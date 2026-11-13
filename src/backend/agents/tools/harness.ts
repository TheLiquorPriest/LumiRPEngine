// RPEngine's tools as the harness lists and runs them (HARNESS-SLICE3: "Each RPEngine tool call
// crosses the link and runs in the extension with a `ToolEnv` built for that call").
//
// - `harnessTools` lists them as LumiAH's tool port takes a tool (`RemoteTool`): every tool the old
//   engines' agents are given, under its own name and family, but those the harness has its own of
//   (`HARNESS_SUPERSEDED`), then the harness engine's own (`harness-tools/`). Descriptions are the
//   registry texts, in the user's words where they wrote them.
// - `runHarnessTool` runs one by name with the env the bridge built for the call.
//
// A tool's tier here is what LumiAH's approval is decided by, not who may make the change: one that
// only reads is `read`; one that changes what the engine keeps is `write`, whether RPEngine takes it
// at the story's tier or the game master's (the calling agent's writer tier and the user's modes
// decide that, in the writer). None is `external`: no tool of the engine's acts outside the world
// and the chat it keeps.
//
// A tool that keeps a file (a lore entry saved or drafted) writes it where the harness's agents read
// their files: LumiAH's workspace, through `ToolEnv.files`. Until the bridge gives that port, the
// file goes where the old engines keep theirs (the chat's own kept files), which the harness's
// workspace takes in when it first reads the chat.

import { toolText, toolTextId, type ToolTier } from "../../../shared/agent-tools";
import { WRITE_NOTE } from "../../../shared/agent-tools-write";
import { HARNESS_NOTE, harnessToolText } from "../../../shared/harness-texts";
import { NESTED_ARG_TEXTS } from "../../../shared/harness-texts-args";
import { HARNESS_DESCRIBED } from "../../../shared/harness-texts-surfaces";
import { hashJson, hashParts } from "../../../shared/hash";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import { neutralizeMacros } from "../../../shared/macros";
import { CHANGE_TYPES, type UserSettings } from "../../../shared/settings";
import type { WorldDoc } from "../../../shared/world";
import { authorLines } from "../../../engine/player-events";
import type { Registry } from "../../../engine/registry-impl";
import { Working } from "../../../engine/working";
import type { RemoteTool } from "../../harness/shapes";
import { renderPrompt } from "../../prompts";
import { applyProposals } from "../../turn-model";
import type { ToolOutcome } from "../runtime";
import { HARNESS_TOOL_DEFINITIONS } from "./harness-tools";
import { stageChange } from "./harness-tools/kit";
import type { HarnessTurn } from "./harness-turn";
import type { ToolReadView } from "./read-view";
import { describedSchema, type ReadNotes, TOOL_DEFINITIONS, type ToolEnv } from "./registry";
import { schemaWorld, text } from "./schema";
import type { ToolWriter } from "./writer";

const WORKSPACE = "the workspace is LumiAH's on the harness: its own tool of this name reads and writes it";

/**
 * The tools of the old engines' agents that the harness doesn't list, each with why. Everything
 * else in `TOOL_DEFINITIONS` is listed under its own name. The engine's lore tools stay (they read
 * lore as the chat's knowledge marks and gates it, and save or draft an entry as a file), so in a
 * chat the engine claims they stand in for LumiAH's of the same names.
 */
export const HARNESS_SUPERSEDED: Readonly<Record<string, string>> = {
  workspace_list: WORKSPACE,
  workspace_read: WORKSPACE,
  workspace_grep: WORKSPACE,
  workspace_write: WORKSPACE,
  workspace_edit: WORKSPACE,
  workspace_move: WORKSPACE,
  workspace_delete: WORKSPACE,
  workspace_pin: WORKSPACE,
  condense: "it condenses with a model call of the engine's own, and on the harness every model call is an agent's",
};

type Run = (args: JsonObject, env: ToolEnv) => Promise<ToolOutcome>;

/**
 * Who may call a tool, as the document's table says it (`docs/harness-tools.md`) and the bridge's
 * gate holds every call to it before the tool runs: `read`, any agent given it (it changes
 * nothing); `story` and `gm`, an agent whose writer tier is that or above; `author`, the run's
 * main agent alone, in its own turn; `mind`, a character's own agent, for the one person it is;
 * `any`, any agent given it, because what it records is checked by the engine's own validator for
 * the step it stands in for.
 */
export type HarnessNeeds = "read" | "story" | "gm" | "author" | "mind" | "any";

/** A tool the harness lists, before its texts and its schema. */
export interface HarnessListed {
  name: string;
  /** What a definition is given it by, with its kin: `@<family>`. */
  family: string;
  /** What LumiAH's approval reads (see the header). */
  tier: RemoteTool["tier"];
  /** The writer tier RPEngine takes it at; null for the harness engine's own, which record through the turn itself, checked by the engine's validators and under the user's modes. */
  writer: ToolTier | null;
  /** Who may call it (`HarnessNeeds`): one of the old engines' at the writer tier it is listed at, one of the harness engine's own as `HARNESS_OWN_NEEDS` says. */
  needs: HarnessNeeds;
}

interface Entry extends HarnessListed {
  args: readonly { path: string }[];
  parameters(world: WorldDoc): JsonObject;
  /** What of its answer reaches the model whole under the player's settings (`HarnessToolDefinition.wholeChars`, or one page of a read that pages, `ToolDefinition.pages`); absent: LumiAH's Tool results clipped past. */
  wholeChars?: (settings: UserSettings) => number;
  run: Run;
}

/**
 * Who may call each of the harness engine's own tools. Kept in one place beside the list itself, so
 * the document's table and the bridge's gate are held to the same answer. A tool it doesn't name
 * yet is open where it only reads and the game master's where it writes: closed until someone says
 * who it is for (the listing test fails on one).
 */
export const HARNESS_OWN_NEEDS: ReadonlyMap<string, HarnessNeeds> = new Map(
  (
    [
      ["mind", ["mind_fight"]],
      ["read", ["checks_stakes", "fight_read", "gm_effects", "sections_read", "world_status", "world_read", "world_shape", "world_history", "world_made"]],
      ["author", ["time_pass", "commit", "grant_writes", "action_play", "fight_start", "fight_round", "fight_end"]],
      ["story", ["set_drop", "item_away"]],
      ["gm", ["person_make", "place_remove", "gm_take_out", "world_put", "world_remove", "world_set", "world_patch", "world_discard", "world_commit", "world_upgrade", "world_restore", "world_keep", "world_place", "world_path", "world_map", "world_map_place", "world_map_link", "world_map_settings"]],
      // The story record's (`harness-tools/story-record.ts`): each tool holds again who may call it, by the definition the caller runs as.
      ["mind", ["feed_read"]],
      ["read", ["beats_read", "cast_list", "drafts_due"]],
      ["any", ["beat_write", "beat_strike", "cast_set", "draft_open", "draft_settle", "draft_drop"]],
      // The mind tools (`harness-tools/story-minds.ts`): each holds again whose mind the caller reaches, by the call's `as` and the definition it runs as.
      ["mind", ["mind_digested"]],
      ["read", ["mind_read", "mind_seed"]],
      ["any", ["mind_write"]],
      // The narration tools (`harness-tools/story-stage.ts`): each holds again who may call it, by the definition the caller runs as and the settings' checker.
      ["read", ["narration_read", "passage_read"]],
      ["any", ["passage_draft", "passage_check"]],
      // The prepared start's (`harness-tools/story-prepare.ts`): the author's own plan and its steps, the historian's record of the chat's past.
      ["read", ["prepare_survey", "prepare_status", "stretch_read"]],
      ["author", ["prepare_plan", "prepare_relive", "prepare_outline", "prepare_finish"]],
      ["story", ["stretch_beats", "stretch_done"]],
    ] as const
  ).flatMap(([needs, tools]) => tools.map((name): [string, HarnessNeeds] => [name, needs])),
);

/** A paged read's schema with the cursor it reads on with (`ToolDefinition.pages`), which only the harness gives it. */
function withCursor(schema: JsonObject): JsonObject {
  return { ...schema, properties: { ...(isRecord(schema.properties) ? schema.properties : {}), cursor: text() } };
}

const ENTRIES: readonly Entry[] = [
  // An argument below the top level that the old engines leave to the description above it is described here too (`NESTED_ARG_TEXTS`): on the harness every argument has a text of its own. A read that pages its answer here is given its cursor, and states one page as its whole.
  ...TOOL_DEFINITIONS.filter((def) => !hasOwn(HARNESS_SUPERSEDED, def.name)).map((def): Entry => ({ name: def.name, family: def.family, tier: def.tier === "read" ? "read" : "write", writer: def.tier, needs: def.tier, args: [...(toolText(def.name)?.args ?? []), ...NESTED_ARG_TEXTS.filter((a) => a.tool === def.name)], parameters: (world) => (def.pages ? withCursor(def.parameters(world)) : def.parameters(world)), ...(def.pages ? { wholeChars: def.pages } : {}), run: (args, env) => def.run(args, env) })),
  ...HARNESS_TOOL_DEFINITIONS.map((def): Entry => ({ name: def.name, family: def.family, tier: def.tier, writer: null, needs: HARNESS_OWN_NEEDS.get(def.name) ?? (def.tier === "read" ? "read" : "gm"), args: harnessToolText(def.name)?.args ?? [], parameters: (world) => def.parameters(world), ...(def.wholeChars ? { wholeChars: def.wholeChars } : {}), run: (args, env) => def.run(args, env) })),
];

/** Every tool the harness lists: the old engines' own that it keeps, then the harness engine's. An agent definition is given its tools from these (`backend/harness/definitions`). */
export const HARNESS_LISTED: readonly HarnessListed[] = ENTRIES.map(({ name, family, tier, writer, needs }) => ({ name, family, tier, writer, needs }));

const RUNNERS: ReadonlyMap<string, Run> = new Map(ENTRIES.map((e) => [e.name, e.run]));

/**
 * The tools that run in RPEngine, as the harness lists them for a chat of `world` under the
 * player's `settings`: each with its family, its tier, its description and its arguments' in the
 * player's texts, its schema filled from the world as an agent may name it (`schemaWorld`), and,
 * for a tool read whole, how much of its answer reaches the model so.
 */
export function harnessTools(input: { world: WorldDoc; registry: Registry; settings: UserSettings }): RemoteTool[] {
  const { settings } = input;
  const { texts } = settings.prompts;
  const world = schemaWorld(input.world, input.registry);
  // A tool of the old engines' that works otherwise here is described for the harness in a text of its own (`HARNESS_DESCRIBED`): what those engines send stays theirs.
  return ENTRIES.map((e): RemoteTool => ({ name: e.name, family: e.family, tier: e.tier, description: renderPrompt(hasOwn(HARNESS_DESCRIBED, e.name) ? HARNESS_DESCRIBED[e.name] : toolTextId(e.name), texts, {}), parameters: describedSchema(e.name, e.args, e.parameters(world), texts), ...(e.wholeChars ? { wholeChars: e.wholeChars(settings) } : {}), source: "extension" }));
}

/**
 * The call's writer as its tools answer through it, in two ways unlike the bridge's own:
 * - A file a tool keeps goes to the harness's workspace when the call has one (`ToolEnv.files`):
 *   the writer still checks it (the caller's tier, the path, the mode of workspace notes), and the
 *   file is then written there at once, as LumiAH's own `workspace_write` writes one, instead of
 *   being staged with the turn. Where the player has workspace notes ask first it is staged after
 *   all, and waits on the review card like any other change.
 * - After the reply no turn is open, so the bridge's stage writes a change as it is made, and its
 *   answer says that instead of "when the turn commits".
 */
function writerOf(env: ToolEnv): ToolWriter | null {
  const writer = env.writer;
  const stage = writer?.stage?.bind(writer);
  const { turn, files } = env;
  if (!writer || !stage || !turn || (turn.reply === null && !files)) return writer;
  return {
    ...writer,
    dryRun: (op) => writer.dryRun(op),
    apply: (ops, label) => writer.apply(ops, label),
    stage: async (op) => {
      const view = await env.reader.view();
      if (files && op.kind === "ws_write") {
        const checked = await writer.dryRun(op);
        if ("refused" in checked) return checked;
        if (checked.mode === "confirm") return stage(op);
        const wrote = await files.write(op.path, op.text, (await files.read(op.path))?.version ?? null);
        if ("refused" in wrote) return { refused: true, code: wrote.refused.code, reason: wrote.refused.reason, key: checked.key };
        return { ...checked, mode: "auto", written: view.text(HARNESS_NOTE.filed, { path: op.path }) };
      }
      const out = await stage(op);
      return "refused" in out || turn.reply === null ? out : { ...out, written: view.text(HARNESS_NOTE.recorded) };
    },
  };
}

/**
 * Stages what a note tool noted. On the old engines a fact such a tool notes lands with the reply's
 * read (`ReadNotes`); the harness has no read, so each fact is staged as the change its own channel
 * makes of it, with the detail of the people it names (`applyProposals`), under its type's mode.
 * The proposal goes with it, for a type the user set to be confirmed.
 */
async function stageNotes(view: ToolReadView, turn: HarnessTurn, facts: readonly JsonObject[]): Promise<ToolOutcome> {
  const { registry: reg, world, state } = view;
  const staged: object[] = [];
  for (const fact of facts) {
    const changeType = CHANGE_TYPES.find((t) => t === fact.type);
    if (changeType === undefined) return view.refuse(WRITE_NOTE.badOp);
    const w = new Working(reg, world, state);
    // Each fact draws its own dice from the turn's seed, so the same fact staged again is the same change.
    const [made] = applyProposals(reg, w, [fact], hashParts("lre.harness.note", turn.seed, hashJson(fact)), turn.runSeed);
    const rejection = made?.rejection ?? null;
    const why = rejection ? (rejection.gm ?? rejection.reason) : made?.dropped;
    if (!made || why !== undefined) return { text: JSON.stringify({ refused: { code: rejection?.code ?? "refused", reason: why ?? "" } }), error: true };
    const lines = authorLines(reg, world, w.state, made.events, made.events.length);
    const out = await stageChange(view, turn, { key: hashJson(["lre.harness.note", fact]), changeType, events: [...made.materialized, ...made.events], lines, proposal: fact });
    if ("refused" in out) return out.refused;
    staged.push({ changeType, lines, lands: out.lands });
  }
  return view.answer(staged.length === 1 ? { staged: staged[0] } : { staged });
}

/**
 * A call's arguments as a tool is given them. What an agent supplies is what a model said, so no
 * string of it reaches a tool, the state or an answer in a form the host's macro engine acts on:
 * a macro's braces and the `<user>`-style shorthands are broken and control characters dropped
 * (`neutralizeMacros`). It is done here, where every call passes, so a tool added later is covered
 * too. A string that is itself JSON (an item of the world's document, a patch, a sheet's fields)
 * is neutralised inside, key by key and value by value: braces are its own syntax.
 */
function neutralized(value: JsonValue): JsonValue {
  if (typeof value === "string") {
    const start = value.trimStart()[0];
    if (start === "{" || start === "[") {
      try {
        const inner: unknown = JSON.parse(value);
        if (typeof inner === "object" && inner !== null) return JSON.stringify(neutralized(inner as JsonValue));
      } catch {
        // Not JSON after all: text like any other.
      }
    }
    return neutralizeMacros(value);
  }
  if (Array.isArray(value)) return value.map(neutralized);
  if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).map(([key, inner]) => [neutralizeMacros(key), neutralized(inner)]));
  return value;
}

/**
 * Runs the tool `name` with `env`, the env the bridge built for this call, and answers as LumiAH's
 * tool port takes an answer: text for the model, `error` when the call failed, in words that tell the
 * model what to do next. A refusal is an answer, never a rejection.
 */
export async function runHarnessTool(env: ToolEnv, name: string, args: JsonObject): Promise<{ text: string; error?: boolean }> {
  const run = RUNNERS.get(name);
  if (!run) return (await env.reader.view()).refuse(HARNESS_NOTE.noTool, { tool: name });
  const turn = env.turn;
  const noted: JsonObject[] = [];
  const notes: ReadNotes | undefined = env.notes ?? (turn ? { add: (fact) => !noted.some((n) => hashJson(n) === hashJson(fact)) && noted.push(fact) > 0 } : undefined);
  const out = await run(neutralized(args) as JsonObject, { ...env, writer: writerOf(env), ...(notes ? { notes } : {}), harness: true });
  const answer = turn && noted.length > 0 && out.error !== true ? await stageNotes(await env.reader.view(), turn, noted) : out;
  return answer.error === true ? { text: answer.text, error: true } : { text: answer.text };
}
