/**
 * Supabase persistence via Storage.
 *
 * When SUPABASE_URL + SUPABASE_KEY (service/secret key) are set, the app keeps
 * its JSON state (the CRM store + settings) as objects in a private Storage
 * bucket — a managed, persistent database that survives redeploys. No tables,
 * no SQL: the app creates the bucket on boot. With the vars unset, the app
 * falls back to the local file store.
 *
 * Uses the Storage REST API with the service key (server-side only — the key
 * never reaches the browser).
 */
const cfg = () => ({
  url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  key: process.env.SUPABASE_KEY || process.env.SUPABASE_API_KEY || process.env.SUPABASE_SERVICE_KEY || '',
  bucket: process.env.SUPABASE_BUCKET || 'laki',
})
const enabled = () => { const c = cfg(); return !!(c.url && c.key) }
const authHeaders = () => { const c = cfg(); return { apikey: c.key, Authorization: 'Bearer ' + c.key } }

// fetch with a hard timeout so init/saves can never hang the process
async function fetchT(url, opts, ms) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms || 8000)
  try { return await fetch(url, { ...opts, signal: ctrl.signal }) } finally { clearTimeout(t) }
}

async function ensureBucket() {
  const c = cfg(); if (!c.url) return false
  try {
    const r = await fetchT(c.url + '/storage/v1/bucket', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: c.bucket, name: c.bucket, public: false }),
    })
    // 200 = created; 409/400 = already exists — both fine.
    return r.status < 400 || r.status === 409 || r.status === 400
  } catch { return false }
}

/** Returns the parsed JSON object, or null if not present / on error. */
async function loadJSON(name) {
  const c = cfg()
  try {
    const r = await fetchT(`${c.url}/storage/v1/object/${c.bucket}/${encodeURIComponent(name)}`, { headers: authHeaders() })
    if (r.status === 200) { try { return await r.json() } catch { return null } }
    return null
  } catch { return null }
}

/** Upserts a JSON object. Throws on failure so callers can log + keep the cache. */
async function saveJSON(name, obj) {
  const c = cfg()
  const r = await fetchT(`${c.url}/storage/v1/object/${c.bucket}/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'no-cache' },
    body: JSON.stringify(obj),
  })
  if (r.status >= 400) throw new Error(`supabase save ${name} → ${r.status} ${await r.text().catch(() => '')}`)
  return true
}

module.exports = { enabled, ensureBucket, loadJSON, saveJSON, cfg }
