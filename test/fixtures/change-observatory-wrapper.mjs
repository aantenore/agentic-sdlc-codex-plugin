import { fileURLToPath } from "node:url";

import { launchDedicatedObservatory } from "../../lib/change-observatory/runtime.mjs";

const scriptPath = fileURLToPath(new URL("../../bin/agentic-sdlc.mjs", import.meta.url));
const termination = await launchDedicatedObservatory({
  argv: process.argv.slice(2),
  scriptPath,
  platform: "win32",
});
process.exitCode = termination.exitCode;
