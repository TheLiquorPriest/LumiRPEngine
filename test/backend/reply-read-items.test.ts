// The reply's read and items (DESIGN §9.4, §4.3): the read is given the player's message as context,
// and a change applied from its confirm chip moves a quest that same turn, as an automatic one does.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { WorldState } from "../../src/engine/state";
import type { JsonObject } from "../../src/shared/json";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";

async function chat(puts: [string, JsonObject][] = []): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  for (const [collection, value] of puts) rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id: String(value.id), value }));
  if (puts.length > 0) rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

async function state(rig: Rig, chatId: string): Promise<WorldState> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const folded = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!folded) throw new Error("no state");
  return folded;
}

describe("the reply's read", () => {
  test("the read is given the player's message beside the reply", async () => {
    const { rig, chatId } = await chat();
    const asked: QuietRequest[] = [];
    rig.host.quietReply = (req) => {
      if ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK)) asked.push(req);
      return "{}";
    };
    await rig.turn(chatId, "I ask Danny to toss me the spare keys.", "Danny tosses them over.");
    expect(asked.length).toBe(1);
    expect(asked[0]?.messages.slice(1).some((m) => m.content.includes("I ask Danny to toss me the spare keys."))).toBe(true);
  });

  test("a found quest item applied from its confirm chip advances the quest that same turn", async () => {
    const key: JsonObject = { id: "brass_key", kind: "item", name: "Brass key", tier: "background", fields: { owner: "danny_okafor" }, relations: [{ type: "in", to: "danny_okafor" }] };
    const quest: JsonObject = {
      id: "the_key",
      kind: "quest",
      label: "Get the key",
      start: "find",
      visibility: "public",
      stages: { find: { label: "Get the brass key", next: [{ to: "done", when: "carries(pov, 'brass_key')" }] }, done: { label: "Got it", next: [] } },
    };
    const { rig, chatId } = await chat([["entities", key], ["tracks", quest]]);
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals: [{ type: "give", item: "brass_key", from: "danny_okafor", to: "pov" }] }) : "{}");
    await rig.turn(chatId, "I ask Danny for the brass key.", "Danny hands you the brass key.");
    const chip = (await rig.rt.view(chatId, rig.host.userId)).chips.find((c) => c.kind === "confirm");
    if (!chip) throw new Error("no confirm chip");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice: "confirm" }));
    const after = await state(rig, chatId);
    expect(after.entities.brass_key?.relations).toContainEqual({ type: "in", to: "pov" });
    expect(after.tracks.the_key?.stage).toBe("done");
  });
});
