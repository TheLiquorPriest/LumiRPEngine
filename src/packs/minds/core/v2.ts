// The Character Engine's events (DEPTH-PLAN §4.4; `shared/character-engine.ts`): the bookkeeping
// beside each mind file write, the batches a character's agent lived, its takes as it plays (its
// working memory of the scene, until it remembers the scene), interviews kept apart from the mind,
// and the chat's switch of player character (D-10). They fold into the minds slice's `v2` part,
// which a chat that never wrote one doesn't have, so older chats fold as before. Each rides a turn's
// record or a basis-anchored layer entry (§4.9) like any event; a fold never calls a model.
//
// Plans reach the world (§4.4): a write by a character's agent whose plans read a time puts each
// in its plans of the classic part (source "agent", `agentPlan`), where the Cast life planner lays
// and settles it, the economy pays it and an invitation asks the player character along, exactly
// as the memory step's plans are; a plan already held by its id (one restated, or one another's
// write of it shared) is left as it stands, so a rewrite never reopens a plan the planner settled.
//
// What they refuse is the Character Engine's bookkeeping, never a judgment of what a character
// keeps: a write whose file the workspace doesn't hold with that body (the `engine.ws.write` before
// it), an agent's write, lived batch or take for the player character, who has no agent (D-10), an
// agent's rewrite of `core.md`, which only seeding and the user write, and an agent's rewrite of a
// file the user's own edit pinned.

import { hasOwn } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import {
  AGENT_MODES,
  MIND_ASK,
  MIND_FILE_NAMES,
  MIND_INTERVIEW,
  MIND_LIVED,
  MIND_POV,
  MIND_TAKE,
  MIND_WRITE,
  MINDS_V2_KEY,
  PROBES_KEPT,
  agentPlan,
  mindAskOf,
  mindFileOf,
  mindInterviewOf,
  mindLivedOf,
  mindTakeOf,
  mindV2At,
  mindWriteOf,
  pinnedBy,
  povOf,
  type MindFileMeta,
  type MindV2,
  type MindsV2Slice,
} from "../../../shared/character-engine";
import type { EntityId } from "../../../shared/ids";
import type { EventTypeDef, ReadContext } from "../../../engine/registry";
import { isGone, kindIs } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { workspaceOf } from "../../../engine/workspace";
import { readCharacter, sharePlan, writeSlice } from "./state";

/** The `v2` part for a reducer, created on first use with every part. */
function writeV2(state: WorldState): MindsV2Slice {
  const slice = writeSlice(state) as unknown as Record<string, unknown>;
  const raw = (slice[MINDS_V2_KEY] ?? {}) as Partial<MindsV2Slice>;
  raw.minds ??= {};
  raw.probes ??= {};
  slice[MINDS_V2_KEY] = raw;
  return raw as MindsV2Slice;
}

/** One character's mind bookkeeping for a reducer, created on first use. */
function writeMind(state: WorldState, who: EntityId): MindV2 {
  const v2 = writeV2(state);
  const m = (hasOwn(v2.minds, who) ? v2.minds[who] : undefined) ?? { files: {}, lived: {}, superseded: {}, writes: 0, last: null };
  m.files ??= {};
  m.lived ??= {};
  m.superseded ??= {};
  v2.minds[who] = m;
  return m;
}

/** Whether `who` names someone of this world or this chat. */
function known(ctx: Pick<ReadContext, "world" | "state">, who: EntityId): boolean {
  return hasOwn(ctx.state.entities, who) || hasOwn(ctx.world.entities, who);
}

const nameOf = (ctx: Pick<ReadContext, "world" | "state">, who: EntityId): string =>
  (hasOwn(ctx.state.entities, who) ? ctx.state.entities[who]?.name : undefined) ?? (hasOwn(ctx.world.entities, who) ? ctx.world.entities[who]?.name : undefined) ?? who;

const NO_AGENT = "the player character has no agent: the player drives him (D-10)";

/** `minds.v2.write`: the bookkeeping of the mind file write just before it, as its agent (or seeding, or the user) supplied it. */
const write: EventTypeDef<PackEvent> = {
  type: MIND_WRITE,
  validate: (e, ctx) => {
    const d = mindWriteOf(e.data);
    if (typeof d === "string") return { code: "bad_event", reason: d };
    if (!known(ctx, d.who)) return { code: "missing_entity", reason: `no one with the id ${d.who}` };
    if (workspaceOf(ctx.state)[d.path] !== d.hash) return { code: "bad_event", reason: "a mind write follows the workspace write of its file with the same body" };
    const file = mindFileOf(d.path);
    if (!file) return { code: "bad_event", reason: "a mind write's file is one of the mind's own" };
    const agent = (AGENT_MODES as readonly string[]).includes(d.mode);
    if (!agent) return d.mode === "seed" && file.kind !== "core" ? { code: "bad_event", reason: "seeding writes a mind's core only" } : null;
    if (d.who === povOf(ctx.world, ctx.state)) return { code: "player_character", reason: NO_AGENT };
    if (file.kind === "core") return { code: "core", reason: "a character's core is seeded or the user's to edit; its agent reads it first and never rewrites it" };
    const meta = mindV2At(ctx.state, d.who).files[file.rel];
    if (pinnedBy(meta, file.rel)) return { code: "pinned", reason: `the user's own edit of ${file.rel} stands; the agent may remark on it elsewhere, never rewrite it` };
    return null;
  },
  apply: (e, state, ctx) => {
    const d = mindWriteOf(e.data);
    const file = typeof d === "string" ? null : mindFileOf(d.path);
    if (typeof d === "string" || !file) return;
    const m = writeMind(state, d.who);
    const before = hasOwn(m.files, file.rel) ? m.files[file.rel] : undefined;
    const meta: MindFileMeta = {
      hash: d.hash,
      at: d.at,
      mode: d.mode,
      lived: d.lived,
      about: d.about,
      rev: (before?.rev ?? 0) + 1,
      ...(d.plans !== undefined ? { plans: d.plans } : {}),
      ...(d.supersedes !== undefined ? { supersedes: d.supersedes } : {}),
      ...(d.source !== undefined ? { source: d.source } : {}),
      ...(d.review ? { review: true as const } : {}),
      ...(d.mode === "user" && before !== undefined ? { was: before.hash } : {}),
    };
    m.files[file.rel] = meta;
    if (d.supersedes !== undefined) m.superseded[d.supersedes] = true;
    m.writes += 1;
    // A reflection's write answers the character's own ask to take stock.
    if (d.mode === "reflect") delete m.asks;
    m.last = m.last === null ? d.at : Math.max(m.last, d.at);
    // Its plans with a time reach the Cast life planner, as the memory step's do; one held already stays as it is.
    if ((AGENT_MODES as readonly string[]).includes(d.mode)) {
      const pov = povOf(ctx.world, state);
      for (const ref of d.plans ?? []) {
        const plan = agentPlan(d.who, d.at, ref);
        if (plan && !readCharacter(state, d.who).plans.some((p) => p.id === plan.id)) sharePlan(state, pov, d.who, plan);
      }
    }
  },
  // The Character Engine's bookkeeping, not a fact of the story: the player's Journal has no line for it; Minds shows every write.
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const d = mindWriteOf(e.data);
    return typeof d === "string" ? "" : `${nameOf(ctx, d.who)}'s mind: ${mindFileOf(d.path)?.rel ?? d.path} written (${d.mode})`;
  },
};

/** `minds.v2.lived`: the beats one call of a character's agent lived, whatever it kept of each; what still reached it unlived is pending. */
const lived: EventTypeDef<PackEvent> = {
  type: MIND_LIVED,
  validate: (e, ctx) => {
    const d = mindLivedOf(e.data);
    if (typeof d === "string") return { code: "bad_event", reason: d };
    if (!known(ctx, d.who)) return { code: "missing_entity", reason: `no one with the id ${d.who}` };
    return d.who === povOf(ctx.world, ctx.state) ? { code: "player_character", reason: NO_AGENT } : null;
  },
  apply: (e, state) => {
    const d = mindLivedOf(e.data);
    if (typeof d === "string") return;
    const m = writeMind(state, d.who);
    for (const beat of d.beats) m.lived[beat] = true;
    // Remembering a scene takes up its working memory: every take before it in fold order was the remember's to read.
    if (d.mode === "remember") delete m.takes;
  },
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const d = mindLivedOf(e.data);
    return typeof d === "string" ? "" : `${nameOf(ctx, d.who)} lived ${d.beats.length} beat${d.beats.length === 1 ? "" : "s"} (${d.mode})`;
  },
};

/** `minds.v2.interview`: an interview kept apart from the mind (a probe); a neutral one also has its write beside it. */
const interview: EventTypeDef<PackEvent> = {
  type: MIND_INTERVIEW,
  validate: (e, ctx) => {
    const d = mindInterviewOf(e.data);
    if (typeof d === "string") return { code: "bad_event", reason: d };
    if (!known(ctx, d.who)) return { code: "missing_entity", reason: `no one with the id ${d.who}` };
    return d.who === povOf(ctx.world, ctx.state) ? { code: "player_character", reason: NO_AGENT } : null;
  },
  apply: (e, state) => {
    const d = mindInterviewOf(e.data);
    if (typeof d === "string") return;
    const v2 = writeV2(state);
    const list = [...((hasOwn(v2.probes, d.who) ? v2.probes[d.who] : undefined) ?? []), { at: d.at, by: d.by, question: d.question, answer: d.answer, neutral: d.neutral }];
    v2.probes[d.who] = list.slice(-PROBES_KEPT);
  },
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const d = mindInterviewOf(e.data);
    return typeof d === "string" ? "" : `${nameOf(ctx, d.who)} interviewed by the ${d.by}${d.neutral ? ", folded into the mind" : ", kept as a probe"}`;
  },
};

/** `minds.v2.ask`: a character asks from its own play to take stock; the poll hears it until a reflection writes. */
const ask: EventTypeDef<PackEvent> = {
  type: MIND_ASK,
  validate: (e, ctx) => {
    const d = mindAskOf(e.data);
    if (typeof d === "string") return { code: "bad_event", reason: d };
    if (!known(ctx, d.who)) return { code: "missing_entity", reason: `no one with the id ${d.who}` };
    return d.who === povOf(ctx.world, ctx.state) ? { code: "player_character", reason: NO_AGENT } : null;
  },
  apply: (e, state) => {
    const d = mindAskOf(e.data);
    if (typeof d === "string") return;
    writeMind(state, d.who).asks = { at: d.at, why: d.why };
  },
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const d = mindAskOf(e.data);
    return typeof d === "string" ? "" : `${nameOf(ctx, d.who)} asks to reflect`;
  },
};

/** `minds.v2.take`: a play's private take, kept as the character's working memory of the scene until it remembers the scene. */
const take: EventTypeDef<PackEvent> = {
  type: MIND_TAKE,
  validate: (e, ctx) => {
    const d = mindTakeOf(e.data);
    if (typeof d === "string") return { code: "bad_event", reason: d };
    if (!known(ctx, d.who)) return { code: "missing_entity", reason: `no one with the id ${d.who}` };
    return d.who === povOf(ctx.world, ctx.state) ? { code: "player_character", reason: NO_AGENT } : null;
  },
  apply: (e, state) => {
    const d = mindTakeOf(e.data);
    if (typeof d === "string") return;
    const m = writeMind(state, d.who);
    m.takes = [...(m.takes ?? []), { at: d.at, lived: [...d.lived], ...(d.beat !== undefined ? { beat: d.beat } : {}), hash: d.take }];
  },
  // The character's own, never a fact of the story: the player's Journal has no line for it; Minds and the turn's inspector show it.
  describe: (e, ctx, viewer) => {
    if (viewer !== undefined) return "";
    const d = mindTakeOf(e.data);
    return typeof d === "string" ? "" : `${nameOf(ctx, d.who)} took the moment in${d.beat !== undefined ? " and acted" : ""}`;
  },
};

/**
 * `minds.v2.pov {who}`: from here on in this chat the player plays `who` (D-10); the world's own player
 * character clears the switch. Decided at its basis before any turn that may follow it there (a switch
 * made while a reply is written folds before that reply), so it lands only where every later turn and
 * entry still folds as made with it: one that played `who`'s agent (a take, a write) would not.
 */
const pov: EventTypeDef<PackEvent> = {
  type: MIND_POV,
  later: {},
  validate: (e, ctx) => {
    const who = e.data.who;
    if (typeof who !== "string" || who === "") return { code: "bad_event", reason: "a switch of player character names whom the player plays" };
    if (!known(ctx, who)) return { code: "missing_entity", reason: `no one with the id ${who}` };
    const person = hasOwn(ctx.state.entities, who) ? ctx.state.entities[who] : undefined;
    if (!person || !kindIs(ctx.registry, ctx.world, person.kind, "person") || isGone(ctx.state, who)) return { code: "not_a_person", reason: `the player plays a person of the chat, and ${nameOf(ctx, who)} isn't one now` };
    return who === povOf(ctx.world, ctx.state) ? { code: "no_change", reason: `${nameOf(ctx, who)} is the player character already` } : null;
  },
  apply: (e, state, ctx) => {
    const who = e.data.who;
    if (typeof who !== "string") return;
    const v2 = writeV2(state);
    if (who === ctx.world.pov) delete v2.pov;
    else v2.pov = who;
  },
  describe: (e, ctx) => `The player now plays ${nameOf(ctx, String(e.data.who))}`,
};

export const MIND_V2_EVENT_DEFS: readonly EventTypeDef<PackEvent>[] = [write, lived, take, ask, interview, pov];

/** The mind file names, for readers that list a mind in its read order. */
export { MIND_FILE_NAMES };
