import { RATES, PRACTICE_KEY } from "./config";
import { brainComplete, brainEnabled, extractJson } from "./brain";
import type { Estimate, LeadInput } from "./types";

/**
 * Two layers, ported from backend/ai.php:
 *  1) rate card — deterministic, always runs, grounded in config RATES.
 *  2) brain pass — optional model refinement within ±30%.
 * If the brain is off/unreachable, layer 1 stands alone.
 */
export async function estimate(inq: LeadInput): Promise<Estimate> {
  const base = ruleCard(inq);
  if (!brainEnabled()) return base;
  try {
    const refined = await brainRefine(inq, base);
    if (refined) return refined;
  } catch {
    /* fall through to deterministic */
  }
  return base;
}

const round500 = (n: number) => Math.round(n / 500) * 500;

/* ── Layer 1: deterministic rate card ─────────────────────────────────────── */
export function ruleCard(inq: LeadInput): Estimate {
  const practice = PRACTICE_KEY[inq.practice] ?? inq.practice ?? "default";
  const rate = RATES.day_rate[practice] ?? RATES.day_rate.default;
  const days = RATES.scope_days[inq.budget ?? "default"] ?? RATES.scope_days.default;
  const tfac =
    RATES.timeline_factor[inq.timeline ?? "default"] ?? RATES.timeline_factor.default;

  // Complexity read from the free-text details (keyword weighting).
  const text = (inq.details ?? "").toLowerCase();
  const weights: Record<string, number> = {
    integration: 0.06,
    compliance: 0.08,
    hipaa: 0.1,
    realtime: 0.06,
    "real-time": 0.06,
    "machine learning": 0.08,
    llm: 0.08,
    migration: 0.07,
    "multi-region": 0.08,
    legacy: 0.06,
    "high availability": 0.07,
    "zero trust": 0.07,
  };
  let cx = 1.0;
  for (const [kw, w] of Object.entries(weights)) if (text.includes(kw)) cx += w;
  cx = Math.min(cx, 1.5);

  const expected = round500(rate * days * tfac * cx);
  const spread = RATES.range_spread;
  const low = round500(expected * (1 - spread));
  const high = round500(expected * (1 + spread));

  const confidence: Estimate["confidence"] =
    (inq.budget ?? "To be discussed") === "To be discussed"
      ? "medium"
      : text.length > 160
      ? "high"
      : "medium";

  return {
    low,
    expected,
    high,
    confidence,
    rationale:
      `Rate-card estimate: ${days} consulting-days for ${practice} at $${rate}/day, ` +
      `timeline ×${tfac}, complexity ×${round(cx)}. Refine after a scoping call.`,
    breakdown: {
      practice,
      day_rate: rate,
      scope_days: days,
      timeline_factor: tfac,
      complexity_factor: round(cx),
      source: "rate-card",
    },
  };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

/* ── Layer 2: brain refinement ────────────────────────────────────────────── */
async function brainRefine(inq: LeadInput, base: Estimate): Promise<Estimate | null> {
  const schema =
    'Return ONLY compact JSON: {"low":int,"expected":int,"high":int,' +
    '"confidence":"low|medium|high","rationale":"one or two sentences"}. USD, no prose outside JSON.';
  const sys =
    "You are REGES, pricing engineer for Like a King Inc (AI/cloud/security consultancy). " +
    "A deterministic rate card produced a baseline. Adjust ONLY within ±30% if the request " +
    `clearly warrants it, and explain why. Baseline: ${JSON.stringify(base)}. ${schema}`;
  const user =
    "Inquiry:\n" +
    JSON.stringify({
      practice: inq.practice ?? "",
      budget: inq.budget ?? "",
      timeline: inq.timeline ?? "",
      details: inq.details ?? "",
    });

  const content = await brainComplete(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    { temperature: 0.2, maxTokens: 400 }
  );
  const j = extractJson<any>(content);
  if (!j || typeof j.expected === "undefined") return null;
  return {
    low: Number(j.low ?? base.low) | 0,
    expected: Number(j.expected) | 0,
    high: Number(j.high ?? base.high) | 0,
    confidence: j.confidence ?? base.confidence,
    rationale: j.rationale ?? base.rationale,
    breakdown: { ...base.breakdown, source: `ai:${process.env.BRAIN_PROVIDER}` },
  };
}
