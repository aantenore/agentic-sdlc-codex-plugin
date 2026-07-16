import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import {
  OBSERVATORY_HEALTH_SCHEMA_VERSION,
  OBSERVATORY_VIEW_SCHEMA_VERSION,
  SECURITY_HEADERS,
  normalizeObservatoryLimits,
} from "./constants.mjs";
import { buildObservatoryViewModel } from "./normalizer.mjs";
import {
  ObservatoryPathError,
  normalizePortableRelativePath,
  resolveExistingFileWithin,
  resolveProjectBoundary,
} from "./path-safety.mjs";
import { readSourceRecord } from "./source-reader.mjs";

const LOOPBACK_HOST = "127.0.0.1";

export async function createObservatoryRequestHandler(options = {}) {
  const projectRoot = await resolveProjectBoundary(options.projectRoot);
  const assetRoot = options.assetRoot ? await resolveAssetRoot(options.assetRoot) : null;
  const limits = normalizeObservatoryLimits(options.limits);
  const host = options.host ?? LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) {
    throw new TypeError(`Change Observatory may bind only to ${LOOPBACK_HOST}`);
  }
  const expectedPort = typeof options.expectedPort === "function"
    ? options.expectedPort
    : () => options.expectedPort ?? null;

  return async function observatoryRequestHandler(request, response) {
    applySecurityHeaders(response);
    try {
      validateRequestMethod(request.method);
      validateHostHeader(request.headers.host, host, expectedPort());
      validateRawRequestPath(request.url);

      const url = new URL(request.url ?? "/", `http://${host}`);
      if (url.pathname === "/api/v1/health") {
        return sendJson(request, response, 200, {
          schemaVersion: OBSERVATORY_HEALTH_SCHEMA_VERSION,
          status: "ok",
          modelSchemaVersion: OBSERVATORY_VIEW_SCHEMA_VERSION,
        });
      }
      if (url.pathname === "/api/v1/observatory") {
        const model = await buildObservatoryViewModel(projectRoot, {
          clock: options.clock,
          limits,
        });
        return sendJson(request, response, 200, model);
      }
      if (url.pathname === "/api/v1/source") {
        const sourcePaths = url.searchParams.getAll("path");
        if (sourcePaths.length !== 1) {
          throw new ObservatoryHttpError("invalid_source_request", "Exactly one source path is required", 400);
        }
        const source = await readSourceRecord(projectRoot, sourcePaths[0], { limits });
        return sendJson(request, response, 200, source);
      }
      if (url.pathname.startsWith("/api/")) {
        throw new ObservatoryHttpError("api_not_found", "The requested API endpoint does not exist", 404);
      }
      if (!assetRoot) {
        throw new ObservatoryHttpError("asset_not_found", "No bundled user interface is configured", 404);
      }
      return serveStaticAsset(request, response, assetRoot, url.pathname, limits);
    } catch (error) {
      return sendError(request, response, error);
    }
  };
}

export async function startObservatoryServer(options = {}) {
  const host = options.host ?? LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) {
    throw new TypeError(`Change Observatory may bind only to ${LOOPBACK_HOST}`);
  }
  const port = options.port ?? 0;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("Observatory port must be an integer between 0 and 65535");
  }

  let listeningPort = port;
  const handler = await createObservatoryRequestHandler({
    ...options,
    host,
    expectedPort: () => listeningPort,
  });
  const server = http.createServer((request, response) => {
    handler(request, response).catch((error) => sendError(request, response, error));
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host, port, exclusive: true });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Observatory server did not expose a TCP address");
  }
  listeningPort = address.port;
  const url = `http://${host}:${listeningPort}/`;
  let closed = false;

  return {
    server,
    url,
    address: { host, port: listeningPort },
    healthUrl: new URL("api/v1/health", url).href,
    modelUrl: new URL("api/v1/observatory", url).href,
    async close() {
      if (closed) return;
      closed = true;
      await closeServer(server);
    },
  };
}

class ObservatoryHttpError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "ObservatoryHttpError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function validateRequestMethod(method) {
  if (!["GET", "HEAD"].includes(method)) {
    throw new ObservatoryHttpError("method_not_allowed", "Only GET and HEAD are allowed", 405);
  }
}

function validateHostHeader(header, expectedHost, expectedPort) {
  if (typeof header !== "string" || header.trim() === "" || /[\\/@\s]/.test(header)) {
    throw new ObservatoryHttpError("invalid_host", "The Host header is invalid", 400);
  }

  let parsed;
  try {
    parsed = new URL(`http://${header}`);
  } catch {
    throw new ObservatoryHttpError("invalid_host", "The Host header is invalid", 400);
  }
  if (parsed.hostname !== expectedHost) {
    throw new ObservatoryHttpError("invalid_host", "The Host header is not allowed", 400);
  }
  if (expectedPort !== null && expectedPort !== undefined && parsed.port !== String(expectedPort)) {
    throw new ObservatoryHttpError("invalid_host", "The Host header port is not allowed", 400);
  }
}

function validateRawRequestPath(requestUrl) {
  const rawPath = String(requestUrl ?? "/").split("?", 1)[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    throw new ObservatoryHttpError("invalid_path_encoding", "The request path is not valid UTF-8", 400);
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    throw new ObservatoryHttpError("invalid_path", "The request path is invalid", 400);
  }
  if (decoded.split("/").some((segment) => segment === "..")) {
    throw new ObservatoryHttpError("path_traversal", "Path traversal is not allowed", 403);
  }
}

async function serveStaticAsset(request, response, assetRoot, pathname, limits) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new ObservatoryHttpError("invalid_path_encoding", "The request path is not valid UTF-8", 400);
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const normalized = normalizePortableRelativePath(relative);
  let asset;
  try {
    asset = await resolveExistingFileWithin(assetRoot, normalized);
  } catch (error) {
    if (error instanceof ObservatoryPathError) {
      const statusCode = error.statusCode === 403 ? 403 : 404;
      throw new ObservatoryHttpError(error.code, statusCode === 403 ? "The asset path is not allowed" : "Asset not found", statusCode);
    }
    throw error;
  }
  if (asset.stats.size > limits.maxAssetBytes) {
    throw new ObservatoryHttpError("asset_too_large", "The requested asset exceeds the configured size limit", 413);
  }
  const content = await fs.readFile(asset.resolved);
  if (content.byteLength > limits.maxAssetBytes) {
    throw new ObservatoryHttpError("asset_too_large", "The requested asset exceeds the configured size limit", 413);
  }
  response.statusCode = 200;
  response.setHeader("Content-Type", mimeType(normalized));
  response.setHeader("Content-Length", String(content.byteLength));
  if (request.method === "HEAD") {
    response.end();
  } else {
    response.end(content);
  }
}

function sendJson(request, response, statusCode, payload) {
  const body = Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", String(body.byteLength));
  if (request.method === "HEAD") {
    response.end();
  } else {
    response.end(body);
  }
}

function sendError(request, response, error) {
  if (response.headersSent || response.writableEnded) {
    if (!response.writableEnded) response.end();
    return;
  }
  applySecurityHeaders(response);
  const isKnown = error instanceof ObservatoryHttpError || error instanceof ObservatoryPathError;
  const statusCode = isKnown ? error.statusCode : 500;
  if (statusCode === 405) {
    response.setHeader("Allow", "GET, HEAD");
  }
  return sendJson(request, response, statusCode, {
    error: {
      code: isKnown ? error.code : "internal_error",
      message: isKnown ? error.message : "The request could not be completed",
    },
  });
}

function applySecurityHeaders(response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

async function resolveAssetRoot(assetRoot) {
  const resolved = await fs.realpath(path.resolve(assetRoot));
  const stats = await fs.stat(resolved);
  if (!stats.isDirectory()) {
    throw new TypeError("Observatory assetRoot must be a directory");
  }
  return resolved;
}

function mimeType(relativePath) {
  switch (path.posix.extname(relativePath).toLowerCase()) {
    case ".html": return "text/html; charset=utf-8";
    case ".css": return "text/css; charset=utf-8";
    case ".js":
    case ".mjs": return "text/javascript; charset=utf-8";
    case ".json": return "application/json; charset=utf-8";
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".ico": return "image/x-icon";
    case ".woff2": return "font/woff2";
    default: return "application/octet-stream";
  }
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
