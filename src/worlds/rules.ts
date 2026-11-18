// Putting a rule set on a chat's world, and growing its tables in play (RULESET-DESIGN §5.2). Both are the Build parts' own machinery
// reused: a rule set is a profile (`planProfile`, `applyProfile`, written into the world's draft by the editor), a row is a patch of
// the draft; each is committed as the world's next revision and the chat is moved to it as any Upgrade moves one, from its next turn,
// so the world's other chats stay on the revision they play until someone moves them. What the call does of its own is the plan said
// first (what is added, what the world already has, what it has of its own that the rule set would change and so keeps), the chat's
// level of the rules' domain put on, and who in the chat has no sheet yet. The same module serves the agents' tools and the World
// page: each says the answer's lines in its own file, by the names `rules_<code>`.
//
// Never decides what a world's rules say: every value is the profile's or the row the call gives. It refuses what it cannot do
// without disturbing the owner's work: a chat that is not on the world's newest revision, and a world whose draft in Build holds
// changes not committed yet (committing it for the rules would commit those too).

import { D20_COLUMNS, D20_TABLE_ROLES, type D20TableRole } from "../shared/d20";
import type { RevisionId, WorldId } from "../shared/ids";
import { isRecord, type JsonObject, type JsonValue, safeKey } from "../shared/json";
import type { ColumnDef } from "../shared/tables";
import { type ProfileChoice, PROFILE_IDS, PROFILES, planProfile, profileOf } from "../shared/profiles/index";
import type { DraftWrite, WorldService } from "./service";
import { lintWorld } from "../engine/authoring";
import { isGone, kindIs } from "../engine/scope";
import type { Registry } from "../engine/registry-impl";
import type { UserStore } from "../store/store";
import { type ChangeInput, STORE_OPS, type StoreState } from "../store/types";
import type { EditorResult } from "./worlds";

/** What a call works with: the world service, the chat's store and the registry, the write queue, and whose chat it is. */
export interface RulesDeps {
  worlds: Pick<WorldService, "read" | "draft" | "commit" | "chats">;
  s: UserStore;
  registry: Registry;
  writes: { run<T>(work: () => T, label?: string): Promise<T> };
  user: string;
  chat: string;
}

/** What a call could not do, as the line of an answers' file named `rules_<code>` and the values it is filled with. */
export class RulesRefused extends Error {
  constructor(
    readonly code: string,
    readonly fields: Record<string, JsonValue> = {},
  ) {
    super(code);
  }
}

/** The domain's level a chat is put on at: the lowest that is on. */
const ON = 1;
/** The most people a call names as having no sheet; the count is whole. */
const NAMED = 12;

interface Ground {
  world: WorldId;
  draft: EditorResult;
  state: StoreState;
}

/** The chat's world, its draft, and the chat's state, refusing where a revision cannot be made from the chat as it stands. */
async function ground(d: RulesDeps): Promise<Ground> {
  const row = d.s.chat(d.chat);
  if (row === null || row.world === null) throw new RulesRefused("no_world");
  const state = d.s.headState(d.chat).state;
  const head = await d.worlds.read(d.user, row.world);
  if (state.world.revision !== head.revision) throw new RulesRefused("behind");
  const draft = await d.worlds.draft(d.user, row.world, { op: "get" });
  if (draft.stored) throw new RulesRefused("draft_open");
  return { world: row.world, draft, state };
}

/** The draft written, committed as the world's next revision, and the chat moved to it; the draft put back where it was if the commit is refused. */
async function toNewRevision(d: RulesDeps, g: Ground, write: DraftWrite, note: string): Promise<{ revision: RevisionId; edit: string | null }> {
  const wrote = await d.worlds.draft(d.user, g.world, write, { base: g.draft.base, version: g.draft.version });
  let revision: RevisionId;
  try {
    revision = (await d.worlds.commit(d.user, g.world, { base: wrote.base, note, source: "agent" })).revision;
  } catch (error) {
    await d.worlds.draft(d.user, g.world, { op: "discard" });
    throw error;
  }
  const moved = await d.worlds.chats.upgrade(d.user, d.chat, revision);
  return { revision, edit: moved.edit };
}

/**
 * The chat's level of the rules' domain put on, where it is off: the owner's own change, with the edit the Upgrade it comes with
 * is taken back by (so one Undo takes both), or its own when nothing was moved. Null where it is on already.
 */
async function switchOn(d: RulesDeps, state: StoreState, edit: string | null): Promise<{ was: number; edit: string } | null> {
  const was = state.world.realism.levels.d20 ?? 0;
  if (was >= ON) return null;
  const tap = edit ?? crypto.randomUUID();
  const marker = { kind: "resolve", domain: "d20", scope: { all: true }, to: ON };
  const input: ChangeInput = { lane: "engine", op: STORE_OPS.marker, value: marker as unknown as JsonValue, by: "player", source: "player", cite: { tap, was, domain: "d20", request: { kind: "level", domain: "d20", to: ON } } };
  await d.writes.run(() => d.s.record(d.s.writeTarget({ chat: d.chat }), [input]), "switching the tabletop rules on");
  return { was, edit: tap };
}

// ---------------------------------------------------------------- a rule set

export interface RulesAsk {
  /** The rule set, by its id. */
  rules: string;
  /** The conflicts, by path, whose rule set's value replaces the world's own. */
  take: readonly string[];
  /** Only say what it would do. */
  preview: boolean;
}

export interface RulesItem {
  path: string;
  label: string;
}

export interface RulesApplied {
  rules: { id: string; label: string };
  preview: boolean;
  added: RulesItem[];
  /** The world's own of what the rule set would change, kept. */
  kept: RulesItem[];
  /** The world's own the call named, replaced by the rule set's. */
  taken: RulesItem[];
  same: number;
  /** The revision made and the chat moved to; null where nothing was. */
  revision: RevisionId | null;
  /** What takes the whole back (the Upgrade's Undo); null where nothing was recorded. */
  edit: string | null;
  /** The chat's level of the rules' domain: where it was and where it is; null where it was on already. */
  level: { was: number; now: number } | null;
  /** Who in the chat has no sheet: how many, and the first of them by name. */
  noSheet: { count: number; names: string[] };
}

/** The people of the kinds the rule set gives a sheet to, with nothing of a sheet set, in the chat's state as it stands. */
function withoutSheet(d: RulesDeps, state: StoreState, doc: Parameters<typeof kindIs>[1], kinds: readonly string[], fields: readonly string[]): { count: number; names: string[] } {
  const out: string[] = [];
  for (const [id, e] of Object.entries(state.world.entities)) {
    if (isGone(state.world, id) || !kinds.some((k) => kindIs(d.registry, doc, e.kind, k))) continue;
    if (fields.some((f) => Object.hasOwn(e.fields, f))) continue;
    out.push(e.name);
  }
  out.sort((a, b) => a.localeCompare(b));
  return { count: out.length, names: out.slice(0, NAMED) };
}

/** Puts the rule set `ask.rules` on the chat's world, as the world's next revision the chat is moved to. */
export async function applyRules(d: RulesDeps, ask: RulesAsk): Promise<RulesApplied> {
  const profile = profileOf(ask.rules);
  if (profile === null) throw new RulesRefused("unknown", { rules: ask.rules, choices: PROFILE_IDS.map((id) => `${id} (${PROFILES[id].label})`).join(", ") });
  const g = await ground(d);
  const kinds = Object.fromEntries(d.registry.kinds);
  const conflicts = planProfile(g.draft.draft, profile, kinds, {}).items.filter((i) => i.status === "conflict");
  const strange = ask.take.filter((path) => !conflicts.some((c) => c.path === path));
  if (strange.length > 0) throw new RulesRefused("not_conflict", { paths: strange.join(", "), rules: profile.label, conflicts: conflicts.map((c) => c.path).join(", ") || "none" });
  const choices: Record<string, ProfileChoice> = Object.fromEntries(ask.take.map((path) => [path, "profile" as const]));
  const plan = planProfile(g.draft.draft, profile, kinds, choices);
  const item = (i: (typeof plan.items)[number]): RulesItem => ({ path: i.path, label: i.label });
  const made: RulesApplied = {
    rules: { id: profile.id, label: profile.label },
    preview: ask.preview,
    added: plan.items.filter((i) => i.status === "add").map(item),
    kept: plan.items.filter((i) => i.status === "conflict" && choices[i.path] === undefined).map(item),
    taken: plan.items.filter((i) => i.status === "conflict" && choices[i.path] !== undefined).map(item),
    same: plan.items.filter((i) => i.status === "same").length,
    revision: null,
    edit: null,
    level: null,
    noSheet: { count: 0, names: [] },
  };
  if (ask.preview) return made;
  let state = g.state;
  if (made.added.length + made.taken.length > 0) {
    const done = await toNewRevision(d, g, { op: "profile", profile: profile.id, choices }, `Rules: ${profile.label}`);
    made.revision = done.revision;
    made.edit = done.edit;
    state = d.s.headState(d.chat).state;
  }
  const on = await switchOn(d, g.state, made.edit);
  if (on !== null) {
    made.level = { was: on.was, now: ON };
    made.edit ??= on.edit;
  }
  // The sheet the rule set gives, to the kinds it names: its `d20` part's, else the kind of the world's people (the plan's).
  const doc = (await d.worlds.read(d.user, g.world, made.revision ?? undefined)).world;
  const part = doc.ruleset?.d20;
  made.noSheet = withoutSheet(d, state, doc, part?.kinds ?? [plan.kind.id], part?.abilities ?? Object.keys(profile.fields));
  return made;
}

// ---------------------------------------------------------------- a row

/** What a table's role is called, by the words a call may use. */
const ROLE_WORDS: Readonly<Record<string, D20TableRole>> = {
  skill: "skills",
  skills: "skills",
  class: "classes",
  classes: "classes",
  track: "tracks",
  tracks: "tracks",
  trait: "traits",
  traits: "traits",
  feat: "traits",
  race: "traits",
  condition: "conditions",
  conditions: "conditions",
  size: "sizes",
  sizes: "sizes",
  weapon: "weapons",
  weapons: "weapons",
  armor: "armor",
  armour: "armor",
  creature: "creatures",
  creatures: "creatures",
  experience: "experience",
  challenge: "challenges",
  challenges: "challenges",
  difficulty: "difficulties",
  difficulties: "difficulties",
};

export interface RowAsk {
  /** The kind of row, by the role of its table (a trait, a condition, a weapon). */
  table: string;
  /** The row's key in its table. */
  id: string;
  /** The row's columns. */
  row: JsonObject;
}

export interface RowAdded {
  role: D20TableRole;
  table: string;
  id: string;
  replaced: boolean;
  /** The row is as given already, so nothing was made. */
  same: boolean;
  revision: RevisionId | null;
  edit: string | null;
}

/** One thing wrong with a row, as the line of the answers' file that says it and the values it is filled with. */
export interface RowProblem {
  line: string;
  fields: Record<string, JsonValue>;
}

/** Whether a value is what a column holds; null where it is, else what the column holds, in the words of its type. */
function holds(column: ColumnDef, v: JsonValue): string | null {
  switch (column.type) {
    case "int":
      return typeof v === "number" && Number.isInteger(v) ? null : "a whole number";
    case "number":
      return typeof v === "number" && Number.isFinite(v) ? null : "a number";
    case "text":
    case "ref":
      return typeof v === "string" ? null : "text";
    case "bool":
      return typeof v === "boolean" ? null : "true or false";
    case "enum":
      return typeof v === "string" && (column.values ?? []).includes(v) ? null : `one of ${(column.values ?? []).join(", ")}`;
    case "list":
      return Array.isArray(v) && v.every((x) => (column.of === undefined || column.of === "json" ? true : column.of === "int" || column.of === "number" ? typeof x === "number" : typeof x === "string")) ? null : "a list";
    default:
      return null;
  }
}

/** What is wrong with `row` as a row of a table of `role` whose columns are `own`: the role's columns it lacks, and those it has of the wrong kind or that the table does not have. */
function rowProblems(role: D20TableRole, own: Readonly<Record<string, ColumnDef>>, row: JsonObject): RowProblem[] {
  const columns: Record<string, ColumnDef> = { ...D20_COLUMNS[role], ...own };
  const out: RowProblem[] = [];
  for (const [name, column] of Object.entries(D20_COLUMNS[role])) if (column.optional !== true && row[name] === undefined) out.push({ line: "rules_row_missing", fields: { column: name, doc: column.doc ?? "" } });
  for (const [name, v] of Object.entries(row)) {
    const column = Object.hasOwn(columns, name) ? columns[name] : undefined;
    if (column === undefined) {
      if (role !== "tracks") out.push({ line: "rules_row_extra", fields: { column: name, columns: Object.keys(columns).join(", ") } });
      continue;
    }
    const wants = holds(column, v);
    if (wants !== null) out.push({ line: "rules_row_type", fields: { column: name, wants } });
  }
  return out;
}

/** A JSON Pointer's token: `~` and `/` escaped. */
const token = (id: string): string => id.replace(/~/g, "~0").replace(/\//g, "~1");

/** Adds or changes a row of one of the rules' tables on the chat's world, as the world's next revision the chat is moved to. */
export async function addRow(d: RulesDeps, ask: RowAsk): Promise<RowAdded> {
  const role = Object.hasOwn(ROLE_WORDS, ask.table.trim().toLowerCase()) ? ROLE_WORDS[ask.table.trim().toLowerCase()] : undefined;
  if (role === undefined) throw new RulesRefused("table_unknown", { table: ask.table, choices: D20_TABLE_ROLES.join(", ") });
  if (!safeKey(ask.id) || !/^[A-Za-z0-9_.-]{1,64}$/.test(ask.id)) throw new RulesRefused("bad_id", { id: ask.id });
  const g = await ground(d);
  const d20 = g.draft.draft.ruleset?.d20;
  if (d20 === undefined) throw new RulesRefused("no_rules");
  const tableId = d20.tables[role];
  const table = tableId === undefined ? undefined : g.draft.draft.tables[tableId];
  if (tableId === undefined || table === undefined || !isRecord(table.rows)) throw new RulesRefused("no_table", { role });
  const problems = rowProblems(role, table.columns, ask.row);
  // What the pack's own lint says of the world with the row in it, beyond what it said before.
  if (problems.length === 0) {
    const after = structuredClone(g.draft.draft);
    const kept = after.tables[tableId];
    if (kept !== undefined) kept.rows[ask.id] = ask.row as never;
    const was = new Set(g.draft.lint.filter((i) => i.severity === "error").map((i) => `${i.path}|${i.code}|${i.message}`));
    for (const i of lintWorld(after, d.registry)) if (i.severity === "error" && !was.has(`${i.path}|${i.code}|${i.message}`)) problems.push({ line: "rules_row_lint", fields: { message: i.message } });
  }
  if (problems.length > 0) throw new RulesRefused("bad_row", { id: ask.id, table: tableId, problems: problems as unknown as JsonValue });
  const there = Object.hasOwn(table.rows, ask.id) ? table.rows[ask.id] : undefined;
  const made: RowAdded = { role, table: tableId, id: ask.id, replaced: there !== undefined, same: false, revision: null, edit: null };
  if (there !== undefined && JSON.stringify(there) === JSON.stringify(ask.row)) return { ...made, same: true };
  const path = `/tables/${token(tableId)}/rows/${token(ask.id)}`;
  const done = await toNewRevision(d, g, { op: "patch", ops: [there === undefined ? { op: "add", path, value: ask.row } : { op: "replace", path, value: ask.row }] }, `Rules: ${there === undefined ? "added" : "changed"} ${ask.id} in ${tableId}`);
  return { ...made, revision: done.revision, edit: done.edit };
}
