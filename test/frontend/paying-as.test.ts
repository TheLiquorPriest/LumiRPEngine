// Paying as (ORG-SPEC §3.6, §11 Phase 2, lane P) on Port Alder: the palette's Pay and Buy offer You
// and each organization the player character may spend for, only when there is one; the sheet's
// selector lists them; the request carries `as` only for one the entry offers; and a payment sent
// so plays as the organization, from its account, with Jordan named on its journal line, through
// the backend as the sheet sends it.

import { describe, expect, test } from "bun:test";
import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import { palette } from "../../src/backend/view";
import { materializeAll } from "../../src/engine/materialize";
import { createRegistry } from "../../src/engine/registry-impl";
import { resolveAction } from "../../src/engine/resolve";
import { createRng } from "../../src/engine/rng";
import { Working } from "../../src/engine/working";
import { Seg } from "../../src/frontend/components";
import { PayingAs } from "../../src/frontend/palette";
import { paletteRequest } from "../../src/frontend/requests";
import { journalOf } from "../../src/packs/economy/core/journal";
import { ALL_PACKS, STARTER_WORLDS } from "../../src/packs/index";
import type { PaletteEntry } from "../../src/shared/state-view";
import { startState } from "../packs/support";
import { propsOf } from "../support/tree";
import { Rig } from "../support/rig";

const reg = createRegistry(ALL_PACKS);
const SHOP = "alder_automotive_co";
const TILL = "acct_marcus_shop";
const MARCUS = "marcus_delgado";
const JORDAN = "pov";
const SHOP_OPTION = { id: SHOP, name: "Alder Automotive" };

/** Port Alder as `pov` sees it at chat start, with the shop's, Marcus's and Jordan's accounts open. */
function portAlder(pov: string): Working {
  const make = STARTER_WORLDS.modern_slice_of_life;
  if (!make) throw new Error("no Port Alder starter");
  const world = make("pa", "Port Alder");
  world.pov = pov;
  const w = new Working(reg, world, startState(world, reg));
  for (const id of [SHOP, MARCUS, JORDAN]) materializeAll(reg, w, id, "paying-as");
  return w;
}

function entryOf(w: Working, action: string): PaletteEntry {
  const entry = palette(w.world, w.state, reg).entries.find((e) => e.action === action);
  if (!entry) throw new Error(`the palette offers no ${action}`);
  return entry;
}

/** Marcus delegates money.spend for the shop to Jordan, up to $200 a payment. */
function delegated(): Working {
  const w = portAlder(JORDAN);
  const granted = resolveAction(reg, w, { action: "org_delegate", params: { org: SHOP, to: JORDAN, powers: "money.spend", payment: 20000 }, actor: MARCUS }, createRng("delegate"));
  expect(granted.failed?.reason ?? granted.rejected.map((r) => r.rejection.reason).join("; ")).toBe("");
  return w;
}

describe("the palette's Paying as", () => {
  test("Jordan, who may spend for no one: Pay and Buy offer no Paying as", () => {
    const w = portAlder(JORDAN);
    for (const action of ["pay", "buy"]) expect(entryOf(w, action).acting).toBeUndefined();
  });

  test("with Marcus's delegation of money.spend, Jordan's Pay, Buy, Lend money and Donate offer Alder Automotive; an action needing another power doesn't", () => {
    const w = delegated();
    const spending = ["pay", "buy", "lend_money", "donate"];
    for (const action of spending) expect(entryOf(w, action).acting).toEqual({ param: "as", label: "Paying as", options: [SHOP_OPTION] });
    // Every other entry with an `as` needs a power other than money.spend, which he doesn't hold.
    for (const entry of palette(w.world, w.state, reg).entries) if (!spending.includes(entry.action)) expect(entry.acting).toBeUndefined();
  });

  test("Marcus, its owner, may spend for Alder Automotive: his Pay offers it", () => {
    expect(entryOf(portAlder(MARCUS), "pay").acting?.options).toContainEqual(SHOP_OPTION);
  });

  test("the selector: You first, then each organization; a pick passes its id, You passes none; one no longer offered reads as You", () => {
    const acting = { param: "as", label: "Paying as", options: [SHOP_OPTION, { id: "household_delgado", name: "The Delgados" }] };
    const picked: string[] = [];
    const seg = propsOf(PayingAs({ acting, value: "", onChange: (id) => picked.push(id) }), Seg)[0];
    expect([seg?.label, seg?.value]).toEqual(["Paying as", ""]);
    expect(seg?.options).toEqual([
      { value: "", label: "You" },
      { value: SHOP, label: "Alder Automotive" },
      { value: "household_delgado", label: "The Delgados" },
    ]);
    (seg?.onChange as (id: string) => void)(SHOP);
    (seg?.onChange as (id: string) => void)("");
    expect(picked).toEqual([SHOP, ""]);
    expect(propsOf(PayingAs({ acting, value: SHOP, onChange: () => undefined }), Seg)[0]?.value).toBe(SHOP);
    expect(propsOf(PayingAs({ acting, value: "trust_gone", onChange: () => undefined }), Seg)[0]?.value).toBe("");
  });

  test("the request carries `as` only for an organization the entry offers", () => {
    const pay: PaletteEntry = { action: "pay", label: "Pay", group: "pay", options: [{ label: "Priya", params: { to: "priya_nair" } }], amount: { param: "amount", min: 0, max: null }, acting: { param: "as", label: "Paying as", options: [SHOP_OPTION] } };
    const priya = pay.options[0];
    if (!priya) throw new Error("fixture");
    expect(paletteRequest(pay, [priya], "c1", 15000, undefined, [], SHOP).params).toEqual({ to: "priya_nair", amount: 15000, as: SHOP });
    expect(paletteRequest(pay, [priya], "c1", 15000).params).toEqual({ to: "priya_nair", amount: 15000 });
    expect(paletteRequest(pay, [priya], "c1", 15000, undefined, [], "household_kowalczyk").params).toEqual({ to: "priya_nair", amount: 15000 });
    // An entry without Paying as never sends one.
    expect(paletteRequest({ ...pay, acting: undefined }, [priya], "c1", 15000, undefined, [], SHOP).params).toEqual({ to: "priya_nair", amount: 15000 });
  });

  test("Pay as Alder Automotive from the palette plays as the shop: its till pays, and Jordan is named on the line", () => {
    const w = delegated();
    const pay = entryOf(w, "pay");
    const to = pay.options.find((o) => o.params.to === MARCUS) ?? pay.options.find((o) => o.person === true);
    if (!to) throw new Error("the palette's Pay offers no one to pay");
    const request = paletteRequest(pay, [to], "c1", 15000, undefined, [], SHOP);
    expect(request.params.as).toBe(SHOP);
    const res = resolveAction(reg, w, { action: request.action, params: request.params }, createRng("pay-as"));
    expect(res.failed ?? null).toBeNull();
    expect(res.rejected).toEqual([]);
    expect(journalOf(w.state, TILL).find((j) => j.cents === -15000)?.by).toBe(JORDAN);
  });

  test("sent from the sheet, it is staged and plays on the next message as the shop: its till pays, Jordan named on the line", async () => {
    const rig = new Rig({ shipped: true });
    const worldId = await rig.newWorld("Port Alder", "modern_slice_of_life");
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
    const chatId = rig.host.createChat("Morning.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    // The GM records Marcus's delegation: money.spend for the shop, up to $200 a payment.
    rig.body(await rig.send({ type: "lre.edit", chatId, ops: [{ op: "link", rel: "acts_for", from: JORDAN, to: SHOP, fields: { powers: ["money.spend"], payment: 20000, by: MARCUS } }] }));
    const pay = (await rig.rt.view(chatId, rig.host.userId)).palette?.entries.find((e) => e.action === "pay");
    expect(pay?.acting).toEqual({ param: "as", label: "Paying as", options: [SHOP_OPTION] });
    const danny = pay?.options.find((o) => o.params.to === "danny_okafor");
    if (!pay || !danny) throw new Error("the palette's Pay offers no Danny");
    rig.host.quietReply = (req: QuietRequest) => ((req.messages[0]?.content ?? "").includes("You map a player's typed input") ? JSON.stringify({ action: null, params: {}, confidence: 0.9 }) : "{}");
    rig.body(await rig.send(paletteRequest(pay, [danny], chatId, 15000, undefined, [], SHOP)));
    await rig.turn(chatId, "I settle up with Danny for the parts.", "You hand Danny the shop's money for the parts.");
    const state = (await rig.rt.ledger.core(chatId, rig.host.userId))?.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
    if (!state) throw new Error("no state");
    expect(journalOf(state, TILL).find((j) => j.cents === -15000)?.by).toBe(JORDAN);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
