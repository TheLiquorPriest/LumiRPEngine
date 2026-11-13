// The agent tool registry (AGENT-LOOP-PLAN §6; INC1-SPEC C6): every tool LRE's agents may call, by
// family and tier, and `toolsFor`, which gives an agent its tools as the runtime takes them (R1's
// `AgentTool`). Each tool reads through one `ToolReadView` (`env.reader`, `tools/read-view.ts`),
// everything in it marked as its view marks it, and writes, at the GM tier, through `env.writer` (C7). A tool's
// description and each argument's are registry texts (`tool.<name>`, `tool.<name>.<path>`, Settings →
// Agents → Prompts, Every agent page, group "Tools"), sent in the user's own words where they wrote them;
// its JSON Schema is hand-written with the world's enums filled in (`tools/schema.ts`). What several
// tools share is told once, in the system prompt of the agent given them (`toolsGuide`), so every call
// sends the same, smaller tool block, which the provider caches.

import type { ToolFamily, ToolTier, ToolView } from "../../../shared/agent-tools";
import { guidesOf, toolArgTextId, toolGuideId, toolText, toolTextId } from "../../../shared/agent-tools";
import type { ChatId, UserId } from "../../../shared/ids";
import { isRecord, type JsonObject } from "../../../shared/json";
import type { PromptTexts } from "../../../shared/prompts";
import type { UserSettings } from "../../../shared/settings";
import type { WorldDoc } from "../../../shared/world";
import { renderPrompt } from "../../prompts";
import type { AgentTool, ToolOutcome } from "../runtime";
import { CONDENSE_TOOLS, type Summarize } from "./condense";
import type { HarnessFiles, WorldBuild } from "./harness-ports";
import type { HarnessTurn } from "./harness-turn";
import { LORE_TOOLS } from "./lore";
import { READ_TOOLS } from "./read";
import type { ToolReader } from "./read-view";
import { schemaWorld } from "./schema";
import { WORKSPACE_TOOLS } from "./workspace";
import { WRITE_TOOLS } from "./write";
import type { ToolWriter } from "./writer";

export type { ToolFamily, ToolTier, ToolView } from "../../../shared/agent-tools";

/**
 * What a tool runs with: whose chat, the view it reads with (`gm` with `marks` for every turn agent,
 * plain `gm` for the GM's own tools, `everyone` for a reader of the narrator's view), where it reads
 * (`reader`: outside a turn the chat's head, `outsideReader`) and writes (`writer`, null for an agent
 * that may not write), who calls, and a signal that ends when the agent is cancelled or its time runs
 * out. `loads`: where an agent working a turn loads lore into the reply the turn is writing; absent
 * outside a turn.
 */
export interface ToolEnv {
  userId: UserId;
  chatId: ChatId;
  knowledge: ToolView;
  /** Under `gm`, every secret marked in the user's wording besides (`ReadViewInput.marks`): a turn agent's view. */
  marks?: boolean;
  reader: ToolReader;
  writer: ToolWriter | null;
  /** Who calls: the definition it runs as (`role`), its handle, and which instance of that definition it is (`as`, the call's own from LumiAH's `delegate` or `job_start`; the person a character's agent is). Absent where nobody said. Never taken from a tool's arguments. */
  agent: { role: string; id: string; as?: string };
  signal: AbortSignal;
  loads?: LoreLoads;
  /** Condenses a source with the agent's own model (`condense`); absent for an agent that can't make the call. */
  summarize?: Summarize;
  /** Where the Curator's tools note what lands with the reply's read (ITEMS-SPEC §7.3); absent outside the Curator's turn. */
  notes?: ReadNotes;
  /** The harness turn the call belongs to (`tools/harness-turn.ts`): what the harness engine's own tools stage into and read of the turn; absent on the classic and agents engines, where those tools aren't given. */
  turn?: HarnessTurn;
  /** The world's document as Build edits it (`tools/harness-ports.ts`): what the harness engine's `world` tools write through; absent or null where the call has none. */
  build?: WorldBuild | null;
  /** The chat's area of LumiAH's workspace (`tools/harness-ports.ts`): where a tool that keeps a file writes it on the harness; absent or null until the harness gives one. */
  files?: HarnessFiles | null;
}

/**
 * Where the Curator's tools note a fact that lands with the reply's read, checked and settled as the
 * read's are, under its change type's mode: a walk-on person (the `spawn` channel), a purchase (the
 * economy's `purchase` channel) and a place someone is put in (`place_make`).
 */
export interface ReadNotes {
  /** Notes one fact as classic's parser reads it; false when the same fact is noted already. */
  add(fact: JsonObject): boolean;
}

/** Where a turn's agents load lore into the reply it is writing (`lore_load`, DESIGN §4.6): the turn's scene lore, which reaches the narrator in the Scene section. */
export interface LoreLoads {
  /** Loads a lore entry, by its lore id, into the turn's reply, once however often it is loaded; false once the reply is written, and nothing is loaded. */
  add(loreId: string): boolean;
}

export interface ToolDefinition {
  name: string;
  family: ToolFamily;
  tier: ToolTier;
  /** Given only to an agent working a turn (`ToolEnv.loads`): what it does is for the turn's reply. */
  turn?: true;
  /** Given only to an agent that can condense a source (`ToolEnv.summarize`). */
  summarizes?: true;
  /** Given only to an agent that notes facts for the reply's read (`ToolEnv.notes`): the Curator working a turn. */
  notes?: true;
  /** Its description is the registry text `tool.<name>` (R5, Every agent page, group "Tools"): editable, with a reset. */
  parameters(world: WorldDoc): JsonObject; // hand-written JSON Schema, with the world's enums filled in
  /** For a tool that holds each answer to one of the player's settings and is meant to be read in one go: that bound, in characters, under `settings`. On the harness LumiAH gives its answer whole up to it (its `wholeChars`) instead of clipping it at Tool results clipped past. */
  wholeChars?: (settings: UserSettings) => number;
  run(args: JsonObject, env: ToolEnv): Promise<ToolOutcome>;
}

/** Every tool, in the order the Prompts page lists their texts: the read families, then the writes, the workspace and the lore. */
export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [...READ_TOOLS, ...WRITE_TOOLS, ...WORKSPACE_TOOLS, ...CONDENSE_TOOLS, ...LORE_TOOLS];

/** The property at a dotted path of a schema, through nested `properties` and an array's `items`; null where the schema has none. */
function propertyAt(schema: JsonObject, path: string): JsonObject | null {
  let at: JsonObject | null = schema;
  for (const key of path.split(".")) {
    const items: unknown = at?.items;
    const holder: unknown = at?.type === "array" && isRecord(items) ? items : at;
    const properties: unknown = isRecord(holder) ? holder.properties : undefined;
    const next: unknown = isRecord(properties) ? properties[key] : undefined;
    at = isRecord(next) ? (next as JsonObject) : null;
  }
  return at;
}

/**
 * `schema` with the description of each argument `args` names (a tool's texts), in the user's words
 * where they wrote one; a tool whose texts name an argument its schema lacks is a bug, and says so.
 * A schema may use one node for several arguments (a shared boolean, say): the copy gives each
 * argument a node of its own, so that each carries its own description rather than the last one
 * written to the node they shared (`structuredClone` would keep them one node).
 */
export function describedSchema(tool: string, args: readonly { path: string }[], schema: JsonObject, texts: PromptTexts): JsonObject {
  const out = JSON.parse(JSON.stringify(schema)) as JsonObject;
  for (const arg of args) {
    const property = propertyAt(out, arg.path);
    if (!property) throw new Error(`the ${tool} tool's texts describe an argument its schema doesn't have: ${arg.path}`);
    property.description = renderPrompt(toolArgTextId(tool, arg.path), texts, {});
  }
  return out;
}

/**
 * The tools an agent is given (C6): those of `tiers`, and of `families` when it names any (a turn's
 * own only to an agent working a turn), each with its description and its arguments' in `texts` (the
 * user's own where they wrote one, else the shipped), and its schema filled from the world as the
 * agent may name it (`schemaWorld`). A call runs with `env` as it stands then, the agent named by the
 * runtime and ended by its signal too.
 */
export function toolsFor(input: { world: WorldDoc; tiers: readonly ToolTier[]; families?: readonly ToolFamily[]; texts: PromptTexts; env: ToolEnv }): AgentTool[] {
  const { env, texts } = input;
  const world = schemaWorld(input.world, env.reader.registry);
  return TOOL_DEFINITIONS.filter((def) => input.tiers.includes(def.tier) && (input.families === undefined || input.families.includes(def.family)) && (def.turn !== true || env.loads !== undefined) && (def.summarizes !== true || env.summarize !== undefined) && (def.notes !== true || env.notes !== undefined)).map(
    (def): AgentTool => ({
      name: def.name,
      description: renderPrompt(toolTextId(def.name), texts, {}),
      parameters: describedSchema(def.name, toolText(def.name)?.args ?? [], def.parameters(world), texts),
      run: (args, ctx) => def.run(args, { ...env, agent: { role: ctx.role, id: ctx.agentId }, signal: AbortSignal.any([env.signal, ctx.signal]) }),
    }),
  );
}

/**
 * What `tools` share (`ToolText.guides`: what a change to a thing or a place does, how a thing is
 * named), each once, in the user's words where they wrote them: the agent given them is told this in
 * its system prompt instead of in each tool's description. Empty when none of them shares anything.
 */
export function toolsGuide(tools: readonly { name: string }[], texts: PromptTexts): string {
  return guidesOf(tools.map((t) => t.name))
    .map((g) => renderPrompt(toolGuideId(g), texts, {}))
    .filter((t) => t.trim() !== "")
    .join("\n\n");
}
