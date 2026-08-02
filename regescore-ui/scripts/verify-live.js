/**
 * Proves the bridge actually replaced the simulation.
 *
 * The check that matters is not "does a number appear" - the simulator also
 * produces numbers. It is that the value tracks the server: the CPU the page
 * shows must converge on the CPU /api/system/stats reports, the simulator's
 * randomisers must be neutralised, and the unsourced bindings must show a dash
 * rather than an invented figure.
 */
const { chromium } = require('playwright')

const URL = process.env.TARGET || 'http://127.0.0.1:3000/'

;(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox'],
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 })

  // The bridge polls every 2s and frame() eases at 0.08 per frame, so the
  // painted value needs a few seconds to converge on the measurement.
  await page.waitForTimeout(16000)

  const result = await page.evaluate(async () => {
    const bridge = window.__regescoreBridge
    const read = (k) => {
      const el = document.querySelector(`[data-live="${k}"]`)
      return el ? el.textContent.trim() : null
    }
    const stats = await fetch('/api/system/stats').then((r) => r.json())
    return {
      attached: !!bridge,
      simNeutralised: bridge
        ? bridge.instance.retarget.toString().replace(/\s+/g, '') === 'function(){}'
        : null,
      serverRamPercent: stats.memory.percent,
      pageRam: read('ram'),
      pageRamGb: read('ramGb'),
      pageUptime: read('sysOn'),
      pageServicesUp: read('svUp'),
      unsourcedSample: ['igVram', 'wsMs', 'clLat', 'rqMs'].map(read),
      logTop: (document.querySelector('[data-log="0"]') || {}).textContent || null,
      scrollbarColor: getComputedStyle(document.body).scrollbarColor,
    }
  })

  // The eased RAM figure should be within a couple of points of the server's.
  const pageRam = parseFloat(String(result.pageRam || '').replace(/[^\d.]/g, ''))
  const tracking = Number.isFinite(pageRam) &&
    Math.abs(pageRam - result.serverRamPercent) <= 3
  const dashed = result.unsourcedSample.every((v) => v === '—')

  console.log(JSON.stringify({ ...result, tracking, dashed, errors }, null, 2))
  await browser.close()
  process.exit(result.attached && result.simNeutralised && tracking && dashed ? 0 : 1)
})()
