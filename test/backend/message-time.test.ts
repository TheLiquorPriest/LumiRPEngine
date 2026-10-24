// The message's own time wins (DESIGN §9.2 typed time, §9.4 `time.advance`): "until dinner" runs to
// the player character's own dinner, a vague "a few minutes later" is a span, and the time a reply
// narrates is the turn's whole, so only what goes beyond the time the turn already took applies.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import { dayPlan } from "../../src/packs/castlife/core/index";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const NONE: JsonObject = { action: null, params: {}, confidence: 0.9, reason: "no action" };

/** A Port Alder chat after one ordinary turn; `interpret` reads by `read`, `extract` proposes `narrated`. */
async function alder(read: (text: string) => JsonObject, narrated: JsonObject[] = []): Promise<{ rig: Rig; chatId: string }> {
  const rig = new Rig({ shipped: true });
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    const text = req.messages[1]?.content ?? "";
    if (system.includes(INTERPRET_MARK)) return JSON.stringify(text.startsWith("I look around") ? NONE : read(text));
    if (system.includes(EXTRACT_MARK) && !text.includes("The shop is quiet.")) return JSON.stringify({ proposals: narrated });
    return "{}";
  };
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  return { rig, chatId };
}

async function folded(rig: Rig, chatId: string) {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("not a world chat");
  const observed = toChain(await rig.host.chats.messages(chatId, rig.host.userId));
  const state = core.fold(observed).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  const head = core.chain(observed).at(-1);
  return { state, world, record: head?.ledger?.swipes[String(head.swipeId)] };
}

const timelapseOf = (events: readonly LedgerEvent[] | undefined): LedgerEvent | undefined => (events ?? []).find((e) => e.type === "timelapse");

/** Jordan chats with Danny, whose action takes 15 minutes. */
const CHAT: JsonObject = { action: "chat_with", params: { target: "danny_okafor" }, confidence: 0.9 };

describe("the message's own time", () => {
  test("'we talk until dinner' runs to the player character's own dinner", async () => {
    const { rig, chatId } = await alder(() => ({ action: "timelapse", params: { span: "until dinner" }, confidence: 0.9 }));
    const before = await folded(rig, chatId);
    const dinner = dayPlan(rig.rt.registry.context(before.world, before.state), before.world.pov).blocks.find((b) => b.activity === "dinner");
    if (!dinner) throw new Error("no dinner in his day");
    await rig.turn(chatId, "We talk until dinner.", "The afternoon goes by in talk.");
    const { record } = await folded(rig, chatId);
    expect(timelapseOf(record?.events)).toMatchObject({ target: { type: "at", at: dinner.start } });
  });

  test("'a few minutes later' is five minutes", async () => {
    const { rig, chatId } = await alder(() => ({ action: "timelapse", params: { span: "a few minutes later" }, confidence: 0.9 }));
    const before = await folded(rig, chatId);
    await rig.turn(chatId, "OOC: a few minutes later.", "A few minutes pass.");
    const after = await folded(rig, chatId);
    expect(timelapseOf(after.record?.events)).toMatchObject({ target: { type: "duration", minutes: 5 } });
    expect(after.state.clock - before.state.clock).toBe(5);
  });
});

describe("time a reply narrates", () => {
  test("'an hour later' after a 15-minute action advances 45 more, not 60", async () => {
    const { rig, chatId } = await alder(() => CHAT, [{ type: "time_advance", minutes: 60 }]);
    const before = await folded(rig, chatId);
    await rig.turn(chatId, "I chat with Danny.", "An hour later, Danny is still talking about engines.");
    expect((await folded(rig, chatId)).state.clock - before.state.clock).toBe(60);
  });

  test("a narrated total below what the turn already took advances nothing", async () => {
    const { rig, chatId } = await alder(() => CHAT, [{ type: "time_advance", minutes: 10 }]);
    const before = await folded(rig, chatId);
    await rig.turn(chatId, "I chat with Danny.", "Ten minutes later, Danny is still talking.");
    expect((await folded(rig, chatId)).state.clock - before.state.clock).toBe(15);
  });
});
