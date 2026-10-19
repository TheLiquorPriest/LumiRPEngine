// An NPC's cash gift read from a reply: the give becomes a transfer of the amount, in
// minor units, once; the payer's accounts are materialized before it applies; and a gift that can't
// apply gets a decline chip instead of silence.

import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../src/shared/json";
import { dedupeProposals, inMinorUnits } from "../../src/backend/steps";
import { declineNote } from "../../src/backend/runtime";
import { toChain } from "../../src/backend/ledger-io";
import { DEFAULT_CURRENCY } from "../../src/shared/world";
import { createRegistry } from "../../src/engine/registry-impl";
import { ALL_PACKS } from "../../src/packs/index";
import type { WorldDoc } from "../../src/shared/world";
import type { WorldState } from "../../src/engine/state";
import { Rig } from "../support/rig";

const reg = createRegistry(ALL_PACKS);
/** The POV's net worth as the economy reads it. */
const worthAt = (world: WorldDoc, state: WorldState): number => {
  const ctx = reg.context(world, state);
  return ctx.query("economy.net_worth")(ctx, "pov") ?? 0;
};

const EXTRACT_MARK = "propose concrete state changes";

/** One turn in a fresh Port Alder chat whose reply the extractor reads as `proposals`; the POV's net worth after it, and the chips. `autoTransfer` pins transfer to auto (D4 starts it in confirm) for tests of the apply mechanics. */
async function gift(proposals: JsonObject[], autoTransfer = true) {
  const rig = new Rig({ shipped: true });
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  if (autoTransfer) rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { transfer: { mode: "auto" } } } }));
  rig.host.quietReply = (req) => ((req.messages[0]?.content ?? "").includes(EXTRACT_MARK) ? JSON.stringify({ proposals }) : "{}");
  await rig.turn(chatId, "I ask Danny if he can spot me for gas.", "Danny hands me $20 for gas. \"Pay me back Friday.\"");
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  const state = core?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  if (!state) throw new Error("no state");
  const view = await rig.rt.view(chatId, rig.host.userId);
  const world = core?.worldAt(state.revision);
  if (!world) throw new Error("no world");
  const prompt = rig.host.quietCalls.map((c) => c.messages[0]?.content ?? "").find((m) => m.includes(EXTRACT_MARK)) ?? "";
  return { rig, chatId, state, world, prompt, worth: worthAt(world, state), chipList: view.chips, chips: view.chips.map((c) => `${c.kind}: ${c.label}`), errors: rig.rt.ledger.errors };
}

describe("an NPC's cash gift", () => {
  test("a cash give becomes a cash transfer of its amount in minor units, scaled once; a model's own transfer keeps its method", () => {
    const usd = DEFAULT_CURRENCY;
    const converted = [inMinorUnits({ type: "give", item: "$20", from: "danny_okafor", to: "pov" }, usd), inMinorUnits({ type: "give", item: "cash", amount: 20, from: "danny_okafor", to: "pov" }, usd), inMinorUnits({ type: "give", item: "a twenty", from: "danny_okafor", to: "pov" }, usd)];
    expect(converted).toEqual([0, 1, 2].map(() => ({ type: "transfer", from: "danny_okafor", to: "pov", amount: 2000, method: "cash" })));
    // Dedupe leaves the transfer as it is: no second conversion.
    expect(dedupeProposals(converted.slice(0, 1), "pov")).toEqual([{ type: "transfer", from: "danny_okafor", to: "pov", amount: 2000, method: "cash" }]);
    expect(inMinorUnits({ type: "transfer", from: "pov", to: "danny_okafor", amount: 15 }, usd)).toEqual({ type: "transfer", from: "pov", to: "danny_okafor", amount: 1500 });
    expect(inMinorUnits({ type: "transfer", from: "pov", to: "danny_okafor", amount: 15, method: "cash" }, usd)).toEqual({ type: "transfer", from: "pov", to: "danny_okafor", amount: 1500, method: "cash" });
    // A thing handed over stays a give, priced or not ("my $300 jacket" is a jacket, not $300).
    expect(inMinorUnits({ type: "give", item: "spare key", from: "danny_okafor", to: "pov" }, usd)).toEqual({ type: "give", item: "spare key", from: "danny_okafor", to: "pov" });
    for (const item of ["my $300 jacket", "a $20 gift card", "a $5 coin purse"]) expect(inMinorUnits({ type: "give", item, from: "pov", to: "danny_okafor" }, usd)).toEqual({ type: "give", item, from: "pov", to: "danny_okafor" });
  });

  test("the extract prompt says a transfer is between people or their own accounts, never things, and when it is cash", async () => {
    const { prompt } = await gift([]);
    expect(prompt).toContain("transfer{from,to,amount,method?} (from and to: people, entity ids, or a person's own cash, checking, savings or card account, never things;");
    expect(prompt).toContain('method: "cash" when bills or coins change hands in person');
  });

  test('"Danny hands me $20 for gas" gives the player $20 from Danny\'s own money', async () => {
    const none = await gift([]);
    const gifts: JsonObject[] = [{ type: "give", item: "$20", from: "danny_okafor", to: "pov" }, { type: "give", item: "cash", amount: 20, from: "danny_okafor", to: "pov" }];
    for (const p of gifts) {
      const got = await gift([p]);
      expect(got.worth - none.worth).toBe(2000);
      expect(got.chips.filter((c) => c.startsWith("undo:"))).toEqual(["undo: Danny Okafor paid $20.00 to you"]);
      expect(got.chips.some((c) => c.startsWith("decline:"))).toBe(false);
      expect(got.errors).toEqual([]);
    }
  });

  test("a gift that can't apply gets a decline chip, never silence", async () => {
    const none = await gift([]);
    const got = await gift([{ type: "give", item: "cash", from: "danny_okafor", to: "pov" }]);
    expect(got.worth).toBe(none.worth);
    expect(got.chips.filter((c) => c.startsWith("decline:"))).toEqual(["decline: Didn't apply: Danny Okafor paid $? to you"]);
  });

  test("a decline note keeps names' case", async () => {
    const { state, world } = await gift([]);
    const move = { type: "location", entity: "danny_okafor", place: "harbor_street_114" };
    const notes = [declineNote(move, "no route", "accept", state, world), declineNote(move, "no route", "remove", state, world)];
    expect(notes.every((n) => n.includes('"Danny Okafor'))).toBe(true);
    expect(notes.some((n) => n.includes("danny"))).toBe(false);
  });

  test("with default settings a narrated transfer between people waits on a confirm chip; no money moves until Apply", async () => {
    const none = await gift([], false);
    const got = await gift([{ type: "transfer", from: "danny_okafor", to: "pov", amount: 20, method: "cash" }], false);
    expect(got.worth).toBe(none.worth);
    expect(got.chips.filter((c) => c.startsWith("undo:"))).toEqual([]);
    const confirm = got.chipList.find((c) => c.kind === "confirm");
    if (!confirm) throw new Error("no confirm chip");
    got.rig.body(await got.rig.send({ type: "lre.chip", chatId: got.chatId, chip: confirm.id, choice: "confirm" }));
    const core = await got.rig.rt.ledger.core(got.chatId, got.rig.host.userId);
    const after = core?.fold(toChain(await got.rig.host.chats.messages(got.chatId, got.rig.host.userId))).state;
    if (!after) throw new Error("no state");
    expect(worthAt(none.world, after) - none.worth).toBe(2000);
    expect(got.rig.rt.ledger.errors).toEqual([]);
  });
});
