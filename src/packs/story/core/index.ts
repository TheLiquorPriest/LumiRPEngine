// Story pack (DESIGN §7, §9.3): flags, the quest log over the engine's tracks (quests, secret ladders,
// puzzles), puzzle answers through `checkAnswer` with the author's opt-in decision threshold, and
// the leaky-label lint. Track stepping, gates, reveals and hints are the engine's (tracks.ts);
// this pack is how they reach effects, formulas, the narrator and the panel. Story has no realism
// domain: tracks behave the same at every level.

import type { JsonValue } from "../../../shared/json";
import type { PackEvent } from "../../../shared/ledger";
import type { WorldDoc } from "../../../shared/world";
import { labelOf, mutableSlice, objOf, sliceOf, strOf, own } from "../../../engine/pack-kit";
import type { PackDef, ReadContext, Rejection } from "../../../engine/registry";
import { checkAnswer } from "../../../engine/tracks";
import { playerTrack, shownTrackId, type PlayerTrack } from "../../../engine/visibility";

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

function reject(code: string, reason: string): Rejection {
  return { code, reason };
}

/**
 * The puzzle an answer is for: `ref` when it is a puzzle's id, or the id the player layer shows an
 * open one by (a secret's stand-in); else, among the open puzzles the POV can see (a stage awaiting
 * an answer), the one whose label and stage as the POV sees them share the most words with `ref`
 * (a secret's own label, which its quest log row masks, never matches), or the only one open.
 */
export function openPuzzle(ctx: ReadContext, ref: string): string | null {
  if (own(ctx.world.tracks, ref)?.kind === "puzzle") return ref;
  const open = Object.keys(ctx.world.tracks)
    .flatMap((id) => {
      const t = own(ctx.world.tracks, id);
      if (t?.kind !== "puzzle" || own(t.stages, own(ctx.state.tracks, id)?.stage ?? t.start)?.answer === undefined) return [];
      const shown = playerTrack(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id);
      return shown ? [{ id, shown }] : [];
    })
    .sort((a, b) => (a.shown.id < b.shown.id ? -1 : a.shown.id > b.shown.id ? 1 : 0));
  const byId = open.find((p) => p.shown.id === ref);
  if (byId) return byId.id;
  const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const want = new Set(words(ref));
  let best: { id: string; n: number } | null = null;
  for (const p of open) {
    const n = words(`${p.shown.label} ${p.shown.stage}`).filter((w) => want.has(w)).length;
    if (n > 0 && (!best || n > best.n)) best = { id: p.id, n };
  }
  return best?.id ?? (open.length === 1 ? (open[0]?.id ?? null) : null);
}

/** A puzzle as the player asked for it, for a refusal: a track they see under that id by the label they see, else their own words, never a hidden track's label. */
function askedFor(ctx: ReadContext, ref: string): string {
  const id = Object.keys(ctx.world.tracks).find((t) => shownTrackId(ctx.world, t) === ref);
  const shown = id === undefined ? null : playerTrack(ctx.registry, ctx.world, ctx.state, ctx.world.pov, id);
  return shown?.label ?? (ref.replace(/_/g, " ").trim() || "nothing");
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
      args: ["track", "answer", "decision?"],
      resolve(a, ctx) {
        const ref = strOf(a.track);
        const track = openPuzzle(ctx, ref);
        if (!track) return { code: "not_a_puzzle", reason: `no open puzzle ${askedFor(ctx, ref)}`, gm: `no open puzzle ${labelOf(ctx, ref)}` };
        const decision = typeof a.decision === "number" ? a.decision : undefined;
        const check = checkAnswer(ctx.world, ctx.state, track, strOf(a.answer), decision);
        // The author opted this stage into model judgement: the turn asks `puzzle.answer`, then retries with `decision`.
        if (check.needsDecision) return reject("needs_decision", "this answer needs a judgement");
        return check.event ? [check.event] : reject("no_answer", "there is nothing to answer here");
      },
    });

    r.action({
      id: "answer",
      label: "Answer",
      pack: "story",
      // `puzzle` may be the id, words from its label ("the safe"), or left out when one puzzle is open.
      params: { puzzle: { type: "text", optional: true, label: "Puzzle" }, answer: { type: "text" }, decision: { type: "number", optional: true, label: "Judged probability" } },
      requires: [],
      outcomes: { default: [{ type: "story.answer", args: { track: "=params.puzzle", answer: "=answer", decision: "=params.decision" } }] },
      duration: "1",
      lexicon: ["the answer is", "i think it's", "solve", "answer", "the code is", "the combination is", "try the combination", "dial", "enter the code"],
      observable: "answers",
    });

    r.renderer({
      slot: "quest",
      render(ctx) {
        const lines: string[] = [];
        for (const t of buildQuestLog(ctx).active) {
          lines.push(`${t.label}: ${t.cue ?? t.stage}`);
          for (const o of t.objectives) if (!o.done) lines.push(`- ${o.label}`);
          for (const h of t.hints) lines.push(`Hint: ${h}`);
          for (const truth of t.truths) lines.push(`Known: ${truth}`);
        }
        return lines;
      },
    });
    r.view({ panel: "story.quests", build: (ctx) => buildQuestLog(ctx) as unknown as JsonValue });

    r.lint({
      code: "story.leaky_label",
      check: (world) => leakyLabels(world).map((l) => ({ severity: "error" as const, code: "story.leaky_label", message: `"${l.text}" gives away a secret ("${l.secret}").`, path: l.path })),
    });
  },
};

export default storyPack;
