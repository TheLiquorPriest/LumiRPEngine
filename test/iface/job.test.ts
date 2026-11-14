// A job's agent reads what its job recorded (plan §10.9): `world_query` and a later `world_apply` of the
// job read the turn's state with the job's own changes on top, while the turn's own agents, like every
// other reading, do not see them until the job ends. Every name is invented.

import { expect, test } from "bun:test";
import type { JsonObject, ToolCtx, ToolResult } from "rp-harness/contract";
import { CHAT, dataOf, rig, USER } from "./rig";

test("a job's agent reads back what its job recorded; the turn's own agent does not", async () => {
  const t = await rig();
  const as = async (job: string | null, name: string, args: JsonObject): Promise<ToolResult> => {
    const ctx: ToolCtx = {
      scope: { user: USER, chat: CHAT, session: "s-1", turn: t.turn.id },
      agent: { id: "steward-1", definition: "steward", ...(job !== null ? { job } : {}) },
      run: "run-1",
      callId: `call-${Math.random()}`,
      signal: new AbortController().signal,
      onUpdate: () => undefined,
    };
    return t.tools.get(name)!.run(args, ctx);
  };
  const set = (value: string): JsonObject => ({ operations: [{ op: "set", at: "bram", key: "mood", value, source: { from: "prose" } }] });

  expect((await as("job-ledger", "world_apply", set("sour"))).error).toBeUndefined();
  expect(JSON.stringify((await as("job-ledger", "world_query", { at: "bram" })).content)).toContain("sour");
  const query = JSON.stringify((await as(null, "world_query", { at: "bram" })).content);
  expect(query).toContain("steady");
  expect(query).not.toContain("sour");
  // The job's next change is worked out on what it recorded: the mood it changes is the sour one.
  const again = dataOf(await as("job-ledger", "world_apply", set("calm"))).changed as JsonObject[];
  expect(again.find((c) => c.at === "entity:bram")).toMatchObject({ was: { mood: "sour" }, now: { mood: "calm" } });
});
