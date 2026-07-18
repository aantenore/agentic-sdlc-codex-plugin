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
  writeObserveEvent,
} from "../../lib/change-observatory/cli.mjs";

const TECHNICAL_ONLY = /\b(?:bounded-autonomous|checkpoint(?:ed|_required)|audit_only|host_verified|profile|receipt|ceiling|schema|hash|reason[ _-]?code|AUT-[A-Z0-9-]+)\b/iu;

test("normalizes loopback launch options and validates ports", () => {
  assert.deepEqual(
    parseObserveOptions({ projectRoot: ".", host: "127.0.0.1", port: "0", openBrowser: false }),
    {
      projectRoot: path.resolve("."),
      host: "127.0.0.1",
      port: 0,
      openBrowser: false,
      json: false,
      locale: "en",
    },
  );
  assert.throws(() => parseObserveOptions({ host: "0.0.0.0" }), /only to 127\.0\.0\.1/);
  for (const port of ["", "1.5", "abc", -1, 65_536]) {
    assert.throws(() => parseObserveOptions({ port }), /integer between 0 and 65535/);
  }
  assert.equal(parseObserveOptions({ locale: "it-IT" }).locale, "it");
  assert.throws(() => parseObserveOptions({ locale: "fr" }), /must be en or it/);
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
  assert.equal(receivedOptions.locale, "en");
  const event = JSON.parse(output.value.trim());
  assert.equal(event.event, "observatory.ready");
  assert.equal(event.browser_open_requested, false);
  assert.equal(event.authentication, "per-run-bearer-fragment");
  assert.equal(event.locale, "en");
  await running.close();
  await running.close();
  assert.equal(closeCount, 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("human launch events explain outcome and protections before optional technical details", () => {
  for (const locale of ["en", "it"]) {
    const output = createMemoryStream();
    writeObserveEvent(output, {
      event: "observatory.ready",
      locale,
      url: "http://127.0.0.1:43127/?locale=it#access_token=secret",
      project_root: "/tmp/project",
    });
    const divider = locale === "it"
      ? "Dettagli tecnici (facoltativi):"
      : "Technical details (optional):";
    const [human, technical] = output.value.split(divider);
    for (const label of locale === "it"
      ? ["Risultato:", "Cosa cambia in pratica:", "Cosa devi decidere:", "Cosa resta protetto:", "Prossimo passo:"]
      : ["Outcome:", "What this changes in practice:", "What you need to decide:", "What remains protected:", "Next step:"]) {
      assert.match(human, new RegExp(label));
    }
    assert.doesNotMatch(human, TECHNICAL_ONLY);
    assert.match(technical, /127\.0\.0\.1/u);
  }
});

test("async browser and shutdown failures keep platform and errors after the technical divider", () => {
  for (const locale of ["en", "it"]) {
    for (const event of [
      {
        event: "observatory.browser_open_failed",
        locale,
        url: "http://127.0.0.1:43127/#access_token=secret",
        platform: "test-platform",
        error: "spawn EACCES",
      },
      {
        event: "observatory.shutdown_failed",
        locale,
        platform: "test-platform",
        error: "close EBUSY",
      },
    ]) {
      const output = createMemoryStream();
      writeObserveEvent(output, event);
      const divider = locale === "it"
        ? "Dettagli tecnici (facoltativi):"
        : "Technical details (optional):";
      const [human, technical] = output.value.split(divider);
      const labels = locale === "it"
        ? ["Risultato:", "Cosa cambia in pratica:", "Cosa devi decidere:", "Cosa resta protetto:", "Prossimo passo:"]
        : ["Outcome:", "What this changes in practice:", "What you need to decide:", "What remains protected:", "Next step:"];
      for (const label of labels) assert.match(human, new RegExp(label));
      assert.doesNotMatch(human, /test-platform|EACCES|EBUSY/u);
      assert.match(technical, /test-platform/u);
      assert.match(technical, event.event.endsWith("browser_open_failed") ? /EACCES/u : /EBUSY/u);
    }
  }
});

test("run command routes asynchronous opener and shutdown errors through human guidance", async () => {
  const browserStdout = createMemoryStream();
  const browserStderr = createMemoryStream();
  const browserRun = await runObserveCommand({ projectRoot: ".", locale: "en" }, {
    registerSignals: false,
    stdout: browserStdout,
    stderr: browserStderr,
    processRef: { platform: "test-platform" },
    opener(_url, { onError }) {
      onError(new Error("spawn EACCES"));
    },
    serverFactory: successfulServer,
  });
  assert.match(browserStderr.value, /^Outcome:/u);
  const [browserHuman, browserTechnical] = browserStderr.value.split("Technical details (optional):");
  assert.doesNotMatch(browserHuman, /test-platform|EACCES/u);
  assert.match(browserTechnical, /test-platform[\s\S]*EACCES/u);
  await browserRun.close();

  const shutdownStdout = createMemoryStream();
  const shutdownStderr = createMemoryStream();
  const processRef = new EventEmitter();
  processRef.exitCode = null;
  processRef.platform = "test-platform";
  await runObserveCommand({ projectRoot: ".", openBrowser: false, locale: "it" }, {
    stdout: shutdownStdout,
    stderr: shutdownStderr,
    processRef,
    async serverFactory() {
      return {
        ...(await successfulServer()),
        async close() {
          throw new Error("close EBUSY");
        },
      };
    },
  });
  processRef.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(processRef.exitCode, 1);
  const [shutdownHuman, shutdownTechnical] = shutdownStderr.value.split("Dettagli tecnici (facoltativi):");
  assert.doesNotMatch(shutdownHuman, /test-platform|EBUSY/u);
  assert.match(shutdownTechnical, /test-platform[\s\S]*EBUSY/u);
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

async function successfulServer() {
  return {
    url: "http://127.0.0.1:43127/",
    accessUrl: "http://127.0.0.1:43127/#access_token=secret",
    healthUrl: "http://127.0.0.1:43127/api/v1/health",
    modelUrl: "http://127.0.0.1:43127/api/v1/observatory",
    address: { host: "127.0.0.1", port: 43127 },
    async close() {},
  };
}
