// The tools an agent manages LumiRPEngine worlds with (`lre_*`), shared by the MCP server and the
// command line, which mirrors them. Every answer is text, JSON for data, of at most ANSWER_LIMIT
// characters; a refusal is an error result whose message says what to do instead. Pure: files,
// the host and the clock come through the ToolContext.

import type { JsonObject } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { Args } from "./args";
import { intArg, onlyArgs, textArg, textsArg, ToolError } from "./args";
import { LiveError, LreError } from "./connection";
import type { Live, Serialize } from "./live";
import { attachTool, chatsTool, commitTool, createTool, deleteTool, diffTool, discardTool, draftTool, editTool, exportTool, historyTool, importTool, restoreTool, searchTool, upgradeTool, worldsTool, worldTool } from "./live";
import { checkTool, docsTool, guideTool, loadWorld, runWorld, schemaTool, templatesTool, templateTool, worldInput } from "./offline";
import type { Loaded, RunKind } from "./offline";
import { ANSWER_LIMIT, clip } from "./read";
import type { ToolResult } from "./report";
import { json, lintSummary } from "./report";
import { VERSIONS } from "./version";
import type { ToolModule } from "./tool-module";
import { CONFIG_TOOLS } from "./tools-config";

/** How a write tool changes things, for MCP's tool annotations (a client may ask the user before a destructive call). */
export interface WriteHints {
  /** It can delete or overwrite what is there: a draft, a world, a chat's state. */
  destructive: boolean;
  /** Calling it again with the same arguments changes nothing more. */
  idempotent: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: JsonObject;
  /** Changes worlds or chats on the host (hidden and refused in read-only mode), and how; false for a tool that only reads. */
  write: false | WriteHints;
}

/** A tool's MCP annotations. None reaches past the user's own Lumiverse and files, so none is open-world. */
export function annotationsOf(def: ToolDef): JsonObject {
  if (def.write === false) return { readOnlyHint: true, openWorldHint: false };
  return { readOnlyHint: false, destructiveHint: def.write.destructive, idempotentHint: def.write.idempotent, openWorldHint: false };
}

export interface ToolContext {
  readFile(path: string): string;
  /** The worlds on the signed-in Lumiverse; throws a LiveError when this client isn't signed in. */
  live(): Live;
  readOnly: boolean;
  /** Runs one world's (or chat's) writes one at a time; calls in parallel are fine otherwise. A function, not a method: tools take it on its own. */
  readonly serialize: Serialize;
}

/** Runs work by key one after another, keys side by side. */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work, work);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

const object = (properties: JsonObject, required: string[] = []): JsonObject => ({ type: "object", properties, ...(required.length > 0 ? { required } : {}), additionalProperties: false });

const WORLD_ID: JsonObject = { type: "string", description: "The world's id (w_…), from lre_worlds." };
const SOURCE: JsonObject = { type: "string", description: 'Which version: "draft" (the working copy Build and lre_edit share; the head when none is stored), "head" (the committed world), or a revision id, or a unique prefix of 6+ characters of one (lre_history lists them).' };
const POINTER: JsonObject = { type: "string", description: 'A JSON Pointer into it (RFC 6901): "" for an outline of the whole, "/entities/mara" for one item, "/entities/mara/fields". In a key, "~1" stands for "/" and "~0" for "~".' };
const OFFSET: JsonObject = { type: "integer", minimum: 0, description: "Read the value's JSON text from this character instead of outlining it; each page says where the next begins." };
const PATH: JsonObject = { type: "string", description: "A path to the world's JSON file on this machine: an lre-world-v1 document or an lre-world-export-v1 file." };
const WORLD: JsonObject = { type: "object", description: "Or the world inline: an lre-world-v1 document or an lre-world-export-v1 file. A whole world is large; prefer path." };
const RUN_FROM = { path: PATH, world: WORLD, worldId: { type: "string", description: "Or a world on your Lumiverse, by id (needs lumirpengine login)." }, source: SOURCE };
const EXPECT_VERSION: JsonObject = { type: "integer", minimum: 0, description: "The draft version you last read (lre_world, lre_draft and lre_worlds say it, stored or not): refused if the draft has moved on since, so a change you haven't seen is never overwritten, committed or thrown away." };

/** The tools kept in files of their own (tool-module.ts), each with its implementation and command, after the ones below. */
export const MODULE_TOOLS: readonly ToolModule[] = [...CONFIG_TOOLS];

export const TOOLS: readonly ToolDef[] = [
  {
    name: "lre_guide",
    description: 'The agent guide to LumiRPEngine worlds: the world model, the workflow, and the patterns that bite (reveals, lifeKnownBy, fields.owner, cues, ids, map-owned items, tables, a mind\'s secrecy, money\'s owners and flows). Read it before you write a world. topic narrows it to one section (its heading, such as "Tracks: quests and secrets", "Money", "Holdings and property" or "Character minds") or to whatever matches the words.',
    inputSchema: object({ topic: { type: "string", description: "A section's heading, or a few words." } }),
    write: false,
  },
  {
    name: "lre_docs",
    description: "Look things up in LumiRPEngine's docs, best-matching sections first: the reference (every kind and field, relation type, effect, formula function, action, event and lint code), the expression language, the recipes, the design, the user guide, the Studio contract and presets.",
    inputSchema: object({ query: { type: "string", description: 'A few words: a kind, field, effect, function or lint code, or a question ("account opening", "stage formula").' }, doc: { type: "string", enum: ["reference", "expressions", "recipes", "design", "user-guide", "studio", "presets"], description: "Only this doc." } }, ["query"]),
    write: false,
  },
  {
    name: "lre_schema",
    description: "Read the published JSON Schema of a world (lre-world-v1), or of a map (lre-map-v1), at a JSON Pointer: which fields each part takes, their types and bounds. Large parts come back as an outline.",
    inputSchema: object({ pointer: POINTER, schema: { type: "string", enum: ["world", "map"], description: 'Default "world". The world schema names the map schema by its $id for maps.' }, offset: OFFSET }),
    write: false,
  },
  {
    name: "lre_templates",
    description: "The starter worlds lre_world_create and lre_template take: id, name and what each holds.",
    inputSchema: object({}),
    write: false,
  },
  {
    name: "lre_template",
    description: "One starter world as an export file (lre-world-export-v1), read at a JSON Pointer or paged by offset: complete worlds to learn the format from. To start a world from one on your Lumiverse, use lre_world_create with template.",
    inputSchema: object({ id: { type: "string", description: "The starter's id (lre_templates)." }, pointer: POINTER, offset: OFFSET }, ["id"]),
    write: false,
  },
  {
    name: "lre_check",
    description: "Check a world the way LumiRPEngine loads it, on this machine: the shape, migration to this engine, every lint rule of the engine and its packs, and the host macro hazards in authored text (lore, section and step templates). It counts the world's items and its entities by kind, which is where its accounts, flows, jobs and holdings show. Errors block a commit and an import.",
    inputSchema: object({ path: PATH, world: WORLD }),
    write: false,
  },
  {
    name: "lre_playtest",
    description: "Play typed turns through the bundled engine from the world's start, with no narrator and no model (so no character mind runs): what each turn does to the world, and the engine's notes on it. The world comes from a file, inline, or from your Lumiverse (worldId with source).",
    inputSchema: object({ ...RUN_FROM, turns: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 50, description: 'What the player types, one entry per turn ("look around", "walk to the market").' } }, ["turns"]),
    write: false,
  },
  {
    name: "lre_check_world",
    description: "Simulate whole days from the world's start with the bundled engine (no narrator, no model, so no character mind runs): NPC schedules and plans, rules, tracks and money, flows and pay included, with dropped events, failures and secret leaks as notes. The world comes from a file, inline, or from your Lumiverse (worldId with source).",
    inputSchema: object({ ...RUN_FROM, days: { type: "integer", minimum: 1, maximum: 14, description: "Days to simulate (default 3)." } }),
    write: false,
  },
  {
    name: "lre_status",
    description: "Which Lumiverse this client is signed in to and as whom, the session's state, whether LumiRPEngine runs there and the agent API it speaks, and this client's versions.",
    inputSchema: object({}),
    write: false,
  },
  {
    name: "lre_worlds",
    description: "Your LumiRPEngine worlds: id, name, head revision, how many revisions, and whether a draft is stored (with its version). It reads every world's draft, so it costs a request per world.",
    inputSchema: object({}),
    write: false,
  },
  {
    name: "lre_world",
    description: "Read a world at a JSON Pointer: its draft (the default; the head when no draft is stored), its head, or any revision. Large parts come back as an outline of keys and ids to read deeper from, or page through with offset.",
    inputSchema: object({ worldId: WORLD_ID, source: SOURCE, pointer: POINTER, offset: OFFSET }, ["worldId"]),
    write: false,
  },
  {
    name: "lre_search",
    description:
      "Search your worlds' heads and stored drafts for words: names, descriptions, lore, cues, formulas, anything written as text. Each hit names the world, whether it is in the head or the draft, the item, its kind when it is an entity, and the field that matched (a JSON Pointer inside the item), with a snippet. Accounts, cards, flows, jobs, holdings, properties, businesses, trusts and households are entities: kinds narrows the search to them. It reads every world it searches whole, so give worldId when you know the world. A world it couldn't read is listed as skipped.",
    inputSchema: object(
      {
        query: { type: "string", description: "Words to look for; items holding all of them come first." },
        worldId: { type: "string", description: "Only this world." },
        collections: { type: "array", items: { type: "string" }, description: 'Only these collections or parts ("entities", "lore", "tracks", "calendar", "packs"…).' },
        kinds: { type: "array", items: { type: "string" }, description: 'Only entities of these kinds, or of kinds that extend them: "flow", "account", "job", "household", "group" (every group)…' },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "At most this many hits (default 20)." },
      },
      ["query"],
    ),
    write: false,
  },
  {
    name: "lre_world_create",
    description: "Create a world on your Lumiverse, blank or from a starter (lre_templates). Its first revision is its head.",
    inputSchema: object({ name: { type: "string", description: "The world's name." }, template: { type: "string", description: "A starter's id; blank when left out." } }, ["name"]),
    write: { destructive: false, idempotent: false },
  },
  {
    name: "lre_world_import",
    description: "Import a world file (an lre-world-v1 document or an lre-world-export-v1 file) as a new world on your Lumiverse. Its shape is checked here first; the macros in its lore and templates come back for review.",
    inputSchema: object({ path: PATH, world: WORLD }),
    write: { destructive: false, idempotent: false },
  },
  {
    name: "lre_edit",
    description:
      'Change a world\'s draft with JSON Patch (RFC 6902): add, remove, replace, move, copy and test, each path a JSON Pointer into the whole world ("/entities/mara/fields/place"). All the operations apply or none do. The draft is the user\'s Build draft too. Pass expectVersion (the draft version you last read) so that a change made since is refused, not overwritten. Without it, when someone writes the draft between this call\'s read and its patch, the patch still goes on top of their write if that write changed none of the items the patch touches (the answer\'s meanwhile lists what it changed); if it did, the edit is refused and names those items. Answers the new version, what changed per collection, the first lint issues and any macro hazards the edit brought in.',
    inputSchema: object(
      {
        worldId: WORLD_ID,
        ops: {
          type: "array",
          minItems: 1,
          maxItems: 500,
          description: "The operations, applied in order.",
          items: { type: "object", properties: { op: { type: "string", enum: ["add", "remove", "replace", "move", "copy", "test"] }, path: { type: "string" }, from: { type: "string" }, value: {} }, required: ["op", "path"] },
        },
        expectVersion: EXPECT_VERSION,
      },
      ["worldId", "ops"],
    ),
    write: { destructive: true, idempotent: false },
  },
  {
    name: "lre_draft",
    description: "A world's draft: whether one is stored, its version and the revision it began from, its lint summary, and what it changes against the head.",
    inputSchema: object({ worldId: WORLD_ID }, ["worldId"]),
    write: false,
  },
  {
    name: "lre_commit",
    description: "Commit the world's draft as its new head revision, with a short note for its history. A commit takes the whole draft, the user's changes in Build with yours, so pass expectVersion. Refused while the draft has lint errors (they are listed) or when the head moved since the draft began. The draft is shared with the user's Build: commit or discard what you start.",
    inputSchema: object({ worldId: WORLD_ID, note: { type: "string", maxLength: 200, description: "What this revision changes, in a few words." }, expectVersion: EXPECT_VERSION }, ["worldId"]),
    write: { destructive: false, idempotent: false },
  },
  {
    name: "lre_discard",
    description: "Throw away the world's stored draft; the head stays as it is. The draft may hold the user's work from Build too, so pass expectVersion.",
    inputSchema: object({ worldId: WORLD_ID, expectVersion: EXPECT_VERSION }, ["worldId"]),
    write: { destructive: true, idempotent: true },
  },
  {
    name: "lre_history",
    description: "A world's revisions, and how each became head (a new world, Build, an agent, an import, the Studio), when, with its commit note.",
    inputSchema: object({ worldId: WORLD_ID }, ["worldId"]),
    write: false,
  },
  {
    name: "lre_diff",
    description: 'What changed between two versions of a world, item by item (added, changed, removed; a pack\'s products and assets are items of their own), with the JSON Pointers that differ inside each changed item. from and to are "head", "draft" or a revision: by default, from the head to the draft.',
    inputSchema: object({ worldId: WORLD_ID, from: SOURCE, to: SOURCE }, ["worldId"]),
    write: false,
  },
  {
    name: "lre_restore",
    description: "Make the world's draft a copy of one of its revisions; committing it then makes that revision's content the head again. It replaces a stored draft, so pass expectVersion.",
    inputSchema: object({ worldId: WORLD_ID, revision: { type: "string", description: "The revision (lre_history), or a unique prefix of 6+ characters of it." }, expectVersion: EXPECT_VERSION }, ["worldId", "revision"]),
    write: { destructive: true, idempotent: true },
  },
  {
    name: "lre_world_delete",
    description:
      "Delete a world for good: every revision, its draft and its history. Its chats lose their world (they stop being world chats), and its engine lore book (\"LumiRPEngine · <name>\") stays in World Books, still attached to them, for the user to delete. Without confirm, it only says what would be deleted; to delete, confirm must be the world's exact current name.",
    inputSchema: object({ worldId: WORLD_ID, confirm: { type: "string", description: "The world's exact current name. Leave it out for a preview of what would be deleted." } }, ["worldId"]),
    write: { destructive: true, idempotent: true },
  },
  {
    name: "lre_world_export",
    description: "A world (its head, or a revision) as an export file (lre-world-export-v1), the format Import reads, as JSON text paged by offset. The command line writes it to a file in one go: lumirpengine export <worldId> --out <file>.",
    inputSchema: object({ worldId: WORLD_ID, revision: { type: "string", description: "A revision (default: the head)." }, offset: OFFSET }, ["worldId"]),
    write: false,
  },
  {
    name: "lre_chats",
    description: "Your chats that play a world (one world's, with worldId): chat id, name, the world and revision each plays, and whether it is behind the world's head. A chat whose state LumiRPEngine can't read has no revision, and a reason.",
    inputSchema: object({ worldId: { type: "string", description: "Only this world's chats." } }),
    write: false,
  },
  {
    name: "lre_attach",
    description: "Attach a world to a chat: the chat plays it from its head revision, and the world's lore book joins the chat. A chat that already plays another world is refused.",
    inputSchema: object({ worldId: WORLD_ID, chatId: { type: "string", description: "The chat's id." } }, ["worldId", "chatId"]),
    write: { destructive: false, idempotent: true },
  },
  {
    name: "lre_upgrade",
    description:
      "Move a chat to a later revision of its world (the head by default). With preview, list what would change, entity by entity, with the default pick of each; without it, apply the Upgrade with the default picks (take what play never touched, keep what it changed). Changes about what the player hasn't found yet stay hidden unless spoilers is true. Applied while the chat is mid-turn, the Upgrade is pending: it lands when that turn ends.",
    inputSchema: object({ chatId: { type: "string", description: "The chat's id (lre_chats)." }, to: { type: "string", description: "The revision to move to (default: the world's head)." }, preview: { type: "boolean", description: "Only list what would change." }, spoilers: { type: "boolean", description: "With preview, show hidden changes too." } }, ["chatId"]),
    write: { destructive: true, idempotent: true },
  },
  ...MODULE_TOOLS,
];

const BY_NAME: Readonly<Record<string, ToolDef>> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));

/** The tools a session offers: without the write tools when it is read-only. */
export function toolsFor(readOnly: boolean): readonly ToolDef[] {
  return readOnly ? TOOLS.filter((t) => !t.write) : TOOLS;
}

export function findTool(name: string): ToolDef | undefined {
  return hasOwn(BY_NAME, name) ? BY_NAME[name] : undefined;
}

async function statusTool(ctx: ToolContext): Promise<ToolResult> {
  let live: Live;
  try {
    live = ctx.live();
  } catch (error) {
    if (error instanceof LiveError) return { text: json({ signedIn: false, problem: error.message, client: VERSIONS, readOnly: ctx.readOnly }), failed: true };
    throw error;
  }
  const host = await live.conn.describe();
  const report = {
    // null when the host couldn't be asked: a lockout or an outage says nothing about the session.
    signedIn: host.session.valid,
    lumiverse: host.base,
    user: host.username,
    session: host.session,
    lumiRPEngine: host.extension === null ? null : { status: host.extension.status, enabled: host.extension.enabled, version: host.extension.version, agentApi: host.agentApi },
    client: VERSIONS,
    readOnly: ctx.readOnly,
    ...(host.problem !== null ? { problem: host.problem } : {}),
  };
  return { text: json(report), ...(host.problem !== null ? { failed: true as const } : {}) };
}

/** Playtest and Check world: on a file, an inline world, or a world on the host read as `source` says. */
async function runTool(kind: RunKind, args: Args, ctx: ToolContext): Promise<ToolResult> {
  const turns = kind === "playtest" ? textsArg(args, "turns") : [];
  if (turns === undefined || (kind === "playtest" && turns.length === 0)) throw new ToolError('Give turns: what the player types, one entry per turn (["look around", "walk to the market"]).');
  if (turns.length > 50) throw new ToolError(`That is ${turns.length} turns; play at most 50 at once.`);
  const days = kind === "check_world" ? (intArg(args, "days", 1, 14) ?? 3) : 1;
  const input = worldInput(args, ctx.readFile);
  const worldId = textArg(args, "worldId");
  if (input !== null && worldId !== undefined) throw new ToolError("Give the world one way: path, world or worldId.");
  let loaded: Loaded;
  let from: string;
  if (input !== null) {
    loaded = loadWorld(input.value);
    from = input.from;
  } else if (worldId !== undefined) {
    const source = await ctx.live().source(worldId, textArg(args, "source") ?? "draft");
    loaded = loadWorld(JSON.parse(JSON.stringify(source.world)));
    from = source.label;
  } else throw new ToolError("Give the world: path (a file), world (inline), or worldId (a world on your Lumiverse).");
  if (!loaded.result.ok) throw new ToolError(`${from} doesn't load as a world, so it can't run:\n${json(lintSummary(loaded.result.issues, 30))}`);
  return runWorld(kind, loaded.result.world, from, loaded.writtenBy, { turns, days });
}

async function dispatch(def: ToolDef, args: Args, ctx: ToolContext): Promise<ToolResult> {
  switch (def.name) {
    case "lre_guide":
      return guideTool(args);
    case "lre_docs":
      return docsTool(args);
    case "lre_schema":
      return schemaTool(args);
    case "lre_templates":
      return templatesTool();
    case "lre_template":
      return templateTool(args);
    case "lre_check":
      return checkTool(args, ctx.readFile);
    case "lre_playtest":
      return runTool("playtest", args, ctx);
    case "lre_check_world":
      return runTool("check_world", args, ctx);
    case "lre_status":
      return statusTool(ctx);
    case "lre_worlds":
      return worldsTool(ctx.live());
    case "lre_world":
      return worldTool(ctx.live(), args);
    case "lre_search":
      return searchTool(ctx.live(), args);
    case "lre_world_create":
      return createTool(ctx.live(), args);
    case "lre_world_import":
      return importTool(ctx.live(), args, ctx.readFile);
    case "lre_edit":
      return editTool(ctx.live(), args, ctx.serialize);
    case "lre_draft":
      return draftTool(ctx.live(), args);
    case "lre_commit":
      return commitTool(ctx.live(), args, ctx.serialize);
    case "lre_discard":
      return discardTool(ctx.live(), args, ctx.serialize);
    case "lre_history":
      return historyTool(ctx.live(), args);
    case "lre_diff":
      return diffTool(ctx.live(), args);
    case "lre_restore":
      return restoreTool(ctx.live(), args, ctx.serialize);
    case "lre_world_delete":
      return deleteTool(ctx.live(), args, ctx.serialize);
    case "lre_world_export":
      return exportTool(ctx.live(), args);
    case "lre_chats":
      return chatsTool(ctx.live(), args);
    case "lre_attach":
      return attachTool(ctx.live(), args, ctx.serialize);
    case "lre_upgrade":
      return upgradeTool(ctx.live(), args, ctx.serialize);
  }
  const module = MODULE_TOOLS.find((t) => t.name === def.name);
  if (module !== undefined) return module.run(args, ctx);
  throw new ToolError(`${def.name} has no implementation.`);
}

/** What a failed call answers: the refusal's own words, with the lint behind a refused write. */
function failure(error: unknown): ToolResult {
  if (error instanceof ToolError || error instanceof LiveError) return { text: error.message, isError: true };
  if (error instanceof LreError) {
    const lint = error.lint.length > 0 ? `\n${json(lintSummary(error.lint, 30))}` : "";
    return { text: `LumiRPEngine refused it (${error.code}): ${error.message}${lint}`, isError: true };
  }
  return { text: `The tool failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
}

/**
 * Runs one tool. Never throws: a refusal or a failure is an error result. A write tool is refused
 * in read-only mode before anything is read or sent.
 */
export async function callTool(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  const def = findTool(name);
  if (!def) return { text: `There is no tool ${name}.`, isError: true };
  if (def.write && ctx.readOnly) return { text: `${name} changes your worlds or chats, and this client runs read-only (--read-only or LRE_READ_ONLY=1): nothing was done.`, isError: true };
  if (rawArgs !== undefined && rawArgs !== null && !isRecord(rawArgs)) return { text: "The arguments must be an object.", isError: true };
  const args: Args = isRecord(rawArgs) ? rawArgs : {};
  try {
    onlyArgs(args, def.inputSchema);
    const result = await dispatch(def, args, ctx);
    // A tool keeps itself within the limit; this is the backstop, so no answer is cut by the client unannounced.
    return result.text.length > ANSWER_LIMIT ? { ...result, text: `${clip(result.text, ANSWER_LIMIT - 200)}\n(Cut to fit one answer: narrow the request with pointer, offset or limit.)` } : result;
  } catch (error) {
    return failure(error);
  }
}
