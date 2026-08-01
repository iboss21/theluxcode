// Server-sent event reader. Brand and engineering by davidio.dev.
//
// Claude Code and LM Studio both require streaming: a client that receives the
// whole response at once has already spent the wall clock it was trying to
// avoid, and Claude Code specifically stalls on a gateway that buffers. This
// reader yields each event as it arrives off the socket.

export interface SseEvent {
  /** The `event:` field, or "message" when the stream omits it. */
  event: string;
  /** The joined `data:` lines for this event. */
  data: string;
}

/**
 * Parses a `text/event-stream` body incrementally.
 *
 * Events are separated by a blank line. A chunk boundary can fall anywhere,
 * including inside a UTF-8 sequence, so decoding is done with `stream: true`
 * and the remainder is carried across reads.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) {
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      let separator = findSeparator(buffer);
      while (separator !== null) {
        const rawEvent = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        const parsed = parseEvent(rawEvent);
        if (parsed !== null) {
          yield parsed;
        }
        separator = findSeparator(buffer);
      }
    }
    buffer += decoder.decode();
    const trailing = parseEvent(buffer);
    if (trailing !== null) {
      yield trailing;
    }
  } finally {
    reader.releaseLock();
  }
}

function findSeparator(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) {
    return null;
  }
  if (crlf !== -1 && (lf === -1 || crlf < lf)) {
    return { index: crlf, length: 4 };
  }
  return { index: lf, length: 2 };
}

function parseEvent(raw: string): SseEvent | null {
  const lines = raw.split(/\r?\n/);
  let event = "message";
  const data: Array<string> = [];
  for (const line of lines) {
    if (line.length === 0 || line.startsWith(":")) {
      continue;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // A single leading space after the colon is part of the framing, not data.
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }
    if (field === "event") {
      event = value;
    } else if (field === "data") {
      data.push(value);
    }
  }
  if (data.length === 0) {
    return null;
  }
  return { event, data: data.join("\n") };
}
