// past_turn (DESIGN §4.6, `tools/past-turns.ts`): the main agent's look back at a past turn of its
// own, in full, from the segments its replies' records hold. A reply alone lists the turn's
// messages; with a message, reads it whole a page at a time; grep finds the lines holding some text,
// in any case, in that turn or, with no reply, in the latest 40 turns, newest first, at most 40
// lines shown. A reply that is no turn of its, or a message the turn doesn't have, is refused, saying
// what there is. Only the main agent's own messages are its turns.

import { describe, expect, test } from "bun:test";
import { MAIN_BY } from "../../src/backend/agents/compaction";
import type { ToolCtx } from "../../src/backend/agents/runtime";
import type { SessionMessage } from "../../src/backend/agents/sessions";
import { GREP_LINES, GREP_TURNS, type PastTurnsSource, pastTurnTool } from "../../src/backend/agents/tools/past-turns";
import type { JsonObject } from "../../src/shared/json";

const TASK = `Your turn task.\n${"The harbor at dusk. ".repeat(100)}\nDanny Okafor waits by the pier.`;

/** Turns on replies 2 and 4 (reply 3 a fixed pipeline's, none of the main agent's), each segment by its hash; `more` turns after them, each with two lines naming the pier. */
function source(more = 0): PastTurnsSource & { asked: string[][] } {
  const segments: Record<string, SessionMessage[]> = {
    s2: [
      { role: "user", content: "[The final review of reply 2: kept as a receipt]", whole: TASK, by: MAIN_BY },
      { role: "assistant", content: "I ran the scene role.", by: MAIN_BY },
    ],
    s3: [{ role: "user", content: "A fixed pipeline's digest.", by: "pipeline" }],
    s4: [
      { role: "user", content: "Stage 1: the PIER.", by: MAIN_BY },
      { role: "assistant", content: "Committed: Danny waits.", by: MAIN_BY },
    ],
  };
  const replies = [
    { reply: 2, segment: "s2" },
    { reply: 3, segment: "s3" },
    { reply: 4, segment: "s4" },
  ];
  for (let i = 0; i < more; i++) {
    segments[`m${i}`] = [{ role: "assistant", content: `pier ${i}\nthe pier again`, by: MAIN_BY }];
    replies.push({ reply: 5 + i, segment: `m${i}` });
  }
  const asked: string[][] = [];
  return {
    replies,
    asked,
    read: async (hashes) => {
      asked.push([...hashes]);
      return hashes.map((h) => segments[h] ?? null);
    },
  };
}

async function ask(args: JsonObject, from = source(), page = 1000): Promise<{ text: string; error?: boolean }> {
  return pastTurnTool({ texts: {}, page, source: () => from }).run(args, {} as ToolCtx);
}

describe("past_turn", () => {
  test("a reply alone lists the turn's messages: who said each, how long it is, whether the session keeps it as a receipt, and its first line", async () => {
    expect(await ask({ reply: 2 })).toEqual({
      text: `Reply 2: your turn's 2 messages, in full as they were sent and answered:\n1. the engine, ${TASK.length} characters, kept as a receipt: Your turn task.\n2. you, 21 characters: I ran the scene role.\nRead one whole with message, or search them with grep.`,
    });
  });

  test("a message is read whole, a page at a time from offset, each page saying where the next starts", async () => {
    const first = await ask({ reply: 2, message: 1 });
    expect(first.text).toStartWith(`Reply 2, message 1 (the engine), characters 0–1000 of ${TASK.length}:\n${TASK.slice(0, 1000)}`);
    expect(first.text).toEndWith("(It goes on: read on with offset 1000.)");
    const last = await ask({ reply: 2, message: "1", offset: 2000 });
    expect(last.text).toBe(`Reply 2, message 1 (the engine), characters 2000–${TASK.length} of ${TASK.length}:\n${TASK.slice(2000)}`);
    expect(last.text).toContain("Danny Okafor waits by the pier.");
  });

  test("grep finds the lines holding the text in any case: in one turn, or with no reply in the latest turns, newest first", async () => {
    expect(await ask({ reply: 4, grep: "pier" })).toEqual({ text: "1 line hold “pier” in reply 4:\n- reply 4, message 1, line 1: Stage 1: the PIER." });
    expect(await ask({ grep: "PIER" })).toEqual({ text: "2 lines hold “PIER” in your latest 2 turns:\n- reply 4, message 1, line 1: Stage 1: the PIER.\n- reply 2, message 1, line 3: Danny Okafor waits by the pier." });
    expect(await ask({ reply: 2, grep: "lighthouse" })).toEqual({ text: "No line in reply 2 holds “lighthouse”." });
  });

  test(`with no reply, grep reads only the latest ${GREP_TURNS} turns and shows at most ${GREP_LINES} lines`, async () => {
    const many = source(60);
    const found = await ask({ grep: "pier" }, many);
    const shown = found.text.split("\n").slice(1);
    expect(shown).toHaveLength(GREP_LINES);
    expect(found.text).toStartWith(`${GREP_TURNS * 2} lines hold “pier” in your latest ${GREP_TURNS} turns (the first ${GREP_LINES} shown):`);
    expect(shown[0]).toBe("- reply 64, message 1, line 1: pier 59");
    expect(many.asked.at(-1)).toHaveLength(GREP_TURNS);
  });

  test("a reply that is no turn of its, and a message the turn hasn't, are refused, saying what there is", async () => {
    expect(await ask({ reply: 3 })).toEqual({ text: "Reply 3 is no turn of yours on this chat. Your turns here are replies 2, 4.", error: true });
    expect(await ask({ reply: 9 })).toEqual({ text: "Reply 9 is no turn of yours on this chat. Your turns here are replies 2, 4.", error: true });
    expect(await ask({ reply: 4, message: 3 })).toEqual({ text: "Reply 4 has 2 messages: give message 1 to 2.", error: true });
    expect(await ask({})).toEqual({ text: "Reply (none given) is no turn of yours on this chat. Your turns here are replies 2, 4.", error: true });
  });
});
