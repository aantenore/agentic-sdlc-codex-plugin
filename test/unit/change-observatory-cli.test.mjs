import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  bundledObservatoryAssetRoot,
  openBrowserBestEffort,
  parseObserveOptions,
  registerShutdownHandlers,
  runObserveCommand,
} from "../../lib/change-observatory/cli.mjs";

test("normalizes loopback launch options and validates ports", () => {
  assert.deepEqual(
    parseObserveOptions({ projectRoot: ".", host: "127.0.0.1", port: "0", openBrowser: false }),
    {
      projectRoot: path.resolve("."),
      host: "127.0.0.1",
      port: 0,
      openBrowser: false,
      json: false,
    },
  );
  assert.throws(() => parseObserveOptions({ host: "0.0.0.0" }), /only to 127\.0\.0\.1/);
  for (const port of ["", "1.5", "abc", -1, 65_536]) {
    assert.throws(() => parseObserveOptions({ port }), /integer between 0 and 65535/);
  }
});

test("resolves the bundled UI relative to the installed launcher module", async () => {
  const assetRoot = bundledObservatoryAssetRoot();
  assert.equal(path.isAbsolute(assetRoot), true);
  assert.equal((await fs.stat(path.join(assetRoot, "index.html"))).isFile(), true);
  assert.equal((await fs.stat(path.join(assetRoot, "app.js"))).isFile(), true);
});

test("run command suppresses the opener with --no-open and emits one ready event", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-cli-"));
  const output = createMemoryStream();
  let opened = false;
  let receivedOptions = null;
  let closeCount = 0;
  const running = await runObserveCommand({
    projectRoot: root,
    openBrowser: false,
    json: true,
  }, {
    registerSignals: false,
    stdout: output,
    opener() {
      opened = true;
    },
    async serverFactory(options) {
      receivedOptions = options;
      return {
        url: "http://127.0.0.1:43127/",
        accessUrl: `http://127.0.0.1:43127/#access_token=${"a".repeat(43)}`,
        healthUrl: "http://127.0.0.1:43127/api/v1/health",
        modelUrl: "http://127.0.0.1:43127/api/v1/observatory",
        address: { host: "127.0.0.1", port: 43127 },
        async close() {
          closeCount += 1;
        },
      };
    },
  });

  assert.equal(opened, false);
  assert.equal(receivedOptions.assetRoot, bundledObservatoryAssetRoot());
  const event = JSON.parse(output.value.trim());
  assert.equal(event.event, "observatory.ready");
  assert.equal(event.browser_open_requested, false);
  assert.equal(event.authentication, "per-run-bearer-fragment");
  await running.close();
  await running.close();
  assert.equal(closeCount, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("browser opener passes URL as an argument with shell disabled", () => {
  const calls = [];
  const child = new EventEmitter();
  child.unref = () => {
    child.unrefCalled = true;
  };
  openBrowserBestEffort("http://127.0.0.1:43127/#access_token=token", {
    platform: "darwin",
    spawn(executable, args, options) {
      calls.push({ executable, args, options });
      return child;
    },
  });

  assert.deepEqual(calls[0].args, ["http://127.0.0.1:43127/#access_token=token"]);
  assert.equal(calls[0].executable, "open");
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, "ignore");
  assert.equal(child.unrefCalled, true);
});

test("signal handlers close once and leave process exit to the event loop", async () => {
  const processRef = new EventEmitter();
  processRef.exitCode = null;
  const seen = [];
  const handlers = registerShutdownHandlers({
    processRef,
    async shutdown(signal) {
      seen.push(signal);
    },
  });

  processRef.emit("SIGTERM");
  processRef.emit("SIGINT");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ["SIGTERM"]);
  assert.equal(processRef.exitCode, 0);
  assert.equal(processRef.listenerCount("SIGTERM"), 0);
  assert.equal(processRef.listenerCount("SIGINT"), 0);
  handlers.dispose();
});

function createMemoryStream() {
  return {
    value: "",
    write(chunk) {
      this.value += String(chunk);
      return true;
    },
  };
}
