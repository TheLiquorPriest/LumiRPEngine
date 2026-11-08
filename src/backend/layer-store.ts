// One chat's basis-anchored layer in userStorage (DEPTH-PLAN §4.9): `runs/<chatId>/layer/`.
//   meta.json      { v, seq, segments, inherit?, pending? }: the landing sequence, the segment count,
//                  and, for a branch, what it took of its ancestor's when it was made (`LayerInherit`),
//                  or that its ancestor couldn't be read yet, so it takes it at its next open
//   seg-<n>.json   landed entries in landing order: a branch's inherited ones (copied in at its first
//                  open, each as its ancestor landed it, renamed for it) and its own; only the last
//                  segment is ever rewritten, and an entry is never changed once written
//   held.json      drafts held while a turn is in flight (P2), each with the windows it waits for
// Every entry is kept in memory while the chat is open: the fold reads them all. A branch never reads
// its ancestor again once it holds what it inherits, so its layer outlives its ancestor's chat, and
// its own files keep the blobs those entries name.

import type { ChatId, GenerationId, MessageId, UserId } from "../shared/ids";
import { isRecord } from "../shared/json";
import type { FoldLayerEntry, LayerDraft, LayerEntry, LayerInherit, LayerSummary } from "../shared/layer";
import { LEDGER_NAMESPACE } from "../shared/ledger";
import type { ChainMessage } from "../engine/ledger/chain";
import { foldLayerOf, inheritedBy, inheritedFirst, swipeKeyOf } from "../engine/ledger/layer";
import type { HostMessage, HostPort } from "./host";
import { carriedMap, carryIn, copyMap, putCarriedTexts } from "./layer-carry";

/** A segment is closed past this many entries or characters, so a landing rewrites a bounded file. */
export const LAYER_SEGMENT_ENTRIES = 64;
export const LAYER_SEGMENT_CHARS = 128 * 1024;

export function layerDir(chatId: ChatId): string {
  return `runs/${chatId}/layer`;
}

interface LayerMeta {
  v: 2;
  seq: number;
  segments: number;
  /** A branch: the terms it inherits on (`LayerInherit`), what they take copied into its own segments. */
  inherit?: LayerInherit;
  /** A branch that hasn't taken what it inherits yet (its ancestor couldn't be read, or an earlier build's terms): its next open does. */
  pending?: true;
}

export interface HeldDraft {
  draft: LayerDraft;
  waitFor: GenerationId[];
  /** Entries its check folds as superseded on both sides (`LedgerCore.layerVerdict`): a redo's that it has yet to replace. */
  without?: string[];
}

/**
 * What a branch inherits of its ancestor, as `ancestorOf` answers: the terms and every entry its
 * ancestor folds; "none" when it inherits nothing (it isn't a branch of a chat of the same run, or
 * nothing was landed there by the time it was made); null when that couldn't be read now.
 */
export type Ancestry = { inherit: LayerInherit; entries: LayerEntry[] } | "none" | null;

function entryOf(raw: unknown): LayerEntry | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.chat !== "string" || typeof raw.kind !== "string" || !Array.isArray(raw.events)) return null;
  const b = raw.basis;
  if (!isRecord(b) || typeof b.message !== "string" || typeof b.swipe !== "string" || typeof b.parentPath !== "string") return null;
  const landed = raw.landed;
  if (!isRecord(landed) || typeof landed.seq !== "number" || typeof landed.at !== "string") return null;
  // Validated above: the shape is the stored entry's.
  const entry: LayerEntry = raw as unknown as LayerEntry;
  return entry;
}

function parseJson(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** Terms as stored, or undefined when they aren't well formed. */
function termsOf(raw: unknown): LayerInherit | undefined {
  if (!isRecord(raw) || typeof raw.from !== "string" || typeof raw.before !== "string" || !isRecord(raw.messages) || !Object.values(raw.messages).every((m) => typeof m === "string")) return undefined;
  return { from: raw.from, before: raw.before, messages: raw.messages as Record<MessageId, MessageId> };
}

/**
 * The stored meta, or null when there is none. An earlier build (v1) read a branch's inheritance
 * from its ancestor at every open, under terms fixed at its first open: those terms stand, and what
 * they take is still to be copied in.
 */
function metaOf(raw: unknown): LayerMeta | null {
  if (!isRecord(raw) || (raw.v !== 1 && raw.v !== 2) || typeof raw.seq !== "number" || typeof raw.segments !== "number") return null;
  const meta: LayerMeta = { v: 2, seq: raw.seq, segments: raw.segments };
  const terms = termsOf(raw.inherit);
  if (terms) meta.inherit = terms;
  if (raw.pending === true || (raw.v === 1 && terms)) meta.pending = true;
  return meta;
}

export class LayerStore {
  private readonly byId = new Map<string, LayerEntry>();
  /** The entries stored, in landing order: a branch's inherited ones and its own. */
  private readonly entries: LayerEntry[] = [];
  /** What the folds read: the entries it inherited (renamed for it), then its own (`foldLayerOf`). */
  fold: FoldLayerEntry[] = [];
  /** What a read-only open (an ancestor read for its branch) inherits itself, kept in memory only. */
  private inherited: LayerEntry[] = [];
  held: HeldDraft[] = [];
  /** The JSON characters held, for the open-chats budget. */
  chars = 0;
  /** The last segment as stored, and its characters: a landing rewrites only it, until it closes. */
  private last: LayerEntry[] = [];
  private lastChars = 0;

  private constructor(
    private readonly host: HostPort,
    readonly chatId: ChatId,
    readonly userId: UserId,
    private meta: LayerMeta,
    /** Whether meta.json is stored: a chat that has landed nothing and inherited nothing writes none. */
    private stored: boolean,
  ) {}

  /**
   * Opens the chat's layer. `ancestor` says what a branch inherits; it is asked while the chat
   * hasn't taken that yet (its first open, or one its ancestor couldn't be read at), and what it
   * answers is copied into the chat's own layer, so it is never asked again. Read-only (an ancestor
   * read for its branch), nothing is written: what it inherits itself is kept in memory.
   */
  static async open(host: HostPort, chatId: ChatId, userId: UserId, ancestor?: () => Promise<Ancestry>, opts: { readOnly?: boolean } = {}): Promise<LayerStore> {
    const dir = layerDir(chatId);
    const found = metaOf(parseJson(await host.storage.read(`${dir}/meta.json`, userId)));
    const store = new LayerStore(host, chatId, userId, found ?? { v: 2, seq: 0, segments: 0 }, found !== null);
    for (let n = 0; n < store.meta.segments; n++) {
      const text = await host.storage.read(`${dir}/seg-${n}.json`, userId);
      const list = parseJson(text);
      if (!Array.isArray(list)) continue;
      store.chars += text?.length ?? 0;
      const kept: LayerEntry[] = [];
      for (const x of list) {
        const e = entryOf(x);
        if (!e) continue;
        kept.push(e);
        if (store.byId.has(e.id)) continue;
        store.byId.set(e.id, e);
        store.entries.push(e);
      }
      if (n === store.meta.segments - 1) {
        store.last = kept;
        store.lastChars = text?.length ?? 0;
      }
    }
    const heldRaw = parseJson(await host.storage.read(`${dir}/held.json`, userId));
    if (Array.isArray(heldRaw)) store.held = heldRaw.flatMap((h): HeldDraft[] => (isRecord(h) && isRecord(h.draft) && isStrings(h.waitFor) ? [{ draft: h.draft as unknown as LayerDraft, waitFor: h.waitFor, ...(isStrings(h.without) && h.without.length > 0 ? { without: h.without } : {}) }] : []));
    if (ancestor && (found === null || found.pending === true)) await store.take(await ancestor().catch(() => null), opts.readOnly === true);
    store.refold();
    return store;
  }

  /**
   * Takes what the chat inherits (`ancestry`), on the terms it stored when it has them, else on those
   * it answers: each entry the terms take, under a message they map, copied in as its ancestor landed
   * it, renamed for this chat, and the terms kept. One that couldn't be read leaves the chat to ask
   * again at its next open.
   */
  private async take(ancestry: Ancestry, readOnly: boolean): Promise<void> {
    if (ancestry === null) {
      if (readOnly || this.meta.pending) return;
      this.meta.pending = true;
      if (this.stored) await this.writeMeta();
      return;
    }
    const terms = ancestry === "none" ? undefined : (this.meta.inherit ?? ancestry.inherit);
    const copies: LayerEntry[] = [];
    if (terms && ancestry !== "none") {
      const taken = new Set(this.byId.keys());
      for (const e of ancestry.entries) {
        const message = terms.messages[e.basis.message];
        if (message === undefined || taken.has(e.id) || !inheritedBy(terms, e)) continue;
        taken.add(e.id);
        copies.push({ ...e, basis: { ...e.basis, message } });
      }
    }
    if (readOnly) {
      this.inherited = copies;
      return;
    }
    const was = this.meta.pending === true;
    delete this.meta.pending;
    if (terms) this.meta.inherit = terms;
    if (copies.length > 0) await this.store(copies);
    else if (this.stored || was || terms) await this.writeMeta();
  }

  get(id: string): LayerEntry | undefined {
    return this.byId.get(id) ?? this.inherited.find((e) => e.id === id);
  }

  /** The chat's own entries without their events (for resuming and listing); with `inherited`, every entry it folds (`foldEntries`): those it inherited first, in its own message ids. */
  summaries(o: { inherited?: boolean } = {}): LayerSummary[] {
    return (o.inherited ? this.foldEntries() : this.entries.filter((e) => e.chat === this.chatId)).map(({ events, ...rest }) => ({ ...rest, events: events.length }));
  }

  /** Every entry this chat folds as `LayerEntry`s in its own message ids, those it inherited first: what a branch of it inherits. */
  foldEntries(): LayerEntry[] {
    return inheritedFirst(this.chatId, this.inherited.length > 0 ? [...this.inherited, ...this.entries] : this.entries);
  }

  private refold(): void {
    this.fold = foldLayerOf(this.chatId, this.inherited.length > 0 ? [...this.inherited, ...this.entries] : this.entries);
  }

  /** Lands `drafts` (already checked) in order, writing the segments and the meta once. The entries landed. */
  async append(drafts: readonly LayerDraft[]): Promise<LayerEntry[]> {
    if (drafts.length === 0) return [];
    const at = new Date().toISOString();
    const made = drafts.map((d): LayerEntry => ({ id: d.id, chat: this.chatId, basis: d.basis, kind: d.kind, events: d.events, ...(d.supersedes ? { supersedes: d.supersedes } : {}), ...(d.reasoning ? { reasoning: d.reasoning } : {}), ...(d.by ? { by: d.by } : {}), landed: { seq: ++this.meta.seq, at } }));
    await this.store(made);
    return made;
  }

  /** Writes `entries` after those stored, then the meta, and keeps them. */
  private async store(entries: readonly LayerEntry[]): Promise<void> {
    const dir = layerDir(this.chatId);
    let segment = [...this.last];
    let segments = Math.max(1, this.meta.segments);
    let chars = this.lastChars;
    const writes: { n: number; list: LayerEntry[] }[] = [];
    for (const entry of entries) {
      const size = JSON.stringify(entry).length;
      if (segment.length >= LAYER_SEGMENT_ENTRIES || (segment.length > 0 && chars + size > LAYER_SEGMENT_CHARS)) {
        writes.push({ n: segments - 1, list: segment });
        segment = [];
        chars = 0;
        segments++;
      }
      segment.push(entry);
      chars += size;
    }
    writes.push({ n: segments - 1, list: segment });
    for (const w of writes) {
      const text = JSON.stringify(w.list);
      await this.host.storage.write(`${dir}/seg-${w.n}.json.tmp`, text, this.userId);
      await this.host.storage.move(`${dir}/seg-${w.n}.json.tmp`, `${dir}/seg-${w.n}.json`, this.userId);
      if (w.n === segments - 1) this.lastChars = text.length;
    }
    this.last = segment;
    this.meta.segments = segments;
    await this.writeMeta();
    for (const e of entries) {
      this.byId.set(e.id, e);
      this.entries.push(e);
      this.chars += JSON.stringify(e).length;
    }
    this.refold();
  }

  async hold(draft: LayerDraft, waitFor: GenerationId[], without: readonly string[] = []): Promise<void> {
    this.held = [...this.held.filter((h) => h.draft.id !== draft.id), { draft, waitFor, ...(without.length > 0 ? { without: [...without] } : {}) }];
    await this.writeHeld();
  }

  /** Takes the held drafts whose windows have all closed (`open` says which are still open). */
  async release(open: ReadonlySet<GenerationId>): Promise<HeldDraft[]> {
    const ready = this.held.filter((h) => h.waitFor.every((w) => !open.has(w)));
    if (ready.length === 0) return [];
    this.held = this.held.filter((h) => !ready.includes(h));
    await this.writeHeld();
    return ready;
  }

  /** Takes the held drafts `which` picks, whatever windows they wait for: a turn adopting the work it waited for (DEPTH-PLAN §6.3). */
  async adoptHeld(which: (h: HeldDraft) => boolean): Promise<HeldDraft[]> {
    const taken = this.held.filter(which);
    if (taken.length === 0) return [];
    this.held = this.held.filter((h) => !taken.includes(h));
    await this.writeHeld();
    return taken;
  }

  private async writeHeld(): Promise<void> {
    const dir = layerDir(this.chatId);
    if (this.held.length === 0) {
      await this.host.storage.remove(`${dir}/held.json`, this.userId).catch(() => undefined);
      return;
    }
    await this.host.storage.write(`${dir}/held.json.tmp`, JSON.stringify(this.held), this.userId);
    await this.host.storage.move(`${dir}/held.json.tmp`, `${dir}/held.json`, this.userId);
  }

  private async writeMeta(): Promise<void> {
    const dir = layerDir(this.chatId);
    await this.host.storage.write(`${dir}/meta.json.tmp`, JSON.stringify(this.meta), this.userId);
    await this.host.storage.move(`${dir}/meta.json.tmp`, `${dir}/meta.json`, this.userId);
    this.stored = true;
  }
}

/**
 * What a branch inherits of its ancestor's layer (DEPTH-PLAN §4.9), on the terms of when it was made:
 * when the chat was branched (`branched_from`, `branch_at_message`, which core writes) from a chat of
 * the same run, the ancestor's entries as it folds them (what it inherited itself included), of which
 * the branch takes those landed by the end of the second the host made it in (`inheritedBy`), each
 * under its message's copy (`inheritMap`, on both chats' messages as `chainOf` decodes them). A chat
 * that wasn't branched but holds a layer carried in its metadata from another chat of the run (an
 * imported copy, `LAYER_CARRY_KEY`) takes the entries carried, each under the copy of its message,
 * their texts put in the user's store first.
 * `opened`: the ancestor's layer, when its chat is open here. A read that fails answers null.
 */
export async function ancestorOf(host: HostPort, chatId: ChatId, userId: UserId, runSeed: string, opened: (chatId: ChatId) => LayerStore | undefined, chainOf: (messages: readonly HostMessage[]) => ChainMessage[], depth = 0): Promise<Ancestry> {
  if (depth > 4) return "none";
  try {
    const meta = await host.chats.chatMetadata(chatId, userId);
    const from = meta.branched_from;
    const at = meta.branch_at_message;
    if (typeof from !== "string" || typeof at !== "string" || from === chatId) return await carriedAncestry(host, userId, meta, chatId, runSeed, async () => chainOf(await host.chats.messages(chatId, userId)));
    const fromRun = (await host.chats.chatMetadata(from, userId))[LEDGER_NAMESPACE];
    if (!isRecord(fromRun) || fromRun.runSeed !== runSeed) return "none";
    const store = opened(from) ?? (await LayerStore.open(host, from, userId, () => ancestorOf(host, from, userId, runSeed, opened, chainOf, depth + 1), { readOnly: true }));
    const entries = store.foldEntries();
    if (entries.length === 0) return "none";
    const made = await host.chats.created(chatId, userId);
    if (made === null) return null;
    const messages = inheritMap(chainOf(await host.chats.messages(from, userId)), at, chainOf(await host.chats.messages(chatId, userId)));
    return messages ? { inherit: { from, before: new Date((made + 1) * 1000 - 1).toISOString(), messages }, entries } : "none";
  } catch {
    return null;
  }
}

/** What an imported copy takes of the layer carried in its metadata: every entry carried, under the copy of its message, the texts they name put in the user's store first (an import into another account has none of them); "none" when it carries none of another chat of this run. */
async function carriedAncestry(host: Pick<HostPort, "storage">, userId: UserId, meta: Readonly<Record<string, unknown>>, chatId: ChatId, runSeed: string, chain: () => Promise<ChainMessage[]>): Promise<Ancestry> {
  const carry = carryIn(meta);
  if (!carry || carry.chat === chatId || carry.runSeed !== runSeed || carry.list.length === 0) return "none";
  await putCarriedTexts(host, userId, carry);
  return { inherit: { from: carry.chat, before: carry.at, messages: carriedMap(carry, await chain()) }, entries: carry.list };
}

/**
 * Which of a branch's messages is the copy of each of its ancestor's (DEPTH-PLAN §4.9). Core copies
 * every message up to the branch point under a new id, its swipes and metadata with it, so a copy
 * shows the identity each swipe of its original showed (`swipeKeyOf`: the seq of the record it holds,
 * else the text it was made from). Messages are matched by those identities, the ancestor's up to the
 * branch point and the branch's in their order, as many as can be (their longest common run, the
 * earlier copy where two would do), never by place: core numbers every later message up from one
 * either chat inserted since (`index_in_chat`), and one either deleted leaves a gap. One that shares
 * no identity with a copy (inserted since, or edited past each) maps onto none: nothing made from it
 * could fold on a copy that doesn't show it. Null when the ancestor has deleted the branch point.
 */
export function inheritMap(ancestor: readonly ChainMessage[], branchAt: MessageId, branch: readonly ChainMessage[]): Record<MessageId, MessageId> | null {
  const point = ancestor.findIndex((m) => m.id === branchAt);
  if (point < 0) return null;
  // Each message's identities, swipe by swipe; no tombstone counts, a copy holding the records its original held when it was copied.
  const [mine, theirs] = [ancestor.slice(0, point + 1), branch].map((list) => list.map((m) => ({ id: m.id, user: m.isUser, keys: new Set(m.swipes.map((_, s) => swipeKeyOf({ ...m, swipeId: s }, []))) })));
  return copyMap(mine, theirs);
}
