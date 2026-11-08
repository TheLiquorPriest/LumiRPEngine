// The GM view (DESIGN §7), built when it is asked for (`lre.gm`), never pushed with the player's
// state: the world as it stands on the head (an in-flight turn's plan included, as GM edits are
// checked against it), every ✎ fix and GM edit in force on the chat's path worded in full, those on
// the latest reply with the chip that undoes them, and the held writes that didn't apply, with their
// reasons. GM → Things (ITEMS-SPEC §10.2) reads the same head and the events on the chat's path
// (`pathEvents`): Build's things reads on the chat, a thing's page with its rest, its why and its
// history, and Tidy up's findings.

import type { GmThingsRead, JsonPatchOp, ResultBodies } from "../shared/protocol";
import type { GmView } from "../shared/state-view";
import { GM_IDS_MAX, GM_IDS_PARTS, GM_KEYED_PARTS, GM_KIND_PARTS, GM_OUTLINE, GM_PARTS, GM_ROSTER, keyedItem, type GmHeldWrite, type GmOutline, type GmPart, type GmPartAnswer, type GmPartView, type GmReadPart, type QueuedOn } from "../shared/gm-parts";
import { effectiveMemory, knowledgeThreshold, type MindsSettings } from "../shared/minds";
import type { HistorySource, KeepResult, MadeInPlay } from "../shared/thing-gm";
import type { WorldDoc } from "../shared/world";
import type { WorldState } from "../engine/state";
import { finalEditsOf, type FinalEdit } from "../shared/final-review";
import { buildGmRoster, buildGmWorld, buildGmWorldPart, gmWorldPartCount, type GmPick, type GmWorldPart } from "../engine/gm-view";
import { buildMindsGm } from "../packs/minds/core/gm";
import { hasOwn, isRecord } from "../shared/json";
import type { ChainMessage } from "../engine/ledger/chain";
import type { LedgerCore } from "../engine/ledger/journal";
import { activeRecord, ownMessage } from "../engine/ledger/path";
import { authorLines } from "../engine/player-events";
import { readPass } from "../engine/read-pass";
import type { ReadContext } from "../engine/registry";
import type { Registry } from "../engine/registry-impl";
import { gmThingExtras, gmThingsList, keepPlaces, keepThings, madePlaceViews, madeThings, type PathEvent } from "../engine/thing-gm";
import { tidyFindings, tidyRun } from "../engine/thing-tidy";
import { findThingIds, personThings, thingPage, thingPicks, thingsList, thingTypes } from "../engine/thing-view";
import { appliedEvents, clockFixLine, fixChip } from "./view";
import { mindEditChip, playerMindEdits } from "./character-engine";
import { mindDir } from "../shared/character-engine";

/** How many edits the GM view lists, newest first. */
const GM_EDITS = 40;

/** How many entries a thing's History strip shows, newest first. */
const HISTORY = 12;

/** What building the GM view's parts reads: the chat's head as it renders (shared, read only), its chain and journal, the user's minds settings, and what a held write waits on now. */
export interface GmHead {
  core: LedgerCore;
  observed: readonly ChainMessage[];
  registry: Registry;
  render: { state: Readonly<WorldState>; world: WorldDoc };
  minds: MindsSettings;
  waitsOn: QueuedOn | null;
}

/** The GM view's parts the chain, the journal and the user's settings give, each built alone. */
const CHAT_PARTS: { [P in Exclude<GmPart, GmWorldPart>]: (head: GmHead) => GmView[P] } = {
  edits: ({ core, observed, registry, render }) => {
    const fold = core.fold(observed);
    const chain = core.chain(observed);
    const edits: GmView["edits"] = [];
    // Undo covers the latest reply (DESIGN §12): its edits carry the chat's chip for them.
    const head = chain.findLastIndex((m) => !m.isUser);
    const minds = playerMindEdits(core, observed);
    chain.forEach((m, i) => {
      const rec = m.isUser ? null : activeRecord(m, core.journal.tombstones);
      // A fix of the time leads with how it moved the clock, which no event line words.
      for (const fix of rec ? appliedEvents(rec, fold, i).fixes : []) {
        const clock = clockFixLine(fix.events);
        edits.push({ messageId: m.id, seq: fix.seq, lines: [...(clock ? [clock] : []), ...authorLines(registry, render.world, render.state, fix.events, 12)], ...(fix.by ? { by: fix.by.label } : {}), undo: i === head ? fixChip(m.id, m.swipeId, fix.seq) : null });
      }
      // The player's edits of a mind file fold after the message they were made at: their Undo, while one stands at the chat's head, supersedes the edit.
      for (const e of minds) {
        if (e.messageId !== m.id) continue;
        const name = hasOwn(render.state.entities, e.who) ? (render.state.entities[e.who]?.name ?? e.who) : e.who;
        edits.push({ messageId: m.id, entry: e.entry.id, lines: [`${name}'s mind: ${e.path.slice(mindDir(e.who).length)}, as you wrote it`], undo: e.undoable ? mindEditChip(e.entry.id) : null });
      }
    });
    return edits.reverse().slice(0, GM_EDITS);
  },
  refused: ({ core }) => (core.journal.refused ?? []).map((r) => ({ id: r.write.id, reason: r.reason })),
  // Writes made while a turn was under way, oldest first, each worded as the edits are; what they wait on is the chat's turn, so it is one for all.
  held: ({ core, registry, render, waitsOn }) =>
    core.journal.held.map(({ write }): GmHeldWrite => {
      const post = write.kind === "post" ? write.entry : null;
      return { id: write.id, kind: post ? post.kind : write.kind, lines: post && post.events.length > 0 ? authorLines(registry, render.world, render.state, post.events, 12) : [], ...(post?.by ? { by: post.by.label } : {}), waitsOn: waitsOn ?? "reply" };
    }),
  // Fidelity reads the chat's latest message and reply, as the next turn's would; a holding under the threshold the chat recorded reads as a suspicion, as on the player's screens.
  minds: ({ observed, registry, render, minds }) => buildMindsGm(registry.context(render.world, render.state), latestTexts(observed), minds.enabled, effectiveMemory(render.world, minds), knowledgeThreshold(render.state.packs.minds), minds.lengths),
};

export function buildGmView(core: LedgerCore, observed: readonly ChainMessage[], registry: Registry, minds: MindsSettings, waitsOn: QueuedOn | null): GmView | null {
  const render = core.renderState(observed);
  if (!render) return null;
  const head: GmHead = { core, observed, registry, render, minds, waitsOn };
  // Everything else only reads the folded states, many times over: one read pass (DESIGN §9.6).
  return readPass(() => ({ ...buildGmWorld(registry, render.world, render.state), edits: CHAT_PARTS.edits(head), refused: CHAT_PARTS.refused(head), held: CHAT_PARTS.held(head), minds: CHAT_PARTS.minds(head) }));
}

/** What `lre.gm.part` asks for (`GmPartRequest` without its envelope, its chat or its `since`). */
export interface GmPartAsk {
  part: string;
  id?: string;
  ids?: readonly string[];
  kind?: string;
  bytes?: boolean;
}

/** Why `lre.gm.part` refuses what was asked, read before anything is built; null when it may be built. */
export function gmPartProblem(ask: GmPartAsk): string | null {
  // What a client sent is checked as it came: a part, an id and a kind are text, ids a list of them.
  if (typeof ask.part !== "string" || (ask.id !== undefined && typeof ask.id !== "string") || (ask.kind !== undefined && typeof ask.kind !== "string")) return "part, id and kind are text";
  if (ask.ids !== undefined && (!Array.isArray(ask.ids) || ask.ids.some((x) => typeof x !== "string"))) return "ids is a list of ids";
  if (ask.bytes !== undefined && typeof ask.bytes !== "boolean") return "bytes is true or false";
  if (ask.part === GM_OUTLINE) return ask.id !== undefined || ask.ids !== undefined || ask.kind !== undefined ? `the outline is read whole; only ${GM_KEYED_PARTS.join(", ")} take an id` : null;
  const asked = readPart(ask.part);
  if (asked === undefined) return `part is one of ${[...GM_PARTS, GM_ROSTER].join(", ")} or ${GM_OUTLINE}, not ${JSON.stringify(ask.part)}`;
  if (ask.bytes !== undefined) return "only the outline tells each part's bytes";
  if (ask.id !== undefined && !GM_KEYED_PARTS.some((p) => p === asked)) return `only ${GM_KEYED_PARTS.join(", ")} take an id; ${asked} is read whole`;
  if (ask.id !== undefined && (ask.ids !== undefined || ask.kind !== undefined)) return "name one by its id, or several by ids, not both";
  if (ask.ids !== undefined && !GM_IDS_PARTS.includes(asked)) return `only ${GM_IDS_PARTS.join(", ")} take ids; ${asked} is read whole`;
  if (ask.ids !== undefined && ask.ids.length > GM_IDS_MAX) return `at most ${GM_IDS_MAX} ids at once`;
  if (ask.kind !== undefined && !GM_KIND_PARTS.includes(asked)) return `only ${GM_KIND_PARTS.join(", ")} take a kind; ${asked} is read whole`;
  return null;
}

function readPart(part: string): GmReadPart | undefined {
  return part === GM_ROSTER ? GM_ROSTER : GM_PARTS.find((p) => p === part);
}

/** A part's value, made once per head under `key` when the head keeps what it built (`parts`), else made now. */
function once<T>(parts: Map<string, unknown> | null, key: string, make: () => T, built?: (part: string) => void): T {
  if (parts?.has(key)) return parts.get(key) as T;
  const value = make();
  built?.(key);
  parts?.set(key, value);
  return value;
}

/**
 * One part of the GM view (`lre.gm.part`), built alone, as the whole view holds it. With `id`, of
 * the entities, money or organizations only that one, named by its id or by its name (read without
 * case): a list of it, empty when there is none, and refused when several have that name, with
 * their ids; an organization named by its id builds only its own page. With `ids`, those found, in
 * the order asked; with `kind`, those of that kind. `roster` is every entity slim. `outline`
 * (`GM_OUTLINE`) is how many each part holds, as the whole view would hold it, counted without
 * building where the part's own reads count it, and with `bytes` each part's size as sent. What it
 * builds goes in `parts`, the head's memo, under the request that built it; `built` hears each part
 * built rather than found there. `gmPartProblem` is checked first.
 */
export function buildGmPart(head: GmHead, ask: GmPartAsk, parts: Map<string, unknown> | null = null, built?: (part: string) => void): GmPartAnswer | { refused: string } {
  const problem = gmPartProblem(ask);
  if (problem !== null) return { refused: problem };
  const { registry } = head;
  const { world, state } = head.render;
  // A part read whole, as the memo keeps it: the outline and the bytes read the same ones.
  const whole = (part: GmReadPart): unknown =>
    once(parts, part, () => (part === GM_ROSTER ? buildGmRoster(registry, world, state) : hasOwnPart(CHAT_PARTS, part) ? CHAT_PARTS[part](head) : buildGmWorldPart(registry, world, state, part)), built);
  return readPass((): GmPartAnswer | { refused: string } => {
    if (ask.part === GM_OUTLINE) {
      const outline: GmOutline = [GM_PARTS[0], GM_ROSTER, ...GM_PARTS.slice(1)].map((p) => {
        const count = p === GM_ROSTER || p === "entities" ? Object.keys(state.entities).length : p === "refused" ? (head.core.journal.refused ?? []).length : p === "held" ? head.core.journal.held.length : hasOwn(COUNTED, p) ? gmWorldPartCount(registry, world, state, p as GmWorldPart) : countOf(p, whole(p));
        return { part: p, count, ...(ask.bytes ? { bytes: Buffer.byteLength(JSON.stringify(whole(p)), "utf8") } : {}) };
      });
      return { part: GM_OUTLINE, id: null, value: outline };
    }
    const asked = readPart(ask.part) as GmReadPart;
    const pick: GmPick = { ...(ask.ids ? { ids: ask.ids } : {}), ...(ask.kind !== undefined ? { kind: ask.kind } : {}) };
    if (ask.id === undefined) {
      if (pick.ids === undefined && pick.kind === undefined) return { part: asked, id: null, value: whole(asked) } as GmPartView;
      const key = `${asked}\u0000${JSON.stringify(pick)}`;
      const value = once(parts, key, () => (asked === GM_ROSTER ? buildGmRoster(registry, world, state, pick) : buildGmWorldPart(registry, world, state, asked as GmWorldPart, pick)), built);
      return { part: asked, id: null, value } as GmPartView;
    }
    const keyed = GM_KEYED_PARTS.find((p) => p === asked);
    if (keyed === undefined) return { refused: `only ${GM_KEYED_PARTS.join(", ")} take an id; ${asked} is read whole` };
    const id = ask.id;
    const key = `${keyed}\u0000${JSON.stringify({ id })}`;
    return once(
      parts,
      key,
      (): GmPartAnswer | { refused: string } => {
        // An organization named by its id is built alone; by its name, as its page names it, from them all.
        if (keyed === "orgs") {
          const alone = buildGmWorldPart(registry, world, state, "orgs", { ids: [id] });
          if (alone.length === 1) return { part: keyed, id, value: alone };
          const all = whole("orgs") as GmView["orgs"];
          const named = keyedItem(all, id, (o) => o.page.id, (o) => o.page.name);
          if (named && "ambiguous" in named) return { refused: `${named.ambiguous.length} have the name ${JSON.stringify(id)}: ${named.ambiguous.join(", ")}; name one by its id` };
          return named ? { part: keyed, id: named.item.page.id, value: [named.item] } : { part: keyed, id, value: [] };
        }
        // An entity or a party as the world names it.
        const named = keyedItem(
          Object.entries(state.entities).map(([e, def]) => ({ id: e, name: def.name })),
          id,
          (e) => e.id,
          (e) => e.name,
        );
        if (named && "ambiguous" in named) return { refused: `${named.ambiguous.length} have the name ${JSON.stringify(id)}: ${named.ambiguous.join(", ")}; name one by its id` };
        if (!named) return { part: keyed, id, value: [] } as GmPartView;
        return { part: keyed, id: named.item.id, value: buildGmWorldPart(registry, world, state, keyed, { ids: [named.item.id] }) } as GmPartView;
      },
      built,
    );
  });
}

/** The world parts the outline counts where their own reads count them, without building them; any other part is built (and kept) to count it. */
const COUNTED: Partial<Record<GmReadPart, true>> = { kinds: true, tiers: true, lifeStates: true, domains: true, classifications: true, places: true, tracks: true, relationTypes: true };

/** How many one part holds, as its outline counts it: a list's items, the classifications' facets, the minds' characters, the fight 1 while one is under way. */
function countOf(part: GmReadPart, value: unknown): number {
  if (part === "minds") return isRecord(value) && Array.isArray(value.characters) ? value.characters.length : 0;
  if (Array.isArray(value)) return value.length;
  if (part === "classifications") return isRecord(value) ? Object.keys(value).length : 0;
  return value === null || value === undefined ? 0 : 1;
}

/** Whether a part is one the chain, the journal or the settings give (`CHAT_PARTS`). */
function hasOwnPart(parts: typeof CHAT_PARTS, part: GmReadPart): part is Exclude<GmPart, GmWorldPart> {
  return Object.prototype.hasOwnProperty.call(parts, part);
}

/**
 * The texts the next turn's fidelity reads, as its pre phase reads them: its own message
 * (`ownMessage`), none when the chat ends with a reply, since a Send with nothing typed adds none,
 * and the reply before it. A GM's minds run picks Live and Near by them too.
 */
export function latestTexts(observed: readonly ChainMessage[]): { user: string; reply: string } {
  const text = (m: ChainMessage | undefined): string => (m ? (m.swipes[m.swipeId] ?? "") : "");
  return { user: text(ownMessage(observed)), reply: text(observed.findLast((m) => !m.isUser)) };
}

/**
 * The events on the chat's path as they applied, in order (`appliedEvents`, undone and dropped ones
 * left out), each with its turn (the player's messages before it), what made it and its unit: a
 * record's planned events are its turn's, the rest and its answered chips the reply's read (the
 * story's), a materialization the turn's; each fix is its own unit, the GM's, an agent's, a player's
 * action's or a ✎ fix.
 */
export function pathEvents(core: LedgerCore, observed: readonly ChainMessage[]): PathEvent[] {
  const fold = core.fold(observed);
  const out: PathEvent[] = [];
  let turn = 0;
  core.chain(observed).forEach((m, i) => {
    if (m.isUser) {
      turn++;
      return;
    }
    const rec = activeRecord(m, core.journal.tombstones);
    if (!rec) return;
    const applied = appliedEvents(rec, fold, i);
    applied.events.forEach((event, at) => out.push({ turn, origin: at < applied.pre ? "turn" : "story", unit: `${m.id}:${at < applied.pre ? "turn" : "read"}`, event }));
    for (const event of applied.post) out.push({ turn, origin: event.type === "materialize" ? "turn" : "story", unit: `${m.id}:post`, event });
    for (const fix of applied.fixes) {
      const origin: HistorySource = fix.gm ? "gm" : fix.agent ? "agent" : fix.by ? "turn" : "fix";
      for (const event of fix.events) out.push({ turn, origin, unit: `${m.id}:fix:${fix.seq}`, event });
    }
  });
  return out;
}

/** The chat's head as GM → Things reads it: its read context (the world as played, places made in play overlaid), the events on its path, and its head turn's final review edits (Tidy up's seventh kind). */
export function gmThingsHead(core: LedgerCore, observed: readonly ChainMessage[], registry: Registry): { ctx: ReadContext; path: PathEvent[]; finalEdits: FinalEdit[] } | null {
  const render = core.renderState(observed);
  const reply = core.chain(observed).findLast((m) => !m.isUser);
  const rec = reply ? activeRecord(reply, core.journal.tombstones) : null;
  return render ? { ctx: registry.context(render.world, render.state), path: pathEvents(core, observed), finalEdits: finalEditsOf(rec?.finalEdits) } : null;
}

/**
 * GM → Things' reads (ITEMS-SPEC §10.2) of the chat's head: Build's list with where the player
 * character is and why each thing someone has is theirs; a thing's page with what the GM's adds
 * (its rest, why it is had, its history, its findings); a person's things; a search; the types; and
 * Tidy up's run (at most `tidy.limit` findings, those left out). Null for a thing or person the
 * head doesn't have.
 */
export function gmThings(registry: Registry, head: { ctx: ReadContext; path: readonly PathEvent[]; finalEdits?: readonly FinalEdit[] }, read: Exclude<GmThingsRead, { op: "leave" | "made" | "keep" }>, tidy: { limit: number; left: ReadonlySet<string> }): ResultBodies["lre.things"] | null {
  const { ctx, path } = head;
  return readPass(() => {
    switch (read.op) {
      case "list":
        return { list: thingsList(ctx), here: gmThingsList(ctx) };
      case "find":
        return { found: findThingIds(ctx, read.words) };
      case "types":
        return { types: thingTypes(ctx) };
      case "tidy":
        return { tidy: tidyRun(tidyFindings(ctx, path, { finalEdits: head.finalEdits ?? [] }), tidy.left, tidy.limit) };
      case "person": {
        const person = personThings(ctx, read.entity);
        return person ? { person, pick: thingPicks(ctx) } : null;
      }
      case "thing": {
        const thing = thingPage(ctx, read.entity);
        return thing ? { thing, pick: thingPicks(ctx), gm: gmThingExtras(registry, ctx, path, read.entity, tidyFindings(ctx, path), HISTORY) } : null;
      }
    }
  });
}

/** What the chat made in play that the world doesn't have (ITEMS-SPEC §6.2): its things and places, each saying whether `draft` has it already. */
export function madeInPlay(ctx: ReadContext, draft: Pick<WorldDoc, "entities" | "places">): MadeInPlay {
  return { things: madeThings(ctx, draft), places: madePlaceViews(ctx, draft) };
}

/**
 * Keep in the world (ITEMS-SPEC §6.2): the draft patch that copies the things and places named
 * into `draft` (the world's stored draft, never a world as a chat plays it), each under its own id,
 * so an Upgrade then follows its keep and take picks for them; the places first, so a thing kept
 * with the place it lies at lies there; with what was kept, what was skipped and why, and what a
 * kept thing lost on the way.
 */
export function keepInWorld(ctx: ReadContext, draft: Pick<WorldDoc, "entities" | "places">, things: readonly string[], places: readonly string[]): { ops: JsonPatchOp[]; result: KeepResult } {
  const placed = keepPlaces(ctx, places, draft);
  const kept = keepThings(ctx, things, draft, new Set(placed.result.places));
  return { ops: [...placed.ops, ...kept.ops], result: { things: kept.result.things, places: placed.result.places, skipped: [...placed.result.skipped, ...kept.result.skipped], notes: kept.result.notes } };
}
