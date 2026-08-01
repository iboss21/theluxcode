# RegesCore // Fable 5 chat template — LM Studio + Claude Code

Template: [`config/chat_templates/regescore_fable5.jinja`](../config/chat_templates/regescore_fable5.jinja)
Tests: `tests/test_regescore_fable5_chat_template.py`

This document explains why a local model served through LM Studio works in
Claude Desktop chat and cowork but fails in code mode, which of those causes
the template fixes, and which need configuration instead.

## The reported failure

```
API Error: 500 Engine protocol predict request returned ...
{"error":{"code":400,
  "message":"Unable to generate parser for this template.
   Automatic parser generation failed:
   While executing CallExpression at line 85, column 32 in source:
   ...first %}  {{- raise_exception('System message must be at the beginnin...
   Error: Jinja Exception: System message must be at the beginning.",
  "type":"invalid_request_error"}}
```

**FACT.** This is a Jinja render failure inside LM Studio, not a network,
model, or gateway-connectivity failure. LM Studio renders the chat template
against synthetic probe conversations at load time in order to derive a
tool-call parser. One of those probes places a system message somewhere other
than position zero. The active template answers that with `raise_exception`,
the render aborts, LM Studio returns `400`, and Claude Code reports it as a
`500` or as a timeout.

**FACT.** Claude Code speaks the Anthropic Messages format to
`POST /v1/messages?beta=true` when `ANTHROPIC_BASE_URL` points at a gateway,
and inference responses must stream
([gateway protocol reference](https://code.claude.com/docs/en/llm-gateway-protocol)).

**INFERENCE.** Chat and cowork survive because they send few or no tool
definitions, so LM Studio never runs tool-call parser generation on that path.
Code mode always sends a full tool list, so it always runs it. That is why the
same model, the same gateway, and the same credentials fail in exactly one
mode.

## What the template fixes

| # | Defect in the previous template | Effect in code mode |
|---|---|---|
| 1 | `raise_exception` on a non-leading system message, on unknown roles, and on unknown content block types | Hard `400 Unable to generate parser`. **This is the reported failure.** |
| 2 | `loop.previtem` / `loop.nextitem` for tool-response grouping | Not implemented by minja, the Jinja engine in LM Studio and llama.cpp |
| 3 | Anthropic `tool_use` and `tool_result` content blocks unhandled | Assistant tool calls and their results vanish from history; the model repeats calls it already made until the turn times out |
| 4 | `thinking` and `redacted_thinking` blocks unhandled | Same, plus opaque `redacted_thinking` payloads leaked into the prompt |
| 5 | `tool_calls[].arguments` assumed to be a mapping | Gateways that hand over a JSON string crash the render |
| 6 | Consecutive text blocks concatenated with no separator | `You are Claude Code.Env: linux` — the system prompt is corrupted at every block boundary |
| 7 | Reasoning re-emitted for every historical assistant turn | Stale thinking accumulates and consumes the context window |
| 8 | Generation prompt pre-filled `<think>\n` | The model never emits the opening tag, the reasoning parser sees an unmatched close, and reasoning leaks into the answer or the answer arrives empty |
| 9 | Persona emitted *after* the host system prompt | The persona's tool protocol competes with Claude Code's; the model follows the wrong one |
| 10 | Literal prose interleaved with control tags | Output shifts with `trim_blocks` / `lstrip_blocks`, so the prompt prefix is not byte-stable and prefix caching misses on every turn |

The rewritten template never raises, for any input. `tests/test_regescore_fable5_chat_template.py`
renders it against 78 LM Studio-style probe combinations plus a full Claude
Code conversation containing thinking blocks, parallel `tool_use`, `tool_result`
with `is_error`, images, and unknown block types. All 33 tests pass.

## Install in LM Studio

1. **My Models** → the model → **Prompt Template** (or the gear icon → *Prompt*).
2. Replace the Jinja template with the contents of
   `config/chat_templates/regescore_fable5.jinja`.
3. Reload the model. If parser generation still fails, the error names the
   line — it will be a different template than this one.

LM Studio does not let you pass template keyword arguments. The knobs are
`{%- set %}` statements in the first 40 lines of the file; edit the defaults
there:

| Variable | Default | Change it when |
|---|---|---|
| `tool_call_format` | `'json'` | Serving Qwen3-Coder under vLLM with `--tool-call-parser qwen3_coder` → `'xml'` |
| `enable_thinking` | `true` | Code mode feels slow: `false` suppresses reasoning and cuts latency per tool step |
| `preserve_thinking` | `false` | Debugging a long agent run |
| `enable_persona` | `true` | Measuring the model without the RegesCore block (~2,000 tokens) |

`tool_call_format` must match the server's parser. Under vLLM or SGLang use
`--tool-call-parser hermes` for `'json'` and `--tool-call-parser qwen3_coder`
for `'xml'`, in both cases with `--enable-auto-tool-choice`. A mismatch means
the server never extracts a call, Claude Code receives prose where it expected
`tool_use`, and the agent loop spins until it times out.

## Causes the template cannot fix

These produce `400` responses regardless of the template. All are documented in
the [gateway protocol reference](https://code.claude.com/docs/en/llm-gateway-protocol#feature-pass-through);
set the variable in the environment where Claude Code runs.

| Symptom | Cause | Fix |
|---|---|---|
| `400` naming the `thinking` field or the `adaptive` tag | Claude Code sends `thinking: {"type":"adaptive"}` and treats unrecognized model names, including gateway aliases, as current models that receive the field | `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` |
| `400 Extra inputs are not permitted` naming `context_management` or `output_config` | Beta body fields the local server's schema rejects | `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` |
| `400` naming a tool schema field such as `strict` or `defer_loading` | Beta tool fields arriving without their paired beta header | `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` |
| Client stalls, then times out, with no server-side error | The gateway buffers the response instead of relaying server-sent events as they arrive | Enable streaming passthrough end to end |
| `400` naming context length, only after the conversation grows | Claude Code's system prompt plus its tool schemas run to roughly 12,000–20,000 tokens before the first user message | Raise the model's context length in LM Studio to at least 32k, ideally 128k |
| Timeouts that start partway into a session | Prompt prefix cache misses force a full re-ingest of a very large prompt every turn | Byte-stable prefix (this template) plus KV cache enabled |

Start with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` and
`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` together — they cover the majority of
the `400` class, cost nothing, and are independent of the template change.

**UNKNOWN.** Whether your LM Studio build serves `/v1/messages` natively or
sits behind a translating proxy at `127.0.0.1:2126`, and what context length
the model is loaded with. Both change which row above applies. The LM Studio
server log prints the rejected request body; that log names the offending
field directly and is the fastest way to confirm which of these you are hitting.

## Prompt layout the template produces

```
<|im_start|>system
REGESCORE // FABLE 5 ENGINEERING INTELLIGENCE     ← static, identical every session
# REASONING CHANNEL                                ← only when thinking is on
# Tools + <tools> … </tools> + TOOL CALL DISCIPLINE ← session-static
# Host application instructions (authoritative)    ← Claude Code's system prompt, last
<|im_end|>
```

Ordering is deliberate. The static persona leads so the cached prefix is shared
across every session and every client mode. The host system prompt goes last,
under an explicit authority header, and the persona's `# PRECEDENCE` section
tells the model that the host protocol wins on conflict. A persona that
outranks the harness is a persona that breaks the harness.
