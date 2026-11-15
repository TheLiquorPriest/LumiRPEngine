// The frames of a generation's stream, as Lumiverse sends them (`services/generate.service.ts:3320-3380`; `services/generation-pool.service.ts:164-210`; paths are Lumiverse's
// `src/`): one `STREAM_TOKEN_RECEIVED` for each stretch of text of one kind, thinking or reply, the stretches batched to forty milliseconds or 768 characters, sent to the topic
// of the chat's stream, which only a socket that has asked to focus the chat is on. Every timer runs on the host's clock.

import type { HostClock } from "./host";

/** `STREAM_EMIT_INTERVAL_MS` and `STREAM_EMIT_MAX_CHARS` (`:3323-3324`). */
export const STREAM_EMIT_INTERVAL_MS = 40;
export const STREAM_EMIT_MAX_CHARS = 768;

interface Segment {
  token: string;
  type?: "reasoning";
  /** The sequence number of the last token merged into it, and of the first. */
  seq: number;
  startSeq: number;
  /** Where its first token starts in the cumulative text of its kind. */
  offset: number;
}

export class StreamFrames {
  private pending: Segment[] = [];
  private chars = 0;
  private timer: unknown = null;
  private lastFlushAt = 0;
  private seq = 0;
  private readonly offsets = { content: 0, reasoning: 0 };

  constructor(
    private readonly clock: () => HostClock,
    private readonly send: (frame: { generationId: string; chatId: string; token: string; type?: "reasoning"; seq: number; startSeq: number; offset: number }) => void,
    private readonly ids: { generationId: string; chatId: string },
  ) {}

  /** A stretch of text of one kind: the pool's append (`appendPoolContent`, `appendPoolReasoning`) gives it its number and its place, then it is queued (`queueStreamSegment`, `:3367-3385`). */
  push(kind: "content" | "reasoning", text: string): void {
    if (text === "") return;
    const offset = this.offsets[kind];
    this.offsets[kind] += text.length;
    const seq = ++this.seq;
    const type = kind === "reasoning" ? ("reasoning" as const) : undefined;
    const previous = this.pending.at(-1);
    if (previous !== undefined && previous.type === type) {
      previous.token += text;
      previous.seq = seq;
    } else this.pending.push({ token: text, seq, startSeq: seq, offset, ...(type !== undefined ? { type } : {}) });
    this.chars += text.length;
    if (this.chars >= STREAM_EMIT_MAX_CHARS) {
      this.flush();
      return;
    }
    if (this.timer !== null) return;
    // Leading edge after idle (`schedulePendingStreamFlush`, `:3352-3365`): a flush older than the interval goes at once.
    const clock = this.clock();
    const delay = Math.max(0, STREAM_EMIT_INTERVAL_MS - (clock.now() - this.lastFlushAt));
    this.timer = { clock, handle: clock.setTimeout(() => this.flush(), delay) };
  }

  /** `flushPendingStreamSegments` (`:3326-3350`): every queued segment goes, in order. */
  flush(): void {
    if (this.timer !== null) {
      const { clock, handle } = this.timer as { clock: HostClock; handle: unknown };
      clock.clearTimeout(handle);
      this.timer = null;
    }
    if (this.pending.length === 0) return;
    const segments = this.pending;
    this.pending = [];
    this.chars = 0;
    this.lastFlushAt = this.clock().now();
    for (const s of segments) this.send({ ...this.ids, token: s.token, ...(s.type !== undefined ? { type: s.type } : {}), seq: s.seq, startSeq: s.startSeq, offset: s.offset });
  }
}
