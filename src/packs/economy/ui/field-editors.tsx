// Build's editors for the money fields whose values are structured (DESIGN §13, §25–§27), in the
// Build forms' idiom (redesign contract §4.6): owners, pay and flow splits, household shares,
// holding lots, payroll deductions and payment preferences are lists whose items open as form
// sheets; schedule lists are chips to toggle, or days typed in a row; a business's places are chips;
// an account's product, a holding's asset and where its payouts go are picks by name. A place's
// cash machine and bank branch are optional parts of the place form. Each edits the field's whole
// value and writes it as the earlier editors did; amounts are typed in the world's currency and
// stored in whole minor units, as Build stores money. Styles: styles/packs-money.ts (M4 block).

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { ACCOUNT_CLASSES, CLASS_TRAITS, OWNER_ROLES, type PayTier } from "../../../shared/finance";
import { hasOwn, isRecord } from "../../../shared/json";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { LintIssue } from "../../../shared/protocol";
import { formatMoney, type FieldDef, type WorldDoc } from "../../../shared/world";
import { Button, IconButton } from "../../../frontend/components";
import { AddPicker, CheckField, Chip, FormSheet, Issues, ItemRow, RefPicker, type RefOption } from "../../../frontend/build/form-kit";
import { ChoiceInput, DateInput, FieldFrame, lintAt, LintBadge, MinorMoneyInput, NumberInput, refOptions, TextInput, useFieldText } from "../../../frontend/build/schema-form";
import { kindIs, TagListInput } from "../../../frontend/build/selector-editor";
import { humanize } from "../../../frontend/format";
import type { FieldEditorDef, FieldEditorProps, PlaceFieldDef, PlaceFieldEditorProps } from "../../../frontend/registry";
import { LEVEL_LABEL } from "../../../frontend/settings/realism";
import { MONTH_CHOICES, WEEKDAY_CHOICES, type Choice } from "./forms";
import { PAY_METHODS } from "./pay-prefs";

/** The records of a list value, each as an object; anything else in it is dropped. */
export function recordsOf(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter((v): v is JsonObject => isRecord(v)) : [];
}

/** The numbers of a list value, sorted and once each. */
export function numbersOf(value: JsonValue | undefined): number[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is number => typeof v === "number" && Number.isFinite(v)))].sort((a, b) => a - b) : [];
}

/** An object with its empty parts left out, so a cleared share or amount isn't stored as null. */
export function compact(o: Record<string, JsonValue | undefined>): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  return out;
}

/** Entities of these kinds (or kinds inheriting from them), as picks by name; their ids show only with Show ids (D-UI6). */
export function entityChoices(doc: WorldDoc, kinds: readonly string[]): RefOption[] {
  return refOptions(doc, "entities").filter((o) => {
    const kind = hasOwn(doc.entities, o.value) ? doc.entities[o.value]?.kind : undefined;
    return kind !== undefined && kinds.some((k) => kindIs(doc, kind, k));
  });
}

/** The members of a household (those with `member_of` toward it). */
export function householdMembers(doc: WorldDoc, household: string): string[] {
  return Object.values(doc.entities)
    .filter((e) => e.relations.some((r) => r.type === "member_of" && r.to === household))
    .map((e) => e.id)
    .sort();
}

/** Equal shares for the members, in whole percentages that add up to 100. */
export function equalShares(members: readonly string[]): JsonObject[] {
  const base = members.length === 0 ? 0 : Math.floor(100 / members.length);
  return members.map((party, i) => ({ party, pct: base + (i < 100 - base * members.length ? 1 : 0) }));
}

/** Days of the month as typed ("1, 15, -1"); -1 is the last day. */
export function monthDays(text: string): number[] | null {
  const parts = text.split(",").map((s) => s.trim()).filter((s) => s !== "");
  const days = parts.map(Number);
  return days.every((d) => Number.isInteger(d) && (d === -1 || (d >= 1 && d <= 31))) ? [...new Set(days)].sort((a, b) => a - b) : null;
}

const textOf = (v: JsonValue | undefined): string => (typeof v === "string" ? v : "");
const isObject = (v: JsonValue | undefined): v is JsonObject => isRecord(v);

/** An entity's name, else what names it. */
function nameOf(doc: WorldDoc, id: string): string {
  return (hasOwn(doc.entities, id) ? doc.entities[id]?.name : undefined) || id;
}

/** Parts of a summary line, the empty ones left out, starting with a capital. */
function line(...parts: (string | null)[]): string {
  const joined = parts.filter((part): part is string => part !== null && part !== "").join(" · ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/** Help notes joined, the empty ones left out. */
function helpOf(...parts: (string | null | undefined)[]): string | undefined {
  const joined = parts.filter((part): part is string => typeof part === "string" && part !== "").join(" · ");
  return joined === "" ? undefined : joined;
}

/**
 * A field's label without the JSON shape its definition spells out ("Owners ({party, role,
 * share?})"), which its editor draws as fields; `plain` drops any last aside in brackets too, for an
 * editor whose choices say it ("Weekdays (0 = Sunday)" drawn as named days).
 */
function labelOf(p: { def: FieldDef; field: string }, plain = false): string {
  const label = p.def.label ?? humanize(p.field);
  const short = label.replace(plain ? /\s*\([^()]*\)\s*$/ : /\s*\(\{[^()]*\}\)\s*$/, "");
  return short === "" ? label : short;
}

/** What the form says under any field of a kind, as it says it under the fields it draws itself: the level the field is live from, and whether it's locked or kept from some. */
function notesOf(def: FieldDef): string {
  const notes = [def.level ? `From level ${def.level} (${LEVEL_LABEL[def.level]})` : null, def.locked ? "Never offered to a model" : null, def.visibility === "secret" ? "Secret" : def.visibility === "known_by" ? "Known only to some" : null];
  return notes.filter((n): n is string => n !== null).join(" · ");
}

/** Whether lint is at a path or below it. */
function under(issue: LintIssue, path: string): boolean {
  return issue.path === path || issue.path.startsWith(`${path}.`);
}

/** A pick by name (`RefPicker`) with the field's help and lint under it; `none` names the empty choice where there is one. */
function PickField(props: { label: string; value: string; options: readonly RefOption[]; none?: string; placeholder?: string; help?: string; issues: readonly LintIssue[]; onChange(value: string): void }) {
  return (
    <div class="lre-field">
      <RefPicker label={props.label} value={props.value} options={props.options} none={props.none} placeholder={props.placeholder} onChange={props.onChange} />
      {props.help ? <span class="lre-field-help">{props.help}</span> : null}
      <Issues issues={props.issues} />
    </div>
  );
}

/** A record of a list value and its place in the stored list, which lint paths name. */
interface Entry<T> {
  item: T;
  at: number;
}

/** A list value's records with their places; anything else in it is dropped, as `recordsOf` drops it. */
function entriesOf(value: JsonValue | undefined): Entry<JsonObject>[] {
  return Array.isArray(value) ? value.flatMap((item, at) => (isObject(item) ? [{ item, at }] : [])) : [];
}

/**
 * A list of records as Build lists items (contract §4.6): a row per item with its lint count, which
 * opens the item as a sheet; remove on the row and in the sheet; Add appends `blank` and opens it.
 * `ordered` numbers the items and moves them up and down, for a list whose order decides (payment
 * tiers). `onChange` gets the items to store; an emptied list is the caller's to drop.
 */
function RecordsField<T>(props: {
  p: FieldEditorProps;
  entries: readonly Entry<T>[];
  noun: string;
  blank: T;
  /** The item's fields its sheet edits, each showing its own lint; lint anywhere else in the item shows at the foot of the sheet. */
  keys: readonly string[];
  help?: string;
  empty?: string;
  lead?: ComponentChildren;
  foot?: ComponentChildren;
  ordered?: boolean;
  title(item: T, index: number): string;
  summary(item: T): string;
  sheet(item: T, set: (next: T) => void, path: string): ComponentChildren;
  onChange(next: T[]): void;
}) {
  const { p, entries, noun } = props;
  const label = labelOf(p);
  const help = helpOf(props.help, notesOf(p.def));
  const items = entries.map((entry) => entry.item);
  const [open, setOpen] = useState<number | null>(null);
  const titleAt = (i: number): string => {
    const entry = entries[i];
    const title = entry ? props.title(entry.item, i) : "";
    return props.ordered ? `${i + 1}. ${title}` : title;
  };
  // An ordered item is named by its place in the row's actions: two tiers may pay the same way.
  const nameAt = (i: number): string => (props.ordered ? `${noun} ${i + 1}` : titleAt(i));
  const pathAt = (i: number): string => `${p.path}.${entries[i]?.at ?? i}`;
  const set = (i: number, next: T) => props.onChange(items.map((item, j) => (j === i ? next : item)));
  const remove = (i: number) => {
    setOpen(null);
    props.onChange(items.filter((_, j) => j !== i));
  };
  const move = (from: number, to: number) => {
    const next = [...items];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    props.onChange(next);
  };
  const actions = (i: number) => (
    <>
      {props.ordered && entries.length > 1 ? (
        <>
          <IconButton icon="chevron-up" label={`Move ${nameAt(i)} up`} disabled={i === 0} onClick={() => move(i, i - 1)} />
          <IconButton icon="chevron-down" label={`Move ${nameAt(i)} down`} disabled={i === entries.length - 1} onClick={() => move(i, i + 1)} />
        </>
      ) : null}
      <IconButton icon="trash" label={`Remove ${nameAt(i)}`} onClick={() => remove(i)} />
    </>
  );
  const current = open !== null ? entries[open] : undefined;
  return (
    <div class="lre-field lre-form-list" data-lre-money-field={p.field}>
      <div class="lre-form-list-head">
        <span class="label">{label}</span>
        <span class="lre-badge">{entries.length}</span>
      </div>
      {help ? <span class="lre-field-help">{help}</span> : null}
      {props.lead}
      <div class="lre-form-items">
        {entries.length === 0 ? <span class="lre-form-items-none">{props.empty ?? "None yet."}</span> : null}
        {entries.map((entry, i) => (
          <ItemRow key={i} title={titleAt(i)} subtitle={props.summary(entry.item) || undefined} badge={<LintBadge issues={lintAt(p.lint, pathAt(i))} />} onOpen={() => setOpen(i)} openLabel={`Edit ${nameAt(i)}`} actions={actions(i)} />
        ))}
      </div>
      {props.foot}
      <Issues issues={p.lint.filter((issue) => !entries.some((_, i) => under(issue, pathAt(i))))} />
      <div class="lre-form-list-add">
        <Button
          size="sm"
          icon="plus"
          onClick={() => {
            props.onChange([...items, props.blank]);
            setOpen(items.length);
          }}
        >
          Add {noun}
        </Button>
      </div>
      {open !== null && current ? (
        <FormSheet title={titleAt(open)} subtitle={`${humanize(noun)} ${open + 1} of ${entries.length}`} backLabel={label} onClose={() => setOpen(null)}>
          {props.sheet(current.item, (next) => set(open, next), pathAt(open))}
          <Issues issues={lintAt(p.lint, pathAt(open)).filter((issue) => !props.keys.some((key) => under(issue, `${pathAt(open)}.${key}`)))} />
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

/** A list of records stored as it is edited; removing the last one removes the field. */
const storeList = (p: FieldEditorProps) => (next: JsonObject[]) => p.onChange(next.length === 0 ? undefined : next);

const OWNER_ROLE_CHOICES: readonly RefOption[] = OWNER_ROLES.map((r) => ({ value: r, label: humanize(r) }));

function OwnersField(p: FieldEditorProps) {
  const parties = entityChoices(p.doc, ["person", "business", "trust", "household"]);
  return (
    <RecordsField<JsonObject>
      p={p}
      entries={entriesOf(p.value)}
      noun="owner"
      blank={{ party: "", role: "owner" }}
      keys={["party", "role", "share"]}
      title={(o, i) => (textOf(o.party) ? nameOf(p.doc, textOf(o.party)) : `Owner ${i + 1}`)}
      summary={(o) => line(humanize(textOf(o.role) || "owner"), typeof o.share === "number" ? `${o.share}% of its worth` : null)}
      sheet={(o, set, path) => (
        <>
          <PickField label="Who" value={textOf(o.party)} options={parties} placeholder="Choose who" issues={lintAt(p.lint, `${path}.party`)} onChange={(party) => set({ ...o, party })} />
          <ChoiceInput
            label="Role"
            value={textOf(o.role) || "owner"}
            options={OWNER_ROLE_CHOICES}
            issues={lintAt(p.lint, `${path}.role`)}
            onChange={(role) => {
              if (typeof role === "string") set({ ...o, role });
            }}
          />
          <NumberInput label="Share of its worth (%)" value={o.share} min={0} max={100} optional hint="Empty: equal parts" issues={lintAt(p.lint, `${path}.share`)} onChange={(share) => set(compact({ ...o, share }))} />
        </>
      )}
      onChange={storeList(p)}
    />
  );
}

function ProductField(p: FieldEditorProps) {
  const products = p.doc.packs.economy?.config.products;
  const own: RefOption[] = isRecord(products) ? Object.entries(products).map(([id, def]) => ({ value: id, label: isRecord(def) && typeof def.label === "string" ? def.label : id, sublabel: "The world's" })) : [];
  const classes: RefOption[] = ACCOUNT_CLASSES.map((c) => ({ value: c, label: CLASS_TRAITS[c].label, sublabel: "Built in" }));
  const value = textOf(p.value);
  const known = value === "" || [...own, ...classes].some((c) => c.value === value);
  return (
    <PickField
      label={labelOf(p, true)}
      value={value}
      none="Not set"
      options={[...own, ...classes, ...(known ? [] : [{ value, label: `${value} (not defined)` }])]}
      help={helpOf("The world's own products (Build → Packs → economy) or a built-in class", notesOf(p.def))}
      issues={p.lint}
      onChange={(next) => p.onChange(next === "" ? undefined : next)}
    />
  );
}

/** Where money is routed: an account in the world, a fixed amount or a percentage of the rest. */
function SplitsField(p: FieldEditorProps) {
  const accounts = entityChoices(p.doc, ["account"]);
  const currency = p.doc.currency;
  return (
    <RecordsField<JsonObject>
      p={p}
      entries={entriesOf(p.value)}
      noun="split"
      blank={{ to: "", pct: 10 }}
      keys={["to", "cents", "pct"]}
      help="Fixed amounts go first, then percentages of what's left; the rest goes to the main account"
      title={(s, i) => (textOf(s.to) ? nameOf(p.doc, textOf(s.to)) : `Split ${i + 1}`)}
      summary={(s) => (typeof s.cents === "number" ? formatMoney(s.cents, currency) : typeof s.pct === "number" ? `${s.pct}% of what's left` : "")}
      sheet={(s, set, path) => (
        <>
          <PickField label="To" value={textOf(s.to)} options={accounts} placeholder="Choose an account" issues={lintAt(p.lint, `${path}.to`)} onChange={(to) => set({ ...s, to })} />
          <MinorMoneyInput label="Fixed amount" value={s.cents} currency={currency} min={0} optional issues={lintAt(p.lint, `${path}.cents`)} onChange={(cents) => set(compact({ ...s, cents, pct: cents === undefined ? s.pct : undefined }))} />
          <NumberInput label="Or a percentage" value={s.pct} min={0} max={100} optional hint="Of what's left after the fixed amounts; setting one clears the other" issues={lintAt(p.lint, `${path}.pct`)} onChange={(pct) => set(compact({ ...s, pct, cents: pct === undefined ? s.cents : undefined }))} />
        </>
      )}
      onChange={storeList(p)}
    />
  );
}

/** What a flow's shares add up to, under them: a whole when they make 100%, else a warning. */
function SharesTotal(props: { total: number }) {
  if (props.total === 100) return <span class="lre-field-help">Parts add up to 100%.</span>;
  return <Issues issues={[{ severity: "warning", path: "", code: "shares_total", message: `Parts add up to ${props.total}% (they should make 100%).` }]} />;
}

function SharesField(p: FieldEditorProps) {
  const parties = entityChoices(p.doc, ["person", "business", "trust"]);
  const accounts = entityChoices(p.doc, ["account"]);
  const households = entityChoices(p.doc, ["household"]);
  const entries = entriesOf(p.value);
  const total = entries.reduce((sum, entry) => sum + (typeof entry.item.pct === "number" ? entry.item.pct : 0), 0);
  return (
    <RecordsField<JsonObject>
      p={p}
      entries={entries}
      noun="share"
      blank={{ party: "", pct: 0 }}
      keys={["party", "pct", "from"]}
      lead={
        households.length > 0 ? (
          <FieldFrame label="Split equally among a household's members" issues={[]}>
            <AddPicker label="Split equally among a household's members" options={households} placeholder="Choose a household" onAdd={(h) => p.onChange(equalShares(householdMembers(p.doc, h)))} />
          </FieldFrame>
        ) : null
      }
      foot={entries.length > 0 ? <SharesTotal total={total} /> : null}
      title={(s, i) => (textOf(s.party) ? nameOf(p.doc, textOf(s.party)) : `Share ${i + 1}`)}
      summary={(s) => line(`${typeof s.pct === "number" ? s.pct : 0}%`, textOf(s.from) ? `paid from ${nameOf(p.doc, textOf(s.from))}` : null)}
      sheet={(s, set, path) => (
        <>
          <PickField label="Who" value={textOf(s.party)} options={parties} placeholder="Choose who" issues={lintAt(p.lint, `${path}.party`)} onChange={(party) => set({ ...s, party })} />
          <NumberInput label="Their part (%)" value={s.pct} min={0} max={100} optional hint="Empty is 0" issues={lintAt(p.lint, `${path}.pct`)} onChange={(pct) => set({ ...s, pct: typeof pct === "number" ? pct : 0 })} />
          <PickField label="Paid from" value={textOf(s.from)} none="As their preferences choose" options={accounts} issues={lintAt(p.lint, `${path}.from`)} onChange={(from) => set(compact({ ...s, from }))} />
        </>
      )}
      onChange={storeList(p)}
    />
  );
}

/** Chips to toggle over a fixed set of numbers (weekdays, months). */
function NumberToggles(p: FieldEditorProps & { choices: readonly Choice[]; plain: boolean }) {
  const on = numbersOf(p.value);
  const label = labelOf(p, p.plain);
  return (
    <FieldFrame label={label} help={helpOf(notesOf(p.def))} issues={p.lint}>
      <div class="lre-form-chips" role="group" aria-label={label} data-lre-money-field={p.field}>
        {p.choices.map((c) => {
          const n = Number(c.value);
          const pressed = on.includes(n);
          return (
            <Chip key={c.value} pressed={pressed} onToggle={() => p.onChange(pressed ? on.filter((x) => x !== n) : [...on, n].sort((a, b) => a - b))}>
              {c.label.slice(0, 3)}
            </Chip>
          );
        })}
      </div>
    </FieldFrame>
  );
}

// Weekdays are named, so a label's "(0 = Sunday)" goes; a month list's "(yearly)" stays.
const WeekdaysField = (p: FieldEditorProps) => <NumberToggles {...p} choices={WEEKDAY_CHOICES} plain />;
const MonthsField = (p: FieldEditorProps) => <NumberToggles {...p} choices={MONTH_CHOICES} plain={false} />;

/** Days of the month typed in a row ("1, 15, -1"), kept once they read as days. */
function MonthDaysField(p: FieldEditorProps) {
  const id = useId();
  const shown = numbersOf(p.value).join(", ");
  const [text, type, handed] = useFieldText(shown);
  const days = monthDays(text);
  const problem = text === shown || days !== null ? null : "Type days of the month from 1 to 31, or -1 for the last, between commas.";
  return (
    <FieldFrame label={labelOf(p, true)} for={id} help={helpOf("Separate days with commas; -1 is the last day of the month", notesOf(p.def))} problem={problem} issues={p.lint}>
      <input
        id={id}
        class={problem ? "lre-input invalid" : "lre-input"}
        aria-invalid={problem ? true : undefined}
        placeholder="e.g. 1, 15, -1"
        autoComplete="off"
        value={text}
        onInput={(event) => type(event.currentTarget.value)}
        onBlur={() => {
          if (text === shown) {
            handed();
            return;
          }
          // Days that don't read as days stay typed, an edit, until they do or the value changes.
          if (days === null) return;
          handed();
          p.onChange(days);
        }}
      />
    </FieldFrame>
  );
}

function HolidaysField(p: FieldEditorProps) {
  const on = Array.isArray(p.value) ? p.value.filter((v): v is string => typeof v === "string") : [];
  const holidays = p.doc.calendar.holidays;
  // Ones the calendar no longer has stay listed, so they show and can go.
  const gone = [...new Set(on.filter((id) => !holidays.some((h) => h.id === id)))];
  const label = labelOf(p);
  return (
    <FieldFrame label={label} help={helpOf(holidays.length === 0 ? "The calendar has no holidays" : null, notesOf(p.def))} issues={p.lint}>
      {holidays.length > 0 || gone.length > 0 ? (
        <div class="lre-form-chips" role="group" aria-label={label} data-lre-money-field={p.field}>
          {holidays.map((h) => {
            const pressed = on.includes(h.id);
            return (
              <Chip key={h.id} pressed={pressed} onToggle={() => p.onChange(pressed ? on.filter((x) => x !== h.id) : [...on, h.id])}>
                {h.label}
              </Chip>
            );
          })}
          {gone.map((id) => (
            <Chip key={`gone:${id}`} tone="warn" removeLabel={`Remove ${id}, which the calendar doesn't have`} onRemove={() => p.onChange(on.filter((x) => x !== id))}>
              {id} (not in the calendar)
            </Chip>
          ))}
        </div>
      ) : null}
    </FieldFrame>
  );
}

function LotsField(p: FieldEditorProps) {
  const currency = p.doc.currency;
  return (
    <RecordsField<JsonObject>
      p={p}
      entries={entriesOf(p.value)}
      noun="lot"
      blank={{ qty: 1, cost: 0, at: p.doc.start.at.slice(0, 10) }}
      keys={["qty", "cost", "at"]}
      title={(l, i) => (typeof l.qty === "number" ? `${l.qty} ${l.qty === 1 ? "unit" : "units"}` : `Lot ${i + 1}`)}
      summary={(l) => line(typeof l.cost === "number" ? `${formatMoney(l.cost, currency)} in all` : null, textOf(l.at) ? `bought ${textOf(l.at).slice(0, 10)}` : null)}
      sheet={(l, set, path) => (
        <>
          <NumberInput label="Units" value={l.qty} min={0} optional hint="Empty is 0" issues={lintAt(p.lint, `${path}.qty`)} onChange={(qty) => set({ ...l, qty: typeof qty === "number" ? qty : 0 })} />
          <MinorMoneyInput label="What it cost in all" value={l.cost} currency={currency} min={0} issues={lintAt(p.lint, `${path}.cost`)} onChange={(cost) => set({ ...l, cost: typeof cost === "number" ? cost : 0 })} />
          <DateInput label="Bought" value={textOf(l.at).slice(0, 10)} calendar={p.doc.calendar} issues={lintAt(p.lint, `${path}.at`)} onChange={(at) => set({ ...l, at: textOf(at) })} />
        </>
      )}
      onChange={storeList(p)}
    />
  );
}

function RouteField(p: FieldEditorProps) {
  const accounts = entityChoices(p.doc, ["account"]);
  return (
    <PickField
      label={labelOf(p, true)}
      value={textOf(p.value)}
      none="The usual place (its account's cash, else the deposit account)"
      options={[{ value: "reinvest", label: "Reinvested" }, ...accounts]}
      help={helpOf(notesOf(p.def))}
      issues={p.lint}
      onChange={(to) => p.onChange(to === "" ? undefined : to)}
    />
  );
}

function AssetField(p: FieldEditorProps) {
  const assets = p.doc.packs.economy?.config.assets;
  const own: RefOption[] = isRecord(assets) ? Object.entries(assets).map(([id, def]) => ({ value: id, label: isRecord(def) && typeof def.label === "string" ? def.label : id, ...(isRecord(def) && typeof def.class === "string" ? { sublabel: humanize(def.class) } : {}) })) : [];
  const value = textOf(p.value);
  return (
    <PickField
      label={labelOf(p)}
      value={value}
      none="Not set"
      options={value === "" || own.some((o) => o.value === value) ? own : [...own, { value, label: `${value} (not defined)` }]}
      help={helpOf("One of the economy pack's assets (Build → Packs → economy)", notesOf(p.def))}
      issues={p.lint}
      onChange={(next) => p.onChange(next === "" ? undefined : next)}
    />
  );
}

const DEDUCTION_KINDS: readonly RefOption[] = ["retirement", "health", "other"].map((k) => ({ value: k, label: humanize(k) }));

function DeductionsField(p: FieldEditorProps) {
  const accounts = entityChoices(p.doc, ["account"]);
  const currency = p.doc.currency;
  return (
    <RecordsField<JsonObject>
      p={p}
      entries={entriesOf(p.value)}
      noun="deduction"
      blank={{ label: "401(k)", kind: "retirement", pretax: true, pct: 5 }}
      keys={["label", "kind", "pretax", "cents", "pct", "match_pct", "to"]}
      title={(d, i) => textOf(d.label) || `Deduction ${i + 1}`}
      summary={(d) =>
        line(
          humanize(textOf(d.kind) || "other"),
          typeof d.cents === "number" ? `${formatMoney(d.cents, currency)} a payday` : typeof d.pct === "number" ? `${d.pct}% of pay` : null,
          d.pretax === true ? "before income tax" : null,
          typeof d.match_pct === "number" ? `matched ${d.match_pct}%` : null,
          textOf(d.to) ? `to ${nameOf(p.doc, textOf(d.to))}` : null,
        )
      }
      sheet={(d, set, path) => (
        <>
          <TextInput label="Name" value={d.label} issues={lintAt(p.lint, `${path}.label`)} onChange={(name) => set({ ...d, label: textOf(name) })} />
          <ChoiceInput
            label="Kind"
            value={textOf(d.kind) || "other"}
            options={DEDUCTION_KINDS}
            issues={lintAt(p.lint, `${path}.kind`)}
            onChange={(kind) => {
              if (typeof kind === "string") set({ ...d, kind });
            }}
          />
          <CheckField label="Taken before income tax" checked={d.pretax === true} issues={lintAt(p.lint, `${path}.pretax`)} onChange={(pretax) => set({ ...d, pretax })} />
          <MinorMoneyInput label="Fixed amount each payday" value={d.cents} currency={currency} min={0} optional issues={lintAt(p.lint, `${path}.cents`)} onChange={(cents) => set(compact({ ...d, cents, pct: cents === undefined ? d.pct : undefined }))} />
          <NumberInput label="Or a percentage of pay" value={d.pct} min={0} max={100} optional hint="Setting one clears the other" issues={lintAt(p.lint, `${path}.pct`)} onChange={(pct) => set(compact({ ...d, pct, cents: pct === undefined ? d.cents : undefined }))} />
          <NumberInput label="Employer match (% of pay)" value={d.match_pct} min={0} max={100} optional issues={lintAt(p.lint, `${path}.match_pct`)} onChange={(match) => set(compact({ ...d, match_pct: match }))} />
          <PickField label="Goes to" value={textOf(d.to)} none="An outside payee" options={accounts} issues={lintAt(p.lint, `${path}.to`)} onChange={(to) => set(compact({ ...d, to }))} />
        </>
      )}
      onChange={storeList(p)}
    />
  );
}

function PlacesField(p: FieldEditorProps) {
  const on = Array.isArray(p.value) ? p.value.filter((v): v is string => typeof v === "string") : [];
  const places = refOptions(p.doc, "places");
  const label = labelOf(p);
  const nameOfPlace = (id: string): string | undefined => places.find((o) => o.value === id)?.label;
  return (
    <FieldFrame label={label} help={helpOf(notesOf(p.def))} issues={p.lint}>
      {on.length > 0 ? (
        <div class="lre-form-chips" data-lre-money-field={p.field}>
          {on.map((id, i) => {
            const name = nameOfPlace(id);
            return (
              <Chip key={`${i}:${id}`} tone={name === undefined ? "warn" : undefined} removeLabel={`Remove ${name ?? id}`} onRemove={() => p.onChange(on.length > 1 ? on.filter((x) => x !== id) : undefined)}>
                {name ?? `${id} (missing)`}
              </Chip>
            );
          })}
        </div>
      ) : null}
      <AddPicker label={`Add to ${label}`} options={places.filter((o) => !on.includes(o.value))} placeholder="Add a place…" onAdd={(id) => p.onChange([...on, id])} />
    </FieldFrame>
  );
}

/** A payment tier as the engine reads one (`tiersOf`): how it pays, and the amounts and categories it fits. */
function tierOf(t: JsonObject, use: string): PayTier {
  return {
    use,
    ...(typeof t.min === "number" ? { min: t.min } : {}),
    ...(typeof t.max === "number" ? { max: t.max } : {}),
    ...(Array.isArray(t.categories) ? { categories: t.categories.filter((c): c is string => typeof c === "string") } : {}),
    ...(Array.isArray(t.except) ? { except: t.except.filter((c): c is string => typeof c === "string") } : {}),
  };
}

function PayPrefsField(p: FieldEditorProps) {
  const mine = Object.values(p.doc.entities).filter((e) => (kindIs(p.doc, e.kind, "account") && recordsOf(e.fields.owners).some((o) => o.party === p.entity.id)) || (kindIs(p.doc, e.kind, "card") && e.fields.holder === p.entity.id));
  const ways: RefOption[] = [...PAY_METHODS.map((m) => ({ value: m.value, label: m.label })), ...mine.map((e) => ({ value: e.id, label: e.name, sublabel: kindIs(p.doc, e.kind, "card") ? "Their card" : "Their account" }))];
  const categories = Object.keys(p.doc.tables["economy.categories"]?.rows ?? {}).sort();
  const currency = p.doc.currency;
  const entries: Entry<PayTier>[] = Array.isArray(p.value) ? p.value.flatMap((t, at) => (isObject(t) && typeof t.use === "string" ? [{ item: tierOf(t, t.use), at }] : [])) : [];
  return (
    <div data-lre-pay-prefs>
      <RecordsField<PayTier>
        p={p}
        entries={entries}
        noun="tier"
        blank={{ use: "debit" }}
        keys={["use", "min", "max", "categories", "except"]}
        ordered
        help="In order: the first tier that fits and covers the amount pays"
        empty="No tiers: the engine's defaults for their wealth and character pay."
        foot={<span class="lre-field-help">When no tier fits or covers the amount, any account they may spend from that covers it pays.</span>}
        title={(t) => ways.find((w) => w.value === t.use)?.label ?? t.use}
        summary={(t) =>
          line(
            t.min !== undefined ? `from ${formatMoney(t.min, currency)}` : null,
            t.max !== undefined ? `up to ${formatMoney(t.max, currency)}` : null,
            t.categories && t.categories.length > 0 ? `for ${t.categories.map(humanize).join(", ")}` : null,
            t.except && t.except.length > 0 ? `not ${t.except.map(humanize).join(", ")}` : null,
          )
        }
        sheet={(t, set, path) => (
          <>
            <PickField label="Pay with" value={t.use} options={ways} issues={lintAt(p.lint, `${path}.use`)} onChange={(use) => set({ ...t, use })} />
            <MinorMoneyInput label="From" value={t.min} currency={currency} optional hint="It fits amounts of at least this much" issues={lintAt(p.lint, `${path}.min`)} onChange={(min) => set({ ...t, min: typeof min === "number" ? min : undefined })} />
            <MinorMoneyInput label="Up to" value={t.max} currency={currency} optional hint="It fits amounts of at most this much" issues={lintAt(p.lint, `${path}.max`)} onChange={(max) => set({ ...t, max: typeof max === "number" ? max : undefined })} />
            <TagListInput label="Only for" noun="category" value={t.categories ?? []} suggestions={categories} onChange={(next) => set({ ...t, categories: next })}>
              <span class="lre-field-help">Categories it pays for; none: anything</span>
              <Issues issues={lintAt(p.lint, `${path}.categories`)} />
            </TagListInput>
            <TagListInput label="Never for" noun="category" value={t.except ?? []} suggestions={categories} onChange={(next) => set({ ...t, except: next })}>
              <Issues issues={lintAt(p.lint, `${path}.except`)} />
            </TagListInput>
          </>
        )}
        onChange={(next) => p.onChange(next.length === 0 ? undefined : next.map((t) => compact({ use: t.use, min: t.min, max: t.max, categories: t.categories && t.categories.length > 0 ? t.categories : undefined, except: t.except && t.except.length > 0 ? t.except : undefined })))}
      />
    </div>
  );
}

/** Every structured money field and its editor; the kinds are the foundation's (and `person`, whose payment preferences the economy declares). */
export const MONEY_FIELD_EDITORS: readonly FieldEditorDef[] = [
  ...["account", "business", "holding", "property", "trust"].map((kind) => ({ kind, field: "owners", component: OwnersField })),
  { kind: "account", field: "product", component: ProductField },
  { kind: "flow", field: "splits", component: SplitsField },
  { kind: "job", field: "splits", component: SplitsField },
  { kind: "flow", field: "shares", component: SharesField },
  { kind: "flow", field: "weekdays", component: WeekdaysField },
  { kind: "job", field: "pay_weekdays", component: WeekdaysField },
  { kind: "flow", field: "months", component: MonthsField },
  { kind: "job", field: "pay_months", component: MonthsField },
  { kind: "flow", field: "days", component: MonthDaysField },
  { kind: "job", field: "pay_days", component: MonthDaysField },
  { kind: "flow", field: "except", component: HolidaysField },
  { kind: "job", field: "pay_except", component: HolidaysField },
  { kind: "holding", field: "lots", component: LotsField },
  { kind: "holding", field: "route", component: RouteField },
  { kind: "holding", field: "asset", component: AssetField },
  { kind: "job", field: "deductions", component: DeductionsField },
  { kind: "business", field: "places", component: PlacesField },
  { kind: "business", field: "trading_days", component: WeekdaysField },
  { kind: "person", field: "pay_prefs", component: PayPrefsField },
];

/** A place without the part yet: says so, with the button that adds it, and any lint at the field. */
function Absent(props: { text: string; add: string; issues: readonly LintIssue[]; onAdd(): void }) {
  return (
    <div class="lre-form-fields lre-money-build-place">
      <div class="lre-money-build-absent">
        <span class="lre-money-build-absent-text">{props.text}</span>
        <Button size="sm" icon="plus" onClick={props.onAdd}>
          {props.add}
        </Button>
      </div>
      <Issues issues={props.issues} />
    </div>
  );
}

/** A place's cash machine: its bank, the operator's surcharge, the most it pays out at once, and whether it takes deposits. */
function AtmField(p: PlaceFieldEditorProps) {
  const atm = isObject(p.value) ? p.value : null;
  if (!atm) return <Absent text="No cash machine here." add="Add a cash machine" issues={p.lint} onAdd={() => p.onChange({ bank: "" })} />;
  const set = (patch: Record<string, JsonValue | undefined>) => p.onChange(compact({ ...atm, ...patch, bank: typeof patch.bank === "string" ? patch.bank : atm.bank }));
  return (
    <div class="lre-form-fields lre-money-build-place" data-lre-atm={p.place.id}>
      <TextInput label="Bank" value={atm.bank} hint="Its customers pay no out-of-network fee" issues={lintAt(p.lint, `${p.path}.bank`)} onChange={(bank) => set({ bank: textOf(bank) })} />
      <MinorMoneyInput label="Surcharge" value={atm.fee} currency={p.doc.currency} min={0} optional issues={lintAt(p.lint, `${p.path}.fee`)} onChange={(fee) => set({ fee })} />
      <MinorMoneyInput label="Most it pays out at once" value={atm.limit} currency={p.doc.currency} min={1} optional issues={lintAt(p.lint, `${p.path}.limit`)} onChange={(limit) => set({ limit })} />
      <CheckField label="Takes deposits" help="Held for the account's hold days" checked={atm.deposits === true} issues={lintAt(p.lint, `${p.path}.deposits`)} onChange={(checked) => set({ deposits: checked || undefined })} />
      <Issues issues={p.lint.filter((issue) => !["bank", "fee", "limit", "deposits"].some((key) => under(issue, `${p.path}.${key}`)))} />
      <div class="lre-money-build-place-actions">
        <Button size="sm" variant="danger" icon="trash" onClick={() => p.onChange(undefined)}>
          Remove the cash machine
        </Button>
      </div>
    </div>
  );
}

function BranchField(p: PlaceFieldEditorProps) {
  const branch = isObject(p.value) ? p.value : null;
  if (!branch) return <Absent text="No bank branch here." add="Add a bank branch" issues={p.lint} onAdd={() => p.onChange({ bank: "" })} />;
  return (
    <div class="lre-form-fields lre-money-build-place" data-lre-branch={p.place.id}>
      <TextInput label="Bank" value={branch.bank} hint="Its customers withdraw and deposit at the counter" issues={lintAt(p.lint, `${p.path}.bank`)} onChange={(bank) => p.onChange({ bank: textOf(bank) })} />
      <Issues issues={p.lint.filter((issue) => !under(issue, `${p.path}.bank`))} />
      <div class="lre-money-build-place-actions">
        <Button size="sm" variant="danger" icon="trash" onClick={() => p.onChange(undefined)}>
          Remove the branch
        </Button>
      </div>
    </div>
  );
}

export const MONEY_PLACE_FIELDS: readonly PlaceFieldDef[] = [
  { field: "atm", label: "Cash machine", component: AtmField },
  { field: "branch", label: "Bank branch", component: BranchField },
];
