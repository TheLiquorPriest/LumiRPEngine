// The rest of Build the world tools don't reach (DESIGN §11, §12, §15): the head's lint, the Sheet
// Designer's preview, a ruleset profile applied to the draft in one write, LumiRPEngine Studio's
// offer and its install, and a chat's map: how it shows, and what Walk here takes.

import { createRegistry, type Registry } from "../engine/registry-impl";
import { ALL_PACKS } from "../packs/index";
import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { planProfile, PROFILE_IDS, PROFILES, type ProfileChoice, type ProfileId } from "../shared/profiles/index";
import type { JsonPatchOp, ResultBodies } from "../shared/protocol";
import { FIDELITIES } from "../shared/minds";
import { DEFAULT_ROUTINE_SETTINGS, ROUTINE_SETTING_VALUES, routineSettingsOf, routineSettingsProblems } from "../shared/routines";
import type { EditorBody as DraftRead } from "./live";
import type { Args } from "./args";
import { boolArg, intArg, neededText, textArg, textsArg, ToolError } from "./args";
import { LreError } from "./connection";
import { changesBetween, countsOf } from "./diff";
import { readAt } from "./read";
import type { ToolResult } from "./report";
import { json, lintSummary } from "./report";
import type { ToolModule } from "./tool-module";
import { object } from "./tool-module";
import type { ToolContext } from "./tools";

const WORLD_ID: JsonObject = { type: "string", description: "The world's id (w_…), from lre_worlds." };
const CHAT_ID: JsonObject = { type: "string", description: "The chat's id (lre_chats lists the chats that play a world)." };
const EXPECT_VERSION: JsonObject = { type: "integer", minimum: 0, description: "The draft version you last read: refused if the draft has moved on since, so a change you haven't seen is never overwritten." };

/** Each routine setting and the values it takes, read from the table a write is held to, so the tool never names fewer than LumiRPEngine takes. */
const ROUTINE_SETTINGS_TAKEN = Object.entries(ROUTINE_SETTING_VALUES)
  .map(([key, allowed]) => (allowed === "switch" ? `${key} (true or false)` : "levels" in allowed ? `${key} ({${FIDELITIES.join(", ")}} each one of ${allowed.levels.map((v) => `"${v}"`).join(", ")})` : `${key} (${allowed.map((v) => `"${v}"`).join(", ")})`))
  .join(", ");

/** The engine's packs, read once: a profile plans against the kinds they define, as the backend applies it. */
let packs: Registry | null = null;

const worldIdOf = (args: Args): string => neededText(args, "worldId", "the world's id (lre_worlds lists them)");

async function profileTool(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const id = neededText(args, "profile", `the profile: ${PROFILE_IDS.join(", ")}`);
  if (!hasOwn(PROFILES, id)) throw new ToolError(`There is no profile ${id}. Profiles: ${PROFILE_IDS.map((p) => `${p} (${PROFILES[p].label}: ${PROFILES[p].summary})`).join("; ")}.`);
  const profile = PROFILES[id as ProfileId];
  const take = textsArg(args, "take") ?? [];
  const expected = intArg(args, "expectVersion", 0, Number.MAX_SAFE_INTEGER);
  const live = ctx.live();
  const reg = (packs ??= createRegistry(ALL_PACKS));
  const kinds = Object.fromEntries(reg.kinds);
  const plan = (doc: Parameters<typeof planProfile>[0], choices: Record<string, ProfileChoice>) => planProfile(doc, profile, kinds, choices);
  const read = await live.draft(worldId);
  if (expected !== undefined && read.version !== expected) throw new ToolError(`Nothing applied: the draft of ${worldId} is at version ${read.version}, not ${expected}. It was written since you read it (by the user in Build, or another agent). Read it again (lre_draft), then apply against version ${read.version}.`);
  const conflicts = plan(read.draft, {}).items.filter((i) => i.status === "conflict").map((i) => i.path);
  const strange = take.filter((path) => !conflicts.includes(path));
  if (strange.length > 0) throw new ToolError(`${strange.join(", ")} ${strange.length === 1 ? "is" : "are"} no conflict of the ${profile.label} profile with this draft. Its conflicts: ${conflicts.join(", ") || "none"}.`);
  const choices: Record<string, ProfileChoice> = Object.fromEntries(take.map((path) => [path, "profile" as const]));
  const planned = plan(read.draft, choices);
  const summary = {
    profile: { id: profile.id, label: profile.label, summary: profile.summary },
    kind: planned.kind,
    add: planned.items.filter((i) => i.status === "add").map((i) => ({ path: i.path, label: i.label })),
    conflicts: planned.items.filter((i) => i.status === "conflict").map((i) => ({ path: i.path, label: i.label, pick: choices[i.path] ?? "mine" })),
    same: planned.items.filter((i) => i.status === "same").length,
    people: planned.people,
    values: planned.values,
  };
  if (boolArg(args, "preview")) return { text: json({ worldId, version: read.version, ...summary, note: "Nothing changed. A conflicting item keeps the draft's own unless take names its path." }) };
  return ctx.serialize(`world:${worldId}`, async () => {
    let after: ResultBodies["lre.editor"];
    try {
      after = await live.conn.request("lre.editor", { op: "profile", worldId, base: read.base, version: read.version, profile: profile.id, choices });
    } catch (error) {
      if (error instanceof LreError && error.code === "conflict") throw new ToolError(`Nothing applied: the draft of ${worldId} was written since it was read (version ${read.version}). Read it again (lre_draft) and apply against its version.`);
      throw error;
    }
    const changes = changesBetween(read.draft, after.draft);
    return { text: json({ worldId, version: after.version, ...summary, changed: countsOf(changes), items: changes.slice(0, 40), moreItems: Math.max(0, changes.length - 40), lint: lintSummary(after.lint, 12), next: "It is in the draft (Build's too): lre_commit makes it the head." }) };
  });
}

async function sheetTool(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const worldId = worldIdOf(args);
  const entity = textArg(args, "entity");
  const live = ctx.live();
  const given = args.ruleset;
  if (given !== undefined && !isRecord(given)) throw new ToolError("ruleset is an object: the world's ruleset as it would be (the draft's own when left out).");
  // The draft's own ruleset when none is given: the preview then shows the sheet a new chat would start with.
  const ruleset = (given ?? (await live.draft(worldId)).draft.ruleset ?? {}) as JsonValue;
  const body = await live.conn.request("lre.world", { op: "sheet", worldId, ruleset, ...(entity !== undefined ? { entity } : {}) });
  if (body.sheet === null || body.sheet === undefined) return { text: json({ worldId, sheet: null, note: "The ruleset designs no sheet (ruleset.sheet)." }) };
  const read = readAt({ worldId, entity: entity ?? "the point of view", sheet: body.sheet }, { what: "the sheet preview", offset: intArg(args, "offset", 0, Number.MAX_SAFE_INTEGER) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
}

async function installTool(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const offerId = neededText(args, "offerId", "the offer's id (lre_studio_offer reviews it)");
  const hash = neededText(args, "hash", "the offer's hash, as lre_studio_offer reviewed it");
  const body = await ctx.live().conn.request("lre.studio", { op: "install", offerId, hash, ...(boolArg(args, "acceptMovedHead") ? { acceptMovedHead: true } : {}) });
  const review = body.lint ?? [];
  return { text: json({ installed: body.installed ?? null, macroReview: review, ...(review.length > 0 ? { note: "Review each macro before playing the world: Lumiverse runs macros in lore and templates when it builds a prompt." } : {}) }) };
}

export const BUILD_TOOLS: readonly ToolModule[] = [
  {
    name: "lre_lint",
    description: "Lint a world's head revision as LumiRPEngine does on your Lumiverse, with every rule of the engine and its packs: errors first. lre_draft lints the draft; lre_check lints a file on this machine.",
    inputSchema: object({ worldId: WORLD_ID }, ["worldId"]),
    write: false,
    run: async (args, ctx) => {
      const worldId = worldIdOf(args);
      const live = ctx.live();
      const [index, body] = await Promise.all([live.index(worldId), live.conn.request("lre.world", { op: "lint", worldId })]);
      return { text: json({ worldId, name: index.name, revision: index.head, lint: lintSummary(body.lint ?? [], 30) }) };
    },
    cli: { command: "lint", section: "Build", usage: "lint <worldId>", summary: "Lint the head revision on your Lumiverse", positionals: ["worldId"], needs: 1 },
  },
  {
    name: "lre_sheet",
    description: "The Sheet Designer's preview (Build → Ruleset → Sheet): the character sheet a new chat would start with, read on entity (default the point of view), section by section with each row's label and value, built from the draft with ruleset in place of its own (the draft's own when left out). Nothing is saved: write a ruleset with lre_edit at /ruleset.",
    inputSchema: object({ worldId: WORLD_ID, ruleset: { type: "object", description: "The ruleset to preview (the world's /ruleset as it would be); default the draft's own." }, entity: { type: "string", description: "The entity whose sheet to read (default the point of view)." }, offset: { type: "integer", minimum: 0, description: "Read the answer's JSON text from this character instead of outlining it." } }, ["worldId"]),
    write: false,
    run: sheetTool,
    cli: { command: "sheet", section: "Build", usage: "sheet <worldId> [--ruleset <file|json>] [--entity <id>] [--offset <n>]", summary: "Preview the character sheet a new chat starts with", positionals: ["worldId"], needs: 1, options: { "--ruleset": { arg: "ruleset", as: "json" }, "--entity": { arg: "entity", as: "text" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_profile",
    description: `Apply a ruleset profile to the world's draft in one write (Build → Ruleset → Start from a profile): its fields on the people's kind, its checks, actions, data tables, progression, sheet, minimum levels and adjudication. Profiles: ${PROFILE_IDS.map((p) => `${p} (${PROFILES[p].label}: ${PROFILES[p].summary})`).join("; ")}. Each item is added, the same already, or a conflict with the draft's own, which stays the draft's unless take names its path; values: people's stored values a taken field can't hold, and what they become. With preview, only say what it would do. The draft is the user's Build draft too: pass expectVersion.`,
    inputSchema: object(
      {
        worldId: WORLD_ID,
        profile: { type: "string", enum: [...PROFILE_IDS], description: "The profile." },
        take: { type: "array", items: { type: "string" }, description: 'The conflicts to take the profile\'s side of, by path ("checks.skill", "ruleset.sheet"); the rest keep the draft\'s.' },
        preview: { type: "boolean", description: "Only say what it would add, keep and change." },
        expectVersion: EXPECT_VERSION,
      },
      ["worldId", "profile"],
    ),
    write: { destructive: true, idempotent: true },
    run: profileTool,
    cli: { command: "profile", section: "Build", usage: "profile <worldId> <profile> [--take <path> …] [--preview] [--expect-version <n>]", summary: "Apply a ruleset profile to the draft", positionals: ["worldId", "profile"], needs: 2, options: { "--take": { arg: "take", as: "many" }, "--preview": { arg: "preview", as: "flag" }, "--expect-version": { arg: "expectVersion", as: "int" } } },
  },
  {
    name: "lre_studio_offer",
    description: "The world LumiRPEngine Studio offers now, reviewed as Build reviews it before anything is installed: new world or next revision of one of yours (target), its name, items per collection, the engine's lint (errors first), the macros in its lore and templates, the chat it wants attached, why it can't be installed as it is (blocked), whether the target's head moved since the Studio took it (headMoved), and the hash lre_studio_install names it by. Null, with why, when there is none.",
    inputSchema: object({}),
    write: false,
    run: async (_args, ctx) => {
      const body = await ctx.live().conn.request("lre.studio", { op: "offer" });
      return { text: json(body.offer ? { offer: body.offer } : { offer: null, message: body.message ?? "LumiRPEngine Studio offers nothing now." }) };
    },
    cli: { command: "studio-offer", section: "Build", usage: "studio-offer", summary: "Review LumiRPEngine Studio's offer" },
  },
  {
    name: "lre_studio_install",
    description: "Install the LumiRPEngine Studio offer you reviewed with lre_studio_offer, by its offerId and hash: a new world, or the next revision of one of yours, which becomes its head. Refused when the Studio offers something else since the review, when it is blocked or already installed, and, when the target's head moved since the Studio took it, unless acceptMovedHead (the new head then leaves out what was committed since). Answers what it became, with the macros to review before playing it.",
    inputSchema: object({ offerId: { type: "string", description: "The offer's id." }, hash: { type: "string", description: "The offer's hash, as reviewed." }, acceptMovedHead: { type: "boolean", description: "Install over a head that moved since the Studio took it." } }, ["offerId", "hash"]),
    write: { destructive: true, idempotent: true },
    run: installTool,
    cli: { command: "studio-install", section: "Build", usage: "studio-install <offerId> <hash> [--accept-moved-head]", summary: "Install the reviewed Studio offer", positionals: ["offerId", "hash"], needs: 2, options: { "--accept-moved-head": { arg: "acceptMovedHead", as: "flag" } } },
  },
  {
    name: "lre_map_display",
    description: 'How a chat\'s map shows (Play → Map): "knowledge" (what the point of view knows) or "fog" (fog of war over what they haven\'t seen). Presentation only, kept beside the chat, never in its story: the world and the chat\'s state don\'t change.',
    inputSchema: object({ chatId: CHAT_ID, display: { type: "string", enum: ["knowledge", "fog"], description: "How the map shows." } }, ["chatId", "display"]),
    write: { destructive: false, idempotent: true },
    run: async (args, ctx) => {
      const chatId = neededText(args, "chatId", "the chat's id");
      const display = neededText(args, "display", '"knowledge" or "fog"');
      if (display !== "knowledge" && display !== "fog") throw new ToolError('display is "knowledge" or "fog".');
      const body = await ctx.live().conn.request("lre.map", { chatId, display });
      return { text: json({ chatId, display: body.display ?? display }) };
    },
    cli: { command: "map-display", section: "Play", usage: "map-display <chatId> <knowledge|fog>", summary: "How a chat's map shows", positionals: ["chatId", "display"], needs: 2 },
  },
  {
    name: "lre_map_walk",
    description: "What Walk here would take in a chat, to a cell of the grid the point of view stands on (x, y): its minutes, or why it can't be walked. Judged on the real ground, as the step action is, so it holds under fog. It only asks: nothing moves.",
    inputSchema: object({ chatId: CHAT_ID, x: { type: "integer", description: "The cell's column." }, y: { type: "integer", description: "The cell's row." } }, ["chatId", "x", "y"]),
    write: false,
    run: async (args, ctx) => {
      const chatId = neededText(args, "chatId", "the chat's id");
      const x = intArg(args, "x", -1_000_000, 1_000_000);
      const y = intArg(args, "y", -1_000_000, 1_000_000);
      if (x === undefined || y === undefined) throw new ToolError("Give x and y: the cell's column and row on the grid the point of view stands on.");
      const body = await ctx.live().conn.request("lre.map", { chatId, op: "walk", x, y });
      return { text: json({ chatId, x, y, ...(body.walk ?? { minutes: 0, disabled: "LumiRPEngine didn't say." }) }) };
    },
    cli: { command: "map-walk", section: "Play", usage: "map-walk <chatId> --x <n> --y <n>", summary: "What Walk here takes to a cell", positionals: ["chatId"], needs: 1, options: { "--x": { arg: "x", as: "int" }, "--y": { arg: "y", as: "int" } } },
  },
  ...itemTools("routines", "routine", "lre_routine", "lre_routines"),
  ...itemTools("schedules", "schedule", "lre_schedule", "lre_schedules"),
  {
    name: "lre_routine_settings",
    description: `A world draft's routine settings (DESIGN §8): ${ROUTINE_SETTINGS_TAKEN}. Without value it reads them; with value it sets them whole (a part left out takes its default; the defaults remove them). A setting or value the engine doesn't take is refused, naming it. Pass expectVersion so a change made since is refused.`,
    inputSchema: object({ worldId: WORLD_ID, value: { type: "object", description: "The settings to set, whole." }, expectVersion: EXPECT_VERSION }, ["worldId"]),
    write: { destructive: true, idempotent: true },
    run: async (args, ctx) => {
      const worldId = worldIdOf(args);
      const live = ctx.live();
      const read = await live.draft(worldId);
      if (args.value === undefined) return { text: json({ worldId, version: read.version, settings: routineSettingsOf(read.draft) }) };
      if (!isRecord(args.value)) throw new ToolError(`value is an object: {${Object.keys(ROUTINE_SETTING_VALUES).map((key) => `${key}?`).join(", ")}}.`);
      // The defaults are no settings; anything else goes as sent, so LumiRPEngine refuses a bad one as it refuses Build's.
      const same = routineSettingsProblems(args.value).length === 0 && JSON.stringify(routineSettingsOf({ routineSettings: args.value })) === JSON.stringify(DEFAULT_ROUTINE_SETTINGS);
      const ops = same ? (read.draft.routineSettings === undefined ? [] : [{ op: "remove" as const, path: "/routineSettings" }]) : [{ op: "add" as const, path: "/routineSettings", value: args.value as JsonObject }];
      return draftPatch(ctx, worldId, read, ops, intArg(args, "expectVersion", 0, Number.MAX_SAFE_INTEGER), "routineSettings");
    },
    cli: { command: "routine-settings", section: "Build", usage: "routine-settings <worldId> [--value <json>] [--expect-version <n>]", summary: "Read or set a world's routine settings", positionals: ["worldId"], needs: 1, options: { "--value": { arg: "value", as: "json" }, "--expect-version": { arg: "expectVersion", as: "int" } } },
  },
];

/** A JSON Pointer token: `~` and `/` escaped. */
function token(id: string): string {
  return id.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Applies a patch to a draft at the version read (or the one expected), answering the new version and the lint under `path`. */
async function draftPatch(ctx: ToolContext, worldId: string, read: DraftRead, ops: JsonPatchOp[], expected: number | undefined, path: string): Promise<ToolResult> {
  if (expected !== undefined && read.version !== expected) throw new ToolError(`Nothing applied: the draft of ${worldId} is at version ${read.version}, not ${expected}. Read it again, then apply against version ${read.version}.`);
  if (ops.length === 0) return { text: json({ worldId, version: read.version, note: "Nothing to change." }) };
  return ctx.serialize(`world:${worldId}`, async () => {
    let after: ResultBodies["lre.editor"];
    try {
      after = await ctx.live().conn.request("lre.editor", { op: "patch", worldId, base: read.base, version: read.version, ops });
    } catch (error) {
      if (error instanceof LreError && error.code === "conflict") throw new ToolError(`Nothing applied: the draft of ${worldId} was written since it was read (version ${read.version}). Read it again and apply against its version.`);
      // A write LumiRPEngine refuses (a malformed routine, a setting it doesn't take) says why, as Build's save does.
      if (error instanceof LreError && (error.code === "bad_request" || error.code === "validation")) throw new ToolError(`Nothing applied: LumiRPEngine refused it. ${error.message}`);
      throw error;
    }
    return { text: json({ worldId, version: after.version, lint: lintSummary(after.lint.filter((i) => i.path === path || i.path.startsWith(`${path}.`)), 20), next: "It is in the draft (Build's too): lre_commit makes it the head." }) };
  });
}

/**
 * List, get, put and delete tools for one world collection (routines or schedules) of a draft, each
 * through the draft's patch at the version read. LumiRPEngine checks a routine's shape as it checks
 * Build's put; a schedule's outline is checked here before it is sent.
 */
function itemTools(collection: "routines" | "schedules", noun: string, one: string, many: string): ToolModule[] {
  const ID: JsonObject = { type: "string", description: `The ${noun}'s id.` };
  const shape = (value: unknown): string[] => (collection === "routines" || (isRecord(value) && typeof value.target === "string" && isRecord(value.recurrence) && Array.isArray(value.slots)) ? [] : ["a schedule has a target, a recurrence and slots"]);
  // The draft's collection as plain JSON: what the tools read and answer.
  const items = (read: DraftRead): Record<string, JsonValue> => {
    const raw: unknown = read.draft[collection];
    return isRecord(raw) ? (raw as Record<string, JsonValue>) : {};
  };
  return [
    {
      name: many,
      description: `A world draft's ${collection} (DESIGN §8): each ${noun}'s id, label or target, owner and size. ${one} reads one whole.`,
      inputSchema: object({ worldId: WORLD_ID }, ["worldId"]),
      write: false,
      run: async (args, ctx) => {
        const worldId = worldIdOf(args);
        const read = await ctx.live().draft(worldId);
        const list = Object.entries(items(read)).map(([id, v]) => {
          const o = isRecord(v) ? v : {};
          return { id, ...(typeof o.label === "string" ? { label: o.label } : {}), ...(typeof o.target === "string" ? { target: o.target } : {}), owner: o.owner ?? null, size: Array.isArray(o.blocks) ? o.blocks.length : Array.isArray(o.slots) ? o.slots.length : 0 };
        });
        return { text: json({ worldId, version: read.version, [collection]: list }) };
      },
      cli: { command: many.replace(/^lre_/, ""), section: "Build", usage: `${many.replace(/^lre_/, "")} <worldId>`, summary: `List a world's ${collection}`, positionals: ["worldId"], needs: 1 },
    },
    {
      name: one,
      description: `One ${noun} of a world draft, whole, with its lint.`,
      write: false,
      inputSchema: object({ worldId: WORLD_ID, id: ID }, ["worldId", "id"]),
      run: async (args, ctx) => {
        const worldId = worldIdOf(args);
        const id = neededText(args, "id", `the ${noun}'s id (${many} lists them)`);
        const read = await ctx.live().draft(worldId);
        const value = items(read)[id];
        if (value === undefined || !hasOwn(items(read), id)) throw new ToolError(`The draft of ${worldId} has no ${noun} ${id}.`);
        return { text: json({ worldId, version: read.version, id, [noun]: value }) };
      },
      cli: { command: one.replace(/^lre_/, ""), section: "Build", usage: `${one.replace(/^lre_/, "")} <worldId> <id>`, summary: `Read one of a world's ${collection}`, positionals: ["worldId", "id"], needs: 2 },
    },
    {
      name: `${one}_put`,
      description: `Create or replace one ${noun} of a world draft, whole (${collection === "routines" ? "{id, label?, owner?, inherit?, blocks: [{id, label, activity, kind: fixed|flexible|optional, at|window, minutes, perWeek?, chance?, priority?, days?, place?, company?, needs?, private?, source?}] or {id, off: true}}, source?}" : "{id, owner?, target, recurrence, slots: [{start, end, value?, source?}], source?}"}). A malformed one is refused, naming the field, and nothing is written; the answer has the new version and its lint. Pass expectVersion so a change made since is refused.`,
      inputSchema: object({ worldId: WORLD_ID, id: ID, value: { type: "object", description: `The ${noun}, whole; its id is the one given.` }, expectVersion: EXPECT_VERSION }, ["worldId", "id", "value"]),
      write: { destructive: true, idempotent: true },
      run: async (args, ctx) => {
        const worldId = worldIdOf(args);
        const id = neededText(args, "id", `the ${noun}'s id`);
        if (!isRecord(args.value)) throw new ToolError(`value is the ${noun}, an object.`);
        const value = { ...args.value, id } as JsonObject;
        const problems = shape(value);
        if (problems.length > 0) throw new ToolError(`Nothing applied: ${problems.join("; ")}.`);
        const read = await ctx.live().draft(worldId);
        const ops: JsonPatchOp[] = [...(isRecord(read.draft[collection]) ? [] : [{ op: "add" as const, path: `/${collection}`, value: {} }]), { op: "add", path: `/${collection}/${token(id)}`, value }];
        return draftPatch(ctx, worldId, read, ops, intArg(args, "expectVersion", 0, Number.MAX_SAFE_INTEGER), `${collection}.${id}`);
      },
      cli: { command: `${one.replace(/^lre_/, "")}-put`, section: "Build", usage: `${one.replace(/^lre_/, "")}-put <worldId> <id> --value <file|json> [--expect-version <n>]`, summary: `Create or replace one of a world's ${collection}`, positionals: ["worldId", "id"], needs: 2, options: { "--value": { arg: "value", as: "json" }, "--expect-version": { arg: "expectVersion", as: "int" } } },
    },
    {
      name: `${one}_delete`,
      description: `Delete one ${noun} of a world draft. Pass expectVersion so a change made since is refused.`,
      inputSchema: object({ worldId: WORLD_ID, id: ID, expectVersion: EXPECT_VERSION }, ["worldId", "id"]),
      write: { destructive: true, idempotent: true },
      run: async (args, ctx) => {
        const worldId = worldIdOf(args);
        const id = neededText(args, "id", `the ${noun}'s id`);
        const read = await ctx.live().draft(worldId);
        if (!hasOwn(items(read), id)) throw new ToolError(`The draft of ${worldId} has no ${noun} ${id}.`);
        return draftPatch(ctx, worldId, read, [{ op: "remove", path: `/${collection}/${token(id)}` }], intArg(args, "expectVersion", 0, Number.MAX_SAFE_INTEGER), `${collection}.${id}`);
      },
      cli: { command: `${one.replace(/^lre_/, "")}-delete`, section: "Build", usage: `${one.replace(/^lre_/, "")}-delete <worldId> <id> [--expect-version <n>]`, summary: `Delete one of a world's ${collection}`, positionals: ["worldId", "id"], needs: 2, options: { "--expect-version": { arg: "expectVersion", as: "int" } } },
    },
  ];
}
