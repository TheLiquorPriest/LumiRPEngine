// What one character's mind is given (DESIGN §24.5): only what that character knows, and nothing of
// any other mind. Every context holds who they are (their own fields, their aims and their own
// secrets, whole), the intent the GM set for them, where they are and whom they see there, and the
// occasion. Then each source the user has minds read (Settings → Minds → What a mind reads), each
// within its own limit: the story as it stands (the lore pinned to them and to where they are, the
// lore the turn activates, how the latest reply ended and what the player says), their usual routine
// (on by default: habits to weigh, never orders), their plans (on by default: what the turns stated
// and the GM set), what they know (on by default while the chat tracks knowledge, §24.11: their own
// holdings, which then stand for the secrets an author gave them, a cue's aside), and, when switched
// on, their own summary, notes and what they saw, last thoughts, recall of the turns they were there
// for, and their life (money, the day and commitments). Nothing limits the whole: a part's own limit
// is the only one, so no room left by the others cuts what the user allowed. Never the GM view
// (but for the intent the GM set for them), another mind, what another character's memory says they
// were told, or a turn they weren't present for.

import type { EntityId, MessageId, PlaceId } from "../shared/ids";
import type { KnowledgeSettings, Limit, MindMoment, MindsCharacter, MindsMemoryConfig, MindsReads } from "../shared/minds";
import { factId, knowledgeText, knowledgeThreshold, limitOf, planWords } from "../shared/minds";
import { applyMarks } from "../shared/secret-marks";
import { loreIsSecret } from "../shared/lore";
import type { LoreEntryDef, StepPurpose, WorldDoc } from "../shared/world";
import { activitySpanEnd, ENGINE_FIELDS, formatMoney } from "../shared/world";
import { calendarOf, dateAt, dayPartAt, formatClock, formatHHMM, holidaysOn } from "../engine/calendar";
import { cuesOf } from "../engine/cues";
import { ownMessage } from "../engine/ledger/path";
import { loreHeldBy, loreReadable, loreSearch, loreSnippet } from "../engine/lore";
import { fitPins, type PinnedText } from "../engine/lore-pins";
import { optionalQuery, own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { together } from "../engine/presence";
import { fieldDef, isGone, kindIs, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { agendaFor } from "../engine/tracks";
import { canSeeEntity, knows, loreFactId, loreGateReader } from "../engine/visibility";
import { dayPlan } from "../packs/castlife/core/index";
import { usualRoutine } from "../packs/castlife/core/usual";
import { routineRole } from "../packs/castlife/core/routines";
import { intentLines, intentOf } from "../packs/minds/core/intent";
import { holdingLine, latestTurns, rankedHoldings } from "../packs/minds/core/knowledge";
import { worldSecrets } from "../packs/minds/core/knowledge-section";
import { faded, openCommitments, openPlans, readCharacter, readKnowledge, readSlice, salienceNow } from "../packs/minds/core/state";
import { CHARS_PER_TOKEN, sectionTokens } from "./book";
import type { HostMessage } from "./host";
import { recentMessages } from "./interpret-context";
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
  /**
   * The lore pinned for the call (DESIGN §24.5), read now: a mind's, to them, to every mind (at a
   * time skip's beat, to its beats too) and to where they are, nearest first; a memory or
   * consolidation call's, to its step.
   */
  pinned?: readonly PinnedText[];
  /** The chat before the moment's turn (`chatBefore`), which Recent chat reads while it is on; absent, none. */
  history?: readonly HostMessage[];
  /**
   * The user's knowledge settings while the chat tracks knowledge (DESIGN §24.11): a mind then reads
   * what it holds (What they know, while that source is on), in place of the secrets an author gave
   * it in who they are. Absent: knowledge off, and a mind reads as before it.
   */
  knowledge?: KnowledgeSettings;
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

/** What a mind's context gave of its lore (DESIGN §24.5): what is pinned for them, and what the turn activated; how many lines of their usual routine it gave and left out over its limit; and how many of the chat's latest messages it gave. */
export interface MindContextReport {
  pinned: GivenLore[];
  activated: GivenLore[];
  routine?: { given: number; left: number };
  plans?: { given: number; left: number };
  history?: number;
}

/** Fields a person's sheet holds that the context says elsewhere or that are the engine's own bookkeeping. */
const SKIPPED_FIELDS: Readonly<Record<string, true>> = { place: true, x: true, y: true, gone: true, needs: true, holds: true, knownBy: true, appointments: true, trips: true, activity: true, ...ENGINE_FIELDS };

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
 * own message (`ownMessage`), none for a reply sent after a reply, and the reply as displayed, so a
 * message is recalled once, with the reply it got.
 */
export function recallFor(scope: Pick<MindScope, "state" | "who" | "memory" | "messages" | "hideJson">, about: string): RecalledTurn[] {
  const { memory, messages } = scope;
  const index = new Map(messages.map((m, i) => [m.id, i]));
  const turns: RecalledTurn[] = [];
  for (const msg of presentTurns(scope.state, scope.who)) {
    const i = index.get(msg);
    const reply = i === undefined ? undefined : messages[i];
    if (i === undefined || !reply || reply.isUser) continue;
    const user = ownMessage(messages.slice(0, i));
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

/**
 * Their own fields, a list of words or ids (traits, likes) as a comma list; the engine's own records
 * and other objects left out. When what they're doing ends is told as every other time here is, the
 * world's day and time in words (a bare count of minutes means nothing to a model), and only while
 * it is still ahead and still that activity's (`activitySpanEnd`): an end gone by tells nothing.
 */
export function sheetLines(scope: Pick<MindScope, "reg" | "world" | "state" | "who">): string[] {
  const { reg, world, state, who } = scope;
  const e = own(state.entities, who);
  if (!e) return [];
  const out: string[] = [];
  for (const [field, value] of Object.entries(e.fields).sort(([a], [b]) => a.localeCompare(b))) {
    if (SKIPPED_FIELDS[field] || value === null) continue;
    const label = fieldDef(reg, world, e.kind, field)?.label ?? field.replace(/_/g, " ");
    if (field === "activity_until") {
      const end = activitySpanEnd(e.fields);
      if (end !== null && end > state.clock) out.push(`- ${label}: ${formatClock(calendarOf(world), end)}`);
      continue;
    }
    const items = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : typeof value === "object" ? [] : [value];
    if (items.length === 0) continue;
    out.push(`- ${label}: ${items.map((v) => (typeof v === "string" && (own(state.entities, v) || own(world.places, v)) ? nameOf(scope, v) : String(v).replace(/_/g, " "))).join(", ")}`);
  }
  return out;
}

/**
 * Their own secrets, whole (DESIGN §24.5): the truths of every track they own and of every track a
 * cue of theirs stands for, and the secret lore that is theirs (`loreHeldBy`), whatever the player has
 * found out. A character knows their own secret, revealed or not. While they read what they hold
 * (`holdings`, DESIGN §24.11), a secret an author gave them that the chat records as a fact is there
 * instead, held or not as the story left it: only a cue's stays here (decision 11 waits), and any the
 * chat hasn't recorded yet.
 */
function secretLines(scope: Pick<MindScope, "world" | "state" | "who">, holdings: boolean): string[] {
  const { world, who } = scope;
  const named = new Set(cuesOf(world, who).flatMap((c) => (c.secret.kind === "track" ? [c.secret.id] : [])));
  const recorded = holdings ? readKnowledge(scope.state).facts : {};
  const out: string[] = [];
  for (const [id, t] of Object.entries(world.tracks).sort(([a], [b]) => a.localeCompare(b))) {
    if (t.owner !== who && !named.has(id)) continue;
    const truths = Object.entries(t.stages).flatMap(([stage, s]) => (s.truth && (named.has(id) || !own(recorded, factId({ kind: "track", track: id, stage }))) ? [s.truth] : []));
    if (truths.length > 0) out.push(`- Your secret, ${t.label}: ${tidy(truths.join(" "))}`);
  }
  for (const l of heldLore(world, who)) {
    const byCue = !(l.holders ?? []).includes(who);
    if (byCue || !own(recorded, loreFactId(l))) out.push(`- Your secret, ${l.title}: ${tidy(l.content)}`);
  }
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
 * (their agendas, the author's) and their own secrets, whole, but those they read in what they hold.
 */
function identityLines(scope: MindScope): string[] {
  const aims = agendaFor(scope.world, scope.state, scope.who).map((a) => `- Your aim, ${a.label}: ${a.stageLabel}`);
  return [...sheetLines(scope), ...aims, ...secretLines(scope, scope.knowledge !== undefined && scope.reads.knowledge.on)];
}

/**
 * What they know (DESIGN §24.11), while the chat tracks knowledge and they read it: the facts they
 * hold, the most relevant first (`byPlay`: a secret, theirs to keep or one of the world's, then what
 * is about someone or somewhere here or came up lately), each with how they came by it, what they
 * make of it and whom they keep it from, within the user's tokens (`mindTokens`). Their own holdings
 * only: no one else's, and no fact they don't hold. A secret mark in a claim's text stays only where
 * it names them (`holder:<id>`).
 */
function knowledgeBlock(scope: MindScope, place: PlaceId | null): string {
  const settings = scope.knowledge;
  if (!settings || !scope.reads.knowledge.on) return "";
  const { world, state, who } = scope;
  const slice = readSlice(state);
  const here = place === null ? [] : Object.keys(state.entities).filter((id) => placeOfEntity(state, id) === place);
  const play = { here: [...here, ...(place ? [place] : [])], recent: latestTurns(slice, settings.inPlayTurns), secret: worldSecrets(scope.reg.context(world, state)) };
  const words = { texts: settings, threshold: knowledgeThreshold(slice), nameOf: (id: EntityId) => (id === world.pov ? povLabel(scope) : nameOf(scope, id)) };
  const lines = rankedHoldings(slice, who, play).map((h) => `- ${holdingLine(applyMarks(h.fact?.claim ?? h.id, { world, state }, `holder:${who}`), h.holding, words)}`);
  const kept = linesWithin(lines, settings.mindTokens);
  return kept.length > 0 ? block(knowledgeText(settings, "mindTitle"), [knowledgeText(settings, "mindLead"), ...kept]) : "";
}

/**
 * Their life, when they read it (DESIGN §24.5): their money in their own words, the rest of today as
 * the Cast life planner lays it (their routine and their plans, and whatever the planner fills the
 * free time with) and their open commitments. None of it is the story as it stands: the planner's
 * day is the engine's guess, and commitments come from narration that may have depicted another mind,
 * which is why minds don't read it unless the user says so. Their plans are a source of their own.
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
  return out;
}

/**
 * Their plans, when they read them (DESIGN §24.5, on by default): their open plans in force, soonest
 * first, each with its time, place and who else is in it: what the turns stated they will do and
 * what the GM set, so a mind keeps to what it agreed. A plan everyone in it shares is each one's own,
 * in its own words only for the one whose memory recorded it (`planWords`). Never the day the planner
 * lays, which stays in their life.
 */
function planLines(scope: MindScope, c: MindsCharacter): string[] {
  const cal = calendarOf(scope.world);
  return openPlans(c).map((p) => `- Plan (${p.kind}): ${planWords(p, scope.who)}${p.cents !== undefined ? `, ${formatMoney(p.cents, scope.world.currency)}` : ""}, ${formatClock(cal, p.when.from)} to ${formatHHMM(dateAt(cal, p.when.to).minuteOfDay)}${p.where ? ` at ${nameOf(scope, p.where)}` : ""}${p.with.length > 0 ? ` with ${p.with.map((id) => nameOf(scope, id)).join(", ")}` : ""}`);
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
 * order, within their own limit. Their own secrets in who they are aren't given again, and a pin
 * given is not given again, so nothing comes twice; a secret they read in what they hold (DESIGN
 * §24.11) comes here whole when the turn calls for it, as any entry they may read. `report` hears
 * what became of each entry.
 */
function loreBlock(scope: MindScope, about: string, report?: MindContextReport): string {
  const { reg, world, state, who, reads } = scope;
  const reader = { reg, world, state, tokens: sectionTokens };
  const recorded = scope.knowledge !== undefined && reads.knowledge.on ? readKnowledge(state).facts : {};
  const held = heldLore(world, who)
    .filter((l) => !(l.holders ?? []).includes(who) || !own(recorded, loreFactId(l)))
    .map((l) => l.id);
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

/**
 * Recent chat (DESIGN §24.5), while it is on: the latest messages before the turn as the player sees
 * them (hidden JSON blocks left out), oldest first, at most so many and about so many tokens in all,
 * whichever runs out first, the oldest that doesn't fit whole keeping its end (`recentMessages`). It
 * tells of turns they weren't there for: the chat, not what they know.
 */
export function recentChat(scope: Pick<MindScope, "reads" | "hideJson" | "history">): string[] {
  const { history } = scope.reads;
  if (!history.on || !scope.history) return [];
  const chain = scope.history.map((m) => ({ id: m.id, isUser: m.isUser, swipeId: m.swipeId, swipes: m.swipes, ledger: null }));
  return recentMessages(chain, { messages: history.messages, tokens: history.tokens }, scope.hideJson);
}

/** Recent chat as a block: the story's "you" is the POV, and it tells of more than they were there for. */
function recentBlock(scope: Pick<MindScope, "state" | "world" | "who">, lines: readonly string[]): string {
  return block("Recent chat (as the player sees it: it tells of turns you weren't there for too)", lines.length > 0 ? [storyVoice(scope), ...lines] : []);
}

/** The user message of a `mind` call: who they are, where they are, and each source they read; `report` hears what became of their lore. */
export function mindContext(scope: MindScope, report?: MindContextReport): string {
  const { world, state, who, moment, reads } = scope;
  const e = own(state.entities, who);
  const c = readCharacter(state, who);
  const place = placeOfEntity(state, who);
  const withPov = together(world, place, placeOfEntity(state, world.pov));
  const cal = calendarOf(world);
  // How the last turn ended is theirs only if they heard it: someone the POV met at its end, or who
  // came in since, wasn't there for what it tells (DESIGN §24.4).
  const said = readSlice(state).presence.findLast((p) => p.msg !== null);
  const heardLast = said === undefined || said.who.includes(who);
  // A moment the player said nothing in (a time skip's end) tells why they think now.
  const why = moment.user.trim() === "" ? sentence(moment.reason) : "";
  const ended = reads.reply.on && moment.kind !== "beat" && withPov && heardLast && moment.reply.trim() !== "" ? latestReply(scope, moment.reply) : "";
  const message = reads.message.on && withPov && moment.kind !== "beat" && moment.user.trim() !== "" ? clip(moment.user, charsOf(reads.message.tokens)) : "";
  // Inside a time skip, those with the player character are told what the player said it does in that
  // time, in the player's words, while minds read the player's message (Settings → Minds).
  const spending = reads.message.on && withPov && moment.skip ? `${povLabel(scope)} is spending this time as the player's message says: ${clip(moment.skip, charsOf(reads.message.tokens))}` : "";
  const now =
    moment.kind === "beat"
      ? [`It is ${formatClock(cal, moment.at)}. ${sentence(moment.reason)}`.trim(), spending]
      : withPov
        ? [ended !== "" || message !== "" ? storyVoice(scope) : "", ended !== "" ? `The story so far ended: ${ended}` : "", why, spending, message !== "" ? `Now ${povLabel(scope)} says or does: ${message}` : `${povLabel(scope)} is here with you.`]
        : [`You aren't with ${povLabel(scope)} right now; carry on with your own day.`, why];
  // What the moment is to them, which activates their lore and ranks their recall: what the POV says
  // and how the last reply ended (as displayed) when they are there to hear it, else where they are.
  const about = withPov && moment.kind === "turn" ? `${moment.user}\n${heardLast ? readableReply(moment.reply, scope.hideJson) : ""}` : place ? nameOf(scope, place) : "";
  const recall = reads.recall.on ? recallFor(scope, about) : [];
  const usual = reads.routine.on ? routineLines(scope) : [];
  const routine = linesWithin(usual, reads.routine.tokens);
  if (report && usual.length > 0) report.routine = { given: routine.length, left: usual.length - routine.length };
  const planned = reads.plans.on ? planLines(scope, c) : [];
  const plans = linesWithin(planned, reads.plans.tokens);
  if (report && planned.length > 0) report.plans = { given: plans.length, left: planned.length - plans.length };
  // The latest reply, when they read how it ended, is the newest message before the turn: Recent
  // chat gives the messages before it rather than the same reply twice.
  const chat = recentChat(ended !== "" && scope.history?.at(-1)?.isUser === false ? { ...scope, history: scope.history.slice(0, -1) } : scope);
  if (report && chat.length > 0) report.history = chat.length;
  return [
    `You are ${e?.name ?? who}. ${occasion(scope, place)}`,
    block("Who you are", identityLines(scope)),
    block("What you mean to do", intentLines(intentOf(state, who))),
    knowledgeBlock(scope, place),
    block("Where you are", sceneLines(scope, place)),
    reads.summary.on && c.summary !== "" ? block("Your story so far", [clip(c.summary, charsOf(reads.summary.tokens))]) : "",
    block("Your usual routine (habits you may weigh, never orders: what is happening now comes first)", routine),
    block("Your plans", plans),
    reads.life.on ? block("Your own life", linesWithin(lifeLines(scope, c), reads.life.tokens)) : "",
    reads.memory.on ? block("What you remember, and what you saw", linesWithin(memoryLines(scope, c), reads.memory.tokens)) : "",
    reads.thoughts.on ? thoughtsBlock(scope, c) : "",
    loreBlock(scope, about, report),
    block("Turns you were there for (ignore any narration of other people's private thoughts)", recall.length > 0 ? [storyVoice(scope), ...recall.map((t) => t.text)] : []),
    recentBlock(scope, chat),
    block("Now", now.filter((l) => l !== "")),
  ]
    .filter((p) => p !== "")
    .join("\n\n");
}

/**
 * The lore pinned to a minds step that reads no other lore (DESIGN §24.5: memory, consolidation, a
 * time skip's beats), as lines: each entry whole within the pinned lore a mind reads, the entry it
 * runs out on cut at a word, or left out once not even its title and a few words fit; read as the
 * character when the call is someone's, so a secret that isn't theirs stays out.
 */
export function pinnedLines(scope: Pick<MindScope, "reg" | "world" | "state" | "reads" | "pinned"> & { who?: EntityId }, purpose: StepPurpose): string[] {
  const { reg, world, state, who } = scope;
  const open = loreGateReader(reg, world, state);
  const given = fitPins({ reg, world, state, tokens: sectionTokens }, scope.pinned ?? [], limitOf(scope.reads.pinned.tokens), (entry) => loreReadable(reg, world, state, entry, purpose, false, open, who));
  return given.flatMap((g) => (g.snippet === null ? [] : [`- ${g.snippet}`]));
}

/**
 * The user message of a `memory` call: who they are, what they hold, the lore pinned to the memory
 * step, the recent chat while minds read it, and the turn as it was written, the reply and the
 * player's message within what minds read of them. With `left`, the POV left them partway through:
 * what the story tells after that happened without them.
 */
export function memoryContext(scope: MindScope, turn: { user: string; reply: string; left?: boolean }): string {
  const { state, who, world } = scope;
  const c = readCharacter(state, who);
  const cal = calendarOf(world);
  const commitments = openCommitments(c).map((x) => `- [${x.id}] ${x.kind}${x.with.length > 0 ? ` with ${x.with.map((id) => nameOf(scope, id)).join(", ")}` : ""}: ${x.text}`);
  const plans = openPlans(c).map((p) => `- ${planWords(p, who)}${p.cents !== undefined ? `, ${formatMoney(p.cents, world.currency)}` : ""} (${formatClock(cal, p.when.from)})${p.with.length > 0 ? ` with ${p.with.map((id) => nameOf(scope, id)).join(", ")}` : ""}`);
  const user = turn.user.trim() !== "" ? clip(turn.user, charsOf(scope.reads.message.tokens)) : "";
  const written = [storyVoice(scope), turn.left ? `${povLabel(scope)} left you partway through this turn: whatever the story tells after they left happened without you.` : "", user !== "" ? `${povLabel(scope)} (the player character) wrote: ${user}` : "", `Story: ${latestReply(scope, turn.reply)}`];
  return [
    `You are ${nameOf(scope, who)}. ${occasion(scope, placeOfEntity(state, who))}`,
    c.summary !== "" ? block("Your story so far", [c.summary]) : "",
    block("Your open commitments (by id)", commitments),
    block("Your plans", plans),
    block("What you remember", memoryLines(scope, c)),
    block("Pinned lore", pinnedLines(scope, "memory")),
    recentBlock(scope, recentChat(scope)),
    block("The turn just written", written.filter((l) => l !== "")),
  ]
    .filter((p) => p !== "")
    .join("\n\n");
}

/** The user message of a `consolidate` call: the summary, the lore pinned to the consolidation step, the recent chat while minds read it, and the notes to fold into it. */
export function consolidateContext(scope: Pick<MindScope, "reg" | "state" | "world" | "who" | "reads" | "pinned" | "hideJson" | "history">, notes: readonly { text: string; at: number }[]): string {
  const c = readCharacter(scope.state, scope.who);
  const cal = calendarOf(scope.world);
  return [`You are ${nameOf(scope, scope.who)}.`, block("Your summary", [c.summary !== "" ? c.summary : "(none yet)"]), block("Pinned lore", pinnedLines(scope, "consolidate")), recentBlock(scope, recentChat(scope)), block("Older notes to fold in", notes.map((n) => `- ${formatClock(cal, n.at)}: ${n.text}`))].filter((p) => p !== "").join("\n\n");
}
