// The decisions tools on Port Alder (ORG-SPEC Phase 5, the acceptance in DESIGN §29.19-29.20): Jordan
// founds Ellis Mobile Repair and the GM brings Danny and Vex Morrow (whom no one may see) in, so the
// votes are Jordan 40 %, Danny 35 %, Vex 25 %; Jordan's issue to Danny is put to a vote (gm_org
// propose), and Jordan, on Marcus's $200 delegation, asks Marcus to approve $250 as Alder Automotive.
// orgs_read's decisions part names Vex with a secret's mark under everyone's knowledge and as she is
// under the GM's; gm_org's vote is checked by its dry run, proposed as org_shares and applied, which
// carries the issue out; its answer, by Marcus, approves the request, which pays then as Jordan's.

import { describe, expect, test } from "bun:test";
import { outsideReader } from "../../src/backend/agents/tools/read-view";
import { toolsFor } from "../../src/backend/agents/tools/registry";
import { chatHead } from "../../src/backend/agents/tools/workspace";
import { type AgentOp, type OpPreview, opKey, outsideWriter } from "../../src/backend/agents/tools/writer";
import { ownersIn } from "../../src/shared/finance";
import type { JsonObject } from "../../src/shared/json";
import type { DecisionsView } from "../../src/shared/org-motions";
import { SECRET_MARK_WORDING, secretMarkText } from "../../src/shared/secret-marks";
import type { WorldState } from "../../src/engine/state";
import { motionsOf } from "../../src/packs/orgs/core/motions";
import { requestsOf } from "../../src/packs/orgs/core/approvals";
import { alderChat, answerOf, HOME, POV } from "../support/tools";

const SHOP = "alder_automotive_co";
const TILL = "acct_marcus_shop";
const MARCUS = "marcus_delgado";
const DANNY = "danny_okafor";
const VEX = "vex_morrow";
const VEX_MARKED = secretMarkText("Vex Morrow", [], "everyone", SECRET_MARK_WORDING);

/** gm_org's answer: what its dry run checked, or the change it proposed. */
interface GmOrgAnswer {
  checked?: OpPreview;
  proposed?: OpPreview;
}

describe("the decisions tools on Port Alder", () => {
  test("orgs_read decisions marks a voter the story view can't see; gm_org vote is dry-run, proposed and applied; answer approves a request", async () => {
    const { rig, chatId } = await alderChat({ put: { entities: { [VEX]: { id: VEX, kind: "character", name: "Vex Morrow", tier: "background", visibility: "secret", fields: { place: HOME }, relations: [] } } } });
    const user = rig.host.userId;
    const org = (change: JsonObject): JsonObject => ({ op: "org", change });
    rig.body(
      await rig.send({
        type: "lre.edit",
        chatId,
        ops: [
          // The chat's first message: no balance is drawn yet, so the GM puts in what the founding and the payment take.
          { op: "adjust", account: "acct_pov_checking", cents: 50_000 },
          { op: "adjust", account: TILL, cents: 50_000 },
          org({ do: "found", type: "company", name: "Ellis Mobile Repair", founder: POV, capital: 50_000, from: "acct_pov_checking", units: 1000 }),
          org({ do: "issue", org: "ellis_mobile_repair_co", to: DANNY, units: 875, price: 0 }),
          org({ do: "issue", org: "ellis_mobile_repair_co", to: VEX, units: 625, price: 0 }),
          org({ do: "delegate", org: SHOP, to: POV, powers: ["money.spend"], payment: 20_000, by: MARCUS }),
        ],
      }),
    );
    // Jordan pays $250 as the shop, over his $200 a payment, asking: the request waits on Marcus.
    rig.body(await rig.send({ type: "lre.action", chatId, action: "pay", params: { to: "priya_nair", amount: 25_000, as: SHOP, ask: true }, source: "palette", now: true }));
    await rig.host.finish(await rig.host.start(chatId, { type: "normal" }), "Jordan texts Marcus about the parts order.");
    const head = async (): Promise<Readonly<WorldState>> => {
      const at = await chatHead(rig.rt, chatId, user);
      if (!at) throw new Error("no head");
      return at.state;
    };
    const request = requestsOf(await head(), SHOP)[0];
    expect(request).toMatchObject({ by: POV, cents: 25_000, approvers: [MARCUS], status: "asked" });

    // The GM assistant outside a turn: the GM tier's tools, with the writer.
    const base = { userId: user, chatId, knowledge: "gm" as const };
    const reader = outsideReader(rig.rt, base);
    const agent = { ...base, reader, agent: { role: "assistant", id: "agent_test" }, signal: new AbortController().signal };
    const writer = outsideWriter(rig.rt, { ...agent, connectionId: null });
    const tools = toolsFor({ world: (await reader.view()).world, tiers: ["read", "gm"], texts: {}, env: { ...agent, writer } });
    const gmOrg = tools.find((t) => t.name === "gm_org");
    if (!gmOrg) throw new Error("no gm_org at the GM tier");
    const call = { signal: new AbortController().signal, agentId: "agent_test", role: "assistant", callId: "call_gm_org" };
    const run = async (args: JsonObject): Promise<GmOrgAnswer> => JSON.parse((await gmOrg.run(args, call)).text) as GmOrgAnswer; // the tool's JSON answer

    // Jordan's issue to Danny, short of his 40 %, put to a vote: his own vote for it.
    const propose: AgentOp = { kind: "gm_edit", op: { op: "org", change: { do: "propose", by: POV, change: { do: "issue", org: "ellis_mobile_repair_co", to: DANNY, units: 100, price: 0 } } } };
    expect((await writer.apply([propose], "Put Jordan's issue to a vote")).applied).toEqual([opKey(propose)]);
    const motion = motionsOf(await head(), "ellis_mobile_repair_co")[0];
    expect(motion).toMatchObject({ status: "open", by: POV });
    const id = motion?.id ?? "";

    // The decisions part: the open motion's voters, Vex marked as a secret under everyone's knowledge and named under the GM's.
    const voters = async (knowledge: "everyone" | "gm") => (await answerOf<{ decisions: DecisionsView | null }>(rig, chatId, knowledge, "orgs_read", { org: "Ellis Mobile Repair", part: "decisions" })).decisions?.open.find((m) => m.id === id)?.voters ?? [];
    expect((await voters("everyone")).find((v) => v.who.id === VEX)?.who.name).toBe(VEX_MARKED);
    expect((await voters("gm")).find((v) => v.who.id === VEX)?.who.name).toBe("Vex Morrow");
    expect(Object.fromEntries((await voters("gm")).map((v) => [v.who.id, v.vote]))).toEqual({ [POV]: "for", [DANNY]: null, [VEX]: null });

    // gm_org vote: its dry run names its change type and mode and writes nothing; proposed, it waits; applied, it carries the issue out.
    const vote = { do: "vote", org: "Ellis Mobile Repair", motion: id, who: "Danny Okafor", vote: "for" };
    const dry = await run({ change: vote, dry: true });
    expect(dry.checked).toEqual(expect.objectContaining({ changeType: "org_shares", mode: "confirm" }));
    expect((await run({ change: vote })).proposed).toEqual(expect.objectContaining({ key: dry.checked?.key, changeType: "org_shares" }));
    expect(motionsOf(await head(), "ellis_mobile_repair_co")[0]?.status).toBe("open");
    const cast: AgentOp = { kind: "gm_edit", op: { op: "org", change: { do: "vote", org: "ellis_mobile_repair_co", motion: id, who: DANNY, vote: "for" } } };
    expect(opKey(cast)).toBe(dry.checked?.key ?? "");
    expect((await writer.apply([cast], "Danny votes for the issue")).applied).toEqual([opKey(cast)]);
    const after = await head();
    expect(motionsOf(after, "ellis_mobile_repair_co")[0]).toMatchObject({ status: "passed", votes: { [DANNY]: { vote: "for", how: "gm" } } });
    expect(ownersIn(after.entities.ellis_mobile_repair_co?.fields ?? {}).find((o) => o.party === DANNY)?.units).toBe(975);

    // gm_org answer: Marcus approves, so the $250 pays now, as Jordan's.
    const till = after.accounts[TILL] ?? 0;
    const answer = { do: "answer", org: "Alder Automotive", request: request?.id ?? "", answer: "approve", by: "Marcus Delgado" };
    expect((await run({ change: answer, dry: true })).checked).toEqual(expect.objectContaining({ changeType: "org_powers" }));
    const approve: AgentOp = { kind: "gm_edit", op: { op: "org", change: { do: "answer", org: SHOP, request: request?.id ?? "", answer: "approve", by: MARCUS } } };
    expect((await writer.apply([approve], "Marcus signs off")).applied).toEqual([opKey(approve)]);
    const paid = await head();
    expect(requestsOf(paid, SHOP)[0]).toMatchObject({ status: "approved", answered: { by: MARCUS } });
    expect(paid.accounts[TILL]).toBe(till - 25_000);
    expect(rig.rt.ledger.errors).toEqual([]);
  });
});
