/**
 * Screen content for the RegesCore dashboard — the companion to fleet-live.js.
 *
 * fleet-live.js owns the numbers frame() repaints: host vitals, service tiles,
 * the dashboard counts. It never touches the twelve tool screens, so those
 * still show the design's fiction — invented facts, invented sessions, invented
 * articles. This file replaces that fiction with whatever the host's /api/*
 * actually returns, and says "no data" where it returns nothing.
 *
 * Three things make that possible without editing the export:
 *
 * 1. The instance. Same handle fleet-live.js takes: the dc runtime keeps the
 *    compiled component on StreamableComponent.logic, not on a fiber
 *    stateNode. setScreen() is wrapped so a screen loads the moment it is
 *    navigated to, rather than up to a second later.
 *
 * 2. Panels are found by their header label, not by a selector the export does
 *    not have. There are no ids and no data-hooks inside these screens: every
 *    panel is <div header><span>LABEL</span>…</div> followed by its body. Find
 *    the label, take header.nextElementSibling, and that is the body. The found
 *    element is then tagged with data-fs-key so the lookup survives a label
 *    being rewritten (the notes detail panel is titled after its note).
 *
 * 3. Rows are cloned from the design's own first row and filled by walking its
 *    text nodes in order. That keeps every border, colour and font the design
 *    chose — the row is the design's row, only the words are real. The
 *    originals are hidden rather than removed, so they stay available as
 *    templates and React never finds a child it created missing.
 *
 * Fetching is per screen and only while that screen is on-screen
 * (offsetParent !== null), refreshed on an interval. Twelve screens polling in
 * the background would be twelve times the load for eleven invisible answers.
 *
 * Where a route is missing, errors, or answers with nothing, the panel says so
 * — with the route and the status code — and every unsourced value is an em
 * dash. Four of these screens (pdf, ragquery, ragindex, email) have only POST
 * routes on the server: there is no read path, so nothing is fired and they
 * report exactly that. A believable fake is worse than a visible gap.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
(function () {
  'use strict'

  var NONE = '—'
  var REFRESH_MS = 15000   // per screen, while visible
  var VISIBLE_MS = 1000    // how often visibility is re-checked
  var MAX_ROWS = 60        // a panel is a panel, not a table dump

  var NOTE_CSS = "font:500 9px/1.7 'JetBrains Mono',monospace; letter-spacing:.14em;" +
    ' color:#55555E; padding:15px 16px;'
  var BODY_CSS = "font:400 12.5px/1.65 'Jost',sans-serif; color:#B9B9C2; padding:14px 16px;" +
    ' white-space:pre-wrap;'

  // Status/kind tokens the design colours. Cloned rows inherit the template's
  // colour, so a row whose state is not the template's would read as the
  // template's state unless the known ones are re-tinted.
  var TINT = {
    LIVE: '#2FE07C', OPEN: '#2FE07C', ACTIVE: '#2FE07C', DONE: '#6E6E78',
    CLOSED: '#6E6E78', COMPLETE: '#6E6E78', COMPLETED: '#6E6E78',
    RUNNING: '#F5A524', PENDING: '#F5A524', QUEUED: '#F5A524', HELD: '#F5A524',
    STALE: '#F5A524', REVIEW: '#F5A524', BLOCKED: '#E5343F', ERROR: '#E5343F',
    FAILED: '#E5343F', ESCALATED: '#E5343F', CONFLICT: '#E5343F', ACT: '#E5343F',
    ENTITY: '#4C8DFF', DECISION: '#2FE07C', PREFERENCE: '#2FE07C',
    PATTERN: '#F5A524', INDEXED: '#2FE07C', FILED: '#6E6E78',
  }
  TINT[NONE] = '#55555E'

  var inst = null
  var state = {}   // screen -> what was painted, for the verifier and the console

  // ------------------------------------------------------------------ instance
  // Identical walk to fleet-live.js: the class instance is not a stateNode, the
  // runtime holds it on .logic and renders its output itself.
  function findInstance() {
    var root = document.querySelector('[data-screen-label]')
    if (!root) return null
    var key = null
    var keys = Object.keys(root)
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].indexOf('__reactFiber$') === 0) { key = keys[i]; break }
    }
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

  // --------------------------------------------------------------------- fetch
  /** Never rejects. Carries the status through so a panel can name the failure. */
  function get(url) {
    return fetch(url, { headers: { accept: 'application/json' } }).then(function (r) {
      return r.text().then(function (body) {
        var json = null
        try { json = JSON.parse(body) } catch (e) { json = null }
        return { ok: r.ok, status: r.status, json: json, route: url }
      })
    }).catch(function () {
      return { ok: false, status: 0, json: null, route: url }
    })
  }

  /** 'NO DATA · /api/memory → 404' — the operator can act on that. */
  function why(res) {
    if (!res) return 'NO DATA'
    if (res.ok) return 'NO DATA · ' + res.route
    return 'NO DATA · ' + res.route + ' → ' + (res.status ? res.status : 'UNREACHABLE')
  }

  // ------------------------------------------------------------------- shapes
  function isObj(v) { return v !== null && typeof v === 'object' }

  /** First present of several field names; dotted paths allowed. */
  function pick(obj, names) {
    if (!isObj(obj)) return undefined
    for (var i = 0; i < names.length; i++) {
      var parts = names[i].split('.')
      var cur = obj
      var ok = true
      for (var j = 0; j < parts.length; j++) {
        if (!isObj(cur) || !(parts[j] in cur)) { ok = false; break }
        cur = cur[parts[j]]
      }
      if (ok && cur !== null && cur !== undefined && cur !== '') return cur
    }
    return undefined
  }

  function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v
    if (typeof v === 'string') { var n = parseFloat(v); if (isFinite(n)) return n }
    if (Array.isArray(v)) return v.length
    return null
  }

  function pickNum(obj, names) { return num(pick(obj, names)) }

  /** Strings, Anthropic-style content blocks, and {text:…} all flatten to text. */
  function textOf(v) {
    if (v === null || v === undefined) return null
    if (typeof v === 'string') return v.trim() || null
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    if (Array.isArray(v)) {
      var parts = []
      for (var i = 0; i < v.length; i++) { var t = textOf(v[i]); if (t) parts.push(t) }
      return parts.length ? parts.join(' ') : null
    }
    if (isObj(v)) return textOf(pick(v, ['text', 'content', 'value', 'message', 'body', 'name', 'title']))
    return null
  }

  function pickText(obj, names) { return textOf(pick(obj, names)) }

  /** The list inside whatever envelope the host chose. */
  function listOf(json, keys) {
    if (Array.isArray(json)) return json
    if (!isObj(json)) return []
    var names = (keys || []).concat(['items', 'results', 'rows', 'data', 'list', 'entries', 'records'])
    for (var i = 0; i < names.length; i++) {
      var v = pick(json, [names[i]])
      if (Array.isArray(v)) return v
      if (isObj(v)) {
        var inner = listOf(v, keys)
        if (inner.length) return inner
      }
    }
    return []
  }

  var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  var WHEN_FIELDS = ['createdAt', 'created_at', 'created', 'timestamp', 'ts', 'time', 'date',
    'updatedAt', 'updated_at', 'startedAt', 'started_at', 'at']

  function whenOf(item) {
    var v = pick(item, WHEN_FIELDS)
    if (v === undefined) return null
    var ms
    if (typeof v === 'number') ms = v < 1e12 ? v * 1000 : v
    else ms = Date.parse(String(v))
    if (!isFinite(ms)) return null
    return new Date(ms)
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n }

  /** Today reads as a clock, anything older as a date — the design's own idiom. */
  function whenText(d) {
    if (!d) return NONE
    var now = new Date()
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()) {
      return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
    }
    return pad2(d.getDate()) + ' ' + MONTHS[d.getMonth()]
  }

  function within24h(d) { return !!d && (Date.now() - d.getTime()) < 86400000 }

  function fmt(n) {
    if (n === null || n === undefined) return NONE
    return Math.round(n) === n ? n.toLocaleString() : String(n)
  }

  function short(s, n) {
    if (!s) return NONE
    s = String(s).replace(/\s+/g, ' ').trim()
    return s.length > n ? s.slice(0, n - 1) + '…' : s
  }

  var ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  function roman(n) {
    var out = ''
    for (var i = 0; i < ROMAN.length; i++) {
      while (n >= ROMAN[i][0]) { out += ROMAN[i][1]; n -= ROMAN[i][0] }
    }
    return out || NONE
  }

  // ----------------------------------------------------------------- dom: find
  function scrEl(name) { return document.querySelector('[data-scr="' + name + '"]') }

  function visible(name) {
    var el = scrEl(name)
    return !!el && el.offsetParent !== null
  }

  function leaves(root) {
    var all = root.querySelectorAll('span,div,p,h1,h2,h3')
    var out = []
    for (var i = 0; i < all.length; i++) if (all[i].children.length === 0) out.push(all[i])
    return out
  }

  /**
   * The label element for a panel or a tile. Matched on text, then tagged, so
   * the second call is a selector lookup and a panel titled after its own data
   * can still be found once its title has been rewritten.
   */
  function labelEl(root, label, opts) {
    opts = opts || {}
    var key = opts.key
    if (key) {
      var known = root.querySelector('[data-fs-key="' + key + '"]')
      if (known) return known
    }
    var cand = leaves(root)
    for (var i = 0; i < cand.length; i++) {
      var el = cand[i]
      if (opts.tag && el.tagName !== opts.tag) continue
      var text = (el.textContent || '').replace(/\s+/g, ' ').trim()
      var hit = label instanceof RegExp ? label.test(text)
        : opts.prefix ? text.indexOf(label) === 0 : text === label
      if (!hit) continue
      if (opts.header && !(el.parentNode && el.parentNode.nextElementSibling)) continue
      if (key) el.setAttribute('data-fs-key', key)
      return el
    }
    return null
  }

  /**
   * A panel: its label, its header row, its body, and the header's trailing
   * badge if it has one. Panel labels are spans in a header whose next sibling
   * is the body; pass tag:'DIV' for the one panel titled with a div.
   */
  function panel(scr, label, opts) {
    opts = opts || {}
    var root = scrEl(scr)
    if (!root) return null
    var lab = labelEl(root, label, {
      key: opts.key || (scr + ':' + String(label)),
      tag: opts.tag || 'SPAN',
      prefix: opts.prefix,
      header: true,
    })
    if (!lab) return null
    var header = lab.parentNode
    var body = header.nextElementSibling
    if (!body) return null
    var meta = header.lastElementChild
    if (meta === lab || (meta && meta.children.length) || (meta && meta.tagName !== 'SPAN')) meta = null
    return { root: root, label: lab, header: header, body: body, meta: meta }
  }

  // ---------------------------------------------------------------- dom: write
  /** Text nodes carrying words, in document order — the slots a row can fill. */
  function slotsOf(el) {
    if (el.__fsSlots) return el.__fsSlots
    var out = []
    ;(function walk(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { if (/\S/.test(c.nodeValue)) out.push(c) }
        else if (c.nodeType === 1) walk(c)
      }
    })(el)
    el.__fsSlots = out
    return out
  }

  function tint(node, value) {
    var el = node.parentNode
    if (!el || el.nodeType !== 1) return
    var c = TINT[String(value).toUpperCase()]
    if (c) el.style.color = c
  }

  function mark(el, how) { if (el && el.nodeType === 1) el.setAttribute('data-fs', how) }

  /** Write into an element that may wrap its text (or a [data-live] span). */
  function setLeaf(el, value) {
    if (!el) return false
    var live = el.querySelector && el.querySelector('[data-live]')
    var target = live || el
    var v = value === null || value === undefined || value === '' ? NONE : String(value)
    if (target.children.length === 0) {
      if (target.textContent !== v) target.textContent = v
    } else {
      var s = slotsOf(target)
      if (!s.length) return false
      s[0].nodeValue = v
      tint(s[0], v)
    }
    mark(target, v === NONE ? 'dash' : 'value')
    return true
  }

  /** A stat tile: a small label with its value in the next element. */
  function setTile(scr, label, value, opts) {
    opts = opts || {}
    var root = scrEl(scr)
    if (!root) return false
    var lab = labelEl(root, label, { key: opts.key || (scr + ':tile:' + label), tag: opts.tag })
    if (!lab) return false
    var el = lab.nextElementSibling
    if (!el) return false
    return setLeaf(el, value)
  }

  function fillRow(row, values) {
    var s = slotsOf(row)
    for (var i = 0; i < s.length; i++) {
      var v = i < values.length && values[i] !== null && values[i] !== undefined && values[i] !== ''
        ? String(values[i]) : NONE
      if (s[i].nodeValue !== v) s[i].nodeValue = v
      tint(s[i], v)
    }
    return s.length
  }

  /**
   * Take a body over: clone the design's row as a template, then hide the
   * originals. Hidden rather than removed — React created those children, and
   * a template that is still in the document cannot go stale.
   */
  function takeover(body, opts) {
    if (body.__fs) return body.__fs
    var kids = []
    for (var i = 0; i < body.children.length; i++) kids.push(body.children[i])
    var keep = opts && opts.skipHeader ? 1 : 0
    var tpl = kids[keep] ? kids[keep].cloneNode(true) : null
    for (var j = keep; j < kids.length; j++) {
      kids[j].setAttribute('data-fs-orig', '')
      kids[j].style.display = 'none'
    }
    body.__fs = { tpl: tpl, mine: [], note: null }
    return body.__fs
  }

  function dropNote(st) {
    if (st.note && st.note.parentNode) st.note.parentNode.removeChild(st.note)
    st.note = null
  }

  function noData(body, msg, opts) {
    var st = takeover(body, opts)
    while (st.mine.length) {
      var el = st.mine.pop()
      if (el.parentNode) el.parentNode.removeChild(el)
    }
    if (!st.note) {
      st.note = document.createElement('div')
      st.note.setAttribute('data-fs-note', '')
      st.note.setAttribute('style', NOTE_CSS)
      body.appendChild(st.note)
    }
    st.note.textContent = msg || 'NO DATA'
    body.setAttribute('data-fs', 'nodata')
    return false
  }

  /** values: array of per-row arrays of strings, in the row's slot order. */
  function paintRows(body, values, opts) {
    opts = opts || {}
    if (!body) return false
    if (!values || !values.length) return noData(body, opts.msg, opts)
    var st = takeover(body, opts)
    if (!st.tpl) return noData(body, opts.msg, opts)
    dropNote(st)
    var n = Math.min(values.length, opts.max || MAX_ROWS)
    while (st.mine.length > n) {
      var gone = st.mine.pop()
      if (gone.parentNode) gone.parentNode.removeChild(gone)
    }
    while (st.mine.length < n) {
      var c = st.tpl.cloneNode(true)
      c.setAttribute('data-fs-row', '')
      body.appendChild(c)
      st.mine.push(c)
    }
    for (var i = 0; i < n; i++) fillRow(st.mine[i], values[i])
    body.setAttribute('data-fs', 'rows:' + n)
    return true
  }

  /**
   * Panels whose rows are fixed label/value pairs the design already names -
   * BY KIND, MERGE PLAN, PIPELINE, COMPLIANCE. The rows are the design's own
   * and stay in place; only the value, and the bar under it, are written.
   */
  function paintPairs(body, lookup, opts) {
    opts = opts || {}
    if (!body) return false
    var wrote = 0
    var vals = []
    for (var i = 0; i < body.children.length; i++) {
      var row = body.children[i]
      if (row.hasAttribute('data-fs-row') || row.hasAttribute('data-fs-note')) continue
      var s = slotsOf(row)
      if (s.length < 2) continue
      var label = s[0].nodeValue.replace(/\s+/g, ' ').trim()
      var v = lookup[label]
      if (v === undefined) v = lookup[label.toUpperCase()]
      var text = v === null || v === undefined || v === '' ? NONE : String(v)
      s[1].nodeValue = text
      tint(s[1], text)
      mark(row, text === NONE ? 'dash' : 'value')
      if (text !== NONE) wrote++
      vals.push({ row: row, n: num(v) })
    }
    // Bars are scaled against the largest real value, or emptied when nothing
    // real came back - a full bar under an em dash would be a lie.
    var max = 0
    for (var k = 0; k < vals.length; k++) if (vals[k].n !== null && vals[k].n > max) max = vals[k].n
    for (var m = 0; m < vals.length; m++) {
      var pct = vals[m].n === null ? 0
        : opts.percent ? vals[m].n
          : max > 0 ? (vals[m].n / max) * 100 : 0
      setBar(vals[m].row, pct)
    }
    body.setAttribute('data-fs', wrote ? 'value' : 'dash')
    return wrote > 0
  }

  function setBar(row, pct) {
    var track = row.lastElementChild
    if (!track || track.tagName !== 'DIV') return
    var fill = track.firstElementChild
    if (!fill || fill.children.length) return
    var v = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, pct))
    fill.style.width = v + '%'
  }

  /**
   * Prose bodies - the graphify source, the RAG synthesis, a note's text.
   * The design's words are blanked and its elements hidden, then one block is
   * appended. Blanking rather than deleting keeps React's children intact.
   */
  function paintBlock(body, text, msg) {
    if (!body) return false
    if (!body.__fsBlank) {
      body.__fsBlank = 1
      var s = slotsOf(body)
      for (var i = 0; i < s.length; i++) s[i].nodeValue = ''
      for (var j = 0; j < body.children.length; j++) {
        body.children[j].setAttribute('data-fs-orig', '')
        body.children[j].style.display = 'none'
      }
    }
    if (!body.__fsBlock) {
      body.__fsBlock = document.createElement('div')
      body.appendChild(body.__fsBlock)
    }
    var block = body.__fsBlock
    if (text) {
      block.setAttribute('style', BODY_CSS)
      block.textContent = text
      body.setAttribute('data-fs', 'value')
      return true
    }
    block.setAttribute('style', NOTE_CSS)
    block.textContent = msg || 'NO DATA'
    body.setAttribute('data-fs', 'nodata')
    return false
  }

  function setMeta(p, value) { if (p && p.meta) setLeaf(p.meta, value) }

  // ------------------------------------------------------------------- screens
  // Each entry fetches only what its own screen shows, and paints every target
  // on that screen - including the ones that have to say "no data", because a
  // panel left alone keeps showing the design's invented content.

  var TEXT_F = ['text', 'fact', 'content', 'value', 'statement', 'body', 'summary', 'message', 'note', 'title']
  var TITLE_F = ['title', 'name', 'heading', 'subject', 'label', 'summary', 'directive', 'prompt']
  var KIND_F = ['kind', 'type', 'category', 'class', 'label', 'tag']
  var TAG_F = ['tag', 'tags.0', 'project', 'category', 'area', 'topic', 'label', 'agent', 'assignee', 'owner']
  var SOURCE_F = ['source', 'origin', 'from', 'provenance', 'file', 'path', 'context']
  var CONF_F = ['confidence', 'conf', 'score', 'certainty', 'weight']
  var STATUS_F = ['status', 'state', 'stage', 'column', 'phase']

  var DEFS = {}

  // -- memory ------------------------------------------------------------
  DEFS.memory = function () {
    return get('/api/memory').then(function (res) {
      var items = listOf(res.json, ['memory', 'facts'])
      var msg = why(res)
      var stream = panel('memory', 'FACT STREAM')
      if (stream) {
        paintRows(stream.body, items.map(function (it) {
          var conf = pickNum(it, CONF_F)
          var src = pickText(it, SOURCE_F)
          var when = whenOf(it)
          return [
            (pickText(it, KIND_F) || 'FACT').toUpperCase(),
            conf === null ? NONE : conf.toFixed(2),
            short(pickText(it, TEXT_F), 120),
            src ? (when ? src + ' · ' + whenText(when).toLowerCase() : src) : whenText(when).toLowerCase(),
          ]
        }), { msg: msg })
      }

      // FACTS HELD / WRITTEN · 24H. frame() does not own these two, so the DOM
      // is the right place for them; the count is the rows the store returned.
      setTile('memory', 'FACTS HELD', items.length ? fmt(items.length) : NONE)
      var stamped = 0, fresh = 0
      items.forEach(function (it) { var d = whenOf(it); if (d) { stamped++; if (within24h(d)) fresh++ } })
      setTile('memory', 'WRITTEN · 24H', stamped ? fmt(fresh) : NONE)
      // No route reports either of these.
      setTile('memory', 'CONTRADICTIONS', NONE)
      setTile('memory', 'STORE SIZE', NONE)

      var kinds = {}
      items.forEach(function (it) {
        var k = (pickText(it, KIND_F) || '').toUpperCase()
        if (!k) return
        kinds[k] = (kinds[k] || 0) + 1
      })
      var byKind = panel('memory', 'BY KIND')
      if (byKind) {
        paintPairs(byKind.body, {
          ENTITIES: kinds.ENTITY || kinds.ENTITIES,
          DECISIONS: kinds.DECISION || kinds.DECISIONS,
          PREFERENCES: kinds.PREFERENCE || kinds.PREFERENCES,
          PATTERNS: kinds.PATTERN || kinds.PATTERNS,
        })
      }
      var needs = panel('memory', 'NEEDS RESOLUTION')
      if (needs) {
        setMeta(needs, NONE)
        noData(needs.body, 'NO CONTRADICTION ROUTE · /api/memory CARRIES NO CONFLICT FLAG')
      }
      return { route: res.route, status: res.status, rows: items.length }
    })
  }

  // -- sessions ----------------------------------------------------------
  DEFS.sessions = function () {
    return get('/api/sessions').then(function (res) {
      var items = listOf(res.json, ['sessions'])
      var msg = why(res)
      var log = panel('sessions', 'SESSION LOG')
      if (log) {
        setMeta(log, items.length ? fmt(items.length) + ' TOTAL' : NONE)
        paintRows(log.body, items.map(function (it) {
          var tools = pickNum(it, ['tools', 'toolCalls', 'tool_calls', 'toolCount', 'calls'])
          var tokens = pickNum(it, ['tokens', 'tokenCount', 'token_count', 'totalTokens',
            'usage.total_tokens', 'usage.totalTokens'])
          return [
            whenText(whenOf(it)),
            short(pickText(it, TITLE_F) || pickText(it, ['messages.0.content', 'messages.0.text']), 70),
            tools === null ? NONE : fmt(tools),
            tokens === null ? NONE : (tokens >= 1000 ? (tokens / 1000).toFixed(1) + 'K' : fmt(tokens)),
            (pickText(it, STATUS_F) || NONE).toUpperCase(),
          ]
        }), { skipHeader: true, msg: msg })
      }

      var tok = 0, tokSeen = 0, calls = 0, callSeen = 0
      items.forEach(function (it) {
        var t = pickNum(it, ['tokens', 'tokenCount', 'token_count', 'totalTokens', 'usage.total_tokens'])
        if (t !== null) { tok += t; tokSeen++ }
        var c = pickNum(it, ['tools', 'toolCalls', 'tool_calls', 'toolCount', 'calls'])
        if (c !== null) { calls += c; callSeen++ }
      })
      var cost = panel('sessions', 'COST · 30D')
      if (cost) {
        paintPairs(cost.body, {
          SESSIONS: items.length || null,
          TOKENS: tokSeen ? (tok >= 1e6 ? (tok / 1e6).toFixed(1) + 'M' : fmt(tok)) : null,
          'TOOL CALLS': callSeen ? fmt(calls) : null,
          'LOCAL SHARE': null,
        })
      }

      // The replay panel is one session's transcript, so it needs the detail
      // route. Only the newest is fetched - the design shows one.
      var replay = panel('sessions', 'REPLAY', { prefix: true, key: 'sessions:replay' })
      if (!replay) return { route: res.route, status: res.status, rows: items.length }
      if (!items.length) {
        setLeaf(replay.label, 'REPLAY')
        noData(replay.body, msg)
        return { route: res.route, status: res.status, rows: 0 }
      }
      var first = items[0]
      var id = pick(first, ['id', 'sessionId', 'session_id', 'uuid', 'key', 'name'])
      setLeaf(replay.label, 'REPLAY · ' + whenText(whenOf(first)))
      if (id === undefined) {
        noData(replay.body, 'NO SESSION ID IN /api/sessions · CANNOT FETCH TRANSCRIPT')
        return { route: res.route, status: res.status, rows: items.length }
      }
      return get('/api/sessions/' + encodeURIComponent(id)).then(function (d) {
        var msgs = listOf(d.json, ['messages', 'turns', 'events', 'history', 'log', 'transcript'])
        paintRows(replay.body, msgs.map(function (m) {
          return [
            (pickText(m, ['role', 'from', 'speaker', 'author', 'type']) || NONE).toUpperCase(),
            short(pickText(m, ['content', 'text', 'message', 'body', 'output']), 240),
          ]
        }), { msg: why(d) })
        return { route: res.route, status: res.status, rows: items.length, replay: msgs.length }
      })
    })
  }

  // -- tasks -------------------------------------------------------------
  var TASK_PANELS = [
    { label: 'INBOX', match: ['todo', 'open', 'inbox', 'new', 'backlog', 'pending', 'captured', ''] },
    { label: 'AGENT WORKING', match: ['in_progress', 'in-progress', 'inprogress', 'working', 'active', 'running', 'doing'] },
    { label: 'NEEDS ME', match: ['blocked', 'held', 'hold', 'waiting', 'review', 'needs_review', 'escalated', 'approval'] },
    { label: 'DONE · 24H', match: ['done', 'complete', 'completed', 'closed', 'finished', 'shipped'] },
  ]

  DEFS.tasks = function () {
    return get('/api/tasks').then(function (res) {
      var items = listOf(res.json, ['tasks'])
      var msg = why(res)
      var buckets = { 0: [], 1: [], 2: [], 3: [] }
      items.forEach(function (it) {
        var s = String(pickText(it, STATUS_F) || '').toLowerCase().replace(/\s+/g, '_')
        var idx = 0
        for (var i = 0; i < TASK_PANELS.length; i++) {
          if (TASK_PANELS[i].match.indexOf(s) !== -1) { idx = i; break }
        }
        // Anything done keeps the design's 24h framing honest by carrying its
        // own timestamp; undated completions still belong in the done column.
        buckets[idx].push(it)
      })
      TASK_PANELS.forEach(function (def, i) {
        var p = panel('tasks', def.label)
        if (!p) return
        var rows = buckets[i]
        setMeta(p, items.length || res.ok ? fmt(rows.length) : NONE)
        paintRows(p.body, rows.map(function (it) {
          var when = whenOf(it)
          var due = pick(it, ['due', 'dueAt', 'due_at', 'deadline', 'due_date'])
          var prog = pickNum(it, ['progress', 'percent', 'pct'])
          var meta = due ? whenText(whenOf({ date: due }))
            : prog !== null ? Math.round(prog <= 1 ? prog * 100 : prog) + '%'
              : whenText(when)
          return [short(pickText(it, TITLE_F) || pickText(it, TEXT_F), 90),
            (pickText(it, TAG_F) || NONE).toUpperCase(), meta]
        }), { msg: msg })
      })
      return { route: res.route, status: res.status, rows: items.length }
    })
  }

  // -- journal -----------------------------------------------------------
  DEFS.journal = function () {
    return get('/api/journal').then(function (res) {
      var items = listOf(res.json, ['journal', 'entries'])
      var msg = why(res)
      var entries = panel('journal', 'ENTRIES')
      if (entries) {
        setMeta(entries, items.length ? fmt(items.length) : NONE)
        paintRows(entries.body, items.map(function (it) {
          return [
            short(pickText(it, TITLE_F) || pickText(it, TEXT_F), 40),
            whenText(whenOf(it)),
            short(pickText(it, ['text', 'content', 'body', 'entry', 'summary']), 80),
          ]
        }), { msg: msg })
      }
      var counts = {}
      items.forEach(function (it) {
        var tags = pick(it, ['tags', 'themes', 'topics', 'labels', 'keywords'])
        if (typeof tags === 'string') tags = tags.split(/[,\s]+/)
        if (!Array.isArray(tags)) { var one = pickText(it, TAG_F); tags = one ? [one] : [] }
        tags.forEach(function (t) {
          var k = textOf(t)
          if (k) counts[k.toLowerCase()] = (counts[k.toLowerCase()] || 0) + 1
        })
      })
      var names = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] })
      var themes = panel('journal', 'THEMES · 30D')
      if (themes) {
        paintRows(themes.body, names.slice(0, 8).map(function (n) { return [n, fmt(counts[n])] }), {
          msg: items.length ? 'NO TAGS ON /api/journal ENTRIES' : msg,
        })
      }
      var notes = panel('journal', 'AGENT NOTES')
      if (notes) noData(notes.body, 'NO AGENT-NOTE ROUTE · /api/journal CARRIES ENTRIES ONLY')
      return { route: res.route, status: res.status, rows: items.length }
    })
  }

  // -- notes -------------------------------------------------------------
  DEFS.notes = function () {
    return get('/api/notes').then(function (res) {
      var items = listOf(res.json, ['notes'])
      var msg = why(res)
      var list = panel('notes', 'NOTES')
      if (list) {
        setMeta(list, items.length ? fmt(items.length) : NONE)
        paintRows(list.body, items.map(function (it) {
          return [short(pickText(it, TITLE_F) || pickText(it, TEXT_F), 40),
            (pickText(it, TAG_F) || NONE).toLowerCase(), whenText(whenOf(it))]
        }), { msg: msg })
      }
      // The right-hand panel is the first note in full, so its title is data
      // too - hence the key, which survives the rewrite.
      var detail = panel('notes', 'SHARD LAG DECISION', { key: 'notes:detail' })
      if (detail) {
        if (!items.length) {
          setLeaf(detail.label, 'NOTE')
          setMeta(detail, NONE)
          paintBlock(detail.body, null, msg)
        } else {
          var it = items[0]
          var tag = pickText(it, TAG_F)
          var when = whenOf(it)
          setLeaf(detail.label, (pickText(it, TITLE_F) || 'NOTE').toUpperCase())
          setMeta(detail, (tag ? tag + ' · ' : '') + whenText(when))
          paintBlock(detail.body, pickText(it, ['text', 'content', 'body', 'note']),
            'NOTE HAS NO BODY · /api/notes')
        }
      }
      return { route: res.route, status: res.status, rows: items.length }
    })
  }

  // -- graph -------------------------------------------------------------
  var FROM_F = ['from', 'source', 'subject', 'head', 'start', 's', 'a']
  var TO_F = ['to', 'target', 'object', 'tail', 'end', 'o', 'b']
  var REL_F = ['type', 'relation', 'relationType', 'rel', 'predicate', 'label', 'kind', 'name']

  DEFS.graph = function () {
    return Promise.all([get('/api/socrates'), get('/api/sessions')]).then(function (r) {
      var res = r[0], sess = r[1]
      var j = res.json || {}
      var ents = listOf(j, ['entities', 'nodes'])
      var rels = listOf(j, ['relations', 'edges', 'links'])
      var msg = why(res)

      var root = scrEl('graph')
      if (root) {
        var hdr = labelEl(root, /ENTITIES · .*RELATIONS/, { key: 'graph:hdr', tag: 'DIV' })
        if (hdr) {
          setLeaf(hdr, (ents.length || rels.length)
            ? fmt(ents.length) + ' ENTITIES · ' + fmt(rels.length) + ' RELATIONS'
            : NONE + ' ENTITIES · ' + NONE + ' RELATIONS')
        }
      }
      setTile('graph', 'ENTITIES', ents.length ? fmt(ents.length) : NONE)
      setTile('graph', 'RELATIONS', rels.length ? fmt(rels.length) : NONE)
      // FACTS is [data-live="facts"], which frame() repaints from sim.facts -
      // fleet-live.js feeds that from /api/dashboard. Writing the DOM here
      // would last one animation frame, so it is left alone.
      var sessions = listOf(sess.json, ['sessions'])
      setTile('graph', 'SESSIONS', sessions.length ? fmt(sessions.length) : NONE)

      var ex = panel('graph', 'RECENT EXTRACTIONS', { tag: 'DIV' })
      if (ex) {
        paintRows(ex.body, rels.map(function (rel) {
          var conf = pickNum(rel, CONF_F)
          var when = whenOf(rel)
          var meta = when ? whenText(when) : null
          if (conf !== null) meta = (meta ? meta + ' · ' : '') + 'CONF ' + conf.toFixed(2)
          return [
            String(textOf(pick(rel, FROM_F)) || NONE).toUpperCase(),
            String(textOf(pick(rel, REL_F)) || NONE).toLowerCase(),
            String(textOf(pick(rel, TO_F)) || NONE).toUpperCase(),
            meta || NONE,
          ]
        }), { msg: msg })
      }
      return { route: res.route, status: res.status, entities: ents.length, relations: rels.length }
    })
  }

  // -- graphify ----------------------------------------------------------
  DEFS.graphify = function () {
    return Promise.all([get('/api/graphify/graph'), get('/api/graphify/status')]).then(function (r) {
      var res = r[0], st = r[1]
      var j = res.json || {}
      var nodes = listOf(j, ['nodes', 'entities'])
      var edges = listOf(j, ['edges', 'relations', 'links', 'triples'])
      var msg = why(res)

      var src = panel('graphify', 'SOURCE TEXT')
      if (src) {
        setMeta(src, NONE)
        paintBlock(src.body, null, 'NO SOURCE ROUTE · TEXT IS POSTED TO /api/graphify/build')
      }
      var trip = panel('graphify', 'EXTRACTED TRIPLES')
      if (trip) {
        setMeta(trip, edges.length ? fmt(edges.length) + ' TRIPLES' : NONE)
        paintRows(trip.body, edges.map(function (e) {
          var conf = pickNum(e, CONF_F)
          return [
            short(textOf(pick(e, FROM_F)), 28),
            '—' + String(textOf(pick(e, REL_F)) || NONE).toUpperCase().replace(/\s+/g, '_') + '→',
            short(textOf(pick(e, TO_F)), 28),
            conf === null ? NONE : conf.toFixed(2),
          ]
        }), { msg: msg })
      }
      var plan = panel('graphify', 'MERGE PLAN')
      if (plan) {
        paintPairs(plan.body, {
          'NEW NODES': nodes.length || pickNum(st.json, ['nodes', 'nodeCount', 'entities']),
          'NEW EDGES': edges.length || pickNum(st.json, ['edges', 'edgeCount', 'relations']),
          'MERGED INTO EXISTING': pickNum(st.json, ['merged', 'mergedCount']),
          'REJECTED · LOW CONF': pickNum(st.json, ['rejected', 'rejectedCount', 'skipped']),
        })
      }
      return { route: res.route, status: res.status, nodes: nodes.length, edges: edges.length }
    })
  }

  // -- pdf ---------------------------------------------------------------
  // /api/pdf/extract is POST-only: there is no document list, no page count and
  // no stored extraction to read. Nothing is fired - a POST is an action, not a
  // page load - so every panel reports the absence.
  DEFS.pdf = function () {
    var pages = panel('pdf', 'PAGES')
    if (pages) {
      setMeta(pages, NONE)
      noData(pages.body, 'NO DOCUMENT LOADED · /api/pdf/extract IS POST-ONLY')
    }
    var ask = panel('pdf', 'ASK THIS DOCUMENT')
    if (ask) noData(ask.body, 'NO TRANSCRIPT ROUTE · ASK POSTS TO /api/pdf/extract')
    var ext = panel('pdf', 'EXTRACTED')
    if (ext) paintPairs(ext.body, {})
    return Promise.resolve({ route: '/api/pdf/extract', status: 'post-only' })
  }

  // -- ragquery ----------------------------------------------------------
  // /api/rag/query is POST-only. A dashboard load must not run a query, so
  // there is nothing to show until one is run from the screen.
  DEFS.ragquery = function () {
    var root = scrEl('ragquery')
    if (root) {
      var q = labelEl(root, 'what did we agree about shard lag tolerance', { key: 'ragquery:q' })
      if (q) setLeaf(q, NONE)
    }
    if (inst && inst.live && inst.live.rqMs) setLeaf(inst.live.rqMs, NONE)
    var chunks = panel('ragquery', 'RETRIEVED CHUNKS')
    if (chunks) {
      setMeta(chunks, NONE)
      noData(chunks.body, 'NO QUERY RUN · /api/rag/query IS POST-ONLY')
    }
    var syn = panel('ragquery', 'SYNTHESISED')
    if (syn) paintBlock(syn.body, null, 'NO QUERY RUN · /api/rag/query IS POST-ONLY')
    var prof = panel('ragquery', 'RETRIEVAL PROFILE')
    if (prof) paintPairs(prof.body, {})
    return Promise.resolve({ route: '/api/rag/query', status: 'post-only' })
  }

  // -- ragindex ----------------------------------------------------------
  // /api/rag/index is POST-only: no index stats, no source list to read.
  DEFS.ragindex = function () {
    setTile('ragindex', 'CHUNKS', NONE)
    setTile('ragindex', 'DIM', NONE)
    setTile('ragindex', 'INDEX SIZE', NONE)
    setTile('ragindex', 'SOURCES', NONE, { tag: 'DIV', key: 'ragindex:tile:SOURCES' })
    var src = panel('ragindex', 'SOURCES')
    if (src) {
      setMeta(src, NONE)
      noData(src.body, 'NO INDEX ROUTE · /api/rag/index IS POST-ONLY', { skipHeader: true })
    }
    var pipe = panel('ragindex', 'PIPELINE')
    if (pipe) { setMeta(pipe, NONE); paintPairs(pipe.body, {}) }
    var thru = panel('ragindex', 'THROUGHPUT')
    if (thru) paintPairs(thru.body, {})
    return Promise.resolve({ route: '/api/rag/index', status: 'post-only' })
  }

  // -- email -------------------------------------------------------------
  // /api/email/send is POST-only - the server sends mail, it does not serve a
  // mailbox, so there is no triage list and no 24h tally to read.
  DEFS.email = function () {
    var tri = panel('email', 'TRIAGED')
    if (tri) {
      setMeta(tri, NONE)
      noData(tri.body, 'NO MAILBOX ROUTE · /api/email/send IS POST-ONLY')
    }
    var auto = panel('email', 'AUTO-HANDLED · 24H')
    if (auto) paintPairs(auto.body, {})
    return Promise.resolve({ route: '/api/email/send', status: 'post-only' })
  }

  // -- constitution ------------------------------------------------------
  /** Articles as a list, or as one document that has to be cut into articles. */
  function articlesFrom(json) {
    if (!json) return []
    var list = listOf(json, ['articles', 'statutes', 'clauses', 'rules', 'principles', 'sections', 'laws'])
    if (list.length) {
      return list.map(function (a, i) {
        if (typeof a === 'string') return { n: roman(i + 1), t: short(a, 46), b: a }
        return {
          n: String(pick(a, ['numeral', 'roman', 'number', 'no', 'index', 'id']) || roman(i + 1)),
          t: short(pickText(a, TITLE_F), 46),
          b: pickText(a, ['text', 'body', 'content', 'rule', 'statement', 'description']),
        }
      })
    }
    var doc = typeof json === 'string' ? json
      : pickText(json, ['constitution', 'text', 'content', 'body', 'document', 'markdown'])
    if (!doc) return []
    var blocks = doc.split(/\n\s*\n|\n(?=#{1,3}\s)/)
    var out = []
    blocks.forEach(function (block) {
      var lines = block.replace(/^#+\s*/, '').split('\n')
      var head = (lines.shift() || '').trim()
      if (!head) return
      var m = head.match(/^(?:article\s+)?([IVXLC]+|\d+)[.)\s—-]+(.*)$/i)
      out.push({
        n: m ? m[1].toUpperCase() : roman(out.length + 1),
        t: short(m ? m[2] : head, 46),
        b: lines.join(' ').trim() || (m ? '' : head),
      })
    })
    return out
  }

  DEFS.constitution = function () {
    return get('/api/constitution').then(function (res) {
      var arts = articlesFrom(res.json)
      var msg = why(res)
      var p = panel('constitution', 'ARTICLES')
      if (p) {
        var version = pick(res.json, ['version', 'rev', 'v'])
        setMeta(p, arts.length
          ? fmt(arts.length) + ' STATUTES' + (version ? ' · v' + version : '')
          : NONE)
        paintRows(p.body, arts.map(function (a) {
          return [a.n, (a.t || NONE).toUpperCase(), short(a.b, 260)]
        }), { msg: msg })
      }
      var comp = panel('constitution', 'COMPLIANCE · 30D')
      if (comp) paintPairs(comp.body, {})
      var inv = panel('constitution', 'INVOCATIONS')
      if (inv) noData(inv.body, 'NO INVOCATION LOG ROUTE · /api/constitution IS THE TEXT ONLY')
      return { route: res.route, status: res.status, articles: arts.length }
    })
  }

  // ----------------------------------------------------------------- schedule
  var busy = {}
  var lastAt = {}

  function run(name) {
    var def = DEFS[name]
    if (!def || busy[name]) return
    busy[name] = 1
    lastAt[name] = Date.now()
    var done = function (info) {
      busy[name] = 0
      state[name] = info || {}
      state[name].at = new Date().toISOString()
    }
    try {
      Promise.resolve(def()).then(done, function (err) {
        console.warn('[fleet-screens] ' + name + ' failed', err)
        done({ error: String(err && err.message || err) })
      })
    } catch (err) {
      console.warn('[fleet-screens] ' + name + ' threw', err)
      done({ error: String(err && err.message || err) })
    }
  }

  /** Only what is on screen, and only when its refresh is due. */
  function pump() {
    for (var name in DEFS) {
      if (!DEFS.hasOwnProperty(name)) continue
      if (!visible(name)) continue
      if (lastAt[name] && Date.now() - lastAt[name] < REFRESH_MS) continue
      run(name)
    }
  }

  function start() {
    inst = findInstance()
    if (!inst) return false

    // setScreen is the only way in: wrapping it loads a screen the moment it is
    // shown instead of on the next visibility sweep. An own property shadows
    // the prototype method, and every call site goes through this.setScreen.
    var original = inst.setScreen
    inst.setScreen = function (name) {
      var out = original.apply(this, arguments)
      if (DEFS[name]) { lastAt[name] = 0; setTimeout(function () { run(name) }, 0) }
      return out
    }

    pump()
    setInterval(pump, VISIBLE_MS)

    window.__fleetScreens = {
      get instance() { return inst },
      get state() { return state },
      screens: Object.keys(DEFS),
      refresh: function (name) { lastAt[name] = 0; run(name) },
    }
    return true
  }

  var tries = 0
  var waiting = setInterval(function () {
    if (start() || ++tries > 160) clearInterval(waiting)
  }, 250)
})()
