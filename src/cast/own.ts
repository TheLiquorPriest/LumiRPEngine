// The character's own writes besides its memory (plan §7.1): `mind_set`, what is on its mind now
// (attention, feeling, beliefs, wants, plans, what it hides), and `relate`, how it feels about each
// person, in its voice, with the few dimensions when useful. Each acts for the character the calling
// agent plays, on the call's turn, so a swipe takes back what it wrote (`self.ts`). Every word is the
// character's agent's: code keeps the rows, by kind and by person, and judges none of them. Which
// agent holds these tools, and when it uses them, is its definition's and the guidance's.
//
// Each call is read in whatever shape its arguments were sent. What an entry does not read, or a value
// it cannot read (a dimension off its scale, a perception that is none of the character's), is left
// out: the rest is written, and the answer names what was left out. A call one of whose entries
// cannot be read at all (an id that is none of theirs, a new entry with no kind or no text, a
// relationship toward no one) is answered whole, and nothing is written.

import type { JsonObject } from "rp-harness/contract";
import type { ReadContext } from "../engine/registry";
import type { Reply } from "../iface/kit";
import { isRecord } from "../shared/json";
import { type CastCall, type CastToolSpec, itemView, readingOr } from "./kit";
import { type CastRow, type CastWrite, type CastWriter, MIND_KINDS, RELATIONSHIP_DIMENSIONS, relationshipItemId, writeCast } from "./record";
import { PROVENANCE_READS, readOwnSource, sourceLines, sourceShown, stampOn } from "./source";
import { towardOf } from "./refs";
import { worldAt } from "./secrets";
import { listOf, nearOwn, notAnItem, ownIds, readFields, selfOr, unchecked } from "./self";
import { CAST_LANE, ignoredOf, type ItemRead, type Kind, leftOut, needed, outsideDimensions, type Reads, refused } from "./update";

/** What one entry of the mind reads, each as its kind. */
const ENTRY: Readonly<Record<string, Kind>> = { id: "name", kind: MIND_KINDS, text: "text", about: "texts", from: "texts", drop: "flag", why: "text" };
const ENTRY_READS: Reads = { reads: [...Object.keys(ENTRY), ...PROVENANCE_READS], needs: [], newNeeds: ["kind", "text"] };

/** Where a feeling, a plan or a stand toward someone can come from: the character's own perceptions and memories, a realization among them. */
const FROM_PARTS = ["perception", "memory"] as const;

/** What one relationship reads, each as its kind. */
const RELATIONSHIP: Readonly<Record<string, Kind>> = { with: "name", text: "text", ...Object.fromEntries(RELATIONSHIP_DIMENSIONS.map((d) => [d, "dimension"])), from: "texts", drop: "flag", why: "text" };
const RELATIONSHIP_READS: Reads = { reads: [...Object.keys(RELATIONSHIP), ...PROVENANCE_READS], needs: ["with"], newNeeds: [] };

/** Writes what a call read, and answers with each item it wrote as it now stands, with the source it was recorded with, and with what was left out. */
async function writeOwn(call: CastCall, reply: Reply, writer: CastWriter, items: readonly ItemRead[], writes: readonly CastWrite[], reads: Reads, key: string): Promise<Reply> {
  if (items.some((it) => it.fatal.length > 0)) return refused(reply, items, () => reads);
  const rows: CastRow[] = await call.deps.writes.run(() => writeCast(call.deps.store, writer, writes), call.tool);
  for (const it of items) leftOut(reply, it, reads.reads);
  sourceLines(reply, items);
  const after = readingOr(call, reply);
  if (after === null) return reply;
  const sources = new Map(rows.map((r, i) => [r.item, sourceShown(writes[i])]));
  const shown = [...new Set(rows.map((r) => r.item))].flatMap((id) => {
    const item = after.record.items.get(id);
    return item === undefined ? [] : [{ ...itemView(after, item), source: sources.get(id) ?? null }];
  });
  return reply.data({ [key]: shown });
}

// ---------------------------------------------------------------- mind_set

async function mindSet(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const list = listOf(args.entries);
  if (list.length === 0) return reply.line("no_entries_sent", {}).fail();
  const self = selfOr(call, reply);
  if (self === null) return reply;
  const items: ItemRead[] = [];
  const writes: CastWrite[] = [];
  for (const [i, raw] of list.entries()) {
    const n = i + 1;
    if (!isRecord(raw)) {
      items.push(notAnItem(n, "mind", "entries", raw));
      continue;
    }
    const given = raw as JsonObject;
    const it: ItemRead = { n, op: "mind", fatal: [], unread: [], ignored: ignoredOf(given, ENTRY_READS.reads) };
    items.push(it);
    const value: JsonObject = {};
    readFields(call, it, given, ENTRY, value);
    readOwnSource(call, it, given);
    const { id, ...fields } = value;
    // An entry to change is one of the character's own on this path, of a kind the mind holds; a file carried from the earlier build is none of them.
    const item = id === undefined ? undefined : self.reading.record.items.get(id as string);
    if (id !== undefined && (item === undefined || item.part !== "mind" || item.character !== self.character.id || !(MIND_KINDS as readonly unknown[]).includes(item.fields.kind))) {
      it.fatal.push({ line: "unknown_id", fields: { n, op: "mind", who: self.character.name, part: "mind", id: JSON.stringify(id), near: nearOwn(self, "mind", String(id)) } });
      continue;
    }
    if (fields.from !== undefined) {
      const from = ownIds(self, it, FROM_PARTS, "from", fields.from, false);
      if (from.length > 0) fields.from = from;
      else delete fields.from;
    }
    if (id === undefined) needed(it, ENTRY_READS.newNeeds.filter((f) => fields[f] === undefined));
    else if (!Object.keys(fields).some((k) => k !== "why")) it.fatal.push({ line: "needs_one", fields: { n, op: "mind", fields: Object.keys(ENTRY).filter((f) => f !== "id" && f !== "why") } });
    if (it.fatal.length === 0) writes.push({ character: self.character.id, part: "mind", item: (id as string | undefined) ?? null, value: fields, ...stampOn(it.prov) });
  }
  return writeOwn(call, reply, self.writer, items, writes, ENTRY_READS, "entries");
}

export const MIND_SET: CastToolSpec = {
  name: "mind_set",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  properties: { entries: { type: "array", items: { type: "object", properties: unchecked(ENTRY_READS.reads) } } },
  required: [],
  example: {
    entries: [
      { kind: "feeling", text: "Cornered, and angry at being cornered.", about: ["the reeve"] },
      { kind: "plan", text: "Read the next sealed letter before I pass it on.", from: ["p-4"] },
    ],
  },
  run: mindSet,
};

// ---------------------------------------------------------------- relate

async function relate(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const list = listOf(args.relationships);
  if (list.length === 0) return reply.line("no_relationships_sent", {}).fail();
  const self = selfOr(call, reply);
  if (self === null) return reply;
  const items: ItemRead[] = [];
  const writes: CastWrite[] = [];
  let ctx: ReadContext | null | undefined;
  for (const [i, raw] of list.entries()) {
    const n = i + 1;
    if (!isRecord(raw)) {
      items.push(notAnItem(n, "relationship", "relationships", raw));
      continue;
    }
    const given = raw as JsonObject;
    const it: ItemRead = { n, op: "relationship", fatal: [], unread: [], ignored: ignoredOf(given, RELATIONSHIP_READS.reads) };
    items.push(it);
    const value: JsonObject = {};
    readFields(call, it, given, RELATIONSHIP, value);
    outsideDimensions(it, given);
    readOwnSource(call, it, given);
    if (typeof value.with !== "string") {
      needed(it, ["with"]);
      continue;
    }
    if (value.from !== undefined) {
      const from = ownIds(self, it, FROM_PARTS, "from", value.from, false);
      if (from.length > 0) value.from = from;
      else delete value.from;
    }
    if (!Object.keys(value).some((k) => k !== "with" && k !== "why")) {
      it.fatal.push({ line: "needs_one", fields: { n, op: "relationship", fields: Object.keys(RELATIONSHIP).filter((f) => f !== "with" && f !== "why") } });
      continue;
    }
    // Toward a person by reference (a character of the chat, or the world's person), the name as written beside it: a rename follows, and the id joins the same relationship.
    const toward = towardOf(call.deps.store.db, call.scope.user, self.reading.chats, ctx ??= worldAt(call.deps.store, call.scope.user, call.scope.turn ?? null, call.agent.job ?? null, call.scope.chat), value.with);
    writes.push({ character: self.character.id, part: "relationship", item: relationshipItemId(self.character.id, toward.ref), value: { ...value, with: toward.name, toward: toward.ref }, ...stampOn(it.prov) });
  }
  return writeOwn(call, reply, self.writer, items, writes, RELATIONSHIP_READS, "relationships");
}

export const RELATE: CastToolSpec = {
  name: "relate",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  properties: { relationships: { type: "array", items: { type: "object", properties: unchecked(RELATIONSHIP_READS.reads) } } },
  required: [],
  example: { relationships: [{ with: "Wren", text: "She lied to me about the causeway, and I still want her safe.", trust: -10, warmth: 30 }] },
  run: relate,
};
