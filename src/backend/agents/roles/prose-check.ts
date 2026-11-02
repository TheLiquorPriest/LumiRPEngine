// The director's lines held against the turn it was given (DESIGN §4.6, "The roles"): a line of its
// brief or outline that has someone in the scene whom the state has elsewhere (`here`), someone the
// state has in the scene gone from it (`gone`), someone holding or handing over a thing the state says
// they don't have (`holds`), or a thing lying in the scene that the state has on someone or elsewhere
// (`lies`) is flagged and kept: the narrator still gets it, and the director's run tells the main
// agent and Diagnostics which lines and why (`agents/yields.ts`), never passing one over silently.
// Its lines tell the turn's own actions as well as the scene they leave, so what a line says is held
// to the state as the turn started and as it ends, and stands when it fits either: what someone hands
// over or puts down this turn was theirs as it started, and whoever the player character leaves was
// with them then.
//
// Conservative by construction, since the story may hold what the state doesn't yet: only people and
// things the world has and the player character may see, each named so that only one fits; only a
// plain statement in the present (the name, then what they do there or that they're gone; the
// holder's, then a verb of holding or handing, then "the" thing); never a line that tells it as
// remote, remembered, hoped for or still to come, as arriving or leaving, or that names a place apart
// from the scene; nor one right after a line about a call, a text, a phone, a message or a screen,
// which may be the other end of it; and nothing the world has no entity for. Answering and replying
// are never read as being here: either may be down a line. Pure: one check per turn, read line by line.

import type { ProseClashKind } from "../../../shared/agent-yield";
import type { EntityId } from "../../../shared/ids";
import type { WorldDoc } from "../../../shared/world";
import { acts } from "../../../engine/life";
import { own } from "../../../engine/pack-kit";
import { together } from "../../../engine/presence";
import type { Registry } from "../../../engine/registry-impl";
import { isGone, kindIs, placeOfEntity, placeWithin } from "../../../engine/scope";
import type { WorldState } from "../../../engine/state";
import { canSeeEntity, plainLetters } from "../../../engine/visibility";
import { holderOf, isInside } from "../../../packs/gear/core/model";

/** A line the check flagged, and how it contradicts the state. */
export interface ProseClash {
  kind: ProseClashKind;
  line: string;
}

const W = "[\\p{L}\\p{N}]";
/** Not inside a word, nor right after an apostrophe; and not inside a word, nor a possessive. */
const BEFORE = `(?<!${W}|')`;
const AFTER = `(?!${W}|')`;

/** What someone does in the scene, said plainly in the present right after their name: never answering or replying, which may be down a line. */
const HERE_VERBS = ["sits", "sits down", "stands", "stands up", "leans", "waits", "watches", "nods", "smiles", "grins", "laughs", "chuckles", "frowns", "shrugs", "sighs", "says", "asks", "tells", "whispers", "mutters", "hands", "gives", "passes", "pours", "slides", "puts", "places", "points", "glances", "joins", "greets", "hugs", "winks", "wipes", "reaches", "turns to", "looks at", "looks up", "looks over", "looks around", "is here", "is sitting", "is standing", "is leaning", "is waiting", "is behind", "is beside", "is next to"];

/** Words of a call, a text, a phone, a message or a screen: whoever a line has at the other end is remote, and so is the line right after one. */
const CHANNEL = ["phone", "phones", "phoned", "phoning", "cellphone", "smartphone", "speakerphone", "cell", "mobile", "receiver", "handset", "on speaker", "the line", "dial", "dials", "dialed", "dialled", "rings", "ringing", "rang", "hangs up", "hung up", "call", "calls", "called", "calling", "caller", "text", "texts", "texted", "texting", "message", "messages", "messaged", "messaging", "voicemail", "video", "facetime", "facetimes", "screen", "screens", "on-screen", "onscreen", "monitor", "laptop", "tablet", "webcam", "livestream", "broadcast", "television", "tv", "email", "emails", "radio"];

/** Words that put what a line says of someone away from the scene: a call, a text, a phone, a message or a screen, and what is remote, remembered, habitual, hoped for, still to come, arriving or leaving. */
const REMOTE = [...CHANNEL, "letter", "note", "remember", "remembers", "remembered", "recall", "recalls", "think", "thinks", "thought", "thoughts", "imagine", "imagines", "imagined", "dream", "dreams", "dreamed", "photo", "photograph", "picture", "portrait", "mention", "mentions", "mentioned", "usually", "always", "often", "sometimes", "never", "every", "all day", "these days", "will", "would", "could", "might", "should", "later", "tomorrow", "yesterday", "earlier", "tonight", "before", "after", "once", "used to", "if", "when", "whether", "wonder", "wonders", "hope", "hopes", "plan", "plans", "expect", "expects", "arrive", "arrives", "arrived", "arriving", "comes in", "walks in", "enters", "entered", "shows up", "returns", "returned", "appears", "knocks", "pulls up", "on the way", "on his way", "on her way", "on their way", "leave", "leaves", "leaving", "departs", "departed", "departing", "goes out", "walks out", "steps out", "heads out", "heads off", "heads for", "heads to", "heads toward", "heads towards", "heads home", "heads back", "walks away", "drives off", "drives away", "out the door", "for the door", "goodbye", "goodbyes", "farewell", "outside", "across the street", "in the distance", "through the window", "next door", "back at", "over at", "at home", "across town", "elsewhere", "meanwhile", "somewhere"];

/** Holding something, said plainly right before "the" thing. */
const HOLD_VERBS = ["holds", "is holding", "carries", "is carrying", "has", "clutches", "is clutching", "grips", "wields", "brandishes", "draws", "pulls out", "takes out", "produces", "sets down", "puts down", "lays down", "drops"];

/** Handing something over, with up to three words for whom between the verb and "the" thing. */
const HAND_VERBS = ["hands", "hands over", "gives", "passes", "slides", "tosses"];

/** A thing lying somewhere, "the thing sits on the counter": its verbs, and the surfaces it lies on. */
const LIE_VERBS = ["lies", "lie", "sits", "sit", "rests", "rest", "waits", "hangs", "is lying", "is sitting", "is resting", "is waiting", "is hanging", "are lying", "are sitting"];
const LIE_SURFACES = ["table", "counter", "bar", "desk", "floor", "shelf", "bench", "workbench", "seat", "dashboard", "ground", "bed", "chair", "stool", "sill", "windowsill", "hood", "step", "steps", "porch", "dock", "deck", "tray", "hook", "nightstand", "dresser"];

/** Honorifics and particles that never single anyone out on their own. */
const FILLER: Readonly<Record<string, true>> = { mr: true, mrs: true, ms: true, miss: true, dr: true, sir: true, lady: true, lord: true, dame: true, the: true, of: true, de: true, van: true, von: true, la: true, le: true, old: true, young: true, captain: true, constable: true, father: true, mother: true, sister: true, brother: true, aunt: true, uncle: true };

/** A text as the checks read it: lowercase, accents and curly quotes plain, one space between words. */
function plain(text: string): string {
  return plainLetters(text.normalize("NFC").toLowerCase())
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** A name's words, as `plain` reads them. */
function words(name: string): string[] {
  return plain(name).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** A name's words in order, whatever stands between them in the line ("mechanic's toolbox"). */
function phrase(ws: readonly string[]): string {
  return ws.join("[^\\p{L}\\p{N}]+");
}

/** Patterns as alternatives, longest first, so the longest one fits where several start; a space in one is any run of spaces. */
function alt(options: readonly string[]): string {
  return [...options]
    .sort((a, b) => b.length - a.length)
    .map((o) => o.replace(/ /g, "\\s+"))
    .join("|");
}

/** A moment of the turn as the checks read it: its state, where the player character is then, whom and what they may see, and the places apart from them. */
interface Moment {
  state: Readonly<WorldState>;
  here: string | null;
  sees: ReadonlySet<EntityId>;
  /** A place apart from the scene, by its whole name: one the player character's place isn't with, nor inside. */
  apart: RegExp | null;
}

/**
 * The check for the turn the director was given: a line's clash with it, or null. `world` is the
 * turn's (its lore included); `start` is the state the turn started from, before its planned events,
 * and `end` the planned turn's, as the director's facts read it. What a line says of someone or
 * something clashes only where it fits neither. `before` is the line told just before it in the same
 * answer: a line right after one about a call, a text, a phone, a message or a screen is remote too.
 */
export function proseClashes(reg: Registry, world: WorldDoc, start: Readonly<WorldState>, end: Readonly<WorldState>): (line: string, before?: string) => ProseClashKind | null {
  const pov = world.pov;
  const moment = (state: Readonly<WorldState>): Moment => {
    const here = placeOfEntity(state, pov);
    const apart = Object.entries(world.places)
      .filter(([id]) => !together(world, here, id) && !(here !== null && placeWithin(world, here, id)))
      .map(([, p]) => phrase(words(p.name)))
      .filter((p) => p !== "");
    return {
      state,
      here,
      sees: new Set(Object.keys(state.entities).filter((id) => !isGone(state, id) && canSeeEntity(reg, world, state, pov, id))),
      apart: apart.length > 0 ? new RegExp(`${BEFORE}(?:${alt(apart)})${AFTER}`, "u") : null,
    };
  };
  const moments = start === end ? [moment(end)] : [moment(start), moment(end)];
  // Each entity by its name and kind as the turn ends, else as it started.
  const entity = (id: EntityId) => own(end.entities, id) ?? own(start.entities, id);
  // Whom and what the player character may see at either moment.
  const visible = [...new Set(moments.flatMap((m) => [...m.sees]))];
  const people = visible.filter((id) => kindIs(reg, world, entity(id)?.kind ?? "", "person"));
  // A word of a name counts alone only while no one else the player character may see has it.
  const holders: Record<string, number> = {};
  for (const id of people) for (const w of new Set(words(entity(id)?.name ?? ""))) holders[w] = (holders[w] ?? 0) + 1;
  // Each person by the forms a line names them in: the whole name, and each word of it no one else's has.
  const named = people.flatMap((id) => {
    const ws = words(entity(id)?.name ?? "");
    const single = ws.filter((w) => w.length >= 3 && FILLER[w] !== true && holders[w] === 1);
    return ws.length === 0 ? [] : [{ id, names: alt([phrase(ws), ...single]) }];
  });
  // Things someone can hold, by their whole names: never a vehicle, a fixed thing or money.
  const byName: Record<string, EntityId[]> = {};
  for (const id of visible) {
    const e = entity(id);
    if (!e || !kindIs(reg, world, e.kind, "item") || kindIs(reg, world, e.kind, "vehicle") || e.kind === "account" || e.kind === "card" || e.fields.fixed === true) continue;
    const key = words(e.name).join(" ");
    if (key !== "") byName[key] = [...(byName[key] ?? []), id];
  }
  const things = alt(Object.keys(byName).map((k) => phrase(k.split(" "))));
  // The one thing a line's words for it name, or null when several go by them.
  const thingOf = (said: string | undefined): EntityId | null => {
    const ids = said === undefined ? [] : (byName[words(said).join(" ")] ?? []);
    return ids.length === 1 ? (ids[0] ?? null) : null;
  };
  // "The" thing, or someone's, as a line names one it means: never "a", "his" or "their", which may be another.
  const definite = `(?:the|${W}+(?:'s|'))\\s+`;
  // What the line says of the thing next isn't a participle ("has the relay installed").
  const thing = `(${things})(?!\\s+${W}+ed${AFTER})${AFTER}`;
  // A word that puts a line away from the scene, or its possessive ("the phone's speaker").
  const remote = new RegExp(`${BEFORE}(?:${alt(REMOTE)})(?:'s?)?${AFTER}`, "u");
  const channel = new RegExp(`${BEFORE}(?:${alt(CHANNEL)})(?:'s?)?${AFTER}`, "u");
  const checks = named.map(({ id, names }) => {
    const who = `${BEFORE}(?:${names})${AFTER}`;
    return {
      id,
      here: new RegExp(`${who}\\s+(?:${W}+ly\\s+)?(?:${alt(HERE_VERBS)})${AFTER}`, "u"),
      gone: new RegExp(
        [
          `${who}\\s+(?:is|was)\\s+(?:gone|absent|nowhere to be seen|no longer here|not here|not around)${AFTER}`.replace(/ /g, "\\s+"),
          `${who}\\s+(?:is|was)\\s+away(?!${W}|'|\\s+(?:from|at|with|in|on)${AFTER})`,
          `${who}\\s+(?:isn't|is\\s+not|wasn't|was\\s+not|is\\s+no\\s+longer)\\s+(?:here|around|present)${AFTER}`,
          `${who}\\s+(?:has|had)\\s+(?:already\\s+)?(?:left|gone\\s+home|gone\\s+away)(?=\\s*(?:[.,;!?]|$|already${AFTER}|for${AFTER}|early${AFTER}|earlier${AFTER}))`,
          `no\\s+sign\\s+of\\s+${who}`,
          `${BEFORE}(?:${names})(?:'s|')\\s+absence${AFTER}`,
        ].join("|"),
        "u",
      ),
      holds: things === "" ? null : new RegExp(`${who}\\s+(?:${W}+ly\\s+)?(?:(?:${alt(HOLD_VERBS)})|(?:${alt(HAND_VERBS)})(?:\\s+${W}+){0,3}?)\\s+${definite}${thing}`, "u"),
    };
  });
  const lies = things === "" ? null : new RegExp(`${BEFORE}${definite}${thing}\\s+(?:${alt(LIE_VERBS)})\\s+(?:on|in|at|by|under|beside|near|against|across|inside|atop)\\s+the\\s+(?:${alt(LIE_SURFACES)})${AFTER}`, "u");
  // Whether someone has a thing on them in a state, however deep: a person holds what holds it.
  const onPerson = (state: Readonly<WorldState>, id: EntityId): boolean => {
    let cur = holderOf(state, id);
    for (let guard = 0; cur !== null && guard < 32; guard++) {
      if (kindIs(reg, world, own(state.entities, cur)?.kind ?? "", "person")) return true;
      cur = holderOf(state, cur);
    }
    return false;
  };
  // What a line says is held to each moment of the turn, and clashes only where every one has it
  // otherwise; a moment in which the player character can't see whom or what it names says nothing.
  return (line, before) => {
    const text = plain(line);
    if (text === "") return null;
    const away = remote.test(text) || (before !== undefined && channel.test(plain(before)));
    for (const c of checks) {
      if (c.id === pov) continue;
      if (!away && c.here.test(text) && moments.every((m) => m.sees.has(c.id) && acts(world, m.state, c.id) && !together(world, m.here, placeOfEntity(m.state, c.id)) && !(m.apart?.test(text) ?? false))) return "here";
      if (c.gone.test(text) && moments.every((m) => m.sees.has(c.id) && acts(world, m.state, c.id) && together(world, m.here, placeOfEntity(m.state, c.id)))) return "gone";
    }
    for (const c of checks) {
      const held = thingOf(c.holds?.exec(text)?.[1]);
      if (held !== null && moments.every((m) => m.sees.has(c.id) && m.sees.has(held) && !isInside(m.state, held, c.id))) return "holds";
    }
    const lying = thingOf(lies?.exec(text)?.[1]);
    return lying !== null && moments.every((m) => m.sees.has(lying) && (onPerson(m.state, lying) || !together(world, m.here, placeOfEntity(m.state, lying)))) ? "lies" : null;
  };
}
