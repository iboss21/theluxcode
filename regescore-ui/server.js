/**
 * RegesCore Command Center - server.
 *
 * Serves the new dashboard export and the /api/* surface it is wired to. One
 * process, no build step: the dashboard is a single .dc.html rendered by the dc
 * runtime in the browser, so replacing the design is a file copy.
 *
 * Two decisions worth knowing:
 *
 * The HTML is served from memory with the offline resource map injected, rather
 * than served as a static file. That keeps index.dc.html byte-identical to the
 * design-tool export - the next redesign drops in over it and nothing has to be
 * re-patched.
 *
 * Every service the dashboard talks to is reached through this server, not from
 * the browser. Browsers block cross-origin calls to :2126, :8000 and the rest,
 * and the alternative - enabling CORS on thirty services - is both more work and
 * worse security. It also means the Anthropic key stays server-side.
 *
 * Usage:
 *   node server.js                  # http://127.0.0.1:3000
 *   PORT=3100 node server.js
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
'use strict'

const express = require('express')
const fs = require('fs')
const path = require('path')

const { injectShim } = require('./src/resources')
const registry = require('./src/registry')
const system = require('./src/api/system')
const services = require('./src/api/services')
const agent = require('./src/api/agent')
const voice = require('./src/api/voice')

const app = express()
const PORT = Number(process.env.PORT || 3000)
const HOST = process.env.HOST || '127.0.0.1'
const PUBLIC = path.join(__dirname, 'public')
const INDEX = path.join(PUBLIC, 'index.dc.html')

app.disable('x-powered-by')
app.use(express.json({ limit: '16mb' }))
app.use(express.urlencoded({ extended: true, limit: '16mb' }))

// -- the dashboard -----------------------------------------------------
// Read once at boot, re-read when the file changes, so a redesign shows up on
// refresh without a restart while normal requests do no disk I/O.
let indexHtml = null
let indexMtime = 0

function loadIndex() {
  const stat = fs.statSync(INDEX)
  if (indexHtml && stat.mtimeMs === indexMtime) return indexHtml
  indexHtml = injectShim(fs.readFileSync(INDEX, 'utf8'))
  indexMtime = stat.mtimeMs
  return indexHtml
}

app.get(['/', '/index.html', '/index.dc.html'], (req, res) => {
  try {
    res.type('html').send(loadIndex())
  } catch (error) {
    res.status(500).type('text').send(
      `Cannot read ${INDEX}\n${error.message}\n\n` +
      'Copy the dashboard export to public/index.dc.html.'
    )
  }
})

app.use(express.static(PUBLIC, { index: false, maxAge: '1h' }))

// -- api ---------------------------------------------------------------
system.mount(app)
services.mount(app)
agent.mount(app)
voice.mount(app)

// Self-description, so the dashboard can render its own route table from the
// server rather than from a hardcoded list that drifts out of date.
app.get('/api/meta', (req, res) => {
  res.json({
    name: 'RegesCore Command Center',
    brand: 'RegesCore // Fable 5',
    author: 'davidio.dev',
    node: process.version,
    pid: process.pid,
    startedAt: STARTED_AT,
    uptimeSeconds: Math.round(process.uptime()),
    serviceCount: registry.SERVICES.length,
    providers: {
      lmstudio: process.env.REGESCORE_LMSTUDIO_URL || 'http://127.0.0.1:2126/v1',
      anthropic: process.env.ANTHROPIC_API_KEY ? 'configured' : 'no ANTHROPIC_API_KEY',
    },
    routes: listRoutes(),
  })
})

function listRoutes() {
  const out = []
  for (const layer of app._router.stack) {
    if (!layer.route) continue
    const methods = Object.keys(layer.route.methods).filter((m) => m !== '_all')
    for (const method of methods) out.push(`${method.toUpperCase()} ${layer.route.path}`)
  }
  return out.sort()
}

app.use('/api', (req, res) => res.status(404).json({ error: `no such route: ${req.path}` }))

const STARTED_AT = new Date().toISOString()

if (require.main === module) {
  app.listen(PORT, HOST, () => {
    const services_ = registry.SERVICES.length
    process.stdout.write(
      `\nRegesCore Command Center - davidio.dev\n` +
      `  dashboard : http://${HOST}:${PORT}/\n` +
      `  api meta  : http://${HOST}:${PORT}/api/meta\n` +
      `  registry  : ${services_} services\n` +
      `  anthropic : ${process.env.ANTHROPIC_API_KEY ? 'key present' : 'no ANTHROPIC_API_KEY (LM Studio only)'}\n\n`
    )
  })
}

module.exports = app
