// The schema-driven form (DESIGN §13): renders a value from `FieldSpec`s,
// each field's label over its control with its help and the backend's lint under it. References
// are pickers by name; money is typed in the world's currency; durations and moments of the clock
// are typed as spans and dates; lists and records of objects list their items, each opening as a
// sheet; formulas go to the expression editor. Entity fields are typed by their kind (single
// inheritance resolved here for display only) and grouped by realism domain, with the values the
// kind doesn't define kept as JSON under Advanced; a structured field a kind declares draws its
// pack's own editor (`UiRegistry.field`).

import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { DomainId, Level } from "../../shared/ids";
import { BANDS, DOMAINS } from "../../shared/ids";
import { CLAIM_PRESETS, DEFAULT_CLAIMS, readClaims } from "../../shared/claims";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord, safeKey } from "../../shared/json";
import { formatMoneyInput, parseMoneyInput } from "../../shared/money";
import type { LintIssue } from "../../shared/protocol";
import { tableChoices } from "../../shared/tables";
import { BAND_LABEL, tierOf, tiersInOrder } from "../../shared/tiers";
import { ALIVE, BUILTIN_RELATIONS, formatMoney, lifeStatesOf } from "../../shared/world";
import type { CalendarDef, FacetValueDef, FieldDef, WorldCurrency, WorldDoc } from "../../shared/world";
import { Button, Disclosure, HostSwitch, IconButton, IdText, Seg, useShowIds } from "../components";
import { humanize } from "../format";
import { MoneyInput } from "../money-input";
import type { FieldEditorDef } from "../registry";
import { ClaimsControl, DOMAIN_LABEL, floorNote, LEVEL_LABEL } from "../settings/realism";
import { useSelect } from "../store";
import { EffectArgsInput } from "./effect-args";
import { ExprEditor, ExprReadout } from "./expr-editor";
import { ClassesInput, classesOf, FacetValuesInput, facetValuesOf } from "./facet-editor";
import type { RefOption } from "./form-kit";
import { AddPicker, CheckField, Chip, FormGroup, FormSheet, Issues, ItemRow, RefPicker } from "./form-kit";
import { theirsLoaded, typedFields } from "./held";
import type { FieldSpec, RefCollection } from "./schema";
import { deriveId, LIST_ITEMS } from "./schema";
import { kindIs, SelectorEditor, selectorOf, TagListInput, worldTags } from "./selector-editor";

export interface FormCtx {
  doc: WorldDoc;
  lint: readonly LintIssue[];
  /** Document path of the value, e.g. `entities.npc_dev`. */
  path: string;
  identifiers: readonly string[];
  /** The backend's formula functions (`Draft.functions`), for the expression editor. */
  functions: readonly string[];
  /** The packs' editors for structured fields (`UiRegistry.field`); without them those fields are JSON. */
  fieldEditors?: readonly FieldEditorDef[];
}

type ListSpec = Extract<FieldSpec, { kind: "list" }>;
type RecordSpec = Extract<FieldSpec, { kind: "record" }>;

export function lintAt(lint: readonly LintIssue[], path: string): LintIssue[] {
  return lint.filter((issue) => issue.path === path || issue.path.startsWith(`${path}.`));
}

/**
 * Pickable ids of a collection by name (ids stay hidden unless Show ids is on), sorted by name. Relations include
 * the built-in types; a pack's kinds and relation types name their pack on the second line, and
 * items that share a name are told apart there by their ids.
 */
export function refOptions(doc: WorldDoc, collection: RefCollection): RefOption[] {
  const source: Record<string, unknown> = doc[collection];
  const named = Object.entries(source).map(([id, entry]) => {
    const label = isRecord(entry) ? [entry.name, entry.label, entry.title].find((v): v is string => typeof v === "string" && v !== "") ?? id : id;
    const pack = (collection === "kinds" || collection === "relations") && isRecord(entry) && typeof entry.pack === "string" ? `${entry.pack} pack` : undefined;
    return { value: id, label, sublabel: pack };
  });
  if (collection === "relations") for (const id of BUILTIN_RELATIONS) if (!(id in source)) named.push({ value: id, label: id.replace(/_/g, " "), sublabel: "built-in" });
  const shared = new Set(named.filter((o, i) => named.findIndex((other) => other.label === o.label) !== i).map((o) => o.label));
  return named
    .map(({ value, label, sublabel }) => {
      const second = shared.has(label) ? [value, sublabel].filter((s) => s !== undefined).join(" · ") : sublabel;
      return second === undefined ? { value, label } : { value, label, sublabel: second };
    })
    .sort((a, b) => a.label.localeCompare(b.label) || a.value.localeCompare(b.value));
}

/** A kind's fields with inherited ones, child definitions winning; cycles stop the walk. */
export function kindFields(doc: WorldDoc, kindId: string): Record<string, FieldDef> {
  const chain: string[] = [];
  for (let id: string | undefined = kindId; id && !chain.includes(id); id = doc.kinds[id]?.extends) chain.push(id);
  const out: Record<string, FieldDef> = {};
  for (const id of chain.reverse()) Object.assign(out, doc.kinds[id]?.fields ?? {});
  return out;
}

/** The pack editor for an entity kind's field: the one registered on the nearest kind up its chain, else none. */
export function fieldEditorFor(editors: readonly FieldEditorDef[], doc: WorldDoc, kindId: string, field: string): FieldEditorDef | undefined {
  const seen: string[] = [];
  for (let id: string | undefined = kindId; id && !seen.includes(id); id = doc.kinds[id]?.extends) {
    seen.push(id);
    const found = editors.find((def) => def.kind === id && def.field === field);
    if (found) return found;
  }
  return undefined;
}

/** An item's name in a collection (its name, label or title), else its id. */
function nameIn(doc: WorldDoc, collection: RefCollection, id: string): string {
  const source: Record<string, unknown> = doc[collection];
  const entry = hasOwn(source, id) ? source[id] : undefined;
  return (isRecord(entry) ? [entry.name, entry.label, entry.title].find((v): v is string => typeof v === "string" && v !== "") : undefined) ?? id;
}

// ---------------------------------------------------------------- durations and the clock

/** Minutes per unit word, as `parseDuration` reads them. */
const UNIT_MINUTES: Readonly<Record<string, number>> = { d: 1440, day: 1440, days: 1440, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, m: 1, min: 1, mins: 1, minute: 1, minutes: 1, s: 1 / 60, sec: 1 / 60, secs: 1 / 60, second: 1 / 60, seconds: 1 / 60 };

/** Game minutes as an exact span `parseDuration` reads back: "1 d 2 h 5 min", "90 min" as "1 h 30 min", "0.5 min". */
export function durationText(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return String(minutes);
  if (!Number.isInteger(minutes)) return `${minutes} min`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [days > 0 ? `${days} d` : null, hours > 0 ? `${hours} h` : null, rest > 0 || (days === 0 && hours === 0) ? `${rest} min` : null];
  return parts.filter((p) => p !== null).join(" ");
}

/**
 * A typed span in game minutes, or null when it isn't one: a bare number is minutes ("90"); `h:mm`
 * is hours and minutes ("1:30"); else amounts with units ("1 h 30 min", "1.5h", "2 d", "30 s"), a
 * bare number after hours read as minutes ("1h30").
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (t === "") return null;
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  const clock = /^(\d+):([0-5]\d)$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  let total = 0;
  let rest = t;
  let last = 0;
  while (rest !== "") {
    const part = /^(\d+(?:\.\d+)?)\s*([a-z]+)[\s,]*/.exec(rest);
    const unit = part ? UNIT_MINUTES[part[2] ?? ""] : undefined;
    if (part && unit !== undefined) {
      total += Number(part[1]) * unit;
      last = unit;
      rest = rest.slice(part[0].length);
      continue;
    }
    const tail = /^(\d+)$/.exec(rest);
    if (tail && last === 60) return total + Number(tail[1]);
    return null;
  }
  return Math.round(total * 1000) / 1000;
}

/** What the clock helpers read of a calendar. */
type Clockwork = Pick<CalendarDef, "system" | "epoch">;

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Days since 1970-01-01 of a proleptic Gregorian date, or null for one that doesn't exist; day differences match the engine's calendar. */
function gregorianDay(year: number, month: number, day: number): number | null {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? Math.round(date.getTime() / DAY_MS) : null;
}

/** The epoch's minute of its day, and its day number in a Gregorian calendar (null in a custom one). */
function epochOf(calendar: Clockwork): { minute: number; day: number | null } | null {
  const m = LOCAL.exec(calendar.epoch);
  if (!m) return null;
  return { minute: Number(m[4]) * 60 + Number(m[5]), day: calendar.system === "gregorian" ? gregorianDay(Number(m[1]), Number(m[2]), Number(m[3])) : null };
}

/**
 * A clock reading as the day of the story (day 1 is the epoch's date) and the minute of that day.
 * The engine's clock counts local minutes from the epoch with no time-zone shifts
 * (`engine/calendar.ts` `clockAt`), so this is exact in any calendar.
 */
export function storyDay(clock: number, calendar: Clockwork): { day: number; minute: number } | null {
  const epoch = epochOf(calendar);
  if (!epoch) return null;
  const local = epoch.minute + Math.floor(clock);
  const index = Math.floor(local / 1440);
  return { day: index + 1, minute: local - index * 1440 };
}

/** The clock reading of a minute on a day of the story, the inverse of `storyDay`. */
export function clockOfStoryDay(day: number, minute: number, calendar: Clockwork): number | null {
  const epoch = epochOf(calendar);
  return epoch ? (day - 1) * 1440 + minute - epoch.minute : null;
}

/** A clock reading as local `YYYY-MM-DDTHH:MM` in a Gregorian world; null in a custom calendar or with an unreadable epoch. */
export function clockLocal(clock: number, calendar: Clockwork): string | null {
  const epoch = epochOf(calendar);
  const at = storyDay(clock, calendar);
  if (!epoch || epoch.day === null || !at) return null;
  const date = new Date((epoch.day + at.day - 1) * DAY_MS);
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(Math.floor(at.minute / 60))}:${pad(at.minute % 60)}`;
}

/** A local `YYYY-MM-DDTHH:MM` as a clock reading in a Gregorian world, the inverse of `clockLocal`; null when it isn't a real date and time. */
export function localClock(text: string, calendar: Clockwork): number | null {
  const epoch = epochOf(calendar);
  const m = LOCAL.exec(text);
  if (!epoch || epoch.day === null || !m) return null;
  const day = gregorianDay(Number(m[1]), Number(m[2]), Number(m[3]));
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  if (day === null || hour > 23 || minute > 59) return null;
  return (day - epoch.day) * 1440 + hour * 60 + minute - epoch.minute;
}

/** A clock reading in words for a summary line: "Tue, Oct 20, 09:00", or "Day 3, 09:00" in a custom calendar. */
function clockWords(clock: number, calendar: Clockwork): string {
  const local = clockLocal(clock, calendar);
  const m = local ? LOCAL.exec(local) : null;
  if (m) {
    const date = new Date(0);
    date.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return `${date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}, ${m[4]}:${m[5]}`;
  }
  const at = storyDay(clock, calendar);
  return at ? `Day ${at.day}, ${pad(Math.floor(at.minute / 60))}:${pad(at.minute % 60)}` : `minute ${clock}`;
}

// ---------------------------------------------------------------- field frame and inputs

/** A field's frame: its label over the control (tied to it by `for`), then its help, a typing problem and the lint. */
export function FieldFrame(props: { label: ComponentChildren; optional?: boolean; for?: string; help?: ComponentChildren; problem?: string | null; issues: readonly LintIssue[]; children: ComponentChildren }) {
  const label = (
    <>
      {props.label}
      {props.optional ? <span class="lre-form-optional"> · optional</span> : null}
    </>
  );
  return (
    <div class="lre-field">
      {props.for !== undefined ? <label for={props.for}>{label}</label> : <span class="label">{label}</span>}
      {props.children}
      {props.help ? <span class="lre-field-help">{props.help}</span> : null}
      {props.problem ? <Issues issues={[{ severity: "error", path: "", code: "input", message: props.problem }]} /> : null}
      <Issues issues={props.issues} />
    </div>
  );
}

/**
 * The text a field shows: what is typed while it is edited, else the value as text. A value that
 * changes from outside (Revert, Load theirs, a draft reload the form follows) replaces what was
 * typed, and Load theirs does even when it leaves the value as it was. From the first keystroke
 * until the field hands its value to the form (`handed`: as typed for plain text, on blur where
 * typed text is parsed), the typed text counts as an edit (`typedFields`): a change made elsewhere
 * then holds the form behind Build's notice rather than reaching the field.
 */
export function useFieldText(shown: string): [text: string, type: (text: string) => void, handed: () => void] {
  const loads = useSelect(theirsLoaded, (n) => n);
  const [, rerender] = useState(0);
  // What is typed, and the value and Load theirs it was typed over. A change of either replaces it as
  // the field renders, not in an effect: an effect still pending from the last keystroke's render
  // would put back that keystroke's value over the next one.
  const field = useRef({ text: shown, shown, loads, typing: false });
  if (field.current.shown !== shown || field.current.loads !== loads) field.current = { text: shown, shown, loads, typing: false };
  const { text, typing } = field.current;
  useEffect(() => {
    if (!typing) return undefined;
    typedFields.update((n) => n + 1);
    return () => typedFields.update((n) => n - 1);
  }, [typing]);
  const type = (next: string): void => {
    field.current = { ...field.current, text: next, typing: true };
    rerender((n) => n + 1);
  };
  const handed = (): void => {
    field.current = { ...field.current, typing: false };
    rerender((n) => n + 1);
  };
  return [text, type, handed];
}

/**
 * A text field. It hands what is typed to the form as it is typed, so the form (its Save, Revert and
 * Build's changed-elsewhere notice) has the edit from the first keystroke. With `commitOnBlur`, it
 * hands it over on blur instead: a date or time typed as text, which turns into a picker once it reads as one.
 */
export function TextInput(props: { label: string; value: JsonValue | undefined; multiline?: boolean; optional?: boolean; readonly?: boolean; hint?: string; mono?: boolean; placeholder?: string; commitOnBlur?: boolean; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const shown = typeof props.value === "string" ? props.value : "";
  const [text, type, handed] = useFieldText(shown);
  const hand = (next: string) => {
    if (!props.readonly && next !== shown) props.onChange(next === "" && props.optional ? undefined : next);
    handed();
  };
  const input = (next: string) => {
    type(next);
    if (!props.commitOnBlur) hand(next);
  };
  const attrs = { id, class: props.mono ? "lre-input lre-form-mono" : props.multiline ? "lre-input lre-form-prose" : "lre-input", readOnly: props.readonly, placeholder: props.placeholder, value: text, onBlur: () => hand(text) };
  return (
    <FieldFrame label={props.label} optional={props.optional} for={id} help={props.hint} issues={props.issues}>
      {props.multiline ? <textarea {...attrs} rows={6} onInput={(event) => input(event.currentTarget.value)} /> : <input {...attrs} onInput={(event) => input(event.currentTarget.value)} />}
    </FieldFrame>
  );
}

/** Why a typed number can't be kept, or null. */
function numberProblem(text: string, field: { min?: number; max?: number; step?: number; optional?: boolean }): string | null {
  const t = text.trim().replace(/\u2212/g, "-");
  if (t === "") return field.optional ? null : "Give a number.";
  const n = Number(t);
  if (!Number.isFinite(n)) return "Type a number.";
  if (field.min !== undefined && n < field.min) return `At least ${field.min}.`;
  if (field.max !== undefined && n > field.max) return `At most ${field.max}.`;
  if (field.step !== undefined && Number.isInteger(field.step) && !Number.isInteger(n)) return "A whole number.";
  return null;
}

export function NumberInput(props: { label: string; value: JsonValue | undefined; min?: number; max?: number; step?: number; optional?: boolean; hint?: string; placeholder?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const shown = typeof props.value === "number" ? String(props.value) : "";
  const [text, type, handed] = useFieldText(shown);
  // A stored value is the backend's to lint; only what is typed here is checked here.
  const problem = text === shown ? null : numberProblem(text, props);
  const range = props.min !== undefined && props.max !== undefined ? `${props.min} to ${props.max}` : props.min !== undefined ? `${props.min} or more` : props.max !== undefined ? `${props.max} or less` : null;
  const help = [props.hint, range].filter((h) => h).join(" · ");
  return (
    <FieldFrame label={props.label} optional={props.optional} for={id} help={help} problem={problem} issues={props.issues}>
      <input
        id={id}
        class={problem ? "lre-input invalid" : "lre-input"}
        inputMode={props.step !== undefined && Number.isInteger(props.step) && (props.min ?? 0) >= 0 ? "numeric" : "decimal"}
        aria-invalid={problem ? true : undefined}
        placeholder={props.placeholder}
        value={text}
        onInput={(event) => type(event.currentTarget.value)}
        onBlur={() => {
          // Text that can't be kept stays typed, an edit, until it can be or the value changes.
          if (problem !== null) return;
          handed();
          if (text === shown) return;
          const t = text.trim().replace(/\u2212/g, "-");
          props.onChange(t === "" ? undefined : Number(t));
        }}
      />
    </FieldFrame>
  );
}

/** Why typed money can't be kept, or null: an amount the currency can't write, or one out of range, in its own words. */
function moneyProblem(text: string, parsed: number | null, field: { currency: WorldCurrency; min?: number; max?: number; optional?: boolean }): string | null {
  if (text.trim() === "") return field.optional ? null : "Give an amount.";
  const example = formatMoney(1250 * 10 ** Math.max(0, field.currency.decimals - 2), field.currency);
  if (parsed === null) return field.currency.decimals > 0 ? `Type an amount like ${example}, with at most ${field.currency.decimals} decimals.` : `Type a whole amount like ${example}.`;
  if (field.min !== undefined && parsed < field.min) return `At least ${formatMoney(field.min, field.currency)}.`;
  if (field.max !== undefined && parsed > field.max) return `At most ${formatMoney(field.max, field.currency)}.`;
  return null;
}

/**
 * A money field Build stores as whole minor units, typed as the world's currency writes it ("12.50"
 * beside "$", "12" beside "bits"), never in minor units. `placeholder` is an amount as typed.
 */
export function MinorMoneyInput(props: { label: string; value: JsonValue | undefined; currency: WorldCurrency; min?: number; max?: number; optional?: boolean; hint?: string; placeholder?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const shown = typeof props.value === "number" ? formatMoneyInput(props.value, props.currency) : "";
  const [text, type, handed] = useFieldText(shown);
  const parsed = text.trim() === "" ? null : parseMoneyInput(text, props.currency);
  const problem = text === shown ? null : moneyProblem(text, parsed, props);
  return (
    <FieldFrame label={props.label} optional={props.optional} help={props.hint} problem={problem} issues={props.issues}>
      <MoneyInput
        currency={props.currency}
        value={text}
        onInput={type}
        label={props.label}
        invalid={problem !== null}
        placeholder={props.placeholder}
        onBlur={() => {
          if (problem !== null) return;
          handed();
          if (text !== shown) props.onChange(parsed === null ? undefined : parsed);
        }}
      />
    </FieldFrame>
  );
}

/** Game minutes typed as a span; the stored number reads back as "1 h 30 min". */
function DurationInput(props: { label: string; value: JsonValue | undefined; optional?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const shown = typeof props.value === "number" ? durationText(props.value) : "";
  const [text, type, handed] = useFieldText(shown);
  const parsed = parseDuration(text);
  const problem = text === shown ? null : text.trim() === "" ? (props.optional ? null : "Give a length of time.") : parsed === null ? "Type a span like 1 h 30 min, 90 (minutes) or 1:30." : null;
  return (
    <FieldFrame label={props.label} optional={props.optional} for={id} help={props.hint} problem={problem} issues={props.issues}>
      <input
        id={id}
        class={problem ? "lre-input invalid" : "lre-input"}
        aria-invalid={problem ? true : undefined}
        placeholder="e.g. 1 h 30 min"
        autoComplete="off"
        value={text}
        onInput={(event) => type(event.currentTarget.value)}
        onBlur={() => {
          if (problem !== null) return;
          handed();
          if (text !== shown) props.onChange(text.trim() === "" ? undefined : (parsed ?? undefined));
        }}
      />
    </FieldFrame>
  );
}

/**
 * A moment of the world's clock: a date and time in a Gregorian world, else the day of the story
 * and a time. A value that isn't a clock reading is kept, shown as it is, until a new one is picked.
 */
function GameTimeInput(props: { label: string; value: JsonValue | undefined; calendar: Clockwork; optional?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const clock = typeof props.value === "number" && Number.isFinite(props.value) ? props.value : null;
  const epoch = epochOf(props.calendar);
  const odd = props.value !== undefined && clock === null ? `Holds ${JSON.stringify(props.value)}, which isn't a time of the world's clock.` : null;
  const help = [props.hint, odd].filter((h) => h).join(" ");
  if (!epoch) return <NumberInput label={`${props.label} (minute of the world's clock)`} value={props.value} optional={props.optional} hint={props.hint} issues={props.issues} onChange={props.onChange} />;
  if (epoch.day !== null) {
    return (
      <FieldFrame label={props.label} optional={props.optional} for={id} help={help} issues={props.issues}>
        <input
          id={id}
          type="datetime-local"
          class="lre-input"
          value={clock === null ? "" : (clockLocal(clock, props.calendar) ?? "")}
          onChange={(event) => {
            const text = event.currentTarget.value;
            if (text === "") {
              if (props.optional) props.onChange(undefined);
              return;
            }
            const next = localClock(text, props.calendar);
            if (next !== null) props.onChange(next);
          }}
        />
      </FieldFrame>
    );
  }
  const at = clock === null ? null : storyDay(clock, props.calendar);
  const set = (day: number, minute: number) => {
    const next = clockOfStoryDay(day, minute, props.calendar);
    if (next !== null) props.onChange(next);
  };
  return (
    <FieldFrame label={props.label} optional={props.optional} help={help || "Day 1 is the day the world's clock starts."} issues={props.issues}>
      <div class="lre-form-daytime">
        <label class="lre-form-daytime-part">
          <span>Day</span>
          <input
            class="lre-input"
            inputMode="numeric"
            value={at ? String(at.day) : ""}
            onChange={(event) => {
              const day = Number(event.currentTarget.value);
              if (Number.isInteger(day)) set(day, at?.minute ?? 0);
            }}
          />
        </label>
        <label class="lre-form-daytime-part">
          <span>Time</span>
          <input
            type="time"
            class="lre-input"
            value={at ? `${pad(Math.floor(at.minute / 60))}:${pad(at.minute % 60)}` : ""}
            onChange={(event) => {
              const m = /^(\d{2}):(\d{2})$/.exec(event.currentTarget.value);
              if (m) set(at?.day ?? 1, Number(m[1]) * 60 + Number(m[2]));
            }}
          />
        </label>
      </div>
    </FieldFrame>
  );
}

/** A local date and time kept as `YYYY-MM-DDTHH:MM` text: a date-time picker in a Gregorian calendar, else the text itself. */
function LocalTimeInput(props: { label: string; value: JsonValue | undefined; gregorian: boolean; optional?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const text = typeof props.value === "string" ? props.value : "";
  if (!props.gregorian || (text !== "" && !LOCAL.test(text))) return <TextInput label={props.label} value={props.value} optional={props.optional} mono commitOnBlur hint={[props.hint, "Written YYYY-MM-DDTHH:MM"].filter((h) => h).join(" · ")} issues={props.issues} onChange={props.onChange} />;
  return (
    <FieldFrame label={props.label} optional={props.optional} for={id} help={props.hint} issues={props.issues}>
      <input
        id={id}
        type="datetime-local"
        class="lre-input"
        value={text}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (LOCAL.test(next)) props.onChange(next);
          else if (next === "" && props.optional) props.onChange(undefined);
        }}
      />
    </FieldFrame>
  );
}

/** A time of day kept as `HH:MM`. */
function TimeOfDayInput(props: { label: string; value: JsonValue | undefined; optional?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const text = typeof props.value === "string" ? props.value : "";
  if (text !== "" && !/^\d{2}:\d{2}$/.test(text)) return <TextInput label={props.label} value={props.value} optional={props.optional} mono commitOnBlur hint={[props.hint, "Written HH:MM"].filter((h) => h).join(" · ")} issues={props.issues} onChange={props.onChange} />;
  return (
    <FieldFrame label={props.label} optional={props.optional} for={id} help={props.hint} issues={props.issues}>
      <input
        id={id}
        type="time"
        class="lre-input"
        value={text}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (/^\d{2}:\d{2}$/.test(next)) props.onChange(next);
          else if (next === "" && props.optional) props.onChange(undefined);
        }}
      />
    </FieldFrame>
  );
}

/** A date field (relations' `since`): a date picker kept as `YYYY-MM-DD` in a Gregorian world; a clock reading stays one. */
export function DateInput(props: { label: string; value: JsonValue | undefined; calendar: Clockwork; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  if (typeof props.value === "number") return <GameTimeInput label={props.label} value={props.value} calendar={props.calendar} optional hint={props.hint} issues={props.issues} onChange={props.onChange} />;
  const text = typeof props.value === "string" ? props.value : "";
  if (props.calendar.system !== "gregorian" || (text !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(text))) return <TextInput label={props.label} value={props.value} optional commitOnBlur hint={[props.hint, "Written YYYY-MM-DD"].filter((h) => h).join(" · ")} issues={props.issues} onChange={props.onChange} />;
  return (
    <FieldFrame label={props.label} optional for={id} help={props.hint} issues={props.issues}>
      <input id={id} type="date" class="lre-input" value={text} onChange={(event) => props.onChange(event.currentTarget.value === "" ? undefined : event.currentTarget.value)} />
    </FieldFrame>
  );
}

/** A number when what is typed reads as one, else the text (a bill's day: 15, or Friday). */
function ScalarInput(props: { label: string; value: JsonValue | undefined; optional?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const shown = typeof props.value === "number" || typeof props.value === "string" ? String(props.value) : "";
  const [text, type, handed] = useFieldText(shown);
  return (
    <FieldFrame label={props.label} optional={props.optional} for={id} help={props.hint} issues={props.issues}>
      <input
        id={id}
        class="lre-input"
        value={text}
        onInput={(event) => type(event.currentTarget.value)}
        onBlur={() => {
          handed();
          if (text === shown) return;
          const t = text.trim();
          props.onChange(t === "" ? (props.optional ? undefined : "") : /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : t);
        }}
      />
    </FieldFrame>
  );
}

function JsonInput(props: { label: string; value: JsonValue | undefined; optional?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const shown = props.value === undefined ? "" : JSON.stringify(props.value, null, 2);
  const [text, type, handed] = useFieldText(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [shown]);
  return (
    <FieldFrame label={props.label} optional={props.optional} for={id} help={props.hint} problem={text === shown ? null : error} issues={props.issues}>
      <textarea
        id={id}
        class={error ? "lre-input lre-form-mono invalid" : "lre-input lre-form-mono"}
        rows={Math.min(10, Math.max(2, text.split("\n").length))}
        spellcheck={false}
        value={text}
        onInput={(event) => type(event.currentTarget.value)}
        onBlur={() => {
          if (text === shown) {
            handed();
            return;
          }
          if (text.trim() === "") {
            setError(null);
            handed();
            props.onChange(props.optional ? undefined : null);
            return;
          }
          try {
            props.onChange(JSON.parse(text) as JsonValue);
            setError(null);
            handed();
          } catch (e) {
            // Text that doesn't parse stays typed, an edit, until it does or the value changes.
            setError(`Not valid JSON: ${e instanceof Error ? e.message : "it doesn't parse"}. The last valid value is kept.`);
          }
        }}
      />
    </FieldFrame>
  );
}

/** A defined word ("one_many") as the form shows it ("one many"). */
function words(value: string): string {
  return value.replace(/_/g, " ");
}

/**
 * One of a fixed set of values: a segmented control when a required choice has four short values or
 * fewer, else a native select (the phone's own picker). A value outside the set stays listed as missing.
 */
export function ChoiceInput(props: { label: string; value: JsonValue | undefined; options: readonly RefOption[]; optional?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const id = useId();
  const current = typeof props.value === "string" ? props.value : "";
  const listed = props.options.some((o) => o.value === current);
  if (!props.optional && (listed || current === "") && props.options.length > 1 && props.options.length <= 4 && props.options.every((o) => o.label.length <= 12)) {
    return (
      <FieldFrame label={props.label} help={props.hint} issues={props.issues}>
        <Seg<string> label={props.label} value={current === "" ? null : current} options={props.options} onChange={(next) => props.onChange(next)} />
      </FieldFrame>
    );
  }
  const options = current !== "" && !listed ? [...props.options, { value: current, label: `${current} (missing)` }] : props.options;
  return (
    <FieldFrame label={props.label} optional={props.optional} for={id} help={props.hint} issues={props.issues}>
      <select id={id} class="lre-input" value={current} onChange={(event) => props.onChange(event.currentTarget.value === "" ? (props.optional ? undefined : "") : event.currentTarget.value)}>
        <option value="" disabled={!props.optional}>
          {props.optional ? "None" : "Choose…"}
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldFrame>
  );
}

/** A reference by name (`RefPicker`), with the field's help and lint under it. `unmarked`: an optional one without the "optional" mark, on a page that drops it. */
export function RefInput(props: { label: string; value: JsonValue | undefined; options: readonly RefOption[]; optional?: boolean; unmarked?: boolean; hint?: string; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  return (
    <div class="lre-field">
      <RefPicker label={props.optional && props.unmarked !== true ? `${props.label} · optional` : props.label} value={typeof props.value === "string" ? props.value : ""} options={props.options} none={props.optional ? "None" : undefined} onChange={(next) => props.onChange(next === "" ? (props.optional ? undefined : "") : next)} />
      {props.hint ? <span class="lre-field-help">{props.hint}</span> : null}
      <Issues issues={props.issues} />
    </div>
  );
}

// ---------------------------------------------------------------- lists and records

/** What a new item of a list or record starts as. */
function blankOf(spec: FieldSpec): JsonValue {
  switch (spec.kind) {
    case "object":
    case "record":
    case "effectArgs":
    case "kindFields":
    case "relationFields":
      return {};
    case "list":
    case "refs":
    case "tags":
    case "tagList":
      return [];
    case "number":
    case "duration":
    case "money":
      return 0;
    case "bool":
      return false;
    default:
      return "";
  }
}

/** A value as a summary line shows it: in the world's currency, as a span or a date, a reference by name. */
function valueWords(field: FieldSpec, value: JsonValue | undefined, ctx: FormCtx): string {
  if (value === undefined || value === null || value === "") return "";
  switch (field.kind) {
    case "money":
      return typeof value === "number" ? formatMoney(value, ctx.doc.currency) : "";
    case "duration":
      return typeof value === "number" ? durationText(value) : "";
    case "gameTime":
      return typeof value === "number" ? clockWords(value, ctx.doc.calendar) : "";
    case "ref":
      return typeof value === "string" ? nameIn(ctx.doc, field.collection, value) : "";
    case "bool":
      return value === true ? field.label : "";
    case "number":
      return typeof value === "number" ? `${field.label} ${value}` : "";
    case "effectArgs":
      return isRecord(value) ? Object.entries(value).map(([arg, v]) => `${arg} ${typeof v === "string" ? v : JSON.stringify(v)}`).join(", ") : "";
    case "list":
      return Array.isArray(value) ? `${value.length} ${field.label.toLowerCase()}` : "";
    case "enum":
      return typeof value === "string" ? (field.labels?.[value] ?? words(value)) : "";
    case "text":
    case "expr":
    case "dice":
    case "scalar":
    case "timeOfDay":
    case "localTime":
      return typeof value === "string" || typeof value === "number" ? String(value) : "";
    default:
      return "";
  }
}

/** A list or record item's name: its title field, a reference by name, else `fallback`. */
function itemTitle(item: JsonValue | undefined, spec: FieldSpec, titleKey: string | undefined, ctx: FormCtx, fallback: string): string {
  if (spec.kind === "object" && isRecord(item) && titleKey) {
    const field = spec.fields.find((f) => f.key === titleKey);
    const shown = field ? valueWords(field, item[titleKey], ctx) : "";
    if (shown !== "") return shown;
  }
  if (spec.kind !== "object" && item !== undefined) {
    const shown = valueWords(spec, item, ctx);
    if (shown !== "") return shown;
  }
  return fallback;
}

/** A short line for an item row: its first few set values after the title. */
function itemSummary(item: JsonValue | undefined, spec: FieldSpec, titleKey: string | undefined, ctx: FormCtx): string {
  if (spec.kind === "list") return Array.isArray(item) ? (item.length === 0 ? "None yet" : `${item.length} ${item.length === 1 ? spec.item.label.toLowerCase() : spec.label.toLowerCase()}`) : "";
  if (spec.kind !== "object" || !isRecord(item)) return "";
  const parts: string[] = [];
  for (const field of spec.fields) {
    if (field.key === titleKey) continue;
    const shown = valueWords(field, item[field.key], ctx);
    if (shown !== "" && !parts.includes(shown)) parts.push(shown);
    if (parts.length === 3) break;
  }
  return parts.join(" · ");
}

/** The lint count on an item row, in the colour of its worst issue. */
export function LintBadge(props: { issues: readonly LintIssue[] }) {
  if (props.issues.length === 0) return null;
  const tone = props.issues.some((i) => i.severity === "error") ? "neg" : props.issues.some((i) => i.severity === "warning") ? "warn" : "";
  return <span class={tone ? `lre-badge ${tone}` : "lre-badge"}>{props.issues.length === 1 ? "1 issue" : `${props.issues.length} issues`}</span>;
}

/**
 * A list (a typed list editor): items of objects as rows that open as sheets, with
 * move up, move down and remove; scalar items inline. Add appends a blank item and opens it.
 */
function ListInput(props: { spec: ListSpec; value: JsonValue | undefined; ctx: FormCtx; path: string; onChange(value: JsonValue | undefined): void }) {
  const { spec, ctx } = props;
  const items: JsonValue[] = Array.isArray(props.value) ? props.value : [];
  const [open, setOpen] = useState<number | null>(null);
  // Objects, lists and records open as sheets; scalars edit in place.
  const structured = spec.item.kind === "object" || spec.item.kind === "list" || spec.item.kind === "record";
  const noun = spec.item.label.toLowerCase();
  const nameOf = (index: number) => itemTitle(items[index], spec.item, spec.title, ctx, `${spec.item.label} ${index + 1}`);
  const put = (next: JsonValue[]) => props.onChange(next);
  const setItem = (index: number, next: JsonValue | undefined) => put(items.map((entry, i) => (i === index ? (next ?? blankOf(spec.item)) : entry)));
  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    put(next);
  };
  const remove = (index: number) => {
    setOpen(null);
    put(items.filter((_, i) => i !== index));
  };
  const actions = (index: number) => (
    <>
      {items.length > 1 ? (
        <>
          <IconButton icon="chevron-up" label={`Move ${nameOf(index)} up`} disabled={index === 0} onClick={() => move(index, index - 1)} />
          <IconButton icon="chevron-down" label={`Move ${nameOf(index)} down`} disabled={index === items.length - 1} onClick={() => move(index, index + 1)} />
        </>
      ) : null}
      <IconButton icon="trash" label={`Remove ${nameOf(index)}`} onClick={() => remove(index)} />
    </>
  );
  const sheetItem = open !== null ? items[open] : undefined;
  return (
    <div class="lre-field lre-form-list" data-lre-list={spec.key || undefined}>
      <div class="lre-form-list-head">
        <span class="label">{spec.label}</span>
        <span class="lre-badge">{items.length}</span>
      </div>
      {spec.hint ? <span class="lre-field-help">{spec.hint}</span> : null}
      {structured ? (
        <div class="lre-form-items">
          {items.length === 0 ? <span class="lre-form-items-none">None yet.</span> : null}
          {items.map((item, index) => (
            <ItemRow key={index} title={nameOf(index)} subtitle={itemSummary(item, spec.item, spec.title, ctx) || undefined} badge={<LintBadge issues={lintAt(ctx.lint, `${props.path}.${index}`)} />} onOpen={() => setOpen(index)} openLabel={`Edit ${nameOf(index)}`} actions={actions(index)} />
          ))}
        </div>
      ) : (
        items.map((item, index) => (
          <div key={index} class="lre-form-scalar">
            <div class="lre-form-scalar-field">
              <FieldInput spec={{ ...spec.item, label: `${spec.item.label} ${index + 1}` }} value={item} ctx={ctx} path={`${props.path}.${index}`} parent={{}} onChange={(next) => setItem(index, next)} />
            </div>
            <span class="lre-form-scalar-actions">{actions(index)}</span>
          </div>
        ))
      )}
      <Issues issues={ctx.lint.filter((issue) => issue.path === props.path)} />
      <div class="lre-form-list-add">
        <Button
          size="sm"
          icon="plus"
          onClick={() => {
            put([...items, blankOf(spec.item)]);
            if (structured) setOpen(items.length);
          }}
        >
          Add {noun}
        </Button>
      </div>
      {open !== null && sheetItem !== undefined ? (
        <FormSheet title={nameOf(open)} subtitle={`${spec.item.label} ${open + 1} of ${items.length}`} backLabel={spec.label} onClose={() => setOpen(null)}>
          <FieldInput spec={spec.item} value={sheetItem} ctx={ctx} path={`${props.path}.${open}`} parent={{}} onChange={(next) => setItem(open, next)} />
          <div class="lre-form-sheet-actions">
            <Button variant="danger" icon="trash" onClick={() => remove(open)}>
              Remove {noun}
            </Button>
            <Button variant="primary" onClick={() => setOpen(null)}>
              Done
            </Button>
          </div>
        </FormSheet>
      ) : null}
    </div>
  );
}

/** Why a new record key can't be used, or null. */
function keyProblem(key: string, taken: ReadonlySet<string>): string | null {
  if (key === "") return null;
  if (taken.has(key)) return "There's already one with this id.";
  return safeKey(key) ? null : "This id is reserved. Choose another.";
}

/**
 * A new record entry. One whose item has a label asks for a name and derives the key from it,
 * the key editable under Advanced or in the open while Show ids is on; any other asks
 * for the key itself, with suggestions.
 */
export function NewKey(props: { named: boolean; keyLabel: string; noun: string; taken: ReadonlySet<string>; suggestions: readonly string[]; onAdd(key: string, label?: string): void; onCancel(): void }) {
  const showIds = useShowIds();
  const nameId = useId();
  const keyId = useId();
  const listId = useId();
  const [name, setName] = useState("");
  const [typed, setTyped] = useState<string | null>(null);
  const key = (typed ?? (props.named && name.trim() !== "" ? deriveId(name.trim(), props.taken) : "")).trim();
  const problem = keyProblem(key, props.taken);
  const ready = key !== "" && problem === null && (!props.named || name.trim() !== "");
  const keyField = (
    <div class="lre-field">
      <label for={keyId}>{props.named ? "Id" : props.keyLabel}</label>
      <input id={keyId} class="lre-input lre-form-mono" list={props.named ? undefined : listId} autoComplete="off" spellcheck={false} value={key} onInput={(event) => setTyped(event.currentTarget.value.replace(/\s+/g, "_"))} />
      {props.named ? <span class="lre-field-help">How rules and formulas name it. It follows the name until you change it.</span> : null}
      {problem ? <Issues issues={[{ severity: "error", path: "", code: "key", message: problem }]} /> : null}
      {props.named ? null : (
        <datalist id={listId}>
          {props.suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </div>
  );
  return (
    <form
      class="lre-form-group lre-form-newkey"
      aria-label={`New ${props.noun}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) props.onAdd(key, props.named ? name.trim() : undefined);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onCancel();
      }}
    >
      {props.named ? (
        <>
          <div class="lre-field">
            <label for={nameId}>Name of the new {props.noun}</label>
            <input id={nameId} class="lre-input" autoComplete="off" value={name} onInput={(event) => setName(event.currentTarget.value)} />
          </div>
          {showIds ? keyField : <Disclosure summary="Advanced">{keyField}</Disclosure>}
        </>
      ) : (
        keyField
      )}
      <div class="lre-form-sheet-actions">
        <Button type="submit" variant="primary" icon="plus" disabled={!ready}>
          Add
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * A record (a map by key): entries of objects as rows that open as sheets, scalar entries inline.
 * Fixed keys (travel modes) are added from buttons; others through `NewKey`.
 */
function RecordInput(props: { spec: RecordSpec; value: JsonValue | undefined; ctx: FormCtx; path: string; parent: JsonObject; onChange(value: JsonValue | undefined): void }) {
  const { spec, ctx } = props;
  const record: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  const keys = Object.keys(record);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const item = spec.item;
  const structured = item.kind === "object" || item.kind === "list" || item.kind === "record";
  const named = item.kind === "object" && item.fields.some((f) => f.key === "label" && f.kind === "text");
  const noun = (item.kind === "object" ? item.label : spec.keyLabel).toLowerCase();
  const titleOf = (key: string): string => {
    const entry = record[key];
    return named && isRecord(entry) && typeof entry.label === "string" && entry.label !== "" ? entry.label : key;
  };
  const put = (next: JsonObject) => props.onChange(next);
  const remove = (key: string) => {
    const next = { ...record };
    delete next[key];
    setOpen(null);
    put(next);
  };
  const add = (key: string, label?: string) => {
    put({ ...record, [key]: label !== undefined ? { label } : blankOf(item) });
    setAdding(false);
    if (structured) setOpen(key);
  };
  const fixed = spec.keys ? spec.keys.filter((key) => !(key in record)) : null;
  // An action's outcomes: those its check can roll, and `default` for no check.
  const check = spec.suggest === "outcomes" && typeof props.parent.check === "string" && hasOwn(ctx.doc.checks, props.parent.check) ? ctx.doc.checks[props.parent.check] : undefined;
  const suggestions = spec.suggest === "outcomes" ? [...(check?.bands?.map((b) => b.outcome) ?? []), "default"].filter((o, i, all) => !(o in record) && all.indexOf(o) === i) : [];
  const sheetEntry = open !== null && hasOwn(record, open) ? record[open] : undefined;
  return (
    <div class="lre-field lre-form-list" data-lre-record={spec.key || undefined}>
      <div class="lre-form-list-head">
        <span class="label">{spec.label}</span>
        <span class="lre-badge">{keys.length}</span>
      </div>
      {spec.hint ? <span class="lre-field-help">{spec.hint}</span> : null}
      {structured ? (
        <div class="lre-form-items">
          {keys.length === 0 ? <span class="lre-form-items-none">None yet.</span> : null}
          {keys.map((key) => (
            <ItemRow
              key={key}
              title={titleOf(key)}
              subtitle={
                <>
                  {itemSummary(record[key], item, named ? "label" : undefined, ctx)}
                  {titleOf(key) !== key ? <IdText id={key} /> : null}
                </>
              }
              badge={<LintBadge issues={lintAt(ctx.lint, `${props.path}.${key}`)} />}
              onOpen={() => setOpen(key)}
              openLabel={`Edit ${titleOf(key)}`}
              actions={<IconButton icon="trash" label={`Remove ${titleOf(key)}`} onClick={() => remove(key)} />}
            />
          ))}
        </div>
      ) : (
        keys.map((key) => (
          <div key={key} class="lre-form-scalar">
            <div class="lre-form-scalar-field">
              <FieldInput spec={{ ...item, label: words(key) }} value={record[key]} ctx={ctx} path={`${props.path}.${key}`} parent={{}} onChange={(next) => put({ ...record, [key]: next ?? blankOf(item) })} />
            </div>
            <span class="lre-form-scalar-actions">
              <IconButton icon="trash" label={`Remove ${words(key)}`} onClick={() => remove(key)} />
            </span>
          </div>
        ))
      )}
      <Issues issues={ctx.lint.filter((issue) => issue.path === props.path)} />
      {fixed ? (
        fixed.length > 0 ? (
          <div class="lre-form-list-add">
            {fixed.map((key) => (
              <Button key={key} size="sm" icon="plus" onClick={() => add(key)}>
                {humanize(key)}
              </Button>
            ))}
          </div>
        ) : null
      ) : adding ? (
        <NewKey named={named} keyLabel={spec.keyLabel} noun={noun} taken={new Set(keys)} suggestions={suggestions} onAdd={add} onCancel={() => setAdding(false)} />
      ) : (
        <div class="lre-form-list-add">
          <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
            Add {noun}
          </Button>
        </div>
      )}
      {open !== null && sheetEntry !== undefined ? (
        <FormSheet title={titleOf(open)} subtitle={titleOf(open) !== open ? <IdText id={open} /> : undefined} backLabel={spec.label} onClose={() => setOpen(null)}>
          <FieldInput spec={item} value={sheetEntry} ctx={ctx} path={`${props.path}.${open}`} parent={{}} onChange={(next) => put({ ...record, [open]: next ?? blankOf(item) })} />
          <div class="lre-form-sheet-actions">
            <Button variant="danger" icon="trash" onClick={() => remove(open)}>
              Remove {noun}
            </Button>
            <Button variant="primary" onClick={() => setOpen(null)}>
              Done
            </Button>
          </div>
        </FormSheet>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- fields typed by a kind or relation type

/** The spec of a list field's elements of type `of`, for a typed scalar list. */
function elementSpec(def: FieldDef, label: string): FieldSpec | null {
  switch (def.of) {
    case "number":
      return { kind: "number", key: "", label };
    case "money":
      return { kind: "money", key: "", label };
    case "duration":
      return { kind: "duration", key: "", label };
    case "bool":
      return { kind: "bool", key: "", label };
    case "dice":
      return { kind: "dice", key: "", label };
    case "enum":
      return { kind: "enum", key: "", label, values: def.values ?? [] };
    case "ref":
      return { kind: "ref", key: "", label, collection: "entities" };
    case "text":
    case "date":
      return { kind: "text", key: "", label };
    default:
      return null;
  }
}

/** A pool's note: what it fills up to (DESIGN §11). */
function poolNote(def: FieldDef, defs: Readonly<Record<string, FieldDef>>): string | null {
  if (!def.pool) return null;
  const max = def.pool.max;
  const named = hasOwn(defs, max) ? (defs[max]?.label ?? humanize(max)) : `the formula ${max}`;
  return `Holds up to ${named}; full when empty`;
}

/**
 * One field typed by its definition (a kind's or a relation type's): a derived field shows its
 * formula read-only with what it reads; the rest by type, money in the world's currency, durations
 * as spans, references and table rows by name, the packs' lists of objects as typed lists.
 * `words`: the page's own lines about the field (the Character page's), shown in place of the
 * builder's notes (the level a field comes from, a pool's max) on a page that reads like a form a
 * person fills in; a number still shows its range, and that page hides the "optional" mark itself.
 */
export function DefInput(props: { name: string; def: FieldDef; defs: Readonly<Record<string, FieldDef>>; value: JsonValue | undefined; ctx: FormCtx; path: string; words?: readonly string[]; onChange(value: JsonValue | undefined): void }) {
  const { def, ctx, name } = props;
  const label = def.label ?? humanize(name);
  const issues = lintAt(ctx.lint, props.path);
  const notes = props.words ?? [def.level ? `From level ${def.level} (${LEVEL_LABEL[def.level]})` : null, def.locked ? "Never offered to a model" : null, def.visibility === "secret" ? "Secret" : def.visibility === "known_by" ? "Known only to some" : null].filter((n): n is string => n !== null);
  const help = notes.join(" · ") || undefined;
  const placeholder = def.default === undefined || def.default === null ? undefined : `Default: ${typeof def.default === "string" ? def.default : JSON.stringify(def.default)}`;
  if (def.derived) {
    return (
      <div class="lre-field" data-lre-derived={name}>
        <span class="label">
          {label}
          <span class="lre-form-optional"> · worked out</span>
        </span>
        <code class="lre-form-formula">{def.derived}</code>
        <ExprReadout text={def.derived} doc={ctx.doc} />
        <span class="lre-field-help">{["Worked out from its formula, never stored", ...notes].join(" · ")}</span>
        <Issues issues={issues} />
      </div>
    );
  }
  switch (def.type) {
    case "number":
      return <NumberInput label={label} value={props.value} min={def.min} max={def.max} optional hint={(props.words ? [help] : [poolNote(def, props.defs), def.bands?.length ? `Shown as ${def.bands.map((b) => b.label).join(", ")}` : null, help]).filter((h) => h).join(" · ") || undefined} placeholder={placeholder} issues={issues} onChange={props.onChange} />;
    case "duration":
      return <DurationInput label={label} value={props.value} optional hint={help} issues={issues} onChange={props.onChange} />;
    case "date":
      return <DateInput label={label} value={props.value} calendar={ctx.doc.calendar} hint={help} issues={issues} onChange={props.onChange} />;
    case "money":
      return <MinorMoneyInput label={label} value={props.value} currency={ctx.doc.currency} min={def.min} max={def.max} optional hint={help} placeholder={typeof def.default === "number" ? formatMoneyInput(def.default, ctx.doc.currency) : undefined} issues={issues} onChange={props.onChange} />;
    case "bool":
      return <CheckField label={label} help={help} checked={props.value === true} issues={issues} onChange={(checked) => props.onChange(checked)} />;
    case "enum":
      return <ChoiceInput label={label} value={props.value} options={(def.values ?? []).map((v) => ({ value: v, label: words(v) }))} optional hint={help} issues={issues} onChange={props.onChange} />;
    case "ref": {
      // A kinded ref names an entity of that kind; an unkinded one any place or entity (world lint's rule), places first.
      const options = def.ref
        ? refOptions(ctx.doc, "entities").filter((o) => kindIs(ctx.doc, ctx.doc.entities[o.value]?.kind ?? "", def.ref ?? ""))
        : [...refOptions(ctx.doc, "places").map((o) => ({ ...o, sublabel: o.sublabel ? `Place · ${o.sublabel}` : "Place" })), ...refOptions(ctx.doc, "entities")];
      return <RefInput label={label} value={props.value} options={options} optional unmarked={props.words !== undefined} hint={help} issues={issues} onChange={props.onChange} />;
    }
    case "list": {
      const shape = hasOwn(LIST_ITEMS, name) ? LIST_ITEMS[name] : undefined;
      if (shape) return <ListInput spec={{ kind: "list", key: name, label, item: shape.item, title: shape.title, hint: help }} value={props.value} ctx={ctx} path={props.path} onChange={props.onChange} />;
      const element = elementSpec(def, def.label ?? "Item");
      if (element) return <ListInput spec={{ kind: "list", key: name, label, item: element, hint: help }} value={props.value} ctx={ctx} path={props.path} onChange={props.onChange} />;
      return <JsonInput label={label} value={props.value} optional hint={["A list, written as JSON", help].filter((h) => h).join(" · ")} issues={issues} onChange={props.onChange} />;
    }
    case "dice":
      return <TextInput label={label} value={props.value} optional mono hint={["Dice, e.g. 2d6+1", help].filter((h) => h).join(" · ")} placeholder={placeholder} issues={issues} onChange={props.onChange} />;
    default: {
      // A text field naming a row of a data table picks the row by its name, while the world has the table.
      const table = def.table && hasOwn(ctx.doc.tables, def.table) ? ctx.doc.tables[def.table] : undefined;
      // The page's own words already name the table where its name adds something, so they stand alone.
      if (table) return <RefInput label={label} value={props.value} options={tableChoices(table).map((c) => ({ value: c.key, label: c.label }))} optional unmarked={props.words !== undefined} hint={(props.words ? [help] : [`A row of ${table.label}`, help]).filter((h) => h).join(" · ") || undefined} issues={issues} onChange={props.onChange} />;
      return <TextInput label={label} value={props.value} optional placeholder={placeholder} hint={help} issues={issues} onChange={props.onChange} />;
    }
  }
}

/** Values a definition set doesn't define, as JSON under Advanced: kept as they are, read only by what names them. */
function OtherValues(props: { values: JsonObject; defs: Readonly<Record<string, FieldDef>>; ctx: FormCtx; path: string; onChange(value: JsonObject): void }) {
  const extra = Object.keys(props.values).filter((key) => !hasOwn(props.defs, key));
  if (extra.length === 0) return null;
  return (
    <Disclosure summary={`Advanced: other values (${extra.length})`}>
      <JsonInput
        label="Values not defined here"
        hint="Kept as they are. Only what reads them by name uses them."
        value={Object.fromEntries(extra.map((key) => [key, props.values[key] ?? null]))}
        issues={extra.flatMap((key) => lintAt(props.ctx.lint, `${props.path}.${key}`))}
        onChange={(next) => props.onChange({ ...Object.fromEntries(Object.entries(props.values).filter(([key]) => hasOwn(props.defs, key))), ...(isRecord(next) ? (next as JsonObject) : {}) })}
      />
    </Disclosure>
  );
}

/** Sets or clears one key of a JSON object. */
function withKey(values: JsonObject, key: string, next: JsonValue | undefined): JsonObject {
  const out = { ...values };
  if (next === undefined) delete out[key];
  else out[key] = next;
  return out;
}

/**
 * An entity's fields, typed by its kind and grouped by realism domain: a pack's fields come alive
 * with its domain's level (DESIGN §9), so they read together. A structured field the kind's pack
 * draws itself (`UiRegistry.field`) gets that editor; a derived one stays read-only.
 */
function KindFieldsInput(props: { value: JsonValue | undefined; kind: string; entityId: string; ctx: FormCtx; path: string; onChange(value: JsonValue | undefined): void }) {
  const { ctx } = props;
  const values: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  if (!props.kind) {
    return (
      <div class="lre-field">
        <span class="label">Fields</span>
        <span class="lre-field-help">Choose a kind to edit its fields.</span>
      </div>
    );
  }
  const defs = kindFields(ctx.doc, props.kind);
  const groups = ([null, ...DOMAINS] as const).map((domain: DomainId | null) => ({ domain, entries: Object.entries(defs).filter(([, def]) => (def.domain ?? null) === domain) })).filter((group) => group.entries.length > 0);
  const kindLabel = ctx.doc.kinds[props.kind]?.label ?? props.kind;
  return (
    <div class="lre-form-kindfields" data-lre-kind-fields={props.kind}>
      {groups.map((group) => (
        <FormGroup key={group.domain ?? "general"} title={group.domain ? DOMAIN_LABEL[group.domain] : `${kindLabel} fields`}>
          {group.entries.map(([key, def]) => {
            const own = def.derived ? undefined : fieldEditorFor(ctx.fieldEditors ?? [], ctx.doc, props.kind, key);
            return own ? (
              <own.component key={key} doc={ctx.doc} entity={{ id: props.entityId, kind: props.kind, fields: values }} field={key} def={def} value={values[key]} lint={lintAt(ctx.lint, `${props.path}.${key}`)} path={`${props.path}.${key}`} onChange={(next) => props.onChange(withKey(values, key, next))} />
            ) : (
              <DefInput key={key} name={key} def={def} defs={defs} value={values[key]} ctx={ctx} path={`${props.path}.${key}`} onChange={(next) => props.onChange(withKey(values, key, next))} />
            );
          })}
        </FormGroup>
      ))}
      {groups.length === 0 ? <span class="lre-field-help">{kindLabel} has no fields.</span> : null}
      <OtherValues values={values} defs={defs} ctx={ctx} path={props.path} onChange={props.onChange} />
    </div>
  );
}

/** A relation's own fields, typed by its relation type; none to show for a type that defines none. */
function RelationFieldsInput(props: { value: JsonValue | undefined; type: string; ctx: FormCtx; path: string; onChange(value: JsonValue | undefined): void }) {
  const { ctx } = props;
  const values: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  const defs = props.type && hasOwn(ctx.doc.relations, props.type) ? (ctx.doc.relations[props.type]?.fields ?? {}) : {};
  const set = (next: JsonObject) => props.onChange(Object.keys(next).length > 0 ? next : undefined);
  if (Object.keys(defs).length === 0 && Object.keys(values).length === 0) return null;
  return (
    <div class="lre-form-fields">
      {Object.entries(defs).map(([key, def]) => (
        <DefInput key={key} name={key} def={def} defs={defs} value={values[key]} ctx={ctx} path={`${props.path}.${key}`} onChange={(next) => set(withKey(values, key, next))} />
      ))}
      <OtherValues values={values} defs={defs} ctx={ctx} path={props.path} onChange={set} />
    </div>
  );
}

// ---------------------------------------------------------------- realism levels

/** A level per domain; with `floors`, the world ruleset's floors are named and the levels below them can't be picked. */
function LevelsInput(props: { label: string; value: JsonValue | undefined; floors?: Partial<Record<DomainId, Level>>; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const base = useId();
  const values: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  const note = props.floors ? floorNote(props.floors) : null;
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      {note ? (
        <span class="lre-field-help" data-lre-floors>
          {note} A chat never plays below those levels, whatever the defaults say.
        </span>
      ) : null}
      <div class="lre-form-levels">
        {DOMAINS.map((domain) => {
          const floor = props.floors?.[domain] ?? 0;
          return (
            <div key={domain} class="lre-form-level">
              <label for={`${base}-${domain}`}>
                {DOMAIN_LABEL[domain]}
                {floor > 0 ? <span class="lre-form-optional"> · at least {floor}</span> : null}
              </label>
              <select
                id={`${base}-${domain}`}
                class="lre-input"
                value={typeof values[domain] === "number" ? String(values[domain]) : ""}
                onChange={(event) => {
                  const out = { ...values };
                  if (event.currentTarget.value === "") delete out[domain];
                  else out[domain] = Number(event.currentTarget.value);
                  props.onChange(Object.keys(out).length > 0 ? out : undefined);
                }}
              >
                <option value="">Not set</option>
                {([0, 1, 2, 3, 4] as const).map((level) => (
                  <option key={level} value={String(level)} disabled={level < floor}>
                    {level} · {LEVEL_LABEL[level]}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <Issues issues={props.issues} />
    </div>
  );
}

/** A cap per domain for each detail band, under the band labels; "—" is no cap (the domain level). */
function BandCapsInput(props: { label: string; value: JsonValue | undefined; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const caps: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
  const capsOf = (band: (typeof BANDS)[number]): JsonObject => {
    const c = caps[band];
    return isRecord(c) ? (c as JsonObject) : {};
  };
  return (
    <div class="lre-field">
      <span class="label">{props.label}</span>
      <span class="lre-field-help">How deeply each band's people are simulated, at most, per domain. A dash is no cap: the domain's level.</span>
      <div class="lre-tier-wrap">
        <div class="lre-tier-grid" role="table" aria-label={props.label} lang="en">
          <div role="row" class="lre-form-contents">
            <span role="columnheader">
              <span class="lre-sr">Domain</span>
            </span>
            {BANDS.map((band) => (
              <span key={band} class="lre-muted" role="columnheader">
                {BAND_LABEL[band]}
              </span>
            ))}
          </div>
          {DOMAINS.map((domain) => (
            <div key={domain} role="row" class="lre-form-contents">
              <span role="rowheader">{DOMAIN_LABEL[domain]}</span>
              {BANDS.map((band) => {
                const cap = capsOf(band)[domain];
                return (
                  <span key={band} role="cell" class="lre-form-contents">
                    <select
                      class="lre-input"
                      aria-label={`${DOMAIN_LABEL[domain]} cap for ${BAND_LABEL[band]}`}
                      value={typeof cap === "number" ? String(cap) : ""}
                      onChange={(event) => {
                        // Every band keeps its record, so the document always has all three.
                        const out: JsonObject = Object.fromEntries(BANDS.map((b) => [b, { ...capsOf(b) }]));
                        const edited = out[band] as JsonObject;
                        if (event.currentTarget.value === "") delete edited[domain];
                        else edited[domain] = Number(event.currentTarget.value);
                        props.onChange(out);
                      }}
                    >
                      <option value="">—</option>
                      {[0, 1, 2, 3, 4].map((level) => (
                        <option key={level} value={String(level)}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <Issues issues={props.issues} />
    </div>
  );
}

/**
 * The world's player-claims default (DESIGN §9.4), with the control Settings and GM mode use. Off, the
 * world sets none and a new chat takes the player's own; switched on, it starts from what the world's
 * realism preset plays claims by, so a Simulation world starts at Ask first.
 */
export function ClaimsInput(props: { label: string; value: JsonValue | undefined; preset: JsonValue | undefined; issues: readonly LintIssue[]; onChange(value: JsonValue | undefined): void }) {
  const policy = readClaims(props.value);
  const seed = props.preset === "story" || props.preset === "grounded" || props.preset === "simulation" ? CLAIM_PRESETS[props.preset] : DEFAULT_CLAIMS;
  return (
    <div class="lre-field" data-lre-claims="world">
      <span class="label">{props.label}</span>
      <HostSwitch label="This world sets what new chats make of them" checked={props.value !== undefined} onChange={(on) => props.onChange(on ? { mode: seed.mode, capped: seed.capped } : undefined)} />
      {policy ? (
        <ClaimsControl value={policy} onChange={(next) => props.onChange({ mode: next.mode, capped: next.capped })} />
      ) : props.value === undefined ? (
        <span class="lre-field-help">Not set: a new chat takes the player's own setting (Settings → Realism).</span>
      ) : null}
      <Issues issues={props.issues} />
    </div>
  );
}

// ---------------------------------------------------------------- the form

/** Whether a checkbox shows ticked: as the engine reads the value (a lore `secret` that isn't false is secret), else only `true`. */
export function boolChecked(spec: Extract<FieldSpec, { kind: "bool" }>, value: JsonValue | undefined): boolean {
  return spec.reads ? spec.reads(value) : value === true;
}

/** "an entity or a place", for an add picker's placeholder. */
const COLLECTION_WORDS: Readonly<Record<RefCollection, string>> = { kinds: "a kind", relations: "a relation type", entities: "an entity", places: "a place", grids: "a grid", checks: "a check", tracks: "a track", tables: "a data table", lore: "a lore entry" };

export function FieldInput(props: { spec: FieldSpec; value: JsonValue | undefined; ctx: FormCtx; path: string; parent: JsonObject; onChange(value: JsonValue | undefined): void }) {
  const { spec, ctx } = props;
  const path = spec.key ? `${props.path}.${spec.key}` : props.path;
  const issues = lintAt(ctx.lint, path);
  // A field for another type of value (a field definition's enum values beside a number type) stays out of the way, unless it holds something.
  const when = spec.kind !== "selector" && "when" in spec ? spec.when : undefined;
  if (when && props.value === undefined && !when.values.some((v) => v === props.parent[when.key])) return null;
  switch (spec.kind) {
    case "text":
      return <TextInput label={spec.label} value={props.value} multiline={spec.multiline} optional={spec.optional} readonly={spec.readonly} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "dice":
      return <TextInput label={spec.label} value={props.value} optional={spec.optional} hint="Dice notation, e.g. 2d6+1" mono issues={issues} onChange={props.onChange} />;
    case "number":
      return <NumberInput label={spec.label} value={props.value} min={spec.min} max={spec.max} step={spec.step} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "duration":
      return <DurationInput label={spec.label} value={props.value} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "gameTime":
      return <GameTimeInput label={spec.label} value={props.value} calendar={ctx.doc.calendar} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "money":
      return <MinorMoneyInput label={spec.label} value={props.value} currency={ctx.doc.currency} min={spec.min} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "scalar":
      return <ScalarInput label={spec.label} value={props.value} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "timeOfDay":
      return <TimeOfDayInput label={spec.label} value={props.value} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "localTime":
      // The calendar part's epoch follows the system picked beside it; anywhere else, the world's calendar.
      return <LocalTimeInput label={spec.label} value={props.value} gregorian={(typeof props.parent.system === "string" ? props.parent.system : ctx.doc.calendar.system) === "gregorian"} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "bool":
      return <CheckField label={spec.label} help={spec.hint} checked={boolChecked(spec, props.value)} issues={issues} onChange={(checked) => props.onChange(checked)} />;
    case "enum":
      return <ChoiceInput label={spec.label} value={props.value} options={spec.values.map((v) => ({ value: v, label: spec.labels?.[v] ?? words(v) }))} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "ref": {
      if (spec.inline && isRecord(props.value)) return <JsonInput label={`${spec.label} (defined here)`} value={props.value} optional={spec.optional} hint="Written out in place rather than named; edit it as JSON, or clear it to pick one by name." issues={issues} onChange={props.onChange} />;
      const options = refOptions(ctx.doc, spec.collection);
      return <RefInput label={spec.label} value={props.value} options={spec.any ? [{ value: "*", label: "Any kind" }, ...options] : options} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    }
    case "expr":
      return <ExprEditor label={spec.label} value={typeof props.value === "string" ? props.value : ""} identifiers={ctx.identifiers} functions={ctx.functions} doc={ctx.doc} lint={issues} optional={spec.optional} onChange={(next) => props.onChange(next === "" && spec.optional ? undefined : next)} />;
    case "effectArgs":
      return <EffectArgsInput label={spec.label} value={props.value} identifiers={ctx.identifiers} functions={ctx.functions} doc={ctx.doc} lint={(at) => lintAt(ctx.lint, at)} path={path} onChange={props.onChange} />;
    case "tags": {
      const tags = Array.isArray(props.value) ? props.value.filter((t): t is string => typeof t === "string") : [];
      return (
        <TagListInput label={spec.label} noun={spec.noun ?? "value"} value={tags} suggestions={[]} onChange={(next) => props.onChange(next.length > 0 ? next : undefined)}>
          <Issues issues={issues} />
        </TagListInput>
      );
    }
    case "tagList": {
      const tags = Array.isArray(props.value) ? props.value.filter((t): t is string => typeof t === "string") : [];
      return (
        <TagListInput label={spec.label} value={tags} suggestions={worldTags(ctx.doc)} onChange={(next) => props.onChange(next.length > 0 ? next : undefined)}>
          <Issues issues={issues} />
        </TagListInput>
      );
    }
    case "selector":
      // Shown only beside the value it qualifies (Known by beside a known_by visibility).
      if (spec.when && !spec.when.values.some((v) => v === props.parent[spec.when?.key ?? ""])) return null;
      // Selector and the class and value maps are plain JSON shapes; the casts only restate them as JSON.
      return (
        <div class="lre-field">
          <SelectorEditor label={spec.label} value={selectorOf(props.value)} doc={ctx.doc} optional={spec.optional} onChange={(next) => props.onChange(next === undefined ? undefined : (next as unknown as JsonValue))} />
          <Issues issues={issues} />
        </div>
      );
    case "classes":
      return (
        <div class="lre-field">
          <ClassesInput label={spec.label} value={classesOf(props.value)} doc={ctx.doc} onChange={(next) => props.onChange(next)} />
          <Issues issues={issues} />
        </div>
      );
    case "facetValues":
      return <FacetValuesInput label={spec.label} value={facetValuesOf(props.value)} path={path} issues={(at) => <Issues issues={lintAt(ctx.lint, at)} />} onChange={(next: Record<string, FacetValueDef>) => props.onChange(next as unknown as JsonValue)} />;
    case "refs": {
      const ids = Array.isArray(props.value) ? props.value.filter((v): v is string => typeof v === "string") : [];
      const options = spec.collections.flatMap((collection) => refOptions(ctx.doc, collection));
      const known = (id: string) => options.some((o) => o.value === id);
      const nameOf = (id: string) => options.find((o) => o.value === id)?.label ?? `${id} (missing)`;
      return (
        <div class="lre-field">
          <span class="label">{spec.label}</span>
          {ids.length > 0 ? (
            <div class="lre-form-chips">
              {ids.map((id) => (
                <Chip key={id} tone={known(id) ? undefined : "warn"} onRemove={() => props.onChange(ids.filter((other) => other !== id))} removeLabel={`Remove ${nameOf(id)}`}>
                  {nameOf(id)}
                </Chip>
              ))}
            </div>
          ) : null}
          <AddPicker label={`Add to ${spec.label}`} options={options.filter((o) => !ids.includes(o.value))} placeholder={`Add ${spec.collections.map((c) => COLLECTION_WORDS[c]).join(" or ")}…`} onAdd={(id) => props.onChange([...ids, id])} />
          <Issues issues={issues} />
        </div>
      );
    }
    case "json":
      return <JsonInput label={spec.label} value={props.value} optional={spec.optional} hint={spec.hint} issues={issues} onChange={props.onChange} />;
    case "list":
      return <ListInput spec={spec} value={props.value} ctx={ctx} path={path} onChange={props.onChange} />;
    case "record":
      return <RecordInput spec={spec} value={props.value} ctx={ctx} path={path} parent={props.parent} onChange={props.onChange} />;
    case "kindFields":
      return <KindFieldsInput value={props.value} kind={typeof props.parent.kind === "string" ? props.parent.kind : ""} entityId={typeof props.parent.id === "string" ? props.parent.id : ""} ctx={ctx} path={path} onChange={props.onChange} />;
    case "relationFields":
      return <RelationFieldsInput value={props.value} type={typeof props.parent.type === "string" ? props.parent.type : ""} ctx={ctx} path={path} onChange={props.onChange} />;
    case "levels":
      return <LevelsInput label={spec.label} value={props.value} floors={spec.floored ? { ...ctx.doc.ruleset?.minLevels } : undefined} issues={issues} onChange={props.onChange} />;
    case "bandCaps":
      return <BandCapsInput label={spec.label} value={props.value} issues={issues} onChange={props.onChange} />;
    case "claims":
      return <ClaimsInput label={spec.label} value={props.value} preset={props.parent.preset} issues={issues} onChange={props.onChange} />;
    case "tier":
      return <RefInput label={spec.label} value={props.value} options={tiersInOrder(ctx.doc).map(([id, t]) => (t.label === BAND_LABEL[t.band] ? { value: id, label: t.label } : { value: id, label: t.label, sublabel: BAND_LABEL[t.band] }))} issues={issues} onChange={props.onChange} />;
    case "agent": {
      // Unset follows the tier's default, which the POV never takes.
      const tier = typeof props.parent.tier === "string" ? tierOf(ctx.doc, props.parent.tier) : undefined;
      const inherited = props.parent.id !== ctx.doc.pov && tier?.agentDefault === true;
      return (
        <FieldFrame label={spec.label} issues={issues}>
          <Seg<"tier" | "yes" | "no">
            label={spec.label}
            value={props.value === true ? "yes" : props.value === false ? "no" : "tier"}
            options={[
              { value: "tier", label: `As its tier (${inherited ? "yes" : "no"})` },
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            onChange={(choice) => props.onChange(choice === "yes" ? true : choice === "no" ? false : undefined)}
          />
        </FieldFrame>
      );
    }
    case "life":
      // Unset is alive, so the built-in default isn't offered twice.
      return (
        <div class="lre-field">
          <RefPicker
            label={spec.label}
            value={typeof props.value === "string" ? props.value : ""}
            none={lifeStatesOf(ctx.doc).find(([id]) => id === ALIVE)?.[1].label ?? "Alive"}
            options={lifeStatesOf(ctx.doc)
              .filter(([id]) => id !== ALIVE)
              .map(([id, def]) => (def.acts ? { value: id, label: def.label } : { value: id, label: def.label, sublabel: "Doesn't act" }))}
            onChange={(next) => props.onChange(next === "" ? undefined : next)}
          />
          <Issues issues={issues} />
        </div>
      );
    case "object": {
      if (spec.optional && !isRecord(props.value)) {
        return (
          <div class="lre-form-absent">
            <span class="lre-form-absent-label">{spec.label}</span>
            <Button size="sm" icon="plus" onClick={() => props.onChange({})}>
              Add
            </Button>
          </div>
        );
      }
      const value: JsonObject = isRecord(props.value) ? (props.value as JsonObject) : {};
      const fields = <SchemaFields specs={spec.fields} value={value} ctx={{ ...ctx, path }} onChange={props.onChange} />;
      // A list item's object is framed by its sheet.
      if (!spec.key) return fields;
      return (
        <FormGroup
          title={spec.label}
          aside={
            spec.optional ? (
              <Button variant="ghost" size="sm" onClick={() => props.onChange(undefined)}>
                Remove
              </Button>
            ) : undefined
          }
        >
          {fields}
          <Issues issues={ctx.lint.filter((issue) => issue.path === path)} />
        </FormGroup>
      );
    }
  }
}

export function SchemaFields(props: { specs: readonly FieldSpec[]; value: JsonObject; ctx: FormCtx; onChange(next: JsonObject): void }) {
  return (
    <div class="lre-form-fields">
      {props.specs.map((spec) => (
        <FieldInput key={spec.key} spec={spec} value={props.value[spec.key]} ctx={props.ctx} path={props.ctx.path} parent={props.value} onChange={(next) => props.onChange(withKey(props.value, spec.key, next))} />
      ))}
    </div>
  );
}

/**
 * Identifiers the expression editor suggests: entity, place, field, track and check ids, and the
 * names every formula can read (engine/scope): `self`, `pov`, `here` and the clock's.
 */
export function worldIdentifiers(doc: WorldDoc): string[] {
  const out = new Set<string>([...Object.keys(doc.entities), ...Object.keys(doc.places), ...Object.keys(doc.tracks), ...Object.keys(doc.checks), "self", "pov", "here", "clock", "minute", "hour", "day", "weekday", "date", "month", "year", "daypart"]);
  for (const kind of Object.values(doc.kinds)) for (const field of Object.keys(kind.fields)) out.add(field);
  return [...out].sort();
}
