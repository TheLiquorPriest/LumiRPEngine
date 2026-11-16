// What a character knows, in one query (plan §7.1 Knowledge, §7.5, §9.6): what perceptions and the GM gave it (the cast's knowledge
// rows), and what the minds' own record holds for it (`minds.knowledge`: the facts the chat holds and each person's holdings of them,
// carried as pack state on a migrated chat, and the lore secrets a perception made them hold), each with where it is kept, how it was
// learned, whether it is believed and how surely. Asked for a character, it answers "does she know?" by words or by a secret's id;
// asked across the cast, who knows a thing. Reads only; it judges nothing.

import type { JsonObject } from "rp-harness/contract";
import type { ReadContext } from "../engine/registry";
import { factText, trackedHoldings } from "../packs/minds/core/knowledge";
import { readSlice } from "../packs/minds/core/state";
import type { FactId } from "../shared/minds";
import { datedAt, type CastReading, type CastCall } from "./kit";
import { type CastItem, type Character } from "./record";
import { personOfCharacter, secretResolver, worldAt } from "./secrets";

/** What a question about knowledge asks for: words every one of which a statement holds, and/or one secret, by the id the lore shows it by. */
export interface KnowledgeAsk {
  words: readonly string[];
  /** The fact of the secret asked for; null: none asked. */
  fact: FactId | null;
}

/** Where a statement is kept: in the cast's own rows (a perception's or the GM's), or in the minds' record of facts and holdings. */
type KeptIn = "cast" | "minds";

/** The world as the call reads it, for the minds' record; null when the chat plays none the store can read. */
export function minds(call: CastCall): ReadContext | null {
  return worldAt(call.deps.store, call.scope.user, call.scope.turn ?? null, call.agent.job ?? null, call.scope.chat);
}

/** The question as the call put it: its words, and the fact its secret id names (an id that names none is no question and reads as no fact). */
export async function askOf(call: CastCall, words: readonly string[], secret: string | undefined): Promise<KnowledgeAsk | { none: string }> {
  if (secret === undefined || secret.trim() === "") return { words, fact: null };
  const fact = await secretResolver(call.deps.secretFact, call.scope.user)(secret);
  return fact === null ? { none: secret.trim() } : { words, fact };
}

/** Whether every word is in a text, case ignored. */
const holds = (text: string, words: readonly string[]): boolean => {
  const lower = text.toLowerCase();
  return words.every((w) => lower.includes(w));
};

/** A knowledge row as an answer shows it, with where it is kept. */
function rowShown(reading: CastReading, row: CastItem): JsonObject {
  return { id: row.id, ...row.fields, ...datedAt(reading.clock, row.at), kept_in: "cast" satisfies KeptIn, ...(row.dropped ? { dropped: true } : {}) };
}

/** The knowledge rows of a character that hold all of `ask.words` (or, asked by secret, give that secret). */
export function rowsFor(reading: CastReading, character: Character, ask: KnowledgeAsk, history: boolean): JsonObject[] {
  return reading.record
    .of(character.id, "knowledge", history)
    .filter((row) => (ask.fact === null || row.fields.secret === ask.fact) && holds(Object.values(row.fields).filter((v): v is string => typeof v === "string").join("\n"), ask.words))
    .map((row) => rowShown(reading, row));
}

/** The holdings the minds' record has for the world's person a character is, that hold all of `ask.words` (or are that secret): the fact's own words, how it was learned, who told them, what they take it to be and how sure they are. */
export function holdingsFor(ctx: ReadContext | null, character: Character, ask: KnowledgeAsk): JsonObject[] {
  if (ctx === null) return [];
  const person = personOfCharacter(ctx, character);
  if (!("id" in person)) return [];
  const slice = readSlice(ctx.state);
  const facts = slice.knowledge?.facts ?? {};
  const nameOf = (id: string): string => ctx.state.entities[id]?.name ?? id;
  return Object.entries(trackedHoldings(slice, person.id)).flatMap(([id, h]): JsonObject[] => {
    if (ask.fact !== null && id !== ask.fact) return [];
    const text = factText(ctx.world, facts[id], id);
    if (!holds(`${text}\n${id}`, ask.words)) return [];
    return [{ fact: id, text, how: h.how, ...(h.by === null ? {} : { told_by: nameOf(h.by) }), belief: h.belief, sure: h.confidence, ...(h.keptFrom === undefined ? {} : { kept_from: h.keptFrom === "everyone" ? "everyone" : h.keptFrom.map(nameOf) }), kept_in: "minds" satisfies KeptIn }];
  });
}

/** Who knows a thing: each character the cast holds with the statements or holdings that match, and how each was learned; those that match nothing are left out. */
export function whoKnows(call: CastCall, reading: CastReading, characters: readonly Character[], ask: KnowledgeAsk): JsonObject[] {
  const ctx = minds(call);
  return characters.flatMap((character): JsonObject[] => {
    const known = [...rowsFor(reading, character, ask, false), ...holdingsFor(ctx, character, ask)];
    return known.length === 0 ? [] : [{ who: character.name, id: character.id, knows: known }];
  });
}
