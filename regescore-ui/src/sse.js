/**
 * Server-sent events, both directions.
 *
 * readSSE parses an upstream stream. The subtle part is that network chunks do
 * not align with SSE frames: one chunk can hold three events and half of a
 * fourth. Splitting each chunk independently corrupts the split event, which
 * shows up as tokens vanishing under load and never in testing. A carry buffer
 * holds the incomplete tail until the rest arrives.
 *
 * SSEStream writes downstream. It disables Nagle and any proxy buffering,
 * because a dashboard that receives a whole answer at once is indistinguishable
 * from a hung one.
 *
 * RegesCore // Fable 5 - brand and engineering by davidio.dev
 */
'use strict'

async function* readSSE(stream) {
  if (!stream) return
  const decoder = new TextDecoder()
  let carry = ''

  for await (const chunk of stream) {
    carry += decoder.decode(chunk, { stream: true })

    // Frames end at a blank line; \r\n\r\n appears behind some proxies.
    let boundary
    while ((boundary = findBoundary(carry)) !== -1) {
      const raw = carry.slice(0, boundary.index)
      carry = carry.slice(boundary.index + boundary.length)
      const event = parseFrame(raw)
      if (event) yield event
    }
  }

  const tail = parseFrame(carry)
  if (tail) yield tail
}

function findBoundary(text) {
  const lf = text.indexOf('\n\n')
  const crlf = text.indexOf('\r\n\r\n')
  if (lf === -1 && crlf === -1) return -1
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 }
  return { index: lf, length: 2 }
}

function parseFrame(raw) {
  const text = raw.trim()
  if (!text) return null
  let event = 'message'
  const data = []
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(':')) continue // comment / keepalive
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (!data.length) return null
  return { event, data: data.join('\n') }
}

class SSEStream {
  constructor(res) {
    this.res = res
    this.closed = false
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx and Caddy buffer text/event-stream by default; this opts out.
      'x-accel-buffering': 'no',
    })
    if (res.socket && typeof res.socket.setNoDelay === 'function') res.socket.setNoDelay(true)
    if (typeof res.flushHeaders === 'function') res.flushHeaders()
    res.on('close', () => { this.closed = true })
  }

  send(payload) {
    if (this.closed) return false
    try {
      this.res.write(`data: ${JSON.stringify(payload)}\n\n`)
      return true
    } catch {
      this.closed = true
      return false
    }
  }

  end() {
    if (this.closed) return
    this.closed = true
    try { this.res.end() } catch { /* client already gone */ }
  }
}

module.exports = { readSSE, SSEStream, parseFrame, findBoundary }
