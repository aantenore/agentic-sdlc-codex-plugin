import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildObservatoryViewModel,
  startObservatoryServer,
} from "../../lib/change-observatory/index.mjs";

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
  assert.match(model.headers.etag, /^"sha256-[A-Za-z0-9_-]+"$/);
  assert.equal(model.headers["cache-control"], "no-store");

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

  const denied = await request(running, "/api/v1/observatory", { authenticated: false });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json.error.code, "access_denied");
  assert.match(denied.headers["www-authenticate"], /^Bearer /);
});

test("carries a validated locale to the browser without exposing the access token in the query", async (t) => {
  const fixture = await createServerFixture(t);
  const running = await startObservatoryServer({
    projectRoot: fixture.projectRoot,
    assetRoot: fixture.assetRoot,
    locale: "it",
  });
  t.after(() => running.close());

  const access = new URL(running.accessUrl);
  assert.equal(access.hostname, "127.0.0.1");
  assert.equal(access.searchParams.get("locale"), "it");
  assert.equal(access.searchParams.has("access_token"), false);
  assert.match(access.hash, /^#access_token=[A-Za-z0-9_-]+$/u);
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

  for (const invalid of [
    `127.0.0.1:${running.address.port}?x`,
    `127.0.0.1:${running.address.port}#x`,
    `2130706433:${running.address.port}`,
    `127.0.0.1:0${running.address.port}`,
  ]) {
    const response = await request(running, "/api/v1/health", { headers: { Host: invalid } });
    assert.equal(response.statusCode, 400, invalid);
  }

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
  assert.equal(symlink.json.error.code, "symlink_forbidden");

  const inProjectSymlink = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/project-hidden/secret.json")}`,
  );
  assert.equal(inProjectSymlink.statusCode, 403);
  assert.equal(inProjectSymlink.json.error.code, "symlink_forbidden");

  const derived = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/cache/derived.json")}`,
  );
  assert.equal(derived.statusCode, 403);
  assert.equal(derived.json.error.code, "derived_source_forbidden");

  const upperDerived = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/CACHE/derived.json")}`,
  );
  assert.equal(upperDerived.statusCode, 403);
  assert.equal(upperDerived.json.error.code, "derived_source_forbidden");

  await fs.symlink(
    path.join(fixture.projectRoot, ".sdlc", "cache"),
    path.join(fixture.projectRoot, ".sdlc", "alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const alias = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/alias/derived.json")}`,
  );
  assert.equal(alias.statusCode, 403);
  assert.equal(alias.json.error.code, "symlink_forbidden");

  for (const relative of [".sdlc/.env", ".sdlc/private.pem", ".sdlc/blob.bin"]) {
    await fs.writeFile(path.join(fixture.projectRoot, ...relative.split("/")), "secret\0bytes");
    const blocked = await request(
      running,
      `/api/v1/source?path=${encodeURIComponent(relative)}`,
    );
    assert.equal(blocked.statusCode, 403, relative);
    assert.equal(blocked.json.error.code, "source_format_forbidden");
  }
});

test("rejects a symlinked knowledge base and a swapped project root", async (t) => {
  if (process.platform === "win32") t.skip("Directory swap coverage requires Unix symlink semantics");

  const symlinkFixture = await createServerFixture(t);
  const hiddenKnowledgeBase = path.join(symlinkFixture.projectRoot, "hidden-sdlc");
  await fs.rename(path.join(symlinkFixture.projectRoot, ".sdlc"), hiddenKnowledgeBase);
  await fs.symlink(".", path.join(symlinkFixture.projectRoot, ".sdlc"), "dir");
  await fs.writeFile(path.join(symlinkFixture.projectRoot, ".env"), "TOP_SECRET=true\n", "utf8");
  const symlinked = await startObservatoryServer({
    projectRoot: symlinkFixture.projectRoot,
    assetRoot: symlinkFixture.assetRoot,
  });
  t.after(() => symlinked.close());
  const escaped = await request(
    symlinked,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/.env")}`,
  );
  assert.equal(escaped.statusCode, 403);
  assert.equal(escaped.json.error.code, "knowledge_base_symlink");

  const swapFixture = await createServerFixture(t);
  const running = await startObservatoryServer({
    projectRoot: swapFixture.projectRoot,
    assetRoot: swapFixture.assetRoot,
  });
  t.after(() => running.close());
  assert.equal((await request(running, "/api/v1/observatory")).statusCode, 200);
  const original = `${swapFixture.projectRoot}-original`;
  const replacement = `${swapFixture.projectRoot}-replacement`;
  await fs.rename(swapFixture.projectRoot, original);
  await fs.mkdir(path.join(replacement, ".sdlc"), { recursive: true });
  await fs.writeFile(path.join(replacement, ".sdlc", "project.json"), '{"project_id":"attacker"}\n');
  await fs.symlink(replacement, swapFixture.projectRoot, "dir");
  const swapped = await request(running, "/api/v1/observatory");
  assert.equal(swapped.statusCode, 409);
  assert.equal(swapped.json.error.code, "project_boundary_changed");
  assert.doesNotMatch(swapped.body, /attacker/);
});

test("serves revision-aware ETags and honors conditional GET and HEAD requests", async (t) => {
  const fixture = await createServerFixture(t);
  const running = await startObservatoryServer({
    projectRoot: fixture.projectRoot,
    assetRoot: fixture.assetRoot,
  });
  t.after(() => running.close());

  const first = await request(running, "/api/v1/observatory");
  assert.equal(first.statusCode, 200);
  assert.match(first.headers.etag, /^"sha256-[A-Za-z0-9_-]+"$/);

  const unchanged = await request(running, "/api/v1/observatory", {
    headers: { "If-None-Match": first.headers.etag },
  });
  assert.equal(unchanged.statusCode, 304);
  assert.equal(unchanged.body, "");
  assert.equal(unchanged.headers.etag, first.headers.etag);
  assert.equal(unchanged.headers["content-type"], undefined);

  const weakListMatch = await request(running, "/api/v1/observatory", {
    method: "HEAD",
    headers: { "If-None-Match": `"stale", W/${first.headers.etag}` },
  });
  assert.equal(weakListMatch.statusCode, 304);
  assert.equal(weakListMatch.body, "");

  const stale = await request(running, "/api/v1/observatory", {
    headers: { "If-None-Match": '"sha256-stale"' },
  });
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.headers.etag, first.headers.etag);

  const denied = await request(running, "/api/v1/observatory", {
    authenticated: false,
    headers: { "If-None-Match": first.headers.etag },
  });
  assert.equal(denied.statusCode, 401);
  assert.equal(denied.headers.etag, undefined);
});

test("shares concurrent model builds and invalidates only for canonical evidence", async (t) => {
  const fixture = await createServerFixture(t);
  let releaseBuild;
  const buildGate = new Promise((resolve) => {
    releaseBuild = resolve;
  });
  let builds = 0;
  let observedCollectionLimit = null;
  const running = await startObservatoryServer({
    projectRoot: fixture.projectRoot,
    assetRoot: fixture.assetRoot,
    async buildViewModel(...args) {
      builds += 1;
      observedCollectionLimit = args[1].limits.maxCollectionItems;
      if (builds === 1) await buildGate;
      return buildObservatoryViewModel(...args);
    },
  });
  t.after(() => running.close());

  const pending = Array.from({ length: 16 }, () => request(running, "/api/v1/observatory"));
  await waitFor(() => builds === 1);
  releaseBuild();
  const concurrent = await Promise.all(pending);
  assert.ok(concurrent.every((response) => response.statusCode === 200));
  assert.ok(concurrent.every((response) => response.headers.etag === concurrent[0].headers.etag));
  assert.equal(builds, 1);
  assert.equal(observedCollectionLimit, 1_000);

  await fs.mkdir(path.join(fixture.projectRoot, ".sdlc", "cache"), { recursive: true });
  await fs.writeFile(path.join(fixture.projectRoot, ".sdlc", "cache", "derived.json"), "{}\n");
  const derivedOnly = await request(running, "/api/v1/observatory");
  assert.equal(derivedOnly.headers.etag, concurrent[0].headers.etag);
  assert.equal(builds, 1);

  await fs.writeFile(path.join(fixture.projectRoot, ".sdlc", "project.json"), `${JSON.stringify({
    schema_version: "0.1.0",
    project_id: "server-fixture",
    project_name: "Server Fixture Updated",
  })}\n`, "utf8");
  const canonicalChange = await request(running, "/api/v1/observatory", {
    headers: { "If-None-Match": concurrent[0].headers.etag },
  });
  assert.equal(canonicalChange.statusCode, 200);
  assert.equal(canonicalChange.json.project.name, "Server Fixture Updated");
  assert.notEqual(canonicalChange.headers.etag, concurrent[0].headers.etag);
  assert.equal(builds, 2);
});

test("allows an explicit server collection limit to override the safe default", async (t) => {
  const fixture = await createServerFixture(t);
  let observedCollectionLimit = null;
  const running = await startObservatoryServer({
    projectRoot: fixture.projectRoot,
    assetRoot: fixture.assetRoot,
    limits: { maxCollectionItems: 1_500 },
    async buildViewModel(...args) {
      observedCollectionLimit = args[1].limits.maxCollectionItems;
      return buildObservatoryViewModel(...args);
    },
  });
  t.after(() => running.close());

  assert.equal((await request(running, "/api/v1/observatory")).statusCode, 200);
  assert.equal(observedCollectionLimit, 1_500);
});

test("does not serve a warm model after the knowledge-base boundary becomes a symlink", async (t) => {
  if (process.platform === "win32") t.skip("Knowledge-base swap coverage requires Unix symlink semantics");

  const fixture = await createServerFixture(t);
  const running = await startObservatoryServer({
    projectRoot: fixture.projectRoot,
    assetRoot: fixture.assetRoot,
  });
  t.after(() => running.close());
  assert.equal((await request(running, "/api/v1/observatory")).statusCode, 200);

  const canonical = path.join(fixture.projectRoot, ".sdlc");
  const hidden = path.join(fixture.projectRoot, "hidden-sdlc");
  await fs.rename(canonical, hidden);
  await fs.symlink("hidden-sdlc", canonical, "dir");

  const blocked = await request(running, "/api/v1/observatory");
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json.error.code, "knowledge_base_symlink");
});

test("GET, HEAD, and rejected writes do not mutate canonical project evidence", async (t) => {
  const fixture = await createServerFixture(t);
  const running = await startObservatoryServer({
    projectRoot: fixture.projectRoot,
    assetRoot: fixture.assetRoot,
  });
  t.after(() => running.close());
  const before = await snapshotTree(fixture.projectRoot);

  await request(running, "/api/v1/observatory");
  await request(running, `/api/v1/source?path=${encodeURIComponent(".sdlc/project.json")}`);
  await request(running, "/", { method: "HEAD" });
  await request(running, "/api/v1/observatory", { method: "POST" });

  assert.deepEqual(await snapshotTree(fixture.projectRoot), before);
});

test("omits deeply nested raw JSON when bounded private-reasoning redaction cannot finish", async (t) => {
  const fixture = await createServerFixture(t);
  const depth = 12_000;
  const nested = `${'{"next":'.repeat(depth)}{"private_reasoning":"DEEP_PRIVATE_MUST_NOT_LEAK"}${"}".repeat(depth)}`;
  await fs.writeFile(
    path.join(fixture.projectRoot, ".sdlc", "deep-private.json"),
    `{"id":"DEEP-PRIVATE","payload":${nested}}\n`,
    "utf8",
  );
  const running = await startObservatoryServer({
    projectRoot: fixture.projectRoot,
    assetRoot: fixture.assetRoot,
  });
  t.after(() => running.close());

  const source = await request(
    running,
    `/api/v1/source?path=${encodeURIComponent(".sdlc/deep-private.json")}`,
  );
  assert.equal(source.statusCode, 200);
  assert.equal(source.json.provenance, "malformed");
  assert.equal(source.json.parseError, "private_reasoning_scan_limited");
  assert.equal(source.json.contentOmitted, true);
  assert.equal(Object.hasOwn(source.json, "data"), false);
  assert.deepEqual(source.json.redactions, [""]);
  assert.doesNotMatch(source.body, /DEEP_PRIVATE_MUST_NOT_LEAK/);
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

function request(running, requestPath, { method = "GET", headers = {}, authenticated = true } = {}) {
  return new Promise((resolve, reject) => {
    const requestHeaders = {
      Host: `${running.address.host}:${running.address.port}`,
      ...(authenticated && running.accessToken
        ? { Authorization: `Bearer ${running.accessToken}` }
        : {}),
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

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for the model build");
}

async function snapshotTree(root) {
  const files = [];
  async function walk(directory, relative = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child, childRelative);
      } else if (entry.isFile()) {
        const content = await fs.readFile(child);
        files.push([childRelative, crypto.createHash("sha256").update(content).digest("hex")]);
      } else if (entry.isSymbolicLink()) {
        files.push([childRelative, `symlink:${await fs.readlink(child)}`]);
      }
    }
  }
  await walk(root);
  return files;
}
