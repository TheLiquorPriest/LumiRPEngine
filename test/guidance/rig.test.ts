// What the shipped definitions do in a turn, played through the composed application on the stand-in
// Lumiverse and the scripted model: the Author starts on the effort its definition names; the indexer,
// which holds tools, is given the consent rule in its first request; a GM's search finds no tool of the
// reply family or of the agents family; and `write_reply` hands the prose to the writer the Author's
// definition names. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { TraceRecord } from "rp-harness/contract";
import type { RecordedRequest } from "rp-harness/testing/rig";
import type { TurnDetail } from "../../src/ui/api";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed } from "../turn/bed";

let bed: TurnBed | null = null;
afterEach(async () => {
  await bed?.close();
  bed = null;
});

/** Every text a request holds, its messages' in order, from the message `from` counted as `slice` counts. */
function textsOf(r: RecordedRequest | undefined, from = 0): string {
  return (r?.messages.slice(from) ?? []).flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])))).join("\n");
}

/** The player says something and asks for a reply; gives the turn's id once it is settled. */
async function play(b: TurnBed, said: string): Promise<string> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  return (await settledTurn(b, out.generationId!)).id;
}

/** What each agent of a turn was started with, by its definition: the records of `agent_started`. */
async function started(b: TurnBed, turn: string): Promise<Record<string, { effort?: string; model: string }>> {
  const detail = await b.page<TurnDetail>("GET", `/api/v1/chats/${CHAT}/turns/${turn}`);
  const out: Record<string, { effort?: string; model: string }> = {};
  for (const record of detail.body.trace as TraceRecord[]) if (record.event.kind === "agent_started") out[record.event.definition] = { model: record.event.model, ...(record.event.effort !== undefined ? { effort: record.event.effort } : {}) };
  return out;
}

test("the Author starts on the effort its definition names", async () => {
  const b = (bed = await openTurnBed({ answers: [replying("Wren looks up.")] }));
  const turn = await play(b, "I wave.");
  expect((await started(b, turn)).author).toMatchObject({ effort: "high" });
});

test("the indexer, which holds tools, is given the consent rule and the file for every agent in its first request", async () => {
  const b = (bed = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>Have the lore indexed.</intent>" }, { call: "delegate", args: { agent: "indexer", brief: "Index the batch you are given." } }] },
      { pieces: [{ text: "Nothing to index." }] },
      replying("Wren looks up."),
    ],
  }));
  await play(b, "I wave.");
  const indexer = textsOf(b.model.requests[1]);
  expect(indexer).toContain("NO AGENT SHOULD EVER IMPROVISE WITHOUT CONSENT OF THE AUTHOR");
  expect(indexer).toContain("## Say where things come from");
});

test("a GM's search finds no tool of the reply family or of the agents family", async () => {
  const b = (bed = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>Ask the GM what a search finds.</intent>" }, { call: "delegate", args: { agent: "gm", brief: "Search for tools." } }] },
      { pieces: [{ call: "tool_search", args: { words: "delegate agent_message agent_drop write_reply reply_release sub-agent reply" } }] },
      { pieces: [{ text: "Searched." }] },
      replying("Wren looks up."),
    ],
  }));
  await play(b, "I wave.");
  // Each tool a search finds is a line that begins with its name and its family.
  const found = [...textsOf(b.model.requests[2], -1).matchAll(/^(\w+) \(/gm)].map((m) => m[1]);
  expect(found.length).toBeGreaterThan(0);
  for (const name of ["delegate", "agent_message", "agent_drop", "write_reply", "reply_release"]) expect(found).not.toContain(name);
});

test("`write_reply` hands the prose to the writer the Author's definition names", async () => {
  const b = (bed = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>The narrator writes this one.</intent>" }, { call: "write_reply", args: { brief: "Wren looks up from the lamp.", live: true } }] },
      { pieces: [{ text: "Wren looks up from the lamp." }] },
      { pieces: [{ text: "Done." }] },
    ],
  }));
  const turn = await play(b, "I wave.");
  expect(Object.keys(await started(b, turn))).toEqual(["author", "narrator"]);
  const narrator = b.model.requests[1];
  expect(textsOf(narrator)).toContain("Wren looks up from the lamp.");
  expect(narrator?.messages.at(-1)).toMatchObject({ role: "user" });
});

test("the reply contract is in the Author's opening block once: the briefing holds no copy of it, and still names the turn's folder", async () => {
  const b = (bed = await openTurnBed({ answers: [replying("Wren looks up.")] }));
  await play(b, "I wave.");
  const first = textsOf(b.model.requests[0]);
  expect(first.split("# The reply contract").length - 1).toBe(1);
  expect(first).not.toContain("How what you write now is marked");
  expect(first).toContain("# Briefing for this turn");
  expect(first).toContain("The same material is on disk for agents you delegate to:");
});
