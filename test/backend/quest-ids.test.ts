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
