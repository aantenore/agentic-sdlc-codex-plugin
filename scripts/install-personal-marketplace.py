#!/usr/bin/env python3
"""Install Agentic SDLC in the default personal Codex marketplace."""

from __future__ import annotations

import json
import sys
from pathlib import Path


PLUGIN_NAME = "agentic-sdlc-codex-plugin"
DEFAULT_MARKETPLACE_NAME = "personal"


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    manifest = repo_root / ".codex-plugin" / "plugin.json"
    if not manifest.is_file():
        print(f"Missing plugin manifest: {manifest}", file=sys.stderr)
        return 1

    home = Path.home()
    marketplace_path = home / ".agents" / "plugins" / "marketplace.json"
    personal_plugin_path = home / "plugins" / PLUGIN_NAME

    if not personal_plugin_path.exists():
        print(
            f"Expected plugin source at {personal_plugin_path}. "
            "Clone the repo there or create a symlink from your checkout first.",
            file=sys.stderr,
        )
        return 1

    if personal_plugin_path.resolve() != repo_root:
        print(
            f"{personal_plugin_path} resolves to {personal_plugin_path.resolve()}, "
            f"but this installer is running from {repo_root}.",
            file=sys.stderr,
        )
        return 1

    marketplace_path.parent.mkdir(parents=True, exist_ok=True)
    if marketplace_path.exists():
        payload = json.loads(marketplace_path.read_text(encoding="utf-8"))
    else:
        payload = {
            "name": DEFAULT_MARKETPLACE_NAME,
            "interface": {"displayName": "Personal"},
            "plugins": [],
        }

    if not isinstance(payload, dict):
        print(f"{marketplace_path} must contain a JSON object.", file=sys.stderr)
        return 1

    payload.setdefault("name", DEFAULT_MARKETPLACE_NAME)
    payload.setdefault("interface", {"displayName": "Personal"})
    plugins = payload.setdefault("plugins", [])
    if not isinstance(plugins, list):
        print(f"{marketplace_path} field 'plugins' must be an array.", file=sys.stderr)
        return 1

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

    for index, item in enumerate(plugins):
        if isinstance(item, dict) and item.get("name") == PLUGIN_NAME:
            plugins[index] = entry
            break
    else:
        plugins.append(entry)

    marketplace_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Updated {marketplace_path}")
    print(f"Run: codex plugin add {PLUGIN_NAME}@{payload.get('name', DEFAULT_MARKETPLACE_NAME)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
