# Go-live runbook — Like a King Inc.

Everything you need to take this from zip to live, in order. Do it once, top to
bottom, and you never have to guess.

## 1. Upload
Hostinger hPanel → your app → **Deploy / Upload new files** → upload the zip
(or push the repo). Then set:

- **Framework:** `Express` (or `Other`)
- **Entry file:** `server.js`
- **Node version:** `20` (18 also works)
- **Package manager:** `npm`

There is **no build step**. Hostinger runs `npm install` then `node server.js`.

## 2. Environment variables (hPanel → Environment)
Set these before you rely on the app:

| Variable | Why it matters |
|---|---|
| `SESSION_SECRET` | Long random string. Signs the admin login cookie. If unset, sessions use a known dev secret — anyone could forge a login. **Required.** |
| `CRM_PASSWORD` | Your admin password. Default is `changeme` — change it. |
| `DATA_DIR` | **The one that saves your data.** See section 3. |
| `SMTP_PASS` | Mailbox password, if you want lead emails sent. Optional. |

AI keys are optional here — you can set the provider live in the admin (AI · REGES)
without a redeploy.

## 3. Persistence — do NOT skip this
Your CRM store (leads, customers, invoices, bookings) is a JSON file under
`DATA_DIR`. If you leave it unset it lands in `./data` **inside the app folder**,
and the next redeploy that replaces that folder **erases every record**.

**Fix:** set `DATA_DIR` to a path *outside* the deploy target, e.g.
```
DATA_DIR=/home/YOURUSER/likeaking-data
```
The server prints its resolved data path at boot and warns loudly if `DATA_DIR`
is unset. Back up `DATA_DIR/store.json` on a schedule.

## 4. First checks after deploy
- Visit `/` → the website loads (your original design).
- Visit `/admin` → log in with `CRM_PASSWORD`.
- Submit the website contact form → it should appear under **Leads** as *New*.
- Check the app log for `[likeaking] data store: …` and confirm it points at your
  persistent `DATA_DIR` (no WARNING line).

## 5. Branding
- **Website** favicon/logo → `public/images/lion-crest.webp` (lion crest, already set).
- **Admin** logo → `public/images/wolf-crest.png` ships with a built-in wolf crest.
  Replace that file with your exact wolf logo (keep the name, or use
  `wolf-crest.webp`) and the console picks it up automatically.

## 6. AI (free, optional)
Admin → **AI · REGES** → provider `groq` → paste a free key from
`console.groq.com/keys` → Save. Powers the site concierge, pricing estimates and
next-best-action. With it off, everything still runs on deterministic fallbacks.

## 7. Armory tools (VPS only)
The 135-tool launcher needs a Docker host. On a Hostinger **VPS**, mount
`/var/run/docker.sock` into the app and set `DOCKER_SOCKET`. On shared/app hosting
the catalogue lists but launch is disabled (you'll see a clear banner).

## 8. Security checklist
- [ ] `SESSION_SECRET` set to a long random string.
- [ ] `CRM_PASSWORD` changed from `changeme`.
- [ ] `DATA_DIR` points outside the deploy folder + backups scheduled.
- [ ] **Rotate any secrets pasted in plain text earlier** (AI key, old password) —
      treat them as compromised: new key from the provider, fresh password.
- [ ] `.env` and `data/` never committed (already gitignored).

## What's verified vs. what proves out on first deploy
- **Verified by running it:** website, admin login, all CRUD, pipeline, invoice
  totals, settings persistence, 135-tool catalogue, the persistence warning,
  clean install from the lockfile boots.
- **Proves out on first live deploy (needs real network):** live AI provider
  calls and outbound SMTP. The fallback paths are tested; the live calls get
  their proof the first time you deploy with a key and a mailbox.
