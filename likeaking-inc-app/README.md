# Like a King Inc. — one deployable app

Your **original website design** (untouched) + a **Node backend** + a **full
admin panel** (dashboard, CRM, AI settings, and the Armory tool orchestrator) —
one Express app, deployable on Hostinger's app hosting (framework: **Express**,
entry file: **server.js**).

```
likeaking-inc/
├── server.js            Express: serves the design + backend routes + /admin
├── public/              YOUR ORIGINAL DESIGN, untouched (index.html, support.js,
│   │                    vendor/, images, …) — all deps vendored, zero external CDNs
│   │                    + SEO/favicon, robots.txt, sitemap.xml
│   └── admin/           the full operations console (single-page, no build step)
├── src/lib/             Node backend: pricing, brain, store, email, auth, settings,
│                        reges (concierge + next-best-action), tools (135 Armory tools)
├── data/                JSON store (leads, customers, invoices, bookings, events,
│                        settings) — created at runtime
├── package.json         start: node server.js
└── .env.example
```

## What works

- **Website** (`/`) — your exact design, untouched. The form and "Ask REGES"
  concierge call the Node backend at the same URLs the design already used
  (`backend/submit.php`, `backend/ai_chat.php`). Now with full **SEO** (title,
  meta, Open Graph, Twitter, JSON-LD Organization), **favicon**, `robots.txt`
  and `sitemap.xml`.
- **Lead engine** — validate → REGES estimate → save → email (best-effort).
- **Operations console** (`/admin`) — password-protected, no build step, loads
  instantly on any host:
  - **Dashboard** — pipeline/won value, conversion, customer & invoice totals,
    charts, reminders.
  - **Pipeline** — drag-and-drop kanban across New → Reviewing → Quoted → Won →
    Lost (dropping into Won auto-creates the customer).
  - **Leads & CRM** — filterable table + lead detail (estimate, status, quote
    override, notes/reminders, REGES next-best-action with a drafted email,
    one-click convert to customer).
  - **Customers** — full CRUD, account value & status.
  - **Invoices** — line-item builder with live totals, statuses (draft/sent/
    paid/overdue), prefix + payment terms from settings.
  - **Calendar** — month grid of events + bookings; click a day to add an event.
  - **Bookings** — consultation bookings CRUD with status.
  - **Armory · Tools** — **135** self-hostable open-source tools across 25
    categories; launch/stop/logs as containers on a Docker host (graceful banner
    when no Docker).
  - **AI · REGES** — pick a provider + paste a key; concierge, pricing and
    next-best-action come alive immediately (no redeploy).
  - **Settings** — 100+ editable fields: company, brand & locale, feature
    toggles, email/SMTP, pricing rate-card, booking & business hours, invoicing,
    notifications, security. All live, no redeploy.

## Branding

- **Website** favicon/logo → `public/images/lion-crest.webp` (the lion crest).
- **Admin** wolf crest → drop your exact logo at `public/images/wolf-crest.webp`
  (or `.png`) and the console uses it automatically; until then it renders a
  clean built-in geometric wolf crest, so nothing ever looks unfinished.

## Run locally

```bash
npm install
npm start          # http://localhost:3000  ·  admin at /admin  (password: changeme)
```

## Deploy on Hostinger (app hosting)

1. **Settings and redeploy** → **Upload new files** → this project (zip).
2. **Framework preset:** `Express` (or `Other`). **Node version:** 20.
   **Entry file:** `server.js`. **Package manager:** `npm`.
3. **Environment variables:** `SESSION_SECRET` (long random), `CRM_PASSWORD`
   (your admin password), and **`DATA_DIR`** — see the persistence warning below.
   Optionally set the AI here or later in the panel.
4. Deploy. Your site is at `/`, the admin at `/admin`.

> **Persistence — read this or you will lose your CRM data.** The store
> (leads, customers, invoices, bookings) is a JSON file under `DATA_DIR`. If you
> leave it unset it defaults to `./data` **inside the app folder**, and a
> redeploy that replaces that folder **erases every record**. Set `DATA_DIR` to
> a path *outside* the deploy target (e.g. `/home/YOURUSER/likeaking-data`) and
> back up `DATA_DIR/store.json` on a schedule. The server prints its resolved
> data path at boot and warns loudly when `DATA_DIR` is unset.

> The **Armory tool orchestrator** needs a Docker host — it runs live on a
> Hostinger **VPS** (mount `/var/run/docker.sock`). On app/shared hosting the
> catalog lists but launch is disabled (clear banner). Everything else works.

## AI (free, no subscription)

Admin → **AI Settings** → provider `groq` → paste a free key from
console.groq.com/keys → Save. Or `gemini`, `openrouter`, `cerebras`, `mistral`,
`together`, `openai`, `anthropic`. With AI off, everything still works on
deterministic fallbacks.

## Security

Set a strong `CRM_PASSWORD` (or `CRM_PASSWORD_HASH`) and a long `SESSION_SECRET`.
Never commit `.env` or `data/` (both gitignored). Mounting the Docker socket
gives the app control of the host's Docker — keep the admin behind its password.

> **Rotate any secrets you pasted into Hostinger env vars earlier** (the AI API
> key and the CRM password). Anything shared in plain text should be treated as
> compromised: generate a new API key with the provider and set a fresh
> `CRM_PASSWORD`.
