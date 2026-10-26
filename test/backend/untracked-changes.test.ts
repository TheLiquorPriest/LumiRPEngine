// What a reply told that the engine has no place for (DESIGN §9.5): a fact told in prose, a thing
// as a newcomer. The story stands, so the read shows it as not tracked, asks nothing and never tells
// the next reply it didn't happen; a refusal by the world's rules still does. A receipt never names
// a person, place or thing the player character doesn't know, and reads the same whether that is
// hidden or nowhere in the world (DESIGN §11); extract's input never names a place the player
// character hasn't heard of. And extract is asked for what its knows and spawn channels take (DESIGN §9.4).

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { chipRole } from "../../src/frontend/chip-roles";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "You read a narrator's roleplay reply";
const MARCUS = "marcus_delgado";
const DANNY = "danny_okafor";
/** A place kept to those who know it, and a secret one: the player character has heard of neither. */
const COVE = "smugglers_cove";
const MILL = "old_mill";
/** A secret person the player character has never met. */
const RUTH = "ruth_calder";
const TOLD = "The story stands as told, and the next reply isn't told otherwise.";
/** The receipt of a change naming someone or something the player character doesn't know. */
const UNKNOWN = { kind: "untracked" as const, detail: `the engine keeps only whom and what you know of. ${TOLD}`, actions: [] };

async function portAlder(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** Port Alder with Smugglers' Cove (kept to those who know it) and the secret Old Mill, Danny at the one and Marcus at the other. */
async function alderWithHiddenPlaces(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  for (const [id, name, visibility] of [
    [COVE, "Smugglers' Cove", "known_by"],
    [MILL, "The Old Mill", "secret"],
  ] as const)
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id, value: { id, name, parent: "port_alder", visibility, fields: {} } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "move", entity: DANNY, to: COVE }, { op: "move", entity: MARCUS, to: MILL }] }));
  return { rig, chatId };
}

/** Port Alder with the secret Old Mill and Ruth Calder, a secret person there: the player character knows of neither. */
async function alderWithStrangers(): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "places", id: MILL, value: { id: MILL, name: "The Old Mill", parent: "port_alder", visibility: "secret", fields: {} } }));
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: RUTH, value: { id: RUTH, kind: "character", name: "Ruth Calder", tier: "background", visibility: "secret", fields: { place: MILL }, relations: [] } }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** The read's chips on the reply after `proposals` are read from it: what each says and offers. */
async function readChips({ rig, chatId }: { rig: Rig; chatId: string }, proposals: JsonObject[], reply: string): Promise<unknown[]> {
  script(rig, { proposals, where: null });
  await rig.turn(chatId, "I ask around.", reply);
  const head = rig.host.head(chatId);
  const chips = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id && ["untracked", "decline", "confirm", "undo"].includes(c.kind));
  return chips.map((c) => ({ kind: c.kind, label: c.label, detail: c.detail, actions: c.actions }));
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
        { type: "knows", who: "pov", fact: "The ferry stops running at nine." },
        { type: "spawn", kind: "item", name: "Brass key" },
        // Something already so changes nothing to show.
        { type: "knows", who: "pov", fact: "pov" },
        { type: "transfer", from: MARCUS, to: "pov", amount: 0 },
      ],
      where: null,
    });
    await rig.turn(chatId, "I read the notice.", "Marcus slides a brass key across the desk: the ferry stops running at nine.");
    const head = rig.host.head(chatId);
    const chips = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id);
    const untracked = chips.filter((c) => c.kind === "untracked");
    // One receipt for the thing the reply introduced, by its name, and one for the fact told in prose,
    // which names nothing the player character knows.
    expect(untracked).toHaveLength(2);
    expect(untracked.filter((c) => c.label.includes("Brass key"))).toHaveLength(1);
    expect(untracked.filter((c) => c.label === "Not tracked: You learn: something you don't know")).toHaveLength(1);
    // A receipt: nothing to answer before the next send.
    for (const c of untracked) expect([c.actions, chipRole(c)]).toEqual([[], "done"]);
    const declines = chips.filter((c) => c.kind === "decline");
    expect(declines.map((c) => c.label)).toEqual([expect.stringContaining("Marcus Delgado paid")]);
    const notes = (await rig.rt.outcomeNotes.list(chatId, rig.host.userId)).map((n) => n.text);
    expect(notes).toEqual([expect.stringContaining("didn't happen")]);
    const outcome = await nextOutcome(rig, chatId, "I pocket the key.");
    for (const said of ["ferry", "Brass key"]) expect(outcome).not.toContain(said);
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

  test("a refused fact never names a place the player character doesn't know, and reads the same whether or not the world holds it: by id or by name, known to those who know it or secret; and extract never sees either place", async () => {
    // The reply tells of the Old Mill, and of Danny hearing of Smugglers' Cove.
    const proposals: JsonObject[] = [
      { type: "knows", fact: "Old Mill" },
      { type: "knows", who: "pov", fact: MILL },
      { type: "knows", who: DANNY, fact: "Smugglers' Cove" },
      { type: "knows", who: DANNY, fact: COVE },
      { type: "knows", who: DANNY, fact: "alder_market" },
    ];
    const receipts = async ({ rig, chatId }: { rig: Rig; chatId: string }) => {
      script(rig, { proposals, where: null });
      const calls = rig.host.quietCalls.length;
      await rig.turn(chatId, "I ask around.", "You hear about the Old Mill, and Danny says he heard of Smugglers' Cove.");
      const head = rig.host.head(chatId);
      const chips = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id && ["untracked", "decline", "confirm", "undo"].includes(c.kind));
      const read = rig.host.quietCalls.slice(calls).find((r) => (r.messages[0]?.content ?? "").includes(EXTRACT_MARK));
      return { shown: chips.map((c) => ({ kind: c.kind, label: c.label, detail: c.detail, actions: c.actions })), read };
    };
    const without = await receipts(await portAlder());
    const hidden = await receipts(await alderWithHiddenPlaces());
    expect(without.shown).toEqual([
      { ...UNKNOWN, label: "Not tracked: You learn: something you don't know" },
      { ...UNKNOWN, label: "Not tracked: You learn: something you don't know" },
      { ...UNKNOWN, label: "Not tracked: Danny Okafor learns: something you don't know" },
      { ...UNKNOWN, label: "Not tracked: Danny Okafor learns: something you don't know" },
      { kind: "untracked", label: "Not tracked: Danny Okafor learns: Alder Market", detail: `a reply only teaches the player character. ${TOLD}`, actions: [] },
    ]);
    expect(hidden.shown).toEqual(without.shown);
    // What extract is given besides the reply itself: the world brief and the state, where Danny and Marcus are nowhere it may name.
    const [stateLine = ""] = (hidden.read?.messages[1]?.content ?? "").split("\n");
    expect(stateLine).toContain(`"${DANNY}":{"name":"Danny Okafor"`);
    for (const said of [hidden.read?.messages[0]?.content ?? "", stateLine]) for (const place of [COVE, MILL, "Smugglers' Cove", "Old Mill"]) expect(said).not.toContain(place);
  });

  test("a move or a person the player character doesn't know reads the same in every world: by id or by name, secret or nowhere in the world, it is a receipt that names neither", async () => {
    // The reply walks you and Marcus to the Old Mill, Ruth Calder to the market, and has her warm to you.
    const proposals: JsonObject[] = [
      { type: "location", entity: "pov", place: MILL },
      { type: "location", entity: MARCUS, place: "Old Mill" },
      { type: "location", entity: RUTH, place: "alder_market" },
      { type: "regard", from: "Ruth Calder", to: "pov", axis: "trust", delta: 1 },
      // Whom and where the player character knows still read by name, and the move applies.
      { type: "location", entity: DANNY, place: "alder_market" },
    ];
    const reply = "You and Marcus walk out to the old mill. Ruth Calder heads for the market and nods at you; Danny goes too.";
    const without = await readChips(await portAlder(), proposals, reply);
    const hidden = await readChips(await alderWithStrangers(), proposals, reply);
    expect(without).toEqual([
      { kind: "undo", label: "Danny Okafor went to Alder Market", detail: "Applied automatically.", actions: [{ id: "undo", label: "Undo", style: "danger" }] },
      { ...UNKNOWN, label: "Not tracked: You went to a place you don't know" },
      { ...UNKNOWN, label: "Not tracked: Marcus Delgado went to a place you don't know" },
      { ...UNKNOWN, label: "Not tracked: Someone you don't know went to Alder Market" },
      { ...UNKNOWN, label: "Not tracked: Someone you don't know's trust toward you rose by 1" },
    ]);
    expect(hidden).toEqual(without);
  });
});
