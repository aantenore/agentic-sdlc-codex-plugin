#!/usr/bin/env python3
"""Two-phase, reversible local installer for the Agentic SDLC plugin.

The existing installer remains the stable v1 entry point. This companion
protocol keeps the byte-exact previous installation until an independently
validated update is explicitly confirmed or restored.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import secrets
import shlex
import stat
import subprocess
import sys
import tempfile
from pathlib import Path


PLUGIN_NAME = "agentic-sdlc-codex-plugin"
PROTOCOL_SCHEMA = "agentic-sdlc.local-installer.v2"
RECEIPT_SCHEMA = "agentic-sdlc.local-installer-receipt.v2"
PLAN_HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")
TRANSACTION_ID_PATTERN = re.compile(r"^[0-9a-f]{24}$")
ACTIVE_PHASES = frozenset(
    {
        "prepared",
        "backup_ready",
        "plugin_backed_up",
        "plugin_replaced",
        "marketplace_replaced",
        "validation_pending",
        "confirm_started",
        "restore_started",
        "rollback_needs_attention",
    }
)
TERMINAL_PHASES = frozenset({"confirmed", "restored"})
ALL_PHASES = ACTIVE_PHASES | TERMINAL_PHASES

MAX_RECEIPT_BYTES = 64 * 1024
MAX_MARKETPLACE_BYTES = 4 * 1024 * 1024
MAX_MANAGED_FILES = 4096
MAX_MANAGED_ENTRIES = 8192
MAX_MANAGED_BYTES = 64 * 1024 * 1024
MAX_MANAGED_FILE_BYTES = 16 * 1024 * 1024
MAX_MANAGED_PATH_BYTES = 1024
MAX_HOME_PATH_BYTES = 4096
MAX_JSON_DEPTH = 64


def _load_v1_installer():
    installer_path = Path(__file__).with_name("install-personal-marketplace.py")
    specification = importlib.util.spec_from_file_location(
        "agentic_sdlc_local_installer_v1", installer_path
    )
    if specification is None or specification.loader is None:
        raise RuntimeError(f"Could not load the v1 installer from {installer_path}")
    module = importlib.util.module_from_spec(specification)
    previous_bytecode_setting = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        specification.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_bytecode_setting
    return module


V1 = _load_v1_installer()
InstallError = V1.InstallError


class InstallerArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise InstallError(message)


def _parse_arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = InstallerArgumentParser(
        description=(
            "Prepare, apply, validate, confirm, or restore one exact reversible "
            "local Agentic SDLC update."
        )
    )
    parser.add_argument(
        "command",
        nargs="?",
        choices=("check", "plan", "apply", "validate", "confirm", "restore"),
        default="plan",
    )
    parser.add_argument("--plan-hash", metavar="SHA256")
    parser.add_argument("--transaction-id", metavar="ID")
    parser.add_argument("--receipt-hash", metavar="SHA256")
    parser.add_argument("--home", metavar="PATH")
    parser.add_argument("--locale", choices=("en", "it"), default="en")
    parser.add_argument("--json", action="store_true")
    arguments = parser.parse_args(argv)

    if arguments.plan_hash is not None:
        arguments.plan_hash = arguments.plan_hash.strip().lower()
        if (
            len(arguments.plan_hash) != 64
            or PLAN_HASH_PATTERN.fullmatch(arguments.plan_hash) is None
        ):
            raise InstallError("--plan-hash must contain exactly 64 hexadecimal characters")
    if arguments.receipt_hash is not None:
        arguments.receipt_hash = arguments.receipt_hash.strip().lower()
        if (
            len(arguments.receipt_hash) != 64
            or PLAN_HASH_PATTERN.fullmatch(arguments.receipt_hash) is None
        ):
            raise InstallError("--receipt-hash must contain exactly 64 hexadecimal characters")
    if arguments.transaction_id is not None:
        arguments.transaction_id = arguments.transaction_id.strip().lower()
        if (
            len(arguments.transaction_id) != 24
            or TRANSACTION_ID_PATTERN.fullmatch(arguments.transaction_id) is None
        ):
            raise InstallError("--transaction-id must contain exactly 24 hexadecimal characters")

    if arguments.command == "apply":
        if arguments.plan_hash is None:
            raise InstallError("apply requires --plan-hash from the v2 preview")
        if arguments.transaction_id is not None or arguments.receipt_hash is not None:
            raise InstallError("apply accepts --plan-hash, not transaction receipt options")
    elif arguments.command in {"validate", "confirm", "restore"}:
        if arguments.transaction_id is None or arguments.receipt_hash is None:
            raise InstallError(
                f"{arguments.command} requires --transaction-id and --receipt-hash"
            )
        if arguments.plan_hash is not None:
            raise InstallError(
                f"--plan-hash cannot be used with {arguments.command}"
            )
    elif any(
        value is not None
        for value in (
            arguments.plan_hash,
            arguments.transaction_id,
            arguments.receipt_hash,
        )
    ):
        raise InstallError(
            "plan and check do not accept plan or transaction receipt options"
        )
    return arguments


def _transaction_root(home: Path) -> Path:
    return home / ".agents" / "plugins" / f".{PLUGIN_NAME}.install-v2"


def _receipt_path(home: Path) -> Path:
    return _transaction_root(home) / "receipt.json"


def _marketplace_backup_path(home: Path) -> Path:
    return _transaction_root(home) / "marketplace.before"


def _plugin_backup_path(home: Path, transaction_id: str) -> Path:
    return (
        home
        / "plugins"
        / f".{PLUGIN_NAME}.validation-{transaction_id}"
    )


def _plugin_restore_path(home: Path, transaction_id: str) -> Path:
    return (
        home
        / "plugins"
        / f".{PLUGIN_NAME}.restore-v2-{transaction_id}"
    )


def _plugin_confirm_cleanup_path(home: Path, transaction_id: str) -> Path:
    return (
        home
        / "plugins"
        / f".{PLUGIN_NAME}.confirm-v2-{transaction_id}"
    )


def _lock_path(home: Path) -> Path:
    return home / ".agents" / "plugins" / f".{PLUGIN_NAME}.install.lock"


def _marketplace_path(home: Path) -> Path:
    return home / ".agents" / "plugins" / "marketplace.json"


def _destination_path(home: Path) -> Path:
    return home / "plugins" / PLUGIN_NAME


def _assert_path_bound(path: Path, label: str) -> None:
    encoded = os.fsencode(str(path))
    if len(encoded) > MAX_HOME_PATH_BYTES:
        raise InstallError(f"{label} path is unexpectedly long")


def _read_bounded_bytes(path: Path, maximum: int, label: str) -> bytes:
    if V1._is_link_like(path):
        raise InstallError(f"Refusing linked {label}: {path}")
    try:
        file_stat = path.stat()
    except OSError as exc:
        raise InstallError(f"Could not inspect {label} {path}: {exc}") from exc
    if not stat.S_ISREG(file_stat.st_mode):
        raise InstallError(f"Refusing non-file {label}: {path}")
    if file_stat.st_size > maximum:
        raise InstallError(f"{label} exceeds the supported {maximum}-byte limit")
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise InstallError(f"Could not read {label} {path}: {exc}") from exc
    if len(payload) > maximum:
        raise InstallError(f"{label} changed beyond the supported size limit")
    return payload


def _assert_bounded_json_nesting(payload: bytes, label: str) -> None:
    depth = 0
    quoted = False
    escaped = False
    for byte in payload:
        if quoted:
            if escaped:
                escaped = False
            elif byte == 0x5C:
                escaped = True
            elif byte == 0x22:
                quoted = False
            continue
        if byte == 0x22:
            quoted = True
        elif byte in {0x5B, 0x7B}:
            depth += 1
            if depth > MAX_JSON_DEPTH:
                raise InstallError(f"{label} exceeds the supported JSON nesting depth")
        elif byte in {0x5D, 0x7D}:
            depth -= 1
            if depth < 0:
                return


def _bounded_marketplace_bytes(path: Path) -> bytes | None:
    if not V1._lexists(path):
        return None
    payload = _read_bounded_bytes(path, MAX_MARKETPLACE_BYTES, "marketplace file")
    _assert_bounded_json_nesting(payload, "The marketplace file")
    return payload


def _preflight_tree_bounds(root: Path, label: str) -> None:
    if not V1._lexists(root):
        return
    if V1._is_link_like(root) or not root.is_dir():
        raise InstallError(f"Refusing linked or non-directory {label}: {root}")
    entry_count = 0
    file_count = 0
    total_bytes = 0
    for current_root, directory_names, file_names in os.walk(root, followlinks=False):
        current = Path(current_root)
        retained = []
        for directory_name in directory_names:
            child = current / directory_name
            if V1._is_link_like(child) or not child.is_dir():
                raise InstallError(f"Refusing linked or non-directory {label} entry: {child}")
            relative = child.relative_to(root).as_posix()
            if len(relative.encode("utf-8")) > MAX_MANAGED_PATH_BYTES:
                raise InstallError(f"{label} contains an overlong path: {relative}")
            entry_count += 1
            if entry_count > MAX_MANAGED_ENTRIES:
                raise InstallError(f"{label} exceeds the supported resource limits")
            retained.append(directory_name)
        directory_names[:] = retained
        for file_name in file_names:
            child = current / file_name
            if V1._is_link_like(child) or not child.is_file():
                raise InstallError(f"Refusing linked or non-file {label} entry: {child}")
            relative = child.relative_to(root).as_posix()
            if len(relative.encode("utf-8")) > MAX_MANAGED_PATH_BYTES:
                raise InstallError(f"{label} contains an overlong path: {relative}")
            size = child.stat().st_size
            if size > MAX_MANAGED_FILE_BYTES:
                raise InstallError(f"{label} contains an oversized file: {relative}")
            entry_count += 1
            file_count += 1
            total_bytes += size
            if (
                entry_count > MAX_MANAGED_ENTRIES
                or file_count > MAX_MANAGED_FILES
                or total_bytes > MAX_MANAGED_BYTES
            ):
                raise InstallError(f"{label} exceeds the supported resource limits")


def _preflight_source_bounds(repo_root: Path, destination: Path) -> None:
    allowlist = V1._read_package_allowlist(repo_root)
    candidates: dict[str, Path] = {}

    def add_candidate(candidate: Path) -> None:
        candidates.setdefault(str(candidate), candidate)
        if len(candidates) > MAX_MANAGED_ENTRIES:
            raise InstallError("The package allowlist expands beyond the resource limit")

    for root_file in V1.STANDARD_ROOT_FILES:
        candidate = repo_root / root_file
        if V1._lexists(candidate):
            add_candidate(candidate)
    for pattern in allowlist:
        try:
            for candidate in repo_root.glob(pattern):
                add_candidate(candidate)
        except (OSError, ValueError) as exc:
            raise InstallError(f"Invalid package files pattern {pattern!r}: {exc}") from exc

    files: dict[str, int] = {}
    directories: set[str] = set()
    total_bytes = 0

    def assert_entry_capacity() -> None:
        if len(files) + len(directories) > MAX_MANAGED_ENTRIES:
            raise InstallError("The local package exceeds the supported resource limits")

    def record_directory(directory: Path) -> None:
        relative_name = directory.relative_to(repo_root).as_posix()
        if len(relative_name.encode("utf-8")) > MAX_MANAGED_PATH_BYTES:
            raise InstallError(f"Managed source path is too long: {relative_name}")
        directories.add(relative_name)
        assert_entry_capacity()

    def record_file(source: Path) -> None:
        nonlocal total_bytes
        relative_name = source.relative_to(repo_root).as_posix()
        if V1._is_link_like(source) or not source.is_file():
            raise InstallError(f"Refusing non-regular allowlisted source file: {source}")
        if len(relative_name.encode("utf-8")) > MAX_MANAGED_PATH_BYTES:
            raise InstallError(f"Managed source path is too long: {relative_name}")
        size = source.stat().st_size
        if size > MAX_MANAGED_FILE_BYTES:
            raise InstallError(f"Managed source file is too large: {relative_name}")
        if relative_name not in files:
            files[relative_name] = size
            total_bytes += size
        if (
            len(files) > MAX_MANAGED_FILES
            or total_bytes > MAX_MANAGED_BYTES
        ):
            raise InstallError("The local package exceeds the supported resource limits")
        assert_entry_capacity()

    for candidate in candidates.values():
        relative = candidate.relative_to(repo_root)
        if V1._is_excluded(relative) or V1._is_forbidden_source_path(
            candidate, (destination,)
        ):
            continue
        if V1._is_link_like(candidate):
            raise InstallError(f"Refusing allowlisted source link: {candidate}")
        if candidate.is_file():
            record_file(candidate)
        elif candidate.is_dir():
            record_directory(candidate)
            for current_root, directory_names, file_names in os.walk(
                candidate, followlinks=False
            ):
                current = Path(current_root)
                retained = []
                for directory_name in directory_names:
                    child = current / directory_name
                    child_relative = child.relative_to(repo_root)
                    if V1._is_excluded(child_relative) or V1._is_forbidden_source_path(
                        child, (destination,)
                    ):
                        continue
                    if V1._is_link_like(child):
                        raise InstallError(f"Refusing allowlisted source link: {child}")
                    if not child.is_dir():
                        raise InstallError(
                            f"Refusing non-directory allowlisted source path: {child}"
                        )
                    record_directory(child)
                    retained.append(directory_name)
                directory_names[:] = retained
                for file_name in file_names:
                    child = current / file_name
                    child_relative = child.relative_to(repo_root)
                    if V1._is_excluded(child_relative) or V1._is_forbidden_source_path(
                        child, (destination,)
                    ):
                        continue
                    record_file(child)
        else:
            raise InstallError(f"Refusing non-regular allowlisted source path: {candidate}")


def _preflight_managed_inputs(repo_root: Path, home: Path) -> None:
    _preflight_source_bounds(repo_root, _destination_path(home))
    _preflight_tree_bounds(_destination_path(home), "The existing local copy")


def _assert_no_orphaned_v2_worktrees(home: Path) -> None:
    parent = _destination_path(home).parent
    if not parent.is_dir() or V1._is_link_like(parent):
        return
    prefixes = (
        f".{PLUGIN_NAME}.validation-",
        f".{PLUGIN_NAME}.restore-v2-",
        f".{PLUGIN_NAME}.confirm-v2-",
    )
    candidates: list[Path] = []
    for entry in parent.iterdir():
        if any(entry.name.startswith(prefix) for prefix in prefixes):
            candidates.append(entry)
            if len(candidates) > 8:
                raise InstallError("Too many unmatched v2 recovery paths exist")
    if candidates:
        paths = ", ".join(str(path) for path in sorted(candidates, key=lambda item: item.name))
        raise InstallError(
            "Unmatched v2 recovery files exist; preserve and inspect them before "
            f"starting another update: {paths}"
        )


def _assert_no_v1_recovery_state(home: Path) -> None:
    transactions, backups = V1._installer_recovery_candidates(home)
    if transactions or backups:
        paths = ", ".join(
            str(path) for path in [*transactions, *backups]
        )
        raise InstallError(
            "An earlier v1 update must be recovered before starting v2: " + paths
        )


def _validate_plan_bounds(plan: dict[str, object], home: Path) -> None:
    _assert_path_bound(home, "HOME")
    source_entries = plan["_source_entries"]
    destination_entries = plan["_destination_snapshot"]["entries"]
    if len(source_entries) > MAX_MANAGED_FILES:
        raise InstallError("The local package contains too many managed files")
    if len(destination_entries) > MAX_MANAGED_ENTRIES:
        raise InstallError("The existing local copy contains too many managed entries")

    source_total = 0
    for entry in source_entries:
        path_value = str(entry["path"])
        if len(path_value.encode("utf-8")) > MAX_MANAGED_PATH_BYTES:
            raise InstallError(f"Managed source path is too long: {path_value}")
        size = int(entry["size"])
        if size > MAX_MANAGED_FILE_BYTES:
            raise InstallError(f"Managed source file is too large: {path_value}")
        source_total += size
    if source_total > MAX_MANAGED_BYTES:
        raise InstallError("The local package exceeds the supported managed byte limit")

    destination_total = 0
    for entry in destination_entries:
        path_value = str(entry["path"])
        if len(path_value.encode("utf-8")) > MAX_MANAGED_PATH_BYTES:
            raise InstallError(f"Managed destination path is too long: {path_value}")
        if entry["type"] == "file":
            size = int(entry["size"])
            if size > MAX_MANAGED_FILE_BYTES:
                raise InstallError(f"Managed destination file is too large: {path_value}")
            destination_total += size
    if destination_total > MAX_MANAGED_BYTES:
        raise InstallError("The existing local copy exceeds the managed byte limit")

    marketplace_before = plan["_marketplace_before"]
    marketplace_after = plan["_marketplace_after"]
    if len(marketplace_before or b"") > MAX_MARKETPLACE_BYTES:
        raise InstallError("The existing marketplace file is too large")
    if len(marketplace_after) > MAX_MARKETPLACE_BYTES:
        raise InstallError("The updated marketplace file is too large")


def _canonical_receipt_hash(receipt: dict[str, object]) -> str:
    return V1._canonical_digest(
        {key: value for key, value in receipt.items() if key != "receipt_hash"}
    )


def _new_receipt(
    plan: dict[str, object], home: Path, staged_snapshot: dict[str, object]
) -> dict[str, object]:
    transaction_id = secrets.token_hex(12)
    destination = Path(str(plan["destination"]["path"]))
    marketplace = Path(str(plan["marketplace"]["path"]))
    before_marketplace = plan["_marketplace_before"]
    after_marketplace = plan["_marketplace_after"]
    receipt = {
        "schema": RECEIPT_SCHEMA,
        "protocol": "v2",
        "transaction_id": transaction_id,
        "phase": "prepared",
        "plan_hash": plan["plan_hash"],
        "operation": plan["operation"],
        "home": str(home),
        "destination": {
            "path": str(destination),
            "before_exists": bool(plan["destination"]["exists"]),
            "before_tree_sha256": str(plan["destination"]["tree_sha256"]),
            "after_exists": True,
            "after_tree_sha256": str(staged_snapshot["digest"]),
        },
        "marketplace": {
            "path": str(marketplace),
            "before_exists": before_marketplace is not None,
            "before_sha256": (
                V1._sha256_bytes(before_marketplace)
                if before_marketplace is not None
                else None
            ),
            "before_bytes": len(before_marketplace or b""),
            "after_exists": True,
            "after_sha256": V1._sha256_bytes(after_marketplace),
            "after_bytes": len(after_marketplace),
        },
        "plugin_backup": (
            str(_plugin_backup_path(home, transaction_id))
            if bool(plan["destination"]["exists"])
            else None
        ),
        "prior_transaction": plan["prior_transaction"],
        "previous_receipt_hash": None,
        "transition_input_receipt_hash": None,
    }
    receipt["receipt_hash"] = _canonical_receipt_hash(receipt)
    return receipt


def _transition_receipt(
    receipt: dict[str, object],
    phase: str,
    *,
    transition_input: str | None = None,
) -> dict[str, object]:
    updated = json.loads(json.dumps(receipt))
    updated["previous_receipt_hash"] = receipt["receipt_hash"]
    updated["phase"] = phase
    if transition_input is not None:
        updated["transition_input_receipt_hash"] = transition_input
    updated.pop("receipt_hash", None)
    updated["receipt_hash"] = _canonical_receipt_hash(updated)
    return updated


def _validate_receipt(receipt: object, home: Path) -> dict[str, object]:
    if not isinstance(receipt, dict):
        raise InstallError("The local update record must contain a JSON object")
    expected_keys = {
        "schema",
        "protocol",
        "transaction_id",
        "phase",
        "plan_hash",
        "operation",
        "home",
        "destination",
        "marketplace",
        "plugin_backup",
        "prior_transaction",
        "previous_receipt_hash",
        "transition_input_receipt_hash",
        "receipt_hash",
    }
    if set(receipt) != expected_keys:
        raise InstallError("The local update record has unsupported fields")
    if receipt.get("schema") != RECEIPT_SCHEMA or receipt.get("protocol") != "v2":
        raise InstallError("The local update record uses an unsupported protocol")

    transaction_id = receipt.get("transaction_id")
    if (
        not isinstance(transaction_id, str)
        or len(transaction_id) != 24
        or TRANSACTION_ID_PATTERN.fullmatch(transaction_id) is None
    ):
        raise InstallError("The local update record has an invalid transaction identifier")
    if receipt.get("phase") not in ALL_PHASES:
        raise InstallError("The local update record has an unsupported state")
    if receipt.get("operation") not in {"install", "update", "noop"}:
        raise InstallError("The local update record has an invalid operation")
    if (
        not isinstance(receipt.get("plan_hash"), str)
        or PLAN_HASH_PATTERN.fullmatch(str(receipt["plan_hash"])) is None
    ):
        raise InstallError("The local update record has an invalid preview identifier")
    if receipt.get("home") != str(home):
        raise InstallError("The local update record belongs to a different HOME")

    destination = receipt.get("destination")
    marketplace = receipt.get("marketplace")
    if not isinstance(destination, dict) or set(destination) != {
        "path",
        "before_exists",
        "before_tree_sha256",
        "after_exists",
        "after_tree_sha256",
    }:
        raise InstallError("The local update record has an invalid destination identity")
    if not isinstance(marketplace, dict) or set(marketplace) != {
        "path",
        "before_exists",
        "before_sha256",
        "before_bytes",
        "after_exists",
        "after_sha256",
        "after_bytes",
    }:
        raise InstallError("The local update record has an invalid marketplace identity")
    if destination.get("path") != str(_destination_path(home)):
        raise InstallError("The local update record names a different plugin destination")
    if marketplace.get("path") != str(_marketplace_path(home)):
        raise InstallError("The local update record names a different marketplace file")

    for field in ("before_tree_sha256", "after_tree_sha256"):
        if (
            not isinstance(destination.get(field), str)
            or PLAN_HASH_PATTERN.fullmatch(str(destination[field])) is None
        ):
            raise InstallError("The local update record has an invalid tree digest")
    for field in ("before_exists", "after_exists"):
        if not isinstance(destination.get(field), bool):
            raise InstallError("The local update record has an invalid tree existence flag")
    if destination.get("after_exists") is not True:
        raise InstallError("The local update record must identify an installed after-state")

    for field in ("before_exists", "after_exists"):
        if not isinstance(marketplace.get(field), bool):
            raise InstallError("The local update record has an invalid marketplace flag")
    if marketplace.get("after_exists") is not True:
        raise InstallError("The local update record must identify a marketplace after-state")
    for field in ("before_bytes", "after_bytes"):
        value = marketplace.get(field)
        if (
            not isinstance(value, int)
            or isinstance(value, bool)
            or value < 0
            or value > MAX_MARKETPLACE_BYTES
        ):
            raise InstallError("The local update record has an invalid marketplace size")
    before_exists = bool(marketplace["before_exists"])
    before_digest = marketplace.get("before_sha256")
    if before_exists:
        if (
            not isinstance(before_digest, str)
            or PLAN_HASH_PATTERN.fullmatch(before_digest) is None
        ):
            raise InstallError("The local update record lacks the prior marketplace digest")
    elif before_digest is not None or marketplace["before_bytes"] != 0:
        raise InstallError("The local update record has an impossible prior marketplace state")
    after_digest = marketplace.get("after_sha256")
    if (
        not isinstance(after_digest, str)
        or PLAN_HASH_PATTERN.fullmatch(after_digest) is None
    ):
        raise InstallError("The local update record lacks the new marketplace digest")

    expected_backup = (
        _plugin_backup_path(home, transaction_id)
        if bool(destination["before_exists"])
        else None
    )
    backup_value = receipt.get("plugin_backup")
    if expected_backup is None:
        if backup_value is not None:
            raise InstallError("The local update record has an unexpected plugin backup")
    elif backup_value != str(expected_backup):
        raise InstallError("The local update record has an unsafe plugin backup path")

    prior_transaction = receipt.get("prior_transaction")
    if prior_transaction is not None:
        if not isinstance(prior_transaction, dict) or set(prior_transaction) != {
            "transaction_id",
            "phase",
            "receipt_hash",
        }:
            raise InstallError("The local update record has an invalid prior transaction")
        if (
            not isinstance(prior_transaction.get("transaction_id"), str)
            or TRANSACTION_ID_PATTERN.fullmatch(prior_transaction["transaction_id"])
            is None
            or prior_transaction.get("phase") not in TERMINAL_PHASES
            or not isinstance(prior_transaction.get("receipt_hash"), str)
            or PLAN_HASH_PATTERN.fullmatch(prior_transaction["receipt_hash"]) is None
        ):
            raise InstallError("The local update record has an invalid prior transaction")

    for field in (
        "previous_receipt_hash",
        "transition_input_receipt_hash",
    ):
        value = receipt.get(field)
        if value is not None and (
            not isinstance(value, str) or PLAN_HASH_PATTERN.fullmatch(value) is None
        ):
            raise InstallError("The local update record has an invalid receipt chain")
    receipt_hash = receipt.get("receipt_hash")
    if (
        not isinstance(receipt_hash, str)
        or PLAN_HASH_PATTERN.fullmatch(receipt_hash) is None
        or receipt_hash != _canonical_receipt_hash(receipt)
    ):
        raise InstallError("The local update record failed its integrity check")
    return receipt


def _validate_transaction_directory(root: Path) -> None:
    if V1._is_link_like(root) or not root.is_dir():
        raise InstallError(f"Refusing linked or non-directory update record: {root}")
    allowed = {"receipt.json", "marketplace.before"}
    entry_count = 0
    for entry in root.iterdir():
        entry_count += 1
        if entry_count > 8:
            raise InstallError("The local update record contains too many entries")
        temporary = (
            (
                entry.name.startswith(".receipt.json.")
                or entry.name.startswith(".marketplace.before.")
            )
            and entry.name.endswith(".tmp")
        )
        if (
            (entry.name not in allowed and not temporary)
            or V1._is_link_like(entry)
            or not entry.is_file()
        ):
            raise InstallError(f"Unexpected content beside the local update record: {entry}")


def _read_receipt(home: Path) -> dict[str, object] | None:
    root = _transaction_root(home)
    if not V1._lexists(root):
        return None
    _validate_transaction_directory(root)
    receipt_path = _receipt_path(home)
    if not receipt_path.is_file() or V1._is_link_like(receipt_path):
        raise InstallError(f"The local update record is missing: {receipt_path}")
    payload = _read_bounded_bytes(receipt_path, MAX_RECEIPT_BYTES, "update receipt")
    try:
        decoded = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise InstallError(f"The local update record is invalid JSON: {exc}") from exc
    return _validate_receipt(decoded, home)


def _write_receipt(home: Path, receipt: dict[str, object]) -> None:
    validated = _validate_receipt(receipt, home)
    root = _transaction_root(home)
    if V1._is_link_like(root) or not root.is_dir():
        raise InstallError(f"Refusing unsafe update record directory: {root}")
    encoded = V1._json_bytes(validated)
    if len(encoded) > MAX_RECEIPT_BYTES:
        raise InstallError("The local update record exceeds its size limit")
    V1._write_bytes_atomically(_receipt_path(home), encoded)
    persisted = _read_receipt(home)
    if persisted is None or persisted["receipt_hash"] != receipt["receipt_hash"]:
        raise InstallError("The local update record could not be verified after writing")
    if os.environ.get("_AGENTIC_SDLC_INSTALLER_V2_TEST_CRASH_PHASE") == receipt.get(
        "phase"
    ):
        os._exit(87)


def _tree_state(path: Path) -> tuple[bool, str]:
    _preflight_tree_bounds(path, "Managed tree")
    snapshot = V1._snapshot_tree(path)
    entries = snapshot["entries"]
    if len(entries) > MAX_MANAGED_ENTRIES:
        raise InstallError("A managed tree exceeds the supported entry limit")
    total = 0
    for entry in entries:
        if len(str(entry["path"]).encode("utf-8")) > MAX_MANAGED_PATH_BYTES:
            raise InstallError("A managed tree contains an overlong path")
        if entry["type"] == "file":
            size = int(entry["size"])
            if size > MAX_MANAGED_FILE_BYTES:
                raise InstallError("A managed tree contains an oversized file")
            total += size
    if total > MAX_MANAGED_BYTES:
        raise InstallError("A managed tree exceeds the supported byte limit")
    return bool(snapshot["exists"]), str(snapshot["digest"])


def _marketplace_state(path: Path) -> tuple[bool, str | None, bytes | None]:
    payload = _bounded_marketplace_bytes(path)
    return (
        payload is not None,
        V1._sha256_bytes(payload) if payload is not None else None,
        payload,
    )


def _expected_tree_state(
    receipt: dict[str, object], side: str
) -> tuple[bool, str]:
    destination = receipt["destination"]
    return (
        bool(destination[f"{side}_exists"]),
        str(destination[f"{side}_tree_sha256"]),
    )


def _expected_marketplace_state(
    receipt: dict[str, object], side: str
) -> tuple[bool, str | None]:
    marketplace = receipt["marketplace"]
    return (
        bool(marketplace[f"{side}_exists"]),
        marketplace[f"{side}_sha256"],
    )


def _plugin_backup_for_receipt(
    home: Path, receipt: dict[str, object]
) -> Path | None:
    if not bool(receipt["destination"]["before_exists"]):
        return None
    return _plugin_backup_path(home, str(receipt["transaction_id"]))


def _capture_directory_identity(path: Path) -> tuple[int, int]:
    if V1._is_link_like(path) or not path.is_dir():
        raise InstallError(f"Refusing linked or non-directory parent: {path}")
    try:
        path_stat = os.stat(path, follow_symlinks=False)
    except OSError as exc:
        raise InstallError(f"Could not inspect managed parent {path}: {exc}") from exc
    return int(path_stat.st_dev), int(path_stat.st_ino)


def _remove_verified_tree(
    path: Path, expected_state: tuple[bool, str], label: str
) -> None:
    if expected_state[0] is not True or _tree_state(path) != expected_state:
        raise InstallError(f"Refusing to remove changed {label}: {path}")
    identity = _capture_directory_identity(path)
    if _tree_state(path) != expected_state or _capture_directory_identity(path) != identity:
        raise InstallError(f"Refusing to remove raced {label}: {path}")
    V1._remove_path(path)
    if V1._lexists(path):
        raise InstallError(f"Could not remove verified {label}: {path}")


def _remove_bounded_cleanup_tree(path: Path, label: str) -> None:
    _preflight_tree_bounds(path, label)
    identity = _capture_directory_identity(path)
    if _capture_directory_identity(path) != identity:
        raise InstallError(f"Refusing raced {label}: {path}")
    V1._remove_path(path)
    if V1._lexists(path):
        raise InstallError(f"Could not finish bounded cleanup of {label}: {path}")


def _remove_transaction_root_safely(home: Path) -> None:
    root = _transaction_root(home)
    _validate_transaction_directory(root)
    root_identity = _capture_directory_identity(root)
    for entry in list(root.iterdir()):
        if _capture_directory_identity(root) != root_identity:
            raise InstallError(f"Refusing raced update record directory: {root}")
        if V1._is_link_like(entry) or not entry.is_file():
            raise InstallError(f"Refusing changed update record entry: {entry}")
        before = os.lstat(entry)
        current = os.lstat(entry)
        if (before.st_dev, before.st_ino, before.st_mode) != (
            current.st_dev,
            current.st_ino,
            current.st_mode,
        ):
            raise InstallError(f"Refusing raced update record entry: {entry}")
        entry.unlink()
    if _capture_directory_identity(root) != root_identity:
        raise InstallError(f"Refusing raced update record directory: {root}")
    try:
        root.rmdir()
    except OSError as exc:
        raise InstallError(
            f"The update record changed during bounded cleanup: {root}: {exc}"
        ) from exc


class _DirectoryGuard:
    def __init__(self, paths: tuple[Path, ...]):
        self.identities = {path: _capture_directory_identity(path) for path in paths}

    def verify(self) -> None:
        for path, expected in self.identities.items():
            if _capture_directory_identity(path) != expected:
                raise InstallError(f"Managed parent changed during the update: {path}")

    def track(self, path: Path) -> None:
        self.identities[path] = _capture_directory_identity(path)


def _assert_safe_layout(home: Path) -> _DirectoryGuard:
    destination = _destination_path(home)
    marketplace = _marketplace_path(home)
    transaction_root = _transaction_root(home)
    lock_path = _lock_path(home)
    for target, label in (
        (destination, "plugin destination"),
        (marketplace, "marketplace"),
        (transaction_root, "update record"),
        (lock_path, "installer lock"),
    ):
        V1._assert_no_nested_symlinks(home, target, label)
    guarded = [home, destination.parent, marketplace.parent]
    if V1._lexists(transaction_root):
        guarded.append(transaction_root)
    return _DirectoryGuard(tuple(guarded))


def _receipt_command_matches(receipt: dict[str, object], provided_hash: str) -> bool:
    return provided_hash in {
        receipt.get("receipt_hash"),
        receipt.get("transition_input_receipt_hash"),
    }


def _verify_marketplace_backup(home: Path, receipt: dict[str, object]) -> None:
    expected = _expected_marketplace_state(receipt, "before")
    backup_path = _marketplace_backup_path(home)
    if expected[0]:
        if not V1._lexists(backup_path):
            raise InstallError("The exact previous marketplace bytes are unavailable")
        payload = _read_bounded_bytes(
            backup_path, MAX_MARKETPLACE_BYTES, "previous marketplace backup"
        )
        if (
            len(payload) != int(receipt["marketplace"]["before_bytes"])
            or V1._sha256_bytes(payload) != expected[1]
        ):
            raise InstallError("The previous marketplace backup changed")
    elif V1._lexists(backup_path):
        raise InstallError("An unexpected previous marketplace backup exists")


def _verify_plugin_backup(home: Path, receipt: dict[str, object]) -> None:
    expected = _expected_tree_state(receipt, "before")
    backup_path = _plugin_backup_for_receipt(home, receipt)
    if expected[0]:
        assert backup_path is not None
        if _tree_state(backup_path) != expected:
            raise InstallError("The exact previous plugin files are unavailable or changed")
    elif receipt["plugin_backup"] is not None or V1._lexists(
        _plugin_backup_path(home, str(receipt["transaction_id"]))
    ):
        raise InstallError("An unexpected previous plugin backup exists")


def _verify_pending_state(home: Path, receipt: dict[str, object]) -> None:
    restore_path = _plugin_restore_path(home, str(receipt["transaction_id"]))
    if V1._lexists(restore_path):
        raise InstallError(f"An unexpected restore work tree exists: {restore_path}")
    confirm_cleanup = _plugin_confirm_cleanup_path(
        home, str(receipt["transaction_id"])
    )
    if V1._lexists(confirm_cleanup):
        raise InstallError(f"An unexpected confirmation work tree exists: {confirm_cleanup}")
    if _tree_state(_destination_path(home)) != _expected_tree_state(receipt, "after"):
        raise InstallError("The installed files changed after apply; confirmation is blocked")
    if _marketplace_state(_marketplace_path(home))[:2] != _expected_marketplace_state(
        receipt, "after"
    ):
        raise InstallError("The personal Codex plugin list changed after apply")
    _verify_plugin_backup(home, receipt)
    _verify_marketplace_backup(home, receipt)


def _verify_terminal_state(home: Path, receipt: dict[str, object]) -> None:
    restore_path = _plugin_restore_path(home, str(receipt["transaction_id"]))
    if V1._lexists(restore_path):
        raise InstallError(f"A completed transaction still has a restore work tree: {restore_path}")
    confirm_cleanup = _plugin_confirm_cleanup_path(
        home, str(receipt["transaction_id"])
    )
    if V1._lexists(confirm_cleanup):
        raise InstallError(
            f"A completed transaction still has a confirmation work tree: {confirm_cleanup}"
        )
    side = "after" if receipt["phase"] == "confirmed" else "before"
    if _tree_state(_destination_path(home)) != _expected_tree_state(receipt, side):
        raise InstallError("The local files drifted after the transaction completed")
    if _marketplace_state(_marketplace_path(home))[:2] != _expected_marketplace_state(
        receipt, side
    ):
        raise InstallError("The personal Codex plugin list drifted after completion")
    plugin_backup = _plugin_backup_for_receipt(home, receipt)
    if plugin_backup is not None and V1._lexists(plugin_backup):
        raise InstallError("A completed transaction still has an unexpected plugin backup")
    if receipt["phase"] == "confirmed":
        if V1._lexists(_marketplace_backup_path(home)):
            raise InstallError(
                "A confirmed transaction still has an unexpected marketplace backup"
            )
    else:
        _verify_marketplace_backup(home, receipt)


def _build_install_plan(
    repo_root: Path, home: Path, prior_receipt: dict[str, object] | None = None
) -> dict[str, object]:
    _assert_no_v1_recovery_state(home)
    _preflight_managed_inputs(repo_root, home)
    marketplace = _marketplace_path(home)
    before_marketplace = _bounded_marketplace_bytes(marketplace)
    base = V1._build_install_plan(repo_root, home, with_rtk=False, rtk_executable=None)
    if base["_marketplace_before"] != before_marketplace:
        raise InstallError("The marketplace file changed while the preview was prepared")
    _validate_plan_bounds(base, home)
    if prior_receipt is None:
        prior_receipt = _read_receipt(home)
    if prior_receipt is not None and prior_receipt["phase"] not in TERMINAL_PHASES:
        raise InstallError(
            "A local update is still awaiting validation, confirmation, or restoration"
        )
    _assert_no_orphaned_v2_worktrees(home)
    prior_reference = (
        {
            "transaction_id": prior_receipt["transaction_id"],
            "phase": prior_receipt["phase"],
            "receipt_hash": prior_receipt["receipt_hash"],
        }
        if prior_receipt is not None
        else None
    )
    plan_core = {
        key: value
        for key, value in V1._public_plan(base, include_plan_hash=False).items()
        if key != "schema"
    }
    plan_core.update(
        {
            "schema": PROTOCOL_SCHEMA,
            "protocol": "v2",
            "validation_required": True,
            "transaction_record": str(_receipt_path(home)),
            "prior_transaction": prior_reference,
        }
    )
    plan_hash = V1._canonical_digest(plan_core)
    return {
        **plan_core,
        "plan_hash": plan_hash,
        **{key: value for key, value in base.items() if key.startswith("_")},
    }


def _rebuild_install_plan_from_receipt(
    repo_root: Path, home: Path, receipt: dict[str, object]
) -> dict[str, object]:
    _assert_no_v1_recovery_state(home)
    _preflight_managed_inputs(repo_root, home)
    marketplace = _marketplace_path(home)
    before_marketplace = _bounded_marketplace_bytes(marketplace)
    base = V1._build_install_plan(repo_root, home, with_rtk=False, rtk_executable=None)
    if base["_marketplace_before"] != before_marketplace:
        raise InstallError("The marketplace changed while recovery rebuilt the preview")
    _validate_plan_bounds(base, home)
    _assert_no_orphaned_v2_worktrees(home)
    plan_core = {
        key: value
        for key, value in V1._public_plan(base, include_plan_hash=False).items()
        if key != "schema"
    }
    plan_core.update(
        {
            "schema": PROTOCOL_SCHEMA,
            "protocol": "v2",
            "validation_required": True,
            "transaction_record": str(_receipt_path(home)),
            "prior_transaction": receipt["prior_transaction"],
        }
    )
    plan_hash = V1._canonical_digest(plan_core)
    return {
        **plan_core,
        "plan_hash": plan_hash,
        **{key: value for key, value in base.items() if key.startswith("_")},
    }


def _public_plan(plan: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in plan.items() if not key.startswith("_")}


def _remove_terminal_record(home: Path, receipt: dict[str, object]) -> None:
    _verify_terminal_state(home, receipt)
    root = _transaction_root(home)
    _validate_transaction_directory(root)
    _remove_transaction_root_safely(home)
    if V1._lexists(root):
        raise InstallError("The prior completed update record could not be removed")


def _restore_marketplace_before(home: Path, receipt: dict[str, object]) -> None:
    before = _expected_marketplace_state(receipt, "before")
    current = _marketplace_state(_marketplace_path(home))
    after = _expected_marketplace_state(receipt, "after")
    if current[:2] == before:
        return
    if current[:2] != after:
        raise InstallError("The personal Codex plugin list changed outside this update")
    if before[0]:
        _verify_marketplace_backup(home, receipt)
        payload = _read_bounded_bytes(
            _marketplace_backup_path(home),
            MAX_MARKETPLACE_BYTES,
            "previous marketplace backup",
        )
        V1._restore_marketplace_bytes(_marketplace_path(home), payload)
    else:
        V1._restore_marketplace_bytes(_marketplace_path(home), None)
    if _marketplace_state(_marketplace_path(home))[:2] != before:
        raise InstallError("The previous marketplace bytes could not be restored exactly")


def _restore_plugin_before(home: Path, receipt: dict[str, object]) -> None:
    destination = _destination_path(home)
    before = _expected_tree_state(receipt, "before")
    after = _expected_tree_state(receipt, "after")
    current = _tree_state(destination)
    restore_path = _plugin_restore_path(home, str(receipt["transaction_id"]))
    restore_exists = V1._lexists(restore_path)
    if restore_exists and _tree_state(restore_path) != after:
        plugin_backup = _plugin_backup_for_receipt(home, receipt)
        backup_exists = plugin_backup is not None and V1._lexists(plugin_backup)
        if (
            current == before
            and not backup_exists
            and receipt["phase"] in {"restore_started", "rollback_needs_attention"}
        ):
            _remove_bounded_cleanup_tree(restore_path, "partial restore work tree")
            return
        raise InstallError("The bounded restore work tree changed unexpectedly")

    if current == before:
        plugin_backup = _plugin_backup_for_receipt(home, receipt)
        if plugin_backup is not None and V1._lexists(plugin_backup):
            raise InstallError("Both the previous plugin and its backup exist unexpectedly")
        if restore_exists:
            _remove_verified_tree(restore_path, after, "restore work tree")
        return
    if current not in {after, (False, V1._canonical_digest([]))}:
        raise InstallError("The plugin files changed outside this update")

    backup = _plugin_backup_for_receipt(home, receipt)
    _verify_plugin_backup(home, receipt)

    if current == after:
        if restore_exists:
            raise InstallError("Both the active plugin and restore work tree exist")
        os.replace(destination, restore_path)
        if _tree_state(restore_path) != after or V1._lexists(destination):
            raise InstallError("The new plugin files could not be isolated for restoration")
        restore_exists = True
    elif not restore_exists and receipt["phase"] not in {
        "backup_ready",
        "plugin_backed_up",
        "rollback_needs_attention",
    }:
        raise InstallError("The active plugin disappeared without a bounded restore work tree")

    if before[0]:
        assert backup is not None
        os.replace(backup, destination)
    if _tree_state(destination) != before:
        raise InstallError("The previous plugin files could not be restored exactly")
    if restore_exists and V1._lexists(restore_path):
        _remove_verified_tree(restore_path, after, "restore work tree")


def _restore_before(home: Path, receipt: dict[str, object], guard: _DirectoryGuard) -> None:
    guard.verify()
    _restore_marketplace_before(home, receipt)
    guard.verify()
    _restore_plugin_before(home, receipt)
    guard.verify()
    if _tree_state(_destination_path(home)) != _expected_tree_state(receipt, "before"):
        raise InstallError("The previous plugin files failed final byte verification")
    if _marketplace_state(_marketplace_path(home))[:2] != _expected_marketplace_state(
        receipt, "before"
    ):
        raise InstallError("The previous marketplace failed final byte verification")


def _apply_transaction(
    plan: dict[str, object], home: Path, staging_root: Path, guard: _DirectoryGuard
) -> dict[str, object]:
    destination = _destination_path(home)
    marketplace = _marketplace_path(home)
    _preflight_tree_bounds(staging_root, "Staged plugin")
    staged_snapshot = V1._snapshot_tree(staging_root)
    receipt = _new_receipt(plan, home, staged_snapshot)
    transaction_root = _transaction_root(home)
    plugin_backup = _plugin_backup_for_receipt(home, receipt)

    if V1._lexists(transaction_root):
        raise InstallError("A local v2 update record already exists")
    if plugin_backup is not None and V1._lexists(plugin_backup):
        raise InstallError(f"Refusing unexpected plugin backup: {plugin_backup}")
    transaction_root.mkdir(mode=0o700)
    guard.track(transaction_root)
    try:
        guard.verify()
        _write_receipt(home, receipt)
        if plan["_marketplace_before"] is not None:
            V1._write_bytes_atomically(
                _marketplace_backup_path(home), plan["_marketplace_before"]
            )
        _verify_marketplace_backup(home, receipt)
        receipt = _transition_receipt(receipt, "backup_ready")
        _write_receipt(home, receipt)

        guard.verify()
        if _tree_state(destination) != _expected_tree_state(receipt, "before"):
            raise InstallError("The plugin destination changed before replacement")
        if _marketplace_state(marketplace)[:2] != _expected_marketplace_state(
            receipt, "before"
        ):
            raise InstallError("The marketplace changed before replacement")

        if bool(receipt["destination"]["before_exists"]):
            assert plugin_backup is not None
            os.replace(destination, plugin_backup)
            _verify_plugin_backup(home, receipt)
        receipt = _transition_receipt(receipt, "plugin_backed_up")
        _write_receipt(home, receipt)

        guard.verify()
        if V1._lexists(destination):
            raise InstallError("The plugin destination unexpectedly exists before activation")
        os.replace(staging_root, destination)
        if _tree_state(destination) != _expected_tree_state(receipt, "after"):
            raise InstallError("The installed plugin did not match the reviewed package")
        receipt = _transition_receipt(receipt, "plugin_replaced")
        _write_receipt(home, receipt)

        guard.verify()
        if _marketplace_state(marketplace)[:2] != _expected_marketplace_state(
            receipt, "before"
        ):
            raise InstallError("The marketplace changed while plugin files were replaced")
        V1._commit_marketplace_bytes(marketplace, plan["_marketplace_after"])
        if _marketplace_state(marketplace)[:2] != _expected_marketplace_state(
            receipt, "after"
        ):
            raise InstallError("The marketplace update failed byte verification")
        receipt = _transition_receipt(receipt, "marketplace_replaced")
        _write_receipt(home, receipt)

        guard.verify()
        _verify_pending_state(home, receipt)
        receipt = _transition_receipt(receipt, "validation_pending")
        _write_receipt(home, receipt)
        return receipt
    except BaseException as update_error:
        rollback_error: BaseException | None = None
        try:
            current_receipt = _read_receipt(home) or receipt
            _restore_before(home, current_receipt, guard)
            if plugin_backup is not None and V1._lexists(plugin_backup):
                raise InstallError("Automatic restoration left an unexpected plugin backup")
            if V1._lexists(transaction_root):
                _remove_transaction_root_safely(home)
        except BaseException as exc:
            rollback_error = exc
            try:
                current_receipt = _read_receipt(home) or receipt
                attention = _transition_receipt(
                    current_receipt, "rollback_needs_attention"
                )
                _write_receipt(home, attention)
            except BaseException:
                pass
        if rollback_error is not None:
            raise InstallError(
                "The local update failed and exact automatic restoration needs "
                f"attention. Update error: {update_error}. Restore error: {rollback_error}"
            ) from update_error
        raise InstallError(
            f"The local update failed, so the exact previous bytes were restored: {update_error}"
        ) from update_error


def _recover_apply_phase(
    home: Path, receipt: dict[str, object], guard: _DirectoryGuard
) -> None:
    if receipt["phase"] in {"confirm_started", "restore_started"}:
        raise InstallError(
            f"The previous {receipt['phase'].split('_', 1)[0]} command must be retried"
        )
    if receipt["phase"] == "validation_pending":
        return
    if receipt["phase"] in TERMINAL_PHASES:
        return
    _restore_before(home, receipt, guard)
    plugin_backup = _plugin_backup_for_receipt(home, receipt)
    if plugin_backup is not None and V1._lexists(plugin_backup):
        raise InstallError("Recovery left an unexpected plugin backup")
    _remove_transaction_root_safely(home)


def _apply_install_plan(
    repo_root: Path, home: Path, approved_plan_hash: str
) -> tuple[dict[str, object], dict[str, object]]:
    initial_receipt = _read_receipt(home)
    if initial_receipt is not None and initial_receipt["plan_hash"] == approved_plan_hash:
        if initial_receipt["phase"] == "validation_pending":
            _verify_pending_state(home, initial_receipt)
            return {"plan_hash": approved_plan_hash}, initial_receipt
        if initial_receipt["phase"] in TERMINAL_PHASES:
            _verify_terminal_state(home, initial_receipt)
            return {"plan_hash": approved_plan_hash}, initial_receipt

    if (
        initial_receipt is not None
        and initial_receipt["plan_hash"] == approved_plan_hash
        and initial_receipt["phase"] in ACTIVE_PHASES
    ):
        initial_plan = None
    else:
        initial_plan = _build_install_plan(repo_root, home, initial_receipt)
    if initial_plan is not None and initial_plan["plan_hash"] != approved_plan_hash:
        raise InstallError(
            "The reviewed v2 preview is no longer current; create and review a new one"
        )

    with V1._exclusive_install_lock(_lock_path(home)):
        receipt = _read_receipt(home)
        if receipt is not None and receipt["plan_hash"] == approved_plan_hash:
            home.mkdir(parents=True, exist_ok=True)
            _destination_path(home).parent.mkdir(parents=True, exist_ok=True)
            _marketplace_path(home).parent.mkdir(parents=True, exist_ok=True)
            guard = _assert_safe_layout(home)
            _recover_apply_phase(home, receipt, guard)
            receipt = _read_receipt(home)
            if receipt is not None:
                if receipt["phase"] == "validation_pending":
                    _verify_pending_state(home, receipt)
                elif receipt["phase"] in TERMINAL_PHASES:
                    _verify_terminal_state(home, receipt)
                return {"plan_hash": approved_plan_hash}, receipt

            locked_plan = _rebuild_install_plan_from_receipt(
                repo_root, home, initial_receipt
            )
            if locked_plan["plan_hash"] != approved_plan_hash:
                raise InstallError(
                    "The source or restored target changed after interrupted apply recovery"
                )
        else:
            locked_plan = _build_install_plan(repo_root, home, receipt)

        if locked_plan["plan_hash"] != approved_plan_hash:
            raise InstallError(
                "Files or the prior transaction changed while waiting; nothing was replaced"
            )

        home.mkdir(parents=True, exist_ok=True)
        _destination_path(home).parent.mkdir(parents=True, exist_ok=True)
        _marketplace_path(home).parent.mkdir(parents=True, exist_ok=True)
        guard = _assert_safe_layout(home)
        if receipt is not None:
            _remove_terminal_record(home, receipt)
            guard = _assert_safe_layout(home)

        staging_root: Path | None = Path(
            tempfile.mkdtemp(
                prefix=f".{PLUGIN_NAME}.staging-v2-",
                dir=_destination_path(home).parent,
            )
        )
        try:
            V1._build_staging_tree(
                repo_root,
                staging_root,
                _destination_path(home),
                locked_plan["_allowlist"],
            )
            V1._verify_tree_files(
                staging_root, locked_plan["_source_entries"], "Staged v2 plugin"
            )
            current_source = V1._collect_allowlisted_source_files(
                repo_root,
                _destination_path(home),
                locked_plan["_allowlist"],
            )
            if current_source != locked_plan["_source_entries"]:
                raise InstallError("The source package changed during staging")
            pending = _apply_transaction(locked_plan, home, staging_root, guard)
            staging_root = None
            return locked_plan, pending
        finally:
            if staging_root is not None and V1._lexists(staging_root):
                V1._remove_path(staging_root)


def _load_bound_receipt(
    home: Path, transaction_id: str, receipt_hash: str
) -> dict[str, object]:
    receipt = _read_receipt(home)
    if receipt is None:
        raise InstallError("No v2 local update record exists for this HOME")
    if receipt["transaction_id"] != transaction_id:
        raise InstallError("The transaction identifier belongs to a different update")
    if not _receipt_command_matches(receipt, receipt_hash):
        raise InstallError("The update record changed; use the current exact receipt")
    return receipt


def _validate_install(
    home: Path, transaction_id: str, receipt_hash: str
) -> dict[str, object]:
    receipt = _load_bound_receipt(home, transaction_id, receipt_hash)
    if receipt["phase"] == "validation_pending":
        _verify_pending_state(home, receipt)
        return receipt
    if receipt["phase"] in TERMINAL_PHASES:
        _verify_terminal_state(home, receipt)
        return receipt
    raise InstallError(
        f"The local update cannot be validated while it is in state {receipt['phase']}"
    )


def _confirm_install(
    home: Path, transaction_id: str, receipt_hash: str
) -> dict[str, object]:
    with V1._exclusive_install_lock(_lock_path(home)):
        receipt = _load_bound_receipt(home, transaction_id, receipt_hash)
        if receipt["phase"] == "confirmed":
            _verify_terminal_state(home, receipt)
            return receipt
        if receipt["phase"] == "restored":
            raise InstallError("This local update was already restored and cannot be confirmed")
        if receipt["phase"] not in {"validation_pending", "confirm_started"}:
            raise InstallError(f"This local update cannot be confirmed from {receipt['phase']}")

        home.mkdir(parents=True, exist_ok=True)
        _destination_path(home).parent.mkdir(parents=True, exist_ok=True)
        _marketplace_path(home).parent.mkdir(parents=True, exist_ok=True)
        guard = _assert_safe_layout(home)
        if receipt["phase"] == "validation_pending":
            _verify_pending_state(home, receipt)
            receipt = _transition_receipt(
                receipt, "confirm_started", transition_input=receipt_hash
            )
            _write_receipt(home, receipt)
        else:
            if _tree_state(_destination_path(home)) != _expected_tree_state(
                receipt, "after"
            ):
                raise InstallError("The installed files changed during confirmation")
            if _marketplace_state(_marketplace_path(home))[:2] != (
                _expected_marketplace_state(receipt, "after")
            ):
                raise InstallError("The marketplace changed during confirmation")
            plugin_backup = _plugin_backup_for_receipt(home, receipt)
            backup_exists = plugin_backup is not None and V1._lexists(plugin_backup)
            confirm_cleanup = _plugin_confirm_cleanup_path(
                home, str(receipt["transaction_id"])
            )
            cleanup_exists = V1._lexists(confirm_cleanup)
            if backup_exists and cleanup_exists:
                raise InstallError(
                    "Both the previous plugin backup and confirmation work tree exist"
                )
            if backup_exists:
                _verify_plugin_backup(home, receipt)
            if cleanup_exists:
                _preflight_tree_bounds(confirm_cleanup, "Confirmation cleanup")
            if V1._lexists(_marketplace_backup_path(home)):
                _verify_marketplace_backup(home, receipt)

        guard.verify()
        plugin_backup = _plugin_backup_for_receipt(home, receipt)
        confirm_cleanup = _plugin_confirm_cleanup_path(
            home, str(receipt["transaction_id"])
        )
        if plugin_backup is not None and V1._lexists(plugin_backup):
            _verify_plugin_backup(home, receipt)
            if V1._lexists(confirm_cleanup):
                raise InstallError("The confirmation work tree unexpectedly exists")
            os.replace(plugin_backup, confirm_cleanup)
            if _tree_state(confirm_cleanup) != _expected_tree_state(receipt, "before"):
                raise InstallError("The confirmation work tree failed byte verification")
        if V1._lexists(confirm_cleanup):
            if _tree_state(confirm_cleanup) == _expected_tree_state(receipt, "before"):
                _remove_verified_tree(
                    confirm_cleanup,
                    _expected_tree_state(receipt, "before"),
                    "confirmation work tree",
                )
            else:
                _remove_bounded_cleanup_tree(
                    confirm_cleanup, "partial confirmation work tree"
                )
        marketplace_backup = _marketplace_backup_path(home)
        if V1._lexists(marketplace_backup):
            _verify_marketplace_backup(home, receipt)
            marketplace_backup.unlink()
        guard.verify()
        if _tree_state(_destination_path(home)) != _expected_tree_state(receipt, "after"):
            raise InstallError("The installed files changed during confirmation")
        if _marketplace_state(_marketplace_path(home))[:2] != _expected_marketplace_state(
            receipt, "after"
        ):
            raise InstallError("The marketplace changed during confirmation")
        receipt = _transition_receipt(receipt, "confirmed")
        _write_receipt(home, receipt)
        _verify_terminal_state(home, receipt)
        return receipt


def _restore_install(
    home: Path, transaction_id: str, receipt_hash: str
) -> dict[str, object]:
    with V1._exclusive_install_lock(_lock_path(home)):
        receipt = _load_bound_receipt(home, transaction_id, receipt_hash)
        if receipt["phase"] == "restored":
            _verify_terminal_state(home, receipt)
            return receipt
        if receipt["phase"] == "confirmed":
            raise InstallError("This local update was already confirmed and cannot be restored")
        if receipt["phase"] not in {"validation_pending", "restore_started"}:
            raise InstallError(f"This local update cannot be restored from {receipt['phase']}")

        home.mkdir(parents=True, exist_ok=True)
        _destination_path(home).parent.mkdir(parents=True, exist_ok=True)
        _marketplace_path(home).parent.mkdir(parents=True, exist_ok=True)
        guard = _assert_safe_layout(home)
        if receipt["phase"] == "validation_pending":
            _verify_pending_state(home, receipt)
            receipt = _transition_receipt(
                receipt, "restore_started", transition_input=receipt_hash
            )
            _write_receipt(home, receipt)
        _restore_before(home, receipt, guard)
        receipt = _transition_receipt(receipt, "restored")
        _write_receipt(home, receipt)
        _verify_terminal_state(home, receipt)
        return receipt


def _shell_command(parts: list[str]) -> str:
    if os.name == "nt":
        return subprocess.list2cmdline(parts)
    return " ".join(shlex.quote(part) for part in parts)


def _base_command(home: Path, locale: str, json_output: bool) -> list[str]:
    command = [
        sys.executable,
        "scripts/install-personal-marketplace-v2.py",
    ]
    if str(home):
        command.extend(["--home", str(home)])
    command.extend(["--locale", locale])
    if json_output:
        command.append("--json")
    return command


def _apply_command(
    plan: dict[str, object], home: Path, locale: str, json_output: bool
) -> str:
    base = _base_command(home, locale, json_output)
    base[2:2] = ["apply", "--plan-hash", str(plan["plan_hash"])]
    return _shell_command(base)


def _transaction_command(
    command: str,
    receipt: dict[str, object],
    home: Path,
    locale: str,
    json_output: bool,
) -> str:
    base = _base_command(home, locale, json_output)
    base[2:2] = [
        command,
        "--transaction-id",
        str(receipt["transaction_id"]),
        "--receipt-hash",
        str(receipt["receipt_hash"]),
    ]
    return _shell_command(base)


def _human_message(command: str, locale: str, state: str, error: bool = False) -> dict[str, str]:
    if locale == "it":
        if error:
            return {
                "outcome": "L’operazione si è fermata per proteggere i file locali già presenti.",
                "impact": "Nessun contenuto estraneo viene sovrascritto intenzionalmente.",
                "decision": "Controlla il dettaglio facoltativo prima di riprovare.",
                "protection_boundary": "Percorsi collegati, dati cambiati e richieste non corrispondenti vengono rifiutati.",
                "next_action": "Risolvi la causa indicata e ripeti soltanto lo stesso passo.",
            }
        if command == "plan":
            return {
                "outcome": "È pronta un’anteprima esatta dell’aggiornamento locale.",
                "impact": "Nessun file è stato modificato.",
                "decision": "Controlla le cartelle indicate; autorizza l’aggiornamento solo se sono corrette.",
                "protection_boundary": "La copia locale precedente sarà conservata finché non sceglierai se tenere o annullare la nuova.",
                "next_action": "Usa l’istruzione facoltativa riportata sotto per iniziare l’aggiornamento.",
            }
        if command == "check":
            return {
                "outcome": "È disponibile un aggiornamento locale." if state == "update_available" else "La copia locale è aggiornata.",
                "impact": "Il controllo ha soltanto letto e confrontato i file.",
                "decision": "Non è richiesta alcuna decisione ora.",
                "protection_boundary": "Il controllo non crea cartelle e non modifica impostazioni.",
                "next_action": "Prepara l’anteprima se vuoi procedere." if state == "update_available" else "Puoi continuare a usare la copia attuale.",
            }
        if command in {"apply", "validate"} and state == "validation_pending":
            return {
                "outcome": "I nuovi file locali corrispondono all’aggiornamento esaminato e attendono la tua decisione finale.",
                "impact": "La copia precedente resta conservata e può ancora essere ripristinata esattamente.",
                "decision": "Dopo i controlli, scegli se tenere la nuova copia oppure tornare alla precedente.",
                "protection_boundary": "Qualsiasi cambiamento successivo ai file blocca entrambe le decisioni.",
                "next_action": "Esegui i controlli locali, poi usa una delle due istruzioni facoltative riportate sotto.",
            }
        if state == "confirmed":
            return {
                "outcome": "La nuova copia locale è stata confermata.",
                "impact": "La copia precedente conservata per il recupero è stata rimossa.",
                "decision": "Non è richiesta un’altra decisione per questo aggiornamento.",
                "protection_boundary": "La conferma vale soltanto per i file e le cartelle mostrati nell’anteprima.",
                "next_action": "Puoi usare la nuova copia locale.",
            }
        return {
            "outcome": "La copia locale precedente è stata ripristinata esattamente.",
            "impact": "I nuovi file non sono più attivi.",
            "decision": "Non è richiesta un’altra decisione per questo tentativo.",
            "protection_boundary": "Il ripristino ha riguardato soltanto i file gestiti dall’aggiornamento.",
            "next_action": "Puoi continuare a usare la copia precedente o creare una nuova anteprima.",
        }

    if error:
        return {
            "outcome": "The operation stopped to protect the local files already present.",
            "impact": "Unrelated content is not intentionally overwritten.",
            "decision": "Review the optional detail before trying again.",
            "protection_boundary": "Linked paths, changed data, and non-matching requests are rejected.",
            "next_action": "Resolve the reported cause and repeat only the same step.",
        }
    if command == "plan":
        return {
            "outcome": "An exact preview of the local update is ready.",
            "impact": "No files were changed.",
            "decision": "Review the displayed folders; authorize the update only if they are correct.",
            "protection_boundary": "The previous local copy will be kept until you choose whether to keep or undo the new one.",
            "next_action": "Use the optional instruction below to start the update.",
        }
    if command == "check":
        return {
            "outcome": "A local update is available." if state == "update_available" else "The local copy is current.",
            "impact": "The check only read and compared files.",
            "decision": "No decision is required now.",
            "protection_boundary": "The check creates no folders and changes no settings.",
            "next_action": "Prepare the preview if you want to continue." if state == "update_available" else "You can keep using the current copy.",
        }
    if command in {"apply", "validate"} and state == "validation_pending":
        return {
            "outcome": "The new local files match the reviewed update and await your final decision.",
            "impact": "The previous copy remains available for exact restoration.",
            "decision": "After your checks, choose whether to keep the new copy or return to the previous one.",
            "protection_boundary": "Any later change to the files blocks both decisions.",
            "next_action": "Run your local checks, then use one of the two optional instructions below.",
        }
    if state == "confirmed":
        return {
            "outcome": "The new local copy was confirmed.",
            "impact": "The previous copy retained for recovery was removed.",
            "decision": "No further decision is required for this update.",
            "protection_boundary": "Confirmation applies only to the files and folders shown in the preview.",
            "next_action": "You can use the new local copy.",
        }
    return {
        "outcome": "The previous local copy was restored exactly.",
        "impact": "The new files are no longer active.",
        "decision": "No further decision is required for this attempt.",
        "protection_boundary": "Restoration affected only files managed by this update.",
        "next_action": "You can keep using the previous copy or create a new preview.",
    }


def _emit_result(
    *,
    command: str,
    locale: str,
    json_output: bool,
    ok: bool,
    human: dict[str, str],
    data: dict[str, object] | None = None,
    technical_details: dict[str, object] | None = None,
) -> None:
    envelope = {
        "schema": PROTOCOL_SCHEMA,
        "ok": ok,
        "command": command,
        "human": human,
        "data": data or {},
        "technical_details": technical_details or {},
    }
    if json_output:
        print(json.dumps(envelope, ensure_ascii=False, sort_keys=True))
        return
    labels = (
        {
            "outcome": "Risultato",
            "impact": "Cosa cambia in pratica",
            "decision": "Cosa devi decidere",
            "protection_boundary": "Cosa resta protetto",
            "next_action": "Prossimo passo",
            "technical": "Dettagli tecnici (facoltativi)",
        }
        if locale == "it"
        else {
            "outcome": "Outcome",
            "impact": "What this changes in practice",
            "decision": "What you need to decide",
            "protection_boundary": "What remains protected",
            "next_action": "Next step",
            "technical": "Technical details (optional)",
        }
    )
    stream = sys.stdout if ok else sys.stderr
    for key in (
        "outcome",
        "impact",
        "decision",
        "protection_boundary",
        "next_action",
    ):
        print(f"{labels[key]}: {human[key]}", file=stream)
    print(f"{labels['technical']}:", file=stream)
    print(
        json.dumps(technical_details or {}, ensure_ascii=False, indent=2, sort_keys=True),
        file=stream,
    )


def _requested_locale(argv: list[str]) -> str:
    return V1._requested_locale(argv)


def _help_message(locale: str) -> dict[str, str]:
    if locale == "it":
        return {
            "outcome": "Puoi preparare un aggiornamento locale reversibile e decidere se tenerlo solo dopo averlo controllato.",
            "impact": "Senza una scelta esplicita vengono soltanto letti e confrontati i file.",
            "decision": "Dopo l’aggiornamento scegli se conservare la nuova copia oppure tornare alla precedente.",
            "protection_boundary": "Ogni passo accetta soltanto l’identificatore esatto prodotto dal passo precedente.",
            "next_action": "Inizia dal controllo o dall’anteprima mostrati nei dettagli facoltativi.",
        }
    return {
        "outcome": "You can prepare a reversible local update and decide whether to keep it only after checking it.",
        "impact": "Without an explicit choice, files are only read and compared.",
        "decision": "After the update, choose whether to keep the new copy or return to the previous one.",
        "protection_boundary": "Each step accepts only the exact identifier produced by the previous step.",
        "next_action": "Start with the check or preview shown in the optional details.",
    }


def _help_details(locale: str) -> dict[str, object]:
    commands = (
        {
            "check": "Controlla lo stato senza scrivere.",
            "plan": "Crea l’anteprima esatta senza scrivere (predefinito).",
            "apply": "Installa l’anteprima e conserva la copia precedente.",
            "validate": "Ricontrolla che i file non siano cambiati.",
            "confirm": "Conserva la nuova copia e rimuove quella precedente.",
            "restore": "Ripristina esattamente la copia precedente.",
        }
        if locale == "it"
        else {
            "check": "Inspect current state without writing.",
            "plan": "Create the exact read-only preview (default).",
            "apply": "Install the preview while retaining the previous copy.",
            "validate": "Recheck that the files have not changed.",
            "confirm": "Keep the new copy and remove the previous one.",
            "restore": "Restore the previous copy exactly.",
        }
    )
    return {
        "usage": (
            "python3 scripts/install-personal-marketplace-v2.py "
            "[check|plan|apply|validate|confirm|restore] [options]"
        ),
        "commands": commands,
        "bindings": {
            "apply": "--plan-hash SHA256",
            "validate_confirm_restore": "--transaction-id ID --receipt-hash SHA256",
        },
        "options": ["--home PATH", "--locale en|it", "--json"],
    }


def main(argv: list[str] | None = None) -> int:
    V1._configure_utf8_output()
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    requested_locale = _requested_locale(raw_argv)
    json_requested = "--json" in raw_argv
    command = next(
        (
            value
            for value in raw_argv
            if value in {"check", "plan", "apply", "validate", "confirm", "restore"}
        ),
        "plan",
    )
    if "--help" in raw_argv or "-h" in raw_argv:
        _emit_result(
            command="help",
            locale=requested_locale,
            json_output=json_requested,
            ok=True,
            human=_help_message(requested_locale),
            data={"default_command": "plan", "read_only_default": True},
            technical_details=_help_details(requested_locale),
        )
        return 0
    try:
        arguments = _parse_arguments(raw_argv)
        requested_locale = arguments.locale
        json_requested = arguments.json
        command = arguments.command
        repo_root = Path(__file__).resolve().parents[1]
        home = V1._home_directory(arguments.home)
        _assert_path_bound(home, "HOME")

        if command in {"check", "plan"}:
            receipt = _read_receipt(home)
            if receipt is not None and receipt["phase"] not in TERMINAL_PHASES:
                raise InstallError(
                    "A local update is still waiting for validation, confirmation, or restoration"
                )
            plan = _build_install_plan(repo_root, home, receipt)
            state = "current" if plan["operation"] == "noop" else "update_available"
            if command == "check":
                _emit_result(
                    command=command,
                    locale=arguments.locale,
                    json_output=arguments.json,
                    ok=True,
                    human=_human_message(command, arguments.locale, state),
                    data={"state": state, "changes": plan["changes"]},
                    technical_details={"inspection": _public_plan(plan)},
                )
                return 0
            _emit_result(
                command=command,
                locale=arguments.locale,
                json_output=arguments.json,
                ok=True,
                human=_human_message(command, arguments.locale, "ready_to_apply"),
                data={
                    "state": "ready_to_apply",
                    "changes": plan["changes"],
                    "plan_hash": plan["plan_hash"],
                },
                technical_details={
                    "plan": _public_plan(plan),
                    "apply_command": _apply_command(
                        plan, home, arguments.locale, arguments.json
                    ),
                    "rollback_boundary": {
                        "plugin": "byte_exact_previous_tree",
                        "marketplace": "byte_exact_previous_file",
                        "global_settings": "not_modified",
                    },
                },
            )
            return 0

        if command == "apply":
            plan, receipt = _apply_install_plan(repo_root, home, arguments.plan_hash)
            state = str(receipt["phase"])
            technical = {
                "plan_hash": arguments.plan_hash,
                "transaction_id": receipt["transaction_id"],
                "receipt_hash": receipt["receipt_hash"],
                "receipt_path": str(_receipt_path(home)),
            }
            if state == "validation_pending":
                technical.update(
                    {
                        "validate_command": _transaction_command(
                            "validate", receipt, home, arguments.locale, arguments.json
                        ),
                        "confirm_command": _transaction_command(
                            "confirm", receipt, home, arguments.locale, arguments.json
                        ),
                        "restore_command": _transaction_command(
                            "restore", receipt, home, arguments.locale, arguments.json
                        ),
                    }
                )
            _emit_result(
                command=command,
                locale=arguments.locale,
                json_output=arguments.json,
                ok=True,
                human=_human_message(command, arguments.locale, state),
                data={"state": state, "transaction_id": receipt["transaction_id"]},
                technical_details=technical,
            )
            return 0

        if command == "validate":
            receipt = _validate_install(
                home, arguments.transaction_id, arguments.receipt_hash
            )
        elif command == "confirm":
            receipt = _confirm_install(
                home, arguments.transaction_id, arguments.receipt_hash
            )
        else:
            receipt = _restore_install(
                home, arguments.transaction_id, arguments.receipt_hash
            )
        state = str(receipt["phase"])
        _emit_result(
            command=command,
            locale=arguments.locale,
            json_output=arguments.json,
            ok=True,
            human=_human_message(command, arguments.locale, state),
            data={"state": state, "transaction_id": receipt["transaction_id"]},
            technical_details={
                "plan_hash": receipt["plan_hash"],
                "receipt_hash": receipt["receipt_hash"],
                "receipt_path": str(_receipt_path(home)),
                "confirm_command": (
                    _transaction_command(
                        "confirm", receipt, home, arguments.locale, arguments.json
                    )
                    if state == "validation_pending"
                    else None
                ),
                "restore_command": (
                    _transaction_command(
                        "restore", receipt, home, arguments.locale, arguments.json
                    )
                    if state == "validation_pending"
                    else None
                ),
            },
        )
        return 0
    except (InstallError, OSError) as exc:
        _emit_result(
            command=command,
            locale=requested_locale,
            json_output=json_requested,
            ok=False,
            human=_human_message(command, requested_locale, "stopped", error=True),
            data={"state": "stopped"},
            technical_details={"error": str(exc), "error_type": type(exc).__name__},
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
