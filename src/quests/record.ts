// The quests as an area of the store (plan §6.2, §6.5, §8.3, Appendix B "Quests"): a quest the story opens, and the parts written to it
// as the story goes on, are changes of the area, `quest.<op>`, folded along the path with the engine's: a swipe or a delete takes a
// turn's writes off the path with the turn, a branch has those of the turns it shares, and one is undone by the area's own reverse.
// A quest is a record: its kind and name, what it is (the objective and why it matters), its stages each with its condition in
// words, who and where and what it involves, its stakes and rewards, and the thread of the story it belongs to. The world's own
// tracks are records of the same kind (`questViews`), the world's labels and conditions as the world wrote them, marked as the
// world's, with the chat's own writes over them. Code folds and counts; it never judges what a quest says.

import type { JsonObject, JsonValue } from "../shared/json";
import { hasOwn, isRecord } from "../shared/json";
import type { TrackKind, TrackDef } from "../shared/world";
import { objectiveLabel, trackOwner } from "../shared/world";
import type { Visibility } from "../shared/ids";
import type { AreaChange, AreaOp, AreaOutcome, AreaPart, StoreArea, StoreState } from "../store";

/** The area's name: its operations are `quest.<op>`. */
export const QUEST_AREA_ID = "quest";

/** The operations of the area, by their names in the changes. */
export const QUEST_OPS = {
  /** A quest opened: `{ quest, kind, name, thread?, visibility? }`. */
  open: "quest.open",
  /** What it is: `{ quest, objective?, why? }`. */
  what: "quest.what",
  /** What failing and succeeding bring: `{ quest, stakes?, rewards? }`. */
  stakes: "quest.stakes",
  /** The thread of the story it belongs to: `{ quest, thread }`, `thread` null for none. */
  thread: "quest.thread",
  /** A stage written, changed or taken out: `{ quest, stage, label?, condition?, after?, drop? }`. */
  stage: "quest.stage",
  /** Who, where and what it involves, bound or unbound: `{ quest, who?, where?, things?, unbind? }`. */
  bind: "quest.bind",
  /** What undoes one: `{ quest, fields }` puts the fields back as they were, or, with `fields` null, takes the quest away. */
  restore: "quest.restore",
} as const;

export const QUEST_KINDS: readonly TrackKind[] = ["quest", "secret", "puzzle", "agenda"];

/** A stage as a quest keeps it: its label and the condition that moves the quest past it, in words. */
export interface QuestStageDoc {
  id: string;
  label: string;
  condition: string;
}

/** One write of a quest as it keeps it: the turn that made it (and that turn's number on the path), who, which operation, and what it said. */
export interface QuestRowDoc {
  turn: string;
  n: number;
  by: string | null;
  op: string;
  value: JsonObject;
}

/** A quest as the slice keeps it. */
export interface QuestDoc {
  id: string;
  kind: TrackKind;
  name: string;
  objective: string | null;
  why: string | null;
  stakes: string | null;
  rewards: string | null;
  /** The id of the story-record thread it belongs to. */
  thread: string | null;
  visibility: Visibility | null;
  stages: QuestStageDoc[];
  who: string[];
  where: string[];
  things: string[];
  opened: string;
  touched: string;
  by: string | null;
  rows: QuestRowDoc[];
}

/** The area's slice of the state. */
export interface QuestSlice {
  /** The quests opened in play, in the order they were opened. */
  quests: Record<string, QuestDoc>;
}

export function emptyQuests(): QuestSlice {
  return { quests: {} };
}

/** The quests' slice of a folded state; the starting one where the state holds none. */
export function questSliceOf(state: Pick<StoreState, "areas">): QuestSlice {
  const slice = state.areas?.[QUEST_AREA_ID] as unknown as QuestSlice | undefined;
  return slice ?? emptyQuests();
}

function asSlice(slice: Readonly<JsonObject>): QuestSlice {
  return slice as unknown as QuestSlice;
}

function json(slice: QuestSlice): JsonObject {
  return slice as unknown as JsonObject;
}

/** The id the first change of a new quest gives it. */
export function newQuestId(firstChange: number): string {
  return `q-${firstChange}`;
}

const text = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";
const nameList = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);

function named(value: JsonValue, what: string): string | null {
  if (!isRecord(value)) return `${what} is an object`;
  if (!text(value.quest)) return `${what} names its quest`;
  return null;
}

/** The quest a change names; the quest it was before, or none where it is not there. */
function known(slice: QuestSlice, value: JsonValue): QuestDoc | undefined {
  const id = (value as { quest: string }).quest;
  return hasOwn(slice.quests, id) ? slice.quests[id] : undefined;
}

function noQuest(value: JsonValue): AreaOutcome {
  return { applied: false, reports: [{ code: "no_quest", values: { quest: (value as { quest: string }).quest } }] };
}

/** `doc` after one more write: its fields set, the turn that touched it and the write kept as its newest row. Nothing of `doc` is changed. */
function written(doc: QuestDoc, change: AreaChange, op: string, set: Partial<QuestDoc>): QuestDoc {
  return { ...doc, ...set, touched: change.turn, rows: [...doc.rows, { turn: change.turn, n: change.n, by: change.by, op, value: change.value as JsonObject }] };
}

function put(slice: QuestSlice, doc: QuestDoc): AreaOutcome {
  return { slice: json({ ...slice, quests: { ...slice.quests, [doc.id]: doc } }) };
}

/** The operations that put back the fields of `doc` a write set, as they stood before it. */
function backTo(value: JsonValue, before: QuestSlice, fields: readonly (keyof QuestDoc)[]): { op: string; value: JsonValue }[] | null {
  const was = known(before, value);
  if (was === undefined) return null;
  const set: JsonObject = {};
  for (const f of fields) set[f] = was[f] as unknown as JsonValue;
  return [{ op: "restore", value: { quest: was.id, fields: set } }];
}

const OPEN: AreaOp = {
  check(value) {
    const bad = named(value, "an opened quest");
    if (bad !== null) return bad;
    const v = value as JsonObject;
    if (!(QUEST_KINDS as readonly unknown[]).includes(v.kind)) return `a quest's kind is one of ${QUEST_KINDS.join(", ")}`;
    if (!text(v.name)) return "an opened quest has a name";
    if (v.thread !== undefined && !text(v.thread)) return "a quest's thread is the id of a thread";
    if (v.visibility !== undefined && v.visibility !== "public" && v.visibility !== "known_by" && v.visibility !== "secret") return "a quest's visibility is public, known_by or secret";
    return null;
  },
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const v = change.value as { quest: string; kind: TrackKind; name: string; thread?: string; visibility?: Visibility };
    if (known(s, change.value) !== undefined) return { applied: false, reports: [{ code: "quest_exists", values: { quest: v.quest } }] };
    const doc: QuestDoc = {
      id: v.quest,
      kind: v.kind,
      name: v.name.trim(),
      objective: null,
      why: null,
      stakes: null,
      rewards: null,
      thread: v.thread ?? null,
      visibility: v.visibility ?? null,
      stages: [],
      who: [],
      where: [],
      things: [],
      opened: change.turn,
      touched: change.turn,
      by: change.by,
      rows: [{ turn: change.turn, n: change.n, by: change.by, op: "open", value: v as unknown as JsonObject }],
    };
    return put(s, doc);
  },
  touches: (value) => [{ ref: `quest:${(value as { quest: string }).quest}`, part: "open" }],
  // What the open made is taken away again.
  undo: (value) => [{ op: "restore", value: { quest: (value as { quest: string }).quest, fields: null } }],
};

const WHAT: AreaOp = {
  check(value) {
    const bad = named(value, "a write of what a quest is");
    if (bad !== null) return bad;
    const v = value as JsonObject;
    if (v.objective === undefined && v.why === undefined) return "what a quest is holds its objective, why it matters, or both";
    if ((v.objective !== undefined && !text(v.objective)) || (v.why !== undefined && !text(v.why))) return "the objective and why it matters are words";
    return null;
  },
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const doc = known(s, change.value);
    if (doc === undefined) return noQuest(change.value);
    const v = change.value as { objective?: string; why?: string };
    return put(s, written(doc, change, "what", { ...(v.objective !== undefined ? { objective: v.objective } : {}), ...(v.why !== undefined ? { why: v.why } : {}) }));
  },
  touches: (value) => (["objective", "why"] as const).filter((p) => hasOwn(value as JsonObject, p)).map((part): AreaPart => ({ ref: `quest:${(value as { quest: string }).quest}`, part })),
  undo: (value, before) => backTo(value, asSlice(before), (["objective", "why"] as const).filter((p) => hasOwn(value as JsonObject, p))),
};

const STAKES: AreaOp = {
  check(value) {
    const bad = named(value, "a write of a quest's stakes");
    if (bad !== null) return bad;
    const v = value as JsonObject;
    if (v.stakes === undefined && v.rewards === undefined) return "a quest's stakes hold what failing costs, what succeeding brings, or both";
    if ((v.stakes !== undefined && !text(v.stakes)) || (v.rewards !== undefined && !text(v.rewards))) return "the stakes and the rewards are words";
    return null;
  },
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const doc = known(s, change.value);
    if (doc === undefined) return noQuest(change.value);
    const v = change.value as { stakes?: string; rewards?: string };
    return put(s, written(doc, change, "stakes", { ...(v.stakes !== undefined ? { stakes: v.stakes } : {}), ...(v.rewards !== undefined ? { rewards: v.rewards } : {}) }));
  },
  touches: (value) => (["stakes", "rewards"] as const).filter((p) => hasOwn(value as JsonObject, p)).map((part): AreaPart => ({ ref: `quest:${(value as { quest: string }).quest}`, part })),
  undo: (value, before) => backTo(value, asSlice(before), (["stakes", "rewards"] as const).filter((p) => hasOwn(value as JsonObject, p))),
};

const THREAD: AreaOp = {
  check(value) {
    const bad = named(value, "a write of a quest's thread");
    if (bad !== null) return bad;
    const v = value as JsonObject;
    if (v.thread !== null && !text(v.thread)) return "a quest's thread is the id of a thread, or null for none";
    return null;
  },
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const doc = known(s, change.value);
    if (doc === undefined) return noQuest(change.value);
    return put(s, written(doc, change, "thread", { thread: (change.value as { thread: string | null }).thread }));
  },
  touches: (value) => [{ ref: `quest:${(value as { quest: string }).quest}`, part: "thread" }],
  undo: (value, before) => backTo(value, asSlice(before), ["thread"]),
};

const STAGE: AreaOp = {
  check(value) {
    const bad = named(value, "a write of a stage");
    if (bad !== null) return bad;
    const v = value as JsonObject;
    if (!text(v.stage)) return "a stage write names its stage";
    if (v.drop !== undefined && v.drop !== true) return "a stage is taken out with drop: true";
    for (const f of ["label", "condition"]) if (v[f] !== undefined && typeof v[f] !== "string") return `a stage's ${f} is words`;
    if (v.after !== undefined && v.after !== null && !text(v.after)) return "a stage is placed after another by its id, or first with null";
    return null;
  },
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const doc = known(s, change.value);
    if (doc === undefined) return noQuest(change.value);
    const v = change.value as { stage: string; label?: string; condition?: string; after?: string | null; drop?: true };
    const at = doc.stages.findIndex((x) => x.id === v.stage);
    if (v.drop === true) {
      if (at < 0) return { applied: false, reports: [{ code: "no_stage", values: { quest: doc.id, stage: v.stage } }] };
      return put(s, written(doc, change, "stage", { stages: doc.stages.filter((x) => x.id !== v.stage) }));
    }
    if (at < 0 && v.label === undefined) return { applied: false, reports: [{ code: "stage_needs_label", values: { quest: doc.id, stage: v.stage } }] };
    const was = at < 0 ? { id: v.stage, label: "", condition: "" } : (doc.stages[at] as QuestStageDoc);
    const stage: QuestStageDoc = { id: v.stage, label: v.label ?? was.label, condition: v.condition ?? was.condition };
    const rest = doc.stages.filter((x) => x.id !== v.stage);
    // Where it stands: where it was, unless `after` places it (first, or after the stage named); a new one goes last.
    let place = at < 0 ? rest.length : at;
    if (v.after === null) place = 0;
    else if (v.after !== undefined) {
      const after = rest.findIndex((x) => x.id === v.after);
      if (after < 0) return { applied: false, reports: [{ code: "no_stage", values: { quest: doc.id, stage: v.after } }] };
      place = after + 1;
    }
    return put(s, written(doc, change, "stage", { stages: [...rest.slice(0, place), stage, ...rest.slice(place)] }));
  },
  touches: (value) => [{ ref: `quest:${(value as { quest: string }).quest}`, part: `stage:${(value as { stage: string }).stage}` }],
  undo: (value, before) => backTo(value, asSlice(before), ["stages"]),
};

const BIND_LISTS = ["who", "where", "things"] as const;

const BIND: AreaOp = {
  check(value) {
    const bad = named(value, "a binding");
    if (bad !== null) return bad;
    const v = value as JsonObject;
    if (BIND_LISTS.every((l) => v[l] === undefined)) return "a binding names who, where or things";
    if (!BIND_LISTS.every((l) => v[l] === undefined || nameList(v[l]))) return "who, where and things are lists of ids";
    if (v.unbind !== undefined && typeof v.unbind !== "boolean") return "unbind is true or false";
    return null;
  },
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const doc = known(s, change.value);
    if (doc === undefined) return noQuest(change.value);
    const v = change.value as { who?: string[]; where?: string[]; things?: string[]; unbind?: boolean };
    const set: Partial<QuestDoc> = {};
    for (const l of BIND_LISTS) {
      const named_ = v[l];
      if (named_ === undefined) continue;
      set[l] = v.unbind === true ? doc[l].filter((x) => !named_.includes(x)) : [...doc[l], ...named_.filter((x, i) => !doc[l].includes(x) && named_.indexOf(x) === i)];
    }
    return put(s, written(doc, change, "bind", set));
  },
  touches: (value) => BIND_LISTS.filter((l) => hasOwn(value as JsonObject, l)).map((part): AreaPart => ({ ref: `quest:${(value as { quest: string }).quest}`, part })),
  undo: (value, before) => backTo(value, asSlice(before), BIND_LISTS.filter((l) => hasOwn(value as JsonObject, l))),
};

const RESTORE: AreaOp = {
  check(value) {
    const bad = named(value, "a restore of a quest");
    if (bad !== null) return bad;
    const fields = (value as JsonObject).fields;
    return fields === null || isRecord(fields) ? null : "a restore holds the fields it puts back, or null to take the quest away";
  },
  apply(slice, change): AreaOutcome {
    const s = asSlice(slice);
    const doc = known(s, change.value);
    if (doc === undefined) return noQuest(change.value);
    const fields = (change.value as { fields: JsonObject | null }).fields;
    if (fields === null) {
      const { [doc.id]: _taken, ...rest } = s.quests;
      return { slice: json({ ...s, quests: rest }) };
    }
    return put(s, written(doc, change, "restore", fields as unknown as Partial<QuestDoc>));
  },
  touches: (value) => {
    const fields = (value as { quest: string; fields: JsonObject | null }).fields;
    return (fields === null ? ["open"] : Object.keys(fields)).map((part): AreaPart => ({ ref: `quest:${(value as { quest: string }).quest}`, part }));
  },
};

/** A quest, by its id or its name (spaces and case ignored); undefined where none has it. */
export function findQuest(slice: Readonly<QuestSlice>, words: string): QuestDoc | undefined {
  const asked = words.trim();
  if (hasOwn(slice.quests, asked)) return slice.quests[asked];
  const key = asked.toLowerCase().replace(/\s+/g, " ");
  return Object.values(slice.quests).find((q) => q.name.toLowerCase().replace(/\s+/g, " ") === key);
}

const READS: NonNullable<StoreArea["reads"]> = {
  /** Every quest opened in play: `[QuestDoc]`, in the order opened. */
  quests: (slice) => Object.values(asSlice(slice).quests) as unknown as JsonValue,
  /** One quest by id or name: `QuestDoc`, null where none has it. Takes `{ quest }`. */
  quest: (slice, args) => (findQuest(asSlice(slice), typeof args.quest === "string" ? args.quest : "") ?? null) as unknown as JsonValue,
};

/** The quests' area, as the store opens with it. */
export const QUEST_STORE_AREA: StoreArea = {
  id: QUEST_AREA_ID,
  initial: () => json(emptyQuests()),
  ops: { open: OPEN, what: WHAT, stakes: STAKES, thread: THREAD, stage: STAGE, bind: BIND, restore: RESTORE },
  reads: READS,
};

/** A quest as it is read, whether the world defined it or the story opened it. */
export interface QuestView {
  id: string;
  kind: TrackKind;
  name: string;
  /** The world defined it: its labels and conditions are as the world wrote them. */
  world: boolean;
  visibility: Visibility | null;
  objective: string | null;
  why: string | null;
  stakes: string | null;
  rewards: string | null;
  thread: string | null;
  stages: (QuestStageDoc & { world: boolean })[];
  who: string[];
  where: string[];
  things: string[];
}

/**
 * A track the world defines as a record of the same kind as a quest opened in play: its name and kind, its owner as a who binding
 * (none for the GM's own), and each stage with the world's label and, as its condition, the objectives' labels, else the
 * conditions to the next stages, as the world wrote them.
 */
export function trackAsQuest(def: TrackDef): QuestView {
  const owner = trackOwner(def);
  return {
    id: def.id,
    kind: def.kind,
    name: def.label,
    world: true,
    visibility: def.visibility,
    objective: null,
    why: null,
    stakes: null,
    rewards: null,
    thread: null,
    stages: Object.entries(def.stages).map(([id, s]) => ({ id, label: s.label, condition: (s.objectives !== undefined && s.objectives.length > 0 ? s.objectives.map(objectiveLabel) : s.next.map((n) => n.when)).join("; "), world: true })),
    who: owner === undefined ? [] : [owner],
    where: [],
    things: [],
  };
}

function viewOf(doc: QuestDoc): QuestView {
  return { ...doc, world: false, stages: doc.stages.map((s) => ({ ...s, world: false })) };
}

/** Every quest of the chat: the world's tracks as it defines them, then those opened in play in the order opened. */
export function questViews(tracks: Readonly<Record<string, TrackDef>>, slice: Readonly<QuestSlice>): QuestView[] {
  return [...Object.values(tracks).map(trackAsQuest), ...Object.values(slice.quests).map(viewOf)];
}
