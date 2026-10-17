// ✎ fixes (DESIGN §12): checked against the field they write, one `fix` entry each with its own
// Undo chip, and a fix held through a reply that no longer applies is told, never dropped silently.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { toChain } from "../../src/backend/ledger-io";
import { Rig } from "../support/rig";
import { POV } from "../support/test-pack";

/** A test-world chat whose person kind has a bounded number, an enum and a locked field. */
async function chat(rig: Rig): Promise<string> {
  const worldId = await rig.newWorld();
  const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
  const person: JsonObject = {
    id: "person",
    label: "Person",
    fields: { cash: { type: "money" }, mood: { type: "text" }, detail: { type: "text" }, grit: { type: "number", min: 1, max: 5 }, temper: { type: "enum", values: ["calm", "hot"] }, secret: { type: "text", locked: true } },
  };
  rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: draft.base, collection: "kinds", id: "person", value: person }));
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
  const chatId = rig.host.createChat("Morning, Sam.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "look around", "Quiet.");
  return chatId;
}

async function fields(rig: Rig, chatId: string): Promise<JsonObject> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  return core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state.entities[POV]?.fields ?? {};
}

async function chips(rig: Rig, chatId: string, kind: Chip["kind"]): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === kind);
}

async function refusal(rig: Rig, request: Record<string, unknown>): Promise<string> {
  const reply = await rig.send(request);
  if (reply.type !== "lre.error") throw new Error(`${String(request.field)} was accepted`);
  return reply.message;
}

describe("✎ fixes", () => {
  test("a fix is checked against its field: out of range, the wrong type, an unknown enum value and a locked field are refused", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    const fix = (field: string, value: unknown) => ({ type: "lre.fix", chatId, entity: POV, field, value });
    expect(await refusal(rig, fix("grit", 9))).toContain("between 1 and 5");
    expect(await refusal(rig, fix("grit", 0))).toContain("between 1 and 5");
    expect(await refusal(rig, fix("grit", "four"))).toContain("must be a number");
    expect(await refusal(rig, fix("temper", "furious"))).toContain("calm, hot");
    expect(await refusal(rig, fix("secret", "the key is under the mat"))).toContain("locked");
    // Nothing refused was written.
    expect((await fields(rig, chatId)).grit).toBeUndefined();
    rig.body(await rig.send(fix("grit", 5)));
    rig.body(await rig.send(fix("temper", "hot")));
    // A value that looks like a formula is stored as typed.
    rig.body(await rig.send(fix("mood", "=1+1")));
    expect(await fields(rig, chatId)).toMatchObject({ grit: 5, temper: "hot", mood: "=1+1" });
  });

  test("each fix gets a Corrected chip whose Undo takes it back", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "mood", value: "calm" }));
    rig.body(await rig.send({ type: "lre.fix", chatId, entity: POV, field: "grit", value: 2 }));
    const corrected = await chips(rig, chatId, "fix");
    expect(corrected.map((c) => [c.label, c.actions.map((a) => a.label)])).toEqual([
      ["Corrected", ["Undo"]],
      ["Corrected", ["Undo"]],
    ]);
    const mood = corrected.find((c) => c.detail?.includes("calm"));
    if (!mood) throw new Error("no chip for the mood fix");
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: mood.id, choice: "undo" }));
    expect(await fields(rig, chatId)).toMatchObject({ mood: "fine", grit: 2 });
    expect((await chips(rig, chatId, "fix")).map((c) => c.id)).not.toContain(mood.id);
    // The Journal keeps the correction that stands, as its own line.
    const journal = (await rig.rt.view(chatId, rig.host.userId)).journal.filter((n) => n.kind === "fix");
    expect(journal.map((n) => n.text)).toEqual([expect.stringContaining("2")]);
  });

  test("a fix held through a reply that no longer applies shows a notice until dismissed", async () => {
    const rig = new Rig();
    const chatId = await chat(rig);
    rig.host.sendUser(chatId, "buy:lamp:20");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    // Made while the reply streams: held, and checked again when the reply finishes (P2).
    const held = await rig.rt.ledger.write(chatId, rig.host.userId, { kind: "post", id: "w-held", target: "head", entry: { kind: "fix", events: [{ type: "test.use", data: { item: "lamp" } }] } });
    expect(held.pending).toBe(true);
    await rig.host.finish(g, "The lamp slips away. [lose:lamp]");
    const [notice] = await chips(rig, chatId, "refused");
    expect(notice?.label).toBe("Your correction didn't apply after the reply");
    expect(notice?.actions.map((a) => a.id)).toEqual(["dismiss"]);
    // It stays until dismissed, restarts included.
    const again = rig.restart();
    expect((await chips(again, chatId, "refused")).map((c) => c.id)).toEqual(["refused:w-held"]);
    again.body(await again.send({ type: "lre.chip", chatId, chip: "refused:w-held", choice: "dismiss" }));
    expect(await chips(again, chatId, "refused")).toEqual([]);
  });
});
