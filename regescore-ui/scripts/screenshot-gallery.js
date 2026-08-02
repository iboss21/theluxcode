/**
 * Full-page screenshot of every screen in the dashboard, plus an index page.
 *
 * Walks the export's own nav contract rather than a hand-kept list: every
 * [data-goto] value is a screen the UI can reach, so enumerating them is the
 * definition of "every link". Each is clicked through the app's real handler
 * (dispatched on the element, since the rail collapses and a synthetic mouse
 * click can miss a hidden item), then captured full-page.
 *
 * Two things are recorded per screen beyond the image, because a screenshot
 * alone cannot tell a working page from a blank one that merely rendered:
 * the element count, and whether the click actually changed the visible
 * [data-scr]. A screen that fails to activate is reported, not quietly
 * captured as whatever was on screen before.
 *
 *   node scripts/screenshot-gallery.js
 *   TARGET=http://127.0.0.1:3000/fleet/ OUT=./shots node scripts/screenshot-gallery.js
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

const TARGET = process.env.TARGET || 'http://127.0.0.1:3000/'
const OUT = path.resolve(process.env.OUT || 'shots')
const WIDTH = Number(process.env.WIDTH || 1600)
const HEIGHT = Number(process.env.HEIGHT || 1000)
const SETTLE_MS = Number(process.env.SETTLE_MS || 1100)

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })

  const browser = await chromium.launch({
    args: ['--no-sandbox'],
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  })
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } })

  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))

  await page.goto(TARGET, { waitUntil: 'load', timeout: 60000 })
  // React + Babel + mount, then the first animation settles.
  await page.waitForTimeout(10000)

  // The nav contract: data-goto on every reachable item, plus data-goto2 for
  // the secondary rails. Deduped, in DOM order, so the gallery reads like the
  // sidebar does.
  // Two kinds of destination, and they are NOT interchangeable:
  //
  //   [data-item][data-goto="x"]  a screen. Clicking sets screen x.
  //   [data-item][data-svc="id"]  a service. Clicking calls openService(id),
  //                               which sets svcKey and then screens to the
  //                               shared [data-scr="service"] detail page.
  //
  // Enumerating raw data-goto2 values and firing them is what NOT to do:
  // several name a service rather than a screen, so setScreen() lands on a
  // name with no [data-scr], the app renders nothing, and it stays blank for
  // every click after. Always click the nav item; never synthesise the
  // destination.
  const links = await page.evaluate(() => {
    const out = []
    const seen = new Set()
    document.querySelectorAll('[data-item][data-goto]').forEach((el) => {
      const v = el.getAttribute('data-goto')
      if (!v || el.hasAttribute('data-svc') || seen.has('s:' + v)) return
      seen.add('s:' + v)
      out.push({ kind: 'screen', key: v, expect: v, label: (el.getAttribute('data-item') || v).trim() })
    })
    document.querySelectorAll('[data-item][data-svc]').forEach((el) => {
      const v = el.getAttribute('data-svc')
      if (!v || seen.has('v:' + v)) return
      seen.add('v:' + v)
      // Every service resolves to the one shared detail screen.
      out.push({ kind: 'service', key: v, expect: 'service', label: (el.getAttribute('data-item') || v).trim() })
    })
    return out
  })

  const visible = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-scr]')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.getAttribute('data-scr'))
      .join(',')
  )

  console.log(`${links.length} links found; capturing to ${OUT}\n`)
  const results = []

  for (const [i, link] of links.entries()) {
    const before = await visible()
    // Click the nav item itself so the app's own handler runs - openService()
    // for a service, setScreen() for a screen. Synthesising the destination
    // is what produced the phantom "21 dead links" in the first run.
    const clicked = await page.evaluate((l) => {
      const sel = l.kind === 'service'
        ? `[data-item][data-svc="${l.key}"]`
        : `[data-item][data-goto="${l.key}"]`
      const el = document.querySelector(sel)
      if (!el) return false
      el.click()
      return true
    }, link)

    await page.waitForTimeout(SETTLE_MS)
    const after = await visible()

    const prefix = link.kind === 'service' ? 'svc-' : ''
    const file = String(i + 1).padStart(2, '0') + '-' + prefix + link.key.replace(/[^a-z0-9-]/gi, '_') + '.png'
    await page.screenshot({ path: path.join(OUT, file), fullPage: true })

    const stats = await page.evaluate(() => ({
      elements: document.body.getElementsByTagName('*').length,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
    }))

    // "Activated" means the visible screen is the one asked for. A link that
    // leaves the previous screen up is a dead link, however good the image.
    // A service resolves to the shared [data-scr="service"] page, so the
    // expected screen is not the same as the key. Comparing against the key
    // would mark every service tile dead.
    const activated = after.split(',').includes(link.expect)
    results.push({ ...link, file, activated, clicked, before, after, ...stats })
    console.log(
      `${String(i + 1).padStart(2)}/${links.length}  ${activated ? 'ok  ' : 'DEAD'}  ` +
      `${link.kind.padEnd(7)} ${link.key.padEnd(16)} -> ${after.padEnd(12)} ${String(stats.elements).padStart(5)} els`
    )
  }

  const dead = results.filter((r) => !r.activated)
  const byKind = { screen: results.filter((r) => r.kind === 'screen').length,
                   service: results.filter((r) => r.kind === 'service').length }
  fs.writeFileSync(path.join(OUT, 'index.html'), gallery(results, dead, errors))
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ target: TARGET, results, errors }, null, 2))

  console.log(`\n${results.length} captured (${byKind.screen} screens, ${byKind.service} services), ` +
              `${dead.length} dead, ${errors.length} page error(s)`)
  if (dead.length) console.log('dead: ' + dead.map((d) => d.key).join(', '))
  console.log(`gallery: ${path.join(OUT, 'index.html')}`)
  await browser.close()
})()

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
}

function gallery(results, dead, errors) {
  const cards = results.map((r) => `
  <figure${r.activated ? '' : ' class="dead"'}>
    <a href="${esc(r.file)}" target="_blank"><img src="${esc(r.file)}" alt="${esc(r.key)}" loading="lazy"></a>
    <figcaption>
      <b>${esc(r.label)}</b>
      <code>${esc(r.kind === 'service' ? 'service · ' + r.key : r.key)}</code>
      <span>${r.elements.toLocaleString()} elements · ${r.text.toLocaleString()} chars${r.activated ? '' : ' · DID NOT ACTIVATE'}</span>
    </figcaption>
  </figure>`).join('')

  return `<!doctype html><meta charset="utf-8"><title>RegesCore — every screen</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;padding:28px;background:#08080A;color:#ECECEF;
       font:14px/1.5 system-ui,sans-serif}
  h1{font:600 22px/1.2 system-ui;letter-spacing:.02em;margin:0 0 4px}
  .sub{color:#7E7E88;font-size:12.5px;margin-bottom:22px}
  .sub b{color:#2FE07C}.sub .bad{color:#E5343F}
  .grid{display:grid;gap:20px;grid-template-columns:repeat(auto-fill,minmax(420px,1fr))}
  figure{margin:0;background:#0B0B0E;border:1px solid #1B1B21;border-radius:10px;overflow:hidden}
  figure.dead{border-color:#E5343F}
  img{display:block;width:100%;height:auto;border-bottom:1px solid #17171B}
  figcaption{padding:10px 12px;display:flex;flex-direction:column;gap:3px}
  figcaption b{font-size:13px}
  code{color:#E5343F;font:11px/1 ui-monospace,monospace}
  figcaption span{color:#5B5B65;font-size:11px}
  footer{margin-top:26px;color:#4A4A52;font-size:11.5px}
</style>
<h1>RegesCore — every screen</h1>
<div class="sub"><b>${results.length}</b> screens captured${dead.length ? ` · <span class="bad">${dead.length} did not activate</span>` : ' · all activated'}${errors.length ? ` · <span class="bad">${errors.length} page error(s)</span>` : ''}</div>
<div class="grid">${cards}</div>
<footer>RegesCore // Fable 5 — davidio.dev</footer>`
}
