// INC3 3a: agents as the default for new chats, with the switch kept (D1); the offer to a classic
// chat that played and never chose (D2), refused as the switch is while a turn waits at a gate; the
// jobs' own model, copied once from the steps they read before (D3); Run minds now on the Minds
// role's connection, model and effort.

import { describe, expect, test } from "bun:test";
import { mindsRunConfig } from "../../src/backend/minds-run";
import { ROLE_IDS } from "../../src/shared/agent-roles";
import { defaultAgentSettings } from "../../src/shared/agent-settings";
import { DEFAULT_HELPER, SETTINGS_DEFAULTS_REV } from "../../src/shared/settings";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

/** Every role prompt-only: an agent turn makes classic's own calls, which the rig answers with nothing. */
const PROMPT_ONLY = { agents: { roles: Object.fromEntries(ROLE_IDS.map((role) => [role, { promptOnly: true }])) } };

async function engineOf(rig: Rig, chatId: string, engine?: "classic" | "agents" | null): Promise<unknown> {
  const body = rig.body(await rig.send({ type: "lre.chat.knowledge", chatId, ...(engine !== undefined ? { engine } : {}) }));
  return { engine: body.engine, engineFrom: body.engineFrom };
}

async function offerOf(rig: Rig, chatId: string) {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "engine_offer") ?? null;
}

describe("which engine a chat plays (INC3 3a, D1)", () => {
  test("a new chat takes New chats start on and its first turn records it, so a later change to the default moves no chat that has played", async () => {
    const rig = new Rig({ newChats: "agents" });
    rig.body(await rig.send({ type: "lre.settings.set", patch: PROMPT_ONLY }));
    const chatId = await rig.worldChat();
    expect(await engineOf(rig, chatId)).toEqual({ engine: "agents", engineFrom: "new" });
    await rig.turn(chatId, "I wave.", "Someone waves back.");
    expect(await engineOf(rig, chatId)).toEqual({ engine: "agents", engineFrom: "default" });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { newChats: "classic" } } }));
    expect(await engineOf(rig, chatId)).toEqual({ engine: "agents", engineFrom: "default" });
    // A chat made since starts on the new default; nothing is offered to either.
    const later = await rig.worldChat();
    expect(await engineOf(rig, later)).toEqual({ engine: "classic", engineFrom: "new" });
    expect(await offerOf(rig, chatId)).toBeNull();
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("choosing classic is stored as a choice, told apart from no choice; null returns the chat to what a chat with none plays", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I wave.", "Someone waves back.");
    expect(await engineOf(rig, chatId)).toEqual({ engine: "classic", engineFrom: "default" });
    expect(await engineOf(rig, chatId, "classic")).toEqual({ engine: "classic", engineFrom: "chosen" });
    expect(await engineOf(rig, chatId, null)).toEqual({ engine: "classic", engineFrom: "played" });
    expect((await rig.send({ type: "lre.chat.knowledge", chatId, engine: "fast" })).type).toBe("lre.error");
  });
});

describe("the offer (INC3 3a, D2)", () => {
  test("a played classic chat with no choice shows it while new chats start on agents; a press while a gate waits says why and leaves it; Keep classic ends it for good", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I wave.", "Someone waves back.");
    // As a chat played before agents were the default: no engine of its own.
    expect(await engineOf(rig, chatId, null)).toEqual({ engine: "classic", engineFrom: "played" });
    expect(await offerOf(rig, chatId)).toBeNull();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { newChats: "agents" } } }));
    const offer = await offerOf(rig, chatId);
    expect(offer?.label).toBe("This chat runs on the classic steps. New chats run on agents.");
    expect(offer?.actions.map((a) => [a.id, a.label])).toEqual([["agents", "Switch to agents"], ["classic", "Keep classic"]]);
    // The chat's turn waits on the player's answer: Switch to agents is refused, saying on what, and the chip stays.
    const head = rig.host.head(chatId);
    if (!offer || !head) throw new Error("no offer");
    await rig.rt.chips.add(chatId, rig.host.userId, [{ id: `claim:${head.id}:0`, kind: "claim", messageId: head.id, label: "A coffee?", actions: [{ id: "add", label: "Add" }], expires: "next_send", payload: {} }]);
    const refused = await rig.send({ type: "lre.chip", chatId, chip: offer.id, choice: "agents" });
    expect(refused.type === "lre.error" ? refused.message : "").toContain("This chat's turn is waiting on your answer to its question");
    expect((await offerOf(rig, chatId))?.id).toBe(offer.id);
    expect(await engineOf(rig, chatId)).toEqual({ engine: "classic", engineFrom: "played" });
    await rig.rt.chips.removeWhere(chatId, rig.host.userId, (c) => c.kind === "claim");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: offer.id, choice: "classic" }));
    expect(await engineOf(rig, chatId)).toEqual({ engine: "classic", engineFrom: "chosen" });
    expect(await offerOf(rig, chatId)).toBeNull();
  });

  test("Switch to agents makes agents the chat's own, and the next turn plays on agents", async () => {
    const rig = new Rig();
    rig.body(await rig.send({ type: "lre.settings.set", patch: PROMPT_ONLY }));
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I wave.", "Someone waves back.");
    rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { newChats: "agents" } } }));
    const offer = await offerOf(rig, chatId);
    if (!offer) throw new Error("no offer");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: offer.id, choice: "agents" }));
    expect(await engineOf(rig, chatId)).toEqual({ engine: "agents", engineFrom: "chosen" });
    expect(await offerOf(rig, chatId)).toBeNull();
    await rig.turn(chatId, "I nod.", "Someone nods back.");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the jobs' own model (INC3 3a, D3)", () => {
  const read = async (file: JsonObject) => {
    const rig = new Rig();
    rig.host.files.set(`${rig.host.userId}/settings.json`, JSON.stringify({ v: 1, ...file }));
    return rig.rt.settings.get(rig.host.userId);
  };
  const ROUTE = { provider: "helper" as const, connectionId: "c-brief", model: "m-brief", effort: "low" as const };

  test("an older file gets a copy of the brief step's route and max tokens, else interpret's, once; one with its own, null included, keeps it", async () => {
    expect((await read({ defaults: 9, modelUse: { preset: "custom", steps: { brief: { enabled: true, signals: ["always"], route: ROUTE, maxTokens: 9000 } } } })).jobs.model).toEqual({ route: ROUTE, maxTokens: 9000 });
    expect((await read({ defaults: 9, modelUse: { preset: "custom", steps: { interpret: { enabled: true, signals: ["typed_input"], route: { ...ROUTE, connectionId: "c-int" } } } } })).jobs.model).toEqual({ route: { ...ROUTE, connectionId: "c-int" } });
    expect((await read({ defaults: 9, jobs: { model: null } })).jobs.model).toBeNull();
    // Read against revision 10 or later, nothing is copied: the copy is made once.
    expect((await read({ defaults: SETTINGS_DEFAULTS_REV, modelUse: { preset: "custom", steps: { brief: { enabled: true, signals: [], route: ROUTE } } } })).jobs.model).toBeNull();
    // A new user's jobs run on the helper model (a file at today's defaults), and the setting resets to it.
    const rig = new Rig({ minds: true });
    const jobs = async () => (await rig.rt.settings.get(rig.host.userId)).jobs;
    expect((await jobs()).model).toBeNull();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { jobs: { model: { route: ROUTE, maxTokens: 20_000 } } } }));
    expect(await jobs()).toEqual({ model: { route: ROUTE, maxTokens: 20_000 }, routineLoreTokens: 8000 });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { jobs: { model: null } } }));
    expect((await jobs()).model).toBeNull();
  });

  test("a model job's call goes out on the jobs' own model, with room for a long answer", async () => {
    const rig = new Rig({ minds: true });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { jobs: { model: { route: ROUTE, maxTokens: 2000 } } } }));
    const worldId = await rig.newWorld();
    const calls: { connectionId: string | null; model: string | null; effort?: string; maxTokens?: number }[] = [];
    rig.host.quietReply = (req) => {
      calls.push({ connectionId: req.connectionId, model: req.model, effort: req.effort, maxTokens: req.maxTokens });
      return JSON.stringify({ proposals: [] });
    };
    rig.body(await rig.send({ type: "lre.job", op: "start", kind: "refine", worldId, input: { instructions: "Add a diner." } }));
    await rig.host.settle();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call).toMatchObject({ connectionId: "c-brief", model: "m-brief", effort: "low" });
    for (const call of calls) expect(call.maxTokens ?? 0).toBeGreaterThanOrEqual(16_384);
  });
});

describe("Run minds now on the Minds role (INC3 3a)", () => {
  const role = defaultAgentSettings().roles.minds;
  const steps = (enabled: boolean) => ({ mind: { enabled, signals: ["always"], route: { provider: "helper" as const, connectionId: "c-step", model: "m-step" } } });

  test("runs on the role's connection, model and effort where it names them, else on the mind step; nowhere to run with neither", () => {
    const helper = { connectionId: DEFAULT_HELPER.connectionId };
    expect(mindsRunConfig({ modelUse: { steps: steps(true) }, helper }, { ...role, connectionId: "c-role", model: "m-role", effort: "high" })?.route).toEqual({ provider: "helper", connectionId: "c-role", model: "m-role", effort: "high" });
    expect(mindsRunConfig({ modelUse: { steps: steps(true) }, helper }, { ...role, connectionId: null, model: null, effort: "inherit" })?.route).toEqual({ provider: "helper", connectionId: "c-step", model: "m-step" });
    expect(mindsRunConfig({ modelUse: { steps: steps(false) }, helper }, { ...role, connectionId: "c-role", model: null, effort: "inherit" })?.route).toEqual({ provider: "helper", connectionId: "c-role", model: null });
    expect(mindsRunConfig({ modelUse: { steps: steps(false) }, helper }, { ...role, connectionId: null, model: null, effort: "inherit" })).toBeNull();
  });
});
