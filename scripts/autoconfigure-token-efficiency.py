#!/usr/bin/env python3
"""Verify bundled token-efficiency components and configure an existing RTK.

The plugin copy itself installs Caveman and the native Codex session meter.
RTK stays an optional external executable: this command verifies its identity
and configures its global Codex instructions when `apply` is requested.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parent.parent
EXPECTED_BUNDLED_FILES = {
    "caveman_skill": (
        Path("skills/caveman/SKILL.md"),
        "f2d4d6e396c35e9dfd4643872d0b749c63e7135f74eb0b5cdd143501ca04c4ac",
    ),
    "caveman_agent_card": (
        Path("skills/caveman/agents/openai.yaml"),
        "4961a650c93d688aab1f68850149cfde235a9f25b20072fcad3ee192914808fc",
    ),
    "codex_session_meter": (
        Path("lib/codex-session-metering-adapter.mjs"),
        None,
    ),
}


def _load_installer():
    installer_path = Path(__file__).with_name("install-personal-marketplace.py")
    specification = importlib.util.spec_from_file_location(
        "agentic_sdlc_local_installer_v1", installer_path
    )
    if specification is None or specification.loader is None:
        raise RuntimeError(f"Could not load installer support from {installer_path}")
    module = importlib.util.module_from_spec(specification)
    previous_bytecode_setting = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        specification.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_bytecode_setting
    return module


INSTALLER = _load_installer()
InstallError = INSTALLER.InstallError


def _sha256(path: Path, *, normalize_crlf: bool = False) -> str:
    digest = hashlib.sha256()
    if normalize_crlf:
        payload = path.read_bytes().replace(b"\r\n", b"\n")
        digest.update(payload)
        return digest.hexdigest()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _bundled_components() -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for component, (relative, expected_hash) in EXPECTED_BUNDLED_FILES.items():
        target = PLUGIN_ROOT / relative
        available = target.is_file() and not target.is_symlink()
        normalize_crlf = expected_hash is not None
        actual_hash = (
            _sha256(target, normalize_crlf=normalize_crlf) if available else None
        )
        verified = available and (
            expected_hash is None or actual_hash == expected_hash
        )
        results.append(
            {
                "id": component,
                "source": "bundled",
                "path": relative.as_posix(),
                "available": available,
                "verified": verified,
                "sha256": actual_hash,
                "hash_normalization": "crlf_to_lf" if normalize_crlf else "none",
                "authentication_required": False,
                "network_required": False,
            }
        )
    return results


def _rtk_plan(configured: str | None) -> tuple[dict[str, object] | None, str | None]:
    try:
        return INSTALLER._inspect_rtk_plan(True, configured), None
    except InstallError as exc:
        if configured is not None:
            raise
        message = str(exc)
        if "was not found on PATH" not in message:
            raise
        return None, message


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Verify bundled Caveman/native metering and configure an existing "
            "RTK installation without CodeBurn, authentication, or network access."
        )
    )
    parser.add_argument("command", nargs="?", choices=("check", "apply"), default="check")
    parser.add_argument("--rtk-executable", metavar="PATH")
    parser.add_argument("--project-root", metavar="PATH")
    parser.add_argument("--json", action="store_true")
    return parser


def _emit(payload: dict[str, object], json_output: bool) -> None:
    if json_output:
        print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
        return
    print(f"Token-efficiency autoconfiguration: {payload['status']}")
    for component in payload["components"]:
        state = "ready" if component.get("verified") else component.get("status", "unavailable")
        print(f"- {component['id']}: {state}")
    if payload.get("next_action"):
        print(f"Next: {payload['next_action']}")


def main(argv: list[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        components = _bundled_components()
        failed = [component for component in components if not component["verified"]]
        if failed:
            raise InstallError(
                "Bundled token-efficiency component verification failed: "
                + ", ".join(str(component["id"]) for component in failed)
            )

        plan, unavailable_reason = _rtk_plan(arguments.rtk_executable)
        rtk_component: dict[str, object] = {
            "id": "rtk",
            "source": "existing_executable",
            "required": False,
            "authentication_required": False,
            "network_required": False,
        }
        next_action = None
        if plan is None:
            rtk_component.update(
                {
                    "available": False,
                    "verified": False,
                    "configured": False,
                    "status": "native_fallback",
                    "reason": unavailable_reason,
                }
            )
            next_action = (
                "Install RTK 0.43.0+ through an approved cross-platform package "
                "channel, then rerun this command. Native command execution remains available."
            )
        else:
            rtk_component.update(
                {
                    "available": True,
                    "verified": True,
                    "configured": False,
                    "status": "verified",
                    "executable": plan["executable"],
                    "version": plan["version"],
                    "binary_sha256": plan["binary_sha256"],
                }
            )
            if arguments.command == "apply":
                project_root = (
                    Path(arguments.project_root).expanduser().resolve()
                    if arguments.project_root
                    else PLUGIN_ROOT
                )
                configured = INSTALLER._configure_rtk_for_codex(plan, project_root)
                rtk_component.update(
                    {
                        "configured": True,
                        "status": "configured",
                        "version": configured["version"],
                    }
                )
            else:
                next_action = "Run `apply` to configure the verified RTK executable for Codex."

        components.append(rtk_component)
        status = (
            "configured"
            if rtk_component["status"] == "configured"
            else "ready"
            if rtk_component["status"] == "verified"
            else "ready_with_native_fallback"
        )
        _emit(
            {
                "schema_version": "agentic-sdlc.token-efficiency-autoconfiguration:v1",
                "status": status,
                "command": arguments.command,
                "components": components,
                "codeburn": {
                    "configured": False,
                    "required": False,
                    "reason": "Replaced by the bundled Codex session meter for the default path.",
                },
                "usage_accounting": "measured_net_usage_only",
                "next_action": next_action,
            },
            arguments.json,
        )
        return 0
    except (InstallError, OSError, RuntimeError) as exc:
        _emit(
            {
                "schema_version": "agentic-sdlc.token-efficiency-autoconfiguration:v1",
                "status": "stopped",
                "command": arguments.command,
                "components": [],
                "error": str(exc),
                "next_action": "Correct the reported local verification problem and retry.",
            },
            arguments.json,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
