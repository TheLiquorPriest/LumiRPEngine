// The depth roles' model port (DEPTH-PLAN §5.1, §7): every model call a depth stage makes goes
// through one function the caller passes in, so the stages stay pure (they ask, and return events;
// they never land them) and a test answers them with recorded text. The real port routes each role
// to the connection, model and effort the user chose for it in Settings → Depth.

import { DEPTH_ROOM_MOST, type DepthRole } from "../../shared/depth-settings";
import type { SamplingParams } from "../../shared/settings";
import type { Misread } from "../../shared/misread";

/** One message of a model call, as the host's quiet generation takes it. */
export interface PortMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** What a call costs, as the provider reported it. */
export interface PortUsage {
  tokensIn: number;
  tokensOut: number;
  /** The part of `tokensOut` the model spent reasoning, where the provider reports it apart. */
  reasoningOut?: number;
  cost?: number;
}

export interface PortOptions {
  /** The answer must be one JSON object. */
  json?: boolean;
  /** A bound on the answer, in tokens. */
  maxTokens?: number;
  /** Sampling parameters for this call over the role's own: the narrator's, as the preset in the loopback's body set them (DEPTH-PLAN §3.13). */
  params?: SamplingParams;
  signal?: AbortSignal;
}

/** Which connection and model answered a call (DEPTH-PLAN §3.8, §9.0 provenance): the connection's id, or "" for the user's default; the model the host says answered, else the one asked for, else ""; the provider's own id for the request, where it gave one. */
export interface PortCall {
  connection: string;
  model: string;
  requestId?: string;
}

/** A model's answer: its text, its reasoning where the provider gave one, what it cost, why it ended, and which connection and model gave it. */
export interface PortAnswer {
  text: string;
  reasoning?: string;
  usage?: PortUsage;
  /** Why the answer ended, as the provider said: "stop", or "length" for one cut off at its answer room; absent where it said nothing. */
  finish?: string;
  call?: PortCall;
  /** The room asked for was over what the model takes, as the provider's refusal said, so the call was made again at that limit: what was asked, and the limit. */
  capped?: { asked: number; limit: number };
  /** The answer room the call was made at, in tokens, its reasoning's included: what the stage asked, else its role's own (Settings → Depth), held to a limit the provider stated. One cut off at it may be asked again with more (`roomAgain`). */
  room?: number;
  /**
   * Where the stage reading this answer says each field its parse didn't keep as written
   * (`Reading`, `depth/common.ts`): whoever made the call keeps the answer's text with those fields
   * (a bootstrap job's record, the turn inspector's call), and only then. Absent: nobody keeps them.
   */
  misread?: (fields: readonly Misread[]) => void;
}

export type ModelPort = (role: DepthRole, messages: PortMessage[], opts?: PortOptions) => Promise<PortAnswer>;

/** The usage of several calls, summed; a call without usage adds nothing. */
export function addUsage(a: PortUsage, b: PortUsage | undefined): PortUsage {
  if (!b) return a;
  const cost = a.cost === undefined && b.cost === undefined ? undefined : (a.cost ?? 0) + (b.cost ?? 0);
  const reasoningOut = a.reasoningOut === undefined && b.reasoningOut === undefined ? undefined : (a.reasoningOut ?? 0) + (b.reasoningOut ?? 0);
  return { tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut, ...(reasoningOut === undefined ? {} : { reasoningOut }), ...(cost === undefined ? {} : { cost }) };
}

export const NO_USAGE: PortUsage = { tokensIn: 0, tokensOut: 0 };

/** The room to ask an answer cut off at `room` again at: twice it, held to the most Settings → Depth lets a room be (`DEPTH_ROOM_MOST`); null where that is no more. */
export function roomAgain(room: number): number | null {
  const again = Math.min(2 * room, DEPTH_ROOM_MOST);
  return again > room ? again : null;
}

/** What a model may write past its answer that is never an answer of its own: tool-call markup (DeepSeek's `<｜tool▁calls▁begin｜>…<｜tool▁calls▁end｜>`, `<tool_call>…</tool_call>`) and bare tags (`</br>`). */
const MARKUP = /<[|｜]tool▁calls▁begin[|｜]>[\s\S]*?(?:<[|｜]tool▁calls▁end[|｜]>|$)|<tool_call>[\s\S]*?(?:<\/tool_call>|$)|<\/?[a-z]+\s*\/?>/giu;

/**
 * The JSON object an answer holds: the whole text, else the first `{` to the last `}` (a model that
 * wraps its answer in a fence or a sentence), else the first whole object from that `{` where nothing
 * follows it but closing braces or a fence (one that writes on past its object's end: DeepSeek's JSON
 * mode closed an author's setup with one `}` too many, LIVE3 lane 1b), or, where the object opens the
 * answer, tool-call markup and bare tags (`MARKUP`) besides; never an object prose comes before and
 * more than that after (an answer that echoes an object before its own isn't read as the echo: late
 * security review S6). With what it wrote past the object's end (`past`), trimmed, a closing fence
 * aside. Null when there is none.
 */
export function answerRead(text: string): { answer: Record<string, unknown>; past: string } | null {
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v: unknown = JSON.parse(s);
      return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const whole = tryParse(text.trim());
  if (whole) return { answer: whole, past: "" };
  const from = text.indexOf("{");
  const to = text.lastIndexOf("}");
  if (from < 0 || to <= from) return null;
  const wrapped = tryParse(text.slice(from, to + 1));
  const end = wrapped ? to : objectEnd(text, from);
  if (end === null) return null;
  const rest = text.slice(end + 1);
  const opens = /^\s*(?:`{3,}[a-z]*\s*)?$/i.test(text.slice(0, from));
  const answer = wrapped ?? (/^[\s}`]*$/.test(opens ? rest.replace(MARKUP, "") : rest) ? tryParse(text.slice(from, end + 1)) : null);
  if (!answer) return null;
  const past = rest.trim();
  return { answer, past: /^`{3,}$/.test(past) ? "" : past };
}

/** Where the JSON object opening at `from` closes: its braces counted outside its strings. Null when it never closes. */
function objectEnd(text: string, from: number): number | null {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return null;
}
