/**
 * Offline shim for the dc runtime.
 *
 * support.js loads React, ReactDOM and Babel from unpkg. On a machine with no
 * outbound network - or one where the CDN is slow, blocked, or the SRI hash
 * stops matching after an unpkg republish - the dashboard renders nothing and
 * the console shows only "dc-runtime: window.React is not available yet".
 *
 * The runtime reads window.__resources first (see cdnScriptFor in support.js):
 * a URL present in that map is loaded from the mapped path, with no integrity
 * attribute. Pointing the three CDN URLs at vendored copies makes the whole
 * dashboard a local-first asset with no third-party fetch on the critical path.
 *
 * The map is injected at request time rather than written into the HTML, so
 * index.dc.html stays byte-identical to the design-tool export and can be
 * replaced wholesale on the next redesign without losing this.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
'use strict'

const fs = require('fs')
const path = require('path')

const PUBLIC = path.join(__dirname, '..', 'public')

const RESOURCES = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js':
    '/vendor/react.production.min.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js':
    '/vendor/react-dom.production.min.js',
  'https://unpkg.com/@babel/standalone@7.29.0/babel.min.js':
    '/vendor/babel.min.js',
}

// Injected before support.js, which is the first script in the document and
// reads the map as soon as it needs a global.
function shimTag(extra = {}) {
  const map = JSON.stringify({ ...RESOURCES, ...extra })
  return `<script>window.__resources=Object.assign(${map},window.__resources||{});</script>`
}

/**
 * Insert the shim ahead of the runtime. Anchored on the support.js tag rather
 * than on <head> so it lands after the charset meta and still precedes the only
 * consumer; if the export ever drops that tag, fall back to <head>.
 */
function injectShim(html, extra) {
  const tag = shimTag(extra)
  const anchor = html.indexOf('<script src="./support.js">')
  let out
  if (anchor !== -1) out = html.slice(0, anchor) + tag + '\n' + html.slice(anchor)
  else {
    const head = html.indexOf('<head>')
    out = head !== -1 ? html.slice(0, head + 6) + '\n' + tag + html.slice(head + 6) : tag + html
  }
  out = injectLive(out)
  // Brand-marks-as-home-buttons is still opt-in: it is unverified.
  return process.env.REGESCORE_ENHANCE === '1' ? injectEnhancements(out) : out
}

/**
 * Load order for the fleet layer. Not alphabetical, and not incidental:
 *
 *   fleet-live      first  - it owns the instance handle (StreamableComponent
 *                            .logic) and silences retarget()/pushLog(). Every
 *                            later script that writes a binding needs the
 *                            simulator already quiet, or frame() overwrites it.
 *   fleet-screens   next   - the single-purpose screens (memory, sessions,
 *                            tasks, journal, notes, graph, pdf, rag, email...)
 *   fleet-services  next   - the service list and the 21 detail pages
 *   fleet-tools     next   - voicebox, music, call, image, social, finance,
 *                            research, web, filesystem, convert, debate
 *   fleet-agent     last   - the console's tool-call loop, which drives the
 *                            other screens and so wants them already wired
 *
 * A file not named here still loads - between tools and agent, alphabetically -
 * so a new fleet-*.js is picked up without editing this list.
 */
const FLEET_FIRST = ['fleet-live.js', 'fleet-screens.js', 'fleet-services.js', 'fleet-tools.js']
const FLEET_LAST = 'fleet-agent.js'

/**
 * Which fleet scripts to inject, decided by what is on disk rather than by a
 * hardcoded list. Four agents write these files independently; a name in a
 * constant that nobody created yet becomes a 404 in the console on every load,
 * and a 404 in the console is indistinguishable from a broken script when you
 * are trying to find out why a screen is dead.
 */
function fleetScripts(dir = PUBLIC) {
  let names
  try { names = fs.readdirSync(dir) } catch { return [] }
  const rank = (name) => {
    const i = FLEET_FIRST.indexOf(name)
    if (i !== -1) return i
    return name === FLEET_LAST ? FLEET_FIRST.length + 1 : FLEET_FIRST.length
  }
  return names
    .filter((name) => /^fleet-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.js$/.test(name))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/**
 * The fleet layer and the scrollbar corrections. Both are additive - the live
 * bridge replaces the simulator's numbers through the component's own sim, the
 * screen scripts attach to the rendered DOM, the stylesheet only closes
 * browser-default gaps - so the export itself stays untouched and a redesign
 * inherits all of it.
 *
 * Disable with REGESCORE_LIVE=0 to see the design's own simulation again,
 * which is the fastest way to tell a data problem from a design problem, and
 * the first step when bisecting which fleet script broke a screen.
 *
 * The scan runs at injection time, and server.js only re-injects when
 * index.dc.html changes - so a fleet-*.js added while the server is up needs a
 * restart to be picked up. The file itself is served statically either way.
 */
function injectLive(html) {
  if (process.env.REGESCORE_LIVE === '0') return html
  const scripts = fleetScripts()
  let out = html

  const headClose = out.indexOf('</helmet>')
  if (headClose !== -1 && fs.existsSync(path.join(PUBLIC, 'polish.css'))) {
    const css = '<link rel="stylesheet" href="/polish.css">'
    out = out.slice(0, headClose) + css + '\n' + out.slice(headClose)
  }

  // Deferred, in list order: defer preserves document order between scripts,
  // so the rank above is the execution order and not just the markup order.
  const tags = scripts.map((name) => `<script src="/${name}" defer></script>`).join('\n')
  if (!tags) return out
  const bodyClose = out.lastIndexOf('</body>')
  return bodyClose !== -1
    ? out.slice(0, bodyClose) + tags + '\n' + out.slice(bodyClose)
    : out + tags
}

/**
 * Behaviour the export cannot carry: it attaches to the rendered DOM, so a new
 * export inherits it for free. Deferred and placed last so it never competes
 * with the runtime for the main thread during mount.
 */
function injectEnhancements(html) {
  const tag = '<script src="/enhance.js" defer></script>'
  const close = html.lastIndexOf('</body>')
  if (close !== -1) return html.slice(0, close) + tag + '\n' + html.slice(close)
  return html + tag
}

module.exports = { RESOURCES, shimTag, injectShim, fleetScripts }
