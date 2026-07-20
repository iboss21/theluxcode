/**
 * AI client — free-first. Providers: off | groq | openrouter | gemini | cerebras
 * | mistral | together | openai | anthropic. Set BRAIN_PROVIDER + BRAIN_API_KEY.
 */
const PRESETS = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free' },
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  cerebras: { baseUrl: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b' },
  mistral: { baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  together: { baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free' },
}

function cfg() {
  // Runtime settings from the admin panel win over env.
  let s = {}
  try {
    s = require('./settings').getAll().ai || {}
  } catch {
    s = {}
  }
  const raw = String(s.provider || process.env.BRAIN_PROVIDER || 'off').toLowerCase()
  const apiKey = s.api_key || process.env.BRAIN_API_KEY || ''
  const timeout = Number(s.timeout_ms || process.env.BRAIN_TIMEOUT_MS || 25000)
  const preset = PRESETS[raw]
  if (preset) {
    return {
      wire: 'openai',
      baseUrl: s.base_url || process.env.BRAIN_BASE_URL || preset.baseUrl,
      apiKey,
      model: s.model || process.env.BRAIN_MODEL || preset.model,
      timeout,
    }
  }
  return {
    wire: ['openai', 'anthropic'].includes(raw) ? raw : 'off',
    baseUrl: s.base_url || process.env.BRAIN_BASE_URL || 'http://127.0.0.1:8000/v1',
    apiKey,
    model: s.model || process.env.BRAIN_MODEL || 'local-model',
    timeout,
  }
}

function enabled() {
  return cfg().wire !== 'off'
}

async function withTimeout(url, init, ms) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(url, Object.assign({}, init, { signal: ctrl.signal }))
  } finally {
    clearTimeout(t)
  }
}

/** messages: [{role, content}]; optional leading system message. Returns text or null. */
async function complete(messages, opts) {
  opts = opts || {}
  const c = cfg()
  if (c.wire === 'off') return null
  try {
    if (c.wire === 'anthropic') {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
      const rest = messages.filter((m) => m.role !== 'system')
      let base = (c.baseUrl || '').replace(/\/$/, '')
      if (!/\/v1$/.test(base)) base = 'https://api.anthropic.com/v1'
      const res = await withTimeout(base + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: c.model, max_tokens: opts.maxTokens || 512, temperature: opts.temperature ?? 0.4, system, messages: rest }),
      }, c.timeout)
      if (!res.ok) return null
      const d = await res.json()
      return (d.content && d.content[0] && d.content[0].text) || null
    }
    const headers = { 'Content-Type': 'application/json' }
    if (c.apiKey) headers.Authorization = 'Bearer ' + c.apiKey
    const res = await withTimeout(c.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: c.model, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens || 512, messages }),
    }, c.timeout)
    if (!res.ok) return null
    const d = await res.json()
    return (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || null
  } catch {
    return null
  }
}

module.exports = { cfg, enabled, complete }
