# RegesCore // Fable 5 — handoff and checkpoint

Branch `claude/chat-template-fable5-x4udjd`, pull request #1.
Brand and engineering by [davidio.dev](https://davidio.dev) — Like A King Inc.

The original problem: models served from the llm-gateway work in Claude Desktop
**Chat** and **Cowork**, but Claude **Code** returns a timeout or a `400`. That
turned out to be not one bug but a stack of six, each hidden behind the one in
front of it. Five are fixed. One is untested. One is a client-side cap that was
never a bug at all.

---

## Status

| # | Symptom | Cause | State |
|---|---|---|---|
| 1 | `500` / `400 Unable to generate parser for this template` | The template called `raise_exception` when LM Studio probed it with a non-leading system message | **Fixed** — `config/chat_templates/regescore_fable5.jinja` never raises |
| 2 | Plugin absent from the Integrations panel | Copying into `~/.lmstudio/extensions/plugins/` does nothing; LM Studio does not scan | **Fixed** — installers call `lms dev --install --yes` |
| 3 | `ReferenceError: require is not defined in ES module scope` | esbuild emits CJS; `"type": "module"` made Node parse it as ESM | **Fixed** — field removed from both `package.json` files |
| 4 | Model reports it cannot see an attached image | The template emitted `<\|vision_start\|>…` as literal text, so `mtmd` saw zero markers | **Fixed** — emits `<__media__>`, one per image |
| 5 | Phantom `qwen/qwen2.5-coder-14b` requests | A stale model id left in config, replayed by a capability probe | **Fixed** — `scripts/windows/Remove-ClaudeGhostModel.ps1` |
| 6 | `400 Failed to initialize samplers: failed to parse grammar` on every request carrying tools | A tool schema bound exceeds llama.cpp's grammar repetition limit | **Fixed** — `scripts/regescore_schema_shim.py` |
| 7 | Images still not read **through Claude Code**, though LM Studio's own chat reads them | Not yet isolated. The mmproj and engine are proven good, so the loss is in the `/v1/messages` path or the client | **OPEN — untested** |
| 8 | `/context` shows 100k regardless of model | Not a bug. A configured cap, see below | **Explained** — `scripts/windows/Get-ClaudeContextWindow.ps1` |

`HEAD /api/hello` in the logs is harmless: LM Studio logs `[ERROR]` for any
unrouted path.

---

## The two findings worth keeping

### Grammar compilation, not the template

LM Studio compiles the tool JSON schemas into a GBNF grammar for constrained
decoding. llama.cpp turns a bounded string into a counted repetition
(`common/json-schema-to-grammar.cpp:971`), so Claude Code's `Workflow.script`
with `"maxLength": 524288` produces:

```
tool-Workflow-schema-script ::= "\"" char{0,524288} "\""
```

and the grammar parser rejects it (`src/llama-grammar.cpp:13` and `:652`,
`MAX_REPETITION_THRESHOLD` is 2000). One tool fails the whole grammar.

Sampler init runs **after** templating. The decisive proof is in the user's own
log: the single request Claude Code sends with `"tools": []` — session-title
generation — processed its prompt and streamed 121 tokens to completion, while
every request after it died at grammar parse.

`scripts/regescore_schema_shim.py` removes the uncompilable bounds and forwards
everything else byte for byte. It removes rather than clamps: clamping to 2000
would let the grammar compile and then truncate a 512 KiB script, trading a loud
`400` for a silently corrupted tool call.

### Where the 100k window comes from

Read out of the Claude Code 2.1.220 binary. The raw window (`Xv` / `mZc`):

1. `DISABLE_COMPACT` **and** `CLAUDE_CODE_MAX_CONTEXT_TOKENS > 0` → that value,
   verbatim and unclamped. The only route above 200000.
2. a model id ending in `[1m]` → 1000000
3. `CLAUDE_CODE_MAX_CONTEXT_TOKENS > 0`, **but only when the model id does not
   start with `claude-`**. A gateway model named `claude-fable-5.0-rg35bmoe` is
   silently excluded from this branch.
4. otherwise → **200000**

Then the auto-compact cap, `min(raw, cap)` (`o7`):

1. env `CLAUDE_CODE_AUTO_COMPACT_WINDOW` — **floored at 100000**, ceilinged at
   1000000
2. `settings.json` `autoCompactWindow` — no floor
3. first-party server data and experiments — unreachable through a custom base URL
4. `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-opus-4-8`, `claude-opus-5` → 200000
5. otherwise → uncapped

That floor is why a too-small value lands on exactly 100k on every model. Max
output tokens is separate: an unrecognised model defaults to 32000 with a hard
ceiling of 128000.

`CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` exists as a name but its gate is
compiled to `return !1` — do not chase it.

---

## What ships

```
config/chat_templates/regescore_fable5.jinja   the template
docs/lmstudio-claude-code-chat-template.md     the diagnosis, with llama.cpp call sites
lmstudio-plugins/regescore/                    prompt preprocessor, directives, presets
lmstudio-plugins/regescore-gateway/            generator plugin proxying to OpenAI or Anthropic
scripts/regescore_schema_shim.py               the grammar fix
scripts/rebrand_regescore_gguf.py              GGUF metadata → RegesCore v1.0
scripts/sync_regescore_doctrine.py             keeps plugin doctrine in step with the template
scripts/verify_template_minja.sh               renders fixtures through LM Studio's own engine
scripts/windows/Get-ClaudeContextWindow.ps1    finds every context window cap
scripts/windows/Remove-ClaudeGhostModel.ps1    hunts stale model ids
scripts/windows/Test-RegesCoreVision.ps1       isolates where image support breaks
```

### Verification

```
python3 -m pytest tests/test_regescore_fable5_chat_template.py \
                  tests/test_regescore_schema_shim.py -q --noconftest   # 53 passed
./scripts/verify_template_minja.sh                                      # 13 fixtures, 0 errors
```

The minja run reports two fixtures differing only in JSON key order — Jinja2's
`tojson` sorts keys, minja preserves insertion order. Same characters, same
length. Byte-stability *within* one engine holds, which is what prompt-prefix
caching needs.

---

## Next, in order

1. **Run the vision isolation test.** One command, and it settles #7:

   ```powershell
   .\scripts\windows\Test-RegesCoreVision.ps1 -Model 'claude-fable-5.0-rg35bmoe' -Both
   ```

   It posts an embedded red square straight to `/messages`, bypassing the
   client. If the answer says "red", the server and model are fine and the loss
   is in Claude Code. If not, `-Both` shows whether `/chat/completions` disagrees,
   which would put the fault in the Anthropic-compatible endpoint rather than the
   model.

2. **Find the 100k cap.**

   ```powershell
   .\scripts\windows\Get-ClaudeContextWindow.ps1 -ModelId 'claude-fable-5.0-rg35bmoe' -ServerUrl http://127.0.0.1:2126
   ```

   Report only. It names the file or variable holding the cap, and cross-checks
   against the length LM Studio actually loaded the model with — a client window
   larger than that produces overflow, not room.

3. **Put the shim in front of LM Studio** if tool-bearing requests still `400`.

Not done, previously offered, never requested: a `--dump-chat-template` flag on
`rebrand_regescore_gguf.py` to read the GGUF's embedded `tokenizer.chat_template`
and confirm which tool-call grammar the model was trained on.

---

RegesCore // Fable 5 — [davidio.dev](https://davidio.dev) ·
[github.com/iboss21](https://github.com/iboss21) ·
[likeakinginc.com](https://likeakinginc.com) ·
[lxrcore.com](https://lxrcore.com) ·
[wolves.land](https://wolves.land)
