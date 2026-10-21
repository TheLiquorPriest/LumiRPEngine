// Inferred checks (DESIGN §11), on Port Alder with the Fifth profile: a typed attempt no catalog
// action with its own check covers is read as Try something and rolled with the world's sheet. The
// Outcome tells the narrator the result and its Narrate line; an opponent's numbers stay out of every
// chip, the Outcome and the view; companions roll their own; a reaction the message asks for rolls;
// the chat's policy (off, suggest, when, which skills, the most rolls) holds, layered as the
// adjudication policy is; and a catalog action with its own check is never doubled.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { defaultSettings } from "../../src/backend/settings-store";
import { startMarkersFrom } from "../../src/backend/start-markers";
import { INFERRED_PRESETS, type InferredChecks } from "../../src/shared/inferred";
import type { JsonObject } from "../../src/shared/json";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { Chip } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import { baseWorld } from "../packs/support";
import { Rig } from "../support/rig";

const INTERPRET = "You map a player's typed input";
const HERE = "harbor_street_114";

/** Port Alder on the Fifth profile, a bouncer with a sharp eye where Jordan stands, Marcus there too, and the chat's policy. */
async function chat(policy: Partial<InferredChecks>, puts: [string, JsonObject][] = []): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", worldId, base: null, op: "profile", profile: "fifth", choices: {} }));
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })).draft as WorldDoc;
  const marcus = { ...draft.entities.marcus_delgado, fields: { ...draft.entities.marcus_delgado?.fields, place: HERE } };
  const bouncer = { id: "bouncer", kind: "character", name: "the bouncer", tier: "supporting", fields: { place: HERE, wis: 50, insight: 2 }, relations: [] };
  for (const [collection, value] of [["entities", bouncer], ["entities", marcus], ...puts] as [string, JsonObject][]) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id: String(value.id), value }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  // The world sets none, so a new chat starts from the user's own policy.
  rig.body(await rig.send({ type: "lre.settings.set", patch: { inferred: { ...INFERRED_PRESETS.simulation, ...policy } as unknown as JsonObject } }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** `interpret` reads every message as `read`; every other step reads nothing. */
function reading(rig: Rig, read: JsonObject): void {
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET) ? JSON.stringify({ confidence: 0.9, ...read }) : "{}");
}

const tryRead = (params: JsonObject): JsonObject => ({ action: "try", params });

async function chips(rig: Rig, chatId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips;
}

async function events(rig: Rig, chatId: string): Promise<LedgerEvent[]> {
  return toChain(await rig.host.chats.messages(chatId, rig.host.userId)).flatMap((m) => Object.values(m.ledger?.swipes ?? {}).flatMap((r) => r.events));
}

const checks = (all: readonly LedgerEvent[]): { actor: unknown; total: unknown; outcome: unknown }[] => all.flatMap((e) => (e.type === "engine.check" && "data" in e ? [{ actor: e.data.actor, total: e.data.total, outcome: e.data.outcome }] : []));

describe("an attempt read as a check", () => {
  test("persuasion: the check rolls, and the Outcome carries its result and a Narrate line", async () => {
    const { rig, chatId } = await chat({});
    reading(rig, tryRead({ attempt: "talk my way past the door", skill: "persuasion", difficulty: "hard" }));
    await rig.turn(chatId, "I try to talk my way past the door.", "You talk.");
    const roll = (await chips(rig, chatId)).find((c) => c.kind === "roll");
    expect(roll?.label).toMatch(/^Persuasion check: (success|failure|great)$/);
    expect(roll?.detail).toMatch(/^Rolled d20 = \d+ against 15\. Odds: /);
    expect(rig.host.section("Outcome")).toMatch(/Persuasion check for "talk my way past the door", Jordan Ellis \(hard\): (success|failure|great) by \d+(, only just|, close to \w+)?\. Narrate it (succeeding|failing)/);
  });

  test("opposed: the bouncer's insight rolls against it, and his numbers reach no chip, Outcome or view", async () => {
    const { rig, chatId } = await chat({});
    reading(rig, tryRead({ attempt: "talk the bouncer into letting me in", skill: "persuasion", difficulty: "moderate", against: [{ who: "bouncer", skill: "insight" }] }));
    await rig.turn(chatId, "I try to talk the bouncer into letting me in.", "He looks you over.");
    const his = checks(await events(rig, chatId)).find((c) => c.actor === "bouncer");
    expect(his?.outcome).toBe("opposed");
    const total = String(his?.total);
    const outcome = rig.host.section("Outcome");
    expect(outcome).toContain("Persuasion check for \"talk the bouncer into letting me in\", Jordan Ellis against the bouncer: failure");
    const view = await rig.rt.view(chatId, rig.host.userId);
    for (const text of [outcome, JSON.stringify(view.chips), JSON.stringify(view.journal)]) expect(text).not.toMatch(new RegExp(`\\b${total}\\b`));
    expect(view.chips.find((c) => c.kind === "roll")?.detail).not.toMatch(/Odds|%/);
  });

  test("companions: 'we sneak past' rolls a check for each companion who joins in", async () => {
    const { rig, chatId } = await chat({ who: "companions" });
    reading(rig, tryRead({ attempt: "sneak past the bouncer", skill: "stealth", difficulty: "moderate", with: ["danny_okafor", "jess_kowalczyk"], against: [{ who: "bouncer", skill: "perception" }] }));
    await rig.turn(chatId, "We sneak past the bouncer.", "You creep along the wall.");
    expect(checks(await events(rig, chatId)).filter((c) => c.actor !== "bouncer").map((c) => c.actor)).toEqual(["danny_okafor", "jess_kowalczyk"]);
    expect(rig.host.section("Outcome")).toMatch(/Stealth check for "sneak past the bouncer", Jordan Ellis with Danny Okafor and Jess Kowalczyk against the bouncer: Jordan Ellis \w+.*; Danny Okafor \w+; Jess Kowalczyk \w+\. .*Narrate the others as their rolls fell\./);
  });

  test("reactive: watching Marcus answer rolls insight against his deception", async () => {
    const { rig, chatId } = await chat({});
    reading(rig, tryRead({ attempt: "tell whether Marcus is lying", skill: "insight", difficulty: "moderate", against: [{ who: "marcus_delgado", skill: "deception" }] }));
    await rig.turn(chatId, "I watch Marcus as he answers: is he lying?", "Marcus shrugs.");
    expect(checks(await events(rig, chatId)).map((c) => c.actor)).toEqual(["marcus_delgado"]);
    expect(rig.host.section("Outcome")).toContain("Read People check for \"tell whether Marcus is lying\", Jordan Ellis against Marcus Delgado:");
  });
});

describe("the chat's policy", () => {
  test("off plays the message as roleplay, and keeps the world's skill actions out of interpret's catalog", async () => {
    const { rig, chatId } = await chat({ mode: "off" });
    const prompts: string[] = [];
    rig.host.quietReply = (req: QuietRequest) => {
      const system = req.messages[0]?.content ?? "";
      if (!system.includes(INTERPRET)) return "{}";
      prompts.push(system);
      return JSON.stringify(tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard" }));
    };
    await rig.turn(chatId, "I try to talk my way in.", "You talk.");
    expect((await chips(rig, chatId)).some((c) => c.kind === "roll")).toBe(false);
    expect(rig.host.section("Outcome")).not.toContain("check");
    const catalog = prompts[0]?.split("Action catalog:\n")[1]?.split("\nRules:")[0] ?? "";
    expect(catalog.split("\n").map((l) => l.split(" — ")[0])).not.toEqual(expect.arrayContaining(["try", "skill_check", "attempt"]));
  });

  test("suggest gives a chip with nothing generated, and Roll plays the message with the roll", async () => {
    const { rig, chatId } = await chat({ mode: "suggest" });
    reading(rig, tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard" }));
    rig.host.sendUser(chatId, "I try to talk my way in.");
    await rig.host.settle();
    const halted = await rig.host.start(chatId, { type: "normal" });
    expect(halted.halted).toBe("cancelled");
    const ask = (await chips(rig, chatId)).find((c) => c.kind === "check");
    expect(ask).toMatchObject({ label: "Roll Persuasion?", actions: [{ id: "roll", label: "Roll" }, { id: "drop", label: "No roll" }] });
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: ask?.id, choice: "roll" })).applied).toBe(true);
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    await rig.host.finish(reply, "You talk.");
    expect((await chips(rig, chatId)).find((c) => c.kind === "roll")?.label).toMatch(/^Persuasion check: /);
  });

  test("'only when the message says it tries' holds: a read that doesn't say so plays as roleplay", async () => {
    const { rig, chatId } = await chat({ when: "tries" });
    reading(rig, tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard" }));
    await rig.turn(chatId, "I talk my way in.", "You talk.");
    expect((await chips(rig, chatId)).some((c) => c.kind === "roll")).toBe(false);
    reading(rig, tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard", tried: true }));
    await rig.turn(chatId, "I try to talk my way in.", "You talk.");
    expect((await chips(rig, chatId)).some((c) => c.kind === "roll")).toBe(true);
  });

  test("the skills list restricts what can be inferred", async () => {
    const { rig, chatId } = await chat({ skills: ["stealth"] });
    reading(rig, tryRead({ attempt: "talk my way in", skill: "persuasion", difficulty: "hard" }));
    await rig.turn(chatId, "I try to talk my way in.", "You talk.");
    expect((await chips(rig, chatId)).some((c) => c.kind === "roll")).toBe(false);
  });

  test("the most rolls a turn holds: past it a companion doesn't roll, and an opponent sets the difficulty without a roll", async () => {
    const { rig, chatId } = await chat({ who: "everyone", most: 2 });
    reading(rig, tryRead({ attempt: "sneak past", skill: "stealth", difficulty: "moderate", with: ["danny_okafor", "jess_kowalczyk"], against: [{ who: "bouncer", skill: "perception" }] }));
    await rig.turn(chatId, "We sneak past.", "You creep.");
    expect(checks(await events(rig, chatId)).map((c) => c.actor)).toEqual(["danny_okafor"]);
  });

  test("a catalog action with its own check keeps it, and an inferred check beside it isn't doubled", async () => {
    const climb: JsonObject = { id: "climb", label: "Climb the wall", params: {}, requires: [], check: { id: "climb", dice: "d20", dc: "11" }, outcomes: { success: [], failure: [] }, duration: "5" };
    const { rig, chatId } = await chat({}, [["actions", climb]]);
    reading(rig, { action: "climb", params: {}, more: [{ action: "try", params: { attempt: "climb the wall", skill: "athletics", difficulty: "moderate" }, text: "I try to climb the wall" }] });
    await rig.turn(chatId, "I try to climb the wall.", "You climb.");
    expect((await chips(rig, chatId)).filter((c) => c.kind === "roll").map((c) => c.label)).toEqual([expect.stringMatching(/^Climb the wall: /)]);
    expect((await chips(rig, chatId)).some((c) => c.kind === "choice" && c.label.includes("climb"))).toBe(false);
  });
});

describe("where a chat's policy comes from", () => {
  const inferOf = (world: WorldDoc, settings = defaultSettings()): InferredChecks | undefined => {
    const m = startMarkersFrom(settings, world, "rev").find((b) => b.kind === "infer");
    return m?.kind === "infer" ? m.to : undefined;
  };
  const authored = { ...INFERRED_PRESETS.grounded, most: 5 };
  const mine = { ...INFERRED_PRESETS.story, mode: "auto" as const, most: 2 };

  test("the world's default, then the user's setting, then the chat's own marker", async () => {
    const plain = baseWorld();
    const ruled = baseWorld({ ruleset: { inferred: authored } });
    // Neither sets one: the chat's starting realism preset (Story) at its Sheets level.
    expect(inferOf(plain)).toEqual(INFERRED_PRESETS.story);
    expect(inferOf(ruled)).toEqual(authored);
    expect(inferOf(plain, { ...defaultSettings(), inferred: mine })).toEqual(mine);
    expect(inferOf(ruled, { ...defaultSettings(), inferred: mine })).toEqual(authored);
    expect(inferOf(ruled, { ...defaultSettings(), inferred: mine, overrideWorldAdjudication: true })).toEqual(mine);
    const { rig, chatId } = await chat({ most: 4 });
    const most = async () => (await rig.rt.view(chatId, rig.host.userId)).controls?.inferred.most;
    expect(await most()).toBe(4);
    reading(rig, { action: null, params: {} });
    await rig.turn(chatId, "Hello.", "Hi.");
    rig.body(await rig.send({ type: "lre.marker", chatId, kind: "infer", to: { ...INFERRED_PRESETS.simulation, most: 7 } as unknown as JsonObject }));
    expect(await most()).toBe(7);
  });
});
