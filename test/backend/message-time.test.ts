// The message's own time wins (DESIGN §9.2 typed time, §9.4 `time.advance`): "until dinner" runs to
// the player character's own dinner, a vague "a few minutes later" is a span, and the time a reply
// narrates is the turn's whole, so only what goes beyond the time the turn already took applies.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { LedgerEvent } from "../../src/shared/ledger";
import type { JsonObject } from "../../src/shared/json";
import { dayPlan } from "../../src/packs/castlife/core/index";
import { activitySpanEnd } from "../../src/shared/world";
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

/** Jordan chats with Danny, then lets an hour pass. */
const CHAT_THEN: JsonObject = { ...CHAT, then: { span: "for an hour", minutes: 60 } };
const CHAT_THEN_TEXT = "I chat with Danny, then wait for an hour.";

/** The Timelapse chips on the head reply, as the player sees them. */
async function offers(rig: Rig, chatId: string): Promise<{ label: string; detail?: string }[]> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.kind === "timelapse_offer").map((c) => ({ label: c.label, ...(c.detail ? { detail: c.detail } : {}) }));
}

describe("time the message lets pass after its actions runs once", () => {
  test("the narrator is told to tell it after them, and once the reply has, no Timelapse runs it again", async () => {
    const { rig, chatId } = await alder(() => CHAT_THEN, [{ type: "time_advance", minutes: 75 }]);
    const before = await folded(rig, chatId);
    await rig.turn(chatId, CHAT_THEN_TEXT, "An hour and a quarter later, Danny is still talking.");
    expect(rig.host.section("Outcome")).toContain("After those actions, the player's message lets time pass: 1 h (“for an hour”). Tell that time in this reply, after them.");
    expect((await folded(rig, chatId)).state.clock - before.state.clock).toBe(75);
    expect(await offers(rig, chatId)).toEqual([]);
  });

  test("a reply that tells part of it leaves only the rest on the Timelapse", async () => {
    const { rig, chatId } = await alder(() => CHAT_THEN, [{ type: "time_advance", minutes: 45 }]);
    await rig.turn(chatId, CHAT_THEN_TEXT, "Half an hour on, Danny is still talking.");
    expect(await offers(rig, chatId)).toEqual([{ label: "Timelapse 30 min?", detail: "The reply already told 30 min of the 1 h you asked for. Run the other 30 min as a timelapse?" }]);
  });

  test("time the reply tells that waits on Apply counts too", async () => {
    const { rig, chatId } = await alder(() => CHAT_THEN, [{ type: "time_advance", minutes: 75 }]);
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { time_advance: { mode: "confirm" } } } }));
    await rig.turn(chatId, CHAT_THEN_TEXT, "An hour and a quarter later, Danny is still talking.");
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "confirm")).toBe(true);
    expect(await offers(rig, chatId)).toEqual([]);
  });

  test("Speed through to the end of a sleep the reply already told is withdrawn", async () => {
    const narrated: JsonObject[] = [];
    const { rig, chatId } = await alder(() => ({ action: "sleep", params: { minutes: 480 }, confidence: 0.9 }), narrated);
    const before = await folded(rig, chatId);
    await rig.turn(chatId, "I sleep for eight hours.", "You crawl under the covers.");
    const end = activitySpanEnd((await folded(rig, chatId)).state.entities.pov?.fields);
    if (end === null) throw new Error("no sleep to run through");
    expect((await offers(rig, chatId)).filter((o) => o.label.startsWith("Timelapse to"))).toHaveLength(1);
    // Played again, its reply tells the whole sleep and a little more.
    narrated.push({ type: "time_advance", minutes: end - before.state.clock + 30 });
    const again = await rig.host.start(chatId, { type: "regenerate" });
    await rig.host.finish(again, "You sleep the eight hours through and lie awake a while.");
    expect((await folded(rig, chatId)).state.clock).toBeGreaterThan(end);
    expect((await offers(rig, chatId)).filter((o) => o.label.startsWith("Timelapse to"))).toEqual([]);
  });
});
