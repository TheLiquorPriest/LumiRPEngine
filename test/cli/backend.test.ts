// The live tools against the real backend (the Rig: runtime and dispatcher on the fake host), so
// the requests the CLI sends are checked against what LumiRPEngine actually answers, not against a
// fake of it. The socket is left out here; connection.test.ts covers it.

import { expect, test } from "bun:test";
import type { Connection, HostDescription, RequestFields, RequestType } from "../../src/cli/connection";
import { LreError } from "../../src/cli/connection";
import { Live } from "../../src/cli/live";
import type { ToolContext } from "../../src/cli/tools";
import { callTool, KeyedQueue } from "../../src/cli/tools";
import type { FrontendToBackend, ResultBodies } from "../../src/shared/protocol";
import { PROTOCOL_VERSION } from "../../src/shared/protocol";
import { Rig } from "../support/rig";

/** The tools' connection, straight into the Rig's dispatcher as one session that said hello as this client. */
class RigConnection implements Connection {
  private seq = 0;
  constructor(private readonly rig: Rig) {}

  private async send(request: Record<string, unknown>): Promise<unknown> {
    const reqId = `cli${++this.seq}`;
    const before = this.rig.host.sent.length;
    await this.rig.dispatch.handle({ lre: PROTOCOL_VERSION, reqId, ...request } as unknown as FrontendToBackend, this.rig.host.userId, "s_cli");
    await this.rig.host.settle();
    const reply = this.rig.host.sent.slice(before).find((m) => (m.type === "lre.result" || m.type === "lre.error") && m.reqId === reqId);
    if (!reply) throw new Error(`no reply to ${String(request.type)}`);
    if (reply.type === "lre.error") throw new LreError(reply.code, reply.message, reply.lint ?? []);
    return reply.type === "lre.result" ? reply.body : null;
  }

  hello(): Promise<unknown> {
    return this.send({ type: "lre.hello", chatId: null, client: { name: "lumirpengine", version: "0.0.1" } });
  }

  async request<T extends RequestType>(type: T, fields: RequestFields<T>): Promise<ResultBodies[T]> {
    return (await this.send({ type, ...fields })) as ResultBodies[T];
  }

  describe(): Promise<HostDescription> {
    throw new Error("not used");
  }

  close(): void {}
}

interface Tools {
  conn: RigConnection;
  ctx: ToolContext;
  /** A tool's answer as data; a tool error fails the test with its text. */
  call(name: string, args?: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** The live tools over a fresh Rig with every shipped pack and the starters, as one signed-in client. */
async function tools(): Promise<Tools> {
  const rig = new Rig({ shipped: true });
  const conn = new RigConnection(rig);
  expect(await conn.hello()).toMatchObject({ accepted: true, agentApi: 1 });
  const live = new Live(conn);
  const queue = new KeyedQueue();
  const ctx: ToolContext = { readFile: () => "", readOnly: false, live: () => live, serialize: (k, w) => queue.run(k, w) };
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
    const result = await callTool(name, args, ctx);
    if (result.isError) throw new Error(`${name}: ${result.text}`);
    return JSON.parse(result.text) as Record<string, unknown>;
  };
  return { conn, ctx, call };
}

test("edit, draft, commit, history, restore and diff against the real backend, with chats and templates", async () => {
  const { conn, ctx, call } = await tools();

  const templates = await conn.request("lre.world", { op: "templates" });
  expect((templates.templates ?? []).map((t) => t.id)).toEqual(["fantasy_town", "mystery_manor", "modern_slice_of_life"]);
  const created = await call("lre_world_create", { name: "Harbor", template: "modern_slice_of_life" });
  const worldId = String(created.worldId);
  const first = String(created.revision);

  const edit = await call("lre_edit", { worldId, ops: [{ op: "add", path: "/entities/mara", value: { id: "mara", kind: "person", name: "Mara", tier: "background", fields: {}, relations: [], lifeKnowBy: ["you"] } }], expectVersion: 0 });
  expect(edit).toMatchObject({ version: 1, changed: { entities: { added: 1 } } });
  // The misspelled key reads as nothing to lint; the schema names it.
  expect((edit.schema as { first: { path: string; code: string }[] }).first).toEqual(expect.arrayContaining([expect.objectContaining({ path: "entities.mara.lifeKnowBy", code: "schema" })]));
  const stale = await callTool("lre_edit", { worldId, ops: [{ op: "remove", path: "/entities/mara" }], expectVersion: 0 }, ctx);
  expect(stale.isError).toBe(true);
  // A failing `test` op is the patch's own precondition, not a stale draft: its message says which op, and nothing lands.
  const failed = await callTool("lre_edit", { worldId, ops: [{ op: "replace", path: "/name", value: "Not this" }, { op: "test", path: "/name", value: "Elsewhere" }] }, ctx);
  expect(failed.isError).toBe(true);
  expect(failed.text).toContain("operation");
  expect(failed.text).not.toContain("written since you read it");
  expect(await call("lre_draft", { worldId })).toMatchObject({ version: 1, name: "Harbor" });

  await call("lre_edit", { worldId, ops: [{ op: "move", from: "/entities/mara/lifeKnowBy", path: "/entities/mara/tags" }, { op: "replace", path: "/name", value: "Mara's Harbor" }], expectVersion: 1 });
  const draft = await call("lre_draft", { worldId });
  expect(draft).toMatchObject({ stored: true, version: 2, base: first, head: first, headMoved: false, changes: { counts: { entities: { added: 1 } } } });

  const commit = await call("lre_commit", { worldId, note: "Add Mara" });
  const second = String(commit.revision);
  expect(second).not.toBe(first);
  // A commit that renames the world reports the name it now has.
  expect(commit.name).toBe("Mara's Harbor");
  const history = (await call("lre_history", { worldId })).history as { revision: string; source: string; note?: string }[];
  expect(history.map((h) => [h.revision, h.source, h.note ?? null])).toEqual([
    [first, "create", null],
    [second, "agent", "Add Mara"],
  ]);
  // With no draft stored the version is the world's count, never 0 again: an edit meant for an older read is refused.
  expect(await call("lre_draft", { worldId })).toMatchObject({ stored: false, version: 3 });
  const afterCommit = await callTool("lre_edit", { worldId, ops: [{ op: "replace", path: "/name", value: "Too late" }], expectVersion: 0 }, ctx);
  expect(afterCommit.isError).toBe(true);
  expect(afterCommit.text).toContain("is at version 3, not 0");

  const restored = await call("lre_restore", { worldId, revision: first.slice(0, 10) });
  expect(restored).toMatchObject({ restored: first, replaced: null });
  // A new draft counts on from the committed one's version.
  expect(Number(restored.version)).toBeGreaterThan(2);
  const diff = await call("lre_diff", { worldId, from: "head", to: "draft" });
  expect(diff.changes).toEqual([expect.objectContaining({ key: "/name", kind: "changed" }), expect.objectContaining({ key: "/entities/mara", kind: "removed" })]);
  expect(await call("lre_chats", { worldId })).toEqual({ chats: [] });
  await call("lre_discard", { worldId });
  expect((await call("lre_draft", { worldId })).stored).toBe(false);
});

test("an agent adds a flow, a holding and a minds config to a starter through lre_edit; it checks clean, commits, runs and is found by kind", async () => {
  const { ctx, call } = await tools();
  const created = await call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" });
  const worldId = String(created.worldId);
  const ops = [
    // A world's own asset (the starter has no assets map, so it comes whole), and a position in it in the POV's brokerage account.
    { op: "add", path: "/packs/economy/config/assets", value: { glix: { label: "Great Lakes Index Fund", class: "fund", symbol: "GLIX", price: 11240, yield_pct: 1.6 } } },
    { op: "add", path: "/entities/hold_pov_glix", value: { id: "hold_pov_glix", kind: "holding", name: "Great Lakes Index Fund", tier: "background", fields: { account: "acct_pov_brokerage", asset: "glix", lots: [{ qty: 20, cost: 196000, at: "2025-03-02" }], route: "reinvest" }, relations: [] } },
    // Payday savings: every other Friday from the first payday, skipped when checking can't cover it.
    { op: "add", path: "/entities/flow_pov_savings", value: { id: "flow_pov_savings", kind: "flow", name: "Payday savings", tier: "background", fields: { flow_kind: "savings", from: "acct_pov_checking", to: "acct_pov_savings", amount_cents: 25000, every: "week", interval: 2, weekdays: [5], start: "2026-09-18", shortfall: "skip" }, relations: [] } },
    { op: "add", path: "/minds", value: { secrecy: "brief", weights: { mentioned: 50 }, thresholds: { live: 60, near: 35, far: 15 }, always: { ids: ["marcus_delgado"] }, memory: { notes: { show: 10, keep: 30 } } } },
  ];
  const edit = await call("lre_edit", { worldId, ops, expectVersion: 0 });
  // Each change is its own item: the asset under its config map, not as "the economy pack changed".
  expect(edit).toMatchObject({ version: 1, changed: { entities: { added: 2 }, minds: { added: 1 }, assets: { added: 1 } } });
  expect(edit.changed).not.toHaveProperty("packs");
  // Clean: no lint error, nothing the schema doesn't know.
  expect((edit.lint as { errors: number }).errors).toBe(0);
  expect(edit.schema).toMatchObject({ warnings: 0 });
  const draft = await call("lre_draft", { worldId });
  expect(draft).toMatchObject({ stored: true, version: 1, lint: { errors: 0 } });
  const commit = await call("lre_commit", { worldId, note: "Savings, an index fund and minds", expectVersion: 1 });
  expect(commit).toMatchObject({ worldId, note: "Savings, an index fund and minds", warnings: { errors: 0 } });
  // Committed as written: the head holds the minds config.
  const head = await callTool("lre_world", { worldId, source: "head", pointer: "/minds/always" }, ctx);
  expect(head.text).toContain('"marcus_delgado"');
  // The committed world runs in the bundled engine, flow, holding and minds config and all.
  const run = await call("lre_check_world", { worldId, source: "head", days: 5 });
  expect(run.days).toHaveLength(5);
  expect(run.lint).toMatchObject({ errors: 0 });
  // Found by kind, with its pointer, among the starter's other entities; the asset in its config map.
  const flows = (await call("lre_search", { worldId, query: "savings", kinds: ["flow"] })).hits as { kind?: string }[];
  expect(flows).toContainEqual(expect.objectContaining({ id: "flow_pov_savings", kind: "flow", pointer: "/entities/flow_pov_savings", label: "Payday savings" }));
  expect(flows.every((h) => h.kind === "flow")).toBe(true);
  const assets = await call("lre_search", { worldId, query: "great lakes", collections: ["assets"] });
  expect(assets.hits).toContainEqual(expect.objectContaining({ id: "glix", collection: "assets", pointer: "/packs/economy/config/assets/glix" }));
});
