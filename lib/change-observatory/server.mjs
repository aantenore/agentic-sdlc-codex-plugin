import crypto from "node:crypto";
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
import { createObservatoryModelCache } from "./model-cache.mjs";
import {
  ObservatoryPathError,
  assertDirectoryIdentity,
  captureDirectoryIdentity,
  normalizePortableRelativePath,
  resolveExistingFileWithin,
  resolveProjectBoundary,
} from "./path-safety.mjs";
import { readSourceRecord } from "./source-reader.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_SERVER_COLLECTION_ITEMS = 1_000;

export async function createObservatoryRequestHandler(options = {}) {
  const projectRoot = await resolveProjectBoundary(options.projectRoot);
  const assetRoot = options.assetRoot ? await resolveAssetRoot(options.assetRoot) : null;
  const projectIdentity = await captureDirectoryIdentity(projectRoot, {
    code: "project_boundary_changed",
    label: "project root",
  });
  const assetIdentity = assetRoot
    ? await captureDirectoryIdentity(assetRoot, {
      code: "asset_boundary_changed",
      label: "bundled UI root",
    })
    : null;
  const limits = normalizeServerLimits(options.limits);
  const buildViewModel = options.buildViewModel ?? buildObservatoryViewModel;
  if (typeof buildViewModel !== "function") {
    throw new TypeError("Observatory buildViewModel must be a function");
  }
  const modelCache = createObservatoryModelCache({
    projectRoot,
    limits,
    buildModel: () => buildViewModel(projectRoot, {
      clock: options.clock,
      limits,
      summaryRanking: options.summaryRanking,
    }),
  });
  const accessToken = normalizeAccessToken(options.accessToken, { allowMissing: true });
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
      await assertDirectoryIdentity(projectIdentity);
      if (assetIdentity) await assertDirectoryIdentity(assetIdentity);
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
        validateAccessToken(request.headers.authorization, accessToken);
        const representation = await modelCache.get();
        return sendModelRepresentation(request, response, representation);
      }
      if (url.pathname === "/api/v1/source") {
        validateAccessToken(request.headers.authorization, accessToken);
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

  const accessToken = normalizeAccessToken(
    options.accessToken ?? crypto.randomBytes(32).toString("base64url"),
  );
  let listeningPort = port;
  const handler = await createObservatoryRequestHandler({
    ...options,
    host,
    accessToken,
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
  const accessUrl = new URL(url);
  const locale = String(options.locale || "en").trim().toLowerCase().split(/[-_]/u)[0];
  if (!["en", "it"].includes(locale)) {
    await closeServer(server);
    throw new TypeError("Change Observatory locale must be en or it");
  }
  if (options.locale !== undefined) accessUrl.searchParams.set("locale", locale);
  accessUrl.hash = new URLSearchParams({ access_token: accessToken }).toString();
  let closed = false;

  return {
    server,
    url,
    accessUrl: accessUrl.href,
    accessToken,
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
  if (
    typeof header !== "string"
    || header.trim() === ""
    || header !== header.trim()
    || header.length > 64
    || /[\\/@\s?#]/.test(header)
  ) {
    throw new ObservatoryHttpError("invalid_host", "The Host header is invalid", 400);
  }
  const expected = expectedPort === null || expectedPort === undefined
    ? null
    : `${expectedHost}:${expectedPort}`;
  if (expected ? header !== expected : !new RegExp(`^${expectedHost.replaceAll(".", "\\.")}(?::[0-9]{1,5})?$`).test(header)) {
    throw new ObservatoryHttpError("invalid_host", "The Host header is not allowed", 400);
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

function sendModelRepresentation(request, response, representation) {
  response.setHeader("ETag", representation.etag);
  if (matchesIfNoneMatch(request.headers["if-none-match"], representation.etag)) {
    response.statusCode = 304;
    response.end();
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", String(representation.body.byteLength));
  if (request.method === "HEAD") {
    response.end();
  } else {
    response.end(representation.body);
  }
}

function matchesIfNoneMatch(header, currentEtag) {
  if (typeof header !== "string") return false;
  return header.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    if (trimmed === "*") return true;
    const weakCandidate = trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
    return weakCandidate === currentEtag;
  });
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
  if (statusCode === 401) {
    response.setHeader("WWW-Authenticate", 'Bearer realm="Change Observatory"');
  }
  return sendJson(request, response, statusCode, {
    error: {
      code: isKnown ? error.code : "internal_error",
      message: isKnown ? error.message : "The request could not be completed",
    },
  });
}

function normalizeAccessToken(value, { allowMissing = false } = {}) {
  if ((value === undefined || value === null || value === "") && allowMissing) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(value)) {
    throw new TypeError("Observatory access token must be a 32-256 character base64url value");
  }
  return value;
}

function normalizeServerLimits(value) {
  const normalized = normalizeObservatoryLimits(value);
  if (value && Object.hasOwn(value, "maxCollectionItems")) return normalized;
  return Object.freeze({
    ...normalized,
    maxCollectionItems: DEFAULT_SERVER_COLLECTION_ITEMS,
  });
}

function validateAccessToken(header, expectedToken) {
  if (!expectedToken) return;
  const match = typeof header === "string" ? header.match(/^Bearer ([A-Za-z0-9_-]+)$/) : null;
  const candidate = match?.[1] ?? "";
  const expected = Buffer.from(expectedToken, "utf8");
  const actual = Buffer.from(candidate, "utf8");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new ObservatoryHttpError("access_denied", "A valid per-run access token is required", 401);
  }
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
