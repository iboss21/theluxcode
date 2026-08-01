# RegesCore for LM Studio

**RegesCore // Fable 5** — engineering doctrine, chat template, and LLM gateway
support for LM Studio and Claude Code.

Brand and engineering by **[davidio.dev](https://davidio.dev)**
· [GitHub](https://github.com/iboss21) · [Like A King Inc.](https://likeakinginc.com)
· [LXRCore](https://lxrcore.com) · [The Land of Wolves](https://wolves.land)

Models: [RegesCore-1.0-35B](https://huggingface.co/iBossonline/RegesCore-1.0-35)
· [RegesCore-1.0-9B-GGUF](https://huggingface.co/iBossonline/RegesCore-1.0-9B-GGUF)

---

## Install

```bash
# macOS / Linux
./install.sh

# Windows (PowerShell)
.\install.ps1
```

Then restart LM Studio. The installer resolves LM Studio's home the same way
LM Studio does — the `~/.lmstudio-home-pointer` file, then `~/.cache/lm-studio`,
then `~/.lmstudio` — copies both plugins into
`extensions/plugins/davidio-dev/`, and runs `npm install` in each.

| Flag | Effect |
|---|---|
| `--link` / `-Link` | Symlink instead of copy, so edits take effect without reinstalling |
| `--uninstall` / `-Uninstall` | Remove both plugins |

For development on a single plugin, `cd` into it and run `lms dev`, which
rebuilds and reloads on every change.

## What ships

### 1. `davidio-dev/regescore` — doctrine and directives

A prompt preprocessor. Appears in the plugin list.

- Typing the trigger (`@regescore` by default) expands in place into the full
  RegesCore // Fable 5 doctrine. Do it once per chat: LM Studio stores the
  expansion in the history, so it persists without repeating.
- Directive triggers expand into focused instruction blocks:

  | Trigger | Effect |
  |---|---|
  | `@sonnet` | Fast, balanced, correct. Act directly, verify briefly |
  | `@opus` | Maximal rigor. Explore, attack the design, verify exhaustively |
  | `@fable5` | End-to-end autonomy. Finish the task, verify as you build |
  | `@audit` | Security review: attack surface, trust boundaries, abuse cases |
  | `@debug` | Observe, reproduce, instrument, isolate, test, fix, verify |
  | `@redm` | RedM and FiveM runtime: FXServer, LuaJIT, LXRCore, oxmysql, Tebex |
  | `@verify` | Treat the work as a hypothesis; run it and report real output |

- **Standing project context** (global setting) is appended to every doctrine
  expansion across all chats — the stack you run, the paths that matter, the
  conventions you expect.
- **Doctrine size**: Full (~2,000 tokens) or Lean (~700 tokens) for small
  context windows.

Why trigger-based and not automatic: LM Studio's preprocessor API receives only
the current user message, never the history, and whatever it returns is written
into the chat history. An automatic prepend would therefore be persisted on
every single message and would fill the context window within a few turns. The
trigger is the idempotent alternative. For an always-on system prompt, use a
preset or the gateway below.

### 2. `davidio-dev/regescore-gateway` — the `/v1` proxy

A generator. Appears in the **model dropdown**, not the plugin list, and
replaces the local model as the token source.

- Speaks **OpenAI** `POST {base}/chat/completions` or **Anthropic**
  `POST {base}/messages`, selectable per install.
- Streams server-sent events end to end. Nothing is buffered — Claude Code
  stalls on a gateway that waits for the full response.
- Forwards tool definitions and streams tool calls back, including parallel
  calls, in both wire formats.
- Routes `<think>` reasoning into LM Studio's reasoning channel rather than the
  answer body, tags split across chunk boundaries included. A mis-tagged
  reasoning stream is what produces `"content": []` alongside a full token count.
- Injects the doctrine into the system prompt automatically, then places the
  host application's own system prompt after it, where it stays authoritative.
- API key stored in global settings and masked in the UI.

Two separate plugins, not one, for a documented reason: a plugin that registers
a generator leaves the plugin list and becomes a model entry, and it takes any
bundled preprocessor with it. Bundled together, the doctrine preprocessor would
only ever run when the gateway was the selected model, never for local ones.

### 3. Chat template

`regescore/templates/regescore_fable5.jinja` — the hardened ChatML template for
Claude Code against a local model. Full rationale in
[`docs/lmstudio-claude-code-chat-template.md`](../docs/lmstudio-claude-code-chat-template.md).

**Plugins cannot set a model's Jinja template.** The LM Studio plugin API
(`PluginContext`) exposes config schematics, a prediction loop handler, a prompt
preprocessor, a tools provider, and a generator — nothing that reaches the
prompt template. Apply it by hand: **My Models → your model → Prompt Template**,
paste, reload the model.

### 4. Presets

`presets/regescore-fable5.system.md` and `presets/regescore-lean.system.md`
hold the doctrine as plain text for the **System Prompt** field of an LM Studio
preset. Use these when you want it always on without a trigger.

## Single source of truth

The doctrine lives in exactly one place: the `rc_identity` block of
`config/chat_templates/regescore_fable5.jinja`. Everything else is generated.

```bash
python3 scripts/sync_regescore_doctrine.py          # regenerate
python3 scripts/sync_regescore_doctrine.py --check   # fail if drifted
```

That writes `src/doctrine.generated.ts` into both plugins and both preset files.
Edit the Jinja template, then re-run; never edit a generated file.

## Tests

```bash
python3 -m pytest tests/test_regescore_lmstudio_plugins.py \
                  tests/test_regescore_fable5_chat_template.py

cd regescore-gateway && npx tsc --noEmit \
  && node --test --experimental-strip-types src/gateway.test.ts
```

## Known limitations

- The gateway forwards text and tool calls, not file attachments. When a message
  carries one, the response says so rather than silently dropping it. Use a
  local vision model for images.
- Plugins cannot install a chat template; that step is manual.
- `lms push` publishes to the LM Studio Hub under the `owner` in `manifest.json`.
  Change `owner` from `davidio-dev` before pushing to an account you control.

---

*RegesCore // Fable 5 — [davidio.dev](https://davidio.dev)*
