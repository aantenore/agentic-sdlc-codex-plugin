import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");
const uiRoot = resolve(repositoryRoot, "ui/change-observatory");
const fixturePath = resolve(repositoryRoot, "test/fixtures/change-observatory/view-model.json");
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const knownSources = new Set(fixture.records.map((record) => record.path));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function send(response, status, body, contentType) {
  response.writeHead(status, {
    "Content-Type": contentType,
    "Content-Security-Policy": CSP,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

export function createPreviewServer() {
  return createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  if (url.pathname === "/api/v1/observatory") {
    send(response, 200, JSON.stringify(fixture), "application/json; charset=utf-8");
    return;
  }
  if (url.pathname === "/api/v1/source") {
    const path = url.searchParams.get("path");
    if (!knownSources.has(path)) {
      send(response, 404, JSON.stringify({ error: "Unknown visual-QA fixture source." }), "application/json; charset=utf-8");
      return;
    }
    send(
      response,
      200,
      JSON.stringify(
        {
          fixture: true,
          notice: "Synthetic record used only for Change Observatory browser QA.",
          path,
          source: fixture.records.find((record) => record.path === path),
        },
        null,
        2,
      ),
      "application/json; charset=utf-8",
    );
    return;
  }

  const relativePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  const target = resolve(uiRoot, relativePath);
  if (target !== uiRoot && !target.startsWith(`${uiRoot}${sep}`)) {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
    return;
  }
  try {
    const body = await readFile(target);
    send(response, 200, body, MIME[extname(target)] ?? "application/octet-stream");
  } catch {
    send(response, 404, "Not found", "text/plain; charset=utf-8");
  }
  });
}

export function parsePreviewPort(argv = []) {
  const portIndex = argv.indexOf("--port");
  const raw = portIndex === -1 ? "4173" : argv[portIndex + 1];
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new TypeError("Preview port must be an integer between 0 and 65535");
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("Preview port must be an integer between 0 and 65535");
  }
  return port;
}

const isMain = !process.env.NODE_TEST_CONTEXT
  && process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createPreviewServer();
  server.listen(parsePreviewPort(process.argv.slice(2)), "127.0.0.1", () => {
    const address = server.address();
    process.stdout.write(`Change Observatory visual-QA fixture: http://127.0.0.1:${address.port}\n`);
  });
}
