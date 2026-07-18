/**
 * Best-effort transactional email via nodemailer. If SMTP isn't configured the
 * functions no-op and return false — leads are still saved and shown in the CRM.
 * Ported email shells from backend/submit.php.
 */
import nodemailer from "nodemailer";
import type { Estimate, Inquiry } from "./types";
import { SITE } from "./config";

function transport() {
  const host = process.env.SMTP_HOST;
  const pass = process.env.SMTP_PASS;
  if (!host || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_SECURE || "true") === "true",
    auth: { user: process.env.SMTP_USER || "", pass },
  });
}

const money = (n: number) => "$" + Number(n || 0).toLocaleString("en-US");
const esc = (s: string) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function shell(title: string, body: string): string {
  return `<div style="background:#080d18;padding:34px 20px;font-family:Georgia,'Times New Roman',serif;">
    <div style="max-width:600px;margin:0 auto;background:#0c1322;border:1px solid rgba(205,214,228,.14);border-radius:8px;overflow:hidden;">
      <div style="padding:22px 32px;border-bottom:1px solid rgba(205,214,228,.12);">
        <span style="font-size:17px;color:#eef1f6;letter-spacing:.02em;">Like a King <span style="color:#b68235;font-size:11px;letter-spacing:.2em;">INC.</span></span>
      </div>
      <div style="padding:30px 32px;">
        <h1 style="margin:0 0 20px;font-size:20px;font-weight:400;color:#f4f6fa;">${title}</h1>
        ${body}
      </div>
      <div style="padding:16px 32px;border-top:1px solid rgba(205,214,228,.1);font-size:11px;color:#6f7994;font-family:Arial,sans-serif;">
        © ${new Date().getFullYear()} ${SITE.name} · ${SITE.email}
      </div>
    </div></div>`;
}

const row = (k: string, v: string) =>
  `<tr><td style="padding:6px 14px 6px 0;color:#8b95ab;white-space:nowrap;vertical-align:top;">${k}</td>
   <td style="padding:6px 0;color:#eef1f6;">${v}</td></tr>`;

async function send(to: string, subject: string, html: string, replyTo?: string): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  try {
    await t.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || SITE.name}" <${process.env.MAIL_FROM_EMAIL || SITE.email}>`,
      to,
      subject,
      html,
      replyTo,
    });
    return true;
  } catch {
    return false;
  }
}

export async function notifyTeamAndVisitor(inq: Inquiry, est: Estimate): Promise<boolean> {
  const teamHtml = shell(`New inquiry · ${inq.ref}`, `
    <p style="margin:0 0 18px;color:#8b95ab;">A new estimate request has arrived and been auto-assessed.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row("Reference", inq.ref)}${row("Channel", inq.channel)}
      ${row("Name", esc(inq.name))}${row("Email", esc(inq.email))}
      ${row("Company", esc(inq.company || "—"))}${row("Phone", esc(inq.phone || "—"))}
      ${row("Practice", esc(inq.practice))}${row("Budget", esc(inq.budget || "—"))}
      ${row("Timeline", esc(inq.timeline || "—"))}${row("Heard via", esc(inq.source || "—"))}
    </table>
    <div style="margin:22px 0;padding:18px 20px;border:1px solid rgba(182,130,53,.4);border-radius:6px;">
      <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#b68235;margin-bottom:10px;">REGES assessment</div>
      <div style="font-size:20px;color:#eef1f6;">${money(est.low)} – ${money(est.high)}
        <span style="color:#8b95ab;font-size:13px;">· expected ${money(est.expected)} · ${esc(est.confidence)} confidence</span></div>
      <p style="margin:12px 0 0;color:#aab6cc;font-size:13px;line-height:1.6;">${esc(est.rationale)}</p>
    </div>
    <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#8b95ab;margin-bottom:8px;">Project details</div>
    <p style="white-space:pre-wrap;color:#cdd6e4;line-height:1.7;margin:0;">${esc(inq.details)}</p>`);

  const visitorHtml = shell("Your estimate from Like a King Inc.", `
    <p style="margin:0 0 16px;color:#cdd6e4;line-height:1.7;">Dear ${esc(inq.name)},</p>
    <p style="margin:0 0 16px;color:#8b95ab;line-height:1.7;">Thank you for reaching out. REGES, our engagement engine,
    has produced a preliminary estimate for your ${esc(inq.practice)} project. A member of our team will follow up
    within one business day to refine it.</p>
    <div style="margin:22px 0;padding:20px 22px;border:1px solid rgba(182,130,53,.4);border-radius:6px;text-align:center;">
      <div style="font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#b68235;margin-bottom:10px;">Preliminary estimate</div>
      <div style="font-size:26px;color:#eef1f6;">${money(est.low)} – ${money(est.high)}</div>
      <div style="color:#8b95ab;font-size:12px;margin-top:8px;">Reference ${inq.ref}</div>
    </div>
    <p style="margin:0;color:#6f7994;font-size:12px;line-height:1.6;">This is an indicative range generated from the
    details you provided — not a formal quote, proposal, or professional advice. Final pricing follows a scoping conversation.</p>`);

  const team = process.env.TEAM_INBOX || SITE.email;
  const teamOk = await send(team, `New inquiry · ${inq.ref} · ${inq.practice}`, teamHtml, inq.email);
  await send(inq.email, `Your estimate from Like a King Inc. · ${inq.ref}`, visitorHtml);
  return teamOk;
}
