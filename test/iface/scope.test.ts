// A call of no turn is recorded, never refused for that: a Talk's, and a job he started (a job's own reads see its own writes).
// A write whose job has ended is told, recording nothing. Every name is invented.

import { expect, test } from "bun:test";
import type { JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import { CHAT, dataOf, rig, USER } from "./rig";

test("a call of no turn is recorded as his own change, a roll of no turn is drawn from its call, and a job he started reads what it recorded", async () => {
  const t = await rig();
  const as = async (job: string | null, name: string, args: JsonObject, callId = `call-${Math.random()}`): Promise<ToolResult> => {
    const ctx: ToolCtx = { scope: { user: USER, chat: CHAT, session: "s-2" }, agent: { id: "talk-1", definition: "assistant", ...(job !== null ? { job } : {}) }, run: "run-2", callId, signal: new AbortController().signal, onUpdate: () => undefined };
    return t.tools.get(name)!.run(args, ctx);
  };
  const set = (value: string): JsonObject => ({ operations: [{ op: "set", at: "bram", key: "mood", value, source: { from: "prose" } }] });

  // A Talk's call: recorded as his own change of the chat, with who made it.
  const talk = await as(null, "world_apply", set("sour"));
  expect(talk.error).toBeUndefined();
  expect(JSON.stringify(talk.content)).not.toContain("turn_needed");
  const own = t.s.ownerChanges(CHAT);
  expect(own.length).toBe(1);
  expect(own[0]).toMatchObject({ by: "assistant", job: null });
  expect(JSON.stringify((await as(null, "world_query", { at: "bram" })).content)).toContain("sour");

  // A job he started: its writes are its own until it ends, and its next call works on them.
  expect((await as("job-1", "world_apply", set("calm"))).error).toBeUndefined();
  expect(JSON.stringify((await as("job-1", "world_query", { at: "bram" })).content)).toContain("calm");
  expect(JSON.stringify((await as(null, "world_query", { at: "bram" })).content)).not.toContain("calm");
  const again = dataOf(await as("job-1", "world_apply", set("glad"))).changed as JsonObject[];
  expect(again.find((c) => c.at === "entity:bram")).toMatchObject({ was: { mood: "calm" }, now: { mood: "glad" } });

  // A roll of no turn is drawn from its call: the same call gives the same dice.
  const roll = { who: "bram", for: "a test of nerve", dice: "2d6" };
  const a = dataOf(await as(null, "roll", roll, "call-fixed")).roll as JsonObject;
  const b = dataOf(await as(null, "roll", roll, "call-fixed")).roll as JsonObject;
  expect(a.dice).toEqual(b.dice);

  // His own write of a job that has ended is told, and records nothing.
  await t.writes.run(() => t.s.endJob("job-1"));
  const before = t.s.ownerChanges(CHAT).length;
  const late = await as("job-1", "world_apply", set("late"));
  expect(JSON.stringify(late.content)).toContain("job-1");
  expect(t.s.ownerChanges(CHAT).length).toBe(before);
});
