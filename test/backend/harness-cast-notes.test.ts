// The note tools on the harness (`person_add`, `purchase`, `place_make` with someone put there,
// `revenue_note`, `project_note`): each records a fact through its change type's own channel, a
// change of the story's tier that never passes through the writer. A definition lists whatever
// tools its user chose, so who may note is held where the fact is noted (`noteFact`), whatever lets
// the call through before it. And an id an agent makes (`gm_spawn`) is in the form the engine mints
// its own in.

import { describe, expect, test } from "bun:test";
import { NOTE_TIER } from "../../src/backend/agents/tools/propose";
import { TOOL_DEFINITIONS } from "../../src/backend/agents/tools/registry";
import { outsideWriter } from "../../src/backend/agents/tools/writer";
import { renderPrompt } from "../../src/backend/prompts";
import { WRITE_NOTE } from "../../src/shared/agent-tools-write";
import { HARNESS_AGENT } from "../../src/shared/harness-texts";
import { STORY_NOTE } from "../../src/shared/harness-texts-story";
import type { JsonObject } from "../../src/shared/json";
import type { ChangeType } from "../../src/shared/settings";
import { placeOfEntity } from "../../src/engine/scope";
import type { Rig } from "../support/rig";
import { alderChat, HOME, POV, toolEnv } from "../support/tools";
import { answer, authorEnv, castEnv, castTurn, guardModel, MARA, noModelCalls, refusal, turnChat } from "./harness-cast-kit";
import { type Agent, AUTHOR, beginJob, beginTurn, cashOf, stateOf } from "./harness-driver";

/** An agent of the game master's definition, which only reads, and one of a definition the user made, which the engine gives no tier at all. */
const GM: Agent = { id: "gm-1", role: HARNESS_AGENT.gm };
const OWN: Agent = { id: "helper-1", role: "a_definition_of_the_users" };
const HISTORIAN: Agent = { id: "job-historian", role: HARNESS_AGENT.historian };

const SHOP = "alder_automotive_co";

/** A walk-on, a purchase and a place someone is put in: what a cast chat's note tools can be asked as it stands. */
const ASKED: readonly (readonly [string, JsonObject])[] = [
  ["person_add", { name: "Brann" }],
  ["purchase", { item: "a loaf of bread", category: "food", price: 3 }],
  ["place_make", { name: "The back room", parent: HOME, as: "room", why: "Mara steps into it.", entity: "Mara" }],
];

/** What those three would change, read from the world: whether Brann is in it, how many loaves there are (the purchase makes the catalog's own), and where Mara is. */
async function left(rig: Rig, chatId: string): Promise<{ brann: boolean; bread: number; mara: string | null }> {
  const state = await stateOf(rig, chatId);
  const names = Object.values(state.entities).map((e) => e.name);
  return { brann: names.includes("Brann"), bread: names.filter((name) => /bread/i.test(name)).length, mara: placeOfEntity(state, MARA) };
}

describe("who may note a fact", () => {
  test("an agent that only reads is refused every note tool its definition gives it, in a turn and in a job; one at the story's tier notes", async () => {
    const { rig, chatId } = await turnChat();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { spawn: { mode: "auto" }, place_make: { mode: "auto" }, purchase: { mode: "auto" } } } }));
    const before = await left(rig, chatId);
    const turn = await beginTurn(rig, chatId, "I ask Mara who is new in town.");
    await turn.answer(AUTHOR, "time_clock");
    for (const agent of [GM, OWN]) {
      for (const [tool, args] of ASKED) expect({ agent: agent.role, tool, refused: (await turn.call(agent, tool, args)).error === true }).toEqual({ agent: agent.role, tool, refused: true });
    }
    // Nothing of theirs was staged: the author's commit lands nothing, and neither does the reply's own.
    expect(await turn.answer(AUTHOR, "commit")).toEqual({ committed: { landed: [], review: [], refused: [] } });
    await turn.finish("Mara shrugs.");
    expect(await left(rig, chatId)).toEqual(before);
    // After the reply a change is written as it is made, so a refusal is all that stands between the call and the world.
    const job = await beginJob(rig, turn, "job-notes");
    for (const [tool, args] of ASKED) expect({ tool, refused: (await job.call(GM, tool, args)).error === true }).toEqual({ tool, refused: true });
    expect(await left(rig, chatId)).toEqual(before);
    // The same calls from the historian, which holds the story's tier, are recorded: what refused the others was their tier, not the calls.
    for (const [tool, args] of ASKED) expect({ tool, refused: (await job.call(HISTORIAN, tool, args)).error === true }).toEqual({ tool, refused: false });
    const after = await left(rig, chatId);
    expect({ brann: after.brann, bread: after.bread - before.bread, moved: after.mara !== before.mara }).toEqual({ brann: true, bread: 1, moved: true });
    noModelCalls(rig);
  });

  test("the function refuses by itself, for each of its five callers: below the story's tier nothing is noted, whatever lets the call through", async () => {
    // The shop's counter takings, a stream its author opened to the agents, and a well the shop is drilling: what `revenue_note` and `project_note` speak of.
    const takings: JsonObject = { id: "shop_takings", kind: "flow", name: "Counter takings", tier: "background", fields: { flow_kind: "income", from: "Customers", to: SHOP, every: "day", at: "17:00", revenue: [{ type: "product", units: 1, price: 15000, buyers: 6, ai: "bounded" }] }, relations: [] };
    const { rig, chatId } = await alderChat({ put: { entities: { shop_takings: takings } } });
    guardModel(rig);
    await outsideWriter(rig.rt, { ...toolEnv(rig, chatId, "gm"), connectionId: null }).apply([{ kind: "gm_edit", op: { op: "org", change: { do: "project", act: "start", org: SHOP, template: "water_well", name: "Shop well" } } }], "Drill the shop a well");
    const noted: readonly (readonly [string, JsonObject, ChangeType])[] = [
      ["person_add", { name: "Brann" }, "spawn"],
      ["purchase", { item: "a loaf of bread", category: "food", price: 3 }, "purchase"],
      ["place_make", { name: "The back room", parent: HOME, as: "room", why: "They step into it.", entity: POV }, "place_make"],
      ["revenue_note", { stream: "Counter takings", factor: 1.5, days: 7, said: "Half the town came by after the fair" }, "revenue"],
      ["project_note", { project: "Shop well", days: 3, why: "The permit office lost the forms" }, "project_note"],
    ];
    // A turn that says the caller only reads, and one that says nothing of an agent that isn't the author: each is no tier to note with.
    for (const setup of [{ main: false, tier: "read" as const }, { main: false }]) {
      const turn = await castTurn(rig, chatId, setup);
      const env = castEnv(rig, chatId, turn, HARNESS_AGENT.gm);
      for (const [tool, args] of noted) expect({ tool, text: await refusal(env, tool, args) }).toEqual({ tool, text: renderPrompt(WRITE_NOTE.noWriter, {}, {}) });
      expect(turn.changes).toEqual([]);
    }
    // At the story's tier each is staged as the change its own channel makes of it; so is the author's, which holds the game master's.
    for (const setup of [{ main: false, tier: "story" as const }, { main: true }]) {
      const turn = await castTurn(rig, chatId, setup);
      const env = castEnv(rig, chatId, turn, HARNESS_AGENT.historian);
      for (const [tool, args] of noted) await answer(env, tool, args);
      expect(turn.changes.map((c) => c.changeType)).toEqual(noted.map(([, , type]) => type));
    }
    noModelCalls(rig);
  });

  test("every tool that notes a fact is listed at the tier its caller is held to", () => {
    // `place_make` notes only a place someone is put in, so it is given to more agents than the one that notes (`notes`).
    const noting = TOOL_DEFINITIONS.filter((def) => def.notes === true || def.name === "place_make");
    expect(noting.map((def) => def.name).sort()).toEqual(["person_add", "place_make", "project_note", "purchase", "revenue_note"]);
    expect(noting.map((def) => ({ tool: def.name, tier: def.tier }))).toEqual(noting.map((def) => ({ tool: def.name, tier: NOTE_TIER })));
  });
});

describe("an id an agent makes", () => {
  test("gm_spawn takes an id only in the form the engine mints its own in, and says so otherwise", async () => {
    const { rig, chatId, env } = await authorEnv();
    for (const id of ["../../x", "Brann", "the courier", "__proto__"]) {
      expect({ id, text: await refusal(env, "gm_spawn", { kind: "character", name: "Brann", id }) }).toEqual({ id, text: renderPrompt(STORY_NOTE.badId, {}, { id }) });
    }
    expect(Object.values((await stateOf(rig, chatId)).entities).filter((e) => e.name === "Brann")).toEqual([]);
    await answer(env, "gm_spawn", { kind: "character", name: "Brann", id: "brann_the_courier" });
    expect((await stateOf(rig, chatId)).entities.brann_the_courier?.name).toBe("Brann");
    noModelCalls(rig);
  });
});
