// `perceive` (plan §7.3, §9.6): what reached a character of a moment of a turn, as the omniscient
// side writes it. Who writes perceptions, for whom and when is the perceptions rule's to say; code
// records them. Each carries the fields of §7.3: how much reached them, what reached their senses,
// what they missed, what they now know, its source (first hand, or who told them and how reliably),
// and the moment it belongs to. It is a row of the turn that wrote it and names the turn it is of
// (this one, or an earlier reply on the path), so who has none for a turn can be counted. Each
// statement of what they now know is a row of their knowledge, tied to the perception; a secret
// named by its id is held the way today's build holds it (`secrets.ts`), on the same turn, its fact
// recorded first when the chat holds none yet. Striking a perception strikes the knowledge tied to
// it, and takes back each secret's holding that no other knowledge of theirs still gives; correcting
// one with a new list of what they now know, or of the secrets they hold, strikes in the same way the
// knowledge it gave that the new list no longer gives, and writes only what that knowledge lacks.
//
// The whole call is read first, each perception in whatever shape its arguments were sent. What a
// perception does not read, or a value it cannot read (a reply the path does not have, a secret that
// cannot be held), is left out: the perception is written with the rest, and the answer names what
// was left out. A name the cast does not hold yet is made a character, not yet cast, and the answer
// says so. A perception that cannot be read at all answers the call, and nothing is written. The
// user's setting for the story lane is held by the harness's gate before the call runs.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import type { Reply } from "../iface/kit";
import type { LedgerEvent } from "../shared/ledger";
import type { FactId } from "../shared/minds";
import { isRecord } from "../shared/json";
import { type CastCall, type CastReading, type CastToolSpec, readingOr, whoView } from "./kit";
import { type CastItem, type CastWrite, writeCast } from "./record";
import { forgetsOf, holdingChanges, secretsHeld, secretsLetGo, SecretWorld, worldAt } from "./secrets";
import { CAST_LANE, characterNamed, ignoredOf, isUnread, type ItemRead, type Kind, leftOut, makeFresh, needed, readArg, type Reads, refused, type Unread } from "./update";

/** How much of a moment reached a character (§7.3): all of it, part of it, told of it by someone, or nothing. */
export const REACHES = ["whole", "part", "told", "none"] as const;

/** Each perception's arguments, each read as its kind. */
const ARGS: Readonly<Record<string, Kind>> = {
  id: "name",
  who: "name",
  message: "whole",
  moment: "text",
  reach: REACHES,
  content: "text",
  missed: "text",
  knows: "texts",
  secrets: "texts",
  told_by: "name",
  reliability: "text",
  drop: "flag",
  why: "text",
};

/** None holds back a value: the file says what each is, and this code reads each in whatever shape it comes. */
const PROPERTIES: Record<string, JsonObject> = Object.fromEntries(Object.keys(ARGS).map((name) => [name, {}]));

/** What an answer's lines call one item of the call. */
const OP = "perception";

/** What a perception reads, what every one needs, and what a new one needs. */
const READS: Reads = { reads: Object.keys(ARGS), needs: ["who"], newNeeds: ["reach"] };

/** A perception read, ready to write. */
interface Planned {
  n: number;
  character: string;
  name: string;
  /** The perception it rewrites, or null for a new one. */
  item: string | null;
  /** What the perception's row says. */
  value: JsonObject;
  /** Each statement of what they now know that no knowledge it gave already says: a new row of their knowledge. */
  knows: string[];
  /** Each secret they now hold, with the events that hold it (none when they hold it so already). */
  secrets: { fact: FactId; events: LedgerEvent[] }[];
  /** Of those secrets, each that no knowledge it gave already holds: a new row of their knowledge. */
  newSecrets: FactId[];
  /** The knowledge it gave that goes (all of it, for a perception it strikes), and each secret's holding taken back. */
  struck: string[];
  forgets: { fact: FactId; events: LedgerEvent[] }[];
}

/** One perception as read, and what it writes when it can be read. */
interface PerceptionRead extends ItemRead {
  planned?: Planned;
}

/** The turn a perception is of: the `of` it was written with. */
export function perceivedTurn(item: CastItem): string {
  return typeof item.fields.of === "string" ? item.fields.of : item.opened;
}

/** A perception as answers and views show it: its fields, with the reply it is of by its number on the path (null: this turn's, not saved yet) in place of the turn's id. */
export function perceptionView(reading: Pick<CastReading, "record">, item: CastItem): JsonObject {
  const { of: _of, ...fields } = item.fields;
  return { id: item.id, ...fields, message: reading.record.at.replyOf(perceivedTurn(item)), ...(item.dropped ? { dropped: true } : {}) };
}

/** One perception read: what it writes, what of it could not be read, and what it does not read. A name the cast does not hold yet goes to `fresh`, made at the write. */
async function readPerception(call: CastCall, cast: CastReading, world: SecretWorld, fresh: Map<string, string>, n: number, raw: JsonValue): Promise<PerceptionRead> {
  const given = isRecord(raw) ? (raw as JsonObject) : null;
  if (given === null) return { n, fatal: [{ line: "unreadable_op", fields: { n, op: OP, field: OP, value: JSON.stringify(raw) } }], unread: [], ignored: [] };
  const out: PerceptionRead = { n, op: OP, fatal: [], unread: [], ignored: ignoredOf(given, READS.reads) };
  const value: JsonObject = {};
  for (const [field, kind] of Object.entries(ARGS)) {
    const got = readArg(call.lines, n, OP, field, kind, given[field]);
    if (isUnread(got)) out.unread.push(got);
    else if (got !== undefined) value[field] = got;
  }
  const { id, who, message, knows, secrets, ...fields } = value;
  if (typeof who !== "string") return needed(out, ["who"]);
  const character = characterNamed(call, cast, fresh, who);

  let item: CastItem | null = null;
  if (id !== undefined) {
    const found = cast.record.items.get(id as string);
    if (found === undefined || found.part !== "perception" || found.character !== character.id) {
      out.fatal.push({ line: "unknown_id", fields: { n, op: OP, who: character.name, part: OP, id: JSON.stringify(id) } });
      return out;
    }
    if (Object.keys(fields).length === 0 && message === undefined && knows === undefined && secrets === undefined) {
      out.fatal.push({ line: "needs_one", fields: { n, op: OP, fields: Object.keys(ARGS).filter((f) => f !== "id" && f !== "who") } });
      return out;
    }
    item = found;
  } else if (fields.reach === undefined) return needed(out, ["reach"]);

  // The turn it is of: the reply named, else the one it was first written of, else this call's. A reply the path does not have is left out.
  const at = cast.record.at;
  let of: string | null = item === null ? (call.scope.turn ?? null) : perceivedTurn(item);
  const named = message === undefined ? undefined : at.turns.find((t) => at.replyOf(t) === message);
  if (named !== undefined) of = named;
  else if (message !== undefined) out.unread.push({ line: "no_message", fields: { n, op: OP, field: "message", message } });

  const said = (secrets as string[] | undefined) ?? [];
  const trouble: Unread[] = [];
  const turnRow = said.length === 0 || of === null ? null : call.deps.store.user(call.scope.user).turn(of);
  const held = said.length > 0 ? await secretsHeld(world, { n, op: OP, field: "secrets" }, character.name, fields.told_by, turnRow, said, call.settings.secretConfidence, trouble) : [];
  // A secret that cannot be held is left out; while another is held, the perception still holds secrets.
  out.unread.push(...trouble.map((u) => (held.length > 0 ? { ...u, kept: true } : u)));
  // The knowledge it gave that stands. Struck, the perception takes all of it along; corrected with what they now know or with the
  // secrets they hold (a list none of which could be held is left out, so it replaces nothing), what the new list no longer gives
  // goes. Each secret it gave is let go unless other knowledge of theirs still gives it.
  const gave = item === null ? [] : cast.record.of(character.id, "knowledge").filter((k) => k.fields.from === item.id);
  const holds = new Set(held.map((s) => s.fact));
  const struck =
    fields.drop === true
      ? item !== null && !item.dropped
        ? gave
        : []
      : gave.filter((k) => (knows !== undefined && typeof k.fields.text === "string" && !(knows as string[]).includes(k.fields.text)) || (holds.size > 0 && typeof k.fields.secret === "string" && !holds.has(k.fields.secret)));
  const forgets = forgetsOf(world.ctx, n, OP, character.name, secretsLetGo(cast.record, character.id, struck), out.unread);
  // What the knowledge it keeps already gives is not written again.
  const kept = gave.filter((k) => !struck.includes(k));
  const keptTexts = new Set(kept.flatMap((k) => (typeof k.fields.text === "string" ? [k.fields.text] : [])));
  const keptSecrets = new Set(kept.flatMap((k) => (typeof k.fields.secret === "string" ? [k.fields.secret] : [])));
  const row: JsonObject = { ...(item === null || named !== undefined ? { of } : {}), ...fields };
  if (knows !== undefined) row.knows = knows;
  if (held.length > 0) row.secrets = held.map((s) => s.fact);
  out.planned = {
    n,
    character: character.id,
    name: character.name,
    item: item?.id ?? null,
    value: row,
    knows: ((knows as string[] | undefined) ?? []).filter((text) => !keptTexts.has(text)),
    secrets: held,
    newSecrets: held.flatMap((s) => (keptSecrets.has(s.fact) ? [] : [s.fact])),
    struck: struck.map((k) => k.id),
    forgets,
  };
  return out;
}

async function perceive(args: JsonObject, call: CastCall): Promise<Reply> {
  const reply = call.reply();
  const list = args.perceptions;
  if (!Array.isArray(list) || list.length === 0) return reply.line("no_perceptions", {}).fail();
  const cast = readingOr(call, reply);
  if (cast === null) return reply;
  const turn = call.scope.turn;
  if (turn === undefined) return reply.line("perceive_turn", {}).fail();

  const world = new SecretWorld(
    () => worldAt(call.deps.store, call.scope.user, turn, call.agent.job ?? null),
    (book, entry) => (call.deps.books === undefined ? Promise.resolve(null) : call.deps.books({ user: call.scope.user, chat: call.scope.chat }, book, entry)),
  );
  const fresh = new Map<string, string>();
  const reads: PerceptionRead[] = [];
  for (const [i, raw] of list.entries()) reads.push(await readPerception(call, cast, world, fresh, i + 1, raw));
  if (reads.some((x) => x.fatal.length > 0)) return refused(reply, reads, () => READS);
  const planned = reads.flatMap((x) => (x.planned === undefined ? [] : [x.planned]));

  const user = call.scope.user;
  const writer = { user, turn, by: call.agent.definition, agent: call.agent.id, job: call.agent.job ?? null, at: cast.clock?.now ?? null, now: (call.deps.now ?? Date.now)() };
  const written = await call.deps.writes.run((db) => {
    // Each character named that the cast did not hold is made first, not yet cast.
    const ids = makeFresh(db, call, fresh, writer.now);
    const out: { character: string; perception: string; knowledge: string[] }[] = [];
    for (const p of planned) {
      const character = ids.get(p.character) ?? p.character;
      const [row] = writeCast(call.deps.store, writer, [{ character, part: "perception", item: p.item, value: p.value }]);
      const perception = row?.item ?? "";
      const source: JsonObject = { from: perception, ...(typeof p.value.told_by === "string" ? { told_by: p.value.told_by } : {}) };
      const knowledge: CastWrite[] = [
        ...p.knows.map((text): CastWrite => ({ character, part: "knowledge", item: null, value: { text, ...source } })),
        ...p.newSecrets.map((fact): CastWrite => ({ character, part: "knowledge", item: null, value: { secret: fact, ...source } })),
      ];
      out.push({ character, perception, knowledge: writeCast(call.deps.store, writer, knowledge).map((k) => k.item) });
      writeCast(call.deps.store, writer, p.struck.map((k): CastWrite => ({ character, part: "knowledge", item: k, value: { drop: true, ...(typeof p.value.why === "string" ? { why: p.value.why } : {}) } })));
    }
    // A secret's fact is recorded before anyone holds it; each perception's holdings, then what its strike lets go.
    const events = [...world.facts, ...planned.flatMap((p) => [...p.secrets.flatMap((s) => s.events), ...p.forgets.flatMap((f) => f.events)])];
    if (events.length > 0) call.deps.store.user(user).addChanges(turn, holdingChanges(events, CAST_LANE, call.agent.id, call.agent.job ?? null));
    return out;
  }, call.tool);
  for (const name of fresh.values()) reply.line("added", { who: name });

  const after = readingOr(call, reply);
  if (after === null) return reply;
  for (const x of reads) leftOut(reply, x, READS.reads);
  return reply.data({
    perceptions: planned.map((p, i) => {
      const done = written[i];
      const item = done === undefined ? undefined : after.record.items.get(done.perception);
      return {
        n: p.n,
        who: whoView({ id: done?.character ?? p.character, name: p.name }),
        id: done?.perception ?? null,
        now: item === undefined ? null : perceptionView(after, item),
        knowledge: done?.knowledge ?? [],
        ...(p.secrets.length > 0 ? { holds: p.secrets.map((s) => s.fact) } : {}),
        ...(p.struck.length > 0 ? { struck: p.struck } : {}),
        ...(p.forgets.some((f) => f.events.length > 0) ? { lets_go: p.forgets.flatMap((f) => (f.events.length > 0 ? [f.fact] : [])) } : {}),
      };
    }),
  });
}

export const PERCEIVE: CastToolSpec = {
  name: "perceive",
  family: "cast",
  tier: "write",
  lane: CAST_LANE,
  // Nothing the code reads is held back by the schema: a call it cannot read is answered in the answers' words, with what would work.
  properties: { perceptions: { type: "array", items: { type: "object", properties: PROPERTIES } } },
  required: [],
  example: {
    perceptions: [
      { who: "Bram", moment: "Wren opens the letter", reach: "part", content: "From behind the bar: Wren breaks a seal and goes pale.", missed: "What the letter says.", knows: ["Wren had a sealed letter."] },
      { who: "Odile", moment: "Wren opens the letter", reach: "told", content: "Bram says Wren read a letter and went white.", told_by: "Bram", reliability: "He saw it himself.", secrets: ["wi:vale-book:e-7:0"] },
    ],
  },
  run: perceive,
};
