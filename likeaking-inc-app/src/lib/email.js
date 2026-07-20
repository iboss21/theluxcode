/** Best-effort transactional email. If SMTP isn't set, no-ops and returns false. */
let nodemailer = null
try {
  nodemailer = require('nodemailer')
} catch {
  /* optional */
}
const { SITE } = require('./config')

function transport() {
  if (!nodemailer) return null
  const host = process.env.SMTP_HOST
  const pass = process.env.SMTP_PASS
  if (!host || !pass) return null
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user: process.env.SMTP_USER || '', pass },
  })
}

const money = (n) => '$' + Number(n || 0).toLocaleString('en-US')
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function shell(title, body) {
  return `<div style="background:#080d18;padding:34px 20px;font-family:Georgia,serif;"><div style="max-width:600px;margin:0 auto;background:#0c1322;border:1px solid rgba(205,214,228,.14);border-radius:8px;overflow:hidden;"><div style="padding:22px 32px;border-bottom:1px solid rgba(205,214,228,.12);"><span style="font-size:17px;color:#eef1f6;">Like a King <span style="color:#b68235;font-size:11px;letter-spacing:.2em;">INC.</span></span></div><div style="padding:30px 32px;"><h1 style="margin:0 0 20px;font-size:20px;font-weight:400;color:#f4f6fa;">${title}</h1>${body}</div><div style="padding:16px 32px;border-top:1px solid rgba(205,214,228,.1);font-size:11px;color:#6f7994;">© ${new Date().getFullYear()} ${SITE.name} · ${SITE.email}</div></div></div>`
}
const row = (k, v) => `<tr><td style="padding:6px 14px 6px 0;color:#8b95ab;white-space:nowrap;vertical-align:top;">${k}</td><td style="padding:6px 0;color:#eef1f6;">${v}</td></tr>`

async function send(to, subject, html, replyTo) {
  const t = transport()
  if (!t) return false
  try {
    await t.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || SITE.name}" <${process.env.MAIL_FROM_EMAIL || SITE.email}>`,
      to, subject, html, replyTo,
    })
    return true
  } catch {
    return false
  }
}

async function notify(inq, est) {
  const teamHtml = shell(`New inquiry · ${inq.ref}`, `
    <p style="margin:0 0 18px;color:#8b95ab;">A new estimate request has arrived and been auto-assessed.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row('Reference', inq.ref)}${row('Name', esc(inq.name))}${row('Email', esc(inq.email))}
      ${row('Company', esc(inq.company || '—'))}${row('Phone', esc(inq.phone || '—'))}
      ${row('Practice', esc(inq.practice))}${row('Budget', esc(inq.budget || '—'))}${row('Timeline', esc(inq.timeline || '—'))}
    </table>
    <div style="margin:22px 0;padding:18px 20px;border:1px solid rgba(182,130,53,.4);border-radius:6px;">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#b68235;margin-bottom:10px;">REGES assessment</div>
      <div style="font-size:20px;color:#eef1f6;">${money(est.low)} – ${money(est.high)} <span style="color:#8b95ab;font-size:13px;">· expected ${money(est.expected)} · ${esc(est.confidence)}</span></div>
      <p style="margin:12px 0 0;color:#aab6cc;font-size:13px;">${esc(est.rationale)}</p>
    </div>
    <div style="font-size:11px;text-transform:uppercase;color:#8b95ab;margin-bottom:8px;">Project details</div>
    <p style="white-space:pre-wrap;color:#cdd6e4;line-height:1.7;margin:0;">${esc(inq.details)}</p>`)

  const visitorHtml = shell('Your estimate from Like a King Inc.', `
    <p style="margin:0 0 16px;color:#cdd6e4;">Dear ${esc(inq.name)},</p>
    <p style="margin:0 0 16px;color:#8b95ab;line-height:1.7;">Thank you for reaching out. REGES has produced a preliminary estimate for your ${esc(inq.practice)} project. A member of our team will follow up within one business day.</p>
    <div style="margin:22px 0;padding:20px 22px;border:1px solid rgba(182,130,53,.4);border-radius:6px;text-align:center;">
      <div style="font-size:11px;text-transform:uppercase;color:#b68235;margin-bottom:10px;">Preliminary estimate</div>
      <div style="font-size:26px;color:#eef1f6;">${money(est.low)} – ${money(est.high)}</div>
      <div style="color:#8b95ab;font-size:12px;margin-top:8px;">Reference ${inq.ref}</div>
    </div>
    <p style="margin:0;color:#6f7994;font-size:12px;">Indicative range — not a formal quote. Final pricing follows a scoping conversation.</p>`)

  const team = process.env.TEAM_INBOX || SITE.email
  const ok = await send(team, `New inquiry · ${inq.ref} · ${inq.practice}`, teamHtml, inq.email)
  await send(inq.email, `Your estimate from Like a King Inc. · ${inq.ref}`, visitorHtml)
  return ok
}

module.exports = { notify }
