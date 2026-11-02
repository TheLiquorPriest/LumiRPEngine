// The checks family (INC1-SPEC R3a) on Port Alder: an action's odds as the palette reads them, for
// anyone and anything, the GM's with the exact odds and the dice; a place argument names every place.

import { describe, expect, test } from "bun:test";
import { alderChat, answerOf, callTool, KNOWLEDGE } from "../support/tools";

interface Odds {
  action: { id: string; label: string };
  actor: { id: string; name: string } | null;
  available: boolean;
  why?: string;
  minutes: number;
  odds?: Record<string, number>;
  dice?: string;
  verdict?: { roll: boolean; pass: string[] };
}

describe("checks_odds", () => {
  test("asking about Marcus with Danny in the room: an action Jordan can take at the start, under every knowledge", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) {
      expect(await answerOf<Odds>(rig, chatId, knowledge, "checks_odds", { action: "ask_about_marcus" })).toMatchObject({ action: { id: "ask_about_marcus" }, actor: { id: "pov", name: "Jordan Ellis" }, available: true, minutes: 15 });
    }
  });

  test("a stat check: the GM's exact odds of each outcome and its dice", async () => {
    const { rig, chatId } = await alderChat();
    const gm = await answerOf<Odds>(rig, chatId, "gm", "checks_odds", { action: "attempt", params: { stat: "mechanics" } });
    expect(gm).toMatchObject({ action: { id: "attempt" }, available: true, minutes: 5, dice: "1d20" });
    expect(Object.keys(gm.odds ?? {}).sort()).toEqual(["failure", "great", "success"]);
    expect(Object.values(gm.odds ?? {}).reduce((sum, p) => sum + p, 0)).toBeCloseTo(100, 0);
    expect(gm.verdict).toBeDefined();
  });

  test("the GM reads the locked step, why it can't be taken, and anyone's odds", async () => {
    const { rig, chatId } = await alderChat();
    const locked = await answerOf<Odds>(rig, chatId, "gm", "checks_odds", { action: "read_bank_statement" });
    expect(locked).toMatchObject({ action: { id: "read_bank_statement" }, available: false, minutes: 15 });
    expect(locked.why).toContain("stage('s_shop_trouble') == 'statement'");
    const dannys = await answerOf<Odds>(rig, chatId, "everyone", "checks_odds", { action: "ask_about_marcus", actor: "Danny Okafor" });
    expect(dannys.actor).toEqual({ id: "danny_okafor", name: "Danny Okafor" });
  });

  test("an argument naming a place reads every place, Marcus's secret home too; one the world lacks is no place", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) expect((await answerOf<Odds>(rig, chatId, knowledge, "checks_odds", { action: "go", params: { to: "12 Birch Lane" } })).action.id).toBe("go");
    const none = await callTool(rig, chatId, "everyone", "checks_odds", { action: "go", params: { to: "Nowhere Street" } });
    expect(none.error).toBe(true);
    expect(none.text).toContain("No such place here");
  });
});
