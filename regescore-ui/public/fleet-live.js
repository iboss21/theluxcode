/**
 * Self-contained live bridge for the RegesCore dashboard.
 *
 * Drops in beside the export inside whatever server already hosts it — no
 * config, no build, no knowledge of that server's API shape required. It
 * discovers the telemetry endpoint by asking, then replaces the export's
 * simulation with the real numbers.
 *
 * Two problems it solves at once:
 *
 * 1. The export ships a simulator. componentDidMount indexes the bindings
 *    (this.live from [data-live], this.bars, this.logs), retarget() picks
 *    random targets every 720ms, frame() eases toward them and paints. Left
 *    alone it overwrites any real value within one animation frame. The class
 *    instance is not a fiber stateNode — the dc runtime's StreamableComponent
 *    keeps it on `.logic` — which is why DOM-level writes lose and only the
 *    instance handle wins.
 *
 * 2. The host server's telemetry route is unknown and differs between builds.
 *    Rather than hardcode one, CANDIDATES are probed in order and the first
 *    response carrying recognisable host fields wins. Shapes are normalised,
 *    so a route returning {cpu:{percent}}, {cpu_percent}, or {cpu:41} all work.
 *
 * Where no measurement exists, the binding shows a dash. A dashboard whose job
 * is answering "what is actually happening" must not substitute a plausible
 * number for a missing one.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
(function () {
  'use strict'

  var NONE = '—'
  var POLL_MS = 2000

  // Probed in order; the first that answers with host-shaped JSON is adopted.
  // Relative so it works under /fleet/ as well as at the root.
  var CANDIDATES = [
    '/api/system/stats', 'api/system/stats',
    '/api/stats', 'api/stats',
    '/api/telemetry', 'api/telemetry',
    '/api/vitals', 'api/vitals',
    '/api/host', 'api/host',
    '/api/system', 'api/system',
  ]
  var SERVICE_ROUTES = ['/api/services/status', 'api/services/status', '/api/services', 'api/services']

  var statsUrl = null
  var servicesUrl = null
  var inst = null

  // -- instance handle ---------------------------------------------------
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
        // The dc runtime compiles the <script type="text/x-dc"> body and holds
        // the result here, rendering its output itself.
        if (node.logic && node.logic.sim && typeof node.logic.frame === 'function') return node.logic
      }
      fiber = fiber.return
    }
    return null
  }

  // -- shape normalisation -----------------------------------------------
  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v
    if (typeof v === 'string') { var n = parseFloat(v); return isFinite(n) ? n : null }
    return null
  }

  function dig(obj, paths) {
    for (var i = 0; i < paths.length; i++) {
      var parts = paths[i].split('.')
      var cur = obj
      var ok = true
      for (var j = 0; j < parts.length; j++) {
        if (cur == null || typeof cur !== 'object' || !(parts[j] in cur)) { ok = false; break }
        cur = cur[parts[j]]
      }
      if (ok) { var v = num(cur); if (v !== null) return v }
    }
    return null
  }

  /** Pull the four vitals out of whatever shape the host returned. */
  function normalise(raw) {
    if (!raw || typeof raw !== 'object') return null
    var d = raw.data && typeof raw.data === 'object' ? raw.data : raw
    var out = {
      cpu: dig(d, ['cpu.percent', 'cpu.usage', 'cpu_percent', 'cpuPercent', 'cpu', 'host.cpu']),
      ramPct: dig(d, ['memory.percent', 'mem.percent', 'memory_percent', 'ramPercent', 'ram.percent', 'ram']),
      ramUsed: dig(d, ['memory.usedBytes', 'memory.used', 'mem.used', 'ram.used', 'memory_used_bytes']),
      ramTotal: dig(d, ['memory.totalBytes', 'memory.total', 'mem.total', 'ram.total', 'memory_total_bytes']),
      load: dig(d, ['cpu.load.0', 'load.0', 'loadavg.0', 'load1', 'load_average', 'cpu.load1']),
      temp: dig(d, ['thermal', 'temperature', 'temp', 'cpu.temp', 'thermal.cpu']),
      uptime: dig(d, ['uptimeSeconds', 'uptime', 'host.uptime', 'uptime_seconds']),
    }
    // Recognised only if at least one vital came back — otherwise the route is
    // something else entirely and must not be adopted.
    return (out.cpu !== null || out.ramPct !== null || out.ramUsed !== null) ? out : null
  }

  function get(url) {
    return fetch(url, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .catch(function () { return null })
  }

  function discover() {
    var i = 0
    function next() {
      if (i >= CANDIDATES.length) return Promise.resolve(null)
      var url = CANDIDATES[i++]
      return get(url).then(function (json) {
        return normalise(json) ? url : next()
      })
    }
    return next()
  }

  function discoverServices() {
    var i = 0
    function next() {
      if (i >= SERVICE_ROUTES.length) return Promise.resolve(null)
      var url = SERVICE_ROUTES[i++]
      return get(url).then(function (json) {
        if (json && (Array.isArray(json) || Array.isArray(json.services))) return url
        return next()
      })
    }
    return next()
  }

  // -- painting ----------------------------------------------------------
  function set(key, value) {
    if (!inst || !inst.live) return
    var el = inst.live[key]
    if (el && value != null && el.textContent !== value) el.textContent = value
  }

  function gb(bytes) { return (bytes / 1073741824).toFixed(1) }

  function uptimeText(seconds) {
    var d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600)
    var m = Math.floor((seconds % 3600) / 60)
    return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm'
  }

  function paint(v) {
    if (!inst) return
    var sim = inst.sim
    // frame() eases sim -> DOM, so writing the target keeps the export's
    // animation and only changes the destination.
    if (v.cpu !== null) sim.cpuT = v.cpu
    if (v.ramPct !== null) sim.ramT = v.ramPct
    if (v.load !== null) sim.loadT = v.load
    if (v.temp !== null) sim.tempT = v.temp

    if (v.ramUsed !== null && v.ramTotal !== null) {
      set('ramGb', gb(v.ramUsed) + ' / ' + gb(v.ramTotal) + ' GB')
    }
    if (v.ramPct !== null) set('ramPct', v.ramPct.toFixed(1) + '%')
    if (v.uptime !== null) set('sysOn', uptimeText(v.uptime))
    if (v.temp === null) { set('temp', NONE); set('temp2', NONE) }
  }

  function paintServices(json) {
    var list = Array.isArray(json) ? json : (json.services || [])
    var up = 0
    list.forEach(function (s) {
      var id = s.id || s.name
      var isUp = s.status === 'up' || s.up === true || s.online === true || s.healthy === true
      if (isUp) up++
      if (!id) return
      var nodes = document.querySelectorAll('[data-svc="' + id + '"]')
      for (var i = 0; i < nodes.length; i++) {
        nodes[i].setAttribute('data-status', isUp ? 'up' : 'down')
        var dot = nodes[i].querySelector('[data-flash], span')
        if (dot) dot.style.background = isUp ? '#2FE07C' : '#E5343F'
      }
    })
    if (list.length) set('svUp', up + ' / ' + list.length)
  }

  function stamp() {
    var d = new Date()
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(function (n) { return String(n).padStart(2, '0') }).join(':')
  }

  function log(text, color) {
    if (!inst || !inst.logs) return
    var html = '<span style="color:' + (color || '#2FE07C') + ';">' + stamp() + '</span> ' + text
    for (var i = inst.logs.length - 1; i > 0; i--) {
      if (inst.logs[i] && inst.logs[i - 1]) inst.logs[i].innerHTML = inst.logs[i - 1].innerHTML
    }
    if (inst.logs[0]) {
      inst.logs[0].innerHTML = html
      inst.logs[0].style.animation = 'none'
      void inst.logs[0].offsetWidth
      inst.logs[0].style.animation = 'rowIn .4s cubic-bezier(.16,1,.3,1) both'
    }
  }

  // -- run ---------------------------------------------------------------
  function tick() {
    if (!statsUrl) return
    get(statsUrl).then(function (json) {
      var v = normalise(json)
      if (v) paint(v)
    })
  }

  function tickServices() {
    if (!servicesUrl) return
    get(servicesUrl).then(function (json) { if (json) paintServices(json) })
  }

  function start() {
    inst = findInstance()
    if (!inst) return false

    discover().then(function (url) {
      if (!url) {
        // Nothing to show is better than showing invented numbers, but the
        // simulation is left running rather than blanking a working dashboard:
        // an operator can tell a simulated panel from a broken one only if it
        // says so, so this goes to the console and the log strip.
        console.warn('[fleet-live] no telemetry route found; tried:', CANDIDATES.join(' '))
        log('fleet-live · no telemetry route found · panels are simulated', '#F5A524')
        return
      }
      statsUrl = url
      // Only now is it safe to silence the simulator: with a real source
      // confirmed, retarget()/pushLog() would just overwrite it.
      inst.retarget = function () {}
      inst.pushLog = function () {}
      log('fleet-live · telemetry from ' + url, '#4C8DFF')
      tick()
      setInterval(tick, POLL_MS)
    })

    discoverServices().then(function (url) {
      if (!url) return
      servicesUrl = url
      tickServices()
      setInterval(tickServices, 8000)
    })

    window.__fleetLive = { get instance() { return inst }, get statsUrl() { return statsUrl } }
    return true
  }

  // The runtime loads React, compiles with Babel, then mounts, so the instance
  // does not exist at DOMContentLoaded. Poll rather than guess a delay.
  var tries = 0
  var waiting = setInterval(function () {
    if (start() || ++tries > 160) clearInterval(waiting)
  }, 250)
})()
