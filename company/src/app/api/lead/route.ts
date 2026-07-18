import { NextRequest, NextResponse } from "next/server";
import { estimate } from "@/lib/pricing";
import { createInquiry, newRef } from "@/lib/store";
import { notifyTeamAndVisitor } from "@/lib/email";
import type { LeadInput } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public lead endpoint. Flow (ported from backend/submit.php):
 * validate → estimate (brain/rate-card) → save → email team + auto-reply visitor.
 */
export async function POST(req: NextRequest) {
  let body: LeadInput;
  try {
    body = (await req.json()) as LeadInput;
  } catch {
    return NextResponse.json({ success: false, message: "Bad request." }, { status: 400 });
  }

  const get = (k: keyof LeadInput) => String((body[k] ?? "") as string).trim();

  // Honeypot — bots fill hidden fields.
  if (get("website") !== "") {
    return NextResponse.json({ success: true, ref: "noop" });
  }

  const inq: LeadInput = {
    name: get("name"),
    email: get("email"),
    company: get("company"),
    phone: get("phone"),
    practice: get("practice"),
    budget: get("budget"),
    timeline: get("timeline"),
    source: get("source"),
    details: get("details"),
    channel: (get("channel") as "form" | "reges") || "form",
  };

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inq.email);
  if (!inq.name || !emailOk || !inq.details) {
    return NextResponse.json(
      { success: false, message: "Name, a valid email, and project details are required." },
      { status: 422 }
    );
  }

  const est = await estimate(inq);

  const saved = createInquiry({
    ref: newRef(),
    name: inq.name,
    email: inq.email,
    company: inq.company || "",
    phone: inq.phone || "",
    practice: inq.practice,
    budget: inq.budget || "",
    timeline: inq.timeline || "",
    source: inq.source || "",
    details: inq.details,
    channel: inq.channel || "form",
    status: "new",
    ai_low: est.low,
    ai_expected: est.expected,
    ai_high: est.high,
    ai_confidence: est.confidence,
    ai_rationale: est.rationale,
    ai_breakdown: est.breakdown,
    quote_amount: null,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "",
  });

  let mailOk = false;
  try {
    mailOk = await notifyTeamAndVisitor(saved, est);
  } catch {
    /* email is best-effort */
  }

  return NextResponse.json({
    success: true,
    ref: saved.ref,
    mail: mailOk,
    estimate: {
      low: est.low,
      expected: est.expected,
      high: est.high,
      confidence: est.confidence,
      rationale: est.rationale,
    },
  });
}
