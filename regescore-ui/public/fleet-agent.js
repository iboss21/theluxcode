/**
 * fleet-agent.js — the console's tool-call loop.
 *
 * The local model already emits well-formed calls in the XML form the RegesCore
 * template specifies. Nothing in the export was parsing them, so they arrived in
 * the transcript as prose:
 *
 *   <tool_call> <function=tool> <parameter=name> read_memory </parameter> ...
 *
 * which is why the agent could not read a file, run a query, or change anything.
 * This file is the missing half in the browser: it takes over the console's
 * response stream, separates tool calls from answer text, runs each one against
 * a fixed route, shows it happening, and hands the results back so the model can
 * continue. Server-side the same job is done by src/api/toolcalls.js; the
 * splitter and the allowlist here are a deliberate ES5 port of that module and
 * scripts/test-agent-loop.js asserts the two stay identical.
 *
 * Four things are worth knowing before changing it.
 *
 * 1. Where it attaches. The export's class is never a fiber stateNode — the dc
 *    runtime's StreamableComponent compiles the <script type="text/x-dc"> body
 *    and keeps the result on `.logic`. The console's own methods are the only
 *    seam that survives a re-render, so this wraps them: say() keeps choosing a
 *    transport, and all three transports now lead here.
 *
 * 2. Chunk boundaries. Tokens arrive in pieces that do not align with tags:
 *    "<tool_c" can end one SSE frame and "all>" begin the next. Splitting each
 *    chunk on its own prints half a tag as answer text and loses the rest, which
 *    only shows up under load. A trailing run that could still become a tag is
 *    held back, and released as ordinary text at end of stream — where it turns
 *    out that is what it was. An unterminated call is reported as truncated
 *    rather than rendered.
 *
 * 3. Dispatch is an allowlist. `method` and `path` are fixed in this file. A
 *    model-supplied name is looked up, never turned into a URL, so a
 *    hallucinated tool comes back as an error the model can read and correct
 *    instead of becoming a request to an arbitrary endpoint.
 *
 * 4. The loop has to stop. A model that keeps calling tools forever must hit a
 *    ceiling and say so in the transcript — a silent stall is indistinguishable
 *    from a hung endpoint. Default is 8 model turns.
 *
 * Tool calls render as their own row, never as answer text: a collapsed line
 * naming the tool and its arguments, expanding to the exact request and the
 * result that came back.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
(function () {
  'use strict'

  var OPEN = '<tool_call>'
  var CLOSE = '</tool_call>'

  var MAX_ITERATIONS = 8      // model turns per directive before the loop stops
  var RESULT_CLIP = 20000     // chars of tool output fed back to the model
  var DETAIL_CLIP = 6000      // chars of tool output shown in the expanded row
  var TOOL_TIMEOUT_MS = 30000

  // Relative variants included so this works under /fleet/ as well as at root.
  var CHAT_PATHS = ['/api/agent/chat', 'api/agent/chat']
  // A cheap GET that proves the /api surface is mounted. POSTing to the chat
  // route to find out would start a generation on the GPU just to probe.
  var PROBE_PATHS = ['/api/agent/models', 'api/agent/models', '/api/models', 'api/models', '/api/meta', 'api/meta']

  // ---------------------------------------------------------------- splitter

  // ES5 has no String.prototype.endsWith on every target this ships to.
  function endsWith(text, suffix) {
    if (suffix.length > text.length) return false
    return text.slice(text.length - suffix.length) === suffix
  }

  /**
   * Streams text through, separating tool-call blocks from answer text.
   *
   * push() returns events in order:
   *   {type:'text', text}       answer text, safe to render
   *   {type:'call', raw}        one complete tool_call block body
   * flush() may return {type:'truncated', raw} — a generation cut mid-call.
   */
  function ToolCallSplitter() {
    this.buffer = ''
    this.inside = false
  }

  // Longest suffix of text that is a proper prefix of tag — the part that
  // cannot yet be classified and must wait for more input.
  ToolCallSplitter.partialSuffix = function (text, tag) {
    var max = Math.min(text.length, tag.length - 1)
    for (var n = max; n > 0; n--) {
      if (endsWith(text, tag.slice(0, n))) return n
    }
    return 0
  }

  ToolCallSplitter.prototype.push = function (chunk) {
    this.buffer += chunk
    var events = []

    for (;;) {
      var tag = this.inside ? CLOSE : OPEN
      var at = this.buffer.indexOf(tag)

      if (at === -1) {
        // Inside a call, nothing is emitted until the close tag arrives: a
        // half-parsed call must never be dispatched.
        if (this.inside) return events
        var hold = ToolCallSplitter.partialSuffix(this.buffer, tag)
        var emit = this.buffer.slice(0, this.buffer.length - hold)
        this.buffer = this.buffer.slice(this.buffer.length - hold)
        if (emit) events.push({ type: 'text', text: emit })
        return events
      }

      var before = this.buffer.slice(0, at)
      if (this.inside) events.push({ type: 'call', raw: before })
      else if (before) events.push({ type: 'text', text: before })

      this.buffer = this.buffer.slice(at + tag.length)
      this.inside = !this.inside
    }
  }

  ToolCallSplitter.prototype.flush = function () {
    var rest = this.buffer
    this.buffer = ''
    // An unterminated call at end of stream is a truncated generation, not
    // text: reporting it lets the caller retry rather than render markup.
    if (this.inside) return rest ? [{ type: 'truncated', raw: rest }] : []
    return rest ? [{ type: 'text', text: rest }] : []
  }

  // --------------------------------------------------------------- parseCall

  /**
   * Parse one tool_call body into {name, args}.
   *
   * Both forms the template can produce are accepted: the XML parameter form,
   * and the Hermes JSON form, because tool_call_format is a template variable
   * and a deployment can be running either.
   */
  function parseCall(raw) {
    var text = String(raw == null ? '' : raw).trim()
    if (!text) return { error: 'empty tool_call block' }

    // JSON form first: unambiguous when it parses.
    if (text.charAt(0) === '{') {
      var json
      try {
        json = JSON.parse(text)
      } catch (error) {
        return { error: 'tool_call JSON is invalid: ' + ((error && error.message) || error) }
      }
      var name = json.name || json.function
      if (!name) return { error: 'tool_call JSON has no name' }
      var args = json.arguments !== undefined ? json.arguments : json.input
      if (typeof args === 'string') {
        try { args = JSON.parse(args) } catch (ignored) { /* leave as a string value */ }
      }
      return { name: String(name), args: args && typeof args === 'object' ? args : {} }
    }

    var fn = /<function=([^>\s]+)\s*>/.exec(text)
    if (!fn) return { error: 'tool_call has no <function=...> tag' }

    var out = {}
    // [\s\S] rather than . because a parameter value is routinely multi-line —
    // a file body or a script is the common case, not the exception.
    var param = /<parameter=([^>\s]+)\s*>([\s\S]*?)<\/parameter>/g
    var m
    while ((m = param.exec(text)) !== null) {
      var key = m[1]
      var value = m[2].trim()
      // Values arrive as raw text. JSON-looking ones are decoded so an object
      // or array parameter reaches the route as structured data.
      if (/^[[{]/.test(value)) {
        try { out[key] = JSON.parse(value); continue } catch (ignored) { /* keep the text */ }
      }
      out[key] = value
    }
    return { name: fn[1], args: out }
  }

  // --------------------------------------------------------------- allowlist

  /**
   * tool name -> how to call it.
   *
   * Every entry names a route that exists on the RegesCore server. `method` and
   * `path` are fixed here and never read from the model, so a hallucinated name
   * cannot reach an arbitrary URL. `body`/`query` map the model's arguments onto
   * the route's shape. Kept in step with src/api/toolcalls.js — the test asserts
   * name, method and path match, and that the request built for a call is the
   * same one the server-side module would build.
   */
  var TOOLS = {
    read_memory: {
      method: 'GET', path: '/api/memory',
      describe: 'Read the fact vault',
      query: function (a) { return a.query ? { q: a.query } : {} },
    },
    write_memory: {
      method: 'POST', path: '/api/memory',
      describe: 'Store a fact',
      body: function (a) { return { text: a.text || a.fact || a.value, tags: a.tags } },
    },
    read_file: {
      method: 'POST', path: '/api/filesystem/read',
      describe: 'Read a file from disk',
      body: function (a) { return { path: a.path || a.file || a.file_path } },
    },
    list_files: {
      method: 'POST', path: '/api/filesystem/list',
      describe: 'List a directory',
      body: function (a) { return { path: a.path || a.dir || '.' } },
    },
    rag_query: {
      method: 'POST', path: '/api/rag/query',
      describe: 'Query the RAG index',
      body: function (a) { return { query: a.query || a.q, k: a.k } },
    },
    graph_query: {
      method: 'POST', path: '/api/graphify/query',
      describe: 'Query the knowledge graph',
      body: function (a) { return { query: a.query || a.q } },
    },
    knowledge_query: {
      method: 'POST', path: '/api/knowledge/query',
      describe: 'Query the knowledge base',
      body: function (a) { return { query: a.query || a.q } },
    },
    list_tasks: { method: 'GET', path: '/api/tasks', describe: 'List tasks' },
    create_task: {
      method: 'POST', path: '/api/tasks',
      describe: 'Create a task',
      body: function (a) { return { title: a.title || a.text, notes: a.notes } },
    },
    list_notes: { method: 'GET', path: '/api/notes', describe: 'List notes' },
    create_note: {
      method: 'POST', path: '/api/notes',
      describe: 'Create a note',
      body: function (a) { return { title: a.title, body: a.body || a.text } },
    },
    services_status: { method: 'GET', path: '/api/services/status', describe: 'Health of every service' },
    system_stats: { method: 'GET', path: '/api/system/stats', describe: 'Host CPU, memory, uptime' },
    list_models: { method: 'GET', path: '/api/models', describe: 'Available models' },
    pdf_extract: {
      method: 'POST', path: '/api/pdf/extract',
      describe: 'Extract text from a PDF',
      body: function (a) { return { path: a.path || a.file } },
    },
    web_search: {
      method: 'POST', path: '/api/web-search',
      describe: 'Search the web',
      body: function (a) { return { query: a.query || a.q } },
    },
    web_fetch: {
      method: 'POST', path: '/api/web-fetch',
      describe: 'Fetch a URL',
      body: function (a) { return { url: a.url } },
    },
  }

  function toolSchemas() {
    return Object.keys(TOOLS).map(function (name) {
      return { name: name, description: TOOLS[name].describe }
    })
  }

  /**
   * The exact request a call becomes — url, method, headers, body — or null for
   * a name that is not on the list. Separated from execute() so the shape can be
   * asserted against the server-side module without a network at all.
   */
  function requestFor(call, baseUrl) {
    var spec = TOOLS[call && call.name]
    if (!spec) return null

    var url = String(baseUrl == null ? '' : baseUrl).replace(/\/$/, '') + spec.path
    var init = { method: spec.method, headers: { accept: 'application/json' } }

    if (spec.method === 'GET') {
      var query = spec.query ? spec.query(call.args || {}) : {}
      var params = new URLSearchParams()
      Object.keys(query).forEach(function (key) {
        if (query[key] !== undefined && query[key] !== null) params.set(key, String(query[key]))
      })
      var qs = params.toString()
      if (qs) url += '?' + qs
    } else {
      var body = spec.body ? spec.body(call.args || {}) : (call.args || {})
      // Drop undefined so a route that validates required fields reports the
      // real omission rather than receiving the literal string "undefined".
      Object.keys(body).forEach(function (key) { if (body[key] === undefined) delete body[key] })
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
    return { url: url, init: init, spec: spec }
  }

  /**
   * Run one parsed call. Never rejects: a failure is a result the model reads
   * and can correct, and a rejection here would kill the whole turn.
   */
  function execute(call, baseUrl, options) {
    var opts = options || {}
    var doFetch = opts.fetch || (typeof fetch === 'function' ? fetch : null)

    if (call && call.error) return Promise.resolve({ ok: false, error: call.error })

    var req = requestFor(call, baseUrl)
    if (!req) {
      return Promise.resolve({
        ok: false,
        error: 'unknown tool "' + (call && call.name) + '". Available: ' + Object.keys(TOOLS).join(', '),
      })
    }
    if (!doFetch) return Promise.resolve({ ok: false, tool: call.name, error: 'no fetch available' })

    var init = req.init
    var timer = null
    // Browser-side only, and set here rather than in requestFor so the request
    // shape stays comparable with the server-side module.
    if (opts.timeoutMs && typeof AbortController === 'function') {
      var controller = new AbortController()
      init = { method: init.method, headers: init.headers, body: init.body, signal: controller.signal }
      timer = setTimeout(function () { controller.abort() }, opts.timeoutMs)
    }

    return Promise.resolve()
      .then(function () { return doFetch(req.url, init) })
      .then(function (response) {
        return Promise.resolve(response.text()).then(function (text) {
          var data
          try { data = JSON.parse(text) } catch (ignored) { data = text }
          return response.ok
            ? { ok: true, tool: call.name, data: data, request: req.spec.method + ' ' + req.spec.path }
            : { ok: false, tool: call.name, error: 'HTTP ' + response.status, data: data, request: req.spec.method + ' ' + req.spec.path }
        })
      })
      .catch(function (error) {
        return {
          ok: false, tool: call.name,
          error: String((error && error.message) || error),
          request: req.spec.method + ' ' + req.spec.path,
        }
      })
      .then(function (result) { if (timer) clearTimeout(timer); return result })
  }

  /**
   * Render a result as the tool_response block the template expects back, so
   * the next turn sees its own tool output in the format it was trained on.
   */
  function formatResult(result) {
    var payload = typeof result.data === 'string'
      ? result.data
      : (result.data === undefined ? '' : JSON.stringify(result.data, null, 2))
    if (result.ok) return '<tool_response>\n' + payload + '\n</tool_response>'
    return '<tool_response>\n[tool error] ' + result.error + (payload ? '\n' + payload : '') + '\n</tool_response>'
  }

  function clip(text, max) {
    var s = String(text == null ? '' : text)
    if (s.length <= max) return s
    return s.slice(0, max) + '\n[truncated · ' + (s.length - max) + ' more chars]'
  }

  // -------------------------------------------------------------------- loop

  /**
   * The agent loop: stream a turn, run whatever it asked for, feed the results
   * back, repeat. Transport, dispatch and rendering are all injected, so the
   * control flow — including the iteration cap — is testable without a browser
   * or a model.
   *
   *   opts.stream(messages, handlers) -> Promise<{ok, error}>   handlers: delta, reasoning
   *   opts.execute(call)              -> Promise<result>
   *   opts.messages                   conversation, appended to in place
   *   opts.maxIterations              hard ceiling on model turns (default 8)
   *   opts.ui                         onTurn onText onReasoning onCall onResult
   *                                   onAnswer onCap onTruncated onError onMessage
   */
  function runLoop(opts) {
    var stream = opts.stream
    var exec = opts.execute
    var ui = opts.ui || {}
    var messages = opts.messages || []
    var max = opts.maxIterations > 0 ? opts.maxIterations : MAX_ITERATIONS

    var stats = {
      iterations: 0, calls: 0, capped: false, truncated: false,
      error: null, text: '', messages: messages,
    }

    function note(message) {
      messages.push(message)
      if (ui.onMessage) ui.onMessage(message)
    }

    function turn() {
      if (stats.iterations >= max) {
        // Visible, not silent: a model looping forever looks exactly like a
        // hung endpoint unless the transcript says which one happened.
        stats.capped = true
        if (ui.onCap) ui.onCap(max, stats)
        return stats
      }

      var index = ++stats.iterations
      var splitter = new ToolCallSplitter()
      var raw = ''       // exactly what the model emitted, markup included
      var answer = ''    // answer text only, safe to render
      var pending = []
      var truncated = null

      function absorb(events) {
        for (var i = 0; i < events.length; i++) {
          var event = events[i]
          if (event.type === 'text') {
            answer += event.text
            if (ui.onText) ui.onText(answer, index)
          } else if (event.type === 'call') {
            pending.push(event.raw)
          } else if (event.type === 'truncated') {
            truncated = event.raw
          }
        }
      }

      if (ui.onTurn) ui.onTurn(index, max)

      return Promise.resolve(stream(messages, {
        delta: function (text) { raw += text; absorb(splitter.push(text)) },
        reasoning: function (text) { if (ui.onReasoning) ui.onReasoning(text, index) },
      })).then(function (outcome) {
        absorb(splitter.flush())
        stats.text = answer

        if (outcome && outcome.ok === false) {
          stats.error = outcome.error || 'stream failed'
          if (ui.onError) ui.onError(stats.error, index)
          return stats
        }
        if (truncated !== null) {
          stats.truncated = true
          if (ui.onTruncated) ui.onTruncated(truncated, index)
          return stats
        }
        if (!pending.length) {
          if (ui.onAnswer) ui.onAnswer(answer, index)
          return stats
        }

        // The model's own turn, verbatim, so the next one sees the call it made
        // and does not repeat it.
        note({ role: 'assistant', content: raw })

        var responses = []
        var chain = Promise.resolve()
        pending.forEach(function (rawCall) {
          chain = chain.then(function () {
            var call = parseCall(rawCall)
            stats.calls++
            var handle = ui.onCall ? ui.onCall(call, index) : null
            return Promise.resolve(exec(call)).then(function (result) {
              if (ui.onResult) ui.onResult(result, handle, call)
              responses.push(clip(formatResult(result), RESULT_CLIP))
            })
          })
        })

        return chain.then(function () {
          // A failed call is fed back like any other, error text and all: the
          // correction has to be the model's to make.
          note({ role: 'user', content: responses.join('\n') })
          return turn()
        })
      })
    }

    return Promise.resolve().then(turn)
  }

  // ---------------------------------------------------------- system prompt

  function toolPrompt() {
    var lines = [
      'TOOLS — you can act, not just answer.',
      '',
      'To use a tool, emit exactly this and stop; the result comes back before you continue:',
      '',
      OPEN,
      '<function=TOOL_NAME>',
      '<parameter=NAME>VALUE</parameter>',
      '</function>',
      CLOSE,
      '',
      'Rules: one or more calls per turn, then wait. Use only the names below —',
      'anything else comes back as an error and wastes a turn. Read before you',
      'write. When you have what you need, answer in prose with no tool call.',
      'Never describe a call instead of making one, and never invent a result.',
      '',
      'Available:',
    ]
    toolSchemas().forEach(function (tool) {
      lines.push('- ' + tool.name + ' — ' + tool.description)
    })
    return lines.join('\n')
  }

  // ------------------------------------------------------------------- wiring

  var NONE = '—'
  var COLOR = { run: '#4C8DFF', ok: '#2FE07C', error: '#E5343F', warn: '#F5A524' }

  var inst = null
  var chatUrl = null
  var model = null
  var seq = 0
  var apiBase = ''

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
        if (node.sim && typeof node.frame === 'function' && typeof node.say === 'function') return node
        // The dc runtime compiles the <script type="text/x-dc"> body and holds
        // the result here, rendering its output itself.
        var logic = node.logic
        if (logic && logic.sim && typeof logic.say === 'function') return logic
      }
      fiber = fiber.return
    }
    return null
  }

  function get(url) {
    return fetch(url, { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .catch(function () { return null })
  }

  /**
   * Find the /api surface without starting a generation. The chat route is a
   * POST that costs a model turn, so a sibling GET is probed instead, and the
   * base is taken from whichever form answered: absolute when /api sits at the
   * server root, the containing directory when the dashboard is served under a
   * sub-path and only the relative form resolves.
   */
  function discover() {
    var i = 0
    function next() {
      if (i >= PROBE_PATHS.length) return Promise.resolve(null)
      var probe = PROBE_PATHS[i++]
      return get(probe).then(function (json) {
        if (!json || typeof json !== 'object') return next()
        if (probe.charAt(0) === '/') return { base: '', chat: CHAT_PATHS[0] }
        var dir = String(location.href).split('#')[0].split('?')[0].replace(/[^/]*$/, '').replace(/\/$/, '')
        return { base: dir, chat: dir + CHAT_PATHS[0] }
      })
    }
    return next()
  }

  // -- transport ---------------------------------------------------------

  function frameBoundary(text) {
    var lf = text.indexOf('\n\n')
    var crlf = text.indexOf('\r\n\r\n')
    if (lf === -1 && crlf === -1) return null
    if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 }
    return { index: lf, length: 2 }
  }

  function frameData(raw) {
    var text = raw.replace(/^\s+|\s+$/g, '')
    if (!text) return null
    var lines = text.split(/\r?\n/)
    var data = []
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].charAt(0) === ':') continue          // keepalive comment
      if (lines[i].indexOf('data:') === 0) data.push(lines[i].slice(5).replace(/^ /, ''))
    }
    return data.length ? data.join('\n') : null
  }

  /**
   * POST /api/agent/chat and read its SSE. Frames do not align with network
   * chunks, so the tail is carried the same way the tag splitter carries a
   * partial tag. Resolves with {ok:false, error} rather than rejecting: the
   * transcript should show what failed, and the loop should stop cleanly.
   */
  function streamChat(messages, handlers) {
    var body = { messages: messages, stream: true, max_tokens: maxTokens() }
    if (model) body.model = model
    var provider = setting('reges.provider')
    if (provider) body.provider = provider
    var temperature = temp()
    if (temperature !== null) body.temperature = temperature

    var failure = null
    var carry = ''

    function handle(data) {
      if (!data || data === '[DONE]') return
      var event
      try { event = JSON.parse(data) } catch (ignored) { return }
      if (event.type === 'delta' && event.text) handlers.delta(event.text)
      else if (event.type === 'reasoning' && event.text) handlers.reasoning(event.text)
      else if (event.type === 'error') failure = String(event.message || event.text || 'stream error')
    }

    function drain(text) {
      carry += text
      var boundary
      while ((boundary = frameBoundary(carry)) !== null) {
        var raw = carry.slice(0, boundary.index)
        carry = carry.slice(boundary.index + boundary.length)
        handle(frameData(raw))
      }
    }

    function finish() {
      handle(frameData(carry))
      carry = ''
      return failure ? { ok: false, error: failure } : { ok: true }
    }

    return fetch(chatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) {
        return res.text().catch(function () { return '' }).then(function (text) {
          return { ok: false, error: 'HTTP ' + res.status + (text ? ' · ' + text.slice(0, 300) : '') }
        })
      }
      if (!res.body || typeof res.body.getReader !== 'function') {
        // No streaming reader (an old browser, or a proxy that buffered the
        // whole response): the body still parses as frames, just all at once.
        return res.text().then(function (text) { drain(text); return finish() })
      }

      var reader = res.body.getReader()
      var decoder = new TextDecoder()

      function pump() {
        return reader.read().then(function (chunk) {
          if (chunk.done) { drain(decoder.decode()); return finish() }
          drain(decoder.decode(chunk.value, { stream: true }))
          return pump()
        })
      }
      return pump()
    }).catch(function (error) {
      return { ok: false, error: String((error && error.message) || error) }
    })
  }

  function setting(key) {
    try { return window.localStorage.getItem(key) } catch (ignored) { return null }
  }

  function maxTokens() {
    var cfg = inst && inst.cfg
    return (cfg && cfg.maxTokens) || 1400
  }

  function temp() {
    var cfg = inst && inst.cfg
    return cfg && cfg.temperature != null ? cfg.temperature : null
  }

  // -- transcript rows ---------------------------------------------------

  function merge(base, extra) {
    var out = {}
    var key
    for (key in base) if (Object.prototype.hasOwnProperty.call(base, key)) out[key] = base[key]
    for (key in extra) if (Object.prototype.hasOwnProperty.call(extra, key)) out[key] = extra[key]
    return out
  }

  /**
   * The literal tags are replaced before anything reaches the transcript.
   *
   * The splitter is byte-identical to the server-side one, and shares its one
   * blind spot: a tool_call nested inside a parameter value closes early, and
   * the remainder is classified as text. That is the bug this whole file exists
   * to fix, so the renderer refuses to print the markup even if the splitter
   * ever hands it over. What is fed back to the model is not scrubbed — it must
   * see its own output verbatim.
   */
  function scrub(text) {
    return String(text == null ? '' : text)
      .split(OPEN).join('[tool_call]')
      .split(CLOSE).join('[/tool_call]')
  }

  function short(value, max) {
    var text = typeof value === 'string' ? value : JSON.stringify(value)
    text = String(text == null ? '' : text).replace(/\s+/g, ' ')
    return text.length > max ? text.slice(0, max) + '…' : text
  }

  function argsLine(args) {
    var keys = Object.keys(args || {})
    if (!keys.length) return ''
    return keys.map(function (key) { return key + '=' + short(args[key], 48) }).join(' · ')
  }

  function summaryOf(rec) {
    var head = rec.name + (rec.argline ? ' · ' + rec.argline : '')
    if (rec.status === 'run') return head + ' · running'
    if (rec.status === 'ok') return head + ' · ok · ' + rec.bytes + ' bytes'
    if (rec.status === 'error') return head + ' · failed · ' + rec.error
    return head + (rec.error ? ' · ' + rec.error : '')
  }

  function labelOf(rec) {
    if (rec.status === 'run') return 'tool · ' + rec.name + ' · running'
    if (rec.status === 'ok') return 'tool · ' + rec.name + ' · ok'
    if (rec.status === 'error') return 'tool · ' + rec.name + ' · failed'
    return 'tool · ' + rec.name
  }

  function detailOf(rec) {
    var lines = [rec.route || '(no route — name not on the allowlist)']
    lines.push('arguments:')
    lines.push(JSON.stringify(rec.args || {}, null, 2))
    if (rec.status !== 'run') {
      lines.push('')
      lines.push('result: ' + (rec.status === 'ok' ? 'ok' : rec.error))
      if (rec.payload) lines.push(clip(rec.payload, DETAIL_CLIP))
    }
    return scrub(lines.join('\n'))
  }

  /** A row the export renders itself, marked so tapeView() can relabel it. */
  function pushRow(rec) {
    rec.id = ++seq
    inst.setState(function (state) {
      return {
        tape: state.tape.concat([{
          tag: 'TL', text: scrub(summaryOf(rec)), raw: '', caret: '',
          hasThink: true, think: detailOf(rec), thinkOpen: false,
          fleetTool: rec,
        }]),
      }
    })
    return rec.id
  }

  function patchRow(id, fields) {
    inst.setState(function (state) {
      var tape = state.tape.slice()
      for (var i = 0; i < tape.length; i++) {
        var rec = tape[i] && tape[i].fleetTool
        if (!rec || rec.id !== id) continue
        var next = merge(rec, fields)
        tape[i] = merge(tape[i], {
          fleetTool: next, text: scrub(summaryOf(next)), think: detailOf(next),
        })
      }
      return { tape: tape }
    })
  }

  /**
   * tapeView() rebuilds every row for render and would relabel a tool row
   * "Thought for 2s", so it is wrapped rather than replaced: the export keeps
   * owning blocks, chevron and the collapse toggle, and only the label and the
   * detail body come from the tool record.
   */
  function patchTapeView() {
    if (inst.__fleetAgentTape) return
    inst.__fleetAgentTape = true
    var original = inst.tapeView.bind(inst)
    inst.tapeView = function () {
      var rows = original()
      var tape = this.state.tape
      for (var i = 0; i < rows.length; i++) {
        var rec = tape[i] && tape[i].fleetTool
        if (!rec) continue
        rows[i].hasThink = true
        rows[i].thinkLabel = labelOf(rec)
        rows[i].think = detailOf(rec)
      }
      return rows
    }
  }

  // -- the UI side of the loop -------------------------------------------

  function makeUi() {
    var reason = ''
    var answered = ''   // answer text of the turn in progress
    var settled = false // the prose row for this turn has stopped streaming

    function paint(answer, caret) {
      inst.patchLast((reason ? '<think>' + reason + '</think>' : '') + scrub(answer), caret || '')
    }

    return {
      onTurn: function (index, max) {
        reason = ''
        answered = ''
        settled = false
        // Turn 1 writes into the row say() already pushed; every later turn
        // gets its own row so the tool rows stay between them in order.
        if (index > 1) inst.push('RC', '', '▌')
        inst.agentState(index === 1 ? 'THINKING' : 'THINKING · TURN ' + index + '/' + max, COLOR.warn)
      },
      onReasoning: function (text) {
        reason += text
        paint(answered, '▌')
      },
      onText: function (answer) {
        answered = answer
        paint(answer, '▌')
      },
      onAnswer: function (answer) {
        settled = true
        paint(answer || '', '')
      },
      onCall: function (call, index) {
        var name = call.name || '(unparsed)'
        var spec = TOOLS[name]
        // The prose that came with the call is settled first, once per turn:
        // the rows below are the actions, and a caret still blinking above them
        // reads as "generating" when the model has in fact stopped.
        if (!settled) {
          settled = true
          paint(answered || ('Calling ' + name), '')
        }
        inst.agentState('TOOL · ' + name.toUpperCase(), COLOR.run)
        return pushRow({
          name: name, args: call.args || {}, argline: argsLine(call.args),
          route: spec ? spec.method + ' ' + spec.path : null,
          status: 'run', turn: index, error: call.error || null,
        })
      },
      onResult: function (result, handle) {
        var payload = typeof result.data === 'string'
          ? result.data
          : (result.data === undefined ? '' : JSON.stringify(result.data, null, 2))
        patchRow(handle, {
          status: result.ok ? 'ok' : 'error',
          error: result.ok ? null : result.error,
          bytes: payload.length,
          payload: payload,
        })
      },
      onCap: function (max) {
        pushRow({
          name: 'iteration cap', args: {}, argline: '', status: 'error',
          route: '(loop control)',
          error: 'stopped after ' + max + ' turns',
          payload: 'The model was still calling tools after ' + max + ' turns, so the loop ' +
            'stopped and nothing further was run. Ask again with a narrower request, or raise ' +
            'window.__fleetAgent.maxIterations.',
        })
        inst.agentState('TOOL CAP · ' + max + ' TURNS', COLOR.warn)
      },
      onTruncated: function (raw) {
        pushRow({
          name: 'truncated tool call', args: {}, argline: '', status: 'error',
          route: '(nothing was run)',
          error: 'generation ended mid-call after ' + raw.length + ' chars',
          payload: raw,
        })
        inst.agentState('TOOL CALL TRUNCATED', COLOR.warn)
      },
      onError: function (message) {
        settled = true
        paint((answered ? answered + '\n\n' : '') +
          'Agent endpoint failed — ' + message + '\n\n' +
          'The console reached ' + chatUrl + ' but the model behind it did not answer. ' +
          'Check that the inference server is up.', '')
        inst.agentState('ENDPOINT ERROR', COLOR.error)
      },
      onMessage: function (message) {
        // Mirrored into the export's own history so a follow-up directive still
        // sees what the tools returned. say() appends the final answer itself.
        inst.hist.push(message)
      },
    }
  }

  /**
   * One directive, start to finish. Called from say()'s three transports, so
   * the export keeps its own streaming flag, error banner, voice and history
   * handling and only the middle — what actually happens — is replaced.
   */
  function runAgent() {
    inst.hist = inst.hist || []
    // Enough of a window that a tool_response is never orphaned from the
    // assistant turn that asked for it.
    var messages = [{ role: 'system', content: inst.sysPrompt() }].concat(inst.hist.slice(-20))

    return runLoop({
      messages: messages,
      maxIterations: api.maxIterations,
      stream: function (msgs, handlers) { return api.stream(msgs, handlers) },
      execute: function (call) { return execute(call, apiBase, { timeoutMs: TOOL_TIMEOUT_MS }) },
      ui: makeUi(),
    }).then(function (stats) {
      api.lastRun = stats
      if (!stats.error && !stats.capped) {
        inst.agentState(stats.calls ? 'IDLE · ' + stats.calls + ' TOOL CALLS' : 'IDLE · READY', COLOR.ok)
      }
      return stats
    }).catch(function (error) {
      // Anything unhandled still has to reach the operator rather than leaving
      // a caret blinking forever.
      inst.patchLast('Agent loop failed — ' + ((error && error.message) || error), '')
      inst.agentState('AGENT ERROR', COLOR.error)
    })
  }

  function chip() {
    var el = inst.root && inst.root.querySelector('[data-epchip]')
    if (!el) return
    var text = (el.textContent || '').trim()
    if (text && text !== 'NOT CONNECTED' && text !== NONE) return
    el.textContent = 'AGENT · ' + Object.keys(TOOLS).length + ' TOOLS'
    el.style.color = COLOR.ok
    el.style.borderColor = 'rgba(47,224,124,.34)'
  }

  function attach() {
    if (inst.__fleetAgent) return
    inst.__fleetAgent = true

    patchTapeView()

    var originalSysPrompt = inst.sysPrompt.bind(inst)
    inst.sysPrompt = function () { return originalSysPrompt() + '\n\n' + toolPrompt() }

    // say() picks a transport from localStorage; all three now lead here, so a
    // dashboard with no endpoint configured gets the real agent rather than the
    // export's canned replies.
    inst.streamOpenAI = function () { return runAgent() }
    inst.viaRelay = function () { return runAgent() }
    inst.localFallback = function () { return runAgent() }

    if (typeof inst.setEpChip === 'function') {
      var originalChip = inst.setEpChip.bind(inst)
      inst.setEpChip = function () { originalChip(); chip() }
    }
    chip()
  }

  var api = {
    ToolCallSplitter: ToolCallSplitter,
    parseCall: parseCall,
    requestFor: requestFor,
    execute: execute,
    formatResult: formatResult,
    toolSchemas: toolSchemas,
    toolPrompt: toolPrompt,
    runLoop: runLoop,
    clip: clip,
    TOOLS: TOOLS,
    MAX_ITERATIONS: MAX_ITERATIONS,
    maxIterations: MAX_ITERATIONS,
    stream: streamChat,
    lastRun: null,
    attached: false,
    get instance() { return inst },
    get chatUrl() { return chatUrl },
    get base() { return apiBase },
  }

  function start() {
    inst = findInstance()
    if (!inst) return false

    discover().then(function (found) {
      if (!found) {
        // Without the /api surface the export's own behaviour is left alone —
        // a canned reply the operator recognises beats a broken console — but
        // it has to be visible in the log that no tool can run.
        console.warn('[fleet-agent] no /api surface found; tried: ' + PROBE_PATHS.join(' '))
        return
      }
      chatUrl = found.chat
      apiBase = found.base
      attach()
      api.attached = true
      get(apiBase + '/api/agent/models').then(function (json) {
        if (json && json.models && json.models.length) model = json.models[0]
      })
      console.log('[fleet-agent] attached · ' + Object.keys(TOOLS).length + ' tools · ' + chatUrl)
    })

    window.__fleetAgent = api
    return true
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api
  else if (typeof window !== 'undefined') window.__fleetAgent = api

  // The runtime loads React, compiles with Babel, then mounts, so the instance
  // does not exist at DOMContentLoaded. Poll rather than guess a delay.
  if (typeof document !== 'undefined') {
    var tries = 0
    var waiting = setInterval(function () {
      if (start() || ++tries > 160) clearInterval(waiting)
    }, 250)
  }
})()
