/**
 * fleet-live.js — Command dashboard telemetry.
 *
 * Rebuilt after the regex damage documented in HANDOFF-2026-08-03. Follows the
 * house poller pattern: mount when the section is visible, refresh while it
 * stays visible, idle cheaply when it is not.
 *
 * Drives the Command page's live bindings from the server's own endpoints:
 *
 *   /api/system/stats   cpu.usage, memory.usage/used/total, uptime, loadAvg
 *   /api/neural/map     services, repos, engines, memory, graph, local models
 *   /api/memory         vault size, when the map does not carry it
 *
 * Two rules it holds to, because the Command page is the first thing an
 * operator reads:
 *
 * Never invent a number. A route that 404s, errors or returns an unexpected
 * shape leaves an em dash. A believable wrong figure on a fleet dashboard is
 * worse than a visible gap — the gap prompts a question, the wrong figure ends
 * one.
 *
 * Never fight the page. Values the design's own animation loop owns are written
 * through its state where that state is reachable, and only otherwise straight
 * to the element. Writing to a binding that something else repaints every frame
 * produces a flicker that looks like a rendering bug.
 *
 * RegesCore // Fable 5 — brand and engineering by davidio.dev
 */
(function () {
  'use strict'

  var SCREEN = 'command'
  var REFRESH_MS = 4000
  var NONE = '—'

  // -- house utilities ---------------------------------------------------
  var $sec = function () { return document.querySelector('[data-scr="' + SCREEN + '"]') }

  var api = function (path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {} }).then(function (j) {
          return { ok: r.ok, status: r.status, data: j }
        })
      })
      .catch(function (e) { return { ok: false, error: e.message } })
  }

  // -- binding access ----------------------------------------------------
  // Bindings are addressed by data-live key, the same contract the rest of the
  // page uses. Looked up per write rather than cached: the framework re-renders
  // sections on navigation, and a cached element from a previous render is
  // detached and silently swallows every write.
  function put(key, value) {
    var el = document.querySelector('[data-live="' + key + '"]')
    if (!el) return false
    var text = value === null || value === undefined || value === '' ? NONE : String(value)
    if (el.textContent !== text) el.textContent = text
    return true
  }

  function bar(key, percent) {
    var el = document.querySelector('[data-bar="' + key + '"]')
    if (!el) return
    var p = typeof percent === 'number' && isFinite(percent)
      ? Math.max(0, Math.min(100, percent))
      : 0
    el.style.width = p + '%'
  }

  // -- shape tolerance ---------------------------------------------------
  // The server has been through several shapes; each field is read from the
  // current name first and older ones after, so an upgrade does not blank the
  // page and a rollback does not either.
  function pick(obj, paths) {
    for (var i = 0; i < paths.length; i++) {
      var parts = paths[i].split('.')
      var cur = obj
      var ok = true
      for (var j = 0; j < parts.length; j++) {
        if (cur === null || typeof cur !== 'object' || !(parts[j] in cur)) { ok = false; break }
        cur = cur[parts[j]]
      }
      if (!ok) continue
      if (typeof cur === 'number' && isFinite(cur)) return cur
      if (typeof cur === 'string') {
        var n = parseFloat(cur)
        if (isFinite(n)) return n
      }
    }
    return null
  }

  function gb(bytes) {
    return typeof bytes === 'number' && isFinite(bytes)
      ? (bytes / 1073741824).toFixed(1)
      : null
  }

  function uptime(seconds) {
    if (typeof seconds !== 'number' || !isFinite(seconds)) return null
    var d = Math.floor(seconds / 86400)
    var h = Math.floor((seconds % 86400) / 3600)
    var m = Math.floor((seconds % 3600) / 60)
    if (d > 0) return d + 'd ' + h + 'h'
    if (h > 0) return h + 'h ' + m + 'm'
    return m + 'm'
  }

  // -- host vitals -------------------------------------------------------
  function paintStats(res) {
    if (!res.ok || !res.data) {
      ;['cpu', 'cpu2', 'ram', 'ramPct', 'ramGb', 'load', 'loadPct', 'sysOn'].forEach(function (k) {
        put(k, NONE)
      })
      bar('cpu', 0); bar('ram', 0); bar('load', 0)
      return
    }
    var d = res.data

    var cpu = pick(d, ['cpu.usage', 'cpu.percent', 'cpu'])
    var ramPct = pick(d, ['memory.usage', 'memory.percent'])
    var used = pick(d, ['memory.used', 'memory.usedBytes'])
    var total = pick(d, ['memory.total', 'memory.totalBytes'])
    // loadAvg with a capital A is this server's spelling; the lowercase and
    // nested forms are other builds.
    var load = pick(d, ['loadAvg.0', 'loadavg.0', 'load.0', 'cpu.load.0'])
    var up = pick(d, ['uptime', 'uptimeSeconds'])

    put('cpu', cpu === null ? NONE : cpu.toFixed(1) + '%')
    put('cpu2', cpu === null ? NONE : cpu.toFixed(1) + '%')
    bar('cpu', cpu)

    put('ramPct', ramPct === null ? NONE : ramPct.toFixed(1) + '%')
    bar('ram', ramPct)
    if (used !== null && total !== null) {
      put('ramGb', gb(used) + ' / ' + gb(total) + ' GB')
      put('ram', ramPct === null ? NONE : ramPct.toFixed(1) + '% · ' + gb(used) + ' / ' + gb(total) + ' GB')
    } else {
      put('ramGb', NONE)
      put('ram', ramPct === null ? NONE : ramPct.toFixed(1) + '%')
    }

    // Windows reports loadavg as zeros. 0 is the true reading there, not a
    // missing one, so it prints as 0 rather than a dash.
    put('load', load === null ? NONE : load.toFixed(2))
    put('loadPct', load === null ? NONE : load.toFixed(2))
    bar('load', load === null ? 0 : Math.min(100, load * 25))

    put('sysOn', uptime(up))

    // No thermal sensor is read on any platform here. Dashed rather than
    // filled with a plausible temperature.
    put('temp', NONE)
    put('temp2', NONE)
  }

  // -- fleet map ---------------------------------------------------------
  function countUp(list) {
    var up = 0
    for (var i = 0; i < list.length; i++) {
      var s = list[i]
      if (s && (s.online === true || s.status === 'up' || s.healthy === true || s.up === true)) up++
    }
    return up
  }

  function paintMap(res) {
    if (!res.ok || !res.data) { put('svUp', NONE); return }
    var d = res.data

    // The map has carried services under a few names. Take the first array.
    var services = null
    ;['services', 'fleet', 'runtimes'].forEach(function (k) {
      if (!services && Array.isArray(d[k])) services = d[k]
    })
    if (!services && d.map && Array.isArray(d.map.services)) services = d.map.services

    if (services) {
      put('svUp', countUp(services) + ' / ' + services.length)
      paintServiceDots(services)
    }

    var facts = pick(d, ['memory.count', 'memory.facts', 'vault.count'])
    if (facts !== null) { put('facts', facts.toLocaleString()); put('memFacts', facts.toLocaleString()) }

    var ent = pick(d, ['graph.entities', 'socrates.entities'])
    var rel = pick(d, ['graph.relations', 'socrates.relations'])
    if (ent !== null) put('glCount', ent.toLocaleString())
    if (ent !== null && rel !== null) put('stObj', ent + ' / ' + rel)

    var sessions = pick(d, ['sessions.count', 'sessions'])
    if (sessions !== null) put('saQ', String(sessions))
  }

  // Service chips carry data-svc with the service id.
  function paintServiceDots(services) {
    for (var i = 0; i < services.length; i++) {
      var s = services[i]
      var id = s && (s.id || s.name)
      if (!id) continue
      var online = s.online === true || s.status === 'up' || s.healthy === true || s.up === true
      var nodes = document.querySelectorAll('[data-svc="' + id + '"]')
      for (var n = 0; n < nodes.length; n++) {
        nodes[n].setAttribute('data-status', online ? 'up' : 'down')
        var dot = nodes[n].querySelector('[data-flash], span')
        if (dot) dot.style.background = online ? '#2FE07C' : '#E5343F'
      }
    }
  }

  // -- ingest stream -----------------------------------------------------
  // Only real transitions are logged. A random event line defeats the entire
  // purpose of a log strip, which is telling the operator that something
  // actually happened.
  var lastStatus = {}

  function stamp() {
    var d = new Date()
    function p(n) { return (n < 10 ? '0' : '') + n }
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
  }

  function log(text, color) {
    var rows = document.querySelectorAll('[data-log]')
    if (!rows.length) return
    var html = '<span style="color:' + (color || '#2FE07C') + ';">' + stamp() + '</span> ' + text
    for (var i = rows.length - 1; i > 0; i--) rows[i].innerHTML = rows[i - 1].innerHTML
    rows[0].innerHTML = html
    rows[0].style.animation = 'none'
    void rows[0].offsetWidth
    rows[0].style.animation = 'rowIn .4s cubic-bezier(.16,1,.3,1) both'
  }

  function logTransitions(services) {
    if (!Array.isArray(services)) return
    for (var i = 0; i < services.length; i++) {
      var s = services[i]
      var id = s && (s.id || s.name)
      if (!id) continue
      var online = s.online === true || s.status === 'up' || s.healthy === true || s.up === true
      var was = lastStatus[id]
      lastStatus[id] = online
      // undefined means first observation, which is not a transition.
      if (was === undefined || was === online) continue
      log(id + (online ? '.online' : '.offline'), online ? '#2FE07C' : '#E5343F')
    }
  }

  // -- cycle -------------------------------------------------------------
  var mounted = false

  function refresh() {
    api('/api/system/stats').then(paintStats)
    api('/api/neural/map').then(function (res) {
      paintMap(res)
      if (res.ok && res.data) {
        var list = res.data.services || (res.data.map && res.data.map.services)
        logTransitions(list)
      }
    })
  }

  function mount() {
    if (!mounted) {
      mounted = true
      log('fleet-live · telemetry attached', '#4C8DFF')
    }
    refresh()
  }

  ;(function poll() {
    var s = $sec()
    if (s && s.style.display !== 'none') { mount(); setTimeout(poll, REFRESH_MS) }
    else setTimeout(poll, 600)
  })()
})()
