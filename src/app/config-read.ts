// The one reader of the config levels (plan §5.2, §5.4 "Config"): every area of RPE reads its settings
// through it, the turn lane's, bootstrap's, the tree's and the door's alike, so the same files give
// every area the same values. A chat's levels (`RPE-global.yml` as shipped and the user's own, the
// chat's `RPE.yml`) are read farthest first and merged by RPH's merge of levels (`mergedConfig`); each
// setting is read from the levels it is read from alone, through the registry's check of a value.
//
// Nothing in a config file stops a turn. A file that does not read, or is no mapping of keys, a section
// that is no mapping of keys where settings live under it (`limits: 5`), a value a setting does not
// take, and a value set in the file of a level the setting is not read from are each logged once a
// read, with the file that holds it, and passed over: the default holds.
//
// Where the levels' texts come from is the caller's: the agents' files through RPH's `FilesPort`
// (`portTexts`), or the files on disk where the tree has them (`diskTexts`). The composition hands
// every area one `SettingsReader` over the tree's levels (`src/tree/settings.ts`).

import { readFileSync } from "node:fs";
import type { FilesPort, JsonValue, LayerLevel, Log, Scope } from "rp-harness/contract";
import { readText } from "./disk";
import { connectionsNamed, type Declared, decidesAt, isMapping, type Mapping, mergedConfig, type NumberSettings, pathOf, type SettingRead, takenValue } from "./setting-list";
import { yamlMapping } from "./yaml";

/** One level's config file as a reader is given it: its level, its name in the agents' view (`@global/RPE-global.yml`, `RPE.yml`), and its text; null where there is none. */
export interface LevelText {
  readonly level: LayerLevel;
  readonly file: string;
  readonly text: string | null;
}

/** One level's config file and where it is on disk. */
export interface LevelFile {
  readonly level: LayerLevel;
  readonly file: string;
  readonly disk: string;
}

/** One level's config file as read: what it holds, or what is wrong with it (it then holds nothing here). */
export interface LevelConfig {
  readonly level: LayerLevel;
  readonly file: string;
  readonly config: Mapping;
  readonly problem: string | null;
}

/** What a level's file sets for a setting, as the Settings page lists it. */
export interface LevelValue {
  readonly level: LayerLevel;
  readonly file: string;
  readonly value: JsonValue;
}

/** The reader every area is handed: the settings of a chat's levels as their files stand now. */
export interface SettingsReader {
  /** A chat's levels, read now; for null, the levels every chat shares. */
  read(user: string, chat: string | null): Promise<ConfigRead>;
  /** The levels every chat shares, read now and at once: for what is made for no chat. */
  shared(): ConfigRead;
}

/** A value as a reason names it. */
function words(value: JsonValue): string {
  return typeof value === "number" && !Number.isFinite(value) ? String(value) : JSON.stringify(value);
}

/**
 * The config levels of one read, and each setting's value in them. Every value passed over is logged
 * once a read, with its key, the file that set it and why; a read made with no log (a page's) logs
 * nothing and says the same in what it gives.
 */
export class ConfigRead {
  readonly levels: readonly LevelConfig[];
  readonly #log: Log | null;
  /** The sections a setting written short may hold whole (`history.hold: true`): no mapping there is no fault. */
  readonly #short: ReadonlySet<string>;
  readonly #logged = new Set<string>();
  readonly #merged = new Map<string, Mapping>();

  constructor(levels: readonly LevelConfig[], log: Log | null, known: readonly Declared[] = []) {
    this.levels = levels;
    this.#log = log;
    this.#short = new Set(known.filter((d) => d.short === true).map((d) => pathOf(d).slice(0, -1).join(".")));
  }

  /** The files read, for the log. */
  get from(): string {
    return this.levels
      .filter((l) => l.problem === null)
      .map((l) => l.file)
      .join(", ");
  }

  /** Every level merged. */
  get config(): Mapping {
    return this.#mergedOf(this.levels, "");
  }

  /** The levels a setting is read from, farthest first. */
  levelsOf(def: Declared): readonly LevelConfig[] {
    return def.levels === undefined ? this.levels : this.levels.filter((l) => def.levels!.includes(l.level));
  }

  /** The levels a setting is read from, merged. */
  configOf(def: Declared): Mapping {
    return this.#mergedOf(this.levelsOf(def), def.levels?.join(",") ?? "");
  }

  /** The level whose file decides a setting's value: the nearest of its levels that sets it, or sets no mapping above it; null where none does. */
  deciding(def: Declared, connection?: string): LevelConfig | null {
    const path = pathOf(def, connection);
    return this.levelsOf(def).findLast((l) => decidesAt(l.config, path)) ?? null;
  }

  /** What each of a setting's levels sets for it, farthest first; a level that sets nothing is left out. */
  setAt(def: Declared, connection?: string): LevelValue[] {
    const path = pathOf(def, connection);
    return this.levelsOf(def).flatMap((l) => {
      let at: JsonValue | undefined = l.config;
      for (const part of path) at = isMapping(at) ? at[part] : undefined;
      return at === undefined ? [] : [{ level: l.level, file: l.file, value: at }];
    });
  }

  /** The names or ids a per-connection setting is set under, in the levels it is read from. */
  named(def: Declared): string[] {
    return [...new Set(this.levelsOf(def).flatMap((l) => connectionsNamed(l.config, def)))];
  }

  /**
   * A setting's value: the one its levels set, where the setting takes it; else its default, with what
   * was set and why it was passed over. A setting every level of which applies (`joined`) is each
   * level's value taken in turn, the farther first: a list of names their names, a list of records
   * their records, and anything else each level's value in a list.
   */
  read(def: Declared & { readonly joined?: true }, connection?: string): SettingRead {
    this.#unread(def);
    if (def.joined === true) return this.#joined(def, connection);
    const path = pathOf(def, connection);
    let at: JsonValue = this.configOf(def);
    for (const [i, part] of path.entries()) {
      if (!isMapping(at)) {
        const above = path.slice(0, i);
        // A short setting's own value, or a sibling's: the section holds that one setting, and the rest are at their defaults.
        if (i === path.length - 1 && (def.short === true || this.#short.has(above.join(".")))) {
          if (def.short === true) return this.#taken(def, at, path, connection);
          return { value: def.default, passed: null };
        }
        return { value: def.default, passed: this.#notMapping(def, above, at) };
      }
      const next: JsonValue | undefined = at[part];
      if (next === undefined) return { value: def.default, passed: null };
      at = next;
    }
    return this.#taken(def, at, path, connection);
  }

  /** A setting's value, as `read` gives it. */
  value(def: Declared & { readonly joined?: true }, connection?: string): JsonValue {
    return this.read(def, connection).value;
  }

  /** Each setting of a group of numbers, by the name the group gives it. */
  numbers<K extends string>(group: NumberSettings<K>): Record<K, number> {
    const out = {} as Record<K, number>;
    // A value a number setting takes is a number, since none takes `~`; a default is one too.
    for (const name of Object.keys(group) as K[]) out[name] = this.value(group[name]) as number;
    return out;
  }

  #mergedOf(levels: readonly LevelConfig[], set: string): Mapping {
    let merged = this.#merged.get(set);
    if (merged === undefined) {
      merged = levels.reduce<Mapping>((config, l) => mergedConfig(config, l.config), {});
      this.#merged.set(set, merged);
    }
    return merged;
  }

  #taken(def: Declared, value: JsonValue, path: readonly string[], connection: string | undefined): SettingRead {
    const key = path.join(".");
    const taken = takenValue(def, value, key);
    if (taken.ok) return { value: taken.value, passed: null };
    this.#pass(key, "A setting has a value it does not take; its default holds.", { setting: key, value, file: this.deciding(def, connection)?.file ?? null, why: taken.why });
    return { value: def.default, passed: { value, why: taken.why } };
  }

  #joined(def: Declared, connection: string | undefined): SettingRead {
    const parts: JsonValue[] = [];
    let passed: SettingRead["passed"] = null;
    const path = pathOf(def, connection);
    for (const set of this.setAt(def, connection)) {
      const key = path.join(".");
      const taken = takenValue(def, set.value, key);
      if (taken.ok) {
        if (taken.value !== null) parts.push(taken.value);
        continue;
      }
      passed ??= { value: set.value, why: taken.why };
      this.#pass(`${key}\n${set.file}`, "A setting has a value it does not take; its default holds.", { setting: key, value: set.value, file: set.file, why: taken.why });
    }
    if (parts.length === 0) return { value: def.default, passed };
    const t = def.takes.type;
    const value: JsonValue = t === "texts" ? [...new Set(parts.flat() as string[])] : t === "records" ? parts.flat() : parts;
    return { value, passed };
  }

  /** A value that is no mapping where settings live under its key: they are all at their defaults. */
  #notMapping(def: Declared, path: readonly string[], value: JsonValue): { value: JsonValue; why: string } {
    const key = path.join(".");
    const why = `${key} holds the settings under it as a mapping of keys, not ${words(value)}.`;
    const file = this.levelsOf(def).findLast((l) => decidesAt(l.config, path))?.file ?? null;
    this.#pass(`${key}\n${file ?? ""}`, "A setting has a value it does not take; its default holds.", { setting: key, value, file, why });
    return { value, why };
  }

  /** A value set for a setting read from some levels alone, in the file of a level it is not read from: passed over, and logged. */
  #unread(def: Declared): void {
    const read = def.levels;
    if (read === undefined) return;
    const path = pathOf(def);
    for (const l of this.levels) {
      if (read.includes(l.level)) continue;
      const set = valueAtPattern(l.config, path);
      for (const { key, value } of set)
        this.#pass(`${key}\n${l.file}`, "A setting is set in a file it is not read from; the value there is passed over.", {
          setting: key,
          value,
          file: l.file,
          why: `${key} is read from ${read.filter((r) => r !== "shipped").join(" and ")} level alone, not from the ${l.level} file.`,
        });
    }
  }

  #pass(once: string, message: string, fields: Record<string, JsonValue>): void {
    if (this.#log === null || this.#logged.has(once)) return;
    this.#logged.add(once);
    this.#log.warn(message, fields);
  }
}

/** Each value a config sets at a key's path, with the key it is set at: one for each connection it names, where the path has `<connection>`. */
function valueAtPattern(config: JsonValue, parts: readonly string[], key: readonly string[] = []): { key: string; value: JsonValue }[] {
  if (parts.length === 0) return [{ key: key.join("."), value: config }];
  if (!isMapping(config)) return [];
  const [part, ...rest] = parts as [string, ...string[]];
  return (part === "<connection>" ? Object.keys(config) : [part]).flatMap((name) => {
    const next = config[name];
    return next === undefined ? [] : valueAtPattern(next, rest, [...key, name]);
  });
}

/**
 * The levels' files as one read: each parsed, one that is missing or empty holding nothing, and one
 * that does not read, or is no mapping of keys, logged once with its name and passed over. `known`:
 * the settings whose short form a section may hold (`history.hold: true`).
 */
export function readConfig(texts: readonly LevelText[], log: Log | null, known: readonly Declared[] = []): ConfigRead {
  const levels = texts.map((t): LevelConfig => {
    if (t.text === null || t.text.trim() === "") return { level: t.level, file: t.file, config: {}, problem: null };
    try {
      return { level: t.level, file: t.file, config: yamlMapping(t.text, t.file) as Mapping, problem: null };
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      log?.warn("A config file is not a mapping of keys that RPE can read; the settings in it are passed over.", { file: t.file, why: problem });
      return { level: t.level, file: t.file, config: {}, problem };
    }
  });
  // The parsed document is JSON-like: YAML's own values (a date, say) are kept as Bun reads them.
  return new ConfigRead(
    levels.map((l) => ({ ...l, config: isMapping(l.config) ? l.config : {} })),
    log,
    known,
  );
}

/** The levels' texts as their files on disk hold them. */
export async function diskTexts(files: readonly LevelFile[]): Promise<LevelText[]> {
  return await Promise.all(files.map(async (f) => ({ level: f.level, file: f.file, text: await readText(f.disk) })));
}

/** The same, read at once: for what is made when RPE starts, before anything waits. */
export function diskTextsNow(files: readonly LevelFile[]): LevelText[] {
  return files.map((f) => {
    let text: string | null = null;
    try {
      text = readFileSync(f.disk, "utf8");
    } catch {
      text = null;
    }
    return { level: f.level, file: f.file, text };
  });
}

/** The levels' texts as a scope's agents read them, through RPH's file port: the levels that have a config file, farthest first. */
export async function portTexts(files: Pick<FilesPort, "layers" | "read">, scope: Scope): Promise<LevelText[]> {
  const out: LevelText[] = [];
  for (const layer of await files.layers(scope)) {
    if (layer.config === undefined) continue;
    const file = `${layer.mount}${layer.config}`;
    const read = await files.read(scope, file);
    out.push({ level: layer.level, file, text: read.status === "read" ? read.text : null });
  }
  return out;
}
