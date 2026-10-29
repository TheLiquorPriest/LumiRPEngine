// The checks family (INC1-SPEC R3a) on Port Alder: an action's odds as the palette reads them; under
// the player character's knowledge only for what Play lets it try (its own attempts, never a step of
// the secret the story hasn't come to, its arguments only what it may name), under the GM's for
// anyone and anything, with the exact odds and the dice.

import { describe, expect, test } from "bun:test";
import { alderChat, answerOf, callTool, KNOWLEDGE } from "../support/tools";

/** The note for what the player character can't know. */
const HIDDEN = "Jordan Ellis doesn't know that";

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

  test("a stat check: the GM's exact odds of each outcome and its dice, and Jordan's own attempt under the player character's knowledge", async () => {
    const { rig, chatId } = await alderChat();
    const gm = await answerOf<Odds>(rig, chatId, "gm", "checks_odds", { action: "attempt", params: { stat: "mechanics" } });
    expect(gm).toMatchObject({ action: { id: "attempt" }, available: true, minutes: 5, dice: "1d20" });
    expect(Object.keys(gm.odds ?? {}).sort()).toEqual(["failure", "great", "success"]);
    expect(Object.values(gm.odds ?? {}).reduce((sum, p) => sum + p, 0)).toBeCloseTo(100, 0);
    expect(gm.verdict).toBeDefined();
    const pov = await answerOf<Odds>(rig, chatId, "pov", "checks_odds", { action: "attempt", params: { stat: "mechanics" } });
    expect(pov).toMatchObject({ action: { id: "attempt" }, actor: { id: "pov" }, available: true, minutes: 5 });
    expect(pov.verdict).toBeUndefined();
  });

  test("under the player character's knowledge, another's odds are beyond it, and a step of the secret the story hasn't come to isn't an action it may name", async () => {
    const { rig, chatId } = await alderChat();
    const theirs = await callTool(rig, chatId, "pov", "checks_odds", { action: "ask_about_marcus", actor: "Danny Okafor" });
    expect(theirs.error).toBe(true);
    expect(theirs.text).toContain(HIDDEN);
    const locked = await callTool(rig, chatId, "pov", "checks_odds", { action: "read_bank_statement" });
    expect(locked.error).toBe(true);
    expect(locked.text).toContain("ask_about_marcus");
    for (const unseen of ["read_past_due_notice", "talk_to_marcus", "s_shop_trouble"]) expect(locked.text).not.toContain(unseen);
  });

  test("the GM reads the locked step, why it can't be taken, and anyone's odds", async () => {
    const { rig, chatId } = await alderChat();
    const locked = await answerOf<Odds>(rig, chatId, "gm", "checks_odds", { action: "read_bank_statement" });
    expect(locked).toMatchObject({ action: { id: "read_bank_statement" }, available: false, minutes: 15 });
    expect(locked.why).toContain("stage('s_shop_trouble') == 'statement'");
    const dannys = await answerOf<Odds>(rig, chatId, "everyone", "checks_odds", { action: "ask_about_marcus", actor: "Danny Okafor" });
    expect(dannys.actor).toEqual({ id: "danny_okafor", name: "Danny Okafor" });
  });

  test("an argument naming a place reads as the view may name it: Marcus's secret home is no place under the player character's knowledge", async () => {
    const { rig, chatId } = await alderChat();
    expect((await answerOf<Odds>(rig, chatId, "pov", "checks_odds", { action: "go", params: { to: "Alder Automotive" } })).action.id).toBe("go");
    const secret = await callTool(rig, chatId, "pov", "checks_odds", { action: "go", params: { to: "12 Birch Lane" } });
    expect(secret.error).toBe(true);
    expect(secret.text).toContain("No such place here");
    expect((await answerOf<Odds>(rig, chatId, "gm", "checks_odds", { action: "go", params: { to: "12 Birch Lane" } })).action.id).toBe("go");
  });
});
