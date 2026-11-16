// Who holds a lore secret (plan §9.6) is state, in the shape today's build keeps it, because the
// secrecy interceptor reads it there: a `Holding` under the minds slice's `knowledge.holdings`
// (`src/shared/minds.ts:1139-1156`), read by `heldSecrets` (`:1198`) for the interceptor
// (`src/backend/wi-interceptor.ts:101`). A perception's "now knows", or a knowledge entry `cast_update`
// writes, can name a secret by its own id; the holding is made by today's own minds code (`mindEdit`'s
// `mind_knowledge`, `src/packs/minds/core/edit.ts:156-183`, which words it as a `minds.learn` event)
// and recorded as a change of the turn that wrote the perception or the entry, so a swipe takes it
// back with them. Taking a holding back is the same code's `minds.forget`.
//
// The world's person a cast character is, is found by name: the cast keeps no other link to the
// world's people yet. A holding is of a fact the chat holds (`minds.fact`). A chat that never ran
// today's build holds none, so the first time a holding of a secret is asked for, its fact is
// recorded first, on the same turn, read from the lore the way today's seeding reads it
// (`src/backend/knowledge-seed.ts`); its claim is the lore's own words, never code's.

import type { ChangeInput, Store } from "../store";
import { applyEvent, validateEvent } from "../engine/events";
import { kindIs } from "../engine/scope";
import type { ReadContext } from "../engine/registry";
import type { WorldState } from "../engine/state";
import { mindEdit } from "../packs/minds/core/edit";
import type { EntityId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { bookTextHash } from "../shared/lore";
import { type FactId, type Holding, type KnowledgeFact, MINDS_EVENTS, parseFactId, wiFactIdOfLiveLore } from "../shared/minds";
import { parseSecretMarks, wholeEntrySecret } from "../shared/secret-marks";
import { type CastItem, type CastRecord, type Character, nameKey } from "./record";
import type { Unread } from "./update";

/** Reads a Lumiverse book entry's text live, for the secret a mark of it holds; null when the book or the entry is not there. */
export type BookReader = (scope: { user: string; chat: string }, book: string, entry: string) => Promise<string | null>;

/**
 * The fact a secret's id names, in the forms today's code reads: a fact id of lore (`lore:<id>`, a
 * world entry) or of World Info (`wi:<book>:<entry>` for a whole entry, `wi:<book>:<entry>:<n>` for
 * its mark counted from 0), or the live lore id of a book entry or mark (`book:<book>/<entry>`,
 * `book:<book>/<entry>#<n>` counted from 1). Null for anything else.
 */
export function secretFact(said: string): FactId | null {
  const id = said.trim();
  const kind = parseFactId(id)?.kind;
  if (kind === "lore" || kind === "wi") return id;
  return wiFactIdOfLiveLore(id);
}

/**
 * The world as the state plays it at a turn (its staged changes in), or at the chat's head for none, for finding people and making a
 * holding; for a job's call, with the job's own changes so far on top (`stateFor`), so a job sees what it recorded. Null when the chat
 * plays no world the store can read.
 */
export function worldAt(store: Store, user: string, turn: string | null, job: string | null = null, chat = ""): ReadContext | null {
  const u = store.user(user);
  const state = (turn === null ? u.headState(chat) : u.stateFor(turn, job)).state.world;
  const doc = store.env.worlds(state.revision);
  return doc === undefined ? null : store.env.registry.context(doc, state);
}

/** Who in the world a name is: the one person with that id or name, none, or the several so named. */
export type PersonFound = { id: EntityId } | { none: true } | { many: EntityId[] };

/** The person in the world `said` names, by id or by name as the cast compares names. */
export function personNamed(ctx: ReadContext, said: string): PersonFound {
  const people = Object.entries(ctx.state.entities).filter(([, e]) => kindIs(ctx.registry, ctx.world, e.kind, "person"));
  if (people.some(([id]) => id === said.trim())) return { id: said.trim() };
  const named = people.filter(([, e]) => nameKey(e.name) === nameKey(said)).map(([id]) => id);
  const [one] = named;
  if (one === undefined) return { none: true };
  return named.length === 1 ? { id: one } : { many: named };
}

/**
 * The world's person a character is: the one its stored reference names, when the world still has that person; else the one its name finds.
 * Two people of one name, or a cast name the world spells otherwise, keep their person by the reference.
 */
export function personOfCharacter(ctx: ReadContext, character: Pick<Character, "name" | "person">): PersonFound {
  const ref = character.person;
  const there = ref === null ? undefined : ctx.state.entities[ref];
  if (ref !== null && there !== undefined && kindIs(ctx.registry, ctx.world, there.kind, "person")) return { id: ref };
  return personNamed(ctx, character.name);
}

/** Someone in the world a name gives, or the answers' line that says why no one is: `none` names the line for no one so named. */
export function oneIn(found: PersonFound, n: number, op: string, field: string, who: string, none: string): EntityId | Unread {
  if ("id" in found) return found.id;
  if ("none" in found) return { line: none, fields: { n, op, field, who } };
  return { line: "many_named", fields: { n, op, field, who, count: found.many.length, ids: found.many } };
}

/** The secrets the knowledge rows `struck` give that no other standing knowledge row of the same character still gives: the holdings striking them takes back. */
export function secretsLetGo(record: CastRecord, character: string, struck: readonly CastItem[]): FactId[] {
  const gone = new Set(struck.map((k) => k.id));
  const secretOf = (k: CastItem): FactId[] => (typeof k.fields.secret === "string" ? [k.fields.secret] : []);
  const still = new Set(record.of(character, "knowledge").filter((k) => !gone.has(k.id)).flatMap(secretOf));
  return [...new Set(struck.flatMap(secretOf))].filter((fact) => !still.has(fact));
}

/**
 * The events that take the holdings of `facts` back from the world's person a character is, each
 * with its secret. When no one in the world is that person, why goes to `unread`, kept, so that the
 * strike is written all the same. A chat that plays no world holds no secrets, and has none to take back.
 */
export function forgetsOf(ctx: ReadContext | null, n: number, op: string, name: string, facts: readonly FactId[], unread: Unread[]): { fact: FactId; events: LedgerEvent[] }[] {
  if (ctx === null || facts.length === 0) return [];
  const holder = oneIn(personNamed(ctx, name), n, op, "drop", name, "no_holder");
  if (typeof holder !== "string") {
    unread.push({ ...holder, kept: true });
    return [];
  }
  return facts.map((fact) => ({ fact, events: forgetEvents(ctx, holder, fact) }));
}

/** A holding as a perception gives it: whose, of which secret, told by whom (null: first hand), since when, and how sure. */
export interface SecretAsk {
  holder: EntityId;
  fact: FactId;
  teller: EntityId | null;
  /** The message of the turn it was perceived in (null while that turn has none), and the story clock then. */
  since: Holding["since"];
  confidence: number;
}

/**
 * The events that make the holding, by today's minds code: none when the holder already holds it
 * so; a rejection's code when the chat cannot hold it (`missing_fact`: the chat holds no such
 * secret; others as `mindEdit` gives them).
 */
export function holdingEvents(ctx: ReadContext, ask: SecretAsk): LedgerEvent[] | { code: string } {
  const holding: Holding = { how: ask.teller === null ? "witnessed" : "told", by: ask.teller, evidence: [], since: ask.since, belief: "true", confidence: ask.confidence };
  const out = mindEdit(ctx, { op: "mind_knowledge", entity: ask.holder, fact: ask.fact, holding });
  if (Array.isArray(out)) return out;
  return out.code === "no_change" ? [] : { code: out.code };
}

/** The events that take a holder's holding of a secret back, by today's minds code (`minds.forget`): none when they do not hold it. */
export function forgetEvents(ctx: ReadContext, holder: EntityId, fact: FactId): LedgerEvent[] {
  const out = mindEdit(ctx, { op: "mind_knowledge", entity: holder, fact, holding: null });
  return Array.isArray(out) ? out : [];
}

/**
 * The fact a secret is, read from the lore as today's seeding reads it, as the `minds.fact` event
 * that records it; null when the lore holds no such secret. A world entry (`lore:<id>`) is its text,
 * or its title when it has none, about what it links (`authoredFact`, `knowledge-seed.ts:121-127`).
 * A book entry is read live: its mark `n` is that mark's text; the whole entry (`wi:<book>:<entry>`)
 * is its one mark when its text is nothing else, or its text when it holds no mark, as an earlier
 * build's secret is (`markSeeds`, `:97-118`), with the hash of the text it was read from. Each claim
 * is whole, whitespace collapsed (`:37-39`), and true.
 */
export async function secretFactEvent(ctx: ReadContext, fact: FactId, read: (book: string, entry: string) => Promise<string | null>): Promise<LedgerEvent | null> {
  const ref = parseFactId(fact);
  let made: KnowledgeFact | null = null;
  if (ref?.kind === "lore") {
    const lore = Object.hasOwn(ctx.world.lore, ref.lore) ? ctx.world.lore[ref.lore] : undefined;
    const text = lore === undefined ? "" : lore.content.trim() !== "" ? lore.content : lore.title;
    if (lore !== undefined && text.trim() !== "") made = { id: fact, kind: "lore", claim: text.replace(/\s+/g, " ").trim(), about: [...lore.links], truth: "true" };
  } else if (ref?.kind === "wi") {
    const content = await read(ref.book, ref.entry);
    if (content !== null) {
      const whole = wholeEntrySecret(content);
      const marks = parseSecretMarks(content);
      const text = ref.mark === null ? (whole?.text ?? (marks.length === 0 ? content : "")) : whole === null ? (marks[ref.mark]?.text ?? "") : "";
      if (text.trim() !== "") made = { id: fact, kind: "wi", claim: text.replace(/\s+/g, " ").trim(), about: [], truth: "true", textHash: bookTextHash(content) };
    }
  }
  return made === null ? null : { type: MINDS_EVENTS.fact, data: { fact: made as unknown as JsonObject } };
}

/**
 * The world a call holds secrets in: the state at its turn, read once and only when a secret is
 * named, with each fact the call records folded in, so that the call's later holdings of it find it.
 */
export class SecretWorld {
  #ctx: ReadContext | null | undefined;
  /** The facts this call records, in the order they were first asked for: written before any holding. */
  readonly facts: LedgerEvent[] = [];

  constructor(
    private readonly load: () => ReadContext | null,
    private readonly read: (book: string, entry: string) => Promise<string | null>,
  ) {}

  /** The world, or null when the chat plays none the store can read. */
  get ctx(): ReadContext | null {
    if (this.#ctx === undefined) this.#ctx = this.load();
    return this.#ctx;
  }

  /** The events that make a holding, as `holdingEvents` gives them; a secret the chat does not hold yet has its fact recorded first, from the lore. */
  async hold(ask: SecretAsk): Promise<LedgerEvent[] | { code: string }> {
    const ctx = this.ctx;
    if (ctx === null) throw new Error("a holding is asked for only in a world the store can read");
    const first = holdingEvents(ctx, ask);
    if (!("code" in first) || first.code !== "missing_fact") return first;
    const fact = await secretFactEvent(ctx, ask.fact, this.read);
    if (fact === null || validateEvent(ctx.registry, fact, ctx) !== null) return first;
    const state = structuredClone(ctx.state) as WorldState;
    applyEvent(ctx.registry, fact, state, ctx);
    this.#ctx = ctx.registry.context(ctx.world, state);
    this.facts.push(fact);
    return holdingEvents(this.#ctx, ask);
  }
}

/** Where a call names secrets, for the answers' lines: its item, what kind of item that is, and the argument. */
export interface SecretsSaid {
  n: number;
  op: string;
  field: string;
}

/**
 * Whose holding it is, the character called `name`, and who told them, `teller` (absent: first hand), each found in the world;
 * null when either is not, and why goes to `unread`.
 */
function holderOf(ctx: ReadContext, where: SecretsSaid, name: string, teller: JsonValue | undefined, unread: Unread[]): { holder: EntityId; by: EntityId | null } | null {
  const { n, op, field } = where;
  const holder = oneIn(personNamed(ctx, name), n, op, field, name, "no_holder");
  const by = typeof teller === "string" ? oneIn(personNamed(ctx, teller), n, op, field, teller, "no_teller") : null;
  if (typeof holder !== "string") unread.push(holder);
  if (by !== null && typeof by !== "string") unread.push(by);
  return typeof holder === "string" && (by === null || typeof by === "string") ? { holder, by } : null;
}

/** Why a holding of `secret` could not be made, as the answers' line says it. */
function heldNot(where: SecretsSaid, name: string, secret: string, code: string): Unread {
  return { line: code === "missing_fact" ? "unknown_secret" : "secret_refused", fields: { ...where, who: name, secret, code } };
}

/**
 * The secrets `said` names that the character called `name` can hold now, each with the events that
 * hold it: told by `teller` (absent: first hand), learned in `turn` (its message, and its story time,
 * the world's clock while it has none), as sure as `confidence`. What keeps any of them from being
 * held goes to `unread`.
 */
export async function secretsHeld(
  world: SecretWorld,
  where: SecretsSaid,
  name: string,
  teller: JsonValue | undefined,
  turn: { message: string | null; storyTime: number | null } | null,
  said: readonly string[],
  confidence: number,
  unread: Unread[],
): Promise<{ fact: FactId; events: LedgerEvent[] }[]> {
  const held: { fact: FactId; events: LedgerEvent[] }[] = [];
  const ctx = world.ctx;
  if (ctx === null) {
    unread.push({ line: "no_world_secret", fields: { ...where } });
    return held;
  }
  const who = holderOf(ctx, where, name, teller, unread);
  for (const secret of said) {
    const fact = secretFact(secret);
    if (fact === null) {
      unread.push({ line: "not_secret", fields: { ...where, value: secret } });
      continue;
    }
    if (who === null) continue;
    const events = await world.hold({ holder: who.holder, fact, teller: who.by, since: { msg: turn?.message ?? null, at: turn?.storyTime ?? ctx.state.clock }, confidence });
    if ("code" in events) unread.push(heldNot(where, name, secret, events.code));
    else held.push({ fact, events });
  }
  return held;
}

/**
 * The holdings of `facts` given back to the character called `name`, as a strike taken back stands the
 * knowledge that gave them: by the same minds code as `secretsHeld`, from the facts the chat holds
 * (each was recorded when it was first held), so no lore is read and it can be worked out inside the
 * write that stands the knowledge. Told by `teller` (absent: first hand), learned in `turn`, as sure
 * as `confidence`; none for a holding they have now. What keeps one from being held goes to `unread`.
 */
export function secretsHeldAgain(
  ctx: ReadContext | null,
  where: SecretsSaid,
  name: string,
  teller: JsonValue | undefined,
  turn: { message: string | null; storyTime: number | null } | null,
  facts: readonly FactId[],
  confidence: number,
  unread: Unread[],
): { fact: FactId; events: LedgerEvent[] }[] {
  if (facts.length === 0) return [];
  if (ctx === null) {
    unread.push({ line: "no_world_secret", fields: { ...where } });
    return [];
  }
  const who = holderOf(ctx, where, name, teller, unread);
  if (who === null) return [];
  return facts.flatMap((fact) => {
    const events = holdingEvents(ctx, { holder: who.holder, fact, teller: who.by, since: { msg: turn?.message ?? null, at: turn?.storyTime ?? ctx.state.clock }, confidence });
    if (!("code" in events)) return [{ fact, events }];
    unread.push(heldNot(where, name, fact, events.code));
    return [];
  });
}

/** The changes that record a holding's events on a turn, in the cast's lane, with who made them. */
export function holdingChanges(events: readonly LedgerEvent[], lane: ChangeInput["lane"], by: string, job: string | null): ChangeInput[] {
  return events.map((e) => ({ lane, op: e.type, value: e as unknown as JsonValue, by, job }));
}
