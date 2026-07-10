#!/usr/bin/env python3
"""Stage Agentic SDLC into the default personal Codex marketplace."""

from __future__ import annotations

import fnmatch
import json
import os
import secrets
import shutil
import sys
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path, PurePosixPath


PLUGIN_NAME = "agentic-sdlc-codex-plugin"
DEFAULT_MARKETPLACE_NAME = "personal"
STANDARD_ROOT_FILES = ("package.json", "README.md", "LICENSE")
EXCLUDED_NAMES = frozenset({".git", ".sdlc", "test", ".DS_Store"})
EXCLUDED_FILE_SUFFIXES = (".pyc", ".pyo")
INSTALL_LOCK_WAIT_SECONDS = 30.0
INSTALL_LOCK_STALE_SECONDS = 300.0


class InstallError(RuntimeError):
    """Raised when staging cannot proceed without risking unmanaged files."""


def _lexists(path: Path) -> bool:
    return os.path.lexists(path)


def _home_directory() -> Path:
    configured_home = os.environ.get("HOME")
    home = Path(configured_home).expanduser() if configured_home else Path.home()
    if not home.is_absolute():
        raise InstallError(f"HOME must be an absolute path, got: {home}")
    return home


def _assert_no_nested_symlinks(base: Path, target: Path, label: str) -> None:
    try:
        relative = target.absolute().relative_to(base.absolute())
    except ValueError as exc:
        raise InstallError(f"{label} escapes HOME: {target}") from exc

    current = base
    for component in relative.parts:
        current = current / component
        if _lexists(current) and current.is_symlink():
            raise InstallError(f"Refusing symlinked {label} path component: {current}")


@contextmanager
def _exclusive_install_lock(lock_path: Path):
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    nonce = secrets.token_hex(12)
    deadline = time.monotonic() + INSTALL_LOCK_WAIT_SECONDS
    payload = {
        "pid": os.getpid(),
        "nonce": nonce,
        "created_at": time.time(),
    }
    while True:
        try:
            descriptor = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle)
            break
        except FileExistsError:
            try:
                age = time.time() - lock_path.stat().st_mtime
            except FileNotFoundError:
                continue
            if age >= INSTALL_LOCK_STALE_SECONDS:
                stale_path = lock_path.with_name(
                    f".{lock_path.name}.stale-{os.getpid()}-{secrets.token_hex(4)}"
                )
                try:
                    os.replace(lock_path, stale_path)
                    stale_path.unlink(missing_ok=True)
                    continue
                except FileNotFoundError:
                    continue
                except OSError:
                    pass
            if time.monotonic() >= deadline:
                raise InstallError(f"Timed out waiting for installer lock: {lock_path}")
            time.sleep(0.05)
    try:
        yield
    finally:
        try:
            current = json.loads(lock_path.read_text(encoding="utf-8"))
            if current.get("nonce") == nonce:
                lock_path.unlink(missing_ok=True)
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass


def _read_package_allowlist(repo_root: Path) -> tuple[str, ...]:
    package_path = repo_root / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise InstallError(f"Missing package manifest: {package_path}") from exc
    except json.JSONDecodeError as exc:
        raise InstallError(f"Invalid JSON in {package_path}: {exc}") from exc
    except OSError as exc:
        raise InstallError(f"Could not read {package_path}: {exc}") from exc

    if not isinstance(package, dict):
        raise InstallError(f"{package_path} must contain a JSON object.")

    raw_allowlist = package.get("files")
    if not isinstance(raw_allowlist, list) or not raw_allowlist:
        raise InstallError(f"{package_path} field 'files' must be a non-empty array.")

    patterns: list[str] = []
    for index, value in enumerate(raw_allowlist):
        if not isinstance(value, str) or not value.strip():
            raise InstallError(
                f"{package_path} field 'files' item {index} must be a non-empty string."
            )

        pattern = value.strip().replace("\\", "/")
        while pattern.startswith("./"):
            pattern = pattern[2:]
        pattern = pattern.rstrip("/")
        parsed = PurePosixPath(pattern)
        if (
            not pattern
            or pattern == "."
            or pattern.startswith("!")
            or parsed.is_absolute()
            or ".." in parsed.parts
        ):
            raise InstallError(
                f"Unsafe or unsupported package files entry at index {index}: {value!r}"
            )
        if pattern not in patterns:
            patterns.append(pattern)

    return tuple(patterns)


def _is_excluded(relative_path: Path) -> bool:
    return any(part in EXCLUDED_NAMES for part in relative_path.parts) or (
        relative_path.name == "__pycache__"
        or relative_path.name.endswith(EXCLUDED_FILE_SUFFIXES)
    )


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.absolute().relative_to(parent.absolute())
        return True
    except ValueError:
        return False


def _is_forbidden_source_path(path: Path, forbidden_roots: tuple[Path, ...]) -> bool:
    return any(_is_within(path, root) for root in forbidden_roots)


def _copy_file(source: Path, repo_root: Path, staging_root: Path) -> None:
    relative_path = source.relative_to(repo_root)
    destination = staging_root / relative_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def _copy_directory(
    source: Path,
    repo_root: Path,
    staging_root: Path,
    forbidden_roots: tuple[Path, ...],
) -> None:
    for current_root, directory_names, file_names in os.walk(source, followlinks=False):
        current_path = Path(current_root)
        current_relative = current_path.relative_to(repo_root)

        retained_directories: list[str] = []
        for directory_name in sorted(directory_names):
            child = current_path / directory_name
            child_relative = child.relative_to(repo_root)
            if _is_excluded(child_relative) or _is_forbidden_source_path(
                child, forbidden_roots
            ):
                continue
            if child.is_symlink():
                raise InstallError(f"Refusing allowlisted source symlink: {child}")
            retained_directories.append(directory_name)
        directory_names[:] = retained_directories

        (staging_root / current_relative).mkdir(parents=True, exist_ok=True)
        for file_name in sorted(file_names):
            child = current_path / file_name
            child_relative = child.relative_to(repo_root)
            if _is_excluded(child_relative) or _is_forbidden_source_path(
                child, forbidden_roots
            ):
                continue
            if child.is_symlink():
                raise InstallError(f"Refusing allowlisted source symlink: {child}")
            if not child.is_file():
                raise InstallError(f"Refusing non-regular allowlisted source file: {child}")
            _copy_file(child, repo_root, staging_root)


def _copy_allowlisted_path(
    source: Path,
    repo_root: Path,
    staging_root: Path,
    forbidden_roots: tuple[Path, ...],
) -> None:
    relative_path = source.relative_to(repo_root)
    if _is_excluded(relative_path) or _is_forbidden_source_path(source, forbidden_roots):
        return
    if source.is_symlink():
        raise InstallError(f"Refusing allowlisted source symlink: {source}")
    if source.is_dir():
        _copy_directory(source, repo_root, staging_root, forbidden_roots)
        return
    if source.is_file():
        _copy_file(source, repo_root, staging_root)
        return
    raise InstallError(f"Refusing non-regular allowlisted source path: {source}")


def _build_staging_tree(
    repo_root: Path,
    staging_root: Path,
    destination: Path,
    allowlist: tuple[str, ...],
) -> None:
    forbidden_roots = (staging_root, destination)

    for root_file in STANDARD_ROOT_FILES:
        source = repo_root / root_file
        if _lexists(source):
            _copy_allowlisted_path(
                source, repo_root, staging_root, forbidden_roots
            )

    for pattern in allowlist:
        try:
            matches = sorted(repo_root.glob(pattern), key=lambda path: path.as_posix())
        except (OSError, ValueError) as exc:
            raise InstallError(f"Invalid package files pattern {pattern!r}: {exc}") from exc
        for source in matches:
            _copy_allowlisted_path(
                source, repo_root, staging_root, forbidden_roots
            )

    staged_manifest = staging_root / ".codex-plugin" / "plugin.json"
    if not staged_manifest.is_file():
        raise InstallError(
            "The package files allowlist did not stage .codex-plugin/plugin.json."
        )

    for staged_path in staging_root.rglob("*"):
        relative_path = staged_path.relative_to(staging_root)
        if _is_excluded(relative_path):
            raise InstallError(f"Excluded path reached the staging tree: {relative_path}")


def _is_managed_top_level(name: str, allowlist: tuple[str, ...]) -> bool:
    if name in STANDARD_ROOT_FILES:
        return True
    if name in EXCLUDED_NAMES:
        return False

    for pattern in allowlist:
        first_component = PurePosixPath(pattern).parts[0]
        if fnmatch.fnmatchcase(name, first_component):
            return True
    return False


def _validate_destination(
    repo_root: Path, destination: Path, allowlist: tuple[str, ...]
) -> None:
    if destination.is_symlink():
        raise InstallError(f"Refusing destination symlink: {destination}")

    if not _lexists(destination):
        return

    try:
        if os.path.samefile(repo_root, destination):
            raise InstallError(
                f"Refusing to replace the source checkout itself: {destination}"
            )
    except OSError as exc:
        raise InstallError(f"Could not compare source and destination: {exc}") from exc

    if not destination.is_dir():
        raise InstallError(f"Refusing non-directory destination: {destination}")

    git_marker = destination / ".git"
    if _lexists(git_marker):
        raise InstallError(
            f"Refusing to replace Git checkout at {destination}; move the checkout elsewhere."
        )

    unexpected = sorted(
        entry.name
        for entry in destination.iterdir()
        if not _is_managed_top_level(entry.name, allowlist)
    )
    if unexpected:
        formatted = ", ".join(unexpected)
        raise InstallError(
            f"Refusing to replace {destination}; unexpected unmanaged top-level "
            f"entries: {formatted}"
        )


def _prepare_marketplace_payload(marketplace_path: Path) -> dict:
    if marketplace_path.is_symlink():
        raise InstallError(f"Refusing marketplace symlink: {marketplace_path}")
    if _lexists(marketplace_path):
        try:
            payload = json.loads(marketplace_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise InstallError(f"Invalid JSON in {marketplace_path}: {exc}") from exc
        except OSError as exc:
            raise InstallError(f"Could not read {marketplace_path}: {exc}") from exc
    else:
        payload = {
            "name": DEFAULT_MARKETPLACE_NAME,
            "interface": {"displayName": "Personal"},
            "plugins": [],
        }

    if not isinstance(payload, dict):
        raise InstallError(f"{marketplace_path} must contain a JSON object.")

    payload.setdefault("name", DEFAULT_MARKETPLACE_NAME)
    payload.setdefault("interface", {"displayName": "Personal"})
    plugins = payload.setdefault("plugins", [])
    if not isinstance(plugins, list):
        raise InstallError(f"{marketplace_path} field 'plugins' must be an array.")

    entry = {
        "name": PLUGIN_NAME,
        "source": {
            "source": "local",
            "path": f"./plugins/{PLUGIN_NAME}",
        },
        "policy": {
            "installation": "AVAILABLE",
            "authentication": "ON_INSTALL",
        },
        "category": "Productivity",
    }

    updated_plugins: list[object] = []
    found = False
    for item in plugins:
        if isinstance(item, dict) and item.get("name") == PLUGIN_NAME:
            if found:
                continue
            updated_entry = dict(item)
            updated_entry.update(entry)
            updated_plugins.append(updated_entry)
            found = True
        else:
            updated_plugins.append(item)
    if not found:
        updated_plugins.append(entry)
    payload["plugins"] = updated_plugins

    return payload


def _write_json_atomically(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    except BaseException:
        if _lexists(temporary_path):
            temporary_path.unlink()
        raise


def _replace_staged_tree(staging_root: Path, destination: Path) -> Path | None:
    if not _lexists(destination):
        os.replace(staging_root, destination)
        return None

    backup = Path(
        tempfile.mkdtemp(prefix=f".{PLUGIN_NAME}.backup-", dir=destination.parent)
    )
    backup.rmdir()
    os.replace(destination, backup)
    try:
        os.replace(staging_root, destination)
    except BaseException as install_error:
        try:
            os.replace(backup, destination)
        except BaseException as rollback_error:
            raise InstallError(
                f"Plugin replacement failed and rollback also failed. Existing files "
                f"remain at {backup}. Replacement error: {install_error}; rollback "
                f"error: {rollback_error}"
            ) from install_error
        raise
    return backup


def _rollback_staged_tree(destination: Path, backup: Path | None) -> None:
    failed_tree = destination.with_name(
        f".{destination.name}.failed-{os.getpid()}"
    )
    if _lexists(failed_tree):
        shutil.rmtree(failed_tree, ignore_errors=True)
    if _lexists(destination):
        os.replace(destination, failed_tree)
    try:
        if backup is not None:
            os.replace(backup, destination)
    except BaseException:
        if _lexists(failed_tree) and not _lexists(destination):
            os.replace(failed_tree, destination)
        raise
    if _lexists(failed_tree):
        shutil.rmtree(failed_tree, ignore_errors=True)


def _remove_backup(backup: Path | None) -> None:
    if backup is None or not _lexists(backup):
        return
    try:
        shutil.rmtree(backup)
    except OSError as exc:
        print(f"Warning: could not remove old staged tree {backup}: {exc}", file=sys.stderr)


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    manifest = repo_root / ".codex-plugin" / "plugin.json"
    if not manifest.is_file():
        print(f"Missing plugin manifest: {manifest}", file=sys.stderr)
        return 1

    staging_root: Path | None = None
    destination_backup: Path | None = None
    try:
        allowlist = _read_package_allowlist(repo_root)
        home = _home_directory()
        marketplace_path = home / ".agents" / "plugins" / "marketplace.json"
        destination = home / "plugins" / PLUGIN_NAME
        install_lock_path = home / ".agents" / "plugins" / f".{PLUGIN_NAME}.install.lock"
        _assert_no_nested_symlinks(home, destination, "plugin destination")
        _assert_no_nested_symlinks(home, marketplace_path, "marketplace")
        with _exclusive_install_lock(install_lock_path):
            marketplace_payload = _prepare_marketplace_payload(marketplace_path)

            destination.parent.mkdir(parents=True, exist_ok=True)
            _validate_destination(repo_root, destination, allowlist)

            staging_root = Path(
                tempfile.mkdtemp(
                    prefix=f".{PLUGIN_NAME}.staging-", dir=destination.parent
                )
            )
            _build_staging_tree(repo_root, staging_root, destination, allowlist)

            _validate_destination(repo_root, destination, allowlist)
            destination_backup = _replace_staged_tree(staging_root, destination)
            staging_root = None

            try:
                _write_json_atomically(marketplace_path, marketplace_payload)
            except BaseException as marketplace_error:
                try:
                    _rollback_staged_tree(destination, destination_backup)
                    destination_backup = None
                except BaseException as rollback_error:
                    raise InstallError(
                        "Marketplace update failed and plugin rollback also failed. "
                        f"Marketplace error: {marketplace_error}; rollback error: {rollback_error}"
                    ) from marketplace_error
                raise
            _remove_backup(destination_backup)
            destination_backup = None
    except (InstallError, OSError) as exc:
        print(f"Install failed: {exc}", file=sys.stderr)
        return 1
    finally:
        if staging_root is not None and _lexists(staging_root):
            shutil.rmtree(staging_root, ignore_errors=True)

    print(f"Installed staged plugin at {destination}")
    print(f"Updated {marketplace_path}")
    print(
        f"Run: codex plugin add {PLUGIN_NAME}@"
        f"{marketplace_payload.get('name', DEFAULT_MARKETPLACE_NAME)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
