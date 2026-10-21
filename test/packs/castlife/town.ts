// Riverton as routines read it (DESIGN §8): places to spend an evening, a household, a kind of worker,
// and the steps the routine tests take through it. Riverton starts on Friday 16 October 2026 at
// 07:30, with the player character (Alex, `you`) at home, Maya at the café and Jordan at the office.

import { expect } from "bun:test";
import { hashJson } from "../../../src/shared/hash";
import type { EventRef, LedgerEvent, PostEntry, Rec } from "../../../src/shared/ledger";
import type { Fidelity, MindPlan } from "../../../src/shared/minds";
import type { RoutineBlock, RoutineDef, RoutineEditOp, RoutineSettings } from "../../../src/shared/routines";
import { DEFAULT_ROUTINE_SETTINGS } from "../../../src/shared/routines";
import type { WorldDoc } from "../../../src/shared/world";
import { calendarOf, clockAt, parseHHMM } from "../../../src/engine/calendar";
import { resolveEdit } from "../../../src/engine/edits";
import type { ChainMessage, FoldOutput } from "../../../src/engine/ledger/chain";
import { LedgerFold } from "../../../src/engine/ledger/fold";
import { computePaths, contentId } from "../../../src/engine/ledger/path";
import { referenceFold } from "../../../src/engine/ledger/reference";
import { createRegistry } from "../../../src/engine/registry-impl";
import { ALL_NOTE } from "../../../src/engine/simulate";
import { runTimelapse, type TimelapseOutcome } from "../../../src/engine/time";
import { Working } from "../../../src/engine/working";
import { ALL_PACKS } from "../../../src/packs/index";
import { modernUsWorld } from "../riverton";
import { startState } from "../support";

export const reg = createRegistry(ALL_PACKS);

/** The player character. */
export const YOU = "you";

/** Riverton with a pub, a gym, a library, a market and a bank; Maya a barista in the Chen household. */
export function townWorld(patch: (w: WorldDoc) => void = () => undefined): WorldDoc {
  const world = modernUsWorld("w", "R");
  const place = (id: string, name: string, sceneType: string): void => {
    world.places[id] = { id, name, parent: "riverton", sceneType, fields: {} };
  };
  place("pub", "The Anchor", "conversation");
  place("gym", "Iron Works Gym", "action");
  place("library", "Riverton Library", "downtime");
  place("market", "Farmers' Market", "exploration");
  place("bank", "Riverton Savings Bank", "conversation");
  world.kinds.barista = { id: "barista", label: "Barista", extends: "person", fields: {} };
  world.entities.chen_household = { id: "chen_household", kind: "household", name: "The Chens", tier: "background", fields: {}, relations: [] };
  const maya = world.entities.maya;
  if (maya) {
    maya.kind = "barista";
    maya.relations.push({ type: "member_of", to: "chen_household" });
  }
  patch(world);
  return world;
}

export function town(patch: (w: WorldDoc) => void = () => undefined): Working {
  const world = townWorld(patch);
  return new Working(reg, world, startState(world, reg));
}

/** A clock reading: `day` days after the epoch (0 is Friday 16 October), at `hhmm`. */
export function at(w: { world: WorldDoc }, day: number, hhmm: string): number {
  return clockAt(calendarOf(w.world), day, parseHHMM(hhmm));
}

/** A routine of the world's (Build → Routines). */
export function routine(id: string, owner: RoutineDef["owner"], blocks: RoutineDef["blocks"], extra: Partial<RoutineDef> = {}): RoutineDef {
  return { id, ...(owner !== undefined ? { owner } : {}), blocks, ...extra };
}

/** A fixed block: `minutes` from `at` every day it's on. */
export function fixed(id: string, at: string, minutes: number, place: RoutineBlock["place"], extra: Partial<RoutineBlock> = {}): RoutineBlock {
  return { id, label: id, activity: "leisure", kind: "fixed", at, minutes, place, ...extra };
}

/** The world's routines and settings, in place. */
export function withRoutines(world: WorldDoc, routines: readonly RoutineDef[], settings?: Partial<RoutineSettings>): void {
  world.routines = Object.fromEntries(routines.map((r) => [r.id, r]));
  if (settings) world.routineSettings = { ...DEFAULT_ROUTINE_SETTINGS, ...settings };
}

/** Applies recorded events, as a turn would leave them; every one must apply. */
export function record(w: Working, events: readonly LedgerEvent[]): void {
  const dropped = w.dropped.length;
  w.applyAll(events);
  expect(w.dropped.slice(dropped)).toEqual([]);
}

/** A GM edit through `lre.edit`'s own resolution: its events, applied as its `fix` entry would be. */
export function gmEdit(w: Working, ops: readonly RoutineEditOp[]): LedgerEvent[] {
  const out = resolveEdit(reg, w.world, w.state, ops, { gm: true, runSeed: "seed" });
  if ("rejection" in out) throw new Error(`refused: ${out.rejection.reason}`);
  record(w, out.events);
  return out.events;
}

/** Time running on its own to `to` (the palette's Timelapse), every interrupt noted unless `stops` keeps the world's. */
export function lapse(w: Working, to: number, stops = false): TimelapseOutcome {
  const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "seed", ...(stops ? {} : { overrides: ALL_NOTE }) });
  if ("code" in out) throw new Error(out.reason);
  return out;
}

/** Time the story spends with the POV where it is (a typed span), every interrupt noted: it could meet whoever comes. */
export function held(w: Working, to: number): TimelapseOutcome {
  const out = runTimelapse(reg, w, { type: "at", at: to }, { runSeed: "seed", overrides: ALL_NOTE, povRoutine: false });
  if ("code" in out) throw new Error(out.reason);
  return out;
}

export const pin = (entity: string, level: Fidelity): LedgerEvent => ({ type: "minds.pin", data: { entity, level } });

/** A plan the GM recorded for someone (GM → Plans), as its `minds.plan_edit` event carries it. */
export function gmPlan(w: Working, entity: string, plan: Partial<MindPlan> & Pick<MindPlan, "id" | "when">): LedgerEvent {
  const p: MindPlan = { what: "See to something", kind: "errand", where: "bank", with: [], priority: 3, status: "open", made: w.state.clock, source: "gm", closed: null, reason: null, ...plan };
  return { type: "minds.plan_edit", data: { entity, plan: p.id, value: JSON.parse(JSON.stringify(p)) } };
}

/** Where someone is and what they are doing. */
export function whereabouts(w: Working, who: string): [unknown, unknown] {
  const f = w.state.entities[who]?.fields;
  return [f?.place, f?.activity];
}

/** The invitations a run made, each as `[host, origin]`. */
export function invitations(events: readonly LedgerEvent[]): [unknown, unknown][] {
  return events.flatMap((e) => (e.type === "castlife.invitation" && "data" in e ? [[e.data.agent, e.data.origin]] : []));
}

/**
 * A chat of `world` as the ledger keeps it: a reply whose record holds `events` as its turn's (a
 * timelapse's, say) and the GM's edits after it as `fix` entries, folded by the reference fold and
 * the optimized one, which must agree on everything. `undone` takes fix entries back (an Undo).
 */
export function foldBoth(world: WorldDoc, events: readonly LedgerEvent[], fixes: readonly LedgerEvent[][] = [], undone: readonly EventRef[] = []): FoldOutput {
  const revision = hashJson(world);
  const chain: ChainMessage[] = [
    { id: "a0", isUser: false, swipeId: 0, swipes: ["Morning."], ledger: null },
    { id: "u1", isUser: true, swipeId: 0, swipes: ["Let the day go by."], ledger: null },
    { id: "a1", isUser: false, swipeId: 0, swipes: ["The day goes by."], ledger: null },
  ];
  const path = computePaths(chain, [])[2]?.parentPath ?? "";
  const post: PostEntry[] = fixes.map((fix, i) => ({ seq: i + 1, at: path, kind: "fix", events: [...fix] }));
  const rec: Rec = { v: 1, defHash: revision, seq: 0, swipeHash: contentId("The day goes by."), path, seed: "s", pre: events.length, events: [...events], post, markersApplied: 0, status: "ok", undone: [...undone], intents: {} };
  const reply = chain[2];
  if (reply) reply.ledger = { v: 1, swipes: { "0": rec }, markers: [] };
  const input = { worlds: (r: string) => (r === revision ? world : undefined), revision, pauses: [], tombstones: [], chain };
  const reference = referenceFold(input, reg);
  const optimized = new LedgerFold(reg).fold(input);
  expect(hashJson(optimized.state)).toBe(hashJson(reference.state));
  expect(optimized.violations).toEqual([]);
  expect(reference.violations).toEqual([]);
  return reference;
}
