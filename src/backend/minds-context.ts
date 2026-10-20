// What one character's mind is given (DESIGN §24.5): only what that character knows. Their own
// entity, their summary, notes, commitments, plans, witness log and last mind; the scene as
// they perceive it and the occasion; their own life (money in plain words, the day, their agendas,
// their own secrets included); lore read as them; and recall by presence: the chat turns they were
// there for, read through the host's chat, the latest and the ones that best match the moment. Never
// the GM view, never another mind, never a turn they weren't present for.

import type { EntityId, MessageId, PlaceId } from "../shared/ids";
import type { MindMoment, MindsCharacter, MindsMemoryConfig } from "../shared/minds";
import type { WorldDoc } from "../shared/world";
import { calendarOf, dateAt, dayPartAt, formatClock, formatHHMM, holidaysOn } from "../engine/calendar";
import { loreSearch } from "../engine/lore";
import { optionalQuery, own } from "../engine/pack-kit";
import type { Registry } from "../engine/registry-impl";
import { fieldDef, isGone, kindIs, placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { agendaFor } from "../engine/tracks";
import { canSeeEntity, knows } from "../engine/visibility";
import { dayPlan } from "../packs/castlife/core/index";
import { faded, openCommitments, openPlans, readCharacter, readSlice, salienceNow } from "../packs/minds/core/state";
import { sectionTokens } from "./book";
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
  /** Tokens the lore read as them may take (the step's lore setting); 0 reads none. */
  loreTokens: number;
}

/** Fields a person's sheet holds that the context says elsewhere or that are the engine's own bookkeeping. */
const SKIPPED_FIELDS: Readonly<Record<string, true>> = { place: true, x: true, y: true, gone: true, needs: true, holds: true, knownBy: true, appointments: true, trips: true, activity: true };

/** The longest a recalled turn's side, or the whole context, may run, in characters. */
const RECALL_SIDE = 1600;
const CONTEXT_MAX = 16_000;

const STOP: Readonly<Record<string, true>> = Object.fromEntries("the and for with that this from into have has had was were are you your they them their there here what when where which who how why just very some more most other then than about would could should will been being does did not but all any can its it's i'm he's she's".split(" ").map((w) => [w, true] as const));

function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => w.length >= 4 && !STOP[w]);
}

/** Text tidied (runs of spaces, and of blank lines, made one), its line breaks kept, and cut at a word to `max` characters. */
function clip(text: string, max: number): string {
  const t = text.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, "")}…`;
}

/** A block of as many of `lines` as fit in `room` characters, whole and in order. */
function blockWithin(title: string, lines: readonly string[], room: number): string {
  const kept: string[] = [];
  let size = title.length + 4;
  for (const line of lines) {
    if (size + line.length + 1 > room) break;
    kept.push(line);
    size += line.length + 1;
  }
  return block(title, kept);
}

/**
 * A context's blocks within `CONTEXT_MAX` characters (DESIGN §24.5), `last` (the moment, or the turn
 * just written) kept whole at the end: each block in turn is cut at a word to the room left, line
 * breaks kept. `room` tells a block made to fit (lore, recall) how much is left before it.
 */
class ContextFit {
  private readonly parts: string[] = [];
  private left: number;
  constructor(private readonly last: string) {
    this.left = CONTEXT_MAX - last.length;
  }
  get room(): number {
    return this.left - 2;
  }
  add(text: string): void {
    if (text === "" || this.room <= 0) return;
    const kept = clip(text, this.room);
    this.parts.push(kept);
    this.left -= kept.length + 2;
  }
  text(): string {
    return [...this.parts, this.last].filter((p) => p !== "").join("\n\n");
  }
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
 * and the `recall.relevant` that share the most words with the moment, oldest first, within
 * `recall.tokens` and `room` characters. A turn is the player's message before the reply and the
 * reply as displayed.
 */
export function recallFor(scope: Pick<MindScope, "state" | "who" | "memory" | "messages" | "hideJson" | "moment">, room = Number.POSITIVE_INFINITY): RecalledTurn[] {
  const { memory, messages } = scope;
  const index = new Map(messages.map((m, i) => [m.id, i]));
  const turns: RecalledTurn[] = [];
  for (const msg of presentTurns(scope.state, scope.who)) {
    const i = index.get(msg);
    const reply = i === undefined ? undefined : messages[i];
    if (i === undefined || !reply || reply.isUser) continue;
    const user = messages.slice(0, i).findLast((m) => m.isUser);
    const said = user ? clip(user.swipes[user.swipeId] ?? user.content, RECALL_SIDE) : "";
    const wrote = clip(readableReply(reply.swipes[reply.swipeId] ?? reply.content, scope.hideJson), RECALL_SIDE);
    if (wrote === "" && said === "") continue;
    turns.push({ msg, text: `${said !== "" ? `Player: ${said}\n` : ""}Story: ${wrote}` });
  }
  const recent = turns.slice(Math.max(0, turns.length - memory.recall.recent));
  const rest = turns.slice(0, Math.max(0, turns.length - memory.recall.recent));
  const wanted = new Set(wordsOf(`${scope.moment.user} ${scope.moment.reply} ${scope.moment.reason}`));
  const scored = rest
    .map((t, i) => ({ t, i, hits: wordsOf(t.text).filter((w) => wanted.has(w)).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.i - a.i)
    .slice(0, memory.recall.relevant);
  const chosen = [...scored.map((x) => x.t), ...recent].sort((a, b) => turns.indexOf(a) - turns.indexOf(b));
  // Within the token budget and the room, the latest turns are kept first, each whole.
  const out: RecalledTurn[] = [];
  let left = memory.recall.tokens;
  let space = room;
  for (const t of [...chosen].reverse()) {
    const cost = sectionTokens(t.text);
    if (cost > left || t.text.length + 1 > space) continue;
    left -= cost;
    space -= t.text.length + 1;
    out.unshift(t);
  }
  return out;
}

/** The occasion: the clock and day part, any holiday today, and the weather over where they are. */
function occasion(scope: MindScope, place: PlaceId | null): string {
  const { reg, world, state } = scope;
  const cal = calendarOf(world);
  const day = dateAt(cal, state.clock).dayIndex;
  const holidays = holidaysOn(cal, day).map((h) => h.label);
  const sky = place ? optionalQuery(reg.context(world, state), "weather.sky")?.(reg.context(world, state), place) : null;
  return `It is ${formatClock(cal, state.clock)} (${dayPartAt(cal, state.clock).label.toLowerCase()})${holidays.length > 0 ? `, ${holidays.join(", ")}` : ""}${sky ? `; the weather: ${sky.replace(/_/g, " ")}` : ""}.`;
}

function sheetLines(scope: MindScope): string[] {
  const { reg, world, state, who } = scope;
  const e = own(state.entities, who);
  if (!e) return [];
  const out: string[] = [];
  for (const [field, value] of Object.entries(e.fields).sort(([a], [b]) => a.localeCompare(b))) {
    if (SKIPPED_FIELDS[field] || value === null || typeof value === "object") continue;
    const label = fieldDef(reg, world, e.kind, field)?.label ?? field.replace(/_/g, " ");
    const shown = typeof value === "string" && own(state.entities, value) ? nameOf(scope, value) : typeof value === "string" && own(world.places, value) ? nameOf(scope, value) : String(value).replace(/_/g, " ");
    out.push(`- ${label}: ${shown}`);
  }
  return out;
}

function lifeLines(scope: MindScope, c: MindsCharacter): string[] {
  const { reg, world, state, who } = scope;
  const ctx = reg.context(world, state);
  const out: string[] = [];
  for (const line of optionalQuery(ctx, "economy.summary")?.(ctx, who).lines ?? []) out.push(`- Money: ${line}`);
  const cal = calendarOf(world);
  try {
    for (const b of dayPlan(ctx, who).blocks.filter((x) => x.end > state.clock).slice(0, 6)) out.push(`- Today ${formatHHMM(dateAt(cal, b.start).minuteOfDay)}–${formatHHMM(dateAt(cal, b.end).minuteOfDay)}: ${b.label}${b.place ? ` (${nameOf(scope, b.place)})` : ""}`);
  } catch {
    // A world without a working day planner (no Cast life) has no day to tell.
  }
  for (const a of agendaFor(world, state, who)) {
    const truth = own(own(world.tracks, a.track)?.stages ?? {}, a.stage)?.truth;
    out.push(`- Your aim, ${a.label}: ${a.stageLabel}${truth ? ` (the truth of it: ${truth})` : ""}`);
  }
  for (const x of openCommitments(c).slice(0, scope.memory.commitments.show)) out.push(`- Commitment (${x.kind}${x.with.length > 0 ? ` with ${x.with.map((id) => nameOf(scope, id)).join(", ")}` : ""}): ${x.text}${x.due !== null ? `, due ${formatClock(cal, x.due)}` : ""}`);
  for (const p of openPlans(c).slice(0, 8)) out.push(`- Plan (${p.kind}): ${p.what}, ${formatClock(cal, p.when.from)} to ${formatHHMM(dateAt(cal, p.when.to).minuteOfDay)}${p.where ? ` at ${nameOf(scope, p.where)}` : ""}${p.with.length > 0 ? ` with ${p.with.map((id) => nameOf(scope, id)).join(", ")}` : ""}`);
  return out;
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

function memoryLines(scope: MindScope, c: MindsCharacter): string[] {
  const { state, memory, world } = scope;
  const cal = calendarOf(world);
  const out: string[] = [];
  const notes = c.notes
    .filter((n) => !faded(n, state.clock, memory))
    .sort((a, b) => salienceNow(b, state.clock, memory) - salienceNow(a, state.clock, memory) || b.at - a.at)
    .slice(0, memory.notes.show);
  for (const n of notes) out.push(`- ${n.text}`);
  const witness = c.witness.slice(Math.max(0, c.witness.length - memory.witness.show));
  for (const w of witness) out.push(`- ${formatClock(cal, w.at)}: ${w.how === "told" ? `told${w.by ? ` by ${nameOf(scope, w.by)}` : ""}: ` : "saw: "}${w.what}`);
  return out;
}

/** Lore read as the character (DESIGN §24.5): public entries, what they know, and their own secrets. */
function loreLines(scope: MindScope, place: PlaceId | null): string[] {
  if (scope.loreTokens <= 0) return [];
  const { reg, world, state, who, moment } = scope;
  const result = loreSearch({ reg, world, state, tokens: sectionTokens }, { query: `${moment.user}\n${moment.reply}\n${moment.reason}`, links: [who, ...(place ? [place] : [])], purpose: "mind", as: who, limit: 6, tokenBudget: scope.loreTokens });
  return result.hits.map((h) => `- ${h.snippet}`);
}

function block(title: string, lines: readonly string[]): string {
  return lines.length > 0 ? `## ${title}\n${lines.join("\n")}` : "";
}

/** The user message of a `mind` call: everything the character knows that bears on the moment. */
export function mindContext(scope: MindScope): string {
  const { world, state, who, moment } = scope;
  const e = own(state.entities, who);
  const c = readCharacter(state, who);
  const place = placeOfEntity(state, who);
  const pov = world.pov;
  const withPov = place !== null && placeOfEntity(state, pov) === place;
  const cal = calendarOf(world);
  const last = c.mind;
  // How the last turn ended is theirs only if they heard it: someone the POV met at its end, or who
  // came in since, wasn't there for what it tells (DESIGN §24.4).
  const said = readSlice(state).presence.findLast((p) => p.msg !== null);
  const heardLast = said === undefined || said.who.includes(who);
  const now =
    moment.kind === "beat"
      ? [`It is ${formatClock(cal, moment.at)}. ${moment.reason}.`]
      : withPov
        ? [heardLast && moment.reply.trim() !== "" ? `The story so far ended: ${clip(readableReply(moment.reply, scope.hideJson), RECALL_SIDE)}` : "", moment.user.trim() !== "" ? `Now ${povLabel(scope)} says or does: ${clip(moment.user, RECALL_SIDE)}` : `${povLabel(scope)} is here with you.`].filter((l) => l !== "")
        : [`You aren't with ${povLabel(scope)} right now; carry on with your own day.`];
  // The moment is never cut: the rest fits in what is left, block by block, then lore and recall,
  // whole entries and whole turns.
  const fit = new ContextFit(block("Now", now.length > 0 && withPov && moment.kind !== "beat" ? [storyVoice(scope), ...now] : now));
  fit.add(`You are ${e?.name ?? who}. ${occasion(scope, place)}`);
  fit.add(block("Who you are", sheetLines(scope)));
  fit.add(c.summary !== "" ? block("Your story so far", [c.summary]) : "");
  fit.add(block("Where you are", sceneLines(scope, place)));
  fit.add(block("Your own life", lifeLines(scope, c)));
  fit.add(block("What you remember, and what you saw or were told", memoryLines(scope, c)));
  fit.add(last ? block(`Your last thoughts (${formatClock(cal, last.at)})`, [last.monologue, last.intent !== "" ? `You meant to: ${last.intent}` : "", last.mood ? `You felt ${last.mood}.` : ""].filter((l) => l !== "")) : "");
  fit.add(blockWithin("What you know of the world", loreLines(scope, place), fit.room));
  const recallTitle = "Turns you were there for (ignore any narration of other people's private thoughts)";
  const voice = storyVoice(scope);
  const recall = recallFor(scope, fit.room - recallTitle.length - voice.length - 6);
  fit.add(block(recallTitle, recall.length > 0 ? [voice, ...recall.map((t) => t.text)] : []));
  return fit.text();
}

/**
 * The user message of a `memory` call: who they are, what they hold, and the turn as it was written.
 * With `left`, the POV left them partway through: what the story tells after that happened without them.
 */
export function memoryContext(scope: MindScope, turn: { user: string; reply: string; left?: boolean }): string {
  const { state, who, world } = scope;
  const c = readCharacter(state, who);
  const cal = calendarOf(world);
  const commitments = openCommitments(c).map((x) => `- [${x.id}] ${x.kind}${x.with.length > 0 ? ` with ${x.with.map((id) => nameOf(scope, id)).join(", ")}` : ""}: ${x.text}`);
  const plans = openPlans(c).map((p) => `- ${p.what} (${formatClock(cal, p.when.from)})`);
  const fit = new ContextFit(block("The turn just written", [storyVoice(scope), turn.left ? `${povLabel(scope)} left you partway through this turn: whatever the story tells after they left happened without you.` : "", turn.user.trim() !== "" ? `${povLabel(scope)} (the player character) wrote: ${clip(turn.user, RECALL_SIDE)}` : "", `Story: ${clip(readableReply(turn.reply, scope.hideJson), RECALL_SIDE * 2)}`].filter((l) => l !== "")));
  fit.add(`You are ${nameOf(scope, who)}. ${occasion(scope, placeOfEntity(state, who))}`);
  fit.add(c.summary !== "" ? block("Your story so far", [c.summary]) : "");
  fit.add(block("Your open commitments (by id)", commitments));
  fit.add(block("Your plans", plans));
  fit.add(block("What you remember", memoryLines(scope, c)));
  return fit.text();
}

/** The user message of a `consolidate` call: the summary and the notes to fold into it. */
export function consolidateContext(scope: Pick<MindScope, "state" | "world" | "who">, notes: readonly { text: string; at: number }[]): string {
  const c = readCharacter(scope.state, scope.who);
  const cal = calendarOf(scope.world);
  return [`You are ${nameOf(scope, scope.who)}.`, block("Your summary", [c.summary !== "" ? c.summary : "(none yet)"]), block("Older notes to fold in", notes.map((n) => `- ${formatClock(cal, n.at)}: ${n.text}`))].filter((p) => p !== "").join("\n\n");
}
