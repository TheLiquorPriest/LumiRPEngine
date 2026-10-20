// Data-table editor (DESIGN §13, ARCHITECTURE §6): a world's copy of a pinned
// table. Its page shows the rows as a paged grid whose first column, each row's name, stays put
// while the other columns scroll sideways inside the grid, so it works at phone width. A row opens
// as a sheet with one field per column, typed by the column contract: money in the world's
// currency, bands as min, typical and max, refs picked by name from the referenced table. Saving
// writes the table to the draft and the backend computes its revision. Styles: the data-table
// block of styles/forms.ts.

import type { ComponentChildren } from "preact";
import { useEffect, useId, useMemo, useRef, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord, safeKey } from "../../shared/json";
import { formatMoneyInput, parseMoneyInput } from "../../shared/money";
import type { ColumnDef, DataTable, TableRow, TableUnit } from "../../shared/tables";
import { tableChoices } from "../../shared/tables";
import { formatMoney } from "../../shared/world";
import type { WorldCurrency, WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import type { SegOption } from "../components";
import { Badge, Button, Disclosure, Empty, Field, IconButton, IdText, List, ListRow, Row, SaveBar, Section, Seg, useBusy, useShowIds } from "../components";
import { humanize } from "../format";
import { Icon } from "../icons";
import { parseJsonText } from "../json-text";
import { MoneyInput } from "../money-input";
import type { EditorProps, Send } from "../registry";
import { revealInScroller } from "../scroll";
import { go, ItemHeader } from "./chrome";
import { CheckField, FormGroup, FormSheet, RefPicker } from "./form-kit";
import { useHeld } from "./held";
import { deriveId } from "./schema";

/** Rows per page of the grid. */
const PAGE = 25;
/** The decimals past the currency's own that a decimal money column (cents per kWh) is typed with. */
const FINE = 4;
/** A band's parts, in order. */
const BAND_PARTS = ["min", "typical", "max"] as const;
type BandPart = (typeof BAND_PARTS)[number];
/** The cells that name a row, in the order they're read (`label`, as `tableChoices` reads it, then `name`, which pack tables use). */
const NAME_KEYS = ["label", "name"] as const;

/** Why a cell value breaks its column contract, or null. */
export function cellProblem(column: ColumnDef, value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return column.optional ? null : "Required";
  switch (column.type) {
    case "int":
      return typeof value === "number" && Number.isInteger(value) ? null : "Whole number";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "Number";
    case "text":
      return typeof value === "string" ? null : "Text";
    case "bool":
      return typeof value === "boolean" ? null : "Yes or no";
    case "enum":
      return typeof value === "string" && (column.values ?? []).includes(value) ? null : `One of ${(column.values ?? []).join(", ")}`;
    case "ref":
      return typeof value === "string" ? null : "Row id";
    case "band":
      if (!isRecord(value) || typeof value.min !== "number" || typeof value.typical !== "number" || typeof value.max !== "number") return "min, typical and max";
      return value.min <= value.typical && value.typical <= value.max ? null : "min ≤ typical ≤ max";
    case "list":
      return Array.isArray(value) ? null : "List";
    case "json":
      return null;
  }
}

// ---------------------------------------------------------------- columns and rows in words

/** A cell of a row, own properties only: column keys come from authored JSON. */
function cellOf(row: TableRow, key: string): JsonValue | undefined {
  return hasOwn(row, key) ? row[key] : undefined;
}

/** Money columns hold minor units: `cents`, and rates such as `cents_per_gal` and `cents_per_h`. */
function isMoney(unit: TableUnit | undefined): boolean {
  return unit !== undefined && unit.startsWith("cents");
}

/** Each unit in words. A money unit names only its rate: the amount itself shows in the world's currency. */
const UNIT_WORDS: Readonly<Record<TableUnit, string>> = {
  cents: "",
  cents_per_gal: "per gallon",
  cents_per_kwh: "per kWh",
  cents_per_month: "per month",
  cents_per_h: "per hour",
  cents_per_year: "per year",
  pct: "percent",
  multiplier: "multiplier",
  g: "grams",
  kg: "kilograms",
  l: "liters",
  gal: "gallons",
  kwh: "kWh",
  mpg: "miles per gallon",
  mi_per_kwh: "miles per kWh",
  gal_per_h: "gallons per hour",
  mi: "miles",
  h: "hours",
  min: "minutes",
  day: "days",
  week: "weeks",
};

/** A unit in words ("per gallon", "liters"); empty for none, and for plain money. */
function unitWords(unit: TableUnit | undefined): string {
  if (unit === undefined) return "";
  // Units come from authored JSON: one this list doesn't know reads as itself.
  return hasOwn(UNIT_WORDS, unit) ? UNIT_WORDS[unit] : unit.replace(/_/g, " ");
}

/**
 * A column's name in words, without the unit its key ends in ("price_cents" → "Price",
 * "median_rent_1br_cents_per_month" → "Median rent 1br", "offset_days" → "Offset"): the unit shows
 * on its own, and a money column's amounts are in the world's currency rather than in cents.
 */
function columnName(key: string, column: ColumnDef): string {
  const words = key.split("_");
  const tails: string[] = [];
  if (column.unit !== undefined) tails.push(column.unit);
  if (isMoney(column.unit)) tails.push("cents");
  for (const tail of tails) {
    const parts = tail.split("_");
    if (parts.length >= words.length) continue;
    const last = parts.length - 1;
    const end = words.slice(words.length - parts.length);
    // A key may end in the unit's plural ("offset_days" for days).
    if (end.every((word, i) => word === parts[i] || (i === last && word === `${parts[i] ?? ""}s`))) return humanize(words.slice(0, words.length - parts.length).join("_"));
  }
  return humanize(key);
}

/** A column's label over its field: its name, and its unit in words ("Price (per gallon)"). */
function columnLabel(key: string, column: ColumnDef): string {
  const unit = unitWords(column.unit);
  return unit ? `${columnName(key, column)} (${unit})` : columnName(key, column);
}

/** A column's heading in the grid ("Price, per gallon"). */
function columnHeading(key: string, column: ColumnDef): string {
  const unit = unitWords(column.unit);
  return unit ? `${columnName(key, column)}, ${unit}` : columnName(key, column);
}

/** The text column that names a table's rows (`label`, else `name`); null when it has neither. */
function nameColumnOf(table: DataTable): string | null {
  for (const key of NAME_KEYS) if (hasOwn(table.columns, key) && table.columns[key]?.type === "text") return key;
  return null;
}

/** A row's name: its `label` or `name` cell, else its id in words, since ids show only with Show ids. */
function rowName(table: DataTable | undefined, id: string): string {
  const row = table && hasOwn(table.rows, id) ? table.rows[id] : undefined;
  for (const key of NAME_KEYS) {
    const cell = row ? cellOf(row, key) : undefined;
    if (typeof cell === "string" && cell.trim() !== "") return cell;
  }
  return humanize(id);
}

/** How many of a row's cells break their column contract. */
function rowProblems(columns: readonly (readonly [string, ColumnDef])[], row: TableRow): number {
  let count = 0;
  for (const [key, column] of columns) if (cellProblem(column, cellOf(row, key)) !== null) count++;
  return count;
}

/** Why a typed row id can't be used, or null. */
function rowIdProblem(id: string, taken: ReadonlySet<string>): string | null {
  if (id === "") return "Give it an id.";
  if (taken.has(id)) return "There's already a row with this id.";
  return safeKey(id) ? null : "This id is reserved. Choose another.";
}

/** A column's doc with a sentence of the field's own after it (the doc may lack its full stop). */
function withHelp(doc: string | undefined, more: string): string {
  const text = doc?.trim() ?? "";
  if (text === "") return more;
  return `${/[.!?]$/.test(text) ? text : `${text}.`} ${more}`;
}

// ---------------------------------------------------------------- money and numbers

/** The decimals a currency writes, as `formatMoney` reads them. */
function placesOf(currency: WorldCurrency): number {
  return Math.max(0, Math.min(6, Math.trunc(currency.decimals)));
}

/**
 * The currency an amount of `minor` units is written in: its own, or, for a fraction of a minor
 * unit (a decimal money column such as cents per kWh), with the few more decimals the fraction
 * needs, up to `FINE`. `scale` turns the amount into whole units of that.
 */
function finer(currency: WorldCurrency, minor: number): { currency: WorldCurrency; scale: number } {
  const base = placesOf(currency);
  const most = Math.min(FINE, 6 - base);
  let extra = 0;
  while (extra < most && Math.abs(minor * 10 ** extra - Math.round(minor * 10 ** extra)) > 1e-6) extra++;
  return extra === 0 ? { currency, scale: 1 } : { currency: { ...currency, decimals: base + extra }, scale: 10 ** extra };
}

/** Minor units in the world's currency; a fraction of one shows with the decimals it needs, except in a format that writes the minor unit apart ("3 sp 4 cp"). */
function moneyText(minor: number, currency: WorldCurrency): string {
  if (!Number.isFinite(minor)) return String(minor);
  if (/\{minor\}/.test(currency.format)) return formatMoney(Math.round(minor), currency);
  const fine = finer(currency, minor);
  return formatMoney(Math.round(minor * fine.scale), fine.currency);
}

/**
 * How a number cell is typed: `show` writes a value for editing, `read` reads typed text (null when
 * it isn't a value), `hint` says what to type instead, and `currency` is the money input's, for money.
 */
interface NumberText {
  show(value: number): string;
  read(text: string): number | null;
  hint: string;
  currency: WorldCurrency | null;
}

/**
 * A number cell's text. Money is typed as the world's currency writes it ("12.50" beside "$"), never
 * in minor units, and kept as whole minor units; a decimal money column (a `number`, such as cents
 * per kWh) keeps up to `FINE` more decimals, so 14.5 cents is "0.145". Any other number is typed
 * as it is, whole for `int`.
 */
function numberText(unit: TableUnit | undefined, whole: boolean, currency: WorldCurrency): NumberText {
  if (!isMoney(unit)) {
    return {
      show: (value) => String(value),
      read: (text) => {
        const n = Number(text.trim());
        return text.trim() !== "" && Number.isFinite(n) && (!whole || Number.isInteger(n)) ? n : null;
      },
      hint: whole ? "Type a whole number" : "Type a number",
      currency: null,
    };
  }
  const base = placesOf(currency);
  const example = formatMoney(1250 * 10 ** Math.max(0, base - 2), currency);
  const show = (value: number): string => {
    const fine = finer(currency, value);
    return formatMoneyInput(Math.round(value * fine.scale), fine.currency);
  };
  if (whole) return { show, read: (text) => parseMoneyInput(text, currency), hint: base > 0 ? `Type an amount like ${example}, with at most ${base} decimals` : `Type a whole amount like ${example}`, currency };
  const extra = Math.min(FINE, 6 - base);
  const fine: WorldCurrency = { ...currency, decimals: base + extra };
  return {
    show,
    read: (text) => {
      const minor = parseMoneyInput(text, fine);
      return minor === null ? null : minor / 10 ** extra;
    },
    hint: `Type an amount like ${example}`,
    currency: fine,
  };
}

// ---------------------------------------------------------------- the grid

/** What cells are read against: the world's currency, and the tables refs name rows of (this one as edited). */
interface GridCtx {
  currency: WorldCurrency;
  tables: Readonly<Record<string, DataTable>>;
}

/** A value with no short form of its own: an object or a list as {…} or […], anything else as written. */
function compact(value: JsonValue): string {
  if (Array.isArray(value)) return "[…]";
  if (isRecord(value)) return "{…}";
  return String(value);
}

/** The row a ref names, by its name; one that isn't there says so. */
function refText(ref: string | undefined, id: string, tables: GridCtx["tables"]): string {
  const target = ref !== undefined && hasOwn(tables, ref) ? tables[ref] : undefined;
  return target && hasOwn(target.rows, id) ? rowName(target, id) : `${id} (missing)`;
}

/** A number as the grid shows it: money in the world's currency, any other as written. */
function amountText(column: ColumnDef, n: number, ctx: GridCtx): string {
  return isMoney(column.unit) ? moneyText(n, ctx.currency) : String(n);
}

/** One item of a list cell, as the grid shows it. */
function itemText(column: ColumnDef, item: JsonValue, ctx: GridCtx): string {
  if (typeof item === "number") return amountText(column, item, ctx);
  if (typeof item === "boolean") return item ? "Yes" : "No";
  if (typeof item !== "string") return item === null ? "null" : compact(item);
  if (column.of === "ref") return refText(column.ref, item, ctx.tables);
  return column.of === "enum" ? humanize(item) : item;
}

/** A cell as the grid shows it, short and read-only: money in the world's currency, a band as min–typical–max, a ref by its row's name; null when empty. */
function cellText(column: ColumnDef, value: JsonValue | undefined, ctx: GridCtx): string | null {
  if (value === undefined || value === null) return null;
  switch (column.type) {
    case "int":
    case "number":
      return typeof value === "number" ? amountText(column, value, ctx) : compact(value);
    case "bool":
      return typeof value === "boolean" ? (value ? "Yes" : "No") : compact(value);
    case "enum":
      return typeof value === "string" ? humanize(value) : compact(value);
    case "ref":
      return typeof value === "string" ? refText(column.ref, value, ctx.tables) : compact(value);
    case "band": {
      if (!isRecord(value)) return compact(value);
      const band = value as JsonObject;
      return BAND_PARTS.map((part) => {
        const n = band[part];
        return typeof n === "number" ? amountText(column, n, ctx) : "?";
      }).join("–");
    }
    case "list":
      if (!Array.isArray(value)) return compact(value);
      return value.length === 0 ? null : value.map((item) => itemText(column, item, ctx)).join(", ");
    case "json":
      return compact(value);
    default:
      return typeof value === "string" ? value : compact(value);
  }
}

/** A grid cell: the value short and read-only, numbers (`num`) on the right. One that breaks its column contract carries the alert icon, naming the problem, in the danger colour. */
function gridCell(key: string, column: ColumnDef, num: boolean, value: JsonValue | undefined, ctx: GridCtx) {
  const text = cellText(column, value, ctx);
  const problem = cellProblem(column, value);
  const classes = ["lre-form-table-cell", num ? "num" : "", problem !== null ? "bad" : ""].filter((c) => c !== "").join(" ");
  const title = [text ?? "", problem ?? ""].filter((t) => t !== "").join(" · ");
  return (
    <td key={key} class={classes} title={title === "" ? undefined : title}>
      <span class="lre-form-table-val">
        {problem !== null ? <Icon name="alert" size={16} label={problem} /> : null}
        {text === null ? (
          <>
            <span class="lre-form-table-empty" aria-hidden="true">
              —
            </span>
            <span class="lre-sr">Empty</span>
          </>
        ) : (
          <span class="lre-form-table-text">{text}</span>
        )}
      </span>
    </td>
  );
}

// ---------------------------------------------------------------- the row sheet's fields

/**
 * A field's typed text over its cell's value. Each edit goes to the row as soon as the text reads
 * as a value, so nothing waits for a blur that closing the sheet would skip. The text follows the
 * cell only when the value changes from elsewhere (Revert, a reload), never when it is the value
 * the text already reads as, so "12." stays as typed.
 */
function useTyped(value: JsonValue | undefined, show: (value: JsonValue | undefined) => string, onChange: (value: JsonValue | undefined) => void): [string, (text: string) => void, (value: JsonValue | undefined) => void] {
  const [text, setText] = useState(() => show(value));
  // The JSON of the value the text stands for: the cell's, or the last one this field sent.
  const mine = useRef(JSON.stringify(value ?? null));
  useEffect(() => {
    const json = JSON.stringify(value ?? null);
    if (json === mine.current) return;
    mine.current = json;
    setText(show(value));
  }, [value]);
  const commit = (next: JsonValue | undefined): void => {
    mine.current = JSON.stringify(next ?? null);
    onChange(next);
  };
  return [text, setText, commit];
}

/** A number's typed text over its cell (see `useTyped`); `typo` while the text isn't a value `codec` reads, when the cell keeps its last one. */
function useNumberText(value: JsonValue | undefined, codec: NumberText, onChange: (value: number | undefined) => void): { text: string; typo: boolean; onInput(text: string): void } {
  const [text, setText, commit] = useTyped(value, (v) => (typeof v === "number" ? codec.show(v) : ""), (v) => onChange(typeof v === "number" ? v : undefined));
  return {
    text,
    typo: text.trim() !== "" && codec.read(text) === null,
    onInput: (next) => {
      setText(next);
      if (next.trim() === "") {
        if (value !== undefined) commit(undefined);
        return;
      }
      const n = codec.read(next);
      if (n !== null && n !== value) commit(n);
    },
  };
}

/** What every field of the row sheet gets. */
interface CellFieldProps {
  /** The label over the control: the column's name, its unit and the optional mark. */
  label: ComponentChildren;
  /** The label as text, for controls that carry their own name. */
  plain: string;
  /** The column's doc. */
  help: string | undefined;
  /** Why the cell breaks its column contract, or null. */
  problem: string | null;
  column: ColumnDef;
  value: JsonValue | undefined;
  onChange(value: JsonValue | undefined): void;
}

/** A number's input: the money input in the world's currency for money, else a plain one with the keypad its numbers need. */
function NumberInput(props: { codec: NumberText; id: string; label: string; text: string; invalid: boolean; whole: boolean; onInput(text: string): void }) {
  if (props.codec.currency) return <MoneyInput currency={props.codec.currency} value={props.text} onInput={props.onInput} label={props.label} invalid={props.invalid} />;
  return (
    <input
      id={props.id}
      class={props.invalid ? "lre-input invalid" : "lre-input"}
      inputMode={props.whole ? "numeric" : "decimal"}
      autoComplete="off"
      aria-label={props.label}
      aria-invalid={props.invalid || undefined}
      value={props.text}
      onInput={(event) => props.onInput(event.currentTarget.value)}
    />
  );
}

/** An `int` or `number`: money through the money input in the world's currency, any other number as typed. */
function NumberField(props: CellFieldProps & { currency: WorldCurrency }) {
  const id = useId();
  const whole = props.column.type === "int";
  const codec = numberText(props.column.unit, whole, props.currency);
  const typed = useNumberText(props.value, codec, props.onChange);
  const error = typed.typo ? `${codec.hint}. The cell keeps its last valid value.` : props.problem;
  return (
    <Field label={props.label} for={codec.currency ? undefined : id} help={props.help} error={error}>
      <NumberInput codec={codec} id={id} label={props.plain} text={typed.text} invalid={error !== null} whole={whole} onInput={typed.onInput} />
    </Field>
  );
}

/** A band: Min, Typical and Max side by side, wrapping when narrow. A money band is typed in the world's currency and kept as whole minor units. */
function BandField(props: CellFieldProps & { currency: WorldCurrency }) {
  const money = isMoney(props.column.unit);
  const codec = numberText(props.column.unit, money, props.currency);
  const band: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  const set = (part: BandPart, n: number | undefined): void => {
    const next: JsonObject = { ...band };
    if (n === undefined) delete next[part];
    else next[part] = n;
    // A band with no part left is no value: the cell goes, as an emptied field's does.
    props.onChange(Object.keys(next).length === 0 ? undefined : next);
  };
  const parts = [
    { part: "min", word: "Min", id: useId(), typed: useNumberText(band.min, codec, (n) => set("min", n)) },
    { part: "typical", word: "Typical", id: useId(), typed: useNumberText(band.typical, codec, (n) => set("typical", n)) },
    { part: "max", word: "Max", id: useId(), typed: useNumberText(band.max, codec, (n) => set("max", n)) },
  ];
  const typo = parts.find((p) => p.typed.typo);
  const error = typo ? `${typo.word}: ${codec.hint}. The cell keeps its last valid value.` : props.problem;
  return (
    <Field label={props.label} help={props.help} error={error}>
      <div class="lre-form-table-band">
        {parts.map((p) => (
          <Field key={p.part} label={p.word} for={codec.currency ? undefined : p.id}>
            <NumberInput codec={codec} id={p.id} label={`${props.plain}, ${p.word.toLowerCase()}`} text={p.typed.text} invalid={p.typed.typo} whole={money} onInput={p.typed.onInput} />
          </Field>
        ))}
      </div>
    </Field>
  );
}

/** Text: one line, or a box for a long value. */
function TextField(props: CellFieldProps) {
  const id = useId();
  // Long text (a description, a note) gets a box it can wrap in. Decided as the sheet opens, so typing never swaps the control.
  const [long] = useState(() => typeof props.value === "string" && (props.value.length > 60 || props.value.includes("\n")));
  const text = typeof props.value === "string" ? props.value : typeof props.value === "number" || typeof props.value === "boolean" ? String(props.value) : "";
  const invalid = props.problem !== null;
  return (
    <Field label={props.label} for={id} help={props.help} error={props.problem}>
      {long ? (
        <textarea
          id={id}
          class={invalid ? "lre-input lre-form-table-prose invalid" : "lre-input lre-form-table-prose"}
          rows={4}
          aria-invalid={invalid || undefined}
          value={text}
          onInput={(event) => props.onChange(event.currentTarget.value === "" && props.column.optional ? undefined : event.currentTarget.value)}
        />
      ) : (
        <input
          id={id}
          class={invalid ? "lre-input invalid" : "lre-input"}
          autoComplete="off"
          aria-invalid={invalid || undefined}
          value={text}
          onInput={(event) => props.onChange(event.currentTarget.value === "" && props.column.optional ? undefined : event.currentTarget.value)}
        />
      )}
    </Field>
  );
}

/** An enum: a segmented control for up to four values, else a native select. A value the column doesn't allow stays listed, so it shows and can be replaced. */
function EnumField(props: CellFieldProps) {
  const id = useId();
  const values = props.column.values ?? [];
  const current = typeof props.value === "string" ? props.value : "";
  if (values.length > 0 && values.length <= 4) {
    const options: SegOption<string>[] = [...(props.column.optional ? [{ value: "", label: "None" }] : []), ...values.map((v) => ({ value: v, label: humanize(v) }))];
    return (
      <Field label={props.label} help={props.help} error={props.problem}>
        <Seg label={props.plain} value={current !== "" || props.column.optional ? current : null} options={options} onChange={(next) => props.onChange(next === "" ? undefined : next)} />
      </Field>
    );
  }
  const invalid = props.problem !== null;
  return (
    <Field label={props.label} for={id} help={props.help} error={props.problem}>
      <select
        id={id}
        class={invalid ? "lre-input invalid" : "lre-input"}
        aria-invalid={invalid || undefined}
        value={current}
        onChange={(event) => props.onChange(event.currentTarget.value === "" ? undefined : event.currentTarget.value)}
      >
        <option value="">{props.column.optional ? "None" : "Choose…"}</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {humanize(v)}
          </option>
        ))}
        {current !== "" && !values.includes(current) ? <option value={current}>{current} (not a choice)</option> : null}
      </select>
    </Field>
  );
}

/** A ref: the referenced table's rows by name, in its row order. The picker draws its own label, so the field's (with the optional mark) stands in for it. */
function RefField(props: CellFieldProps & { tables: GridCtx["tables"] }) {
  const ref = props.column.ref;
  const target = ref !== undefined && hasOwn(props.tables, ref) ? props.tables[ref] : undefined;
  const options = useMemo(() => tableChoices(target).map((choice) => ({ value: choice.key, label: rowName(target, choice.key) })), [target]);
  const help = target === undefined && ref !== undefined ? withHelp(props.help, `It names rows of ${humanize(ref)}, a table this world doesn't have.`) : props.help;
  return (
    <Field label={props.label} help={help} error={props.problem}>
      <div class="lre-form-table-ref">
        <RefPicker label={props.plain} value={typeof props.value === "string" ? props.value : ""} options={options} none={props.column.optional ? "None" : undefined} placeholder="Choose a row…" onChange={(next) => props.onChange(next === "" ? undefined : next)} />
      </div>
    </Field>
  );
}

/** Whether a list can't be typed between commas: its items are objects or lists, or text with a comma in it. */
function listNeedsJson(column: ColumnDef, value: JsonValue | undefined): boolean {
  if (column.of === "json" || column.of === "band") return true;
  return Array.isArray(value) && value.some((item) => item === null || typeof item === "object" || (typeof item === "string" && item.includes(",")));
}

/** A list typed between commas; numbers (money in the world's currency) are read item by item. */
function CommaListField(props: CellFieldProps & { currency: WorldCurrency }) {
  const id = useId();
  const of = props.column.of;
  const codec = of === "int" || of === "number" ? numberText(props.column.unit, of === "int", props.currency) : null;
  const read = (text: string): JsonValue[] | null => {
    const parts = text
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part !== "");
    if (!codec) return parts;
    const numbers = parts.map((part) => codec.read(part));
    return numbers.every((n): n is number => n !== null) ? numbers : null;
  };
  const [text, setText, commit] = useTyped(props.value, (value) => (Array.isArray(value) ? value.map((item) => (typeof item === "number" && codec ? codec.show(item) : String(item))).join(", ") : ""), props.onChange);
  const typo = codec !== null && read(text) === null ? `${codec.hint} for each item. The cell keeps its last valid value.` : null;
  const onInput = (next: string): void => {
    setText(next);
    const items = read(next);
    if (items === null) return;
    const value = items.length > 0 ? items : props.column.optional ? undefined : [];
    if (JSON.stringify(value ?? null) !== JSON.stringify(props.value ?? null)) commit(value);
  };
  const allowed = of === "enum" && props.column.values ? ` Each is one of: ${props.column.values.join(", ")}.` : "";
  const error = typo ?? props.problem;
  return (
    <Field label={props.label} for={id} help={withHelp(props.help, `Separate with commas.${allowed}`)} error={error}>
      <input id={id} class={error !== null ? "lre-input invalid" : "lre-input"} autoComplete="off" aria-invalid={error !== null || undefined} value={text} onInput={(event) => onInput(event.currentTarget.value)} />
    </Field>
  );
}

/** JSON in a text box. While the text isn't JSON the cell keeps its last valid value, and the field says where the text goes wrong. */
function JsonField(props: CellFieldProps) {
  const id = useId();
  const [text, setText, commit] = useTyped(props.value, (value) => (value === undefined ? "" : JSON.stringify(value, null, 2)), props.onChange);
  const parsed = text.trim() === "" ? null : parseJsonText(text);
  const typo = parsed !== null && !parsed.ok ? `Not valid JSON: ${parsed.message} (line ${parsed.line}). The cell keeps its last valid value.` : null;
  const onInput = (next: string): void => {
    setText(next);
    if (next.trim() === "") {
      if (props.value !== undefined) commit(undefined);
      return;
    }
    const result = parseJsonText(next);
    if (result.ok && JSON.stringify(result.value) !== JSON.stringify(props.value ?? null)) commit(result.value);
  };
  const error = typo ?? props.problem;
  return (
    <Field label={props.label} for={id} help={props.help} error={error}>
      <textarea
        id={id}
        class={error !== null ? "lre-input invalid" : "lre-input"}
        rows={Math.min(10, Math.max(3, text.split("\n").length))}
        spellcheck={false}
        aria-invalid={error !== null || undefined}
        value={text}
        onInput={(event) => onInput(event.currentTarget.value)}
      />
    </Field>
  );
}

/** A list: typed between commas, or as JSON when its items can't be (once JSON, it stays so while the sheet is open, so typing never swaps the control). */
function ListField(props: CellFieldProps & { currency: WorldCurrency }) {
  const json = useRef(false);
  if (listNeedsJson(props.column, props.value)) json.current = true;
  if (json.current) return <JsonField {...props} help={withHelp(props.help, "It's typed as JSON, since its items can't be separated with commas.")} />;
  return <CommaListField {...props} />;
}

/** One column's field in the row sheet: its label over a control typed by the column contract, the column's doc as help, and the cell's problem under it. */
function CellField(props: { name: string; column: ColumnDef; value: JsonValue | undefined; ctx: GridCtx; onChange(value: JsonValue | undefined): void }) {
  const { column } = props;
  const plain = columnLabel(props.name, column);
  const field: CellFieldProps = {
    label: (
      <>
        {plain}
        {column.optional ? <span class="lre-form-optional"> · optional</span> : null}
      </>
    ),
    plain,
    help: column.doc,
    problem: cellProblem(column, props.value),
    column,
    value: props.value,
    onChange: props.onChange,
  };
  switch (column.type) {
    case "int":
    case "number":
      return <NumberField {...field} currency={props.ctx.currency} />;
    case "band":
      return <BandField {...field} currency={props.ctx.currency} />;
    case "bool":
      return <CheckField label={field.label} help={column.doc} checked={props.value === true} issues={field.problem !== null ? [{ severity: "error", path: props.name, code: "cell", message: field.problem }] : []} onChange={props.onChange} />;
    case "enum":
      return <EnumField {...field} />;
    case "ref":
      return <RefField {...field} tables={props.ctx.tables} />;
    case "list":
      return <ListField {...field} currency={props.ctx.currency} />;
    case "json":
      return <JsonField {...field} />;
    default:
      return <TextField {...field} />;
  }
}

/** A row's own page: a field per column, then Delete row and Done. */
function RowSheet(props: { table: DataTable; rowId: string; row: TableRow; ctx: GridCtx; onCell(key: string, value: JsonValue | undefined): void; onDelete(): void; onClose(): void }) {
  const showIds = useShowIds();
  return (
    <FormSheet title={rowName(props.table, props.rowId)} subtitle={showIds ? <IdText id={props.rowId} /> : undefined} backLabel={props.table.label} onClose={props.onClose}>
      <FormGroup>
        {Object.entries(props.table.columns).map(([key, column]) => (
          <CellField key={key} name={key} column={column} value={cellOf(props.row, key)} ctx={props.ctx} onChange={(value) => props.onCell(key, value)} />
        ))}
      </FormGroup>
      <div class="lre-form-table-actions spread">
        <Button variant="danger" icon="trash" onClick={props.onDelete}>
          Delete row
        </Button>
        <Button variant="primary" onClick={props.onClose}>
          Done
        </Button>
      </div>
    </FormSheet>
  );
}

/**
 * New row. A table that names its rows (a `label` or `name` column) asks for the name and
 * derives the id from it (`deriveId`), editable under Advanced or in the open while Show ids is on;
 * once typed, the id stops following the name. Any other table asks for the id itself. A taken or
 * reserved id is refused.
 */
function NewRow(props: { nameColumn: string | null; taken: ReadonlySet<string>; onCreate(id: string, row: TableRow): void; onCancel(): void }) {
  const showIds = useShowIds();
  const nameId = useId();
  const idId = useId();
  const first = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [typed, setTyped] = useState<string | null>(null);
  useEffect(() => first.current?.focus(), []);
  const nameColumn = props.nameColumn;
  const id = typed ?? (nameColumn !== null && name.trim() !== "" ? deriveId(name.trim(), props.taken) : "");
  const problem = typed === null ? null : rowIdProblem(typed, props.taken);
  const ready = id !== "" && problem === null && (nameColumn === null || name.trim() !== "");
  const idField = (
    <Field
      label={nameColumn !== null ? "Id" : "Row id"}
      for={idId}
      help={nameColumn !== null ? "How rules and other tables refer to the row. It follows the name until you change it." : "How rules and other tables refer to the row."}
      error={problem}
    >
      <input
        ref={nameColumn !== null ? undefined : first}
        id={idId}
        class={problem !== null ? "lre-input lre-form-table-mono invalid" : "lre-input lre-form-table-mono"}
        value={id}
        autoComplete="off"
        spellcheck={false}
        aria-invalid={problem !== null || undefined}
        onInput={(event) => setTyped(event.currentTarget.value.replace(/\s+/g, "_"))}
      />
    </Field>
  );
  return (
    <form
      class="lre-form-table-new"
      aria-label="New row"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) props.onCreate(id, nameColumn !== null ? { [nameColumn]: name.trim() } : {});
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onCancel();
      }}
    >
      {nameColumn !== null ? (
        <>
          <Field label="Name of the new row" for={nameId}>
            <input ref={first} id={nameId} class="lre-input" value={name} autoComplete="off" onInput={(event) => setName(event.currentTarget.value)} />
          </Field>
          {showIds ? idField : <Disclosure summary="Advanced">{idField}</Disclosure>}
        </>
      ) : (
        idField
      )}
      <div class="lre-form-table-actions">
        <Button type="submit" variant="primary" icon="plus" disabled={!ready}>
          Create row
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- pages

/** The world's data tables, when the editor opens on none: each by its label, with its pack, its rows and where its figures come from. */
function TableList(props: EditorProps) {
  const app = useApp();
  const tables = Object.entries(props.world.tables);
  if (tables.length === 0) {
    return (
      <Empty icon="table" title="No data tables">
        Packs copy theirs in when a world is created.
      </Empty>
    );
  }
  return (
    <div class="lre-build-page" data-lre-editor="tables">
      <Section flush>
        <List>
          {tables.map(([key, t]) => {
            const count = Object.keys(t.rows).length;
            return (
              <ListRow
                key={key}
                title={t.label}
                subtitle={`${humanize(t.pack)} · ${count} ${count === 1 ? "row" : "rows"} · ${t.source?.approximate ? "approximate" : "authored"}`}
                id={key}
                chevron
                onClick={() => go(app, { view: "item", worldId: props.world.id, collection: "tables", id: key })}
              />
            );
          })}
        </List>
      </Section>
    </div>
  );
}

/** A table's page: its header, what it is, its rows as a paged grid, a row's sheet while one is open, and Save / Revert. */
function TablePage(props: { world: WorldDoc; send: Send; id: string; table: DataTable; stored: DataTable | undefined; update(edit: (table: DataTable) => DataTable): void; revert(): void }) {
  const app = useApp();
  const { table, update } = props;
  const [rowId, setRowId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busy, run] = useBusy();
  const tools = useRef<HTMLDivElement>(null);
  const storedJson = useMemo(() => JSON.stringify(props.stored), [props.stored]);
  const changed = useMemo(() => JSON.stringify(table) !== storedJson, [table, storedJson]);
  const columns = useMemo(() => Object.entries(table.columns), [table.columns]);
  const problems = useMemo(() => Object.values(table.rows).reduce((n, row) => n + rowProblems(columns, row), 0), [table.rows, columns]);
  const taken = useMemo(() => new Set(Object.keys(table.rows)), [table.rows]);
  const ctx = useMemo<GridCtx>(() => ({ currency: props.world.currency, tables: { ...props.world.tables, [props.id]: table } }), [props.world.currency, props.world.tables, props.id, table]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => Object.entries(table.rows).filter(([rid, row]) => !q || rid.toLowerCase().includes(q) || Object.values(row).some((v) => typeof v === "string" && v.toLowerCase().includes(q))), [table.rows, q]);
  // The naming column's cells are the grid's first column; the rest follow it.
  const nameColumn = nameColumnOf(table);
  const nameDef = nameColumn !== null ? table.columns[nameColumn] : undefined;
  // Numbers (bands included) align on the right, their heading with them.
  const shown = columns.filter(([key]) => key !== nameColumn).map(([key, column]) => ({ key, column, num: column.type === "int" || column.type === "number" || column.type === "band" }));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = Math.min(page, pages - 1);
  const pageRows = rows.slice(current * PAGE, current * PAGE + PAGE);
  const editing = rowId !== null && hasOwn(table.rows, rowId) ? table.rows[rowId] : undefined;
  const breaking = problems === 1 ? "1 cell breaks the column contract" : `${problems} cells break the column contract`;

  const goPage = (next: number): void => {
    setPage(next);
    // A page starts at the top of the grid: bring the search bar over it into view.
    revealInScroller(tools.current, "nearest");
  };
  const setCell = (rid: string, key: string, value: JsonValue | undefined): void =>
    update((t) => {
      if (!hasOwn(t.rows, rid)) return t;
      const row: TableRow = { ...t.rows[rid] };
      if (value === undefined) delete row[key];
      else row[key] = value;
      return { ...t, rows: { ...t.rows, [rid]: row } };
    });
  const removeRow = async (rid: string): Promise<void> => {
    if (!(await app.host.confirm("Delete row", `Delete the row “${rowName(table, rid)}”? It leaves the draft when you save the table.`, "danger", "Delete"))) return;
    setRowId(null);
    update((t) => {
      const next = { ...t.rows };
      delete next[rid];
      return { ...t, rows: next };
    });
  };
  const create = (rid: string, row: TableRow): void => {
    const at = Object.keys({ ...table.rows, [rid]: row }).indexOf(rid);
    update((t) => ({ ...t, rows: { ...t.rows, [rid]: row } }));
    setAdding(false);
    setQuery("");
    setPage(Math.floor(Math.max(0, at) / PAGE));
    setRowId(rid);
  };

  return (
    <div class="lre-build-page" data-lre-editor="tables">
      <ItemHeader title={table.label} id={props.id} subtitle={`${humanize(table.pack)} pack`} />
      <Disclosure summary="About this table">
        <div>
          <Row k="Schema" v={<code class="lre-form-table-code">{table.schema}</code>} />
          <Row k="Revision" v={<code class="lre-form-table-code">{table.revision.slice(0, 12)}</code>} sub={changed ? "A new revision is computed when you save" : undefined} />
          {table.source ? <Row k="Source" v={table.source.dataPack} sub={`${table.source.file} · ${table.source.reflectsPeriod}${table.source.approximate ? " · approximate" : ""}`} /> : null}
        </div>
      </Disclosure>
      <Section title="Rows" aside={<Badge>{rows.length}</Badge>} flush>
        <div ref={tools} class="lre-form-table-tools">
          <div class="lre-form-table-search">
            <Icon name="search" size={16} />
            <input
              class="lre-input"
              type="search"
              placeholder="Search rows"
              aria-label="Search rows"
              value={query}
              onInput={(event) => {
                setQuery(event.currentTarget.value);
                setPage(0);
              }}
            />
          </div>
        </div>
        {pageRows.length === 0 ? (
          taken.size === 0 ? (
            <Empty icon="table" title="No rows yet">
              Add the first one with New row.
            </Empty>
          ) : (
            <Empty icon="search" title="No matches">
              Nothing here matches “{query.trim()}”.
            </Empty>
          )
        ) : (
          <div class="lre-form-table-scroll" role="region" aria-label={`Rows of ${table.label}`} tabIndex={0}>
            <table class="lre-form-table-grid">
              <thead>
                <tr>
                  <th scope="col" class="lre-form-table-name">
                    {nameColumn !== null && nameDef ? columnHeading(nameColumn, nameDef) : "Row"}
                  </th>
                  {shown.map(({ key, column, num }) => (
                    <th key={key} scope="col" class={num ? "num" : undefined} title={column.doc}>
                      <span class="lre-form-table-head">{columnHeading(key, column)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(([rid, row]) => {
                  const bad = rowProblems(columns, row);
                  return (
                    <tr key={rid}>
                      <th scope="row" class="lre-form-table-name">
                        <button type="button" class="lre-form-table-open" onClick={() => setRowId(rid)}>
                          <span class="lre-form-table-open-text">
                            <span>{rowName(table, rid)}</span>
                            <IdText id={rid} />
                          </span>
                          {bad > 0 ? (
                            <Badge tone="neg">
                              <Icon name="alert" size={12} />
                              {bad}
                              <span class="lre-sr">{bad === 1 ? " problem" : " problems"}</span>
                            </Badge>
                          ) : null}
                        </button>
                      </th>
                      {shown.map(({ key, column, num }) => gridCell(key, column, num, cellOf(row, key), ctx))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > PAGE ? (
          <div class="lre-form-table-pager">
            <IconButton icon="chevron-left" label="Previous page" disabled={current === 0} onClick={() => goPage(current - 1)} />
            <span class="lre-form-table-range" aria-live="polite">
              {`${current * PAGE + 1}–${Math.min(rows.length, current * PAGE + PAGE)} of ${rows.length}`}
            </span>
            <IconButton icon="chevron-right" label="Next page" disabled={current >= pages - 1} onClick={() => goPage(current + 1)} />
          </div>
        ) : null}
        <div class="lre-form-table-foot">
          {adding ? (
            <NewRow nameColumn={nameColumn} taken={taken} onCreate={create} onCancel={() => setAdding(false)} />
          ) : (
            <Button icon="plus" onClick={() => setAdding(true)}>
              New row
            </Button>
          )}
        </div>
      </Section>
      {editing && rowId !== null ? (
        <RowSheet key={rowId} table={table} rowId={rowId} row={editing} ctx={ctx} onCell={(key, value) => setCell(rowId, key, value)} onDelete={() => void removeRow(rowId)} onClose={() => setRowId(null)} />
      ) : null}
      <SaveBar>
        <Button
          variant="primary"
          disabled={!changed}
          busy={busy}
          title={problems > 0 ? breaking : undefined}
          label={problems > 0 ? `Save table, ${breaking}` : undefined}
          onClick={() =>
            run(async () => {
              const message = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "put", collection: "tables", id: props.id, value: table as unknown as JsonValue });
              if (message.type === "lre.result") app.toast("Table saved to the draft.", "info");
            })
          }
        >
          {problems > 0 ? `Save table · ${problems} ${problems === 1 ? "problem" : "problems"}` : "Save table"}
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={props.revert}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}

export function TableEditor(props: EditorProps) {
  const id = props.id?.startsWith("new:") ? props.id.slice(4) : props.id;
  const stored = id !== null && hasOwn(props.world.tables, id) ? props.world.tables[id] : undefined;
  const [table, setTable] = useState<DataTable | null>(stored ? structuredClone(stored) : null);
  useHeld(table, setTable, stored ?? null, `${props.world.id}/tables/${id ?? ""}`, stored?.revision ?? "");
  if (!id) return <TableList {...props} />;
  if (!table) return <Empty icon="table">New tables come from packs; edit an existing table's copy instead.</Empty>;
  return (
    <TablePage
      key={id}
      world={props.world}
      send={props.send}
      id={id}
      table={table}
      stored={stored}
      update={(edit) => setTable((now) => (now ? edit(now) : now))}
      revert={() => setTable(stored ? structuredClone(stored) : null)}
    />
  );
}
