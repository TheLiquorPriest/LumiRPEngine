// The Curator's quiet-turn gate (`pipeline.curatorGate`; Settings → Agents → Roles → Curator → When
// it runs): before the Curator starts on a reply, a check of the reply's words and the player's
// message, with no call of its own, says whether they give it work. They do when they name a thing
// in the player character's scene (by a head noun of any of its names: "the keys" for Danny's truck
// keys), someone or somewhere the world doesn't have (a capitalized name none of its people, places,
// organizations, things or lore entries goes by: a walk-on, or a place made in play), a hand-over, a
// placement, a purchase (a price among them), something worn or something used; and when the turn's
// own action is a Buy. Anything else is a quiet turn.
//
// Off, the gate isn't read. In shadow (the default) the Curator runs as ever, and Diagnostics records
// beside it what the gate would have decided, and why. On, a quiet turn skips the Curator: the read's
// changes of its kinds, held aside for it, land in its place, as for a Curator that never ran
// (`roles/curator.ts` `uncurated`), so a quiet turn the gate misjudges still lands what the read
// found. Pure but `quietCurator`, which records.

import { ROLE_LABEL } from "../../shared/agent-roles";
import type { CuratorGate } from "../../shared/agent-pipeline";
import { hasOwn, isRecord, type JsonObject } from "../../shared/json";
import { nameTokens, stem } from "../../shared/things";
import type { WorldDoc } from "../../shared/world";
import type { Registry } from "../../engine/registry-impl";
import { isGone, placeOfEntity } from "../../engine/scope";
import type { WorldState } from "../../engine/state";
import { thingIndex } from "../../engine/thing-index";
import { holdersOf } from "../../engine/things";
import type { DiagAt } from "../diagnostics";
import type { Runtime } from "../runtime";

/** What a turn's world gives the gate to read the words against. */
export interface GateWords {
  /** The head nouns of every name of each thing in the player character's scene (on them, or where they are), stemmed (`nameKey`). */
  things: ReadonlySet<string>;
  /** Every word of a name the world has (its entities', its places', made in play among them, its lore entries', its own), stemmed. */
  known: ReadonlySet<string>;
}

export interface CuratorGateInput extends GateWords {
  reply: string;
  /** The player's message the reply answers. */
  said: string;
  /** The turn's own action, or one queued after it, is a Buy. */
  buy: boolean;
}

/** Whether the Curator runs, and why: each thing in the words that gives it work, in words (none for a quiet turn). */
export interface CuratorGateDecision {
  run: boolean;
  why: string[];
}

/** The acts that give the Curator work, each a pattern over the words as `folded` reads them. A word that is mostly a noun ("hand", "store", "fire", "pack") counts only in a verb's phrase. */
const ACTS: readonly { act: string; words: RegExp }[] = [
  {
    act: "a hand-over",
    words: words([
      "give",
      "gives",
      "gave",
      "given",
      "giving",
      "handed",
      "handing",
      "hands? (?:over|back|it|them|him|her|you|me|us)",
      "pass(?:es|ed|ing)? (?:it|them|him|her|you|me|us|over|back|along)",
      "lend(?:s|ing)?",
      "lent",
      "loan(?:s|ed|ing)?",
      "borrow(?:s|ed|ing)?",
      "trad(?:e|es|ed|ing)",
      "swap(?:s|ped|ping)?",
      "steal(?:s|ing)?",
      "stole",
      "stolen",
      "snatch(?:es|ed|ing)?",
      "grab(?:s|bed|bing)?",
      "toss(?:es|ed|ing)?",
      "pocket(?:ed|ing)",
      "return(?:s|ed|ing)? (?:it|them|the|his|her|their|my|your)",
    ]),
  },
  {
    act: "a placement",
    words: words([
      "put",
      "puts",
      "putting",
      "plac(?:ed|ing)",
      "places (?:it|them|the|a|an|his|her|their|my|your)",
      "set(?:s|ting)? (?:it |them )?(?:down|aside)",
      "drop(?:s|ped|ping)?",
      "stash(?:es|ed|ing)?",
      "stow(?:s|ed|ing)?",
      "tuck(?:s|ed|ing)?",
      "pack(?:s|ed|ing)",
      "unpack(?:s|ed|ing)?",
      "load(?:s|ed|ing)",
      "unload(?:s|ed|ing)?",
      "hang(?:s|ing)?",
      "hung",
      "stor(?:ed|ing)",
      "leav(?:e|es|ing) (?:it|them)",
      "left (?:it|them)",
      "slip(?:s|ped|ping)? (?:it|them)",
    ]),
  },
  {
    act: "a purchase",
    words: words(["buy(?:s|ing)?", "bought", "purchas(?:e|es|ed|ing)", "pay(?:s|ing)?", "paid", "sell(?:s|ing)?", "sold", "rent(?:s|ed|ing)?", "tipp(?:ed|ing)", "order(?:s|ed|ing)", "order (?:a|an|the|some|two|three|another|one|more)", "costs?", "pric(?:ed|es)", "charg(?:e|es|ed|ing)", "refund(?:s|ed|ing)?"]),
  },
  { act: "a purchase", words: /[$€£¥]\s?\d|\b\d+(?:[.,]\d+)?\s?(?:dollars?|bucks|cents?|euros?|pounds?|quid)\b/u },
  {
    act: "something worn",
    words: words([
      "wear(?:s|ing)?",
      "wore",
      "worn",
      "don(?:s|ned|ning)?",
      "doff(?:s|ed|ing)?",
      "dress(?:es|ed|ing)?",
      "undress(?:es|ed|ing)?",
      "(?:put|puts|putting|pull|pulls|pulled|pulling|slip|slips|slipped|slipping|tug|tugs|tugged|tugging|shrug|shrugs|shrugged|shrugging|zip|zips|zipped|zipping|button|buttons|buttoned|buttoning) (?:on|off|up|into)",
      "(?:take|takes|took|taking|kick|kicks|kicked|kicking|peel|peels|peeled|peeling|strip|strips|stripped|stripping) off",
      "chang(?:e|es|ed|ing) (?:into|out of|clothes)",
      "holster(?:s|ed|ing)?",
      "unholster(?:s|ed|ing)?",
      "sheath(?:e|es|ed|ing)?",
      "unsheath(?:e|es|ed|ing)?",
      "(?:draws?|drew|readies|readied|ready) (?:a|an|the|his|her|their|my|your) (?:gun|pistol|revolver|rifle|shotgun|knife|sword|blade|weapon|bow)",
    ]),
  },
  {
    act: "something used",
    words: words([
      "use",
      "uses",
      "using",
      "used(?! to)",
      "eat(?:s|en|ing)?",
      "ate",
      "drink(?:s|ing)?",
      "drank",
      "sip(?:s|ped|ping)?",
      "swallow(?:s|ed|ing)?",
      "chew(?:s|ed|ing)?",
      "smok(?:es|ed|ing)",
      "lights? (?:a|an|the|his|her|their|my|your|it|up)",
      "lit (?:a|an|the|his|her|their|my|your|it|up)",
      "pour(?:s|ed|ing)?",
      "fill(?:s|ed|ing)?",
      "refill(?:s|ed|ing)?",
      "empt(?:ies|ied|ying)",
      "fires (?:a|an|the|at|off|it)",
      "fired",
      "firing",
      "shoot(?:s|ing)?",
      "shot (?:at|him|her|them|it|the|a|an)",
      "reload(?:s|ed|ing)?",
      "wield(?:s|ed|ing)?",
      "smash(?:es|ed|ing)?",
      "shatter(?:s|ed|ing)?",
      "repair(?:s|ed|ing)?",
      "mend(?:s|ed|ing)?",
      "fix(?:es|ed|ing)? (?:it|the|a|an|his|her|their|my|your)",
      "break(?:s|ing)? (?:it|the|a|an|his|her|their|my|your)",
      "broke (?:it|the|a|an|his|her|their|my|your)",
      "los(?:e|es|ing)",
      "lost (?:it|the|a|an|his|her|their|my|your)",
      "misplac(?:e|es|ed|ing)",
      "find(?:s|ing)?",
      "found",
      "unlock(?:s|ed|ing)?",
      "open(?:s|ed|ing)? (?:it|the|a|an|his|her|their|my|your)",
    ]),
  },
];

/** A pattern of whole words and phrases. */
function words(list: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${list.join("|")})\\b`, "u");
}

/** A list of words, each a key. */
function lookup(...lists: readonly string[]): Readonly<Record<string, true>> {
  return Object.freeze(Object.fromEntries(lists.flatMap((list) => list.split(" ")).map((word) => [word, true as const])));
}

/** Capitalized words that name no one: the first person, titles and the calendar's. */
const NEVER_NAMES = lookup("i im ive ill id mr mrs ms dr sir madam maam miss god monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december");

/** Words that are never a name inside a sentence either (one after a colon, a title's): articles, pronouns, the commonest joining words. */
const FUNCTION_WORDS = "the a an and or but nor of in on at to for with from by as into onto is it its this that these those there here then than if so not no yes you your yours he she his her hers him they them their theirs we us our ours me my mine";
const NEVER_IN_A_SENTENCE = lookup(FUNCTION_WORDS);

/**
 * Words a sentence starts with that are no name: besides the joining words, pronouns, question
 * words, the commonest adverbs, interjections, contractions (apostrophes gone) and dialogue's
 * openers. A sentence's first word counts as a name only when it is none of these, the words never
 * say it in lowercase, and it isn't a word ending in -ing or -ly before a comma ("Smiling, she…").
 */
const SENTENCE_STARTS = lookup(
  FUNCTION_WORDS,
  "about above across after again against all almost along also although always among another any anybody anyone anything anyway anywhere around because before behind below beneath beside besides between beyond both during each either else even ever every everybody everyone everything everywhere few finally first however inside instead just later least less like maybe meanwhile more most much near neither never next nobody none nothing now nowhere once only other others outside over perhaps quite rather really several since slowly some somebody someone something sometimes somewhere soon still such suddenly though through throughout together too toward towards under unless until up upon very well what whatever when whenever where wherever whether which while who whoever whom whose why within without yet",
  "ah aha alright bye ha hello hey hi hm hmm huh mhm nope oh ok okay oops sorry sure thanks thank uh um wait whoa wow yeah yep",
  "am are be been being can could did do does done had has have may might must shall should was were will would",
  "aint arent cant couldnt didnt doesnt dont hadnt hasnt havent hed hes id ill im isnt itd itll ive lets mustnt shed shell shes shouldnt thats theres theyd theyll theyre theyve wasnt wed werent weve whats wheres whos wont wouldnt youd youll youre youve",
  "come go look listen tell give take get let make keep stop please see watch hold try leave stay sit stand put bring call",
);

/** Whether the word at `at` starts a sentence: the text's first, a line's, one right after an opening quote, bracket or action mark, or one after a sentence's end (past any closing marks). */
function sentenceStart(text: string, at: number): boolean {
  const before = text[at - 1];
  if (before === undefined || /["“'‘([*_]/u.test(before)) return true;
  let i = at - 1;
  while (i >= 0 && /\s/u.test(text[i] ?? "")) {
    if (text[i] === "\n") return true;
    i--;
  }
  while (i >= 0 && /["”'’)\]*_]/u.test(text[i] ?? "")) i--;
  return i < 0 || /[.!?…]/u.test(text[i] ?? "");
}

/** A word's comparison forms, as a name's words are kept: stemmed, and a hyphenated word's last part too. */
function formsOf(token: string): string[] {
  const out = [stem(token)];
  const last = token.includes("-") ? token.split("-").at(-1) : undefined;
  if (last !== undefined && last !== "") out.push(stem(last));
  return out;
}

/** The capitalized words of `text` that name someone or somewhere the world doesn't have (`known`), each once, as written. */
function unknownNames(text: string, known: ReadonlySet<string>, lower: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\p{L}[\p{L}\p{M}\p{N}'’-]*/gu)) {
    const word = m[0].replace(/['’]s?$/u, "");
    if (!/^\p{Lu}/u.test(word) || (word.length > 1 && word === word.toUpperCase())) continue;
    const tokens = nameTokens(word);
    if (tokens.length === 0 || tokens.every((t) => hasOwn(NEVER_NAMES, t) || formsOf(t).some((f) => known.has(f)))) continue;
    if (tokens.some((t) => hasOwn(NEVER_IN_A_SENTENCE, t))) continue;
    if (sentenceStart(text, m.index)) {
      if (tokens.some((t) => hasOwn(SENTENCE_STARTS, t) || lower.has(t))) continue;
      if (/(?:ing|ly)$/u.test(tokens.at(-1) ?? "") && text[m.index + m[0].length] === ",") continue;
    }
    if (!out.includes(word)) out.push(word);
  }
  return out;
}

/** Quoted, the first few. */
function quoted(list: readonly string[]): string {
  return list
    .slice(0, 3)
    .map((w) => `"${w}"`)
    .join(", ");
}

/** The gate (see the module's head): whether the reply and the player's message give the Curator work, and each reason they do. */
export function curatorGate(input: CuratorGateInput): CuratorGateDecision {
  const why: string[] = [];
  const text = `${input.reply}\n${input.said}`;
  // A thing here, by a head noun of one of its names, as the words say it.
  const forms = new Map<string, string>();
  for (const token of nameTokens(text)) for (const form of formsOf(token)) if (!forms.has(form)) forms.set(form, token);
  const things = [...new Set([...forms].flatMap(([form, token]) => (input.things.has(form) ? [token] : [])))];
  if (things.length > 0) why.push(`the words name something in the scene (${quoted(things)})`);
  // Someone or somewhere the world doesn't have: what the words also say in lowercase is a common word.
  const lower = new Set((text.match(/(?<![\p{L}\p{M}'’-])\p{Ll}[\p{L}\p{M}\p{N}'’-]*/gu) ?? []).flatMap((w) => nameTokens(w)));
  const names = unknownNames(text, input.known, lower);
  if (names.length > 0) why.push(`the words name someone or somewhere the world doesn't have (${quoted(names)})`);
  // The acts read the words lowercased, accents and apostrophes gone ("don't" is "dont", so no pattern meets a contraction's part), spacing single.
  const lowered = text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/['’]/g, "").replace(/\s+/g, " ");
  const acts = new Map<string, string>();
  for (const { act, words: pattern } of ACTS) {
    const found = acts.has(act) ? null : pattern.exec(lowered);
    if (found) acts.set(act, found[0]);
  }
  for (const [act, word] of acts) why.push(`the words tell of ${act} ("${word}")`);
  if (input.buy) why.push("the turn's own action is a Buy");
  return { run: why.length > 0, why };
}

/** The other names a record keeps (`fields.aliases`). */
function aliasesOf(fields: Readonly<JsonObject> | undefined): string[] {
  const list = isRecord(fields) ? fields.aliases : undefined;
  return Array.isArray(list) ? list.filter((a): a is string => typeof a === "string") : [];
}

/** What `state` gives the gate: the scene's things by their head nouns, and every name the world has, word by word. */
export function gateWords(registry: Registry, world: WorldDoc, state: Readonly<WorldState>): GateWords {
  const ctx = registry.context(world, state);
  const index = thingIndex(ctx);
  const here = placeOfEntity(state, world.pov);
  const things = new Set<string>();
  for (const id of index.things) {
    if (isGone(state, id) || !((here !== null && placeOfEntity(state, id) === here) || holdersOf(state, id).includes(world.pov))) continue;
    for (const name of index.names.get(id) ?? []) for (const head of name.heads) things.add(head);
  }
  const known = new Set<string>();
  const add = (text: string): void => {
    for (const token of nameTokens(text)) for (const form of formsOf(token)) known.add(form);
  };
  add(ctx.world.name);
  for (const e of Object.values(state.entities)) for (const name of [e.name, ...aliasesOf(e.fields)]) add(name);
  for (const p of Object.values(ctx.world.places)) for (const name of [p.name, ...aliasesOf(p.fields)]) add(name);
  for (const l of Object.values(ctx.world.lore)) for (const name of [l.title, ...(l.aliases ?? [])]) add(name);
  return { things, known };
}

/** Why a quiet turn skipped the Curator, as Diagnostics and the log say it. */
const QUIET = "a quiet turn: the words name nothing it keeps, so the read's own changes of its kinds land instead (Settings → Agents → Roles → Curator → When it runs)";

/**
 * The gate as a turn's read runs it (`mode`, `pipeline.curatorGate`): whether its Curator is skipped.
 * Off, it reads nothing and skips nothing. In shadow it records in Diagnostics, beside the Curator,
 * what it would have decided and why, and skips nothing. On, a quiet turn skips the Curator, which
 * Diagnostics records as a step skipped, and a turn with work runs it, the log saying why.
 */
export function quietCurator(rt: Pick<Runtime, "registry" | "diag" | "host">, at: DiagAt, mode: CuratorGate, input: { world: WorldDoc; state: Readonly<WorldState>; reply: string; said: string; buy: boolean }): boolean {
  if (mode === "off") return false;
  const gate = curatorGate({ ...gateWords(rt.registry, input.world, input.state), reply: input.reply, said: input.said, buy: input.buy });
  const turn = `[LumiRPEngine] turn ${(at.turn ?? "").slice(0, 8)}`;
  const why = gate.why.join("; ");
  if (mode === "shadow") {
    const decided = gate.run ? `in shadow, the quiet-turn gate would run it: ${why}` : "in shadow, the quiet-turn gate would have skipped it: the words name nothing it keeps";
    rt.diag.yielded(at, "read", ROLE_LABEL.curator, decided, false);
    rt.host.log("info", `${turn}: the Curator ran; ${decided}`, at.userId);
    return false;
  }
  if (gate.run) {
    rt.host.log("info", `${turn}: the quiet-turn gate runs the Curator: ${why}`, at.userId);
    return false;
  }
  rt.diag.skipped(at, "read", ROLE_LABEL.curator, QUIET);
  rt.host.log("info", `${turn}: the Curator was skipped, ${QUIET}`, at.userId);
  return true;
}
