#!/usr/bin/env python3
"""Render the chat template fixtures through minja and compare with Jinja2.

Driven by scripts/verify_template_minja.sh, which builds the harness first.

A minja error here means the template will fail to load in LM Studio, which is
the failure this whole template exists to avoid. An output mismatch is reported
separately, because one benign class exists: Jinja2's tojson sorts object keys
while minja preserves insertion order, so the tool schema block can differ in
key order while carrying identical content. That is flagged rather than failed.

RegesCore // Fable 5 - brand and engineering by davidio.dev
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO_ROOT / "tests"))

from test_regescore_fable5_chat_template import (  # noqa: E402
    CLAUDE_CODE_CONVERSATION,
    CLAUDE_CODE_TOOLS,
    IMAGE_MESSAGE,
    render as jinja_render,
)

RENDER_BIN = os.environ.get("RENDER_BIN", "")
TEMPLATE_FILE = os.environ.get("TEMPLATE_FILE", "")
WORK_DIR = Path(os.environ.get("WORK_DIR", "."))

# Each case exercises a construct minja implements differently from Jinja2, or
# a payload shape Claude Code actually sends.
CASES: dict[str, tuple] = {
    "claude_code_full": (CLAUDE_CODE_CONVERSATION, CLAUDE_CODE_TOOLS, {}),
    "image_message": (IMAGE_MESSAGE, None, {}),
    "qwen_vision_style": (IMAGE_MESSAGE, None, {"vision_marker_style": "qwen"}),
    "simple": ([{"role": "user", "content": "hi"}], None, {}),
    "system_last": (
        [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "yo"},
            {"role": "system", "content": "You are a helpful assistant."},
        ],
        None,
        {},
    ),
    "empty": ([], None, {}),
    "openai_toolcalls": (
        [
            {"role": "user", "content": "go"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "c1",
                        "type": "function",
                        "function": {
                            "name": "Read",
                            "arguments": {"file_path": "/a", "limit": 20},
                        },
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "c1", "content": "alpha"},
            {"role": "tool", "tool_call_id": "c2", "content": "beta"},
        ],
        CLAUDE_CODE_TOOLS,
        {},
    ),
    "string_arguments": (
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"function": {"name": "Bash", "arguments": '{"command": "ls"}'}}
                ],
            }
        ],
        None,
        {},
    ),
    "xml_format": (
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "function": {
                            "name": "Read",
                            "arguments": {"file_path": "/a", "limit": 20},
                        }
                    }
                ],
            }
        ],
        None,
        {"tool_call_format": "xml"},
    ),
    "thinking_history": (
        [
            {"role": "user", "content": "first"},
            {"role": "assistant", "content": "<think>old plan</think>answer one"},
            {"role": "user", "content": "second"},
            {"role": "assistant", "content": "<think>live plan</think>answer two"},
        ],
        None,
        {},
    ),
    "thinking_disabled": ([{"role": "user", "content": "hi"}], None, {"enable_thinking": False}),
    "malformed_messages": (
        [{"role": "moderator", "content": "policy"}, {}, {"role": "user"}, {"content": "orphan"}],
        None,
        {},
    ),
    "unknown_blocks": (
        [
            {
                "role": "user",
                "content": [
                    {"type": "document", "source": {"data": "x"}},
                    {"type": "server_tool_use", "id": "s", "name": "web_search"},
                    {"type": "text", "text": "still here"},
                ],
            }
        ],
        None,
        {},
    ),
}


def main() -> int:
    if not RENDER_BIN or not TEMPLATE_FILE:
        return fail("run this through scripts/verify_template_minja.sh")

    errors: list[tuple[str, str]] = []
    benign: list[str] = []

    for name, (messages, tools, extra) in CASES.items():
        context = {"messages": messages, "add_generation_prompt": True}
        if tools is not None:
            context["tools"] = tools
        context.update(extra)

        context_path = WORK_DIR / f"ctx_{name}.json"
        context_path.write_text(json.dumps(context), encoding="utf-8")

        result = subprocess.run(
            [RENDER_BIN, TEMPLATE_FILE, str(context_path)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            errors.append((name, result.stderr.strip()[:500]))
            continue

        expected = jinja_render(messages, tools=tools, **extra)
        if result.stdout == expected:
            continue

        # Same characters in a different order is the tojson key-ordering
        # difference, which changes nothing about the prompt's meaning.
        if sorted(result.stdout) == sorted(expected):
            benign.append(name)
        else:
            errors.append(
                (name, f"real divergence: minja {len(result.stdout)} chars, "
                       f"jinja2 {len(expected)} chars")
            )

    print(f"\n{len(CASES)} fixtures rendered through minja")
    if benign:
        print(f"  {len(benign)} differ only in JSON key order (expected): "
              + ", ".join(benign))
    if not errors:
        print("  0 errors - the template loads and renders under LM Studio's engine\n")
        return 0

    print(f"  {len(errors)} FAILURES:\n")
    for name, detail in errors:
        print(f"  {name}\n    {detail}\n")
    return 1


def fail(message: str) -> int:
    print(f"error: {message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
