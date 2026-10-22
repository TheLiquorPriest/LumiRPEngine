// Recent chat for every helper step (DESIGN §5.2): a step other than interpret reads none until its
// card turns it on; then its prompt carries the messages before the turn's, oldest first, within
// its limits, either of which may be no limit.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { recentMessages } from "../../src/backend/interpret-context";
import { stepUpdatePatch } from "../../src/frontend/settings/steps";
import type { ChainMessage } from "../../src/engine/ledger/chain";
import { recentOf, stepConfigOf } from "../../src/shared/settings";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";
const LEAD = "Recent chat, oldest first";

/** The extract calls' input messages, as the helper is given them. */
function extractInputs(rig: Rig): string[] {
  const inputs: string[] = [];
  rig.host.quietReply = (req: QuietRequest) => {
    if ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK)) inputs.push(req.messages[1]?.content ?? "");
    return "{}";
  };
  return inputs;
}

/** The lines of the Recent chat block, to the end of the input. */
function recentBlock(input: string): string[] {
  const lines = input.split("\n");
  const at = lines.findIndex((l) => l.startsWith(LEAD));
  return at < 0 ? [] : lines.slice(at + 1);
}

function message(id: string, isUser: boolean, text: string): ChainMessage {
  return { id, isUser, swipeId: 0, swipes: [text], ledger: null };
}

describe("recent chat for every helper step", () => {
  test("extract reads none by default; on, its input carries the messages before the turn's, oldest first", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const inputs = extractInputs(rig);
    const card = stepConfigOf((await rig.rt.settings.get(rig.host.userId)).modelUse.steps, "extract");
    expect(recentOf("extract", card).on).toBe(false);
    await rig.turn(chatId, "Hi Danny.", "Danny looks up from the engine bay.");
    await rig.turn(chatId, "I nod.", "He nods back.");
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.some((i) => i.includes(LEAD))).toBe(false);

    rig.body(await rig.send({ type: "lre.settings.set", patch: stepUpdatePatch("extract", { ...card, recent: { on: true, messages: "none", tokens: 3000 } }) }));
    const before = inputs.length;
    await rig.turn(chatId, "I check my phone.", "No new messages.");
    const read = inputs.slice(before);
    expect(read).toHaveLength(1);
    expect(recentBlock(read[0] ?? "")).toEqual(["Story: Morning.", "Player: Hi Danny.", "Story: Danny looks up from the engine bay.", "Player: I nod.", "Story: He nods back."]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("no limit on messages stops at the token limit, the newest kept; no limit on both reads them all", () => {
    const chat = [message("a", false, "Morning."), message("b", true, "Hi there, how was the drive in this morning?"), message("c", false, "Long, but the coffee helped."), message("d", true, "Good.")];
    // "Player: Good." and "Story: Long, but the coffee helped." are 5 and 11 tokens by the estimate: 16 holds both whole, and nothing older.
    expect(recentMessages(chat, { messages: "none", tokens: 16 }, true)).toEqual(["Story: Long, but the coffee helped.", "Player: Good."]);
    expect(recentMessages(chat, { messages: "none", tokens: "none" }, true)).toHaveLength(4);
    expect(recentMessages(chat, { on: false, messages: "none", tokens: "none" }, true)).toEqual([]);
  });
});
