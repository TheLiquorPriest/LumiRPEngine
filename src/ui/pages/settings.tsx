// Settings (plan §14, §5.2, §5.4 "Config"): every setting RPH and RPE read, with the value in force, its
// shipped default, and the level and file that decide it; a value set at a level, or taken away there so
// the level above shows through; the settings set per connection, once for each connection, under it.
// With a chat open its own level is there too. What RPE refuses is shown in its words.

import type { LayerLevel } from "rp-harness/contract";
import { useEffect, useState } from "preact/hooks";
import type { JsonValue } from "../../shared/json";
import type { SettingsReply, SettingTakes, SettingView } from "../api";
import { useApp } from "../app";
import { Banner, Button, Fold, PageHeader } from "../atoms";
import type { RpeClient } from "../client";
import { errorWords, LEVEL_WORDS, num } from "../words";

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

/** A list's items one after the other. */
const listed = (items: readonly JsonValue[], gap: string): string => items.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(gap);

/** A value as the page says it: yes or no, a list item by item, and no value as what it means. */
export function valueWords(value: JsonValue, none: string | null): string {
  if (value === null) return none ?? "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return num(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.length === 0 ? "none listed" : listed(value, ", ");
  return JSON.stringify(value);
}

/** A setting being changed: the level it is set at, and its value as typed. */
export interface SettingDraft {
  key: string;
  level: LayerLevel;
  text: string;
}

/**
 * The value typed, as the setting takes it: a number where the text is one, yes or no, a list one name
 * per line. Anything else goes as typed, for RPE to take or refuse in its own words.
 */
export function draftValue(takes: SettingTakes, text: string): JsonValue {
  const trimmed = text.trim();
  if (takes.type === "whole" || takes.type === "number") return trimmed !== "" && Number.isFinite(Number(trimmed)) ? Number(trimmed) : text;
  if (takes.type === "yesNo") return trimmed === "yes" ? true : trimmed === "no" ? false : text;
  if (takes.type === "texts") return text.split("\n").flatMap((line) => (line.trim() === "" ? [] : [line.trim()]));
  return text;
}

/** The value in force as the change form starts with it. */
function draftText(value: JsonValue): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  return Array.isArray(value) ? listed(value, "\n") : JSON.stringify(value);
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
      show({ ...shown, refusal: null, editing: s === undefined ? null : { key: s.key, level, text: draftText(s.value) } });
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
  if (takes.type === "texts") return <textarea class="lre-input" spellcheck={false} value={draft.text} onInput={(event) => set(event.currentTarget.value)} />;
  return <input class="lre-input" inputMode={takes.type === "text" ? undefined : "decimal"} spellcheck={false} autoComplete="off" value={draft.text} onInput={(event) => set(event.currentTarget.value)} />;
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
        <span class="k">{s.key}</span>
        <span class="v">{valueWords(s.value, s.none)}</span>
      </div>
      <p class="rpe-meta">
        {from} · default: {valueWords(s.default, s.none)} · takes {s.takesWords}
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
            <select class="lre-input" onChange={(event) => props.onDraft({ ...editing, level: s.levels.find((l) => l === event.currentTarget.value) ?? editing.level })}>
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
            {s.takes.type === "texts" ? <span class="lre-field-help">One on each line.</span> : null}
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
  useEffect(() => {
    setShown(NO_SETTINGS);
    const made = settingsControl(settingsCalls(app.client, chat), setShown);
    setControl(made);
    return () => made.stop();
  }, [chat]);
  return (
    <SettingsView
      chat={chat}
      shown={shown}
      onEdit={(key) => control?.edit(key)}
      onDraft={(draft) => control?.draft(draft)}
      onSave={() => control?.save()}
      onNone={() => control?.none()}
      onTakeAway={(key, level) => control?.takeAway(key, level)}
    />
  );
}
