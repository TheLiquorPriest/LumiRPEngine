// The provider endpoint Lumiverse calls on RPE's connection (STANDALONE-PLAN §4.2, §4.4): `POST
// /v1/chat/completions` and `GET /v1/models`, behind RPE's provider key. A request with no tag (a title,
// a summary, a quiet call, another extension's) is passed on as it came to the model set for such
// requests, through RPH's model layer: RPE never calls a model itself. While RPE's extension does not
// hold RPE's registration none is passed on, since a chat reply then comes with no tag too. A tagged
// chat reply is read, its history window checked or made, its prompt laid out, and handed to the turn
// lane, which writes the reply to the response as the turn goes, streamed or whole as the request asked.

import type { Clock, PassError, PassRequest, PassSink, Usage as PassUsage } from "rp-harness/contract";
import { isRecord, type JsonObject } from "../../shared/json";
import type { HistoryWindow } from "./answer";
import { rawLayout, type BlocksHint } from "./layout";
import type { RawLayout } from "rp-harness/contract";
import { receive, Refused, type Cut, type PromptReads } from "./receipt";
import { streamedReply, wholeReply, type ReplyStream, type Usage } from "./stream";
import { readTag, TAG_FIELD, type Role, type Tag } from "./wire";

/** A tagged chat reply, ready for a turn (§10.1). */
export interface TaggedTurn {
  tag: Tag;
  /**
   * The prompt the model is to read, in order, after the history window's cut; content as Lumiverse sent it (text, or a list of parts with
   * pictures). `thinking`: what Lumiverse sent back as an earlier reply's thinking (`reasoning_content`), read apart and no part of its text.
   */
  prompt: { role: Role; content: string | unknown[]; thinking?: string }[];
  layout: RawLayout;
  cut: Cut;
  /** The model the request names: the connection's model in Lumiverse. */
  model: string | null;
  /** Asked for whole, not streamed (§4.2, READINGS N-1): answered as one whole completion, of which nothing reaches Lumiverse before its end. */
  whole?: boolean;
  /**
   * For a reply asked for whole: milliseconds from its arrival at which its turn is stopped where it stands, what it has going out,
   * since Lumiverse cuts a generation that sent nothing for ten minutes. Absent: no hold.
   */
  hold?: number;
  /** The request's other fields as Lumiverse sent them: sampling, anything a preset or extension added. */
  parameters: JsonObject;
}

/** What the turn lane (`src/turn/`) implements: one turn per tagged reply. */
export interface TurnPlayer {
  /**
   * Plays the turn, writing the reply to `out` as it is written: thinking, progress lines, the reply's
   * text, its end. `signal` aborts when Lumiverse stops listening (Stop, or the user left). Returning
   * without ending the reply ends it; a throw ends it with the error's words.
   */
  play(turn: TaggedTurn, out: ReplyStream, signal: AbortSignal): Promise<void>;
}

/** RPH's model layer's pass (`ModelsApi.pass`), given the user this RPE belongs to: the door names no user of its own. */
export interface OwnerPass {
  pass(request: PassRequest, sink: PassSink, signal: AbortSignal): Promise<void>;
}

export interface ProviderDeps {
  /** The Lumiverse user this RPE plays for. */
  user: string;
  /** Whether the request carries RPE's provider key. */
  allowed(request: Request): boolean | Promise<boolean>;
  window: HistoryWindow;
  /** What the receipt reads of Lumiverse when the request arrives, by RPE's own reads (`receipt.ts`): the chat's rows the window counts when RPE makes the cut itself and that tell Lumiverse's own clipping, and the settings that say how Lumiverse joined the prompt. */
  reads: PromptReads;
  /** Lumiverse's breakdown of the chat's prompt, a hint for names (`hint.ts`); null when it has none. */
  blocks(tag: Tag, signal: AbortSignal): Promise<BlocksHint | null>;
  /** RPH's model layer, for requests passed through: its pass, given the user this RPE belongs to. */
  models: OwnerPass;
  /** The connection a request with no tag is passed on to; null for RPH's default. */
  passConnection(): string | null;
  /**
   * Why no request with no tag may be passed on now, in words a user is shown; null when one may.
   * Not while RPE's extension in Lumiverse does not hold RPE's registration: it then cannot tell
   * RPE's connection, so a chat reply on it comes untagged, and another model would play it with its
   * secrets unchecked (§4.2, Permissions: no reply is passed through unplayed).
   */
  unpassable(): string | null;
  /** The model names `GET /v1/models` lists: those RPE's connection in Lumiverse may name. */
  modelNames(): string[];
  turns: TurnPlayer;
  clock: Pick<Clock, "now" | "setTimeout" | "clearTimeout">;
  /** How long a stream may send nothing at all before a comment line, read at each reply (the door's settings); `COMMENT_MS` when not given. */
  commentMs?: () => number;
  log?(message: string): void;
}

function error(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: { message, type: status === 401 ? "authentication_error" : "invalid_request_error" } }), { status, headers: { "content-type": "application/json" } });
}

const ROLES: readonly string[] = ["system", "user", "assistant"];

/** RPH's tokens as an OpenAI-compatible usage. */
const usageOf = (u: PassUsage): Usage => ({ prompt_tokens: u.input, completion_tokens: u.output, total_tokens: u.input + u.output });

/** Why a passed request has no answer, in words Lumiverse shows. */
function passWords(e: PassError): string {
  const detail = e.detail ? `: ${e.detail}` : "";
  switch (e.code) {
    case "no-connection":
      return `RPE has no connection to pass this request on to${detail}. Add one on RPE's Connections page.`;
    case "not-carried":
      return `RPE's connection for such requests cannot carry this request${detail}.`;
    case "stopped":
      return `The request was stopped${detail}.`;
    case "provider":
      return `The model's provider failed${detail}.`;
  }
}

/** `POST /v1/chat/completions` as a handler from a request to its response. */
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
    const now = deps.clock.now();
    const read = readTag(body);
    if ("absent" in read) {
      const why = deps.unpassable();
      return why === null ? passThrough(deps, body as JsonObject, request.signal, now) : error(503, `RPE answered nothing: it cannot tell a chat reply from other requests on its connection now. ${why}`);
    }
    if ("invalid" in read) return error(400, `RPE could not read this reply's tag (${read.invalid}). Update the extension and RPE to the same build.`);
    let received;
    try {
      received = await receive(read.tag, body, { user: deps.user, window: deps.window, reads: deps.reads }, request.signal);
    } catch (e) {
      // The window is the user's setting: a reply whose window RPE could not work out is not sent with more history than it allows.
      return e instanceof Refused ? error(e.status, e.message) : error(500, `RPE could not prepare this reply: ${e instanceof Error ? e.message : String(e)}`);
    }
    const hint = await deps.blocks(read.tag, request.signal).catch((e: unknown) => {
      // Only a hint for names: without it the layout names parts by their place.
      deps.log?.(`Lumiverse's breakdown of chat ${read.tag.chat} was not read: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    });
    const { messages: _messages, model, stream, [TAG_FIELD]: _tag, ...parameters } = body;
    const turn: TaggedTurn = {
      tag: received.tag,
      prompt: received.messages.map((m) => ({ role: ROLES.includes(m.role) ? (m.role as Role) : "user", content: m.content, ...(m.thinking !== undefined ? { thinking: m.thinking } : {}) })),
      layout: rawLayout(received.tag, received.messages, received.cut.told, hint),
      cut: received.cut,
      model: typeof model === "string" ? model : null,
      ...(stream === true ? {} : { whole: true }),
      parameters: parameters as JsonObject,
    };
    const meta = { id: `rpe-${received.tag.generation}`, model: turn.model ?? "rpe", created: Math.floor(now / 1000) };
    const run = (out: ReplyStream, signal: AbortSignal): Promise<void> => deps.turns.play(turn, out, signal);
    if (turn.whole === true) return await wholeReply(run, meta, request.signal);
    return streamedReply(run, meta, request.signal, { clock: deps.clock, turn: true, ...(deps.commentMs !== undefined ? { commentMs: deps.commentMs() } : {}) });
  };
}

/** A request with no tag, passed on untouched through RPH's model layer and answered in kind. */
function passThrough(deps: ProviderDeps, body: JsonObject, signal: AbortSignal, now: number): Promise<Response> | Response {
  const meta = { id: `rpe-pass-${now.toString(36)}`, model: typeof body.model === "string" ? body.model : "rpe", created: Math.floor(now / 1000) };
  const run = async (out: ReplyStream, stop: AbortSignal): Promise<void> => {
    await deps.models.pass(
      { connection: deps.passConnection(), body },
      {
        content: (delta) => out.content(delta),
        reasoning: (delta) => out.reasoning(delta),
        finish: (result) => {
          out.toolCalls((result.toolCalls ?? []).map((c) => ({ id: c.id, name: c.name, arguments: JSON.stringify(c.args) })));
          out.finish({ reason: result.finishReason, usage: usageOf(result.usage) });
        },
        error: (e) => out.error(passWords(e)),
      },
      stop,
    );
  };
  return body.stream === true ? streamedReply(run, meta, signal, { clock: deps.clock, turn: false, ...(deps.commentMs !== undefined ? { commentMs: deps.commentMs() } : {}) }) : wholeReply(run, meta, signal);
}

/** `GET /v1/models`: the names RPE's connection may name, as an OpenAI-compatible list (Lumiverse reads `data[].id`, `openai-compatible.ts:324-334`). */
export function modelsEndpoint(deps: Pick<ProviderDeps, "allowed" | "modelNames">): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET") return error(405, "The model list is asked for with GET.");
    if (!(await deps.allowed(request))) return error(401, "This connection's key is not RPE's.");
    const data = deps.modelNames().map((id) => ({ id, object: "model", created: 0, owned_by: "rpe" }));
    return new Response(JSON.stringify({ object: "list", data }), { status: 200, headers: { "content-type": "application/json" } });
  };
}
