// The organizations family on Port Alder (ORG-SPEC §7.1, §7.2, §11 Phase 4): Alder Automotive's page
// read whole under every view, its secret member named with a secret's mark under everyone's
// knowledge and with their visibility under the GM's (secrecy is marks, never a filter); who may
// hire there, Marcus as its owner and Danny by his Shop foreman position; and gm_org's appointment,
// checked by its dry run, proposed as org_people at confirm, and applied as one GM edit whose one
// Undo takes it back. Then gm_revenue on the shop's counter takings: refused on a stream kept from
// the agents, held to its bounds by its dry run, and an adjustment within them applied as a GM edit.

import { describe, expect, test } from "bun:test";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import { toolsFor } from "../../src/backend/agents/tools/registry";
import { chatHead } from "../../src/backend/agents/tools/workspace";
import { type AgentOp, type OpPreview, opKey, outsideWriter } from "../../src/backend/agents/tools/writer";
import { STARTER_WORLDS } from "../../src/packs/index";
import { objOf } from "../../src/engine/pack-kit";
import type { JsonObject } from "../../src/shared/json";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { WorldDoc } from "../../src/shared/world";
import type { Rig } from "../support/rig";
import { alderChat, answerOf, HOME, POV } from "../support/tools";

const SHOP = "alder_automotive_co";
const DANNY = "danny_okafor";
const MARCUS = "marcus_delgado";
const VEX_MARKED = secretMarkText("Vex Morrow", [], "everyone", SECRET_MARK_WORDING);

/** Alder Automotive with a Shop foreman position (staff.hire and the money powers, up to $500 a payment) beside its Mechanic, and Danny's job in it, as acting-for has them. */
function shopWithForeman(): Record<string, JsonObject> {
  const world = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
  const shop = world.entities[SHOP];
  const job = world.entities.job_danny_mechanic;
  if (!shop || !job) throw new Error("no shop or no job for Danny");
  shop.fields.positions = [
    { id: "mechanic", title: "Mechanic", powers: [], seats: 0 },
    { id: "shop_foreman", title: "Shop foreman", powers: ["staff.hire", "staff.pay", "money.view", "money.spend"], limits: { payment: 50000 } },
  ];
  job.fields = { ...job.fields, position: "shop_foreman" };
  // Put through the editor as JSON, as the world's file holds them.
  const put = JSON.parse(JSON.stringify({ [SHOP]: shop, job_danny_mechanic: job })) as Record<string, JsonObject>;
  return put;
}

/** Vex Morrow, whom no one may see, a member of the shop: a test's own, never Port Alder's. */
const VEX: JsonObject = { id: "vex_morrow", kind: "character", name: "Vex Morrow", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [{ type: "member_of", to: SHOP }] };

interface Person {
  id: string;
  name: string;
  visibility?: string;
}

/** gm_org's answer: what its dry run checked, or the change it proposed. */
interface GmOrgAnswer {
  checked?: OpPreview;
  proposed?: OpPreview;
}

let shared: Promise<{ rig: Rig; chatId: string }> | null = null;

/** One Port Alder chat for the tests that only read: the shop with its foreman, and Vex among its members. */
function chat(): Promise<{ rig: Rig; chatId: string }> {
  shared ??= alderChat({ put: { entities: { ...shopWithForeman(), vex_morrow: VEX } } });
  return shared;
}

describe("the organizations tools on Port Alder", () => {
  test("orgs_read people names a secret member with a secret's mark under everyone's knowledge, and with their visibility under the GM's", async () => {
    const { rig, chatId } = await chat();
    const [everyone, gm] = await Promise.all((["everyone", "gm"] as const).map(async (knowledge) => (await answerOf<{ people: Person[] }>(rig, chatId, knowledge, "orgs_read", { org: "Alder Automotive", part: "people" })).people));
    expect(everyone?.find((p) => p.id === "vex_morrow")).toEqual(expect.objectContaining({ name: VEX_MARKED }));
    expect(everyone?.find((p) => p.id === "vex_morrow")?.visibility).toBeUndefined();
    // Everyone else on the page as they are: the owner, the foreman and the player character.
    expect(everyone?.filter((p) => [MARCUS, DANNY, POV].includes(p.id)).map((p) => p.name).sort()).toEqual(["Danny Okafor", "Jordan Ellis", "Marcus Delgado"]);
    expect(gm?.find((p) => p.id === "vex_morrow")).toEqual(expect.objectContaining({ name: "Vex Morrow", visibility: "secret" }));
  });

  test("orgs_who_may staff.hire lists Marcus as the shop's owner and Danny by his Shop foreman position", async () => {
    const { rig, chatId } = await chat();
    const may = await answerOf<{ holders: { who: Person; basis: string; limits?: JsonObject }[] }>(rig, chatId, "everyone", "orgs_who_may", { org: "Alder Automotive", power: "staff.hire" });
    // In the GM's order, by id: Danny by his position, Marcus as the owner.
    expect(may.holders.map((h) => [h.who.id, h.basis])).toEqual([
      [DANNY, "position"],
      [MARCUS, "owner"],
    ]);
    expect(may.holders.find((h) => h.who.id === DANNY)?.limits).toEqual(expect.objectContaining({ payment: 50000 }));
  });

  test("gm_org appoint is checked by its dry run, proposed as org_people at confirm, and applied as one GM edit whose one Undo takes it back", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: shopWithForeman() } });
    const user = rig.host.userId;
    // The GM assistant outside a turn: the GM tier's tools, with the writer.
    const base = { userId: user, chatId, knowledge: "gm" as const };
    const reader = outsideReader(rig.rt, base);
    const agent = { ...base, reader, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal };
    const writer = outsideWriter(rig.rt, { ...agent, connectionId: null });
    const tools = toolsFor({ world: (await reader.view()).world, tiers: ["read", "gm"], texts: {}, env: { ...agent, writer } });
    const gmOrg = tools.find((t) => t.name === "gm_org");
    if (!gmOrg) throw new Error("no gm_org at the GM tier");
    const call = { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: "call_gm_org" };
    const jordanPosition = async (): Promise<unknown> => (await chatHead(rig.rt, chatId, user))?.state.entities.job_pov_mechanic?.fields.position;
    const change = { do: "appoint", org: "Alder Automotive", who: "Jordan Ellis", position: "shop_foreman", why: "Marcus wants a second pair of eyes on the floor" };

    // The dry run names its change type and mode, and writes nothing.
    const dry = JSON.parse((await gmOrg.run({ change, dry: true }, call)).text) as GmOrgAnswer; // the tool's JSON answer
    expect(dry.checked).toEqual(expect.objectContaining({ changeType: "org_people", mode: "confirm" }));
    expect(dry.checked?.lines.length).toBeGreaterThan(0);
    expect(await jordanPosition()).toBe("mechanic");
    // Outside a turn it is proposed, to wait for the GM's Apply: the op with its names as ids.
    const proposed = (JSON.parse((await gmOrg.run({ change }, call)).text) as GmOrgAnswer).proposed; // the tool's JSON answer
    expect(proposed).toEqual(expect.objectContaining({ key: dry.checked?.key, changeType: "org_people", mode: "confirm" }));
    expect(await jordanPosition()).toBe("mechanic");
    const op: AgentOp = { kind: "gm_edit", op: { op: "org", change: { do: "appoint", org: SHOP, who: POV, position: "shop_foreman", why: change.why } } };
    expect(opKey(op)).toBe(proposed?.key ?? "");

    // Applied: one GM edit with one Undo chip, which takes it back.
    const result = await writer.apply([op], "Make Jordan a foreman");
    expect([result.applied, result.refused, result.pending]).toEqual([[opKey(op)], [], false]);
    expect(await jordanPosition()).toBe("shop_foreman");
    const chipId = result.chipId ?? "";
    const fixes = async () => (await rig.rt.view(chatId, user)).chips.filter((c) => c.kind === "fix").map((c) => [c.id, c.actions.map((a) => a.id)]);
    expect(await fixes()).toEqual([[chipId, ["undo"]]]);
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: chipId, choice: "undo" }))).toEqual({ applied: true, pending: false });
    expect(await jordanPosition()).toBe("mechanic");
    expect(await fixes()).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});

/** The shop's counter takings: a revenue stream its author opened to the agents (or, `off`, didn't). */
function takings(ai: "bounded" | "off"): JsonObject {
  return { id: "shop_takings", kind: "flow", name: "Counter takings", tier: "background", fields: { flow_kind: "income", from: "Customers", to: SHOP, every: "day", at: "17:00", revenue: [{ type: "product", units: 1, price: 15000, buyers: 6, ...(ai === "bounded" ? { ai } : {}) }] }, relations: [] };
}

describe("the revenue tools on Port Alder", () => {
  async function gmRevenue(ai: "bounded" | "off") {
    const { rig, chatId } = await alderChat({ put: { entities: { shop_takings: takings(ai) } } });
    const base = { userId: rig.host.userId, chatId, knowledge: "gm" as const };
    const reader = outsideReader(rig.rt, base);
    const agent = { ...base, reader, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal };
    const writer = outsideWriter(rig.rt, { ...agent, connectionId: null });
    const tools = toolsFor({ world: (await reader.view()).world, tiers: ["read", "gm"], texts: {}, env: { ...agent, writer } });
    const tool = tools.find((t) => t.name === "gm_revenue");
    if (!tool) throw new Error("no gm_revenue at the GM tier");
    const call = { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: "call_gm_revenue" };
    const run = async (args: JsonObject) => JSON.parse((await tool.run(args, call)).text) as GmOrgAnswer & { refused?: { code: string; reason: string } };
    const adjustments = async (): Promise<unknown> => objOf((await chatHead(rig.rt, chatId, rig.host.userId))?.state.packs.economy?.revenue_adj).shop_takings;
    return { rig, run, writer, adjustments };
  }

  test("gm_revenue is refused on a stream its author kept from the agents", async () => {
    const { run } = await gmRevenue("off");
    expect((await run({ stream: "Counter takings", factor: 2, reason: "A rally in town", dry: true })).refused?.code).toBe("not_open");
  });

  test("gm_revenue's dry run holds it to its bounds, and an adjustment within them is proposed, then applied as one GM edit", async () => {
    const { rig, run, writer, adjustments } = await gmRevenue("bounded");
    expect((await run({ stream: "Counter takings", factor: 5, reason: "A rally in town", dry: true })).refused?.code).toBe("out_of_bounds");
    expect((await run({ stream: "Counter takings", cents: 90_001, reason: "A rally in town", dry: true })).refused?.code).toBe("out_of_bounds");
    const dry = await run({ stream: "Counter takings", factor: 1.5, days: 10, reason: "A rally in town", dry: true });
    expect(dry.checked?.lines.length).toBeGreaterThan(0);
    const proposed = (await run({ stream: "Counter takings", factor: 1.5, days: 10, reason: "A rally in town" })).proposed;
    expect(proposed?.key).toBe(dry.checked?.key);
    expect(await adjustments()).toBeUndefined();
    const op: AgentOp = { kind: "gm_edit", op: { op: "effect", effect: "economy.revenue_adjust", args: { stream: "shop_takings", reason: "A rally in town", factor: 1.5, days: 10 } } };
    expect(opKey(op)).toBe(proposed?.key ?? "");
    const result = await writer.apply([op], "Busier for the rally");
    expect([result.applied, result.refused]).toEqual([[opKey(op)], []]);
    expect(await adjustments()).toEqual([expect.objectContaining({ factor: 1.5, reason: "A rally in town" })]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
