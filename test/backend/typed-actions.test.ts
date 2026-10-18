// What `interpret` reads from typed text (DESIGN §5.2, §9.4), on Port Alder: an action whose params
// name nothing in the world plays as plain roleplay, says why on a decline chip and tells the next
// reply it didn't happen.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";

/** A Port Alder chat; `hidden` adds someone of that name the POV can't see. */
async function chat(extra: { hidden?: string } = {}): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  if (extra.hidden) {
    rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection: "entities", id: "hidden_one", value: { id: "hidden_one", kind: "person", name: extra.hidden, tier: "background", fields: {}, relations: [], visibility: "secret" } }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  }
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  return { rig, chatId };
}

/** `interpret` answers `read(typed text)`; every other step reads nothing. */
function reading(rig: Rig, read: (text: string) => JsonObject): void {
  rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes(INTERPRET_MARK) ? JSON.stringify(read(req.messages[1]?.content ?? "")) : "{}");
}

async function folded(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = state ? core?.worldAt(state.revision) : undefined;
  if (!state || !world) throw new Error("no state");
  return { state, world };
}

/** The POV's money history (the Money panel's lines). */
async function history(rig: Rig, chatId: string): Promise<JsonValue[]> {
  const h = (await folded(rig, chatId)).state.packs.economy?.history;
  return Array.isArray(h) ? h : [];
}

/** The chips on the latest reply. */
async function replyChips(rig: Rig, chatId: string): Promise<Chip[]> {
  const head = rig.host.head(chatId);
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id);
}

/** Plays the next turn on `text` and returns what its Outcome slot told the narrator. */
async function nextTurn(rig: Rig, chatId: string, text: string): Promise<string> {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  const g = await rig.host.start(chatId, { type: "normal" });
  const outcome = rig.host.lastInterceptor?.mutated.find((m) => m.content?.startsWith("[Outcome]"))?.content ?? "";
  await rig.host.finish(g, "A quiet moment passes.");
  return outcome;
}

describe("a typed action that names nothing in the world", () => {
  const pay = (to: string) => () => ({ action: "pay", params: { to, amount: 6 }, confidence: 0.9 });

  test("'I pay Rena for the latte' charges nothing, its reply says why on a decline chip, and the next reply is told it didn't happen", async () => {
    const { rig, chatId } = await chat();
    reading(rig, pay("rena"));
    const before = await history(rig, chatId);
    await rig.turn(chatId, "I pay Rena for the latte.", "You hand Rena a few bills and take the cup.");
    expect(await history(rig, chatId)).toEqual(before);
    const chip = (await replyChips(rig, chatId)).find((c) => c.kind === "decline");
    // The chip names the action and the name as the player typed it, with the usual choices.
    expect(`${chip?.label} ${chip?.detail}`).toContain("Pay");
    expect(chip?.detail).toContain("Rena");
    expect(chip?.actions.map((a) => a.id)).toEqual(["remove", "accept"]);
    const told = (await nextTurn(rig, chatId, "I look around.")).split("\n").find((line) => line.includes("Pay"));
    expect(told).toContain("Rena");
    expect(rig.rt.ledger.errors).toEqual([]);

    // Remove it rewords that note before the next reply.
    const other = await chat();
    reading(other.rig, pay("rena"));
    await other.rig.turn(other.chatId, "I pay Rena for the latte.", "You hand Rena a few bills and take the cup.");
    const decline = (await replyChips(other.rig, other.chatId)).find((c) => c.kind === "decline");
    expect(other.rig.body(await other.rig.send({ type: "lre.chip", chatId: other.chatId, chip: decline?.id, choice: "remove" })).applied).toBe(true);
    const removed = (await nextTurn(other.rig, other.chatId, "I look around.")).split("\n").find((line) => line.includes("Pay"));
    expect(removed).toBeDefined();
    expect(removed).not.toBe(told);
  });

  test("a name the POV can't see is never repeated on the chip", async () => {
    const { rig, chatId } = await chat({ hidden: "Vex Morrow" });
    reading(rig, pay("Vex"));
    await rig.turn(chatId, "I pay Vex for the latte.", "You look around for Vex.");
    const chips = await replyChips(rig, chatId);
    expect(chips.some((c) => c.kind === "decline")).toBe(true);
    for (const c of chips) expect(`${c.label} ${c.detail ?? ""}`.toLowerCase()).not.toContain("vex");
  });
});
