const SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;


export class ReleaseWorkflowGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReleaseWorkflowGuardError";
    this.code = code;
  }
}


function fail(code, message) {
  throw new ReleaseWorkflowGuardError(code, message);
}


export function parseReleaseTag(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    fail("INVALID_RELEASE_TAG", "release tag must be v followed by a strict SemVer version");
  }
  const version = tag.slice(1);
  const match = SEMVER.exec(version);
  if (!match) {
    fail("INVALID_RELEASE_TAG", "release tag must be v followed by a strict SemVer version");
  }
  return Object.freeze({
    tag,
    version,
    prerelease: match[4] ?? null,
    build: match[5] ?? null,
    isPrerelease: match[4] !== undefined,
  });
}
