/**
 * /api/agent/* - the chat console, over LM Studio or Anthropic.
 *
 * Two providers, one wire format. The browser should not care which brain is
 * answering, so both upstreams are normalised to the same event stream:
 *
 *   {"type":"reasoning","text":"..."}   thinking, for the collapsed panel
 *   {"type":"delta","text":"..."}       answer text
 *   {"type":"done","usage":{...}}
 *   {"type":"error","message":"..."}
 *
 * Reasoning is split out rather than passed through. A local model running the
 * RegesCore template emits <think>...</think> inline, and a UI that renders the
 * raw stream shows the model's scratchpad as the answer. The splitter holds
 * back any partial tag at a chunk boundary - "<thi" arriving at the end of one
 * chunk must not be printed as text and must not be lost either.
 *
 * The API key never reaches the browser. The dashboard talks to this route and
 * this route talks to Anthropic, so opening the dashboard on the LAN does not
 * hand out the key.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
'use strict'

const { SSEStream, readSSE } = require('../sse')

const LMSTUDIO_URL = process.env.REGESCORE_LMSTUDIO_URL || 'http://127.0.0.1:2126/v1'
const ANTHROPIC_URL = process.env.REGESCORE_ANTHROPIC_URL || 'https://api.anthropic.com/v1'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_ANTHROPIC_MODEL = process.env.REGESCORE_ANTHROPIC_MODEL || 'claude-sonnet-4-5'

/**
 * Splits <think> blocks out of a token stream.
 *
 * The hard case is a tag straddling a chunk boundary. Any trailing run that
 * could still become a tag is held back and prepended to the next chunk, so a
 * tag is never half-printed and never dropped. On flush the held text is
 * released, because at end of stream it was ordinary text after all.
 */
class ThinkSplitter {
  constructor() {
    this.buffer = ''
    this.inside = false
  }

  // Longest suffix of `text` that is a proper prefix of `tag`.
  static partialSuffix(text, tag) {
    const max = Math.min(text.length, tag.length - 1)
    for (let n = max; n > 0; n--) {
      if (text.endsWith(tag.slice(0, n))) return n
    }
    return 0
  }

  push(chunk) {
    this.buffer += chunk
    const events = []

    for (;;) {
      const tag = this.inside ? '</think>' : '<think>'
      const at = this.buffer.indexOf(tag)

      if (at === -1) {
        const hold = ThinkSplitter.partialSuffix(this.buffer, tag)
        const emit = this.buffer.slice(0, this.buffer.length - hold)
        this.buffer = this.buffer.slice(this.buffer.length - hold)
        if (emit) events.push({ type: this.inside ? 'reasoning' : 'delta', text: emit })
        return events
      }

      const before = this.buffer.slice(0, at)
      if (before) events.push({ type: this.inside ? 'reasoning' : 'delta', text: before })
      this.buffer = this.buffer.slice(at + tag.length)
      this.inside = !this.inside
    }
  }

  flush() {
    const rest = this.buffer
    this.buffer = ''
    if (!rest) return []
    return [{ type: this.inside ? 'reasoning' : 'delta', text: rest }]
  }
}

// Anthropic wants system as a top-level field, OpenAI as a leading message.
function splitSystem(messages) {
  const system = []
  const rest = []
  for (const message of messages || []) {
    if (!message || typeof message !== 'object') continue
    const content = typeof message.content === 'string' ? message.content : ''
    if (message.role === 'system') { if (content) system.push(content) }
    else if (message.role === 'user' || message.role === 'assistant') {
      rest.push({ role: message.role, content })
    }
  }
  return { system: system.join('\n\n'), messages: rest }
}

async function streamLMStudio(body, out, signal) {
  const { system, messages } = splitSystem(body.messages)
  const payload = {
    model: body.model || 'local-model',
    stream: true,
    temperature: body.temperature ?? 0.7,
    max_tokens: body.max_tokens ?? 4096,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
  }

  const response = await fetch(`${LMSTUDIO_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`LM Studio ${response.status}: ${detail.slice(0, 500)}`)
  }

  const splitter = new ThinkSplitter()
  let usage = null

  for await (const event of readSSE(response.body)) {
    if (event.data === '[DONE]') break
    let json
    try { json = JSON.parse(event.data) } catch { continue }
    if (json.usage) usage = json.usage

    const choice = json.choices && json.choices[0]
    if (!choice) continue
    const delta = choice.delta || {}

    // Some builds surface thinking on its own field; prefer it when present.
    if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
      out.send({ type: 'reasoning', text: delta.reasoning_content })
    }
    if (typeof delta.content === 'string' && delta.content) {
      for (const piece of splitter.push(delta.content)) out.send(piece)
    }
  }
  for (const piece of splitter.flush()) out.send(piece)
  return usage
}

async function streamAnthropic(body, out, signal) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server')

  const { system, messages } = splitSystem(body.messages)
  const payload = {
    model: body.model || DEFAULT_ANTHROPIC_MODEL,
    max_tokens: body.max_tokens ?? 4096,
    temperature: body.temperature ?? 0.7,
    stream: true,
    messages: messages.length ? messages : [{ role: 'user', content: '' }],
  }
  if (system) payload.system = system

  const response = await fetch(`${ANTHROPIC_URL}/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Anthropic ${response.status}: ${detail.slice(0, 500)}`)
  }

  let usage = null
  let blockType = 'text'

  for await (const event of readSSE(response.body)) {
    let json
    try { json = JSON.parse(event.data) } catch { continue }

    if (json.type === 'content_block_start') {
      blockType = (json.content_block && json.content_block.type) || 'text'
    } else if (json.type === 'content_block_delta') {
      const delta = json.delta || {}
      if (delta.type === 'thinking_delta' && delta.thinking) {
        out.send({ type: 'reasoning', text: delta.thinking })
      } else if (delta.type === 'text_delta' && delta.text) {
        out.send({ type: blockType === 'thinking' ? 'reasoning' : 'delta', text: delta.text })
      }
    } else if (json.type === 'message_delta' && json.usage) {
      usage = json.usage
    } else if (json.type === 'error') {
      throw new Error((json.error && json.error.message) || 'anthropic stream error')
    }
  }
  return usage
}

async function listModels(provider) {
  if (provider === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY
    if (!key) return { provider, models: [], error: 'ANTHROPIC_API_KEY is not set' }
    const response = await fetch(`${ANTHROPIC_URL}/models`, {
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
    })
    if (!response.ok) return { provider, models: [], error: `HTTP ${response.status}` }
    const json = await response.json()
    return { provider, models: (json.data || []).map((m) => m.id) }
  }

  const response = await fetch(`${LMSTUDIO_URL}/models`)
  if (!response.ok) return { provider: 'lmstudio', models: [], error: `HTTP ${response.status}` }
  const json = await response.json()
  return { provider: 'lmstudio', models: (json.data || []).map((m) => m.id) }
}

function mount(app) {
  app.get('/api/agent/models', async (req, res) => {
    const provider = req.query.provider === 'anthropic' ? 'anthropic' : 'lmstudio'
    try {
      res.json(await listModels(provider))
    } catch (error) {
      res.json({ provider, models: [], error: String(error && error.message) })
    }
  })

  app.post('/api/agent/chat', async (req, res) => {
    const body = req.body || {}
    const provider = body.provider === 'anthropic' ? 'anthropic' : 'lmstudio'
    const out = new SSEStream(res)

    // Abort the upstream when the browser navigates away, so a closed tab does
    // not leave a generation running against the GPU.
    const controller = new AbortController()
    res.on('close', () => controller.abort())

    try {
      out.send({ type: 'start', provider, model: body.model || null })
      const usage = provider === 'anthropic'
        ? await streamAnthropic(body, out, controller.signal)
        : await streamLMStudio(body, out, controller.signal)
      out.send({ type: 'done', usage: usage || null })
    } catch (error) {
      if (!controller.signal.aborted) {
        out.send({ type: 'error', message: String(error && error.message || error) })
      }
    } finally {
      out.end()
    }
  })
}

module.exports = { mount, ThinkSplitter, splitSystem, listModels }
