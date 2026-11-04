// The reply's organization facts on Port Alder (ORG-SPEC §7.3, §11 Phase 4 Reply), the read answering
// from fixtures with no model: Marcus putting Danny in charge of the floor is Danny appointed Shop
// foreman, a position Alder Automotive has (F1); a hire on the spot is Jess hired at the shop as its
// Receptionist (F2), each asked first; Danny thinking about quitting changes nothing (F3); and Jess
// quitting the Rusty Anchor ends her job there once applied (F4). And the plan the player's own
// message gives (assess-party §6.2): added by its turn's plan, with a receipt whose Edit opens the
// Plan tab and whose Undo takes it back, kept when the reply is edited and read again; one naming no
// one the player character knows is a receipt saying so.

import { describe, expect, test } from "bun:test";
import { chatHead } from "../../src/backend/agents/tools/workspace";
import type { WorldState } from "../../src/engine/state";
import { planOf } from "../../src/packs/orgs/core/agenda";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { JsonObject } from "../../src/shared/json";
import { PLAN_TAB } from "../../src/shared/org-feed";
import type { Chip } from "../../src/shared/state-view";
import type { WorldDoc } from "../../src/shared/world";
import type { Rig } from "../support/rig";
import { alderChat } from "../support/tools";

const EXTRACT_MARK = "You read a narrator's roleplay reply";
const INTERPRET_MARK = "You map a player's typed input";
const SHOP = "alder_automotive_co";
const DANNY = "danny_okafor";
const MARCUS = "marcus_delgado";
const JESS = "jess_kowalczyk";
/** The player character's party, before it has an entity of its own: the id it will take. */
const PARTY = "party_pov";

/** Alder Automotive with a Shop foreman position beside its Mechanic; Danny is still a mechanic. */
function shopWithForeman(): Record<string, JsonObject> {
  const world = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
  const shop = world.entities[SHOP];
  if (!shop) throw new Error("no shop");
  shop.fields.positions = [
    { id: "mechanic", title: "Mechanic", powers: [], seats: 0 },
    { id: "shop_foreman", title: "Shop foreman", powers: ["staff.hire", "staff.pay", "money.view", "money.spend"], limits: { payment: 50000 } },
  ];
  // Put through the editor as JSON, as the world's file holds it.
  const put = JSON.parse(JSON.stringify({ [SHOP]: shop })) as Record<string, JsonObject>;
  return put;
}

/** The read answers with `proposals`, and interpret with `interpret` (no action unless it says). */
function answers(rig: Rig, proposals: JsonObject[], interpret: JsonObject = {}): void {
  rig.host.quietReply = (req) => {
    const prompt = req.messages[0]?.content ?? "";
    if (prompt.includes(EXTRACT_MARK)) return JSON.stringify({ proposals });
    if (prompt.includes(INTERPRET_MARK)) return JSON.stringify({ action: null, params: {}, confidence: 0.9, ...interpret });
    return "{}";
  };
}

async function state(rig: Rig, chatId: string): Promise<WorldState> {
  const head = await chatHead(rig.rt, chatId, rig.host.userId);
  if (!head) throw new Error("the chat plays no world");
  return head.state;
}

/** The chips on the head reply's displayed swipe. */
async function replyChips(rig: Rig, chatId: string): Promise<Chip[]> {
  const head = rig.host.head(chatId);
  return (await rig.rt.view(chatId, rig.host.userId)).chips.filter((c) => c.messageId === head?.id && (c.swipeId === undefined || c.swipeId === head?.swipeId));
}

/** The chat's one chip `which` finds. */
async function chipOf(rig: Rig, chatId: string, which: (c: Chip) => boolean): Promise<Chip> {
  const found = (await rig.rt.view(chatId, rig.host.userId)).chips.filter(which);
  const [one] = found;
  if (found.length !== 1 || !one) throw new Error(`${found.length} chips found`);
  return one;
}

async function answer(rig: Rig, chatId: string, chip: Chip, choice: string): Promise<void> {
  rig.body(await rig.send({ type: "lre.chip", chatId, chip: chip.id, choice }));
}

describe("the reply's organization facts (ORG-SPEC §11 Phase 4 Reply)", () => {
  test("F1: Marcus putting Danny in charge of the floor is a membership change, Danny appointed Shop foreman, asked first", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: shopWithForeman() } });
    answers(rig, [{ type: "membership", who: DANNY, org: SHOP, change: "appoint", position: "Shop foreman", by: MARCUS, said: "You're running the floor from now on." }]);
    await rig.turn(chatId, "I watch Marcus cross the shop to Danny.", "Marcus clapped Danny on the shoulder: 'You're running the floor from now on.'");
    const chip = await chipOf(rig, chatId, (c) => c.kind === "confirm");
    expect(chip.label).toBe("Danny Okafor is now Shop foreman at Alder Automotive");
    expect((await state(rig, chatId)).entities.job_danny_mechanic?.fields.position).toBe("mechanic");
    await answer(rig, chatId, chip, "confirm");
    expect((await state(rig, chatId)).entities.job_danny_mechanic?.fields.position).toBe("shop_foreman");
  });

  test("F2: Marcus hiring Jess on the spot is an employment change, Jess hired at Alder Automotive as its Receptionist, asked first", async () => {
    const { rig, chatId } = await alderChat();
    answers(rig, [{ type: "employment", who: JESS, org: SHOP, change: "hired", title: "Receptionist", hours: 20, by: MARCUS, said: "Marcus hired Jess on the spot, twenty hours a week at the front desk." }]);
    await rig.turn(chatId, "I hold the door for Jess.", "Marcus hired Jess on the spot, twenty hours a week at the front desk.");
    const jobsAtShop = (s: WorldState) => Object.values(s.entities).filter((e) => e.kind === "job" && e.fields.worker === JESS && e.fields.employer === SHOP);
    const chip = await chipOf(rig, chatId, (c) => c.kind === "confirm");
    expect(chip.label).toBe("Jess Kowalczyk was hired as Receptionist at Alder Automotive");
    expect(jobsAtShop(await state(rig, chatId))).toEqual([]);
    await answer(rig, chatId, chip, "confirm");
    const [job, ...more] = jobsAtShop(await state(rig, chatId));
    expect(more).toEqual([]);
    expect(job?.fields).toEqual(expect.objectContaining({ title: "Receptionist", hours_per_week: 20, status: "active" }));
  });

  test("F3: Danny thinking about quitting changes nothing, with no chip", async () => {
    const { rig, chatId } = await alderChat();
    answers(rig, [{ type: "employment", who: DANNY, org: SHOP, change: "quit", said: "thinking about quitting" }]);
    await rig.turn(chatId, "I ask Danny how he's holding up.", "Danny says he's thinking about quitting.");
    expect((await replyChips(rig, chatId)).filter((c) => c.kind === "confirm" || c.kind === "undo" || c.kind === "untracked")).toEqual([]);
    expect((await state(rig, chatId)).entities.job_danny_mechanic?.fields.status).toBe("active");
  });

  test("F4: Jess quitting the Rusty Anchor is an employment change that ends her job there once applied", async () => {
    const { rig, chatId } = await alderChat();
    answers(rig, [{ type: "employment", who: JESS, org: "rusty_anchor", change: "quit", said: "Jess quit the Rusty Anchor." }]);
    await rig.turn(chatId, "I ask Jess about work.", "Jess quit the Rusty Anchor.");
    const chip = await chipOf(rig, chatId, (c) => c.kind === "confirm");
    expect(chip.label).toBe("Jess Kowalczyk quit The Rusty Anchor");
    expect((await state(rig, chatId)).entities.job_jess_kowalczyk?.fields.status).toBe("active");
    await answer(rig, chatId, chip, "confirm");
    expect((await state(rig, chatId)).entities.job_jess_kowalczyk?.fields.status).toBe("ended");
  });

  test("a fact the state holds already (Danny appointed the position he holds) is silent: no chip", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: shopWithForeman() } });
    answers(rig, [{ type: "membership", who: DANNY, org: SHOP, change: "appoint", position: "Mechanic", said: "Danny is a mechanic at the shop." }]);
    await rig.turn(chatId, "I ask what Danny does.", "Danny is a mechanic at the shop.");
    expect((await replyChips(rig, chatId)).filter((c) => c.kind === "confirm" || c.kind === "undo" || c.kind === "untracked")).toEqual([]);
  });
});

describe("the plan the player's message gives (assess-party §6.2)", () => {
  const ORDER = { to: ["Danny"], text: "Sweep the bays", said: "Danny, sweep the bays" };

  test("is added by the turn's plan with a receipt: Edit opens the party's Plan tab, a Re-read of the edited reply keeps it, and Undo takes it back", async () => {
    const { rig, chatId } = await alderChat();
    answers(rig, [], { agenda: { orders: [ORDER] } });
    await rig.turn(chatId, "Danny, sweep the bays before Marcus gets in.", "Danny grabs the broom.");
    const orders = async () => planOf(await state(rig, chatId), PARTY).orders.map((o) => [o.to, o.text, o.status]);
    expect(await orders()).toEqual([[[DANNY], "Sweep the bays", "open"]]);
    const receipt = await chipOf(rig, chatId, (c) => c.id.startsWith("plan:"));
    expect([receipt.kind, receipt.label]).toEqual(["undo", "Added to the plan: 1 order"]);
    expect(receipt.actions).toEqual([
      { id: "edit", label: "Edit", input: { type: "org", label: "The plan", org: PARTY, tab: PLAN_TAB } },
      { id: "undo", label: "Undo", style: "danger" },
    ]);
    // The reply edited and read again: the read is replaced, the plan the message gave stays.
    const reply = rig.host.head(chatId);
    if (!reply) throw new Error("no reply");
    rig.host.editMessage(chatId, reply.id, "Danny grabs the broom and starts on the first bay.");
    await rig.host.settle();
    rig.body(await rig.send({ type: "lre.chip", chatId, chip: `reread:${reply.id}:${reply.swipeId}`, choice: "reread" }));
    expect(await orders()).toEqual([[[DANNY], "Sweep the bays", "open"]]);
    // Undo takes it back, and the receipt with it.
    await answer(rig, chatId, await chipOf(rig, chatId, (c) => c.id === receipt.id), "undo");
    expect(await orders()).toEqual([]);
    expect((await rig.rt.view(chatId, rig.host.userId)).chips.some((c) => c.id === receipt.id)).toBe(false);
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("an order for someone the player character doesn't know is not added, and its receipt says why", async () => {
    const { rig, chatId } = await alderChat();
    answers(rig, [], { agenda: { orders: [{ to: ["Bartholomew"], text: "Fetch the van", said: "Bartholomew, fetch the van" }] } });
    await rig.turn(chatId, "Bartholomew, fetch the van.", "Nobody answers.");
    const receipt = await chipOf(rig, chatId, (c) => c.id.startsWith("plan:"));
    expect([receipt.kind, receipt.label, receipt.actions]).toEqual(["decline", "Not added to the plan: you don't know anyone called Bartholomew", []]);
    expect(planOf(await state(rig, chatId), PARTY).orders).toEqual([]);
  });
});
