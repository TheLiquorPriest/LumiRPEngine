// GM → Minds against the backend, for what each person knows (DESIGN §24.9, §24.11): each character's
// holdings and the player character's own, as the tab reads them from `lre.gm`, and a holding set,
// changed and taken away from its page through `lre.edit`, each with its Undo. Nothing the player
// character doesn't hold reaches anything Play is pushed; what they hold is theirs to see in What you
// know.

import { describe, expect, test } from "bun:test";
import { forgetOp, holdingDraft, holdingOp } from "../../src/packs/minds/ui/ops";
import { editRequest } from "../../src/frontend/requests";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import { claimFactId, factId, KNOWLEDGE_DEFAULTS, MINDS_EVENTS, MINDS_KEEP, witnessRef, type KnowledgeFact, type LearnEventData, type MindsGmHolding, type MindsGmView } from "../../src/shared/minds";
import type { EditOp } from "../../src/shared/protocol";
import { Rig } from "../support/rig";

/** Words no world text has, so a leak into Play shows: the claim of a fact the player character doesn't hold. */
const MARK = "KNOW-MARK";
/** The words of what the player character was told, which Play's What you know shows them. */
const HEARD = "HEARD-MARK";

const debt: KnowledgeFact = {
  id: factId({ kind: "track", track: "s_shop_trouble", stage: "truth" }),
  kind: "track",
  claim: `${MARK}: the shop is $112,000 behind on its lease and its loan`,
  about: ["marcus_delgado"],
  truth: "true",
};
const rumorClaim = `${HEARD}: a regional chain has been asking about the shop`;
const rumor: KnowledgeFact = { id: claimFactId(rumorClaim, null), kind: "claim", claim: rumorClaim, about: ["marcus_delgado"], truth: "open", source: { msg: null, at: 0 } };

const SAW = "Marcus took a call in the parking lot and hung up when Danny walked by.";

async function minds(rig: Rig, chatId: string): Promise<MindsGmView> {
  return rig.body(await rig.send({ type: "lre.gm", chatId })).minds as MindsGmView;
}

/** What one person holds as the tab lists it: a character's section, or the player character's page. */
async function holdings(rig: Rig, chatId: string, entity: string): Promise<MindsGmHolding[]> {
  const view = await minds(rig, chatId);
  if (view.knowledge.pov?.entity === entity) return view.knowledge.pov.holdings;
  const c = view.characters.find((x) => x.entity === entity);
  if (!c) throw new Error(`no ${entity}`);
  return c.holdings;
}

async function held(rig: Rig, chatId: string, entity: string, fact: string): Promise<MindsGmHolding | undefined> {
  return (await holdings(rig, chatId, entity)).find((h) => h.fact === fact);
}

async function edit(rig: Rig, chatId: string, op: EditOp | null): Promise<void> {
  if (!op) throw new Error("the form refused it");
  rig.body(await rig.send(editRequest(chatId, [op]) as unknown as Record<string, unknown>));
}

async function undoLatest(rig: Rig, chatId: string): Promise<void> {
  const undo = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
  if (!undo) throw new Error("no Undo chip");
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: undo.id, choice: "undo" }));
}

/** A Port Alder chat, and its player character's id. */
async function alder(): Promise<{ rig: Rig; chatId: string; pov: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  const gm = rig.body(await rig.send({ type: "lre.gm", chatId })) as { entities: { id: string; pov: boolean }[] };
  const pov = gm.entities.find((e) => e.pov)?.id;
  if (!pov) throw new Error("no player character");
  return { rig, chatId, pov };
}

/** Events written to the chat as one correction, as the turn that learned them would record them. */
async function record(rig: Rig, chatId: string, id: string, events: LedgerEvent[]): Promise<void> {
  await rig.rt.ledger.write(chatId, rig.host.userId, { kind: "post", id, target: "head", entry: { kind: "fix", events } });
}

const fact = (f: KnowledgeFact): LedgerEvent => ({ type: MINDS_EVENTS.fact, data: { fact: f as unknown as JsonObject } });
const learn = (d: Omit<LearnEventData, "msg">): LedgerEvent => ({ type: MINDS_EVENTS.learn, data: { ...d, msg: null } as unknown as JsonObject });
const presence = (at: number, saw: string[]): LedgerEvent => ({ type: MINDS_EVENTS.presence, data: { msg: null, at, place: null, who: ["danny_okafor"], saw } });

/**
 * Who knows what in Port Alder: Marcus keeps the shop's debt from everyone; Priya only guesses at
 * it, from the rumour; Danny half-believes the rumour Priya told him, from what he saw, and keeps
 * it from Marcus; and Danny told the player character.
 */
async function seed(rig: Rig, chatId: string, pov: string): Promise<{ now: number; seen: string }> {
  const now = (await minds(rig, chatId)).now;
  const seen = witnessRef({ at: now, what: SAW, how: "saw", by: null, place: null });
  await record(rig, chatId, "seed-knowledge", [
    presence(now, [SAW]),
    fact(debt),
    fact(rumor),
    learn({ who: ["marcus_delgado"], fact: debt.id, how: "authored", by: null, evidence: [], belief: "true", confidence: 1, keptFrom: "everyone", at: now }),
    learn({ who: ["priya_nair"], fact: debt.id, how: "guessed", by: null, evidence: [rumor.id], belief: "uncertain", confidence: 0.3, at: now }),
    learn({ who: ["danny_okafor"], fact: rumor.id, how: "told", by: "priya_nair", evidence: [seen], belief: "uncertain", confidence: 0.5, keptFrom: ["marcus_delgado"], at: now }),
    learn({ who: [pov], fact: rumor.id, how: "told", by: "danny_okafor", evidence: [], belief: "true", confidence: 0.8, at: now }),
  ]);
  return { now, seen };
}

/** Nothing Play is pushed, nor the view Play reads, carries the words of a fact the player character doesn't hold. */
function playNeverSees(rig: Rig, chatId: string): void {
  for (const m of rig.host.sent) if (m.type === "lre.state.snapshot" || m.type === "lre.state.delta") expect(JSON.stringify(m)).not.toContain(MARK);
  expect(JSON.stringify(rig.latestView(chatId))).not.toContain(MARK);
}

describe("GM → Minds: what each person knows", () => {
  test("each character's holdings and the player character's own, with how, from whom, how sure, from whom it's kept and what it rests on", async () => {
    const { rig, chatId, pov } = await alder();
    const { seen } = await seed(rig, chatId, pov);
    const view = await minds(rig, chatId);
    const name = (id: string): string | undefined => view.characters.find((c) => c.entity === id)?.name;
    expect(view.knowledge.threshold).toBe(KNOWLEDGE_DEFAULTS.threshold);

    // Every fact, with who holds it.
    expect(Object.fromEntries(view.knowledge.facts.map((f) => [f.id, f.holders]))).toEqual({
      [debt.id]: ["marcus_delgado", "priya_nair"],
      [rumor.id]: ["danny_okafor", pov].sort(),
    });

    expect(await holdings(rig, chatId, "marcus_delgado")).toEqual([
      expect.objectContaining({ fact: debt.id, claim: debt.claim, kind: "track", truth: "true", how: "authored", byName: null, confidence: 1, suspicion: false, keptFromNames: "everyone", evidenceShown: [] }),
    ]);
    // Held less surely than the threshold, a guess is a suspicion; what it rests on reads as its claim.
    expect(await holdings(rig, chatId, "priya_nair")).toEqual([
      expect.objectContaining({ fact: debt.id, how: "guessed", belief: "uncertain", confidence: 0.3, suspicion: true, keptFromNames: [], evidenceShown: [{ ref: rumor.id, kind: "fact", text: rumor.claim }] }),
    ]);
    // A told one names its teller; a witness entry it rests on reads as the line in their log.
    const dannys = await held(rig, chatId, "danny_okafor", rumor.id);
    expect(dannys).toMatchObject({ kind: "claim", truth: "open", how: "told", byName: name("priya_nair"), confidence: 0.5, suspicion: true, keptFromNames: [name("marcus_delgado")] });
    expect(dannys?.evidenceShown).toEqual([{ ref: seen, kind: "witness", text: expect.stringContaining(SAW) }]);
    expect(dannys?.sinceText).not.toBe("");

    // The player character has no mind and no character entry, but a page of what they know.
    expect(view.characters.some((c) => c.entity === pov)).toBe(false);
    expect(view.knowledge.pov?.entity).toBe(pov);
    expect(view.knowledge.pov?.name).not.toBe("");
    expect(view.knowledge.pov?.holdings).toEqual([expect.objectContaining({ fact: rumor.id, how: "told", byName: name("danny_okafor"), confidence: 0.8, suspicion: false, keptFromNames: [] })]);
    // What they hold is theirs: Play's What you know lists it.
    expect(JSON.stringify((await rig.rt.view(chatId, rig.host.userId)).panels["minds.known"])).toContain(HEARD);

    playNeverSees(rig, chatId);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a holding outlives the witness entry it rests on: once their log no longer keeps it, the evidence reads as gone", async () => {
    const { rig, chatId, pov } = await alder();
    const { now, seen } = await seed(rig, chatId, pov);
    // As many newer things seen as the log keeps push the first out.
    await record(rig, chatId, "seen-more", [presence(now + 1, Array.from({ length: MINDS_KEEP.witness }, (_, i) => `Danny watched car ${i + 1} pull into the shop.`))]);
    const dannys = await held(rig, chatId, "danny_okafor", rumor.id);
    expect(dannys).toMatchObject({ how: "told", confidence: 0.5, suspicion: true });
    expect(dannys?.evidenceShown).toEqual([{ ref: seen, kind: "gone", text: expect.any(String) }]);
    expect(JSON.stringify(dannys?.evidenceShown)).not.toContain(SAW);
  });

  test("a holding is set, changed and taken away from its page, each with its Undo, the player character's too", async () => {
    const { rig, chatId, pov } = await alder();
    const { now } = await seed(rig, chatId, pov);
    const name = async (id: string): Promise<string | undefined> => (await minds(rig, chatId)).characters.find((c) => c.entity === id)?.name;
    const danny = await name("danny_okafor");
    const marcus = await name("marcus_delgado");
    expect(await held(rig, chatId, "priya_nair", rumor.id)).toBeUndefined();

    // The form refuses a told one with no teller, someone told by themselves, and a confidence that isn't a percent.
    const told = { ...holdingDraft(now), how: "told" as const, by: "danny_okafor", confidence: "60", kept: "some" as const, keptFrom: ["marcus_delgado"] };
    expect(holdingOp("priya_nair", rumor.id, { ...told, by: null })).toBeNull();
    expect(holdingOp("priya_nair", rumor.id, { ...told, by: "priya_nair" })).toBeNull();
    expect(holdingOp("priya_nair", rumor.id, { ...told, confidence: "150" })).toBeNull();
    // A fact the chat doesn't hold is refused by the backend.
    const unknown = await rig.send(editRequest(chatId, [holdingOp("priya_nair", claimFactId("Nobody said this", null), told)].flatMap((op) => (op ? [op] : []))) as unknown as Record<string, unknown>);
    expect(unknown.type).toBe("lre.error");

    await edit(rig, chatId, holdingOp("priya_nair", rumor.id, told));
    const first = await held(rig, chatId, "priya_nair", rumor.id);
    expect(first).toMatchObject({ how: "told", byName: danny, confidence: 0.6, suspicion: true, keptFromNames: [marcus] });
    if (!first) throw new Error("no holding");

    await edit(rig, chatId, holdingOp("priya_nair", rumor.id, { ...holdingDraft(now, first), confidence: "90", kept: "none" }));
    expect(await held(rig, chatId, "priya_nair", rumor.id)).toMatchObject({ how: "told", byName: danny, confidence: 0.9, suspicion: false, keptFromNames: [] });
    await undoLatest(rig, chatId);
    expect(await held(rig, chatId, "priya_nair", rumor.id)).toEqual(first);

    await edit(rig, chatId, forgetOp("priya_nair", rumor.id));
    expect(await held(rig, chatId, "priya_nair", rumor.id)).toBeUndefined();
    expect((await minds(rig, chatId)).knowledge.facts.find((f) => f.id === rumor.id)?.holders).not.toContain("priya_nair");
    await undoLatest(rig, chatId);
    expect(await held(rig, chatId, "priya_nair", rumor.id)).toEqual(first);

    playNeverSees(rig, chatId);
    // The player character's page sets theirs the same way. A secret they only suspect is no reveal,
    // so What you know never words it; once they're sure of it, it is theirs to see, until Undo takes
    // it away again.
    const known = async (): Promise<string> => JSON.stringify((await rig.rt.view(chatId, rig.host.userId)).panels["minds.known"]);
    await edit(rig, chatId, holdingOp(pov, debt.id, { ...holdingDraft(now), how: "witnessed", belief: "uncertain", confidence: "40", kept: "everyone" }));
    expect(await held(rig, chatId, pov, debt.id)).toMatchObject({ how: "witnessed", belief: "uncertain", confidence: 0.4, suspicion: true, keptFromNames: "everyone" });
    expect(await known()).not.toContain(MARK);
    await edit(rig, chatId, holdingOp(pov, debt.id, { ...holdingDraft(now), how: "witnessed", belief: "true", confidence: "90", kept: "everyone" }));
    expect(await known()).toContain(MARK);
    await undoLatest(rig, chatId);
    await undoLatest(rig, chatId);
    expect(await held(rig, chatId, pov, debt.id)).toBeUndefined();
    expect(JSON.stringify((await rig.rt.view(chatId, rig.host.userId)).panels["minds.known"])).not.toContain(MARK);
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain(MARK);

    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("swipes keep a holding the GM set, Re-narrate and Re-run alike", async () => {
    const { rig, chatId, pov } = await alder();
    await rig.turn(chatId, "I wait on the porch.", "The street wakes up around you.");
    const { now } = await seed(rig, chatId, pov);
    await edit(rig, chatId, holdingOp("helen_kowalczyk", rumor.id, { ...holdingDraft(now), how: "told", by: "danny_okafor", confidence: "75" }));
    const set = await held(rig, chatId, "helen_kowalczyk", rumor.id);
    expect(set).toMatchObject({ how: "told", confidence: 0.75, suspicion: false });

    rig.rt.setSwipeChoice(chatId, "renarrate");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "The street wakes slowly.");
    expect(await held(rig, chatId, "helen_kowalczyk", rumor.id)).toEqual(set);
    rig.rt.setSwipeChoice(chatId, "rerun");
    await rig.host.finish(await rig.host.start(chatId, { type: "swipe" }), "A third morning.");
    expect(await held(rig, chatId, "helen_kowalczyk", rumor.id)).toEqual(set);

    playNeverSees(rig, chatId);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
