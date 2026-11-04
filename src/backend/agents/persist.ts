// Smart persistence (Settings → Agents → Pipeline; B decision 6): opt-in, for every agent chat.
// A scene is its basis (`sceneBasis`): where the player character is; who is with them, and where;
// the day part; the world's revision and the live lore's fingerprint; the things where the player
// character is and on everyone present; how the people present regard each other; and how many
// marks and GM fixes the chat holds. A turn whose basis is the last turn's, with no mark or fix since,
// within the settings' turns in a row and world minutes since its roles last ran afresh, keeps the
// in-scene Live minds that are quiet (`quietMind`) and the scene role's lore and notes: each is
// recorded again as this turn's, marked kept, and the narrator is told it is unchanged. Never on a
// Re-run, swipe, Continue, Retry read or timelapse, for a mind's first thoughts, one the GM asked to
// refresh, or a classic chat; the read, the Curator, the knowledge, the memory, the skip and the
// world's steps are never kept (`NEVER_SKIPPED`).
//
// What the last turn's scene was is kept in memory per chat, for the reply that turn wrote (`ScenePersistence`):
// a restart, a Branch or a swipe asks every role afresh, which is always safe. Nothing here is
// recorded but the kept copies themselves.

import { BASIS_WORDS, basisChanged, type PersistHold, type SceneBasis } from "../../shared/agent-pipeline";
import type { PersistSettings } from "../../shared/agent-settings";
import { hashParts } from "../../shared/hash";
import type { ChatId, EntityId, MessageId } from "../../shared/ids";
import type { GenerationKind } from "../../shared/ledger";
import type { WorldDoc } from "../../shared/world";
import { calendarOf, dayPartAt } from "../../engine/calendar";
import type { ChainMessage } from "../../engine/ledger/chain";
import type { LedgerCore } from "../../engine/ledger/journal";
import { activeRecord } from "../../engine/ledger/path";
import { acts } from "../../engine/life";
import { inPovScene } from "../../engine/presence";
import type { Registry } from "../../engine/registry-impl";
import { isGone, kindIs, placeOfEntity } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { holderOf, isThing } from "../../engine/things";
import { regardBand } from "../../packs/relationships/core/index";

/** The people with the player character now, in id order: every person in the POV's scene who still acts. */
export function presentPeople(reg: Registry, world: WorldDoc, state: Readonly<WorldState>): EntityId[] {
  return Object.keys(state.entities)
    .sort()
    .filter((id) => kindIs(reg, world, state.entities[id]?.kind ?? "", "person") && !isGone(state, id) && acts(world, state, id) && inPovScene(world, state, id));
}

/** How many marks and post entries (a GM fix, an out-of-play action) the chain's messages hold: one more since the last turn closed means something changed outside it. */
export function chainMarks(core: LedgerCore, observed: readonly ChainMessage[]): number {
  let n = 0;
  for (const m of core.chain(observed)) {
    n += m.ledger?.markers.length ?? 0;
    if (!m.isUser) n += activeRecord(m, core.journal.tombstones)?.post.length ?? 0;
  }
  return n;
}

/** The live lore's fingerprint: every lore entry the turn reads, World Info read live included. */
export function loreFingerprint(world: WorldDoc): string {
  return hashParts("lre.persist.lore", JSON.stringify(world.lore ?? {}));
}

/** A scene's basis (`SceneBasis`), signal by signal, from the state a turn plans from; `marks` is `chainMarks` then. */
export function sceneBasis(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, marks: number): SceneBasis {
  const pov = world.pov;
  const here = placeOfEntity(state, pov);
  const present = presentPeople(reg, world, state);
  const people = new Set([pov, ...present]);
  const ctx = reg.context(world, state);
  const things = Object.keys(state.entities)
    .sort()
    .filter((id) => isThing(ctx, id) && ((here !== null && placeOfEntity(state, id) === here && holderOf(state, id) === null) || people.has(holderOf(state, id) ?? "")))
    .map((id) => `${id}:${JSON.stringify(state.entities[id])}`);
  const regard = [...people].sort().flatMap((from) => [...people].sort().flatMap((to) => (from === to ? [] : [`${from}>${to}:${regardBand(ctx, from, to)}`])));
  return {
    place: here ?? "",
    present: present.map((id) => `${id}@${placeOfEntity(state, id) ?? ""}`).join(","),
    dayPart: dayPartAt(calendarOf(world), state.clock).id,
    revision: state.revision,
    lore: loreFingerprint(world),
    things: hashParts("lre.persist.things", things.join("\n")),
    regard: regard.join(","),
    marks: String(marks),
  };
}

/** The last agent turn's scene in a chat: the reply it wrote, its basis, the marks once it closed, when its roles last ran afresh, and how many turns in a row kept them since. */
interface LastScene {
  reply: { messageId: MessageId; swipeId: number };
  basis: SceneBasis;
  freshAt: number;
  kept: number;
}

/** A turn under way: its basis, its clock, and whether it kept anything. */
interface TurnScene {
  chatId: ChatId;
  basis: SceneBasis;
  clock: number;
  kept: boolean;
}

/** What a turn decides from: its kind, the reply it follows (null: none), its basis and its clock. */
export interface PersistAsk {
  settings: Readonly<PersistSettings>;
  kind: GenerationKind;
  after: { messageId: MessageId; swipeId: number } | null;
  basis: SceneBasis;
  clock: number;
}

const KIND_WHY: Partial<Record<GenerationKind, string>> = {
  regenerate: "A Re-run asks every role again.",
  swipe: "A swipe asks every role again.",
  continue: "A Continue plays no turn.",
  impersonate: "An impersonation plays no turn.",
  renarrate: "A Re-narrate tells its turn's own plan.",
};

/** Each chat's last agent turn's scene, and each turn's under way, by generation; at most `cap` of each. */
export class ScenePersistence {
  private readonly chats = new Map<ChatId, LastScene>();
  private readonly turns = new Map<string, TurnScene>();

  constructor(private readonly cap = 256) {}

  /** Whether the turn's scene is the last turn's, so persistence keeps what it may; else why not. */
  hold(chatId: ChatId, ask: PersistAsk): PersistHold {
    if (!ask.settings.on) return { holds: false, why: "Smart persistence is off." };
    const kind = KIND_WHY[ask.kind];
    if (kind) return { holds: false, why: kind };
    const last = this.chats.get(chatId);
    if (!last || !ask.after || last.reply.messageId !== ask.after.messageId || last.reply.swipeId !== ask.after.swipeId) return { holds: false, why: "The last turn's scene isn't known: its roles ran on another reply, or before a restart." };
    const changed = basisChanged(last.basis, ask.basis);
    if (changed.length > 0) return { holds: false, why: `The scene changed: ${changed.map((s) => BASIS_WORDS[s]).join(", ")}.` };
    if (last.kept >= ask.settings.turns) return { holds: false, why: `It was kept ${last.kept === 1 ? "1 turn" : `${last.kept} turns`} in a row, the most Smart persistence keeps.` };
    const minutes = ask.clock - last.freshAt;
    if (minutes > ask.settings.minutes) return { holds: false, why: `${minutes} world minutes passed since its roles last ran, more than Smart persistence keeps.` };
    return { holds: true };
  }

  /** A turn's scene, as it plays: its basis and clock, which the next turn compares with once it closes. */
  begin(generationId: string, chatId: ChatId, basis: SceneBasis, clock: number): void {
    this.turns.delete(generationId);
    this.turns.set(generationId, { chatId, basis, clock, kept: false });
    while (this.turns.size > this.cap) this.turns.delete(this.turns.keys().next().value as string);
  }

  /** The turn kept a mind or the scene's notes. */
  keptIn(generationId: string): void {
    const t = this.turns.get(generationId);
    if (t) t.kept = true;
  }

  /** Whether the turn kept anything. */
  kept(generationId: string): boolean {
    return this.turns.get(generationId)?.kept === true;
  }

  /** A generation took the turn: its scene goes with it. */
  adopted(from: string, to: string): void {
    const t = this.turns.get(from);
    if (!t) return;
    this.turns.delete(from);
    this.turns.set(to, t);
  }

  /** The turn closed on its reply: the chat's last scene is its, with the marks the chain holds now folded into its basis; a turn that kept counts on from the last one. */
  closed(generationId: string, reply: { messageId: MessageId; swipeId: number }, marks: number): void {
    const t = this.turns.get(generationId);
    this.turns.delete(generationId);
    if (!t) return;
    const last = this.chats.get(t.chatId);
    const keptOn = t.kept && last !== undefined;
    this.chats.delete(t.chatId);
    this.chats.set(t.chatId, { reply, basis: { ...t.basis, marks: String(marks) }, freshAt: keptOn ? last.freshAt : t.clock, kept: keptOn ? last.kept + 1 : 0 });
    while (this.chats.size > this.cap) this.chats.delete(this.chats.keys().next().value as ChatId);
  }

  /** The chat's last scene is no longer the one its next turn follows: a classic turn, a rollback, a deleted reply. */
  forget(chatId: ChatId): void {
    this.chats.delete(chatId);
  }
}
