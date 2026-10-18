// Typed text → an action without a model, for Playtest (engine-only): the action whose lexicon phrase
// the text says (its words in order, with only filler words such as "down" or "back" between them,
// so "walk down to" says "walk to"), with its ref params filled from names said in the text, its first
// required text param from what follows the phrase, and amounts from the first number. Of the
// phrases said, one whose action's required params are all filled wins, then one said exactly, then
// the longest.
//
// A phrase only counts where the player does it: not after a negation ("I don't want to walk to"),
// not in a hypothetical ("I wonder whether to buy", "if I walk to"), not inside an idiom ("pay
// attention"), and only with the player as the subject: first person ("I", "we", "let's") or a bare
// command, never someone else ("Danny says he'll walk to", "ask her to buy").

import type { JsonObject } from "../shared/json";
import type { ActionDef, WorldDoc } from "../shared/world";
import { offersAction } from "../shared/world";
import type { Registry } from "./registry-impl";
import { isGone, kindIs } from "./scope";
import { selectorMatches } from "./selector";
import type { WorldState } from "./state";
import type { InterpretOutput } from "./steps";
import { canSeeEntity, canSeePlace } from "./visibility";

const STOP = new Set(["the", "a", "an", "to", "of", "at", "my", "your", "and", "with", "about", "for", "in", "on", "some", "over", "up", "down"]);

/** Words a typed line may put inside a lexicon phrase ("walk down to", "head back over to"). */
const FILLER = new Set(["down", "up", "over", "back", "out", "across", "along", "around", "right", "straight", "on", "off", "just"]);

/** Words that start a new clause: a negation or a subject before them doesn't reach past them. */
const CLAUSE_WORDS = new Set(["but", "so", "because", "though", "although", "however", "instead"]);

const NEGATION = new Set(["not", "no", "never", "cannot", "nothing", "nobody", "neither", "nor", "refuse", "refuses", "refused", "avoid", "avoiding"]);

/** Hypotheticals in the phrase's own clause ("might", "whether to"). */
const HYPOTHETICAL = new Set(["might", "maybe", "perhaps", "whether", "wonder", "wonders", "wondering", "wondered", "consider", "considering", "imagine", "imagining", "suppose", "supposing", "wish", "debating"]);

/** Conditionals reach across the sentence ("If I had the money, I'd buy a boat"). */
const CONDITIONAL = new Set(["if", "unless"]);

/** "think about" / "thinking of": a verb of musing followed by one of these. */
const MUSING = new Set(["think", "thinks", "thinking", "thought"]);
const MUSING_OBJECT = new Set(["about", "of"]);

const FIRST_PERSON = new Set(["i", "i'm", "i'll", "i'd", "i've", "me", "myself", "we", "we're", "we'll", "we'd", "we've", "us", "let's", "lets"]);

const OTHER_PERSON = new Set([
  "he", "she", "they", "you", "he's", "she's", "they're", "you're", "he'll", "she'll", "they'll", "you'll", "he'd", "she'd", "they'd", "you'd", "they've", "you've",
  "him", "her", "them", "someone", "somebody", "everyone", "everybody", "anyone", "anybody", "people", "y'all",
]);

/**
 * Words that put a subject before the verb: modals, "is", and the third-person verbs a line uses to
 * say what someone else will do ("Danny will walk to", "the clerk wants to buy"). A bare command has none.
 */
const AUX = new Set([
  "will", "would", "shall", "should", "can", "could", "may", "might", "must", "is", "are", "was", "were", "does", "did", "has",
  "wants", "needs", "decides", "decided", "tries", "tried", "plans", "planned", "says", "said", "tells", "told", "asks", "asked", "agrees", "agreed", "offers", "offered", "starts", "begins", "gets", "likes", "hopes",
]);

/** Words that may sit between someone's name and the phrase while that person stays its subject. */
const BRIDGE = new Set(["to", "going", "gonna", "just", "then", "also", "now", "soon", "finally", "quickly", "slowly", "really", "probably", "already", "still"]);

/** Phrases that read as an action's words but never mean it. */
const IDIOMS: readonly (readonly string[])[] = [
  ["pay", "attention"],
  ["pay", "close", "attention"],
  ["pay", "heed"],
  ["pay", "no", "mind"],
  ["pay", "respects"],
  ["pay", "my", "respects"],
  ["pay", "a", "visit"],
  ["pay", "a", "compliment"],
  ["pay", "the", "price"],
  ["buy", "time"],
  ["buy", "some", "time"],
  ["take", "a", "look"],
  ["take", "a", "seat"],
  ["take", "a", "breath"],
  ["take", "a", "deep", "breath"],
  ["take", "care"],
  ["take", "my", "time"],
  ["take", "your", "time"],
  ["take", "it", "easy"],
  ["lend", "a", "hand"],
  ["lend", "an", "ear"],
  ["on", "the", "other", "hand"],
  ["give", "up"],
  ["give", "it", "a", "try"],
];

interface Token {
  word: string;
  clause: number;
  sentence: number;
}

/** The text's lowercase words (contractions kept whole: "don't", "he'll"), each with its clause and sentence. */
function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let clause = 0;
  let sentence = 0;
  for (const m of text.toLowerCase().replace(/[‘’]/g, "'").matchAll(/[a-z0-9]+(?:'[a-z]+)*|[.!?;:,]/g)) {
    const word = m[0];
    if (/^[.!?;]$/.test(word)) {
      sentence++;
      clause++;
    } else if (word === "," || word === ":") clause++;
    else {
      if (CLAUSE_WORDS.has(word)) clause++;
      out.push({ word, clause, sentence });
    }
  }
  return out;
}

function words(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/** The candidate whose name shares the most words with what was said (none when nothing is shared). */
function byName(said: ReadonlySet<string>, pool: readonly { id: string; name: string }[]): string | null {
  let best: { id: string; n: number } | null = null;
  for (const c of pool) {
    const n = words(c.name).filter((w) => said.has(w)).length;
    if (n > 0 && (!best || n > best.n)) best = { id: c.id, n };
  }
  return best?.id ?? null;
}

/**
 * Whether the player is the subject of the verb that starts at the end of `lead` (the phrase's clause
 * up to the phrase): the nearest subject word before the phrase decides. A name of someone present
 * decides when only "to", an auxiliary or an adverb follows it ("ask Danny to walk", "Danny will
 * walk"), not across other words ("I meet Danny and walk"). With no subject word, a bare command.
 */
function playerSubject(lead: readonly string[], names: ReadonlySet<string>): boolean {
  for (let i = lead.length - 1; i >= 0; i--) {
    const w = lead[i] ?? "";
    if (FIRST_PERSON.has(w)) return true;
    if (OTHER_PERSON.has(w)) return false;
    const name = w.replace(/'(s|ll|d|re|ve)$/, "");
    if (!names.has(name)) continue;
    // "Danny'll walk" carries its own auxiliary; a bare name is the subject only right before the verb.
    if (/'(ll|d|re|ve)$/.test(w) || lead.slice(i + 1).every((b) => AUX.has(b) || BRIDGE.has(b))) return false;
  }
  return !lead.some((w) => AUX.has(w));
}

/** Whether a phrase said at `start` is something the player does (see the module comment). */
function playerActs(tokens: readonly Token[], start: number, names: ReadonlySet<string>): boolean {
  const at = tokens[start];
  if (!at) return false;
  const before = tokens.slice(0, start);
  const lead = before.filter((t) => t.clause === at.clause).map((t) => t.word);
  // An idiom that covers the phrase's first word ("pay" in "I pay attention").
  if (IDIOMS.some((idiom) => idiom.some((w, offset) => w === at.word && idiom.every((x, k) => tokens[start - offset + k]?.word === x)))) return false;
  if (lead.some((w) => NEGATION.has(w) || w.endsWith("n't"))) return false;
  if (lead.some((w, i) => HYPOTHETICAL.has(w) || (MUSING.has(w) && MUSING_OBJECT.has(lead[i + 1] ?? "")))) return false;
  if (before.some((t) => t.sentence === at.sentence && CONDITIONAL.has(t.word))) return false;
  return playerSubject(lead, names);
}

/**
 * Where `phrase` is said in `tokens` (the text's lowercase words) by the player: its words in order,
 * from some start that `acts` accepts, with only filler words between them. The token index just
 * past it and how many fillers it skipped, or null.
 */
function phraseAt(tokens: readonly string[], phrase: readonly string[], acts: (start: number) => boolean): { end: number; skipped: number } | null {
  for (let start = 0; start < tokens.length; start++) {
    if (tokens[start] !== phrase[0]) continue;
    let at = start + 1;
    let skipped = 0;
    let k = 1;
    for (; k < phrase.length; k++) {
      while (at < tokens.length && tokens[at] !== phrase[k] && FILLER.has(tokens[at] ?? "")) {
        at++;
        skipped++;
      }
      if (tokens[at] !== phrase[k]) break;
      at++;
    }
    if (k === phrase.length && acts(start)) return { end: at, skipped };
  }
  return null;
}

export function typedIntent(reg: Registry, world: WorldDoc, state: Readonly<WorldState>, text: string): InterpretOutput | null {
  const said = tokenize(text);
  const tokens = said.map((t) => t.word);
  const actions = new Map<string, ActionDef>();
  for (const [id, a] of reg.actions) actions.set(id, a);
  for (const [id, a] of Object.entries(world.actions)) actions.set(id, a);
  const named = new Set(words(text));
  const pov = world.pov;
  const people = new Set<string>();
  for (const [id, e] of Object.entries(state.entities)) if (id !== pov && kindIs(reg, world, e.kind, "person") && !isGone(state, id)) for (const w of words(e.name)) people.add(w);
  const acts = (start: number) => playerActs(said, start, people);
  let best: { action: ActionDef; params: JsonObject; filled: boolean; skipped: number; length: number } | null = null;
  // Numbers fill an action's number params in the order they were said: "walk over to 6, 2" is x 6, y 2.
  const numbers = [...text.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  for (const action of actions.values()) {
    // A combat action only where the ruleset has combat, as the palette and interpret offer them.
    if (!offersAction(world, action)) continue;
    for (const raw of action.lexicon ?? []) {
      const phrase = raw.trim().toLowerCase();
      if (phrase.length <= 2) continue;
      const at = phraseAt(
        tokens,
        tokenize(phrase).map((t) => t.word),
        acts,
      );
      if (!at) continue;
      const rest = words(tokens.slice(at.end).join(" ")).join(" ");
      const params: JsonObject = {};
      let textFilled = false;
      let nextNumber = 0;
      const ordered = Object.entries(action.params).sort(([, a], [, b]) => Number(a.optional === true) - Number(b.optional === true));
      for (const [name, def] of ordered) {
        if (def.type === "ref") {
          const pool =
            def.ref === "place"
              ? Object.values(world.places).filter((p) => canSeePlace(reg, world, state, pov, p.id))
              : Object.entries(state.entities)
                  .filter(([id, e]) => id !== pov && canSeeEntity(reg, world, state, pov, id) && (!def.ref || kindIs(reg, world, e.kind, def.ref)) && (!def.of || selectorMatches(reg, world, state, def.of, id)))
                  .map(([id, e]) => ({ id, name: e.name }));
          const id = byName(named, pool);
          if (id) params[name] = id;
        } else if (def.type === "text" && !textFilled && def.optional !== true && rest !== "") {
          params[name] = rest;
          textFilled = true;
        } else if (def.type === "money" || def.type === "number" || def.type === "duration") {
          // A typed amount is in the world's currency: "5" is 5 bits, or $5.00 (500 cents).
          const n = numbers[nextNumber];
          if (n !== undefined) {
            params[name] = def.type === "money" ? Math.round(n * 10 ** world.currency.decimals) : n;
            nextNumber += 1;
          }
        }
      }
      const filled = Object.entries(action.params).every(([name, def]) => def.optional === true || params[name] !== undefined);
      const better = !best || (filled !== best.filled ? filled : at.skipped !== best.skipped ? at.skipped < best.skipped : phrase.length > best.length);
      if (better) best = { action, params, filled, skipped: at.skipped, length: phrase.length };
    }
  }
  return best ? { action: best.action.id, params: best.params, probabilities: { [best.action.id]: 1 } } : null;
}
