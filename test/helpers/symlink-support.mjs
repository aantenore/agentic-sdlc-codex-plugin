import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WINDOWS_UNAVAILABLE_CODES = new Set(["EACCES", "ENOSYS", "ENOTSUP", "EPERM"]);
const capabilityByType = new Map();

export function requireSymlinkSupport(testContext, type = "file") {
  if (process.platform !== "win32") return true;

  const cached = capabilityByType.get(type);
  if (cached !== undefined) {
    if (cached === true) return true;
    testContext.skip(`Windows ${type} symlinks are unavailable: ${cached}`);
    return false;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agentic-sdlc-symlink-${type}-`));
  const target = path.join(root, "target");
  const link = path.join(root, "link");
  try {
    if (type === "dir" || type === "junction") {
      fs.mkdirSync(target);
    } else {
      fs.writeFileSync(target, "symlink capability probe\n", "utf8");
    }
    fs.symlinkSync(target, link, type);
    capabilityByType.set(type, true);
    return true;
  } catch (error) {
    if (!WINDOWS_UNAVAILABLE_CODES.has(error?.code)) throw error;
    capabilityByType.set(type, error.code);
    testContext.skip(`Windows ${type} symlinks are unavailable: ${error.code}`);
    return false;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
