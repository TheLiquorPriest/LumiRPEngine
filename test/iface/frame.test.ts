// What every engine tool answers with where a call goes wrong or a rule of the world advises: near matches
// that are never short while anything of the kind exists, the engine's own refusal with its list, advice
// kept as a report, a fault told as one, an operation's lane named per call, and a scope that is gone or
// joined to another turn told as the fact. Every name here is invented.

import { expect, test } from "bun:test";
import type { JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import { faultAnswer, hostTool, IFACE_DEFAULTS, type ToolSpec } from "../../src/iface/kit";
import { Lines } from "../../src/iface/texts";
import { CHAT, dataOf, rig, texts, USER } from "./rig";

const SRC = { source: { from: "prose", message: "m-1" } } as const;

const ctxOf = (turn: string, job?: string): ToolCtx => ({
  scope: { user: USER, chat: CHAT, session: "s-1", turn },
  agent: { id: "gm-1", definition: "gm", parent: "author-1", ...(job !== undefined ? { job } : {}) },
  run: "run-1",
  callId: `call-${Math.random()}`,
  signal: new AbortController().signal,
  onUpdate: () => undefined,
});

test("a name like nothing still gets the nearest of its kind, further off with the distance raised, and a kind with nothing in it says so", async () => {
  const t = await rig();
  const far = await t.call("world_query", { at: "Zzzzzz" });
  expect(texts(far)[0]).toContain("Near: ");
  const none = await t.call("world_search", { words: "tam", kind: "group" });
  expect(none.error).toBeUndefined();
  const blank = await rig({}, "blank");
  const gone = await blank.call("world_apply", { operations: [{ op: "move", who: "Nobody", to: "Nowhere", ...SRC }] });
  expect(texts(gone).join("\n")).toContain("world_search finds what is recorded");
});

test("an add to a field that holds no number is recorded as given, the value unchanged, with advice said as a report and kept with the operation", async () => {
  const t = await rig();
  const r = await t.call("world_apply", { operations: [{ op: "set", at: "bram", key: "mood", add: 2, ...SRC }] });
  expect(r.error).toBeUndefined();
  expect((r.reports ?? []).some((x) => x.includes("holds no number"))).toBe(true);
  expect(t.s.stateAt(t.turn.id).state.world.entities.bram?.fields.mood).toBe("steady");
  expect((dataOf(r).operations as JsonObject[])[0]?.applied).toBe(true);
});

test("an operation that recorded nothing is not applied, and a fact names the lane the call gives", async () => {
  const t = await rig();
  const story = await t.call("world_apply", { operations: [{ op: "fact", about: "wren", key: "coin", value: "spent most of it", lane: "story", ...SRC }] });
  expect(story.error).toBeUndefined();
  expect((dataOf(story).operations as JsonObject[])[0]?.lane).toBe("story");
  expect(t.s.changes(t.turn.id).at(-1)?.lane).toBe("story");
  const bad = await t.call("world_apply", { operations: [{ op: "fact", about: "wren", key: "coin", value: "x", lane: "elsewhere", ...SRC }] });
  expect(bad.error).toBe(true);
  expect(texts(bad)[0]).toContain("It is one of: engine, story");
});

test("a throw in a tool is answered as a fault, logged, with the error in the details, never as the call refused", async () => {
  const t = await rig();
  const failed: unknown[] = [];
  t.deps.env.failed = (f) => void failed.push(f);
  const spec: ToolSpec = { name: "boom", family: "state", tier: "read", properties: {}, required: [], example: {}, run: async () => Promise.reject(new Error("the handler broke")) };
  const lines = Lines.parse(await Bun.file("guidance/.prompts/engine-answers.md").text(), "engine-answers");
  const tool = hostTool(spec, { description: "", arguments: {} }, { part: "engine-answers", lines, failed: t.deps.env.failed, call: (base) => ({ ...base, deps: t.deps, settings: IFACE_DEFAULTS, tree: undefined as never }) });
  const r = await tool.run({}, ctxOf(t.turn.id));
  expect(r.error).toBe(true);
  expect(texts(r)[0]).toContain("failed in the engine");
  expect(failed).toHaveLength(1);
  expect(faultAnswer(Lines.none(), "x", new Error("e"), undefined, "").error).toBe(true);
  expect(r.details).toMatchObject({ fault: { error: "the handler broke" } });
});

test("a turn whose staged changes were dropped, a job that has ended and a turn joined to another are told, and record nothing", async () => {
  const t = await rig();
  const before = t.s.changes(t.turn.id).length;
  const set = { operations: [{ op: "set", at: "bram", key: "mood", value: "sour", ...SRC }] };
  const run = async (ctx: ToolCtx): Promise<ToolResult> => t.tools.get("world_apply")?.run(set, ctx) as Promise<ToolResult>;

  await t.writes.run(() => t.s.endJob("job-old"));
  const ended = await run(ctxOf(t.turn.id, "job-old"));
  expect(ended.error).toBe(true);
  expect(texts(ended)[0]).toContain("which takes no more changes");
  expect(texts(ended)[0]).toContain("job-old");

  await t.writes.run(() => t.s.tieTurn(t.turn.id, { message: "m-1", hash: "h-1" }));
  const held = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "continue" }));
  await t.writes.run(() => t.s.joinTurn(held.id, t.turn.id));
  const joined = await run(ctxOf(held.id));
  expect(joined.error).toBe(true);
  expect(texts(joined)[0]).toContain(`was joined to turn ${t.turn.id}`);
  const viewed = await t.tools.get("world_query")?.run({ at: "bram" }, ctxOf(held.id));
  expect(texts(viewed as ToolResult)[0]).toContain("was joined to turn");

  const other = await t.writes.run(() => t.s.beginTurn({ chat: CHAT, kind: "new" }));
  await t.writes.run(() => t.s.dropTurn(other.id));
  const dropped = await run(ctxOf(other.id));
  expect(dropped.error).toBe(true);
  expect(texts(dropped)[0]).toContain(other.id);
  expect(t.s.changes(t.turn.id).length).toBe(before);
});
