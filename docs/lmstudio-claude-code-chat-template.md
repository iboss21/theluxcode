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
| `400 Failed to initialize samplers: failed to parse grammar` on every request that carries tools | A tool schema bound exceeds llama.cpp's grammar repetition limit — see the next section | `scripts/regescore_schema_shim.py`, or drop the offending tool |

Start with `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` and
`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` together — they cover the majority of
the `400` class, cost nothing, and are independent of the template change.

**UNKNOWN.** Whether your LM Studio build serves `/v1/messages` natively or
sits behind a translating proxy at `127.0.0.1:2126`, and what context length
the model is loaded with. Both change which row above applies. The LM Studio
server log prints the rejected request body; that log names the offending
field directly and is the fastest way to confirm which of these you are hitting.

## `failed to parse grammar`: the tool schemas, not the template

**FACT.** This is the failure that survives a correct template, and it is the
one that makes Code mode look broken while Chat and Cowork work.

```
parse: error parsing grammar: number of repetitions exceeds sane defaults, please reduce the number of repetitions
E failed to parse grammar
E srv send_error: task id = 1024, error: Failed to initialize samplers: failed to parse grammar
[ERROR] Anthropic streaming error: Engine protocol predict request returned 400
```

Sampler initialisation happens **after** the prompt is templated. A template
error cannot reach this point, and the log proves it: in the same session, the
one request Claude Code sends with `"tools": []` — the session-title
generation — processes its prompt and streams 121 tokens to completion. Every
request after it carries the tool array and dies here.

### Why

LM Studio compiles the tool JSON schemas into a GBNF grammar so the model can
only emit a well-formed tool call. llama.cpp turns a bounded string into a
counted repetition — `common/json-schema-to-grammar.cpp:971`:

```cpp
if (schema_type == "string" && (schema.contains("minLength") || schema.contains("maxLength"))) {
    int max_len = schema.contains("maxLength") ? schema["maxLength"].get<int>() : INT_MAX;
    return _add_rule(rule_name, "\"\\\"\" " + build_repetition(char_rule, min_len, max_len) + " \"\\\"\"");
}
```

Claude Code's `Workflow.script` is declared `"maxLength": 524288`, so the
generated rule is:

```
tool-Workflow-schema-script ::= "\"" char{0,524288} "\""
```

and the grammar parser refuses it — `src/llama-grammar.cpp:13` and `:652`:

```cpp
#define MAX_REPETITION_THRESHOLD 2000
...
if (min_times > MAX_REPETITION_THRESHOLD || (has_max && max_times > MAX_REPETITION_THRESHOLD)) {
    throw std::runtime_error("number of repetitions exceeds sane defaults, please reduce the number of repetitions");
}
```

524288 > 2000. One tool fails the whole grammar, the sampler never initialises,
and the request returns `400`. The same limit applies to `minLength`,
`maxItems` and `minItems`.

A second, non-fatal contributor sits alongside it: `Read.limit`, `Read.offset`
and `ReportFindings.findings[].line` carry JS-safe-integer bounds of
±9007199254740991. Those expand through `build_min_max_int` into hundreds of
digit-range alternations. They compile, but they inflate the grammar for a
bound that excludes nothing.

### Fix

`scripts/regescore_schema_shim.py` sits between Claude Code and LM Studio and
removes the bounds llama.cpp cannot compile, forwarding everything else
unchanged.

```
# see which tools break, from a saved request body
python3 scripts/regescore_schema_shim.py --inspect captured-request.json

# run it
python3 scripts/regescore_schema_shim.py --listen 2127 --upstream http://127.0.0.1:2126
setx ANTHROPIC_BASE_URL http://127.0.0.1:2127
```

It **removes** the keyword rather than clamping it. Clamping `maxLength` to
2000 would let the grammar compile and then truncate a 512 KiB script at 2000
characters — a loud `400` traded for a silently corrupted tool call. Removing
it makes the rule unbounded (`char*`), which is what the tool wants: the bound
was advisory metadata, never a decoding constraint.

Streaming is relayed line by line, so tokens still arrive live.

The alternative, if you would rather not run a proxy, is to drop the tool:
`claude --disallowedTools Workflow`. That removes the oversized rule at the
source but costs you the tool, and any future Claude Code tool with a large
`maxLength` reintroduces the failure.

**Also in that log.** `Reasoning setting 'high' is not supported by model ...
Supported settings: 'on', 'off'. Falling back to 'on'` comes from Claude Code's
`output_config: {effort: "high"}`. It is a warning, not the failure, and
`CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` silences it.

## Images: why the model says it cannot see your screenshot

**FACT.** llama.cpp attaches images through `mtmd`, and `mtmd` requires the
literal marker `<__media__>` in the rendered prompt. `mtmd.cpp` splits the
prompt on that marker and substitutes the image embedding chunk, adding
`<|vision_start|>` and `<|vision_end|>` around it *itself*. The header states it
directly: *"the prompt must have the input image marker (default: `<__media__>`)
in it ... the marker will be replaced with the image/audio chunk"*, and *"number
of bitmaps must be equal to the number of markers in the prompt"*.

A template that emits `<|vision_start|><|image_pad|><|vision_end|>` as literal
text therefore produces **zero** markers. The image is never spliced in, the
model receives only the text, and it answers that no screenshot was attached —
exactly what the Claude Code session showed.

The template now emits `<__media__>`, one per image, including images inside a
`tool_result`. Set `vision_marker_style` to `'qwen'` only for vLLM or
transformers, which take the opposite convention.

**INFERENCE.** Your `mmproj-BF16.gguf` is almost certainly fine. The projector
only runs once the marker splices an image into the prompt; with no marker it
was never reached. Load the mmproj alongside the model in LM Studio, confirm the
model shows a vision badge, then re-test with the corrected template. If a
mismatch remains, prefer `mmproj-F16.gguf`: BF16 has patchier CPU-side support
in llama.cpp than F16 does.

## The empty response: `"content": []` with 4,096 tokens generated

Your log shows a completed generation with no content:

```
"content": [], "stop_reason": "end_turn", "usage": {}
... release: id 0 | task 2 | stop processing: n_tokens = 4096, truncated = 0
```

**INFERENCE.** The model produced 4,096 tokens and none of them survived into
the response. That is the signature of reasoning-channel mis-tagging rather than
a model that stayed silent: everything went into reasoning and was stripped. The
pre-filled `<think>` tag (row 8 above) causes exactly this — the model never
emits an opening tag, so the parser cannot pair it with the closing one. The
corrected generation prompt should resolve it. If it persists, the tokens are
being spent inside an unterminated reasoning block, which points at sampling
settings or a context window too small for the prompt.

## The request you did not make

```
POST /v1/messages  {"model": "qwen/qwen2.5-coder-14b", "max_tokens": 1,
                    "messages": [{"role":"user","content":"count"}],
                    "tools": [...], "metadata": {"user_id": "..."}}
```

**INFERENCE.** `max_tokens: 1` with a single throwaway message and one tool is a
capability probe, not real inference — Claude Code checking whether the endpoint
accepts tool definitions. It is harmless. The `metadata.user_id` carrying a
device and session ID confirms it comes from Claude Code, not from LM Studio.

The stale model name comes from configuration, not from nowhere. Claude Code
resolves model IDs from environment variables and settings files, and a
background or small-model slot keeps its own ID separate from the one in the
model picker. Check, in this order:

```bash
grep -rn "qwen2.5-coder" ~/.claude/settings.json ~/.claude.json \
     ~/.claude/settings.local.json .claude/settings.json 2>/dev/null
env | grep -i ANTHROPIC_
```

The variables that hold a model ID are `ANTHROPIC_MODEL`,
`ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`,
`ANTHROPIC_DEFAULT_HAIKU_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL`. A leftover
value in any of them, in a shell profile or a project-level
`.claude/settings.json`, produces requests naming a model you no longer have.

**UNKNOWN.** Which of those holds the value on your machine. The two commands
above answer it directly.

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
