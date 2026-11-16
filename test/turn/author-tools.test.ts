// The Author's fixed list (plan §6.8, §17.3 "A fixed list and a search"): exactly the thirty by name, the same on every call of a session.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT, openTurnBed, type TurnBed, USER } from "./bed";

/** §6.8's table, by name. */
const THIRTY = [
  "prompt", "chat_read", "chat_search", "lore_read", "lore_search", "archive_search", "web_search", "gap_check", "delegate", "agent_message",
  "write_reply", "reply_release", "file_read", "file_find", "file_write", "skill_load", "job_start", "suggest", "todo", "tool_search",
  "tool_use", "world_query", "world_search", "world_apply", "roll", "story_query", "story_record", "cast_query", "cast_update", "perceive",
];

const beds: TurnBed[] = [];
afterEach(async () => {
  for (const b of beds.splice(0)) await b.close();
});

describe("the Author's tools", () => {
  test("the shipped Author carries exactly the thirty of §6.8 by name, and the same list when asked again", async () => {
    const b = await openTurnBed({ answers: [] });
    beds.push(b);
    const scope = { user: USER, chat: CHAT, session: "s-author" };
    const first = await b.turns.harness.definitions.declared(scope, "author");
    expect(first.tools.map((t) => t.name).sort()).toEqual([...THIRTY].sort());
    const again = await b.turns.harness.definitions.declared(scope, "author");
    expect(again.tools).toEqual(first.tools);
  });
});

describe("his own tools", () => {
  test("a command tool of his is held among the registry's tools as his own, outside the Author's fixed list, which stays the thirty", async () => {
    const b = await openTurnBed({ answers: [] });
    beds.push(b);
    const scope = { user: USER, chat: CHAT, session: "s-author" };
    const before = await b.turns.harness.definitions.declared(scope, "author");
    mkdirSync(join(b.app.paths.files, ".tools"), { recursive: true });
    writeFileSync(join(b.app.paths.files, ".tools", "dice_pool.json"), JSON.stringify({ family: "dice", description: "Rolls a pool of dice for a tabletop game", takes: { type: "object", properties: { sides: { type: "number" } } }, command: "dice --sides {{sides}}" }));
    const held = await b.turns.harness.definitions.tools(scope);
    expect(held.find((t) => t.name === "dice_pool")).toEqual({ name: "dice_pool", family: "dice", from: "owner" });
    const after = await b.turns.harness.definitions.declared(scope, "author");
    expect(after.tools.map((t) => t.name)).toEqual(before.tools.map((t) => t.name));
  });
});
