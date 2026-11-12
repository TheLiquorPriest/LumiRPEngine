// A person made whole in play (`harness-tools/people.ts`): `person_make` makes someone and gives
// them a sheet, a place, ties, things and a mind in one call, each part through the engine's writer
// as the single tools send it. The writes here land for real (`landingWriter`), so what the tool
// says it made is read back from the world with the tools an author would read it with.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { stateOf } from "../support/mind-chat";
import { HOME } from "../support/tools";
import { answer, authorEnv, castChat, castEnv, castTurn, MARA, noModelCalls, refusal, turnChat } from "./harness-cast-kit";
import { AUTHOR, beginTurn, noModelCalls as driverNoModelCalls, stateOf as turnState } from "./harness-driver";

interface Made {
  made: { id: string; name: string; changeType: string; lines: string[]; lands: string };
  parts?: { part: string; changeType: string; lines: string[] }[];
  refused?: { part: string; code: string; reason: string; fix: string }[];
  next: string;
}

const INTENT = "Hand the letter over and leave before anyone asks who sent it.";
const NOTES = ["The letter is for the house on Harbor Street."];

/** A courier who walks in: a sheet, a tie, a scarf on and a letter in hand, and a mind that already knows what it is here for. */
const BRANN: JsonObject = {
  name: "Brann",
  place: HOME,
  why: "a courier walks in with a letter",
  fields: JSON.stringify({ occupation: "courier" }),
  relations: [{ relation: "knows", to: "Mara" }],
  holds: [
    { name: "a grey scarf", worn: true },
    { name: "a sealed letter", description: "Cream paper, a wax seal the colour of rust." },
  ],
  mind: { intent: INTENT, approach: "proactive", notes: NOTES, level: "near" },
};

describe("a person made whole", () => {
  test("person_make makes them with their sheet, where they are, their ties, what they hold and wear, and a mind that starts with an intent and a memory", async () => {
    const { rig, chatId, env } = await authorEnv();
    const out = (await answer(env, "person_make", BRANN)) as unknown as Made;
    expect(out.made).toMatchObject({ id: "brann", name: "Brann", changeType: "gm_spawn" });
    expect(out.refused).toBeUndefined();
    expect((out.parts ?? []).map((p) => p.part)).toEqual(["fields.occupation", "relations.knows", "holds.a grey scarf", "holds.a grey scarf.worn", "holds.a sealed letter", "mind.intent", "mind.notes.1", "mind.level"]);
    // What follows is told with their id, which every later call names them by.
    expect(out.next).toContain("brann");

    const { state } = await stateOf(rig, chatId);
    expect(state.entities.brann).toMatchObject({ kind: "person", name: "Brann", fields: { place: HOME, occupation: "courier" } });
    const sheet = (await answer(env, "people_sheet", { person: "Brann" })) as { relations: { type: string; to: { id: string; name: string } }[] };
    expect(sheet.relations).toContainEqual({ type: "knows", to: { id: MARA, name: "Mara" } });
    const inventory = (await answer(env, "items_inventory", { person: "brann" })) as { worn: { name: string }[]; carried: { name: string }[] };
    expect(inventory.worn.map((t) => t.name)).toEqual(["a grey scarf"]);
    expect(inventory.carried.map((t) => t.name)).toEqual(["a sealed letter"]);
    const mind = (await answer(env, "minds_read", { person: "brann" })) as { intent: { text: string; approach: string | null }; notes: { text: string }[]; fidelity: { pin: { gm: string | null } } };
    expect(mind.intent).toEqual({ text: INTENT, approach: "proactive" });
    expect(mind.notes.map((n) => n.text)).toEqual(NOTES);
    expect(mind.fidelity.pin.gm).toBe("near");
    noModelCalls(rig);
  });

  test("no one is made twice: a name the world has is refused with their id, and a name whose id is taken gets the next free one", async () => {
    const { rig, chatId, env } = await authorEnv();
    const twice = await refusal(env, "person_make", { name: "mara", why: "she walks in" });
    expect(twice).toContain("already has Mara");
    expect(twice).toContain("(mara)");
    expect(twice).toContain("gm_set_field");
    await answer(env, "person_make", BRANN);
    expect(await refusal(env, "person_make", BRANN)).toContain("already has Brann");
    // A different person whose name makes the same id is given the next one.
    const other = (await answer(env, "person_make", { name: "Mara!", why: "a namesake from the ferry" })) as unknown as Made;
    expect(other.made.id).toBe("mara_2");
    expect((await stateOf(rig, chatId)).state.entities.mara_2?.name).toBe("Mara!");
    noModelCalls(rig);
  });

  test("an argument it can't read makes no one, and the refusal says what to fix", async () => {
    const { rig, chatId, env } = await authorEnv();
    const people = async (): Promise<number> => Object.keys((await stateOf(rig, chatId)).state.entities).length;
    const before = await people();
    const why = { why: "a courier walks in" };
    expect(await refusal(env, "person_make", why)).toContain("name");
    expect(await refusal(env, "person_make", { name: "Brann" })).toContain("why");
    const kind = await refusal(env, "person_make", { name: "Brann", kind: "vehicle", ...why });
    expect(kind).toContain("vehicle");
    expect(kind).toContain("person");
    expect(await refusal(env, "person_make", { name: "Brann", id: MARA, ...why })).toContain("mara is taken already");
    expect(await refusal(env, "person_make", { name: "Brann", id: "not an id!", ...why })).toContain("lower case letters");
    expect(await refusal(env, "person_make", { name: "Brann", place: "a cellar no one made", ...why })).toContain("a cellar no one made");
    expect(await refusal(env, "person_make", { name: "Brann", tier: "legend", ...why })).toContain("background");
    const field = await refusal(env, "person_make", { name: "Brann", fields: JSON.stringify({ shoe_size: 9 }), ...why });
    expect(field).toContain("shoe_size is no field of the kind person");
    expect(field).toContain("occupation");
    expect(await refusal(env, "person_make", { name: "Brann", fields: "a courier", ...why })).toContain("fields");
    const tie = await refusal(env, "person_make", { name: "Brann", relations: [{ relation: "knows" }], ...why });
    expect(tie).toContain("Item 1 of relations");
    expect(tie).toContain("relation, to");
    expect(await refusal(env, "person_make", { name: "Brann", relations: [{ relation: "knows", to: "someone the world doesn't have" }], ...why })).toContain("someone the world doesn't have");
    expect(await refusal(env, "person_make", { name: "Brann", holds: [{ name: "a satchel" }, { worn: true }], ...why })).toContain("Item 2 of holds");
    const approach = await refusal(env, "person_make", { name: "Brann", mind: { approach: "sneaky" }, ...why });
    expect(approach).toContain("sneaky");
    expect(approach).toContain("proactive");
    expect(await refusal(env, "person_make", { name: "Brann", mind: { level: "always" }, ...why })).toContain("background");
    expect(await people()).toBe(before);
    noModelCalls(rig);
  });

  test("a part the engine refuses is answered with why and the tool that fixes it, and the rest stand", async () => {
    const { rig, chatId, env } = await authorEnv();
    const out = (await answer(env, "person_make", { ...BRANN, relations: [{ relation: "no_such_relation", to: "Mara" }, { relation: "knows", to: "Joss" }] })) as unknown as Made;
    expect(out.made.id).toBe("brann");
    expect(out.refused?.map((r) => [r.part, r.fix])).toEqual([["relations.no_such_relation", "gm_link"]]);
    expect(out.refused?.[0]?.reason ?? "").not.toBe("");
    // Everything else of the call landed: the person, the tie that holds, their things and their mind.
    expect((out.parts ?? []).map((p) => p.part)).toContain("relations.knows");
    const { state } = await stateOf(rig, chatId);
    expect(state.entities.brann?.fields.occupation).toBe("courier");
    const mind = (await answer(env, "minds_read", { person: "brann" })) as { notes: unknown[] };
    expect(mind.notes).toHaveLength(1);
    noModelCalls(rig);
  });

  test("an agent that only reads makes no one, and neither does a call outside a turn", async () => {
    const { rig, chatId } = await castChat();
    const reads = castEnv(rig, chatId, await castTurn(rig, chatId));
    expect(await refusal(reads, "person_make", BRANN)).toContain("only reads");
    const outside = castEnv(rig, chatId, null);
    expect(await refusal(outside, "person_make", BRANN)).toContain("no turn open");
    expect((await stateOf(rig, chatId)).state.entities.brann).toBeUndefined();
    noModelCalls(rig);
  });
});

describe("a person made in a harness turn", () => {
  /** What the turn's commit made of what was staged (`commit`). */
  interface Committed {
    landed: string[][];
    review: string[][];
    refused: { lines: string[]; reason: string }[];
  }

  test("set to Auto, the person lands whole with the author's commit and the next tool call finds them: on the harness nothing of them asks first by a rule of its own", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { gm_spawn: { mode: "auto" } } } }));
    const run = await beginTurn(rig, chatId, "Someone knocks. I open the door.");
    const out = (await run.answer(AUTHOR, "person_make", BRANN)) as unknown as Made;
    expect(out.refused).toBeUndefined();
    expect(out.made.lands).not.toContain("review card");
    // Staged, not landed: the world has no Brann until the author commits.
    expect((await turnState(rig, chatId)).entities.brann).toBeUndefined();
    const committed = (await run.answer(AUTHOR, "commit")).committed as Committed;
    expect(committed.refused).toEqual([]);
    // Each part is its own change, and every one lands: a thing priced above what a reply may claim asks first on the old engines only.
    expect(committed.review).toEqual([]);
    expect(committed.landed).toHaveLength(1 + (out.parts ?? []).length);
    const sheet = (await run.answer(AUTHOR, "people_sheet", { person: "Brann" })) as { person: { id: string }; place: { id: string } };
    expect(sheet).toMatchObject({ person: { id: "brann" }, place: { id: HOME } });
    const inventory = (await run.answer(AUTHOR, "items_inventory", { person: "brann" })) as { worn: { name: string }[]; carried: { name: string }[] };
    expect(inventory.carried.map((t) => t.name)).toEqual(["a sealed letter"]);
    expect(inventory.worn.map((t) => t.name)).toEqual(["a grey scarf"]);
    const mind = (await run.answer(AUTHOR, "minds_read", { person: "brann" })) as { intent: { text: string }; notes: { text: string }[] };
    expect(mind.intent.text).toBe(INTENT);
    expect(mind.notes.map((n) => n.text)).toEqual(NOTES);
    await run.finish("A courier in a grey scarf holds out a letter.");
    const state = await turnState(rig, chatId);
    expect(state.entities.brann).toMatchObject({ name: "Brann", fields: { place: HOME, occupation: "courier" } });
    expect(Object.values(state.entities).filter((e) => e.name === "a grey scarf" || e.name === "a sealed letter")).toHaveLength(2);
    expect(rig.body(await rig.send({ type: "lre.review", chatId, op: "get" })).cards).toEqual([]);
    driverNoModelCalls(rig);
  });

  test("set to Confirm by the user, the person waits on the reply's card with every part that names them, and Apply lands them whole", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { gm_spawn: { mode: "confirm" } } } }));
    const run = await beginTurn(rig, chatId, "Someone knocks. I open the door.");
    const out = (await run.answer(AUTHOR, "person_make", BRANN)) as unknown as Made;
    expect(out.made.lands).toContain("review card");
    expect(out.next).toContain("Apply");
    const committed = (await run.answer(AUTHOR, "commit")).committed as Committed;
    expect(committed.landed).toEqual([]);
    expect(committed.refused).toEqual([]);
    expect(committed.review).toHaveLength(1 + (out.parts ?? []).length);
    await run.finish("A courier in a grey scarf holds out a letter.");
    expect((await turnState(rig, chatId)).entities.brann).toBeUndefined();
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    const applied = rig.body(await rig.send({ type: "lre.review", chatId, op: "apply", turn: `${reply.id}:0` })).cards as { items: { status: string }[] }[];
    expect(applied[0]?.items.every((i) => i.status === "applied")).toBe(true);
    const state = await turnState(rig, chatId);
    expect(state.entities.brann).toMatchObject({ name: "Brann", fields: { place: HOME, occupation: "courier" } });
    expect(Object.values(state.entities).filter((e) => e.name === "a grey scarf" || e.name === "a sealed letter")).toHaveLength(2);
    driverNoModelCalls(rig);
  });
});
