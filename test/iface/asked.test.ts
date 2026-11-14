// The player is asked once for a call under Confirm. A tool that writes and names its lane (a
// searchable write, a map write, a roll) is asked about by RPH, before it runs, by that lane, as the
// contract's `HostTool.lane` has it; `world_apply` names none and asks for each lane its operations
// write. Each call here runs as RPH runs a tool: its lane's setting first, then the tool. When the
// player holds back an operation a later one needs, the answer says which was held and why.

import { describe, expect, test } from "bun:test";
import type { ApprovalAnswer, ApprovalsPort, JsonObject, ToolResult } from "rp-harness/contract";
import { dataOf, type Rig, rig, texts, wordsFromFiles } from "./rig";

const SRC = { source: { from: "prose", message: "m-40" } };

/** Every lane at Confirm, the player answering `answer`, each question kept as `tool:lane`. */
function confirming(answer: ApprovalAnswer = { go: true }): ApprovalsPort & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    permission: async () => "confirm",
    ask: async (_scope, ask) => {
      asked.push(`${ask.tool}:${ask.lane}`);
      return answer;
    },
  };
}

/** A call as RPH runs it: a tool that writes and names its lane is asked about by that lane, and runs only on a yes; then the tool. */
async function gated(t: Rig, approvals: ApprovalsPort, name: string, args: JsonObject): Promise<ToolResult | null> {
  const tool = t.tools.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  const scope = { user: "user-a", chat: "chat-a", session: "s-1", turn: t.turn.id };
  if (tool.tier === "write" && tool.lane !== undefined && (await approvals.permission(scope, tool.lane)) === "confirm") {
    const said = await approvals.ask(scope, { agent: { id: "gm-1", definition: "gm" }, callId: "call-1", tool: name, lane: tool.lane, args, at: 0 }, new AbortController().signal);
    if (!said.go) return null;
  }
  return t.call(name, args);
}

describe("asked once", () => {
  test("under Confirm, a searchable write is asked about once, by its lane, and goes ahead on the player's yes", async () => {
    const approvals = confirming();
    const t = await rig({ approvals });
    const r = await gated(t, approvals, "item_condition", { item: "knife", delta: -10, ...SRC });
    expect(approvals.asked).toEqual(["item_condition:engine"]);
    expect((dataOf(r as ToolResult).operations as JsonObject[])[0]).toMatchObject({ op: "item_condition", applied: true });
    expect(t.s.changes(t.turn.id).length).toBeGreaterThan(0);
  });

  test("under Confirm, a map write is asked about once, by its lane", async () => {
    const approvals = confirming();
    const t = await rig({ approvals });
    const r = await gated(t, approvals, "map_lay", { place: "The Far Road", width: 12, height: 8, ...SRC });
    expect(approvals.asked).toEqual(["map_lay:engine"]);
    expect((dataOf(r as ToolResult).operations as JsonObject[])[0]?.applied).toBe(true);
  });

  test("a searchable write the player declines never runs, so nothing is recorded", async () => {
    const approvals = confirming({ go: false, reason: "not now" });
    const t = await rig({ approvals });
    expect(await gated(t, approvals, "item_condition", { item: "knife", delta: -10, ...SRC })).toBeNull();
    expect(approvals.asked).toEqual(["item_condition:engine"]);
    expect(t.s.changes(t.turn.id)).toEqual([]);
  });

  test("under Confirm, world_apply is asked about once for each lane its operations write", async () => {
    const approvals = confirming();
    const t = await rig({ approvals });
    const r = await gated(t, approvals, "world_apply", { operations: [{ op: "set", at: "bram", key: "mood", value: "calm", ...SRC }, { op: "relate", who: "bram", to: "wren", change: 5, ...SRC }, { op: "move", who: "odile", to: "common_room", ...SRC }] });
    expect(approvals.asked.sort()).toEqual(["world_apply:engine", "world_apply:story"]);
    expect((dataOf(r as ToolResult).operations as JsonObject[]).every((o) => o.applied === true)).toBe(true);
  });
});

describe("held back", () => {
  const CALL = { operations: [{ op: "spawn", name: "Ines Varga", kind: "character", at: "common_room", ...SRC }, { op: "relate", who: "Ines Varga", to: "bram", change: 5, ...SRC }] };

  test("an operation that needs one the player's setting holds back refuses the call, and the answer says which was held and why", async () => {
    const t = await rig({ approvals: { permission: async (_s, lane) => (lane === "engine" ? "never" : "auto"), ask: async () => ({ go: true }) } });
    const r = await t.call("world_apply", CALL);
    expect(r.error).toBe(true);
    const said = texts(r);
    expect(said.some((x) => x.includes("Operation 2 (relate)") && x.includes("Ines Varga"))).toBe(true);
    expect(said.some((x) => x.includes("Operation 1 (spawn) was not applied") && x.includes("where the player allows no writes"))).toBe(true);
    expect(said.some((x) => x.includes("needs what the player held back"))).toBe(true);
    // Neither sends the agent to make the thing earlier in the call nor to send the same call again: the player's setting would hold it again.
    expect(said.some((x) => x.includes("can be made earlier in this same call") || x.includes("Send the call again"))).toBe(false);
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });

  test("an operation that needs one the player declined refuses the call with the player's no and their reason", async () => {
    const t = await rig({ approvals: { permission: async () => "confirm", ask: async (_s, ask) => (ask.lane === "engine" ? { go: false, reason: "no strangers tonight" } : { go: true }) } });
    const r = await t.call("world_apply", CALL);
    expect(r.error).toBe(true);
    expect(texts(r).some((x) => x.includes("Operation 1 (spawn) was not applied: the player said no") && x.includes("no strangers tonight"))).toBe(true);
    expect(texts(r).some((x) => x.includes("needs what the player held back"))).toBe(true);
    expect(t.s.changes(t.turn.id)).toEqual([]);
    wordsFromFiles(r);
  });
});
