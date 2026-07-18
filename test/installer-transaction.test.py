#!/usr/bin/env python3
"""Focused tests for the plan-first personal marketplace installer."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[1]
INSTALLER_PATH = REPO_ROOT / "scripts" / "install-personal-marketplace.py"
SPEC = importlib.util.spec_from_file_location("personal_marketplace_installer", INSTALLER_PATH)
assert SPEC is not None and SPEC.loader is not None
INSTALLER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(INSTALLER)


PRIMARY_INTERNAL_JARGON = re.compile(
    r"\b(?:bounded[-_ ]autonomous|checkpoint(?:ed)?|audit[-_ ]only|receipt(?:s)?|"
    r"profile(?:s)?|ceiling|plan_hash|plugin(?:s)?|lock(?:s|ed|ing)?|rollback|"
    r"backup(?:s)?|apply|plan|marketplace|schema|manifest|sha256|transaction(?:al)?)\b",
    re.IGNORECASE,
)
PRIMARY_COMMAND_TEXT = re.compile(
    r"(?:--[a-z][a-z0-9-]*|\bpython3?\b|\bcodex\s+plugin\b|\brtk\s+init\b|"
    r"scripts[/\\]|agentic-sdlc-codex-plugin)",
    re.IGNORECASE,
)

HUMAN_FIELDS = {
    "outcome",
    "impact",
    "decision",
    "protection_boundary",
    "next_action",
}


class InstallerTransactionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="installer-transaction-")
        self.root = Path(self.temporary.name)
        self.repo = self.root / "source"
        self.home = self.root / "custom-home"
        (self.repo / ".codex-plugin").mkdir(parents=True)
        (self.repo / "lib").mkdir()
        (self.repo / ".codex-plugin" / "plugin.json").write_text(
            '{"name":"fixture","version":"1.0.0"}\n', encoding="utf-8"
        )
        (self.repo / "lib" / "core.mjs").write_text(
            'export const version = "one";\n', encoding="utf-8"
        )
        (self.repo / "package.json").write_text(
            json.dumps(
                {
                    "name": "fixture",
                    "version": "1.0.0",
                    "files": [".codex-plugin", "lib"],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        (self.repo / "README.md").write_text("fixture\n", encoding="utf-8")
        (self.repo / "LICENSE").write_text("fixture\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def plan(self):
        return INSTALLER._build_install_plan(self.repo, self.home)

    def apply(self, plan):
        return INSTALLER._apply_install_plan(
            self.repo,
            self.home,
            plan["plan_hash"],
            False,
            None,
        )

    def test_plan_is_deterministic_and_strictly_read_only(self) -> None:
        first = self.plan()
        second = self.plan()

        self.assertEqual(first["plan_hash"], second["plan_hash"])
        self.assertEqual(first["operation"], "install")
        self.assertFalse(self.home.exists())

    def test_apply_requires_current_hash_and_byte_verifies_custom_home(self) -> None:
        plan = self.plan()
        applied, warnings = self.apply(plan)

        destination = self.home / "plugins" / INSTALLER.PLUGIN_NAME
        marketplace = self.home / ".agents" / "plugins" / "marketplace.json"
        self.assertEqual(warnings, [])
        self.assertEqual(applied["operation"], "install")
        self.assertEqual(
            (destination / "lib" / "core.mjs").read_text(encoding="utf-8"),
            'export const version = "one";\n',
        )
        self.assertEqual(
            INSTALLER._file_entries(INSTALLER._snapshot_tree(destination)),
            plan["_source_entries"],
        )
        self.assertIn(
            INSTALLER.PLUGIN_NAME,
            [entry["name"] for entry in json.loads(marketplace.read_text())["plugins"]],
        )
        self.assertFalse(
            (self.home / ".agents" / "plugins" / f".{INSTALLER.PLUGIN_NAME}.install.lock").exists()
        )

    def test_stale_plan_fails_before_creating_home(self) -> None:
        stale = self.plan()
        (self.repo / "lib" / "core.mjs").write_text(
            'export const version = "two";\n', encoding="utf-8"
        )

        with self.assertRaisesRegex(INSTALLER.InstallError, "no longer current"):
            self.apply(stale)
        self.assertFalse(self.home.exists())

    def test_marketplace_failure_restores_plugin_and_exact_original_bytes(self) -> None:
        self.apply(self.plan())
        destination = self.home / "plugins" / INSTALLER.PLUGIN_NAME
        marketplace = self.home / ".agents" / "plugins" / "marketplace.json"
        original_plugin = (destination / "lib" / "core.mjs").read_bytes()
        original_marketplace = (
            b'{\n  "name": "personal",\n  "interface": {"displayName": "My plugins"},\n'
            b'  "plugins": [],\n  "custom": "preserve exact formatting"\n}\n'
        )
        marketplace.write_bytes(original_marketplace)
        (self.repo / "lib" / "core.mjs").write_text(
            'export const version = "two";\n', encoding="utf-8"
        )
        update = self.plan()

        with mock.patch.object(
            INSTALLER,
            "_commit_marketplace_bytes",
            side_effect=OSError("deterministic injected marketplace failure"),
        ):
            with self.assertRaisesRegex(
                INSTALLER.InstallError, "original plugin and marketplace were restored"
            ):
                self.apply(update)

        self.assertEqual(
            (destination / "lib" / "core.mjs").read_bytes(), original_plugin
        )
        self.assertEqual(marketplace.read_bytes(), original_marketplace)
        self.assertEqual(
            list((self.home / "plugins").glob(f".{INSTALLER.PLUGIN_NAME}.backup-*")),
            [],
        )
        self.assertEqual(
            list(
                (self.home / ".agents" / "plugins").glob(
                    f".{INSTALLER.PLUGIN_NAME}.transaction-*"
                )
            ),
            [],
        )

    def test_post_commit_verification_failure_restores_both_locations(self) -> None:
        self.apply(self.plan())
        destination = self.home / "plugins" / INSTALLER.PLUGIN_NAME
        marketplace = self.home / ".agents" / "plugins" / "marketplace.json"
        original_plugin = (destination / "lib" / "core.mjs").read_bytes()
        original_marketplace = marketplace.read_bytes()
        (self.repo / "lib" / "core.mjs").write_text(
            'export const version = "two";\n', encoding="utf-8"
        )
        update = self.plan()
        original_verify = INSTALLER._verify_tree_files
        installed_verifications = 0

        def fail_after_marketplace(root, expected, label):
            nonlocal installed_verifications
            original_verify(root, expected, label)
            if label == "Installed plugin":
                installed_verifications += 1
                if installed_verifications == 2:
                    raise INSTALLER.InstallError(
                        "deterministic injected final verification failure"
                    )

        with mock.patch.object(
            INSTALLER, "_verify_tree_files", side_effect=fail_after_marketplace
        ):
            with self.assertRaisesRegex(
                INSTALLER.InstallError, "original plugin and marketplace were restored"
            ):
                self.apply(update)

        self.assertEqual(
            (destination / "lib" / "core.mjs").read_bytes(), original_plugin
        )
        self.assertEqual(marketplace.read_bytes(), original_marketplace)

    def test_concurrent_apply_allows_one_update_and_rejects_stale_peer(self) -> None:
        self.apply(self.plan())
        (self.repo / "lib" / "core.mjs").write_text(
            'export const version = "two";\n', encoding="utf-8"
        )
        update = self.plan()
        barrier = threading.Barrier(2)
        outcomes: list[str] = []

        def worker() -> None:
            barrier.wait()
            try:
                self.apply(update)
                outcomes.append("applied")
            except INSTALLER.InstallError:
                outcomes.append("stale")

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)

        self.assertEqual(sorted(outcomes), ["applied", "stale"])
        self.assertEqual(
            (
                self.home
                / "plugins"
                / INSTALLER.PLUGIN_NAME
                / "lib"
                / "core.mjs"
            ).read_text(encoding="utf-8"),
            'export const version = "two";\n',
        )

    def test_old_lock_is_not_reclaimed_while_its_owner_is_alive(self) -> None:
        lock_path = (
            self.home
            / ".agents"
            / "plugins"
            / f".{INSTALLER.PLUGIN_NAME}.install.lock"
        )
        lock_path.parent.mkdir(parents=True)
        owner = {
            "pid": os.getpid(),
            "nonce": "active-owner",
            "created_at": 1,
        }
        lock_path.write_text(json.dumps(owner), encoding="utf-8")
        os.utime(lock_path, (1, 1))

        with mock.patch.object(INSTALLER, "INSTALL_LOCK_WAIT_SECONDS", 0.01):
            with self.assertRaisesRegex(
                INSTALLER.InstallError,
                "Timed out waiting for installer lock",
            ):
                with INSTALLER._exclusive_install_lock(lock_path):
                    self.fail("a live process must retain its installer lock")

        self.assertEqual(json.loads(lock_path.read_text(encoding="utf-8")), owner)

    def test_unmanaged_and_linked_destinations_fail_closed(self) -> None:
        destination = self.home / "plugins" / INSTALLER.PLUGIN_NAME
        destination.mkdir(parents=True)
        (destination / "unmanaged.txt").write_text("keep\n", encoding="utf-8")
        with self.assertRaisesRegex(INSTALLER.InstallError, "unexpected unmanaged"):
            self.plan()

        if os.name != "nt":
            linked_home = self.root / "linked-home"
            external = self.root / "external-plugins"
            external.mkdir()
            linked_home.mkdir()
            (linked_home / "plugins").symlink_to(external, target_is_directory=True)
            with self.assertRaisesRegex(INSTALLER.InstallError, "symlinked or junction"):
                INSTALLER._build_install_plan(self.repo, linked_home)

    def test_rtk_identity_changes_the_exact_plan(self) -> None:
        with mock.patch.object(
            INSTALLER,
            "_inspect_rtk_plan",
            return_value={
                "enabled": True,
                "transactional": False,
                "executable": "/tools/rtk",
                "version": "0.43.0",
                "binary_sha256": "a" * 64,
                "binary_bytes": 10,
            },
        ):
            first = INSTALLER._build_install_plan(
                self.repo, self.home, with_rtk=True
            )
        with mock.patch.object(
            INSTALLER,
            "_inspect_rtk_plan",
            return_value={
                "enabled": True,
                "transactional": False,
                "executable": "/tools/rtk",
                "version": "0.44.0",
                "binary_sha256": "b" * 64,
                "binary_bytes": 11,
            },
        ):
            second = INSTALLER._build_install_plan(
                self.repo, self.home, with_rtk=True
            )
        self.assertNotEqual(first["plan_hash"], second["plan_hash"])

    def test_rtk_binary_drift_stops_before_any_global_command(self) -> None:
        executable = self.root / ("rtk.cmd" if os.name == "nt" else "rtk")
        approved_bytes = b"approved RTK executable bytes\n"
        executable.write_bytes(approved_bytes)
        if os.name != "nt":
            executable.chmod(0o755)
        rtk_plan = {
            "enabled": True,
            "transactional": False,
            "executable": str(executable),
            "version": "0.43.0",
            "binary_sha256": INSTALLER._sha256_bytes(approved_bytes),
            "binary_bytes": len(approved_bytes),
        }
        executable.write_bytes(b"different bytes after review\n")

        with mock.patch.object(INSTALLER, "_run_rtk_command") as invoked:
            with self.assertRaisesRegex(
                INSTALLER.InstallError,
                "changed after the reviewed preview",
            ):
                INSTALLER._configure_rtk_for_codex(rtk_plan, self.repo)
        invoked.assert_not_called()

    def test_rtk_consent_is_explicit_and_plain_in_english_and_italian(self) -> None:
        plan = {"operation": "install", "rtk": {"enabled": True}}
        expectations = {
            "en": (
                r"global personal (?:instructions Codex|Codex instructions)",
                r"separate",
                r"(?:not undone|does not undo)",
            ),
            "it": (
                r"istruzioni personali globali (?:usate da Codex|di Codex)",
                r"separata",
                r"non (?:viene|vengono) annullat[ae]",
            ),
        }
        for locale, patterns in expectations.items():
            for command in ("check", "plan", "apply"):
                message = INSTALLER._human_message(command, locale, plan)
                primary = "\n".join(message.values())
                for pattern in patterns:
                    self.assertRegex(primary, pattern)
                self.assertNotRegex(primary, PRIMARY_INTERNAL_JARGON)
                self.assertNotRegex(primary, PRIMARY_COMMAND_TEXT)

    def test_plan_preserves_crash_state_and_apply_recovers_before_updating(self) -> None:
        crash_repo = self.root / "crash-source"
        shutil.copytree(self.repo, crash_repo)
        (crash_repo / "scripts").mkdir()
        shutil.copy2(
            INSTALLER_PATH,
            crash_repo / "scripts" / "install-personal-marketplace.py",
        )
        crash_home = self.root / "crash-home"
        copied_installer = crash_repo / "scripts" / "install-personal-marketplace.py"

        def invoke(arguments, *, crash_phase=None):
            environment = dict(os.environ)
            environment["HOME"] = str(crash_home)
            if crash_phase is not None:
                environment[
                    "_AGENTIC_SDLC_INSTALLER_TEST_CRASH_PHASE"
                ] = crash_phase
            return subprocess.run(
                [sys.executable, str(copied_installer), *arguments],
                cwd=str(crash_repo),
                env=environment,
                capture_output=True,
                encoding="utf-8",
                timeout=20,
                check=False,
            )

        initial_plan_result = invoke(
            ["plan", "--json", "--home", str(crash_home)]
        )
        self.assertEqual(initial_plan_result.returncode, 0, initial_plan_result.stderr)
        initial_hash = json.loads(initial_plan_result.stdout)["data"]["plan_hash"]
        initial_apply = invoke(
            [
                "apply",
                "--json",
                "--plan-hash",
                initial_hash,
                "--home",
                str(crash_home),
            ]
        )
        self.assertEqual(initial_apply.returncode, 0, initial_apply.stderr)

        destination = crash_home / "plugins" / INSTALLER.PLUGIN_NAME
        marketplace = crash_home / ".agents" / "plugins" / "marketplace.json"
        original_plugin = (destination / "lib" / "core.mjs").read_bytes()
        (crash_repo / "lib" / "core.mjs").write_text(
            'export const version = "two";\n', encoding="utf-8"
        )
        update_plan_result = invoke(
            ["plan", "--json", "--home", str(crash_home)]
        )
        self.assertEqual(update_plan_result.returncode, 0, update_plan_result.stderr)
        update_hash = json.loads(update_plan_result.stdout)["data"]["plan_hash"]
        crashed = invoke(
            [
                "apply",
                "--json",
                "--plan-hash",
                update_hash,
                "--home",
                str(crash_home),
            ],
            crash_phase="plugin_replaced",
        )
        self.assertEqual(crashed.returncode, 86)

        unmanaged = destination / "unmanaged-after-crash.txt"
        unmanaged.write_text("preserve me\n", encoding="utf-8")
        interrupted_plugin_bytes = {
            str(item.relative_to(destination)): item.read_bytes()
            for item in destination.rglob("*")
            if item.is_file()
        }
        interrupted_marketplace_bytes = marketplace.read_bytes()
        refused = invoke(["plan", "--json", "--home", str(crash_home)])
        self.assertNotEqual(refused.returncode, 0)
        refused_envelope = json.loads(refused.stdout)
        self.assertEqual(refused_envelope["data"]["state"], "recovery_required")
        self.assertFalse(refused_envelope["data"]["files_changed"])
        self.assertTrue(refused_envelope["technical_details"]["recovery_required"])
        self.assertEqual(unmanaged.read_text(encoding="utf-8"), "preserve me\n")
        self.assertEqual(
            {
                str(item.relative_to(destination)): item.read_bytes()
                for item in destination.rglob("*")
                if item.is_file()
            },
            interrupted_plugin_bytes,
        )
        self.assertEqual(marketplace.read_bytes(), interrupted_marketplace_bytes)
        self.assertTrue(
            list(
                (crash_home / ".agents" / "plugins").glob(
                    f".{INSTALLER.PLUGIN_NAME}.transaction-*"
                )
            )
        )

        unmanaged.unlink()
        pending = invoke(["plan", "--json", "--home", str(crash_home)])
        self.assertNotEqual(pending.returncode, 0)
        self.assertEqual(json.loads(pending.stdout)["data"]["state"], "recovery_required")
        recovered = invoke(
            [
                "apply",
                "--json",
                "--plan-hash",
                update_hash,
                "--home",
                str(crash_home),
            ]
        )
        self.assertEqual(recovered.returncode, 0, recovered.stderr)
        recovered_envelope = json.loads(recovered.stdout)
        self.assertEqual(
            recovered_envelope["technical_details"]["recovery_actions"],
            ["restored_interrupted_update"],
        )
        self.assertEqual(
            (destination / "lib" / "core.mjs").read_text(encoding="utf-8"),
            'export const version = "two";\n',
        )
        self.assertNotEqual(
            (destination / "lib" / "core.mjs").read_bytes(), original_plugin
        )
        self.assertTrue(marketplace.is_file())
        self.assertEqual(
            list(
                (crash_home / ".agents" / "plugins").glob(
                    f".{INSTALLER.PLUGIN_NAME}.transaction-*"
                )
            ),
            [],
        )
        self.assertEqual(
            list(
                (crash_home / "plugins").glob(
                    f".{INSTALLER.PLUGIN_NAME}.backup-*"
                )
            ),
            [],
        )

    def test_help_is_bilingual_human_first_and_keeps_commands_secondary(self) -> None:
        labels = {
            "en": "Technical details (optional):",
            "it": "Dettagli tecnici (facoltativi):",
        }
        for locale, divider in labels.items():
            result = subprocess.run(
                [sys.executable, str(INSTALLER_PATH), "--help", "--locale", locale],
                cwd=str(REPO_ROOT),
                capture_output=True,
                encoding="utf-8",
                timeout=20,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            primary, technical = result.stdout.split(divider, 1)
            self.assertNotRegex(primary, PRIMARY_INTERNAL_JARGON)
            self.assertNotRegex(primary, PRIMARY_COMMAND_TEXT)
            self.assertIn("--plan-hash", technical)
            self.assertIn("SHA256", technical)
            self.assertIn("HOME", technical)
            self.assertIn("RTK", technical)
            if locale == "it":
                self.assertIn("Risultato:", primary)
                self.assertIn("Cosa devi decidere:", primary)
            else:
                self.assertIn("Outcome:", primary)
                self.assertIn("What you need to decide:", primary)

        machine = subprocess.run(
            [sys.executable, str(INSTALLER_PATH), "--help", "--locale=it", "--json"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            encoding="utf-8",
            timeout=20,
            check=False,
        )
        self.assertEqual(machine.returncode, 0, machine.stderr)
        payload = json.loads(machine.stdout)
        self.assertEqual(payload["command"], "help")
        self.assertIn("Puoi controllare", payload["human"]["outcome"])

    def test_json_envelope_and_italian_primary_text_are_human_first(self) -> None:
        json_home = self.root / "json-home"
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = INSTALLER.main(
                ["plan", "--home", str(json_home), "--json"]
            )
        lines = stdout.getvalue().splitlines()
        self.assertEqual(status, 0)
        self.assertEqual(len(lines), 1)
        envelope = json.loads(lines[0])
        self.assertEqual(envelope["schema"], INSTALLER.INSTALLER_SCHEMA)
        self.assertEqual(set(envelope["human"]), HUMAN_FIELDS)
        self.assertFalse(json_home.exists())

        check_home = self.root / "check-home"
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = INSTALLER.main(
                ["check", "--home", str(check_home), "--json"]
            )
        self.assertEqual(status, 0)
        self.assertEqual(json.loads(stdout.getvalue())["command"], "check")
        self.assertFalse(check_home.exists())

        human_home = self.root / "human-home"
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = INSTALLER.main(
                ["plan", "--home", str(human_home), "--locale", "it"]
            )
        self.assertEqual(status, 0)
        primary, divider, technical = stdout.getvalue().partition(
            "Dettagli tecnici (facoltativi):"
        )
        self.assertTrue(divider)
        for label in (
            "Risultato",
            "Cosa cambia in pratica",
            "Cosa devi decidere",
            "Cosa resta protetto",
            "Prossimo passo",
        ):
            self.assertIn(f"{label}:", primary)
        self.assertNotRegex(primary, PRIMARY_INTERNAL_JARGON)
        self.assertNotRegex(primary, PRIMARY_COMMAND_TEXT)
        self.assertIn("plan_hash", technical)
        self.assertFalse(human_home.exists())

    def test_all_primary_messages_hide_internal_jargon_and_commands(self) -> None:
        update = {"operation": "install", "rtk": {"enabled": False}}
        current = {"operation": "noop", "rtk": {"enabled": False}}

        for locale in ("en", "it"):
            messages = [
                INSTALLER._human_message(command, locale, plan)
                for command in ("check", "plan", "apply")
                for plan in (update, current)
            ]
            messages.extend(
                (
                    INSTALLER._human_message("apply", locale, error=True),
                    INSTALLER._human_message(
                        "apply", locale, error=True, rtk_partial_failure=True
                    ),
                )
            )
            for message in messages:
                self.assertEqual(set(message), HUMAN_FIELDS)
                primary = "\n".join(message.values())
                self.assertNotRegex(primary, PRIMARY_INTERNAL_JARGON)
                self.assertNotRegex(primary, PRIMARY_COMMAND_TEXT)

    def test_rendered_messages_use_exact_progressive_disclosure_labels(self) -> None:
        plan = {"operation": "install", "rtk": {"enabled": False}}
        expectations = {
            "en": (
                "Technical details (optional):",
                (
                    "Outcome",
                    "What this changes in practice",
                    "What you need to decide",
                    "What remains protected",
                    "Next step",
                ),
            ),
            "it": (
                "Dettagli tecnici (facoltativi):",
                (
                    "Risultato",
                    "Cosa cambia in pratica",
                    "Cosa devi decidere",
                    "Cosa resta protetto",
                    "Prossimo passo",
                ),
            ),
        }
        command = (
            "python3 scripts/install-personal-marketplace.py apply "
            f"--plan-hash {'a' * 64}"
        )

        for locale, (divider, labels) in expectations.items():
            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                INSTALLER._emit_result(
                    command="plan",
                    locale=locale,
                    json_output=False,
                    ok=True,
                    human=INSTALLER._human_message("plan", locale, plan),
                    technical_details={"apply_command": command},
                )
            primary, found_divider, technical = stdout.getvalue().partition(divider)
            self.assertEqual(found_divider, divider)
            for label in labels:
                self.assertIn(f"{label}:", primary)
            self.assertNotRegex(primary, PRIMARY_INTERNAL_JARGON)
            self.assertNotRegex(primary, PRIMARY_COMMAND_TEXT)
            self.assertIn(command, technical)

    def test_relative_home_and_missing_apply_hash_are_rejected(self) -> None:
        self.assertEqual(INSTALLER._parse_arguments([]).command, "plan")
        with self.assertRaisesRegex(INSTALLER.InstallError, "absolute path"):
            INSTALLER._home_directory("relative/home")
        with self.assertRaisesRegex(INSTALLER.InstallError, "requires --plan-hash"):
            INSTALLER._parse_arguments(["apply"])

        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = INSTALLER.main(["apply", "--json"])
        self.assertEqual(status, 1)
        self.assertEqual(stderr.getvalue(), "")
        self.assertEqual(len(stdout.getvalue().splitlines()), 1)
        self.assertFalse(json.loads(stdout.getvalue())["ok"])


if __name__ == "__main__":
    unittest.main()
