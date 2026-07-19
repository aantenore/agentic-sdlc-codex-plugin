import fs from "node:fs";
import path from "node:path";

import { isPlainRecord, requireNonEmptyString } from "../../canonical.mjs";
import {
  DELIVERY_PROVIDER_SPI_VERSION,
  DeliveryProviderError,
} from "../provider-registry.mjs";

export const LOCAL_FILESYSTEM_PROVIDER_ID = "local-filesystem";

const SUBJECT_KEYS = new Set(["allowed_write_paths", "root_path"]);

export function createLocalFilesystemProvider({ filesystem = fs } = {}) {
  assertFilesystemApi(filesystem);
  return Object.freeze({
    id: LOCAL_FILESYSTEM_PROVIDER_ID,
    adapter_version: "1.0.0",
    spi_version: DELIVERY_PROVIDER_SPI_VERSION,
    capabilities: Object.freeze({
      "release.local": Object.freeze(["precondition", "completion"]),
    }),
    observePrecondition(operation) {
      assertLocalReleaseAction(operation);
      const subject = normalizeLocalReleaseSubject(operation.subject);
      return inspectBoundary(filesystem, subject);
    },
    verifyCompletion(operation, { precondition_receipt: preconditionReceipt }) {
      assertLocalReleaseAction(operation);
      const subject = normalizeLocalReleaseSubject(operation.subject);
      const before = preconditionReceipt?.proof;
      if (
        before?.root_path !== subject.root_path
        || !isPlainRecord(before?.root_identity)
        || !Array.isArray(before?.allowed_write_paths)
      ) {
        throw new DeliveryProviderError(
          "release.local completion lacks its exact filesystem precondition",
          "provider_precondition_mismatch",
        );
      }
      const after = inspectBoundary(filesystem, subject);
      if (
        before.root_identity.real_path !== after.root_identity.real_path
        || before.root_identity.device !== after.root_identity.device
        || before.root_identity.inode !== after.root_identity.inode
      ) {
        throw new DeliveryProviderError(
          "release.local root identity changed after authorization",
          "provider_completion_unproven",
        );
      }
      return {
        ...after,
        precondition_receipt_hash: preconditionReceipt.receipt_hash,
      };
    },
  });
}

function assertLocalReleaseAction(operation) {
  if (operation?.action !== "release.local") {
    throw new DeliveryProviderError(
      `Local filesystem cannot prove '${operation?.action || "missing"}'`,
      "provider_operation_unsupported",
      { provider_id: LOCAL_FILESYSTEM_PROVIDER_ID, action: operation?.action || null },
    );
  }
}

function normalizeLocalReleaseSubject(subject) {
  if (!isPlainRecord(subject)) {
    throw new DeliveryProviderError("release.local subject must be an object", "provider_operation_invalid");
  }
  const unknown = Object.keys(subject).filter((key) => !SUBJECT_KEYS.has(key));
  if (unknown.length > 0) {
    throw new DeliveryProviderError(
      `release.local subject contains unsupported fields: ${unknown.sort().join(", ")}`,
      "provider_operation_invalid",
    );
  }
  const rootPath = requireAbsolutePath(subject.root_path, "release.local.subject.root_path");
  if (path.parse(rootPath).root === rootPath) {
    throw new DeliveryProviderError("release.local root_path cannot be a filesystem root", "provider_operation_invalid");
  }
  if (!Array.isArray(subject.allowed_write_paths) || subject.allowed_write_paths.length === 0) {
    throw new DeliveryProviderError("release.local requires at least one exact allowed_write_path", "provider_operation_invalid");
  }
  const allowedWritePaths = subject.allowed_write_paths.map((item, index) => {
    const writePath = requireAbsolutePath(item, `release.local.subject.allowed_write_paths[${index}]`);
    if (!strictlyInside(rootPath, writePath)) {
      throw new DeliveryProviderError(
        `release.local allowed_write_path must be a strict child of ${rootPath}: ${writePath}`,
        "provider_operation_invalid",
      );
    }
    return writePath;
  });
  const canonical = [...new Set(allowedWritePaths)].sort();
  if (canonical.length !== allowedWritePaths.length || JSON.stringify(canonical) !== JSON.stringify(allowedWritePaths)) {
    throw new DeliveryProviderError(
      "release.local allowed_write_paths must be sorted and unique",
      "provider_operation_invalid",
    );
  }
  return { root_path: rootPath, allowed_write_paths: canonical };
}

function inspectBoundary(filesystem, subject) {
  const rootStats = lstatRequired(filesystem, subject.root_path, "release.local root_path");
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new DeliveryProviderError(
      "release.local root_path must be a real directory, not a symlink",
      "provider_boundary_invalid",
    );
  }
  const rootRealPath = realpath(filesystem, subject.root_path);
  const allowed = subject.allowed_write_paths.map((writePath) =>
    inspectAllowedPath(filesystem, subject.root_path, rootRealPath, writePath));
  return {
    root_path: subject.root_path,
    root_identity: identity(rootStats, rootRealPath, "directory"),
    allowed_write_paths: allowed,
  };
}

function inspectAllowedPath(filesystem, rootPath, rootRealPath, writePath) {
  const relative = path.relative(rootPath, writePath);
  const components = relative.split(path.sep).filter(Boolean);
  let current = rootPath;
  let missing = false;
  let finalStats = null;
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    if (missing) continue;
    const stats = lstatOptional(filesystem, current);
    if (!stats) {
      missing = true;
      continue;
    }
    if (stats.isSymbolicLink()) {
      throw new DeliveryProviderError(
        `release.local path contains a symlink component: ${current}`,
        "provider_boundary_invalid",
      );
    }
    if (index < components.length - 1 && !stats.isDirectory()) {
      throw new DeliveryProviderError(
        `release.local path has a non-directory parent component: ${current}`,
        "provider_boundary_invalid",
      );
    }
    if (index === components.length - 1) finalStats = stats;
  }
  if (missing) {
    const existingParent = nearestExistingParent(filesystem, writePath, rootPath);
    const parentRealPath = realpath(filesystem, existingParent);
    if (!insideOrEqual(rootRealPath, parentRealPath)) {
      throw new DeliveryProviderError(
        `release.local missing path would escape its real root: ${writePath}`,
        "provider_boundary_invalid",
      );
    }
    return {
      path: writePath,
      status: "absent",
      nearest_existing_parent: parentRealPath,
    };
  }
  const writeRealPath = realpath(filesystem, writePath);
  if (!strictlyInside(rootRealPath, writeRealPath)) {
    throw new DeliveryProviderError(
      `release.local path resolves outside its real root: ${writePath}`,
      "provider_boundary_invalid",
    );
  }
  return {
    path: writePath,
    status: "present",
    identity: identity(finalStats, writeRealPath, fileType(finalStats)),
  };
}

function nearestExistingParent(filesystem, targetPath, rootPath) {
  let current = path.dirname(targetPath);
  while (strictlyInside(rootPath, current) || current === rootPath) {
    const stats = lstatOptional(filesystem, current);
    if (stats) {
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new DeliveryProviderError(
          `release.local nearest existing parent is not a real directory: ${current}`,
          "provider_boundary_invalid",
        );
      }
      return current;
    }
    if (current === rootPath) break;
    current = path.dirname(current);
  }
  throw new DeliveryProviderError("release.local could not resolve a safe existing parent", "provider_boundary_invalid");
}

function identity(stats, realPath, type) {
  return {
    real_path: realPath,
    device: String(stats.dev),
    inode: String(stats.ino),
    type,
  };
}

function fileType(stats) {
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "other";
}

function lstatRequired(filesystem, targetPath, label) {
  const stats = lstatOptional(filesystem, targetPath);
  if (!stats) {
    throw new DeliveryProviderError(`${label} does not exist: ${targetPath}`, "provider_boundary_invalid");
  }
  return stats;
}

function lstatOptional(filesystem, targetPath) {
  try {
    return filesystem.lstatSync(targetPath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw new DeliveryProviderError(
      `release.local could not inspect ${targetPath}: ${error?.message || error}`,
      "provider_observation_failed",
    );
  }
}

function realpath(filesystem, targetPath) {
  try {
    return typeof filesystem.realpathSync.native === "function"
      ? filesystem.realpathSync.native(targetPath)
      : filesystem.realpathSync(targetPath);
  } catch (error) {
    throw new DeliveryProviderError(
      `release.local could not resolve ${targetPath}: ${error?.message || error}`,
      "provider_observation_failed",
    );
  }
}

function requireAbsolutePath(value, label) {
  const targetPath = requireNonEmptyString(value, label);
  if (!path.isAbsolute(targetPath) || targetPath.includes("\0") || path.normalize(targetPath) !== targetPath) {
    throw new DeliveryProviderError(`${label} must be a normalized absolute path`, "provider_operation_invalid");
  }
  return targetPath;
}

function strictlyInside(rootPath, candidatePath) {
  const relative = path.relative(rootPath, candidatePath);
  return relative !== ""
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function insideOrEqual(rootPath, candidatePath) {
  return rootPath === candidatePath || strictlyInside(rootPath, candidatePath);
}

function assertFilesystemApi(filesystem) {
  if (
    !filesystem
    || typeof filesystem.lstatSync !== "function"
    || typeof filesystem.realpathSync !== "function"
  ) {
    throw new DeliveryProviderError(
      "local-filesystem requires lstatSync and realpathSync APIs",
      "provider_invalid",
    );
  }
}
