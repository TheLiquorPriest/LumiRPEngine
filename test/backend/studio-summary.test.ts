// The chat summaries the engine publishes to LumiRPEngine Studio say only what the player sees.

import { describe, expect, test } from "bun:test";
import { isRecord } from "../../src/shared/json";
import type { StudioChats } from "../../src/shared/studio-bridge";
import { chatsChannel, engineEndpoint, STUDIO_EXTENSION } from "../../src/shared/studio-bridge";
import { decodeQuestsView } from "../../src/packs/story/ui/panel";
import { Rig } from "../support/rig";

describe("the Studio's chat summary", () => {
  test("a secret the quest log masks goes by the quest log's own stand-in, and a body the player has found isn't read as alive", async () => {
    const rig = new Rig({ shipped: true });
    const created = rig.body(await rig.send({ type: "lre.world", op: "create", name: "Lantern Row", template: null }));
    if (!isRecord(created.world) || typeof created.world.id !== "string" || !isRecord(created.world.start)) throw new Error("no world");
    const worldId = created.world.id;
    // Where play starts, so the POV finds the body there.
    const place = String(created.world.start.place);
    const track = {
      id: "thorne_owes_the_guild",
      kind: "secret",
      label: "Thorne's hidden debt",
      start: "hidden",
      visibility: "secret",
      stages: { hidden: { label: "Something is off", cue: "The ledger doesn't add up.", next: [{ to: "out", when: "false" }] }, out: { label: "Out", truth: "Silas Thorne owes the guild a fortune.", next: [] } },
    };
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "tracks", id: track.id, value: track }));
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "old_bram", value: { id: "old_bram", kind: "person", name: "Old Bram", tier: "supporting", life: "dead", fields: { place }, relations: [] } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Evening on Lantern Row.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const { chats } = (await rig.host.rpcPool.read(engineEndpoint(chatsChannel(rig.host.userId)), STUDIO_EXTENSION)) as StudioChats;
    const summary = chats.find((c) => c.chatId === chatId);
    expect(summary?.quests.map((q) => q.label)).toContain("Something is going on");
    expect(JSON.stringify(summary)).not.toContain("thorne_owes_the_guild");
    // The same id the player's quest log gives it, so the Studio and Play name one quest alike.
    const log = decodeQuestsView((await rig.rt.view(chatId, rig.host.userId)).panels["story.quests"])?.tracks ?? [];
    expect(summary?.quests.find((q) => q.label === "Something is going on")?.id).toBe(log.find((t) => t.label === "Something is going on")?.id ?? "none in the quest log");
    expect(summary?.present.find((p) => p.id === "old_bram")?.life ?? JSON.stringify(summary?.present)).toMatch(/dead/i);
  });
});
