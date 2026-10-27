// What a reply's reads leave under it (DESIGN §9.2, §9.4): a Re-read replaces only its read's chips,
// keeping what the turn said of the player's message; the turn's Timelapse offers are sized again
// against the new read, so the time the message asked for is offered once and never run twice
// (L27); a Re-read held behind a reply lands its offers however that reply ends; and a Continue
// offers a skip its added text tells that is too long to run unasked.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import type { JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const NONE: JsonObject = { action: null, params: {}, confidence: 0.9, reason: "no action" };
const SKIPPED = "The narration skipped ahead — run it as a timelapse?";
// Two days later: past the default of a day that a skip runs without asking.
const TWO_DAYS: JsonObject[] = [{ type: "time_advance", minutes: 2 * 24 * 60 }];

/** The model: `interpret` reads every typed message as `read`, and `extract` reads a reply as `told.proposals`. */
function model(rig: Rig, read: JsonObject, told: { proposals: JsonObject[] }): void {
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (system.includes(INTERPRET_MARK)) return JSON.stringify({ confidence: 0.9, ...read });
    if (system.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: told.proposals });
    return "{}";
  };
}

/** A shipped world's chat after one turn that reads nothing. */
async function played(name: string, template: string, greeting: string): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  rig.host.quietReply = () => "{}";
  const worldId = await rig.newWorld(name, template);
  const chatId = rig.host.createChat(greeting);
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around.", "It is quiet.");
  return { rig, chatId };
}

async function chipsOf(rig: Rig, chatId: string, messageId: string): Promise<Chip[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === messageId);
}

function headId(rig: Rig, chatId: string): string {
  const head = rig.host.head(chatId);
  if (!head) throw new Error("no reply");
  return head.id;
}

/** Edits the reply to `text`; its Re-read chip. */
async function edited(rig: Rig, chatId: string, messageId: string, text: string): Promise<string> {
  rig.host.editMessage(chatId, messageId, text);
  await rig.host.settle();
  const chip = (await chipsOf(rig, chatId, messageId)).find((c) => c.kind === "reread");
  if (!chip) throw new Error("no Re-read chip");
  return chip.id;
}

async function reread(rig: Rig, chatId: string, messageId: string, text: string): Promise<void> {
  const chip = await edited(rig, chatId, messageId, text);
  rig.body(await rig.send({ type: "lre.chip", chatId, chip, choice: "reread" }));
}

describe("a Re-read and the time the player's message asked for", () => {
  test("its Timelapse offers what the new read leaves of it: none once the reply tells it all, the rest of part, all of it again for none", async () => {
    const { rig, chatId } = await played("Port Alder", "modern_slice_of_life", "Morning.");
    const told = { proposals: [] as JsonObject[] };
    model(rig, { action: "go", params: { to: "bluebird_coffee" }, then: { span: "for two hours" } }, told);
    await rig.turn(chatId, "I head over to Bluebird Coffee, then wait there for two hours.", "The bell over the door jangles.");
    const reply = headId(rig, chatId);
    const asked = async () => (await chipsOf(rig, chatId, reply)).filter((c) => c.kind === "timelapse_offer").map((c) => c.label);
    expect(await asked()).toEqual(["Timelapse 2 h?"]);
    // The reply's time counts the whole turn, the walk over included (DESIGN §9.4).
    told.proposals = [{ type: "time_advance", minutes: 180 }];
    await reread(rig, chatId, reply, "The bell jangles, and three hours pass over coffee.");
    expect(await asked()).toEqual([]);
    told.proposals = [{ type: "time_advance", minutes: 60 }];
    await reread(rig, chatId, reply, "The bell jangles, and an hour passes over coffee.");
    expect(await asked()).toEqual([expect.stringMatching(/^Timelapse 1 h( \d+ min)?\?$/)]);
    told.proposals = [];
    await reread(rig, chatId, reply, "The bell jangles.");
    expect(await asked()).toEqual(["Timelapse 2 h?"]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a Re-read held behind a reply in flight", () => {
  test("lands its offers when that reply is stopped, and no later turn brings back the offer a newer read replaced", async () => {
    const { rig, chatId } = await played("Port Alder", "modern_slice_of_life", "Morning.");
    const told = { proposals: [] as JsonObject[] };
    model(rig, NONE, told);
    const reply = headId(rig, chatId);
    const skips = async () => (await chipsOf(rig, chatId, reply)).filter((c) => c.kind === "timelapse_offer").map((c) => c.label);
    const chip = await edited(rig, chatId, reply, "Two days later, the shop opens again.");
    rig.host.sendUser(chatId, "I wait.");
    await rig.host.settle();
    const g = await rig.host.start(chatId, { type: "normal" });
    told.proposals = TWO_DAYS;
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip, choice: "reread" }))).toEqual({ applied: false, pending: true });
    told.proposals = [];
    await rig.host.stop(g, "Danny looks up.");
    expect(await skips()).toEqual([SKIPPED]);
    // A newer Re-read reads no skip: its offer goes, and stays gone through the next turn.
    await reread(rig, chatId, reply, "The shop opens again.");
    expect(await skips()).toEqual([]);
    await rig.turn(chatId, "I wait some more.", "Time passes.");
    expect(await skips()).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a Re-read and what the turn said of the player's message", () => {
  test("keeps the roleplay and couldn't receipts and the rest of the message; only the read's own chips go", async () => {
    const { rig, chatId } = await played("Harrowmere Hall", "mystery_manor", "Evening.");
    const told = { proposals: [] as JsonObject[] };
    model(rig, { action: "go", params: { to: "entrance_hall" }, text: "I stay in the hall", more: [{ action: "find_muddy_prints", params: {}, text: "I examine the floor by the garden door" }], next: "I look out at the rain" }, told);
    await rig.turn(chatId, "I stay in the hall. I examine the floor by the garden door. I look out at the rain.", "The hall is quiet.");
    const reply = headId(rig, chatId);
    const turnChips = async () => (await chipsOf(rig, chatId, reply)).filter((c) => c.kind === "untracked" || c.kind === "decline" || c.kind === "choice").map((c) => `${c.kind} ${c.label}`);
    const before = await turnChips();
    expect(before.map((c) => c.split(" ")[0])).toEqual(["untracked", "decline", "choice"]);
    await reread(rig, chatId, reply, "The hall is quiet, and rain streaks the windows.");
    expect(await turnChips()).toEqual(before);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

describe("a Continue", () => {
  test("offers a skip its added text tells that is too long to run unasked", async () => {
    const { rig, chatId } = await played("Port Alder", "modern_slice_of_life", "Morning.");
    const told = { proposals: [] as JsonObject[] };
    model(rig, NONE, told);
    await rig.turn(chatId, "I wait.", "The shop is quiet.");
    const reply = headId(rig, chatId);
    told.proposals = TWO_DAYS;
    const c = await rig.host.start(chatId, { type: "continue", messageId: reply });
    await rig.host.finish(c, " Two days later, the shop opens again.");
    expect((await chipsOf(rig, chatId, reply)).filter((ch) => ch.kind === "timelapse_offer").map((ch) => ch.label)).toEqual([SKIPPED]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
