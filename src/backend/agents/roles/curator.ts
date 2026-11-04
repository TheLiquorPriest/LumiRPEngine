// The Curator, agent-backed (ITEMS-SPEC §7, I9): after the read on an agent chat, it keeps the
// world's fabric true to the reply (its things, the places it makes, its walk-ons and a purchase's
// goods), working from the GM's view with every secret marked, the turn's own changes told in words
// so it never makes one twice, and the Place, Gear and People sections its context starts it with.
// Each change to a thing or a place is one tool call, checked and staged in the turn (its writer),
// committed after the read's in role order; a walk-on, a purchase and a place someone is put in are
// noted for the read's own path (`ReadNotes`), and so is a thing fact its answer gives for a change
// its tools couldn't make, each settled as the read's are. Its answer is classic's `ExtractRead`, by
// classic's own parser on the Curator's channels; prompt-only, it is classic's item read
// (`task.classic`: classic's extract on those channels alone), which the reconciler settles exactly
// as classic's.
//
// Its work is what it staged and noted: a limit on its rounds of tool calls that stops its agent
// before it answers leaves that standing, its answer cut short (`ExtractRead.short`). Wherever its
// own work isn't whole (cut short, failed, or never run), the read's changes of its types, held
// aside for it, land for what it didn't stage or answer (`uncurated`).

import type { EntityId } from "../../../shared/ids";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import { EXTRACT_ITEM_TEXT, roleTaskTextId } from "../../../shared/role-prompts";
import { isThingFact, nameTokens } from "../../../shared/things";
import type { WorldDoc } from "../../../shared/world";
import { own } from "../../../engine/pack-kit";
import { reconcileFact } from "../../../engine/reconcile-things";
import type { Registry } from "../../../engine/registry-impl";
import type { WorldState } from "../../../engine/state";
import { Working } from "../../../engine/working";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { type ExtractRead, extractAnswer } from "../../steps";
import type { ReadNotes } from "../tools/registry";
import type { CurateTask, TurnAgentCtx } from "../turn-ctx";
import { commitOrder, type StagedOp } from "../turn-writer";
import { type RoleAnswer, runRoleAgent } from "./agent";

/** The limits on rounds of tool calls (Tool rounds per agent, Tool rounds per turn): one that stops the Curator's agent before it answers leaves its work standing. */
const ROUND_LIMITS: Readonly<Record<string, true>> = { tool_turns: true, turn_tool_turns: true };

/** The field a purchase, a walk-on and a place made name what they are of by: the thing bought, the person, the place. */
const NAMED_BY: Readonly<Record<string, string>> = { purchase: "item", spawn: "name", place_make: "place" };

/** The reply's fabric as the Curator's agent works it, with the tools of its families. */
export async function curateRun(rt: Runtime, task: CurateTask, ctx: TurnAgentCtx): Promise<RoleAnswer<ExtractRead>> {
  const i = task.input;
  const texts = ctx.texts ?? (await rt.settings.get(ctx.userId)).prompts.texts;
  // What its tools noted for the read, each fact once, in the order noted.
  const noted = new Map<string, JsonObject>();
  const notes: ReadNotes = {
    add(fact) {
      const key = JSON.stringify(fact);
      if (noted.has(key)) return false;
      noted.set(key, fact);
      return true;
    },
  };
  const said = i.said.trim();
  const answered = await runRoleAgent(rt, ctx, {
    sub: "curate",
    phase: "read",
    names: { world: i.world.name, pov: own(i.world.entities, i.world.pov)?.name ?? i.world.pov },
    vars: {
      pov_id: i.world.pov,
      instructions: i.instructions ?? "",
      events: task.events.length > 0 ? task.events.join("\n") : "-",
      // The player's message as the read's task gives it: context, never a change of its own.
      message: said !== "" ? renderPrompt(roleTaskTextId("read", "extract", "message"), texts, { text: said }) : "",
      reply: task.reply,
    },
    answer: { part: "answer", vars: { facts: renderPrompt(EXTRACT_ITEM_TEXT.facts, texts, {}) } },
    tools: task.world,
    notes,
    check: (raw) => {
      if (!isRecord(raw) || !Array.isArray(raw.proposals)) return null;
      const read = extractAnswer(raw, { world: i.world, appliedMinutes: i.appliedMinutes, channels: i.channels, moves: false });
      return { ...read, proposals: [...noted.values(), ...read.proposals], where: null };
    },
  });
  if (answered.ok || !hasOwn(ROUND_LIMITS, answered.code)) return answered;
  // A round limit stopped its agent before it answered: what it staged stands, and what it noted lands with the read, its answer cut short.
  return { ok: true, out: { proposals: [...noted.values()], where: null, short: "cut" }, usage: answered.usage, via: "agent", text: answered.text };
}

/** A purchase's, a walk-on's or a place made's key: its type and what it is of, folded as the resolver folds words (case, accents, apostrophes, punctuation); null for any other change, or one naming nothing. */
function namedKey(p: JsonObject): string | null {
  const type = String(p.type);
  const name = hasOwn(NAMED_BY, type) ? p[NAMED_BY[type] ?? ""] : undefined;
  const words = typeof name === "string" ? nameTokens(name) : [];
  return words.length > 0 ? `${type}:${words.join(" ")}` : null;
}

/**
 * The read's held facts (ITEMS-SPEC §6.4) that land in the Curator's place where its own work isn't
 * whole: each that isn't the Curator's already. Its work is what it staged that stands and the thing
 * facts its answer gives, settled in that order on `state`. A thing fact is the Curator's when the
 * reconciler, reading its words before that work or after it, finds a thing the work made or
 * changed, or finds it changes nothing once the work lands; a purchase, a walk-on or a place made is
 * when the Curator's answer has one of the same thing, person or place, or it staged that place.
 * The rest land as the read's, deduped with its own where the read settles them.
 */
export function uncurated(registry: Registry, world: WorldDoc, state: Readonly<WorldState>, held: readonly JsonObject[], curator: { staged: readonly StagedOp[]; answer: readonly JsonObject[] }): JsonObject[] {
  if (held.length === 0) return [];
  const opts = { viewer: world.pov, salt: "curator:held" };
  // The things its work made or changed, and the purchases, walk-ons and places made it is of.
  const touched = new Set<EntityId>();
  const named = new Set<string>();
  const after = new Working(registry, world, state);
  for (const o of commitOrder(curator.staged)) {
    if (o.op.kind === "gm_edit" && o.op.op.op === "item") {
      const c = o.op.op.change;
      for (const id of ["item" in c ? c.item : undefined, "keep" in c ? c.keep : undefined, "drop" in c ? c.drop : undefined]) if (typeof id === "string") touched.add(id);
      for (const e of o.events) if (e.type === "spawn") touched.add(e.entity.id);
    }
    const place = o.op.kind === "gm_edit" && o.op.op.op === "place" && o.op.op.change.do === "make" ? namedKey({ type: "place_make", place: o.op.op.change.name }) : null;
    if (place !== null) named.add(place);
    const mark = after.mark();
    if (after.applyAll(o.events).length < o.events.length) after.restore(mark);
  }
  for (const p of curator.answer) {
    const key = namedKey(p);
    if (key !== null) named.add(key);
    const r = isThingFact(p.type) ? reconcileFact(after, p, opts) : null;
    if (r?.kind === "change") for (const id of r.items) touched.add(id);
  }
  const covered = (p: JsonObject): boolean => {
    if (!isThingFact(p.type)) {
      const key = namedKey(p);
      return key !== null && named.has(key);
    }
    for (const on of [state, after.state]) {
      const r = reconcileFact(new Working(registry, world, on), p, opts);
      const found = r.kind === "change" ? r.items : r.kind === "which" ? r.candidates : [];
      if (found.some((id) => touched.has(id)) || (on === after.state && r.kind === "refused" && r.rejection.code === "already")) return true;
    }
    return false;
  };
  return held.filter((p) => !covered(p));
}
