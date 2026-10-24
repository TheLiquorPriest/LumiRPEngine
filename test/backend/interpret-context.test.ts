// What `interpret` reads besides the typed message (DESIGN §5.2): the catalog of what the player
// character can do now (the world's actions and the built-in ones, each with its description, its
// params and what may fill them, and what it needs in words), the scene and the places as the POV
// knows them, and the messages before the typed one, as many as the interpret card allows. A
// message that hangs on the reply before it is read from it; nothing the POV can't see is named.

import { describe, expect, test } from "bun:test";
import type { DecideRequest, QuietRequest } from "../../src/backend/host";
import { interpretCatalog, interpretScene, type CatalogEntry } from "../../src/backend/interpret-context";
import { toChain } from "../../src/backend/ledger-io";
import { defaultSettings, SettingsStore } from "../../src/backend/settings-store";
import { stepUpdatePatch } from "../../src/frontend/settings/steps";
import type { Answers } from "../../src/engine/decide";
import { createRegistry } from "../../src/engine/registry-impl";
import type { WorldState } from "../../src/engine/state";
import { Working } from "../../src/engine/working";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import type { JsonObject } from "../../src/shared/json";
import { DEFAULT_RECENT, recentOf, stepConfigOf } from "../../src/shared/settings";
import type { WorldDoc } from "../../src/shared/world";
import { FakeHost } from "../support/fake-host";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const NONE: JsonObject = { action: null, params: {}, confidence: 0.9 };

/** A Port Alder chat on the default settings, after `extra` editor puts (a collection, an id, the value). */
async function alder(extra: [string, string, JsonObject][] = []): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  for (const [collection, id, value] of extra) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** `interpret` answers `read(the typed text, its prompt)`; every other step reads nothing. Returns the prompts it was given. */
function reading(rig: Rig, read: (text: string, system: string) => JsonObject = () => NONE): string[] {
  const prompts: string[] = [];
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (!system.includes(INTERPRET_MARK)) return "{}";
    prompts.push(system);
    return JSON.stringify(read(req.messages[1]?.content ?? "", system));
  };
  return prompts;
}

/** A block of the prompt: the lines after its heading, up to the next block. */
function block(system: string, heading: string): string[] {
  const at = system.split("\n");
  const from = at.findIndex((line) => line.startsWith(heading));
  if (from < 0) return [];
  const rest = at.slice(from + 1);
  const end = rest.findIndex((line) => /^(Scene|Places \(|Recent messages|Action catalog|Rules):?/.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

async function headState(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  return state;
}

/** A thermos lying where the POV starts. */
const THERMOS: [string, string, JsonObject] = ["entities", "thermos", { id: "thermos", kind: "item", name: "Thermos", tier: "background", fields: { place: "harbor_street_114" }, relations: [] }];

describe("interpret reads the messages before the typed one", () => {
  test("'I take what he offered' is read from the reply before it, and plays as the take", async () => {
    const { rig, chatId } = await alder([THERMOS]);
    // The model takes the thermos only when the reply that offered it is in front of it, and the
    // thermos is something the take can name.
    const takes = (system: string): boolean => block(system, "Action catalog").some((l) => l.startsWith("take — ") && /\bthermos\b/.test(l)) && block(system, "Scene").some((l) => l.includes("Thermos (thermos)"));
    const prompts = reading(rig, (text, system) => (text.includes("what he offered") && block(system, "Recent messages").some((l) => l.includes("sets a thermos")) && takes(system) ? { action: "take", params: { item: "thermos" }, confidence: 0.9 } : NONE));
    await rig.turn(chatId, "Hi Danny.", "Danny sets a thermos on the table. “Coffee. For you.”");
    expect((await headState(rig, chatId)).entities.thermos?.relations.some((r) => r.type === "in" && r.to === "pov")).toBe(false);
    await rig.turn(chatId, "I take what he offered.", "It's still warm.");
    expect(prompts).toHaveLength(2);
    expect(block(prompts[1] ?? "", "Recent messages")).toEqual(["Story: Morning.", "Player: Hi Danny.", "Story: Danny sets a thermos on the table. “Coffee. For you.”"]);
    expect((await headState(rig, chatId)).entities.thermos?.relations.some((r) => r.type === "in" && r.to === "pov")).toBe(true);
  });

  test("the interpret card sets how many messages and tokens it reads", async () => {
    const { rig, chatId } = await alder();
    const prompts = reading(rig);
    const card = stepConfigOf((await rig.rt.settings.get(rig.host.userId)).modelUse.steps, "interpret");
    expect(card.recent).toBeUndefined();
    const reply = "Danny wipes his hands on a rag, looks up from the engine bay and says the part came in late again.";
    await rig.turn(chatId, "Hi Danny.", reply);
    await rig.turn(chatId, "I nod.", "He nods back.");
    // By default it reads every message so far.
    expect(block(prompts[1] ?? "", "Recent messages")).toEqual(["Story: Morning.", "Player: Hi Danny.", `Story: ${reply}`]);
    // One message: the reply just before.
    rig.body(await rig.send({ type: "lre.settings.set", patch: stepUpdatePatch("interpret", { ...card, recent: { on: true, messages: 1, tokens: 3000 } }) }));
    await rig.turn(chatId, "I check my phone.", "No new messages.");
    expect(block(prompts[2] ?? "", "Recent messages")).toEqual(["Story: He nods back."]);
    // Few tokens: the reply is cut to its end, where it leaves off.
    rig.body(await rig.send({ type: "lre.settings.set", patch: stepUpdatePatch("interpret", { ...card, recent: { on: true, messages: 8, tokens: 10 } }) }));
    await rig.turn(chatId, "Hmm.", reply);
    await rig.turn(chatId, "Okay.", "Fine.");
    const cut = block(prompts[4] ?? "", "Recent messages");
    expect(cut).toHaveLength(1);
    expect(cut[0]).toMatch(/^Story: ….+came in late again\.$/);
    expect(cut[0]?.length).toBeLessThan(`Story: ${reply}`.length);
    // Off: no messages block at all.
    rig.body(await rig.send({ type: "lre.settings.set", patch: stepUpdatePatch("interpret", { ...card, recent: { on: false, messages: 8, tokens: 3000 } }) }));
    await rig.turn(chatId, "Right.", "Right.");
    expect(prompts[5]).not.toContain("Recent messages");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("interpret's catalog and scene", () => {
  /** A world action of its own, described; one this chat's level of detail rules out. */
  const FEED: [string, string, JsonObject] = ["actions", "feed_gulls", { id: "feed_gulls", label: "Feed the gulls", description: "Toss bread crusts to the gulls along the waterfront.", params: {}, requires: [], outcomes: { default: [] }, duration: "5" }];
  const STARGAZE: [string, string, JsonObject] = ["actions", "stargaze", { id: "stargaze", label: "Read the sky", description: "Read tomorrow's weather from the clouds.", params: {}, requires: ["level.weather >= 4"], outcomes: { default: [] }, duration: "5" }];
  /** Someone here the POV can't see, and a room it hasn't found. */
  const WATCHER: [string, string, JsonObject] = ["entities", "watcher", { id: "watcher", kind: "character", name: "Silent Watcher", tier: "background", visibility: "secret", fields: { place: "harbor_street_114" }, relations: [] }];
  const CELLAR: [string, string, JsonObject] = ["places", "hidden_cellar", { id: "hidden_cellar", name: "Hidden Cellar", parent: "harbor_street_114", visibility: "discoverable", fields: {} }];

  test("it holds the world's actions with their descriptions, the built-in ones with theirs, their params and what they need in words", async () => {
    const { rig, chatId } = await alder([FEED, STARGAZE]);
    const prompts = reading(rig);
    await rig.turn(chatId, "I look around.", "Gulls wheel over the harbor.");
    const catalog = block(prompts[0] ?? "", "Action catalog");
    const line = (id: string): string => catalog.find((l) => l.startsWith(`${id} — `)) ?? "";
    expect(line("feed_gulls")).toBe("feed_gulls — Feed the gulls: Toss bread crusts to the gulls along the waterfront.");
    // A required param lists the ids that may fill it, each named once in the scene; its needs are
    // words, never an expression.
    expect(line("give")).toContain("to (person: ");
    expect(line("give")).toMatch(/to \(person: [^)]*\bdanny_okafor\b/);
    expect(block(prompts[0] ?? "", "Scene").join("\n")).toContain("Danny Okafor (danny_okafor)");
    expect(line("give")).toContain("Needs: you have `item` with you; `to` is here.");
    for (const expression of ["!=", "==", "route_exists(", "carries(", "at(to"]) expect(catalog.join("\n")).not.toContain(expression);
    // Weather is level 3 here: an action that needs level 4 can't be taken, so it isn't offered.
    expect(line("stargaze")).toBe("");
    // Nobody has invited Jordan anywhere: Accept invitation has no host to name.
    expect(line("accept_invitation")).toBe("");
    // Letting time pass is always there.
    expect(line("timelapse")).toStartWith("timelapse — Let time pass: ");
  });

  test("the scene says where and when, who is there, what the POV carries and its vehicles, by name and id, and nothing it can't see", async () => {
    const { rig, chatId } = await alder([WATCHER, CELLAR]);
    const prompts = reading(rig);
    await rig.turn(chatId, "I stretch.", "The radiator ticks.");
    const system = prompts[0] ?? "";
    const scene = block(system, "Scene");
    expect(scene[0]).toMatch(/^Now: Mon 2026-09-14 06:\d\d, at 114 Harbor Street \(harbor_street_114\), in Port Alder \(port_alder\)\.$/);
    expect(scene[1]).toContain("Danny Okafor (danny_okafor)");
    expect(scene[2]).toContain("Phone (pov_phone)");
    expect(scene[3]).toContain("Your pickup (pov_truck, at 114 Harbor Street)");
    expect(block(system, "Places (")).toContain("bluebird_coffee: Bluebird Coffee, in Port Alder");
    for (const hidden of ["Silent Watcher", "watcher", "Hidden Cellar", "hidden_cellar"]) expect(system).not.toContain(hidden);
  });

  test("on the Decision route, each choice carries its description, and the decision reads the scene and the messages before", async () => {
    const { rig, chatId } = await alder([FEED]);
    reading(rig);
    // Lean, so the only decision is interpret's.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { modelUse: { preset: "lean" } } }));
    const card = stepConfigOf((await rig.rt.settings.get(rig.host.userId)).modelUse.steps, "interpret");
    rig.body(await rig.send({ type: "lre.settings.set", patch: stepUpdatePatch("interpret", { ...card, route: { provider: "decision", connectionId: null, model: null } }) }));
    const asked: DecideRequest[] = [];
    rig.host.decideReply = (req: DecideRequest): Answers => {
      asked.push(req);
      return { action: { type: "choice", choice: "feed_gulls", probabilities: { feed_gulls: 0.9, none: 0.1 }, confidence: 0.9 } };
    };
    await rig.turn(chatId, "I toss the crusts out to the birds.", "The gulls shriek.");
    const decision = asked.find((r) => isChoiceOver(r, "feed_gulls"));
    const question = decision?.questions.action;
    expect(question?.type === "choice" ? question.criteria.feed_gulls : null).toBe("Feed the gulls: Toss bread crusts to the gulls along the waterfront.");
    const state = JSON.stringify(decision?.state);
    expect(state).toContain("at 114 Harbor Street (harbor_street_114)");
    expect(state).toContain('"recent":["Story: Morning."]');
  });

  test("an invitation waiting on the POV's answer is in the scene, and Accept invitation names its host", () => {
    const reg = createRegistry(ALL_PACKS);
    const world = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
    const w = new Working(reg, world, initialState(world, "r", reg));
    const mayKnow = (): boolean => true;
    const scene = (): string[] => interpretScene(reg, world, w.state, { mayKnow, named: [], earlier: [], recent: DEFAULT_RECENT, hideJson: false }).lines;
    const accept = (): CatalogEntry | undefined => interpretCatalog(reg, world, w.state, [...reg.actions.values()], mayKnow).entries.find((e) => e.action.id === "accept_invitation")?.entry;
    expect(scene().some((l) => l.startsWith("Waiting on your answer"))).toBe(false);
    expect(accept()).toBeUndefined();
    w.applyAll([{ type: "castlife.invitation", data: { agent: "danny_okafor", place: "bluebird_coffee", at: w.state.clock + 60, text: "Danny Okafor invites you to Bluebird Coffee at 07:15.", key: "danny:test" } }]);
    expect(scene()).toContain("Waiting on your answer: Danny Okafor invites you to Bluebird Coffee at 7:15 AM. (host danny_okafor)");
    expect(accept()?.params).toEqual(["host (person: danny_okafor)"]);
  });
});

/** Whether a decision asks a choice over the catalog (it lists `id`). */
function isChoiceOver(req: DecideRequest, id: string): boolean {
  const q = req.questions.action;
  return q?.type === "choice" && Object.prototype.hasOwnProperty.call(q.criteria, id);
}

describe("the interpret card's recent messages", () => {
  test("a saved limit reads back; one that isn't a whole number from 0 reads as the default", async () => {
    const host = new FakeHost();
    const base = defaultSettings();
    const save = async (recent: unknown): Promise<unknown> => {
      await host.storage.write("settings.json", JSON.stringify({ ...base, modelUse: { ...base.modelUse, preset: "custom", steps: { ...base.modelUse.steps, interpret: { ...base.modelUse.steps.interpret, recent } } } }), host.userId);
      return stepConfigOf((await new SettingsStore(host).get(host.userId)).modelUse.steps, "interpret").recent;
    };
    // Saved before the switch, a limit reads as on.
    expect(await save({ messages: 3, tokens: 500 })).toEqual({ on: true, messages: 3, tokens: 500 });
    expect(await save({ on: false, messages: 0, tokens: 100_000 })).toEqual({ on: false, messages: 0, tokens: 100_000 });
    expect(await save({ on: true, messages: "none", tokens: "none" })).toEqual({ on: true, messages: "none", tokens: "none" });
    expect(await save({ messages: -1, tokens: 500 })).toBeUndefined();
    expect(await save({ messages: 2.5, tokens: 500 })).toBeUndefined();
    expect(await save("lots")).toBeUndefined();
    // Interpret's default is unchanged: on, the last 8 messages, about 3,000 tokens.
    expect(DEFAULT_RECENT).toEqual({ on: true, messages: 8, tokens: 3000 });
    expect(recentOf("interpret", stepConfigOf(base.modelUse.steps, "interpret"))).toEqual(DEFAULT_RECENT);
  });
});
