/** REGES estimate — deterministic rate card (always), optional AI refine. */
const { RATES, PRACTICE_KEY } = require('./config')
const brain = require('./brain')

const round500 = (n) => Math.round(n / 500) * 500

function ruleCard(inq) {
  const practice = PRACTICE_KEY[inq.practice] || inq.practice || 'default'
  const rate = RATES.day_rate[practice] || RATES.day_rate.default
  const days = RATES.scope_days[inq.budget] || RATES.scope_days.default
  const tfac = RATES.timeline_factor[inq.timeline] || RATES.timeline_factor.default

  const text = (inq.details || '').toLowerCase()
  const weights = {
    integration: 0.06, compliance: 0.08, hipaa: 0.1, realtime: 0.06, 'real-time': 0.06,
    'machine learning': 0.08, llm: 0.08, migration: 0.07, 'multi-region': 0.08,
    legacy: 0.06, 'high availability': 0.07, 'zero trust': 0.07,
  }
  let cx = 1.0
  for (const kw in weights) if (text.includes(kw)) cx += weights[kw]
  cx = Math.min(cx, 1.5)

  const expected = round500(rate * days * tfac * cx)
  const spread = RATES.range_spread
  const low = round500(expected * (1 - spread))
  const high = round500(expected * (1 + spread))
  const confidence = (inq.budget || 'To be discussed') === 'To be discussed' ? 'medium' : text.length > 160 ? 'high' : 'medium'

  return {
    low, expected, high, confidence,
    rationale: `Rate-card estimate: ${days} consulting-days for ${practice} at $${rate}/day, timeline ×${tfac}, complexity ×${Math.round(cx * 100) / 100}. Refine after a scoping call.`,
    breakdown: { practice, day_rate: rate, scope_days: days, timeline_factor: tfac, complexity_factor: Math.round(cx * 100) / 100, source: 'rate-card' },
  }
}

async function estimate(inq) {
  const base = ruleCard(inq)
  if (!brain.enabled()) return base
  try {
    const schema = 'Return ONLY compact JSON: {"low":int,"expected":int,"high":int,"confidence":"low|medium|high","rationale":"one or two sentences"}. USD, no prose outside JSON.'
    const sys = `You are REGES, pricing engineer for Like a King Inc. A deterministic rate card produced a baseline. Adjust ONLY within ±30% if the request clearly warrants it. Baseline: ${JSON.stringify(base)}. ${schema}`
    const user = 'Inquiry:\n' + JSON.stringify({ practice: inq.practice, budget: inq.budget, timeline: inq.timeline, details: inq.details })
    const out = await brain.complete([{ role: 'system', content: sys }, { role: 'user', content: user }], { temperature: 0.2, maxTokens: 400 })
    const m = out && out.match(/\{[\s\S]*\}/)
    if (m) {
      const j = JSON.parse(m[0])
      if (j && j.expected)
        return {
          low: parseInt(j.low, 10) || base.low,
          expected: parseInt(j.expected, 10),
          high: parseInt(j.high, 10) || base.high,
          confidence: j.confidence || base.confidence,
          rationale: j.rationale || base.rationale,
          breakdown: Object.assign({}, base.breakdown, { source: 'ai:' + process.env.BRAIN_PROVIDER }),
        }
    }
  } catch {
    /* fall through */
  }
  return base
}

module.exports = { estimate, ruleCard }
