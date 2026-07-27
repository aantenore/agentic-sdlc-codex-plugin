import fs from "node:fs";
import path from "node:path";

/**
 * Rejects symlinks between a trusted project boundary and a target path.
 *
 * The boundary is intentionally the first inspected segment. Scanning from a
 * filesystem volume root is both unnecessary once the project root is trusted
 * and incompatible with sandboxes that expose only a nested workspace.
 */
export function assertNoSymlinkSegmentsWithinBoundary(
  boundaryRoot,
  targetPath,
  options = {},
) {
  const fsModule = options.fsModule ?? fs;
  const pathModule = options.pathModule ?? path;
  const boundary = pathModule.resolve(boundaryRoot);
  const target = pathModule.resolve(targetPath);
  const relative = pathModule.relative(boundary, target);
  if (
    relative === ".."
    || relative.startsWith(`..${pathModule.sep}`)
    || pathModule.isAbsolute(relative)
  ) {
    throw new ProjectPathSafetyError(
      `Path escapes the trusted project boundary: ${target}`,
      "PROJECT_PATH_OUTSIDE_BOUNDARY",
    );
  }

  const segments = relative.split(pathModule.sep).filter(Boolean);
  let current = boundary;
  inspectEntry(current, fsModule);
  for (const segment of segments) {
    current = pathModule.join(current, segment);
    inspectEntry(current, fsModule);
  }
  return target;
}

function inspectEntry(entryPath, fsModule) {
  let entry;
  try {
    entry = fsModule.lstatSync(entryPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (entry.isSymbolicLink()) {
    throw new ProjectPathSafetyError(
      `Refusing to follow symlink inside the project boundary: ${entryPath}`,
      "PROJECT_PATH_SYMLINK",
    );
  }
}

export class ProjectPathSafetyError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ProjectPathSafetyError";
    this.code = code;
  }
}
