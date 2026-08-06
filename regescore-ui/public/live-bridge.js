/**
 * Live data bridge: replaces the dashboard's simulation with real telemetry.
 *
 * The export ships a self-contained simulator. componentDidMount indexes every
 * binding - this.live[key] from [data-live], this.bars from [data-bar],
 * this.logs from [data-log] - then runs three loops:
 *
 *   retarget()  every 720ms   picks new random targets in this.sim
 *   frame(t)    every frame   eases sim values toward those targets and paints
 *   pushLog()   every 2100ms  shifts a random event line into the log rows
 *
 * The clean seam is that frame() only reads this.sim and never checks whether
 * the numbers are real - and the design already declares a `liveData` boolean
 * prop that both retarget() and pushLog() bail out on. So this bridge stops
 * those two, writes measured values into this.sim, and lets frame() keep doing
 * the easing and painting. The animation and polish are the export's; only the
 * numbers change. Nothing in index.dc.html is modified.
 *
 * Where there is no measurement, the binding shows a dash. That is deliberate:
 * a dashboard whose job is answering "what is actually happening" must not
 * substitute a plausible number for a missing one, because a believable fake
 * is worse than a visible gap.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
(function () {
  'use strict'

  var POLL_FAST_MS = 2000   // host telemetry
  var POLL_SLOW_MS = 8000   // service sweep, which costs 27 probes
  var NONE = '—'

  var state = { stats: null, services: null, meta: null, voice: null, model: null }
  var inst = null
  var seenStatus = {}

  // -- reaching the component -------------------------------------------
  /**
   * Walk React's fiber tree up from the root element to the class instance.
   * The instance is the only place the sim lives, and it is not exposed on
   * window; the alternative - writing to the DOM directly - loses to frame()
   * on the very next animation frame.
   */
  function findInstance() {
    var root = document.querySelector('[data-screen-label]')
    if (!root) return null
    var key = Object.keys(root).find(function (k) {
      return k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0
    })
    if (!key) return null

    // The export's class is never a fiber stateNode. The dc runtime wraps it:
    // StreamableComponent compiles the <script type="text/x-dc"> body and keeps
    // the resulting object on `.logic`, rendering its output itself. So the
    // instance is one property off the wrapper, not a node in the tree - which
    // is why searching stateNodes for `sim` finds nothing.
    var fiber = root[key]
    var seen = new Set()
    while (fiber && !seen.has(fiber)) {
      seen.add(fiber)
      var node = fiber.stateNode
      if (node && typeof node === 'object') {
        if (node.sim && typeof node.frame === 'function') return node
        var logic = node.logic
        if (logic && logic.sim && typeof logic.frame === 'function') return logic
      }
      fiber = fiber.return
    }
    return null
  }

  function takeOver(component) {
    if (component.__regescoreBridged) return
    component.__regescoreBridged = true
    // Both are no-ops rather than deleted: the intervals that call them are
    // already scheduled and clearing them needs ids we do not have.
    component.retarget = function () {}
    component.pushLog = function () {}
  }

  // -- fetching ----------------------------------------------------------
  function get(path) {
    return fetch(path, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .catch(function () { return null })
  }

  function pollFast() {
    get('/api/system/stats').then(function (data) { if (data) state.stats = data; apply() })
  }

  function pollSlow() {
    get('/api/services/status').then(function (data) {
      if (!data) return
      logServiceChanges(data)
      state.services = data
      apply()
      paintServices(data)
    })
    get('/api/voice/engines').then(function (data) { if (data) state.voice = data; apply() })
    get('/api/agent/models').then(function (data) {
      if (data && data.models && data.models.length) state.model = data.models[0]
      apply()
    })
  }

  // -- writing -----------------------------------------------------------
  function bytesToGb(n) { return (n / 1073741824).toFixed(1) }

  /**
   * Push measured values into the sim. Both the current and target fields are
   * set for the eased metrics so frame() converges instead of drifting back.
   */
  function apply() {
    if (!inst) return
    var sim = inst.sim
    var stats = state.stats

    if (stats) {
      if (typeof stats.cpu.percent === 'number') { sim.cpuT = stats.cpu.percent }
      if (typeof stats.memory.percent === 'number') { sim.ramT = stats.memory.percent }
      if (stats.cpu.load && typeof stats.cpu.load[0] === 'number') { sim.loadT = stats.cpu.load[0] }
      // No thermal sensor is read on any platform yet, so this stays put
      // rather than easing toward an invented temperature.
      if (typeof stats.thermal === 'number') sim.tempT = stats.thermal
    }

    writeDirect()
  }

  /**
   * Bindings frame() does not own. Written straight to the element, because
   * the export never touches these keys once mounted.
   */
  function writeDirect() {
    var stats = state.stats
    var services = state.services

    set('ramGb', stats ? bytesToGb(stats.memory.usedBytes) + ' / ' + bytesToGb(stats.memory.totalBytes) + ' GB' : NONE)
    set('ramPct', stats && stats.memory.percent != null ? stats.memory.percent + '%' : NONE)
    set('sysOn', stats ? uptime(stats.uptimeSeconds) : NONE)
    set('temp', stats && stats.thermal == null ? NONE : undefined)
    set('temp2', stats && stats.thermal == null ? NONE : undefined)

    if (services) {
      set('svUp', services.summary.up + ' / ' + services.summary.total)
      set('sysOn2', undefined)
    }

    set('raModel', state.model || NONE)
    set('raState', state.model ? 'READY' : 'NO ENDPOINT')

    if (state.voice && state.voice.engines) {
      var live = state.voice.engines.filter(function (e) { return e.up })
      set('soEng', live.length ? live[0].engine : NONE)
      set('vcVad', live.length ? 'READY' : 'OFFLINE')
    }

    // Every remaining binding has no measurement behind it. Dashed once, on
    // the first pass, so the panels read as "not wired yet" rather than as
    // healthy numbers that happen to be wrong.
    UNSOURCED.forEach(function (key) { set(key, NONE) })
  }

  function set(key, value) {
    if (value === undefined || !inst || !inst.live) return
    var el = inst.live[key]
    if (el && el.textContent !== value) el.textContent = value
  }

  function uptime(seconds) {
    var d = Math.floor(seconds / 86400)
    var h = Math.floor((seconds % 86400) / 3600)
    var m = Math.floor((seconds % 3600) / 60)
    return d > 0 ? d + 'd ' + h + 'h' : h > 0 ? h + 'h ' + m + 'm' : m + 'm'
  }

  // Keys whose backing service is not implemented in /api yet. Listed
  // explicitly so adding a route means deleting a line here, and so nobody
  // has to guess which panels are live.
  //
  // `facts` and `memFacts` are deliberately absent: frame() paints those from
  // this.sim every animation frame, so a dash written here is overwritten
  // within 16ms. With retarget() neutralised they hold the design's default
  // instead of drifting randomly, which is the honest resting state until a
  // memory route exists to drive sim.facts.
  var UNSOURCED = [
    'acJit', 'acTasks', 'ahAgents', 'ahCalls', 'ahTasks', 'amVec',
    'clDur', 'clJit', 'clLat', 'clSent', 'feRows', 'glCount',
    'igPct', 'igVram', 'mcTools', 'memWrote', 'mgPct',
    'odTouch', 'raJit', 'raRpm', 'raTps', 'riChunks', 'rqMs', 'rsStep',
    'saQ', 'soFol', 'soImp', 'stObj', 'vcNoise', 'vcPartial', 'vcPeak',
    'vcTime', 'wfMs', 'wsCache', 'wsCount', 'wsMs',
  ]

  // -- service tiles -----------------------------------------------------
  var COLORS = { up: '#2FE07C', down: '#E5343F', timeout: '#F5A524' }

  function paintServices(data) {
    data.services.forEach(function (service) {
      var nodes = document.querySelectorAll('[data-svc="' + service.id + '"]')
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i]
        var dot = el.querySelector('[data-flash], .dot, span')
        var color = COLORS[service.status] || COLORS.down
        if (dot) dot.style.background = color
        el.setAttribute('data-status', service.status)
        el.setAttribute('title',
          service.name + ' · ' + service.status +
          (service.httpStatus ? ' · HTTP ' + service.httpStatus : '') +
          ' · ' + service.latencyMs + 'ms · ' + service.url +
          (service.status !== 'up' && service.docker ? ' (needs Docker)' : ''))
      }
    })
  }

  // -- real log lines ----------------------------------------------------
  /**
   * The log rows exist to show that something happened. Random events defeat
   * that, so only genuine transitions are pushed: a service changing state,
   * and a periodic measured vitals line.
   */
  function logServiceChanges(next) {
    next.services.forEach(function (service) {
      var was = seenStatus[service.id]
      seenStatus[service.id] = service.status
      if (was === undefined || was === service.status) return
      pushLine(service.id + '.' + service.status +
        (service.httpStatus ? ' · HTTP ' + service.httpStatus : '') +
        ' · ' + service.latencyMs + 'ms',
        service.status === 'up' ? '#2FE07C' : '#E5343F')
    })
  }

  function stamp() {
    var d = new Date()
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(function (n) { return String(n).padStart(2, '0') }).join(':')
  }

  function pushLine(text, color) {
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

  function pushVitals() {
    if (!inst || !inst.tlogs || !state.stats) return
    var s = state.stats
    var html = '<span style="color:#2FE07C;">' + stamp() + '</span> ' +
      '<span style="color:#55555E;">cpu</span> ' + (s.cpu.percent == null ? NONE : s.cpu.percent + '%') + ' ' +
      '<span style="color:#55555E;">ram</span> ' + (s.memory.percent == null ? NONE : s.memory.percent + '%') + ' ' +
      '<span style="color:#55555E;">load</span> ' +
      (s.cpu.load ? s.cpu.load[0].toFixed(2) : NONE)
    for (var i = inst.tlogs.length - 1; i > 0; i--) {
      if (inst.tlogs[i] && inst.tlogs[i - 1]) inst.tlogs[i].innerHTML = inst.tlogs[i - 1].innerHTML
    }
    if (inst.tlogs[0]) inst.tlogs[0].innerHTML = html
  }

  // -- boot --------------------------------------------------------------
  function boot() {
    inst = findInstance()
    if (!inst) return false
    takeOver(inst)

    pollFast(); pollSlow()
    setInterval(pollFast, POLL_FAST_MS)
    setInterval(pollSlow, POLL_SLOW_MS)
    setInterval(pushVitals, 2100)

    pushLine('bridge.online · live telemetry attached', '#4C8DFF')
    window.__regescoreBridge = { state: state, instance: inst }
    return true
  }

  // The runtime loads React, compiles with Babel, then mounts, so the instance
  // does not exist at DOMContentLoaded. Poll briefly rather than guess a delay.
  var tries = 0
  var waiting = setInterval(function () {
    if (boot() || ++tries > 120) clearInterval(waiting)
  }, 250)
})()
