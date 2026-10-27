// The turn after a deleted message, and every way a turn the engine finished can miss its reply
// (DESIGN §5.1): the turn after any deletion gets its reply; a Lumiverse page's settings save that
// lands while the engine runs leaves the reply it prepared to start; and a prepared reply that can't
// start any more says so on the chat, with a Retry that runs the engine again, never silently.

import { describe, expect, test } from "bun:test";
import { toChain } from "../../src/backend/ledger-io";
import { placeOfEntity } from "../../src/engine/scope";
import type { JsonObject } from "../../src/shared/json";
import type { FakeMessage } from "../support/fake-host";
import { Rig } from "../support/rig";

async function playedChat(rig: Rig): Promise<string> {
  const chatId = await rig.worldChat();
  for (let i = 0; i < 3; i++) await rig.turn(chatId, `I look around (${i}).`, `The square is quiet (${i}).`);
  return chatId;
}

/** The player sends a message: the generation the reply streams in, or the stopped one when none started. */
async function send(rig: Rig, chatId: string, text: string) {
  rig.host.sendUser(chatId, text);
  await rig.host.settle();
  return rig.host.start(chatId, { type: "normal" });
}

/** The chat's flag for a turn that generated nothing, as the view shows it. */
async function flagOf(rig: Rig, chatId: string): Promise<JsonObject | undefined> {
  const view = await rig.rt.view(chatId, rig.host.userId);
  const flag = view.chips.find((c) => c.kind === "engine_failed");
  return flag ? (JSON.parse(JSON.stringify(flag)) as JsonObject) : undefined;
}

const DELETIONS: [string, (rig: Rig, chatId: string, messages: readonly FakeMessage[]) => Promise<void>][] = [
  ["the latest reply", async (rig, chatId, all) => rig.host.deleteMessage(chatId, all.at(-1)?.id ?? "")],
  ["the latest player message", async (rig, chatId, all) => rig.host.deleteMessage(chatId, all.at(-2)?.id ?? "")],
  ["a message in the middle", async (rig, chatId, all) => rig.host.deleteMessage(chatId, all[2]?.id ?? "")],
  [
    "a reply with several swipes",
    async (rig, chatId, all) => {
      await rig.host.finish(await rig.host.start(chatId, { type: "regenerate" }), "The square is loud.");
      rig.host.deleteMessage(chatId, all.at(-1)?.id ?? "");
    },
  ],
  [
    "two in a row",
    async (rig, chatId, all) => {
      rig.host.deleteMessage(chatId, all.at(-1)?.id ?? "");
      await rig.host.settle();
      rig.host.deleteMessage(chatId, all.at(-2)?.id ?? "");
    },
  ],
];

describe("the turn after a deleted message", () => {
  for (const [what, remove] of DELETIONS) {
    test(`after deleting ${what}, the next message gets its reply, planned by the engine`, async () => {
      const rig = new Rig();
      const chatId = await playedChat(rig);
      await remove(rig, chatId, [...rig.host.chat(chatId).messages]);
      await rig.host.settle();
      const g = await send(rig, chatId, "I wave.");
      expect(g.halted).toBeUndefined();
      await rig.host.finish(g, "Someone waves back.");
      const core = await rig.rt.ledger.core(chatId, rig.host.userId);
      expect(core?.journal.messages[g.messageId ?? ""]?.ledger.swipes["0"]?.status).toBe("ok");
      expect(await flagOf(rig, chatId)).toBeUndefined();
    });
  }
});

describe("a turn the engine finished", () => {
  test("a Lumiverse page's settings save landing while the engine runs leaves the reply it prepared to start", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig);
    // Lumiverse's pages save their settings in one batch naming every key, a second and a half after a
    // change (a drawer or a dock moved, a one-shot guide used): here, while the engine reads the action.
    rig.host.quietReply = () => {
      rig.host.settingsSaved(["drawerSettings", "portraitDockSettings"]);
      return "{}";
    };
    const g = await send(rig, chatId, "I wave.");
    expect(g.halted).toBeUndefined();
    await rig.host.finish(g, "Someone waves back.");
    expect(await flagOf(rig, chatId)).toBeUndefined();
  });

  test("a reply that can't start any more says so on the chat, with a Retry that runs the engine again and then the reply", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig);
    // The player's RPEngine settings changed while the engine ran: the sections it wrote follow the
    // old ones, so the prepared reply goes.
    let changed = false;
    rig.host.quietReply = () => {
      if (!changed) void rig.send({ type: "lre.settings.set", patch: { modelUse: { tokens: { sections: 3900 } } } });
      changed = true;
      return "{}";
    };
    const said = rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const stopped = await rig.host.start(chatId, { type: "normal" });
    expect(stopped.halted).toBe("cancelled");
    expect(await flagOf(rig, chatId)).toMatchObject({ messageId: said, label: "The reply didn't start, so nothing was generated", actions: [{ id: "regenerate", label: "Retry" }, { id: "diagnostics", label: "Diagnostics" }] });
    // The flag names what changed, so the player knows why and the next report says which input moved.
    expect(String((await flagOf(rig, chatId))?.detail)).toBe("Your RPEngine settings changed after the engine ran and before the reply started");
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.some((r) => r.kind === "turn" && r.status === "failed" && /before the reply started/.test(r.reason ?? ""))).toBe(true);
    // Retry: the flag's Regenerate, which the host plays as a new reply after the player's message.
    const reply = await rig.host.start(chatId, { type: "regenerate" });
    expect(reply.halted).toBeUndefined();
    await rig.host.finish(reply, "Someone waves back.");
    expect(await flagOf(rig, chatId)).toBeUndefined();
  });

  test("saving a setting the turn doesn't read keeps the reply it prepared, while a step's model drops it", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig);
    // The swipe default and a new chat's check rules: neither is read by a turn already prepared.
    let saved = false;
    rig.host.quietReply = () => {
      if (!saved) void rig.send({ type: "lre.settings.set", patch: { swipeDefault: "renarrate", overrideWorldAdjudication: true } });
      saved = true;
      return "{}";
    };
    const kept = await send(rig, chatId, "I wave.");
    expect(kept.halted).toBeUndefined();
    await rig.host.finish(kept, "Someone waves back.");
    expect(await flagOf(rig, chatId)).toBeUndefined();
    // A step's model is: the turn made on the old one goes.
    let changed = false;
    rig.host.quietReply = () => {
      if (!changed) void rig.send({ type: "lre.settings.set", patch: { modelUse: { steps: { interpret: { route: { connectionId: "other", model: "other-model" } } } } } });
      changed = true;
      return "{}";
    };
    rig.host.sendUser(chatId, "I nod.");
    await rig.host.settle();
    expect((await rig.host.start(chatId, { type: "normal" })).halted).toBe("cancelled");
  });
});

describe("cancelling a turn in flight", () => {
  test("Cancel stops the engine run with no failure flag, and sending again plays the turn", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig);
    // The player presses Cancel while the engine reads the action.
    let pressed = false;
    rig.host.quietReply = () => {
      if (!pressed) void rig.send({ type: "lre.cancel", chatId });
      pressed = true;
      return "{}";
    };
    rig.host.sendUser(chatId, "I wave.");
    await rig.host.settle();
    const stopped = await rig.host.start(chatId, { type: "normal" });
    expect(pressed).toBe(true);
    expect(stopped.halted).toBe("cancelled");
    expect(await flagOf(rig, chatId)).toBeUndefined();
    const records = await rig.rt.diag.records(chatId, rig.host.userId);
    expect(records.some((r) => r.kind === "turn" && r.status === "failed")).toBe(false);
    // Nothing runs now, so a second Cancel stops nothing.
    expect(rig.body(await rig.send({ type: "lre.cancel", chatId })).cancelled).toBe(false);
    // Sent again (the frontend's Regenerate after the player's message), the turn plays with its reply.
    const again = await rig.host.start(chatId, { type: "regenerate" });
    expect(again.halted).toBeUndefined();
    await rig.host.finish(again, "Someone waves back.");
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    expect(core?.journal.messages[again.messageId ?? ""]?.ledger.swipes["0"]?.status).toBe("ok");
    expect(await flagOf(rig, chatId)).toBeUndefined();
  });
});

describe("Cancel on the activity line", () => {
  test("is offered while the engine runs, and not once the turn only waits for its reply", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig);
    let during: boolean | undefined;
    rig.host.quietReply = () => {
      during ??= rig.rt.diag.activityOf(chatId)?.cancellable;
      return "{}";
    };
    const reply = await send(rig, chatId, "I wave.");
    expect(during).toBe(true);
    const waiting = rig.rt.diag.activityOf(chatId);
    expect(waiting?.state).toBe("running");
    expect(waiting?.cancellable).toBeUndefined();
    await rig.host.finish(reply, "Someone waves back.");
  });
});

describe("Cancel late in the engine run", () => {
  test("pressed while the sections are made, it stops the run with no reply; once the turn is prepared there is nothing to cancel", async () => {
    const rig = new Rig();
    const chatId = await playedChat(rig);
    const press: { answered: boolean | null } = { answered: null };
    const deliver = rig.rt.deliver.bind(rig.rt);
    rig.rt.deliver = async (input) => {
      press.answered ??= rig.rt.ledger.cancel(chatId, rig.host.userId);
      return deliver(input);
    };
    const stopped = await send(rig, chatId, "I wave.");
    expect(press.answered).toBe(true);
    expect(stopped.halted).toBe("cancelled");
    expect(await flagOf(rig, chatId)).toBeUndefined();
    // Played again, the turn is prepared and its reply goes on: Cancel then stops nothing.
    rig.rt.deliver = deliver;
    const again = await rig.host.start(chatId, { type: "regenerate" });
    expect(again.halted).toBeUndefined();
    expect(rig.rt.ledger.cancel(chatId, rig.host.userId)).toBe(false);
    await rig.host.finish(again, "Someone waves back.");
  });
});

describe("Cancel while the reply is read", () => {
  test("leaves the reply unread: nothing its read found applies, and Retry read is offered", async () => {
    const rig = new Rig({ shipped: true });
    rig.host.quietReply = () => "{}";
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const reply = await send(rig, chatId, "I look around.");
    expect(reply.halted).toBeUndefined();
    const press: { answered: boolean | null } = { answered: null };
    rig.host.quietReply = () => {
      press.answered ??= rig.rt.ledger.cancel(chatId, rig.host.userId);
      return JSON.stringify({ proposals: [{ type: "location", entity: "pov", place: "alder_market" }] });
    };
    await rig.host.finish(reply, "You walk to the market.");
    expect(press.answered).toBe(true);
    const kinds = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === reply.messageId).map((c) => c.kind);
    expect(kinds).toContain("retry_read");
    // The reply's move to the market, which the read found, never applies.
    const core = await rig.rt.ledger.core(chatId, rig.host.userId);
    const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    expect(state ? placeOfEntity(state, "pov") : null).not.toBe("alder_market");
    expect(kinds).not.toContain("change");
  });

  test("pressed once the read has found its changes, keeps none of its chips: no Undo for a move that never applied", async () => {
    const rig = new Rig({ shipped: true });
    rig.host.quietReply = () => "{}";
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    const reply = await send(rig, chatId, "I look around.");
    rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes("propose concrete state changes") ? JSON.stringify({ proposals: [{ type: "location", entity: "pov", place: "alder_market" }] }) : "{}");
    const press: { answered: boolean | null } = { answered: null };
    const prepare = rig.rt.prepareRead.bind(rig.rt);
    rig.rt.prepareRead = async (...args: Parameters<typeof prepare>) => {
      await prepare(...args);
      press.answered ??= rig.rt.ledger.cancel(chatId, rig.host.userId);
    };
    await rig.host.finish(reply, "You walk to the market.");
    expect(press.answered).toBe(true);
    const kinds = (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === reply.messageId).map((c) => c.kind);
    expect(kinds).toContain("retry_read");
    expect(kinds).not.toContain("undo");
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
