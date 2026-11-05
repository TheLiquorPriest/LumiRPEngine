// past_turn (Build C; the owner's decision 2): the main agent's look back at a past turn of its own,
// in full. Its session keeps past turns as receipts (`receipts.ts`), and each turn's segment keeps
// its messages whole beside them (`MainMessage.whole`, or its `content` where it kept no receipt);
// this reads those, never anything the main agent wasn't sent: what it was sent and what it did, as
// it saw them, secrets marked. A turn is named by its reply's number in the chat, as the digest and
// the receipts name it; the replies are those on the chain before the turn that reads them, each
// record's segment its turn's. Without a reply, grep reads the latest turns, newest first.

import type { JsonObject } from "../../../shared/json";
import { MAIN_TEXT, MAIN_TOOLS } from "../../../shared/main-agent-prompts";
import type { PromptTexts } from "../../../shared/prompts";
import { renderPrompt } from "../../prompts";
import { isMainMessage, type MainMessage, wholeText } from "../compaction";
import type { AgentTool, ToolOutcome } from "../runtime";
import type { SessionMessage } from "../sessions";

/** Where a turn's past turns are: each reply on the chain before it whose record holds a segment, oldest first, and how to read segments. */
export interface PastTurnsSource {
  replies: readonly { reply: number; segment: string }[];
  read(hashes: readonly string[]): Promise<(SessionMessage[] | null)[]>;
}

/** How many of the latest turns a grep without a reply reads, and a listing of the turns there are names. */
export const GREP_TURNS = 40;
/** The most lines one grep answers with. */
export const GREP_LINES = 40;
/** A line found is shown at most this long, around what it found. */
const LINE_CHARS = 300;

/** A whole number as the arguments give it, or written as text; null for anything else. */
function wholeArg(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isSafeInteger(n) ? n : null;
}

/** A line around `at`, at most `LINE_CHARS` long. */
function around(line: string, at: number, length: number): string {
  if (line.length <= LINE_CHARS) return line;
  const from = Math.max(0, Math.min(at - Math.floor((LINE_CHARS - length) / 2), line.length - LINE_CHARS));
  return `${from > 0 ? "…" : ""}${line.slice(from, from + LINE_CHARS)}${from + LINE_CHARS < line.length ? "…" : ""}`;
}

/**
 * The past_turn tool: reads its turns from `source` as each call finds them; `page` is how much of a
 * message one call reads, within what a tool's answer reaches the model unclipped.
 */
export function pastTurnTool(input: { texts: PromptTexts; page: number; source: () => PastTurnsSource }): AgentTool {
  const { texts } = input;
  const text = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, texts, vars);
  const describe = (arg: string): string => text(MAIN_TEXT.toolArg(MAIN_TOOLS.pastTurn, arg));
  const refuse = (id: string, vars: Readonly<Record<string, string>>): ToolOutcome => ({ text: text(id, vars), error: true });
  /** The main agent's own messages of each reply, read together; a reply with none of its own is no turn of its. */
  const mine = async (source: PastTurnsSource, replies: readonly { reply: number; segment: string }[]): Promise<{ reply: number; messages: (SessionMessage & MainMessage)[] }[]> => {
    const read = await source.read(replies.map((r) => r.segment));
    return replies.flatMap((r, i) => {
      const messages = (read[i] ?? []).filter(isMainMessage);
      return messages.length > 0 ? [{ reply: r.reply, messages }] : [];
    });
  };
  const none = text(MAIN_TEXT.none);
  return {
    name: MAIN_TOOLS.pastTurn,
    description: text(MAIN_TEXT.tool(MAIN_TOOLS.pastTurn)),
    parameters: {
      type: "object",
      properties: { reply: { type: "integer", description: describe("reply") }, message: { type: "integer", description: describe("message") }, grep: { type: "string", description: describe("grep") }, offset: { type: "integer", description: describe("offset") } },
    },
    async run(args: JsonObject): Promise<ToolOutcome> {
      const source = input.source();
      const reply = wholeArg(args.reply);
      const grep = typeof args.grep === "string" ? args.grep.trim() : "";
      const latest = source.replies.slice(-GREP_TURNS);
      const named = reply === null ? null : source.replies.find((r) => r.reply === reply);
      const turns = await mine(source, named ? [named] : reply === null ? [...latest].reverse() : []);
      if (reply !== null && turns.length === 0) {
        const theirs = (await mine(source, latest)).map((t) => String(t.reply));
        return refuse(MAIN_TEXT.pastTurnNone, { reply: String(reply), replies: theirs.length > 0 ? theirs.join(", ") : none });
      }
      if (grep !== "") {
        const needle = grep.toLowerCase();
        const found: string[] = [];
        let count = 0;
        for (const turn of turns) {
          turn.messages.forEach((m, i) => {
            wholeText(m)
              .split("\n")
              .forEach((line, at) => {
                const hit = line.toLowerCase().indexOf(needle);
                if (hit < 0) return;
                count++;
                if (found.length < GREP_LINES) found.push(text(MAIN_TEXT.pastTurnMatch, { reply: String(turn.reply), n: String(i + 1), line: String(at + 1), text: around(line, hit, needle.length) }));
              });
          });
        }
        const where = reply !== null ? `reply ${reply}` : `your latest ${turns.length} ${turns.length === 1 ? "turn" : "turns"}`;
        if (count === 0) return { text: text(MAIN_TEXT.pastTurnNoMatch, { where, grep }) };
        return { text: text(MAIN_TEXT.pastTurnFound, { count: String(count), lines: count === 1 ? "line" : "lines", grep, where, more: count > found.length ? ` (the first ${found.length} shown)` : "", found: found.join("\n") }) };
      }
      if (reply === null) {
        const theirs = turns.map((t) => String(t.reply)).reverse();
        return refuse(MAIN_TEXT.pastTurnNone, { reply: "(none given)", replies: theirs.length > 0 ? theirs.join(", ") : none });
      }
      const turn = turns[0];
      if (!turn) return refuse(MAIN_TEXT.pastTurnNone, { reply: String(reply), replies: none });
      const n = wholeArg(args.message);
      const role = (m: { role: string }): string => (m.role === "user" ? "the engine" : "you");
      if (n === null) {
        const lines = turn.messages.map((m, i) => {
          const whole = wholeText(m);
          const first = (whole.split("\n").find((l) => l.trim() !== "") ?? "").trim();
          return text(MAIN_TEXT.pastTurnEntry, { n: String(i + 1), role: role(m), chars: String(whole.length), receipt: typeof m.whole === "string" ? ", kept as a receipt" : "", first: first.length > 160 ? `${first.slice(0, 160)}…` : first });
        });
        return { text: text(MAIN_TEXT.pastTurnList, { reply: String(reply), count: String(turn.messages.length), messages: lines.join("\n") }) };
      }
      const m = turn.messages[n - 1];
      if (!m || n < 1) return refuse(MAIN_TEXT.pastTurnNoMessage, { reply: String(reply), count: String(turn.messages.length) });
      const whole = wholeText(m);
      const from = Math.min(Math.max(0, wholeArg(args.offset) ?? 0), whole.length);
      const to = Math.min(whole.length, from + Math.max(1, input.page));
      const page = text(MAIN_TEXT.pastTurnRead, { reply: String(reply), n: String(n), role: role(m), from: String(from), to: String(to), chars: String(whole.length), text: whole.slice(from, to) });
      return { text: to < whole.length ? `${page}\n${text(MAIN_TEXT.pastTurnMore, { next: String(to) })}` : page };
    },
  };
}
