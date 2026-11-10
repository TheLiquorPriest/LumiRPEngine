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
import { hasOwn, isRecord } from "../shared/json";
import { parsePointer } from "../shared/json-patch";
import { GM_IDS_PARTS, GM_KEYED_PARTS, GM_OUTLINE, GM_PARTS, GM_ROSTER, keyedItem, type GmKeyedPart, type GmOutline, type GmPartAnswer, type GmPartReply, type GmReadPart, type QueuedOn } from "../shared/gm-parts";
import type { EventRef, ResolveScope, TimeControl, TimeScope } from "../shared/ledger";
import type { MindEditOp } from "../shared/minds";
import type { RoutineEditOp } from "../shared/routines";
import type { EditOp, GenerateAs, ResultBodies } from "../shared/protocol";
import type { Chip, GmEntity, GmView } from "../shared/state-view";
import { chipStarts } from "../shared/state-view";
import { atOnceByDefault } from "../shared/offstage";
import type { ThingRow } from "../shared/thing-view";
import { sizeLabel, whoseWords } from "../shared/thing-view";
import { ORG_PARTS, orgPart, ORGS_LIST_PANEL, ORGS_ORG_PANEL, type OrgListView, type OrgView } from "../shared/org-view";
import type { AdjudicationDef } from "../shared/world";
import { TIME_CONTROLS } from "../engine/events";
// The one limit on a GM edit's operations: the schemas take no more than the engine accepts.
import { EDIT_OPS_MAX } from "../shared/protocol";
import type { Args } from "./args";
import { boolArg, intArg, neededText, textArg, textsArg, ToolError } from "./args";
import type { RequestFields, RequestType } from "./connection";
import { LreError } from "./connection";
import { BODY_LIMIT, itemKey, nameOf, readAt } from "./read";
import type { ToolResult } from "./report";
import { json } from "./report";
import type { CliMirror, ToolModule } from "./tool-module";
import { object } from "./tool-module";
import type { ToolContext } from "./tools";

const SECTION = "Playing a chat on Lumiverse";
const MAX_OFFSET = Number.MAX_SAFE_INTEGER;

const CHAT_ID: JsonObject = { type: "string", description: "The chat's id (lre_chats lists the chats that play a world)." };
const POINTER: JsonObject = { type: "string", description: 'A JSON Pointer into it (RFC 6901): "" for an outline of the whole, "/hud" for one part. A token on a list is an index or, keyed, an item\'s id or name ("/money/danny_okafor", "/orgs/Alder Automotive"). In a key, "~1" stands for "/" and "~0" for "~".' };
const OFFSET: JsonObject = { type: "integer", minimum: 0, description: "Read the value's JSON text from this character instead of outlining it; each page says where the next begins." };
export const SPOILERS: JsonObject = { type: "boolean", description: "Must be true: this shows (or answers with) what the player isn't meant to know. Pass it only when the user asked to see behind the curtain." };
const FROM: JsonObject = { type: "integer", minimum: 0, description: "Read a list's or an object's entries from this one (0 is the first): whole when they fit, else outlined; each page says where the next begins." };
const LIMIT: JsonObject = { type: "integer", minimum: 1, description: "With from (0 by default), at most this many entries." };
/** The paging arguments of a read tool. */
export const PAGING: JsonObject = { pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT };
/** The command line's paging flags of a read tool, and how its usage shows them. */
export const PAGING_OPTIONS: NonNullable<CliMirror["options"]> = { "--pointer": { arg: "pointer", as: "text" }, "--offset": { arg: "offset", as: "int" }, "--from": { arg: "from", as: "int" }, "--limit": { arg: "limit", as: "int" } };
export const PAGING_USAGE = "[--pointer <p>] [--offset <n> | --from <n> [--limit <n>]]";
/** What a GM read picks besides its part (`gmRead`): one entity, party's money or organization, several by ids, the entities of a kind, compact entities, the key it holds; its paging after them. */
export const GM_PICKS: JsonObject = {
  entity: { type: "string", description: "One entity, by id or name." },
  party: { type: "string", description: "One party's money (a person, household, business, trust or group), by id or name." },
  account: { type: "string", description: "With party: only this account of theirs (id or name), its cards, lines and standing payments." },
  org: { type: "string", description: "One organization as GM → Orgs shows it, by id or name." },
  ids: { type: "array", items: { type: "string" }, description: "With part entities, roster, money or orgs: only these, by id, in this order (at most 500)." },
  kind: { type: "string", description: "Only entities (or roster entries, or money) of this kind, or of a kind extending it." },
  compact: { type: "boolean", description: "Entities with each field's definition once per kind (/fieldDefs), each field's value alone." },
  since: { type: "string", description: "The key an earlier read of this part answered with: while the chat is unchanged, the answer says so and sends nothing again." },
  ...PAGING,
};
/** The command line's flags for `GM_PICKS`. */
export const GM_PICK_OPTIONS: NonNullable<CliMirror["options"]> = { "--entity": { arg: "entity", as: "text" }, "--party": { arg: "party", as: "text" }, "--account": { arg: "account", as: "text" }, "--org": { arg: "org", as: "text" }, "--ids": { arg: "ids", as: "list" }, "--kind": { arg: "kind", as: "text" }, "--compact": { arg: "compact", as: "flag" }, "--since": { arg: "since", as: "text" }, ...PAGING_OPTIONS };

/** What a held write waits on, as its answer tells it (`queued`): it lands once that turn is over. */
const QUEUED: Record<QueuedOn, string> = {
  engine: "Queued: the engine is preparing the chat's turn, and this lands after that turn.",
  page: "Queued: the chat's turn is prepared and waits for Lumiverse to start its reply, which a page showing the chat does on its own (ask the user to open the chat in Lumiverse if it isn't open); this lands after that reply. lre_gm with part held lists what waits.",
  reply: "Queued: the chat is in the middle of a reply, and this lands when the reply finishes.",
};

/** A held write's `queued` and `waits`: what it waits on, in words. */
const queuedOf = (body: { pending: boolean; queued?: QueuedOn }): JsonObject => (body.pending ? { queued: body.queued ?? "reply", waits: QUEUED[body.queued ?? "reply"] } : {});

/**
 * What an outside client can't do: start the reply. Lumiverse's generation for the new message is
 * stopped by the engine's guard while the engine prepares the turn, and only a page restarts it
 * (DESIGN §5.1); a page that shows the chat does so on its own, else the next page to open it.
 */
const REPLY =
  "The engine prepares the turn now (the plan, the checks, the time it takes), but the reply is started by Lumiverse, not by this client: when the user has this chat open in Lumiverse, its page starts the reply on its own; otherwise the reply waits until the chat is next opened there. Ask the user to open the chat if it isn't. lre_chat_state's activity says where the turn stands, and its state shows what the turn did once the reply is in.";

const chatIdOf = (args: Args): string => neededText(args, "chatId", "the chat's id (lre_chats lists the chats that play a world)");

/** Refuses a spoiler-gated tool unless the caller said `spoilers: true`, before anything is asked of the host. */
export function gate(args: Args, name: string, shows: string): void {
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
export function readOut(root: unknown, what: string, args: Args): ToolResult {
  const read = readAt(root, { what, pointer: textArg(args, "pointer") ?? "", offset: intArg(args, "offset", 0, MAX_OFFSET), from: intArg(args, "from", 0, MAX_OFFSET), limit: intArg(args, "limit", 1, MAX_OFFSET) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
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
      about: "Answer one with lre_chip {chatId, chip, choice}. An action marked starts is finished only by the reply Lumiverse starts, which the user does in the chat: Regenerate (or a swipe), Continue, or Send with nothing typed.",
    }),
  };
}

async function inspector(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const { view } = await stateOf(ctx, chatId);
  return readOut(view.panels["core.context"] ?? null, `the context inspector of chat ${chatId} (the last engine runs, newest first, and its warnings)`, args);
}

/** A GM part's one item, by what names it: lre_gm's entity, party and org, as the GM view's keyed reads name them. */
const PICKS = { entity: "entities", party: "money", org: "orgs" } as const satisfies Record<string, GmKeyedPart>;

/** lre_gm's part that reads the whole view at once: on a large world it is many megabytes, so a bare call reads the view's outline instead. */
export const GM_ALL = "all";

/** What a GM read asks of one part besides its name: one item by id or name, several by ids, those of a kind, and the key the reader holds. */
export interface GmReadPick {
  id?: string;
  ids?: string[];
  kind?: string;
  since?: string;
}

/**
 * Where a GM read comes from: a chat on the host (`lre.gm.part`, `lre.gm`), or a sandbox on this
 * machine (DESIGN §23), which has the world's parts alone. `what` is how its answers name it.
 */
export interface GmSource {
  what: string;
  /** The parts it has, in the view's order. */
  parts: readonly GmReadPart[];
  /**
   * One part, built alone; with `id`, of the entities, money or organizations only that one (an
   * empty list when there is none), with `ids` those, with `kind` those of that kind. A name several
   * share is refused. `key`: the chat's head it was read at; `same`: still the `since` key, nothing sent.
   */
  part(part: GmReadPart, pick?: GmReadPick): Promise<{ id: string | null; value: unknown; key?: string; same?: true }>;
  /** How many each part holds. */
  outline(): Promise<GmOutline>;
  /** Every part at once. */
  whole(): Promise<unknown>;
  /** Why it holds no entity, party or organization by those words. */
  noneNamed(part: GmKeyedPart, said: string): string;
}

/** A chat's GM view on the host, behind the GM gate. */
function chatGm(ctx: ToolContext, chatId: string): GmSource {
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

async function gmView(args: Args, ctx: ToolContext): Promise<ToolResult> {
  gate(args, "lre_gm", "shows everything in the chat, secrets, hidden people and places and characters' minds included");
  return gmRead(args, chatGm(ctx, chatIdOf(args)));
}

/**
 * The GM view's outline, one part of it built alone, or the whole view (part `all`): `part`; one
 * entity, one party's money (cut to one account with `account`) or one organization, by id or name;
 * the entities of a kind; the entities with their fields' definitions once (`compact`). With none of
 * them, a pointer whose first token is a part reads that part alone, and a keyed token after it
 * (`/money/danny_okafor`) builds that one only, so a pointer reads the same however much of the view
 * it asks for; with no pointer either, the outline: how many each part holds, and how to read it.
 */
export async function gmRead(args: Args, source: GmSource): Promise<ToolResult> {
  const asked = textArg(args, "part");
  const kind = textArg(args, "kind");
  const ids = textsArg(args, "ids");
  const since = textArg(args, "since");
  const account = textArg(args, "account");
  const compact = boolArg(args, "compact");
  const picked = Object.entries(PICKS).flatMap(([arg, part]) => {
    const said = textArg(args, arg);
    return said === undefined ? [] : [{ arg, part, said }];
  });
  const pick = picked[0];
  if (picked.length + (asked !== undefined ? 1 : 0) > 1) throw new ToolError("Give at most one of part, entity, party and org.");
  const part = asked === undefined ? undefined : asked.trim() === GM_ALL ? GM_ALL : source.parts.find((p) => p === asked.trim());
  if (asked !== undefined && part === undefined) throw new ToolError(`part is one of ${source.parts.join(", ")} or ${GM_ALL}, not ${JSON.stringify(asked)}.`);
  if (account !== undefined && pick?.arg !== "party") throw new ToolError("account cuts one party's money to one account: give party with it.");
  if (compact && (pick ? pick.part !== "entities" : part !== undefined && part !== "entities")) throw new ToolError("compact reads the entities: give it with part entities, entity, or neither.");
  if (kind !== undefined && (pick ? pick.part !== "entities" : part !== undefined && part !== "entities" && part !== GM_ROSTER && part !== "money")) throw new ToolError("kind reads the entities, the roster or the money: give it with part entities, roster or money, entity, or alone.");
  if (ids !== undefined && (pick !== undefined || part === undefined || part === GM_ALL || !GM_IDS_PARTS.includes(part))) throw new ToolError(`ids read some of ${GM_IDS_PARTS.join(", ")}: give them with one of those parts.`);
  if (since !== undefined && (part === undefined || part === GM_ALL)) throw new ToolError("since rereads one part: give it with that part.");
  const { what } = source;
  if (pick) {
    const { id, value } = await source.part(pick.part, { id: pick.said });
    const [one] = value as JsonValue[];
    if (one === undefined) throw new ToolError(source.noneNamed(pick.part, pick.said));
    const root = pick.part === "entities" && compact ? compacted([one as unknown as GmEntity]) : pick.part === "money" && account !== undefined ? onlyAccount(one as JsonObject, account, `${pick.said}'s money`) : one;
    return readOut(root, `${what}: ${pick.part === "money" ? `the money of ${id}${account !== undefined ? `, account ${account} alone` : ""}` : `${pick.part === "orgs" ? "organization" : "entity"} ${id}`}`, args);
  }
  if (part === GM_ALL) return readOut(await source.whole(), `${what}: everything as it stands, secrets included`, args);
  if (part !== undefined || kind !== undefined || compact) {
    const read = part ?? "entities";
    const got = await source.part(read, { ...(ids ? { ids } : {}), ...(kind !== undefined ? { kind } : {}), ...(since !== undefined ? { since } : {}) });
    // Read at the key this read held: nothing changed, so nothing is sent again.
    if (got.same) return readOut({ same: true, key: got.key ?? since ?? null }, `${what}: its ${read}, unchanged since key ${since}`, args);
    const root = read === "entities" && compact ? compacted(got.value as GmEntity[]) : got.value;
    return readOut(root, `${what}: its ${read}${ids ? `, ${ids.length} by id` : ""}${kind !== undefined ? ` of kind ${kind}` : ""}${compact ? ", each field's definition once per kind under /fieldDefs" : ""}${got.key !== undefined ? ` (key ${got.key}: pass it as since to read this again only once it changed)` : ""}`, args);
  }
  // A pointer into one part reads that part alone; one keyed into a list of entities, money or organizations builds that one alone.
  let tokens: string[] = [];
  try {
    tokens = parsePointer(textArg(args, "pointer") ?? "");
  } catch {
    // readOut says what is wrong with it.
  }
  const first = source.parts.find((p) => p === tokens[0]);
  if (first !== undefined) {
    const second = tokens[1];
    const keyed = GM_KEYED_PARTS.find((p) => p === first);
    const id = keyed !== undefined && second !== undefined && !/^(0|[1-9]\d*)$/.test(second) ? second : undefined;
    const { value } = await source.part(first, id !== undefined ? { id } : {});
    if (keyed !== undefined && id !== undefined && Array.isArray(value) && value.length === 0) throw new ToolError(source.noneNamed(keyed, id));
    return readOut({ [first]: value }, `${what}: everything as it stands, secrets included`, args);
  }
  if (tokens.length > 0) throw new ToolError(`The GM view has no part ${JSON.stringify(tokens[0])}: its parts are ${source.parts.join(", ")}. Read one with part, or pointer "/<part>"; part ${GM_ALL} reads the whole view.`);
  // The outline: how many each part holds, and how to read them.
  const outline = await source.outline();
  const how = `Read a part with part, or pointer "/<part>", which goes deeper too ("/money/<party id or name>/accounts"). One entity, one party's money or one organization: entity, party or org, by id or name. The entities of a kind: kind; with each field's definition once per kind: compact. The whole view at once, every part above, which on a large world is many megabytes: part "${GM_ALL}".`;
  return readOut({ parts: Object.fromEntries(outline.map((p) => [p.part, p.count])), read: how }, `${what}: its outline, how many each part holds`, args);
}

/** Why a GM read found no entity, party or organization by those words, in `where` ("chat c_1", "sandbox sb1"). */
export function noneNamed(part: GmKeyedPart, said: string, where: string): string {
  const noun = part === "money" ? "party" : part === "orgs" ? "organization" : "entity";
  return `No ${noun} ${JSON.stringify(said)} in ${where}, by id or by name: lre_gm with part ${part} lists them${part === "orgs" ? "" : ", and lre_items_find finds things by the words that name them"}.`;
}

/**
 * Entities with their fields' definitions once per kind (`fieldDefs`: label, type, bounds, values…),
 * each entity's fields read as their values alone, and a definition that differs on one entity (its
 * own bounds, a field its kind doesn't declare) under its `fieldsOwn`.
 */
function compacted(entities: readonly GmEntity[]): JsonObject {
  const fieldDefs: Record<string, Record<string, JsonValue>> = {};
  const out = entities.map((e): JsonValue => {
    const defs = (fieldDefs[e.kind] ??= {});
    const values: JsonObject = {};
    const own: JsonObject = {};
    for (const { id, value, ...def } of e.fields) {
      values[id] = value;
      const plain = JSON.parse(JSON.stringify(def)) as JsonValue;
      const known = defs[id];
      if (known === undefined) defs[id] = plain;
      else if (JSON.stringify(known) !== JSON.stringify(plain)) own[id] = plain;
    }
    const { fields: _fields, ...rest } = e;
    return { ...(JSON.parse(JSON.stringify(rest)) as JsonObject), fields: values, ...(Object.keys(own).length > 0 ? { fieldsOwn: own } : {}) };
  });
  return { fieldDefs, entities: out };
}

/**
 * Money (a party's, an organization's) cut to one account, named by its id or name: that account,
 * and of each other list in it only what names the account (its cards, its lines, the standing
 * payments that draw on it or pay into it). Refused, naming the accounts, when it has none so named.
 */
function onlyAccount(money: JsonObject, account: string, whose: string): JsonObject {
  const accounts = Array.isArray(money.accounts) ? money.accounts : [];
  const found = keyedItem(accounts, account, itemKey, nameOf);
  const listed = accounts.map((a) => `${itemKey(a) ?? "?"} (${nameOf(a) ?? "unnamed"})`).join(", ") || "none";
  if (found && "ambiguous" in found) throw new ToolError(`${found.ambiguous.length} of ${whose} accounts are named ${JSON.stringify(account)}: ${found.ambiguous.join(", ")}. Name one by its id.`);
  if (!found) throw new ToolError(`${whose} has no account ${JSON.stringify(account)}; its accounts: ${listed}.`);
  const id = itemKey(found.item);
  const names = (v: unknown): boolean => v === id || (Array.isArray(v) ? v.some(names) : isRecord(v) && Object.values(v).some(names));
  return Object.fromEntries(Object.entries(money).map(([key, v]) => [key, key === "accounts" ? [found.item] : Array.isArray(v) ? v.filter(names) : v]));
}

async function sections(args: Args, ctx: ToolContext): Promise<ToolResult> {
  gate(args, "lre_sections", "shows what the narrator would be told, facts the player character doesn't know included where a section's scope adds them");
  const chatId = chatIdOf(args);
  return readOut(await ask(ctx, chatId, "lre.sections", { chatId }), `the sections the narrator would get in chat ${chatId}'s next turn, in prompt order`, args);
}

async function minds(args: Args, ctx: ToolContext): Promise<ToolResult> {
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

async function itemsFind(args: Args, ctx: ToolContext): Promise<ToolResult> {
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
async function orgsRead(args: Args, ctx: ToolContext): Promise<ToolResult> {
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

function gmEdit(args: Args, ctx: ToolContext, name: string, only?: readonly string[]): Promise<ToolResult> {
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
    return written(chatId, { set: fields.kind, note: "It holds from the chat's latest message on; lre_chat_state shows it at /controls." }, body);
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
    return written(chatId, { choice, messageId }, body);
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
    return written(chatId, { panel, entity, materialized: body.materialized, note }, body);
  });
}

function action(args: Args, ctx: ToolContext): Promise<ToolResult> {
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
    const body = await ask(ctx, chatId, "lre.action", { chatId, action: offered.action, params, source: "palette", now: true, ...(text !== undefined && text.trim() !== "" ? { text } : {}) });
    return { text: json({ chatId, action: offered.action, target: target as JsonObject, messageId: "messageId" in body ? body.messageId : null, reply: REPLY }) };
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
/** Every minds control `lre_mind_edit` takes: a lookup over the ops, so a new one fails the typecheck until it is here. */
const MIND_OP: Record<MindEditOp["op"], true> = { mind_pin: true, mind_refresh: true, mind_memory: true, mind_intent: true, mind_knowledge: true };
const MIND_OPS = Object.keys(MIND_OP);
/** Every routine control `lre_routine_edit` takes: a lookup over the ops, so a new one fails the typecheck until it is here. */
const ROUTINE_OP: Record<RoutineEditOp["op"], true> = { routine_follow: true, routine_block: true, schedule_override: true };
const ROUTINE_OPS = Object.keys(ROUTINE_OP);

export const PLAY_TOOLS: readonly ToolModule[] = [
  {
    name: "lre_chat_state",
    description:
      "Read a chat's state view at a JSON Pointer: what the player sees in Play, the same view the chat's page is sent. /hud (clock, place, weather, cash, and its ✎ fixes at /hud/fixes), /scene (who is present), /chips, /journal, /keepReport (when status is paused), /palette (the actions at /palette/entries, the timelapse at /palette/timelapse), /controls (realism, time controls, player claims and the checks policy the chat plays by), /panels (each pack's panel, the inspector at /panels/core.context), /currency, and activity: what the engine is doing for the chat now (null when idle). Only what the player can know: lre_gm has the rest. A large part comes back as an outline to read deeper from.",
    inputSchema: object({ chatId: CHAT_ID, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId"]),
    write: false,
    run: chatState,
    cli: { command: "chat", section: SECTION, usage: `chat <chatId> ${PAGING_USAGE}`, summary: "A chat's state view, as Play shows it", positionals: ["chatId"], needs: 1, options: PAGING_OPTIONS },
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
    inputSchema: object({ chatId: CHAT_ID, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId"]),
    write: false,
    run: inspector,
    cli: { command: "inspector", section: SECTION, usage: `inspector <chatId> ${PAGING_USAGE}`, summary: "A chat's context inspector", positionals: ["chatId"], needs: 1, options: PAGING_OPTIONS },
  },
  {
    name: "lre_gm",
    description:
      "A chat's GM view: everything as it stands, secrets included. Every entity (/entities: fields, relations, levels, classes, life state, who knows it), kinds, tiers, places, tracks with their stages and truths, relation types, everyone's money (/money, the POV first), every organization as GM → Orgs shows it (/orgs), the fight as the GM sees it, the ✎ fixes and GM edits in force (/edits), refused writes, the writes waiting for a turn under way with what each waits on (/held), and character minds (/minds). Ids from here are what lre_gm_edit's operations name. The whole view is many megabytes on a large world, so with no part, entity, party or org and no pointer it answers the view's outline: how many each part holds, and how to read them; part all reads the whole view at once. part (one of the parts above) builds and sends that part alone; entity, party or org (an id, or a name: an ambiguous one is refused, listing the ids) one entity, one party's money or one organization, and account (with party) that money cut to one account; kind (with part entities, or alone) the entities of that kind or a kind extending it; compact the entities with each field's definition once per kind (/fieldDefs) and their fields as values alone. A pointer whose first token is a part reads that part alone too, and a token on a list may be an item's id or name: /money/danny_okafor/accounts, /orgs/Alder Automotive, /entities/pov. A large value comes back as an outline: page its entries with from and limit, or its JSON with offset. Needs spoilers: true.",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, part: { type: "string", enum: [...GM_PARTS, GM_ALL], description: `Only this part, built alone; ${GM_ALL}: the whole view at once (many megabytes on a large world). Left out, with no entity, party, org or pointer either: the view's outline.` }, ...GM_PICKS }, ["chatId", "spoilers"]),
    write: false,
    run: gmView,
    cli: { command: "gm", section: SECTION, usage: `gm <chatId> --spoilers [--part <part|${GM_ALL}> | --entity <id|name> | --party <id|name> [--account <id|name>] | --org <id|name>] [--kind <kind>] [--compact] ${PAGING_USAGE}`, summary: "A chat's GM view: its outline, one part of it, or all of it, secrets included", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, "--part": { arg: "part", as: "text" }, ...GM_PICK_OPTIONS } },
  },
  {
    name: "lre_sections",
    description:
      "What the narrator would get in a chat's next turn, at a JSON Pointer, as GM → This chat → Sections previews it: every section in prompt order (/sections: its status, sent, off, unplaced, empty or clipped, its scope, its text as the narrator reads it with marked facts and hints, its tokens, and the lines its caps cut), and the section budget (/budget). Built the way a turn builds it, with no model call; Outcome, Montage, Outline and Scene's elapsed time are the turn's own and wait for it. Needs spoilers: true.",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId", "spoilers"]),
    write: false,
    run: sections,
    cli: { command: "sections", section: SECTION, usage: `sections <chatId> --spoilers ${PAGING_USAGE}`, summary: "What the narrator would get next turn, section by section", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, ...PAGING_OPTIONS } },
  },
  {
    name: "lre_minds",
    description: "A chat's character minds at a JSON Pointer, as GM → Minds shows them: whether minds are on, the secrecy, the clock, and every character but the POV (/characters, closest on the ladder first: fidelity and why, pins, the latest mind, plans, notes, commitments, summary and holdings), what the chat knows (/knowledge: every fact with its holders, the player character's own holdings, and the threshold a suspicion is under), with the latest Run minds now at /run. Needs spoilers: true. Change them with lre_mind_edit; run them with lre_minds_run.",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId", "spoilers"]),
    write: false,
    run: minds,
    cli: { command: "minds", section: SECTION, usage: `minds <chatId> --spoilers ${PAGING_USAGE}`, summary: "A chat's character minds and their latest run", positionals: ["chatId"], needs: 1, options: { "--spoilers": { arg: "spoilers", as: "flag" }, ...PAGING_OPTIONS } },
  },
  {
    name: "lre_items_find",
    description:
      "The things in a chat that words name, best first, as GM → Things finds them (ITEMS-SPEC §7.5): the name resolver's matches (as the player character would mean the words), then any thing whose name, alias or type has a word starting with each word given. Each with its id (what lre_gm_edit's item ops name), name, type, size, where it is (outermost first), whose it is and who has it, hidden and secret ones marked. Reads the chat as the GM does, secrets included: needs spoilers: true.",
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, words: { type: "string", description: 'The words that name it, as the story says them: "Danny\'s truck keys", "the wallet".' } }, ["chatId", "spoilers", "words"]),
    write: false,
    run: itemsFind,
    cli: { command: "items-find", section: SECTION, usage: "items-find <chatId> <words> --spoilers", summary: "The things words name in a chat, best first", positionals: ["chatId", "words"], needs: 2, options: { "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_orgs",
    description:
      "A chat's organizations (ORG-SPEC §7.5): with no org, the player character's Orgs home (the party, where they belong, the organizations they know of); with org (its id or name; \"party\" for the party; a name several share is refused, listing their ids), its page as their Orgs tab reads it (their place there, who runs it, its people with titles, positions and jobs, positions and delegations, its money, premises, ownership and taxes where they may see them, its decisions, its History), or one part of it: overview, people, money, property, ownership, taxes, projects (its production projects: each step's days, cost, when it's paid, what it waits on and what it unlocks; where each stands, what it has paid and when it's due to be done), rules, decisions (how its decisions are made, its motions with each voter's vote and its requests for approval, each by the id lre_gm_edit's vote, end_motion and answer name) or log. account (with org) cuts its money to one account (id or name): its lines, cards and standing payments. Members the player character can't see are only counted. With spoilers: true, GM → Orgs instead, read from that part of the GM view alone: every organization, every member named, and who holds each power there and why. Ids from here are what lre_gm_edit's org op names. The answer is whole JSON when it fits; a larger one, or one read with pointer, offset, from or limit, reads as lre_gm's do: an outline to read deeper from by pointer (a token on a list may be an item's id or name), its entries page by page from from, or its JSON from offset.",
    inputSchema: object({ chatId: CHAT_ID, org: { type: "string", description: 'The organization: its id or its name ("Alder Automotive"), or "party"; leave it out for the list.' }, part: { type: "string", enum: [...ORG_PARTS], description: "Only this part of its page; needs org." }, account: { type: "string", description: "With org: its money cut to this account (id or name)." }, spoilers: { type: "boolean", description: "true: read GM → Orgs, everyone named and every power's holders, which the player isn't meant to know. Pass it only when the user asked to see behind the curtain." }, pointer: POINTER, offset: OFFSET, from: FROM, limit: LIMIT }, ["chatId"]),
    write: false,
    run: orgsRead,
    cli: { command: "orgs", section: SECTION, usage: `orgs <chatId> [--org <id|name>] [--part <part>] [--account <id|name>] [--spoilers] ${PAGING_USAGE}`, summary: "A chat's organizations, or one's page", positionals: ["chatId"], needs: 1, options: { "--org": { arg: "org", as: "text" }, "--part": { arg: "part", as: "text" }, "--account": { arg: "account", as: "text" }, "--spoilers": { arg: "spoilers", as: "flag" }, ...PAGING_OPTIONS } },
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
      'GM edits on the chat\'s latest message (GM view → Edit): the operations in order, all or none, as one edit with an Undo chip; locked fields are writable. Each names its op: set {entity, field, value}; add {entity, field, delta}; link {rel, from, to, fields?, until?}; unlink {rel, from, to}; move {entity, to: place}; put {entity, into: entity or null}; adjust {account, cents} (money in or out against a correction); stage {track, to}; entity {entity, tier?, agent?, levels?}; classify {entity, class, tags}; life {entity, to?, tell?}; spawn {kind, name, id?, tier?, place?, agent?}; despawn {entity}; restore {entity}; mind_pin, mind_refresh, mind_memory, mind_intent, mind_knowledge (as lre_mind_edit); effect {effect, args}; feed {section, to: {enabled?, maxTokens?, maxLines?, include?, scope?: "player", "scene" or "gm"} or null} sets a section\'s settings in this chat over the world\'s (null returns them); item {change} is one change to a thing, its change.do one of make {name, at: {place} or {in}, why, type?, size?, owner?, home?, qty?, aliases?, hidden?} (refused as exists when one it may be is there already: use that one), move {item, to: {place} or {in}, why} (a thing too big to carry lands where its person stands), hand {item, to, basis: hold, loan, return, gift, sale, trade or theft, until?, why} (only a gift, sale or trade changes the owner), own {item, owner or null, why}, grant or revoke {item, who, basis?: hold, loan or assign, until?, by?}, permit or unpermit {from, to, scope?: all or home, until?, by?}, home {item, home: {place}, {in}, "owner" or null}, use {item, qty?}, wear {item, who, off?}, condition {item, delta}, lose {item, by?}, label {item, name?, aliases?, description?, size?}, merge {keep, drop}, remove {item, why}, each until the clock in minutes (lre_gm reads it at /minds/now); place {change} is one change to a place made in play, its change.do one of make {name, parent, as: room, spot or venue, why, aliases?, description?, entry?} (refused as exists when one of that name is under the parent), label {place, name?, aliases?, description?}, remove {place} (a made place nobody and nothing is in); org {change} is one change to an organization as the GM makes it (no one\'s powers asked, its History line kept), its change.do one of found {type: company or group, name, founder, kind?, structure?, capital?, from?, units?}, admit {org, who, title?, position?, why}, remove {org, who, why}, appoint {org, who, position or null, why}, title {org, who, title or null}, position {org, position: {title, id?, powers?, seats?, reports_to?, scope?, limits?: {payment?, month?}, successor?, default?}}, unposition {org, position}, delegate {org, to, powers, payment?, month?, accounts?, until?: YYYY-MM-DD, by}, revoke {org, to}, hire {org, who, position?, title?, basis?, rate?, hours?}, fire {job, why}, pay {job, rate or pct}, issue {org, to, units, price (a unit), class?, from?}, buy_back {org, from, units, price}, transfer {org, from, to, units or pct, price?}, list {org, units, price? (a unit), symbol?} (a C corporation on the market; listed already, more units), delist {org, price? (a unit)} (every public unit bought back), trade {org, who, side: buy or sell, units, account?} (its stock on the market; cap-table units sell into its float), entry {place, entry: owner, members, staff, customers, public or null, keys?}, dues {org, cents or null, every?}, tier {who, tier: core, companion, hired, ally or null}, restructure {org, structure}, wind_up {org, stage?: all, begin, finish or resume, property?: distribute or sell, to?, why?}, merge {org, into, ratio?, cash?, from?, keep?, why?}, rename {org, name}, tax_status {org, status: charity, church or club (a row of the world\'s exempt table), or null}, consolidate {org, elect: true or false}, propose {by, change, party?} (an issue, buy_back, restructure, list, delist, wind_up or merge change put to a vote for by, who lacks the votes alone), vote {org, motion, who, vote: for, against or abstain}, end_motion {org, motion, how: close or withdraw}, answer {org, request, answer: approve, deny or withdraw, by?, why?} (by: one up the requester\'s chain of command, or the requester withdrawing; none, the GM), decisions {org, vote_by?: shares or members, quorum?, pass?, days?, approval_days?; null puts a default back}, money in minor units (lre_orgs reads organizations, and its decisions part the motion and request ids). Ids come from lre_gm. Needs spoilers: true.',
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, ops: { type: "array", minItems: 1, maxItems: EDIT_OPS_MAX, items: OPS_ITEM, description: 'The operations, applied in order: [{"op": "set", "entity": "pov", "field": "mood", "value": "calm"}].' } }, ["chatId", "spoilers", "ops"]),
    write: { destructive: true, idempotent: false },
    run: (args, ctx) => gmEdit(args, ctx, "lre_gm_edit"),
    cli: { command: "gm-edit", section: SECTION, usage: "gm-edit <chatId> --ops <file|json> --spoilers", summary: "GM edits, all or none", positionals: ["chatId"], needs: 1, options: { "--ops": { arg: "ops", as: "json" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_mind_edit",
    description:
      'Change characters\' minds (GM → Minds), as one GM edit with an Undo chip: mind_pin {entity, level: "live", "near", "far", "background", or null to unpin} pins a character\'s fidelity; mind_refresh {entity} asks for a fresh mind next turn; mind_memory {entity, part: "note", "commitment" or "plan", id, value} edits one (value: the fields to change), adds one (id null; value needs its text, and a plan its what and when) or deletes one (value null); mind_intent {entity, text?, approach?} sets what they mean to do now, in your words (at most 600 characters), which only their own mind reads, first, and works from, and how they go about it ("reactive": answer the scene; "proactive": pursue their own aims; null: their mind decides); give either or both, "" and null empty them, and with both empty the intent is cleared; mind_knowledge {entity, fact, holding} sets what one person (the player character too) holds of a fact the chat knows, whole: holding {how: "authored", "witnessed", "told", "inferred" or "guessed", by: who told them or null (a told one names its teller), evidence: [fact ids and witness refs], since: {msg, at}, belief: "true", "false" or "uncertain", confidence: 0 to 1, keptFrom?: [ids] or "everyone"}, or holding null to take it away. lre_minds shows the ids, each intent, the facts (/knowledge/facts) and each holding. Needs spoilers: true.',
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, ops: { type: "array", minItems: 1, maxItems: EDIT_OPS_MAX, items: { type: "object", properties: { op: { type: "string", enum: MIND_OPS } }, required: ["op", "entity"] }, description: 'The operations, in order: [{"op": "mind_pin", "entity": "danny_okafor", "level": "live"}].' } }, ["chatId", "spoilers", "ops"]),
    write: { destructive: true, idempotent: false },
    run: (args, ctx) => gmEdit(args, ctx, "lre_mind_edit", MIND_OPS),
    cli: { command: "mind-edit", section: SECTION, usage: "mind-edit <chatId> --ops <file|json> --spoilers", summary: "Pin, refresh, edit or steer characters' minds", positionals: ["chatId"], needs: 1, options: { "--ops": { arg: "ops", as: "json" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
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
    description: `Play an action from the palette as the player's next turn: action is an entry's action id (lre_chat_state's /palette/entries), params the picked option's params merged in order (each option's params; an amount or count goes under the entry's amount or number param). text, when given, is the player's words for how they do it (the judge rates them); without it the message is the action's label. It posts the player's message. A money or organization action with no text is done at once, off screen (no message, no reply; Undo on its chip); with text it plays as the player's next turn. ${REPLY}`,
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
  {
    name: "lre_day",
    write: false,
    description:
      "A character's routine and day in a chat (DESIGN §8). As the GM (spoilers: true): their effective routine, each block with the owner it comes from (this chat, their own, a group, a kind, a selector, the world, the basic needs), its source (authored, lore, a sheet, the story, the GM) and what it shadows; every schedule that applies, which wins and the chat's change; the day as laid with why each block is there; what the story holds now; and the invitations they made and received with their grounds. As the player (view: \"player\"): only what Cast shows of someone the POV may know.",
    inputSchema: object({ chatId: CHAT_ID, entity: { type: "string", description: "The character's id (lre_gm lists them)." }, view: { type: "string", enum: ["gm", "player"], description: "gm (needs spoilers: true) or player." }, day: { type: "integer", description: "A day index; today when left out (gm only)." }, spoilers: SPOILERS }, ["chatId", "entity", "view"]),
    run: (args, ctx) => routineDay(args, ctx),
    cli: { command: "day", section: SECTION, usage: "day <chatId> <entity> [--view gm|player] [--day <n>] [--spoilers]", summary: "A character's routine and day, with why", positionals: ["chatId", "entity"], needs: 2, options: { "--view": { arg: "view", as: "text" }, "--day": { arg: "day", as: "int" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
  {
    name: "lre_routine_changes",
    write: false,
    description: "Everyone a chat changed the routine or schedules of (GM → Routine): their follow setting, and the blocks and schedules it changed, with whether the GM or the story did. Needs spoilers: true.",
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
    description:
      'Change characters\' routines and schedules in a chat (GM → Routine), as one GM edit with an Undo chip: routine_follow {entity, mode?: "follows", "no_invitations" or "off" (no routine: the story, the GM, commitments and basic needs only), awareness?: "story_first", "balanced" or "routine_first", role?: "informative" (context only: the engine never moves them by their routine or schedules), "enforced" (lived, the story first) or "off" (not even context)} (null returns a part to the world\'s, the role to their level\'s); routine_block {entity, block, value: a block, {"id", "off": true}, or null to drop the chat\'s change}; schedule_override {entity, schedule, value: {"off": true, "until": minutes or null}, {"slots": [...], "recurrence"?}, or null}. lre_day shows the blocks and schedules. Needs spoilers: true.',
    inputSchema: object({ chatId: CHAT_ID, spoilers: SPOILERS, ops: { type: "array", minItems: 1, maxItems: EDIT_OPS_MAX, items: { type: "object", properties: { op: { type: "string", enum: ROUTINE_OPS } }, required: ["op", "entity"] }, description: 'The operations, in order: [{"op": "routine_follow", "entity": "danny_okafor", "mode": "no_invitations"}].' } }, ["chatId", "spoilers", "ops"]),
    write: { destructive: true, idempotent: false },
    run: (args, ctx) => gmEdit(args, ctx, "lre_routine_edit", ROUTINE_OPS),
    cli: { command: "routine-edit", section: SECTION, usage: "routine-edit <chatId> --ops <file|json> --spoilers", summary: "Change characters' routines and schedules in a chat", positionals: ["chatId"], needs: 1, options: { "--ops": { arg: "ops", as: "json" }, "--spoilers": { arg: "spoilers", as: "flag" } } },
  },
];

/** A character's day: the GM's view behind the spoilers gate, the player's as Cast shows it. */
async function routineDay(args: Args, ctx: ToolContext): Promise<ToolResult> {
  const chatId = chatIdOf(args);
  const entity = neededText(args, "entity", "the character's id (lre_gm lists them)");
  const view = textArg(args, "view") === "player" ? "player" : "gm";
  if (view === "gm") gate(args, "lre_day", "shows a character's whole routine, secrets and the GM's changes included");
  const day = intArg(args, "day", Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const body = await ask(ctx, chatId, "lre.routine", { chatId, op: "day", entity, view, ...(day !== undefined && view === "gm" ? { day } : {}) });
  return { text: json(body) };
}
