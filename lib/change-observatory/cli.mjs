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
  const locale = String(options.locale || "en").trim().toLowerCase().split(/[-_]/u)[0];
  if (!["en", "it"].includes(locale)) {
    throw new TypeError("Change Observatory locale must be en or it");
  }
  return Object.freeze({
    projectRoot,
    host,
    port,
    openBrowser: options.openBrowser !== false,
    json: options.json === true,
    locale,
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
    locale: parsed.locale,
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
      locale: parsed.locale,
    }, { json: parsed.json });
  };

  if (dependencies.registerSignals !== false) {
    signals = registerShutdownHandlers({
      processRef,
      shutdown: announceStopped,
      onError(error) {
        processRef.exitCode = 1;
        writeObserveEvent(stderr, {
          event: "observatory.shutdown_failed",
          status: "error",
          error: String(error?.message ?? error),
          platform: processRef.platform ?? process.platform,
          locale: parsed.locale,
        }, { json: parsed.json });
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
    locale: parsed.locale,
  };
  writeObserveEvent(stdout, readyEvent, { json: parsed.json });

  if (parsed.openBrowser) {
    opener(readyEvent.url, {
      onError(error) {
        writeObserveEvent(stderr, {
          event: "observatory.browser_open_failed",
          status: "warning",
          url: readyEvent.url,
          error: String(error?.message ?? error),
          platform: processRef.platform ?? process.platform,
          locale: parsed.locale,
        }, { json: parsed.json });
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
  const italian = event.locale === "it";
  if (event.event === "observatory.ready") {
    stream.write([
      `${italian ? "Risultato" : "Outcome"}: ${italian ? "L’osservatorio locale è pronto." : "The local observatory is ready."}`,
      `${italian ? "Cosa cambia in pratica" : "What this changes in practice"}: ${italian ? "Puoi esplorare richieste, modifiche, decisioni e prove dal browser." : "You can explore requests, changes, decisions, and evidence in the browser."}`,
      `${italian ? "Cosa devi decidere" : "What you need to decide"}: ${italian ? "Non devi approvare nulla per aprire questa vista." : "You do not need to approve anything to open this view."}`,
      `${italian ? "Cosa resta protetto" : "What remains protected"}: ${italian ? "La sessione è locale e in sola lettura; non modifica file e non pubblica dati." : "The session is local and read-only; it does not change files or publish data."}`,
      `${italian ? "Prossimo passo" : "Next step"}: ${italian ? "Apri la pagina nel browser; premi Ctrl+C quando hai finito." : "Open the page in your browser; press Ctrl+C when finished."}`,
      "",
      `${italian ? "Dettagli tecnici (facoltativi)" : "Technical details (optional)"}:`,
      `- URL: ${event.url}`,
      `- ${italian ? "Progetto" : "Project"}: ${event.project_root}`,
      "",
    ].join("\n"));
    return;
  }
  if (event.event === "observatory.browser_open_failed") {
    stream.write([
      `${italian ? "Risultato" : "Outcome"}: ${italian ? "L’osservatorio locale è pronto, ma il browser non si è aperto automaticamente." : "The local observatory is ready, but the browser did not open automatically."}`,
      `${italian ? "Cosa cambia in pratica" : "What this changes in practice"}: ${italian ? "La pagina in sola lettura resta disponibile all’indirizzo già mostrato." : "The read-only page is still available at the address already shown."}`,
      `${italian ? "Cosa devi decidere" : "What you need to decide"}: ${italian ? "Non devi approvare nulla." : "You do not need to approve anything."}`,
      `${italian ? "Cosa resta protetto" : "What remains protected"}: ${italian ? "Nessun file del progetto è stato modificato e nessun dato è stato pubblicato." : "No project file was changed and no data was published."}`,
      `${italian ? "Prossimo passo" : "Next step"}: ${italian ? "Copia l’indirizzo dai dettagli facoltativi e aprilo nel browser." : "Copy the address from the optional details and open it in your browser."}`,
      "",
      `${italian ? "Dettagli tecnici (facoltativi)" : "Technical details (optional)"}:`,
      `- URL: ${event.url}`,
      `- Platform: ${event.platform}`,
      `- Error: ${event.error}`,
      "",
    ].join("\n"));
    return;
  }
  if (event.event === "observatory.shutdown_failed") {
    stream.write([
      `${italian ? "Risultato" : "Outcome"}: ${italian ? "L’osservatorio non è riuscito a chiudersi correttamente." : "The observatory could not finish closing cleanly."}`,
      `${italian ? "Cosa cambia in pratica" : "What this changes in practice"}: ${italian ? "La pagina potrebbe restare disponibile finché il processo non viene terminato." : "The page may remain available until the process is stopped."}`,
      `${italian ? "Cosa devi decidere" : "What you need to decide"}: ${italian ? "Non serve alcuna approvazione." : "No approval is needed."}`,
      `${italian ? "Cosa resta protetto" : "What remains protected"}: ${italian ? "La vista resta in sola lettura e l’errore non autorizza modifiche ai file." : "The viewer remains read-only, and the failure does not authorize file changes."}`,
      `${italian ? "Prossimo passo" : "Next step"}: ${italian ? "Termina manualmente il processo; se serve, riapri poi l’osservatorio." : "Stop the process manually; then reopen the observatory if needed."}`,
      "",
      `${italian ? "Dettagli tecnici (facoltativi)" : "Technical details (optional)"}:`,
      `- Platform: ${event.platform}`,
      `- Error: ${event.error}`,
      "",
    ].join("\n"));
    return;
  }
  if (event.event === "observatory.stopped") {
    stream.write([
      `${italian ? "Risultato" : "Outcome"}: ${italian ? "L’osservatorio locale è stato chiuso." : "The local observatory was stopped."}`,
      `${italian ? "Cosa cambia in pratica" : "What this changes in practice"}: ${italian ? "La pagina non riceverà altri aggiornamenti finché non verrà riaperta." : "The page will not receive more updates until it is opened again."}`,
      `${italian ? "Cosa devi decidere" : "What you need to decide"}: ${italian ? "Non devi decidere nulla." : "You do not need to decide anything."}`,
      `${italian ? "Cosa resta protetto" : "What remains protected"}: ${italian ? "Nessun file è stato modificato dalla chiusura." : "Stopping the session did not change any files."}`,
      `${italian ? "Prossimo passo" : "Next step"}: ${italian ? "Riapri l’osservatorio quando vuoi consultare di nuovo le prove." : "Open the observatory again when you want to review the evidence."}`,
      ...(event.signal ? ["", `${italian ? "Dettagli tecnici (facoltativi)" : "Technical details (optional)"}:`, `- Signal: ${event.signal}`] : []),
      "",
    ].join("\n"));
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
