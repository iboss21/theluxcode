/**
 * Like a King Inc. — one deployable Node app (Express).
 * Serves the ORIGINAL design (public/) untouched, replaces the PHP backend with
 * Node routes at the SAME URLs, and hosts a full admin panel (dashboard, CRM,
 * AI settings, Armory tool orchestrator) at /admin.
 *
 * Hostinger: framework = Express (or Other), entry file = server.js.
 */
const express = require('express')
const path = require('path')

const pricing = require('./src/lib/pricing')
const store = require('./src/lib/store')
const email = require('./src/lib/email')
const brain = require('./src/lib/brain')
const reges = require('./src/lib/reges')
const auth = require('./src/lib/auth')
const settings = require('./src/lib/settings')
const tools = require('./src/lib/tools')

const app = express()
const PORT = parseInt(process.env.PORT || '3000', 10)
const PUBLIC = path.join(__dirname, 'public')

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

const clean = (v) => String(v == null ? '' : v).trim()
const COLLS = ['customers', 'invoices', 'bookings', 'events']

/* ── Public: lead capture (frontend posts to backend/submit.php) ───────────── */
app.post('/backend/submit.php', async (req, res) => {
  const b = req.body || {}
  if (clean(b.website) !== '') return res.json({ success: true, ref: 'noop' }) // honeypot
  const inq = {
    name: clean(b.name), email: clean(b.email), company: clean(b.company), phone: clean(b.phone),
    practice: clean(b.service || b.practice), budget: clean(b.budget), timeline: clean(b.timeline),
    source: clean(b.source), details: clean(b.details), channel: clean(b.channel) || 'form',
  }
  if (!inq.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inq.email) || !inq.details)
    return res.status(422).json({ success: false, message: 'Name, a valid email, and project details are required.' })

  const est = await pricing.estimate(inq)
  const saved = store.createInquiry({
    ref: store.newRef(), name: inq.name, email: inq.email, company: inq.company, phone: inq.phone,
    practice: inq.practice, budget: inq.budget, timeline: inq.timeline, source: inq.source, details: inq.details,
    channel: inq.channel, ai_low: est.low, ai_expected: est.expected, ai_high: est.high,
    ai_confidence: est.confidence, ai_rationale: est.rationale, ai_breakdown: est.breakdown, quote_amount: null,
    ip: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '',
  })
  let mail = false
  try { mail = await email.notify(saved, est) } catch { /* best-effort */ }
  res.json({ success: true, ref: saved.ref, mail, estimate: { low: est.low, expected: est.expected, high: est.high, confidence: est.confidence, rationale: est.rationale } })
})

/* ── Public: on-page AI (frontend shim posts to backend/ai_chat.php) ───────── */
app.post('/backend/ai_chat.php', async (req, res) => {
  res.type('text/plain')
  const b = req.body || {}
  const fallback = 'REGES is unavailable just now — please use the enquiry form and the team will follow up within a business day.'
  if (!brain.enabled()) return res.send(fallback)
  const msgs = []
  if (clean(b.system)) msgs.push({ role: 'system', content: clean(b.system) })
  ;(Array.isArray(b.messages) ? b.messages : []).forEach((m) => { if (m && m.role && m.content != null) msgs.push({ role: m.role, content: String(m.content) }) })
  const out = await brain.complete(msgs, { temperature: 0.4, maxTokens: parseInt(b.max_tokens, 10) || 500 })
  res.send(out && out.trim() ? out : fallback)
})

/* ── CRM API — their crm.html (backend/api.php) AND the admin panel ────────── */
async function crmApi(req, res) {
  const b = Object.assign({}, req.query, req.body)
  const action = clean(b.action)
  if (action === 'login') { const ok = auth.verifyPassword(clean(b.password)); if (ok) auth.setSession(res); return res.json({ ok }) }
  if (action === 'logout') { auth.clearSession(res); return res.json({ ok: true }) }
  if (action === 'session') return res.json({ authed: auth.isAuthed(req) })
  if (!auth.isAuthed(req)) return res.status(401).json({ error: 'auth' })

  switch (action) {
    case 'list': return res.json({ inquiries: store.listInquiries() })
    case 'metrics': return res.json(store.metrics())
    case 'reminders': return res.json({ reminders: store.reminders() })
    case 'update': {
      const patch = {}
      if (['new', 'reviewing', 'quoted', 'won', 'lost'].includes(b.status)) patch.status = b.status
      if (Object.prototype.hasOwnProperty.call(b, 'quote_amount')) patch.quote_amount = b.quote_amount === null || b.quote_amount === '' ? null : parseInt(b.quote_amount, 10)
      if (!b.id || Object.keys(patch).length === 0) return res.json({ ok: false })
      return res.json({ ok: store.updateInquiry(String(b.id), patch) })
    }
    case 'note': { if (!b.id || !clean(b.body)) return res.json({ ok: false }); return res.json({ ok: store.addNote(String(b.id), clean(b.body), b.remind_at || null) }) }
    case 'suggest': { const inq = store.getInquiry(String(b.id)); if (!inq) return res.status(404).json({ error: 'not found' }); return res.json({ suggestion: await reges.nextBestAction(inq) }) }
    case 'convert': { const c = store.convertToCustomer(String(b.id)); if (!c) return res.status(404).json({ error: 'not found' }); return res.json({ ok: true, customer: c }) }

    // Generic collections: customers · invoices · bookings · events
    case 'coll_list': { if (!COLLS.includes(b.coll)) return res.status(400).json({ error: 'bad coll' }); return res.json({ items: store.list(b.coll) }) }
    case 'coll_create': { if (!COLLS.includes(b.coll)) return res.status(400).json({ error: 'bad coll' }); return res.json({ ok: true, item: store.create(b.coll, b.data || {}) }) }
    case 'coll_update': { if (!COLLS.includes(b.coll) || !b.id) return res.json({ ok: false }); return res.json({ ok: store.update(b.coll, String(b.id), b.data || {}) }) }
    case 'coll_remove': { if (!COLLS.includes(b.coll) || !b.id) return res.json({ ok: false }); return res.json({ ok: store.remove(b.coll, String(b.id)) }) }

    // Settings — the whole editable configuration (100+ fields), AI key redacted on read
    case 'settings_get': return res.json({ settings: settings.publicAll() })
    case 'settings_save': {
      const patch = b.settings || b.patch || {}
      // Don't overwrite the stored AI key with the redacted placeholder
      if (patch.ai && typeof patch.ai.api_key === 'string' && /^•+/.test(patch.ai.api_key)) delete patch.ai.api_key
      const saved = settings.save(patch)
      return res.json({ ok: true, settings: settings.publicAll(), ai_enabled: brain.enabled(), provider: saved.ai.provider })
    }
    // Armory tools
    case 'tools_status': { const av = await tools.available(); return res.json({ available: av, tools: av ? await tools.statusAll() : tools.REGISTRY.map((t) => ({ slug: t.slug, name: t.name, category: t.category, replaces: t.replaces, image: t.image, port: t.port, needs: t.needs || [], note: t.note || '', state: 'unknown', url: null })) }) }
    case 'tools_launch': return res.json(await tools.launch(clean(b.slug), b.env || {}))
    case 'tools_stop': return res.json(await tools.stop(clean(b.slug)))
    case 'tools_restart': return res.json(await tools.restart(clean(b.slug)))
    case 'tools_remove': return res.json(await tools.remove(clean(b.slug)))
    case 'tools_logs': return res.json({ logs: await tools.logs(clean(b.slug)) })
    default: return res.status(400).json({ error: 'unknown action' })
  }
}
app.all('/backend/api.php', crmApi)
app.all('/api/admin', crmApi)

/* ── Admin panel ───────────────────────────────────────────────────────────── */
app.get(['/admin', '/admin/'], (_req, res) => res.sendFile(path.join(PUBLIC, 'admin', 'index.html')))

/* ── The original design (untouched static site) ───────────────────────────── */
app.use(express.static(PUBLIC, { extensions: ['html'] }))
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')))

app.listen(PORT, '0.0.0.0', () => console.log(`[likeaking] listening on http://0.0.0.0:${PORT}  ·  admin at /admin`))
