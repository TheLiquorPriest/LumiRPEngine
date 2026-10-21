// The tools that play a chat on the user's Lumiverse (`lre_chat_state`, `lre_fix`, `lre_action`…):
// what the chat's page reads (its state view, chips and inspector) and what Play's controls send
// (✎ fixes, markers, chip answers, Keep, opening a panel, palette actions and timelapses), with the
// GM view, GM edits and character minds behind `spoilers: true`. An outside client is no page
// (DESIGN §23): the engine prepares a turn it asks for, but only Lumiverse starts the reply.

import { DOMAINS, INTERRUPT_CLASSES } from "../shared/ids";
import type { DomainId, Level } from "../shared/ids";
import type { ClaimsPolicy } from "../shared/claims";
import type { InferredChecks } from "../shared/inferred";
import type { JsonObject, JsonValue } from "../shared/json";
import { isRecord } from "../shared/json";
import type { EventRef, ResolveScope, TimeControl, TimeScope } from "../shared/ledger";
import type { EditOp, ResultBodies } from "../shared/protocol";
import type { Chip } from "../shared/state-view";
import { chipRegenerates } from "../shared/state-view";
import type { AdjudicationDef } from "../shared/world";
import { TIME_CONTROLS } from "../engine/events";
import type { Args } from "./args";
import { boolArg, intArg, neededText, textArg, textsArg, ToolError } from "./args";
import type { RequestFields, RequestType } from "./connection";
import { LreError } from "./connection";
import { readAt } from "./read";
import type { ToolResult } from "./report";
import { json } from "./report";
import type { ToolModule } from "./tool-module";
import { object } from "./tool-module";
import type { ToolContext } from "./tools";

const SECTION = "Playing a chat on Lumiverse";
const MAX_OFFSET = Number.MAX_SAFE_INTEGER;

const CHAT_ID: JsonObject = { type: "string", description: "The chat's id (lre_chats lists the chats that play a world)." };
const POINTER: JsonObject = { type: "string", description: 'A JSON Pointer into it (RFC 6901): "" for an outline of the whole, "/hud" for one part. In a key, "~1" stands for "/" and "~0" for "~".' };
const OFFSET: JsonObject = { type: "integer", minimum: 0, description: "Read the value's JSON text from this character instead of outlining it; each page says where the next begins." };
const SPOILERS: JsonObject = { type: "boolean", description: "Must be true: this shows (or answers with) what the player isn't meant to know. Pass it only when the user asked to see behind the curtain." };
const PENDING = "The chat is in the middle of a reply: this lands when the reply finishes.";

/**
 * What an outside client can't do: start the reply. Lumiverse's generation for the new message is
 * stopped by the engine's guard while the engine prepares the turn, and only a page restarts it
 * (DESIGN §5.1); a page that shows the chat does so on its own, else the next page to open it.
 */
const REPLY =
  "The engine prepares the turn now (the plan, the checks, the time it takes), but the reply is started by Lumiverse, not by this client: when the user has this chat open in Lumiverse, its page starts the reply on its own; otherwise the reply waits until the chat is next opened there. Ask the user to open the chat if it isn't. lre_chat_state's activity says where the turn stands, and its state shows what the turn did once the reply is in.";

const chatIdOf = (args: Args): string => neededText(args, "chatId", "the chat's id (lre_chats lists the chats that play a world)");

/** Refuses a spoiler-gated tool unless the caller said `spoilers: true`, before anything is asked of the host. */
function gate(args: Args, name: string, shows: string): void {
  if (!boolArg(args, "spoilers")) throw new ToolError(`${name} ${shows}, which the player isn't meant to know. Call it again with spoilers: true, only if the user asked you to look behind the curtain.`);
}

/** Sends one chat request; the refusals an agent can act on say what to do next. */
async function ask<T extends RequestType>(ctx: ToolContext, chatId: string, type: T, fields: RequestFields<T>): Promise<ResultBodies[T]> {
  try {
    return await ctx.live().conn.request(type, fields);
  } catch (error) {
    if (error instanceof LreError && error.code === "not_world_chat") throw new ToolError(`Chat ${chatId} plays no world (or there is no such chat): lre_chats lists the chats that play one, and lre_attach attaches a world to a chat.`);
    if (error instanceof LreError && error.code === "paused") throw new ToolError(`Chat ${chatId} is paused: an earlier message of the player's was edited, and nothing changes until that is settled. Read /keepReport with lre_chat_state, then answer with lre_keep (keep or discard).`);
    throw error;
  }
}

/** A read tool's answer: the value at a pointer, outlined or paged as lre_world reads a world. */
function readOut(root: unknown, what: string, args: Args): ToolResult {
  const read = readAt(root, { what, pointer: textArg(args, "pointer") ?? "", offset: intArg(args, "offset", 0, MAX_OFFSET) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
}

/** A write's answer: what was done, with the note a held write needs. */
function written(chatId: string, done: JsonObject, pending: boolean): ToolResult {
  return { text: json({ chatId, ...done, pending, ...(pending ? { note: PENDING } : {}) }) };
}

/** A chip as the agent reads it: each action says when Lumiverse has to regenerate the reply to finish it. */
function chipOut(chip: Chip): JsonValue {
  return {
    id: chip.id,
    kind: chip.kind,
    messageId: chip.messageId,
    ...(chip.swipeId !== undefined ? { swipeId: chip.swipeId } : {}),
    label: chip.label,
    ...(chip.detail !== undefined ? { detail: chip.detail } : {}),
    actions: chip.actions.map((a): JsonValue => ({ id: a.id, label: a.label, ...(a.style !== undefined ? { style: a.style } : {}), ...(a.input !== undefined ? { input: JSON.parse(JSON.stringify(a.input)) as JsonValue } : {}), ...(chipRegenerates(chip.kind, a.id) ? { regenerates: true } : {}) })),
    expires: chip.expires,
  };
}

const stateOf = async (ctx: ToolContext, chatId: string): Promise<ResultBodies["lre.state.get"]> => ask(ctx, chatId, "lre.state.get", { chatId });

// ---------------------------------------------------------------- reads

async function chatState(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const { view, activity } = await stateOf(ctx, chatId);
  return readOut({ ...view, activity }, `the state view of chat ${chatId} (world ${view.worldId ?? "none"}, revision ${view.revision ?? "none"}, ${view.status})`, args);
}

async function chips(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const { view } = await stateOf(ctx, chatId);
  return {
    text: json({
      chatId,
      status: view.status,
      chips: view.chips.map(chipOut),
      ...(view.keepReport.length > 0 ? { keepReport: JSON.parse(JSON.stringify(view.keepReport)) as JsonValue } : {}),
      about: "Answer one with lre_chip {chatId, chip, choice}. An action marked regenerates is finished only by Lumiverse regenerating the reply, which the user does in the chat.",
    }),
  };
}

async function inspector(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const { view } = await stateOf(ctx, chatId);
  return readOut(view.panels["core.context"] ?? null, `the context inspector of chat ${chatId} (the last engine runs, newest first, and its warnings)`, args);
}

async function gmView(args: Args, ctx: ToolContext): Promise<ToolResult> {
  gate(args, "lre_gm", "shows everything in the chat, secrets, hidden people and places and characters' minds included");
  const chatId = chatIdOf(args);
  return readOut(await ask(ctx, chatId, "lre.gm", { chatId }), `the GM view of chat ${chatId}: everything as it stands, secrets included`, args);
}

async function minds(args: Args, ctx: ToolContext): Promise<ToolResult> {
  gate(args, "lre_minds", "shows characters' private minds, plans and notes");
  const chatId = chatIdOf(args);
  const [gm, status] = await Promise.all([ask(ctx, chatId, "lre.gm", { chatId }), ask(ctx, chatId, "lre.minds", { chatId, op: "status" })]);
  return readOut({ ...gm.minds, run: status.run }, `the character minds of chat ${chatId} (secrets included), with the latest Run minds now`, args);
}

// ---------------------------------------------------------------- writes

const HUD_FIXES = ["place", "weather", "cash", "scene"] as const;

function fixTool(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const time = textArg(args, "time");
  const named = textArg(args, "fix");
  const entity = textArg(args, "entity");
  const field = textArg(args, "field");
  const hasValue = args.value !== undefined;
  if (time !== undefined && (named !== undefined || entity !== undefined || field !== undefined || hasValue)) throw new ToolError("Give time alone (the clock), or a field and its value: one fix at a time.");
  if (named !== undefined && (entity !== undefined || field !== undefined)) throw new ToolError("Give fix (a HUD fix's name) or entity and field, not both.");
  if (time === undefined && !hasValue) throw new ToolError("Give value: what the field should hold. Or time, to set the clock.");
  return ctx.serialize(`chat:${chatId}`, async () => {
    if (time !== undefined) {
      const body = await ask(ctx, chatId, "lre.fix", { chatId, time });
      return written(chatId, { fixed: { time } }, body.pending);
    }
    let target = { entity: entity ?? "", field: field ?? "" };
    if (named !== undefined) {
      const fix = HUD_FIXES.find((f) => f === named);
      if (fix === undefined) throw new ToolError(`fix is one of ${HUD_FIXES.join(", ")} (the HUD's ✎ fixes), not ${JSON.stringify(named)}. For any other field give entity and field.`);
      const found = (await stateOf(ctx, chatId)).view.hud?.fixes[fix];
      if (found === undefined) throw new ToolError(`Chat ${chatId}'s HUD has no ${fix} fix now (lre_chat_state shows the fixes it has at /hud/fixes).`);
      target = { entity: found.entity, field: found.field };
    } else if (entity === undefined || field === undefined) throw new ToolError("Give entity and field (the field to fix), or fix (place, weather, cash or scene), or time.");
    const value = args.value as JsonValue;
    const body = await ask(ctx, chatId, "lre.fix", { chatId, entity: target.entity, field: target.field, value });
    return written(chatId, { fixed: { ...target, value } }, body.pending);
  });
}

/** The edit operations as given, each an object naming its op; the backend checks each against what it touches. */
function editOps(args: Args, only?: readonly string[]): EditOp[] {
  const raw = args.ops;
  if (!Array.isArray(raw) || raw.length === 0) throw new ToolError("Give ops: a list of edit operations, each an object with its op.");
  if (raw.length > 200) throw new ToolError(`That is ${raw.length} operations; send at most 200 at once.`);
  raw.forEach((op: unknown, i) => {
    if (!isRecord(op) || typeof op.op !== "string") throw new ToolError(`ops[${i}] isn't an operation: each is an object with its op ("set", "move", "mind_pin"…).`);
    if (only !== undefined && !only.includes(op.op)) throw new ToolError(`ops[${i}] is ${op.op}; this tool takes ${only.join(", ")}. lre_gm_edit takes every GM edit.`);
  });
  return raw as EditOp[];
}

function gmEdit(args: Args, ctx: ToolContext, name: string, only?: readonly string[]): Promise<ToolResult> {
  gate(args, name, "edits the chat as the GM does, hidden things included, and its refusals name them");
  const chatId = chatIdOf(args);
  const ops = editOps(args, only);
  return ctx.serialize(`chat:${chatId}`, async () => {
    const body = await ask(ctx, chatId, "lre.edit", { chatId, ops });
    return written(chatId, { applied: ops.length, note: "One GM edit, all or nothing, with an Undo chip (lre_chips)." }, body.pending);
  });
}

const MARKER_KINDS = ["resolve", "time", "claims", "adjudicate", "infer"] as const;
// Every marker kind the protocol takes is this tool's, but an Upgrade's (lre_upgrade): a new kind
// fails the typecheck here until the tool sets it.
const MARKER_KINDS_COVERED: [Exclude<RequestFields<"lre.marker">["kind"], (typeof MARKER_KINDS)[number] | "migrate">] extends [never] ? true : never = true;
void MARKER_KINDS_COVERED;

/** The marker request as the kind takes it; the backend checks the values and refuses one it can't read. */
function markerFields(chatId: string, args: Args): RequestFields<"lre.marker"> {
  const kind = MARKER_KINDS.find((k) => k === textArg(args, "kind"));
  if (kind === undefined) throw new ToolError(`kind is one of ${MARKER_KINDS.join(", ")} (an Upgrade is lre_upgrade).`);
  const preview = boolArg(args, "preview") ? { preview: true as const } : {};
  const to = args.to;
  if (to === undefined) throw new ToolError("Give to: the value the marker sets.");
  const scope = args.scope ?? { all: true };
  if (!isRecord(scope)) throw new ToolError('scope is an object: {"all": true} (the default), or as the kind takes it.');
  if (kind === "resolve") {
    const domain = DOMAINS.find((d) => d === textArg(args, "domain"));
    if (domain === undefined) throw new ToolError(`A realism marker needs domain, one of ${DOMAINS.join(", ")}.`);
    return { chatId, kind, domain: domain satisfies DomainId, scope: scope as ResolveScope, to: to as Level, ...preview };
  }
  if (kind === "time") {
    const control = TIME_CONTROLS.find((c) => c === textArg(args, "control"));
    if (control === undefined) throw new ToolError(`A time marker needs control, one of ${TIME_CONTROLS.join(", ")}.`);
    return { chatId, kind, control: control satisfies TimeControl, scope: scope as TimeScope, to: to as JsonValue, ...preview };
  }
  if (kind === "claims") return { chatId, kind, to: to as unknown as ClaimsPolicy, ...preview };
  if (kind === "infer") return { chatId, kind, to: to as unknown as InferredChecks, ...preview };
  return { chatId, kind, to: to as unknown as AdjudicationDef, ...preview };
}

function marker(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const fields = markerFields(chatId, args);
  return ctx.serialize(`chat:${chatId}`, async () => {
    let body: ResultBodies["lre.marker"];
    try {
      body = await ask(ctx, chatId, "lre.marker", fields);
    } catch (error) {
      if (error instanceof LreError && error.code === "bad_request") throw new ToolError(`LumiRPEngine can't read that marker (${error.message}). Check its values against what lre_chat_state shows at /controls, which is what each kind sets, and the shapes this tool's schema describes.`);
      throw error;
    }
    if (fields.preview === true) return { text: json({ chatId, preview: (body.preview?.lines ?? []).map((l) => ({ text: l.text, tone: l.tone })), note: "Nothing was written: call again without preview to set it." }) };
    return written(chatId, { set: fields.kind, note: "It holds from the chat's latest message on; lre_chat_state shows it at /controls." }, body.pending);
  });
}

function chipTool(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const id = neededText(args, "chip", "the chip's id (lre_chips lists them)");
  const choice = neededText(args, "choice", "one of the chip's action ids (lre_chips lists them)");
  const payload = args.payload;
  if (payload !== undefined && !isRecord(payload)) throw new ToolError('payload is an object: {"cents": 899} for an amount, {"value": "…"} for a choice.');
  return ctx.serialize(`chat:${chatId}`, async () => {
    const chip = (await stateOf(ctx, chatId)).view.chips.find((c) => c.id === id);
    if (chip === undefined) throw new ToolError(`Chat ${chatId} has no chip ${id} now (a chip lapses at the next send, and goes once answered): lre_chips lists the ones it has.`);
    if (!chip.actions.some((a) => a.id === choice)) throw new ToolError(`The chip ${id} has no action ${choice}; its actions: ${chip.actions.map((a) => `${a.id} (${a.label})`).join(", ")}.`);
    // A plain Regenerate is the frontend's own: nothing to send, and only a page can do it.
    if (choice === "regenerate") throw new ToolError(`${chip.label}: ${choice} only regenerates the reply, which Lumiverse does, not this client: ask the user to press Regenerate (or swipe) in the chat.`);
    const body = await ask(ctx, chatId, "lre.chip", { chatId, chip: id, choice, ...(isRecord(payload) ? { payload: payload as JsonObject } : {}) });
    const sends = chip.kind === "choice" && choice === "send";
    return {
      text: json({
        chatId,
        chip: id,
        choice,
        applied: body.applied,
        pending: body.pending,
        ...(body.pending ? { note: PENDING } : {}),
        ...(chipRegenerates(chip.kind, choice) ? { reply: "This takes effect on the reply's next swipe, which Lumiverse makes: ask the user to press Regenerate (or swipe) in the chat." } : {}),
        ...(sends ? { reply: REPLY } : {}),
      }),
    };
  });
}

const KEEP_CHOICES = ["keep", "discard", "convert"] as const;

function keep(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const choice = KEEP_CHOICES.find((c) => c === textArg(args, "choice"));
  if (choice === undefined) throw new ToolError(`choice is one of ${KEEP_CHOICES.join(", ")}.`);
  const messageId = neededText(args, "messageId", "the edited message's id (the keep report's lines name it)");
  return ctx.serialize(`chat:${chatId}`, async () => {
    let fields: RequestFields<"lre.keep">;
    if (choice === "convert") {
      const parentPath = neededText(args, "parentPath", "the keep report line's parentPath");
      const refs = args.refs;
      if (!Array.isArray(refs) || refs.length === 0 || !refs.every(isRecord)) throw new ToolError("Give refs: the keep report lines' ref objects to convert, as /keepReport shows them.");
      fields = { chatId, choice, messageId, parentPath, refs: refs as unknown as EventRef[] };
    } else fields = { chatId, choice, messageId };
    const body = await ask(ctx, chatId, "lre.keep", fields);
    return written(chatId, { choice, messageId }, body.pending);
  });
}

function viewOpen(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const panel = neededText(args, "panel", 'the panel\'s id, a key of /panels in lre_chat_state ("money.hub", "core.context"…)');
  const entity = textArg(args, "entity") ?? null;
  return ctx.serialize(`chat:${chatId}`, async () => {
    const body = await ask(ctx, chatId, "lre.view.open", { chatId, panel, entity });
    const note =
      panel === "core.context"
        ? "The inspector checks the active preset on a dry run of the prompt after this: read lre_inspector (its warnings) again in a moment."
        : body.materialized
          ? "Opening it settled detail the chat hadn't decided yet: lre_chat_state shows it now."
          : "Nothing needed settling: the panel reads as it was.";
    return written(chatId, { panel, entity, materialized: body.materialized, note }, body.pending);
  });
}

function action(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const id = neededText(args, "action", "the action's id (lre_chat_state lists the palette's at /palette/entries)");
  const params = args.params ?? {};
  if (!isRecord(params)) throw new ToolError("params is an object: the picked option's params, as /palette/entries/<i>/options/<j>/params shows them.");
  const text = textArg(args, "text");
  return ctx.serialize(`chat:${chatId}`, async () => {
    const body = await ask(ctx, chatId, "lre.action", { chatId, action: id, params: params as JsonObject, source: "palette", ...(text !== undefined && text.trim() !== "" ? { text } : {}) });
    return { text: json({ chatId, action: id, messageId: body.messageId, reply: REPLY }) };
  });
}

function timelapse(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const target = args.target;
  if (!isRecord(target) || typeof target.type !== "string") throw new ToolError('Give target: how far to skip, such as {"type": "duration", "minutes": 120} (lre_chat_state lists the choices at /palette/timelapse/until).');
  const overrides = args.overrides ?? {};
  if (!isRecord(overrides)) throw new ToolError(`overrides is an object of interrupt classes (${INTERRUPT_CLASSES.join(", ")}) to stop, note or ignore.`);
  const text = textArg(args, "text");
  return ctx.serialize(`chat:${chatId}`, async () => {
    const offered = (await stateOf(ctx, chatId)).view.palette?.timelapse ?? null;
    if (offered === null) throw new ToolError(`Chat ${chatId} offers no timelapse now (lre_chat_state's /palette/timelapse is null).`);
    if (offered.blocked !== null) throw new ToolError(`Chat ${chatId} can't timelapse now: ${offered.blocked}`);
    const params: JsonObject = { target: target as JsonObject, overrides: overrides as JsonObject };
    const body = await ask(ctx, chatId, "lre.action", { chatId, action: offered.action, params, source: "palette", ...(text !== undefined && text.trim() !== "" ? { text } : {}) });
    return { text: json({ chatId, action: offered.action, target: target as JsonObject, messageId: body.messageId, reply: REPLY }) };
  });
}

function mindsRun(args: Args, ctx: ToolContext): Promise<ToolResult> {
  gate(args, "lre_minds_run", "answers with which characters' minds it runs, the hidden ones included");
  const chatId = chatIdOf(args);
  const who = textsArg(args, "who");
  return ctx.serialize(`chat:${chatId}`, async () => {
    const body = await ask(ctx, chatId, "lre.minds", { chatId, op: "run", ...(who !== undefined ? { who } : {}) });
    return { text: json({ chatId, run: body.run as unknown as JsonValue, note: "It runs in the background, with model calls on the user's connection, and records the minds as one GM edit with an Undo chip. lre_minds shows its progress at /run; lre_minds_cancel stops it." }) };
  });
}

function mindsCancel(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const runId = neededText(args, "runId", "the run's id (lre_minds shows it at /run/runId)");
  return ctx.serialize(`chat:${chatId}`, async () => {
    const run = (await ask(ctx, chatId, "lre.minds", { chatId, op: "cancel", runId })).run;
    // Only how it went: the run's entries name the characters it ran, hidden ones included.
    if (run === null || run.runId !== runId) throw new ToolError(`Chat ${chatId} has no run ${runId}${run === null ? "" : ` (its latest is ${run.runId}, ${run.status})`}: lre_minds shows the latest at /run.`);
    if (run.status !== "running") return { text: json({ chatId, runId, stopped: false, status: run.status, note: `It had already ended (${run.status}): nothing to stop.` }) };
    return { text: json({ chatId, runId, stopped: true, note: "It stops at its next step and records nothing; lre_minds shows it cancelled at /run/status." }) };
  });
}

// ---------------------------------------------------------------- the tools

const OPS_ITEM: JsonObject = { type: "object", properties: { op: { type: "string" } }, required: ["op"] };
const MIND_OPS = ["mind_pin", "mind_refresh", "mind_memory"] as const;

export const PLAY_TOOLS: readonly ToolModule[] = [
  {
    name: "lre_chat_state",
    description:
      "Read a chat's state view at a JSON Pointer: what the player sees in Play, the same view the chat's page is sent. /hud (clock, place, weather, cash, and its ✎ fixes at /hud/fixes), /scene (who is present), /chips, /journal, /keepReport (when status is paused), /palette (the actions at /palette/entries, the timelapse at /palette/timelapse), /controls (realism, time controls, player claims and the checks policy the chat plays by), /panels (each pack's panel, the inspector at /panels/core.context), /currency, and activity: what the engine is doing for the chat now (null when idle). Only what the player can know: lre_gm has the rest. A large part comes back as an outline to read deeper from.",
    inputSchema: object({ chatId: CHAT_ID, pointer: POINTER, offset: OFFSET }, ["chatId"]),
    write: false,
    run: chatState,
    cli: { command: "chat", section: SECTION, usage: "chat <chatId> [--pointer <p>] [--offset <n>]", summary: "A chat's state view, as Play shows it", positionals: ["chatId"], needs: 1, options: { "--pointer": { arg: "pointer", as: "text" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_chips",
    description: "A chat's chips: the confirmations, Undo, Retry, suggested moves and other choices under its messages, each with its id, kind, message and actions (and the value an action asks for first, as input). An action marked regenerates is finished only by Lumiverse regenerating the reply. The keep report too, when it has lines. Answer a chip with lre_chip.",
    inputSchema: object({ chatId: CHAT_ID }, ["chatId"]),
    write: false,
    run: chips,
    cli: { command: "chips", section: SECTION, usage: "chips <chatId>", summary: "A chat's chips and their actions", positionals: ["chatId"], needs: 1 },
  },
  {
    name: "lre_inspector",
    description: "A chat's context inspector at a JSON Pointer: the last ten engine runs, newest first (/generations: each section the engine wrote into the prompt, its tokens and whether it was delivered, the budget, what each model step read of the lore, and the minds calls, with no text), and its standing warnings (/warnings: the lore book, the preset's caveats, journal notices). Player-safe, as the chat's own inspector is. lre_view_open with panel core.context checks the active preset again.",
    inputSchema: object({ chatId: CHAT_ID, pointer: POINTER, offset: OFFSET }, ["chatId"]),
    write: false,
    run: inspector,
    cli: { command: "inspector", section: SECTION, usage: "inspector <chatId> [--pointer <p>] [--offset <n>]", summary: "A chat's context inspector", positionals: ["chatId"], needs: 1, options: { "--pointer": { arg: "pointer", as: "text" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_gm",
    description:
      "A chat's GM view at a JSON Pointer: everything as it stands, secrets included. Every entity (/entities: fields, relations, levels, classes, life state, who knows it), kinds, tiers, places, tracks with their stages and truths, relation types, everyone's money, the fight as the GM sees it, the ✎ fixes and GM edits in force (/edits), refused writes, and character minds (/minds). Needs spoilers: true. Ids from here are what lre_gm_edit's operations name.",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, pointer: POINTER, offset: OFFSET }, ["chatId", "spoilers"]),
    write: false,
    run: gmView,
    cli: { command: "gm", section: SECTION, usage: "gm <chatId> --spoilers [--pointer <p>] [--offset <n>]", summary: "A chat's GM view, secrets included", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, "--pointer": { arg: "pointer", as: "text" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_minds",
    description: "A chat's character minds at a JSON Pointer, as GM → Minds shows them: whether minds are on, the secrecy, the clock, and every character but the POV (/characters, closest on the ladder first: fidelity and why, pins, the latest mind, plans, notes, commitments and summary), with the latest Run minds now at /run. Needs spoilers: true. Change them with lre_mind_edit; run them with lre_minds_run.",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, pointer: POINTER, offset: OFFSET }, ["chatId", "spoilers"]),
    write: false,
    run: minds,
    cli: { command: "minds", section: SECTION, usage: "minds <chatId> --spoilers [--pointer <p>] [--offset <n>]", summary: "A chat's character minds and their latest run", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, "--pointer": { arg: "pointer", as: "text" }, "--offset": { arg: "offset", as: "int" } } },
  },
  {
    name: "lre_fix",
    description:
      'A ✎ fix, as the player corrects the HUD: set one field on the chat\'s latest message, or the clock. fix names a HUD fix (place, weather, cash, scene: lre_chat_state shows each at /hud/fixes with its entity, field, type, value now and options); or give entity and field for any other field the player can fix; value is what it should hold, in the field\'s type (money in minor units: 2500 is 25.00). time sets the clock instead: "YYYY-MM-DD HH:MM" in the world\'s calendar where the POV is (later runs the time between; earlier sets it back). A locked field is refused. It leaves an Undo chip (lre_chips).',
    inputSchema: object({ chatId: CHAT_ID, fix: { type: "string", enum: [...HUD_FIXES], description: "A HUD fix, instead of entity and field." }, entity: { type: "string", description: "The entity's id." }, field: { type: "string", description: "The field's id." }, value: { description: "The field's new value." }, time: { type: "string", description: 'Or the clock: "YYYY-MM-DD HH:MM".' } }, ["chatId"]),
    write: { destructive: true, idempotent: true },
    run: fixTool,
    cli: {
      command: "fix",
      section: SECTION,
      usage: "fix <chatId> (--fix <name> | --entity <id> --field <id>) --value <json> | --time <YYYY-MM-DD HH:MM>",
      summary: "A ✎ fix to a field or the clock",
      positionals: ["chatId"],
      needs: 1,
      options: { "--fix": { arg: "fix", as: "text" }, "--entity": { arg: "entity", as: "text" }, "--field": { arg: "field", as: "text" }, "--value": { arg: "value", as: "json" }, "--time": { arg: "time", as: "text" } },
    },
  },
  {
    name: "lre_gm_edit",
    description:
      'GM edits on the chat\'s latest message (GM view → Edit): the operations in order, all or none, as one edit with an Undo chip; locked fields are writable. Each names its op: set {entity, field, value}; add {entity, field, delta}; link {rel, from, to, fields?, until?}; unlink {rel, from, to}; move {entity, to: place}; put {entity, into: entity or null}; adjust {account, cents} (money in or out against a correction); stage {track, to}; entity {entity, tier?, agent?, levels?}; classify {entity, class, tags}; life {entity, to?, tell?}; spawn {kind, name, id?, tier?, place?, agent?}; despawn {entity}; restore {entity}; mind_pin, mind_refresh, mind_memory (as lre_mind_edit); effect {effect, args}. Ids come from lre_gm. Needs spoilers: true.',
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, ops: { type: "array", minItems: 1, maxItems: 200, items: OPS_ITEM, description: 'The operations, applied in order: [{"op": "set", "entity": "pov", "field": "mood", "value": "calm"}].' } }, ["chatId", "spoilers", "ops"]),
    write: { destructive: true, idempotent: false },
    run: (args, ctx) => gmEdit(args, ctx, "lre_gm_edit"),
    cli: { command: "gm-edit", section: SECTION, usage: "gm-edit <chatId> --ops <file|json> --spoilers", summary: "GM edits, all or none", positionals: ["chatId"], needs: 1, options: { "--ops": { arg: "ops", as: "json" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_mind_edit",
    description:
      'Change characters\' minds (GM → Minds), as one GM edit with an Undo chip: mind_pin {entity, level: "live", "near", "far", "background", or null to unpin} pins a character\'s fidelity; mind_refresh {entity} asks for a fresh mind next turn; mind_memory {entity, part: "note", "commitment" or "plan", id, value} edits one (value: the fields to change), adds one (id null; value needs its text, and a plan its what and when) or deletes one (value null). lre_minds shows the ids. Needs spoilers: true.',
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, ops: { type: "array", minItems: 1, maxItems: 200, items: { type: "object", properties: { op: { type: "string", enum: [...MIND_OPS] } }, required: ["op", "entity"] }, description: 'The operations, in order: [{"op": "mind_pin", "entity": "danny_okafor", "level": "live"}].' } }, ["chatId", "spoilers", "ops"]),
    write: { destructive: true, idempotent: false },
    run: (args, ctx) => gmEdit(args, ctx, "lre_mind_edit", MIND_OPS),
    cli: { command: "mind-edit", section: SECTION, usage: "mind-edit <chatId> --ops <file|json> --spoilers", summary: "Pin, refresh or edit characters' minds", positionals: ["chatId"], needs: 1, options: { "--ops": { arg: "ops", as: "json" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_marker",
    description:
      'Change how the chat plays from its latest message on (Settings → This chat, Play → Calendar), as a marker. kind resolve: realism, domain at level to (0–4), scope {"all": true}, {"tier": "principal"|"supporting"|"background"} or {"entity": id}. kind time: a time control (tick per scene type, scale, pause, interrupt, speed_through, montage, unit_cap) set to to, scope {"all": true}, {"sceneType": id}, {"activity": id} or {"interrupt": class}. kind claims: to is the player-claims policy {"mode": "real"|"ask"|"hold", "capped": bool}. kind adjudicate: to is the whole checks policy, as lre_chat_state shows it at /controls/adjudication, changed where you want. kind infer: to is the whole inferred-checks policy (when typed attempts roll skill checks), as lre_chat_state shows it at /controls/inferred, changed where you want. lre_chat_state\'s /controls has every current value. With preview, says what it would change (demotions freeze, promotions settle) and writes nothing. An Upgrade is lre_upgrade.',
    inputSchema: object(
      {
        chatId: CHAT_ID,
        kind: { type: "string", enum: [...MARKER_KINDS] },
        domain: { type: "string", enum: [...DOMAINS], description: "resolve: the domain." },
        control: { type: "string", enum: [...TIME_CONTROLS], description: "time: the control." },
        scope: { type: "object", description: 'resolve and time: whom or where it holds for; default {"all": true}.' },
        to: { description: "The value it sets." },
        preview: { type: "boolean", description: "Only say what it would change." },
      },
      ["chatId", "kind", "to"],
    ),
    write: { destructive: false, idempotent: true },
    run: marker,
    cli: {
      command: "marker",
      section: SECTION,
      usage: "marker <chatId> --kind <resolve|time|claims|adjudicate|infer> --to <json> [--domain <d>] [--control <c>] [--scope <json>] [--preview]",
      summary: "Set realism, a time control, player claims, the checks policy or inferred checks",
      positionals: ["chatId"],
      needs: 1,
      options: { "--kind": { arg: "kind", as: "text" }, "--to": { arg: "to", as: "json" }, "--domain": { arg: "domain", as: "text" }, "--control": { arg: "control", as: "text" }, "--scope": { arg: "scope", as: "json" }, "--preview": { arg: "preview", as: "flag" } },
    },
  },
  {
    name: "lre_chip",
    description: `Answer a chip as the player taps it: choice is one of its action ids (lre_chips), payload the value an action asks for first ({"cents": 899} for an amount, {"value": id} for a pick). Confirm, Undo, Dismiss, Keep and the like apply at once. An action lre_chips marks regenerates (Re-narrate, Re-run, Retry read, Add…) is finished by Lumiverse regenerating the reply: the user presses Regenerate or swipes in the chat; a plain Regenerate is only that, so it is refused here. A suggested move's Send posts it as the player's message: ${REPLY}`,
    inputSchema: object({ chatId: CHAT_ID, chip: { type: "string", description: "The chip's id (lre_chips)." }, choice: { type: "string", description: "One of its action ids." }, payload: { type: "object", description: "The value an action asks for first." } }, ["chatId", "chip", "choice"]),
    write: { destructive: true, idempotent: false },
    run: chipTool,
    cli: { command: "chip", section: SECTION, usage: "chip <chatId> <chipId> <choice> [--payload <json>]", summary: "Answer a chip", positionals: ["chatId", "chip", "choice"], needs: 3, options: { "--payload": { arg: "payload", as: "json" } } },
  },
  {
    name: "lre_keep",
    description:
      "Settle a paused chat (lre_chat_state's status is paused: the player edited an earlier message of theirs after later turns were played on it). messageId is the edited message. keep re-checks the later turns against the edit and lists what no longer holds in the keep report (lre_chat_state's /keepReport). discard removes the later turns' records for good (their messages stay as plain text, and the world forgets what happened in them; it can't be undone), so ask the user first. convert brings chosen dropped lines of the keep report back: give each line's ref in refs, with its parentPath.",
    inputSchema: object({ chatId: CHAT_ID, choice: { type: "string", enum: [...KEEP_CHOICES] }, messageId: { type: "string", description: "The edited message's id." }, parentPath: { type: "string", description: "convert: the line's parentPath." }, refs: { type: "array", items: { type: "object" }, description: "convert: the lines' ref objects." } }, ["chatId", "choice", "messageId"]),
    write: { destructive: true, idempotent: true },
    run: keep,
    cli: { command: "keep", section: SECTION, usage: "keep <chatId> <keep|discard|convert> <messageId> [--parent-path <p>] [--refs <json>]", summary: "Keep or discard after an earlier edit", positionals: ["chatId", "choice", "messageId"], needs: 3, options: { "--parent-path": { arg: "parentPath", as: "text" }, "--refs": { arg: "refs", as: "json" } } },
  },
  {
    name: "lre_view_open",
    description: 'Open a panel as the player does: panel is a key of lre_chat_state\'s /panels ("money.hub"…), entity whom it is about (default the POV). Opening detail the chat hasn\'t decided yet settles it (an account\'s balance first looked at, say), as a write on the latest message; lre_chat_state shows it after. Opening core.context (the inspector) checks the active preset on a dry run instead.',
    inputSchema: object({ chatId: CHAT_ID, panel: { type: "string", description: "The panel's id." }, entity: { type: "string", description: "Whom it is about; default the POV." } }, ["chatId", "panel"]),
    write: { destructive: false, idempotent: true },
    run: viewOpen,
    cli: { command: "view-open", section: SECTION, usage: "view-open <chatId> <panel> [--entity <id>]", summary: "Open a panel, settling its detail", positionals: ["chatId", "panel"], needs: 2, options: { "--entity": { arg: "entity", as: "text" } } },
  },
  {
    name: "lre_action",
    description: `Play an action from the palette as the player's next turn: action is an entry's action id (lre_chat_state's /palette/entries), params the picked option's params merged in order (each option's params; an amount or count goes under the entry's amount or number param). text, when given, is the player's words for how they do it (the judge rates them); without it the message is the action's label. It posts the player's message. ${REPLY}`,
    inputSchema: object({ chatId: CHAT_ID, action: { type: "string", description: "The action's id." }, params: { type: "object", description: "The option's params." }, text: { type: "string", description: "The player's words for it." } }, ["chatId", "action"]),
    write: { destructive: false, idempotent: false },
    run: action,
    cli: { command: "act", section: SECTION, usage: "act <chatId> <action> [--params <json>] [--text <words>]", summary: "Play a palette action as the next turn", positionals: ["chatId", "action"], needs: 2, options: { "--params": { arg: "params", as: "json" }, "--text": { arg: "text", as: "text" } } },
  },
  {
    name: "lre_timelapse",
    description: `Skip time as the palette's timelapse does, as the player's next turn: target is how far, as /palette/timelapse/until lists them ({"type": "duration", "minutes": 120}, {"type": "day_part", "dayPart": id}, {"type": "shift"}, {"type": "commitment"}, {"type": "arrival"}, {"type": "at", "at": game minutes}, {"type": "stage", "track", "stage"}, {"type": "interrupt"}); overrides changes what interrupts it for this skip ({class: "stop"|"note"|"ignore"}, the classes at /palette/timelapse/interrupts). Refused when the chat offers none, or says why it can't now. ${REPLY}`,
    inputSchema: object({ chatId: CHAT_ID, target: { type: "object", description: "How far to skip." }, overrides: { type: "object", description: "Interrupt classes to stop, note or ignore for this skip." }, text: { type: "string", description: "The player's words for it." } }, ["chatId", "target"]),
    write: { destructive: false, idempotent: false },
    run: timelapse,
    cli: { command: "timelapse", section: SECTION, usage: "timelapse <chatId> --target <json> [--overrides <json>] [--text <words>]", summary: "Skip time as the next turn", positionals: ["chatId"], needs: 1, options: { "--target": { arg: "target", as: "json" }, "--overrides": { arg: "overrides", as: "json" }, "--text": { arg: "text", as: "text" } } },
  },
  {
    name: "lre_minds_run",
    description: "Run minds now (GM → Minds): ask the minds of who (character ids; default everyone Live and Near) at the chat's latest message, from its messages and lore as a turn would, and record them as one GM edit with an Undo chip. It answers at once and runs in the background, with model calls on the user's connection; lre_minds shows its progress at /run. Needs spoilers: true.",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, who: { type: "array", items: { type: "string" }, description: "The characters' ids." } }, ["chatId", "spoilers"]),
    write: { destructive: false, idempotent: false },
    run: mindsRun,
    cli: { command: "minds-run", section: SECTION, usage: "minds-run <chatId> --spoilers [--who <a,b>]", summary: "Run characters' minds now", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, "--who": { arg: "who", as: "list" } } },
  },
  {
    name: "lre_minds_cancel",
    description: "Stop a Run minds now that is under way; nothing of it is recorded. runId is lre_minds' /run/runId.",
    inputSchema: object({ chatId: CHAT_ID, runId: { type: "string", description: "The run's id." } }, ["chatId", "runId"]),
    write: { destructive: false, idempotent: true },
    run: mindsCancel,
    cli: { command: "minds-cancel", section: SECTION, usage: "minds-cancel <chatId> <runId>", summary: "Stop a minds run", positionals: ["chatId", "runId"], needs: 2 },
  },
];
