import childProcess from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startObservatoryServer } from "./server.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const DEFAULT_ASSET_ROOT = fileURLToPath(
  new URL("../../ui/change-observatory/", import.meta.url),
);

export function bundledObservatoryAssetRoot() {
  return DEFAULT_ASSET_ROOT;
}

export function parseObserveOptions(options = {}) {
  const host = options.host === undefined ? LOOPBACK_HOST : String(options.host).trim();
  if (host !== LOOPBACK_HOST) {
    throw new TypeError(`Change Observatory may bind only to ${LOOPBACK_HOST}`);
  }

  const rawPort = options.port === undefined ? 0 : options.port;
  if (typeof rawPort === "string" && rawPort.trim() === "") {
    throw new TypeError("Observatory port must be an integer between 0 and 65535");
  }
  const port = typeof rawPort === "number" ? rawPort : Number(String(rawPort).trim());
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("Observatory port must be an integer between 0 and 65535");
  }

  const projectRoot = path.resolve(String(options.projectRoot || process.cwd()));
  return Object.freeze({
    projectRoot,
    host,
    port,
    openBrowser: options.openBrowser !== false,
    json: options.json === true,
  });
}

export async function runObserveCommand(options = {}, dependencies = {}) {
  const parsed = parseObserveOptions(options);
  const serverFactory = dependencies.serverFactory ?? startObservatoryServer;
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const processRef = dependencies.processRef ?? process;
  const opener = dependencies.opener ?? openBrowserBestEffort;
  const running = await serverFactory({
    projectRoot: parsed.projectRoot,
    assetRoot: DEFAULT_ASSET_ROOT,
    host: parsed.host,
    port: parsed.port,
  });

  let closed = false;
  let signals = null;
  const announceStopped = async (signal = null) => {
    if (closed) return;
    closed = true;
    signals?.dispose();
    await running.close();
    writeObserveEvent(stdout, {
      event: "observatory.stopped",
      status: "stopped",
      signal,
    }, { json: parsed.json });
  };

  if (dependencies.registerSignals !== false) {
    signals = registerShutdownHandlers({
      processRef,
      shutdown: announceStopped,
      onError(error) {
        processRef.exitCode = 1;
        stderr.write(`Change Observatory shutdown failed: ${error.message}\n`);
      },
    });
  }

  const readyEvent = {
    event: "observatory.ready",
    status: "ready",
    url: running.accessUrl ?? running.url,
    base_url: running.url,
    health_url: running.healthUrl,
    model_url: running.modelUrl,
    host: running.address.host,
    port: running.address.port,
    project_root: parsed.projectRoot,
    browser_open_requested: parsed.openBrowser,
    authentication: running.accessUrl ? "per-run-bearer-fragment" : "none",
  };
  writeObserveEvent(stdout, readyEvent, { json: parsed.json });

  if (parsed.openBrowser) {
    opener(readyEvent.url, {
      onError(error) {
        if (!parsed.json) {
          stderr.write(`Browser could not be opened automatically: ${error.message}\n`);
        }
      },
    });
  }

  return {
    ...running,
    readyEvent,
    async close() {
      await announceStopped(null);
    },
    shutdown: announceStopped,
  };
}

export function openBrowserBestEffort(url, options = {}) {
  const platform = options.platform ?? process.platform;
  const spawn = options.spawn ?? childProcess.spawn;
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  const command = browserCommand(platform, url);
  if (!command) {
    onError(new Error(`Automatic browser opening is unsupported on ${platform}`));
    return null;
  }

  try {
    const child = spawn(command.executable, command.arguments, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once?.("error", onError);
    child.unref?.();
    return child;
  } catch (error) {
    onError(error);
    return null;
  }
}

export function registerShutdownHandlers({
  shutdown,
  processRef = process,
  onError = () => {},
}) {
  if (typeof shutdown !== "function") {
    throw new TypeError("A shutdown callback is required");
  }
  let active = true;
  let shuttingDown = false;
  const handlers = new Map();

  const dispose = () => {
    if (!active) return;
    active = false;
    for (const [signal, handler] of handlers) {
      processRef.removeListener(signal, handler);
    }
    handlers.clear();
  };

  for (const signal of ["SIGINT", "SIGTERM"]) {
    const handler = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      Promise.resolve(shutdown(signal))
        .then(() => {
          processRef.exitCode = 0;
        })
        .catch(onError)
        .finally(dispose);
    };
    handlers.set(signal, handler);
    processRef.on(signal, handler);
  }

  return { dispose };
}

export function writeObserveEvent(stream, event, { json = false } = {}) {
  if (json) {
    stream.write(`${JSON.stringify(event)}\n`);
    return;
  }
  if (event.event === "observatory.ready") {
    stream.write([
      `Change Observatory ready: ${event.url}`,
      `Project: ${event.project_root}`,
      "Read-only local session. Press Ctrl+C to stop.",
      "",
    ].join("\n"));
    return;
  }
  if (event.event === "observatory.stopped") {
    stream.write(`Change Observatory stopped${event.signal ? ` (${event.signal})` : ""}.\n`);
  }
}

function browserCommand(platform, url) {
  if (platform === "darwin") return { executable: "open", arguments: [url] };
  if (platform === "win32") {
    return {
      executable: "rundll32.exe",
      arguments: ["url.dll,FileProtocolHandler", url],
    };
  }
  if (["linux", "freebsd", "openbsd"].includes(platform)) {
    return { executable: "xdg-open", arguments: [url] };
  }
  return null;
}
