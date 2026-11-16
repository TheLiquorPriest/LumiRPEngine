// The provider endpoint Lumiverse calls on RPE's connections (STANDALONE-PLAN §4.2, §4.4): `POST
// /v1/chat/completions` and `GET /v1/models`. Every connection in Lumiverse that is RPE's is answered,
// each under its own model name and with its own key (§15.2 l.1625, READINGS R-109): a request with
// the key of any of them is let in, the model list names every one's model, and each answer names the
// model its request named. A request with no tag (a title, a summary, a quiet call, another
// extension's) is passed on as it came, at every moment, to the model set for such requests, through
// RPH's model layer: RPE never calls a model itself, and adds, cuts and changes nothing in it (READINGS
// R-100); keeping an unplayed chat reply out is the extension's work. A tagged chat reply is read, its
// history window checked or made, its prompt laid out, and handed to the turn lane, which writes the
// reply to the response as the turn goes, streamed or whole as the request asked; a reply asked for
// whole is given the hold, so its turn ends before Lumiverse's ten minutes.

import type { Clock, PassError, PassRequest, PassSink, PromptRole, Usage as PassUsage } from "rp-harness/contract";
import { isRecord, type JsonObject } from "../../shared/json";
import type { HistoryWindow } from "./answer";
import type { HeardGenerations } from "./heard";
import { rawLayout, type BlocksHint } from "./layout";
import type { RawLayout } from "rp-harness/contract";
import { receive, Refused, type Cut, type ModelRooms, type PromptReads } from "./receipt";
import { streamedReply, wholeReply, type ReplyStream, type Usage } from "./stream";
import { readTag, TAG_FIELD, type Role, type Tag, type TagLore } from "./wire";

/** A tagged chat reply, ready for a turn (§10.1). */
export interface TaggedTurn {
  tag: Tag;
  /**
   * The prompt the model is to read, in order, after the history window's cut; content as Lumiverse sent it (text, or a list of parts with
   * pictures). `thinking`: what Lumiverse sent back as an earlier reply's thinking (`reasoning_content`), read apart and no part of its text.
   */
  prompt: { role: PromptRole; content: string | unknown[]; thinking?: string }[];
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
  /** The lore Lumiverse activated for the generation, as its `WORLD_INFO_ACTIVATED` said before the request came (none heard: none activated); one heard after is told to the turn lane as a change. */
  lore: TagLore[];
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
  /** Whether the request carries the key of a connection that is RPE's: RPE's own provider key, or one taken with a connection at the swap (R-109). */
  allowed(request: Request): boolean | Promise<boolean>;
  window: HistoryWindow;
  /** What the receipt reads of Lumiverse when the request arrives, by RPE's own reads (`receipt.ts`): the chat's rows the window counts when RPE makes the cut itself and that tell Lumiverse's own clipping, and the settings that say how Lumiverse joined the prompt. */
  reads: PromptReads;
  /** The Author's model's room for the chat's prompt (the turn lane, through RPH's model port): what the model's own window lets through (§4.2 l.237). */
  room: ModelRooms;
  /** Lumiverse's breakdown of the chat's prompt, a hint for names (`hint.ts`); null when it has none. */
  blocks(tag: Tag, signal: AbortSignal): Promise<BlocksHint | null>;
  /** RPH's model layer, for requests passed through: its pass, given the user this RPE belongs to. */
  models: OwnerPass;
  /** The connection a request with no tag is passed on to; null for RPH's default. */
  passConnection(): string | null;
  /** A passed request's failure in the shipped file's words (`guidance/.prompts/reply-errors.md`, key `pass-<code>`, `{{detail}}`), read at each failure; the key alone where the file has no line for it. */
  passWords(key: string, fields: { detail?: string }): Promise<string>;
  /** For a reply asked for whole: milliseconds after its arrival at which its turn is stopped with what it has, below Lumiverse's ten minutes (the door's settings). */
  holdMs(): number;
  /** The generations the event socket heard (`heard.ts`): a tagged request's activated lore, and whether one on RPE's connection awaits its tag. */
  heard: Pick<HeardGenerations, "tagged" | "untagged">;
  /** `lumiverse.untagged.whileAwaited`, read at each untagged request. */
  untaggedWhileAwaited(): "pass" | "fail";
  /** The model names `GET /v1/models` lists: every one RPE's connections in Lumiverse name, each answered under its own (R-109). */
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

/** The roles of Lumiverse's chat format (`llm/types.ts`): a tool's result stays a tool message, which RPH places itself. */
const ROLES: readonly string[] = ["system", "user", "assistant", "tool"];

/**
 * The hold of a reply asked for whole: 9 minutes. Nothing reaches Lumiverse while a whole reply is written, and Lumiverse ends a
 * generation that has had no text for ten minutes, checked each minute (`services/generation/active-generation-registry.ts:140-158`).
 */
export const WHOLE_HOLD_MS = 9 * 60_000;

/** RPH's tokens as an OpenAI-compatible usage. */
const usageOf = (u: PassUsage): Usage => ({ prompt_tokens: u.input, completion_tokens: u.output, total_tokens: u.input + u.output });

/** Why a passed request has no answer, in the shipped file's words: `pass-no-connection`, `pass-not-carried`, `pass-stopped`, `pass-provider`. */
function passWords(deps: ProviderDeps, e: PassError): Promise<string> {
  return deps.passWords(`pass-${e.code}`, e.detail ? { detail: e.detail } : {});
}

/** What the server gives the endpoint of a request: its body as parsed (on a worker when large), and the lift of its idle bound for an answer that sends nothing until it is done. */
export interface EndpointCall {
  json(): Promise<unknown>;
  untimed(): void;
}

/** `POST /v1/chat/completions` as a handler from a request to its response. A reply asked for whole sends nothing until it ends, so it lifts the server's idle bound; a streamed one keeps the request open by its comment lines. */
export function providerEndpoint(deps: ProviderDeps): (request: Request, call: EndpointCall) => Promise<Response> {
  return async (request, call) => {
    if (request.method !== "POST") return error(405, "Chat completions are asked for with POST.");
    if (!(await deps.allowed(request))) return error(401, "This connection's key is not RPE's.");
    let body: unknown;
    try {
      body = await call.json();
    } catch {
      return error(400, "The request is not JSON.");
    }
    if (!isRecord(body)) return error(400, "The request is not a chat completion.");
    if (body.stream !== true) call.untimed();
    const now = deps.clock.now();
    const read = readTag(body);
    if ("absent" in read) {
      // Counted against every generation that awaits its tag; failed only where the setting says so (N-18).
      const awaited = deps.heard.untagged();
      return awaited && deps.untaggedWhileAwaited() === "fail" ? failUntagged(deps, body as JsonObject, request.signal, now) : passThrough(deps, body as JsonObject, request.signal, now);
    }
    if ("invalid" in read) return error(400, `RPE could not read this reply's tag (${read.invalid}). Update the extension and RPE to the same build.`);
    let received;
    try {
      received = await receive(read.tag, body, { user: deps.user, window: deps.window, reads: deps.reads, room: deps.room }, request.signal);
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
      prompt: received.messages.map((m) => ({ role: ROLES.includes(m.role) ? (m.role as PromptRole) : "user", content: m.content, ...(m.thinking !== undefined ? { thinking: m.thinking } : {}) })),
      layout: rawLayout(received.tag, received.messages, received.cut.told, hint),
      cut: received.cut,
      model: typeof model === "string" ? model : null,
      ...(stream === true ? {} : { whole: true, hold: deps.holdMs() }),
      lore: await deps.heard.tagged(received.tag.chat, received.tag.generation),
      parameters: parameters as JsonObject,
    };
    const meta = { id: `rpe-${received.tag.generation}`, model: turn.model ?? "rpe", created: Math.floor(now / 1000) };
    const run = (out: ReplyStream, signal: AbortSignal): Promise<void> => deps.turns.play(turn, out, signal);
    if (turn.whole === true) return await wholeReply(run, meta, request.signal);
    return streamedReply(run, meta, request.signal, { clock: deps.clock, turn: true, ...(deps.commentMs !== undefined ? { commentMs: deps.commentMs() } : {}) });
  };
}

/**
 * A request with no tag while a reply RPE heard start awaits its tag, with `untagged.whileAwaited: fail`: answered with the shipped
 * file's line (`reply-errors.md`, key `untagged-awaited`), the outcome §4.2 l.258 gives such a generation; nothing is passed on.
 */
function failUntagged(deps: ProviderDeps, body: JsonObject, signal: AbortSignal, now: number): Promise<Response> | Response {
  const meta = { id: `rpe-pass-${now.toString(36)}`, model: typeof body.model === "string" ? body.model : "rpe", created: Math.floor(now / 1000) };
  const run = async (out: ReplyStream): Promise<void> => out.error(await deps.passWords("untagged-awaited", {}));
  return body.stream === true ? streamedReply(run, meta, signal, { clock: deps.clock, turn: false, ...(deps.commentMs !== undefined ? { commentMs: deps.commentMs() } : {}) }) : wholeReply(run, meta, signal);
}

/** A request with no tag, passed on untouched through RPH's model layer and answered in kind. */
function passThrough(deps: ProviderDeps, body: JsonObject, signal: AbortSignal, now: number): Promise<Response> | Response {
  const meta = { id: `rpe-pass-${now.toString(36)}`, model: typeof body.model === "string" ? body.model : "rpe", created: Math.floor(now / 1000) };
  const run = async (out: ReplyStream, stop: AbortSignal): Promise<void> => {
    let failed: PassError | null = null;
    await deps.models.pass(
      { connection: deps.passConnection(), body },
      {
        content: (delta) => out.content(delta),
        reasoning: (delta) => out.reasoning(delta),
        finish: (result) => {
          out.toolCalls((result.toolCalls ?? []).map((c) => ({ id: c.id, name: c.name, arguments: JSON.stringify(c.args) })));
          out.finish({ reason: result.finishReason, usage: usageOf(result.usage) });
        },
        error: (e) => {
          failed = e;
        },
      },
      stop,
    );
    // Its words are read from the shipped file before the reply ends.
    if (failed !== null) out.error(await passWords(deps, failed));
  };
  return body.stream === true ? streamedReply(run, meta, signal, { clock: deps.clock, turn: false, ...(deps.commentMs !== undefined ? { commentMs: deps.commentMs() } : {}) }) : wholeReply(run, meta, signal);
}

/** `GET /v1/models`: the model names of every connection that is RPE's, as an OpenAI-compatible list (Lumiverse reads `data[].id`, `openai-compatible.ts:324-334`). */
export function modelsEndpoint(deps: Pick<ProviderDeps, "allowed" | "modelNames">): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET") return error(405, "The model list is asked for with GET.");
    if (!(await deps.allowed(request))) return error(401, "This connection's key is not RPE's.");
    const data = deps.modelNames().map((id) => ({ id, object: "model", created: 0, owned_by: "rpe" }));
    return new Response(JSON.stringify({ object: "list", data }), { status: 200, headers: { "content-type": "application/json" } });
  };
}
