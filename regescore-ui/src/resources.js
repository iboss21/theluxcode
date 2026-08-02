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
 * The live bridge and the scrollbar corrections. Both are additive - the
 * bridge replaces the simulator's numbers through the component's own
 * `liveData` seam, the stylesheet only closes browser-default gaps - so the
 * export itself stays untouched and a redesign inherits both.
 *
 * Disable with REGESCORE_LIVE=0 to see the design's own simulation again,
 * which is the fastest way to tell a data problem from a design problem.
 */
function injectLive(html) {
  if (process.env.REGESCORE_LIVE === '0') return html
  const css = '<link rel="stylesheet" href="/polish.css">'
  const js = '<script src="/live-bridge.js" defer></script>'
  const headClose = html.indexOf('</helmet>')
  let out = html
  if (headClose !== -1) out = html.slice(0, headClose) + css + '\n' + html.slice(headClose)
  const bodyClose = out.lastIndexOf('</body>')
  return bodyClose !== -1 ? out.slice(0, bodyClose) + js + '\n' + out.slice(bodyClose) : out + js
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

module.exports = { RESOURCES, shimTag, injectShim }
