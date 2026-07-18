# Like a King Inc. — Company Platform + REGES Brain

A production Next.js rebuild of the Like a King Inc. company site, wired to
**REGES** — the firm's AI operations brain. It runs the whole money loop:
**attract → qualify → price → close → grow.**

> Rebuilt from the original design-canvas exports (`Like A King Landing/Armory/CRM`)
> and the PHP backend, as a single component-based app. The pricing rate card,
> CRM data model, email shells, and auth model are ported faithfully from that
> backend; the concierge and per-lead next-best-action are new "brain" layers.

## What's inside

| Surface | Route | What it does |
|---|---|---|
| **Landing** | `/` | Four practices, Applied Intelligence, the REGES concierge, FAQ, and the lead form. The storefront that wins clients. |
| **The Armory** | `/armory` | The 40-tool open-source arsenal ("Own the whole stack. Pay for none of it."), filterable by category. |
| **REGES concierge** | corner widget → `/api/reges` | Guard-railed on-site assistant that answers visitors and routes them to the right practice. |
| **Lead engine** | form → `/api/lead` | Validates → prices (REGES estimate) → stores → emails team + auto-replies the visitor. Money **in**. |
| **Operations Cockpit** | `/crm` → `/api/crm` | Password-protected pipeline: metrics, status, quote override, notes/reminders, and **AI next-best-action** per lead. The growth brain. |
| **Privacy** | `/privacy` | Template policy. |

## The REGES brain (the "Jarvis" layer)

Every AI behaviour is **pluggable and degrades gracefully** — with the brain
`off` the whole platform still works on deterministic fallbacks (rate-card
pricing, keyword-routed concierge, heuristic next-best-action). Point it at any
brain via env:

- **Odysseus** (this repo's self-hosted AI workspace) or any OpenAI-compatible
  server (LM Studio, vLLM, Together, Groq, OpenAI) → `BRAIN_PROVIDER=openai` + `BRAIN_BASE_URL`
- **Anthropic** Messages API → `BRAIN_PROVIDER=anthropic` + `BRAIN_API_KEY` + `BRAIN_MODEL`

When enabled, REGES refines pricing (within ±30% of the rate card), answers as a
scoped concierge, and recommends the single next action to close each lead —
drafting the follow-up email for you.

## Quick start

```bash
cd company
npm install
cp .env.example .env.local   # optional — runs fine with defaults
npm run dev                  # http://localhost:3000
```

Production:

```bash
npm run build && npm run start
```

The CRM default password is `changeme` (set `CRM_PASSWORD` or, preferably,
`CRM_PASSWORD_HASH`). Open `/crm` and sign in.

## Configuration

All optional — see [`.env.example`](./.env.example) for the full list.

- **Pricing rate card** lives in [`src/lib/config.ts`](./src/lib/config.ts) — day
  rates per practice, scope-days per budget band, timeline factors. That IS your
  pricing schema; tune the numbers.
- **CRM auth**: `CRM_PASSWORD_HASH` (bcrypt, preferred) or `CRM_PASSWORD`, plus a
  long random `SESSION_SECRET`.
  ```bash
  node -e "console.log(require('bcryptjs').hashSync('your-strong-pass',10))"
  ```
- **Email**: SMTP is best-effort — leave it blank and leads are still saved and
  shown in the cockpit. Set `SMTP_*` (Hostinger mailbox defaults are pre-filled).
- **Data store**: a zero-config JSON file at `DATA_DIR` (default `./.data`). For
  heavy or serverless production, swap [`src/lib/store.ts`](./src/lib/store.ts)
  for Postgres/MySQL — the exported function surface is the contract.

## Architecture

```
src/
  app/
    page.tsx              landing        armory/  crm/  privacy/
    api/lead   route.ts   lead engine (submit → estimate → save → email)
    api/reges  route.ts   concierge chat
    api/crm    route.ts   action-routed CRM API (login/list/metrics/update/note/suggest…)
  lib/
    config.ts   rate card + practice options        pricing.ts  estimator (rule card + brain)
    brain.ts    pluggable LLM client (openai/anthropic/off)
    reges.ts    concierge + next-best-action (+ fallbacks)
    store.ts    JSON data store          auth.ts  signed-cookie session
    email.ts    nodemailer shells        types.ts
  data/         practices.ts · armory.ts (40 tools)
  components/   site/ · armory/ · crm/
```

## Notes

- Public pages are static; the three API routes and the CRM run on the Node
  runtime (they use the filesystem store and cookies).
- No secret is ever committed — the `.data/` store and `.env*` are gitignored.
