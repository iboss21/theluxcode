#!/usr/bin/env python3
"""Generate the RegesCore doctrine TypeScript constants from the chat template.

The chat template at config/chat_templates/regescore_fable5.jinja holds the
canonical RegesCore // Fable 5 doctrine inside its ``rc_identity`` variable.
The LM Studio plugins need the same text as a TypeScript constant. Rather than
maintaining three copies, this script extracts the canonical text and writes
``src/doctrine.generated.ts`` into each plugin.

Run with --check in CI to fail when a generated file has drifted.

    python3 scripts/sync_regescore_doctrine.py
    python3 scripts/sync_regescore_doctrine.py --check
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = REPO_ROOT / "config/chat_templates/regescore_fable5.jinja"
TARGETS = [
    REPO_ROOT / "lmstudio-plugins/regescore/src/doctrine.generated.ts",
    REPO_ROOT / "lmstudio-plugins/regescore-gateway/src/doctrine.generated.ts",
]
PRESETS_DIR = REPO_ROOT / "lmstudio-plugins/presets"

PRESET_HEADER = (
    "<!-- GENERATED FILE - DO NOT EDIT.\n"
    "     Source: config/chat_templates/regescore_fable5.jinja (rc_identity)\n"
    "     Regenerate: python3 scripts/sync_regescore_doctrine.py\n"
    "\n"
    "     Paste the text below the rule into the System Prompt field of an\n"
    "     LM Studio preset. RegesCore // Fable 5 - davidio.dev\n"
    "-->\n\n"
)

# Sections kept in the lean variant, in canonical order. The lean variant exists
# for small context windows where the full doctrine would crowd out the work.
LEAN_SECTIONS = (
    "IDENTITY",
    "PRECEDENCE",
    "PRIMARY LAW: TRUTH",
    "EFFORT CALIBRATION",
    "AGENTIC OPERATING PRINCIPLES",
    "COMMUNICATION",
    "FINAL STANDARD",
)

_IDENTITY_RE = re.compile(
    r"\{%-\s*set\s+rc_identity\s*=\s*\"(?P<body>.*?)\"\s*%\}", re.DOTALL
)


def extract_doctrine(template_text: str) -> str:
    match = _IDENTITY_RE.search(template_text)
    if match is None:
        raise SystemExit(
            f"could not find the rc_identity block in {TEMPLATE}; "
            "the template format changed"
        )
    return match.group("body").replace('\\"', '"').strip()


def split_sections(doctrine: str) -> list[tuple[str, str]]:
    """Return [(heading, body_including_heading)] plus a leading preamble."""
    parts: list[tuple[str, str]] = []
    current_name = ""
    current: list[str] = []
    for line in doctrine.splitlines():
        if line.startswith("# "):
            if current:
                parts.append((current_name, "\n".join(current).strip()))
            current_name = line[2:].strip()
            current = [line]
        else:
            current.append(line)
    if current:
        parts.append((current_name, "\n".join(current).strip()))
    return parts


def build_lean(doctrine: str) -> str:
    sections = split_sections(doctrine)
    preamble = sections[0][1] if sections and sections[0][0] == "" else ""
    keep = [preamble] if preamble else []
    by_name = {name: body for name, body in sections}
    missing = [name for name in LEAN_SECTIONS if name not in by_name]
    if missing:
        raise SystemExit(
            "lean variant expects these sections in the doctrine: "
            + ", ".join(missing)
        )
    keep.extend(by_name[name] for name in LEAN_SECTIONS)
    return "\n\n".join(keep)


def ts_literal(value: str) -> str:
    escaped = (
        value.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    )
    return f"`{escaped}`"


def render_module(full: str, lean: str) -> str:
    return (
        "// GENERATED FILE - DO NOT EDIT.\n"
        "// Source: config/chat_templates/regescore_fable5.jinja (rc_identity)\n"
        "// Regenerate: python3 scripts/sync_regescore_doctrine.py\n"
        "//\n"
        "// RegesCore // Fable 5 doctrine. Brand and engineering by davidio.dev.\n"
        "\n"
        "/** The complete RegesCore // Fable 5 doctrine. */\n"
        f"export const REGESCORE_DOCTRINE_FULL = {ts_literal(full)};\n"
        "\n"
        "/** Condensed doctrine for small context windows. */\n"
        f"export const REGESCORE_DOCTRINE_LEAN = {ts_literal(lean)};\n"
        "\n"
        "export type DoctrineMode = \"full\" | \"lean\" | \"off\";\n"
        "\n"
        "export function getDoctrine(mode: DoctrineMode): string | null {\n"
        "  switch (mode) {\n"
        "    case \"full\":\n"
        "      return REGESCORE_DOCTRINE_FULL;\n"
        "    case \"lean\":\n"
        "      return REGESCORE_DOCTRINE_LEAN;\n"
        "    default:\n"
        "      return null;\n"
        "  }\n"
        "}\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit non-zero if any generated file is out of date",
    )
    args = parser.parse_args()

    doctrine = extract_doctrine(TEMPLATE.read_text(encoding="utf-8"))
    lean = build_lean(doctrine)
    module = render_module(doctrine, lean)

    wanted: dict[Path, str] = {target: module for target in TARGETS}
    wanted[PRESETS_DIR / "regescore-fable5.system.md"] = PRESET_HEADER + doctrine + "\n"
    wanted[PRESETS_DIR / "regescore-lean.system.md"] = PRESET_HEADER + lean + "\n"

    stale = []
    for target, content in wanted.items():
        current = target.read_text(encoding="utf-8") if target.exists() else None
        if current == content:
            continue
        if args.check:
            stale.append(target)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        print(f"wrote {target.relative_to(REPO_ROOT)}")

    if stale:
        for target in stale:
            print(
                f"out of date: {target.relative_to(REPO_ROOT)}", file=sys.stderr
            )
        print(
            "run: python3 scripts/sync_regescore_doctrine.py", file=sys.stderr
        )
        return 1
    if args.check:
        print("doctrine files are in sync")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
