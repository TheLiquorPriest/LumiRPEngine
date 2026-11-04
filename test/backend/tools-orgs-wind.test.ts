// gm_org's wind_up on Port Alder: Alder Automotive (its operating account funded so it can pay its
// debts) wound up all at once, checked by its dry run, proposed as org_shares at confirm, and applied
// as one GM edit whose one Undo takes it back. And parseOrgOp's wind_up and merge shapes.

import { describe, expect, test } from "bun:test";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import { toolsFor } from "../../src/backend/agents/tools/registry";
import { chatHead } from "../../src/backend/agents/tools/workspace";
import { type AgentOp, type OpPreview, opKey, outsideWriter } from "../../src/backend/agents/tools/writer";
import { STARTER_WORLDS } from "../../src/packs/index";
import type { JsonObject } from "../../src/shared/json";
import { parseOrgOp } from "../../src/shared/org-ops";
import type { WorldDoc } from "../../src/shared/world";
import { alderChat } from "../support/tools";

const SHOP = "alder_automotive_co";
const SHOP_ACCOUNT = "acct_marcus_shop";

/** Alder Automotive's operating account with $60,000 in it, enough for its lift loan and its other debts. */
function solventShop(): Record<string, JsonObject> {
  const world = (STARTER_WORLDS.modern_slice_of_life as (id: string, name: string) => WorldDoc)("w", "Port Alder");
  const account = world.entities[SHOP_ACCOUNT];
  if (!account) throw new Error("no shop account");
  account.fields = { ...account.fields, opening: 6_000_000 };
  return JSON.parse(JSON.stringify({ [SHOP_ACCOUNT]: account })) as Record<string, JsonObject>;
}

interface GmOrgAnswer {
  checked?: OpPreview;
  proposed?: OpPreview;
}

describe("winding up through the GM's tools", () => {
  test("parseOrgOp takes wind_up and merge and refuses bad ones", () => {
    expect(parseOrgOp({ do: "wind_up", org: SHOP, stage: "begin", property: "sell", why: " retiring " })).toEqual({ do: "wind_up", org: SHOP, stage: "begin", property: "sell", why: "retiring" });
    expect(parseOrgOp({ do: "wind_up", org: SHOP, stage: "later" })).toBeNull();
    expect(parseOrgOp({ do: "merge", org: "a", into: "b", ratio: 2, keep: true })).toEqual({ do: "merge", org: "a", into: "b", ratio: 2, keep: true });
    expect(parseOrgOp({ do: "merge", org: "a", into: "a" })).toBeNull();
    expect(parseOrgOp({ do: "merge", org: "a", into: "b", cash: -1 })).toBeNull();
  });

  test("gm_org wind_up is checked by its dry run, proposed as org_shares at confirm, and applied as one GM edit whose one Undo takes it back", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: solventShop() } });
    const user = rig.host.userId;
    const base = { userId: user, chatId, knowledge: "gm" as const };
    const reader = outsideReader(rig.rt, base);
    const agent = { ...base, reader, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal };
    const writer = outsideWriter(rig.rt, { ...agent, connectionId: null });
    const tools = toolsFor({ world: (await reader.view()).world, tiers: ["read", "gm"], texts: {}, env: { ...agent, writer } });
    const gmOrg = tools.find((t) => t.name === "gm_org");
    if (!gmOrg) throw new Error("no gm_org at the GM tier");
    const call = { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: "call_gm_org" };
    const dissolved = async (): Promise<unknown> => (await chatHead(rig.rt, chatId, user))?.state.entities[SHOP]?.fields.dissolved;
    const change = { do: "wind_up", org: "Alder Automotive", why: "Marcus retires" };

    const dry = JSON.parse((await gmOrg.run({ change, dry: true }, call)).text) as GmOrgAnswer; // the tool's JSON answer
    expect(dry.checked).toEqual(expect.objectContaining({ changeType: "org_shares", mode: "confirm" }));
    expect(dry.checked?.lines.length).toBeGreaterThan(0);
    expect(await dissolved()).toBeUndefined();
    const proposed = (JSON.parse((await gmOrg.run({ change }, call)).text) as GmOrgAnswer).proposed; // the tool's JSON answer
    expect(proposed).toEqual(expect.objectContaining({ key: dry.checked?.key, changeType: "org_shares", mode: "confirm" }));
    expect(await dissolved()).toBeUndefined();
    const op: AgentOp = { kind: "gm_edit", op: { op: "org", change: { do: "wind_up", org: SHOP, why: change.why } } };
    expect(opKey(op)).toBe(proposed?.key ?? "");

    const result = await writer.apply([op], "Wind up Alder Automotive");
    expect([result.applied, result.refused, result.pending]).toEqual([[opKey(op)], [], false]);
    expect(typeof (await dissolved())).toBe("string");
    const chipId = result.chipId ?? "";
    const fixes = async () => (await rig.rt.view(chatId, user)).chips.filter((c) => c.kind === "fix").map((c) => [c.id, c.actions.map((a) => a.id)]);
    expect(await fixes()).toEqual([[chipId, ["undo"]]]);
    expect(rig.body(await rig.send({ type: "lre.chip", chatId, chip: chipId, choice: "undo" }))).toEqual({ applied: true, pending: false });
    expect(await dissolved()).toBeUndefined();
    expect(await fixes()).toEqual([]);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
