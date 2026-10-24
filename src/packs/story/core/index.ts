// Story pack (DESIGN §7, §9.3): flags, the quest log over the engine's tracks (quests, secret ladders,
// puzzles), puzzle answers through `checkAnswer` with the author's opt-in decision threshold, and
// the leaky-label, leaky-id and answer-track lints. Track stepping, gates, reveals and hints are the engine's
// (tracks.ts); this pack is how they reach effects, formulas, the narrator and the panel. Story has
// no realism domain: tracks behave the same at every level.

import type { TrackId } from "../../../shared/ids";
import { hasOwn, type JsonValue } from "../../../shared/json";
import type { LedgerEvent, PackEvent } from "../../../shared/ledger";
import type { FeedScope, WorldDoc } from "../../../shared/world";
import { wordsOf } from "../../../engine/lore";
import { labelOf, mutableSlice, objOf, sliceOf, strOf, own } from "../../../engine/pack-kit";
import type { FeedLine, PackDef, ReadContext, Rejection } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { effectLists } from "../../../engine/ruleset-lint";
import { isGone, kindIs, placeOfEntity } from "../../../engine/scope";
import { checkAnswer } from "../../../engine/tracks";
import { canSeeEntity, canSeePlace, playerTrack, shownTrackId, trackKnown, visibilityOf, type PlayerTrack } from "../../../engine/visibility";
import { together } from "../../../engine/presence";

declare module "../../../engine/registry" {
  interface QueryMap {
    /** A story flag's value (false when unset). */
    "story.flag": (ctx: ReadContext, name: string) => JsonValue;
  }
}

/** A flag's value: set by `story.flag`, else the author's default (`packs.story.config.flags`), else false. */
export function flagValue(ctx: Pick<ReadContext, "world" | "state">, name: string): JsonValue {
  return own(objOf(sliceOf(ctx.state, "story").flags), name) ?? own(objOf(ctx.world.packs.story?.config.flags), name) ?? false;
}

export interface QuestLogView {
  active: PlayerTrack[];
  done: PlayerTrack[];
  failed: PlayerTrack[];
}

/**
 * The Quest section (DESIGN §6, §6.11): each active track the POV can see, with its objectives
 * still open, the hints it has earned and the truths revealed. In `scene` scope, a `known_by` quest
 * the POV doesn't know of whose owner or someone it lets know is with the POV, at its stage, as
 * theirs to know; a secret track and any truth are the GM's alone, told only in `gm` scope.
 */
export function questLines(ctx: ReadContext, scope: FeedScope): FeedLine[] {
  const lines: FeedLine[] = [];
  for (const t of buildQuestLog(ctx).active) {
    lines.push({ text: `${t.label}: ${t.cue ?? t.stage}`, known: "pov" });
    for (const o of t.objectives) if (!o.done) lines.push({ text: `- ${o.label}`, known: "pov" });
    for (const h of t.hints) lines.push({ text: `Hint: ${h}`, known: "pov" });
    for (const truth of t.truths) lines.push({ text: `Known: ${truth}`, known: "pov" });
  }
  if (scope === "player") return lines;
  const pov = ctx.world.pov;
  const here = placeOfEntity(ctx.state, pov);
  const withHim = Object.keys(ctx.state.entities)
    .sort()
    .filter((id) => {
      const e = own(ctx.state.entities, id);
      return !!e && id !== pov && kindIs(ctx.registry, ctx.world, e.kind, "person") && !isGone(ctx.state, id) && canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id) && together(ctx.world, here, placeOfEntity(ctx.state, id));
    });
  for (const [id, t] of Object.entries(ctx.world.tracks).sort(([a], [b]) => a.localeCompare(b))) {
    const shown = playerTrack(ctx.registry, ctx.world, ctx.state, pov, id);
    if (shown && shown.label === t.label) continue;
    const stage = own(t.stages, own(ctx.state.tracks, id)?.stage ?? t.start);
    if (!stage || (stage.next.length === 0 && !stage.fail)) continue;
    // A secret track is no one's to know but the GM's (`trackKnown` reads only `known_by`), and so is a truth.
    const who = visibilityOf(t.visibility) === "secret" ? [] : withHim.filter((k) => trackKnown(ctx.registry, ctx.world, ctx.state, k, t)).map((k) => own(ctx.state.entities, k)?.name ?? k);
    if (who.length > 0) lines.push({ text: `${t.label}: ${stage.label}.`, known: "scene", who: who.join(", ") });
    else if (scope === "gm") lines.push({ text: `${t.label}: ${stage.label}${stage.truth ? ` (the truth: ${stage.truth})` : ""}.`, known: "gm" });
  }
  return lines;
}

/**
 * The POV's quest log: visible tracks only, through the engine's visibility (secret truths stay out
 * until revealed), each under the id the player layer knows it by and in that id's order, so a
 * secret's stand-in says nothing of its own id by where it sits.
 */
export function buildQuestLog(ctx: ReadContext): QuestLogView {
  const view: QuestLogView = { active: [], done: [], failed: [] };
  for (const id of Object.keys(ctx.world.tracks)) {
    if (own(ctx.world.tracks, id)?.kind === "agenda") continue;
    const t = playerTrack(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id);
    if (t) view[t.status === "done" ? "done" : t.status === "failed" ? "failed" : "active"].push(t);
  }
  for (const list of [view.active, view.done, view.failed]) list.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return view;
}

/** Public text that contains a secret (a stage truth, a secret entity's or place's name). */
export function leakyLabels(world: WorldDoc): { path: string; text: string; secret: string }[] {
  const secrets: string[] = [];
  for (const t of Object.values(world.tracks)) for (const s of Object.values(t.stages)) if (s.truth) secrets.push(s.truth);
  for (const e of Object.values(world.entities)) if (e.visibility === "secret" && e.name.length > 3) secrets.push(e.name);
  for (const p of Object.values(world.places)) if (p.visibility === "secret" && p.name.length > 3) secrets.push(p.name);
  const out: { path: string; text: string; secret: string }[] = [];
  const check = (path: string, text: string | undefined): void => {
    if (!text) return;
    const l = text.toLowerCase();
    for (const s of secrets) if (l.includes(s.toLowerCase()) && l !== s.toLowerCase()) out.push({ path, text, secret: s });
  };
  for (const t of Object.values(world.tracks)) {
    check(`tracks.${t.id}.label`, t.label);
    for (const [sid, s] of Object.entries(t.stages)) {
      check(`tracks.${t.id}.stages.${sid}.label`, s.label);
      check(`tracks.${t.id}.stages.${sid}.cue`, s.cue);
      (s.hints ?? []).forEach((h, i) => check(`tracks.${t.id}.stages.${sid}.hints.${i}`, h));
    }
  }
  for (const e of Object.values(world.entities)) if (e.visibility !== "secret") check(`entities.${e.id}.name`, e.name);
  for (const p of Object.values(world.places)) if (p.visibility !== "secret") check(`places.${p.id}.name`, p.name);
  return out;
}

/** An id's words: its parts between separators and case changes, lowercased (`bill_danny_rent` and `billDannyRent` are bill, danny, rent). */
function idWords(id: string): string[] {
  return id.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== "");
}

/** A name's words of four or more letters, lowercased: what of it an id could spell. */
function nameWords(name: string): string[] {
  return name.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4);
}

/** An id the player's views can carry that gives a secret away, with the secrets it gives and an id that names none of them. */
export interface LeakyId {
  path: string;
  id: string;
  secrets: string[];
  neutral: string;
}

/**
 * The ids that give a secret away: a non-secret entity's id (an account, a flow, an invoice, a
 * lease, a job or anything else in the world) holding a secret entity's or place's id, or a word of
 * its name four or more letters long that no one and nowhere the player can see is also called
 * (`bill_danny_rent` while Danny Okafor is secret, but not `chapel_bell` under the public Chapel of
 * the Quiet Bell). Only people and places make a word public: a possession is named for whoever
 * holds it ("Danny's checking"), so its name says nothing more. A player's views send an id
 * wherever the player acts on what it names, and the engine can't rename an author's ids.
 */
export function leakyIds(world: WorldDoc, registry?: Registry): LeakyId[] {
  // Someone the player can know by name: a person, by the registry's kinds where the lint has them, else by the world's own.
  const person = (kind: string): boolean => {
    if (registry) return kindIs(registry, world, kind, "person");
    let k: string | undefined = kind;
    for (let guard = 0; k !== undefined && guard < 32; guard++) {
      if (k === "person") return true;
      k = own(world.kinds, k)?.extends;
    }
    return false;
  };
  const known = new Set<string>();
  for (const p of Object.values(world.places)) if (p.visibility !== "secret") for (const w of nameWords(p.name)) known.add(w);
  for (const e of Object.values(world.entities)) if (e.visibility !== "secret" && person(e.kind)) for (const w of nameWords(e.name)) known.add(w);
  const secrets = [...Object.values(world.entities).filter((e) => e.visibility === "secret"), ...Object.values(world.places).filter((p) => p.visibility === "secret")].map((s) => ({
    name: s.name || s.id,
    id: idWords(s.id),
    words: nameWords(s.name).filter((w) => !known.has(w)),
  }));
  if (secrets.length === 0) return [];
  const taken = new Set([...Object.keys(world.entities), ...Object.keys(world.places)]);
  const unused = (base: string): string => {
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    taken.add(id);
    return id;
  };
  const out: LeakyId[] = [];
  for (const e of Object.values(world.entities)) {
    if (e.visibility === "secret") continue;
    const words = idWords(e.id);
    const spelt = new Set<number>();
    const gives: string[] = [];
    for (const s of secrets) {
      const at: number[] = [];
      for (let i = 0; s.id.length > 0 && i + s.id.length <= words.length; i++) if (s.id.every((w, j) => words[i + j] === w)) for (let j = 0; j < s.id.length; j++) at.push(i + j);
      words.forEach((w, i) => {
        if (s.words.some((n) => w === n || w === `${n}s`)) at.push(i);
      });
      if (at.length === 0) continue;
      gives.push(s.name);
      for (const i of at) spelt.add(i);
    }
    if (gives.length === 0) continue;
    out.push({ path: `entities.${e.id}.id`, id: e.id, secrets: gives, neutral: unused(words.filter((_, i) => !spelt.has(i)).join("_") || e.kind) });
  }
  return out;
}

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/** An open puzzle: the track, and its row in the quest log. */
export interface OpenPuzzle {
  id: TrackId;
  shown: PlayerTrack;
}

/**
 * The puzzles the POV can see that take an answer now (a stage awaiting one), each with its quest log
 * row, in the order of the ids the player layer knows them by, as the quest log lists them.
 */
export function openPuzzles(ctx: ReadContext): OpenPuzzle[] {
  return Object.keys(ctx.world.tracks)
    .flatMap((id) => {
      const t = own(ctx.world.tracks, id);
      if (t?.kind !== "puzzle" || own(t.stages, own(ctx.state.tracks, id)?.stage ?? t.start)?.answer === undefined) return [];
      const shown = playerTrack(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id);
      return shown ? [{ id, shown }] : [];
    })
    .sort((a, b) => (a.shown.id < b.shown.id ? -1 : a.shown.id > b.shown.id ? 1 : 0));
}

/**
 * Whether `ref` is written as an id (one word with `_` or `~` in it: `p_strongroom`, `study_safe`, a
 * stand-in), not in words. `puzzlesFor` reads one no quest log row goes by as the name of the thing
 * the POV sees by that id, else by its own parts alone.
 */
function idShaped(ref: string): boolean {
  const t = ref.trim();
  return t !== "" && !/\s/.test(t) && /[_~]/.test(t);
}

/** The name of the entity or place `id` belongs to, when the POV can see it; null for any other id (a hidden thing's, or one nothing has). */
function seenName(ctx: ReadContext, id: string): string | null {
  const pov = ctx.world.pov;
  const e = own(ctx.state.entities, id);
  if (e && canSeeEntity(ctx.registry, ctx.world, ctx.state, pov, id)) return e.name;
  const p = own(ctx.world.places, id);
  return p && canSeePlace(ctx.registry, ctx.world, ctx.state, pov, id) ? p.name : null;
}

/**
 * The puzzles the player's `ref` may be for, only ever ones in the POV's quest log (`openPuzzles`):
 * the one it names by the id its row goes by (a secret's stand-in, any other's own id); else those
 * whose label, stage and cue, as the POV sees them, hold the most of its words (a secret's own label,
 * which its row masks, never counts); else the only one open. Several when they tie, or when `ref`
 * names nothing while more than one is open. A ref written as an id (`idShaped`) that no row goes by
 * reads as the name of the entity or place the POV sees by it (`study_safe`: "The study safe"). Any
 * other id-shaped ref (a hidden puzzle's or thing's id, a slug, one nothing has) is read by its parts
 * alone (`township_truck`: "township truck"), never as the only one open, so it finds nothing unless
 * its words fit a row. Only what the POV sees decides, so a hidden id fares as one nothing has.
 */
function puzzlesFor(ctx: ReadContext, ref: string): TrackId[] {
  const open = openPuzzles(ctx);
  const byId = open.find((p) => p.shown.id === ref);
  if (byId) return [byId.id];
  const name = idShaped(ref) ? seenName(ctx, ref.trim()) : null;
  const partsOnly = idShaped(ref) && name === null;
  const want = new Set(wordsOf(name ?? ref));
  const scored = open.map(({ id, shown }) => {
    const seen = new Set(wordsOf(`${shown.label} ${shown.stage} ${shown.cue ?? ""}`));
    return { id, n: [...want].filter((w) => seen.has(w)).length };
  });
  const best = Math.max(0, ...scored.map((s) => s.n));
  if (best > 0) return scored.filter((s) => s.n === best).map((s) => s.id);
  if (partsOnly) return [];
  // Words that fit none still find the only one open (the player may name it loosely); none at all fit every one.
  if (open.length === 1) return open.map((p) => p.id);
  return want.size === 0 ? open.map((p) => p.id) : [];
}

/** The puzzle the player's `ref` is for (`puzzlesFor`), or null when none fits or more than one fits equally. */
export function openPuzzle(ctx: ReadContext, ref: string): TrackId | null {
  const fits = puzzlesFor(ctx, ref);
  return fits.length === 1 ? (fits[0] ?? null) : null;
}

/**
 * How a refusal names the puzzle the player asked for: by the label of a quest log row it is the id
 * of; else in their own words, unless those are written as an id or are some track's own id, which a
 * refusal never repeats (null), so a hidden puzzle's id reads as one nothing has.
 */
function askedFor(ctx: ReadContext, ref: string): string | null {
  const id = Object.keys(ctx.world.tracks).find((t) => shownTrackId(ctx.world, t) === ref);
  const shown = id === undefined ? null : playerTrack(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id);
  if (shown) return shown.label;
  const words = ref.trim();
  return idShaped(words) || hasOwn(ctx.world.tracks, words) || hasOwn(ctx.world.tracks, ref) ? null : words;
}

/** What the player asked for, for the GM: their words, and the track a track's own id names. */
function askedForGm(ctx: ReadContext, ref: string): string {
  if (ref.trim() === "") return "an answer that names none";
  const t = own(ctx.world.tracks, ref);
  return t ? `"${ref}" (${t.label})` : `"${ref}"`;
}

/** An answer to `track`, a puzzle: its attempt, or a refusal when it needs a judgement first or its stage takes none. */
function answerTo(ctx: ReadContext, track: TrackId, a: Record<string, JsonValue>): LedgerEvent[] | Rejection {
  const decision = typeof a.decision === "number" ? a.decision : undefined;
  const check = checkAnswer(ctx.world, ctx.state, track, strOf(a.answer), decision);
  // The author opted this stage into model judgement: the turn asks `puzzle.answer`, then retries with `decision`.
  if (check.needsDecision) return reject("needs_decision", "this answer needs a judgement");
  return check.event ? [check.event] : reject("no_answer", "there is nothing to answer here");
}

export const storyPack: PackDef = {
  id: "story",
  label: "Story",
  version: 1,
  domain: null,
  requires: [],
  register(r) {
    r.event<PackEvent>({
      type: "story.flag",
      validate: (e) => (strOf(e.data.name) !== "" ? null : { code: "bad_flag", reason: "a flag needs a name" }),
      apply: (e, state) => {
        const s = mutableSlice(state, "story");
        s.flags = { ...objOf(s.flags), [strOf(e.data.name)]: e.data.value ?? true };
      },
      describe: (e) => `flag ${strOf(e.data.name)}`,
    });
    r.query("story.flag", (ctx, name) => flagValue(ctx, name));
    r.formula("flag", (ctx, name) => {
      const v = flagValue(ctx, String(name ?? ""));
      return typeof v === "number" || typeof v === "boolean" || typeof v === "string" ? v : v !== null;
    });

    r.effect({ type: "story.flag", args: ["name", "value?"], resolve: (a) => (strOf(a.name) === "" ? reject("bad_flag", "a flag needs a name") : [{ type: "story.flag", data: { name: strOf(a.name), value: a.value ?? true } }]) });
    r.effect({
      type: "story.answer",
      // `track`: the puzzle's own id, which only the world's own content gives (an authored action or rule).
      // `puzzle`: the player's reference, as the Answer action passes it on.
      args: ["track?", "puzzle?", "answer", "decision?"],
      resolve(a, ctx) {
        // The world's own content names its puzzle by its own id, so it is answered as named, whatever
        // the player sees of it. A refusal names no track: the id is the author's.
        if (a.track !== undefined) {
          const id = strOf(a.track);
          if (own(ctx.world.tracks, id)?.kind !== "puzzle") return { code: "not_a_puzzle", reason: "there is nothing to answer here", gm: `story.answer's track ${id === "" ? "names nothing" : `"${id}" is no puzzle`}` };
          return answerTo(ctx, id, a);
        }
        // The player's reference reaches only a puzzle in their quest log (`puzzlesFor`).
        const ref = strOf(a.puzzle);
        const asked = ref.trim() === "" ? "" : askedFor(ctx, ref);
        const fits = puzzlesFor(ctx, ref);
        // Several fit equally: which one is meant isn't for the engine to guess, so none is tried and no hint is spent.
        if (fits.length > 1) {
          return {
            code: "ambiguous_puzzle",
            reason: asked === "" ? "more than one puzzle is open, and the answer doesn't say which" : `more than one open puzzle fits ${asked ?? "that name"}`,
            gm: `${fits.length} open puzzles fit ${askedForGm(ctx, ref)}: ${fits.map((id) => labelOf(ctx, id)).join(", ")}`,
          };
        }
        const track = fits[0];
        if (track === undefined) return { code: "not_a_puzzle", reason: asked === "" ? "there is no open puzzle to answer" : `no open puzzle ${asked ?? "by that name"}`, gm: `no open puzzle in the quest log fits ${askedForGm(ctx, ref)}` };
        return answerTo(ctx, track, a);
      },
    });

    r.action({
      id: "answer",
      label: "Answer",
      description: "Give your answer to a puzzle: a riddle, a code, a combination.",
      pack: "story",
      // `puzzle` names one in the quest log: the id its row goes by (a secret's stand-in), as interpret's Answer label lists it; words from what the player sees of it (its label, stage or cue: "the safe"), or the id of something they see (`study_safe`), read as its name; or nothing when one puzzle is open.
      params: { puzzle: { type: "text", optional: true, label: "Puzzle" }, answer: { type: "text" }, decision: { type: "number", optional: true, label: "Judged probability" } },
      requires: [],
      outcomes: { default: [{ type: "story.answer", args: { puzzle: "=params.puzzle", answer: "=answer", decision: "=params.decision" } }] },
      duration: "1",
      lexicon: ["the answer is", "i think it's", "solve", "answer", "the code is", "the combination is", "try the combination", "dial", "enter the code"],
      observable: "answers",
    });

    r.renderer({ slot: "quest", label: "Quests and goals your character knows", render: (ctx) => questLines(ctx, "player").map((l) => l.text), feed: questLines });
    r.view({ panel: "story.quests", build: (ctx) => buildQuestLog(ctx) as unknown as JsonValue });

    r.lint({
      code: "story.leaky_label",
      check: (world) => leakyLabels(world).map((l) => ({ severity: "error" as const, code: "story.leaky_label", message: `"${l.text}" gives away a secret ("${l.secret}").`, path: l.path })),
    });
    // A warning: the id may never reach the player, as when they never act on what it names, but nothing here can tell.
    r.lint({
      code: "story.leaky_id",
      check: (world, registry) =>
        leakyIds(world, registry).map((l) => ({
          severity: "warning" as const,
          code: "story.leaky_id",
          message: `The id "${l.id}" gives away a secret (${l.secrets.map((s) => `"${s}"`).join(", ")}): a player's views carry it wherever the player acts on what it names. Give it an id that names no one, such as "${l.neutral}".`,
          path: l.path,
        })),
    });
    // `track` names the puzzle by its own id, which only the world's own content knows: a formula there
    // answers whatever it gives, a puzzle the player can't see too, so one fed the player's words could reach it.
    r.lint({
      code: "story.answer_track",
      check: (world) =>
        effectLists(world).flatMap(({ path, effects }) =>
          effects.flatMap((spec, i) => {
            const track = spec.type === "story.answer" ? spec.args.track : undefined;
            if (typeof track !== "string" || !track.startsWith("=")) return [];
            return [{ severity: "warning" as const, code: "story.answer_track", message: `This answer's track is a formula (${track}), but track takes a puzzle's own id as written, such as "p_safe": the puzzle the formula gives is answered even when the player can't see it. To let the player say which puzzle, pass their words as puzzle instead.`, path: `${path}.${i}.args.track` }];
          }),
        ),
    });
  },
};

export default storyPack;
