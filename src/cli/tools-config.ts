// The tools for the user's own LumiRPEngine setup, outside any world: Settings (every page of it,
// read and patched as the Settings pages patch it), the active preset's engine blocks, the caveats,
// and a chat's diagnostics and activity line. Settings belong to the user, not to a world: a change
// here is the same change the user would make in Settings, and shows there at once.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import { getAt, jsonEqual, pointerOf } from "../shared/json-patch";
import type { ResultBodies } from "../shared/protocol";
import type { DiagRecord } from "../shared/diagnostics";
import type { Args } from "./args";
import { boolArg, intArg, neededText, textArg, ToolError } from "./args";
import { LreError } from "./connection";
import type { Live } from "./live";
import { BODY_LIMIT, jsonText, readAt } from "./read";
import type { ToolResult } from "./report";
import { json } from "./report";
import type { ToolModule } from "./tool-module";
import type { ToolContext } from "./tools";
import { object } from "./tool-module";

/** The settings as the tools read them: the stored settings and each change type's effective mode. */
interface SettingsRoot {
  settings: JsonObject;
  extractionModes: JsonObject;
}

/** Which Settings page writes each part of the settings, for the agent to find its way. */
const SECTIONS: Readonly<Record<string, string>> = {
  helper: "Helper model: the connection (connectionId, null for Lumiverse's default), model, effort, maxTokens and sampling params every helper call runs on unless its step chooses otherwise.",
  modelUse: 'Model use (preset "lean", "standard", "full" or "custom"; budgets.pre and budgets.post: calls and lookup.calls; tokens.sections) and Steps and connections (steps.<purpose>: enabled, signals, route {provider, connectionId, model, effort, params}, template, maxTokens, lore, recent).',
  minds: 'Minds: on or off, the Live limit, refresh, memory levels and overrides, the Minds section\'s tokens, what a mind reads (reads.<source>: on and tokens, "none" for no limit; recall\'s tokens are memory.recall.tokens), their prompts, time-skip caps.',
  timeouts: "Timeouts: every wall clock the engine keeps (milliseconds, or \"none\").",
  realism: 'Realism for new chats (preset "story", "grounded", "simulation" or "custom"; levels per domain; tierCaps per band) and Player claims (claims: mode and capped).',
  overrideWorldDefaults: "Realism and Time: new chats use these settings over a world's own defaults.",
  adjudication: 'Checks for new chats (preset "narrative", "balanced", "crunchy" or "custom"; checks, riskyAt, trivialAt, impossibleAt, description, authority, closeBy, retry, retryAfter).',
  overrideWorldAdjudication: "Checks: new chats use these over a world's own adjudication.",
  time: "Time for new chats: sceneTicks, scale, interrupts, speedThrough, montage, unitCap.",
  extraction: 'Changes from the reply: a pinned mode per change type ("auto", "confirm", "never", maxDelta); null unpins one, so learning decides it again.',
  swipeDefault: 'Swipes: what a swipe does ("rerun" or "renarrate").',
  hideJsonBlocks: "Preset: hide each reply's <json> block in world chats.",
};

/** Each change type's effective mode, which Changes from the reply shows: derived, so read-only. */
const MODES_SECTION = "extractionModes";

/** A patch key no Settings page writes: the file's own bookkeeping. */
const NOT_PATCHED: Readonly<Record<string, string>> = { v: "the settings file's format", defaults: "which shipped defaults the file was last read against" };

/**
 * Where a manual change makes a named preset Custom, as the Settings pages do: a named preset sets
 * these itself, so a change without `preset: "custom"` would sit under a preset that no longer
 * describes it (and for checks, be dropped: a named adjudication preset ignores its fields).
 */
const MANUAL: readonly { part: string; keys: readonly string[] | "any"; preset: readonly [string, string] }[] = [
  { part: "realism", keys: ["levels", "tierCaps", "claims"], preset: ["realism", "preset"] },
  { part: "modelUse", keys: ["steps", "budgets", "tokens"], preset: ["modelUse", "preset"] },
  { part: "minds", keys: ["enabled", "liveLimit", "farRefreshMinutes", "refreshLimit", "memoryLevels", "tokens", "nearRefresh", "skip"], preset: ["modelUse", "preset"] },
  { part: "adjudication", keys: "any", preset: ["adjudication", "preset"] },
];

const CHAT_ID: JsonObject = { type: "string", description: "The chat's id (lre_chats lists the chats that play a world)." };

async function settingsRoot(live: Live): Promise<SettingsRoot> {
  const body = await live.conn.request("lre.settings.get", {});
  return { settings: body.settings as unknown as JsonObject, extractionModes: body.extraction as unknown as JsonObject };
}

async function settingsRead(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const section = textArg(args, "section");
  if (section !== undefined && !hasOwn(SECTIONS, section) && section !== MODES_SECTION) throw new ToolError(`There is no settings section ${section}. Sections: ${[...Object.keys(SECTIONS), MODES_SECTION].join(", ")}.`);
  const root = await settingsRoot(ctx.live());
  const base = section === undefined ? "" : section === MODES_SECTION ? `/${MODES_SECTION}` : `/settings/${section}`;
  const read = readAt(root, { what: "your LumiRPEngine settings", pointer: `${base}${textArg(args, "pointer") ?? ""}`, offset: intArg(args, "offset", 0, Number.MAX_SAFE_INTEGER) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
}

/** The leaves of a merge patch, by JSON Pointer into the settings: what each says the setting becomes (null: deleted). */
function leaves(patch: JsonValue, at: readonly string[] = []): { tokens: string[]; value: JsonValue }[] {
  if (!isRecord(patch)) return [{ tokens: [...at], value: patch }];
  const entries = Object.entries(patch);
  // An empty object merges as nothing changing there, so it says nothing to check.
  return entries.flatMap(([key, value]) => leaves(value as JsonValue, [...at, key]));
}

/** The patch with each named preset made Custom where it changes what that preset sets, and what that did. */
function withCustom(patch: JsonObject): { patch: JsonObject; custom: string[] } {
  const out = structuredClone(patch);
  const custom: string[] = [];
  for (const rule of MANUAL) {
    const part = out[rule.part];
    if (!isRecord(part)) continue;
    const touched = rule.keys === "any" ? Object.keys(part).filter((k) => k !== "preset") : rule.keys.filter((k) => hasOwn(part, k));
    if (touched.length === 0) continue;
    const [presetPart, presetKey] = rule.preset;
    const holder = out[presetPart];
    if (isRecord(holder) && hasOwn(holder, presetKey)) continue;
    out[presetPart] = { ...(isRecord(holder) ? holder : {}), [presetKey]: "custom" };
    custom.push(`${presetPart}.${presetKey} became "custom" (it changes ${touched.map((k) => `${rule.part}.${k}`).join(", ")}): Settings makes any change to what a named preset sets Custom.`);
  }
  return { patch: out, custom: [...new Set(custom)] };
}

async function settingsSet(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const given = args.patch;
  if (!isRecord(given) || Object.keys(given).length === 0) throw new ToolError('Give patch: a JSON merge patch over the settings, such as {"swipeDefault": "renarrate"} or {"realism": {"levels": {"money": 3}}}. lre_settings reads them.');
  const refused = Object.keys(given).filter((k) => hasOwn(NOT_PATCHED, k));
  if (refused.length > 0) throw new ToolError(`Nothing changed: ${refused.map((k) => `${k} is ${NOT_PATCHED[k] ?? k}`).join("; ")}, which no setting changes.`);
  const unknown = Object.keys(given).filter((k) => !hasOwn(SECTIONS, k));
  if (unknown.length > 0) throw new ToolError(`Nothing changed: there is no setting ${unknown.join(", ")}. Settings: ${Object.keys(SECTIONS).join(", ")}.`);
  const { patch, custom } = withCustom(given as JsonObject);
  const live = ctx.live();
  return ctx.serialize("settings", async () => {
    const before = await settingsRoot(live);
    const body = await live.conn.request("lre.settings.set", { patch });
    const after = { settings: body.settings as unknown as JsonValue, extractionModes: body.extraction as unknown as JsonValue };
    // What the backend made of the patch where it isn't what was sent: a value out of range, a preset's expansion, an unknown key.
    const adjusted = leaves(patch).flatMap(({ tokens, value }) => {
      const now = getAt(after.settings, tokens);
      if (value === null ? now === undefined : jsonEqual(now, value)) return [];
      return [{ pointer: pointerOf(tokens), sent: value, now: now ?? "(not set)" }];
    });
    const changed = Object.keys(SECTIONS).filter((k) => !jsonEqual(before.settings[k], isRecord(after.settings) ? after.settings[k] : undefined));
    const values = Object.fromEntries(changed.map((k) => [k, isRecord(after.settings) ? (after.settings[k] ?? null) : null]));
    // The caveats read the preset and the chat with the settings now; the backend waits a bounded time for them.
    const caveats = (await live.conn.request("lre.settings.caveats", {})).caveats;
    const shown = jsonText(values).length <= BODY_LIMIT / 2;
    return {
      text: json({
        changed,
        ...(shown ? { settings: values } : { note: `The changed sections are too large to show here: read them with lre_settings (section ${changed.join(", ")}).` }),
        ...(custom.length > 0 ? { presets: custom } : {}),
        ...(adjusted.length > 0 ? { adjusted, about: "LumiRPEngine keeps every setting within what it takes: these came out other than sent (a value out of range or of the wrong kind, a key it doesn't know, or a named preset's own values)." } : {}),
        caveats,
      }),
    };
  });
}

async function presetCard(live: Live, op: "get" | "add"): Promise<ResultBodies["lre.preset"]["card"]> {
  try {
    return (await live.conn.request("lre.preset", { op })).card;
  } catch (error) {
    if (error instanceof LreError && error.code === "not_found")
      throw new ToolError(`LumiRPEngine can't add the blocks (${error.message}). Lumiverse has no preset selected for prompts: select one in Lumiverse and ask again.`);
    throw error;
  }
}

const BLOCK_STATES = "Each guidance block is missing (the preset has no such block), empty (it has the block with only notes), read (switched off but written: LumiRPEngine gives its text to that helper) or enabled (switched on, so it also goes into the main prompt; it should be off).";

function diagRecord(record: DiagRecord): JsonObject {
  return JSON.parse(JSON.stringify({ ...record, start: new Date(record.start).toISOString(), end: undefined })) as JsonObject;
}

async function diagRead(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = neededText(args, "chatId", "the chat's id (lre_chats lists them)");
  const spoilers = boolArg(args, "spoilers");
  const last = intArg(args, "last", 1, 400) ?? 30;
  const failures = boolArg(args, "failures");
  const body = await ctx.live().conn.request("lre.diag", { chatId, op: "get" });
  const records = failures ? body.records.filter((r) => r.status === "failed" || r.level === "error" || r.level === "warn") : body.records;
  const byStatus: Record<string, number> = {};
  for (const r of body.records) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const summary = { chatId, activity: body.activity, records: body.records.length, byStatus };
  // Records are GM-level (a step's reason or a failure can name someone the player hasn't met): only behind the spoiler gate.
  if (!spoilers) return { text: json({ ...summary, note: "The records are GM-level: a step's reason or a failure may name what the player hasn't found. Pass spoilers: true to read them. The activity line is player-safe." }) };
  const shown: JsonObject[] = [];
  let room = BODY_LIMIT - 2000;
  for (const record of records.slice(-last).reverse()) {
    const entry = diagRecord(record);
    const size = jsonText(entry).length;
    if (size > room) break;
    room -= size;
    shown.unshift(entry);
  }
  return { text: json({ ...summary, shown: shown.length, of: records.length, ...(shown.length < Math.min(last, records.length) ? { note: "The oldest of those asked for didn't fit in one answer: ask for fewer with last." } : {}), list: shown }) };
}

export const CONFIG_TOOLS: readonly ToolModule[] = [
  {
    name: "lre_settings",
    description: `Read your LumiRPEngine settings, as Settings shows them: the whole (an outline when large), one section, or a JSON Pointer inside it. Settings are yours, not a world's: realism, checks and time seed new chats only (a running chat changes through its own markers). Sections, by the Settings page that writes them: ${Object.entries(SECTIONS)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" ")} ${MODES_SECTION}: each change type's effective mode and where it comes from (pinned, learned on the connection, or the default), read-only. Lumiverse's connection profiles (the ids a route names) are in Lumiverse's own Connections.`,
    inputSchema: object({
      section: { type: "string", enum: [...Object.keys(SECTIONS), MODES_SECTION], description: "Only this section." },
      pointer: { type: "string", description: 'A JSON Pointer inside it (inside the section when one is given): "/levels/money", "/steps/interpret". Without a section, the root holds settings and extractionModes.' },
      offset: { type: "integer", minimum: 0, description: "Read the value's JSON text from this character instead of outlining it; each page says where the next begins." },
    }),
    write: false,
    run: settingsRead,
    cli: { command: "settings", section: "Settings and presets", usage: "settings [<section>] [--pointer <p>] [--offset <n>]", summary: "Your settings, a section of them, or a pointer inside", positionals: ["section"], options: { "--pointer": { arg: "pointer", as: "text" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_settings_set",
    description:
      'Change your LumiRPEngine settings with a JSON merge patch (RFC 7386) over them, as the Settings pages do: objects merge, a list or a value replaces, null deletes (unpin a change type with {"extraction": {"purchase": null}}). A named preset (realism.preset, modelUse.preset) expands into its levels and caps, or its steps, budgets and minds policy; a change to what a named preset sets makes it "custom", as Settings does. LumiRPEngine keeps every setting within what it takes: the answer lists the sections that changed with their values now, anything that came out other than sent (adjusted), and the caveats (Settings → Caveats) as they read now. Realism, checks and time seed new chats only.',
    inputSchema: object({ patch: { type: "object", description: 'The merge patch: {"swipeDefault": "renarrate"}, {"modelUse": {"preset": "standard"}}, {"modelUse": {"steps": {"judge": {"enabled": true}}}}, {"timeouts": {"requestMs": 60000}}.' } }, ["patch"]),
    write: { destructive: true, idempotent: true },
    run: settingsSet,
    cli: { command: "settings-set", section: "Settings and presets", usage: "settings-set --patch <file|json>", summary: "Change settings with a JSON merge patch", options: { "--patch": { arg: "patch", as: "json" } } },
  },
  {
    name: "lre_settings_caveats",
    description: "What to know about your setup now (Settings → Caveats): the active preset's blocks the engine's sections conflict with or miss, a Lumiverse that can't stop a generation for the engine run, and the like, each with a code and a message. It builds a test prompt of the chat you play (a dry run), which takes a while on a long chat: when it isn't done yet, the answer says so; ask again in a moment.",
    inputSchema: object({}),
    write: false,
    run: async (_args, ctx) => ({ text: json(await ctx.live().conn.request("lre.settings.caveats", {})) }),
    cli: { command: "caveats", section: "Settings and presets", usage: "caveats", summary: "What to know about your setup now" },
  },
  {
    name: "lre_preset",
    description: `The active Lumiverse preset as LumiRPEngine reads it (Settings → Preset): its name, the section outlets its enabled blocks hold ({{outlet::lre_<section>}}, with the section each places, null when none has that name), and each engine guidance block ("RPEngine · <step>"). ${BLOCK_STATES} lre_preset_add_blocks adds the missing ones.`,
    inputSchema: object({}),
    write: false,
    run: async (_args, ctx) => ({ text: json({ card: await presetCard(ctx.live(), "get"), about: BLOCK_STATES }) }),
    cli: { command: "preset", section: "Settings and presets", usage: "preset", summary: "The active preset: outlets and engine blocks" },
  },
  {
    name: "lre_preset_add_blocks",
    description: "Add the engine's guidance blocks the active Lumiverse preset lacks (Settings → Preset → Add RPEngine blocks), under an RPEngine category, each switched off and holding only notes until written: the preset's own blocks stay as they are, and one already there is never touched. Writes the user's preset in Lumiverse. Answers the preset's card after, and which blocks it added.",
    inputSchema: object({}),
    write: { destructive: false, idempotent: true },
    run: async (_args, ctx) => {
      const live = ctx.live();
      const before = await presetCard(live, "get");
      const after = await presetCard(live, "add");
      const added = after.blocks.filter((b) => before.blocks.find((x) => x.target === b.target)?.state === "missing" && b.state !== "missing").map((b) => b.name);
      return { text: json({ added, card: after, about: BLOCK_STATES }) };
    },
    cli: { command: "preset-add-blocks", section: "Settings and presets", usage: "preset-add-blocks", summary: "Add the engine blocks the active preset lacks" },
  },
  {
    name: "lre_diag",
    description:
      "A chat's diagnostics (Settings → Diagnostics): the activity line (what the engine is doing for it now, or the step that failed last; player-safe), and the records of each turn's steps, model calls (connection, model, tokens, finish reason, time), failures and why, the sections each engine run wrote, and slow requests. The records are GM-level, since a step's reason can name what the player hasn't found: without spoilers: true only their counts come back. last: the newest records to show (default 30); failures: only failed, warning and error records.",
    inputSchema: object({ chatId: CHAT_ID, spoilers: { type: "boolean", description: "Show the records themselves." }, last: { type: "integer", minimum: 1, maximum: 400, description: "The newest records to show (default 30)." }, failures: { type: "boolean", description: "Only failed steps, warnings and errors." } }, ["chatId"]),
    write: false,
    run: diagRead,
    cli: { command: "diag", section: "Diagnostics", usage: "diag <chatId> [--spoilers] [--last <n>] [--failures]", summary: "A chat's activity line and diagnostics", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, "--last": { arg: "last", as: "int" }, "--failures": { arg: "failures", as: "flag" } } },
  },
  {
    name: "lre_diag_clear",
    description: "Forget a chat's diagnostics records (Diagnostics → Clear). The chat and its world don't change; the records start again with the next turn.",
    inputSchema: object({ chatId: CHAT_ID }, ["chatId"]),
    write: { destructive: true, idempotent: true },
    run: async (args, ctx) => {
      const chatId = neededText(args, "chatId", "the chat's id");
      const body = await ctx.live().conn.request("lre.diag", { chatId, op: "clear" });
      return { text: json({ chatId, cleared: true, activity: body.activity }) };
    },
    cli: { command: "diag-clear", section: "Diagnostics", usage: "diag-clear <chatId>", summary: "Forget a chat's diagnostics records", positionals: ["chatId"], needs: 1 },
  },
  {
    name: "lre_activity_dismiss",
    description: "Clear a failure from a chat's activity line (the HUD's and the drawer's in-flight line), as its dismiss button does. A turn in progress stays shown; the diagnostics records stay.",
    inputSchema: object({ chatId: CHAT_ID }, ["chatId"]),
    write: { destructive: false, idempotent: true },
    run: async (args, ctx) => {
      const chatId = neededText(args, "chatId", "the chat's id");
      const body = await ctx.live().conn.request("lre.diag", { chatId, op: "dismiss" });
      return { text: json({ chatId, activity: body.activity }) };
    },
    cli: { command: "activity-dismiss", section: "Diagnostics", usage: "activity-dismiss <chatId>", summary: "Clear a failure from a chat's activity line", positionals: ["chatId"], needs: 1 },
  },
];
