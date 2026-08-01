"""Render coverage for config/chat_templates/regescore_fable5.jinja.

The template exists because LM Studio derives a tool-call parser by rendering
the chat template against synthetic probe conversations at model load time. A
template that raises on any probe fails the whole model with
``400 Unable to generate parser for this template``, which Claude Code
surfaces as a 500 or a request timeout. Claude Desktop chat and cowork never
trigger parser generation, so the failure looks mode-specific.

Every test here asserts the template renders. Raising is the bug.
"""
import json
from pathlib import Path

import pytest

jinja2 = pytest.importorskip("jinja2")

TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent
    / "config/chat_templates/regescore_fable5.jinja"
)


def _raise_exception(message):
    raise RuntimeError(message)


def _env(trim_blocks=True, lstrip_blocks=True):
    env = jinja2.Environment(
        trim_blocks=trim_blocks,
        lstrip_blocks=lstrip_blocks,
        undefined=jinja2.Undefined,
    )
    env.globals["raise_exception"] = _raise_exception
    return env


def render(messages, tools=None, **kwargs):
    template = _env().from_string(TEMPLATE_PATH.read_text(encoding="utf-8"))
    return template.render(
        messages=messages,
        tools=tools,
        add_generation_prompt=kwargs.pop("add_generation_prompt", True),
        **kwargs,
    )


# --------------------------------------------------------------------------
# The exact failure from the bug report
# --------------------------------------------------------------------------


def test_system_message_not_at_the_beginning_renders():
    """LM Studio probes with a trailing system message; the old template raised."""
    out = render(
        [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
            {"role": "system", "content": "You are a helpful assistant."},
        ]
    )
    assert "You are a helpful assistant." in out
    assert out.count("You are a helpful assistant.") == 1


def test_system_message_only():
    out = render([{"role": "system", "content": "sys only"}])
    assert "sys only" in out


def test_multiple_scattered_system_messages_merge_in_order():
    out = render(
        [
            {"role": "system", "content": "first"},
            {"role": "user", "content": "q"},
            {"role": "system", "content": "second"},
        ]
    )
    assert out.index("first") < out.index("second")


def test_empty_message_list_renders():
    out = render([])
    assert "<|im_start|>system" in out
    assert out.endswith("<|im_start|>assistant\n")


def test_no_messages_key_renders():
    template = _env().from_string(TEMPLATE_PATH.read_text(encoding="utf-8"))
    assert "<|im_start|>system" in template.render(add_generation_prompt=False)


def test_unknown_role_renders_as_user_turn():
    out = render([{"role": "moderator", "content": "policy note"}])
    assert "policy note" in out


def test_message_without_role_or_content_renders():
    out = render([{}, {"role": "user"}, {"content": "orphan"}])
    assert "orphan" in out


# --------------------------------------------------------------------------
# Anthropic Messages content blocks (what Claude Code actually sends)
# --------------------------------------------------------------------------


CLAUDE_CODE_TOOLS = [
    {
        "name": "Read",
        "description": "Read a file from the local filesystem.",
        "input_schema": {
            "type": "object",
            "properties": {"file_path": {"type": "string"}},
            "required": ["file_path"],
        },
    },
    {
        "type": "function",
        "function": {
            "name": "Bash",
            "description": "Run a shell command.",
            "parameters": {
                "type": "object",
                "properties": {"command": {"type": "string"}},
            },
        },
    },
]


CLAUDE_CODE_CONVERSATION = [
    {
        "role": "system",
        "content": [
            {"type": "text", "text": "You are Claude Code."},
            {
                "type": "text",
                "text": "Env: linux",
                "cache_control": {"type": "ephemeral"},
            },
        ],
    },
    {"role": "user", "content": [{"type": "text", "text": "read app.py"}]},
    {
        "role": "assistant",
        "content": [
            {"type": "thinking", "thinking": "I should read it.", "signature": "abc"},
            {"type": "redacted_thinking", "data": "opaque"},
            {"type": "text", "text": "Reading now."},
            {
                "type": "tool_use",
                "id": "toolu_01",
                "name": "Read",
                "input": {"file_path": "/app.py"},
            },
            {
                "type": "tool_use",
                "id": "toolu_02",
                "name": "Bash",
                "input": {"command": "ls -la"},
            },
        ],
    },
    {
        "role": "user",
        "content": [
            {
                "type": "tool_result",
                "tool_use_id": "toolu_01",
                "content": [{"type": "text", "text": "print('hi')"}],
            },
            {
                "type": "tool_result",
                "tool_use_id": "toolu_02",
                "content": "permission denied",
                "is_error": True,
            },
        ],
    },
]


def test_claude_code_payload_renders_every_part():
    out = render(CLAUDE_CODE_CONVERSATION, tools=CLAUDE_CODE_TOOLS)

    assert "You are Claude Code." in out
    assert "read app.py" in out
    assert "Reading now." in out
    assert '"name": "Read"' in out
    assert '"file_path": "/app.py"' in out
    assert '"name": "Bash"' in out
    assert "print('hi')" in out
    assert "permission denied" in out
    assert "[tool error]" in out
    # opaque reasoning must never reach the prompt
    assert "opaque" not in out


def test_parallel_tool_results_share_one_user_turn():
    out = render(CLAUDE_CODE_CONVERSATION, tools=CLAUDE_CODE_TOOLS)
    tail = out.split("<|im_end|>\n")[-2]
    assert tail.count("<tool_response>") == 2
    assert tail.startswith("<|im_start|>user")


def test_openai_style_tool_role_messages_group_into_one_turn():
    out = render(
        [
            {"role": "user", "content": "go"},
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {"name": "Read", "arguments": {"file_path": "/a"}},
                    }
                ],
            },
            {"role": "tool", "tool_call_id": "call_1", "content": "alpha"},
            {"role": "tool", "tool_call_id": "call_2", "content": "beta"},
            {"role": "user", "content": "thanks"},
        ]
    )
    assert out.count("<|im_start|>user") == 3  # go / grouped results / thanks
    grouped = out.split("<|im_start|>user")[2]
    assert grouped.count("<tool_response>") == 2


def test_tool_call_arguments_as_json_string_survive():
    """Anthropic-to-OpenAI gateways emit arguments as a JSON string."""
    out = render(
        [
            {"role": "user", "content": "go"},
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {
                        "id": "call_1",
                        "function": {
                            "name": "Bash",
                            "arguments": json.dumps({"command": "echo hi"}),
                        },
                    }
                ],
            },
        ]
    )
    assert '"command": "echo hi"' in out


def test_tool_call_arguments_as_json_string_survive_in_xml_mode():
    out = render(
        [
            {
                "role": "assistant",
                "content": "",
                "tool_calls": [
                    {"function": {"name": "Bash", "arguments": '{"command": "ls"}'}}
                ],
            }
        ],
        tool_call_format="xml",
    )
    assert "<function=Bash>" in out
    assert '"command": "ls"' in out


def test_xml_format_emits_parameter_blocks():
    out = render(
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
        tool_call_format="xml",
    )
    assert "<function=Read>" in out
    assert "<parameter=file_path>\n/a\n</parameter>" in out
    assert "<parameter=limit>\n20\n</parameter>" in out
    assert "</function>\n</tool_call>" in out


def test_image_blocks_become_vision_tokens():
    out = render(
        [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "what is this"},
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/png"},
                    },
                ],
            }
        ]
    )
    assert "<|vision_start|><|image_pad|><|vision_end|>" in out


def test_unknown_content_block_types_are_skipped_not_raised():
    out = render(
        [
            {
                "role": "user",
                "content": [
                    {"type": "document", "source": {"data": "..."}},
                    {"type": "server_tool_use", "id": "x", "name": "web_search"},
                    {"type": "text", "text": "still here"},
                ],
            }
        ]
    )
    assert "still here" in out


# --------------------------------------------------------------------------
# Prompt structure guarantees
# --------------------------------------------------------------------------


def test_multiple_text_blocks_in_one_message_stay_separated():
    """Claude Code splits system and user turns across several text blocks."""
    out = render(CLAUDE_CODE_CONVERSATION, tools=CLAUDE_CODE_TOOLS)
    assert "You are Claude Code.\nEnv: linux" in out
    assert "You are Claude Code.Env" not in out


def test_host_system_prompt_is_emitted_after_the_persona():
    out = render(CLAUDE_CODE_CONVERSATION, tools=CLAUDE_CODE_TOOLS)
    assert out.index("REGESCORE // FABLE 5") < out.index("You are Claude Code.")
    assert "# Host application instructions (authoritative)" in out


def test_fable5_operating_principles_are_present():
    out = render([{"role": "user", "content": "hi"}])
    for marker in (
        "# AGENTIC OPERATING PRINCIPLES",
        "Lead with the outcome.",
        "Progress integrity.",
        "Completion check.",
        "# EFFORT CALIBRATION",
        "# PRIMARY LAW: TRUTH",
    ):
        assert marker in out


def test_persona_can_be_disabled():
    out = render([{"role": "user", "content": "hi"}], enable_persona=False)
    assert "REGESCORE // FABLE 5" not in out


def test_persona_can_be_replaced():
    out = render(
        [{"role": "user", "content": "hi"}], regescore_identity="CUSTOM IDENTITY"
    )
    assert "CUSTOM IDENTITY" in out
    assert "REGESCORE // FABLE 5" not in out


def test_generation_prompt_does_not_prefill_the_think_tag():
    out = render([{"role": "user", "content": "hi"}])
    assert out.endswith("<|im_start|>assistant\n")


def test_thinking_disabled_emits_closed_block():
    out = render([{"role": "user", "content": "hi"}], enable_thinking=False)
    assert out.endswith("<|im_start|>assistant\n<think>\n\n</think>\n\n")


def test_stale_reasoning_is_dropped_but_live_segment_is_kept():
    messages = [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "<think>old plan</think>answer one"},
        {"role": "user", "content": "second"},
        {"role": "assistant", "content": "<think>live plan</think>answer two"},
    ]
    out = render(messages)
    assert "old plan" not in out
    assert "live plan" in out
    assert "answer one" in out


def test_preserve_thinking_keeps_all_reasoning():
    messages = [
        {"role": "user", "content": "first"},
        {"role": "assistant", "content": "<think>old plan</think>answer one"},
        {"role": "user", "content": "second"},
    ]
    out = render(messages, preserve_thinking=True)
    assert "old plan" in out


def test_reasoning_content_field_is_honoured():
    out = render(
        [
            {"role": "user", "content": "q"},
            {
                "role": "assistant",
                "content": "answer",
                "reasoning_content": "field reasoning",
            },
        ],
        preserve_thinking=True,
    )
    assert "<think>\nfield reasoning\n</think>" in out


def test_tool_schemas_are_unwrapped_consistently():
    out = render([{"role": "user", "content": "hi"}], tools=CLAUDE_CODE_TOOLS)
    assert '"name": "Read"' in out
    assert '"name": "Bash"' in out
    assert '"type": "function"' not in out.split("</tools>")[0]


def test_tool_discipline_only_appears_with_tools():
    with_tools = render([{"role": "user", "content": "hi"}], tools=CLAUDE_CODE_TOOLS)
    without = render([{"role": "user", "content": "hi"}])
    assert "# TOOL CALL DISCIPLINE" in with_tools
    assert "# TOOL CALL DISCIPLINE" not in without


# --------------------------------------------------------------------------
# Byte-stable output: prompt-prefix caching depends on it
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "messages,tools",
    [
        (CLAUDE_CODE_CONVERSATION, CLAUDE_CODE_TOOLS),
        ([{"role": "user", "content": "hi"}], None),
        ([], None),
    ],
)
def test_output_is_identical_under_every_whitespace_policy(messages, tools):
    source = TEMPLATE_PATH.read_text(encoding="utf-8")
    renders = set()
    for trim in (True, False):
        for lstrip in (True, False):
            template = _env(trim_blocks=trim, lstrip_blocks=lstrip).from_string(source)
            renders.add(
                template.render(
                    messages=messages, tools=tools, add_generation_prompt=True
                )
            )
    assert len(renders) == 1


def test_no_stray_blank_lines_between_turns():
    out = render(
        [
            {"role": "user", "content": "a"},
            {"role": "assistant", "content": "b"},
            {"role": "user", "content": "c"},
        ]
    )
    assert "<|im_end|>\n<|im_start|>user\na<|im_end|>\n" in out
    assert "\n\n<|im_start|>" not in out


def test_template_never_calls_raise_exception():
    """The prose header mentions it; no call site may exist."""
    assert "raise_exception(" not in TEMPLATE_PATH.read_text(encoding="utf-8")


def test_lmstudio_probe_matrix_never_raises():
    """Every shape LM Studio's parser generation is known to probe with."""
    probes = [
        [],
        [{"role": "user", "content": "hi"}],
        [{"role": "system", "content": "s"}],
        [{"role": "user", "content": "hi"}, {"role": "system", "content": "s"}],
        [{"role": "assistant", "content": "a"}, {"role": "assistant", "content": "b"}],
        [{"role": "user", "content": "a"}, {"role": "user", "content": "b"}],
        [{"role": "tool", "content": "orphan result"}],
        [{"role": "assistant", "content": None}],
        [{"role": "user", "content": []}],
        [{"role": "user", "content": [{"type": "text", "text": None}]}],
        [{"role": "assistant", "content": "x", "tool_calls": []}],
        [{"role": "assistant", "tool_calls": [{"function": {"name": "f"}}]}],
        [{"role": "assistant", "tool_calls": [{"name": "f", "input": {"a": 1}}]}],
    ]
    for probe in probes:
        for fmt in ("json", "xml"):
            for tools in (None, [], CLAUDE_CODE_TOOLS):
                render(probe, tools=tools, tool_call_format=fmt)
