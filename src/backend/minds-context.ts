// What one character's mind is given (DESIGN §24.5): only what that character knows, and nothing of
// any other mind. Every context holds who they are (their own fields, their aims and their own
// secrets, whole), the intent the GM set for them, where they are and whom they see there, and the
// occasion. Then each source the user has minds read (Settings → Minds → What a mind reads), each
// within its own limit: the story as it stands (the lore pinned to them and to where they are, the
// lore the turn activates, how the latest reply ended and what the player says), their usual routine
// (on by default: habits to weigh, never orders), and, when switched on, their own summary, notes and
// what they saw, last thoughts, recall of the turns they were there for, and their life (money, the
// day, commitments and plans). Nothing limits the whole: a part's own
// limit is the only one, so no room left by the others cuts what the user allowed. Never the GM view
// (but for the intent the GM set for them), another mind, what another character's memory says they
// were told, or a turn they weren't present for.

import type { EntityId, MessageId, PlaceId } from "../shared/ids";
import type { Limit, MindMoment, MindsCharacter, MindsMemoryConfig, MindsReads } from "../shared/minds";
import { limitOf } from "../shared/minds";
import { loreIsSecret } from "../shared/lore";
import type { LoreEntryDef, WorldDoc } from "../shared/world";
import { formatMoney } from "../shared/world";
import { calendarOf, dateAt, dayPartAt, formatClock, formatHHMM, holidaysOn } from "../engine/calendar";
import { cuesOf } from "../engine/cues";
import { loreHeldBy, loreReadable, loreSearch, loreSnippet } from "../engine/lore";
import { fitPins, type PinnedText } from "../engine/lore-pins";
import { optionalQuery, own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { fieldDef, isGone, kindIs, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { agendaFor } from "../engine/tracks";
import { canSeeEntity, knows, loreGateReader } from "../engine/visibility";
import { dayPlan } from "../packs/castlife/core/index";
import { usualRoutine } from "../packs/castlife/core/usual";
import { routineRole } from "../packs/castlife/core/routines";
import { intentLines, intentOf } from "../packs/minds/core/intent";
import { faded, openCommitments, openPlans, readCharacter, readSlice, salienceNow } from "../packs/minds/core/state";
import { CHARS_PER_TOKEN, sectionTokens } from "./book";
import type { HostMessage } from "./host";
import { readableReply } from "./json-hiding";

/** Everything a mind's context is read from. */
export interface MindScope {
  reg: Registry;
  world: WorldDoc;
  state: Readonly<WorldState>;
  who: EntityId;
  memory: MindsMemoryConfig;
  /** The chat's messages, for recall. */
  messages: readonly HostMessage[];
  /** Replies' hidden JSON blocks stay out of recall, as they stay out of every read (DESIGN §6.7). */
  hideJson: boolean;
  moment: MindMoment;
  /** What a mind reads (Settings → Minds): each source on or off, within its own limit. The memory step reads the turn within the reply's and the message's limits. */
  reads: MindsReads;
  /** The lore pinned to them, then to where they are and the places holding it, nearest first (DESIGN §24.5), read now. */
  pinned?: readonly PinnedText[];
}

/** A lore entry as a mind's context gave it: whole, or cut to its source's limit, or left out over it (`left`). A `secret` one stays off every player surface. */
export interface GivenLore {
  title: string;
  entry: LoreEntryDef | null;
  tokens: number;
  cut: boolean;
  left: boolean;
  secret: boolean;
}

/** What a mind's context gave of its lore (DESIGN §24.5): what is pinned for them, and what the turn activated; and how many lines of their usual routine it gave and left out over its limit. */
export interface MindContextReport {
  pinned: GivenLore[];
  activated: GivenLore[];
  routine?: { given: number; left: number };
}

/** Fields a person's sheet holds that the context says elsewhere or that are the engine's own bookkeeping. */
const SKIPPED_FIELDS: Readonly<Record<string, true>> = { place: true, x: true, y: true, gone: true, needs: true, holds: true, knownBy: true, appointments: true, trips: true, activity: true };

const STOP: Readonly<Record<string, true>> = Object.fromEntries("the and for with that this from into have has had was were are you your they them their there here what when where which who how why just very some more most other then than about would could should will been being does did not but all any can its it's i'm he's she's".split(" ").map((w) => [w, true] as const));

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => w.length >= 4 && !STOP[w]);
}

/** Text tidied: runs of spaces, and of blank lines, made one; its line breaks kept. */
function tidy(text: string): string {
  return text.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Text tidied and cut at a word to `max` characters. */
function clip(text: string, max: number): string {
  const t = tidy(text);
  return t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** The end of a text, tidied, from a word, within `max` characters: where a reply ended up. */
function tail(text: string, max: number): string {
  const t = tidy(text);
  return t.length <= max ? t : `…${t.slice(t.length - max + 1).replace(/^\S*\s+/, "")}`;
}

/** A source's limit in characters, at the section estimate's characters a token: what its text is cut to. */
function charsOf(limit: Limit): number {
  return limit === "none" ? Number.POSITIVE_INFINITY : Math.floor(limit * CHARS_PER_TOKEN);
}

/** The latest reply as a mind or the memory step reads it: as displayed, whole, or its end within the reply's limit. */
function latestReply(scope: Pick<MindScope, "hideJson" | "reads">, reply: string): string {
  return tail(readableReply(reply, scope.hideJson), charsOf(scope.reads.reply.tokens));
}

/** Whole lines, in order, within `limit` tokens: one that doesn't fit is left out and the next one tried. */
function linesWithin(lines: readonly string[], limit: Limit): string[] {
  let left = limitOf(limit);
  return lines.filter((line) => {
    const cost = sectionTokens(line);
    if (cost > left) return false;
    left -= cost;
    return true;
  });
}

/** Text as one sentence: its first letter capitalised and a full stop added unless it ends in one; "" stays "". */
function sentence(text: string): string {
  const t = text.trim();
  return t === "" ? "" : `${t[0]?.toUpperCase() ?? ""}${t.slice(1)}${/[.!?…]$/.test(t) ? "" : "."}`;
}


function nameOf(scope: Pick<MindScope, "state" | "world">, id: string): string {
  return own(scope.state.entities, id)?.name ?? own(scope.world.places, id)?.name ?? id;
}

/** The POV as this character knows them: by name once they know them (a `knows` relation, or regard either way), else as a stranger. */
export function povLabel(scope: Pick<MindScope, "state" | "world" | "who">): string {
  const { state, world, who } = scope;
  const pov = world.pov;
  const known = knows(state, who, pov) || knows(state, pov, who) || !!own(state.entities, who)?.relations.some((r) => r.type === "regard" && r.to === pov) || !!own(state.entities, pov)?.relations.some((r) => r.type === "regard" && r.to === who);
  return known ? nameOf(scope, pov) : "a stranger";
}

/** The narration speaks to the POV in the second person; a mind told "You are X" would otherwise read every "you" in it as X. */
function storyVoice(scope: Pick<MindScope, "state" | "world" | "who">): string {
  const pov = povLabel(scope);
  const them = pov === "a stranger" ? "that stranger" : pov;
  return `The story is told to ${pov === "a stranger" ? "a stranger, the player character" : `${pov}, the player character`}: in the story's text, "you" and "your" mean ${them}, never you.`;
}

/** The assistant messages of the turns `who` was in the POV's scene for, oldest first (`minds.presence`). */
export function presentTurns(state: Readonly<WorldState>, who: EntityId): MessageId[] {
  const out: MessageId[] = [];
  for (const p of readSlice(state).presence) if (p.msg !== null && p.who.includes(who) && !out.includes(p.msg)) out.push(p.msg);
  return out;
}

/** One recalled turn: its reply message, and the turn as text. */
export interface RecalledTurn {
  msg: MessageId;
  text: string;
}

/**
 * Recall by presence (DESIGN §24.4): of the turns `who` was present for, the latest `recall.recent`
 * and the `recall.relevant` that share the most words with `about` (what the moment is to them),
 * oldest first, within `recall.tokens`: whole turns, the latest kept first. A turn is the player's
 * message before the reply and the reply as displayed.
 */
export function recallFor(scope: Pick<MindScope, "state" | "who" | "memory" | "messages" | "hideJson">, about: string): RecalledTurn[] {
  const { memory, messages } = scope;
  const index = new Map(messages.map((m, i) => [m.id, i]));
  const turns: RecalledTurn[] = [];
  for (const msg of presentTurns(scope.state, scope.who)) {
    const i = index.get(msg);
    const reply = i === undefined ? undefined : messages[i];
    if (i === undefined || !reply || reply.isUser) continue;
    const user = messages.slice(0, i).findLast((m) => m.isUser);
    const said = user ? tidy(user.swipes[user.swipeId] ?? user.content) : "";
    const wrote = tidy(readableReply(reply.swipes[reply.swipeId] ?? reply.content, scope.hideJson));
    if (wrote === "" && said === "") continue;
    turns.push({ msg, text: `${said !== "" ? `Player: ${said}\n` : ""}Story: ${wrote}` });
  }
  const recent = turns.slice(Math.max(0, turns.length - memory.recall.recent));
  const rest = turns.slice(0, Math.max(0, turns.length - memory.recall.recent));
  const wanted = new Set(wordsOf(about));
  const scored = rest
    .map((t, i) => ({ t, i, hits: wordsOf(t.text).filter((w) => wanted.has(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.i - a.i)
    .slice(0, memory.recall.relevant);
  const chosen = [...scored.map((x) => x.t), ...recent].sort((a, b) => turns.indexOf(a) - turns.indexOf(b));
  // Within the token limit the latest turns are kept first, each whole.
  const out: RecalledTurn[] = [];
  let left = limitOf(memory.recall.tokens);
  for (const t of [...chosen].reverse()) {
    const cost = sectionTokens(t.text);
    if (cost > left) continue;
    left -= cost;
    out.unshift(t);
  }
  return out;
}

/** The occasion: the clock and day part, any holiday today, and the weather over where they are. */
function occasion(scope: Pick<MindScope, "reg" | "world" | "state">, place: PlaceId | null): string {
  const { reg, world, state } = scope;
  const cal = calendarOf(world);
  const day = dateAt(cal, state.clock).dayIndex;
  const holidays = holidaysOn(cal, day).map((h) => h.label);
  const sky = place ? optionalQuery(reg.context(world, state), "weather.sky")?.(reg.context(world, state), place) : null;
  return `It is ${formatClock(cal, state.clock)} (${dayPartAt(cal, state.clock).label.toLowerCase()})${holidays.length > 0 ? `, ${holidays.join(", ")}` : ""}${sky ? `; the weather: ${sky.replace(/_/g, " ")}` : ""}.`;
}

/** Their own fields, a list of words or ids (traits, likes) as a comma list; the engine's own records and other objects left out. */
function sheetLines(scope: MindScope): string[] {
  const { reg, world, state, who } = scope;
  const e = own(state.entities, who);
  if (!e) return [];
  const out: string[] = [];
  for (const [field, value] of Object.entries(e.fields).sort(([a], [b]) => a.localeCompare(b))) {
    if (SKIPPED_FIELDS[field] || value === null) continue;
    const items = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : typeof value === "object" ? [] : [value];
    if (items.length === 0) continue;
    const label = fieldDef(reg, world, e.kind, field)?.label ?? field.replace(/_/g, " ");
    out.push(`- ${label}: ${items.map((v) => (typeof v === "string" && (own(state.entities, v) || own(world.places, v)) ? nameOf(scope, v) : String(v).replace(/_/g, " "))).join(", ")}`);
  }
  return out;
}

/**
 * Their own secrets, whole (DESIGN §24.5): the truths of every track they own and of every track a
 * cue of theirs stands for, and the secret lore that is theirs (`loreHeldBy`), whatever the player has
 * found out. A character knows their own secret, revealed or not.
 */
function secretLines(scope: Pick<MindScope, "world" | "who">): string[] {
  const { world, who } = scope;
  const named = new Set(cuesOf(world, who).flatMap((c) => (c.secret.kind === "track" ? [c.secret.id] : [])));
  const out: string[] = [];
  for (const [id, t] of Object.entries(world.tracks).sort(([a], [b]) => a.localeCompare(b))) {
    if (t.owner !== who && !named.has(id)) continue;
    const truths = Object.values(t.stages).flatMap((s) => (s.truth ? [s.truth] : []));
    if (truths.length > 0) out.push(`- Your secret, ${t.label}: ${tidy(truths.join(" "))}`);
  }
  for (const l of heldLore(world, who)) out.push(`- Your secret, ${l.title}: ${tidy(l.content)}`);
  return out;
}

/** The secret lore entries that are `who`'s own, in id order. */
function heldLore(world: WorldDoc, who: EntityId): LoreEntryDef[] {
  return Object.keys(world.lore)
    .sort()
    .flatMap((id) => {
      const l = own(world.lore, id);
      return l && loreIsSecret(l) && loreHeldBy(world, l, who) ? [l] : [];
    });
}

/**
 * Who they are, in every context and never cut (DESIGN §24.5): their own fields, the aims they pursue
 * (their agendas, the author's) and their own secrets, whole.
 */
function identityLines(scope: MindScope): string[] {
  const aims = agendaFor(scope.world, scope.state, scope.who).map((a) => `- Your aim, ${a.label}: ${a.stageLabel}`);
  return [...sheetLines(scope), ...aims, ...secretLines(scope)];
}

/**
 * Their life, when they read it (DESIGN §24.5): their money in their own words, the rest of today as
 * the Cast life planner lays it (their routine and their plans, and whatever the planner fills the
 * free time with), their open commitments and their plans in force. None of it is the story as it
 * stands: the planner's day is the engine's guess, and plans and commitments come from narration
 * that may have depicted another mind, which is why minds don't read it unless the user says so.
 */
function lifeLines(scope: MindScope, c: MindsCharacter): string[] {
  const { reg, world, state, who } = scope;
  const ctx = reg.context(world, state);
  const out: string[] = [];
  // Their money in their own words: each line is a sentence that says what it is about.
  for (const line of optionalQuery(ctx, "economy.summary")?.(ctx, who).lines ?? []) out.push(`- ${line}`);
  const cal = calendarOf(world);
  try {
    for (const b of dayPlan(ctx, who).blocks.filter((x) => x.end > state.clock).slice(0, 6)) out.push(`- Today ${formatHHMM(dateAt(cal, b.start).minuteOfDay)}–${formatHHMM(dateAt(cal, b.end).minuteOfDay)}: ${b.label}${b.place ? ` (${nameOf(scope, b.place)})` : ""}`);
  } catch {
    // A world without a working day planner (no Cast life) has no day to tell.
  }
  for (const x of openCommitments(c).slice(0, scope.memory.commitments.show)) out.push(`- Commitment (${x.kind}${x.with.length > 0 ? ` with ${x.with.map((id) => nameOf(scope, id)).join(", ")}` : ""}): ${x.text}${x.due !== null ? `, due ${formatClock(cal, x.due)}` : ""}`);
  for (const p of openPlans(c).slice(0, 8)) out.push(`- Plan (${p.kind}): ${p.what}${p.cents !== undefined ? `, ${formatMoney(p.cents, world.currency)}` : ""}, ${formatClock(cal, p.when.from)} to ${formatHHMM(dateAt(cal, p.when.to).minuteOfDay)}${p.where ? ` at ${nameOf(scope, p.where)}` : ""}${p.with.length > 0 ? ` with ${p.with.map((id) => nameOf(scope, id)).join(", ")}` : ""}`);
  return out;
}

/**
 * Their usual routine, when they read it (DESIGN §24.5): the blocks of their routine and their own
 * place and activity schedules, the ones around now first, as habits they may weigh, never orders.
 * Never the day the planner lays (the meals, friends and invitations it fills free time with), and a
 * private block only when it is their own routine's or the chat's change for them: a group's, a
 * kind's or the world's private block is someone else's business. With their routine role `off` they
 * have none to read.
 */
function routineLines(scope: MindScope): string[] {
  const { reg, world, state, who } = scope;
  const ctx = reg.context(world, state);
  if (routineRole(ctx, who) === "off") return [];
  try {
    return usualRoutine(ctx, who, { place: (place) => own(world.places, place)?.name ?? null, activity: true })
      .filter((c) => !c.private || c.own)
      .map((c) => `- ${sentence(c.text)}`);
  } catch {
    // A world without Cast life's routines has no routine to tell.
    return [];
  }
}

/** The people where they are that they can see, with how they stand toward each. */
function sceneLines(scope: MindScope, place: PlaceId | null): string[] {
  const { reg, world, state, who } = scope;
  if (place === null) return ["You aren't anywhere in particular."];
  const ctx = reg.context(world, state);
  const words = optionalQuery(ctx, "relationships.words");
  const here = Object.keys(state.entities)
    .sort()
    .filter((id) => id !== who && placeOfEntity(state, id) === place && kindIs(reg, world, own(state.entities, id)?.kind ?? "", "person") && !isGone(state, id) && canSeeEntity(reg, world, state, who, id));
  const out = [`You are at ${nameOf(scope, place)}.`];
  if (here.length === 0) out.push("No one else is here.");
  for (const id of here) {
    const label = id === world.pov ? povLabel(scope) : nameOf(scope, id);
    const regard = words?.(ctx, who, id) ?? null;
    out.push(`- ${label}${id === world.pov ? " (the player character)" : ""}${regard ? `: you feel ${regard}` : knows(state, who, id) ? ": you know them" : ""}`);
  }
  return out;
}

/**
 * What they remember and what they saw (DESIGN §24.4): their notes, most salient first, then the
 * latest of what they saw happen. Never what their witness log says someone told them: that is
 * another character's memory step's reading of the turn, and nothing of another mind reaches a mind
 * (whoever was told was there for the turn, which is theirs to recall).
 */
function memoryLines(scope: Pick<MindScope, "state" | "memory" | "world">, c: MindsCharacter): string[] {
  const { state, memory, world } = scope;
  const cal = calendarOf(world);
  const out: string[] = [];
  const notes = c.notes
    .filter((n) => !faded(n, state.clock, memory))
    .sort((a, b) => salienceNow(b, state.clock, memory) - salienceNow(a, state.clock, memory) || b.at - a.at)
    .slice(0, memory.notes.show);
  for (const n of notes) out.push(`- ${n.text}`);
  const saw = c.witness.filter((w) => w.how === "saw");
  for (const w of saw.slice(Math.max(0, saw.length - memory.witness.show))) out.push(`- ${formatClock(cal, w.at)}: saw: ${w.what}`);
  return out;
}

/**
 * What they know of the world (DESIGN §24.5): the lore pinned to them and to where they are, nearest
 * first, within what they read of it, each whole until that runs out (the entry it runs out on cut at
 * a word, or left out once not even its title and a few words fit); then the lore the turn activates,
 * read as them: the entries `about` names by a key, an alias, a title or a lookup-table term, in rank
 * order, within their own limit. Their own secrets are in who they are, and a pin given is not given
 * again, so nothing comes twice. `report` hears what became of each entry.
 */
function loreBlock(scope: MindScope, about: string, report?: MindContextReport): string {
  const { reg, world, state, who, reads } = scope;
  const reader = { reg, world, state, tokens: sectionTokens };
  const held = heldLore(world, who).map((l) => l.id);
  const given = new Set(held);
  const lines: string[] = [];
  if (reads.pinned.on) {
    const open = loreGateReader(reg, world, state);
    const pins = (scope.pinned ?? []).filter((p) => p.entry === null || !held.includes(p.entry.id));
    for (const g of fitPins(reader, pins, limitOf(reads.pinned.tokens), (entry) => loreReadable(reg, world, state, entry, "mind", false, open, who))) {
      report?.pinned.push({ title: g.title, entry: g.entry, tokens: g.tokens, cut: g.cut, left: g.snippet === null, secret: g.secret });
      if (g.snippet === null) continue;
      if (g.entry) given.add(g.entry.id);
      lines.push(`- ${g.snippet}`);
    }
  }
  if (reads.activated.on && about.trim() !== "") {
    let left = limitOf(reads.activated.tokens);
    for (const hit of loreSearch(reader, { query: about, purpose: "mind", as: who, exact: true, tokenBudget: Number.POSITIVE_INFINITY, skip: given }).hits) {
      const entry = own(world.lore, hit.id);
      if (!entry) continue;
      const snippet = loreSnippet(sectionTokens, entry, left);
      report?.activated.push({ title: hit.title, entry, tokens: snippet?.tokens ?? 0, cut: snippet?.cut ?? false, left: snippet === null, secret: hit.secret });
      if (!snippet) continue;
      left -= snippet.tokens;
      lines.push(`- ${snippet.text}`);
    }
  }
  return block("What you know of the world", lines);
}

function block(title: string, lines: readonly string[]): string {
  return lines.length > 0 ? `## ${title}\n${lines.join("\n")}` : "";
}

/** Their last thoughts: their own latest mind, within what they read of it. */
function thoughtsBlock(scope: MindScope, c: MindsCharacter): string {
  const last = c.mind;
  const text = last ? clip([last.monologue, last.intent !== "" ? `You meant to: ${last.intent}` : "", last.mood ? `You felt ${last.mood}.` : ""].filter((l) => l !== "").join("\n"), charsOf(scope.reads.thoughts.tokens)) : "";
  return last && text !== "" ? block(`Your last thoughts (${formatClock(calendarOf(scope.world), last.at)})`, [text]) : "";
}

/** The user message of a `mind` call: who they are, where they are, and each source they read; `report` hears what became of their lore. */
export function mindContext(scope: MindScope, report?: MindContextReport): string {
  const { world, state, who, moment, reads } = scope;
  const e = own(state.entities, who);
  const c = readCharacter(state, who);
  const place = placeOfEntity(state, who);
  const withPov = place !== null && placeOfEntity(state, world.pov) === place;
  const cal = calendarOf(world);
  // How the last turn ended is theirs only if they heard it: someone the POV met at its end, or who
  // came in since, wasn't there for what it tells (DESIGN §24.4).
  const said = readSlice(state).presence.findLast((p) => p.msg !== null);
  const heardLast = said === undefined || said.who.includes(who);
  // A moment the player said nothing in (a time skip's end) tells why they think now.
  const why = moment.user.trim() === "" ? sentence(moment.reason) : "";
  const ended = reads.reply.on && moment.kind !== "beat" && withPov && heardLast && moment.reply.trim() !== "" ? latestReply(scope, moment.reply) : "";
  const message = reads.message.on && withPov && moment.kind !== "beat" && moment.user.trim() !== "" ? clip(moment.user, charsOf(reads.message.tokens)) : "";
  const now =
    moment.kind === "beat"
      ? [`It is ${formatClock(cal, moment.at)}. ${sentence(moment.reason)}`.trim()]
      : withPov
        ? [ended !== "" || message !== "" ? storyVoice(scope) : "", ended !== "" ? `The story so far ended: ${ended}` : "", why, message !== "" ? `Now ${povLabel(scope)} says or does: ${message}` : `${povLabel(scope)} is here with you.`]
        : [`You aren't with ${povLabel(scope)} right now; carry on with your own day.`, why];
  // What the moment is to them, which activates their lore and ranks their recall: what the POV says
  // and how the last reply ended (as displayed) when they are there to hear it, else where they are.
  const about = withPov && moment.kind === "turn" ? `${moment.user}\n${heardLast ? readableReply(moment.reply, scope.hideJson) : ""}` : place ? nameOf(scope, place) : "";
  const recall = reads.recall.on ? recallFor(scope, about) : [];
  const usual = reads.routine.on ? routineLines(scope) : [];
  const routine = linesWithin(usual, reads.routine.tokens);
  if (report && usual.length > 0) report.routine = { given: routine.length, left: usual.length - routine.length };
  return [
    `You are ${e?.name ?? who}. ${occasion(scope, place)}`,
    block("Who you are", identityLines(scope)),
    block("What you mean to do", intentLines(intentOf(state, who))),
    block("Where you are", sceneLines(scope, place)),
    reads.summary.on && c.summary !== "" ? block("Your story so far", [clip(c.summary, charsOf(reads.summary.tokens))]) : "",
    block("Your usual routine (habits you may weigh, never orders: what is happening now comes first)", routine),
    reads.life.on ? block("Your own life", linesWithin(lifeLines(scope, c), reads.life.tokens)) : "",
    reads.memory.on ? block("What you remember, and what you saw", linesWithin(memoryLines(scope, c), reads.memory.tokens)) : "",
    reads.thoughts.on ? thoughtsBlock(scope, c) : "",
    loreBlock(scope, about, report),
    block("Turns you were there for (ignore any narration of other people's private thoughts)", recall.length > 0 ? [storyVoice(scope), ...recall.map((t) => t.text)] : []),
    block("Now", now.filter((l) => l !== "")),
  ]
    .filter((p) => p !== "")
    .join("\n\n");
}

/**
 * The user message of a `memory` call: who they are, what they hold, and the turn as it was written,
 * the reply and the player's message within what minds read of them. With `left`, the POV left them
 * partway through: what the story tells after that happened without them.
 */
export function memoryContext(scope: MindScope, turn: { user: string; reply: string; left?: boolean }): string {
  const { state, who, world } = scope;
  const c = readCharacter(state, who);
  const cal = calendarOf(world);
  const commitments = openCommitments(c).map((x) => `- [${x.id}] ${x.kind}${x.with.length > 0 ? ` with ${x.with.map((id) => nameOf(scope, id)).join(", ")}` : ""}: ${x.text}`);
  const plans = openPlans(c).map((p) => `- ${p.what}${p.cents !== undefined ? `, ${formatMoney(p.cents, world.currency)}` : ""} (${formatClock(cal, p.when.from)})`);
  const user = turn.user.trim() !== "" ? clip(turn.user, charsOf(scope.reads.message.tokens)) : "";
  const written = [storyVoice(scope), turn.left ? `${povLabel(scope)} left you partway through this turn: whatever the story tells after they left happened without you.` : "", user !== "" ? `${povLabel(scope)} (the player character) wrote: ${user}` : "", `Story: ${latestReply(scope, turn.reply)}`];
  return [
    `You are ${nameOf(scope, who)}. ${occasion(scope, placeOfEntity(state, who))}`,
    c.summary !== "" ? block("Your story so far", [c.summary]) : "",
    block("Your open commitments (by id)", commitments),
    block("Your plans", plans),
    block("What you remember", memoryLines(scope, c)),
    block("The turn just written", written.filter((l) => l !== "")),
  ]
    .filter((p) => p !== "")
    .join("\n\n");
}

/** The user message of a `consolidate` call: the summary and the notes to fold into it. */
export function consolidateContext(scope: Pick<MindScope, "state" | "world" | "who">, notes: readonly { text: string; at: number }[]): string {
  const c = readCharacter(scope.state, scope.who);
  const cal = calendarOf(scope.world);
  return [`You are ${nameOf(scope, scope.who)}.`, block("Your summary", [c.summary !== "" ? c.summary : "(none yet)"]), block("Older notes to fold in", notes.map((n) => `- ${formatClock(cal, n.at)}: ${n.text}`))].filter((p) => p !== "").join("\n\n");
}
