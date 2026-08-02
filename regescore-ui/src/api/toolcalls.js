/**
 * Tool-call parsing and dispatch — the loop that makes the agent act.
 *
 * The model already emits well-formed calls in the XML form the RegesCore
 * template specifies:
 *
 *   <tool_call>
 *   <function=read_memory>
 *   <parameter=path>/data/memory/v2/shard_health.json</parameter>
 *   </function>
 *   </tool_call>
 *
 * Nothing was parsing them, so they arrived in the console as prose and the
 * agent could not read a file, run a command, or modify itself. This module is
 * the missing half: extract calls from the token stream, run each against a
 * real route, and hand the results back so the model can continue.
 *
 * The parser is the part that has to be right. Tokens arrive in chunks that do
 * not align with tag boundaries — "<tool_c" can end one chunk and "all>" begin
 * the next. Splitting each chunk independently prints half a tag as answer text
 * and loses the rest, which shows up as corrupted output only under load. So a
 * trailing run that could still become a tag is held back and prepended to the
 * next chunk, and released as ordinary text at end of stream, where it turns
 * out that is what it was.
 *
 * Dispatch is a fixed allowlist. A model-supplied name is never turned into a
 * URL, a path, or a shell string: it is looked up, and an unknown name comes
 * back as an error the model can read and correct. That is the boundary that
 * keeps a hallucinated tool name from becoming a request to an arbitrary
 * endpoint.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
'use strict'

const OPEN = '<tool_call>'
const CLOSE = '</tool_call>'

/**
 * Streams text through, separating tool-call blocks from answer text.
 *
 * push() returns events in order:
 *   {type:'text', text}      answer text, safe to render
 *   {type:'call', raw}       one complete tool_call block body
 */
class ToolCallSplitter {
  constructor() {
    this.buffer = ''
    this.inside = false
  }

  // Longest suffix of text that is a proper prefix of tag — the part that
  // cannot yet be classified and must wait for more input.
  static partialSuffix(text, tag) {
    const max = Math.min(text.length, tag.length - 1)
    for (let n = max; n > 0; n--) {
      if (text.endsWith(tag.slice(0, n))) return n
    }
    return 0
  }

  push(chunk) {
    this.buffer += chunk
    const events = []

    for (;;) {
      const tag = this.inside ? CLOSE : OPEN
      const at = this.buffer.indexOf(tag)

      if (at === -1) {
        // Inside a call, nothing is emitted until the close tag arrives: a
        // half-parsed call must never be dispatched.
        if (this.inside) return events
        const hold = ToolCallSplitter.partialSuffix(this.buffer, tag)
        const emit = this.buffer.slice(0, this.buffer.length - hold)
        this.buffer = this.buffer.slice(this.buffer.length - hold)
        if (emit) events.push({ type: 'text', text: emit })
        return events
      }

      const before = this.buffer.slice(0, at)
      if (this.inside) events.push({ type: 'call', raw: before })
      else if (before) events.push({ type: 'text', text: before })

      this.buffer = this.buffer.slice(at + tag.length)
      this.inside = !this.inside
    }
  }

  flush() {
    const rest = this.buffer
    this.buffer = ''
    // An unterminated call at end of stream is a truncated generation, not
    // text: reporting it lets the caller retry rather than render markup.
    if (this.inside) return rest ? [{ type: 'truncated', raw: rest }] : []
    return rest ? [{ type: 'text', text: rest }] : []
  }
}

/**
 * Parse one tool_call body into {name, args}.
 *
 * Accepts both forms the template can produce: the XML parameter form, and the
 * Hermes JSON form ({"name":..,"arguments":{..}}), because tool_call_format is
 * a template variable and a deployment can be running either.
 */
function parseCall(raw) {
  const text = String(raw || '').trim()
  if (!text) return { error: 'empty tool_call block' }

  // JSON form first: unambiguous when it parses.
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text)
      const name = json.name || json.function
      if (!name) return { error: 'tool_call JSON has no name' }
      let args = json.arguments !== undefined ? json.arguments : json.input
      if (typeof args === 'string') {
        try { args = JSON.parse(args) } catch { /* leave as a string value */ }
      }
      return { name: String(name), args: args && typeof args === 'object' ? args : {} }
    } catch (error) {
      return { error: `tool_call JSON is invalid: ${error.message}` }
    }
  }

  const fn = /<function=([^>\s]+)\s*>/.exec(text)
  if (!fn) return { error: 'tool_call has no <function=...> tag' }

  const args = {}
  // [\s\S] rather than . because a parameter value is routinely multi-line —
  // a file body or a script is the common case, not the exception.
  const param = /<parameter=([^>\s]+)\s*>([\s\S]*?)<\/parameter>/g
  let m
  while ((m = param.exec(text)) !== null) {
    const key = m[1]
    const value = m[2].trim()
    // Values arrive as raw text. JSON-looking ones are decoded so an object or
    // array parameter reaches the route as structured data.
    if (/^[[{]/.test(value)) {
      try { args[key] = JSON.parse(value); continue } catch { /* keep the text */ }
    }
    args[key] = value
  }
  return { name: fn[1], args }
}

/**
 * The allowlist: tool name -> how to call it.
 *
 * Every entry names a route that exists on the RegesCore server (verified
 * against its route table). `method` and `path` are fixed here, never taken
 * from the model, so a hallucinated name cannot reach an arbitrary URL.
 * `body` maps the model's arguments onto the route's expected shape.
 */
const TOOLS = {
  read_memory: {
    method: 'GET', path: '/api/memory',
    describe: 'Read the fact vault',
    query: (a) => (a.query ? { q: a.query } : {}),
  },
  write_memory: {
    method: 'POST', path: '/api/memory',
    describe: 'Store a fact',
    body: (a) => ({ text: a.text || a.fact || a.value, tags: a.tags }),
  },
  read_file: {
    method: 'POST', path: '/api/filesystem/read',
    describe: 'Read a file from disk',
    body: (a) => ({ path: a.path || a.file || a.file_path }),
  },
  list_files: {
    method: 'POST', path: '/api/filesystem/list',
    describe: 'List a directory',
    body: (a) => ({ path: a.path || a.dir || '.' }),
  },
  rag_query: {
    method: 'POST', path: '/api/rag/query',
    describe: 'Query the RAG index',
    body: (a) => ({ query: a.query || a.q, k: a.k }),
  },
  graph_query: {
    method: 'POST', path: '/api/graphify/query',
    describe: 'Query the knowledge graph',
    body: (a) => ({ query: a.query || a.q }),
  },
  knowledge_query: {
    method: 'POST', path: '/api/knowledge/query',
    describe: 'Query the knowledge base',
    body: (a) => ({ query: a.query || a.q }),
  },
  list_tasks: { method: 'GET', path: '/api/tasks', describe: 'List tasks' },
  create_task: {
    method: 'POST', path: '/api/tasks',
    describe: 'Create a task',
    body: (a) => ({ title: a.title || a.text, notes: a.notes }),
  },
  list_notes: { method: 'GET', path: '/api/notes', describe: 'List notes' },
  create_note: {
    method: 'POST', path: '/api/notes',
    describe: 'Create a note',
    body: (a) => ({ title: a.title, body: a.body || a.text }),
  },
  services_status: { method: 'GET', path: '/api/services/status', describe: 'Health of every service' },
  system_stats: { method: 'GET', path: '/api/system/stats', describe: 'Host CPU, memory, uptime' },
  list_models: { method: 'GET', path: '/api/models', describe: 'Available models' },
  pdf_extract: {
    method: 'POST', path: '/api/pdf/extract',
    describe: 'Extract text from a PDF',
    body: (a) => ({ path: a.path || a.file }),
  },
  web_search: {
    method: 'POST', path: '/api/web-search',
    describe: 'Search the web',
    body: (a) => ({ query: a.query || a.q }),
  },
  web_fetch: {
    method: 'POST', path: '/api/web-fetch',
    describe: 'Fetch a URL',
    body: (a) => ({ url: a.url }),
  },
}

function toolSchemas() {
  return Object.keys(TOOLS).map((name) => ({ name, description: TOOLS[name].describe }))
}

/**
 * Execute one parsed call. Never throws: a failure is a result the model reads
 * and can correct, and an exception here would kill the whole turn.
 */
async function execute(call, baseUrl, fetchImpl = fetch) {
  if (call.error) return { ok: false, error: call.error }

  const spec = TOOLS[call.name]
  if (!spec) {
    return {
      ok: false,
      error: `unknown tool "${call.name}". Available: ${Object.keys(TOOLS).join(', ')}`,
    }
  }

  let url = baseUrl.replace(/\/$/, '') + spec.path
  const init = { method: spec.method, headers: { accept: 'application/json' } }

  if (spec.method === 'GET') {
    const query = spec.query ? spec.query(call.args || {}) : {}
    const params = new URLSearchParams()
    for (const key of Object.keys(query)) {
      if (query[key] !== undefined && query[key] !== null) params.set(key, String(query[key]))
    }
    if ([...params].length) url += '?' + params.toString()
  } else {
    const body = spec.body ? spec.body(call.args || {}) : (call.args || {})
    // Drop undefined so a route that validates required fields reports the
    // real omission rather than receiving the literal string "undefined".
    for (const key of Object.keys(body)) if (body[key] === undefined) delete body[key]
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  try {
    const response = await fetchImpl(url, init)
    const text = await response.text()
    let data
    try { data = JSON.parse(text) } catch { data = text }
    return response.ok
      ? { ok: true, tool: call.name, data }
      : { ok: false, tool: call.name, error: `HTTP ${response.status}`, data }
  } catch (error) {
    return { ok: false, tool: call.name, error: String((error && error.message) || error) }
  }
}

/**
 * Render a result as the tool_response block the template expects back, so the
 * next turn sees its own tool output in the format it was trained on.
 */
function formatResult(result) {
  const payload = typeof result.data === 'string'
    ? result.data
    : JSON.stringify(result.data, null, 2)
  if (result.ok) return `<tool_response>\n${payload}\n</tool_response>`
  return `<tool_response>\n[tool error] ${result.error}${payload ? '\n' + payload : ''}\n</tool_response>`
}

module.exports = { ToolCallSplitter, parseCall, execute, formatResult, toolSchemas, TOOLS }
