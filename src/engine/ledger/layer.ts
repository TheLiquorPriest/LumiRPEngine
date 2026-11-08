// The basis-anchored layer in the fold (DEPTH-PLAN §4.9): which entries are live on a chain, and how
// one folds. An entry is live where its basis message is on the chain showing the swipe it was made
// from (`swipeKeyOf`); a live entry's `supersedes` stops the entries it names. A live entry folds
// right after its basis message's record, in landing order: as made (its events re-validated, a
// failure a violation) where the chain up to that message is the one it read, else as a rebased view
// (a unit that no longer fits drops, with a line in `FoldOutput.layerDrops`). Entries move no path.
// The reference fold re-implements liveness itself (L1).

import { hashJson, hashParts } from "../../shared/hash";
import type { ChatId, MessageId } from "../../shared/ids";
import { foldEntryOf, type Basis, type FoldLayerEntry, type LayerEntry, type LayerInherit, type SwipeKey } from "../../shared/layer";
import type { LedgerEvent, PathHash, Tombstone } from "../../shared/ledger";
import { ROOT_PATH } from "../../shared/ledger";
import type { WorldDoc } from "../../shared/world";
import { applyEvent, eventUnits, validateEvent } from "../events";
import type { WorldState } from "../state";
import { FoldError, type ChainMessage, type LayerDrop } from "./chain";
import { activeRecord, activeText, contentId, nextPath, turnPath } from "./path";
import type { FoldTypes } from "./reference";

/**
 * The identity of the swipe `m` shows (`SwipeKey`): its turn record's seq, else the text it was made
 * with: a bare record carries that across an edit, a reply's (an assistant edit leaves it as it was)
 * and a player's message's that layer entries were made from (`LedgerCore.keepIdentity`); else its
 * text's hash.
 */
export function swipeKeyOf(m: ChainMessage, tombstones: readonly Tombstone[]): SwipeKey {
  const rec = activeRecord(m, tombstones);
  if (rec) return turnPath(rec) !== null ? `r${rec.seq}` : `c${rec.swipeHash.hash}`;
  return `c${contentId(activeText(m)).hash}`;
}

/** Every message's basis on `chain`, in chain order: what a job reading through that message records. */
export function chainBases(chain: readonly ChainMessage[], tombstones: readonly Tombstone[]): Basis[] {
  const out: Basis[] = [];
  let parent: PathHash = ROOT_PATH;
  for (const m of chain) {
    out.push({ message: m.id, swipe: swipeKeyOf(m, tombstones), parentPath: parent });
    parent = nextPath(m, parent, tombstones);
  }
  return out;
}

/** The basis of the message at `index` on `chain`, or null past its end. */
export function basisAt(chain: readonly ChainMessage[], tombstones: readonly Tombstone[], index: number): Basis | null {
  if (index < 0 || index >= chain.length) return null;
  let parent: PathHash = ROOT_PATH;
  for (let i = 0; i < index; i++) parent = nextPath(chain[i] as ChainMessage, parent, tombstones);
  const m = chain[index] as ChainMessage;
  return { message: m.id, swipe: swipeKeyOf(m, tombstones), parentPath: parent };
}

/** Where `basis` sits on `chain`: its index, or -1 when its message isn't there or shows another swipe. */
export function basisIndex(chain: readonly ChainMessage[], tombstones: readonly Tombstone[], basis: Pick<Basis, "message" | "swipe">): number {
  const index = chain.findIndex((m) => m.id === basis.message);
  if (index < 0) return -1;
  return swipeKeyOf(chain[index] as ChainMessage, tombstones) === basis.swipe ? index : -1;
}

/** A deterministic entry id from what makes a job's result unique (its kind, its subject, its basis): `l` and 31 hex digits. */
export function layerEntryId(...parts: string[]): string {
  return `l${hashParts("lre.layer", ...parts).slice(1)}`;
}

/**
 * Whether an entry takes part in the world-state folds: one whose events are all neutral
 * (`EventTypeDef.neutral`: beats, staging, strikes, the author's records) and which supersedes
 * nothing changes no state, so it is left out of them (`LedgerCore.foldInput`) and landing the
 * bootstrap's beats never re-folds the chain after them. The narrative record reads every entry
 * (`storyOn`).
 */
export function foldsState(e: FoldLayerEntry, types: Pick<FoldTypes, "get">): boolean {
  return (e.supersedes?.length ?? 0) > 0 || e.events.some((ev) => types.get(ev.type)?.neutral !== true);
}

/** The live entries of `entries` on `chain`, by the message they fold after, each list in landing order; superseded ones left out. */
export interface LiveLayer {
  at: Map<MessageId, FoldLayerEntry[]>;
  /** Ids a live entry supersedes. */
  superseded: Set<string>;
}

export const NO_LAYER: LiveLayer = { at: new Map(), superseded: new Set() };

export function liveLayer(chain: readonly ChainMessage[], tombstones: readonly Tombstone[], entries: readonly FoldLayerEntry[] | undefined): LiveLayer {
  if (!entries || entries.length === 0) return NO_LAYER;
  const byId = new Map(chain.map((m) => [m.id, m]));
  const keys = new Map<MessageId, SwipeKey>();
  const keyOf = (id: MessageId): SwipeKey | undefined => {
    const known = keys.get(id);
    if (known !== undefined) return known;
    const m = byId.get(id);
    if (!m) return undefined;
    const key = swipeKeyOf(m, tombstones);
    keys.set(id, key);
    return key;
  };
  const live = entries.filter((e) => keyOf(e.basis.message) === e.basis.swipe);
  const superseded = new Set(live.flatMap((e) => e.supersedes ?? []));
  const at = new Map<MessageId, FoldLayerEntry[]>();
  for (const e of live) {
    if (superseded.has(e.id)) continue;
    const list = at.get(e.basis.message);
    if (list) list.push(e);
    else at.set(e.basis.message, [e]);
  }
  return { at, superseded };
}

/** Whether a branch made on `inherit`'s terms takes `e`, one of the entries its ancestor folds: one landed by the time the branch was made (what its ancestor inherited itself all was). */
export function inheritedBy(inherit: Pick<LayerInherit, "before">, e: Pick<LayerEntry, "landed">): boolean {
  return Date.parse(e.landed.at) <= Date.parse(inherit.before);
}

/** `entries` in the order a chat folds them: those it inherited (landed in another chat, copied in renamed for it) first, then its own, each in landing order. */
export function inheritedFirst<E extends Pick<LayerEntry, "chat">>(chatId: ChatId, entries: readonly E[]): E[] {
  return [...entries.filter((e) => e.chat !== chatId), ...entries.filter((e) => e.chat === chatId)];
}

/** The entries a chat folds, as its folds read them (`inheritedFirst`). */
export function foldLayerOf(chatId: ChatId, entries: readonly LayerEntry[]): FoldLayerEntry[] {
  return inheritedFirst(chatId, entries).map(foldEntryOf);
}

/**
 * The entries folding after one message as a step key and a fold shape take them: each one's id, the
 * parent path it was made on (which, with the key before, says whether it folds as a view) and a
 * digest of its events. An id alone can name what never landed: a check folds an entry before it
 * lands, and a refused one's id may come again with other events (a settlement's and a drop's name
 * their draft and basis, never what they decide), so its steps and snapshots never stand in for the
 * entry that does land.
 */
export function layerKey(entries: readonly FoldLayerEntry[]): string {
  return entries.map((e) => `${e.id}:${e.basis.parentPath}:${eventsDigest(e.events)}`).join(",");
}

/** Each entry's events' digest, kept beside them: an entry is never changed once written, so its events are hashed once. */
const DIGESTS = new WeakMap<readonly LedgerEvent[], string>();

function eventsDigest(events: readonly LedgerEvent[]): string {
  const known = DIGESTS.get(events);
  if (known !== undefined) return known;
  const digest = hashJson(events);
  DIGESTS.set(events, digest);
  return digest;
}

/**
 * Folds `entries` after message `messageId` (whose parent path is `parent`) into `state`: each as
 * made where it read this chain, else as a rebased view. Its drops and violations go to the lists.
 */
export function foldLayerEntries(
  types: FoldTypes,
  worlds: (revision: string) => WorldDoc | undefined,
  state: WorldState,
  messageId: MessageId,
  parent: PathHash,
  entries: readonly FoldLayerEntry[],
  drops: LayerDrop[],
  violations: string[],
): void {
  const ctx = () => {
    const world = worlds(state.revision);
    if (!world) throw new FoldError(`unknown revision ${state.revision}`);
    return types.context(world, state);
  };
  for (const entry of entries) {
    const view = entry.basis.parentPath !== parent;
    for (const [from, to] of eventUnits(entry.events)) {
      const unit = entry.events.slice(from, to);
      if (!view) {
        unit.forEach((ev, k) => {
          const failure = validateEvent(types, ev, ctx());
          if (failure) violations.push(`${messageId}: layer entry ${entry.id} event ${from + k} ${ev.type} failed re-validation (${failure.reason})`);
          else applyEvent(types, ev, state, ctx());
        });
        continue;
      }
      const failure = unit.length === 1 ? validateEvent(types, unit[0] as LedgerEvent, ctx()) : trial(types, worlds, state, unit);
      if (failure) {
        for (let k = from; k < to; k++) drops.push({ messageId, entry: entry.id, index: k, text: failure.reason });
        continue;
      }
      for (const ev of unit) applyEvent(types, ev, state, ctx());
    }
  }
}

/** Whether `unit` fits `state` whole, tried on a copy: its first rejection, or null. */
function trial(types: FoldTypes, worlds: (revision: string) => WorldDoc | undefined, state: WorldState, unit: readonly LedgerEvent[]): { reason: string } | null {
  const scratch = structuredClone(state);
  for (const ev of unit) {
    const world = worlds(scratch.revision);
    if (!world) throw new FoldError(`unknown revision ${scratch.revision}`);
    const c = types.context(world, scratch);
    const rejection = validateEvent(types, ev, c);
    if (rejection) return rejection;
    applyEvent(types, ev, scratch, c);
  }
  return null;
}
