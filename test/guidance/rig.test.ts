// What the shipped definitions do in a turn, played through the composed application on the stand-in
// Lumiverse and the scripted model: the Author's call carries the effort its definition names; the
// indexer, which holds tools, is given the consent rule in its first request; and a GM's search finds no
// tool of the reply family or the agents family. Every name is invented.

import { afterEach, expect, test } from "bun:test";
import type { RecordedRequest } from "rp-harness/testing/rig";
import { CHAT, CONNECTION, openTurnBed, PRESET, replying, settledTurn, type TurnBed } from "../turn/bed";

let bed: TurnBed | null = null;
afterEach(async () => {
  await bed?.close();
  bed = null;
});

/** Every text a request holds, its messages' in order. */
function textsOf(r: RecordedRequest | undefined, from = 0): string {
  return (r?.messages.slice(from) ?? []).flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])))).join("\n");
}

async function play(b: TurnBed, said: string): Promise<void> {
  b.host.send(CHAT, said);
  const out = await b.host.generate({ chat: CHAT, connection: CONNECTION, preset: PRESET });
  expect(out.error).toBeNull();
  await settledTurn(b, out.generationId!);
}

test("the Author's call carries the effort its definition names", async () => {
  const b = (bed = await openTurnBed({ answers: [replying("Wren looks up.")] }));
  await play(b, "I wave.");
  expect(b.model.requests[0]?.options.reasoning).toBe("high");
});

test("the indexer, which holds tools, is given the consent rule in its first request", async () => {
  const b = (bed = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>Have the lore indexed.</intent>" }, { call: "delegate", args: { agent: "indexer", brief: "Index the batch you are given." } }] },
      { pieces: [{ text: "Nothing to index." }] },
      replying("Wren looks up."),
    ],
  }));
  await play(b, "I wave.");
  const indexer = b.model.requests[1];
  expect(textsOf(indexer)).toContain("NO AGENT SHOULD EVER IMPROVISE WITHOUT CONSENT OF THE AUTHOR");
  expect(textsOf(indexer)).toContain("Where a recorded thing comes from");
});

test("a GM's search finds no tool of the reply family or of the agents family", async () => {
  const b = (bed = await openTurnBed({
    answers: [
      { pieces: [{ text: "<intent>Ask the GM what a search finds.</intent>" }, { call: "delegate", args: { agent: "gm", brief: "Search for tools." } }] },
      { pieces: [{ call: "tool_search", args: { words: "delegate agent_message write_reply reply_release sub-agent reply" } }] },
      { pieces: [{ text: "Searched." }] },
      replying("Wren looks up."),
    ],
  }));
  await play(b, "I wave.");
  const found = textsOf(b.model.requests[2], -1);
  for (const name of ["delegate", "agent_message", "write_reply", "reply_release"]) expect(found).not.toContain(name);
});
