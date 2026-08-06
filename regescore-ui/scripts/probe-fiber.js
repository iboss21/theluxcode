const { chromium } = require('playwright')
;(async () => {
  const b = await chromium.launch({ args:['--no-sandbox'], executablePath:'/opt/pw-browsers/chromium' })
  const p = await b.newPage({ viewport:{ width:1400, height:900 } })
  await p.goto('http://127.0.0.1:3000/', { waitUntil:'load' })
  await p.waitForTimeout(9000)
  console.log(JSON.stringify(await p.evaluate(() => {
    const root = document.querySelector('[data-screen-label]')
    if (!root) return { err: 'no root' }
    const keys = Object.keys(root)
    const fk = keys.find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
    const out = { rootTag: root.tagName, rootKeys: keys.slice(0,8), fiberKey: fk || null, chain: [] }
    let f = fk ? root[fk] : null, depth = 0
    while (f && depth < 40) {
      const sn = f.stateNode
      out.chain.push({
        depth,
        type: typeof f.type === 'function' ? (f.type.name || 'anon-fn') : String(f.type),
        stateNode: sn ? (sn.nodeName || sn.constructor?.name || typeof sn) : null,
        hasSim: !!(sn && sn.sim),
        hasFrame: !!(sn && typeof sn.frame === 'function'),
        hasLive: !!(sn && sn.live),
      })
      f = f.return; depth++
    }
    return out
  }), null, 2))
  await b.close()
})()
