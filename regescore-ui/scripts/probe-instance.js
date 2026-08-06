const { chromium } = require('playwright')
;(async () => {
  const b = await chromium.launch({ args:['--no-sandbox'], executablePath:'/opt/pw-browsers/chromium' })
  const p = await b.newPage({ viewport:{ width:1400, height:900 } })
  await p.goto('http://127.0.0.1:3000/', { waitUntil:'load' })
  await p.waitForTimeout(9000)
  console.log(JSON.stringify(await p.evaluate(() => {
    const out = {}
    const root = document.querySelector('[data-screen-label]')
    const fk = Object.keys(root).find(k => k.startsWith('__reactFiber$'))
    // find the StreamableComponent fiber and dump its stateNode keys
    let f = root[fk]
    while (f && !(f.stateNode && f.stateNode.constructor && f.stateNode.constructor.name === 'StreamableComponent')) f = f.return
    if (f) {
      const sn = f.stateNode
      out.streamableKeys = Object.keys(sn)
      out.streamableProtoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(sn)).slice(0,25)
      // look one level deep for an object carrying sim
      out.nested = Object.keys(sn).filter(k => {
        const v = sn[k]
        return v && typeof v === 'object' && (v.sim || typeof v.frame === 'function' || typeof v.retarget === 'function')
      })
      // React refs commonly hold it
      if (sn.state) out.stateKeys = Object.keys(sn.state).slice(0,20)
    }
    // brute: walk the full fiber tree from the container looking for ANY stateNode with sim
    const container = document.body.firstElementChild
    const ck = container && Object.keys(container).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'))
    out.containerKey = ck || null
    const found = []
    const seen = new Set()
    const walk = (fb, d) => {
      if (!fb || seen.has(fb) || d > 60) return
      seen.add(fb)
      const sn = fb.stateNode
      if (sn && typeof sn === 'object' && (sn.sim || typeof sn.retarget === 'function')) {
        found.push({ name: sn.constructor && sn.constructor.name, hasSim: !!sn.sim, hasLive: !!sn.live, hasLogs: !!sn.logs })
      }
      walk(fb.child, d+1); walk(fb.sibling, d+1)
    }
    let top = root[fk]
    while (top && top.return) top = top.return
    walk(top, 0)
    out.found = found
    return out
  }), null, 2))
  await b.close()
})()
