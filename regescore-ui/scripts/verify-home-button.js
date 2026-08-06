/**
 * Proves the two brand marks navigate home.
 *
 * A click handler that is attached but wired to the wrong screen looks
 * identical to a working one in a screenshot, so this navigates away first and
 * asserts the header actually changes back.
 */
const { chromium } = require('playwright')

const URL = process.env.TARGET || 'http://127.0.0.1:3000/'

;(async () => {
  const browser = await chromium.launch({
    args: ['--no-sandbox'],
    executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium',
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto(URL, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(9000)

  // All 51 screens stay in the DOM and visibility is CSS-driven, so the header
  // brand text is identical everywhere. The only honest signal is which
  // [data-scr] is actually laid out.
  const current = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-scr]')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.getAttribute('data-scr'))
      .join(',')
  )

  // Nav items are inside a rail that collapses, so a real mouse click can miss.
  // Dispatching on the element tests the app's handler, which is the point.
  const goto = (screen) => page.evaluate(
    (s) => document.querySelector(`[data-goto="${s}"]`)?.click(), screen
  )
  const clickMark = (label) => page.evaluate(
    (l) => document.querySelector(`[role="button"][aria-label="${l}"]`)?.click(), label
  )

  const wired = await page.evaluate(() =>
    [...document.querySelectorAll('[role="button"][aria-label*="Dashboard"]')]
      .map((el) => el.getAttribute('aria-label'))
  )

  const home = await current()

  await goto('voicebox')
  await page.waitForTimeout(900)
  const away = await current()

  await clickMark('DAVIDIO REGES.CORE, back to Dashboard')
  await page.waitForTimeout(900)
  const viaWordmark = await current()

  await goto('voicebox')
  await page.waitForTimeout(900)
  await clickMark('RegesCore, back to Dashboard')
  await page.waitForTimeout(900)
  const viaLogo = await current()

  const pass = away !== home && viaWordmark === home && viaLogo === home
  console.log(JSON.stringify({ wired, home, away, viaWordmark, viaLogo, pass }, null, 2))
  await browser.close()
  process.exit(pass ? 0 : 1)
})()
