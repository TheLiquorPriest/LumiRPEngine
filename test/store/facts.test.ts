// The fact store (plan §6.6), and the two stores read together: plain statements about a thing,
// each with how exact, how sure and from where, kept as changes of their turn; replaced only
// explicitly; and shown beside the typed systems' exact values, neither overwriting the other.

import { describe, expect, test } from "bun:test";
import type { FactStore } from "../../src/iface/kit";
import { factStore } from "../../src/store/facts";
import type { ChangeInput, Fact, Precision } from "../../src/store/types";
import { EXTERNAL_ACCOUNT_PREFIX } from "../../src/engine/events";
import { engine, hashOf, pay, play, POV, say, shown, testStore } from "./fixtures";

/** The engine's tools hold a fact store by this interface: the store's must fit it as it is. */
const forTools: FactStore = factStore;

const WREN = `entity:${POV}`;

function chat() {
  const ts = testStore();
  ts.s.createChat({ id: "c", revision: ts.revision });
  return ts;
}

/** A fact as a change of the engine lane, with its provenance. */
function fact(about: string, key: string, value: string, more: { precision?: Precision; replaces?: string; source?: ChangeInput["source"]; standing?: ChangeInput["standing"] } = {}): ChangeInput {
  const { op, value: v } = factStore.change({ about, key, value, ...(more.replaces !== undefined ? { replaces: more.replaces } : {}) });
  return { lane: "engine", op, value: v, by: "gm", source: more.source ?? "prose", precision: more.precision ?? null, standing: more.standing ?? null };
}

/** The facts standing on a thing, read as the engine's tools read them. */
const standingOn = (state: Parameters<FactStore["of"]>[0], about: string): Fact[] => forTools.of(state, about) as unknown as Fact[];

describe("the fact store", () => {
  test("a fact is a change of its turn: staged inside it, gone after a swipe of it, back when the swipe is flipped back", () => {
    const { s } = chat();
    const t = s.beginTurn({ chat: "c", kind: "normal" });
    s.addChanges(t.id, [fact(WREN, "scar", "a thin scar over her left brow", { precision: "exact", standing: "established" })]);
    // Staged: inside the open turn only.
    expect(standingOn(s.stateAt(t.id).state, WREN).map((f) => f.value)).toEqual(["a thin scar over her left brow"]);
    expect(standingOn(s.headState("c").state, WREN)).toEqual([]);
    s.tieTurn(t.id, { message: "m1", hash: hashOf("She touches the old scar."), date: 1 });
    const [scar] = standingOn(s.headState("c").state, WREN);
    expect(scar).toMatchObject({ about: WREN, key: "scar", value: "a thin scar over her left brow", precision: "exact", standing: "established", source: "prose", by: "gm", turn: t.id, n: 1 });
    // Another swipe of that reply: its fact is not there.
    play(s, "c", "m1", "She says nothing of it.", 2, [], { target: "m1" });
    expect(standingOn(s.headState("c").state, WREN)).toEqual([]);
    // The first swipe shown again: the fact is back.
    s.sync("c", shown(["m1", "She touches the old scar.", 1]));
    expect(standingOn(s.headState("c").state, WREN).map((f) => f.id)).toEqual([scar?.id]);
  });

  test("one call writes many; the same thing and key replaces, and so does naming a fact; keys match exactly and history is kept", () => {
    const { s } = chat();
    const t1 = play(s, "c", "m1", "Wren is wet through and owes the ferryman.", 1, [fact(WREN, "clothes", "soaked from the river"), fact(WREN, "debt", "owes the ferryman a favour"), fact("place:cellar", "door", "left unlocked")]);
    const first = standingOn(s.headState("c").state, WREN);
    expect(first.map((f) => f.key)).toEqual(["clothes", "debt"]);
    const debt = first.find((f) => f.key === "debt");
    // Same key on the same thing: the new one stands. A key written another way is another key. Naming a fact replaces it whatever its key.
    play(s, "c", "m2", "She dries by the fire and pays the ferryman.", 2, [fact(WREN, "clothes", "dry, smelling of smoke"), fact(WREN, "Clothes", "a borrowed shawl"), fact(WREN, "favour", "paid in full", { replaces: debt?.id ?? "" })]);
    const state = s.headState("c").state;
    expect(standingOn(state, WREN).map((f) => [f.key, f.value])).toEqual([
      ["clothes", "dry, smelling of smoke"],
      ["Clothes", "a borrowed shawl"],
      ["favour", "paid in full"],
    ]);
    // The replaced facts are kept, marked with what replaced them and when.
    const all = state.facts[WREN] ?? [];
    expect(all.filter((f) => f.replacedBy !== undefined).map((f) => [f.value, f.replacedAt])).toEqual([
      ["soaked from the river", 2],
      ["owes the ferryman a favour", 2],
    ]);
    expect(standingOn(state, "place:cellar").map((f) => [f.value, f.turn])).toEqual([["left unlocked", t1.id]]);
    // Naming a fact that is not standing is reported, and the fact is recorded all the same.
    const t3 = play(s, "c", "m3", "Later.", 3, [fact(WREN, "favour", "owed again", { replaces: debt?.id ?? "" })]);
    expect(s.changes(t3.id).map((c) => [c.applied, c.reports])).toEqual([[true, [{ code: "replaces_none", values: { id: debt?.id ?? "" } }]]]);
    expect(standingOn(s.headState("c").state, WREN).find((f) => f.key === "favour")?.value).toBe("owed again");
  });

  test("an exact amount and a later vague fact both show, each with its turn; neither overwrites the other; a sum over an inexact value says it is inexact", () => {
    const { s } = chat();
    const exact = (cents: number, memo: string, precision: Precision = "exact"): ChangeInput[] => engine(pay("acct_wren", cents, memo)).map((c) => ({ ...c, precision }));
    play(s, "c", "m1", "Wren pays for a room.", 1, exact(400, "A room"));
    play(s, "c", "m2", "She spends most of what is left on drink.", 2, [fact("entity:acct_wren", "posted", "spent most of it on drink", { precision: "vague" })]);
    const node = s.view("c").node("acct_wren");
    expect(node?.values.find((v) => v.key === "posted")).toMatchObject({ value: "-$4.00", from: { system: "economy" }, mark: { n: 1, precision: "exact" } });
    expect(node?.facts.map((f) => [f.key, f.value, f.precision, f.n])).toEqual([["posted", "spent most of it on drink", "vague", 2]]);
    // As an agent reads it: the exact value, then the fact beside it.
    const text = say(s.view("c"), "acct_wren", 0).split("\n");
    const at = text.findIndex((l) => l.startsWith("  · posted: -$4.00"));
    expect(text[at]).toBe("  · posted: -$4.00 (economy) — exact, turn 1");
    expect(text[at + 1]).toMatch(/^ {2}· posted: "spent most of it on drink" \(vague, turn 2\) \[f-[0-9a-f]{12}\]$/);
    // A later exact payment moves the amount and settles the vague fact, which stays in its history (R-62).
    play(s, "c", "m3", "She pays her tab.", 3, exact(100, "A tab"));
    const after = s.view("c").node("acct_wren");
    expect(after?.values.find((v) => v.key === "posted")).toMatchObject({ value: "-$5.00", mark: { n: 3, precision: "exact" } });
    expect(after?.facts.map((f) => f.value)).toEqual([]);
    // A payment of about some amount: the balance, a sum over it, is now inexact, and stays so.
    play(s, "c", "m4", "She tips the boy something.", 4, exact(50, "A tip", "approximate"));
    play(s, "c", "m5", "She buys bread.", 5, exact(20, "Bread"));
    expect(s.view("c").node("acct_wren")?.values.find((v) => v.key === "posted")?.mark).toMatchObject({ n: 5, precision: "approximate" });
  });

  test("a person's coin carries the turn and precision of what last moved it, so a fact beside it shows as older or newer", () => {
    const { s } = chat();
    // Her purse opens as the economy opens an account, its opening amount posted; then she pays about four silver from it.
    const open = engine({ type: "post", lines: [{ account: "acct_wren", amount: 1200 }, { account: `${EXTERNAL_ACCOUNT_PREFIX}${POV}`, amount: -1200 }], memo: "Opening balances" }, { type: "economy.open", data: { accounts: ["acct_wren"] } });
    play(s, "c", "m1", "Wren pays for a room, about four silver.", 1, [...open, ...engine(pay("acct_wren", 400, "A room")).map((c) => ({ ...c, precision: "approximate" as const }))]);
    play(s, "c", "m2", "She spends most of what is left on drink.", 2, [fact(WREN, "coin", "spent most of it", { precision: "vague" })]);
    const coin = s.view("c").node(POV)?.values.find((v) => v.key === "coin");
    expect(coin).toMatchObject({ value: "$8.00", from: { system: "economy" }, mark: { n: 1, precision: "approximate" } });
    // As an agent reads it: the coin with its turn, then the later fact beside it.
    const text = say(s.view("c"), POV, 0).split("\n");
    const at = text.findIndex((l) => l.startsWith("  · coin: $8.00"));
    expect(text[at]).toBe("  · coin: $8.00 (economy) — approximate, turn 1");
    expect(text[at + 1]).toMatch(/^ {2}· coin: "spent most of it" \(vague, turn 2\) \[f-[0-9a-f]{12}\]$/);
  });
});
