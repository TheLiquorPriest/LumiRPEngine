// What the GM view's reads share (DESIGN §7, §9.6; Settings → Speed → Reuse built views): one
// render of a chat's head per ledger core, the state as the fold keeps it (never copied: nothing
// that builds a part changes it), and each part built from it once, kept under the head's key. So the
// parts a page asks for one by one fold once between them, and a part asked for again at the same
// head is sent as it was built. Builds are synchronous and run after every await of a request, so
// requests arriving together for one head build each part once between them. A request that names
// the key it holds (`since`) while the head is unchanged builds nothing at all. With Reuse built
// views off, each request folds and copies the state and builds its part, as before.

import { hashJson, hashParts } from "../shared/hash";
import type { GmPartReply, QueuedOn } from "../shared/gm-parts";
import type { MindsSettings } from "../shared/minds";
import type { WorldDoc } from "../shared/world";
import type { ChainMessage } from "../engine/ledger/chain";
import type { FoldKeys } from "../engine/ledger/fold";
import type { LedgerCore } from "../engine/ledger/journal";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { buildGmPart, gmPartProblem, type GmPartAsk } from "./gm";

/**
 * What the GM page shows changes only with this (`StateView.gmKey`): the state as the GM view reads
 * it (`renderKey`, a planned turn's included), the chain as the edits read it (its last step's key:
 * every message, its swipe, its record and markers), the refused writes and the held ones. A status
 * flip, or a message sent that changes none of them, leaves it as it was. `keys` are the fold's of
 * `observed`, when the caller has them.
 */
export function gmKeyOf(core: LedgerCore, observed: readonly ChainMessage[], keys: FoldKeys = core.foldKeys(observed)): string {
  return hashParts("lre.gm", core.renderKey(observed, keys), keys.steps.at(-1) ?? keys.root, hashJson(core.journal.refused ?? []), core.journal.held.map((h) => h.write.id).join("\u0000"));
}

/** An answer's key: the head's (`gmKeyOf`), with the user's minds settings and what a held write waits on, which the minds and the held writes read too. */
export function gmAnswerKey(gmKey: string, minds: MindsSettings, waitsOn: QueuedOn | null): string {
  return hashParts("lre.gm.answer", gmKey, hashJson(minds), waitsOn ?? "");
}

/** One head as kept: its key, its render once made (null: the chat's world isn't loaded), and the parts built from it, by request. */
interface Head {
  key: string;
  render?: { state: Readonly<WorldState>; world: WorldDoc } | null;
  parts: Map<string, unknown>;
}

// Each chat's latest head, kept with its ledger core, so it goes when the ledger does.
const heads = new WeakMap<LedgerCore, Head>();

/** What one GM read reads: the chat's ledger core and chain, the packs, the user's minds settings, what a held write waits on now, and whether built views are reused. */
export interface GmRead {
  core: LedgerCore;
  observed: readonly ChainMessage[];
  registry: Registry;
  minds: MindsSettings;
  waitsOn: QueuedOn | null;
  reuse: boolean;
}

/** Where a GM read's time went (ms), and the parts it built rather than found kept: the slow record's steps. */
export interface GmReadSteps {
  render: number;
  build: number;
  built: string[];
}

/**
 * One part of the GM view at the chat's head (`lre.gm.part`), with the head's key: `same` when
 * `since` is that key; else built, or found kept for this head when built views are reused. Refused
 * for a request `gmPartProblem` refuses; null when the chat's world isn't loaded.
 */
export function readGmPart(read: GmRead, ask: GmPartAsk & { since?: string }, steps?: GmReadSteps): GmPartReply | { refused: string } | null {
  const problem = gmPartProblem(ask);
  if (problem !== null) return { refused: problem };
  const key = gmAnswerKey(gmKeyOf(read.core, read.observed), read.minds, read.waitsOn);
  if (ask.since === key) return { part: ask.part as GmPartReply["part"], id: ask.id ?? null, key, same: true };
  let head = read.reuse ? heads.get(read.core) : undefined;
  if (!head || head.key !== key) {
    head = { key, parts: new Map() };
    if (read.reuse) heads.set(read.core, head);
  }
  const t0 = performance.now();
  // The state as the fold keeps it, shared; without reuse, a copy of its own, as before.
  head.render ??= read.reuse ? read.core.readState(read.observed) : read.core.renderState(read.observed);
  const t1 = performance.now();
  if (steps) steps.render += t1 - t0;
  const render = head.render;
  if (!render) return null;
  const answer = buildGmPart({ core: read.core, observed: read.observed, registry: read.registry, render, minds: read.minds, waitsOn: read.waitsOn }, ask, read.reuse ? head.parts : null, steps ? (part) => steps.built.push(part) : undefined);
  if (steps) steps.build += performance.now() - t1;
  return "refused" in answer ? answer : { ...answer, key };
}
