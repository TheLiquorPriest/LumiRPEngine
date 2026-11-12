// The story record as a harness call reaches it (DEPTH2-PLAN §4): read along the chat's path and
// written with the call's turn (`HarnessTurn.story`, a `StoryPort` the bridge builds for the call).
//
// - Kept in the reply's record, as the story's part beside the harness part (`Rec.story`), outside
//   every hash but the tombstone's: it follows swipes and branches with the record and moves no path.
// - In a turn's own run a change is staged with the turn (`LedgerService.stageStory`) and lands on
//   the turn's record as it commits; a turn that doesn't stand lands none of it.
// - In a job's run a change is written at once to the record of the turn the job belongs to
//   (`keepStory`), while that record is on the chat's path, as every write of a job is held.
// - A read walks the records on the chat's path in order (`storyRecords`), what this turn staged on
//   top. In a turn that replaces a reply (a swipe or a Regenerate), the reply it replaces is no part
//   of what it reads; a Continue reads the reply it continues.

import type { ChatId, MessageId, UserId } from "../../shared/ids";
import type { Cast, DraftBasis, Rec, RecStory } from "../../shared/ledger";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { activeRecord } from "../../engine/ledger/path";
import { castOn, recStoryOf, type StoryPart, type StoryPath, type StoryRecordAt, storedStory, walkStory, withStory } from "../../engine/story/record";
import { turnRecord } from "../harness/record";
import { type LedgerService, toChain } from "../ledger-io";
import type { Runtime } from "../runtime";

/** Why the story record took no write: the call reaches none (`none`); the turn is over (`closed`); the job's turn record left the chat's path (`off_path`); the engine never saw that turn write a record, or the chat has no reply to write on (`no_basis`). */
export type StoryRefusal = "none" | "closed" | "off_path" | "no_basis";

/** How a write of the story record went. */
export type StoryWritten = { kept: true } | { refused: StoryRefusal };

/** The story as a call reads it. */
export interface StoryRead {
  /** The story along the chat's path, what this turn staged on top. */
  path: StoryPath;
  /** What the record the call writes to holds of the story so far: in a turn what it staged (a Continue's reply's own before it), in a job its turn's record's. */
  own: StoryPart;
  /** The point of the chat a draft opened now is written against: the newest reply on the path that holds a record, else the newest message; null on a chat with none. */
  basis: DraftBasis | null;
  /** Whether a draft's basis is on the chat's path as it stands: its message showing its swipe, the record it held still there; or, where no message has its id (a Branch's copy), a record of its number on the path. */
  onPath(basis: DraftBasis): boolean;
}

/** The story record as one call reaches it. */
export interface StoryPort {
  /** The harness turn the call's changes belong to: its own, or, in a job's run, the turn whose record the job belongs to. */
  readonly turn: string;
  /** True in a turn's own run, where a change is staged and lands as the turn commits; false in a job's run, where it is written at once. */
  readonly staged: boolean;
  /** The story as the call reads it now; null for a chat that plays no world. */
  read(): Promise<StoryRead | null>;
  /** Stages `change` with the turn, or writes it on the job's turn record. */
  write(change: RecStory): Promise<StoryWritten>;
}

/** What the story record reaches of the backend. */
export type StoryRuntime = Pick<Runtime, "ledger" | "runOf" | "host">;

/** The records of `chain` (the chat's path, the journal's ledgers over the messages') that hold a story part, in order: each reply's shown swipe's, unless it was discarded. */
export function storyRecords(core: LedgerCore, chain: readonly ChainMessage[]): StoryRecordAt[] {
  const out: StoryRecordAt[] = [];
  for (const m of chain) {
    const rec = m.isUser ? null : activeRecord(m, core.journal.tombstones);
    const story = rec ? recStoryOf(rec) : null;
    if (rec && story && storedStory(story) !== null) out.push({ messageId: m.id, swipeId: m.swipeId, seq: rec.seq, story });
  }
  return out;
}

/** Where `basis` stands on the chat's path (see `StoryRead.onPath`). */
function basisOnPath(chain: readonly ChainMessage[], core: LedgerCore, basis: DraftBasis): boolean {
  const recOf = (m: ChainMessage): Rec | null => (m.isUser ? null : activeRecord(m, core.journal.tombstones));
  const m = chain.find((c) => c.id === basis.messageId);
  if (m) return m.swipeId === basis.swipeId && (basis.seq === undefined || recOf(m)?.seq === basis.seq);
  return basis.seq !== undefined && chain.some((c) => recOf(c)?.seq === basis.seq);
}

/** The newest reply of `chain` that holds a record, with the record; null where none does. */
function headRecord(chain: readonly ChainMessage[], core: LedgerCore): { messageId: MessageId; swipeId: number; rec: Rec } | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    const rec = m && !m.isUser ? activeRecord(m, core.journal.tombstones) : null;
    if (m && rec) return { messageId: m.id, swipeId: m.swipeId, rec };
  }
  return null;
}

/** The point of `chain` a draft is written against: its newest reply that holds a record (with the record's number), else its newest message. */
function basisIn(chain: readonly ChainMessage[], core: LedgerCore): DraftBasis | null {
  const head = headRecord(chain, core);
  if (head) return { messageId: head.messageId, swipeId: head.swipeId, seq: head.rec.seq };
  const last = chain.at(-1);
  return last ? { messageId: last.id, swipeId: last.swipeId } : null;
}

/** The chat's ledger and its messages as they stand, read without the ledger's queue; null for a chat that plays no world. */
async function chatNow(rt: StoryRuntime, chatId: ChatId, userId: UserId): Promise<{ core: LedgerCore; observed: ChainMessage[] } | null> {
  const run = await rt.runOf(chatId, userId);
  const core = run ? await rt.ledger.core(chatId, userId) : null;
  return core ? { core, observed: toChain(await rt.host.chats.messages(chatId, userId)) } : null;
}

/**
 * The story record for a call of harness turn `turn`'s own run (its generation's id): read along
 * the path the turn plays on, what it staged on top; written by staging with the turn.
 */
export function turnStoryPort(rt: StoryRuntime, at: { chatId: ChatId; userId: UserId; turn: string }): StoryPort {
  return {
    turn: at.turn,
    staged: true,
    async read() {
      const now = await chatNow(rt, at.chatId, at.userId);
      if (!now) return null;
      const { core, observed } = now;
      const chain = core.chain(observed);
      const p = core.journal.pending[at.turn];
      // The path the turn plays on: what comes before the reply it writes, so a reply it tells anew (a swipe, a Regenerate) is none of it; a Continue's takes in the reply it continues.
      const target = p && p.kind !== "continue" ? p.messageId : null;
      const cut = target === null ? -1 : chain.findIndex((m) => m.id === target);
      const through = cut < 0 ? chain : chain.slice(0, cut);
      const records = storyRecords(core, through);
      const staged = rt.ledger.stagedStory(at.turn);
      const continued = p?.kind === "continue" ? records.find((r) => r.messageId === p.continueHead) : undefined;
      return {
        path: walkStory(records, staged),
        own: withStory(continued?.story ?? {}, staged ?? {}),
        basis: basisIn(through, core),
        onPath: (basis) => basisOnPath(chain, core, basis),
      };
    },
    async write(change) {
      return rt.ledger.stageStory(at.chatId, at.turn, change) ? { kept: true } : { refused: "closed" };
    },
  };
}

/**
 * The story record for a call of a job's run, tied to the record of harness turn `turn` (the job's
 * basis): read along the chat's path as it stands; written at once on that record while it is on
 * the path. `committed`: the engine saw the turn write its record, so one it no longer finds has
 * left the path, where one it never saw is unknown.
 */
export function jobStoryPort(rt: StoryRuntime, at: { chatId: ChatId; userId: UserId; turn: string; committed: boolean }): StoryPort {
  return {
    turn: at.turn,
    staged: false,
    async read() {
      const now = await chatNow(rt, at.chatId, at.userId);
      if (!now) return null;
      const { core, observed } = now;
      const chain = core.chain(observed);
      const record = turnRecord(core, observed, at.turn);
      return {
        path: walkStory(storyRecords(core, chain)),
        own: typeof record === "string" ? withStory({}, {}) : recStoryOf(record.rec),
        basis: typeof record === "string" ? null : { messageId: record.messageId, swipeId: record.swipeId, seq: record.rec.seq },
        onPath: (basis) => basisOnPath(chain, core, basis),
      };
    },
    write: (change) => keepStory(rt.ledger, at, change),
  };
}

/** The replies of `chain` that no turn under way is writing, in the chain's order: each with where it stands in the chain and the record its shown swipe holds (null: none yet, or one discarded). */
function repliesOf(chain: readonly ChainMessage[], core: LedgerCore): { index: number; messageId: MessageId; swipeId: number; rec: Rec | null }[] {
  const writing = new Set(Object.values(core.journal.pending).map((p) => p.messageId));
  return chain.flatMap((m, index) => (m.isUser || writing.has(m.id) ? [] : [{ index, messageId: m.id, swipeId: m.swipeId, rec: activeRecord(m, core.journal.tombstones) }]));
}

/** The newest (`last`) or the first reply of `chain` that no turn under way is writing, with its record (`repliesOf`); null where the chain has no such reply. */
function replyOf(chain: readonly ChainMessage[], core: LedgerCore, which: "first" | "last"): { messageId: MessageId; swipeId: number; rec: Rec | null } | null {
  const replies = repliesOf(chain, core);
  return (which === "last" ? replies.at(-1) : replies[0]) ?? null;
}

/**
 * The story record for a call of a run no turn's record is tied to: read along the chat's path as it
 * stands; each change written at once on one reply of the path as it is when the write lands (one a
 * turn under way is writing aside), which is given a bare record where its shown swipe holds none
 * (`LedgerCore.recordStory`); refused (`no_basis`) on a chat with no reply. Which reply: the chat's
 * first (`first`), for the story's prepared start, whose past beats, castings and marks of what each
 * mind took in must stay on every path through the chat, whatever is swiped or regenerated later; the
 * newest (`last`), for any other job the player started. `turn`: the id the run's beats are written
 * under (`Beat.turn`).
 */
export function chatStoryPort(rt: StoryRuntime, at: { chatId: ChatId; userId: UserId; turn: string; on: "first" | "last" }): StoryPort {
  return {
    turn: at.turn,
    staged: false,
    async read() {
      const now = await chatNow(rt, at.chatId, at.userId);
      if (!now) return null;
      const { core, observed } = now;
      const chain = core.chain(observed);
      return {
        path: walkStory(storyRecords(core, chain)),
        own: recStoryOf(replyOf(chain, core, at.on)?.rec),
        basis: basisIn(chain, core),
        onPath: (basis) => basisOnPath(chain, core, basis),
      };
    },
    async write(change) {
      const out = { found: false };
      const refused = await rt.ledger.recordStory(at.chatId, at.userId, (core, observed) => {
        const reply = replyOf(core.chain(observed), core, at.on);
        if (!reply) return null;
        out.found = true;
        return { messageId: reply.messageId, swipeId: reply.swipeId, story: withStory(recStoryOf(reply.rec), change) };
      });
      if (!out.found) return { refused: "no_basis" };
      return refused === null ? { kept: true } : { refused: "off_path" };
    },
  };
}

/**
 * A casting the player sets from their page: `make` answers, from someone's casting as it stands on
 * the path through a reply, what that reply's record keeps of them (null: nothing there). Written on
 * the newest reply and on the reply before it, where a regenerate or a new swipe of the newest starts
 * from, so the player's word stands either way; each from the path through its own reply, so the
 * earlier copy keeps the mark of what a mind took in that stood there, never one past it. A chat with
 * one reply keeps it on that one; one with none refuses it (`no_basis`). Both are written in one step
 * of the chat's queue.
 */
export async function castOnReplies(rt: StoryRuntime, at: { chatId: ChatId; userId: UserId }, entity: string, make: (held: Cast | null) => Cast | null): Promise<StoryWritten> {
  const out = { found: false };
  const refused = await rt.ledger.recordStory(at.chatId, at.userId, (core, observed) => {
    const chain = core.chain(observed);
    const replies = repliesOf(chain, core).slice(-2);
    if (replies.length === 0) return null;
    out.found = true;
    return replies.flatMap((reply) => {
      const entry = make(castOn(walkStory(storyRecords(core, chain.slice(0, reply.index + 1))), entity));
      return entry ? [{ messageId: reply.messageId, swipeId: reply.swipeId, story: withStory(recStoryOf(reply.rec), { cast: [entry] }) }] : [];
    });
  });
  if (!out.found) return { refused: "no_basis" };
  return refused === null ? { kept: true } : { refused: "off_path" };
}

/**
 * Writes `change` on the record of harness turn `turn`, after what its story part holds, in the
 * chat's queue: only the record's story part is written, outside every hash but the tombstone's, so
 * nothing of the world moves and no path changes. As for every write tied to a turn's record
 * (`turnRecord`), only while that record is on the chat's path.
 */
export async function keepStory(ledger: Pick<LedgerService, "recordStory">, at: { chatId: ChatId; userId: UserId; turn: string; committed: boolean }, change: RecStory): Promise<StoryWritten> {
  const out: { why: StoryRefusal | null } = { why: null };
  const refused = await ledger.recordStory(at.chatId, at.userId, (core, observed) => {
    const found = turnRecord(core, observed, at.turn);
    if (typeof found === "string") {
      out.why = found === "unknown" && !at.committed ? "no_basis" : "off_path";
      return null;
    }
    return { messageId: found.messageId, swipeId: found.swipeId, story: withStory(recStoryOf(found.rec), change) };
  });
  if (out.why !== null) return { refused: out.why };
  // The write itself was refused as it reached the record (it was discarded meanwhile): the record takes no more.
  return refused === null ? { kept: true } : { refused: "off_path" };
}
