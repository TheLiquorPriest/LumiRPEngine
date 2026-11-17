// The control each kind of setting is changed with (plan §14, §2.1 point 5): a switch for on or off; the choices side by side, or a
// list where they are many; a number with its unit; a line of text, or a choice among his connections or definitions where it names
// one; a list of names as chips; a table of names to files, and a list of records, as rows. A choice or a switch is written at once;
// what is typed waits for Save (or Enter), with Cancel beside it. Where `~` may be set, its meaning is one more choice. Nothing here
// refuses a value: RPE takes or refuses it in its own words, and the advice beside a number is the row's.

import { useState } from "preact/hooks";
import { Button, IconButton, Seg } from "../../../frontend/components";
import type { LoreBooks, SettingView, Takes } from "../../../shared/api";
import { isRecord, type JsonValue } from "../../../shared/json";
import { Icon } from "../../icons";
import { noneWords } from "./model";

export interface ControlProps {
  setting: SettingView;
  /** What the control starts from at the level it writes. */
  start: JsonValue;
  busy: boolean;
  /** Writes a value at the level the row writes. */
  onWrite(value: JsonValue): void;
  /** Sets `~` there. */
  onNone(): void;
  /** What is typed and not yet saved, as a value, for the row's advice; undefined once it is saved or let go. */
  onDraft(value: JsonValue | undefined): void;
  /** The choices for a setting that names a connection or a definition. */
  choices: readonly string[] | null;
  /** His books, which `lore.books` is chosen among (null with no chat open). */
  books: LoreBooks | null;
}

/** The choice that stands for `~`, beside the values a setting takes. */
const NONE = "\u0000none";

/** What `~` means, short enough for a button: its own words, or "None" with them as its title. */
function noneLabel(s: SettingView): string {
  const words = noneWords(s, true);
  return words.length <= 22 ? words.charAt(0).toUpperCase() + words.slice(1) : "None";
}

/** Save and Cancel, shown while what is typed differs from what is set. */
function SaveCancel(props: { busy: boolean; ok: boolean; onSave(): void; onCancel(): void }) {
  return (
    <span class="lre-inline rpe-set-save">
      <Button size="sm" variant="primary" busy={props.busy} disabled={!props.ok} onClick={props.onSave}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={props.onCancel}>
        Cancel
      </Button>
    </span>
  );
}

/** Nothing sets it, and what then holds is not what `~` means (a definition's own value): neither `~` nor a value is chosen. */
const unsetNow = (props: ControlProps): boolean => props.start === null && props.setting.from === null && props.setting.unset !== null;

/** Choices side by side where they are few and short; else a list to pick from. `~` is one more choice where it may be set. */
function ChoiceControl(props: ControlProps & { values: readonly { value: string; label: string }[] }) {
  const { setting: s } = props;
  const current = props.start === null ? null : typeof props.start === "string" ? props.start : String(props.start);
  const options = [...props.values, ...(s.orNone ? [{ value: NONE, label: noneLabel(s), title: noneWords(s, true) }] : [])];
  const chosen = current ?? (s.orNone && !unsetNow(props) ? NONE : null);
  const pick = (value: string): void => {
    if (value === chosen) return;
    if (value === NONE) props.onNone();
    else props.onWrite(s.takes.type === "yesNo" ? value === "true" : value);
  };
  if (options.length <= 4 && options.every((o) => o.label.length <= 16)) return <Seg value={chosen} options={options} onChange={pick} label={s.name} disabled={props.busy} />;
  return (
    <select class="lre-input rpe-set-select" aria-label={s.name} disabled={props.busy} onChange={(event) => pick(event.currentTarget.value)}>
      {chosen === null ? (
        <option value="" selected>
          {s.unset !== null && unsetNow(props) ? s.unset.charAt(0).toUpperCase() + s.unset.slice(1) : "Choose one"}
        </option>
      ) : null}
      {current !== null && !options.some((o) => o.value === current) ? (
        <option value={current} selected>
          {current} (not one of these)
        </option>
      ) : null}
      {options.map((o) => (
        <option key={o.value} value={o.value} selected={o.value === chosen}>
          {o.value === NONE ? noneWords(s, true) : o.label}
        </option>
      ))}
    </select>
  );
}

/** On or off, written at once. */
function SwitchControl(props: ControlProps) {
  const on = props.start === true;
  return (
    <label class="rpe-switch">
      <input type="checkbox" role="switch" aria-label={props.setting.name} checked={on} disabled={props.busy} onChange={() => props.onWrite(!on)} />
      <span class="rpe-switch-track" aria-hidden="true" />
      <span>{on ? "On" : "Off"}</span>
    </label>
  );
}

/** What a typed number is, where it is one the setting's shape reads (spaces, commas and underscores between digits allowed); null where it is not. */
function typedNumber(takes: Takes, text: string): number | null {
  const trimmed = text.trim().replace(/[,_\s]/g, "");
  if (trimmed === "" || !Number.isFinite(Number(trimmed))) return null;
  const n = Number(trimmed);
  return takes.type === "whole" && !Number.isInteger(n) ? null : n;
}

/** A number with its unit beside it; where `~` may be set, its meaning and "A value" side by side above it (neither chosen while it is unset). */
function NumberControl(props: ControlProps) {
  const { setting: s } = props;
  const startText = typeof props.start === "number" ? String(props.start) : "";
  const startMode = props.start !== null || !s.orNone ? "value" : unsetNow(props) ? "unset" : "none";
  const [text, setText] = useState(startText);
  const [mode, setMode] = useState<"value" | "none" | "unset">(startMode);
  const wantValue = mode === "value";
  const n = typedNumber(s.takes, text);
  const dirty = wantValue && text.trim() !== startText;
  const cancel = (): void => {
    setText(startText);
    setMode(startMode);
    props.onDraft(undefined);
  };
  const save = (): void => {
    if (n === null) return;
    props.onDraft(undefined);
    props.onWrite(n);
  };
  return (
    <div class="lre-stack rpe-set-number">
      {s.orNone ? (
        <Seg
          value={mode === "unset" ? null : mode}
          options={[
            { value: "none", label: noneLabel(s), title: noneWords(s, true) },
            { value: "value", label: "A value" },
          ]}
          label={s.name}
          disabled={props.busy}
          onChange={(to) => {
            setMode(to);
            if (to === "value") return;
            props.onDraft(undefined);
            if (props.start !== null || unsetNow(props)) props.onNone();
          }}
        />
      ) : null}
      {wantValue ? (
        <div class="lre-inline rpe-set-numberline">
          <input
            class={n === null && text.trim() !== "" ? "lre-input rpe-set-input invalid" : "lre-input rpe-set-input"}
            inputMode={s.takes.type === "whole" ? "numeric" : "decimal"}
            aria-label={s.unit === null ? s.name : `${s.name}, in ${s.unit}`}
            spellcheck={false}
            autoComplete="off"
            value={text}
            disabled={props.busy}
            onInput={(event) => {
              const next = event.currentTarget.value;
              setText(next);
              const typed = typedNumber(s.takes, next);
              props.onDraft(next.trim() === startText || typed === null ? undefined : typed);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && dirty) save();
              if (event.key === "Escape") cancel();
            }}
          />
          {s.unit === null ? null : <span class="rpe-set-unit">{s.unit}</span>}
          {dirty ? <SaveCancel busy={props.busy} ok={n !== null} onSave={save} onCancel={cancel} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** A line of text; a choice among his connections or definitions where the setting names one. */
function TextControl(props: ControlProps) {
  const { setting: s } = props;
  const startText = typeof props.start === "string" ? props.start : "";
  const [text, setText] = useState(startText);
  if (props.choices !== null) return <ChoiceControl {...props} values={props.choices.map((c) => ({ value: c, label: c }))} />;
  const typed = text.trim();
  const dirty = typed !== startText;
  return (
    <div class="lre-inline rpe-set-textline">
      <input
        class="lre-input rpe-set-text"
        aria-label={s.name}
        spellcheck={false}
        autoComplete="off"
        value={text}
        disabled={props.busy}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && dirty && typed !== "") props.onWrite(typed);
          if (event.key === "Escape") setText(startText);
        }}
      />
      {dirty ? <SaveCancel busy={props.busy} ok={typed !== ""} onSave={() => props.onWrite(typed)} onCancel={() => setText(startText)} /> : null}
      {s.orNone && props.start !== null && !dirty ? (
        <Button size="sm" variant="ghost" busy={props.busy} title={noneWords(s, true)} onClick={props.onNone}>
          {noneLabel(s)}
        </Button>
      ) : null}
    </div>
  );
}

/** A list's names as they stand. */
const namesOf = (value: JsonValue): string[] => (Array.isArray(value) ? value.flatMap((v) => (typeof v === "string" ? [v] : [])) : []);

/** A list of names as chips, each with a way to take it out, and a field to add one. */
function ListEditor(props: { label: string; names: readonly string[]; busy: boolean; onNames(names: string[]): void }) {
  const [adding, setAdding] = useState("");
  const add = (): void => {
    const name = adding.trim();
    if (name === "" || props.names.includes(name)) return;
    props.onNames([...props.names, name]);
    setAdding("");
  };
  return (
    <div class="lre-stack rpe-set-list">
      {props.names.length === 0 ? (
        <span class="rpe-meta">None listed.</span>
      ) : (
        <ul class="rpe-set-chips" aria-label={props.label}>
          {props.names.map((name) => (
            <li key={name}>
              <span>{name}</span>
              <button type="button" class="rpe-set-chip-x" aria-label={`Take ${name} out`} title={`Take ${name} out`} disabled={props.busy} onClick={() => props.onNames(props.names.filter((n) => n !== name))}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div class="lre-inline">
        <input class="lre-input rpe-set-text" aria-label={`Add to ${props.label}`} placeholder="Add one" spellcheck={false} autoComplete="off" value={adding} disabled={props.busy} onInput={(event) => setAdding(event.currentTarget.value)} onKeyDown={(event) => (event.key === "Enter" ? add() : undefined)} />
        <Button size="sm" variant="ghost" icon="plus" disabled={adding.trim() === ""} onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

/** `lore.books`: auto, or the books he picks among those he has. */
function BooksEditor(props: { books: LoreBooks; names: readonly string[]; busy: boolean; onNames(names: string[]): void }) {
  const auto = props.names.length === 0 || props.names.includes("auto");
  return (
    <div class="lre-stack" data-books>
      <label class="lre-inline">
        <input type="radio" name="lore-books" checked={auto} disabled={props.busy} onChange={() => props.onNames(["auto"])} />
        <span>Every book the chat reads (auto)</span>
      </label>
      {props.books.books.map((book) => {
        const on = !auto && props.names.includes(book.id);
        return (
          <label key={book.id} class="lre-inline" data-book={book.id}>
            <input
              type="checkbox"
              checked={on}
              disabled={props.busy}
              onChange={() => {
                const ids = on ? props.names.filter((id) => id !== book.id && id !== "auto") : [...props.names.filter((id) => id !== "auto"), book.id];
                props.onNames(ids.length === 0 ? ["auto"] : ids);
              }}
            />
            <span>
              {book.name}
              {book.attached ? " · attached to this chat" : ""}
              {book.character ? " · a character's" : ""}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** A list of names, saved whole. */
function ListControl(props: ControlProps) {
  const { setting: s } = props;
  const start = namesOf(props.start);
  const [names, setNames] = useState(start);
  const dirty = JSON.stringify(names) !== JSON.stringify(start);
  return (
    <div class="lre-stack">
      {s.key === "lore.books" && props.books !== null ? <BooksEditor books={props.books} names={names} busy={props.busy} onNames={setNames} /> : <ListEditor label={s.name} names={names} busy={props.busy} onNames={setNames} />}
      {dirty ? <SaveCancel busy={props.busy} ok onSave={() => props.onWrite(names)} onCancel={() => setNames(start)} /> : null}
    </div>
  );
}

/** A table's rows as typed: a name, and its files between commas. */
type TableRowDraft = { name: string; files: string };

/** The table a set of rows writes: each named row to its files. */
const tableValue = (rows: readonly TableRowDraft[]): JsonValue => Object.fromEntries(rows.filter((r) => r.name.trim() !== "").map((r) => [r.name.trim(), r.files.split(",").map((f) => f.trim()).filter((f) => f !== "")]));

/** A table of names to lists of files: one row each, a name and its files between commas; with `whole`, one list for every name instead. */
function TableControl(props: ControlProps & { takes: Extract<Takes, { type: "table" }> }) {
  const { setting: s, takes } = props;
  const startRows: TableRowDraft[] = isRecord(props.start) ? Object.entries(props.start).map(([name, v]) => ({ name, files: namesOf(v as JsonValue).join(", ") })) : [];
  const startWhole = takes.whole === true && Array.isArray(props.start) ? namesOf(props.start) : null;
  const [rows, setRows] = useState(startRows);
  const [whole, setWhole] = useState<string[] | null>(startWhole);
  const value = whole ?? tableValue(rows);
  const dirty = JSON.stringify(value) !== JSON.stringify(startWhole ?? tableValue(startRows));
  const cancel = (): void => {
    setRows(startRows);
    setWhole(startWhole);
  };
  const setRow = (i: number, row: TableRowDraft): void => setRows((held) => held.map((r, j) => (j === i ? row : r)));
  return (
    <div class="lre-stack">
      {takes.whole === true ? (
        <Seg
          value={whole === null ? "each" : "every"}
          options={[
            { value: "every", label: "The same for every agent" },
            { value: "each", label: "Agent by agent" },
          ]}
          label={`How ${s.name} is set`}
          onChange={(to) => setWhole(to === "every" ? (whole ?? []) : null)}
        />
      ) : null}
      {whole !== null ? (
        <ListEditor label={s.name} names={whole} busy={props.busy} onNames={setWhole} />
      ) : (
        <div class="lre-stack rpe-set-rows">
          {rows.length === 0 ? <span class="rpe-meta">None listed.</span> : null}
          {rows.map((row, i) => (
            <div key={i} class="rpe-set-rowedit">
              <input class="lre-input" aria-label="Name" placeholder="name" spellcheck={false} value={row.name} disabled={props.busy} onInput={(event) => setRow(i, { ...row, name: event.currentTarget.value })} />
              <input class="lre-input" aria-label="Files, between commas" placeholder="files, between commas" spellcheck={false} value={row.files} disabled={props.busy} onInput={(event) => setRow(i, { ...row, files: event.currentTarget.value })} />
              <IconButton icon="trash" label="Take this row out" disabled={props.busy} onClick={() => setRows((held) => held.filter((_, j) => j !== i))} />
            </div>
          ))}
          <span>
            <Button size="sm" variant="ghost" icon="plus" onClick={() => setRows((held) => [...held, { name: "", files: "" }])}>
              Add a row
            </Button>
          </span>
        </div>
      )}
      {dirty ? <SaveCancel busy={props.busy} ok onSave={() => props.onWrite(value)} onCancel={cancel} /> : null}
    </div>
  );
}

/** A list of records: a row each, a field for each of its fields (a choice where the field takes one of a few), saved whole. */
function RecordsControl(props: ControlProps & { takes: Extract<Takes, { type: "records" }> }) {
  const { takes } = props;
  const startRows = Array.isArray(props.start) ? props.start.flatMap((item) => (isRecord(item) ? [Object.fromEntries(takes.fields.map((f) => [f.name, item[f.name] === undefined ? "" : String(item[f.name])]))] : [])) : [];
  const [rows, setRows] = useState<Record<string, string>[]>(startRows);
  const dirty = JSON.stringify(rows) !== JSON.stringify(startRows);
  const setCell = (i: number, field: string, value: string): void => setRows((held) => held.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
  const whole = rows.every((r) => takes.fields.every((f) => (r[f.name] ?? "").trim() !== ""));
  return (
    <div class="lre-stack rpe-set-rows">
      {rows.length === 0 ? <span class="rpe-meta">None listed.</span> : null}
      {rows.map((row, i) => (
        <div key={i} class="rpe-set-rowedit">
          {takes.fields.map((f) =>
            f.takes.type === "oneOf" ? (
              <select key={f.name} class="lre-input" aria-label={f.name} title={f.about} disabled={props.busy} onChange={(event) => setCell(i, f.name, event.currentTarget.value)}>
                {row[f.name] === "" ? (
                  <option value="" selected>
                    {f.name}
                  </option>
                ) : null}
                {f.takes.values.map((v) => (
                  <option key={v} value={v} selected={row[f.name] === v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input key={f.name} class="lre-input" aria-label={f.name} title={f.about} placeholder={f.name} spellcheck={false} value={row[f.name] ?? ""} disabled={props.busy} onInput={(event) => setCell(i, f.name, event.currentTarget.value)} />
            ),
          )}
          <IconButton icon="trash" label="Take this row out" disabled={props.busy} onClick={() => setRows((held) => held.filter((_, j) => j !== i))} />
        </div>
      ))}
      <span>
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setRows((held) => [...held, Object.fromEntries(takes.fields.map((f) => [f.name, ""]))])}>
          Add a row
        </Button>
      </span>
      {dirty ? <SaveCancel busy={props.busy} ok={whole} onSave={() => props.onWrite(rows.map((r) => Object.fromEntries(takes.fields.map((f) => [f.name, (r[f.name] ?? "").trim()]))))} onCancel={() => setRows(startRows)} /> : null}
    </div>
  );
}

/** The control that fits what a setting takes. */
export function SettingControl(props: ControlProps) {
  const t = props.setting.takes;
  switch (t.type) {
    case "yesNo":
      return props.setting.orNone ? (
        <ChoiceControl
          {...props}
          values={[
            { value: "true", label: "On" },
            { value: "false", label: "Off" },
          ]}
        />
      ) : (
        <SwitchControl {...props} />
      );
    case "oneOf":
      return <ChoiceControl {...props} values={t.values.map((v) => ({ value: v, label: v }))} />;
    case "whole":
    case "number":
      return <NumberControl {...props} />;
    case "text":
      return <TextControl {...props} />;
    case "texts":
      return <ListControl {...props} />;
    case "table":
      return <TableControl {...props} takes={t} />;
    case "records":
      return <RecordsControl {...props} takes={t} />;
  }
}
