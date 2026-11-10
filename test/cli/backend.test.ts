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
import { AGENT_API, PROTOCOL_VERSION } from "../../src/shared/protocol";
import { GUIDE_SECTIONS, guidePatches } from "../support/agent-guide";
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
  expect(await conn.hello()).toMatchObject({ accepted: true, agentApi: AGENT_API });
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
    // A world's own asset, added by its id beside the starter's, and a position in it in the POV's brokerage account.
    { op: "add", path: "/packs/economy/config/assets/glix", value: { label: "Great Lakes Index Fund", class: "fund", symbol: "GLIX", price: 11240, yield_pct: 1.6 } },
    { op: "add", path: "/entities/hold_pov_glix", value: { id: "hold_pov_glix", kind: "holding", name: "Great Lakes Index Fund", tier: "background", fields: { account: "acct_pov_brokerage", asset: "glix", lots: [{ qty: 20, cost: 196000, at: "2025-03-02" }], route: "reinvest" }, relations: [] } },
    // A boat fund: every other Friday from the first payday, skipped when checking can't cover it.
    { op: "add", path: "/entities/flow_pov_boat_fund", value: { id: "flow_pov_boat_fund", kind: "flow", name: "Boat fund", tier: "background", fields: { flow_kind: "savings", from: "acct_pov_checking", to: "acct_pov_savings", amount_cents: 4000, every: "week", interval: 2, weekdays: [5], start: "2026-09-18", shortfall: "skip" }, relations: [] } },
    { op: "add", path: "/minds", value: { secrecy: "brief", weights: { mentioned: 50 }, thresholds: { live: 60, near: 35, far: 15 }, always: { ids: ["marcus_delgado"] }, memory: { notes: { show: 10, keep: 30 } } } },
  ];
  const edit = await call("lre_edit", { worldId, ops, expectVersion: 0 });
  // Each change is its own item, the asset under its config map, and nothing of the starter's moves with them.
  expect(edit).toMatchObject({ version: 1 });
  expect(edit.changed).toEqual({ entities: { added: 2 }, minds: { added: 1 }, assets: { added: 1 } });
  // Clean: no lint error, nothing the schema doesn't know.
  expect((edit.lint as { errors: number }).errors).toBe(0);
  expect(edit.schema).toMatchObject({ warnings: 0 });
  const draft = await call("lre_draft", { worldId });
  expect(draft).toMatchObject({ stored: true, version: 1, lint: { errors: 0 } });
  const commit = await call("lre_commit", { worldId, note: "A boat fund, an index fund and minds", expectVersion: 1 });
  expect(commit).toMatchObject({ worldId, note: "A boat fund, an index fund and minds", warnings: { errors: 0 } });
  // Committed as written: the head holds the minds config.
  const head = await callTool("lre_world", { worldId, source: "head", pointer: "/minds/always" }, ctx);
  expect(head.text).toContain('"marcus_delgado"');
  // The committed world runs in the bundled engine, flow, holding and minds config and all.
  const run = await call("lre_check_world", { worldId, source: "head", days: 5 });
  expect(run.days).toHaveLength(5);
  expect(run.lint).toMatchObject({ errors: 0 });
  // Found by kind, with its pointer, among the starter's other entities; the asset in its config map.
  const flows = (await call("lre_search", { worldId, query: "boat fund", kinds: ["flow"] })).hits as { kind?: string }[];
  expect(flows).toContainEqual(expect.objectContaining({ id: "flow_pov_boat_fund", kind: "flow", pointer: "/entities/flow_pov_boat_fund", label: "Boat fund" }));
  expect(flows.every((h) => h.kind === "flow")).toBe(true);
  const assets = await call("lre_search", { worldId, query: "great lakes", collections: ["assets"] });
  expect(assets.hits).toContainEqual(expect.objectContaining({ id: "glix", collection: "assets", pointer: "/packs/economy/config/assets/glix" }));
});

test("every patch the agent guide shows for minds and money goes through lre_edit onto the modern starter, one by one, lint-clean, and commits", async () => {
  const { call } = await tools();
  const created = await call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" });
  const worldId = String(created.worldId);
  let version = 0;
  let applied = 0;
  for (const title of GUIDE_SECTIONS) {
    for (const ops of guidePatches(title)) {
      // As an agent copies it: each block on its own, on the draft its last edit left.
      const edit = await call("lre_edit", { worldId, ops, expectVersion: version });
      expect({ title, ops, lintErrors: (edit.lint as { errors: number }).errors }).toEqual({ title, ops, lintErrors: 0 });
      version = Number(edit.version);
      applied++;
    }
  }
  expect(applied).toBeGreaterThan(5);
  expect(await call("lre_commit", { worldId, note: "The guide's examples", expectVersion: version })).toMatchObject({ worldId, warnings: { errors: 0 } });
});

test("a malformed routine or routine settings is refused, naming the field, through Build's editor and the outside tools alike; a good one saves", async () => {
  const { conn, ctx, call } = await tools();
  const worldId = String((await call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" })).worldId);
  const good = { id: "sam_rounds", label: "Sam's rounds", owner: "sam_reyes", blocks: [{ id: "coffee", label: "Coffee at the Bluebird", activity: "having coffee", kind: "flexible", window: { from: "07:00", to: "09:00" }, minutes: 30, place: { place: "bluebird_coffee" } }] };
  const refusal = async (send: () => Promise<unknown>): Promise<string> => {
    try {
      await send();
    } catch (error) {
      if (error instanceof LreError) return error.message;
      throw error;
    }
    throw new Error("the write was taken");
  };
  const draftNow = async () => conn.request("lre.editor", { op: "get", worldId, base: null });
  const before = await draftNow();

  // Build's put and set: each refusal names the field at fault, and nothing is written.
  const noWindow = { ...good, blocks: [{ ...good.blocks[0], window: { from: "7am", to: "09:00" } }] };
  expect(await refusal(() => conn.request("lre.editor", { op: "put", worldId, base: null, collection: "routines", id: "sam_rounds", value: noWindow }))).toContain("window");
  expect(await refusal(() => conn.request("lre.editor", { op: "put", worldId, base: null, collection: "routines", id: "sam_rounds", value: { ...good, blocks: [{ ...good.blocks[0], kind: "sometimes" }] } }))).toContain("kind");
  expect(await refusal(() => conn.request("lre.editor", { op: "put", worldId, base: null, collection: "routines", id: "sam_rounds", value: { ...good, blocks: "coffee" } }))).toContain("blocks");
  expect(await refusal(() => conn.request("lre.editor", { op: "set", worldId, base: null, part: "routineSettings", value: { awareness: "sometimes" } }))).toContain("awareness");
  expect(await refusal(() => conn.request("lre.editor", { op: "set", worldId, base: null, part: "routineSettings", value: { strictness: "high" } }))).toContain("strictness");
  // A patch that leaves either malformed is refused the same way.
  expect(await refusal(() => conn.request("lre.editor", { op: "patch", worldId, base: null, ops: [{ op: "add", path: "/routines", value: { sam_rounds: noWindow } }] }))).toContain("window");
  expect(await refusal(() => conn.request("lre.editor", { op: "patch", worldId, base: null, ops: [{ op: "add", path: "/routineSettings", value: { invitations: "always" } }] }))).toContain("invitations");
  const after = await draftNow();
  expect({ version: after.version, routines: after.draft.routines, settings: after.draft.routineSettings }).toEqual({ version: before.version, routines: before.draft.routines, settings: before.draft.routineSettings });

  // The outside tools get the same refusals, and still nothing is written.
  const tool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const result = await callTool(name, args, ctx);
    expect([name, result.isError]).toEqual([name, true]);
    return result.text;
  };
  expect(await tool("lre_routine_put", { worldId, id: "sam_rounds", value: noWindow })).toContain("window");
  expect(await tool("lre_routine_put", { worldId, id: "sam_rounds", value: { ...good, blocks: [{ ...good.blocks[0], minutes: 0 }] } })).toContain("minutes");
  expect(await tool("lre_edit", { worldId, ops: [{ op: "add", path: "/routines", value: { sam_rounds: { ...good, blocks: [{ ...good.blocks[0], priority: 9 }] } } }] })).toContain("priority");
  expect(await tool("lre_routine_settings", { worldId, value: { sociability: "loud" } })).toContain("sociability");
  expect((await draftNow()).version).toBe(before.version);

  // Good ones save, through either.
  const put = await conn.request("lre.editor", { op: "put", worldId, base: null, collection: "routines", id: "sam_rounds", value: good });
  expect(put.draft.routines?.sam_rounds as unknown).toEqual(good);
  expect(put.lint.filter((i) => i.severity === "error" && i.path.startsWith("routines."))).toEqual([]);
  await call("lre_routine_put", { worldId, id: "dale_mornings", value: { owner: "dale_whitcomb", blocks: [{ id: "boat", label: "Checks the boats", activity: "checking the boats", kind: "fixed", at: "06:30", minutes: 60, place: "work" }] } });
  expect(await call("lre_routine", { worldId, id: "dale_mornings" })).toMatchObject({ routine: { id: "dale_mornings", owner: "dale_whitcomb" } });
  await call("lre_routine_settings", { worldId, value: { awareness: "story_first", invitations: "off" } });
  expect(await call("lre_routine_settings", { worldId })).toMatchObject({ settings: { awareness: "story_first", invitations: "off", sociability: "usual", planBend: "standard" } });
  const set = await conn.request("lre.editor", { op: "set", worldId, base: null, part: "routineSettings", value: { sociability: "outgoing" } });
  expect(set.draft.routineSettings).toMatchObject({ sociability: "outgoing", awareness: "balanced" });
  // The defaults are no settings.
  await call("lre_routine_settings", { worldId, value: {} });
  expect((await draftNow()).draft.routineSettings).toBeUndefined();
});

test("needs settings are refused when the engine can't read them, store only what differs from the defaults, and Check world flags an alert below its told point", async () => {
  const { conn, call } = await tools();
  const worldId = String((await call("lre_world_create", { name: "Port Alder", template: "modern_slice_of_life" })).worldId);
  const refusal = async (send: () => Promise<unknown>): Promise<string> => {
    try {
      await send();
    } catch (error) {
      if (error instanceof LreError) return error.message;
      throw error;
    }
    throw new Error("the write was taken");
  };
  const before = await conn.request("lre.editor", { op: "get", worldId, base: null });
  expect(await refusal(() => conn.request("lre.editor", { op: "set", worldId, base: null, part: "needs", value: { thirst: { rate: 2 } } }))).toContain("thirst");
  expect(await refusal(() => conn.request("lre.editor", { op: "set", worldId, base: null, part: "needs", value: { hunger: { rate: -1 } } }))).toContain("hunger.rate");
  expect(await refusal(() => conn.request("lre.editor", { op: "patch", worldId, base: null, ops: [{ op: "add", path: "/needs", value: { fun: { on: "yes" } } }] }))).toContain("fun.on");
  expect((await conn.request("lre.editor", { op: "get", worldId, base: null })).version).toBe(before.version);
  // Every part at its default is no settings; only what differs is stored.
  const set = await conn.request("lre.editor", { op: "set", worldId, base: null, part: "needs", value: { hunger: { on: true, rate: 6, tell: 60, alert: 80 }, fatigue: { on: true, rate: 3, tell: 60, alert: 80 } } });
  expect(set.draft.needs).toEqual({ hunger: { rate: 6 } });
  const odd = await conn.request("lre.editor", { op: "set", worldId, base: null, part: "needs", value: { social: { tell: 70, alert: 40 } } });
  expect(odd.lint.some((i) => i.code === "castlife.needs" && i.path === "needs.social" && i.severity === "warning")).toBe(true);
  const cleared = await conn.request("lre.editor", { op: "set", worldId, base: null, part: "needs", value: {} });
  expect(cleared.draft.needs).toBeUndefined();
});
