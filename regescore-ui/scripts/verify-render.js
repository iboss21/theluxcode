// Render the dashboard and report what the browser actually did:
// console errors, failed requests, and whether the runtime mounted anything.
const { chromium } = require('playwright')

const URL = process.env.TARGET || 'http://127.0.0.1:3000/'
const OUT = process.env.OUT || '/tmp/shot.png'

;(async () => {
  // Pinned to the Chromium already on the image. The npm playwright version
  // may expect a newer browser build than the one installed, and downloading
  // one is both slow and unnecessary for a render check.
  const browser = await chromium.launch({
    args: ['--no-sandbox'],
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })

  const errors = []
  const failed = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 300)))
  page.on('requestfailed', (r) => failed.push(`${r.url().slice(0, 110)} :: ${r.failure()?.errorText}`))

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
  // The dc runtime loads React, compiles with Babel, then mounts. Give it room.
  await page.waitForTimeout(9000)

  const probe = await page.evaluate(() => {
    const dc = document.querySelector('x-dc')
    const body = document.body
    return {
      hasReact: typeof window.React !== 'undefined',
      hasReactDOM: typeof window.ReactDOM !== 'undefined',
      hasBabel: typeof window.Babel !== 'undefined',
      xdcStillInDom: !!dc,
      screens: document.querySelectorAll('[data-scr]').length,
      elementCount: body.getElementsByTagName('*').length,
      visibleText: (body.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
    }
  })

  await page.screenshot({ path: OUT, fullPage: false })
  console.log(JSON.stringify({ probe, errors: errors.slice(0, 12), failed: failed.slice(0, 12) }, null, 2))
  await browser.close()
})()
