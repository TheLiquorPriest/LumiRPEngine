// minds_read against Port Alder (INC1-SPEC R3a): a character's mind as each knowledge may read it.
// Danny's and Maddie's minds are recorded as a turn records them (a minds round, then each mind),
// with Danny's memory of it and the GM's intent and pin for him, both of them with Jordan at home.
// Under the player character's knowledge no mind is read at all; under everyone's, each one's line in
// the narrator's Minds section, Maddie's, which carries the shop's unrevealed truth, marked as hers
// and kept from Jordan, as the engine run marks it for the narrator; under the GM's, everything
// GM → Minds shows.

import { describe, expect, test } from "bun:test";
import { calendarOf, formatClock } from "../../src/engine/calendar";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { MINDS_EVENTS } from "../../src/shared/minds";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { Rig } from "../support/rig";
import { alderChat, answerOf, callTool, HOME, POV, recordFix, toolEnv } from "../support/tools";

/** Words no world text has, so a leak of a mind shows. */
const MARK = "MIND-MARK";

const DANNY = { id: "danny_okafor", name: "Danny Okafor" };
const MADDIE = { id: "maddie_kowalczyk", name: "Maddie Kowalczyk" };
const PRIYA = { id: "priya_nair", name: "Priya Nair" };
const JORDAN = { id: POV, name: "Jordan Ellis" };

const DANNYS = { monologue: `${MARK} the coffee is burnt again`, depiction: "Danny drums his fingers on the counter", intent: "offer Jordan a ride to work", reactions: ["glances at the clock", "rubs his eyes"], mood: "restless" };
/** Danny's line in the narrator's Minds section, as the world's `full` secrecy gives a mind whole. */
const DANNY_LINE = `Danny Okafor's mind: ${DANNYS.monologue}. Intends: ${DANNYS.intent}. Reactions: ${DANNYS.reactions.join("; ")}. Mood: ${DANNYS.mood}. Shows: ${DANNYS.depiction}.`;
const MADDIE_SHOWS = "Maddie stares at her phone";

const NOTE = `${MARK} Jordan looked worn out this morning`;
const PROMISE = `${MARK} drive Jordan to the shop`;
const PLAN = `${MARK} pick up brake pads at the market`;
const SUMMARY = `${MARK} Danny wants Marcus to see what he can do`;
const GM_INTENT = `${MARK} ask Jordan about the fleet contract`;

/** One mind, as the minds round records it: on a turn, at Live, where Jordan wakes. */
function mind(entity: string, at: number, m: { monologue: string; depiction: string; intent: string; reactions: string[]; mood: string | null }): LedgerEvent {
  return { type: MINDS_EVENTS.mind, data: { entity, at, place: HOME, level: "live", moment: "turn", reason: "live", ...m, interrupt: null, withheld: false } };
}

/** The minds (see the header), recorded now; the shop's truth, which no one has revealed, is in Maddie's thoughts. Answers the clock in the world's calendar. */
async function seed(rig: Rig, chatId: string): Promise<{ truth: string; clock: (minutes: number) => string; at: number }> {
  const { world, state } = await toolEnv(rig, chatId, "gm").reader.view();
  const at = state.clock;
  const truth = world.tracks.s_shop_trouble?.stages.truth?.truth ?? "";
  expect(truth).toContain("112,000");
  const memory: JsonObject = {
    entity: DANNY.id,
    at,
    notes: [{ id: "n_tired", text: NOTE, salience: 4, at }],
    commitments: [{ id: "c_ride", kind: "promise", with: [POV], text: PROMISE, due: at + 600, status: "open", made: at, closed: null }],
    resolved: [],
    plans: [{ id: "p_pads", what: PLAN, kind: "errand", when: { from: at + 120, to: at + 180 }, where: "alder_market", with: [], priority: 3, status: "open", made: at, source: "memory", closed: null, reason: null }],
    told: [],
    summary: SUMMARY,
  };
  await recordFix(rig, chatId, "seed-minds", [
    { type: MINDS_EVENTS.round, data: { at, on: true } },
    mind(DANNY.id, at, DANNYS),
    mind(MADDIE.id, at, { monologue: truth, depiction: MADDIE_SHOWS, intent: "", reactions: [], mood: null }),
    { type: MINDS_EVENTS.memory, data: memory },
    { type: MINDS_EVENTS.intent, data: { entity: DANNY.id, intent: { text: GM_INTENT, approach: "proactive" } } },
    { type: MINDS_EVENTS.pin, data: { entity: DANNY.id, level: "live" } },
  ]);
  expect(rig.rt.ledger.errors).toEqual([]);
  return { truth, at, clock: (minutes) => formatClock(calendarOf(world), minutes) };
}

describe("minds_read", () => {
  test("under the player character's knowledge no mind is ever read, not even one it is with", async () => {
    const { rig, chatId } = await alderChat();
    await seed(rig, chatId);
    for (const person of ["Danny", "Maddie Kowalczyk", "Jordan", "Nobody Atall"]) {
      const out = await callTool(rig, chatId, "pov", "minds_read", { person });
      expect({ person, out }).toEqual({ person, out: { text: "Jordan Ellis doesn't know that, and you read the world as Jordan Ellis knows it.", error: true } });
    }
  });

  test("under everyone's knowledge, each one's line in the narrator's Minds section: a mind carrying an unrevealed secret marked as theirs, kept from Jordan; none for one the section tells nothing of", async () => {
    const { rig, chatId } = await alderChat();
    const { truth } = await seed(rig, chatId);
    expect(await answerOf(rig, chatId, "everyone", "minds_read", { person: "Danny" })).toEqual({ who: DANNY, mind: DANNY_LINE });
    const maddie = await answerOf(rig, chatId, "everyone", "minds_read", { person: "Maddie" });
    expect(maddie).toEqual({ who: MADDIE, mind: secretMarkText(`Maddie Kowalczyk's mind: ${truth} Shows: ${MADDIE_SHOWS}.`, ["Maddie Kowalczyk"], ["Jordan Ellis"], SECRET_MARK_WORDING) });
    // Priya, across town with no mind this turn, is in no line.
    expect(await answerOf(rig, chatId, "everyone", "minds_read", { person: "Priya" })).toEqual({ who: PRIYA, mind: null });
    // What only the GM and Danny's own mind read never reaches the narrator's knowledge.
    const told = JSON.stringify([await answerOf(rig, chatId, "everyone", "minds_read", { person: "Danny" }), maddie]);
    for (const own of [GM_INTENT, NOTE, PROMISE, PLAN, SUMMARY]) expect(told).not.toContain(own);
  });

  test("under the GM's knowledge, everything GM → Minds shows of them: the ladder and the pins, the GM's intent, the latest mind, plans, commitments, notes and summary", async () => {
    const { rig, chatId } = await alderChat();
    const { at, clock, truth } = await seed(rig, chatId);
    expect(await answerOf(rig, chatId, "gm", "minds_read", { person: "Danny Okafor" })).toEqual({
      who: DANNY,
      fidelity: { level: "live", score: expect.any(Number), reasons: expect.arrayContaining([{ label: "Pinned at live by the GM", points: 0 }]), pin: { gm: "live", author: null } },
      refreshQueued: false,
      intent: { text: GM_INTENT, approach: "proactive" },
      mind: { at: clock(at), level: "live", moment: "turn", reason: "live", place: { id: HOME, name: "114 Harbor Street" }, ...DANNYS, interrupt: null, withheld: false },
      plans: [{ id: "p_pads", what: PLAN, kind: "errand", from: clock(at + 120), to: clock(at + 180), where: { id: "alder_market", name: "Alder Market" }, with: [], priority: 3, status: "open", source: "memory" }],
      commitments: [{ id: "c_ride", kind: "promise", text: PROMISE, with: [JORDAN], due: clock(at + 600), status: "open" }],
      notes: [{ id: "n_tired", text: NOTE, at: clock(at), salience: 4, salienceNow: 4, faded: false }],
      witness: [],
      summary: SUMMARY,
    });
    // Maddie's thoughts, the shop's truth among them, read plainly.
    expect(await answerOf(rig, chatId, "gm", "minds_read", { person: "Maddie" })).toMatchObject({ who: MADDIE, intent: null, mind: { monologue: truth, depiction: MADDIE_SHOWS }, plans: [], notes: [], summary: "" });
    // The player character, whom the player decides for, has no mind.
    expect(await answerOf(rig, chatId, "gm", "minds_read", { person: "Jordan" })).toEqual({ who: JORDAN, mind: null });
  });
});
