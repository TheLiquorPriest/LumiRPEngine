// The provider endpoint Lumiverse calls on RPE's connection (`/v1/chat/completions`, STANDALONE-PLAN
// §4.2, §4.4): a request in, a reply out in the form Lumiverse reads from an OpenAI-compatible
// connection. A request with no tag (a title, a summary, a quiet call, another extension's) is passed
// on as it came. A tagged chat reply is read, its history window checked or made, its prompt laid out,
// and played; the reply is written to the response as the turn writes it.

import { isRecord, type JsonObject } from "../../shared/json";
import type { HistoryWindow } from "./answer";
import { rawLayout, type BlocksHint, type RawLayout } from "./layout";
import { receive, Refused, type Cut } from "./receipt";
import { streamedReply, wholeReply, type ReplyStream } from "./stream";
import { readTag, TAG_FIELD, type Role, type Tag } from "./wire";

/** A tagged chat reply, ready for a turn (§10.1). */
export interface TaggedTurn {
  tag: Tag;
  /** The prompt the model is to read, in order, after the history window's cut; content as Lumiverse sent it (text, or a list of parts with pictures). */
  prompt: { role: Role; content: string | unknown[] }[];
  layout: RawLayout;
  cut: Cut;
  /** The request's other fields as Lumiverse sent them: the model's name, sampling, anything a preset or extension added. */
  model: string | null;
  stream: boolean;
  parameters: JsonObject;
}

export interface ProviderDeps {
  /** The Lumiverse user this RPE plays for. */
  user: string;
  /** Whether the request carries RPE's provider key. */
  allowed(request: Request): boolean | Promise<boolean>;
  window: HistoryWindow;
  /** Lumiverse's breakdown of the chat's last prompt, a hint for names; null when it has none. */
  blocks(user: string, chat: string, signal: AbortSignal): Promise<BlocksHint | null>;
  /** A request with no tag, passed on to the model set for such requests. */
  passThrough(body: JsonObject, signal: AbortSignal): Promise<Response>;
  /** A tagged reply played: the reply written to `out`. */
  play(turn: TaggedTurn, out: ReplyStream, signal: AbortSignal): Promise<void>;
  now(): number;
  log?(message: string): void;
}

function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, type: status === 401 ? "authentication_error" : "invalid_request_error" } }), { status, headers: { "content-type": "application/json" } });
}

const ROLES: readonly string[] = ["system", "user", "assistant"];

/** The endpoint as a handler from a request to its response. */
export function providerEndpoint(deps: ProviderDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "POST") return error(405, "Chat completions are asked for with POST.");
    if (!(await deps.allowed(request))) return error(401, "This connection's key is not RPE's.");
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error(400, "The request is not JSON.");
    }
    if (!isRecord(body)) return error(400, "The request is not a chat completion.");
    const read = readTag(body);
    if ("absent" in read) return await deps.passThrough(body as JsonObject, request.signal);
    if ("invalid" in read) return error(400, `RPE could not read this reply's tag (${read.invalid}). Update the extension and RPE to the same build.`);
    let received;
    try {
      received = await receive(read.tag, body, { user: deps.user, window: deps.window }, request.signal);
    } catch (e) {
      // The window is the user's setting: a reply whose window RPE could not work out is not sent with more history than it allows.
      return e instanceof Refused ? error(e.status, e.message) : error(500, `RPE could not prepare this reply: ${e instanceof Error ? e.message : String(e)}`);
    }
    const hint = await deps.blocks(read.tag.user, read.tag.chat, request.signal).catch((e: unknown) => {
      // Only a hint for names: without it the layout names parts by their place.
      deps.log?.(`Lumiverse's breakdown of chat ${read.tag.chat} was not read: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    const { messages: _messages, model, stream, [TAG_FIELD]: _tag, ...parameters } = body;
    const turn: TaggedTurn = {
      tag: received.tag,
      prompt: received.messages.map((m) => ({ role: ROLES.includes(m.role) ? (m.role as Role) : "user", content: m.content })),
      layout: rawLayout(received.tag, received.messages, received.overlay.complete, hint),
      cut: received.cut,
      model: typeof model === "string" ? model : null,
      stream: stream === true,
      parameters: parameters as JsonObject,
    };
    const meta = { id: `rpe-${received.tag.generation}`, model: turn.model ?? "rpe", created: Math.floor(deps.now() / 1000) };
    const run = (out: ReplyStream, signal: AbortSignal) => deps.play(turn, out, signal);
    return turn.stream ? streamedReply(run, meta, request.signal) : await wholeReply(run, meta, request.signal);
  };
}
