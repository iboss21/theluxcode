// Reasoning channel router. Brand and engineering by davidio.dev.
//
// Reasoning models stream `<think> ... </think>` inline with the answer. LM
// Studio wants those fragments tagged, not stripped: an untagged reasoning
// block shows up as the answer, and a stripped one leaves the answer empty --
// the `"content": []` with a full token count that a mis-tagged stream produces.
//
// Tags can straddle a chunk boundary, so a trailing partial `<thi` is held back
// until the next chunk decides what it is.

export type ReasoningType = "none" | "reasoning" | "reasoningStartTag" | "reasoningEndTag";

export interface Segment {
  text: string;
  reasoningType: ReasoningType;
}

const OPEN = "<think>";
const CLOSE = "</think>";

export class ReasoningRouter {
  private buffer = "";
  private inside = false;

  /** Feeds a streamed chunk and returns the segments that are now unambiguous. */
  public push(chunk: string): Array<Segment> {
    this.buffer += chunk;
    const segments: Array<Segment> = [];

    while (this.buffer.length > 0) {
      const tag = this.inside ? CLOSE : OPEN;
      const index = this.buffer.indexOf(tag);

      if (index !== -1) {
        const before = this.buffer.slice(0, index);
        if (before.length > 0) {
          segments.push({
            text: before,
            reasoningType: this.inside ? "reasoning" : "none",
          });
        }
        segments.push({
          text: tag,
          reasoningType: this.inside ? "reasoningEndTag" : "reasoningStartTag",
        });
        this.buffer = this.buffer.slice(index + tag.length);
        this.inside = !this.inside;
        continue;
      }

      // No complete tag. Emit everything that cannot be the start of one and
      // keep the rest until more text arrives.
      const held = partialTagLength(this.buffer, tag);
      const emit = this.buffer.slice(0, this.buffer.length - held);
      if (emit.length > 0) {
        segments.push({
          text: emit,
          reasoningType: this.inside ? "reasoning" : "none",
        });
      }
      this.buffer = this.buffer.slice(this.buffer.length - held);
      break;
    }

    return segments;
  }

  /** Flushes whatever is held back once the stream ends. */
  public flush(): Array<Segment> {
    if (this.buffer.length === 0) {
      return [];
    }
    const segment: Segment = {
      text: this.buffer,
      reasoningType: this.inside ? "reasoning" : "none",
    };
    this.buffer = "";
    return [segment];
  }
}

/** Length of the suffix of `text` that could still grow into `tag`. */
function partialTagLength(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let length = max; length > 0; length--) {
    if (tag.startsWith(text.slice(text.length - length))) {
      return length;
    }
  }
  return 0;
}
