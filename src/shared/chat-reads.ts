// How the chat tools read (DESIGN §23): a read tool's paging arguments and answer (`readOut`), the
// spoilers gate, and a read of a GM view (`gmRead`): its outline, one part built alone, one entity,
// party or organization by id or name, the entities of a kind, compact entities, or all of it. Shared
// by the chat tools LumiRPEngine serves outside clients (`backend/agents/tools/outside-play.ts`) and
// the command line's sandbox (`cli/tools-sandbox.ts`), which reads a scratch copy of a chat the same
// way, so both answer alike.

import { GM_IDS_PARTS, GM_KEYED_PARTS, GM_ROSTER, keyedItem, type GmKeyedPart, type GmOutline, type GmReadPart } from "./gm-parts";
import type { JsonObject, JsonValue } from "./json";
import { isRecord } from "./json";
import { parsePointer } from "./json-patch";
import type { CliMirror } from "./outside-tools";
import type { GmEntity } from "./state-view";
import type { ToolResult } from "./tool-answer";
import type { Args } from "./tool-args";
import { boolArg, intArg, textArg, textsArg, ToolError } from "./tool-args";
import { itemKey, nameOf, readAt } from "./tool-read";

const MAX_OFFSET = Number.MAX_SAFE_INTEGER;

export const POINTER: JsonObject = { type: "string", description: 'A JSON Pointer into it (RFC 6901): "" for an outline of the whole, "/hud" for one part. A token on a list is an index or, keyed, an item\'s id or name ("/money/danny_okafor", "/orgs/Alder Automotive"). In a key, "~1" stands for "/" and "~0" for "~".' };
export const OFFSET: JsonObject = { type: "integer", minimum: 0, description: "Read the value's JSON text from this character instead of outlining it; each page says where the next begins." };
export const SPOILERS: JsonObject = { type: "boolean", description: "Must be true: this shows (or answers with) what the player isn't meant to know. Pass it only when the user asked to see behind the curtain." };
export const FROM: JsonObject = { type: "integer", minimum: 0, description: "Read a list's or an object's entries from this one (0 is the first): whole when they fit, else outlined; each page says where the next begins." };
export const LIMIT: JsonObject = { type: "integer", minimum: 1, description: "With from (0 by default), at most this many entries." };
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

/** Refuses a spoiler-gated tool unless the caller said `spoilers: true`, before anything is asked of the host. */
export function gate(args: Args, name: string, shows: string): void {
  if (!boolArg(args, "spoilers")) throw new ToolError(`${name} ${shows}, which the player isn't meant to know. Call it again with spoilers: true, only if the user asked you to look behind the curtain.`);
}

/** A read tool's answer: the value at a pointer, outlined or paged as lre_world reads a world. */
export function readOut(root: unknown, what: string, args: Args): ToolResult {
  const read = readAt(root, { what, pointer: textArg(args, "pointer") ?? "", offset: intArg(args, "offset", 0, MAX_OFFSET), from: intArg(args, "from", 0, MAX_OFFSET), limit: intArg(args, "limit", 1, MAX_OFFSET) });
  return read.ok ? { text: read.text } : { text: read.text, isError: true };
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
export function onlyAccount(money: JsonObject, account: string, whose: string): JsonObject {
  const accounts = Array.isArray(money.accounts) ? money.accounts : [];
  const found = keyedItem(accounts, account, itemKey, nameOf);
  const listed = accounts.map((a) => `${itemKey(a) ?? "?"} (${nameOf(a) ?? "unnamed"})`).join(", ") || "none";
  if (found && "ambiguous" in found) throw new ToolError(`${found.ambiguous.length} of ${whose} accounts are named ${JSON.stringify(account)}: ${found.ambiguous.join(", ")}. Name one by its id.`);
  if (!found) throw new ToolError(`${whose} has no account ${JSON.stringify(account)}; its accounts: ${listed}.`);
  const id = itemKey(found.item);
  const names = (v: unknown): boolean => v === id || (Array.isArray(v) ? v.some(names) : isRecord(v) && Object.values(v).some(names));
  return Object.fromEntries(Object.entries(money).map(([key, v]) => [key, key === "accounts" ? [found.item] : Array.isArray(v) ? v.filter(names) : v]));
}
