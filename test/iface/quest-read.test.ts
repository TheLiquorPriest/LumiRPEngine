// The Author's own read of a quest (`world_query` at it) in a turn after the quest was moved: the same stages, in the same order, as
// the page's record of it, each passed one with how it went and why, the present one marked, the ones to come with nothing; and a
// move's reason is the stage it leaves. Every name here is invented.

import { expect, test } from "bun:test";
import type { JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import type { WorldDoc } from "../../src/shared/world";
import { recordOf } from "../../src/quests/journal";
import { questSliceOf, questViews } from "../../src/quests/record";
import { trailsOf, withTrails } from "../../src/quests/trail";
import { hashOf } from "../store/fixtures";
import { CHAT, dataOf, rig, USER, world } from "./rig";

test("a quest moved over two turns reads, in the turn after, as the page reads it: passed stages with their reasons, the present one, those to come", async () => {
  const doc = world();
  const step = (to: string) => ({ label: to, next: [{ to, when: "false" }] });
  doc.tracks.fleet = { id: "fleet", kind: "quest", label: "The fleet contract", owner: "wren", start: "kickoff", visibility: "public", stages: { kickoff: step("trial"), trial: step("inspection"), inspection: step("done"), done: { label: "done", next: [] } } } as WorldDoc["tracks"][string];
  const t = await rig({}, doc);
  const call = (name: string, args: JsonObject, turn: string): Promise<ToolResult> => {
    const tool = t.tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    const ctx: ToolCtx = { scope: { user: USER, chat: CHAT, session: "s-1", turn }, agent: { id: "gm-1", definition: "gm", parent: "author-1" }, run: "run-1", callId: `call-${Math.random()}`, signal: new AbortController().signal, onUpdate: () => undefined };
    return tool.run(args, ctx);
  };
  const move = (to: string, why: string, turn: string) => call("world_apply", { operations: [{ op: "quest", quest: "The fleet contract", stage: to, outcome: "met", why, source: { from: "gm" } }] }, turn);
  await move("trial", "Jordan took the job", t.turn.id);
  await t.writes.run(() => t.s.tieTurn(t.turn.id, { message: "m-1", hash: hashOf("one"), date: 1 }));
  const second = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "new" }));
  await move("inspection", "the trial run held", second.id);
  await t.writes.run(() => t.s.tieTurn(second.id, { message: "m-2", hash: hashOf("two"), date: 2 }));
  const third = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "new" }));

  const read: unknown[][] = (dataOf(await call("world_query", { at: "The fleet contract" }, third.id)).stages as JsonObject[]).map((s) => [s.stage, s.state, s.why, s.current]);
  expect(read).toEqual([
    ["kickoff", "met", "Jordan took the job", false],
    ["trial", "met", "the trial run held", false],
    ["inspection", null, null, true],
    ["done", null, null, false],
  ]);
  // The page's record of it, at the chat's head.
  const head = t.s.headState(CHAT).state;
  const views = withTrails(questViews(doc.tracks, questSliceOf(head)), doc.tracks, trailsOf(t.s, t.deps.env, CHAT, null, doc.tracks, head.world.tracks));
  const fleet = views.find((v) => v.id === "fleet");
  if (fleet === undefined) throw new Error("no quest");
  const standing = Object.fromEntries(Object.entries(head.world.tracks).map(([id, s]) => [id, s.stage]));
  const page: unknown[][] = recordOf(fleet, standing, true).stages.map((s) => [s.id, s.state, s.why, s.current]);
  expect(page).toEqual(read);
});
