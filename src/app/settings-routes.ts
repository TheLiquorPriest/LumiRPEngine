// The Settings page's routes (plan §14: "both config files as forms… every limit editable"; §5.2,
// §5.4 "Config"; §2.1 point 5): every setting of the registry (`App.settings`, every area's list and
// RPH's), with the value in force for a chat, its default, the level and file it comes from, what each
// level sets, when a change takes effect, one line on what it does, the section and group the page
// finds it in, a number's unit and the advice the page gives beside a value past what is usual; a
// setting set per connection once for each connection, and one set per agent once for each definition
// in force; and a value written into the config file of one level, as the user would write it.
//
// The levels are those of the agents' tree that have a config file, farthest first: the shipped
// `RPE-global.yml`, the user's own, and the chat's `RPE.yml`. They are read by the one reader of the
// config levels (`config-read.ts`), as every area reads them. The shipped one is never written. A
// write changes only the key's own lines, so the user's comments and the rest of the file stay as they
// were. The write is a function as well as a route (`writeSetting`), for the parts of RPE that write a
// setting for the user.

import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import type { JsonValue, LayerLevel } from "rp-harness/contract";
import type { InstallFact } from "./config";
import { diskTexts, type LevelFile, readConfig } from "./config-read";
import { oneFileAtATime, readText, writeWhole } from "./disk";
import { type Exactly, type Holds, type Infer, type Mutually, route, RouteError, shape } from "./routes";
import { type Effect, EFFECT_WORDS, groupOf, isMapping, keyFor, type Mapping, pathOf, SECTIONS, type Setting, type SettingAdvice, setFor, settingOfKey, type Takes, takenValue, takesWords, unitOf, valueAt } from "./setting-list";
import { LayoutRefused, withKeyAt, yamlMapping } from "./yaml";

export const SETTINGS_PATH = "/api/v1/settings";

export interface SettingsDeps {
  /** The registry: every setting RPH and RPE read. */
  settings: readonly Setting[];
  /**
   * The config files of a chat's levels, farthest first; for no chat, those every chat shares. A level the chat has no folder for yet is
   * left out, unless `make` asks for it: a write at a chat's level makes the chat's folder as its first turn would, so that turn reads it.
   */
  levels(chat: string | null, make?: boolean): Promise<LevelFile[]>;
  /** The model layer's connections, for the settings set per connection. */
  connections(): Promise<{ id: string; name: string }[]>;
  /** The names of the agent definitions in force for a chat (null: as a new chat takes them), for the settings set per agent. */
  definitions(user: string, chat: string | null): Promise<string[]>;
  /** The install's facts, as config.json and the environment give them: listed, never written here. */
  facts(): InstallFact[];
}

const T = shape.text();
const layerLevel = shape.named("LayerLevel", "A level of the agents' tree: what ships, the user's own, a character's, a chat's.", shape.oneOf("shipped", "global", "character", "chat"));
const rphTakes = shape.named(
  "SettingTakes",
  "One of RPH's shapes of a value: a whole number, at least `least` and at most `most` where it has one; a number, at least `least` where it has one and at most `most` where it has one; one of `values`; yes or no; a line of text that is not blank; or a list of names.",
  shape.union(
    shape.object({ type: shape.literal("whole"), least: shape.number(), most: shape.optional(shape.number()) }),
    shape.object({ type: shape.literal("number"), least: shape.optional(shape.number()), most: shape.optional(shape.number()) }),
    shape.object({ type: shape.literal("oneOf"), values: shape.list(T, { readonly: true }) }),
    shape.object({ type: shape.literal("yesNo") }),
    shape.object({ type: shape.literal("text") }),
    shape.object({ type: shape.literal("texts") }),
  ),
);
const takes = shape.named(
  "Takes",
  "What a level may set a setting to: one of RPH's shapes; a table of names, each to a value of `of` (with `whole`, such a value alone for every name); or a list of records, each holding every field.",
  shape.union(
    rphTakes,
    shape.object({ type: shape.literal("table"), of: rphTakes, whole: shape.optional(shape.literal(true)) }),
    shape.object({ type: shape.literal("records"), fields: shape.list(shape.object({ name: T, takes: rphTakes, about: T }), { readonly: true }) }),
  ),
);
const effect = shape.named("Effect", "When a change to a setting is in force: at its next use, from the next turn, or from RPE's next start.", shape.oneOf("use", "turn", "start"));
// The registry's own types, which the readers read by: the declaration says the same. Their fields are readonly; a reply's carry them written.
type Written<T> = T extends readonly (infer I)[] ? readonly Written<I>[] : T extends object ? { -readonly [K in keyof T]: Written<T[K]> } : T;
type LevelMirrored = Holds<Exactly<Infer<typeof layerLevel>, LayerLevel>>;
type TakesMirrored = Holds<Mutually<Infer<typeof takes>, Written<Takes>>>;
type EffectMirrored = Holds<Exactly<Infer<typeof effect>, Effect>>;

const advice = shape.named(
  "Advice",
  "A line the Settings page shows beside a setting's control while its value is below `below` or above `above`, saying what such a value does; the value is taken all the same.",
  shape.object({ below: shape.optional(shape.number()), above: shape.optional(shape.number()), says: T }),
);
type AdviceMirrored = Holds<Mutually<Infer<typeof advice>, Written<SettingAdvice>>>;

const setForView = shape.named(
  "SetFor",
  "What a setting set for one connection or one agent at a time is set for here: a connection or an agent definition, the name or id its key writes, the name the page shows, and whether one is in force now by that name.",
  shape.object({ kind: shape.oneOf("connection", "definition"), key: T, name: T, known: shape.yesNo() }),
);

const settingView = shape.named(
  "SettingView",
  "A setting as the Settings page shows it.",
  shape.object({
    key: shape.field(T, "As a config file writes it; one set for a connection or an agent names it."),
    pattern: shape.field(T, "The key as declared, with `<connection>` or `<definition>` where it names one: the same for every connection's or agent's."),
    name: shape.field(T, "What the page calls it."),
    about: shape.field(T, "One line on what it does."),
    section: shape.field(T, "The section of the page it is shown in."),
    group: shape.field(T, "The group within its section, in plain words."),
    unit: shape.field(shape.nullable(T), "The unit a number is in (ms, seconds, bytes, tokens…), from the end of its key; null for a count and for anything not a number."),
    effect: shape.field(effect, "When a change to it is in force."),
    effectWords: shape.field(T, "The same, in words: at its next use, from the next turn, from RPE's next start."),
    row: shape.field(shape.nullable(T), "Its row of Appendix D.1; null for a value beyond D.1, listed for the owner's approval."),
    value: shape.field(shape.json(), "The value in force; for a setting every level of which applies, all of theirs together."),
    default: shape.json(),
    from: shape.field(shape.nullable(layerLevel), "The level whose file decides the value in force; null where no file does, and the default holds."),
    file: shape.field(shape.nullable(T), "That level's file, as the Files page names it."),
    set: shape.field(shape.list(shape.object({ level: layerLevel, file: T, value: shape.json() })), "What each level's file sets, farthest first; a level that sets nothing is left out."),
    joined: shape.field(shape.yesNo(), "Every level's value applies, not the nearest alone."),
    takes,
    takesWords: shape.field(T, "What it takes, in words."),
    none: shape.field(shape.nullable(T), "What no value means, where the default is none or `~` may be set."),
    unset: shape.field(shape.nullable(T), "What holds where no level sets it, where that is not what `~` means: a definition's own value for one set per agent."),
    orNone: shape.field(shape.yesNo(), "`~` may be set (`none: true` in a write)."),
    levels: shape.field(shape.list(layerLevel), "The levels it may be set at here."),
    setFor: shape.optional(setForView, "For one set per connection or per agent, the connection or definition this one is for."),
    advice: shape.field(shape.list(advice), "The lines the page shows while a value passes what is usual."),
    passed: shape.field(shape.nullable(shape.object({ value: shape.json(), why: T })), "A value a file sets that the setting does not take, and why: the default holds in its place."),
  }),
);
export type SettingView = Infer<typeof settingView>;

const installFact = shape.named(
  "InstallFact",
  "One of the install's facts, which the command line sets and no page writes: its key in config.json, what it is, its value, and where it was given (config.json, the environment, or where the install put the data folder).",
  shape.object({ key: T, name: T, value: shape.json(), from: shape.oneOf("config.json", "environment", "install") }),
);
type FactMirrored = Holds<Exactly<Infer<typeof installFact>, InstallFact>>;

const settingsReply = shape.named(
  "SettingsReply",
  "Each section of the page in order with one line on it; each level's config file, farthest first, with what is wrong with one that cannot be read (its settings are then passed over); every setting; and the install's facts.",
  shape.object({
    chat: shape.nullable(T),
    sections: shape.list(shape.object({ title: T, about: T })),
    files: shape.list(shape.object({ level: layerLevel, file: T, problem: shape.nullable(T) })),
    settings: shape.list(settingView),
    facts: shape.list(installFact),
  }),
);
export type SettingsReply = Infer<typeof settingsReply>;

const settingsWrite = shape.named(
  "SettingsWrite",
  "A key written at a level, a chat's naming the chat (left out or null: no chat): its value, null to take the key away at that level, or `none: true` to set `~`.",
  shape.object({ level: layerLevel, chat: shape.optional(shape.nullable(shape.text({ blank: false }))), key: shape.text({ blank: false }), value: shape.optional(shape.json()), none: shape.optional(shape.yesNo()) }),
);
export type SettingsWrite = Infer<typeof settingsWrite>;

/** Every setting as the levels' files stand now, for a chat's levels (null: those every chat shares). */
async function settingsNow(deps: SettingsDeps, user: string, chat: string | null): Promise<SettingsReply> {
  const files = await deps.levels(chat);
  // A page's read logs nothing: what it finds is in the reply.
  const read = readConfig(await diskTexts(files), null, deps.settings);
  const [connections, definitions] = await Promise.all([deps.connections(), deps.definitions(user, chat)]);
  const settings: SettingView[] = [];
  // In the order of the page's sections and of the groups within each; the registry's order within a group (`sort` keeps it).
  for (const def of [...deps.settings].sort((a, b) => groupOf(a).order - groupOf(b).order)) {
    const { section, group } = groupOf(def);
    const view = (named?: Infer<typeof setForView>): SettingView => {
      const name = named?.key;
      const deciding = read.deciding(def, name);
      const { value, passed } = read.read(def, name);
      return {
        key: keyFor(def, name),
        pattern: def.key,
        name: def.name,
        about: def.about,
        section,
        group,
        unit: unitOf(def),
        effect: def.effect,
        effectWords: EFFECT_WORDS[def.effect],
        row: def.row ?? null,
        value,
        default: def.default,
        from: deciding?.level ?? null,
        file: deciding?.file ?? null,
        set: read.setAt(def, name).map((s) => ({ level: s.level, file: s.file, value: s.value })),
        joined: def.joined === true,
        takes: def.takes as Written<Takes>,
        takesWords: takesWords(def),
        none: def.none ?? null,
        unset: def.unset ?? null,
        orNone: def.orNone === true,
        levels: read
          .levelsOf(def)
          .filter((l) => l.level !== "shipped")
          .map((l) => l.level),
        ...(named !== undefined ? { setFor: named } : {}),
        advice: (def.advice ?? []).map((a) => ({ ...a })),
        passed,
      };
    };
    const kind = setFor(def);
    const named = new Set(kind === null ? [] : read.named(def));
    if (kind === null) settings.push(view());
    else if (kind === "connection") {
      // Each connection under each name or id a file sets it by, or by its id where none does; then the names no connection has.
      for (const c of connections) {
        const keys = [c.id, c.name].filter((key) => named.has(key));
        for (const key of keys.length === 0 ? [c.id] : keys) settings.push(view({ kind, key, name: c.name, known: true }));
      }
      const known = new Set(connections.flatMap((c) => [c.id, c.name]));
      for (const key of [...named].filter((key) => !known.has(key)).sort()) settings.push(view({ kind, key, name: key, known: false }));
    } else {
      // Each definition in force, by its name; then the names a file sets it for that no definition in force has.
      for (const d of definitions) settings.push(view({ kind, key: d, name: d, known: true }));
      const known = new Set(definitions);
      for (const key of [...named].filter((key) => !known.has(key)).sort()) settings.push(view({ kind, key, name: key, known: false }));
    }
  }
  return { chat, sections: SECTIONS.map((s) => ({ ...s })), files: read.levels.map((l) => ({ level: l.level, file: l.file, problem: l.problem })), settings, facts: deps.facts() };
}

/**
 * Writes one setting into one level's config file, as the user would write it: only the key's own
 * lines change. Refused, in RPE's words, for a key no setting has, a level it is not read from, a value
 * it does not take, the shipped file, and a chat with no folder yet.
 */
export async function writeSetting(deps: Pick<SettingsDeps, "settings" | "levels">, asked: SettingsWrite): Promise<void> {
  if (asked.value === undefined && asked.none !== true) throw new RouteError(400, 'Send the setting\'s "value" (null takes the key away at that level), or "none": true to set ~.');
  const body = { level: asked.level, chat: asked.chat ?? null, key: asked.key, value: asked.value ?? null, none: asked.none === true };
  if (body.level === "shipped") throw new RouteError(400, "The shipped file is never written: set the value at the global level, or a chat's.");
  if (body.level === "chat" && body.chat === null) throw new RouteError(400, 'Name the chat whose level this is: "chat": "<its id>".');
  const found = settingOfKey(deps.settings, body.key);
  if (found === null) throw new RouteError(400, `RPE reads no setting "${body.key}".`);
  const { def, name } = found;
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
  const target = (await deps.levels(body.chat, body.level === "chat")).find((l) => l.level === body.level);
  if (target === undefined) throw new RouteError(409, `The ${body.level} level has no config file.`);
  await oneFileAtATime(target.disk, async () => {
    const text = (await readText(target.disk)) ?? "";
    let doc: Record<string, unknown>;
    try {
      doc = yamlMapping(text, target.file);
    } catch (error) {
      throw new RouteError(409, error instanceof Error ? error.message : String(error));
    }
    const full = pathOf(def, name);
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
    let spliced: string;
    try {
      spliced = withKeyAt(text, path, written, target.file);
    } catch (error) {
      // His file in a layout the splice does not follow: nothing is written, and the answer names the line.
      if (error instanceof LayoutRefused) throw new RouteError(409, error.message);
      throw error;
    }
    await mkdir(dirname(target.disk), { recursive: true });
    await writeWhole(target.disk, spliced);
  });
}

/** `GET` and `PUT /api/v1/settings`. */
export function settingsRoutes(deps: SettingsDeps) {
  return [
    route({
      method: "GET",
      path: SETTINGS_PATH,
      access: "page",
      group: "settings",
      does: "Every setting RPH and RPE read, with the value in force for a chat (or for every chat), its default, the level and file it comes from, when a change takes effect, what it does and where the page shows it; one set per connection or per agent once for each.",
      query: { chat: shape.optional(T, "The chat whose levels are read; left out or empty, the levels every chat shares.") },
      reply: settingsReply,
      handle: ({ user, query }) => settingsNow(deps, user, query.chat || null),
    }),
    route({
      method: "PUT",
      path: SETTINGS_PATH,
      access: "page",
      group: "settings",
      does: "Writes one setting into one level's config file, as the user would write it, and answers every setting as it then stands.",
      body: settingsWrite,
      reply: settingsReply,
      handle: async ({ user, body }) => {
        await writeSetting(deps, body);
        return await settingsNow(deps, user, body.chat ?? null);
      },
    }),
  ] as const;
}
