// The migration's settings (STANDALONE-PLAN §15.2 "anything else found ... no row above names", §22
// l.2117; Appendix D.1): the rows he gives to what the run finds that no row of the plan's table
// names. The run reads them from `RPE-global.yml` at the global level, as every setting of RPE is read,
// when it starts.

import { diskTexts, readConfig } from "../app/config-read";
import { isMapping, type Mapping, type Setting } from "../app/setting-list";

/** The fates he may give a thing: kept in the backup and listed (`archived`), or kept word for word as what it belongs to (`attached`). Carrying one needs a reader in code (§22 l.2117), which is not his to give. */
export const OWNER_FATES = ["archived", "attached"] as const;
export type OwnerFate = (typeof OWNER_FATES)[number];

/** A row he gave: the path of what it is for, what becomes of it, and his line saying what it is. */
export interface OwnerRow {
  path: string;
  fate: OwnerFate;
  line: string;
}

export const MIGRATION_ROWS_KEY = "migration.rows";

/** The settings the migration reads, as a config file writes them. */
export const MIGRATE_SETTINGS: readonly Setting[] = [
  {
    key: MIGRATION_ROWS_KEY,
    default: [],
    takes: {
      type: "records",
      fields: [
        { name: "path", takes: { type: "text" }, about: "The path of the file the report found and no row names, as the report names it (`stray-notes.txt`, or `user storage: stray-notes.txt`); a path ending in `/` is every file under that folder." },
        { name: "fate", takes: { type: "oneOf", values: OWNER_FATES }, about: "`archived`: kept in the backup and listed. `attached`: kept word for word as what it belongs to; nothing reads it yet." },
        { name: "line", takes: { type: "text" }, about: "Your line saying what it is, which the report prints beside it." },
      ],
    },
    levels: ["global"],
    perConnection: false,
    name: "Rows you give to what the migration finds",
    about: "A file the migration finds that no row of its table names fails the report by name. A row given here (its path, what becomes of it, and your line saying what it is) is counted, kept in the backup and listed in the report as yours; nothing is carried that has no reader.",
    effect: "use",
  },
  {
    key: "migration.page",
    default: 20,
    takes: { type: "whole", least: 1, most: 1000 },
    levels: ["global"],
    perConnection: false,
    name: "Carried turns per page",
    about: "How many of a migrated chat's turns a page of its list of carried turns holds, each with what the old engine recorded of it.",
    effect: "use",
  },
  {
    key: "migration.pageMost",
    default: 200,
    takes: { type: "whole", least: 1, most: 5000 },
    levels: ["global"],
    perConnection: false,
    name: "Most carried turns a page may ask for",
    about: "The most carried turns one request for a chat's list may ask for with `limit`; a larger ask is given this many.",
    effect: "use",
  },
];

/** How many carried turns a page of a chat's list holds, and the most one request may ask for, as the global config says now. */
export async function carriedPage(globalConfig: string): Promise<{ size: number; most: number }> {
  const read = readConfig(await diskTexts([{ level: "global", file: globalConfig, disk: globalConfig }]), null, MIGRATE_SETTINGS);
  const number = (key: string): number => {
    const def = MIGRATE_SETTINGS.find((s) => s.key === key);
    const value = def === undefined ? undefined : read.read(def).value;
    return typeof value === "number" ? value : 0;
  };
  return { size: number("migration.page"), most: number("migration.pageMost") };
}

/** The rows a config holds, from the records the reader gives for the setting (`ConfigRead.read`): each entry that is a whole row. */
export function ownerRowsOf(value: unknown): OwnerRow[] {
  if (!Array.isArray(value)) return [];
  const out: OwnerRow[] = [];
  for (const item of value as unknown[]) {
    if (!isMapping(item)) continue;
    const { path, fate, line } = item as Mapping;
    if (typeof path === "string" && typeof line === "string" && (fate === "archived" || fate === "attached")) out.push({ path, fate, line });
  }
  return out;
}
