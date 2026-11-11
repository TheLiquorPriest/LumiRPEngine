// Sovereign Hand on the harness (docs/HARNESS.md: "What you can change"). The harness's own setting
// is the engine's word on what counts as a chat's story, passed to LumiAH with its claim
// (`ChatClaim.story`): whose messages are the story (following Lumiverse's own switch, or on, or
// off) and what the author is given of the newest. Where only the model's replies are the story, the
// author's opening says first how to read the player's message: a direction, carried out through the
// tools. Everywhere else the opening is as it was.

import { describe, expect, test } from "bun:test";
import { renderPrompt } from "../../src/backend/prompts";
import { agentSettingsOf, defaultAgentSettings } from "../../src/shared/agent-settings";
import { HARNESS_TEXT } from "../../src/shared/harness-texts";
import type { Rig } from "../support/rig";
import { claimOf, harnessChat, noModelCalls } from "./harness-driver";

const SOVEREIGN = renderPrompt(HARNESS_TEXT.sovereign, {}, {});

/** Sets the harness's Sovereign Hand settings, as its rows on GM → This chat → Engine send them. */
async function set(rig: Rig, harness: { sovereignHand?: string | null; newestMessage?: string | null }): Promise<void> {
  rig.body(await rig.send({ type: "lre.settings.set", patch: { agents: { harness } } }));
}

/** What the engine claims of the chat: its word on the story, and the guidance its author reads first. Lumiverse's switch as LumiAH read it (null: Lumiverse doesn't say). */
async function claimed(rig: Rig, chatId: string, sovereignHand: boolean | null, from: "everyone" | "replies" = "everyone") {
  const claim = await claimOf(rig, chatId, { story: { hidden: "leave_out", from, newest: "directive" }, sovereignHand });
  const guidance = claim?.guidance;
  return { story: claim?.story, opening: guidance && "text" in guidance ? guidance.text : "" };
}

describe("Sovereign Hand on the harness", () => {
  test("old settings read with its defaults: following Lumiverse, the newest message given as the direction; a value it doesn't take is its default", () => {
    const d = defaultAgentSettings().harness;
    expect([d.sovereignHand, d.newestMessage]).toEqual(["follow", "direction"]);
    expect(agentSettingsOf({ harness: { defaultTick: false } }).harness).toEqual({ ...d, defaultTick: false });
    expect(agentSettingsOf({ harness: { sovereignHand: "always", newestMessage: 3 } }).harness).toMatchObject({ sovereignHand: "follow", newestMessage: "direction" });
    expect(agentSettingsOf({ harness: { sovereignHand: "on", newestMessage: "leave_out" } }).harness).toMatchObject({ sovereignHand: "on", newestMessage: "leave_out" });
  });

  test("the claim carries the setting as the engine's word on the story, and only where the replies alone are the story does the opening tell the author how to read the player's message", async () => {
    const { rig, chatId } = await harnessChat();
    // Following Lumiverse (the default): its switch off, or not told, the opening is as it was.
    const today = await claimed(rig, chatId, false);
    expect(today.story).toEqual({ from: "lumiverse", newest: "directive" });
    expect(today.opening).not.toContain(SOVEREIGN);
    expect((await claimed(rig, chatId, null)).opening).toBe(today.opening);
    // Its switch on: the opening starts with how a direction is read.
    expect((await claimed(rig, chatId, true)).opening).toBe(`${SOVEREIGN}\n\n${today.opening}`);
    // The engine's word stands over the chat's own choice in LumiAH: following Lumiverse with its switch off, the replies alone are not the story.
    expect((await claimed(rig, chatId, false, "replies")).opening).toBe(today.opening);

    // On: the replies alone are the story whatever Lumiverse says.
    await set(rig, { sovereignHand: "on" });
    const on = await claimed(rig, chatId, false);
    expect(on.story).toEqual({ from: "replies", newest: "directive" });
    expect(on.opening).toBe(`${SOVEREIGN}\n\n${today.opening}`);
    // The newest message left out, where the preset carries it: the word says so, and the opening is the same.
    await set(rig, { newestMessage: "leave_out" });
    const left = await claimed(rig, chatId, false);
    expect(left.story).toEqual({ from: "replies", newest: "leave_out" });
    expect(left.opening).toBe(on.opening);

    // Off: everyone's messages are the story whatever Lumiverse says, and the opening is as it was.
    await set(rig, { sovereignHand: "off", newestMessage: null });
    const off = await claimed(rig, chatId, true);
    expect(off.story).toEqual({ from: "everyone", newest: "directive" });
    expect(off.opening).toBe(today.opening);
    noModelCalls(rig);
  });
});
