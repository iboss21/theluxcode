# RegesCore Command Center — server

Serves the Claude Design dashboard export and the `/api/*` surface behind it.
One process, no build step.

Brand and engineering by [davidio.dev](https://davidio.dev).

```
npm install
node server.js            # http://127.0.0.1:3000
```

## Swapping the design

The dashboard is a single `.dc.html` rendered in the browser by `support.js`,
so replacing it is a file copy:

```powershell
.\Install-RegesCoreUI.ps1 -Source C:\Users\iBoss\Downloads\RegesCore-UI -WhatIf
.\Install-RegesCoreUI.ps1 -Source C:\Users\iBoss\Downloads\RegesCore-UI
```

It backs up the current dashboard first, copies `support.js`, `image-slot.js`,
`assets/` and `vendor/` alongside the HTML, and prints the screen and nav-item
counts of both builds so you can confirm the swap changed something. If the
SHA-256 matches what is already installed it refuses and says so — that is the
check that catches a stale export.

Roll back with `.\Install-RegesCoreUI.ps1 -Restore`. Hard-refresh
(`Ctrl+Shift+R`) after a swap; a normal reload serves the cached old build.

The export is served **unmodified**. `public/enhance.js` (brand marks as home
buttons) is opt-in behind `REGESCORE_ENHANCE=1` and off by default.

## Why the HTML is served from memory

`support.js` pulls React, ReactDOM and Babel from unpkg. On a machine with no
outbound network, or when an unpkg republish breaks the SRI hash, the dashboard
renders nothing and the console says only `window.React is not available yet`.

The runtime checks `window.__resources` before the CDN, so `src/resources.js`
injects a map pointing those three URLs at `public/vendor/` copies at request
time. Injecting rather than editing the file keeps `index.dc.html`
byte-identical to the export, so the next redesign drops straight in.

## Why everything is proxied

The browser cannot call `:2126`, `:8000` and the rest directly — cross-origin
is blocked, and enabling CORS on thirty services is both more work and worse
security. Every upstream is reached through this server, which also keeps
`ANTHROPIC_API_KEY` server-side.

## API

| Route | What it does |
|---|---|
| `GET /api/meta` | Server identity and its own live route table |
| `GET /api/system/stats` | CPU, memory, uptime. Cross-platform |
| `GET /api/system/processes` | Top processes by memory (`ps` / `Get-Process`) |
| `GET /api/services/status` | Concurrent health sweep of the whole registry |
| `GET /api/services/registry` | The registry itself |
| `GET /api/services/:id` | One service, probed fresh |
| `GET /api/agent/models` | Models from `?provider=lmstudio\|anthropic` |
| `POST /api/agent/chat` | Streaming chat, either provider |
| `GET /api/voice/engines` | Which voice backends are reachable |
| `GET /api/voice/profiles` | Voices, from whichever engine answers |
| `POST /api/voice/speak` | Streamed TTS audio |
| `POST /api/voice/transcribe` | STT |

CPU percentage is sampled across calls: `os.cpus()` returns counters since
boot, so a single reading is the average since power-on and barely moves.
Thermal reports `null` rather than a plausible invented number.

A probe counts a service as up on **any** HTTP response, including 401 and 404
— it answered, so it is running. Requiring 2xx would paint half the registry
red for not having a health route.

### Chat

Both providers are normalised to one event stream:

```
{"type":"reasoning","text":"..."}   thinking, for the collapsed panel
{"type":"delta","text":"..."}       answer text
{"type":"done","usage":{...}}
{"type":"error","message":"..."}
```

Reasoning is split out rather than passed through: a local model running the
RegesCore template emits `<think>…</think>` inline, and a UI that renders the
raw stream shows the scratchpad as the answer. The splitter holds back a
partial tag at a chunk boundary, so `<thi` at the end of one chunk is neither
printed nor lost.

```bash
curl -N http://127.0.0.1:3000/api/agent/chat \
  -H 'content-type: application/json' \
  -d '{"provider":"lmstudio","messages":[{"role":"user","content":"status?"}]}'
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` / `HOST` | `3000` / `127.0.0.1` | Bind address |
| `ANTHROPIC_API_KEY` | — | Enables `provider=anthropic` |
| `REGESCORE_ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Default Anthropic model |
| `REGESCORE_LMSTUDIO_URL` | `http://127.0.0.1:2126/v1` | LM Studio |
| `REGESCORE_VOICEBOX_URL` | `http://127.0.0.1:8000` | Voicebox |
| `REGESCORE_VOICESERVER_URL` | `http://127.0.0.1:17493` | edge-tts server |
| `REGESCORE_SERVICE_HOST` | `127.0.0.1` | Host every probe targets |
| `REGESCORE_PROBE_TIMEOUT_MS` | `2500` | Per-probe bound |
| `REGESCORE_ENHANCE` | off | Inject `public/enhance.js` |

## Verification

```bash
node scripts/verify-render.js        # renders headless, reports console errors
node scripts/verify-home-button.js   # only meaningful with REGESCORE_ENHANCE=1
```

`verify-render.js` is the one that matters: it loads the dashboard in Chromium
and reports whether React resolved, how many screens mounted, and every failed
request. The current export renders 51 screens and 71 nav items with no runtime
errors.

---

RegesCore // Fable 5 — [davidio.dev](https://davidio.dev)

## Live data: status

`public/polish.css` — **working, verified.** Fixes the OS scrollbar leaking
through (the export scopes its dark scrollbar rules to `[data-scr] `
descendants, so scrollers outside that subtree fell back to the light default)
and borders service tiles by state.

`public/live-bridge.js` — **not attaching yet.** The approach is sound and the
seam is real: `retarget()` and `pushLog()` both bail on
`this.props.liveData === false`, a declared editable prop, while `frame()` reads
only `this.sim` and never checks it. Feeding measured values into `this.sim`
therefore keeps the export's easing and painting and changes only the numbers.

What does not work is *reaching the instance*. Walking React's fiber `return`
chain up from `[data-screen-label]` tops out at the dc runtime's
`StreamableComponent`; a full breadth search over `child`/`sibling`/`alternate`
does not find a `stateNode` carrying `sim` either. Until that resolves, the
bridge is inert — the panels keep showing the export's own simulation.

Verified by `scripts/verify-live.js`, which fails on purpose while this is true:
it asserts the painted RAM figure converges on `/api/system/stats` rather than
merely that a number appears.

The `/api/*` layer underneath is live and correct independently of this.
