// What the Settings page makes of the settings route's reply (plan §14, §2.1 point 5): a value as the page says it, a number with
// its unit; what holds where no file of his sets a setting (the shipped file's value, else the default); whether he changed it; the
// advice a value passes; which level a change goes to; how settings fall into sections and groups; and the table of those set per
// connection or per agent, a row for each connection or definition and a column for each setting.

import type { Advice, LayerLevel, SettingView } from "../../../shared/api";
import { isRecord, type JsonValue } from "../../../shared/json";
import { bytesWords, duration, num } from "../../words";

/** Where a change made on the page goes: his own file for every chat, or the chat's own. */
export type ChangeLevel = "global" | "chat";

/** Each level as a setting's row says it is set there. */
export const SET_AT_WORDS: Readonly<Record<LayerLevel, string>> = { shipped: "as shipped", global: "for every chat", character: "for this character", chat: "for this chat" };

// ---------------------------------------------------------------- values as said

/** A unit in the singular, for a value of one. */
const ONE: Readonly<Record<string, string>> = { seconds: "second", minutes: "minute", hours: "hour", days: "day", bytes: "byte", characters: "character", tokens: "token", words: "word", lines: "line", feet: "foot" };

/** A number in its unit, with a plainer reading beside a long time or a large size: "3,000 ms (3.0 s)", "1,048,576 bytes (1.0 MB)". */
export function numberWords(value: number, unit: string | null): string {
  if (unit === null) return num(value);
  const said = `${num(value)} ${value === 1 ? (ONE[unit] ?? unit) : unit}`;
  if (unit === "ms" && value >= 1000) return `${said} (${duration(value)})`;
  if (unit === "seconds" && value >= 120) return `${said} (${duration(value * 1000)})`;
  if (unit === "minutes" && value >= 120) return `${said} (${duration(value * 60_000)})`;
  if (unit === "bytes" && value >= 1024) return `${said} (${bytesWords(value)})`;
  return said;
}

/** What a value of none means for a setting: what holds unset where nothing sets it and that differs, else what `~` means. */
export function noneWords(s: SettingView, set: boolean): string {
  return !set && s.unset !== null ? s.unset : (s.none ?? "none");
}

/** A value as the page says it: on or off, a number in its unit, a list item by item, a table entry by entry, and no value as what it means. */
export function valueWords(s: SettingView, value: JsonValue, set = true): string {
  if (value === null) return noneWords(s, set);
  if (typeof value === "boolean") return value ? "On" : "Off";
  if (typeof value === "number") return numberWords(value, s.unit);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return "none listed";
    return value.map((item) => (typeof item === "string" ? item : isRecord(item) ? Object.values(item).map((v) => String(v)).join(" → ") : JSON.stringify(item))).join(", ");
  }
  const entries = Object.entries(value);
  return entries.length === 0 ? "none listed" : entries.map(([name, v]) => `${name}: ${Array.isArray(v) ? v.join(", ") : String(v)}`).join("; ");
}

// ---------------------------------------------------------------- what he set

/** What holds where no file of his sets a setting: the shipped file's value, else the default. For one every level of which applies, the shipped list. */
export function shippedValue(s: SettingView): JsonValue {
  return s.set.find((at) => at.level === "shipped")?.value ?? s.default;
}

/** The levels of his that set a setting and that it may be set at here, farthest first. */
export function mineSet(s: SettingView): { level: LayerLevel; file: string; value: JsonValue }[] {
  return s.set.filter((at) => at.level !== "shipped" && s.levels.includes(at.level));
}

/** Whether what is in force differs from what was shipped; for one every level of which applies, whether a level of his adds to it. */
export function isChanged(s: SettingView): boolean {
  if (s.joined) return mineSet(s).some((at) => !(Array.isArray(at.value) && at.value.length === 0) && !(isRecord(at.value) && Object.keys(at.value).length === 0));
  return s.from !== null && s.from !== "shipped" && JSON.stringify(s.value) !== JSON.stringify(shippedValue(s));
}

/** The level a change goes to: the one asked for where the setting is read there, else his own for every chat. */
export function levelFor(s: SettingView, wanted: ChangeLevel): LayerLevel {
  if (s.levels.includes(wanted)) return wanted;
  return s.levels.includes("global") ? "global" : (s.levels[0] ?? "global");
}

/** The levels of the agents' tree, farthest first: a nearer one's value stands over a farther one's. */
export const LEVEL_ORDER: readonly LayerLevel[] = ["shipped", "global", "character", "chat"];

/**
 * What a change starts from at a level: for one every level of which applies, that level's own list; else what holds at that level,
 * the nearer levels left out (the value in force where the level that decides it is that one or farther).
 */
export function startingValue(s: SettingView, level: LayerLevel): JsonValue {
  if (s.joined) return s.set.find((at) => at.level === level)?.value ?? (s.takes.type === "table" ? {} : []);
  const upTo = LEVEL_ORDER.indexOf(level);
  if (s.from === null || LEVEL_ORDER.indexOf(s.from) <= upTo) return s.value;
  return s.set.filter((at) => LEVEL_ORDER.indexOf(at.level) <= upTo).at(-1)?.value ?? s.default;
}

/**
 * The way back for a setting he set: the level whose file is taken away (the nearest of his that sets it), and what that brings back:
 * the value a farther level of his sets, or the default.
 */
export function wayBack(s: SettingView, level: LayerLevel): { level: LayerLevel; to: "farther" | "default" } | null {
  if (s.joined) return mineSet(s).some((at) => at.level === level) ? { level, to: "default" } : null;
  const mine = mineSet(s);
  const nearest = mine.at(-1);
  if (nearest === undefined || nearest.level !== s.from) return null;
  return { level: nearest.level, to: mine.length > 1 ? "farther" : "default" };
}

// ---------------------------------------------------------------- advice

/** The advice lines a value passes: a number below or above what is usual. */
export function adviceFor(advice: readonly Advice[], value: JsonValue | undefined): string[] {
  if (typeof value !== "number") return [];
  return advice.flatMap((a) => ((a.below !== undefined && value < a.below) || (a.above !== undefined && value > a.above) ? [a.says] : []));
}

// ---------------------------------------------------------------- finding

/** Whether a setting matches what he typed: every word of it is in its name, what it does, its group, section, unit, key or what it is set for. */
export function settingMatches(s: SettingView, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return true;
  const hay = `${s.name} ${s.about} ${s.group} ${s.section} ${s.unit ?? ""} ${s.key} ${s.setFor?.name ?? ""}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

export interface GroupShown {
  title: string;
  /** Set for one connection or one agent at a time: shown as a table. */
  table: "connection" | "definition" | null;
  settings: SettingView[];
}

export interface SectionShown {
  title: string;
  about: string;
  groups: GroupShown[];
  /** How many of its settings he changed. */
  changed: number;
  count: number;
}

/** The settings in sections, in the route's order of sections, each with its groups in the order RPE lists them; empty sections left out. */
export function sectionsOf(sections: readonly { title: string; about: string }[], settings: readonly SettingView[]): SectionShown[] {
  return sections.flatMap((section) => {
    const inside = settings.filter((s) => s.section === section.title);
    if (inside.length === 0) return [];
    const groups = new Map<string, GroupShown>();
    for (const s of inside) {
      const held = groups.get(s.group);
      if (held !== undefined) held.settings.push(s);
      else groups.set(s.group, { title: s.group, table: s.setFor?.kind ?? null, settings: [s] });
    }
    return [{ title: section.title, about: section.about, groups: [...groups.values()], changed: inside.filter(isChanged).length, count: inside.length }];
  });
}

// ---------------------------------------------------------------- tables

export interface TableColumn {
  pattern: string;
  name: string;
  about: string;
}

export interface TableRow {
  /** The name or id its keys write. */
  key: string;
  name: string;
  /** A connection or definition in force by that name; false for one a file names that is not. */
  known: boolean;
  cells: Map<string, SettingView>;
}

/** Settings set for one connection or one agent at a time as a table: a column for each setting, a row for each connection or definition. */
export function tableOf(settings: readonly SettingView[]): { columns: TableColumn[]; rows: TableRow[] } {
  const columns = new Map<string, TableColumn>();
  const rows = new Map<string, TableRow>();
  for (const s of settings) {
    if (s.setFor === undefined) continue;
    if (!columns.has(s.pattern)) columns.set(s.pattern, { pattern: s.pattern, name: s.name, about: s.about });
    const row = rows.get(s.setFor.key) ?? { key: s.setFor.key, name: s.setFor.name, known: s.setFor.known, cells: new Map() };
    row.cells.set(s.pattern, s);
    rows.set(s.setFor.key, row);
  }
  return { columns: [...columns.values()], rows: [...rows.values()].sort((a, b) => Number(b.known) - Number(a.known)) };
}
