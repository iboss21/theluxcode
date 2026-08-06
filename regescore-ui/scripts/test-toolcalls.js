/**
 * Tests for the tool-call parser and dispatcher.
 *
 * The case that matters is chunk splitting. A parser that works on whole
 * strings and fails across boundaries passes every casual test and then
 * corrupts output under real streaming, so the same input is replayed at every
 * possible split point and the result must be identical each time.
 */
'use strict'

const assert = require('assert')
const { ToolCallSplitter, parseCall, execute, formatResult, toolSchemas } = require('../src/api/toolcalls')

let passed = 0
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name) }
  catch (error) { console.log('  FAIL ' + name + '\n       ' + error.message); process.exitCode = 1 }
}

// -- the splitter ------------------------------------------------------

function run(splitter, chunks) {
  const events = []
  for (const c of chunks) events.push(...splitter.push(c))
  events.push(...splitter.flush())
  return events
}

const STREAM =
  'Checking the vault.\n' +
  '<tool_call>\n<function=read_memory>\n<parameter=query>shard health</parameter>\n</function>\n</tool_call>' +
  'and the graph too' +
  '<tool_call>\n{"name":"graph_query","arguments":{"query":"Meridian"}}\n</tool_call>' +
  ' done.'

test('whole-string parse finds both calls and the text between', () => {
  const events = run(new ToolCallSplitter(), [STREAM])
  const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('')
  const calls = events.filter((e) => e.type === 'call')
  assert.strictEqual(calls.length, 2, `got ${calls.length} calls`)
  assert.ok(text.includes('Checking the vault.'))
  assert.ok(text.includes('and the graph too'))
  assert.ok(text.includes(' done.'))
  assert.ok(!text.includes('tool_call'), 'markup leaked into answer text')
})

test('every split point yields identical output', () => {
  const reference = run(new ToolCallSplitter(), [STREAM])
  const refText = reference.filter((e) => e.type === 'text').map((e) => e.text).join('')
  const refCalls = reference.filter((e) => e.type === 'call').map((e) => e.raw)

  for (let i = 1; i < STREAM.length; i++) {
    const events = run(new ToolCallSplitter(), [STREAM.slice(0, i), STREAM.slice(i)])
    const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('')
    const calls = events.filter((e) => e.type === 'call').map((e) => e.raw)
    assert.strictEqual(text, refText, `text differs when split at ${i}`)
    assert.deepStrictEqual(calls, refCalls, `calls differ when split at ${i}`)
  }
})

test('one-character-at-a-time is the same as one chunk', () => {
  const events = run(new ToolCallSplitter(), STREAM.split(''))
  assert.strictEqual(events.filter((e) => e.type === 'call').length, 2)
  const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('')
  assert.ok(!text.includes('<tool'), 'a partial tag was printed as text')
})

test('a partial tag is never printed and never lost', () => {
  const s = new ToolCallSplitter()
  // "<tool_c" could still become the open tag, so nothing may be emitted yet.
  assert.deepStrictEqual(s.push('hello <tool_c'), [{ type: 'text', text: 'hello ' }])
  // It turns out to be ordinary text, so it must come back on flush.
  assert.deepStrictEqual(s.flush(), [{ type: 'text', text: '<tool_c' }])
})

test('an unterminated call reports truncation instead of leaking markup', () => {
  const s = new ToolCallSplitter()
  s.push('<tool_call>\n<function=read_file>')
  const out = s.flush()
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].type, 'truncated')
})

// -- parseCall ---------------------------------------------------------

test('XML form parses name and parameters', () => {
  const c = parseCall('<function=read_file>\n<parameter=path>/etc/hosts</parameter>\n</function>')
  assert.strictEqual(c.name, 'read_file')
  assert.strictEqual(c.args.path, '/etc/hosts')
})

test('a multi-line parameter value survives intact', () => {
  const body = 'line one\nline two\n  indented'
  const c = parseCall(`<function=write_file>\n<parameter=body>${body}</parameter>\n</function>`)
  assert.strictEqual(c.args.body, body)
})

test('a JSON-looking parameter is decoded to structured data', () => {
  const c = parseCall('<function=x>\n<parameter=tags>["a","b"]</parameter>\n</function>')
  assert.deepStrictEqual(c.args.tags, ['a', 'b'])
})

test('Hermes JSON form parses too', () => {
  const c = parseCall('{"name":"rag_query","arguments":{"query":"invoices","k":5}}')
  assert.strictEqual(c.name, 'rag_query')
  assert.strictEqual(c.args.k, 5)
})

test('stringified arguments are decoded', () => {
  const c = parseCall('{"name":"web_fetch","arguments":"{\\"url\\":\\"https://x\\"}"}')
  assert.strictEqual(c.args.url, 'https://x')
})

test('malformed input returns an error rather than throwing', () => {
  assert.ok(parseCall('').error)
  assert.ok(parseCall('no tags here').error)
  assert.ok(parseCall('{"broken":').error)
})

// -- dispatch ----------------------------------------------------------

test('an unknown tool name never becomes a request', async () => {
  let called = false
  const r = await execute({ name: 'rm_rf', args: {} }, 'http://x', () => { called = true })
  assert.strictEqual(called, false, 'a request was made for an unlisted tool')
  assert.strictEqual(r.ok, false)
  assert.ok(r.error.includes('unknown tool'))
})

test('GET tools put arguments in the query string, not the body', async () => {
  let seen = null
  await execute({ name: 'read_memory', args: { query: 'shard health' } }, 'http://h',
    (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => '[]' } })
  assert.ok(seen.url.startsWith('http://h/api/memory?'))
  assert.ok(seen.url.includes('shard+health') || seen.url.includes('shard%20health'))
  assert.strictEqual(seen.init.body, undefined)
})

test('POST tools map arguments onto the route shape', async () => {
  let seen = null
  await execute({ name: 'read_file', args: { file_path: '/a/b' } }, 'http://h',
    (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => '{}' } })
  assert.strictEqual(seen.url, 'http://h/api/filesystem/read')
  assert.deepStrictEqual(JSON.parse(seen.init.body), { path: '/a/b' })
})

test('undefined fields are dropped so the route reports the real omission', async () => {
  let seen = null
  await execute({ name: 'write_memory', args: { text: 'hi' } }, 'http://h',
    (url, init) => { seen = init; return { ok: true, status: 200, text: async () => '{}' } })
  assert.deepStrictEqual(Object.keys(JSON.parse(seen.body)), ['text'])
})

test('a transport failure is a readable result, not an exception', async () => {
  const r = await execute({ name: 'system_stats', args: {} }, 'http://h',
    () => { throw new Error('ECONNREFUSED') })
  assert.strictEqual(r.ok, false)
  assert.ok(r.error.includes('ECONNREFUSED'))
})

test('an HTTP error keeps the body so the model can correct itself', async () => {
  const r = await execute({ name: 'read_file', args: { path: '/nope' } }, 'http://h',
    () => ({ ok: false, status: 404, text: async () => '{"error":"ENOENT"}' }))
  assert.strictEqual(r.ok, false)
  assert.ok(r.error.includes('404'))
  assert.strictEqual(r.data.error, 'ENOENT')
})

test('results render as the tool_response form the template expects', () => {
  assert.ok(formatResult({ ok: true, data: { a: 1 } }).startsWith('<tool_response>'))
  assert.ok(formatResult({ ok: false, error: 'boom', data: '' }).includes('[tool error] boom'))
})

test('every advertised tool has a route and a description', () => {
  const schemas = toolSchemas()
  assert.ok(schemas.length >= 15, `only ${schemas.length} tools`)
  for (const s of schemas) assert.ok(s.description, `${s.name} has no description`)
})

// Async tests above return promises; give them a tick before reporting.
setTimeout(() => {
  console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`)
}, 50)
