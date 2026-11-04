// The knowledge read tools against Port Alder (INC1-SPEC R3a, K1), with who knows the shop's debt
// seeded as GM → Minds' own tests seed it (`gm-knowledge.test.ts`): Marcus keeps the debt from
// everyone, Priya only guesses at it from the rumour, Danny half-believes the rumour Priya told him
// and keeps it from Marcus, and Danny told Jordan. Under everyone's view, every holder, a fact
// someone keeps marked in the user's wording; under the GM's, every fact plain with its truth, and
// what each holding rests on.

import { describe, expect, test } from "bun:test";
import { calendarOf, formatClock } from "../../src/engine/calendar";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { claimFactId, factId, type KnowledgeFact, type LearnEventData, MINDS_EVENTS, witnessRef } from "../../src/shared/minds";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { Rig } from "../support/rig";
import { alderChat, answerOf, callTool, KNOWLEDGE, POV, recordFix, toolEnv } from "../support/tools";

/** Words no world text has, so a leak shows. */
const MARK = "KNOW-MARK";

const debt: KnowledgeFact = {
  id: factId({ kind: "track", track: "s_shop_trouble", stage: "truth" }),
  kind: "track",
  claim: `${MARK}: the shop is $112,000 behind on its lease and its loan`,
  about: ["marcus_delgado"],
  truth: "true",
};
const rumorClaim = `${MARK}: a regional chain has been asking about the shop`;
const rumor: KnowledgeFact = { id: claimFactId(rumorClaim, null), kind: "claim", claim: rumorClaim, about: ["marcus_delgado"], truth: "open", source: { msg: null, at: 0 } };

const SAW = "Marcus took a call in the parking lot and hung up when Danny walked by.";

const JORDAN = { id: POV, name: "Jordan Ellis" };
const MARCUS = { id: "marcus_delgado", name: "Marcus Delgado" };
const DANNY = { id: "danny_okafor", name: "Danny Okafor" };
const PRIYA = { id: "priya_nair", name: "Priya Nair" };

/** A person no one in Port Alder knows of: the world keeps him secret. */
const VEX: JsonObject = { id: "vex_morrow", kind: "character", name: "Vex Morrow", tier: "background", visibility: "secret", fields: { place: "alder_automotive" }, relations: [] };

const fact = (f: KnowledgeFact): LedgerEvent => ({ type: MINDS_EVENTS.fact, data: { fact: f as unknown as JsonObject } });
const learn = (d: Omit<LearnEventData, "msg">): LedgerEvent => ({ type: MINDS_EVENTS.learn, data: { ...d, msg: null } as unknown as JsonObject });
const presence = (at: number, saw: string[]): LedgerEvent => ({ type: MINDS_EVENTS.presence, data: { msg: null, at, place: null, who: ["danny_okafor"], saw } });

/** The chat's clock now, and in the world's calendar: when everything a test records is learned. */
async function now(rig: Rig, chatId: string): Promise<{ at: number; since: string }> {
  const { world, state } = await toolEnv(rig, chatId, "gm").reader.view();
  return { at: state.clock, since: formatClock(calendarOf(world), state.clock) };
}

/** Who knows what in Port Alder (see the header), learned now; `since` is when, in the world's calendar. */
async function seed(rig: Rig, chatId: string): Promise<string> {
  const { at, since } = await now(rig, chatId);
  const seen = witnessRef({ at, what: SAW, how: "saw", by: null, place: null });
  await recordFix(rig, chatId, "seed-knowledge", [
    presence(at, [SAW]),
    fact(debt),
    fact(rumor),
    learn({ who: ["marcus_delgado"], fact: debt.id, how: "authored", by: null, evidence: [], belief: "true", confidence: 1, keptFrom: "everyone", at }),
    learn({ who: ["priya_nair"], fact: debt.id, how: "guessed", by: null, evidence: [rumor.id], belief: "uncertain", confidence: 0.3, at }),
    learn({ who: ["danny_okafor"], fact: rumor.id, how: "told", by: "priya_nair", evidence: [seen], belief: "uncertain", confidence: 0.5, keptFrom: ["marcus_delgado"], at }),
    learn({ who: [POV], fact: rumor.id, how: "told", by: "danny_okafor", evidence: [], belief: "true", confidence: 0.8, at }),
  ]);
  expect(rig.rt.ledger.errors).toEqual([]);
  return since;
}

/** The debt's claim as everyone's knowledge reads it: Marcus's secret, kept from everyone. */
const MARKED_DEBT = secretMarkText(debt.claim, ["Marcus Delgado"], "everyone", SECRET_MARK_WORDING);

describe("knowledge_who_knows and knowledge_what_knows: who knows the shop's debt", () => {
  test("under everyone's knowledge, every holder: the debt marked as Marcus's, kept from everyone, Priya's guess a suspicion; the rumour plain, as no one sure of it keeps it", async () => {
    const { rig, chatId } = await alderChat();
    const since = await seed(rig, chatId);
    const marcus = { who: MARCUS, how: "authored", by: null, since, belief: "true", confidence: 1, suspicion: false, keptFrom: "everyone" };
    const priya = { who: PRIYA, how: "guessed", by: null, since, belief: "uncertain", confidence: 0.3, suspicion: true };
    const danny = { who: DANNY, how: "told", by: PRIYA, since, belief: "uncertain", confidence: 0.5, suspicion: true, keptFrom: ["Marcus Delgado"] };
    const jordan = { who: JORDAN, how: "told", by: DANNY, since, belief: "true", confidence: 0.8, suspicion: false };
    // Both share "shop", so by their claims.
    expect(await answerOf(rig, chatId, "everyone", "knowledge_who_knows", { about: "shop's debt" })).toEqual({
      facts: [
        { fact: rumor.id, claim: rumorClaim, holders: [danny, jordan] },
        { fact: debt.id, claim: MARKED_DEBT, holders: [marcus, priya] },
      ],
    });
    expect(await answerOf(rig, chatId, "everyone", "knowledge_what_knows", { person: "Priya" })).toEqual({ who: PRIYA, facts: [{ fact: debt.id, claim: MARKED_DEBT, how: "guessed", by: null, since, belief: "uncertain", confidence: 0.3, suspicion: true }] });
    expect(await answerOf(rig, chatId, "everyone", "knowledge_what_knows", { person: "Priya", about: "lease" })).toEqual({ who: PRIYA, facts: [{ fact: debt.id, claim: MARKED_DEBT, how: "guessed", by: null, since, belief: "uncertain", confidence: 0.3, suspicion: true }] });
    expect(await answerOf(rig, chatId, "everyone", "knowledge_what_knows", { person: "Priya", about: "pontoon" })).toEqual({ who: PRIYA, facts: [] });
  });

  test("under the GM's knowledge, every fact plain with its kind, truth and whom it is about, and what each holding rests on", async () => {
    const { rig, chatId } = await alderChat();
    const since = await seed(rig, chatId);
    expect(await answerOf(rig, chatId, "gm", "knowledge_who_knows", { about: debt.id })).toEqual({
      facts: [
        {
          fact: debt.id,
          claim: debt.claim,
          kind: "track",
          truth: "true",
          about: [MARCUS],
          holders: [
            { who: MARCUS, how: "authored", by: null, since, belief: "true", confidence: 1, suspicion: false, keptFrom: "everyone" },
            { who: PRIYA, how: "guessed", by: null, since, belief: "uncertain", confidence: 0.3, suspicion: true, evidence: [rumor.claim] },
          ],
        },
      ],
    });
    // The quest the debt is the truth of finds it first; the rumour shares a word with the quest's id.
    const quest = await answerOf<{ facts: { fact: string }[] }>(rig, chatId, "gm", "knowledge_who_knows", { about: "s_shop_trouble" });
    expect(quest.facts.map((f) => f.fact)).toEqual([debt.id, rumor.id]);
    // Danny's half-belief rests on what he saw, as his witness log has it.
    expect(await answerOf(rig, chatId, "gm", "knowledge_what_knows", { person: "danny_okafor" })).toEqual({
      who: DANNY,
      facts: [{ fact: rumor.id, claim: rumorClaim, kind: "claim", truth: "open", about: [MARCUS], how: "told", by: PRIYA, since, belief: "uncertain", confidence: 0.5, suspicion: true, keptFrom: ["Marcus Delgado"], evidence: [`${SAW} (saw it, ${since})`] }],
    });
  });

  test("a secret teller and whom a fact is kept from: everyone's view marks them, the GM's names them plainly", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: { vex_morrow: VEX } } });
    const { at, since } = await now(rig, chatId);
    const letterClaim = `${MARK}: someone slid an unsigned letter under the shop door`;
    const letter: KnowledgeFact = { id: claimFactId(letterClaim, null), kind: "claim", claim: letterClaim, about: ["marcus_delgado"], truth: "true", source: { msg: null, at } };
    await recordFix(rig, chatId, "seed-letter", [
      fact(letter),
      learn({ who: [POV], fact: letter.id, how: "told", by: "vex_morrow", evidence: [], belief: "true", confidence: 0.9, keptFrom: ["vex_morrow", "marcus_delgado"], at }),
    ]);
    expect(rig.rt.ledger.errors).toEqual([]);
    // Jordan holds it surely and keeps it from Vex and Marcus: a secret he knows, kept from them.
    const vex = secretMarkText("Vex Morrow", [], "everyone", SECRET_MARK_WORDING);
    expect(await answerOf(rig, chatId, "everyone", "knowledge_who_knows", { about: letter.id })).toEqual({
      facts: [{ fact: letter.id, claim: secretMarkText(letterClaim, ["Jordan Ellis"], ["Vex Morrow", "Marcus Delgado"], SECRET_MARK_WORDING), holders: [{ who: JORDAN, how: "told", by: { id: "vex_morrow", name: vex }, since, belief: "true", confidence: 0.9, suspicion: false, keptFrom: [vex, "Marcus Delgado"] }] }],
    });
    expect(await answerOf(rig, chatId, "gm", "knowledge_who_knows", { about: letter.id })).toEqual({
      facts: [{ fact: letter.id, claim: letterClaim, kind: "claim", truth: "true", about: [MARCUS], holders: [{ who: JORDAN, how: "told", by: { id: "vex_morrow", name: "Vex Morrow", visibility: "secret" }, since, belief: "true", confidence: 0.9, suspicion: false, keptFrom: ["Vex Morrow", "Marcus Delgado"] }] }],
    });
  });

  test("a chat that has learned nothing answers with nothing held, in every knowledge; a call without its argument is told what it needs", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) {
      expect(await answerOf(rig, chatId, knowledge, "knowledge_who_knows", { about: "shop" })).toEqual({ facts: [] });
      expect(await answerOf(rig, chatId, knowledge, "knowledge_what_knows", { person: "Jordan Ellis" })).toEqual({ who: JORDAN, facts: [] });
      const missing = await callTool(rig, chatId, knowledge, "knowledge_who_knows", {});
      expect(missing.error).toBe(true);
      expect(missing.text).toStartWith("knowledge_who_knows needs about:");
    }
  });

  test("about takes a book entry by any of its lore ids: its short id, a mark's with #n, or its book and entry", async () => {
    const { rig, chatId } = await alderChat();
    const { at } = await now(rig, chatId);
    const mark = factId({ kind: "wi", book: "harbor_book", entry: "entry_1", mark: 1 });
    const breakwater: KnowledgeFact = { id: mark, kind: "wi", claim: `${MARK}: the breakwater was rebuilt after the storm`, about: [], truth: "true" };
    await recordFix(rig, chatId, "seed-lore", [fact(breakwater), learn({ who: ["marcus_delgado"], fact: mark, how: "authored", by: null, evidence: [], belief: "true", confidence: 1, at })]);
    const ids = await rig.rt.loreRouting.ids.assign(rig.host.userId, [{ bookId: "harbor_book", entryId: "entry_1", keys: [] }], (await rig.rt.settings.get(rig.host.userId)).loreIndex);
    const short = ids.get("harbor_book/entry_1") ?? "";
    expect(short).not.toBe("");
    // The mark by its short id and number, the entry whole (its marks), by its book and entry: each finds Marcus's fact.
    for (const about of [`${short}#2`, short, "harbor_book/entry_1", "harbor_book/entry_1#2"]) {
      const found = await answerOf<{ facts: { fact: string }[] }>(rig, chatId, "gm", "knowledge_who_knows", { about });
      expect([about, found.facts.map((f) => f.fact)]).toEqual([about, [mark]]);
    }
    expect((await answerOf<{ facts: { fact: string }[] }>(rig, chatId, "gm", "knowledge_what_knows", { person: "Marcus", about: `${short}#2` })).facts.map((f) => f.fact)).toEqual([mark]);
    // Another mark of it, which no one holds, finds nothing.
    expect(await answerOf(rig, chatId, "gm", "knowledge_who_knows", { about: `${short}#1` })).toEqual({ facts: [] });
  });
});
