// What the story pages say of what the backend answered (DEPTH2-PLAN §1): Harness → Cast and Record,
// Play → Now's prepared start and Settings → Story. Pure, so the tests read them without a DOM. A
// view names people and places by id with their names beside them (`StoryNames`); "player" is the
// player's character, "world" the world itself.

import { HARNESS_AGENT } from "../../shared/harness-texts";
import type { BeatKind, BeatReach, CastStanding, DraftState, DraftTier } from "../../shared/ledger";
import type { AgentStanding, CharacterRun, ModelPick, StoryModels } from "../../shared/settings";
import { type ModelAsk, type ModelLevel, modelLadder } from "../../shared/story-models";
import type { BeatView, CastRowView, DraftView, ExposureView, PrepareDepth, PrepareState, PrepareView, ReachedItem, StoryNames } from "../../shared/story-pages";
import { humanize } from "../format";

/** Someone's name as a view gives it: the world as itself, an id with no name as written. */
export function nameIn(names: StoryNames, id: string): string {
  if (id === "world") return "The world";
  return names[id] ?? id;
}

/** A list of names: "Mara", "Mara and Dev", "Mara, Dev and Ana". */
export function andList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** When something was written, from now: "just now", "5 minutes ago", "3 hours ago", "4 days ago", else its date. */
export function agoText(at: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return minutes === 1 ? "a minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "an hour ago" : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  return `on ${new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

// ---------------------------------------------------------------- Cast

/** Each standing in the pages' words: its name and what it means. */
export const STANDING_WORDS: Readonly<Record<CastStanding, { label: string; plural: string; help: string }>> = {
  principal: { label: "Principal", plural: "Principals", help: "Has an agent and a mind of their own: they decide what they do, from what reached them." },
  supporting: { label: "Supporting", plural: "Supporting characters", help: "Has a short profile the author keeps, and is voiced by the author." },
  extra: { label: "Extra", plural: "Extras", help: "Has no mind of their own: the author voices them when they're needed." },
};

/** The cast in groups, as the page lists it: the player's character, then principals, supporting characters and extras, each in the story's order. */
export function castGroups(cast: readonly CastRowView[]): { you: CastRowView | null; groups: { standing: CastStanding; rows: CastRowView[] }[] } {
  const you = cast.find((c) => c.entity === "player") ?? null;
  const others = cast.filter((c) => c.entity !== "player");
  const groups = (["principal", "supporting", "extra"] as const).map((standing) => ({ standing, rows: others.filter((c) => c.standing === standing) })).filter((g) => g.rows.length > 0);
  return { you, groups };
}

/** A cast row's line under the name: the standing, the pin, what waits for their mind. */
export function castLine(row: CastRowView): string {
  const parts = [row.entity === "player" ? "Your character" : STANDING_WORDS[row.standing].label, row.pinned ? "pinned by you" : null, row.waiting > 0 ? `${row.waiting} ${row.waiting === 1 ? "beat" : "beats"} not taken in yet` : null];
  return parts.filter((p): p is string => p !== null).join(" · ");
}

// ---------------------------------------------------------------- beats

/** What a beat is, as its line says it. */
export const KIND_WORDS: Readonly<Record<BeatKind, string>> = { say: "said", do: "did", happen: "happened", inner: "thought" };

/** An agent that decided a beat, by its definition's id and whom it ran as. */
export function agentWords(agent: string, as: string | null, names: StoryNames): string {
  switch (agent) {
    case HARNESS_AGENT.author:
      return "the author";
    case HARNESS_AGENT.gm:
      return "the game master";
    case HARNESS_AGENT.narrator:
      return "the narrator";
    case HARNESS_AGENT.historian:
      return "the historian";
    case HARNESS_AGENT.character:
      return as !== null ? `${nameIn(names, as)}'s own agent` : "a character's agent";
    default:
      return humanize(agent).toLowerCase();
  }
}

/** How fully a beat reached someone, in words. */
export const REACH_WORDS: Readonly<Record<BeatReach, string>> = { whole: "all of it", part: "part of it", told: "told of it" };

/** One line of whom a beat reached: who, how fully, and what they got of it where that isn't all. */
export function exposureLine(e: ExposureView, names: StoryNames): { who: string; how: string; got: string | null } {
  const who = nameIn(names, e.who);
  const how = e.reach === "told" ? (e.from !== null ? `told by ${nameIn(names, e.from)}` : "told of it") : REACH_WORDS[e.reach];
  return { who, how, got: e.reach === "whole" ? null : e.got };
}

/** A beat's head: who did it and what kind of thing it was (what the world did reads "In the world"), where and when. */
export function beatHead(beat: BeatView, names: StoryNames): { who: string; kind: string; where: string | null; when: string } {
  const world = beat.by === "world";
  return { who: world ? "In the world" : nameIn(names, beat.by), kind: world ? "" : KIND_WORDS[beat.kind], where: beat.where !== null ? nameIn(names, beat.where) : null, when: beat.time.text };
}

/** One beat as it reached someone, as Cast shows it: how it reached them, where, what they got of it and the words they heard. */
export function reachedText(item: ReachedItem, names: StoryNames): { head: string; text: string; quotes: readonly string[] } {
  const where = item.where !== null ? ` · ${nameIn(names, item.where)}` : "";
  switch (item.reach) {
    case "own":
      return { head: `Their own: they ${KIND_WORDS[item.kind]}${where}`, text: item.what, quotes: item.quotes ?? [] };
    case "whole":
      return { head: `${item.by === "world" ? "From the world" : `From ${nameIn(names, item.by)}`}, all of it${where}`, text: item.surface, quotes: item.quotes ?? [] };
    case "part":
      return { head: `Part of it${where}`, text: item.got, quotes: [] };
    case "told":
      return { head: `${item.from !== undefined ? `Told by ${nameIn(names, item.from)}` : "Told of it"}${where}`, text: item.got, quotes: [] };
  }
}

/** Whom a beat reached, in a line, for its collapsed card. */
export function reachedLine(beat: BeatView, names: StoryNames): string {
  if (beat.kind === "inner") return `Reached no one: a thought of ${nameIn(names, beat.by)}'s own`;
  if (beat.exposure.length === 0) return "Reached no one";
  return `Reached ${andList(beat.exposure.map((e) => nameIn(names, e.who)))}`;
}

// ---------------------------------------------------------------- drafts

/** Each tier of treatment in the pages' words. */
export const TIER_WORDS: Readonly<Record<DraftTier, { short: string; long: string }>> = {
  1: { short: "T1", long: "The characters live it, with the author and the game master running it." },
  2: { short: "T2", long: "The author plays every part, round a campfire, steering." },
  3: { short: "T3", long: "The author and the game master decide it, and brief the characters." },
  4: { short: "T4", long: "The author just writes it." },
};

/** Each draft's state in the pages' words. */
export const DRAFT_STATE_WORDS: Readonly<Record<DraftState, string>> = { open: "Waiting", settled: "Played", dropped: "Dropped", stale: "Out of date" };

/** The drafts as the page lists them: waiting ones first, soonest first; then the rest, latest first. */
export function draftsInOrder(drafts: readonly DraftView[]): DraftView[] {
  const open = drafts.filter((d) => d.state === "open").sort((a, b) => a.time.at - b.time.at);
  const rest = drafts.filter((d) => d.state !== "open").sort((a, b) => b.time.at - a.time.at);
  return [...open, ...rest];
}

// ---------------------------------------------------------------- models

/** Each level of the model ladder in the pages' words, most specific first. */
export const LEVEL_WORDS: Readonly<Record<ModelLevel, string>> = { character: "this character", run: "the kind of run", standing: "how it was started", agent: "the agent", default: "the default" };

/** Each agent the story engine runs, as Settings → Story → Models lists it. */
export const STORY_AGENTS: readonly { id: string; label: string; help: string }[] = [
  { id: HARNESS_AGENT.author, label: "The author", help: "Plays each turn: decides how the moment is played, casts, keeps the notebook." },
  { id: HARNESS_AGENT.gm, label: "The game master", help: "Rules on what is contested, and checks each passage against the beats." },
  { id: HARNESS_AGENT.narrator, label: "The narrator", help: "Writes the reply from the beats, in your preset's voice." },
  { id: HARNESS_AGENT.character, label: "Characters", help: "Each principal's own agent: their choices, their mind, their words on the direct line." },
  { id: HARNESS_AGENT.historian, label: "The historian", help: "Reads the chat's past when the story is prepared, and records it as beats." },
];

/** How an agent stands in its run, in the pages' words. */
export const STANDING_RUN_WORDS: Readonly<Record<AgentStanding, { label: string; help: string }>> = {
  turn: { label: "Started by the turn", help: "An agent the turn starts itself, such as the author." },
  sub: { label: "Started by another agent", help: "An agent another agent hands work to, such as a character the author asks to act." },
  job: { label: "Running after the reply", help: "An agent of a job: taking in, preparing, reliving." },
};

/** A character's kinds of run, in the pages' words. */
export const RUN_WORDS: Readonly<Record<CharacterRun, { label: string; help: string }>> = {
  scene: { label: "In a scene", help: "Acting in a turn, or answering you on the direct line." },
  digest: { label: "Taking in", help: "After the reply: taking in what reached them, before the next turn." },
  prepare: { label: "Preparing", help: "After the reply: getting ready for what may come." },
  relive: { label: "Reliving", help: "While the story is prepared: living the chat's past." },
};

/** The ask a character's agent makes in each kind of run, as LumiAH would ask it (`characterRun` reads it back). */
export function characterAsk(entity: string, run: CharacterRun): ModelAsk {
  const definition = HARNESS_AGENT.character;
  switch (run) {
    case "scene":
      return { definition, as: entity, standing: "sub", job: null };
    case "digest":
      return { definition, as: entity, standing: "job", job: { basis: "turn", due: "next_turn" } };
    case "prepare":
      return { definition, as: entity, standing: "job", job: { basis: "turn" } };
    case "relive":
      return { definition, as: entity, standing: "job", job: { basis: null } };
  }
}

/** What an agent's ask runs on (`pick`), and the level of the ladder that picked each member; null where no level picks it, so it is the agent's own. */
export interface PickedBy {
  connection: ModelLevel | null;
  model: ModelLevel | null;
  effort: ModelLevel | null;
  pick: ModelPick;
}

/** What an agent's ask runs on, member by member, and which level of the ladder picked each. */
export function pickedBy(models: StoryModels, ask: ModelAsk): PickedBy {
  const ladder = modelLadder(models, ask);
  const first = (member: keyof ModelPick) => ladder.find((l) => l.pick[member] !== undefined) ?? null;
  const connection = first("connectionId");
  const model = first("model");
  const effort = first("effort");
  return {
    connection: connection?.level ?? null,
    model: model?.level ?? null,
    effort: effort?.level ?? null,
    pick: { ...(connection?.pick.connectionId !== undefined ? { connectionId: connection.pick.connectionId } : {}), ...(model?.pick.model !== undefined ? { model: model.pick.model } : {}), ...(effort?.pick.effort !== undefined ? { effort: effort.pick.effort } : {}) },
  };
}

/** Whether a level picks anything. */
export function picksAny(pick: ModelPick | undefined): boolean {
  return pick !== undefined && (pick.connectionId !== undefined || pick.model !== undefined || pick.effort !== undefined);
}

// ---------------------------------------------------------------- the budget

/** A stretch of story time in words: "1 day", "12 hours", "90 minutes". */
export function stretchText(minutes: number): string {
  if (minutes % 1440 === 0) return minutes === 1440 ? "1 day" : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** The stretches the budget page offers, in minutes: from an hour to a year of story time. */
export const STRETCH_CHOICES: readonly number[] = [60, 360, 720, 1440, 2880, 4320, 10080, 20160, 43200, 525600];

// ---------------------------------------------------------------- the prepared start

/** Each state of the prepared start, as Play → Now says it. */
export const PREPARE_STATE_WORDS: Readonly<Record<PrepareState, { title: string; tone: "info" | "warn" | "neg" }>> = {
  none: { title: "Prepare this story", tone: "info" },
  planning: { title: "The author is planning", tone: "info" },
  revising: { title: "The author is revising its plan", tone: "info" },
  waiting: { title: "The author's plan waits for you", tone: "warn" },
  running: { title: "Preparing the story", tone: "info" },
  paused: { title: "Preparing is paused", tone: "warn" },
  done: { title: "The story is prepared", tone: "info" },
  cancelled: { title: "Preparing was cancelled", tone: "warn" },
  failed: { title: "Preparing stopped", tone: "neg" },
  unreachable: { title: "The story's preparation can't be reached", tone: "warn" },
};

/** Whether Play → Now shows the prepared start's card: while it's offered or under way, waits, is held, stopped or was cancelled. Once done it goes to a quiet line (`prepareQuiet`); out of reach, to one line saying so. */
export function prepareShown(view: PrepareView | null): boolean {
  if (view === null) return false;
  if (view.offer !== null) return true;
  return view.state === "planning" || view.state === "revising" || view.state === "waiting" || view.state === "running" || view.state === "paused" || view.state === "failed" || view.state === "cancelled";
}

/** Whether Play → Now shows a finished preparation's quiet line, which opens its card again. */
export function prepareQuiet(view: PrepareView | null): boolean {
  return view !== null && view.state === "done";
}

/** Whether the page asks again while it shows: the author or a job is at work. */
export function prepareBusy(state: PrepareState): boolean {
  return state === "planning" || state === "revising" || state === "running";
}

/** A count of tokens in words. */
export function tokensText(tokens: number): string {
  return `${Math.round(tokens).toLocaleString("en-US")} tokens`;
}

/** Each depth a preparation can go to, in the pages' words: the card's choice, and the live view's. */
export const DEPTH_WORDS: Readonly<Record<PrepareDepth, { label: string; help: string }>> = {
  outline: { label: "Outlines only", help: "Every principal knows the past in outline, from the summaries and the lore, with their core. Nothing is relived." },
  key: { label: "Key moments", help: "The outlines, and the few moments that made the story what it is, relived by those who were in them." },
  all: { label: "Everything planned", help: "Every stretch of the plan, relived." },
};

/** What a stretch's state means, in words. */
export const STRETCH_STATE_WORDS: Readonly<Record<"planned" | "open" | "recorded" | "dropped", string>> = { planned: "Planned", open: "Being recorded", recorded: "Relived", dropped: "Filled from summaries" };

/** The cap as typed: a whole number of tokens, none where left empty, or a problem in words. */
export function capOf(text: string): { tokens: number | null } | { problem: string } {
  const t = text.replace(/[,\s_]/g, "");
  if (t === "") return { tokens: null };
  if (!/^\d+$/.test(t)) return { problem: "Write the cap as a whole number of tokens, or leave it empty for none." };
  const tokens = Number(t);
  return tokens > 0 ? { tokens } : { problem: "A cap is more than 0 tokens. Leave it empty for none." };
}
