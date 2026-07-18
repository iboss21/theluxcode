/**
 * REGES growth brain — the two "Jarvis" behaviours that help the company make
 * money: the on-site concierge (qualifies visitors) and the per-lead
 * next-best-action (tells the operator who to chase and drafts the follow-up).
 * Both degrade to useful deterministic output when the brain is off/unreachable.
 */
import { brainComplete, brainEnabled, extractJson } from "./brain";
import type { Inquiry } from "./types";
import { SITE } from "./config";

const FIRM_FACTS = `Like a King Inc. is a professional business-services and corporate-technology firm.
Four practices: (1) Intelligent Systems & AI Engineering — assistants & autonomous agents, retrieval/RAG on private knowledge, automation & decisioning; (2) Digital Platforms & Product Engineering — cloud-native web platforms; (3) Cybersecurity & Risk Management — assessments, penetration testing, governance aligned to NIST, ISO 27001, SOC 2; (4) Cloud Infrastructure & Managed Services — AWS/Azure/GCP, automation, resilience, 24/7 monitoring.
Engagements start with a discovery consult; within a week the client gets a fixed-scope proposal or a phased roadmap. Every engagement includes a security review by default. Clients span finance, healthcare, retail, and professional services. We reply within one business day. Contact: ${SITE.email}.`;

/* ── Concierge ────────────────────────────────────────────────────────────── */
export type ChatTurn = { role: "user" | "assistant"; content: string };

const CONCIERGE_SYSTEM = `You are REGES, the concierge for ${SITE.name} — a scoped, guard-railed assistant that speaks ONLY for the firm.
Rules:
- Answer only about the firm, its four practices, how engagements work, security/compliance, and how to get an estimate. Politely decline anything else.
- Be concise (2–4 sentences), precise and calm. Never invent prices, client names, or guarantees.
- If the visitor describes a project or a need, briefly say which practice fits and encourage them to send the enquiry form for a tailored REGES estimate.
- Never handle sensitive data, credentials, or make legal/financial promises.
Firm facts:
${FIRM_FACTS}`;

const OFFLINE_REPLY =
  "I can point you to where our work fits and help you get a tailored estimate. Tell me the challenge you're facing, or send the enquiry form and the team will follow up within one business day.";

export async function conciergeReply(history: ChatTurn[], message: string): Promise<{
  reply: string;
  live: boolean;
}> {
  if (!brainEnabled()) return { reply: scriptedReply(message), live: false };
  const msgs = [
    { role: "system" as const, content: CONCIERGE_SYSTEM },
    ...history.slice(-8).map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: message },
  ];
  const out = await brainComplete(msgs, { temperature: 0.4, maxTokens: 320 });
  if (!out) return { reply: scriptedReply(message), live: false };
  return { reply: out.trim(), live: true };
}

/** Deterministic concierge — keyword routing to the right practice. */
function scriptedReply(message: string): string {
  const m = message.toLowerCase();
  const hit = (arr: string[]) => arr.some((k) => m.includes(k));
  if (hit(["ai", "agent", "llm", "rag", "chatbot", "automation", "model"]))
    return "That sounds like our Intelligent Systems & AI Engineering practice — assistants, retrieval on your private data, and automation wired into real workflows. Send the enquiry form and REGES will return a tailored estimate. " + OFFLINE_REPLY;
  if (hit(["secur", "pentest", "penetration", "compliance", "soc 2", "iso", "nist", "risk"]))
    return "Our Cybersecurity & Risk Management practice covers assessments, penetration testing, and governance aligned to NIST, ISO 27001, and SOC 2. Every engagement also includes a security review by default. " + OFFLINE_REPLY;
  if (hit(["cloud", "aws", "azure", "gcp", "infrastructure", "devops", "kubernetes"]))
    return "That maps to Cloud Infrastructure & Managed Services — AWS/Azure/GCP with automation, resilience, and 24/7 monitoring. " + OFFLINE_REPLY;
  if (hit(["website", "web", "platform", "product", "app", "frontend", "portal"]))
    return "That's our Digital Platforms & Product Engineering practice — cloud-native web platforms built for speed and long-term maintainability. " + OFFLINE_REPLY;
  return OFFLINE_REPLY;
}

/* ── Next-best-action (per lead) ──────────────────────────────────────────── */
export interface NextAction {
  action: string; // short imperative
  why: string; // one-line reasoning
  draft: string; // suggested follow-up message
  priority: "high" | "medium" | "low";
  live: boolean;
}

export async function nextBestAction(inq: Inquiry): Promise<NextAction> {
  const base = heuristicAction(inq);
  if (!brainEnabled()) return base;

  const sys =
    `You are REGES, revenue operations for ${SITE.name}. Given one CRM lead, decide the single next best action to move it toward a closed deal. ` +
    'Return ONLY JSON: {"action":"short imperative","why":"one line","draft":"a 2-3 sentence follow-up email to the client","priority":"high|medium|low"}.';
  const user = JSON.stringify({
    status: inq.status,
    practice: inq.practice,
    budget: inq.budget,
    timeline: inq.timeline,
    estimate: { low: inq.ai_low, expected: inq.ai_expected, high: inq.ai_high, confidence: inq.ai_confidence },
    days_since: daysSince(inq.created_at),
    notes: inq.notes.map((n) => n.body).slice(-5),
    details: inq.details,
    name: inq.name,
    company: inq.company,
  });
  const out = await brainComplete(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { temperature: 0.4, maxTokens: 400 }
  );
  const j = extractJson<any>(out);
  if (!j || !j.action) return base;
  return {
    action: String(j.action),
    why: String(j.why || base.why),
    draft: String(j.draft || base.draft),
    priority: ["high", "medium", "low"].includes(j.priority) ? j.priority : base.priority,
    live: true,
  };
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** Deterministic next-best-action from status + age. */
export function heuristicAction(inq: Inquiry): NextAction {
  const age = daysSince(inq.created_at);
  const first = (inq.name || "there").split(" ")[0];
  const est = `$${(inq.ai_low || 0).toLocaleString()} – $${(inq.ai_high || 0).toLocaleString()}`;
  const rush = /immediate|urgent/i.test(inq.timeline || "");
  const priority: NextAction["priority"] = rush || age >= 2 ? "high" : age >= 1 ? "medium" : "low";

  switch (inq.status) {
    case "new":
      return {
        action: age >= 1 ? "Reply now — lead is aging" : "Send first response",
        why: `New ${inq.practice} lead, ${age}d old${rush ? ", urgent timeline" : ""}. First-response speed drives conversion.`,
        draft: `Hi ${first}, thank you for reaching out to Like a King Inc. about your ${inq.practice} project. Based on what you shared, our preliminary REGES estimate is ${est}. I'd love to set up a short discovery call this week to scope it precisely — what times work for you?`,
        priority,
        live: false,
      };
    case "reviewing":
      return {
        action: "Book the discovery call",
        why: "Lead is under review — convert interest into a scoped call before it cools.",
        draft: `Hi ${first}, following up on your ${inq.practice} enquiry. I've reviewed the details and can put together a fixed-scope proposal after a 30-minute discovery call. Are you free this week?`,
        priority,
        live: false,
      };
    case "quoted":
      return {
        action: age >= 3 ? "Chase the quote decision" : "Confirm the quote landed",
        why: `Quoted ${age}d ago. Silence after a quote usually means a question you can resolve.`,
        draft: `Hi ${first}, checking in on the proposal for your ${inq.practice} engagement (${est}). Happy to walk through scope, phasing, or adjust to fit budget — what would help you decide?`,
        priority: age >= 3 ? "high" : "medium",
        live: false,
      };
    case "won":
      return {
        action: "Kick off & look for expansion",
        why: "Deal won — protect delivery and watch for the next workstream.",
        draft: `Hi ${first}, excited to get started. I'll send the onboarding plan and our first-week milestones shortly. As we deliver, let's keep an eye on adjacent areas where we can help next.`,
        priority: "low",
        live: false,
      };
    default: // lost
      return {
        action: "Log the reason & nurture",
        why: "Marked lost — capture why and keep a light touch for future work.",
        draft: `Hi ${first}, understood, and thank you for considering us. If priorities shift on the ${inq.practice} work, we'd be glad to pick it back up. I'll check in down the road.`,
        priority: "low",
        live: false,
      };
  }
}
