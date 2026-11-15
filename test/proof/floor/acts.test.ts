// What the floor needs of a host (PlanGates-4-fix1 item 14; finding 21): `missingActs` names each member a
// host's acts lack, and a host lacking one stops the play before anything is sent, naming it.

import { describe, expect, test } from "bun:test";
import { missingActs, playFloor } from "../../../scripts/proof/floor/play";
import type { Play } from "../../../scripts/proof/route/form";

const WHOLE = {
  lumiverse: { base: "http://lumiverse.invalid", token: "invented" },
  rpe: { base: "http://rpe.invalid", token: "invented" },
  connections: { plain: "conn-plain", rpe: "conn-rpe" },
  chat: async () => "chat-floor",
  send: async () => ({ sent: 0, firstThinking: null, firstWord: null, lastWord: null, ended: null, resolution: 20 }),
};

describe("the acts a host gives the floor", () => {
  test("acts that give every member lack nothing; each one missing is named", () => {
    expect(missingActs(WHOLE)).toEqual([]);
    expect(missingActs(null)).toEqual(["every member (the host's acts are not an object)"]);
    const { send: _send, ...noSend } = WHOLE;
    expect(missingActs(noSend)).toEqual(["send(chat, connection, line, as): a line sent through the chat page, its reply timed in the page"]);
    expect(missingActs({ ...WHOLE, rpe: { base: "http://rpe.invalid" }, connections: { plain: "conn-plain" } })).toEqual(["rpe: its address and token", "connections: plain's and RPE's ids"]);
    const { chat: _chat, lumiverse: _lumiverse, ...bare } = WHOLE;
    expect(missingActs(bare)).toEqual(["lumiverse: its address and token", "chat(card): a fresh chat"]);
  });

  test("a host lacking a member stops the play by name, before anything is read or sent", async () => {
    const { send: _send, ...noSend } = WHOLE;
    let kept = 0;
    // A play whose host's acts lack `send`: the floor refuses at once, so nothing of the play is touched.
    const play = { acts: noSend, keep: async () => void kept++ } as unknown as Play;
    await expect(playFloor(play)).rejects.toThrow("the host's acts do not give what the floor plays with (PlanScenarios-2's rig host, PlanScenarios-3's bed host): send(chat, connection, line, as)");
    expect(kept).toBe(0);
  });
});
