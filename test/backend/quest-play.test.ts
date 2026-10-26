// Quests as they play (DESIGN §10, §11): an end stage pays out, a stage this turn's action reaches is
// told to this turn's narrator, hints wait behind Show a hint and only opened ones are told, the GM's
// Stage enters a stage as play does, a person's secret cue is told once, by Stance, the lists of
// actions name no step the story hasn't come to, and the lint names a flag nothing sets. Played
// through the starters, as the player and the GM would.

import { describe, expect, test } from "bun:test";
import { interpretCatalog } from "../../src/backend/interpret-context";
import { toChain } from "../../src/backend/ledger-io";
import { createRegistry } from "../../src/engine/registry-impl";
import { initialState } from "../../src/engine/world-state";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import { regardAxes } from "../../src/packs/relationships/core/index";
import { decodeQuestsView, type QuestTrack } from "../../src/packs/story/ui/panel";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { EditOp, ResultBodies } from "../../src/shared/protocol";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";

const STARTERS = [
  ["modern_slice_of_life", "Port Alder"],
  ["fantasy_town", "Brindlemere"],
  ["mystery_manor", "Ashcombe Manor"],
] as const;

function starter(id: string, name: string): WorldDoc {
  return (STARTER_WORLDS[id] as (id: string, name: string) => WorldDoc)("w", name);
}

/** A starter's chat, with `tracks` put into its world first. */
async function chatOf(rig: Rig, template: string, name: string, tracks: readonly JsonObject[] = []): Promise<string> {
  const worldId = await rig.newWorld(name, template);
  if (tracks.length > 0) {
    for (const value of tracks) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: String(value.id), value }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  }
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

/** A GM edit of these operations. */
async function gm(rig: Rig, chatId: string, ...ops: EditOp[]): Promise<void> {
  rig.body(await rig.send({ type: "lre.edit", chatId, ops }));
}

/** The quest log's rows as the quest sheet reads them. */
async function questLog(rig: Rig, chatId: string): Promise<QuestTrack[]> {
  return decodeQuestsView((await rig.rt.view(chatId, rig.host.userId)).panels["story.quests"])?.tracks ?? [];
}

/** Each section's text as GM → Sections previews it for the next turn, by slot ("" when not sent). */
async function sections(rig: Rig, chatId: string): Promise<Record<string, string>> {
  const body = rig.body(await rig.send({ type: "lre.sections", chatId })) as unknown as ResultBodies["lre.sections"];
  return Object.fromEntries(body.sections.map((s) => [s.slot, s.status === "sent" ? (s.content ?? "") : ""]));
}

/** The chat's head: its state and the world it plays. */
async function head(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = state ? core?.worldAt(state.revision) : undefined;
  if (!state || !world) throw new Error("no head");
  return { state, world };
}

/** `from`'s regard for the player character on `axis`, as the relationships pack reads it, and the reasons it has changed for, oldest first. */
async function regardOf(rig: Rig, chatId: string, from: string, axis: string): Promise<{ value: number; why: string[] }> {
  const { state, world } = await head(rig, chatId);
  const history = state.entities[from]?.relations.find((r) => r.type === "regard" && r.to === world.pov)?.fields?.history;
  const why = (Array.isArray(history) ? history : []).flatMap((h) => (isRecord(h) && typeof h.why === "string" ? [h.why] : []));
  return { value: regardAxes(rig.rt.registry.context(world, state), from, world.pov)[axis] ?? 0, why };
}

/** The last ✎ fix or GM edit chip on the head, with its Undo. */
async function lastFix(rig: Rig, chatId: string) {
  const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "fix").at(-1);
  if (!chip) throw new Error("no fix chip");
  return chip;
}

/** Each starter quest, the stage before its end, the end, and the regard its end rewards. */
const ENDS = [
  ["fantasy_town", "Brindlemere", "q_far_bank_fever", "deliver", "done", "wren_aldous", "warmth"],
  ["fantasy_town", "Brindlemere", "q_idle_millstone", "fit", "done", "joss_tamber", "warmth"],
  ["modern_slice_of_life", "Port Alder", "q_fleet_contract", "service_run", "done", "marcus_delgado", "respect"],
  ["modern_slice_of_life", "Port Alder", "q_pontoon_weekend", "loan", "done", "dale_whitcomb", "respect"],
  ["mystery_manor", "Ashcombe Manor", "q_find_the_truth", "accuse", "solved", "lady_honoria", "warmth"],
  ["mystery_manor", "Ashcombe Manor", "q_call_for_help", "call", "done", "gideon_pell", "trust"],
] as const;

describe("a quest's end", () => {
  test.each(ENDS)("%s (%s): %s, from %s to its end %s, pays out what the end rewards", async (template, name, track, before, end, from, axis) => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, template, name);
    const reward = starter(template, name).tracks[track]?.stages[end]?.rewards?.find((r) => r.type === "relationships.adjust" && r.args.from === from && r.args.axis === axis);
    expect(typeof reward?.args.why).toBe("string");
    await gm(rig, chatId, { op: "stage", track, to: before });
    const was = await regardOf(rig, chatId, from, axis);
    await gm(rig, chatId, { op: "stage", track, to: end });
    // The end's own reward, for the reason it gives, and the regard is up.
    const now = await regardOf(rig, chatId, from, axis);
    expect(now.why.slice(was.why.length)).toContain(String(reward?.args.why));
    expect(now.value).toBeGreaterThan(was.value);
    expect((await questLog(rig, chatId)).find((q) => q.id === track)?.status).toBe("done");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a stage this turn reaches", () => {
  test("Port Alder: taking the fleet job tells this turn's narrator the quest's next step, in the Quest section and the Outline", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder");
    await gm(rig, chatId, { op: "move", entity: "pov", to: "alder_automotive" }, { op: "move", entity: "marcus_delgado", to: "alder_automotive" });
    const told: string[][] = [];
    const deliver = rig.rt.deliver.bind(rig.rt);
    rig.rt.deliver = async (input) => {
      const delivered = await deliver(input);
      told.push([...delivered.fills.values()]);
      return delivered;
    };
    rig.body(await rig.send({ type: "lre.action", chatId, action: "accept_fleet_job", params: {}, source: "palette", now: true }));
    const g = await rig.host.start(chatId, { type: "normal" });
    await rig.host.finish(g, "Marcus slides the work order across the counter.");
    const fills = told.at(-1) ?? [];
    expect(fills.find((c) => c.startsWith("[Quest]")) ?? "").toContain("The Fleet Contract: Fix the township pickup");
    expect(fills.find((c) => c.startsWith("[Outline]")) ?? "").toContain("Fix the township pickup");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("hints", () => {
  test("a stage's hints wait behind Show a hint, open one at a time with an Undo, and only opened ones reach the narrator", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder");
    const quest = starter("modern_slice_of_life", "Port Alder").tracks.q_pontoon_weekend;
    const [first = "", second = ""] = quest?.stages.diagnose?.hints ?? [];
    await gm(rig, chatId, { op: "stage", track: "q_pontoon_weekend", to: "diagnose" });
    const row = async () => (await questLog(rig, chatId)).find((q) => q.id === "q_pontoon_weekend");
    expect([(await row())?.hints, (await row())?.opened]).toEqual([[first, second], 0]);
    expect((await sections(rig, chatId)).quest).not.toContain(first);
    const open = () => rig.send({ type: "lre.fix", chatId, hint: "q_pontoon_weekend" });
    rig.body(await open());
    expect((await row())?.opened).toBe(1);
    const told = (await sections(rig, chatId)).quest;
    expect([told.includes(`${quest?.label}, a hint your character has: ${first}`), told.includes(second)]).toEqual([true, false]);
    // The player's own doing, named as theirs, with its Undo.
    const chip = await lastFix(rig, chatId);
    expect([chip.label, chip.detail]).toEqual([`Opened a hint: ${quest?.label}`, undefined]);
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "undo" }));
    expect((await row())?.opened).toBe(0);
    rig.body(await open());
    rig.body(await open());
    expect((await row())?.opened).toBe(2);
    // Every one earned is open: there is no other to show.
    const refused = await open();
    expect(refused.type === "lre.error" ? refused.message : "").toContain("No hint to show");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the GM's Stage", () => {
  test("on to a stage, it plays the entry, its effects and its reveal, as a GM edit with its Undo; back, it only sets the stage", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder");
    const masked = (await questLog(rig, chatId)).find((q) => q.label === "Something is going on");
    if (!masked) throw new Error("the masked secret isn't in the quest log");
    await gm(rig, chatId, { op: "stage", track: "s_shop_trouble", to: "truth" });
    const revealed = (await questLog(rig, chatId)).find((q) => q.id === masked.id);
    expect([revealed?.label, revealed?.truths.length]).toEqual(["What Marcus isn't saying", 1]);
    const chip = await lastFix(rig, chatId);
    expect(chip.label).toBe("GM edit");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "undo" }));
    expect((await questLog(rig, chatId)).find((q) => q.id === masked.id)?.truths).toEqual([]);
    // On to the trial: its entry tells the player character of the pickup.
    const knows = async () => (await head(rig, chatId)).state.entities.pov?.relations.some((r) => r.type === "knows" && r.to === "township_pickup") ?? false;
    expect(await knows()).toBe(false);
    await gm(rig, chatId, { op: "stage", track: "q_fleet_contract", to: "trial" });
    expect(await knows()).toBe(true);
    // Back to the start: the stage only, and what the trial's entry did stays.
    await gm(rig, chatId, { op: "stage", track: "q_fleet_contract", to: "kickoff" });
    expect([(await head(rig, chatId)).state.tracks.q_fleet_contract?.stage, await knows()]).toEqual(["kickoff", true]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a person's secret cue", () => {
  test("is told once, by Stance while they are here, and never as a quest log row of someone's behaviour", async () => {
    const rig = new Rig({ shipped: true });
    const CUE = "Marcus keeps glancing at the office door.";
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder", [
      { id: "s_drawer", kind: "secret", label: "Unpaid letters", owner: "marcus_delgado", start: "watch", visibility: "secret", stages: { watch: { label: "Watching", cue: CUE, next: [{ to: "known", when: "false" }] }, known: { label: "Known", truth: "The bank's letters are hidden in a drawer.", next: [] } } },
    ]);
    await gm(rig, chatId, { op: "move", entity: "pov", to: "alder_automotive" }, { op: "move", entity: "marcus_delgado", to: "alder_automotive" });
    expect(JSON.stringify(await questLog(rig, chatId))).not.toContain(CUE);
    const told = await sections(rig, chatId);
    expect([told.quest?.includes(CUE), told.stance?.includes(CUE)]).toEqual([false, true]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the lists of actions", () => {
  test("Port Alder: neither the Actions sheet nor interpret's catalog names a step the story hasn't come to; one it has stays, locked where it can't be taken", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await chatOf(rig, "modern_slice_of_life", "Port Alder");
    const AHEAD = ["read_past_due_notice", "read_bank_statement", "talk_to_marcus", "diagnose_pontoon"];
    const palette = async () => (await rig.rt.view(chatId, rig.host.userId)).palette?.entries ?? [];
    const listed = async () => (await palette()).map((e) => e.action);
    expect((await listed()).filter((id) => AHEAD.includes(id))).toEqual([]);
    expect((await palette()).find((e) => e.action === "accept_fleet_job")?.options[0]?.disabled).toBe("Not possible here and now");
    expect(await listed()).toEqual(expect.arrayContaining(["look_at_pontoon", "ask_about_marcus"]));
    const reg = createRegistry(ALL_PACKS);
    const world = starter("modern_slice_of_life", "Port Alder");
    const catalog = interpretCatalog(reg, world, initialState(world, "r", reg), [...reg.actions.values(), ...Object.values(world.actions)], () => true).entries.map((e) => e.action.id);
    expect(catalog.filter((id) => AHEAD.includes(id))).toEqual([]);
    expect(catalog).toEqual(expect.arrayContaining(["accept_fleet_job", "look_at_pontoon", "ask_about_marcus"]));
    // Once the story comes to a step, it is listed.
    await gm(rig, chatId, { op: "stage", track: "s_shop_trouble", to: "notice" });
    expect(await listed()).toContain("read_past_due_notice");
  });
});

describe("the unset-flag lint", () => {
  test("names a flag a quest or a secret's gate waits on that nothing sets, and no starter has one", () => {
    const reg = createRegistry(ALL_PACKS);
    const issues = (world: WorldDoc) => reg.lints.flatMap((l) => l.check(world, reg)).filter((i) => i.code === "story.unset_flag");
    for (const [template, name] of STARTERS) expect(issues(starter(template, name)), name).toEqual([]);
    const world = starter("modern_slice_of_life", "Port Alder");
    const trial = world.tracks.q_fleet_contract?.stages.trial;
    if (!trial) throw new Error("no trial stage");
    trial.next = [{ to: "inspection", when: "flag('township_truck_fixed') and flag('priya_called_back')" }];
    world.lore.ledger = { id: "ledger", title: "The second ledger", content: "Marcus keeps a second ledger.", keys: [], links: [], secret: true, gate: "flag('ledger_found')" };
    expect(issues(world).map((i) => [i.severity, i.path, i.message.includes('"priya_called_back"') || i.message.includes('"ledger_found"')])).toEqual([
      ["warning", "tracks.q_fleet_contract", true],
      ["warning", "lore.ledger.gate", true],
    ]);
    // An action that sets it, and the warning goes.
    const accept = world.actions.accept_fleet_job;
    if (!accept) throw new Error("no accept_fleet_job");
    world.actions.call_priya = { ...accept, id: "call_priya", label: "Call Priya back", outcomes: { default: [{ type: "story.flag", args: { name: "priya_called_back", value: true } }] } };
    expect(issues(world).map((i) => i.path)).toEqual(["lore.ledger.gate"]);
  });
});
