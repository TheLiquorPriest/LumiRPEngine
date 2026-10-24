// How long a skip runs without asking (DESIGN §9.2, §9.4): one user setting, a day by default, for
// time a reply narrates and time the player types alike. A longer skip is the Timelapse chip.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { isRecord, type JsonObject, type JsonValue } from "../../src/shared/json";
import { ASK_BEYOND_DEFAULT, TIMELAPSE_REACH_MINUTES } from "../../src/shared/settings";
import { Rig } from "../support/rig";

const INTERPRET_MARK = "You map a player's typed input";
const EXTRACT_MARK = "propose concrete state changes";
const NONE: JsonObject = { action: null, params: {}, confidence: 0.9, reason: "no action" };

/**
 * A Port Alder chat after one ordinary turn, with `askBeyondMinutes` set when given. The next
 * message reads as `read`, and the reply after it as `narrated`.
 */
async function alder(opts: { read?: JsonObject; narrated?: JsonObject[]; askBeyondMinutes?: number }): Promise<{ rig: Rig; chatId: string; clock: () => Promise<number> }> {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  if (opts.askBeyondMinutes !== undefined) rig.body(await rig.send({ type: "lre.settings.set", patch: { time: { askBeyondMinutes: opts.askBeyondMinutes } } }));
  await rig.turn(chatId, "I look around the shop.", "The shop is quiet.");
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    if (system.includes(INTERPRET_MARK)) return JSON.stringify(opts.read ?? NONE);
    if (system.includes(EXTRACT_MARK)) return JSON.stringify({ proposals: opts.narrated ?? [] });
    return "{}";
  };
  const clock = async (): Promise<number> => {
    const state = (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    if (!state) throw new Error("no state");
    return state.clock;
  };
  return { rig, chatId, clock };
}

async function offered(rig: Rig, chatId: string): Promise<boolean> {
  return (await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.kind === "timelapse_offer");
}

describe("how long a skip runs without asking", () => {
  test("at the default of a day, a narrated six-hour jump applies", async () => {
    const { rig, chatId, clock } = await alder({ narrated: [{ type: "time_advance", minutes: 360 }] });
    const before = await clock();
    await rig.turn(chatId, "I settle in to wait.", "Six hours later, the light has gone gold.");
    expect((await clock()) - before).toBe(360);
    expect(await offered(rig, chatId)).toBe(false);
  });

  test("set to two hours, a narrated three-hour jump is offered as a chip, not applied", async () => {
    const { rig, chatId, clock } = await alder({ narrated: [{ type: "time_advance", minutes: 180 }], askBeyondMinutes: 120 });
    const before = await clock();
    await rig.turn(chatId, "I settle in to wait.", "Three hours later, the light has gone gold.");
    expect((await clock()) - before).toBeLessThan(180);
    expect(await offered(rig, chatId)).toBe(true);
  });

  test("set to two hours, a typed three-hour skip is offered as a chip, not run", async () => {
    const { rig, chatId, clock } = await alder({ read: { action: "timelapse", params: { span: "for the next three hours" }, confidence: 0.9 }, askBeyondMinutes: 120 });
    const before = await clock();
    await rig.turn(chatId, "OOC: for the next three hours, I sort the stock.", "The stock waits.");
    expect((await clock()) - before).toBeLessThan(180);
    expect(await offered(rig, chatId)).toBe(true);
  });

  test("the setting keeps whole minutes, from none up to the timelapse's reach; anything else reads as a day", async () => {
    const rig = new Rig({ shipped: true });
    const set = async (askBeyondMinutes: JsonValue): Promise<number> => {
      const body = rig.body(await rig.send({ type: "lre.settings.set", patch: { time: { askBeyondMinutes } } }));
      const settings = body.settings;
      if (!isRecord(settings) || !isRecord(settings.time) || typeof settings.time.askBeyondMinutes !== "number") throw new Error("no setting");
      return settings.time.askBeyondMinutes;
    };
    expect(await set(90.4)).toBe(90);
    expect(await set(0)).toBe(0);
    expect(await set(10 ** 9)).toBe(TIMELAPSE_REACH_MINUTES);
    for (const bad of [-5, "a day", null]) expect(await set(bad)).toBe(ASK_BEYOND_DEFAULT);
  });
});
