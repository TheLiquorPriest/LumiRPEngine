// gm_org's listing ops (ORG-SPEC §7.2; DESIGN §27.10 Listing) on Port Alder, with Alder Automotive
// made a C corporation valued at $20,000 (its books $20 a unit, what the public pays for its new
// units): `list` is checked by its dry run as an `org_shares` change, proposed to wait for the GM's
// Apply, and applied as one GM edit whose one Undo takes the listing back.

import { describe, expect, test } from "bun:test";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import { toolsFor } from "../../src/backend/agents/tools/registry";
import { chatHead } from "../../src/backend/agents/tools/workspace";
import { type AgentOp, type OpPreview, opKey, outsideWriter } from "../../src/backend/agents/tools/writer";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { alderChat } from "../support/tools";

const SHOP = "alder_automotive_co";

/** Alder Automotive as a C corporation valued at $20,000, put through the editor as the world's file holds it. */
function corporation(): Record<string, JsonObject> {
  const world = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
  const shop = world.entities[SHOP];
  if (!shop) throw new Error("no shop");
  shop.fields = { ...shop.fields, structure: "c_corp", value: 2_000_000 };
  return JSON.parse(JSON.stringify({ [SHOP]: shop })) as Record<string, JsonObject>;
}

interface GmOrgAnswer {
  checked?: OpPreview;
  proposed?: OpPreview;
}

describe("gm_org on a company's market", () => {
  test("list is checked as org_shares, proposed, applied as one GM edit and undone", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: corporation() } });
    const user = rig.host.userId;
    const base = { userId: user, chatId, knowledge: "gm" as const };
    const reader = outsideReader(rig.rt, base);
    const agent = { ...base, reader, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal };
    const writer = outsideWriter(rig.rt, { ...agent, connectionId: null });
    const tools = toolsFor({ world: (await reader.view()).world, tiers: ["read", "gm"], texts: {}, env: { ...agent, writer } });
    const gmOrg = tools.find((t) => t.name === "gm_org");
    if (!gmOrg) throw new Error("no gm_org at the GM tier");
    const call = { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: "call_gm_org_list" };
    const listing = async (): Promise<unknown> => (await chatHead(rig.rt, chatId, user))?.state.entities[SHOP]?.fields.listing ?? null;
    const change = { do: "list", org: "Alder Automotive", units: 500, price: 2000 };

    const dry = JSON.parse((await gmOrg.run({ change, dry: true }, call)).text) as GmOrgAnswer; // the tool's JSON answer
    expect(dry.checked).toEqual(expect.objectContaining({ changeType: "org_shares", mode: "confirm" }));
    expect(await listing()).toBeNull();
    const proposed = (JSON.parse((await gmOrg.run({ change }, call)).text) as GmOrgAnswer).proposed; // the tool's JSON answer
    expect(proposed).toEqual(expect.objectContaining({ key: dry.checked?.key, changeType: "org_shares" }));
    const op: AgentOp = { kind: "gm_edit", op: { op: "org", change: { do: "list", org: SHOP, units: 500, price: 2000 } } };
    expect(opKey(op)).toBe(proposed?.key ?? "");

    const result = await writer.apply([op], "List Alder Automotive");
    expect([result.applied, result.refused, result.pending]).toEqual([[opKey(op)], [], false]);
    expect(await listing()).toMatchObject({ asset: `stock:${SHOP}`, symbol: "AA", float: 500, price: 2000 });
    const chipId = result.chipId ?? "";
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: chipId, choice: "undo" }))).toEqual({ applied: true, pending: false });
    expect(await listing()).toBeNull();
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
