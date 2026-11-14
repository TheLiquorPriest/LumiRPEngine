// The lore map's world entries are matched in what Lumiverse itself scans of a chat for lore (plan §9.2):
// the user's own scan settings read from Lumiverse, the visible messages but the one being written, to
// the scan depth, with the markup Lumiverse hides from its scan blanked. Every name is invented.

import { afterEach, describe, expect, test } from "bun:test";
import type { LvStep } from "../../src/adapter/lumiverse/reads";
import type { LoreMapAsk } from "../../src/lore/lore";
import { BLANK_REVISION } from "../../src/store";
import { maskWorldInfoScanExclusions, scannedSteps, scanSettingsOf } from "../../src/turn/scan";
import { CHAT, CONNECTION, GREETING, openTurnBed, PRESET, replying, settledTurn, type TurnBed, USER } from "./bed";

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

describe("what Lumiverse scans for lore", () => {
  test("the user's scan settings, with Lumiverse's own defaults for what they do not say", () => {
    expect(scanSettingsOf({ globalScanDepth: 3, forceCaseSensitive: true, forceMatchWholeWords: true, maxRecursionPasses: 2 })).toEqual({ matching: { caseSensitive: true, wholeWords: true }, depth: 3 });
    expect(scanSettingsOf(undefined)).toEqual({ matching: { caseSensitive: false, wholeWords: false }, depth: null });
    expect(scanSettingsOf({ globalScanDepth: 0 }).depth).toBeNull();
    expect(scanSettingsOf({ globalScanDepth: 4.7 }).depth).toBe(4);
    expect(scanSettingsOf({ forceCaseSensitive: "yes" }).matching.caseSensitive).toBe(false);
  });

  test("the messages scanned: visible ones but the one being written, the latest to the depth", () => {
    const step = (id: string, hidden = false) => ({ id, hidden }) as LvStep;
    const steps = [step("a"), step("b", true), step("c"), step("d"), step("e")];
    expect(scannedSteps(steps, new Set(["e"]), null).map((s) => s.id)).toEqual(["a", "c", "d"]);
    expect(scannedSteps(steps, new Set(["e"]), 2).map((s) => s.id)).toEqual(["c", "d"]);
    expect(scannedSteps(steps, new Set(), 10).map((s) => s.id)).toEqual(["a", "c", "d", "e"]);
  });

  test("markup Lumiverse hides from its scan is blanked to the same length; text with none is left as it is", () => {
    const blank = (s: string) => " ".repeat(s.length);
    expect(maskWorldInfoScanExclusions("The lamp <wi-exclude>and the oil</wi-exclude> burns.")).toBe(`The lamp ${blank("<wi-exclude>and the oil</wi-exclude>")} burns.`);
    expect(maskWorldInfoScanExclusions('A <span class="x" wi-exclude>keeper</span> waits.')).toBe(`A ${blank('<span class="x" wi-exclude>keeper</span>')} waits.`);
    expect(maskWorldInfoScanExclusions("Rope !--WI_EXCLUDE_START--!anchor!--WI_EXCLUDE_END--! chain")).toBe(`Rope ${blank("!--WI_EXCLUDE_START--!anchor!--WI_EXCLUDE_END--!")} chain`);
    expect(maskWorldInfoScanExclusions("<wi-exclude>all of it</wi-exclude>")).toBe("");
    expect(maskWorldInfoScanExclusions("<!-- <wi-exclude> -->kept")).toBe("<!-- <wi-exclude> -->kept");
    const plain = "Nothing hidden here.";
    expect(maskWorldInfoScanExclusions(plain)).toBe(plain);
  });

  test("a turn's lore map is asked for with the user's scan settings and the messages as Lumiverse scans them", async () => {
    const b = await openTurnBed({
      answers: [replying("The lamp turns.")],
      messages: [
        { id: "m-greeting", role: "assistant", content: GREETING },
        { id: "m-hidden", role: "user", content: "A note to myself about the harbor.", hidden: true },
        { id: "m-old", role: "assistant", content: "Wren winds the clockwork." },
      ],
    });
    beds.push(b);
    // The chat plays on a world (here the blank one), so the world's own keys are looked for.
    await b.app.writes.run(() => b.turns.store.user(USER).createChat({ id: CHAT, revision: BLANK_REVISION }), "a chat on a world");
    b.db.run("INSERT INTO settings (key, value, user_id) VALUES (?, ?, ?)", "worldInfoSettings", JSON.stringify({ globalScanDepth: 2, forceCaseSensitive: true, forceMatchWholeWords: true }), USER);
    const asks: LoreMapAsk[] = [];
    const loreMap = b.turns.lore.loreMap.bind(b.turns.lore);
    b.turns.lore.loreMap = (ask) => {
      asks.push(ask);
      return loreMap(ask);
    };

    b.host.send(CHAT, "I ask about the <wi-exclude>smuggler's</wi-exclude> lamp.");
    const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET, type: "normal" });
    expect(out.error).toBeNull();
    await settledTurn(b, out.generationId!);

    expect(asks).toHaveLength(1);
    expect(asks[0]!.matching).toEqual({ caseSensitive: true, wholeWords: true });
    // The latest two visible messages: the hidden one is not scanned, nor is the reply being written.
    expect(asks[0]!.messages).toEqual(["Wren winds the clockwork.", `I ask about the ${" ".repeat("<wi-exclude>smuggler's</wi-exclude>".length)} lamp.`]);
  });
});
