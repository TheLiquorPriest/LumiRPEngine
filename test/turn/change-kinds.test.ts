// Every kind of change the store can record, said as the turn's card and the briefing's "since the last turn" say it (`changeSaid`):
// one change of each event type the engine and its packs register (the engine's own list), each store operation and each operation of
// the areas, on a new chat of each of the three starter worlds, and again where each event applies in turn; and the briefing's rows of a
// job's changes in the notices part's words. None comes out blank, with an empty phrase, or as the record it is kept as.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { LinesPart } from "../../src/app/guidance";
import { applyEvent } from "../../src/engine/events";
import { createRegistry } from "../../src/engine/registry-impl";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { playAnswers } from "../../src/play/service";
import type { JsonValue } from "../../src/shared/json";
import type { Part } from "../../src/store";
import { STORE_OPS } from "../../src/store/types";
import { RPE_GUIDANCE } from "../../src/tree";
import { changeSaid } from "../../src/turn/card-words";
import { STORE_AREAS } from "../../src/turn/store-areas";
import { EVERY_TYPE, everythingWorld, registeredTypes } from "../engine/every-type";
import { openSet, type OpenSet, shippedTexts } from "../guidance/set";
import { rig } from "../play/undo-rig";

/** What words must never show: a brace of a record, a value left out (a slot with nothing in it), or what code says of nothing. */
const BLANK = /[{}]|\bundefined\b|\bnull\b|\bNaN\b|\[object|[:,;] *[,.;:]|\( *\)|[:,;]$|^\s|\s$|\s{2}/;

let set: OpenSet;
let notices: LinesPart;
let answers: Part;
beforeAll(async () => {
  set = await openSet(shippedTexts());
  const part = await set.guidance().part("notices");
  if (part?.format !== "lines") throw new Error("notices.md is not a lines part that loads");
  notices = part;
  answers = await playAnswers(RPE_GUIDANCE);
});
afterAll(() => set.close());

/** Each kind's words, with what is wrong with any: none said, or said with a blank or a record in it. */
function faults(said: readonly [string, string | undefined][]): string[] {
  return said.flatMap(([kind, words]) => (words === undefined ? [`${kind}: no words`] : BLANK.test(words) ? [`${kind}: "${words}"`] : []));
}

describe("every kind of change, in words", () => {
  test("the engine's list of kinds is all here, one change of each", () => {
    const reg = createRegistry(ALL_PACKS);
    expect(registeredTypes(reg).filter((t) => !EVERY_TYPE.some((e) => e.type === t))).toEqual([]);
  });

  for (const template of Object.keys(STARTER_WORLDS)) {
    test(`on a new chat of ${template}, every kind is said in words, the job's rows of the briefing among them`, async () => {
      const r = await rig(undefined, template);
      const reg = r.store.env.registry;
      const state = r.world();
      // The changes name the player character as the starter has it.
      const own = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value).replaceAll('"you"', JSON.stringify(r.doc.pov))) as JsonValue;
      const events = EVERY_TYPE.map((e): [string, string | undefined] => [e.type, changeSaid(answers, reg, r.doc, state, { op: e.type, value: own(e) })]);
      const ops = [...Object.values(STORE_OPS), ...STORE_AREAS.flatMap((a) => Object.keys(a.ops).map((op) => `${a.id}.${op}`))];
      const stored = ops.map((op): [string, string | undefined] => [op, changeSaid(answers, reg, r.doc, state, { op, value: {} })]);
      expect(faults([...events, ...stored])).toEqual([]);
      // A job's changes as the briefing tells them: each in those words, never its operation and value as kept.
      const applied = events.map(([, words]) => ({ ...(words !== undefined ? { words } : {}), about: r.doc.name }));
      const told = notices.line("job_finished", { job: "j-1", agent: "steward", brief: "Tally the stock.", applied, not_applied: [{ words: events[0]?.[1] ?? "", why: "a later turn had already set that value", later: 9 }] } as never) ?? "";
      expect(told).not.toMatch(/[{}]|"type"/);
      expect(told).toContain(`Took effect now: ${events[0]?.[1]} (about ${r.doc.name}).`);
    });
  }

  test("where each event applies, in a world with something for each to act on, every kind is said in words", () => {
    const reg = createRegistry(ALL_PACKS);
    const world = everythingWorld();
    const state = initialState(world, "r", reg);
    const said = EVERY_TYPE.map((e): [string, string | undefined] => {
      applyEvent(reg, e, state, reg.context(world, state));
      return [e.type, changeSaid(answers, reg, world, state, { op: e.type, value: e as unknown as JsonValue })];
    });
    expect(faults(said)).toEqual([]);
  });
});
