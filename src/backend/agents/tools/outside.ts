// The tools LumiRPEngine serves outside clients (DESIGN §23; INC3-SPEC D4, as INC3-REEVAL §2.3 amends
// it), asked by a session that said hello as one (`lre.tools`): the chat and lore tools an MCP server
// ran in the client before (`outside-play.ts`, `outside-lore.ts`), the agent tool families at the GM
// tier, and `lre_tool_describe`. `list` answers each with a world-agnostic schema (no world's kinds,
// places or actions), its description in the user's words (the registry texts, group "MCP tools")
// and its MCP annotations; `describe` fills a chat's world into one tool's schema, as LRE's own agents
// are given it; `call` runs one as the caller's session.
//
// A chat or lore tool keeps its own arguments, checks and answers, its spoilers gate among them, now
// enforced here. An agent tool needs `chatId` and `spoilers: true` (it reads the chat as the GM does,
// unmarked), its arguments are checked against the chat's schema at call time, and a write applies at
// once as the GM's own edit with its Undo chip, the client named on it (`clientWriter`). A write is
// refused to a read-only client before anything runs, a caller's writes to one chat or world run one
// after another, and every answer is kept within ANSWER_LIMIT, as the command line's are.

import { blankWorld } from "../../../engine/authoring";
import { toolTextId } from "../../../shared/agent-tools";
import { gate } from "../../../shared/chat-reads";
import { pathSafe } from "../../../shared/ids";
import type { ChatId, UserId } from "../../../shared/ids";
import { isRecord, type JsonObject } from "../../../shared/json";
import { KeyedQueue } from "../../../shared/keyed-queue";
import { OUTSIDE_TEXT, OUTSIDE_TEXT_VARS } from "../../../shared/outside-tool-texts";
import { annotationsOf, DESCRIBE_TOOL, type OutsideTool, readOnlyRefusal, type WriteHints } from "../../../shared/outside-tools";
import type { PromptTexts } from "../../../shared/prompts";
import type { RequestFields, RequestType, ResultBodies } from "../../../shared/protocol";
import { checkSchema, pathText, type Schema } from "../../../shared/schema-check";
import { type Args, neededText, onlyArgs, ToolError } from "../../../shared/tool-args";
import { failedText, json, refusedText, type ToolResult } from "../../../shared/tool-answer";
import { ANSWER_LIMIT, clip } from "../../../shared/tool-read";
import type { WorldDoc } from "../../../shared/world";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { OUTSIDE_LORE_TOOLS } from "./outside-lore";
import { OUTSIDE_PLAY_TOOLS } from "./outside-play";
import { type OutsideContext, type OutsideToolDef, Refusal } from "./outside-tool";
import { outsideReader } from "./read-view";
import { described, TOOL_DEFINITIONS, type ToolDefinition, type ToolEnv } from "./registry";
import { objectSchema, schemaWorld } from "./schema";
import { clientWriter, GM_ROLE } from "./writer";

/** Who calls: the user, the session that said hello as an outside client, the client in words ("lumirpengine (claude-code)"), and its requests, answered in process as that session's. */
export interface OutsideCaller {
  userId: UserId;
  session: string;
  client: string;
  request<T extends RequestType>(type: T, fields: RequestFields<T>): Promise<ResultBodies[T]>;
}

/** The chat and lore tools, by name. */
const OWN: ReadonlyMap<string, OutsideToolDef> = new Map([...OUTSIDE_PLAY_TOOLS, ...OUTSIDE_LORE_TOOLS].map((t) => [t.name, t]));

/** The agent tools an outside client is given: every family's, but none that works a turn, condenses a source or notes facts for a reply's read. */
const FAMILIES: ReadonlyMap<string, ToolDefinition> = new Map(TOOL_DEFINITIONS.filter((d) => d.turn !== true && d.summarizes !== true && d.notes !== true).map((d) => [d.name, d]));

/** How an agent write tool changes a chat: what is there may be overwritten, and a second call writes again. */
const FAMILY_WRITE: WriteHints = { destructive: true, idempotent: false };

const writes = (def: ToolDefinition): false | WriteHints => (def.tier === "read" ? false : FAMILY_WRITE);

/** The world the listed schemas are written for: none of a world's kinds, places or actions, so the list names none. */
const LISTED: WorldDoc = { ...blankWorld("w_listed", ""), kinds: {}, places: {}, actions: {} };

const DESCRIBE_SCHEMA: JsonObject = objectSchema({ name: { type: "string", description: "The tool's name, as this list gives it." }, chatId: { type: "string", description: "The chat whose world fills its schema (lre_chats lists the chats that play a world)." } }, ["name", "chatId"]);

const SHOWS = "reads the chat as the GM does, secrets, hidden people and places and characters' minds included";

/** A family tool's schema as an outside client calls it: its own arguments, then the chat and `spoilers`, both required. */
function outsideSchema(schema: JsonObject, texts: PromptTexts): JsonObject {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  return { ...schema, properties: { ...properties, chatId: { type: "string", description: renderPrompt(OUTSIDE_TEXT.chatId, texts, {}) }, spoilers: { type: "boolean", description: renderPrompt(OUTSIDE_TEXT.spoilers, texts, {}) } }, required: [...required, "chatId", "spoilers"] };
}

function familyTool(def: ToolDefinition, world: WorldDoc, texts: PromptTexts): OutsideTool {
  const write = writes(def);
  const description = renderPrompt(toolTextId(def.name), texts, {});
  return { name: def.name, description: write === false ? description : `${description}\n\n${renderPrompt(OUTSIDE_TEXT.writes, texts, {})}`, inputSchema: outsideSchema(described(def, def.parameters(world), texts), texts), annotations: annotationsOf(write) };
}

function ownTool(def: OutsideToolDef, texts: PromptTexts): OutsideTool {
  const id = toolTextId(def.name);
  return { name: def.name, description: renderPrompt(id, texts, OUTSIDE_TEXT_VARS[id] ?? {}), inputSchema: def.inputSchema, annotations: annotationsOf(def.write), ...(def.cli !== undefined ? { cli: def.cli } : {}) };
}

function describeTool(texts: PromptTexts): OutsideTool {
  return { name: DESCRIBE_TOOL, description: renderPrompt(toolTextId(DESCRIBE_TOOL), texts, {}), inputSchema: DESCRIBE_SCHEMA, annotations: annotationsOf(false) };
}

/** The ids of every text the list reads: a change to one changes what an outside client is told. */
export function listsText(id: string): boolean {
  return id.startsWith("tool.") || id.startsWith("mcp.");
}

/** A call's answer within ANSWER_LIMIT, as the command line's backstop keeps one. */
function bounded(result: ToolResult): ToolResult {
  return result.text.length > ANSWER_LIMIT ? { ...result, text: `${clip(result.text, ANSWER_LIMIT - 200)}\n(Cut to fit one answer: narrow the request with pointer, offset or limit.)` } : result;
}

/** What a failed call answers: the refusal's own words, with the lint behind a refused write. */
function failure(error: unknown): ToolResult {
  if (error instanceof ToolError) return { text: error.message, isError: true };
  if (error instanceof Refusal) return { text: refusedText(error.code, error.message, error.lint), isError: true };
  return { text: failedText(error), isError: true };
}

/** Every tool LumiRPEngine serves outside clients, as `lre.tools list` answers it, in the user's words (`texts`). */
export function servedTools(texts: PromptTexts): OutsideTool[] {
  return [...OUTSIDE_PLAY_TOOLS.map((t) => ownTool(t, texts)), ...OUTSIDE_LORE_TOOLS.map((t) => ownTool(t, texts)), describeTool(texts), ...[...FAMILIES.values()].map((d) => familyTool(d, LISTED, texts))];
}

/** The names of the tools served, whatever their texts: the part of an MCP client's list the agent kit's fingerprints leave out (`holdsBuild`). */
export const SERVED_NAMES: ReadonlySet<string> = new Set([...OWN.keys(), DESCRIBE_TOOL, ...FAMILIES.keys()]);

export class OutsideTools {
  /** Each caller's writes to one chat or world, one after another. */
  private readonly queue = new KeyedQueue();

  constructor(private readonly rt: Runtime) {}

  /** One tool with `chatId`'s world filled into its schema (an agent tool's kinds, fields, places and actions); a chat or lore tool's names no world, so it is as listed. */
  async describe(userId: UserId, name: string, chatId: string): Promise<OutsideTool> {
    const texts = (await this.rt.settings.get(userId)).prompts.texts;
    const own = OWN.get(name);
    if (own !== undefined) return ownTool(own, texts);
    if (name === DESCRIBE_TOOL) return describeTool(texts);
    const def = FAMILIES.get(name);
    if (def === undefined) throw new Refusal("bad_request", `There is no tool ${name}.`);
    return familyTool(def, await this.worldOf(userId, chatId), texts);
  }

  /**
   * Runs one tool for `caller`. A refusal or a failure is an error result; only a name no tool has is
   * refused (`not_found`), so a client answers it as no tool of its list. A write is refused to a
   * read-only client before anything is read or sent.
   */
  async call(caller: OutsideCaller, name: string, rawArgs: unknown, readOnly: boolean): Promise<ToolResult> {
    const own = OWN.get(name);
    const def = own === undefined ? FAMILIES.get(name) : undefined;
    if (own === undefined && def === undefined && name !== DESCRIBE_TOOL) throw new Refusal("not_found", `There is no tool ${name}.`);
    if (readOnly && ((own !== undefined && own.write !== false) || (def !== undefined && writes(def) !== false))) return { text: readOnlyRefusal(name), isError: true };
    if (rawArgs !== undefined && rawArgs !== null && !isRecord(rawArgs)) return { text: "The arguments must be an object.", isError: true };
    const args: Args = isRecord(rawArgs) ? rawArgs : {};
    try {
      if (own !== undefined) {
        onlyArgs(args, own.inputSchema);
        // The caller's requests, and its writes to one chat or world one after another.
        const ctx: OutsideContext = { request: (type, fields) => caller.request(type, fields), serialize: (key, work) => this.queue.run(`${caller.userId}\u0000${caller.session}\u0000${key}`, work) };
        return bounded(await own.run(args, ctx));
      }
      if (def !== undefined) return bounded(await this.family(caller, def, args));
      onlyArgs(args, DESCRIBE_SCHEMA);
      const tool = await this.describe(caller.userId, neededText(args, "name", "the tool's name, as the list gives it"), neededText(args, "chatId", "the chat's id (lre_chats lists the chats that play a world)"));
      return bounded({ text: json(tool) });
    } catch (error) {
      return failure(error);
    }
  }

  /** An agent tool: behind `spoilers`, its arguments checked against its chat's schema, read as the GM does and written as the GM's own edit. */
  private async family(caller: OutsideCaller, def: ToolDefinition, args: Args): Promise<ToolResult> {
    const chatId = neededText(args, "chatId", "the chat's id (lre_chats lists the chats that play a world)");
    gate(args, def.name, SHOWS);
    const own: JsonObject = Object.fromEntries(Object.entries(args).filter(([key]) => key !== "chatId" && key !== "spoilers")) as JsonObject;
    const world = await this.worldOf(caller.userId, chatId);
    const texts = (await this.rt.settings.get(caller.userId)).prompts.texts;
    const problems = checkSchema(described(def, def.parameters(world), texts) as Schema, own);
    if (problems.length > 0) throw new ToolError(`${def.name}'s arguments don't fit its schema for chat ${chatId}:\n${problems.map((p) => `- ${p.path.length > 0 ? `${pathText(p.path)}: ` : ""}${p.message}`).join("\n")}\n${DESCRIBE_TOOL} gives the schema with this chat's ids.`);
    const signal = new AbortController().signal;
    const reads = { userId: caller.userId, chatId, knowledge: "gm" as const };
    const reader = outsideReader(this.rt, reads);
    const agent = { role: GM_ROLE, id: caller.client };
    const env: ToolEnv = { ...reads, reader, agent, signal, writer: writes(def) === false ? null : clientWriter(this.rt, { ...reads, reader, agent, signal, connectionId: null, client: caller.client }) };
    const out = await this.queue.run(`${caller.userId}\u0000${caller.session}\u0000chat:${chatId}`, () => def.run(own, env));
    return out.error ? { text: out.text, isError: true } : { text: out.text };
  }

  /** The chat's world as its agents may name it (`schemaWorld`); refused for a chat that plays none, or that the host has no chat by. */
  private async worldOf(userId: UserId, chatId: string): Promise<WorldDoc> {
    const plays = pathSafe(chatId) && (await this.rt.runOf(chatId as ChatId, userId).then((run) => Boolean(run), () => false)) && Boolean(await this.rt.ledger.core(chatId as ChatId, userId));
    if (!plays) throw new ToolError(`Chat ${chatId} plays no world (or there is no such chat): lre_chats lists the chats that play one, and lre_attach attaches a world to a chat.`);
    const view = await outsideReader(this.rt, { userId, chatId: chatId as ChatId, knowledge: "gm" }).view();
    return schemaWorld(view.world, this.rt.registry);
  }
}
