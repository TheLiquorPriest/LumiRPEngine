// The Settings page's routes (plan §14: "both config files as forms… every limit editable"; §5.2,
// §5.4 "Config"): every setting RPH and RPE read, from the lists their readers take each value
// through (`SettingDef`), with the value in force for a chat, its default, and the level and file it
// comes from; and a value written into the config file of one level, as the user would write it.
//
// The levels are those of the agents' tree that have a config file, farthest first: the shipped
// `RPE-global.yml`, the user's own, and the chat's `RPE.yml`. The shipped one is never written. A
// write changes only the key's own lines, so the user's comments and the rest of the file stay as they
// were; and since the readers read the files at every turn, the next turn runs under it.

import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { JsonValue, LayerLevel } from "rp-harness/contract";
import { readText, writeWhole } from "./disk";
import { type Exactly, type Holds, type Infer, route, RouteError, shape } from "./routes";
import { connectionsNamed, decidesAt, isMapping, keyFor, type Mapping, mergedConfig, pathOf, type SettingDef, settingIn, settingOfKey, type SettingTakes, takenValue, takesWords, valueAt } from "./setting-list";
import { configWrites, withKeyAt, yamlMapping } from "./yaml";

export const SETTINGS_PATH = "/api/v1/settings";

/** A level's config file: as the agents' tree names it (`@global/RPE-global.yml`, a chat's `RPE.yml`), and on disk. */
export interface LevelFile {
  level: LayerLevel;
  file: string;
  disk: string;
}

export interface SettingsDeps {
  /** Every setting RPH and RPE read. */
  settings: readonly SettingDef[];
  /** The config files of a chat's levels, farthest first; for no chat, those every chat shares. A level the chat has no folder for yet is left out. */
  levels(chat: string | null): Promise<LevelFile[]>;
  /** The model layer's connections, for the settings set per connection. */
  connections(): Promise<{ id: string; name: string }[]>;
}

const T = shape.text();
const layerLevel = shape.named("LayerLevel", "A level of the agents' tree: what ships, the user's own, a character's, a chat's.", shape.oneOf("shipped", "global", "character", "chat"));
const takes = shape.named(
  "SettingTakes",
  "What a level may set a setting to: a whole number or a number, at least `least` and at most `most` where it has one; one of `values`; yes or no; a line of text that is not blank; or a list of names.",
  shape.union(
    shape.object({ type: shape.literal("whole"), least: shape.number(), most: shape.optional(shape.number()) }),
    shape.object({ type: shape.literal("number"), least: shape.number(), most: shape.optional(shape.number()) }),
    shape.object({ type: shape.literal("oneOf"), values: shape.list(T, { readonly: true }) }),
    shape.object({ type: shape.literal("yesNo") }),
    shape.object({ type: shape.literal("text") }),
    shape.object({ type: shape.literal("texts") }),
  ),
);
// The setting list's own types, which the readers read by: the declaration says the same. RPH's
// `SettingTakes` marks its members readonly; a reply's shape carries the same members, written.
type Written<T> = T extends unknown ? { -readonly [K in keyof T]: T[K] } : never;
type LevelMirrored = Holds<Exactly<Infer<typeof layerLevel>, LayerLevel>>;
type TakesMirrored = Holds<Exactly<Infer<typeof takes>, Written<SettingTakes>>>;

const settingView = shape.named(
  "SettingView",
  "A setting as the Settings page shows it.",
  shape.object({
    key: shape.field(T, "As a config file writes it; a per-connection setting's names the connection."),
    value: shape.field(shape.json(), "The value in force."),
    default: shape.json(),
    from: shape.field(shape.nullable(layerLevel), "The level whose file decides the value in force; null where no file does, and the default holds."),
    file: shape.field(shape.nullable(T), "That level's file, as the Files page names it."),
    takes,
    takesWords: shape.field(T, "What it takes, in words."),
    none: shape.field(shape.nullable(T), "What no value means, where the default is none or `~` may be set."),
    orNone: shape.field(shape.yesNo(), "`~` may be set (`none: true` in a write)."),
    levels: shape.field(shape.list(layerLevel), "The levels it may be set at here."),
    connection: shape.optional(shape.nullable(shape.object({ id: T, name: T })), "For a per-connection setting, the connection it names; null for a name or id no connection has now."),
    passed: shape.field(shape.nullable(shape.object({ value: shape.json(), why: T })), "A value a file sets that the setting does not take, and why: the default holds in its place."),
  }),
);
export type SettingView = Infer<typeof settingView>;

const settingsReply = shape.named(
  "SettingsReply",
  "Each level's config file, farthest first, with what is wrong with one that cannot be read (its settings are then passed over); and every setting.",
  shape.object({ chat: shape.nullable(T), files: shape.list(shape.object({ level: layerLevel, file: T, problem: shape.nullable(T) })), settings: shape.list(settingView) }),
);
export type SettingsReply = Infer<typeof settingsReply>;

const settingsWrite = shape.named(
  "SettingsWrite",
  "A key written at a level, a chat's naming the chat (left out or null: no chat): its value, null to take the key away at that level, or `none: true` to set `~`.",
  shape.object({ level: layerLevel, chat: shape.optional(shape.nullable(shape.text({ blank: false }))), key: shape.text({ blank: false }), value: shape.optional(shape.json()), none: shape.optional(shape.yesNo()) }),
);

interface LevelConfig extends LevelFile {
  config: Mapping;
  problem: string | null;
}

/** Each level's file read as the readers read it: one that is missing or empty holds nothing, and one that does not read is passed over. */
async function readLevels(levels: readonly LevelFile[]): Promise<LevelConfig[]> {
  return await Promise.all(
    levels.map(async (level) => {
      const text = await readText(level.disk);
      try {
        const doc = text === null ? {} : yamlMapping(text, level.file);
        return { ...level, config: isMapping(doc) ? doc : {}, problem: null };
      } catch (error) {
        return { ...level, config: {}, problem: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
}

function reply(chat: string | null, levels: readonly LevelConfig[], defs: readonly SettingDef[], connections: readonly { id: string; name: string }[]): SettingsReply {
  const settings: SettingView[] = [];
  for (const def of defs) {
    const read = levels.filter((l) => def.levels === undefined || def.levels.includes(l.level));
    const merged = read.reduce<Mapping>((config, l) => mergedConfig(config, l.config), {});
    const view = (connection?: string, named?: { id: string; name: string } | null): SettingView => {
      const path = pathOf(def, connection);
      const deciding = read.findLast((l) => decidesAt(l.config, path)) ?? null;
      const { value, passed } = settingIn(merged, def, connection);
      return {
        key: keyFor(def, connection),
        value,
        default: def.default,
        from: deciding?.level ?? null,
        file: deciding?.file ?? null,
        takes: def.takes,
        takesWords: takesWords(def),
        none: def.none ?? null,
        orNone: def.orNone === true,
        levels: read.filter((l) => l.level !== "shipped").map((l) => l.level),
        ...(named !== undefined ? { connection: named } : {}),
        passed,
      };
    };
    if (!def.perConnection) {
      settings.push(view());
      continue;
    }
    // Each connection under each name or id a file sets it by, or by its id where none does; then the names no connection has.
    const named = new Set(read.flatMap((l) => connectionsNamed(l.config, def)));
    for (const c of connections) {
      const keys = [c.id, c.name].filter((key) => named.has(key));
      for (const key of keys.length === 0 ? [c.id] : keys) settings.push(view(key, c));
    }
    const known = new Set(connections.flatMap((c) => [c.id, c.name]));
    for (const key of [...named].filter((key) => !known.has(key)).sort()) settings.push(view(key, null));
  }
  return { chat, files: levels.map((l) => ({ level: l.level, file: l.file, problem: l.problem })), settings };
}

/** `GET` and `PUT /api/v1/settings`. */
export function settingsRoutes(deps: SettingsDeps) {
  const now = async (chat: string | null): Promise<SettingsReply> => reply(chat, await readLevels(await deps.levels(chat)), deps.settings, await deps.connections());
  return [
    route({
      method: "GET",
      path: SETTINGS_PATH,
      access: "page",
      group: "settings",
      does: "Every setting RPH and RPE read, with the value in force for a chat (or for every chat), its default, and the level and file it comes from.",
      query: { chat: shape.optional(T, "The chat whose levels are read; left out or empty, the levels every chat shares.") },
      reply: settingsReply,
      handle: ({ query }) => now(query.chat || null),
    }),
    route({
      method: "PUT",
      path: SETTINGS_PATH,
      access: "page",
      group: "settings",
      does: "Writes one setting into one level's config file, as the user would write it, and answers every setting as it then stands.",
      body: settingsWrite,
      reply: settingsReply,
      handle: async ({ body: asked }) => {
        if (asked.value === undefined && asked.none !== true) throw new RouteError(400, 'Send the setting\'s "value" (null takes the key away at that level), or "none": true to set ~.');
        const body = { level: asked.level, chat: asked.chat ?? null, key: asked.key, value: asked.value ?? null, none: asked.none === true };
        if (body.level === "shipped") throw new RouteError(400, "The shipped file is never written: set the value at the global level, or a chat's.");
        if (body.level === "chat" && body.chat === null) throw new RouteError(400, 'Name the chat whose level this is: "chat": "<its id>".');
        const found = settingOfKey(deps.settings, body.key);
        if (found === null) throw new RouteError(400, `RPE reads no setting "${body.key}".`);
        const { def, connection } = found;
        if (def.levels !== undefined && !def.levels.includes(body.level)) throw new RouteError(400, `${body.key} is read from the ${def.levels.filter((l) => l !== "shipped").join(" and ")} level alone.`);
        let value: JsonValue | undefined;
        if (body.none) {
          if (def.orNone !== true) throw new RouteError(400, `${body.key} takes no ~: it takes ${takesWords(def)}.`);
          value = null;
        } else if (body.value !== null) {
          const taken = takenValue(def, body.value, body.key, true);
          if (!taken.ok) throw new RouteError(400, taken.why);
          value = taken.value;
        }
        const target = (await deps.levels(body.chat)).find((l) => l.level === body.level);
        if (target === undefined) throw new RouteError(409, body.level === "chat" ? "That chat has no folder in RPE yet: it gets one at its first turn on RPE." : `The ${body.level} level has no config file.`);
        await configWrites(target.disk).run(async () => {
          const text = (await readText(target.disk)) ?? "";
          let doc: Record<string, unknown>;
          try {
            doc = yamlMapping(text, target.file);
          } catch (error) {
            throw new RouteError(409, error instanceof Error ? error.message : String(error));
          }
          const full = pathOf(def, connection);
          const parent = full.slice(0, -1);
          let path = full;
          let written = value;
          // A key written short at this level (`hold: true` for `hold: { on: true }`): its own setting is written in its place, and
          // another key of that mapping is written with the short one's value kept beside it.
          const above = valueAt(doc as Mapping, parent);
          if (above !== undefined && !isMapping(above)) {
            const short = deps.settings.find((d) => d.short === true && JSON.stringify(pathOf(d).slice(0, -1)) === JSON.stringify(parent));
            if (short === def) path = parent;
            else if (short !== undefined) {
              path = parent;
              written = { [pathOf(short).at(-1) ?? ""]: above, ...(value === undefined ? {} : { [full.at(-1) ?? ""]: value }) };
            }
          }
          await mkdir(dirname(target.disk), { recursive: true });
          await writeWhole(target.disk, withKeyAt(text, path, written, target.file));
        });
        return await now(body.chat);
      },
    }),
  ] as const;
}
