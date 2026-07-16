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
const requestedPort = Number.parseInt(process.argv[process.argv.indexOf("--port") + 1] ?? "4173", 10);

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

const server = createServer(async (request, response) => {
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

server.listen(requestedPort, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`Change Observatory visual-QA fixture: http://127.0.0.1:${address.port}\n`);
});
