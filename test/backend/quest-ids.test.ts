// A secret track's own id never reaches the player (DESIGN §7): the quest log names it by a stand-in
// for as long as it lasts, through every stage and its reveal, and the player's requests about it
// (an answer, the hints it earns) work by that stand-in. Played through the starters' pushed state.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { decodeQuestsView, type QuestTrack } from "../../src/packs/story/ui/panel";
import { STARTER_WORLDS } from "../../src/packs/index";
import { Rig } from "../support/rig";

const STARTERS = [
  ["modern_slice_of_life", "Port Alder"],
  ["fantasy_town", "Brindlemere"],
  ["mystery_manor", "Ashcombe Manor"],
] as const;

/** Everything the engine has pushed to the player's view of the chat so far, from message `from` on. */
function pushed(rig: Rig, from = 0): string {
  return JSON.stringify(rig.host.sent.slice(from).filter((m) => m.type === "lre.state.snapshot" || m.type === "lre.state.delta"));
}

/** The quest log's rows as the quest sheet reads them. */
async function questLog(rig: Rig, chatId: string): Promise<QuestTrack[]> {
  return decodeQuestsView((await rig.rt.view(chatId, rig.host.userId)).panels["story.quests"])?.tracks ?? [];
}

async function starterChat(rig: Rig, starter: string, name: string, patch?: (draft: WorldDoc) => JsonObject[]): Promise<string> {
  const worldId = await rig.newWorld(name, starter);
  if (patch) {
    const { draft } = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null })) as { draft: WorldDoc };
    for (const value of patch(draft)) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: String(value.id), value }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  }
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return chatId;
}

describe("a secret track on the player layer", () => {
  test.each(STARTERS)("%s: no secret track's own id is pushed, at the start or at any stage, and its row keeps one stand-in", async (starter, name) => {
    const rig = new Rig({ shipped: true });
    const chatId = await starterChat(rig, starter, name);
    const secrets = Object.values((STARTER_WORLDS[starter] as (id: string, name: string) => WorldDoc)("w", name).tracks).filter((t) => t.visibility === "secret");
    expect(secrets.length).toBeGreaterThan(0);
    for (const t of secrets) expect(pushed(rig), `${t.id} at the start`).not.toContain(t.id);
    for (const t of secrets.filter((x) => x.kind !== "agenda")) {
      const shown = new Set<string>();
      for (const stage of Object.keys(t.stages)) {
        const from = rig.host.sent.length;
        rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "stage", track: t.id, to: stage }] }));
        await rig.turn(chatId, "I look around.", "Nothing much happens.");
        for (const s of secrets) expect(pushed(rig, from), `${s.id} once ${t.id} is at ${stage}`).not.toContain(s.id);
        // The row the quest sheet finds it by: its cue, under one stand-in from first to last.
        const cue = t.stages[stage]?.cue;
        const row = (await questLog(rig, chatId)).find((q) => cue !== undefined && q.cue === cue);
        if (row) shown.add(row.id);
      }
      expect([...shown]).toEqual([expect.stringMatching(/^~/)]);
    }
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("revealed in play, a secret shows its own label but keeps its stand-in, so its open quest sheet still finds it", async () => {
    const rig = new Rig({ shipped: true });
    // Port Alder's secret, its last step taken as soon as the track stands before it.
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft) => {
      const t = draft.tracks.s_shop_trouble;
      if (!t?.stages.statement) throw new Error("no s_shop_trouble");
      return [{ ...t, stages: { ...t.stages, statement: { ...t.stages.statement, next: [{ to: "truth", when: "true" }] } } } as unknown as JsonObject];
    });
    const before = (await questLog(rig, chatId)).find((q) => q.label === "Something is going on");
    if (!before) throw new Error("the masked secret isn't in the quest log");
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "stage", track: "s_shop_trouble", to: "statement" }] }));
    await rig.turn(chatId, "I look around.", "Nothing much happens.");
    const after = (await questLog(rig, chatId)).find((q) => q.id === before.id);
    expect(after?.label).toBe("What Marcus isn't saying");
    expect(after?.truths.length).toBe(1);
    expect(pushed(rig)).not.toContain("s_shop_trouble");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("a secret puzzle is answered and hinted by its stand-in, and the quest sheet keeps finding it", async () => {
    const rig = new Rig({ shipped: true });
    // Port Alder's truck puzzle, kept secret: the quest log shows it masked.
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft) => [{ ...(draft.tracks.p_township_truck as unknown as JsonObject), visibility: "secret" }]);
    expect(pushed(rig)).not.toContain("p_township_truck");
    const masked = (await questLog(rig, chatId)).find((q) => q.cue?.startsWith("The township pickup turns over fine"));
    if (!masked) throw new Error("the masked puzzle isn't in the quest log");
    expect([masked.label, masked.stage, masked.hints]).toEqual(["Something is going on", "", []]);
    const sheet = async () => (await questLog(rig, chatId)).find((q) => q.id === masked.id);
    const answer = async (text: string) => {
      rig.body(await rig.send({ type: "lre.action", chatId, action: "answer", params: { puzzle: masked.id, answer: text }, source: "palette" }));
      const g = await rig.host.start(chatId, { type: "normal" });
      await rig.host.finish(g, "You try it.");
    };
    // A wrong answer earns its first hint, on the same row.
    await answer("the battery");
    expect((await sheet())?.hints).toEqual(["No priming hum from the tank: the pump isn't getting power."]);
    // The right one solves it: the row is done, under the same id.
    await answer("fuel pump relay");
    const done = await sheet();
    expect([done?.status, done?.cue]).toEqual(["done", "The pump hums, the engine catches, and the exhaust note settles into a steady idle."]);
    expect(pushed(rig)).not.toContain("p_township_truck");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("answering a puzzle the quest log masks", () => {
  /** Sends Answer with `params` and plays the turn; the turn's decline, if any. */
  async function answer(rig: Rig, chatId: string, params: JsonObject): Promise<{ decline: string; outcome: string }> {
    rig.body(await rig.send({ type: "lre.action", chatId, action: "answer", params, source: "palette" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    const outcome = rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "";
    await rig.host.finish(g, "You try it.");
    const decline = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "decline");
    return { decline: `${decline?.label ?? ""} ${decline?.detail ?? ""}`, outcome };
  }

  test("a refusal names it as the player asked, never by the secret's own label", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder");
    const { decline, outcome } = await answer(rig, chatId, { puzzle: "s_shop_trouble", answer: "42" });
    expect(decline).toContain("no open puzzle s shop trouble");
    expect(`${decline}\n${outcome}`).not.toContain("What Marcus isn't saying");
  });

  test("its own label finds nothing, and interpret is told it by the label the quest log shows", async () => {
    const rig = new Rig({ shipped: true });
    // The truck puzzle kept secret, beside a public one: two open, so neither is answered as the only one.
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft): JsonObject[] => [
      { ...(draft.tracks.p_township_truck as unknown as JsonObject), visibility: "secret" },
      { id: "p_lockbox", kind: "puzzle", label: "The lockbox", start: "shut", visibility: "public", stages: { shut: { label: "Three dials", cue: "A lockbox with three brass dials.", answer: { expect: ["317"] }, next: [{ to: "open", when: "false" }] }, open: { label: "Open", next: [] } } },
    ]);
    const masked = async () => (await questLog(rig, chatId)).find((q) => q.cue?.startsWith("The township pickup turns over fine"));
    expect((await masked())?.label).toBe("Something is going on");
    await rig.turn(chatId, "The answer is the relay.", "You think it over.");
    const interpret = rig.host.quietCalls.map((c) => c.messages.map((m) => m.content).join("\n")).find((p) => p.includes("answer — Answer (open:")) ?? "";
    expect(interpret).toContain("Something is going on");
    expect(interpret).not.toContain("The truck that won't start");
    // A word only its hidden label holds doesn't reach it: it stays unanswered.
    const { decline } = await answer(rig, chatId, { puzzle: "truck", answer: "fuel pump relay" });
    expect(decline).toContain("no open puzzle truck");
    expect([(await masked())?.status, (await masked())?.hints]).toEqual(["active", []]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("with two open, interpret is told each by its cue, the cue's words reach the right one, and an answer that fits both is refused with no attempt and no hint", async () => {
    const rig = new Rig({ shipped: true });
    // Port Alder's truck puzzle and a lockbox, both kept secret: the quest log shows each as "Something is going on".
    const lockbox: JsonObject = { id: "p_lockbox", kind: "puzzle", label: "The lockbox", start: "shut", visibility: "secret", stages: { shut: { label: "Three dials", cue: "A lockbox with three brass dials.", answer: { expect: ["317"] }, hints: ["The dials only go to 3, 1 and 7 here."], next: [{ to: "open", when: "false" }] }, open: { label: "Open", cue: "The lockbox clicks open.", next: [] } } };
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder", (draft): JsonObject[] => [{ ...(draft.tracks.p_township_truck as unknown as JsonObject), visibility: "secret" }, lockbox]);
    const log = await questLog(rig, chatId);
    const truckId = log.find((q) => q.cue?.startsWith("The township pickup turns over fine"))?.id ?? "no truck";
    const boxId = log.find((q) => q.cue === "A lockbox with three brass dials.")?.id ?? "no lockbox";
    expect(log.filter((q) => q.id === truckId || q.id === boxId).map((q) => q.label)).toEqual(["Something is going on", "Something is going on"]);
    const row = async (id: string) => (await questLog(rig, chatId)).find((q) => q.id === id);
    const hints = async () => [(await row(truckId))?.hints.length, (await row(boxId))?.hints.length];
    let prompt = "";
    /** A typed turn interpret reads as Answer with `params` (each text its own: a text keeps its reading); the turn's decline chip, or "". */
    const typed = async (text: string, params: JsonObject): Promise<string> => {
      rig.host.quietReply = (req) => {
        const content = req.messages.map((m) => m.content).join("\n");
        if (!content.includes("You map a player's typed input")) return "{}";
        prompt = content;
        return JSON.stringify({ action: "answer", params, confidence: 0.9 });
      };
      await rig.turn(chatId, text, "You try it.");
      const decline = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "decline");
      return decline ? `${decline.label} | ${decline.detail ?? ""}` : "";
    };
    // By the label both rows show: refused, and neither is tried.
    expect(await typed("The answer is 317.", { puzzle: "Something is going on", answer: "317" })).toBe("Answer: declined | more than one open puzzle fits Something is going on");
    expect(await hints()).toEqual([0, 0]);
    // Interpret was told each by the cue the quest log shows, never by its own label.
    expect(prompt).toContain("Something is going on — A lockbox with three brass dials.");
    expect(prompt).toContain("Something is going on — The township pickup turns over fine");
    for (const label of ["The lockbox", "The truck that won't start"]) expect(prompt).not.toContain(label);
    // Naming neither, with both open, is refused the same way.
    expect(await typed("The code is 317.", { answer: "317" })).toBe("Answer: declined | more than one puzzle is open, and the answer doesn't say which");
    expect(await hints()).toEqual([0, 0]);
    // The cue's words reach the one they describe: a wrong guess at the pickup earns its hint alone...
    expect(await typed("The answer is the battery.", { puzzle: "the township pickup", answer: "the battery" })).toBe("");
    expect(await hints()).toEqual([1, 0]);
    // ...and the brass dials open the lockbox.
    expect(await typed("I dial 317 on the brass dials.", { puzzle: "the brass dials", answer: "317" })).toBe("");
    expect([(await row(boxId))?.status, (await row(boxId))?.cue, (await row(truckId))?.status]).toEqual(["done", "The lockbox clicks open.", "active"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("the narrator's sections", () => {
  test("an action a secret gates, tried before its stage, is told as the player reads it, never by the secret's id", async () => {
    const rig = new Rig({ shipped: true });
    const chatId = await starterChat(rig, "modern_slice_of_life", "Port Alder");
    // Read the past-due notice needs Port Alder's secret at its notice stage; the chat starts on its cue.
    rig.body(await rig.send({ type: "lre.action", chatId, action: "read_past_due_notice", params: {}, source: "palette" }));
    const g = await rig.host.start(chatId, { type: "normal" });
    const sections = (rig.host.lastInterceptor?.mutated ?? []).map((m) => m.content ?? "").join("\n");
    await rig.host.finish(g, "The desk is bare.");
    expect(sections).toContain("Read the past-due notice: it didn't happen (Not possible here and now)");
    for (const said of ["s_shop_trouble", "stage("]) expect(sections).not.toContain(said);
  });
});
