// GM → Minds on demand and lore pins on the fake host (DESIGN §24.5, §24.9): Run minds now records
// the chosen characters' minds from the chat so far as one GM edit with its Undo; lore pinned to a
// character and to a place reaches that character's mind and every helper and mind call there, and
// a secret pinned there reaches none of them; a pin to a missing entry is linted.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { JsonObject } from "../../src/shared/json";
import type { MindsRunView } from "../../src/shared/minds";
import type { WorldDoc } from "../../src/shared/world";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { readCharacter } from "../../src/packs/minds/core/state";
import { lint, newWorld } from "../../src/studio-api";
import { Rig } from "../support/rig";

const PEOPLE = ["danny_okafor", "priya_nair"] as const;
const MIND = /You are the private mind of (.+?) in the roleplay world/;

/** Mind calls answer with `mark` in the monologue; every other step says nothing. */
function fakeModels(rig: Rig, mark: { text: string }): void {
  rig.host.quietReply = (req: QuietRequest) => {
    const mind = MIND.exec(req.messages[0]?.content ?? "")?.[1];
    if (mind) return JSON.stringify({ monologue: `${mark.text} thoughts of ${mind}.`, depiction: `${mind} looks up`, intent: "wait and see", reactions: [], plans: [], mood: "calm" });
    if ((req.messages[0]?.content ?? "").includes("You map a player's typed input")) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    return JSON.stringify({ proposals: [] });
  };
}

const mindCalls = (rig: Rig): QuietRequest[] => rig.host.quietCalls.filter((c) => MIND.test(c.messages[0]?.content ?? ""));
const nameOf = (c: QuietRequest): string => MIND.exec(c.messages[0]?.content ?? "")?.[1] ?? "";

async function stateOf(rig: Rig, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const state = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  return { state, world };
}

/** Port Alder with Danny and Priya Live beside the POV; `setup` writes lore and pins into the draft (it gets the POV's start place) before the commit. */
async function alderChat(rig: Rig, setup: (worldId: string, here: string) => Promise<void> = async () => undefined): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [...PEOPLE] } } }));
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
  await setup(worldId, draft.start.place);
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
  const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov");
  if (!here) throw new Error("the POV is nowhere");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: PEOPLE.map((entity) => ({ op: "move", entity, to: here })) }));
  return chatId;
}

/** The run's last update, once it has ended. */
async function runEnd(rig: Rig, runId: string): Promise<MindsRunView> {
  const last = await rig.host.sentWhere((m) => m.type === "lre.minds.update" && m.run.runId === runId && m.run.status !== "running");
  if (last.type !== "lre.minds.update") throw new Error("not a minds run update");
  return last.run;
}

describe("Run minds now (GM → Minds)", () => {
  test("records the chosen characters' minds from the chat so far, as one GM edit with its Undo, and tells the player nothing", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    const mark = { text: "TURN-MARK" };
    fakeModels(rig, mark);
    const chatId = await alderChat(rig);
    await rig.turn(chatId, "Hello.", "LAST-REPLY-MARK: Danny nods. Priya smiles at you.");
    const before = mindCalls(rig).length;
    mark.text = "RUN-MARK";
    const started = rig.body(await rig.send({ type: "lre.minds", op: "run", chatId, who: ["danny_okafor"] })).run as MindsRunView;
    expect(started.status).toBe("running");
    const done = await runEnd(rig, started.runId);
    expect(done.status).toBe("done");
    expect(done.entries.map((e) => [e.entity, e.status])).toEqual([["danny_okafor", "recorded"]]);
    // Only Danny was asked, on the chat so far: how the latest reply ended.
    const calls = mindCalls(rig).slice(before);
    expect(calls.map(nameOf)).toEqual(["Danny Okafor"]);
    expect(calls[0]?.messages[1]?.content ?? "").toContain("LAST-REPLY-MARK");
    let { state } = await stateOf(rig, chatId);
    expect(readCharacter(state, "danny_okafor").mind?.monologue).toContain("RUN-MARK");
    expect(readCharacter(state, "danny_okafor").mind?.reason).toBe("gm");
    expect(readCharacter(state, "priya_nair").mind?.monologue).toContain("TURN-MARK");
    // No player surface tells the mind.
    expect(JSON.stringify(rig.latestView(chatId))).not.toContain("RUN-MARK");
    // One edit: its Undo takes the run's mind back.
    expect(done.undo).toMatch(/^fix:/);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: done.undo ?? "", choice: "undo" }));
    ({ state } = await stateOf(rig, chatId));
    expect(readCharacter(state, "danny_okafor").mind?.monologue).toContain("TURN-MARK");
    // Everyone Live and Near when nobody is named; a second run while one runs is refused.
    const all = rig.body(await rig.send({ type: "lre.minds", op: "run", chatId })).run as MindsRunView;
    expect(all.entries.map((e) => e.entity).sort()).toEqual([...PEOPLE]);
    const again = await rig.send({ type: "lre.minds", op: "run", chatId });
    expect(again.type === "lre.error" && again.code).toBe("conflict");
    expect((await runEnd(rig, all.runId)).entries.every((e) => e.status === "recorded")).toBe(true);
  });

  test("a mind that comes back empty says why, and nothing is recorded", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    const chatId = await alderChat(rig);
    rig.host.quietReply = () => "";
    const run = rig.body(await rig.send({ type: "lre.minds", op: "run", chatId, who: ["priya_nair"] })).run as MindsRunView;
    const done = await runEnd(rig, run.runId);
    expect(done.status).toBe("failed");
    expect(done.entries[0]?.reason).toBe("the answer was empty");
    expect(done.undo).toBeNull();
  });
});

describe("lore pins", () => {
  test("reach the pinned character's mind, and every helper and mind call at the pinned place; a secret pinned there reaches none", async () => {
    const rig = new Rig({ shipped: true, minds: true });
    fakeModels(rig, { text: "TURN-MARK" });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "full" } } }));
    const user = rig.host.userId;
    const book = await rig.host.books.create("Town lore", "", user);
    const bookEntry = await rig.host.books.createEntry(book, { comment: "Town notice", content: "BOOK-PIN: the harbor closes at dusk.", keys: [], disabled: false, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {} }, user);
    const chatId = await alderChat(rig, async (worldId, here) => {
      const put = async (id: string, value: JsonObject): Promise<void> => void rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "lore", id, value }));
      await put("danny_ledger", { id: "danny_ledger", title: "Danny's ledger", content: "DANNY-PIN: Danny owes the bank three months.", keys: [], links: [] });
      await put("house_rules", { id: "house_rules", title: "House rules", content: "PLACE-PIN: no shoes on the couch.", keys: [], links: [] });
      await put("hidden_truth", { id: "hidden_truth", title: "Hidden truth", content: "SECRET-PIN: the deed is forged.", keys: [], links: [], secret: true, gate: "false" });
      rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: { danny_okafor: [{ lore: "danny_ledger" }] }, places: { [here]: [{ lore: "house_rules" }, { lore: "hidden_truth" }, { book, entry: bookEntry }] } } }));
    });
    await rig.turn(chatId, "I walk to the window and wait.", "The kettle clicks off.");
    const minds = new Map(mindCalls(rig).map((c) => [nameOf(c), c.messages[1]?.content ?? ""]));
    expect(minds.get("Danny Okafor")).toContain("DANNY-PIN");
    for (const name of ["Danny Okafor", "Priya Nair"]) {
      expect(minds.get(name)).toContain("PLACE-PIN");
      expect(minds.get(name)).toContain("BOOK-PIN");
    }
    expect(minds.get("Priya Nair")).not.toContain("DANNY-PIN");
    // A helper at the place reads the place's pins, never a character's.
    const interpret = rig.host.quietCalls.find((c) => (c.messages[0]?.content ?? "").includes("You map a player's typed input"))?.messages[0]?.content ?? "";
    expect(interpret).toContain("PLACE-PIN");
    expect(interpret).toContain("BOOK-PIN");
    expect(interpret).not.toContain("DANNY-PIN");
    // The secret reaches no call, and no trace names it; the inspector shows the pins that were read.
    expect(JSON.stringify(rig.host.quietCalls)).not.toContain("SECRET-PIN");
    const records = rig.rt.inspectorRecords(chatId) ?? [];
    expect(JSON.stringify(records)).not.toContain("Hidden truth");
    const danny = records.flatMap((r) => r.minds ?? []).find((t) => t.who === "Danny Okafor" && t.purpose === "mind");
    expect((danny?.pinned ?? []).map((p) => p.title)).toEqual(["Danny's ledger", "House rules", "Town notice"]);
    expect(records.flatMap((r) => r.lore ?? []).find((t) => t.step === "interpret")?.entries.filter((e) => e.pinned).map((e) => e.title)).toEqual(["House rules", "Town notice"]);
  });

  test("a pin to an entry the world doesn't have is linted where it is", () => {
    const world = newWorld("w_pins", "Pins");
    const issues = lint({ ...world, lorePins: { characters: { [world.pov]: [{ lore: "no_such_entry" }] }, places: {} } });
    expect(issues.filter((i) => i.code === "pin_missing").map((i) => [i.path, i.severity])).toEqual([[`lorePins.characters.${world.pov}`, "warning"]]);
  });
});
