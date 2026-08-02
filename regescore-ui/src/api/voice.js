/**
 * /api/voice/* - one voice surface over two backends.
 *
 * The dashboard should not care whether Voicebox (:8000) or the edge-tts voice
 * server (:17493) is answering. Both expose /profiles, /speak and /transcribe;
 * this picks one, falls back to the other when the preferred engine is not
 * running, and reports which one actually served the request so the UI can
 * label it honestly.
 *
 * Audio is streamed straight through rather than buffered. A minute of speech
 * is several megabytes, and buffering it delays the first sample until the last
 * one is generated.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
'use strict'

const { Readable } = require('stream')

const ENGINES = {
  voicebox: process.env.REGESCORE_VOICEBOX_URL || 'http://127.0.0.1:8000',
  edge: process.env.REGESCORE_VOICESERVER_URL || 'http://127.0.0.1:17493',
}

const REACH_TIMEOUT_MS = 1500

async function reachable(base) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REACH_TIMEOUT_MS)
  try {
    const response = await fetch(`${base}/profiles`, { signal: controller.signal })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve the engine to use. An explicit choice is honoured even if the probe
 * fails - the caller may know it is starting up - but the preferred-then-other
 * order applies when nothing was specified.
 */
async function pick(preferred) {
  if (preferred && ENGINES[preferred]) {
    return { engine: preferred, base: ENGINES[preferred] }
  }
  for (const engine of ['voicebox', 'edge']) {
    if (await reachable(ENGINES[engine])) return { engine, base: ENGINES[engine] }
  }
  return null
}

function normaliseProfiles(payload) {
  const list = Array.isArray(payload) ? payload : (payload.profiles || payload.voices || [])
  return list
    .map((item) => {
      if (typeof item === 'string') return { id: item, name: item }
      if (!item || typeof item !== 'object') return null
      const id = item.id || item.name || item.voice || item.short_name
      if (!id) return null
      return { id, name: item.name || item.display_name || id, meta: item }
    })
    .filter(Boolean)
}

function mount(app) {
  app.get('/api/voice/engines', async (req, res) => {
    const entries = await Promise.all(
      Object.entries(ENGINES).map(async ([engine, base]) => ({
        engine, url: base, up: await reachable(base),
      }))
    )
    res.json({ engines: entries, timestamp: Date.now() })
  })

  app.get('/api/voice/profiles', async (req, res) => {
    const chosen = await pick(req.query.engine)
    if (!chosen) {
      return res.status(503).json({
        error: 'no voice engine is reachable',
        tried: ENGINES,
        profiles: [],
      })
    }
    try {
      const response = await fetch(`${chosen.base}/profiles`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      res.json({ engine: chosen.engine, profiles: normaliseProfiles(payload) })
    } catch (error) {
      res.status(502).json({
        engine: chosen.engine, profiles: [], error: String(error && error.message),
      })
    }
  })

  app.post('/api/voice/speak', async (req, res) => {
    const body = req.body || {}
    const text = String(body.text || '').trim()
    if (!text) return res.status(400).json({ error: 'text is required' })

    const chosen = await pick(body.engine)
    if (!chosen) return res.status(503).json({ error: 'no voice engine is reachable', tried: ENGINES })

    try {
      const upstream = await fetch(`${chosen.base}/speak`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: body.voice || body.profile || undefined,
          rate: body.rate,
          pitch: body.pitch,
        }),
      })
      if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '')
        return res.status(502).json({
          engine: chosen.engine,
          error: `${chosen.engine} ${upstream.status}`,
          detail: detail.slice(0, 500),
        })
      }
      res.setHeader('content-type', upstream.headers.get('content-type') || 'audio/mpeg')
      res.setHeader('x-regescore-voice-engine', chosen.engine)
      if (!upstream.body) return res.end()
      // Streamed, so playback can start before synthesis finishes.
      Readable.fromWeb(upstream.body).pipe(res)
    } catch (error) {
      res.status(502).json({ engine: chosen.engine, error: String(error && error.message) })
    }
  })

  app.post('/api/voice/transcribe', async (req, res) => {
    const chosen = await pick(req.query.engine)
    if (!chosen) return res.status(503).json({ error: 'no voice engine is reachable', tried: ENGINES })
    try {
      const upstream = await fetch(`${chosen.base}/transcribe`, {
        method: 'POST',
        headers: { 'content-type': req.headers['content-type'] || 'application/json' },
        body: JSON.stringify(req.body || {}),
      })
      const text = await upstream.text()
      res.status(upstream.status)
      res.setHeader('content-type', upstream.headers.get('content-type') || 'application/json')
      res.send(text)
    } catch (error) {
      res.status(502).json({ engine: chosen.engine, error: String(error && error.message) })
    }
  })
}

module.exports = { mount, ENGINES, normaliseProfiles, pick }
