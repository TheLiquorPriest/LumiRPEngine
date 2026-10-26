// What a reply told that the engine has no place for (DESIGN §9.5): a fact told in prose, a thing
// as a newcomer. The story stands, so the read shows it as not tracked, asks nothing and never tells
// the next reply it didn't happen; a refusal by the world's rules still does. Neither the receipts
// nor extract's input tell of a place the player character hasn't heard of. And extract is asked
// for what its knows and spawn channels take (DESIGN §9.4).

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { chipRole } from "../../src/frontend/chip-roles";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "You read a narrator's roleplay reply";
const MARCUS = "marcus_delgado";
const DANNY = "danny_okafor";
/** A place kept to those who know it, which the player character hasn't heard of. */
const COVE = "smugglers_cove";

async function portAlder(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** Port Alder with Smugglers' Cove, which the player character hasn't heard of, and Danny there. */
async function dannyAtTheCove(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id: COVE, value: { id: COVE, name: "Smugglers' Cove", parent: "port_alder", visibility: "known_by", fields: {} } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: DANNY, to: COVE }] }));
  return { rig, chatId };
}

/** Extract answers `extract`, keeping each prompt it is given; every other step says nothing. */
function script(rig: Rig, extract: JsonObject): string[] {
  const prompts: string[] = [];
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (system.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    if (!system.includes(EXTRACT_MARK)) return "{}";
    prompts.push(system);
    return JSON.stringify(extract);
  };
  return prompts;
}

/** The player's message and the next prompt's Outcome section, before its reply is written. */
async function nextOutcome(rig: Rig, chatId: string, text: string): Promise<string> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  const outcome = rig.host.section("Outcome");
  await rig.host.finish(g, "The lot is quiet.");
  return outcome;
}

describe("a change the engine has no place for", () => {
  test("a fact told in prose or a thing as a newcomer is Not tracked: a receipt, no card, no note, and the next reply isn't told it didn't happen; a refused payment still is", async () => {
    const { rig, chatId } = await portAlder();
    script(rig, {
      proposals: [
        { type: "knows", who: "pov", fact: "Fourteen vehicles are going out to bid." },
        { type: "spawn", kind: "item", name: "Unsigned letter" },
        // Something already so changes nothing to show.
        { type: "knows", who: "pov", fact: "pov" },
        { type: "transfer", from: MARCUS, to: "pov", amount: 0 },
      ],
      where: null,
    });
    await rig.turn(chatId, "I read the notice.", "Marcus slides an unsigned letter across the desk: fourteen vehicles are going out to bid.");
    const head = rig.host.head(chatId);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id);
    const untracked = chips.filter((c) => c.kind === "untracked");
    // One receipt for the thing the reply introduced and one for the fact told in prose, each naming it.
    expect(untracked).toHaveLength(2);
    expect(untracked.filter((c) => c.label.includes("Unsigned letter"))).toHaveLength(1);
    expect(untracked.filter((c) => c.label.includes("Fourteen vehicles are going out to bid"))).toHaveLength(1);
    // A receipt: nothing to answer before the next send.
    for (const c of untracked) expect([c.actions, chipRole(c)]).toEqual([[], "done"]);
    const declines = chips.filter((c) => c.kind === "decline");
    expect(declines.map((c) => c.label)).toEqual([expect.stringContaining("Marcus Delgado paid")]);
    const notes = (await rig.rt.outcomeNotes.list(chatId, rig.host.userId)).map((n) => n.text);
    expect(notes).toEqual([expect.stringContaining("didn't happen")]);
    const outcome = await nextOutcome(rig, chatId, "I fold the letter away.");
    for (const said of ["Fourteen vehicles", "Unsigned letter"]) expect(outcome).not.toContain(said);
    expect(outcome).toMatch(/Marcus Delgado paid.*didn't happen/);
  });

  test("extract is asked for what its channels take: knows by id, never a sentence; spawn a newcomer of the world's person kinds, never a thing", async () => {
    const { rig, chatId } = await portAlder();
    const prompts = script(rig, { proposals: [], where: null });
    await rig.turn(chatId, "I look around.", "Gulls wheel over the lot.");
    const prompt = prompts[0] ?? "";
    expect(prompt).toContain("knows{who,fact} (fact: the id of a person, thing or place the player character newly learns of, or the name of a place they first hear of; never a sentence)");
    expect(prompt).toContain("spawn{kind,name,place?,role?} (a new character the reply introduces by name; kind: character|person; never a thing)");
    expect(prompt).toContain("knows only when the player character newly learns of a public person, thing or place");
  });

  test("a refused fact naming a place the player character hasn't heard of gets no receipt, by id or by name; one about a place it knows still does", async () => {
    const { rig, chatId } = await dannyAtTheCove();
    // Someone else's learning is refused: by the place's id, by its name, and of a place the player character knows.
    script(rig, { proposals: [{ type: "knows", who: DANNY, fact: COVE }, { type: "knows", who: DANNY, fact: "Smugglers' Cove" }, { type: "knows", who: DANNY, fact: "alder_market" }], where: null });
    await rig.turn(chatId, "I call Danny.", "Danny says he's down by the water, patching a hull.");
    const head = rig.host.head(chatId);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id);
    expect(chips.filter((c) => c.kind === "untracked").map((c) => c.label)).toEqual(["Not tracked: Danny Okafor learns: Alder Market"]);
    expect(JSON.stringify(chips).toLowerCase()).not.toContain("smuggler");
  });

  test("extract is never told someone is at a place the player character hasn't heard of", async () => {
    const { rig, chatId } = await dannyAtTheCove();
    script(rig, { proposals: [], where: null });
    const calls = rig.host.quietCalls.length;
    await rig.turn(chatId, "I call Danny.", "Danny says he's down by the water, patching a hull.");
    const read = rig.host.quietCalls.slice(calls).find((r) => (r.messages[0]?.content ?? "").includes(EXTRACT_MARK));
    expect(read?.messages[1]?.content).toContain(`"${DANNY}":{"name":"Danny Okafor"`);
    expect(JSON.stringify(read?.messages ?? []).toLowerCase()).not.toContain("smuggler");
  });
});
