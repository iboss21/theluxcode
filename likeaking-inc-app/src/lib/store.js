/**
 * JSON-file store. Holds inquiries (leads) + generic collections (customers,
 * invoices, bookings, events). Zero-config; set DATA_DIR for a persistent path.
 */
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const supa = require('./supabase')

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', '..', 'data')
const FILE = path.join(DATA_DIR, 'store.json')

const EMPTY = { inquiries: [], customers: [], invoices: [], bookings: [], events: [] }

/* ── Backend: Supabase (managed) when configured, else the local file ──────────
 * The public read()/write() stay synchronous (the whole store API depends on
 * that), backed by an in-memory cache. init() loads the cache once at boot;
 * write() updates the cache, always mirrors to the local file for durability,
 * and (on Supabase) debounce-pushes the state to Storage. */
let CACHE = null
let BACKEND = 'file'
let saveTimer = null

function normalize(db) { db = db || {}; for (const k in EMPTY) if (!Array.isArray(db[k])) db[k] = []; return db }
function fileLoad() { try { if (fs.existsSync(FILE)) return normalize(JSON.parse(fs.readFileSync(FILE, 'utf-8'))) } catch { /* fall through */ } return null }
function fileWrite(db) { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 2)); fs.renameSync(tmp, FILE) } catch (e) { /* best-effort */ } }

async function init() {
  if (supa.enabled()) {
    try {
      await supa.ensureBucket()
      const remote = await supa.loadJSON('store.json')
      CACHE = normalize(remote || fileLoad() || {})
      await supa.saveJSON('store.json', CACHE) // ensure the object exists
      BACKEND = 'supabase'
      return 'supabase'
    } catch (e) {
      console.error('[store] Supabase init failed, using local file:', e && e.message)
    }
  }
  BACKEND = 'file'
  CACHE = fileLoad() || JSON.parse(JSON.stringify(EMPTY))
  return 'file'
}
function backend() { return BACKEND }

function read() { if (!CACHE) CACHE = fileLoad() || JSON.parse(JSON.stringify(EMPTY)); return CACHE }
function write(db) {
  CACHE = db
  fileWrite(db) // durable within the session regardless of backend
  if (BACKEND === 'supabase') {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => { supa.saveJSON('store.json', CACHE).catch((e) => console.error('[store] Supabase save failed:', e && e.message)) }, 400)
  }
}
const id = () => crypto.randomBytes(9).toString('hex')
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ')
const newRef = (p) => (p || 'LAK') + '-' + crypto.randomBytes(4).toString('hex').slice(0, 6).toUpperCase()

/* ── Inquiries (leads) ─────────────────────────────────────────────────────── */
function createInquiry(data) {
  const db = read()
  const row = Object.assign({ id: id(), created_at: now(), status: 'new', notes: [] }, data)
  db.inquiries.unshift(row)
  write(db)
  return row
}
const listInquiries = () => read().inquiries
const getInquiry = (i) => read().inquiries.find((x) => x.id === i)
function updateInquiry(i, patch) {
  const db = read()
  const r = db.inquiries.find((x) => x.id === i)
  if (!r) return false
  if (patch.status) r.status = patch.status
  if (Object.prototype.hasOwnProperty.call(patch, 'quote_amount')) r.quote_amount = patch.quote_amount === null ? null : parseInt(patch.quote_amount, 10) || 0
  write(db)
  return true
}
function addNote(i, body, remind_at) {
  const db = read()
  const r = db.inquiries.find((x) => x.id === i)
  if (!r) return false
  r.notes.push({ id: id(), inquiry_id: i, created_at: now(), body, remind_at: remind_at || null })
  write(db)
  return true
}
function convertToCustomer(inqId) {
  const inq = getInquiry(inqId)
  if (!inq) return null
  const db = read()
  if (db.customers.find((c) => c.email === inq.email)) return db.customers.find((c) => c.email === inq.email)
  const c = { id: id(), created_at: now(), name: inq.name, email: inq.email, company: inq.company || '', phone: inq.phone || '', practice: inq.practice || '', status: 'active', value: inq.quote_amount || inq.ai_expected || 0, notes: '', from_lead: inqId }
  db.customers.unshift(c)
  write(db)
  return c
}

/* ── Generic collections (customers, invoices, bookings, events) ───────────── */
function list(coll) { return read()[coll] || [] }
function create(coll, data) {
  const db = read()
  const row = Object.assign({ id: id(), created_at: now() }, data)
  db[coll].unshift(row)
  write(db)
  return row
}
function update(coll, itemId, patch) {
  const db = read()
  const r = db[coll].find((x) => x.id === itemId)
  if (!r) return false
  Object.assign(r, patch, { id: r.id })
  write(db)
  return true
}
function remove(coll, itemId) {
  const db = read()
  const before = db[coll].length
  db[coll] = db[coll].filter((x) => x.id !== itemId)
  write(db)
  return db[coll].length < before
}

/* ── Metrics / reminders ───────────────────────────────────────────────────── */
function metrics() {
  const db = read()
  const rows = db.inquiries
  const out = { counts: {}, value: {}, total: 0, won_value: 0, pipeline_value: 0, conversion: 0, customers: db.customers.length, invoices: db.invoices.length, bookings: db.bookings.length, invoice_outstanding: 0, invoice_paid: 0 }
  for (const r of rows) {
    const v = (r.quote_amount != null ? r.quote_amount : r.ai_expected) || 0
    out.counts[r.status] = (out.counts[r.status] || 0) + 1
    out.value[r.status] = (out.value[r.status] || 0) + v
    out.total += 1
    if (r.status === 'won') out.won_value += v
    if (['new', 'reviewing', 'quoted'].includes(r.status)) out.pipeline_value += v
  }
  const won = out.counts.won || 0, lost = out.counts.lost || 0
  out.conversion = won + lost ? Math.round((won / (won + lost)) * 100) : 0
  for (const inv of db.invoices) {
    const total = (inv.items || []).reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0)
    if (inv.status === 'paid') out.invoice_paid += total
    else out.invoice_outstanding += total
  }
  return out
}
function reminders() {
  const today = new Date().toISOString().slice(0, 10)
  const out = []
  for (const r of read().inquiries) for (const n of r.notes || []) if (n.remind_at && n.remind_at <= today) out.push(Object.assign({ name: r.name, ref: r.ref }, n))
  return out.sort((a, b) => (a.remind_at < b.remind_at ? -1 : 1))
}

module.exports = {
  init, backend,
  newRef,
  createInquiry, listInquiries, getInquiry, updateInquiry, addNote, convertToCustomer,
  list, create, update, remove,
  metrics, reminders,
}
