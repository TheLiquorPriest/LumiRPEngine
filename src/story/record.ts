// The story record (plan §8.1): the Author's understanding of the story, as items of eleven parts. Every write is a change of the
// story's area in the store's fold (`./fold`), tied to the turn that wrote it, holding only what that write said. An item as it
// stands is its changes on the reading's path, merged in order; its history is those changes. Code merges and counts; it never
// judges what an item says.
//
// Where an item stands in the chat comes from the records alone: a beat lies at the message it names, or at its turn's reply; a
// scene or a chapter runs from the message it names, or from the first message its opening turn answered, to the message it names,
// or its closing turn's reply, and never past the start of the next one.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { emptyQuests, type QuestSlice, questSliceOf } from "../quests/record";
import type { Stamp } from "../iface/source";
import type { ChangeInput, Source, Store } from "../store";
import { applyStory, type HorizonEntry, mergeWrite, newItemId, STORY_OPS, type StoryItemDoc, type StoryPart, type StoryRowDoc, storySliceOf } from "./fold";
import type { StoryAt } from "./path";

export { keyedItemId, nameKey, newItemId, STORY_PARTS, type StoryPart } from "./fold";

/** The parts of the timeline that span messages. */
export type SpanPart = "chapter" | "scene";

/** One write of an item as it is kept: its turn (and that turn's number on the path), who wrote it, and what it said (the fields it set, `close` and `drop` among them). */
export type StoryRow = StoryRowDoc;

/** An item as it stands on a path. */
export type StoryItem = StoryItemDoc;

/** Messages by number, both ends kept; an end is null where the record cannot place it. */
export interface Span {
  from: number | null;
  to: number | null;
}

/** The record as one reading sees it. */
export class StoryRecord {
  readonly items = new Map<string, StoryItem>();
  /** The Author's horizon as the record holds it: the entries in the order he left them. */
  readonly horizon: readonly HorizonEntry[];
  /** The quests of the same point of the path: a thread shows each quest that names it. */
  readonly quests: QuestSlice;

  constructor(
    readonly at: StoryAt,
    slice?: { items: Readonly<Record<string, StoryItem>>; horizon?: readonly HorizonEntry[] },
    quests: QuestSlice = emptyQuests(),
  ) {
    this.horizon = slice?.horizon ?? [];
    this.quests = quests;
    if (slice !== undefined) for (const [id, item] of Object.entries(slice.items)) this.items.set(id, item);
  }

  /**
   * The record at `at`, as the store folded it there: at the chat's head, at a turn (inside an open turn, with what it has staged),
   * or, for a job's own reading (`job`), where it was started with its own writes on top: at the turn it was started with, or, for a
   * job of his own that belongs to no turn, at the chat's head. A turn joined to another is refused as the store refuses it, naming
   * the turn it joined.
   */
  static read(store: Store, user: string, at: StoryAt, job: string | null = null): StoryRecord {
    const u = store.user(user);
    if (at.turn === null) {
      const state = u.headState(at.chat).state;
      const head = storySliceOf(state);
      if (job === null) return new StoryRecord(at, head, questSliceOf(state));
      // His own job's writes are changes of no turn, placed when it ends: until then only the job reads them, on top of the head.
      const own = store.db
        .query<{ op: string; value: string; by: string | null }, [string, string, string]>("SELECT op, value, by FROM change WHERE user = ? AND chat = ? AND job = ? AND applied = 1 AND op LIKE 'story.%' ORDER BY ord")
        .all(user, at.chat, job);
      return new StoryRecord(at, applyStory(head, own.map((c) => ({ op: c.op, value: JSON.parse(c.value) as JsonValue, turn: "", n: at.turns.length + 1, by: c.by }))), questSliceOf(state));
    }
    const folded = job === null ? u.stateAt(at.turn) : u.stateFor(at.turn, job);
    return new StoryRecord(at, storySliceOf(folded.state), questSliceOf(folded.state));
  }

  /**
   * Merges one more write in, in this reading only (a call's own operations are read against the record with each earlier one of the
   * call applied): the item's fields, whether it is closed or struck, and when it was touched. The store's items are never changed.
   */
  apply(write: { part: StoryPart; item: string; value: JsonObject; turn: string; by?: string | null }): StoryItem {
    const row: StoryRow = { turn: write.turn, n: 0, by: write.by ?? null, value: write.value };
    const item = mergeWrite(this.items.get(write.item), write.part, write.item, write.value, row);
    this.items.set(write.item, item);
    return item;
  }

  /** A part's items in the order they were first written; those dropped only when asked. */
  of(part: StoryPart, dropped = false): StoryItem[] {
    return [...this.items.values()].filter((i) => i.part === part && (dropped || !i.dropped));
  }

  /** The number of the message a field holds the id of; null when it holds none or it is not on the chat's path. */
  numberOf(field: JsonValue | undefined): number | null {
    return typeof field === "string" ? this.at.number(field) : null;
  }

  /** Where a beat lies: the message it names, or its turn's reply. */
  beatAt(beat: StoryItem): number | null {
    return beat.fields.message !== undefined ? this.numberOf(beat.fields.message) : this.at.replyOf(beat.opened);
  }

  /** The messages a beat covers: from where it lies through the last message it names, where it names one (a beat recorded from a stretch of the chat's past); else where it lies alone. */
  beatSpan(beat: StoryItem): Span {
    const from = this.beatAt(beat);
    const to = beat.fields.last !== undefined ? this.numberOf(beat.fields.last) : null;
    return { from, to: from === null ? null : to !== null && to > from ? to : from };
  }

  /** Where a scene or a chapter starts: the message it names, or the first message its opening turn answered. */
  startOf(item: StoryItem): number | null {
    return item.fields.first !== undefined ? this.numberOf(item.fields.first) : this.at.startOf(item.opened);
  }

  /** Each scene's or chapter's messages (see the header), by id; dropped ones have none. */
  spans(part: SpanPart): Map<string, Span> {
    const known = this.of(part).map((item, made) => ({ item, made, from: this.startOf(item) }));
    // Placed by where each starts, one that cannot be placed after every other; then by when it was made.
    known.sort((a, b) => (a.from ?? Number.POSITIVE_INFINITY) - (b.from ?? Number.POSITIVE_INFINITY) || a.made - b.made);
    const last = this.at.messages.length - 1;
    const out = new Map<string, Span>();
    known.forEach(({ item, from }, i) => {
      if (from === null) {
        out.set(item.id, { from: null, to: null });
        return;
      }
      if (item.fields.last !== undefined) {
        out.set(item.id, { from, to: this.numberOf(item.fields.last) });
        return;
      }
      // One placed by the messages it names may start where this one does; the next to start later bounds it.
      const next = known.slice(i + 1).find((k) => k.from !== null && k.from > from)?.from ?? null;
      const stop = item.closedBy === null ? last : (this.at.replyOf(item.closedBy) ?? last);
      out.set(item.id, { from, to: next === null ? stop : Math.min(stop, next - 1) });
    });
    return out;
  }

  /**
   * The scene or chapter the chat is in now: the one that starts last, one whose opening turn is not
   * placed yet counting as last. One that names a first message the chat no longer has (deleted) is
   * past, not current. Null when there is none. It may be closed: then the chat is in none.
   */
  current(part: SpanPart): StoryItem | null {
    let best: { item: StoryItem; from: number } | null = null;
    for (const item of this.of(part)) {
      const placed = this.startOf(item);
      if (placed === null && item.fields.first !== undefined) continue;
      const from = placed ?? Number.POSITIVE_INFINITY;
      if (best === null || from >= best.from) best = { item, from };
    }
    return best?.item ?? null;
  }
}

/** One write a call asks for: of an item already there (`item`), or of a new one (`item` null, given its id from its first change). */
export interface StoryWrite {
  part: StoryPart;
  item: string | null;
  value: JsonObject;
  /**
   * A stand-in for a new item, which later writes of the same call name for it (`item` is the stand-in there): given the id the
   * item is made with, once its first write is recorded.
   */
  stand?: string;
  /** The write's own provenance (its source, precision, standing and what it cites), which takes the place of the writer's source. */
  stamp?: Stamp;
}

/** One lore overlay a call asks for (plan §9.3): a note on a lore entry, written with the story's own writes. */
export interface StoryOverlayWrite {
  entry: string;
  note: string;
  /** The note's own provenance, as for a write. */
  stamp?: Stamp;
}

/** Who writes, and where: the chat and the turn it belongs to (none: his own change of no turn, placed after the chat's newest reply); an agent's definition, `player` or the import; its handle in its run; the job it was started as. */
export interface StoryWriter {
  user: string;
  chat: string;
  turn: string | null;
  by: string | null;
  agent: string | null;
  job: string | null;
  /** Where what it wrote came from (§6.6): the player's strike, the import; none for an agent's own conclusion. */
  source?: Source | null;
}

/** What one write of a call came to: the change that holds it, and the item it wrote (null for an overlay). */
export interface StoryRecorded {
  change: number;
  item: string | null;
}

/** The id the next change of the store's table is given, which the first write of a new item takes its id from. */
export function nextChange(store: Store): number {
  return (store.db.query<{ seq: number }, []>("SELECT seq FROM sqlite_sequence WHERE name = 'change'").get()?.seq ?? 0) + 1;
}

/**
 * Records a call's writes on the writer's turn, in order, as one write of the store, inside the caller's queued write: each write of
 * an item is a change of the story's area, an overlay another, the lane story, each keeping who wrote it and its run's handle. A new
 * item is given its id from its first change (its part and that change's number). A turn joined to another is refused with the typed
 * error naming the turn it joined; a job's writes take effect where the store places a job's.
 */
export function recordStory(store: Store, writer: StoryWriter, list: readonly (StoryWrite | StoryOverlayWrite)[]): StoryRecorded[] {
  const first = nextChange(store);
  const given = new Map<string, string>();
  const items: (string | null)[] = [];
  const inputs = list.map((w, i): ChangeInput => {
    const base = { lane: "story" as const, by: writer.by, handle: writer.agent, source: writer.source ?? null };
    if ("entry" in w) {
      items.push(null);
      return { ...base, ...(w.stamp ?? {}), op: STORY_OPS.overlay, value: { entry: w.entry, note: w.note } };
    }
    const item = w.item === null ? newItemId(w.part, first + i) : (given.get(w.item) ?? w.item);
    if (w.item === null && w.stand !== undefined) given.set(w.stand, item);
    items.push(item);
    return { ...base, ...(w.stamp ?? {}), op: STORY_OPS.write, value: { part: w.part, item, value: w.value } };
  });
  const u = store.user(writer.user);
  const target = u.writeTarget({ chat: writer.chat, turn: writer.turn, job: writer.job });
  const { changes } = u.record(target, inputs);
  return changes.map((c, i) => ({ change: c.id, item: items[i] ?? null }));
}

/** What `writeStory` wrote for one write: its change, the item it wrote with its part, and what it said. */
export interface StoryWritten {
  change: number;
  item: string;
  part: StoryPart;
  value: JsonObject;
}

/** `recordStory` for writes of items only. */
export function writeStory(store: Store, writer: StoryWriter, writes: readonly StoryWrite[]): StoryWritten[] {
  return recordStory(store, writer, writes).map((r, i) => ({ change: r.change, item: r.item as string, part: (writes[i] as StoryWrite).part, value: (writes[i] as StoryWrite).value }));
}
