// Settings (plan §14, §5.2, §5.4 "Config"): every setting RPH and RPE read, with the value in force, its
// shipped default, and the level and file that decide it; a value set at a level, or taken away there so
// the level above shows through; the settings set per connection, once for each connection, under it.
// With a chat open its own level is there too. What RPE refuses is shown in its words.

import { useEffect, useState } from "preact/hooks";
import type { LayerLevel, SettingsReply, SettingView, Takes } from "../../shared/api";
import { isRecord, type JsonValue } from "../../shared/json";
import { useApp } from "../app";
import { Banner, Button, Fold, PageHeader } from "../atoms";
import type { RpeClient } from "../client";
import { errorWords, LEVEL_WORDS, num } from "../words";
import { type BuildsReader, type BuildsShown, BuildsView, NO_BUILDS, readBuilds, readSession, SessionLine } from "./builds";

// ---------------------------------------------------------------- the calls

export interface SettingsCalls {
  read(): Promise<SettingsReply>;
  /** Writes `key` at `level`: `value` null takes it away there, and `none` sets `~`. */
  write(level: LayerLevel, key: string, value: JsonValue, none: boolean): Promise<SettingsReply>;
}

/** The calls for `chat` (null: the levels every chat shares). */
export function settingsCalls(client: Pick<RpeClient, "call">, chat: string | null): SettingsCalls {
  return {
    read: () => client.call("GET /api/v1/settings", {}, { query: chat === null ? {} : { chat } }),
    write: (level, key, value, none) => client.call("PUT /api/v1/settings", {}, { body: { level, chat, key, value, none } }),
  };
}

// ---------------------------------------------------------------- values as said and typed

/** A list's items one after the other: a record by its fields' values. */
const listed = (items: readonly JsonValue[], gap: string): string => items.map((item) => (typeof item === "string" ? item : isRecord(item) ? Object.values(item).map((v) => valueWords(v as JsonValue, null)).join(" → ") : JSON.stringify(item))).join(gap);

/** A value as the page says it: yes or no, a list item by item, a table entry by entry, and no value as what it means. */
export function valueWords(value: JsonValue, none: string | null): string {
  if (value === null) return none ?? "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return num(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length === 0 ? "none listed" : listed(value, ", ");
  const entries = Object.entries(value);
  return entries.length === 0 ? "none listed" : entries.map(([name, v]) => `${name}: ${valueWords(v, null)}`).join("; ");
}

/** A setting being changed: the level it is set at, and its value as typed. */
export interface SettingDraft {
  key: string;
  level: LayerLevel;
  text: string;
}

/** A line's parts between `by`, each trimmed, the blank ones left out. */
const parts = (line: string, by: string): string[] => line.split(by).flatMap((part) => (part.trim() === "" ? [] : [part.trim()]));

/** The lines of a text that hold something. */
const lines = (text: string): string[] => text.split("\n").filter((line) => line.trim() !== "");

/**
 * The value typed, as the setting takes it: a number where the text is one, yes or no, a list one name
 * per line, a table one entry per line (`swipe: SWIPE, RECAP`), a list of records one per line, its
 * fields in order between `|`. Anything else goes as typed, for RPE to take or refuse in its own words.
 */
export function draftValue(takes: Takes, text: string): JsonValue {
  const trimmed = text.trim();
  if (takes.type === "whole" || takes.type === "number") return trimmed !== "" && Number.isFinite(Number(trimmed)) ? Number(trimmed) : text;
  if (takes.type === "yesNo") return trimmed === "yes" ? true : trimmed === "no" ? false : text;
  if (takes.type === "texts") return lines(text).map((line) => line.trim());
  if (takes.type === "table") {
    const entries = lines(text);
    // A list for every name, where the setting takes one and no line names an entry.
    if (takes.whole === true && entries.every((line) => !line.includes(":"))) return entries.map((line) => line.trim());
    return Object.fromEntries(entries.map((line) => (line.includes(":") ? [line.slice(0, line.indexOf(":")).trim(), parts(line.slice(line.indexOf(":") + 1), ",")] : [line.trim(), []])));
  }
  if (takes.type === "records") return lines(text).map((line) => Object.fromEntries(takes.fields.map((field, i) => [field.name, line.split("|")[i]?.trim() ?? ""])));
  return text;
}

/** A value as the change form starts with it, by what the setting takes. */
function draftText(value: JsonValue, takes: Takes): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  if (takes.type === "records" && Array.isArray(value)) return value.map((item) => (isRecord(item) ? takes.fields.map((field) => valueWords((item[field.name] ?? "") as JsonValue, null)).join(" | ") : JSON.stringify(item))).join("\n");
  if (takes.type === "table" && isRecord(value)) return Object.entries(value).map(([name, v]) => `${name}: ${Array.isArray(v) ? listed(v, ", ") : valueWords(v as JsonValue, null)}`).join("\n");
  return Array.isArray(value) ? listed(value, "\n") : JSON.stringify(value);
}

/** What a setting is changed from at a level: for one every level of which applies, that level's own; else the value in force. */
function startingValue(s: SettingView, level: LayerLevel): JsonValue {
  return s.joined ? (s.set.find((at) => at.level === level)?.value ?? s.default) : s.value;
}

/** How to type a value, where its field does not say. */
function typingHelp(takes: Takes): string | null {
  if (takes.type === "texts") return "One on each line.";
  if (takes.type === "table") return `One on each line, a name, a colon, then its files between commas: swipe: SWIPE, RECAP.${takes.whole === true ? " Or one file on each line, for every name." : ""}`;
  if (takes.type === "records") return `One on each line: ${takes.fields.map((f) => f.name).join(" | ")}.`;
  return null;
}

// ---------------------------------------------------------------- what the page holds

/** What the page shows: the settings once read, or why they could not be; the one being changed; whether a change is under way, and RPE's refusal of the last one, under its setting. */
export interface SettingsShown {
  reply: SettingsReply | null;
  loading: boolean;
  problem: string | null;
  editing: SettingDraft | null;
  busy: boolean;
  refusal: { key: string; words: string } | null;
}

export const NO_SETTINGS: SettingsShown = { reply: null, loading: true, problem: null, editing: null, busy: false, refusal: null };

export interface SettingsControl {
  /** Starts changing a setting, from the value in force at the level that decides it; null stops. */
  edit(key: string | null): void;
  draft(draft: SettingDraft): void;
  save(): void;
  /** Sets `~` at the level being changed. */
  none(): void;
  /** Takes a setting away at a level, so the level above shows through. */
  takeAway(key: string, level: LayerLevel): void;
  stop(): void;
}

/** The page's state over its calls: the settings at once, and as RPE answers each write; nothing once `stop()` is called. */
export function settingsControl(calls: SettingsCalls, onChange: (shown: SettingsShown) => void): SettingsControl {
  let shown = NO_SETTINGS;
  let alive = true;
  const show = (next: SettingsShown): void => {
    if (!alive) return;
    shown = next;
    onChange(next);
  };
  calls.read().then(
    (reply) => show({ ...shown, reply, loading: false, problem: null }),
    (error: unknown) => show({ ...shown, loading: false, problem: errorWords(error) }),
  );
  const write = (key: string, level: LayerLevel, value: JsonValue, none: boolean): void => {
    show({ ...shown, busy: true, refusal: null });
    calls.write(level, key, value, none).then(
      (reply) => show({ ...shown, reply, busy: false, editing: null }),
      (error: unknown) => show({ ...shown, busy: false, refusal: { key, words: errorWords(error) } }),
    );
  };
  return {
    edit(key) {
      const s = key === null ? undefined : shown.reply?.settings.find((one) => one.key === key);
      // Changed where it is decided, when that is a level it may be set at here; else at the user's own.
      const level = s?.from !== null && s?.from !== undefined && s.levels.includes(s.from) ? s.from : (s?.levels[0] ?? "global");
      show({ ...shown, refusal: null, editing: s === undefined ? null : { key: s.key, level, text: draftText(startingValue(s, level), s.takes) } });
    },
    draft(draft) {
      show({ ...shown, editing: draft });
    },
    save() {
      const draft = shown.editing;
      const s = shown.reply?.settings.find((one) => one.key === draft?.key);
      if (draft !== null && s !== undefined) write(draft.key, draft.level, draftValue(s.takes, draft.text), false);
    },
    none() {
      const draft = shown.editing;
      if (draft !== null) write(draft.key, draft.level, null, true);
    },
    takeAway(key, level) {
      write(key, level, null, false);
    },
    stop() {
      alive = false;
    },
  };
}

// ---------------------------------------------------------------- the view

export interface SettingsViewProps {
  chat: string | null;
  shown: SettingsShown;
  onEdit(key: string | null): void;
  onDraft(draft: SettingDraft): void;
  onSave(): void;
  onNone(): void;
  onTakeAway(key: string, level: LayerLevel): void;
  /** The builds that meet at RPE, and "Update now". */
  builds?: { shown: BuildsShown; onUpdate(): void };
  /** When the web key this browser holds ends (null: it has no end, or this is not the web shell). */
  sessionEnds?: number | null;
}

/** The field a setting's value is typed in, by what it takes. */
function ValueField(props: { setting: SettingView; draft: SettingDraft; onDraft(draft: SettingDraft): void }) {
  const { setting, draft } = props;
  const set = (text: string): void => props.onDraft({ ...draft, text });
  const takes = setting.takes;
  if (takes.type === "oneOf" || takes.type === "yesNo") {
    const values = takes.type === "oneOf" ? takes.values : ["yes", "no"];
    return (
      <select class="lre-input" onChange={(event) => set(event.currentTarget.value)}>
        {draft.text === "" ? (
          <option value="" selected>
            Choose one
          </option>
        ) : null}
        {values.map((value) => (
          <option key={value} value={value} selected={value === draft.text}>
            {value}
          </option>
        ))}
      </select>
    );
  }
  if (takes.type === "texts" || takes.type === "table" || takes.type === "records") return <textarea class="lre-input" spellcheck={false} value={draft.text} onInput={(event) => set(event.currentTarget.value)} />;
  return <input class="lre-input" inputMode={takes.type === "text" ? undefined : "decimal"} spellcheck={false} autoComplete="off" value={draft.text} onInput={(event) => set(event.currentTarget.value)} />;
}

/** A list of records as a table: a column for each field, a row for each record. It fills the row's width and wraps a long value, so it fits a phone. */
function RecordsTable(props: { fields: readonly { name: string; about: string }[]; value: JsonValue }) {
  const records = Array.isArray(props.value) ? props.value.flatMap((item) => (isRecord(item) ? [item as { readonly [field: string]: JsonValue }] : [])) : [];
  if (records.length === 0) return <p class="rpe-meta">None listed.</p>;
  const cell = { textAlign: "left", overflowWrap: "anywhere", padding: "2px 8px 2px 0", verticalAlign: "top" } as const;
  return (
    <table class="rpe-records" style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
      <thead>
        <tr>
          {props.fields.map((f) => (
            <th key={f.name} title={f.about} class="rpe-meta" style={cell}>
              {f.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((record, i) => (
          <tr key={i}>
            {props.fields.map((f) => (
              <td key={f.name} style={cell}>
                {valueWords((record[f.name] ?? null) as JsonValue, "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SettingRow(props: SettingsViewProps & { setting: SettingView }) {
  const { setting: s, shown } = props;
  const editing = shown.editing !== null && shown.editing.key === s.key ? shown.editing : null;
  const refusal = shown.refusal !== null && shown.refusal.key === s.key ? shown.refusal.words : null;
  // It is taken away where it is decided, when that is a level it may be set at here.
  const decides = s.from !== null && s.levels.includes(s.from) ? s.from : null;
  const from = s.from === null ? "no file sets it" : `set in ${s.file ?? LEVEL_WORDS[s.from]} (${LEVEL_WORDS[s.from]})`;
  return (
    <li class="lre-stack rpe-setting" data-setting={s.key}>
      <div class="lre-row">
        <span class="k">{s.name}</span>
        <span class="v">{s.takes.type === "records" ? null : valueWords(s.value, s.none)}</span>
      </div>
      <p class="rpe-line rpe-about">{s.about}</p>
      {s.takes.type === "records" ? <RecordsTable fields={s.takes.fields} value={s.value} /> : null}
      {s.joined ? (
        <ul class="rpe-levels">
          {s.set.map((at) => (
            <li key={at.level} data-level={at.level}>
              <span class="k">{`${at.file} (${LEVEL_WORDS[at.level]})`}</span> <span class="v">{valueWords(at.value, s.none)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p class="rpe-meta">
        <code>{s.key}</code> · {from} · default: {valueWords(s.default, s.none)} · takes {s.takesWords} · a change holds {s.effectWords} · {s.row === null ? "beyond Appendix D.1, for the owner's approval" : `Appendix D.1: ${s.row}`}
      </p>
      {s.passed === null ? null : (
        <p class="rpe-line rpe-note">
          A file sets it to {valueWords(s.passed.value, null)}, which is not taken: {s.passed.why}
        </p>
      )}
      {editing === null ? (
        <div class="lre-inline rpe-wrap">
          <Button small onClick={() => props.onEdit(s.key)}>
            Change
          </Button>
          {decides === null ? null : (
            <Button small kind="ghost" busy={shown.busy} onClick={() => props.onTakeAway(s.key, decides)}>
              {`Remove it from ${s.file ?? LEVEL_WORDS[decides]}`}
            </Button>
          )}
        </div>
      ) : (
        <div class="lre-stack">
          <label class="lre-field">
            <span class="label">Set at</span>
            {/* A select's starting choice is its option marked selected: Preact gives a select no defaultValue. */}
            <select class="lre-input" onChange={(event) => {
              const level = s.levels.find((l) => l === event.currentTarget.value) ?? editing.level;
              // A setting every level of which applies is changed from that level's own value.
              props.onDraft({ ...editing, level, ...(s.joined ? { text: draftText(startingValue(s, level), s.takes) } : {}) });
            }}>
              {s.levels.map((level) => (
                <option key={level} value={level} selected={level === editing.level}>
                  {LEVEL_WORDS[level]}
                </option>
              ))}
            </select>
          </label>
          <label class="lre-field">
            <span class="label">Value</span>
            <ValueField setting={s} draft={editing} onDraft={props.onDraft} />
            {typingHelp(s.takes) === null ? null : <span class="lre-field-help">{typingHelp(s.takes)}</span>}
          </label>
          <div class="lre-inline rpe-wrap">
            <Button small kind="primary" busy={shown.busy} onClick={props.onSave}>
              Save
            </Button>
            {s.orNone ? (
              <Button small busy={shown.busy} onClick={props.onNone}>
                {`Set it to ~ (${s.none ?? "none"})`}
              </Button>
            ) : null}
            <Button small kind="ghost" onClick={() => props.onEdit(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {refusal === null ? null : (
        <Banner tone="neg" icon="alert" title="RPE did not make that change">
          <span>{refusal}</span>
        </Banner>
      )}
    </li>
  );
}

/** The settings in groups, in the order RPE lists them: those set per connection under their connection, the rest by the first part of their key. */
function groupsOf(settings: readonly SettingView[]): { title: string; settings: SettingView[] }[] {
  const groups = new Map<string, SettingView[]>();
  for (const s of settings) {
    const title = s.connection === undefined ? (s.key.split(".")[0] ?? s.key) : s.connection === null ? "Names no connection there is now" : `Connection: ${s.connection.name}`;
    groups.set(title, [...(groups.get(title) ?? []), s]);
  }
  return [...groups].map(([title, inside]) => ({ title, settings: inside }));
}

export function SettingsView(props: SettingsViewProps) {
  const { shown } = props;
  const reply = shown.reply;
  return (
    <div class="lre-stack rpe-page" data-page="settings" data-chat={props.chat ?? undefined}>
      <PageHeader title="Settings" sub={props.chat === null ? "The settings RPE's agents run under, at your own level." : "The settings RPE's agents run under in this chat."} />
      <SessionLine ends={props.sessionEnds ?? null} />
      {props.builds === undefined ? null : <BuildsView {...props.builds} />}
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The settings could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {reply === null ? (
        shown.loading ? (
          <p class="lre-muted rpe-line">Reading the settings…</p>
        ) : null
      ) : (
        <>
          <p class="rpe-meta">Read from {reply.files.map((f) => `${f.file} (${LEVEL_WORDS[f.level]})`).join(", ")}.</p>
          {reply.files.flatMap((f) =>
            f.problem === null
              ? []
              : [
                  <Banner key={f.file} tone="warn" icon="alert" title={`${f.file} could not be read`}>
                    <span>{f.problem}</span>
                  </Banner>,
                ],
          )}
          {groupsOf(reply.settings).map((group) => (
            <Fold key={group.title} open summary={`${group.title} (${group.settings.length})`}>
              <ul class="lre-stack rpe-plain">
                {group.settings.map((s) => (
                  <SettingRow key={s.key} {...props} setting={s} />
                ))}
              </ul>
            </Fold>
          ))}
          {reply.facts.length === 0 ? null : (
            <Fold summary={`The install (${reply.facts.length})`}>
              <p class="rpe-meta">Set by the command line (rpe up, rpe lumiverse), never on this page.</p>
              <ul class="lre-stack rpe-plain">
                {reply.facts.map((fact) => (
                  <li key={fact.key} class="rpe-setting" data-fact={fact.key}>
                    <strong>{fact.name}</strong>: {typeof fact.value === "number" ? String(fact.value) : valueWords(fact.value, "not set")}
                    <span class="rpe-meta">{fact.from === "environment" ? " (given by the environment, over config.json)" : fact.from === "install" ? " (where the install put it)" : " (config.json)"}</span>
                  </li>
                ))}
              </ul>
            </Fold>
          )}
        </>
      )}
    </div>
  );
}

export function SettingsPage(props: { chat: string | null }) {
  const app = useApp();
  const { chat } = props;
  const [shown, setShown] = useState<SettingsShown>(NO_SETTINGS);
  const [control, setControl] = useState<SettingsControl | null>(null);
  const [builds, setBuilds] = useState<BuildsShown>(NO_BUILDS);
  const [buildsReader, setBuildsReader] = useState<BuildsReader | null>(null);
  const [sessionEnds, setSessionEnds] = useState<number | null>(null);
  useEffect(() => {
    setShown(NO_SETTINGS);
    const made = settingsControl(settingsCalls(app.client, chat), setShown);
    setControl(made);
    return () => made.stop();
  }, [chat]);
  useEffect(() => {
    const reading = readBuilds(app.client, setBuilds);
    setBuildsReader(reading);
    const forget = app.shell === "web" ? readSession(app.client, setSessionEnds) : () => undefined;
    return () => {
      reading.stop();
      forget();
    };
  }, []);
  return (
    <SettingsView
      chat={chat}
      shown={shown}
      onEdit={(key) => control?.edit(key)}
      onDraft={(draft) => control?.draft(draft)}
      onSave={() => control?.save()}
      onNone={() => control?.none()}
      onTakeAway={(key, level) => control?.takeAway(key, level)}
      builds={{ shown: builds, onUpdate: () => buildsReader?.update() }}
      sessionEnds={sessionEnds}
    />
  );
}
