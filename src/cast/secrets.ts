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
import { IFACE_DEFAULTS } from "../iface/kit";
import { nearestOf } from "../iface/reading";
import { textOf } from "../iface/texts";
import { PACK as MINDS_PACK, readKnowledge } from "../packs/minds/core/state";
import type { WorldState } from "../engine/state";
import { mindEdit } from "../packs/minds/core/edit";
import type { EntityId } from "../shared/ids";
import type { JsonObject, JsonValue } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import { bookTextHash, loreSourceOf } from "../shared/lore";
import { type FactId, type Holding, type HoldingBelief, type HoldingHow, type KnowledgeFact, MINDS_EVENTS, parseFactId, wiFactIdOfLiveLore } from "../shared/minds";
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

/** Whose a holding is: a character of the cast, found in the world by the reference its record keeps, else by its name; or a name alone. */
export type Holder = string | Pick<Character, "name" | "person">;

const holderName = (holder: Holder): string => (typeof holder === "string" ? holder : holder.name);
const personOf = (ctx: ReadContext, holder: Holder): PersonFound => (typeof holder === "string" ? personNamed(ctx, holder) : personOfCharacter(ctx, holder));

/**
 * The events that take the holdings of `facts` back from the world's person a character is, each
 * with its secret. When no one in the world is that person, why goes to `unread`, kept, so that the
 * strike is written all the same. A chat that plays no world holds no secrets, and has none to take back.
 */
export function forgetsOf(ctx: ReadContext | null, n: number, op: string, who: Holder, facts: readonly FactId[], unread: Unread[]): { fact: FactId; events: LedgerEvent[] }[] {
  if (ctx === null || facts.length === 0) return [];
  const holder = oneIn(personOf(ctx, who), n, op, "drop", holderName(who), "no_holder");
  if (typeof holder !== "string") {
    unread.push({ ...holder, kept: true });
    return [];
  }
  return facts.map((fact) => ({ fact, events: forgetEvents(ctx, holder, fact) }));
}

/** A holding as a perception gives it: whose, of which secret, told by whom (null: first hand), since when, how it was learned, whether they believe it and how sure. */
export interface SecretAsk {
  holder: EntityId;
  fact: FactId;
  teller: EntityId | null;
  /** The message of the turn it was perceived in (null while that turn has none), and the story clock then. */
  since: Holding["since"];
  confidence: number;
  /** How it was learned, as today's holdings say it; none given: told when there is a teller, else witnessed. */
  how?: HoldingHow;
  /** Whether they believe it; none given: they do. */
  belief?: HoldingBelief;
}

/**
 * The events that make the holding, by today's minds code: none when the holder already holds it
 * so; a rejection's code when the chat cannot hold it (`missing_fact`: the chat holds no such
 * secret; others as `mindEdit` gives them).
 */
export function holdingEvents(ctx: ReadContext, ask: SecretAsk): LedgerEvent[] | { code: string } {
  const holding: Holding = { how: ask.how ?? (ask.teller === null ? "witnessed" : "told"), by: ask.teller, evidence: [], since: ask.since, belief: ask.belief ?? "true", confidence: ask.confidence };
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
      // About what the world's lore entries made of this book entry link, as today's seeding records it (`markSeeds`).
      const about = [...new Set(Object.values(ctx.world.lore).flatMap((l) => (isBookEntry(l.source, ref.book, ref.entry) ? l.links : [])))];
      if (text.trim() !== "") made = { id: fact, kind: "wi", claim: text.replace(/\s+/g, " ").trim(), about, truth: "true", textHash: bookTextHash(content) };
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
    /** The fact a secret named by the id the lore shows it by (`e-112#2`, `w-31`), or by one of today's forms, is; null for one that names none. */
    private readonly resolve: (said: string) => Promise<FactId | null> = (said) => Promise.resolve(secretFact(said)),
  ) {}

  /** The world, or null when the chat plays none the store can read. */
  get ctx(): ReadContext | null {
    if (this.#ctx === undefined) this.#ctx = this.load();
    return this.#ctx;
  }

  /** The fact a secret's id names. */
  factOf(said: string): Promise<FactId | null> {
    return this.resolve(said);
  }

  /** The events that make a holding, as `holdingEvents` gives them; a secret the chat does not hold yet has its fact recorded first, from the lore. */
  async hold(ask: SecretAsk): Promise<LedgerEvent[] | { code: string }> {
    const ctx = this.ctx;
    if (ctx === null) throw new Error("a holding is asked for only in a world the store can read");
    const first = holdingEvents(ctx, ask);
    if (!("code" in first) || first.code !== "missing_fact") return first;
    const fact = await secretFactEvent(ctx, ask.fact, this.read);
    if (fact === null || validateEvent(ctx.registry, fact, ctx) !== null) return first;
    // The fact is laid over the state for this call alone: only the path to where it is written is copied, never the state.
    const state = withKnowledgeCopied(ctx.state);
    applyEvent(ctx.registry, fact, state, ctx);
    this.#ctx = ctx.registry.context(ctx.world, state);
    this.facts.push(fact);
    return holdingEvents(this.#ctx, ask);
  }
}

/**
 * The state with the path to the minds' facts copied (the state itself, its packs, the minds' slice, its knowledge and its facts), so
 * that recording a fact in it changes the copy and not the state it was made from; everything else is shared, not copied.
 */
function withKnowledgeCopied(state: WorldState): WorldState {
  const slice = state.packs[MINDS_PACK] as unknown as { knowledge?: { facts?: Record<string, unknown>; holdings?: Record<string, unknown> } } | undefined;
  const copy: WorldState = { ...state, packs: { ...state.packs } };
  copy.packs[MINDS_PACK] = { ...slice, knowledge: { ...slice?.knowledge, facts: { ...slice?.knowledge?.facts }, holdings: { ...slice?.knowledge?.holdings } } } as unknown as WorldState["packs"][string];
  return copy;
}

/** Where a call names secrets, for the answers' lines: its item, what kind of item that is, and the argument. */
export interface SecretsSaid {
  n: number;
  op: string;
  field: string;
}

/**
 * Whose holding it is, the character `holder` (found by the reference its record keeps), and who told them, `teller` (absent: first
 * hand), each found in the world; null when either is not, and why goes to `unread`. A teller who is the holder is written all the
 * same, as first hand, and said.
 */
function holderOf(ctx: ReadContext, where: SecretsSaid, holder: Holder, teller: JsonValue | undefined, unread: Unread[]): { holder: EntityId; by: EntityId | null } | null {
  const { n, op, field } = where;
  const name = holderName(holder);
  const mine = oneIn(personOf(ctx, holder), n, op, field, name, "no_holder");
  const told = typeof teller === "string" ? oneIn(personNamed(ctx, teller), n, op, field, teller, "no_teller") : null;
  if (typeof mine !== "string") unread.push(mine);
  if (told !== null && typeof told !== "string") unread.push(told);
  if (typeof mine !== "string" || (told !== null && typeof told !== "string")) return null;
  if (told === mine) {
    unread.push({ line: "self_teller", fields: { ...where, who: name }, kept: true });
    return { holder: mine, by: null };
  }
  return { holder: mine, by: told };
}

/** Why a holding of `secret` could not be made, as the answers' line says it; one the chat does not hold names the nearest it does. */
function heldNot(ctx: ReadContext, where: SecretsSaid, name: string, secret: string, code: string): Unread {
  if (code !== "missing_fact") return { line: "secret_refused", fields: { ...where, who: name, secret, code } };
  const near = nearestOf(secret, Object.keys(readKnowledge(ctx.state).facts), IFACE_DEFAULTS).slice(0, IFACE_DEFAULTS.nearMatches);
  return { line: "unknown_secret", fields: { ...where, who: name, secret, code, near: textOf(near) } };
}

/** What the writer says of how a secret was learned, beside who told it: how, whether they believe it, how sure; what is left out is the default. */
export interface HoldingGiven {
  how?: HoldingHow;
  belief?: HoldingBelief;
  sure?: number;
}

/**
 * The secrets `said` names that the character `holder` can hold now, each with the events that
 * hold it: told by `teller` (absent: first hand), learned in `turn` (its message, and its story time,
 * the world's clock while it has none), as sure as `confidence` unless `given` says how sure. What keeps any of them from being
 * held goes to `unread`. A secret is named by the id the lore shows it by, or by one of today's own forms.
 */
export async function secretsHeld(
  world: SecretWorld,
  where: SecretsSaid,
  holder: Holder,
  teller: JsonValue | undefined,
  turn: { message: string | null; storyTime: number | null } | null,
  said: readonly string[],
  confidence: number,
  unread: Unread[],
  given: HoldingGiven = {},
): Promise<{ fact: FactId; events: LedgerEvent[] }[]> {
  const held: { fact: FactId; events: LedgerEvent[] }[] = [];
  const ctx = world.ctx;
  if (ctx === null) {
    unread.push({ line: "no_world_secret", fields: { ...where } });
    return held;
  }
  const who = holderOf(ctx, where, holder, teller, unread);
  for (const secret of said) {
    const fact = await world.factOf(secret);
    if (fact === null) {
      unread.push({ line: "not_secret", fields: { ...where, value: secret } });
      continue;
    }
    if (who === null) continue;
    const events = await world.hold({ holder: who.holder, fact, teller: who.by, since: { msg: turn?.message ?? null, at: turn?.storyTime ?? ctx.state.clock }, confidence: given.sure ?? confidence, ...(given.how !== undefined ? { how: given.how } : {}), ...(given.belief !== undefined ? { belief: given.belief } : {}) });
    if ("code" in events) unread.push(heldNot(world.ctx ?? ctx, where, holderName(holder), secret, events.code));
    else held.push({ fact, events });
  }
  return held;
}

/**
 * The holdings of `facts` given back to the character `holder`, as a strike taken back stands the
 * knowledge that gave them: by the same minds code as `secretsHeld`, from the facts the chat holds
 * (each was recorded when it was first held), so no lore is read and it can be worked out inside the
 * write that stands the knowledge. Told by `teller` (absent: first hand), learned in `turn`, as sure
 * as `confidence`; none for a holding they have now. What keeps one from being held goes to `unread`.
 */
export function secretsHeldAgain(
  ctx: ReadContext | null,
  where: SecretsSaid,
  holder: Holder,
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
  const who = holderOf(ctx, where, holder, teller, unread);
  if (who === null) return [];
  return facts.flatMap((fact) => {
    const events = holdingEvents(ctx, { holder: who.holder, fact, teller: who.by, since: { msg: turn?.message ?? null, at: turn?.storyTime ?? ctx.state.clock }, confidence });
    if (!("code" in events)) return [{ fact, events }];
    unread.push(heldNot(ctx, where, holderName(holder), fact, events.code));
    return [];
  });
}

/** The changes that record a holding's events on a turn, in the cast's lane, with who made them. */
export function holdingChanges(events: readonly LedgerEvent[], lane: ChangeInput["lane"], by: string, job: string | null): ChangeInput[] {
  return events.map((e) => ({ lane, op: e.type, value: e as unknown as JsonValue, by, job }));
}

/** Turns the id a lore secret is shown by (`e-112`, `e-112#2`, `w-31`) into the fact it is, for a user; null for one that names none (the lore's resolver, `secretIds`). */
export type SecretFactOf = (user: string, shown: string) => Promise<FactId | null>;

/** What a call reads a secret's id by: the lore's resolver where the host gave one, else today's own forms alone. */
export function secretResolver(resolve: SecretFactOf | undefined, user: string): (said: string) => Promise<FactId | null> {
  return resolve === undefined ? (said) => Promise.resolve(secretFact(said)) : (said) => resolve(user, said);
}

/** Whether a world lore entry's source is this book entry. */
function isBookEntry(source: unknown, book: string, entry: string): boolean {
  const at = loreSourceOf(source);
  return at.kind === "book" && at.bookId === book && at.entryId === entry;
}
