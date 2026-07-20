/** Single-password admin auth — HMAC-signed cookie, bcrypt hash support. */
const crypto = require('crypto')
let bcrypt = null
try {
  bcrypt = require('bcryptjs')
} catch {
  /* optional */
}

const COOKIE = 'reges_ops'
const MAX_AGE = 60 * 60 * 12 // 12h

const secret = () => process.env.SESSION_SECRET || 'insecure-dev-secret-change-me'

function verifyPassword(pw) {
  const hash = process.env.CRM_PASSWORD_HASH
  if (hash && hash.startsWith('$2') && bcrypt) {
    try {
      return bcrypt.compareSync(pw, hash)
    } catch {
      return false
    }
  }
  const plain = process.env.CRM_PASSWORD || 'changeme'
  const a = Buffer.from(String(pw))
  const b = Buffer.from(plain)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function sign(payload) {
  const mac = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
  return payload + '.' + mac
}
function valid(token) {
  if (!token) return false
  const i = token.lastIndexOf('.')
  if (i < 0) return false
  const payload = token.slice(0, i)
  const mac = token.slice(i + 1)
  const exp = crypto.createHmac('sha256', secret()).update(payload).digest('hex')
  if (mac.length !== exp.length) return false
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(exp))) return false
  return Number(payload.split(':')[1] || 0) > Date.now()
}

function parseCookies(req) {
  const out = {}
  const raw = req.headers.cookie || ''
  raw.split(';').forEach((p) => {
    const idx = p.indexOf('=')
    if (idx > -1) out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim())
  })
  return out
}

function setSession(res) {
  const token = sign('reges:' + (Date.now() + MAX_AGE * 1000))
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : ''
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${MAX_AGE};${secure}`)
}
function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0`)
}
function isAuthed(req) {
  return valid(parseCookies(req)[COOKIE])
}

module.exports = { verifyPassword, setSession, clearSession, isAuthed }
