// How a page learns that a chat's state changed (plan §4.4): a push of its own kind on the live hub,
// with no data, which the page answers by reading the chat's state again. Keyed, so a page that fell
// behind is given one. It goes out after each change made from a panel here, and when a run of the
// chat ends, which the turn lane says on the hub itself: it publishes every record of RPH's trace as
// a `trace` event, and a run's last is `run_ended`. A chat is followed for that once a page has read
// its state.

import type { LiveHub } from "../app";
import { isRecord } from "../shared/json";

/** The kind the turn lane publishes RPH's trace records under, and the events that begin and end a run: each moves what the panels say (a turn is running, or is not). */
const TRACE_KIND = "trace";
const RUN_CHANGES: ReadonlySet<string> = new Set(["run_started", "run_ended"]);

/** Tells everyone following `chat` that its state changed. */
export function stateChanged(live: Pick<LiveHub, "publish">, chat: string): void {
  live.publish(chat, { kind: "state", data: {} });
}

/** Follows chats on the live hub, each once, and tells their followers when a run of theirs begins or ends. */
export class RunEnds {
  private readonly followed = new Set<string>();

  constructor(private readonly live: Pick<LiveHub, "publish" | "follow">) {}

  follow(chat: string): void {
    if (this.followed.has(chat)) return;
    this.followed.add(chat);
    this.live.follow(chat, {
      take: (batch) => {
        const changes = batch.events.some((e) => e.kind === TRACE_KIND && isRecord(e.data) && isRecord(e.data.event) && RUN_CHANGES.has(String(e.data.event.kind)));
        // After the hub has handed the run's start or end to every follower, so each page gets the events in order.
        if (changes) queueMicrotask(() => stateChanged(this.live, chat));
        return true;
      },
    });
  }
}
