/**
 * /api/services/* - health sweep across every service in the registry.
 *
 * The whole point of the Services screen is answering "what is actually up"
 * in one glance, so the sweep runs every probe concurrently and bounds each
 * one. A single hung service must not hold the sweep: a Docker container that
 * accepts the TCP connection and then never answers would otherwise stall the
 * whole page behind the default socket timeout.
 *
 * Any HTTP response at all counts as up, including 401, 404 and 500. A service
 * that returns 404 on the probe path is running - it answered. Requiring 2xx
 * would paint half the registry red for having no health route.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
'use strict'

const { SERVICES, BY_ID, baseUrl, probeUrl } = require('../registry')

const PROBE_TIMEOUT_MS = Number(process.env.REGESCORE_PROBE_TIMEOUT_MS || 2500)

// A sweep is cheap but not free, and the Command screen polls. Serving a
// recent result to concurrent callers keeps 30 probes from running per client.
const CACHE_MS = Number(process.env.REGESCORE_PROBE_CACHE_MS || 4000)
let cache = { at: 0, data: null, inflight: null }

async function probe(service, host) {
  const url = probeUrl(service, host)
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { accept: '*/*' },
    })
    return {
      id: service.id,
      name: service.name,
      kind: service.kind,
      port: service.port,
      repo: service.repo || null,
      what: service.what,
      docker: Boolean(service.docker),
      url: baseUrl(service, host),
      status: 'up',
      httpStatus: response.status,
      latencyMs: Date.now() - started,
      error: null,
    }
  } catch (error) {
    // Distinguish "nothing is listening" from "listening but too slow". They
    // need different fixes and the dashboard should not conflate them.
    const aborted = error && (error.name === 'AbortError' || error.name === 'TimeoutError')
    return {
      id: service.id,
      name: service.name,
      kind: service.kind,
      port: service.port,
      repo: service.repo || null,
      what: service.what,
      docker: Boolean(service.docker),
      url: baseUrl(service, host),
      status: aborted ? 'timeout' : 'down',
      httpStatus: null,
      latencyMs: Date.now() - started,
      error: aborted ? `no response within ${PROBE_TIMEOUT_MS}ms` : String(error && error.message || error),
    }
  } finally {
    clearTimeout(timer)
  }
}

async function sweep(host) {
  const results = await Promise.all(SERVICES.map((service) => probe(service, host)))
  const up = results.filter((r) => r.status === 'up')
  return {
    services: results,
    summary: {
      total: results.length,
      up: up.length,
      down: results.filter((r) => r.status === 'down').length,
      timeout: results.filter((r) => r.status === 'timeout').length,
      // Called out separately: these are red because Docker is missing, which
      // is a different job from debugging a crashed service.
      awaitingDocker: results.filter((r) => r.status !== 'up' && r.docker).length,
    },
    timestamp: Date.now(),
  }
}

// Collapses a burst of concurrent requests onto one sweep.
async function cachedSweep(host) {
  if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data
  if (cache.inflight) return cache.inflight
  cache.inflight = sweep(host)
    .then((data) => { cache = { at: Date.now(), data, inflight: null }; return data })
    .catch((error) => { cache.inflight = null; throw error })
  return cache.inflight
}

function mount(app) {
  app.get('/api/services/status', async (req, res) => {
    try {
      const data = req.query.fresh ? await sweep(req.query.host) : await cachedSweep(req.query.host)
      res.json(data)
    } catch (error) {
      res.status(500).json({ error: String(error && error.message) })
    }
  })

  app.get('/api/services/registry', (req, res) => {
    res.json({ services: SERVICES, timestamp: Date.now() })
  })

  app.get('/api/services/:id', async (req, res) => {
    const service = BY_ID.get(req.params.id)
    if (!service) return res.status(404).json({ error: `unknown service: ${req.params.id}` })
    res.json(await probe(service, req.query.host))
  })
}

module.exports = { mount, probe, sweep, cachedSweep }
