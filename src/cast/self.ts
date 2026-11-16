// What a character's own tools share (plan §7.1, §7.4): each acts for the character the calling agent
// plays (`AgentRef.plays`), on the call's turn, so a swipe takes back what it wrote; and each reads its
// call in whatever shape its arguments were sent, the way `cast_update` does (`update.ts`): what an
// item does not read, or a value it cannot read, is left out and said once; an item that cannot be
// read at all answers the whole call, and nothing is written.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { Reply } from "../iface/kit";
import { type CastCall, type CastReading, readingOr } from "./kit";
import { type CastWriter, type Character, findCharacter } from "./record";
import { isUnread, type ItemRead, type Kind, readArg, type Unread } from "./update";

/** What one call of a character's own tool works with: the reading, the character, story time, and the writer of its rows. */
export interface Self {
  reading: CastReading;
  character: Character;
  now: number | null;
  writer: CastWriter;
}

/** The character the calling agent plays, at the call's turn or, in a job of no turn, as that job's own changes; a line says why not when there is none. */
export function selfOr(call: CastCall, reply: Reply): Self | null {
  const reading = readingOr(call, reply);
  if (reading === null) return null;
  const plays = call.agent.plays;
  if (plays === undefined) {
    reply.line("plays_none", { tool: call.tool }).fail();
    return null;
  }
  const character = findCharacter(call.deps.store.db, call.scope.user, reading.chats, plays);
  if (character === null) {
    reply.line("no_character", { who: plays }).fail();
    return null;
  }
  const now = reading.clock?.now ?? null;
  return { reading, character, now, writer: { user: call.scope.user, turn: call.scope.turn ?? null, chat: call.scope.chat, by: call.agent.definition, agent: call.agent.id, job: call.agent.job ?? null, at: now, now: (call.deps.now ?? Date.now)() } };
}

/** Arguments that hold nothing back: the file says what each is, and this code reads each in whatever shape it comes. */
export function unchecked(names: readonly string[]): Record<string, JsonObject> {
  return Object.fromEntries(names.map((name) => [name, {}]));
}

/** A list argument as a call sent it; one item sent on its own is read as a list of one. */
export function listOf(said: JsonValue | undefined): JsonValue[] {
  return said === undefined || said === null ? [] : Array.isArray(said) ? said : [said];
}

/** Reads `kinds` of an item into `value`; what cannot be read goes to the item's `unread`. */
export function readFields(call: CastCall, it: ItemRead, given: JsonObject, kinds: Readonly<Record<string, Kind>>, value: JsonObject): void {
  for (const [field, kind] of Object.entries(kinds)) {
    const got = readArg(call.lines, it.n, it.op ?? "", field, kind, given[field], call.settings.dimensionScale);
    if (isUnread(got)) {
      it.unread.push(got);
      if (got.applied !== undefined) value[field] = got.applied;
    } else if (got !== undefined) value[field] = got;
  }
}

/** The parts whose items a character's own tools name by id as where something comes from. */
export type OwnPart = "memory" | "perception";

/** The ids of `part` (or of either of several) a list names that are none of the character's on this path. */
export function strangers(self: Self, part: OwnPart | readonly OwnPart[], ids: unknown): string[] {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  const parts: readonly string[] = typeof part === "string" ? [part] : part;
  return list.filter((id) => {
    const item = self.reading.record.items.get(id);
    return item === undefined || !parts.includes(item.part) || item.character !== self.character.id;
  });
}

/**
 * The ids of `part` an item's `field` names that are the character's: those that are not are left
 * out, each said; none left of a list it needs, they make the item unreadable.
 */
export function ownIds(self: Self, it: ItemRead, part: OwnPart | readonly OwnPart[], field: string, ids: JsonValue | undefined, need: boolean): string[] {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  const unknown = strangers(self, part, list);
  const kept = list.filter((id) => !unknown.includes(id));
  const said: Unread[] = unknown.map((id) => ({ line: "unknown_id", fields: { n: it.n, op: it.op, field, who: self.character.name, part: typeof part === "string" ? part : part.join(" or "), id: JSON.stringify(id) }, ...(kept.length > 0 ? { kept: true } : {}) }));
  (need && kept.length === 0 ? it.fatal : it.unread).push(...said);
  return kept;
}

/** An item a list holds that is no object: it cannot be read at all. */
export function notAnItem(n: number, op: string, field: string, raw: JsonValue): ItemRead {
  return { n, fatal: [{ line: "unreadable_op", fields: { n, op, field, value: JSON.stringify(raw) } }], unread: [], ignored: [] };
}
