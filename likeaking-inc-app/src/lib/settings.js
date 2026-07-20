/**
 * Runtime settings (data/settings.json) — the admin Settings area. Everything
 * here is editable from the panel without redeploying. Falls back to env.
 */
const fs = require('fs')
const path = require('path')

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', '..', 'data')
const FILE = path.join(DATA_DIR, 'settings.json')

const DEFAULTS = {
  company: {
    name: 'Like a King Inc.',
    tagline: 'Professional Business Services',
    email: process.env.MAIL_FROM_EMAIL || 'info@likeaking.pro',
    phone: '',
    address: '',
    website: 'https://www.likeakinginc.com',
    primary_domain: 'likeakinginc.com',
    secondary_domain: 'likeaking.pro',
    reply_sla: 'one business day',
    linkedin: 'https://www.linkedin.com/company/likeakinginc/',
    instagram: 'https://www.instagram.com/likeakinginc/',
    facebook: 'https://www.facebook.com/likeakinginc/',
  },
  brand: {
    accent: '#b68235',
    accent2: '#e1ad66',
    currency: 'USD',
    currency_symbol: '$',
    locale: 'en-US',
    timezone: 'UTC',
  },
  ai: {
    provider: process.env.BRAIN_PROVIDER || 'off',
    api_key: process.env.BRAIN_API_KEY || '',
    model: process.env.BRAIN_MODEL || '',
    base_url: process.env.BRAIN_BASE_URL || '',
    timeout_ms: Number(process.env.BRAIN_TIMEOUT_MS || 25000),
    concierge_enabled: true,
    pricing_ai_enabled: true,
    temperature: 0.4,
  },
  rates: {
    day_rate: { 'AI Engineering': 1650, 'Digital Platforms': 1400, Cybersecurity: 1550, Cloud: 1450, default: 1450 },
    scope_days: { 'Under $10k': 5, '$10k – $50k': 18, '$50k – $150k': 45, '$150k+': 80, 'To be discussed': 15, default: 15 },
    timeline_factor: { 'Immediate (< 1 month)': 1.25, 'This quarter (1–3 months)': 1.0, '6+ months': 0.92, Exploratory: 0.9, default: 1.0 },
    range_spread: 0.22,
  },
  email: {
    smtp_host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    smtp_port: Number(process.env.SMTP_PORT || 465),
    smtp_secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    smtp_user: process.env.SMTP_USER || 'info@likeaking.pro',
    from_name: process.env.MAIL_FROM_NAME || 'Like a King Inc.',
    from_email: process.env.MAIL_FROM_EMAIL || 'info@likeaking.pro',
    team_inbox: process.env.TEAM_INBOX || 'info@likeaking.pro',
    notify_team_on_lead: true,
    auto_reply_visitor: true,
  },
  booking: {
    enabled: true,
    slot_minutes: 30,
    daily_start: '09:00',
    daily_end: '17:00',
    lead_time_hours: 24,
    buffer_minutes: 15,
    confirmation_email: true,
  },
  hours: {
    mon: { open: '09:00', close: '17:00', closed: false },
    tue: { open: '09:00', close: '17:00', closed: false },
    wed: { open: '09:00', close: '17:00', closed: false },
    thu: { open: '09:00', close: '17:00', closed: false },
    fri: { open: '09:00', close: '17:00', closed: false },
    sat: { open: '10:00', close: '14:00', closed: true },
    sun: { open: '10:00', close: '14:00', closed: true },
  },
  invoicing: {
    prefix: 'INV',
    tax_rate: 0,
    payment_terms_days: 14,
    notes: 'Thank you for your business.',
  },
  notifications: {
    email_new_lead: true,
    email_new_booking: true,
    email_invoice_paid: false,
    weekly_summary: false,
  },
  features: {
    concierge: true,
    armory_tools: true,
    invoices: true,
    bookings: true,
    calendar: true,
    customers: true,
    pipeline_kanban: true,
    public_pricing: false,
  },
  security: {
    session_hours: 12,
    require_strong_password: true,
  },
  // External self-hosted tools (VPS). When a URL is set, the admin opens the
  // REAL product for that function instead of the built-in module.
  integrations: {
    invoicing_url: process.env.INVOICING_URL || '',   // e.g. https://invoices.likeakinginc.com (Invoice Ninja)
    booking_url: process.env.BOOKING_URL || '',        // e.g. https://book.likeakinginc.com (Cal.com)
    crm_url: process.env.CRM_URL || '',                // e.g. https://crm.likeakinginc.com (EspoCRM / Twenty)
  },
}

function ensure() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }) }
function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base)
  for (const k in (over || {})) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object' && base[k] && !Array.isArray(base[k])) out[k] = deepMerge(base[k], over[k])
    else out[k] = over[k]
  }
  return out
}
function getAll() {
  ensure()
  try {
    return deepMerge(DEFAULTS, JSON.parse(fs.readFileSync(FILE, 'utf-8')))
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS))
  }
}
function save(patch) {
  ensure()
  const next = deepMerge(getAll(), patch || {})
  const tmp = FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2))
  fs.renameSync(tmp, FILE)
  return next
}
/** Full settings with the AI key redacted, for the panel. */
function publicAll() {
  const s = getAll()
  const key = s.ai.api_key
  s.ai = Object.assign({}, s.ai, { api_key: key ? '••••••••' + key.slice(-4) : '', has_key: !!key })
  return s
}

module.exports = { getAll, save, publicAll, DEFAULTS }
