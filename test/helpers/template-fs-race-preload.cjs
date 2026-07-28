"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { syncBuiltinESMExports } = require("node:module");

const action = process.env.AGENTIC_SDLC_TEST_TEMPLATE_FS_ACTION;
const triggerPath = process.env.AGENTIC_SDLC_TEST_TEMPLATE_FS_TRIGGER
  ? path.resolve(process.env.AGENTIC_SDLC_TEST_TEMPLATE_FS_TRIGGER)
  : null;
const requireTrigger = process.env.AGENTIC_SDLC_TEST_TEMPLATE_FS_REQUIRE_TRIGGER === "1";
const originalOpenSync = fs.openSync;
let triggered = false;

function openedPath(value) {
  if (typeof value === "string") return path.resolve(value);
  if (Buffer.isBuffer(value)) return path.resolve(value.toString("utf8"));
  return null;
}

function writeMarker(markerPath) {
  const descriptor = originalOpenSync.call(fs, markerPath, "a");
  try {
    fs.writeSync(descriptor, "opened\n");
  } finally {
    fs.closeSync(descriptor);
  }
}

if (action && triggerPath) {
  fs.openSync = function templateRaceOpenSync(filePath, ...args) {
    if (!triggered && openedPath(filePath) === triggerPath) {
      triggered = true;
      if (action === "swap-file") {
        fs.renameSync(
          triggerPath,
          path.resolve(process.env.AGENTIC_SDLC_TEST_TEMPLATE_FS_MOVED),
        );
        fs.renameSync(
          path.resolve(process.env.AGENTIC_SDLC_TEST_TEMPLATE_FS_REPLACEMENT),
          triggerPath,
        );
      } else if (action === "retarget-symlink") {
        const linkPath = path.resolve(process.env.AGENTIC_SDLC_TEST_TEMPLATE_FS_LINK);
        fs.unlinkSync(linkPath);
        fs.symlinkSync(
          path.resolve(process.env.AGENTIC_SDLC_TEST_TEMPLATE_FS_LINK_TARGET),
          linkPath,
          process.platform === "win32" ? "junction" : "dir",
        );
      } else if (action === "mark-open") {
        writeMarker(path.resolve(process.env.AGENTIC_SDLC_TEST_TEMPLATE_FS_MARKER));
      } else {
        throw new Error(`Unknown template filesystem test action: ${action}`);
      }
    }
    return originalOpenSync.call(fs, filePath, ...args);
  };
  syncBuiltinESMExports();
}

process.on("exit", () => {
  if (requireTrigger && !triggered) {
    process.stderr.write(`Template filesystem test trigger was not reached: ${triggerPath}\n`);
    process.exitCode = 86;
  }
});
