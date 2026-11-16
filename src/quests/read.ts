// What an agent reads of the quests (plan §8.3, §6.8): world_query at the quests' level gives one line of data per quest, and at one quest
// (by name, id or ref) its record whole: what it is, every stage with its condition as written, its state and the reason of the call,
// who and where, stakes and rewards, its visibility and sources, its thread, the beats that moved it, and, for a stage the world
// defines, what the world authored for it. Also world_search's words over the quests. Code matches words and judges none, and applies
// nothing the world authored: an agent lands rewards as ordinary operations.

import type { JsonObject, JsonValue } from "../shared/json";
import type { StageDef, TrackDef } from "../shared/world";
import type { StoryItemDoc } from "../story/fold";
import { type QuestDoc, type QuestSlice, type QuestStageView, type QuestView, questViews, seenOf } from "./record";
import type { QuestHolder } from "./holders";
import type { QuestsSettings } from "./settings";
import { questEvents, threadClosedAt } from "./thread";

const spaced = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
const wordsOf = (s: string): string[] =>
  spaced(s)
    .replace(/['’]s\b/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== "");

/** A quest's ref in the tree: `quest:<id>`; a stage of it is `quest:<id>/<stage>`. */
export const questRef = (id: string): string => `quest:${id}`;
export const stageRef = (quest: string, stage: string): string => `quest:${quest}/${stage}`;

/** The quest a ref, id or name stands for: the world's or one opened in play; or the quests nearest the words. */
export type QuestFound = { quest: QuestView } | { near: string[] };

export function findQuestView(views: readonly QuestView[], said: string, limit = 5): QuestFound {
  const trimmed = said.trim();
  const bare = trimmed.replace(/^(?:quest|track):/, "");
  const byId = views.find((q) => q.id === bare || q.id.toLowerCase() === bare.toLowerCase());
  if (byId !== undefined) return { quest: byId };
  const named = views.filter((q) => spaced(q.name) === spaced(bare));
  if (named.length === 1 && named[0] !== undefined) return { quest: named[0] };
  const asked = wordsOf(bare);
  const byWords = asked.length === 0 ? [] : views.filter((q) => asked.every((w) => wordsOf(q.name).includes(w)));
  if (byWords.length === 1 && byWords[0] !== undefined) return { quest: byWords[0] };
  // Never none while any quest exists: those that share a word with the words, then the rest.
  const near = [...views].sort((a, b) => Number(asked.some((w) => wordsOf(b.name).includes(w))) - Number(asked.some((w) => wordsOf(a.name).includes(w))));
  return { near: near.slice(0, limit).map((q) => q.name) };
}

/** The ref of the quest a name, id or ref stands for, in the world's tracks and those opened in play; null when it names none. */
export function questRefOf(tracks: Readonly<Record<string, TrackDef>>, slice: Readonly<QuestSlice>, said: string): string | null {
  const found = findQuestView(questViews(tracks, slice), said);
  return "quest" in found ? questRef(found.quest.id) : null;
}

/** The stage of a quest a ref, id or label stands for: by its id or `quest:<id>/<stage>` within the quest, or by its label; or the quest's stages. */
export type StageFound = { stage: QuestStageView } | { stages: string[] };

export function findStage(view: QuestView, said: string): StageFound {
  const trimmed = said.trim();
  const bare = trimmed.startsWith(`quest:${view.id}/`) ? trimmed.slice(`quest:${view.id}/`.length) : trimmed;
  const byId = view.stages.find((s) => s.id === bare);
  if (byId !== undefined) return { stage: byId };
  const byLabel = view.stages.filter((s) => spaced(s.label) === spaced(bare) || spaced(s.id) === spaced(bare));
  if (byLabel.length === 1 && byLabel[0] !== undefined) return { stage: byLabel[0] };
  return { stages: view.stages.map((s) => `${s.label} [${s.id}]`) };
}

/** What the world authored for a stage, as data: its effects, rewards, gate, failure, truth, cue, answer and hints; none left out that it holds. */
export function authoredOf(stage: StageDef): JsonObject {
  const out: JsonObject = {};
  if (stage.effects !== undefined && stage.effects.length > 0) out.effects = stage.effects as unknown as JsonValue;
  if (stage.rewards !== undefined && stage.rewards.length > 0) out.rewards = stage.rewards as unknown as JsonValue;
  if (stage.gate !== undefined) out.gate = stage.gate as unknown as JsonValue;
  if (stage.fail !== undefined) out.fail = stage.fail as unknown as JsonValue;
  if (stage.truth !== undefined) out.truth = stage.truth;
  if (stage.cue !== undefined) out.cue = stage.cue;
  if (stage.answer !== undefined) out.answer = stage.answer as unknown as JsonValue;
  if (stage.hints !== undefined && stage.hints.length > 0) out.hints = stage.hints;
  if (stage.priority !== undefined) out.priority = stage.priority;
  if (stage.next.length > 0) out.next = stage.next.map((n) => ({ to: n.to, when: n.when as unknown as JsonValue }));
  return out;
}

/** One quest of the quests' level: its id and ref, kind, name, whether it is open, and where it stands. */
export function questLine(view: QuestView, open: boolean, standing: Readonly<Record<string, string>>, extra: JsonObject = {}): JsonObject {
  const at = view.world ? standing[view.id] : undefined;
  const stage = at === undefined ? undefined : view.stages.find((s) => s.id === at);
  return { quest: view.id, ref: questRef(view.id), name: view.name, kind: view.kind, world: view.world, open, ...extra, ...(stage !== undefined ? { at: { stage: stage.id, label: stage.label } } : {}), ...(view.closed !== null ? { closed: { outcome: view.closed.outcome, ...(view.closed.why !== null ? { why: view.closed.why } : {}) } } : {}) };
}

/** What `world_query` reads at one quest. */
export interface QuestReadInput {
  view: QuestView;
  open: boolean;
  /** Where each of the world's tracks stands now. */
  standing: Readonly<Record<string, string>>;
  /** The world's own track, where the quest is one the world defines. */
  track: TrackDef | undefined;
  /** The quest as the area keeps it, where the story opened it. */
  doc: QuestDoc | undefined;
  slice: Readonly<QuestSlice>;
  /** The story record's items of the same point of the path: its thread and the beats that moved the quest. */
  items: Readonly<Record<string, StoryItemDoc>>;
  settings: Pick<QuestsSettings, "history">;
  /** The entries bound to the quest as the lore keeps them: each with its aspect. */
  sources: readonly { entry: string; aspect: string; title: string | null }[];
  /** For a quest the world defines, where the engine has it: its status, since when, what its objectives hold, the hints earned and opened and the truths revealed. */
  engine: JsonObject;
  /** The characters whose knowledge names the quest or one of its stages (the cast's), with what they hold. */
  holders: readonly QuestHolder[];
  /** The message number a turn's reply lies at, for a beat's place in the chat; null when it is not on the path. */
  messageOf(item: StoryItemDoc): number | null;
}

/** The beats that moved a quest, newest first: the setting's number of them with a count of the rest. */
export function historyOfQuest(items: Readonly<Record<string, StoryItemDoc>>, quest: string, limit: number, messageOf: (item: StoryItemDoc) => number | null): { items: JsonObject[]; more: number } {
  const ref = questRef(quest);
  const beats = Object.values(items).filter((i) => i.part === "beat" && !i.dropped && Array.isArray(i.fields.quest_refs) && i.fields.quest_refs.includes(ref));
  const newest = beats.slice().reverse();
  return { items: newest.slice(0, limit).map((b): JsonObject => ({ beat: b.id, text: typeof b.fields.text === "string" ? b.fields.text : null, message: messageOf(b), turn: b.opened })), more: Math.max(0, newest.length - limit) };
}

/** A quest's record whole, as `world_query` answers it. */
export function questRead(i: QuestReadInput): JsonObject {
  const { view } = i;
  const thread = view.thread === null ? undefined : i.items[view.thread];
  const closedThread = thread === undefined ? null : threadClosedAt(thread);
  const seen = seenOf(view, false);
  const stages = view.stages.map((s): JsonObject => {
    const authored = i.track !== undefined && Object.hasOwn(i.track.stages, s.id) ? authoredOf(i.track.stages[s.id] as StageDef) : undefined;
    return {
      stage: s.id,
      ref: stageRef(view.id, s.id),
      label: s.label,
      condition: s.condition,
      world: s.world,
      state: s.call?.state ?? null,
      why: s.call?.why ?? null,
      ...(view.world ? { current: i.standing[view.id] === s.id } : {}),
      ...(authored !== undefined && Object.keys(authored).length > 0 ? { authored } : {}),
    };
  });
  return {
    quest: view.id,
    ref: questRef(view.id),
    name: view.name,
    kind: view.kind,
    world: view.world,
    open: i.open,
    objective: view.objective,
    why: view.why,
    stakes: view.stakes,
    rewards: view.rewards,
    stages,
    who: view.who,
    where: view.where,
    things: view.things,
    ...i.engine,
    visibility: view.visibility,
    shown: view.shown,
    player_sees: seen.whole ? "all" : seen.stages.length > 0 ? [...seen.stages] : "none",
    closed: view.closed === null ? null : { outcome: view.closed.outcome, why: view.closed.why },
    sources: i.sources.map((s) => ({ entry: s.entry, aspect: s.aspect, title: s.title })),
    holders: i.holders.map((h) => ({ character: h.character, name: h.name, text: h.text, stage: h.stage })),
    thread: thread === undefined ? null : { id: thread.id, text: typeof thread.fields.text === "string" ? thread.fields.text : null, state: thread.closedBy === null ? "open" : "closed", ...(closedThread !== null ? { closed_at: closedThread.turn } : {}) },
    history: historyOfQuest(i.items, view.id, i.settings.history, i.messageOf) as unknown as JsonValue,
    events: i.doc === undefined ? [] : (questEvents(i.doc, i.slice, thread).map((e) => ({ turn: e.turn, what: e.what })) as unknown as JsonValue),
  };
}

/** The quests whose name, objective, why, stakes or any stage's label or condition holds every one of the words; their names and refs, and what the words matched. */
export function searchQuests(views: readonly QuestView[], words: string): { ref: string; name: string; what: string; matched: string }[] {
  const asked = wordsOf(words);
  if (asked.length === 0) return [];
  const out: { ref: string; name: string; what: string; matched: string }[] = [];
  for (const q of views) {
    const fields: [string, string | null][] = [
      ["its name", q.name],
      ["its objective", q.objective],
      ["why it matters", q.why],
      ["its stakes", q.stakes],
      ["its rewards", q.rewards],
      ...q.stages.flatMap((s): [string, string][] => [[`stage ${s.label}`, s.label], [`stage ${s.label}`, s.condition]]),
    ];
    const held = new Set(fields.flatMap(([, text]) => (text === null ? [] : wordsOf(text))));
    if (!asked.every((w) => held.has(w))) continue;
    const matched = fields.find(([, text]) => text !== null && asked.some((w) => wordsOf(text).includes(w)))?.[0] ?? "its name";
    out.push({ ref: questRef(q.id), name: q.name, what: q.kind, matched });
  }
  return out;
}

/** Every quest at a point of the path: the world's tracks and those opened in play. */
export function allQuests(tracks: Readonly<Record<string, TrackDef>>, slice: Readonly<QuestSlice>): QuestView[] {
  return questViews(tracks, slice);
}
