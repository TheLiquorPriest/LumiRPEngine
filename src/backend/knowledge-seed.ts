// Seeding what everyone knows from what the world and its books author (DESIGN §24.11): each fact a
// person holds from the start, as `minds.fact` and `minds.learn` (`how: authored`) events recorded
// with a turn, so a replay never reads a book's text again. Its sources:
//   - world lore: a secret entry's `holders` hold it (`lore:<id>`), kept from everyone;
//   - tracks: whoever owns a track holds each stage's truth (`track:<id>:<stage>`), kept from
//     everyone when the track is secret;
//   - authored holdings (`world.minds.holdings`, Build → World → Minds): as the author gave them;
//   - World Info secret marks (C1): those a mark is known to hold it, kept from whom it says, each
//     mark `wi:<book>:<entry>:<n>` (from 0, in the entry's order), or the whole entry `wi:<book>:<entry>`
//     when its text is one mark or an earlier build's secret, with the hash of the entry's text.
// A fact the chat holds already is never seeded again, nor are its holdings: what the story and the
// GM made of it stands (a forgotten holding stays forgotten). So a chat's first knowledge turn seeds
// all of it, and a later turn only what is new: a book entry whose text changed (`textHash`) has its
// marks read again, each fact recorded anew and whoever its marks now name who doesn't hold it
// learning it. Cue grants stay where they were (decision 11 waits): a cue's character still reads its
// truth in who they are. Every claim is cut to the user's length (`claimChars`), never in the fold.

import type { EntityId, UserId } from "../shared/ids";
import type { JsonObject } from "../shared/json";
import type { LedgerEvent } from "../shared/ledger";
import type { AuthoredHolding, FactId, KeptFrom, KnowledgeFact, KnowledgeSettings, LearnEventData } from "../shared/minds";
import { factId, keptFromOf, MINDS_EVENTS, parseFactId, wiFactIdOfLiveLore, worldMindsOf } from "../shared/minds";
import { bookTextHash, loreIsSecret, loreSourceOf } from "../shared/lore";
import { parseSecretMarks, resolveMarkNames, wholeEntrySecret } from "../shared/secret-marks";
import type { LoreEntryDef, WorldDoc } from "../shared/world";
import { visibilityOf } from "../engine/visibility";
import { own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { fieldDef, kindIs } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { capText } from "../packs/minds/core/edit";
import { readKnowledge } from "../packs/minds/core/state";
import type { HostPort } from "./host";

/** One fact to seed and who holds it from the start, each with their own belief, confidence and discretion. */
interface Seed {
  fact: KnowledgeFact;
  holders: Map<EntityId, AuthoredHolding>;
}

export interface SeedInput {
  reg: Registry;
  /** The world as the turn read it, its books' lore live (`liveLore`): each book entry and mark its own lore entry. */
  world: WorldDoc;
  /** The state the turn's knowledge starts from. */
  state: Readonly<WorldState>;
  settings: Pick<KnowledgeSettings, "claimChars">;
  userId: UserId;
}

/** A person in the chat: someone a holding may name. */
function person(input: Pick<SeedInput, "reg" | "world" | "state">, id: string): boolean {
  const e = own(input.state.entities, id);
  return e !== undefined && kindIs(input.reg, input.world, e.kind, "person");
}

/** A secret's holding from the start: true and sure, kept as given. */
function authored(keptFrom: KeptFrom | null): AuthoredHolding {
  return { belief: "true", confidence: 1, ...(keptFrom ? { keptFrom } : {}) };
}

/** Whether a lore id is a World Info mark's live one (`book:<book>/<entry>#<n>`), not an entry's own. */
function isMarkLore(id: string): boolean {
  const ref = parseFactId(wiFactIdOfLiveLore(id) ?? "");
  return ref?.kind === "wi" && ref.mark !== null;
}

/**
 * Each book entry the turn's lore reads that holds a secret (a mark, a whole-entry secret or an
 * earlier build's secret): its book and entry, the hash of its text as read (each of its lore entries,
 * read now, carries it: `liveLore`), and its lore entries.
 */
function secretBookEntries(world: WorldDoc): Map<string, { book: string; entry: string; hash: string; lore: LoreEntryDef[] }> {
  const out = new Map<string, { book: string; entry: string; hash: string; lore: LoreEntryDef[] }>();
  for (const entry of Object.values(world.lore)) {
    const source = loreSourceOf(entry.source);
    if (source.kind !== "book" || !loreIsSecret(entry)) continue;
    const key = `${source.bookId}\u0000${source.entryId}`;
    const at = out.get(key) ?? { book: source.bookId, entry: source.entryId, hash: source.hash, lore: [] };
    at.lore.push(entry);
    out.set(key, at);
  }
  return out;
}

/**
 * The seeds of one book entry, read now: each mark, resolved (those it is known to hold it, kept
 * from whom it says), or the whole entry when its text is one mark; an entry with no mark is an
 * earlier build's secret, held by the holders its lore gives but the player character, whom its gate
 * opens it to, kept from everyone. Each is about what the entry links.
 */
function markSeeds(input: SeedInput, at: { book: string; entry: string; lore: LoreEntryDef[] }, content: string): Seed[] {
  const { world, state, settings } = input;
  const textHash = bookTextHash(content);
  const about = [...new Set(at.lore.flatMap((l) => l.links))];
  const seed = (id: FactId, text: string, knownTo: readonly string[], keptFrom: KeptFrom | null): Seed => ({
    fact: { id, kind: "wi", claim: capText(text, settings.claimChars), about, truth: "true", textHash },
    holders: new Map(knownTo.filter((who) => person(input, who)).map((who) => [who, authored(keptFromOf(keptFrom, who))])),
  });
  const whole = wholeEntrySecret(content);
  if (whole) {
    const names = resolveMarkNames(world, state, whole);
    return [seed(factId({ kind: "wi", book: at.book, entry: at.entry, mark: null }), whole.text, names.knownTo, names.keptFrom)];
  }
  const marks = parseSecretMarks(content);
  if (marks.length > 0)
    return marks.map((mark, n) => {
      const names = resolveMarkNames(world, state, mark);
      return seed(factId({ kind: "wi", book: at.book, entry: at.entry, mark: n }), mark.text, names.knownTo, names.keptFrom);
    });
  const own = at.lore.find((l) => !isMarkLore(l.id));
  return own && own.content.trim() !== "" ? [seed(factId({ kind: "wi", book: at.book, entry: at.entry, mark: null }), own.content, (own.holders ?? []).filter((who) => who !== world.pov), "everyone")] : [];
}

/** The text an authored fact's claim reads from: a lore entry's, a stage's truth, or someone's field as their sheet says it; null when the world has none. */
function authoredFact(input: SeedInput, id: FactId): KnowledgeFact | null {
  const { reg, world, state, settings } = input;
  const ref = parseFactId(id);
  const claim = (text: string): string => capText(text, settings.claimChars);
  if (ref?.kind === "lore") {
    const lore = own(world.lore, ref.lore);
    const text = lore ? (lore.content.trim() !== "" ? lore.content : lore.title) : "";
    return lore && text.trim() !== "" ? { id, kind: "lore", claim: claim(text), about: [...lore.links], truth: "true" } : null;
  }
  if (ref?.kind === "track") {
    const track = own(world.tracks, ref.track);
    const truth = track ? own(track.stages, ref.stage)?.truth : undefined;
    return track && truth ? { id, kind: "track", claim: claim(truth), about: track.owner ? [track.owner] : [], truth: "true" } : null;
  }
  if (ref?.kind === "field") {
    const e = own(state.entities, ref.entity);
    const value = e ? own(e.fields, ref.field) : undefined;
    if (!e || value === undefined || value === null || typeof value === "object") return null;
    const label = fieldDef(reg, world, e.kind, ref.field)?.label ?? ref.field.replace(/_/g, " ");
    return { id, kind: "field", claim: claim(`${e.name}'s ${label}: ${String(value)}`), about: [ref.entity], truth: "true" };
  }
  return null;
}

/**
 * What the world authors that the chat doesn't hold yet (see the header): its facts and who holds
 * each from the start, as events, the facts first. `host` reads a book entry whose marks are new or
 * changed; a book or entry that can't be read seeds nothing this turn and is read again on the next.
 */
export async function seedKnowledge(host: Pick<HostPort, "books" | "log">, input: SeedInput): Promise<LedgerEvent[]> {
  const { world, state, userId } = input;
  const k = readKnowledge(state);
  const seeds = new Map<FactId, Seed>();
  const add = (fact: KnowledgeFact, who: EntityId, holding: AuthoredHolding): void => {
    if (!person(input, who)) return;
    const at = seeds.get(fact.id) ?? { fact, holders: new Map() };
    if (!at.holders.has(who)) at.holders.set(who, holding);
    seeds.set(fact.id, at);
  };
  // World lore: a secret entry's holders. A book's entries and marks, and a world entry indexed from
  // one, are seeded from their book's text below, as `wi:` facts, so none is seeded twice.
  for (const entry of Object.values(world.lore)) {
    if (loreSourceOf(entry.source).kind === "book" || !loreIsSecret(entry) || (entry.holders ?? []).length === 0) continue;
    const id = factId({ kind: "lore", lore: entry.id });
    if (own(k.facts, id)) continue;
    const fact = authoredFact(input, id);
    if (fact) for (const who of entry.holders ?? []) add(fact, who, authored("everyone"));
  }
  // Tracks: an owner holds each stage's truth, kept from everyone while the track is secret.
  for (const [track, t] of Object.entries(world.tracks)) {
    if (t.owner === undefined) continue;
    for (const stage of Object.keys(t.stages)) {
      const id = factId({ kind: "track", track, stage });
      if (own(k.facts, id)) continue;
      const fact = authoredFact(input, id);
      if (fact) add(fact, t.owner, authored(visibilityOf(t.visibility) === "secret" ? "everyone" : null));
    }
  }
  // Authored holdings, as the author gave them.
  for (const [who, facts] of Object.entries(worldMindsOf(world).holdings)) {
    for (const [id, holding] of Object.entries(facts)) {
      if (own(k.facts, id)) continue;
      const fact = authoredFact(input, id);
      if (fact) add(fact, who, { belief: holding.belief, confidence: holding.confidence, ...(holding.keptFrom ? { keptFrom: holding.keptFrom } : {}) });
    }
  }
  // World Info marks: an entry is read only when no fact of it the chat records has the hash of its
  // text as the turn's lore read it, and seeded only when the text read isn't one its facts were
  // recorded from.
  const recorded = new Map<string, Set<string>>();
  for (const fact of Object.values(k.facts)) {
    const ref = parseFactId(fact.id);
    if (ref?.kind !== "wi" || fact.textHash === undefined) continue;
    const key = `${ref.book}\u0000${ref.entry}`;
    recorded.set(key, (recorded.get(key) ?? new Set()).add(fact.textHash));
  }
  // Each book with an entry to read is read once, whole.
  const due = [...secretBookEntries(world)].filter(([key, at]) => !recorded.get(key)?.has(at.hash)).map(([, at]) => at);
  const books = await Promise.all(
    [...new Set(due.map((at) => at.book))].map(async (book) => {
      const entries = await host.books.entries(book, userId).catch((error: unknown) => {
        host.log("warn", `[LumiRPEngine] knowledge: book ${book} wasn't read for its secret marks, so they're read on a later turn: ${error instanceof Error ? error.message : String(error)}`, userId);
        return [];
      });
      return [book, new Map(entries.map((e) => [e.id, e.content]))] as const;
    }),
  );
  const texts = new Map(books);
  const marked = due.flatMap((at) => {
    const content = texts.get(at.book)?.get(at.entry);
    return content === undefined || recorded.get(`${at.book}\u0000${at.entry}`)?.has(bookTextHash(content)) ? [] : markSeeds(input, at, content);
  });
  const events: LedgerEvent[] = [];
  const learn = (fact: FactId, who: EntityId, h: AuthoredHolding): LedgerEvent => {
    const data: LearnEventData = { who: [who], fact, how: "authored", by: null, evidence: [], belief: h.belief, confidence: h.confidence, ...(h.keptFrom ? { keptFrom: h.keptFrom } : {}), msg: null, at: state.clock };
    return { type: MINDS_EVENTS.learn, data: data as unknown as JsonObject };
  };
  for (const seed of [...seeds.values(), ...marked]) {
    events.push({ type: MINDS_EVENTS.fact, data: { fact: seed.fact as unknown as JsonObject } });
    // A changed mark is learned again only by whom it names who doesn't hold it already.
    for (const [who, h] of seed.holders) if (own(own(k.holdings, who) ?? {}, seed.fact.id) === undefined) events.push(learn(seed.fact.id, who, h));
  }
  return events;
}
