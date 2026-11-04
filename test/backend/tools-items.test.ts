// The items family's read tools on Port Alder (INC1-SPEC R3a): what Jordan wears, carries and owns,
// what someone with him has on them, where a thing is and whose it is, and how worn his pickup is,
// under each view an agent reads with. A secret thing in his toolbox is marked for the narrator, and
// read with its visibility by the GM.
//
// The Curator's item and place tools working a turn (ITEMS-SPEC §12 Phase 3), as its agent calls
// them in the turn's post phase: each change staged into the turn's draft and landed by the turn's
// commit, re-validated in order. A make finds first and names the one there already; a thing too big
// to carry lands where its person stands; a handover's basis decides its owner (§4.6); a merge is of
// things made in play, an authored one the GM's; a place is found first under its parent; and a
// change asked for again is the one staged, landing once.

import { describe, expect, test } from "bun:test";
import { type ReadNotes, type ToolEnv, toolsFor } from "../../src/backend/agents/tools/registry";
import { type ChatHead, chatHead } from "../../src/backend/agents/tools/workspace";
import { contextOf } from "../../src/backend/agents/tools/writer";
import { type CommitCtx, type CommitOutcome, commitStaged, TurnDraft, turnReader, turnWriter } from "../../src/backend/agents/turn-writer";
import { ENGINE_EVENTS } from "../../src/engine/engine-pack";
import { madePlaces } from "../../src/engine/places-in-play";
import { bandOf, fieldDef } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import { Working } from "../../src/engine/working";
import type { RoleTier } from "../../src/shared/agent-roles";
import type { JsonObject } from "../../src/shared/json";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { Rig } from "../support/rig";
import { alderChat, answerOf, HOME, KNOWLEDGE, POV, toolEnv } from "../support/tools";

const JORDAN = "Jordan Ellis";
const LEDGER = "Vex's ledger";
/** A secret thing in Jordan's toolbox at the shop: no one knows of it. */
const SECRET: Record<string, JsonObject> = {
  vex_ledger: { id: "vex_ledger", kind: "item", name: LEDGER, tier: "background", fields: {}, relations: [{ type: "in", to: "pov_toolbox" }], visibility: "secret" },
};
/** What Danny has on him at home, where Jordan wakes: a thermos in hand, and a duffel bag with a key in it. */
const DANNY_GEAR: Record<string, JsonObject> = {
  thermos: { id: "thermos", kind: "item", name: "Thermos", tier: "background", fields: { owner: "danny_okafor" }, relations: [{ type: "in", to: "danny_okafor" }] },
  duffel: { id: "duffel", kind: "container", name: "Duffel bag", tier: "background", fields: { owner: "danny_okafor", capacity_l: 40 }, relations: [{ type: "in", to: "danny_okafor" }] },
  brass_key: { id: "brass_key", kind: "item", name: "Brass key", tier: "background", fields: { owner: "danny_okafor" }, relations: [{ type: "in", to: "duffel" }] },
};

interface Ref {
  id?: string;
  name: string;
  visibility?: string;
}
interface Field {
  field: string;
  label: string;
  value: unknown;
  band?: string;
}
interface Item extends Ref {
  slot?: string;
  condition?: Field;
  contents?: Item[];
}
interface Stored extends Item {
  at: Ref | null;
}
interface Inventory {
  person: Ref;
  worn: Item[];
  carried: Item[];
  elsewhere?: Stored[];
  lent?: unknown[];
  borrowed?: unknown[];
}
interface Holder {
  thing: Ref;
  in: Ref[];
  held?: true;
  place: Ref | null;
  owners: (Ref & { role: string; share: number })[];
  users: Ref[];
}
interface Condition {
  thing: Ref;
  fields: Field[];
}

/** Every thing of a list, and every thing inside each, depth first. */
const everything = (items: readonly Item[]): Item[] => items.flatMap((i) => [i, ...everything(i.contents ?? [])]);
/** What an inventory has in Jordan's toolbox. */
const inToolbox = (inv: Inventory): Item[] => inv.elsewhere?.find((i) => i.id === "pov_toolbox")?.contents ?? [];

describe("items_inventory", () => {
  test("Jordan wears his wallet, keys and phone, and owns his toolbox at Alder Automotive and his pickup at home, under each knowledge", async () => {
    const { rig, chatId } = await alderChat();
    const { state, registry, world } = await toolEnv(rig, chatId, "gm").reader.view();
    const condition = state.entities.pov_truck?.fields.condition;
    const band = bandOf(fieldDef(registry, world, "vehicle", "condition")?.bands, Number(condition))?.label;
    expect(band).toBeDefined();
    for (const knowledge of KNOWLEDGE) {
      const inv = await answerOf<Inventory>(rig, chatId, knowledge, "items_inventory", { person: JORDAN });
      expect(inv.person).toMatchObject({ id: POV, name: JORDAN });
      expect(inv.worn.map((i) => i.id)).toEqual(expect.arrayContaining(["pov_wallet", "pov_keys", "pov_phone"]));
      const wallet = inv.worn.find((i) => i.id === "pov_wallet");
      expect(wallet?.slot).toBe("pocket");
      // What the wallet holds is nested in it, his cash aside: that is money, not a thing he carries.
      expect(everything(wallet?.contents ?? []).map((i) => i.id)).toEqual(expect.arrayContaining(["pov_debit_card", "pov_id"]));
      expect(everything([...inv.worn, ...inv.carried]).map((i) => i.id)).not.toContain("acct_pov_cash");
      const toolbox = inv.elsewhere?.find((i) => i.id === "pov_toolbox");
      expect(toolbox?.at).toEqual({ id: "alder_automotive", name: "Alder Automotive" });
      expect(toolbox?.contents?.map((i) => i.id)).toContain("pov_headlamp");
      const truck = inv.elsewhere?.find((i) => i.id === "pov_truck");
      expect(truck?.at).toMatchObject({ id: HOME });
      expect(truck?.condition).toMatchObject({ field: "condition", value: condition, band });
      // What his pickup holds is in it, not listed again on its own.
      expect(everything(truck?.contents ?? []).map((i) => i.id)).toEqual(expect.arrayContaining(["pov_truck_glovebox", "pov_flashlight"]));
      expect(inv.elsewhere?.map((i) => i.id)).not.toContain("pov_flashlight");
      expect(inv.lent).toEqual([]);
      expect(inv.borrowed).toEqual([]);
    }
  });

  test("a secret thing in Jordan's toolbox: marked for the narrator, with its visibility for the GM", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: SECRET } });
    const everyone = await answerOf<Inventory>(rig, chatId, "everyone", "items_inventory", { person: JORDAN });
    expect(inToolbox(everyone)).toContainEqual({ id: "vex_ledger", name: secretMarkText(LEDGER, [], "everyone", SECRET_MARK_WORDING) });
    const gm = await answerOf<Inventory>(rig, chatId, "gm", "items_inventory", { person: JORDAN });
    expect(inToolbox(gm)).toContainEqual({ id: "vex_ledger", name: LEDGER, visibility: "secret" });
  });

  test("someone with Jordan or away: what they have on them, what is in their bag, and what they own elsewhere", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: DANNY_GEAR } });
    for (const knowledge of ["everyone", "gm"] as const) {
      const inv = await answerOf<Inventory>(rig, chatId, knowledge, "items_inventory", { person: "Danny Okafor" });
      expect(inv.carried.find((i) => i.id === "duffel")?.contents?.map((i) => i.id)).toEqual(["brass_key"]);
      expect(inv.elsewhere).toEqual([]);
    }
    const marcus = await answerOf<Inventory>(rig, chatId, "gm", "items_inventory", { person: "Marcus Delgado" });
    expect(marcus.worn.map((i) => i.id)).toContain("shop_office_key");
    expect(marcus.elsewhere?.find((i) => i.id === "shop_tow_truck")?.at).toMatchObject({ id: "alder_automotive" });
  });
});

describe("items_holder", () => {
  test("Jordan's debit card is in his wallet, on him at home, and his, under each knowledge", async () => {
    const { rig, chatId } = await alderChat();
    for (const knowledge of KNOWLEDGE) {
      const held = await answerOf<Holder>(rig, chatId, knowledge, "items_holder", { thing: "pov_debit_card" });
      expect(held.thing).toMatchObject({ id: "pov_debit_card", name: "Debit card" });
      expect(held.in.map((h) => h.id)).toEqual(["pov_wallet", POV]);
      expect(held.held).toBeUndefined();
      expect(held.place).toMatchObject({ id: HOME });
      expect(held.owners).toEqual([{ id: POV, name: JORDAN, role: "owner", share: 100 }]);
      expect(held.users).toEqual([]);
    }
  });

  test("a secret thing: the narrator reads it marked, the GM with its visibility", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: SECRET } });
    const everyone = await answerOf<Holder>(rig, chatId, "everyone", "items_holder", { thing: LEDGER });
    expect(everyone.thing).toEqual({ id: "vex_ledger", name: secretMarkText(LEDGER, [], "everyone", SECRET_MARK_WORDING) });
    expect(everyone.in.map((h) => h.id)).toEqual(["pov_toolbox"]);
    expect(everyone.place).toEqual({ id: "alder_automotive", name: "Alder Automotive" });
    expect(everyone.owners).toEqual([]);
    const gm = await answerOf<Holder>(rig, chatId, "gm", "items_holder", { thing: LEDGER });
    expect(gm.thing).toEqual({ id: "vex_ledger", name: LEDGER, visibility: "secret" });
    expect(gm.in.map((h) => h.id)).toEqual(["pov_toolbox"]);
  });
});

describe("items_condition", () => {
  test("Jordan's pickup: its condition with its band's word, its status, fuel and mileage, under each knowledge", async () => {
    const { rig, chatId } = await alderChat();
    const { state, registry, world } = await toolEnv(rig, chatId, "gm").reader.view();
    const truck = state.entities.pov_truck?.fields ?? {};
    const band = bandOf(fieldDef(registry, world, "vehicle", "condition")?.bands, Number(truck.condition))?.label;
    expect(band).toBeDefined();
    for (const knowledge of KNOWLEDGE) {
      const read = await answerOf<Condition>(rig, chatId, knowledge, "items_condition", { thing: "Your pickup" });
      expect(read.thing).toMatchObject({ id: "pov_truck" });
      const field = (id: string): Field | undefined => read.fields.find((f) => f.field === id);
      expect(field("condition")).toMatchObject({ label: "Condition", value: truck.condition, band });
      expect(field("status")?.value).toBe(truck.status);
      expect(field("fuel_pct")?.value).toBe(truck.fuel_pct);
      expect(field("odometer_mi")?.value).toBe(truck.odometer_mi);
      // Its home base is a place, named as the knowledge names it.
      expect(field("home")?.value).toMatchObject({ id: HOME });
      // Where it is and whose it is aren't its condition.
      expect(field("owner")).toBeUndefined();
      expect(field("place")).toBeUndefined();
    }
  });

  test("a secret thing's condition: the narrator reads it marked, the GM with its visibility", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: SECRET } });
    expect((await answerOf<Condition>(rig, chatId, "everyone", "items_condition", { thing: LEDGER })).thing).toEqual({ id: "vex_ledger", name: secretMarkText(LEDGER, [], "everyone", SECRET_MARK_WORDING) });
    expect((await answerOf<Condition>(rig, chatId, "gm", "items_condition", { thing: LEDGER })).thing).toEqual({ id: "vex_ledger", name: LEDGER, visibility: "secret" });
  });
});

// ---------------------------------------------------------------- the Curator's tools (Phase 3)

/** The Curator's agent in a test turn. */
const CURATOR = "curator:test:1";
/** Danny's truck keys, on him. */
const TRUCK_KEYS: JsonObject = { id: "danny_truck_keys", kind: "item", name: "Truck keys", tier: "background", fields: { owner: "danny_okafor" }, relations: [{ type: "in", to: "danny_okafor" }] };
/** Jordan's old guitar, on him. */
const GUITAR: JsonObject = { id: "pov_guitar", kind: "item", name: "Old guitar", tier: "background", fields: { owner: "pov" }, relations: [{ type: "in", to: "pov" }] };

/** A write tool's answer: staged into the turn, checked only (`dry`), or refused with why, and, for a make, the one there already. */
interface WriteAnswer {
  staged?: { key: string; changeType: string; mode: "auto" | "confirm"; lines: string[]; lands: string };
  checked?: { key: string; changeType: string; mode: "auto" | "confirm"; lines: string[] };
  refused?: { code: string; reason: string; exists?: string };
}

/** What a turn's commit landed, the GM's Apply of what it set aside for the review card when asked, and the state they left as the next turn's head. */
interface Landed {
  out: CommitOutcome;
  applied: CommitOutcome | null;
  state: WorldState;
  head: ChatHead;
}

interface CuratorTurn {
  head: ChatHead;
  draft: TurnDraft;
  /** One call of the tool `name`, as the Curator's agent makes it, its answer read back from its JSON. */
  call<T = WriteAnswer>(name: string, args: JsonObject): Promise<T>;
  /** The turn's post phase committed onto its head (`commitStaged`); with `apply`, what went to the review card let through as the GM's Apply lets it. */
  land(apply?: boolean): Promise<Landed>;
}

/**
 * The Curator working the post phase of a turn on `head` (the chat's own unless given), as the
 * orchestrator gives it its tools: those of its role's families, read and story tiers (and the GM's,
 * at the GM tier), reading the GM's view with every secret marked, with what it staged before in the
 * phase on top, writing into the turn's draft.
 */
async function curatorTurn(rig: Rig, chatId: string, opts: { head?: ChatHead; tier?: RoleTier } = {}): Promise<CuratorTurn> {
  const { rt } = rig;
  const userId = rig.host.userId;
  const head = opts.head ?? (await chatHead(rt, chatId, userId));
  if (!head) throw new Error("the chat has no head");
  const settings = await rt.settings.get(userId);
  const role = settings.agents.roles.curator;
  const tier = opts.tier ?? role.tier;
  const signal = new AbortController().signal;
  const draft = new TurnDraft("gen_curator_test");
  const reader = turnReader(rt, () => head, { userId, chatId, knowledge: "gm", marks: true, own: () => draft.own(CURATOR, "post") });
  const writer = turnWriter(rt, draft, { userId, chatId, role: "curator", agentId: CURATOR, tier, connectionId: null, phase: "post", base: () => head, kept: () => ({}), reader, gmOps: settings.agents.gmOpsPerTurn, holder: CURATOR, signal });
  const notes: ReadNotes = { add: () => true };
  const env: ToolEnv = { userId, chatId, knowledge: "gm", marks: true, reader, writer, agent: { role: "curator", id: CURATOR }, signal, notes };
  const tools = toolsFor({ world: head.world, tiers: tier === "gm" ? ["read", "story", "gm"] : ["read", "story"], families: role.families, texts: settings.prompts.texts, env });
  return {
    head,
    draft,
    async call<T>(name: string, args: JsonObject): Promise<T> {
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`the Curator has no tool ${name}`);
      const out = await tool.run(args, { signal, agentId: CURATOR, role: "curator", callId: `call_${name}` });
      try {
        return JSON.parse(out.text) as T;
      } catch {
        throw new Error(`${name}: ${out.text}`);
      }
    },
    async land(apply = false) {
      const learning = await rt.settings.learningOf(userId);
      const active = await rt.activeConnectionId(userId);
      const commit: CommitCtx = { ctx: () => contextOf(rt, { knowledge: "everyone" }, head, settings, learning, {}, active), reader: turnReader(rt, () => head, { userId, chatId, knowledge: "gm" }), userId, chatId, signal };
      const w = new Working(rt.registry, head.world, head.state);
      const out = commitStaged(rt, commit, draft.take("post"), w);
      const applied = apply ? commitStaged(rt, commit, out.confirm.map((op) => ({ ...op, approved: true as const, gm: true })), w) : null;
      // The next turn's head is the state they left, with the world played for it: a place made in play is in it.
      return { out, applied, state: w.state, head: { ...head, state: w.state, world: w.world } };
    },
  };
}

/** The things named `name` in `state`, by id. */
const named = (state: WorldState, name: string): string[] => Object.keys(state.entities).filter((id) => state.entities[id]?.name === name);
/** Who holds a thing (its `in`), or undefined. */
const holderOf = (state: WorldState, id: string): string | undefined => state.entities[id]?.relations.find((r) => r.type === "in")?.to;
/** Every use grant on a thing, whoever has it. */
const grantsOn = (state: WorldState, id: string): string[] => Object.keys(state.entities).filter((who) => state.entities[who]?.relations.some((r) => r.type === "uses" && r.to === id));

describe("the Curator's item and place tools in a turn (ITEMS-SPEC §12 Phase 3)", () => {
  test("item_make finds first: one in its scope is refused as exists, naming it, the Curator's own new one too", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: DANNY_GEAR } });
    const turn = await curatorTurn(rig, chatId);
    // Danny's thermos is on him: a thermos made on him is that one, dry run or not.
    expect((await turn.call("item_make", { name: "Thermos", in: "Danny Okafor", why: "Danny sips from his thermos", dry: true })).refused).toMatchObject({ code: "exists", exists: "thermos" });
    expect((await turn.call("item_make", { name: "Thermos", in: "Danny Okafor", why: "Danny sips from his thermos" })).refused).toMatchObject({ code: "exists", exists: "thermos" });
    expect(turn.draft.size).toBe(0);
    // A mug made at home, then "the mug" made there again: the second finds the first on the Curator's own draft.
    expect((await turn.call("item_make", { name: "Coffee mug", at: "114 Harbor Street", why: "Jordan pours a coffee" })).staged).toMatchObject({ changeType: "item_make", mode: "auto" });
    const again = (await turn.call("item_make", { name: "mug", at: HOME, why: "the mug on the counter" })).refused;
    expect(again?.code).toBe("exists");
    expect(turn.draft.writesOf(CURATOR).refused.map((r) => r.code)).toEqual(["exists", "exists"]);
    const { out, state } = await turn.land();
    expect(out.committed).toHaveLength(1);
    expect(named(state, "Coffee mug")).toEqual([again?.exists ?? ""]);
    expect(state.entities[again?.exists ?? ""]?.fields).toMatchObject({ place: HOME, made: { by: "curator", at: { place: HOME } } });
  });

  test("a thing too big to carry, moved or made onto someone, lands where they stand, with a note; one bigger than Armful asks first", async () => {
    const bag: JsonObject = { id: "concrete_mix", kind: "item", name: "Bag of concrete mix", tier: "background", fields: { owner: POV, size: "heavy" }, relations: [{ type: "in", to: "pov_truck_bed" }] };
    const { rig, chatId } = await alderChat({ put: { entities: { concrete_mix: bag } } });
    const turn = await curatorTurn(rig, chatId);
    expect((await turn.call("item_move", { item: "Bag of concrete mix", in: JORDAN, why: "Jordan hauls the bag out of the truck bed" })).staged).toMatchObject({ changeType: "item_move", mode: "auto" });
    expect((await turn.call("item_make", { name: "Refrigerator", type: "refrigerator", in: JORDAN, why: "Jordan and Danny carry a new fridge in" })).staged).toMatchObject({ changeType: "item_make", mode: "confirm" });
    const { out, applied, state } = await turn.land(true);
    // The move lands at once: at 114 Harbor Street, where Jordan stands, out of the truck bed and not on him.
    expect(out.committed.map((c) => c.op.changeType)).toEqual(["item_move"]);
    expect(state.entities.concrete_mix?.fields.place).toBe(HOME);
    expect(holderOf(state, "concrete_mix")).toBeUndefined();
    expect(out.committed[0]?.events.find((ev) => ev.type === ENGINE_EVENTS.note)).toMatchObject({ data: { text: "Bag of concrete mix is too big to carry (Heavy), so it is at 114 Harbor Street rather than on Jordan Ellis.", entity: "concrete_mix", visibility: "secret" } });
    // The fridge waits for the GM's Apply, then is made at home, not in his hands.
    expect(out.confirm.map((o) => o.changeType)).toEqual(["item_make"]);
    expect(applied?.committed).toHaveLength(1);
    const [fridge = "", ...more] = named(state, "Refrigerator");
    expect(more).toEqual([]);
    expect(state.entities[fridge]?.fields).toMatchObject({ place: HOME, catalog: "refrigerator", made: { by: "curator", at: { place: HOME } } });
    expect(holderOf(state, fridge)).toBeUndefined();
  });

  test("item_hand's bases (§4.6): a hold, a loan and a theft keep the owner; a gift, a sale and a trade make the receiver the owner, asking first", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: { ...DANNY_GEAR, danny_truck_keys: TRUCK_KEYS, pov_guitar: GUITAR } } });
    const turn = await curatorTurn(rig, chatId);
    const hand = async (item: string, to: string, basis: string, why: string, until?: string): Promise<WriteAnswer["staged"]> => (await turn.call("item_hand", { item, to, basis, why, ...(until !== undefined ? { until } : {}) })).staged;
    const keeps = { changeType: "item_hand", mode: "auto" };
    const owns = { changeType: "item_own", mode: "confirm" };
    expect(await hand("Truck keys", JORDAN, "hold", "Danny tosses Jordan his truck keys so he can move the truck")).toMatchObject(keeps);
    expect(await hand("Old guitar", "Danny Okafor", "loan", "Jordan lends Danny his old guitar", "for two days")).toMatchObject(keeps);
    expect(await hand("pov_phone", "Danny Okafor", "theft", "Danny pockets Jordan's phone while he isn't looking")).toMatchObject({ changeType: "item_move", mode: "auto" });
    expect(await hand("Thermos", JORDAN, "gift", '"Keep it," Danny says of his thermos')).toMatchObject(owns);
    expect(await hand("pov_pocketknife", "Danny Okafor", "sale", "Danny buys Jordan's pocketknife off him")).toMatchObject(owns);
    expect(await hand("Brass key", JORDAN, "trade", "Danny trades his brass key for Jordan's wristwatch")).toMatchObject(owns);
    expect(await hand("pov_watch", "Danny Okafor", "trade", "Jordan trades his wristwatch for Danny's brass key")).toMatchObject(owns);
    const { out, applied, state } = await turn.land(true);
    // What keeps the owner lands with the turn; what changes it waits for the GM's Apply.
    expect(out.committed.map((c) => c.op.changeType)).toEqual(["item_hand", "item_hand", "item_move"]);
    expect(out.confirm.map((o) => o.changeType)).toEqual(["item_own", "item_own", "item_own", "item_own"]);
    expect(applied?.committed).toHaveLength(4);
    const e = state.entities;
    // Held: in Jordan's hands, still Danny's, Jordan's to use on a hold.
    expect(holderOf(state, "danny_truck_keys")).toBe(POV);
    expect(e.danny_truck_keys?.fields).toMatchObject({ owner: "danny_okafor", got: { how: "holding", from: "danny_okafor" } });
    expect(e.pov?.relations).toContainEqual({ type: "uses", to: "danny_truck_keys", fields: { basis: "hold", by: "danny_okafor" } });
    // Lent: with Danny till it ends, still Jordan's.
    expect(holderOf(state, "pov_guitar")).toBe("danny_okafor");
    expect(e.pov_guitar?.fields).toMatchObject({ owner: POV, got: { how: "loan", from: POV } });
    expect(e.danny_okafor?.relations).toContainEqual({ type: "uses", to: "pov_guitar", fields: { basis: "loan", by: POV }, until: turn.head.state.clock + 2 * 24 * 60 });
    // Taken: with Danny, still Jordan's.
    expect(holderOf(state, "pov_phone")).toBe("danny_okafor");
    expect(e.pov_phone?.fields).toMatchObject({ owner: POV, got: { how: "took", from: POV } });
    // Given, sold and traded: the receiver's, and with them.
    expect(["thermos", "pov_pocketknife", "brass_key", "pov_watch"].map((id) => [id, e[id]?.fields.owner, holderOf(state, id)])).toEqual([
      ["thermos", POV, POV],
      ["pov_pocketknife", "danny_okafor", "danny_okafor"],
      ["brass_key", POV, POV],
      ["pov_watch", "danny_okafor", "danny_okafor"],
    ]);
  });

  test("a return goes back to the owner only, and ends the grants on it", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: { danny_truck_keys: TRUCK_KEYS, pov_guitar: GUITAR } } });
    const first = await curatorTurn(rig, chatId);
    await first.call("item_hand", { item: "danny_truck_keys", to: JORDAN, basis: "hold", why: "Danny tosses Jordan his truck keys" });
    await first.call("item_hand", { item: "pov_guitar", to: "Danny Okafor", basis: "loan", until: "until 7 tonight", why: "Jordan lends Danny his guitar till tonight" });
    const { state: lent, head } = await first.land();
    expect([grantsOn(lent, "danny_truck_keys"), grantsOn(lent, "pov_guitar")]).toEqual([[POV], ["danny_okafor"]]);
    const next = await curatorTurn(rig, chatId, { head });
    // Handed to someone who doesn't own it, it isn't a return.
    expect((await next.call("item_hand", { item: "danny_truck_keys", to: "Helen Kowalczyk", basis: "return", why: "Jordan gives the keys to Helen" })).refused?.code).toBe("not_owner");
    const returned = { changeType: "item_hand", mode: "auto" };
    expect((await next.call("item_hand", { item: "danny_truck_keys", to: "Danny Okafor", basis: "return", why: "Jordan hands Danny his keys back" })).staged).toMatchObject(returned);
    expect((await next.call("item_hand", { item: "pov_guitar", to: JORDAN, basis: "return", why: "Danny brings the guitar back" })).staged).toMatchObject(returned);
    const { state } = await next.land();
    expect([holderOf(state, "danny_truck_keys"), state.entities.danny_truck_keys?.fields.owner]).toEqual(["danny_okafor", "danny_okafor"]);
    expect([holderOf(state, "pov_guitar"), state.entities.pov_guitar?.fields.owner]).toEqual([POV, POV]);
    expect([grantsOn(state, "danny_truck_keys"), grantsOn(state, "pov_guitar")]).toEqual([[], []]);
  });

  test("a merge works on things made in play only: merging one the world defines is the GM's", async () => {
    const mug: JsonObject = { id: "kitchen_mug", kind: "item", name: "Coffee mug", tier: "background", fields: { place: HOME }, relations: [] };
    const { rig, chatId } = await alderChat({ put: { entities: { kitchen_mug: mug } } });
    // One turn makes a travel mug on the counter, and another in Jordan's hand: two of one.
    const first = await curatorTurn(rig, chatId);
    await first.call("item_make", { name: "Travel mug", at: HOME, why: "a travel mug on the counter" });
    await first.call("item_make", { name: "Travel mug", in: JORDAN, why: "Jordan grabs his travel mug" });
    const { state: made, head } = await first.land();
    const mugs = named(made, "Travel mug");
    const onCounter = mugs.find((id) => made.entities[id]?.fields.place === HOME) ?? "";
    const inHand = mugs.find((id) => holderOf(made, id) === POV) ?? "";
    expect([mugs.length, onCounter !== "", inHand !== ""]).toEqual([2, true, true]);
    const next = await curatorTurn(rig, chatId, { head });
    expect((await next.call("item_merge", { keep: inHand, drop: "kitchen_mug" })).refused?.code).toBe("authored");
    expect((await next.call("item_merge", { keep: inHand, drop: onCounter })).staged).toMatchObject({ changeType: "item_merge", mode: "confirm" });
    const { out, applied, state } = await next.land(true);
    expect([out.committed.length, out.confirm.length, applied?.committed.length]).toEqual([0, 1, 1]);
    expect(state.entities[onCounter]?.fields).toMatchObject({ merged_into: inHand, gone: true });
    expect(state.entities[inHand]?.fields.qty).toBe(2);
    expect(state.entities.kitchen_mug?.fields.gone).toBeUndefined();
    // At the GM tier, the world's own mug merges too.
    const gm = await curatorTurn(rig, chatId, { head, tier: "gm" });
    expect((await gm.call("item_merge", { keep: inHand, drop: "kitchen_mug" })).staged).toMatchObject({ changeType: "item_merge", mode: "confirm" });
  });

  test("place_make finds first: a place under the same parent by its name, the Curator's own new one too, is refused as exists, naming it; a venue asks first", async () => {
    const { rig, chatId } = await alderChat();
    const turn = await curatorTurn(rig, chatId);
    expect((await turn.call("place_make", { name: "Back booth", parent: "The Rusty Anchor", as: "spot", why: "Jordan slides into the back booth" })).staged).toMatchObject({ changeType: "place_make", mode: "auto" });
    const again = (await turn.call("place_make", { name: "the back booth", parent: "rusty_anchor", as: "spot", why: "the booth at the back" })).refused;
    expect(again?.code).toBe("exists");
    const { out, state, head } = await turn.land();
    expect(out.committed).toHaveLength(1);
    expect(madePlaces(state).map((p) => [p.id, p.name, p.parent, p.made.as, p.made.by])).toEqual([[again?.exists ?? "", "Back booth", "rusty_anchor", "spot", "curator"]]);
    // The next turn: "booth" is that one, by its head noun, and places_find reads it as made.
    const next = await curatorTurn(rig, chatId, { head });
    expect((await next.call("place_make", { name: "booth", parent: "rusty_anchor", as: "spot", why: "Jordan's usual booth" })).refused).toMatchObject({ code: "exists", exists: again?.exists });
    const found = await next.call<{ places: { id: string; made?: boolean }[] }>("places_find", { words: "the back booth" });
    expect(found.places[0]).toMatchObject({ id: again?.exists, made: true });
    expect((await next.call("place_make", { name: "Harbor Light Diner", parent: "Port Alder", as: "venue", why: "a new diner opens on the harbor" })).staged).toMatchObject({ changeType: "place_make", mode: "confirm" });
  });

  test("an op key repeated applies once: a dry run stages nothing, the call stages once however often it is made, and it lands once", async () => {
    const { rig, chatId } = await alderChat();
    const turn = await curatorTurn(rig, chatId);
    const take = { item: "pov_flashlight", in: JORDAN, why: "Jordan takes the flashlight from the glovebox" };
    const checked = (await turn.call("item_move", { ...take, dry: true })).checked;
    expect(checked).toMatchObject({ changeType: "item_move", mode: "auto" });
    expect(turn.draft.size).toBe(0);
    const staged = (await turn.call("item_move", take)).staged;
    expect(staged?.key).toBe(checked?.key ?? "");
    expect((await turn.call("item_move", take)).staged).toEqual(staged);
    expect(turn.draft.size).toBe(1);
    const { out, state, head } = await turn.land();
    expect(out.committed.map((c) => c.op.key)).toEqual([staged?.key ?? ""]);
    expect(out.committed[0]?.events.filter((ev) => ev.type === "link")).toHaveLength(1);
    expect(holderOf(state, "pov_flashlight")).toBe(POV);
    // Asked for again once it landed, it is so already.
    const next = await curatorTurn(rig, chatId, { head });
    expect((await next.call("item_move", take)).refused?.code).toBe("no_change");
  });

  test("within a turn the Curator reads what it staged: the fridge it just made is found, and the milk goes into it by name (R5)", async () => {
    const milk: JsonObject = { id: "pov_milk", kind: "item", name: "Milk", tier: "background", fields: { owner: POV }, relations: [{ type: "in", to: POV }] };
    const { rig, chatId } = await alderChat({ put: { entities: { pov_milk: milk } } });
    // A fridge is Furniture, whose make asks first: pinned to apply, so both changes land together.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { item_make: { mode: "auto" } } } }));
    const turn = await curatorTurn(rig, chatId);
    const find = (): Promise<{ found: string; candidates: { id?: string }[] }> => turn.call("items_find", { words: "the fridge" });
    const before = await find();
    expect((await turn.call("item_make", { name: "Refrigerator", type: "refrigerator", at: "114 Harbor Street", why: "Jordan opens the fridge" })).staged).toMatchObject({ changeType: "item_make", mode: "auto" });
    const [made] = turn.draft.own(CURATOR, "post");
    const fridge = made?.events.find((e) => e.type === "spawn");
    const id = fridge?.type === "spawn" ? fridge.entity.id : "";
    expect(id).not.toBe("");
    // Its reads find it before the turn commits, nearest first, and a write names it as it made it.
    expect([before.candidates.some((c) => c.id === id), (await find()).candidates[0]?.id]).toEqual([false, id]);
    expect((await turn.call("item_move", { item: "Milk", in: "Refrigerator", why: "Jordan puts the milk in the fridge" })).staged).toMatchObject({ changeType: "item_move", mode: "auto" });
    const { out, state } = await turn.land();
    expect(out.committed.map((c) => c.op.changeType)).toEqual(["item_make", "item_move"]);
    expect(named(state, "Refrigerator")).toEqual([id]);
    expect(state.entities[id]?.fields).toMatchObject({ place: HOME, catalog: "refrigerator" });
    expect(holderOf(state, "pov_milk")).toBe(id);
  });

  test("the writes name a thing and what it goes into as items_find reads words: the milk goes into the fridge it just made; words that fit two mugs as well are refused with both ids", async () => {
    const milk: JsonObject = { id: "pov_milk", kind: "item", name: "Milk", tier: "background", fields: { owner: POV }, relations: [{ type: "in", to: POV }] };
    const mug = (id: string): JsonObject => ({ id, kind: "item", name: "Coffee mug", tier: "background", fields: { owner: POV }, relations: [{ type: "in", to: POV }] });
    const { rig, chatId } = await alderChat({ put: { entities: { pov_milk: milk, mug_a: mug("mug_a"), mug_b: mug("mug_b") } } });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { item_make: { mode: "auto" } } } }));
    const turn = await curatorTurn(rig, chatId);
    const putAway = { item: "the milk", in: "the fridge", why: "Jordan puts the milk in the fridge" };
    // No fridge yet: nothing holds things by those words.
    await expect(turn.call("item_move", putAway)).rejects.toThrow("No such thing here: the fridge.");
    expect((await turn.call("item_make", { name: "Refrigerator", type: "refrigerator", at: HOME, why: "Jordan opens the fridge" })).staged).toMatchObject({ changeType: "item_make", mode: "auto" });
    const made = turn.draft.own(CURATOR, "post")[0]?.events.find((e) => e.type === "spawn");
    const fridge = made?.type === "spawn" ? made.entity.id : "";
    expect((await turn.call("item_move", putAway)).staged).toMatchObject({ changeType: "item_move", mode: "auto" });
    // Two mugs on Jordan alike: neither stands first, so each is named with its id, and an id names one.
    await expect(turn.call("item_move", { item: "the mug", at: HOME, why: "Jordan sets a mug down" })).rejects.toThrow("the mug could be any of these; ask again with one of their ids: Coffee mug (mug_a); Coffee mug (mug_b).");
    await expect(turn.call("item_move", { item: "Coffee mug", at: HOME, why: "Jordan sets a mug down" })).rejects.toThrow("Coffee mug (mug_a); Coffee mug (mug_b)");
    expect((await turn.call("item_move", { item: "mug_b", in: "the fridge", why: "Jordan chills a mug" })).staged).toMatchObject({ changeType: "item_move" });
    const { state } = await turn.land();
    expect([holderOf(state, "pov_milk"), holderOf(state, "mug_b"), holderOf(state, "mug_a")]).toEqual([fridge, fridge, POV]);
  });
});

describe("a make that gives neither a type nor a size takes its type (N3)", () => {
  test("a typeless Refrigerator made on Jordan gets the catalog's refrigerator type, asks first, and is made at home", async () => {
    const { rig, chatId } = await alderChat();
    const turn = await curatorTurn(rig, chatId);
    expect((await turn.call("item_make", { name: "Refrigerator", in: JORDAN, why: "Jordan and Danny carry a new fridge in" })).staged).toMatchObject({ changeType: "item_make", mode: "confirm" });
    const { out, applied, state } = await turn.land(true);
    expect(out.confirm.map((o) => o.changeType)).toEqual(["item_make"]);
    expect(applied?.committed).toHaveLength(1);
    const [fridge = "", ...more] = named(state, "Refrigerator");
    expect(more).toEqual([]);
    expect(state.entities[fridge]?.fields).toMatchObject({ place: HOME, catalog: "refrigerator" });
    expect(holderOf(state, fridge)).toBeUndefined();
  });
});
