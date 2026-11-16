// Recorded answers of the Cast and Story routes, in the shapes `test/ui/direct.test.ts` holds to the
// routes themselves. Every name and every word is made up.

import type { CharacterReply, EntryCounts, EntryRow, CastReply, CastMemberRow, StoryReply, StoryItemRow, StoryItems } from "../../src/shared/api";

export const CHAT = "chat-lantern";

const none = { held: 0, struck: 0 };
const counts = (over: Partial<EntryCounts>): EntryCounts => ({ growth: none, mind: none, memories: none, relationships: none, knowledge: none, history: none, perceptions: none, files: { ...none, filed: 0 }, ...over });

export const ODILE: CastMemberRow = {
  id: "char-odile",
  person: null,
  name: "Odile Holt",
  chat: CHAT,
  casting: { as: "principal", pinned: true, line: "Runs the ferry, owes nobody." },
  from: { carried: true, played: true },
  counts: counts({ mind: { held: 1, struck: 1 }, memories: { held: 2, struck: 0 }, knowledge: { held: 1, struck: 0 }, perceptions: { held: 1, struck: 0 }, files: { held: 2, struck: 0, filed: 1 } }),
};

export const TOBIN: CastMemberRow = { id: "char-tobin", name: "Tobin Reede", chat: CHAT, person: null, casting: null, from: { carried: false, played: false }, counts: counts({}) };

export const CAST: CastReply = { chat: CHAT, turn: null, characters: [ODILE, TOBIN] };

const entry = (id: string, part: EntryRow["part"], fields: EntryRow["fields"], over: Partial<EntryRow> = {}): EntryRow => ({
  id,
  part,
  fields,
  date: null,
  turn: "turn-7",
  message: 12,
  imported: false,
  by: "author",
  struck: false,
  writes: [{ turn: "turn-7", message: 12, imported: false, by: "author", wrote: fields }],
  ...over,
});

/** A mind entry whose words look like markup: the page shows them as the text they are. */
export const MARKUP = "<b>Wants</b> the toll lifted";
export const CARRIED_FILE = "# Odile\n\nKeeps the ferry's ledger in a tin under the bench.\n";

/** A list as the cast route gives it: bounded, with how many the record holds and how many it leaves out on each side. */
const bound = <T>(items: T[]): { items: T[]; total: number; before: number; after: number } => ({ items, total: items.length, before: 0, after: 0 });

export const ODILE_RECORD: CharacterReply = {
  chat: CHAT,
  turn: null,
  character: ODILE,
  sources: [{ kind: "card", ref: "card-odile", defines: "her looks and her trade", created: 1_700_000_000_000, title: "Odile Holt", state: "current" }],
  base: [
    { part: "seed", version: 1, text: "A ferrywoman who kept the crossing open.", standing: false, turn: null, by: "migration", created: 1 },
    { part: "seed", version: 2, text: "A ferrywoman who keeps the crossing open, toll or no toll.", standing: true, turn: "turn-7", by: "author", created: 2 },
  ],
  castings: [{ turn: "turn-2", message: 3, imported: true, by: "migration", wrote: { as: "principal" } }],
  growth: bound([]),
  mind: bound([entry("mind-1", "mind", { kind: "want", text: MARKUP }), entry("mind-2", "mind", { kind: "feeling", text: "Tired of the reeve." }, { struck: true })]),
  memories: bound([
    { ...entry("mem-1", "memory", { text: "The night the rope broke." }, { date: "3 Thawmonth" }), tier: "long", strength: 0.21, faint: true },
    { ...entry("mem-2", "memory", { text: "Tobin paid in copper." }), tier: "top", strength: 0.9, faint: false },
  ]),
  relationships: bound([]),
  knowledge: bound([entry("know-1", "knowledge", { text: "The reeve skims the toll." })]),
  history: bound([]),
  perceptions: bound([{ ...entry("perc-1", "perception", { text: "Tobin looked away at the reeve's name." }), of: { turn: "turn-6", message: 10 } }]),
  files: bound([
    { ...entry("file-1", "mind", { kind: "imported", file: "core.md", text: CARRIED_FILE }, { imported: true, by: "migration" }), file: "core.md", text: CARRIED_FILE, filed: true },
    { ...entry("file-2", "mind", { kind: "imported", file: "plans.md", text: "Sell the spare oars." }, { imported: true, by: "migration" }), file: "plans.md", text: "Sell the spare oars.", filed: false },
  ]),
};

const item = (id: string, part: StoryItemRow["part"], from: number | null, to: number | null, fields: StoryItemRow["fields"], over: Partial<StoryItemRow> = {}): StoryItemRow => ({
  id,
  part,
  fields,
  from,
  to,
  turn: "turn-5",
  message: 8,
  imported: false,
  by: "author",
  closed: false,
  struck: false,
  writes: [{ turn: "turn-5", message: 8, imported: false, by: "author", wrote: fields }],
  ...over,
});

const listOf = (items: StoryItemRow[], before = 0): StoryItems => ({ items, total: items.length + before, before, after: 0 });

export const THREAD = "Who cut the ferry rope?";

export const STORY: StoryReply = {
  chat: CHAT,
  turn: null,
  now: "4 Thawmonth, evening",
  listed: 2,
  timeline: {
    chapter: listOf([item("ch-1", "chapter", 0, null, { title: "The Crossing", summary: "Odile takes the ferry out in a storm." })]),
    scene: listOf([item("sc-1", "scene", 0, 6, { summary: "The rope breaks." }, { closed: true }), item("sc-2", "scene", 7, null, { summary: "The reeve's hall." })]),
    beat: listOf([item("bt-3", "beat", 4, 4, { text: "Tobin dives for the rope." }), item("bt-4", "beat", 8, 9, { text: "The reeve names the toll." })], 3),
  },
  current: { chapter: "ch-1", scene: "sc-2" },
  model: {
    premise: item("pr-1", "premise", null, null, { text: "A river town and the one ferry across it." }),
    thread: listOf([item("th-1", "thread", null, null, { text: THREAD, heat: "hot" })]),
    arc: listOf([]),
    player: listOf([item("pl-1", "player", null, null, { text: "Likes a slow mystery." })]),
    canon: listOf([]),
    retcon: listOf([]),
    record: listOf([]),
  },
  horizon: [
    { at: "the reeve's hall", ref: "place:hall", name: "The Reeve's Hall", depth: 1 },
    { at: "a storm upriver", ref: null, name: null, depth: "full" },
  ],
  futures: listOf([item("fu-1", "future", null, null, { text: "The reeve is found out at the spring fair." })]),
};

/** What the story route gives for `part=beat&skip=2`: the three older beats. */
export const OLDER_BEATS: StoryReply = {
  ...STORY,
  timeline: { ...STORY.timeline, beat: { items: [item("bt-1", "beat", 1, 1, { text: "Odile checks the knots." }), item("bt-2", "beat", 2, 3, { text: "The wind turns." })], total: 5, before: 1, after: 2 } },
};
