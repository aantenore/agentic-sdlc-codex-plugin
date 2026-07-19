import path from "node:path";

import { canonicalJson, isPlainRecord } from "../canonical.mjs";

export function deliveryProviderOperationSubjectsMatch(action, persistedSubject, expectedSubject) {
  if (!isPlainRecord(persistedSubject) || !isPlainRecord(expectedSubject)) return false;
  if (canonicalJson(persistedSubject) === canonicalJson(expectedSubject)) return true;
  if (action !== "git.push") return false;

  const { cwd, ...portableSubject } = persistedSubject;
  return typeof cwd === "string"
    && (path.posix.isAbsolute(cwd) || path.win32.isAbsolute(cwd))
    && !cwd.includes("\0")
    && canonicalJson(portableSubject) === canonicalJson(expectedSubject);
}
