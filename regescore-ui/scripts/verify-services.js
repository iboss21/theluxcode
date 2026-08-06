/**
 * Verify that the service detail screen and the armory show live data.
 *
 * Two phases, because "shows the truth" and "the buttons work" need different
 * setups and conflating them hides failures in both:
 *
 *   A - against the real server, nothing intercepted. Clicks the rail's
 *       [data-item][data-svc] entries and asserts the rendered state matches
 *       /api/services/status and, where the two disagree, that it is NOT the
 *       export's hardcoded value. Also asserts the honest no-data state on the
 *       armory, whose route this server does not have.
 *
 *   B - with /api/armory, /api/armory/toggle, /api/services/launch and
 *       /api/meta stubbed, so the toggle and launch POSTs can be observed.
 *       Phase B proves the wiring; only phase A proves the honesty.
 *
 * Usage:  node scripts/verify-services.js            # http://127.0.0.1:3000
 *         TARGET=http://127.0.0.1:3999/ node scripts/verify-services.js
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
const { chromium } = require('playwright')

const URL = process.env.TARGET || 'http://127.0.0.1:3000/'
// Pinned to the Chromium already on the image, as verify-render.js does: the
// npm playwright build may want a browser that is not installed and
// downloading one is slow and unnecessary.
const EXEC = process.env.CHROME_PATH || '/opt/pw-browsers/chromium'

// The rail entries to exercise. `note` records what the export hardcodes, so a
// pass is visibly a pass against the design's own value and not a tautology.
const CASES = [
  { id: 'regescore', note: 'export: ONLINE' },
  { id: 'voiceserver', note: 'export: ONLINE' },
  { id: 'sia', note: 'export: ONLINE' },
  { id: 'excalidraw', note: 'export: ONLINE' },
  { id: 'n8n', note: 'export: OFFLINE' },
  { id: 'agentmemorysvc', note: 'export: OFFLINE, live id agentmemory' },
  { id: 'twentycrm', note: 'export: NEEDS DOCKER, live id twenty' },
  { id: 'nextcloud', note: 'export: NEEDS DOCKER' },
  { id: 'benchmarks', note: 'export: REFERENCE, no port, not probed' },
  { id: 'mcpshopline', note: 'export: NOT INTEGRATED, no port, not probed' },
]

const results = []
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '\n          ' + detail : ''))
}

/** Read everything the detail screen is currently claiming. */
const readDetail = () => {
  const sec = document.querySelector('[data-scr="service"]')
  if (!sec || sec.style.display === 'none') return { visible: false }
  const h1 = sec.querySelector('h1')
  const buttons = []
  sec.querySelectorAll('div').forEach((d) => {
    if (d.children.length === 0 && d.textContent.trim()) buttons.push(d.textContent.trim())
  })
  return {
    visible: true,
    name: h1 ? h1.textContent.trim() : null,
    eyebrow: h1 && h1.previousElementSibling ? h1.previousElementSibling.textContent.trim() : null,
    text: (sec.innerText || '').replace(/\s+/g, ' ').trim(),
    leaves: buttons,
  }
}

/** Open the rail group holding a service entry, then click the entry itself. */
async function openService(page, id) {
  const group = await page.evaluate((svc) => {
    const it = document.querySelector('[data-item][data-svc="' + svc + '"]')
    if (!it) return null
    const box = it.closest('[data-group]')
    return box ? box.dataset.group : null
  }, id)
  if (group) {
    const head = page.locator('[data-grouphead="' + group + '"]')
    if (await head.count()) {
      const open = await page.evaluate((g) => {
        const box = document.querySelector('[data-group="' + g + '"]')
        return !!box && box.style.display !== 'none'
      }, group)
      if (!open) await head.first().click()
    }
  }
  const item = page.locator('[data-item][data-svc="' + id + '"]').first()
  await item.waitFor({ state: 'visible', timeout: 8000 })
  await item.click()
  await page.waitForTimeout(450)
}

// -- phase A: the real server, nothing intercepted ---------------------------
async function phaseA(browser) {
  console.log('\n=== PHASE A  live server, no interception  ' + URL)
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 240)))

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
  // The dc runtime loads React, compiles with Babel, then mounts; the bridge
  // then polls once. Wait for the bridge to report a phase rather than sleeping
  // a guessed amount.
  await page.waitForFunction(
    () => window.__fleetServices && window.__fleetServices.phase !== 'probing',
    null, { timeout: 45000 },
  ).catch(() => {})

  const bridge = await page.evaluate(() => {
    const f = window.__fleetServices
    if (!f) return null
    return {
      phase: f.phase, statusUrl: f.statusUrl, armoryUrl: f.armoryUrl,
      launchUrl: f.launchUrl === undefined ? '(undetermined)' : f.launchUrl,
      live: f.live,
      baselineStates: Object.keys(f.baseline || {}).reduce((acc, k) => {
        acc[k] = f.baseline[k].svcState; return acc
      }, {}),
      baselineCount: Object.keys(f.baseline || {}).length,
    }
  })

  check('bridge attached to the export instance', !!bridge,
    bridge ? 'phase=' + bridge.phase + ' status=' + bridge.statusUrl : 'window.__fleetServices missing')
  if (!bridge) { await page.close(); return { errors } }

  check('harvested all 21 SERVICES entries from the export', bridge.baselineCount === 21,
    'harvested ' + bridge.baselineCount)
  check('adopted a status route', bridge.phase === 'live' && !!bridge.statusUrl,
    'phase=' + bridge.phase + ' url=' + bridge.statusUrl)
  check('launch route resolved from /api/meta as absent', bridge.launchUrl === null,
    'launchUrl=' + JSON.stringify(bridge.launchUrl))

  const liveIds = Object.keys(bridge.live || {})
  console.log('\n  live probe results the bridge resolved (' + liveIds.length + ' of 21 export ids):')
  liveIds.forEach((k) => {
    const l = bridge.live[k]
    console.log('    ' + k.padEnd(16) + l.state.padEnd(14) + ':' + String(l.port || '-').padEnd(7) +
      'http=' + String(l.httpStatus) + ' ' + String(l.latencyMs) + 'ms')
  })
  console.log('')

  let differed = 0
  for (const c of CASES) {
    await openService(page, c.id)
    const d = await page.evaluate(readDetail)
    const l = bridge.live[c.id] || null
    const base = bridge.baselineStates[c.id]

    if (!d.visible) { check(c.id + ' detail screen shown', false, 'service screen not visible'); continue }

    if (!l) {
      // Not probed: either not a network service, or no live row. Both must
      // read as such, and must never read as a reachability claim.
      const notNetworked = c.id === 'benchmarks' || c.id === 'mcpshopline'
      const ok = notNetworked
        ? d.text.indexOf('NOT A NETWORK SERVICE') !== -1 && d.text.indexOf('NOT APPLICABLE') !== -1
        : d.text.indexOf('NO DATA') !== -1 && d.text.indexOf('NOT PROBED') !== -1
      check(c.id + ' shows an explicit not-probed state  [' + c.note + ']', ok,
        'eyebrow=' + JSON.stringify(d.eyebrow))
      continue
    }

    const expected = l.state
    const shownExpected = d.eyebrow && d.eyebrow.indexOf('· ' + expected) !== -1
    const notBaseline = expected === base ? null : d.text.indexOf(base) === -1
    if (expected !== base) differed++

    check(c.id + ' renders live state ' + expected + '  [' + c.note + ']',
      shownExpected && notBaseline !== false,
      'eyebrow=' + JSON.stringify(d.eyebrow) +
      (expected === base ? '  (live and export agree here)' : '  export said ' + base + ', not rendered: ' + notBaseline))

    if (l.port) {
      check(c.id + ' renders the live port :' + l.port, d.text.indexOf(':' + l.port) !== -1,
        'looking for :' + l.port)
    }
    const ctaOk = expected === 'ONLINE'
      ? d.leaves.indexOf('OPEN') !== -1
      : d.leaves.some((t) => /NOT REACHABLE|DOCKER REQUIRED|START SERVICE|RE-PROBE|NO STATUS DATA/.test(t))
    check(c.id + ' CTA matches the live state', ctaOk, 'buttons=' + JSON.stringify(d.leaves.slice(0, 6)))
  }
  check('at least one service contradicts the export\'s hardcoded state', differed >= 3,
    differed + ' of ' + CASES.length + ' cases differ from the export')

  // The online CTA must open the service, not flash a fake toast.
  await openService(page, 'regescore')
  const popup = await Promise.all([
    page.waitForEvent('popup', { timeout: 5000 }).catch(() => null),
    page.locator('[data-scr="service"]').getByText('OPEN', { exact: true }).first().click(),
  ]).then((r) => r[0])
  check('online CTA opens the live url in a new tab',
    !!popup && /127\.0\.0\.1:3\d\d\d/.test(popup.url()),
    popup ? 'opened ' + popup.url() : 'no popup')
  if (popup) await popup.close()

  // Armory: this server has no /api/armory, so the export's placeholder
  // catalogue must be hidden and the gap stated.
  await page.locator('[data-item][data-goto="armory"]').first().click()
  await page.waitForTimeout(700)
  const armory = await page.evaluate(() => {
    const sec = document.querySelector('[data-scr="armory"]')
    const host = document.getElementById('fleet-armory-live')
    const hidden = sec ? sec.querySelector('[data-armory-live]') : null
    let staticVisible = false
    if (hidden) {
      for (const kid of hidden.children) {
        if (getComputedStyle(kid).display !== 'none') staticVisible = true
      }
    }
    return {
      hostText: host ? (host.innerText || '').replace(/\s+/g, ' ').trim() : null,
      gridMarked: !!hidden,
      staticVisible,
      tiles: sec ? Array.from(sec.children).filter((c) => (c.getAttribute('style') || '').indexOf('repeat(4') !== -1)
        .map((row) => Array.from(row.children).map((t) => t.children[1] && t.children[1].textContent))[0] : null,
      exportPlaceholderVisible: (sec ? sec.innerText : '').indexOf('lxr-voicemod') !== -1,
    }
  })
  check('armory hides the export placeholder cards when /api/armory is absent',
    armory.gridMarked && !armory.staticVisible && !armory.exportPlaceholderVisible,
    JSON.stringify({ gridMarked: armory.gridMarked, staticVisible: armory.staticVisible }))
  check('armory states the gap instead of inventing a catalogue',
    !!armory.hostText && /UNAVAILABLE/.test(armory.hostText),
    JSON.stringify(armory.hostText))
  check('armory count tiles read as no-data',
    !!armory.tiles && armory.tiles.every((t) => t === '—'),
    'tiles=' + JSON.stringify(armory.tiles))

  await page.screenshot({ path: '/tmp/verify-services-A.png' })
  await page.close()
  return { errors }
}

// -- phase B: stubbed routes, to observe the POSTs ---------------------------
const ARMORY_FIXTURE = {
  tools: [
    { id: 'lxr-voicemod', name: 'lxr-voicemod', description: 'Voicebox engine', enabled: true, lang: 'py', size: '41k', repo: 'https://github.com/jamiepine/voicebox' },
    { id: 'socrates', name: 'socrates', description: 'Knowledge graph store', enabled: false, lang: 'rs', size: '28k' },
    { id: 'stripeforge', name: 'stripeforge', description: 'Finance connector', enabled: true, lang: 'ts', size: '12k' },
  ],
}

async function phaseB(browser) {
  console.log('\n=== PHASE B  /api/armory, /api/armory/toggle, /api/services/launch stubbed')
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const posts = []
  const enabled = { 'lxr-voicemod': true, socrates: false, stripeforge: true }

  await page.route('**/api/armory', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      tools: ARMORY_FIXTURE.tools.map((t) => Object.assign({}, t, { enabled: enabled[t.id] })),
    }),
  }))
  await page.route('**/api/armory/toggle', (route) => {
    const body = JSON.parse(route.request().postData() || '{}')
    posts.push({ url: '/api/armory/toggle', body })
    if (body.id in enabled) enabled[body.id] = !enabled[body.id]
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, id: body.id }) })
  })
  await page.route('**/api/services/launch', (route) => {
    posts.push({ url: '/api/services/launch', body: JSON.parse(route.request().postData() || '{}') })
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  // Publish the launch route so the CTA offers START rather than NOT REACHABLE.
  await page.route('**/api/meta', async (route) => {
    const res = await route.fetch()
    const json = await res.json().catch(() => ({}))
    json.routes = (json.routes || []).concat(['POST /api/services/launch'])
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) })
  })

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(
    () => window.__fleetServices && window.__fleetServices.phase !== 'probing' &&
      window.__fleetServices.launchUrl !== undefined,
    null, { timeout: 45000 },
  ).catch(() => {})

  const bridgeB = await page.evaluate(() => ({
    launchUrl: window.__fleetServices.launchUrl,
    armoryUrl: window.__fleetServices.armoryUrl,
    items: window.__fleetServices.armoryItems,
  }))
  check('launch route adopted from the published route table', bridgeB.launchUrl === '/api/services/launch',
    'launchUrl=' + JSON.stringify(bridgeB.launchUrl))
  check('armory route adopted', !!bridgeB.armoryUrl && !!bridgeB.items && bridgeB.items.length === 3,
    'url=' + bridgeB.armoryUrl + ' items=' + (bridgeB.items || []).length)

  await page.locator('[data-item][data-goto="armory"]').first().click()
  await page.waitForTimeout(600)
  const cards = await page.evaluate(() => {
    const host = document.getElementById('fleet-armory-live')
    if (!host) return null
    return {
      names: Array.from(host.querySelectorAll('[data-armory-toggle]')).map((n) => n.getAttribute('data-armory-toggle')),
      labels: Array.from(host.querySelectorAll('[data-armory-toggle]')).map((n) => n.textContent.trim()),
      text: (host.innerText || '').replace(/\s+/g, ' ').trim(),
      tiles: Array.from(document.querySelector('[data-scr="armory"]').children)
        .filter((c) => (c.getAttribute('style') || '').indexOf('repeat(4') !== -1)
        .map((row) => Array.from(row.children).map((t) => t.children[1] && t.children[1].textContent))[0],
    }
  })
  check('armory renders a card per live registry entry',
    !!cards && cards.names.length === 3 && cards.names.indexOf('socrates') !== -1,
    JSON.stringify(cards && cards.names))
  check('armory card action reflects the live enabled flag',
    !!cards && cards.labels[0] === 'DISABLE →' && cards.labels[1] === 'ENABLE →',
    JSON.stringify(cards && cards.labels))
  check('armory count tiles come from the live registry',
    !!cards && cards.tiles[0] === '3' && cards.tiles[1] === '2',
    'tiles=' + JSON.stringify(cards && cards.tiles))

  await page.locator('[data-armory-toggle="socrates"]').first().click()
  await page.waitForTimeout(900)
  const toggled = await page.evaluate(() => {
    const n = document.querySelector('[data-armory-toggle="socrates"]')
    return n ? n.textContent.trim() : null
  })
  const togglePost = posts.filter((p) => p.url === '/api/armory/toggle')
  check('armory toggle POSTs {id} to /api/armory/toggle',
    togglePost.length === 1 && togglePost[0].body.id === 'socrates',
    JSON.stringify(togglePost))
  check('armory re-reads the server after a toggle instead of guessing',
    toggled === 'DISABLE →', 'socrates action now ' + JSON.stringify(toggled))

  // An offline service must POST {id} to the launch route.
  await openService(page, 'n8n')
  const cta = await page.evaluate(readDetail)
  check('offline CTA offers START SERVICE once a launch route exists',
    cta.leaves.indexOf('START SERVICE') !== -1, 'buttons=' + JSON.stringify(cta.leaves.slice(0, 6)))
  await page.locator('[data-scr="service"]').getByText('START SERVICE', { exact: true }).first().click()
  await page.waitForTimeout(700)
  const launchPost = posts.filter((p) => p.url === '/api/services/launch')
  check('offline CTA POSTs {id} to /api/services/launch',
    launchPost.length >= 1 && launchPost[0].body.id === 'n8n', JSON.stringify(launchPost))

  await page.screenshot({ path: '/tmp/verify-services-B.png' })
  await page.close()
}

;(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'], executablePath: EXEC })
  let errors = []
  try {
    const a = await phaseA(browser)
    errors = errors.concat(a.errors || [])
    await phaseB(browser)
  } finally {
    await browser.close()
  }

  const failed = results.filter((r) => !r.ok)
  console.log('\n=== ' + (results.length - failed.length) + ' passed, ' + failed.length + ' failed')
  if (errors.length) console.log('console errors:\n  ' + errors.slice(0, 8).join('\n  '))
  if (failed.length) { failed.forEach((f) => console.log('  FAILED: ' + f.name)); process.exit(1) }
})()
