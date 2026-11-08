// The chat tools LumiRPEngine serves outside clients (`lre_chat_state`, `lre_fix`, `lre_action`…;
// DESIGN §23, INC3-SPEC D4): what the chat's page reads (its state view, chips and inspector) and what
// Play's controls send (✎ fixes, markers, chip answers, Keep, opening a panel, palette actions and
// timelapses), with the GM view, GM edits and character minds behind `spoilers: true`. Each sends the
// requests the chat's page sends, as the caller's session, answered in process (`OutsideContext`): an
// MCP server ran these in the client until they moved here, and they answer as they did. An outside
// client is no page: the engine prepares a turn it asks for, but only Lumiverse starts the reply.

import { DOMAINS, INTERRUPT_CLASSES } from "../../../shared/ids";
import type { DomainId, Level } from "../../../shared/ids";
import type { ClaimsPolicy } from "../../../shared/claims";
import type { InferredChecks } from "../../../shared/inferred";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { hasOwn, isRecord } from "../../../shared/json";
import { GM_OUTLINE, GM_PARTS, GM_ROSTER, keyedItem, type GmPartAnswer, type GmPartReply, type QueuedOn } from "../../../shared/gm-parts";
import type { EventRef, ResolveScope, TimeControl, TimeScope } from "../../../shared/ledger";
import type { MindEditOp } from "../../../shared/minds";
import type { RoutineEditOp } from "../../../shared/routines";
import type { EditOp, GenerateAs, RequestFields, RequestType, ResultBodies } from "../../../shared/protocol";
import type { Chip, GmView } from "../../../shared/state-view";
import { chipStarts } from "../../../shared/state-view";
import { atOnceByDefault } from "../../../shared/offstage";
import type { ThingRow } from "../../../shared/thing-view";
import { sizeLabel, whoseWords } from "../../../shared/thing-view";
import { ORG_PARTS, orgPart, ORGS_LIST_PANEL, ORGS_ORG_PANEL, type OrgListView, type OrgView } from "../../../shared/org-view";
import type { AdjudicationDef } from "../../../shared/world";
import { TIME_CONTROLS } from "../../../engine/events";
// The one limit on a GM edit's operations: the schemas take no more than the engine accepts.
import { EDIT_OPS_MAX } from "../../../shared/protocol";
import type { Args } from "../../../shared/tool-args";
import { boolArg, intArg, neededText, textArg, textsArg, ToolError } from "../../../shared/tool-args";
import { BODY_LIMIT } from "../../../shared/tool-read";
import type { ToolResult } from "../../../shared/tool-answer";
import { json } from "../../../shared/tool-answer";
import { FROM, gate, GM_ALL, GM_PICK_OPTIONS, GM_PICKS, gmRead, type GmSource, LIMIT, noneNamed, OFFSET, onlyAccount, PAGING_OPTIONS, PAGING_USAGE, POINTER, readOut, SPOILERS } from "../../../shared/chat-reads";
import { REPLY } from "../../../shared/outside-tool-texts";
import { objectSchema as object } from "./schema";
import { type OutsideContext, type OutsideToolDef, Refusal } from "./outside-tool";

const SECTION = "Playing a chat on Lumiverse";

const CHAT_ID: JsonObject = { type: "string", description: "The chat's id (lre_chats lists the chats that play a world)." };

/** What a held write waits on, as its answer tells it (`queued`): it lands once that turn is over. */
const QUEUED: Record<QueuedOn, string> = {
  engine: "Queued: the engine is preparing the chat's turn, and this lands after that turn.",
  page: "Queued: the chat's turn is prepared and waits for Lumiverse to start its reply, which a page showing the chat does on its own (ask the user to open the chat in Lumiverse if it isn't open); this lands after that reply. lre_gm with part held lists what waits.",
  reply: "Queued: the chat is in the middle of a reply, and this lands when the reply finishes.",
};

/** A held write's `queued` and `waits`: what it waits on, in words. */
const queuedOf = (body: { pending: boolean; queued?: QueuedOn }): JsonObject => (body.pending ? { queued: body.queued ?? "reply", waits: QUEUED[body.queued ?? "reply"] } : {});

const chatIdOf = (args: Args): string => neededText(args, "chatId", "the chat's id (lre_chats lists the chats that play a world)");

/** Sends one chat request; the refusals an agent can act on say what to do next. */
async function ask<T extends RequestType>(ctx: OutsideContext, chatId: string, type: T, fields: RequestFields<T>): Promise<ResultBodies[T]> {
  try {
    return await ctx.request(type, fields);
  } catch (error) {
    if (error instanceof Refusal && error.code === "not_world_chat") throw new ToolError(`Chat ${chatId} plays no world (or there is no such chat): lre_chats lists the chats that play one, and lre_attach attaches a world to a chat.`);
    if (error instanceof Refusal && error.code === "paused") throw new ToolError(`Chat ${chatId} is paused: an earlier message of the player's was edited, and nothing changes until that is settled. Read /keepReport with lre_chat_state, then answer with lre_keep (keep or discard).`);
    throw error;
  }
}

/** A write's answer: what was done, and for a held write what it waits on. */
function written(chatId: string, done: JsonObject, body: { pending: boolean; queued?: QueuedOn }): ToolResult {
  return { text: json({ chatId, ...done, pending: body.pending, ...queuedOf(body) }) };
}

/** What the user presses in the chat to start the reply a chip's choice waits for (`chipStarts`). */
const START_PRESS: Record<GenerateAs, string> = { regenerate: "Regenerate (or swipe)", continue: "Continue", send: "Send, with nothing typed," };

/** A chip as the agent reads it: each action says how Lumiverse has to start the reply to finish it. */
function chipOut(chip: Chip): JsonValue {
  return {
    id: chip.id,
    kind: chip.kind,
    messageId: chip.messageId,
    ...(chip.swipeId !== undefined ? { swipeId: chip.swipeId } : {}),
    label: chip.label,
    ...(chip.detail !== undefined ? { detail: chip.detail } : {}),
    actions: chip.actions.map((a): JsonValue => {
      const start = chipStarts(chip, a.id);
      return { id: a.id, label: a.label, ...(a.style !== undefined ? { style: a.style } : {}), ...(a.input !== undefined ? { input: JSON.parse(JSON.stringify(a.input)) as JsonValue } : {}), ...(start ? { starts: start } : {}) };
    }),
    expires: chip.expires,
  };
}

const stateOf = async (ctx: OutsideContext, chatId: string): Promise<ResultBodies["lre.state.get"]> => ask(ctx, chatId, "lre.state.get", { chatId });

// ---------------------------------------------------------------- reads

async function chatState(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const { view, activity } = await stateOf(ctx, chatId);
  return readOut({ ...view, activity }, `the state view of chat ${chatId} (world ${view.worldId ?? "none"}, revision ${view.revision ?? "none"}, ${view.status})`, args);
}

async function chips(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const { view } = await stateOf(ctx, chatId);
  return {
    text: json({
      chatId,
      status: view.status,
      chips: view.chips.map(chipOut),
      ...(view.keepReport.length > 0 ? { keepReport: JSON.parse(JSON.stringify(view.keepReport)) as JsonValue } : {}),
      about: "Answer one with lre_chip {chatId, chip, choice}. An action marked starts is finished only by the reply Lumiverse starts, which the user does in the chat: Regenerate (or a swipe), Continue, or Send with nothing typed.",
    }),
  };
}

async function inspector(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const { view } = await stateOf(ctx, chatId);
  return readOut(view.panels["core.context"] ?? null, `the context inspector of chat ${chatId} (the last engine runs, newest first, and its warnings)`, args);
}

/** A chat's GM view on the host, behind the GM gate. */
function chatGm(ctx: OutsideContext, chatId: string): GmSource {
  return {
    what: `the GM view of chat ${chatId}`,
    parts: [GM_PARTS[0], GM_ROSTER, ...GM_PARTS.slice(1)],
    part: async (part, pick = {}) => {
      const read = await ask(ctx, chatId, "lre.gm.part", { chatId, part, ...pick });
      return read.same ? { id: read.id, value: null, key: read.key, same: true } : { id: read.id, value: read.value, key: read.key };
    },
    outline: async () => {
      const read = await ask(ctx, chatId, "lre.gm.part", { chatId, part: GM_OUTLINE });
      return read.same || read.part !== GM_OUTLINE ? [] : read.value;
    },
    whole: () => ask(ctx, chatId, "lre.gm", { chatId }),
    noneNamed: (part, said) => noneNamed(part, said, `chat ${chatId}`),
  };
}

async function gmView(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  gate(args, "lre_gm", "shows everything in the chat, secrets, hidden people and places and characters' minds included");
  return gmRead(args, chatGm(ctx, chatIdOf(args)));
}

async function sections(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  gate(args, "lre_sections", "shows what the narrator would be told, facts the player character doesn't know included where a section's scope adds them");
  const chatId = chatIdOf(args);
  return readOut(await ask(ctx, chatId, "lre.sections", { chatId }), `the sections the narrator would get in chat ${chatId}'s next turn, in prompt order`, args);
}

async function minds(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  gate(args, "lre_minds", "shows characters' private minds, plans and notes");
  const chatId = chatIdOf(args);
  const [gm, status] = await Promise.all([ask(ctx, chatId, "lre.gm.part", { chatId, part: "minds" }), ask(ctx, chatId, "lre.minds", { chatId, op: "status" })]);
  return readOut({ ...(builtPart(gm).value as GmView["minds"]), run: status.run }, `the character minds of chat ${chatId} (secrets included), with the latest Run minds now`, args);
}

/** A part read that held no key (`since`): what was built, which such a read is always answered with. */
function builtPart(read: GmPartReply): GmPartAnswer {
  if (read.same) throw new ToolError("The GM view answered unchanged to a read that held no key.");
  return read;
}

/** A thing as lre_items_find answers it: its id and name, its type, its size, where it is (outermost first), whose it is and who has it, and whether it is hidden or secret. */
function foundThing(row: ThingRow): JsonValue {
  return {
    id: row.id,
    name: row.name,
    ...(row.type !== null ? { type: row.type } : {}),
    size: sizeLabel(row.size),
    where: row.where.map((s) => ({ id: s.id, name: s.name })),
    whose: whoseWords(row.whose),
    owners: row.whose.owners.map((o) => o.id),
    ...(row.with !== null ? { with: row.with } : {}),
    ...(row.hidden ? { hidden: true } : {}),
    ...(row.secret ? { secret: true } : {}),
  };
}

async function itemsFind(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  gate(args, "lre_items_find", "reads the chat's things as the GM does, hidden and secret ones included");
  const chatId = chatIdOf(args);
  const words = neededText(args, "words", 'the words that name the thing, as the story says them ("Danny\'s truck keys", "the wallet")');
  const [{ found = [] }, { list }] = await Promise.all([ask(ctx, chatId, "lre.things", { scope: "gm", chatId, op: "find", words }), ask(ctx, chatId, "lre.things", { scope: "gm", chatId, op: "list" })]);
  const rows = new Map((list?.rows ?? []).map((r) => [r.id, r]));
  const things = found.map((id): JsonValue => {
    const row = rows.get(id);
    return row ? foundThing(row) : { id };
  });
  return { text: json({ chatId, words, things, ...(things.length === 0 ? { note: "Nothing in the chat goes by those words: try fewer of them, or read lre_gm's /entities." } : {}) }) };
}

/** The words that name the party among organizations, besides its id and name. */
const PARTY_WORDS: Readonly<Record<string, true>> = { party: true, "your party": true, "the party": true };

/** The organization words name among `pages`: its id, else its name in any case (refused, listing the ids, when several have it); the party is also "party". */
function orgFound(pages: readonly OrgView[], said: string): OrgView | null {
  if (hasOwn(PARTY_WORDS, said.trim().toLowerCase())) return pages.find((p) => p.type === "party") ?? null;
  const found = keyedItem(pages, said.trim(), (p) => p.id, (p) => p.name);
  if (found && "ambiguous" in found) throw new ToolError(`${found.ambiguous.length} organizations are named ${JSON.stringify(said)}: ${found.ambiguous.join(", ")}. Name one by its id.`);
  return found?.item ?? null;
}

/**
 * A chat's organizations (ORG-SPEC §7.5): the player character's Orgs home, or one organization's
 * page or a part of it, as their Orgs tab reads it (members they can't see counted, money behind its
 * power); with spoilers, GM → Orgs: every organization, every member named, with who holds each
 * power, read from that part of the GM view alone. `account` cuts its money to one account. Whole
 * JSON when it fits an answer and no pointer, offset or from asks for less; else read as lre_gm is.
 */
async function orgsRead(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const said = textArg(args, "org");
  const asked = textArg(args, "part");
  const account = textArg(args, "account");
  const part = asked === undefined ? undefined : ORG_PARTS.find((p) => p === asked.trim().toLowerCase());
  if (asked !== undefined && part === undefined) throw new ToolError(`part is one of ${ORG_PARTS.join(", ")}, not ${JSON.stringify(asked)}.`);
  if (part !== undefined && said === undefined) throw new ToolError("Give org with part: the organization whose part to read (lre_orgs without org lists them).");
  if (account !== undefined && (said === undefined || (part !== undefined && part !== "money"))) throw new ToolError("account cuts an organization's money to one account: give org with it (and part money, or no part).");
  const answer = (root: JsonObject, what: string): ToolResult => {
    const paged = ["pointer", "offset", "from", "limit"].some((a) => args[a] !== undefined);
    const text = json(root);
    return paged || text.length > BODY_LIMIT ? readOut(root, what, args) : { text };
  };
  const shown = (page: OrgView, more: JsonObject = {}): ToolResult => {
    const plain = JSON.parse(JSON.stringify(page)) as JsonObject;
    const sections = isRecord(plain.sections) ? plain.sections : {};
    // The money cut to one account, where the page shows its money.
    const money = account === undefined ? null : isRecord(sections.money) ? onlyAccount(sections.money, account, `${page.name}'s money`) : null;
    if (account !== undefined && money === null) throw new ToolError(`${page.name}'s money isn't shown here: the player character may not see it, or it holds no accounts.`);
    const org = { id: page.id, name: page.name, type: page.type, badge: page.badge };
    if (money !== null) return answer({ chatId, org, part: "money", money }, `the money of ${page.name} in chat ${chatId}, account ${account ?? ""} alone`);
    return answer({ chatId, org, ...(part !== undefined ? { part, ...(JSON.parse(JSON.stringify(orgPart(page, part))) as JsonObject) } : { page: plain, ...more }) }, `the page of ${page.name} in chat ${chatId}${part !== undefined ? `, its ${part}` : ""}`);
  };
  if (boolArg(args, "spoilers")) {
    // The party is named by words its page doesn't carry: it is found among them all.
    const byWords = said !== undefined && hasOwn(PARTY_WORDS, said.trim().toLowerCase());
    const { value } = builtPart(await ask(ctx, chatId, "lre.gm.part", { chatId, part: "orgs", ...(said !== undefined && !byWords ? { id: said } : {}) }));
    const orgs = value as GmView["orgs"];
    if (said === undefined) return answer({ chatId, organizations: orgs.map((o): JsonValue => ({ id: o.page.id, name: o.page.name, type: o.page.type, badge: o.page.badge, runBy: o.page.runBy.map((r) => r.name), people: o.page.people.length })), about: "Read one with lre_orgs {chatId, org, part?, spoilers: true}; change one with lre_gm_edit's org op." }, `GM → Orgs of chat ${chatId}`);
    const one = byWords ? orgs.find((o) => o.page.type === "party") : orgs[0];
    if (!one) throw new ToolError(`No organization ${JSON.stringify(said)} in chat ${chatId}: lre_orgs with spoilers and no org lists them.`);
    return shown(one.page, { may: JSON.parse(JSON.stringify(one.may)) as JsonValue });
  }
  const { view } = await stateOf(ctx, chatId);
  const home = (view.panels[ORGS_LIST_PANEL] ?? null) as OrgListView | null;
  const pages = Object.values((view.panels[ORGS_ORG_PANEL] ?? {}) as unknown as Record<string, OrgView>);
  if (said === undefined) return answer({ chatId, ...(home ? (JSON.parse(JSON.stringify(home)) as JsonObject) : { note: "This chat's world has no organizations." }) }, `the Orgs home of chat ${chatId}`);
  const page = orgFound(pages, said);
  if (!page) throw new ToolError(`The player character knows no organization ${JSON.stringify(said)} in chat ${chatId}: lre_orgs without org lists those they belong to and know of.`);
  return shown(page);
}

// ---------------------------------------------------------------- writes

const HUD_FIXES = ["place", "weather", "cash", "scene"] as const;

function fixTool(args: Args, ctx: OutsideContext): Promise<ToolResult> {
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
      return written(chatId, { fixed: { time } }, body);
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
    return written(chatId, { fixed: { ...target, value } }, body);
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

function gmEdit(args: Args, ctx: OutsideContext, name: string, only?: readonly string[]): Promise<ToolResult> {
  gate(args, name, "edits the chat as the GM does, hidden things included, and its refusals name them");
  const chatId = chatIdOf(args);
  const ops = editOps(args, only);
  return ctx.serialize(`chat:${chatId}`, async () => {
    const body = await ask(ctx, chatId, "lre.edit", { chatId, ops });
    return written(chatId, { applied: ops.length, note: "One GM edit, all or nothing, with an Undo chip (lre_chips)." }, body);
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

function marker(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const fields = markerFields(chatId, args);
  return ctx.serialize(`chat:${chatId}`, async () => {
    let body: ResultBodies["lre.marker"];
    try {
      body = await ask(ctx, chatId, "lre.marker", fields);
    } catch (error) {
      if (error instanceof Refusal && error.code === "bad_request") throw new ToolError(`LumiRPEngine can't read that marker (${error.message}). Check its values against what lre_chat_state shows at /controls, which is what each kind sets, and the shapes this tool's schema describes.`);
      throw error;
    }
    if (fields.preview === true) return { text: json({ chatId, preview: (body.preview?.lines ?? []).map((l) => ({ text: l.text, tone: l.tone })), note: "Nothing was written: call again without preview to set it." }) };
    return written(chatId, { set: fields.kind, note: "It holds from the chat's latest message on; lre_chat_state shows it at /controls." }, body);
  });
}

function chipTool(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const id = neededText(args, "chip", "the chip's id (lre_chips lists them)");
  const choice = neededText(args, "choice", "one of the chip's action ids (lre_chips lists them)");
  const payload = args.payload;
  if (payload !== undefined && !isRecord(payload)) throw new ToolError('payload is an object: {"cents": 899} for an amount, {"value": "…"} for a choice.');
  return ctx.serialize(`chat:${chatId}`, async () => {
    const chip = (await stateOf(ctx, chatId)).view.chips.find((c) => c.id === id);
    if (chip === undefined) throw new ToolError(`Chat ${chatId} has no chip ${id} now (a chip lapses at the next send, and goes once answered): lre_chips lists the ones it has.`);
    if (!chip.actions.some((a) => a.id === choice)) throw new ToolError(`The chip ${id} has no action ${choice}; its actions: ${chip.actions.map((a) => `${a.id} (${a.label})`).join(", ")}.`);
    // Regenerate and Continue are the frontend's own: nothing to send, and only a page can do them.
    if (choice === "regenerate" || choice === "continue") throw new ToolError(`${chip.label}: ${choice} only ${choice === "continue" ? "continues" : "regenerates"} the reply, which Lumiverse does, not this client: ask the user to press ${START_PRESS[choice]} in the chat.`);
    const body = await ask(ctx, chatId, "lre.chip", { chatId, chip: id, choice, ...(isRecord(payload) ? { payload: payload as JsonObject } : {}) });
    const sends = chip.kind === "choice" && choice === "send";
    const start = chipStarts(chip, choice);
    return {
      text: json({
        chatId,
        chip: id,
        choice,
        applied: body.applied,
        pending: body.pending,
        ...queuedOf(body),
        ...(start ? { reply: `This takes effect on the reply Lumiverse writes next: ask the user to press ${START_PRESS[start]} in the chat.` } : {}),
        ...(sends ? { reply: REPLY } : {}),
      }),
    };
  });
}

const KEEP_CHOICES = ["keep", "discard", "convert"] as const;

function keep(args: Args, ctx: OutsideContext): Promise<ToolResult> {
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
    return written(chatId, { choice, messageId }, body);
  });
}

function viewOpen(args: Args, ctx: OutsideContext): Promise<ToolResult> {
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
    return written(chatId, { panel, entity, materialized: body.materialized, note }, body);
  });
}

function action(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const id = neededText(args, "action", "the action's id (lre_chat_state lists the palette's at /palette/entries)");
  const params = args.params ?? {};
  if (!isRecord(params)) throw new ToolError("params is an object: the picked option's params, as /palette/entries/<i>/options/<j>/params shows them.");
  const text = textArg(args, "text");
  return ctx.serialize(`chat:${chatId}`, async () => {
    // An outside agent's action plays at once (`now`): there is no next message for it to wait for. A
    // money or organization action with no words is done at once, off screen, without it.
    const words = text !== undefined && text.trim() !== "" ? text : undefined;
    const body = await ask(ctx, chatId, "lre.action", { chatId, action: id, params: params as JsonObject, source: "palette", ...(atOnceByDefault(id) && words === undefined ? {} : { now: true }), ...(words !== undefined ? { text: words } : {}) });
    // A mechanical action, or a money or organization one, with no words is recorded at once, with no message and no reply to wait for.
    return { text: json("messageId" in body ? { chatId, action: id, messageId: body.messageId, reply: REPLY } : "pending" in body ? { chatId, action: id, applied: true, pending: body.pending, ...queuedOf(body), ...(body.undo ? { undo: body.undo } : {}) } : { chatId, action: id, applied: true, pending: false }) };
  });
}

function timelapse(args: Args, ctx: OutsideContext): Promise<ToolResult> {
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
    const body = await ask(ctx, chatId, "lre.action", { chatId, action: offered.action, params, source: "palette", now: true, ...(text !== undefined && text.trim() !== "" ? { text } : {}) });
    return { text: json({ chatId, action: offered.action, target: target as JsonObject, messageId: "messageId" in body ? body.messageId : null, reply: REPLY }) };
  });
}

function mindsRun(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  gate(args, "lre_minds_run", "answers with which characters' minds it runs, the hidden ones included");
  const chatId = chatIdOf(args);
  const who = textsArg(args, "who");
  return ctx.serialize(`chat:${chatId}`, async () => {
    const body = await ask(ctx, chatId, "lre.minds", { chatId, op: "run", ...(who !== undefined ? { who } : {}) });
    return { text: json({ chatId, run: body.run as unknown as JsonValue, note: "It runs in the background, with model calls on the user's connection, and records the minds as one GM edit with an Undo chip. lre_minds shows its progress at /run; lre_minds_cancel stops it." }) };
  });
}

function mindsCancel(args: Args, ctx: OutsideContext): Promise<ToolResult> {
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
/** Every minds control `lre_mind_edit` takes: a lookup over the ops, so a new one fails the typecheck until it is here. */
const MIND_OP: Record<MindEditOp["op"], true> = { mind_pin: true, mind_refresh: true, mind_memory: true, mind_intent: true, mind_knowledge: true };
const MIND_OPS = Object.keys(MIND_OP);
/** Every routine control `lre_routine_edit` takes: a lookup over the ops, so a new one fails the typecheck until it is here. */
const ROUTINE_OP: Record<RoutineEditOp["op"], true> = { routine_follow: true, routine_block: true, schedule_override: true };
const ROUTINE_OPS = Object.keys(ROUTINE_OP);

export const OUTSIDE_PLAY_TOOLS: readonly OutsideToolDef[] = [
  {
    name: "lre_chat_state",
    inputSchema: object({ chatId: CHAT_ID, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId"]),
    write: false,
    run: chatState,
    cli: { command: "chat", section: SECTION, usage: `chat <chatId> ${PAGING_USAGE}`, summary: "A chat's state view, as Play shows it", positionals: ["chatId"], needs: 1, options: PAGING_OPTIONS },
  },
  {
    name: "lre_chips",
    inputSchema: object({ chatId: CHAT_ID }, ["chatId"]),
    write: false,
    run: chips,
    cli: { command: "chips", section: SECTION, usage: "chips <chatId>", summary: "A chat's chips and their actions", positionals: ["chatId"], needs: 1 },
  },
  {
    name: "lre_inspector",
    inputSchema: object({ chatId: CHAT_ID, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId"]),
    write: false,
    run: inspector,
    cli: { command: "inspector", section: SECTION, usage: `inspector <chatId> ${PAGING_USAGE}`, summary: "A chat's context inspector", positionals: ["chatId"], needs: 1, options: PAGING_OPTIONS },
  },
  {
    name: "lre_gm",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, part: { type: "string", enum: [...GM_PARTS, GM_ALL], description: `Only this part, built alone; ${GM_ALL}: the whole view at once (many megabytes on a large world). Left out, with no entity, party, org or pointer either: the view's outline.` }, ...GM_PICKS }, ["chatId", "spoilers"]),
    write: false,
    run: gmView,
    cli: { command: "gm", section: SECTION, usage: `gm <chatId> --spoilers [--part <part|${GM_ALL}> | --entity <id|name> | --party <id|name> [--account <id|name>] | --org <id|name>] [--kind <kind>] [--compact] ${PAGING_USAGE}`, summary: "A chat's GM view: its outline, one part of it, or all of it, secrets included", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, "--part": { arg: "part", as: "text" }, ...GM_PICK_OPTIONS } },
  },
  {
    name: "lre_sections",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId", "spoilers"]),
    write: false,
    run: sections,
    cli: { command: "sections", section: SECTION, usage: `sections <chatId> --spoilers ${PAGING_USAGE}`, summary: "What the narrator would get next turn, section by section", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, ...PAGING_OPTIONS } },
  },
  {
    name: "lre_minds",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId", "spoilers"]),
    write: false,
    run: minds,
    cli: { command: "minds", section: SECTION, usage: `minds <chatId> --spoilers ${PAGING_USAGE}`, summary: "A chat's character minds and their latest run", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, ...PAGING_OPTIONS } },
  },
  {
    name: "lre_items_find",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, words: { type: "string", description: 'The words that name it, as the story says them: "Danny\'s truck keys", "the wallet".' } }, ["chatId", "spoilers", "words"]),
    write: false,
    run: itemsFind,
    cli: { command: "items-find", section: SECTION, usage: "items-find <chatId> <words> --spoilers", summary: "The things words name in a chat, best first", positionals: ["chatId", "words"], needs: 2, options: { "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_orgs",
    inputSchema: object({ chatId: CHAT_ID, org: { type: "string", description: 'The organization: its id or its name ("Alder Automotive"), or "party"; leave it out for the list.' }, part: { type: "string", enum: [...ORG_PARTS], description: "Only this part of its page; needs org." }, account: { type: "string", description: "With org: its money cut to this account (id or name)." }, spoilers: { type: "boolean", description: "true: read GM → Orgs, everyone named and every power's holders, which the player isn't meant to know. Pass it only when the user asked to see behind the curtain." }, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId"]),
    write: false,
    run: orgsRead,
    cli: { command: "orgs", section: SECTION, usage: `orgs <chatId> [--org <id|name>] [--part <part>] [--account <id|name>] [--spoilers] ${PAGING_USAGE}`, summary: "A chat's organizations, or one's page", positionals: ["chatId"], needs: 1, options: { "--org": { arg: "org", as: "text" }, "--part": { arg: "part", as: "text" }, "--account": { arg: "account", as: "text" }, "--spoilers": { arg: "spoilers", as: "flag" }, ...PAGING_OPTIONS } },
  },
  {
    name: "lre_fix",
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
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, ops: { type: "array", minItems: 1, maxItems: EDIT_OPS_MAX, items: OPS_ITEM, description: 'The operations, applied in order: [{"op": "set", "entity": "pov", "field": "mood", "value": "calm"}].' } }, ["chatId", "spoilers", "ops"]),
    write: { destructive: true, idempotent: false },
    run: (args, ctx) => gmEdit(args, ctx, "lre_gm_edit"),
    cli: { command: "gm-edit", section: SECTION, usage: "gm-edit <chatId> --ops <file|json> --spoilers", summary: "GM edits, all or none", positionals: ["chatId"], needs: 1, options: { "--ops": { arg: "ops", as: "json" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_mind_edit",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, ops: { type: "array", minItems: 1, maxItems: EDIT_OPS_MAX, items: { type: "object", properties: { op: { type: "string", enum: MIND_OPS } }, required: ["op", "entity"] }, description: 'The operations, in order: [{"op": "mind_pin", "entity": "danny_okafor", "level": "live"}].' } }, ["chatId", "spoilers", "ops"]),
    write: { destructive: true, idempotent: false },
    run: (args, ctx) => gmEdit(args, ctx, "lre_mind_edit", MIND_OPS),
    cli: { command: "mind-edit", section: SECTION, usage: "mind-edit <chatId> --ops <file|json> --spoilers", summary: "Pin, refresh, edit or steer characters' minds", positionals: ["chatId"], needs: 1, options: { "--ops": { arg: "ops", as: "json" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_marker",
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
    inputSchema: object({ chatId: CHAT_ID, chip: { type: "string", description: "The chip's id (lre_chips)." }, choice: { type: "string", description: "One of its action ids." }, payload: { type: "object", description: "The value an action asks for first." } }, ["chatId", "chip", "choice"]),
    write: { destructive: true, idempotent: false },
    run: chipTool,
    cli: { command: "chip", section: SECTION, usage: "chip <chatId> <chipId> <choice> [--payload <json>]", summary: "Answer a chip", positionals: ["chatId", "chip", "choice"], needs: 3, options: { "--payload": { arg: "payload", as: "json" } } },
  },
  {
    name: "lre_keep",
    inputSchema: object({ chatId: CHAT_ID, choice: { type: "string", enum: [...KEEP_CHOICES] }, messageId: { type: "string", description: "The edited message's id." }, parentPath: { type: "string", description: "convert: the line's parentPath." }, refs: { type: "array", items: { type: "object" }, description: "convert: the lines' ref objects." } }, ["chatId", "choice", "messageId"]),
    write: { destructive: true, idempotent: true },
    run: keep,
    cli: { command: "keep", section: SECTION, usage: "keep <chatId> <keep|discard|convert> <messageId> [--parent-path <p>] [--refs <json>]", summary: "Keep or discard after an earlier edit", positionals: ["chatId", "choice", "messageId"], needs: 3, options: { "--parent-path": { arg: "parentPath", as: "text" }, "--refs": { arg: "refs", as: "json" } } },
  },
  {
    name: "lre_view_open",
    inputSchema: object({ chatId: CHAT_ID, panel: { type: "string", description: "The panel's id." }, entity: { type: "string", description: "Whom it is about; default the POV." } }, ["chatId", "panel"]),
    write: { destructive: false, idempotent: true },
    run: viewOpen,
    cli: { command: "view-open", section: SECTION, usage: "view-open <chatId> <panel> [--entity <id>]", summary: "Open a panel, settling its detail", positionals: ["chatId", "panel"], needs: 2, options: { "--entity": { arg: "entity", as: "text" } } },
  },
  {
    name: "lre_action",
    inputSchema: object({ chatId: CHAT_ID, action: { type: "string", description: "The action's id." }, params: { type: "object", description: "The option's params." }, text: { type: "string", description: "The player's words for it." } }, ["chatId", "action"]),
    write: { destructive: false, idempotent: false },
    run: action,
    cli: { command: "act", section: SECTION, usage: "act <chatId> <action> [--params <json>] [--text <words>]", summary: "Play a palette action as the next turn", positionals: ["chatId", "action"], needs: 2, options: { "--params": { arg: "params", as: "json" }, "--text": { arg: "text", as: "text" } } },
  },
  {
    name: "lre_timelapse",
    inputSchema: object({ chatId: CHAT_ID, target: { type: "object", description: "How far to skip." }, overrides: { type: "object", description: "Interrupt classes to stop, note or ignore for this skip." }, text: { type: "string", description: "The player's words for it." } }, ["chatId", "target"]),
    write: { destructive: false, idempotent: false },
    run: timelapse,
    cli: { command: "timelapse", section: SECTION, usage: "timelapse <chatId> --target <json> [--overrides <json>] [--text <words>]", summary: "Skip time as the next turn", positionals: ["chatId"], needs: 1, options: { "--target": { arg: "target", as: "json" }, "--overrides": { arg: "overrides", as: "json" }, "--text": { arg: "text", as: "text" } } },
  },
  {
    name: "lre_minds_run",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, who: { type: "array", items: { type: "string" }, description: "The characters' ids." } }, ["chatId", "spoilers"]),
    write: { destructive: false, idempotent: false },
    run: mindsRun,
    cli: { command: "minds-run", section: SECTION, usage: "minds-run <chatId> --spoilers [--who <a,b>]", summary: "Run characters' minds now", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, "--who": { arg: "who", as: "list" } } },
  },
  {
    name: "lre_minds_cancel",
    inputSchema: object({ chatId: CHAT_ID, runId: { type: "string", description: "The run's id." } }, ["chatId", "runId"]),
    write: { destructive: false, idempotent: true },
    run: mindsCancel,
    cli: { command: "minds-cancel", section: SECTION, usage: "minds-cancel <chatId> <runId>", summary: "Stop a minds run", positionals: ["chatId", "runId"], needs: 2 },
  },
  {
    name: "lre_day",
    write: false,
    inputSchema: object({ chatId: CHAT_ID, entity: { type: "string", description: "The character's id (lre_gm lists them)." }, view: { type: "string", enum: ["gm", "player"], description: "gm (needs spoilers: true) or player." }, day: { type: "integer", description: "A day index; today when left out (gm only)." }, spoilers: SPOILERS }, ["chatId", "entity", "view"]),
    run: (args, ctx) => routineDay(args, ctx),
    cli: { command: "day", section: SECTION, usage: "day <chatId> <entity> [--view gm|player] [--day <n>] [--spoilers]", summary: "A character's routine and day, with why", positionals: ["chatId", "entity"], needs: 2, options: { "--view": { arg: "view", as: "text" }, "--day": { arg: "day", as: "int" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_routine_changes",
    write: false,
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS }, ["chatId", "spoilers"]),
    run: async (args, ctx) => {
      gate(args, "lre_routine_changes", "shows the GM's changes to people's routines");
      const chatId = chatIdOf(args);
      return { text: json(await ask(ctx, chatId, "lre.routine", { chatId, op: "changed" })) };
    },
    cli: { command: "routine-changes", section: SECTION, usage: "routine-changes <chatId> --spoilers", summary: "Whose routines a chat changed", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_routine_edit",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, ops: { type: "array", minItems: 1, maxItems: EDIT_OPS_MAX, items: { type: "object", properties: { op: { type: "string", enum: ROUTINE_OPS } }, required: ["op", "entity"] }, description: 'The operations, in order: [{"op": "routine_follow", "entity": "danny_okafor", "mode": "no_invitations"}].' } }, ["chatId", "spoilers", "ops"]),
    write: { destructive: true, idempotent: false },
    run: (args, ctx) => gmEdit(args, ctx, "lre_routine_edit", ROUTINE_OPS),
    cli: { command: "routine-edit", section: SECTION, usage: "routine-edit <chatId> --ops <file|json> --spoilers", summary: "Change characters' routines and schedules in a chat", positionals: ["chatId"], needs: 1, options: { "--ops": { arg: "ops", as: "json" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
];

/** A character's day: the GM's view behind the spoilers gate, the player's as Cast shows it. */
async function routineDay(args: Args, ctx: OutsideContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const entity = neededText(args, "entity", "the character's id (lre_gm lists them)");
  const view = textArg(args, "view") === "player" ? "player" : "gm";
  if (view === "gm") gate(args, "lre_day", "shows a character's whole routine, secrets and the GM's changes included");
  const day = intArg(args, "day", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const body = await ask(ctx, chatId, "lre.routine", { chatId, op: "day", entity, view, ...(day !== undefined && view === "gm" ? { day } : {}) });
  return { text: json(body) };
}
