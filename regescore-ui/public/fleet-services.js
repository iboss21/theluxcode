/**
 * Live service state for the RegesCore dashboard.
 *
 * Companion to fleet-live.js, which owns host vitals and the rail's service
 * dots. This file owns the two screens fleet-live.js does not touch:
 *
 *   [data-scr="service"]  the single detail screen all 21 services share
 *   [data-scr="armory"]   the tool/repo catalogue
 *
 * Why it works the way it does
 * ---------------------------
 * The export's service detail screen is rendered from a module-scoped
 * `const SERVICES = { ... }` inside the <script type="text/x-dc"> body, which
 * support.js evaluates through `new Function(...)`. That makes SERVICES a
 * function-scoped binding: it is not on window, not on the instance, and not
 * reachable from here. What IS reachable is the method that reads it -
 * `svcVals()`, whose return value renderVals() spreads into every `{{ svc* }}`
 * binding on the screen. So the seam is svcVals itself: the original is called
 * for the export's own copy (descriptions, wiring table, dependency list, the
 * design's colours and gradients), then the fields that make a *claim about
 * reachability* are replaced with measurements. Everything visual stays the
 * export's. A redesign that keeps the same binding names inherits this for free.
 *
 * The armory screen has no `{{ }}` bindings at all - it is static markup - so
 * it has to be written in the DOM. React owns those nodes, so nothing is
 * removed: the export's grid is hidden by attribute + stylesheet and live cards
 * are appended as a sibling. Adding nodes React does not know about is safe;
 * removing nodes it does know about is not.
 *
 * Honesty rules this file follows
 * -------------------------------
 * Before the first probe lands the screen says PROBING, not the export's
 * hardcoded ONLINE. If no status route answers, every service reads NO DATA.
 * The export's health bars ("UPTIME 2h 46m") are design fiction and are
 * replaced with the probe's own numbers - latency, HTTP status - or with
 * NOT PROBED. The two entries that are not network services at all
 * (REFERENCE, NOT INTEGRATED with no port) keep the export's classification,
 * because "reference material" is not a claim that something is up.
 *
 * A service shown ONLINE that is down is worse than one shown UNKNOWN.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
(function () {
  'use strict'

  var NONE = '—'
  var STATUS_POLL_MS = 8000    // a sweep is 27 probes; the server caches 4s
  var ARMORY_POLL_MS = 20000

  // Relative variants included so the dashboard also works mounted under a
  // sub-path such as /fleet/, exactly as fleet-live.js does.
  var STATUS_ROUTES = [
    '/api/services/status', 'api/services/status',
    '/api/services', 'api/services',
  ]
  var ARMORY_ROUTES = ['/api/armory', 'api/armory']
  var LAUNCH_ROUTES = ['/api/services/launch', 'api/services/launch']
  var META_ROUTES = ['/api/meta', 'api/meta']

  // The export's SERVICES keys, in the order the object declares them.
  // Verified against public/index.dc.html lines 1553-1680.
  var IDS = [
    'regescore', 'voiceserver', 'luxcode', 'n8n', 'agentmemorysvc', 'sia',
    'excalidraw', 'openwebui', 'activepieces', 'twentycrm', 'outline',
    'chatwoot', 'docuseal', 'formbricks', 'kimai', 'caldiy', 'usesend',
    'nextcloud', 'benchmarks', 'creditfix', 'mcpshopline',
  ]

  // Where the export's key and the server's registry id disagree. Name
  // matching (below) catches these too; the map is kept so the common cases
  // resolve without depending on display strings staying in sync.
  var ALIAS = {
    agentmemorysvc: 'agentmemory',
    twentycrm: 'twenty',
    benchmarks: null,   // reference material, nothing to probe
    mcpshopline: null,  // stdio MCP server, no port to reach
  }

  // Same palette the export's SVCCOL uses, extended with the two states a
  // real probe can report that a static design has no word for.
  var COL = {
    ONLINE: '#2FE07C',
    OFFLINE: '#E5343F',
    TIMEOUT: '#F5A524',
    'NEEDS DOCKER': '#E5343F',
    'NEEDS ENV': '#F5A524',
    'NOT INTEGRATED': '#55555E',
    REFERENCE: '#82828C',
    PROBING: '#6E6E78',
    'NO DATA': '#82828C',
  }

  var inst = null
  var origSvcVals = null
  var baseline = null          // export id -> its own svcVals() output
  var nameToId = {}            // display name -> export id, for the sibling list
  var grads = {}               // g/b/a/r -> gradient string, harvested from the export
  var wrapped = false

  var statusUrl = null
  var armoryUrl = null
  var toggleUrl = null
  var launchUrl = null         // null = not found, undefined = not yet known
  var phase = 'probing'        // 'probing' | 'live' | 'nodata'
  var live = {}                // export id -> normalised probe result
  var armoryPhase = 'probing'  // 'probing' | 'live' | 'nodata'
  var armoryItems = null
  var armoryNote = ''

  // -- instance handle ---------------------------------------------------
  // Same walk as fleet-live.js: the export's class is never a fiber
  // stateNode, the dc runtime's StreamableComponent keeps it on `.logic`.
  function findInstance() {
    var root = document.querySelector('[data-screen-label]')
    if (!root) return null
    var key = Object.keys(root).find(function (k) { return k.indexOf('__reactFiber$') === 0 })
    if (!key) return null
    var fiber = root[key]
    var guard = 0
    while (fiber && guard++ < 200) {
      var node = fiber.stateNode
      if (node && typeof node === 'object') {
        if (node.sim && typeof node.frame === 'function') return node
        if (node.logic && node.logic.sim && typeof node.logic.frame === 'function') return node.logic
      }
      fiber = fiber.return
    }
    return null
  }

  // -- transport ---------------------------------------------------------
  function get(url) {
    return fetch(url, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .catch(function () { return null })
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) {
      return r.text().then(function (text) {
        var json = null
        try { json = JSON.parse(text) } catch (e) { /* not JSON; keep the text */ }
        return { ok: r.ok, status: r.status, json: json, text: text }
      })
    }).catch(function (e) {
      return { ok: false, status: 0, json: null, text: String((e && e.message) || e) }
    })
  }

  function firstRoute(routes, accept) {
    var i = 0
    function next() {
      if (i >= routes.length) return Promise.resolve(null)
      var url = routes[i++]
      return get(url).then(function (json) {
        return json && accept(json) ? url : next()
      })
    }
    return next()
  }

  // -- normalising a probe result ----------------------------------------
  function listOf(json) {
    if (Array.isArray(json)) return json
    if (!json || typeof json !== 'object') return []
    var keys = ['services', 'items', 'results', 'data']
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(json[keys[i]])) return json[keys[i]]
    }
    return []
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '') }

  /**
   * Two server shapes are in play and both are real: this repo's sweep returns
   * status:'up'|'down'|'timeout', the user's box returns online:true|false.
   * Anything else returns null so the service reads UNKNOWN rather than
   * inheriting a guess.
   */
  function stateOf(row) {
    if (!row || typeof row !== 'object') return null
    var st = norm(row.status !== undefined ? row.status : row.state)
    if (row.online === true || row.up === true || row.healthy === true) return 'ONLINE'
    if (st === 'up' || st === 'online' || st === 'running' || st === 'healthy' || st === 'ok') return 'ONLINE'
    if (st === 'timeout' || st === 'timedout' || st === 'timedout') return 'TIMEOUT'
    var down = row.online === false || row.up === false || row.healthy === false ||
      st === 'down' || st === 'offline' || st === 'stopped' || st === 'error' || st === 'unreachable'
    if (down) return row.docker === true ? 'NEEDS DOCKER' : 'OFFLINE'
    return null
  }

  function portOf(row) {
    if (row.port !== undefined && row.port !== null && row.port !== '') return String(row.port)
    var m = /:(\d+)(?:\/|$)/.exec(String(row.url || row.href || ''))
    return m ? m[1] : null
  }

  function urlOf(row) {
    if (row.url) return String(row.url)
    if (row.href) return String(row.href)
    var port = portOf(row)
    return port ? 'http://127.0.0.1:' + port : null
  }

  function numOr(v, fallback) {
    var n = typeof v === 'number' ? v : parseFloat(v)
    return isFinite(n) ? n : fallback
  }

  /** Index a sweep by export id, resolving id -> alias -> display name. */
  function indexStatus(json) {
    var rows = listOf(json)
    if (!rows.length) return null
    var byId = {}, byName = {}
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      if (!row || typeof row !== 'object') continue
      var rid = row.id || row.key || row.slug || row.name
      if (rid) byId[String(rid)] = row
      if (row.name) byName[norm(row.name)] = row
    }
    var out = {}
    for (var j = 0; j < IDS.length; j++) {
      var id = IDS[j]
      var alias = Object.prototype.hasOwnProperty.call(ALIAS, id) ? ALIAS[id] : undefined
      if (alias === null) continue   // deliberately not a network service
      var row = byId[id] || (alias && byId[alias]) || null
      if (!row && baseline && baseline[id]) row = byName[norm(baseline[id].svcName)] || null
      if (!row) continue
      var state = stateOf(row)
      if (!state) continue           // shape unrecognised: claim nothing
      out[id] = {
        state: state,
        port: portOf(row),
        url: urlOf(row),
        httpStatus: row.httpStatus !== undefined ? row.httpStatus : (row.statusCode !== undefined ? row.statusCode : null),
        latencyMs: numOr(row.latencyMs !== undefined ? row.latencyMs : row.latency, null),
        error: row.error || null,
        liveId: row.id || row.key || row.slug || id,
      }
    }
    return out
  }

  // -- harvesting the export's own copy ----------------------------------
  /**
   * svcVals() is the only way in: call it once per key with svcKey set, and it
   * hands back everything SERVICES[key] holds, already formatted by the design.
   * A key the export does not know falls back to SERVICES.regescore, so an
   * output identical to regescore's means "not present" and is dropped.
   */
  function harvest() {
    var saved = inst.svcKey
    var base = {}
    for (var i = 0; i < IDS.length; i++) {
      inst.svcKey = IDS[i]
      try { base[IDS[i]] = origSvcVals.call(inst) } catch (e) { /* skip */ }
    }
    inst.svcKey = saved

    var ref = base.regescore
    for (var k in base) {
      if (!Object.prototype.hasOwnProperty.call(base, k)) continue
      if (k !== 'regescore' && ref && base[k] && base[k].svcName === ref.svcName) { delete base[k]; continue }
      nameToId[base[k].svcName] = k
      harvestGrads(base[k].svcHealth)
    }
    return base
  }

  /**
   * The health-bar gradients are design constants declared as GRAD in the
   * export. Rather than copy them here, where they would silently drift from
   * the next redesign, they are read back out of the harvested rows and keyed
   * by the accent colour each one starts from.
   */
  function harvestGrads(rows) {
    if (!rows) return
    for (var i = 0; i < rows.length; i++) {
      var g = rows[i] && rows[i].g
      if (typeof g !== 'string') continue
      if (g.indexOf('#2FE07C') !== -1) grads.g = g
      else if (g.indexOf('#4C8DFF') !== -1) grads.b = g
      else if (g.indexOf('#F5A524') !== -1) grads.a = g
      else if (g.indexOf('#E5343F') !== -1) grads.r = g
    }
  }

  function grad(key, fallbackColour) { return grads[key] || fallbackColour }

  // -- the service detail screen -----------------------------------------
  /** True for the two entries that have no port and are not services. */
  function notNetworked(id) {
    var b = baseline && baseline[id]
    if (!b) return false
    return b.svcPort === NONE &&
      (b.svcState === 'REFERENCE' || b.svcState === 'NOT INTEGRATED')
  }

  function healthRows(id, l) {
    var rows = []
    if (!l) {
      rows.push({ k: 'PROBE', v: phase === 'probing' ? 'IN FLIGHT' : 'NOT PROBED', w: '0%', g: grad('r', COL.OFFLINE) })
      return rows
    }
    var up = l.state === 'ONLINE'
    rows.push({
      k: 'PROBE', v: l.state,
      w: (up ? 100 : 0) + '%',
      g: up ? grad('g', COL.ONLINE) : l.state === 'TIMEOUT' ? grad('a', COL.TIMEOUT) : grad('r', COL.OFFLINE),
    })
    if (l.latencyMs !== null) {
      var w = Math.max(2, Math.min(100, Math.round(l.latencyMs / 20)))
      rows.push({
        k: 'LATENCY', v: l.latencyMs + ' ms', w: w + '%',
        g: l.latencyMs < 400 ? grad('g', COL.ONLINE) : grad('a', COL.TIMEOUT),
      })
    }
    rows.push({
      k: 'HTTP', v: l.httpStatus === null || l.httpStatus === undefined ? NONE : String(l.httpStatus),
      w: (l.httpStatus ? 100 : 0) + '%', g: grad('b', '#4C8DFF'),
    })
    if (l.error) rows.push({ k: 'REASON', v: String(l.error).slice(0, 28).toUpperCase(), w: '0%', g: grad('r', COL.OFFLINE) })
    return rows
  }

  function openUrl(url) {
    if (!url) return false
    window.open(url, '_blank', 'noopener')
    return true
  }

  /** POST {id} to the launch route, discovering it on first use if needed. */
  function launch(id, l, label) {
    var liveId = (l && l.liveId) || id
    if (launchUrl === null) { inst.flash(label + ' · NO LAUNCH ROUTE ON THIS SERVER'); return }
    if (launchUrl === undefined) {
      inst.flash(label + ' · LOCATING LAUNCH ROUTE')
      launchTry(0, id, l, label)
      return
    }
    inst.flash(label + ' · LAUNCH REQUESTED')
    post(launchUrl, { id: liveId }).then(function (r) { launchDone(r, label) })
  }

  function launchTry(i, id, l, label) {
    if (i >= LAUNCH_ROUTES.length) {
      launchUrl = null
      inst.flash(label + ' · NO LAUNCH ROUTE ON THIS SERVER')
      refresh()
      return
    }
    post(LAUNCH_ROUTES[i], { id: (l && l.liveId) || id }).then(function (r) {
      if (r.status === 404 || r.status === 0) return launchTry(i + 1, id, l, label)
      launchUrl = LAUNCH_ROUTES[i]
      launchDone(r, label)
      refresh()
    })
  }

  function launchDone(r, label) {
    if (r.status === 404) {
      launchUrl = null
      inst.flash(label + ' · NO LAUNCH ROUTE ON THIS SERVER')
      refresh()
      return
    }
    if (!r.ok) {
      inst.flash(label + ' · LAUNCH FAILED · ' + (r.status || 'NO RESPONSE'))
      return
    }
    inst.flash(label + ' · LAUNCH ACCEPTED')
    // Give the process a moment to bind before re-probing, then again after.
    setTimeout(tickStatus, 1500)
    setTimeout(tickStatus, 6000)
  }

  /** Ask for a fresh sweep rather than the cached one, and report the answer. */
  function reprobe(id, label) {
    if (!statusUrl) { inst.flash(label + ' · NO STATUS ROUTE'); return }
    inst.flash(label + ' · PROBE SENT')
    var url = statusUrl + (statusUrl.indexOf('?') === -1 ? '?' : '&') + 'fresh=1'
    get(url).then(function (json) {
      var idx = json ? indexStatus(json) : null
      if (!idx) { inst.flash(label + ' · PROBE RETURNED NOTHING'); return }
      live = idx
      phase = 'live'
      inst.flash(label + ' · ' + ((idx[id] && idx[id].state) || 'NO DATA'))
      refresh()
    })
  }

  /**
   * Replace only what makes a claim about reachability. Descriptions, the
   * wiring table, the dependency list and every colour and gradient stay the
   * export's own.
   */
  function liveVals(v, key) {
    if (notNetworked(key)) {
      // Not a service: keep the export's classification but say plainly that
      // nothing was measured, so REFERENCE never reads as "probed and up".
      v.svcReach = 'NOT A NETWORK SERVICE'
      v.svcHealthTitle = 'CLASSIFICATION'
      v.svcHealth = [{ k: 'PROBE', v: 'NOT APPLICABLE', w: '0%', g: grad('r', COL.OFFLINE) }]
      return v
    }

    var l = live[key] || null
    var state = l ? l.state : (phase === 'probing' ? 'PROBING' : 'NO DATA')
    var col = COL[state] || '#82828C'
    var up = state === 'ONLINE'
    var name = (v.svcName || key).toUpperCase()

    // ARMORY · VENDORED · <state> - keep the design's prefix, swap the claim.
    var eyebrow = String(v.svcEyebrow || '')
    var cut = eyebrow.lastIndexOf(' · ')
    v.svcEyebrow = (cut === -1 ? eyebrow : eyebrow.slice(0, cut)) + ' · ' + state +
      (l ? '' : phase === 'probing' ? '' : ' · NOT PROBED')

    v.svcState = state
    v.svcStateCol = col
    if (l && l.port) v.svcPort = ':' + l.port
    v.svcReach = up ? 'REACHABLE'
      : state === 'TIMEOUT' ? 'LISTENING · NO RESPONSE'
      : state === 'PROBING' ? 'PROBE IN FLIGHT'
      : state === 'NO DATA' ? 'NOT PROBED · NO STATUS ROUTE'
      : 'NOT REACHABLE'
    v.svcHealthTitle = up ? 'HEALTH' : l ? 'LAST PROBE' : 'PROBE'
    v.svcHealth = healthRows(key, l)

    // Provenance, so the panel says where the state came from.
    v.svcDeps = (v.svcDeps || []).concat([{ k: 'LIVE PROBE', v: state, c: col }])

    if (up) {
      var url = (l && l.url) || null
      v.svcCta = 'OPEN'
      v.svcBtnLabel = l && l.port ? 'OPEN :' + l.port : 'OPEN PAGE'
      v.svcBtnBg = 'var(--accent,#E5343F)'
      v.svcBtnBorder = 'transparent'
      v.svcBtnFg = '#fff'
      v.svcAct = function () {
        if (openUrl(url)) inst.flash(name + ' · OPENED ' + url)
        else inst.flash(name + ' · ONLINE BUT NO URL REPORTED')
      }
    } else if (state === 'PROBING') {
      v.svcCta = 'PROBING'
      v.svcBtnLabel = 'PROBE IN FLIGHT'
      v.svcBtnBg = '#121216'
      v.svcBtnBorder = '#23232A'
      v.svcBtnFg = '#6E6E78'
      v.svcAct = function () { inst.flash(name + ' · WAITING ON FIRST PROBE') }
    } else if (state === 'NO DATA') {
      v.svcCta = 'NO STATUS DATA'
      v.svcBtnLabel = 'STATUS UNKNOWN'
      v.svcBtnBg = '#121216'
      v.svcBtnBorder = '#23232A'
      v.svcBtnFg = '#82828C'
      v.svcAct = function () { inst.flash(name + ' · NO STATUS ROUTE ON THIS SERVER') }
    } else if (state === 'TIMEOUT') {
      v.svcCta = 'RE-PROBE'
      v.svcBtnLabel = 'NO RESPONSE · RE-PROBE'
      v.svcBtnBg = '#121216'
      v.svcBtnBorder = '#23232A'
      v.svcBtnFg = '#B9B9C2'
      v.svcAct = function () { reprobe(key, name) }
    } else if (launchUrl === null) {
      // Down, and this server cannot start anything: say so instead of
      // offering a button that does nothing.
      v.svcCta = state === 'NEEDS DOCKER' ? 'DOCKER REQUIRED' : 'NOT REACHABLE'
      v.svcBtnLabel = v.svcCta
      v.svcBtnBg = '#121216'
      v.svcBtnBorder = '#23232A'
      v.svcBtnFg = '#B9B9C2'
      v.svcAct = function () { reprobe(key, name) }
    } else {
      v.svcCta = 'START SERVICE'
      v.svcBtnLabel = 'START SERVICE'
      v.svcBtnBg = '#121216'
      v.svcBtnBorder = '#23232A'
      v.svcBtnFg = '#B9B9C2'
      v.svcAct = function () { launch((l && l.liveId) || key, l, name) }
    }

    v.svcProbe = function () { reprobe(key, name) }

    // The OTHER SERVICES list is the same claim in miniature, so it gets the
    // same treatment. Matched by display name because svcVals hands back
    // names, not keys.
    v.svcSiblings = (v.svcSiblings || []).map(function (s) {
      var sid = nameToId[s.name]
      if (!sid) return s
      if (notNetworked(sid)) return s
      var sl = live[sid] || null
      var sstate = sl ? sl.state : (phase === 'probing' ? 'PROBING' : 'NO DATA')
      return {
        name: s.name,
        port: sl && sl.port ? ':' + sl.port : s.port,
        c: COL[sstate] || '#82828C',
        go: s.go,
      }
    })

    return v
  }

  function wrapSvcVals() {
    if (wrapped) return
    wrapped = true
    inst.svcVals = function () {
      var key = this.svcKey || 'regescore'
      var v = origSvcVals.call(this)
      try { return liveVals(v, baseline && baseline[key] ? key : 'regescore') }
      catch (e) { console.warn('[fleet-services] svcVals override failed', e); return v }
    }
  }

  /** Repaint only when the screen the override feeds is actually showing. */
  function refresh() {
    if (!inst) return
    if (inst.scr === 'service') inst.forceUpdate()
  }

  // -- the armory screen -------------------------------------------------
  var CARD_STYLE = "display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid #1D1D22; border-radius:12px; background:#0E0E11; overflow:hidden;"
  var GRID_STYLE = "display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:11px;"
  var TITLE_STYLE = "flex:1; min-width:0; font:400 13.5px/1 'JetBrains Mono',monospace; color:#ECECEF; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"
  var LINK_STYLE = "font:500 8px/1 'JetBrains Mono',monospace; letter-spacing:.1em; color:#8FB0E8; text-decoration:none; flex-shrink:0;"
  var BADGE_STYLE = "font:500 8.5px/1 'JetBrains Mono',monospace; letter-spacing:.14em;"
  var DESC_STYLE = "font:400 11.5px/1.5 'Jost',sans-serif; color:#6E6E78;"
  var META_STYLE = "padding:3px 7px; border:1px solid #23232A; border-radius:4px; font:500 9px/1 'JetBrains Mono',monospace; letter-spacing:.1em; color:#6E6E78;"
  var ACT_STYLE = "font:500 9px/1 'JetBrains Mono',monospace; letter-spacing:.1em;"

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function armorySection() { return document.querySelector('[data-scr="armory"]') }

  /**
   * The armory screen is static markup with no bindings, so its parts are
   * found by the one thing that identifies them: the grid declaration in the
   * style attribute the export wrote.
   */
  function armoryParts() {
    var sec = armorySection()
    if (!sec) return null
    var parts = { section: sec, stats: null, grid: null }
    for (var i = 0; i < sec.children.length; i++) {
      var st = sec.children[i].getAttribute('style') || ''
      if (st.indexOf('auto-fill') !== -1) parts.grid = sec.children[i]
      else if (st.indexOf('repeat(4') !== -1) parts.stats = sec.children[i]
    }
    return parts.grid ? parts : null
  }

  function ensureHideRule() {
    if (document.getElementById('fleet-armory-css')) return
    var s = document.createElement('style')
    s.id = 'fleet-armory-css'
    // Attribute-scoped so React, which does not know the attribute exists,
    // never reverts it - and no React-owned node has to be removed.
    s.textContent = '[data-armory-live] > * { display: none !important; }'
    document.head.appendChild(s)
  }

  function armoryTileValues(items) {
    var counts = { total: 0, deployed: 0, drifted: 0, archived: 0 }
    var sawDrift = false, sawArchive = false
    for (var i = 0; i < items.length; i++) {
      counts.total++
      if (items[i].on === true) counts.deployed++
      var st = norm(items[i].state)
      if (st === 'drifted' || st === 'drift') { counts.drifted++; sawDrift = true }
      if (st === 'archived') { counts.archived++; sawArchive = true }
    }
    return [
      String(counts.total),
      String(counts.deployed),
      sawDrift ? String(counts.drifted) : NONE,
      sawArchive ? String(counts.archived) : NONE,
    ]
  }

  /** Each tile is <label div><value div>; only the value is touched. */
  function paintTiles(values) {
    var parts = armoryParts()
    if (!parts || !parts.stats) return
    for (var i = 0; i < parts.stats.children.length && i < values.length; i++) {
      var value = parts.stats.children[i].children[1]
      if (value && value.textContent !== values[i]) value.textContent = values[i]
    }
  }

  /** One armory entry out of whatever key names the server chose. */
  function armoryItem(row) {
    if (!row || typeof row !== 'object') return null
    var id = row.id || row.key || row.slug || row.name
    if (!id) return null
    var on = null
    var flags = ['enabled', 'active', 'on', 'deployed', 'installed']
    for (var i = 0; i < flags.length; i++) {
      if (typeof row[flags[i]] === 'boolean') { on = row[flags[i]]; break }
    }
    var state = row.state || row.status || null
    if (on === null && state) {
      var ns = norm(state)
      if (ns === 'deployed' || ns === 'enabled' || ns === 'active' || ns === 'on' || ns === 'up') on = true
      else if (ns === 'disabled' || ns === 'off' || ns === 'idle' || ns === 'inactive') on = false
    }
    var lang = row.lang || row.language || row.kind || row.type || null
    var size = row.size || row.loc || row.stars || null
    var meta = [lang, size].filter(Boolean).join(' · ')
    return {
      id: String(id),
      name: String(row.name || row.title || id),
      desc: String(row.description || row.what || row.desc || row.summary || ''),
      state: state ? String(state).toUpperCase() : (on === true ? 'ENABLED' : on === false ? 'DISABLED' : 'UNKNOWN'),
      on: on,
      meta: meta,
      repo: row.repo || row.url || row.html_url || row.link || null,
    }
  }

  function armoryCard(it) {
    var col = it.on === true ? COL.ONLINE : it.on === false ? '#82828C' : COL['NO DATA']
    var repo = it.repo ? '<a href="' + esc(it.repo) + '" target="_blank" rel="noopener" style="' + LINK_STYLE + '">↗</a>' : ''
    var actLabel, actAttr, actCol
    if (toggleUrl === null) { actLabel = 'NO TOGGLE ROUTE'; actAttr = ''; actCol = '#4A4A52' }
    else {
      actLabel = (it.on === true ? 'DISABLE' : it.on === false ? 'ENABLE' : 'TOGGLE') + ' →'
      actAttr = ' data-armory-toggle="' + esc(it.id) + '"'
      actCol = '#82828C'
    }
    return '<div style="' + CARD_STYLE + '">' +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span style="' + TITLE_STYLE + '">' + esc(it.name) + '</span>' + repo +
        '<span style="' + BADGE_STYLE + ' color:' + col + ';">' + esc(it.state) + '</span>' +
      '</div>' +
      '<div style="' + DESC_STYLE + '">' + esc(it.desc || 'No description reported') + '</div>' +
      '<div style="display:flex; align-items:center; gap:8px;">' +
        '<span style="' + META_STYLE + '">' + esc(it.meta || it.id) + '</span>' +
        '<div style="flex:1;"></div>' +
        '<span' + actAttr + ' style="' + ACT_STYLE + ' color:' + actCol + '; cursor:' + (actAttr ? 'pointer' : 'default') + ';">' + esc(actLabel) + '</span>' +
      '</div>' +
    '</div>'
  }

  function armoryNotice(title, detail) {
    return '<div style="' + CARD_STYLE + ' grid-column:1/-1; border-color:#2A2A32;">' +
      '<div style="display:flex; align-items:center; gap:10px;">' +
        '<span style="flex-shrink:0; width:6px; height:6px; border-radius:50%; background:' + COL.TIMEOUT + ';"></span>' +
        '<span style="' + BADGE_STYLE + ' color:' + COL.TIMEOUT + ';">' + esc(title) + '</span>' +
      '</div>' +
      '<div style="' + DESC_STYLE + '">' + esc(detail) + '</div>' +
    '</div>'
  }

  function paintArmory() {
    var parts = armoryParts()
    if (!parts) return
    ensureHideRule()

    var host = document.getElementById('fleet-armory-live')
    if (!host) {
      host = document.createElement('div')
      host.id = 'fleet-armory-live'
      host.setAttribute('style', GRID_STYLE)
      // Appended, never swapped: React keeps ownership of everything it made.
      parts.grid.parentNode.insertBefore(host, parts.grid.nextSibling)
      host.addEventListener('click', onArmoryClick)
    }
    parts.grid.setAttribute('data-armory-live', '1')

    if (armoryPhase === 'probing') {
      host.innerHTML = armoryNotice('LOADING REGISTRY', 'Waiting on GET /api/armory.')
      paintTiles([NONE, NONE, NONE, NONE])
      return
    }
    if (armoryPhase === 'nodata' || !armoryItems || !armoryItems.length) {
      host.innerHTML = armoryNotice('ARMORY REGISTRY UNAVAILABLE',
        armoryNote || 'No /api/armory route answered on this server. The catalogue below the fold is the design export’s placeholder data and has been hidden rather than shown as real.')
      paintTiles([NONE, NONE, NONE, NONE])
      return
    }

    var html = ''
    for (var i = 0; i < armoryItems.length; i++) html += armoryCard(armoryItems[i])
    host.innerHTML = html
    paintTiles(armoryTileValues(armoryItems))
  }

  function onArmoryClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-armory-toggle]') : null
    if (!t) return
    e.stopPropagation()
    var id = t.getAttribute('data-armory-toggle')
    if (!toggleUrl) { inst.flash(id.toUpperCase() + ' · NO TOGGLE ROUTE'); return }
    t.textContent = 'WORKING…'
    post(toggleUrl, { id: id }).then(function (r) {
      if (r.status === 404) {
        toggleUrl = null
        inst.flash(id.toUpperCase() + ' · NO TOGGLE ROUTE ON THIS SERVER')
      } else if (!r.ok) {
        inst.flash(id.toUpperCase() + ' · TOGGLE FAILED · ' + (r.status || 'NO RESPONSE'))
      } else {
        inst.flash(id.toUpperCase() + ' · TOGGLED')
      }
      // The server is the authority on the new state, so re-read rather than
      // flipping the badge optimistically.
      tickArmory()
    })
  }

  // -- polling -----------------------------------------------------------
  function tickStatus() {
    if (!statusUrl) return
    get(statusUrl).then(function (json) {
      var idx = json ? indexStatus(json) : null
      if (!idx) return
      var changed = JSON.stringify(idx) !== JSON.stringify(live)
      live = idx
      phase = 'live'
      if (changed) refresh()
    })
  }

  function tickArmory() {
    if (!armoryUrl) return
    get(armoryUrl).then(function (json) {
      var rows = listOf(json)
      var items = []
      for (var i = 0; i < rows.length; i++) {
        var it = armoryItem(rows[i])
        if (it) items.push(it)
      }
      if (!items.length) {
        armoryPhase = 'nodata'
        armoryNote = 'GET ' + armoryUrl + ' answered but reported no tools.'
      } else {
        armoryPhase = 'live'
        armoryItems = items
      }
      paintArmory()
    })
  }

  // -- run ---------------------------------------------------------------
  function start() {
    inst = findInstance()
    if (!inst) return false
    if (typeof inst.svcVals !== 'function') {
      console.warn('[fleet-services] export has no svcVals(); detail screen left alone')
      return true
    }

    origSvcVals = inst.svcVals
    baseline = harvest()
    wrapSvcVals()

    // Repaint the armory whenever it is shown, since it is DOM-written rather
    // than bound and a screen change re-runs the export's panel animations.
    var origSetScreen = inst.setScreen
    inst.setScreen = function (name) {
      var out = origSetScreen.apply(this, arguments)
      if (name === 'armory') paintArmory()
      return out
    }

    firstRoute(STATUS_ROUTES, function (j) { return listOf(j).length > 0 }).then(function (url) {
      if (!url) {
        phase = 'nodata'
        console.warn('[fleet-services] no service status route; tried:', STATUS_ROUTES.join(' '))
        refresh()
        return
      }
      statusUrl = url
      tickStatus()
      setInterval(tickStatus, STATUS_POLL_MS)
    })

    firstRoute(ARMORY_ROUTES, function (j) {
      return Array.isArray(j) || (j && typeof j === 'object')
    }).then(function (url) {
      if (!url) {
        armoryPhase = 'nodata'
        armoryNote = 'No /api/armory route answered (tried ' + ARMORY_ROUTES.join(', ') + ').'
        paintArmory()
        return
      }
      armoryUrl = url
      toggleUrl = url.replace(/\/?$/, '') + '/toggle'
      tickArmory()
      setInterval(tickArmory, ARMORY_POLL_MS)
    })

    // Preflight the launch route from the server's own route table where one
    // is published, so the CTA can say NOT REACHABLE instead of offering a
    // START that will 404. Without /api/meta it stays undefined and is
    // resolved on the first click.
    launchUrl = undefined
    firstRoute(META_ROUTES, function (j) { return j && Array.isArray(j.routes) }).then(function (url) {
      if (!url) return
      get(url).then(function (j) {
        if (!j || !Array.isArray(j.routes)) return
        var found = null
        for (var i = 0; i < j.routes.length; i++) {
          if (/^POST\s+\/api\/services\/launch$/.test(String(j.routes[i]))) { found = '/api/services/launch'; break }
        }
        launchUrl = found
        refresh()
      })
    })

    window.__fleetServices = {
      get instance() { return inst },
      get statusUrl() { return statusUrl },
      get armoryUrl() { return armoryUrl },
      get launchUrl() { return launchUrl },
      get phase() { return phase },
      get live() { return live },
      get baseline() { return baseline },
      get armoryItems() { return armoryItems },
      refresh: tickStatus,
    }
    return true
  }

  // The runtime loads React, compiles with Babel, then mounts, so the instance
  // does not exist at DOMContentLoaded. Poll rather than guess a delay.
  var tries = 0
  var waiting = setInterval(function () {
    if (start() || ++tries > 160) clearInterval(waiting)
  }, 250)
})()
