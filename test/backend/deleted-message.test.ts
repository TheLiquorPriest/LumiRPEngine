// The turn after a deleted message, and every way a turn the engine finished can miss its reply
// (DESIGN §5.1): the turn after any deletion gets its reply; a Lumiverse page's settings save that
// lands while the engine runs leaves the reply it prepared to start; and a prepared reply that can't
// start any more says so on the chat, with a Retry that runs the engine again, never silently.

import { describe, expect, test } from "bun:test";
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
});
