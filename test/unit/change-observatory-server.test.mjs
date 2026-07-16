import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { startObservatoryServer } from "../../lib/change-observatory/index.mjs";

test("serves health, view model, raw records, static assets, and HEAD over loopback", async (t) => {
  const fixture = await createServerFixture(t);
  const running = await startObservatoryServer({
    projectRoot: fixture.projectRoot,
    assetRoot: fixture.assetRoot,
    port: 0,
    clock: () => new Date("2026-07-16T09:00:00Z"),
  });
  t.after(() => running.close());

  assert.equal(running.address.host, "127.0.0.1");
  assert.match(running.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

  const health = await request(running, "/api/v1/health");
  assert.equal(health.statusCode, 200);
  assert.equal(health.json.status, "ok");
  assert.match(health.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(health.headers["access-control-allow-origin"], undefined);

  const model = await request(running, "/api/v1/observatory");
  assert.equal(model.statusCode, 200);
  assert.equal(model.json.project.id, "server-fixture");
  assert.equal(model.json.generatedAt, "2026-07-16T09:00:00.000Z");

  const source = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/project.json")}`,
  );
  assert.equal(source.statusCode, 200);
  assert.equal(source.json.data.project_id, "server-fixture");
  assert.match(source.json.sha256, /^[a-f0-9]{64}$/);

  const index = await request(running, "/");
  assert.equal(index.statusCode, 200);
  assert.equal(index.headers["content-type"], "text/html; charset=utf-8");
  assert.match(index.body, /Change Observatory/);

  const head = await request(running, "/app.js", { method: "HEAD" });
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, "");
  assert.ok(Number(head.headers["content-length"]) > 0);
});

test("rejects invalid Host, write methods, traversal, derived evidence, and symlink escape", async (t) => {
  const fixture = await createServerFixture(t);
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "change-observatory-outside-"));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, "secret.json"), "{\"secret\":true}\n", "utf8");
  await fs.mkdir(path.join(fixture.projectRoot, "project-hidden"), { recursive: true });
  await fs.writeFile(path.join(fixture.projectRoot, "project-hidden", "secret.json"), "{\"secret\":true}\n", "utf8");
  await fs.symlink(
    outside,
    path.join(fixture.projectRoot, ".sdlc", "external"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await fs.symlink(
    path.join(fixture.projectRoot, "project-hidden"),
    path.join(fixture.projectRoot, ".sdlc", "project-hidden"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await fs.mkdir(path.join(fixture.projectRoot, ".sdlc", "cache"), { recursive: true });
  await fs.writeFile(path.join(fixture.projectRoot, ".sdlc", "cache", "derived.json"), "{}\n", "utf8");

  const running = await startObservatoryServer({
    projectRoot: fixture.projectRoot,
    assetRoot: fixture.assetRoot,
  });
  t.after(() => running.close());

  const invalidHost = await request(running, "/api/v1/health", {
    headers: { Host: "attacker.example" },
  });
  assert.equal(invalidHost.statusCode, 400);
  assert.equal(invalidHost.json.error.code, "invalid_host");

  const wrongPort = await request(running, "/api/v1/health", {
    headers: { Host: "127.0.0.1:1" },
  });
  assert.equal(wrongPort.statusCode, 400);

  const post = await request(running, "/api/v1/observatory", { method: "POST" });
  assert.equal(post.statusCode, 405);
  assert.equal(post.headers.allow, "GET, HEAD");
  assert.equal(post.headers["access-control-allow-origin"], undefined);

  const traversal = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent("../secret.json")}`,
  );
  assert.equal(traversal.statusCode, 403);
  assert.equal(traversal.json.error.code, "path_traversal");

  const encodedStaticTraversal = await request(running, "/%2e%2e%2fsecret.json");
  assert.equal(encodedStaticTraversal.statusCode, 403);

  const symlink = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/external/secret.json")}`,
  );
  assert.equal(symlink.statusCode, 403);
  assert.equal(symlink.json.error.code, "symlink_escape");

  const inProjectSymlink = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/project-hidden/secret.json")}`,
  );
  assert.equal(inProjectSymlink.statusCode, 403);
  assert.equal(inProjectSymlink.json.error.code, "symlink_escape");

  const derived = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/cache/derived.json")}`,
  );
  assert.equal(derived.statusCode, 403);
  assert.equal(derived.json.error.code, "derived_source_forbidden");
});

test("refuses non-loopback bind configuration", async (t) => {
  const fixture = await createServerFixture(t);
  await assert.rejects(
    () => startObservatoryServer({ projectRoot: fixture.projectRoot, host: "0.0.0.0" }),
    /may bind only to 127\.0\.0\.1/,
  );
});

async function createServerFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "change-observatory-server-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  const assetRoot = path.join(root, "assets");
  await fs.mkdir(path.join(projectRoot, ".sdlc"), { recursive: true });
  await fs.mkdir(assetRoot, { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".sdlc", "project.json"), `${JSON.stringify({
    schema_version: "0.1.0",
    project_id: "server-fixture",
    project_name: "Server Fixture",
  })}\n`, "utf8");
  await fs.writeFile(
    path.join(assetRoot, "index.html"),
    "<!doctype html><title>Change Observatory</title><script type=\"module\" src=\"/app.js\"></script>\n",
    "utf8",
  );
  await fs.writeFile(path.join(assetRoot, "app.js"), "export const ready = true;\n", "utf8");
  return { projectRoot, assetRoot };
}

function request(running, requestPath, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = {
      Host: `${running.address.host}:${running.address.port}`,
      ...headers,
    };
    const outgoing = http.request({
      host: running.address.host,
      port: running.address.port,
      path: requestPath,
      method,
      headers: requestHeaders,
    }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        let json = null;
        if ((incoming.headers["content-type"] ?? "").startsWith("application/json") && body) {
          json = JSON.parse(body);
        }
        resolve({
          statusCode: incoming.statusCode,
          headers: incoming.headers,
          body,
          json,
        });
      });
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}
