// Tests for the parsing logic in the RegesCore gateway.
//
// Run: node --test --experimental-strip-types src/*.test.ts
//
// These cover the two places where a streaming proxy actually goes wrong: an
// event or a tag split across a chunk boundary. Both produce silent corruption
// rather than an error, so they need explicit coverage.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ReasoningRouter, type Segment } from "./reasoning.ts";
import { readSse } from "./sse.ts";

function streamOf(chunks: Array<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(chunks: Array<string>) {
  const events = [];
  for await (const event of readSse(streamOf(chunks))) {
    events.push(event);
  }
  return events;
}

function route(router: ReasoningRouter, chunks: Array<string>): Array<Segment> {
  const segments: Array<Segment> = [];
  for (const chunk of chunks) {
    segments.push(...router.push(chunk));
  }
  segments.push(...router.flush());
  return segments;
}

function textOf(segments: Array<Segment>, type: Segment["reasoningType"]): string {
  return segments
    .filter(segment => segment.reasoningType === type)
    .map(segment => segment.text)
    .join("");
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

test("parses simple data events", async () => {
  const events = await collect(['data: {"a":1}\n\n', "data: [DONE]\n\n"]);
  assert.deepEqual(events, [
    { event: "message", data: '{"a":1}' },
    { event: "message", data: "[DONE]" },
  ]);
});

test("parses named events with the Anthropic framing", async () => {
  const events = await collect([
    'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n',
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "content_block_delta");
  assert.equal(events[0].data, '{"type":"content_block_delta"}');
});

test("reassembles an event split across chunk boundaries", async () => {
  const events = await collect(['data: {"cont', 'ent":"hel', 'lo"}\n', "\n"]);
  assert.deepEqual(events, [{ event: "message", data: '{"content":"hello"}' }]);
});

test("handles a multibyte character split across chunks", async () => {
  const encoder = new TextEncoder();
  const bytes = encoder.encode('data: {"t":"日本"}\n\n');
  const first = bytes.slice(0, 16);
  const second = bytes.slice(16);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(first);
      controller.enqueue(second);
      controller.close();
    },
  });
  const events = [];
  for await (const event of readSse(stream)) {
    events.push(event);
  }
  assert.deepEqual(events, [{ event: "message", data: '{"t":"日本"}' }]);
});

test("accepts CRLF framing", async () => {
  const events = await collect(['data: {"a":1}\r\n\r\n']);
  assert.deepEqual(events, [{ event: "message", data: '{"a":1}' }]);
});

test("joins multiple data lines and ignores comments", async () => {
  const events = await collect([": keep-alive\ndata: line one\ndata: line two\n\n"]);
  assert.deepEqual(events, [{ event: "message", data: "line one\nline two" }]);
});

test("emits a trailing event that has no terminating blank line", async () => {
  const events = await collect(["data: last\n"]);
  assert.deepEqual(events, [{ event: "message", data: "last" }]);
});

// ---------------------------------------------------------------------------
// Reasoning router
// ---------------------------------------------------------------------------

test("passes plain text through as answer content", () => {
  const segments = route(new ReasoningRouter(), ["hello ", "world"]);
  assert.equal(textOf(segments, "none"), "hello world");
  assert.equal(textOf(segments, "reasoning"), "");
});

test("separates reasoning from the answer", () => {
  const segments = route(new ReasoningRouter(), ["<think>plan</think>answer"]);
  assert.equal(textOf(segments, "reasoning"), "plan");
  assert.equal(textOf(segments, "none"), "answer");
  assert.equal(textOf(segments, "reasoningStartTag"), "<think>");
  assert.equal(textOf(segments, "reasoningEndTag"), "</think>");
});

test("holds back a tag split across chunk boundaries", () => {
  const segments = route(new ReasoningRouter(), ["<thi", "nk>plan</thi", "nk>answer"]);
  assert.equal(textOf(segments, "reasoning"), "plan");
  assert.equal(textOf(segments, "none"), "answer");
});

test("does not mistake a lone angle bracket for a tag", () => {
  const segments = route(new ReasoningRouter(), ["a < b and c > d"]);
  assert.equal(textOf(segments, "none"), "a < b and c > d");
});

test("treats unterminated reasoning as reasoning, not as the answer", () => {
  // The empty-answer failure mode: everything the model produced was reasoning,
  // so nothing may be reported as answer content.
  const segments = route(new ReasoningRouter(), ["<think>still thinking"]);
  assert.equal(textOf(segments, "reasoning"), "still thinking");
  assert.equal(textOf(segments, "none"), "");
});

test("handles reasoning arriving one character at a time", () => {
  const source = "<think>abc</think>xyz";
  const segments = route(new ReasoningRouter(), source.split(""));
  assert.equal(textOf(segments, "reasoning"), "abc");
  assert.equal(textOf(segments, "none"), "xyz");
});

test("preserves the full stream across every segment", () => {
  const source = "intro<think>why</think>done";
  const segments = route(new ReasoningRouter(), ["intro<thi", "nk>why</think>do", "ne"]);
  assert.equal(segments.map(segment => segment.text).join(""), source);
});
