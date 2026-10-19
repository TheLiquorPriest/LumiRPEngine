// Build's editors for the money fields whose values are structured (DESIGN §13, §25–§27): owners,
// an account's product, pay and flow splits, household shares, schedule lists, holding lots and
// routing, payroll deductions, a business's places, payment preferences, and the cash machines and
// branches places hold. Each edits the field's whole value; amounts are whole minor units, as Build
// stores money.

import type { ComponentChildren } from "preact";
import { ACCOUNT_CLASSES, CLASS_TRAITS, OWNER_ROLES, type PayTier } from "../../../shared/finance";
import { isRecord } from "../../../shared/json";
import type { JsonObject, JsonValue } from "../../../shared/json";
import type { WorldDoc } from "../../../shared/world";
import { MinorMoneyInput } from "../../../frontend/build/schema-form";
import { kindIs } from "../../../frontend/build/selector-editor";
import { humanize } from "../../../frontend/format";
import type { FieldEditorDef, FieldEditorProps, PlaceFieldDef, PlaceFieldEditorProps } from "../../../frontend/registry";
import { MONTH_CHOICES, NumberField, SelectField, TextField, WEEKDAY_CHOICES, type Choice } from "./forms";
import { PayTiersEditor } from "./pay-prefs";

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

/** Entities of these kinds (or kinds inheriting from them), as choices. */
export function entityChoices(doc: WorldDoc, kinds: readonly string[]): Choice[] {
  return Object.values(doc.entities)
    .filter((e) => kinds.some((k) => kindIs(doc, e.kind, k)))
    .map((e) => ({ value: e.id, label: `${e.name} (${e.id})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function Shell(props: { label: string; lint: FieldEditorProps["lint"]; children: ComponentChildren }) {
  return (
    <div class="lre-field" data-lre-money-field={props.label}>
      <span class="label">{props.label}</span>
      <div class="lre-stack">{props.children}</div>
      {props.lint.map((issue) => (
        <span key={`${issue.path}:${issue.code}`} class={issue.severity === "error" ? "lre-small lre-neg" : "lre-small lre-warn"}>
          {issue.message}
        </span>
      ))}
    </div>
  );
}

/** A list of records: each drawn by `row`, with remove, and an add button. */
function RecordList(props: { items: JsonObject[]; add: string; blank: JsonObject; onChange(next: JsonValue | undefined): void; row(item: JsonObject, set: (next: JsonObject) => void, index: number): ComponentChildren }) {
  const set = (i: number, next: JsonObject) => props.onChange(props.items.map((item, j) => (j === i ? next : item)));
  return (
    <>
      {props.items.map((item, i) => (
        <div key={i} class="lre-card lre-stack">
          {props.row(item, (next) => set(i, next), i)}
          <button type="button" class="lre-btn small danger" onClick={() => props.onChange(props.items.length > 1 ? props.items.filter((_, j) => j !== i) : undefined)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" class="lre-btn small" onClick={() => props.onChange([...props.items, props.blank])}>
        {props.add}
      </button>
    </>
  );
}

const label = (p: FieldEditorProps): string => p.def.label ?? humanize(p.field);

function OwnersField(p: FieldEditorProps) {
  const parties = entityChoices(p.doc, ["person", "business", "trust", "household"]);
  return (
    <Shell label={label(p)} lint={p.lint}>
      <RecordList
        items={recordsOf(p.value)}
        add="+ Add an owner"
        blank={{ party: "", role: "owner" }}
        onChange={p.onChange}
        row={(o, set) => (
          <>
            <SelectField label="Who" value={typeof o.party === "string" ? o.party : ""} empty="Choose" options={parties} onChange={(party) => set({ ...o, party })} />
            <SelectField label="Role" value={typeof o.role === "string" ? o.role : "owner"} options={OWNER_ROLES.map((r) => ({ value: r, label: humanize(r) }))} onChange={(role) => set({ ...o, role })} />
            <NumberField label="Share of its worth (%; empty: equal parts)" value={typeof o.share === "number" ? o.share : null} min={0} max={100} onChange={(share) => set(compact({ ...o, share: share ?? undefined }))} />
          </>
        )}
      />
    </Shell>
  );
}

function ProductField(p: FieldEditorProps) {
  const products = p.doc.packs.economy?.config.products;
  const own: Choice[] = isRecord(products) ? Object.entries(products).map(([id, def]) => ({ value: id, label: `${isRecord(def) && typeof def.label === "string" ? def.label : id} (the world's)` })) : [];
  const classes = ACCOUNT_CLASSES.map((c) => ({ value: c, label: `${CLASS_TRAITS[c].label} (built in)` }));
  const value = typeof p.value === "string" ? p.value : "";
  const known = [...own, ...classes].some((c) => c.value === value);
  return (
    <Shell label={label(p)} lint={p.lint}>
      <SelectField label="Product" value={value} empty="Choose" options={[...own, ...classes, ...(known || value === "" ? [] : [{ value, label: `${value} (not defined)` }])]} onChange={(next) => p.onChange(next === "" ? undefined : next)} />
    </Shell>
  );
}

/** Where money is routed: an account in the world (or a name), a fixed amount or a percentage of the rest. */
function SplitsField(p: FieldEditorProps) {
  const accounts = entityChoices(p.doc, ["account"]);
  return (
    <Shell label={label(p)} lint={p.lint}>
      <span class="lre-small lre-muted">Fixed amounts go first, then percentages of what's left; the rest goes to the main account.</span>
      <RecordList
        items={recordsOf(p.value)}
        add="+ Add a split"
        blank={{ to: "", pct: 10 }}
        onChange={p.onChange}
        row={(s, set) => (
          <>
            <SelectField label="To" value={typeof s.to === "string" ? s.to : ""} empty="Choose an account" options={accounts} onChange={(to) => set({ ...s, to })} />
            <MinorMoneyInput label="Fixed amount" value={s.cents} currency={p.doc.currency} min={0} optional issues={[]} onChange={(cents) => set(compact({ ...s, cents, pct: cents === undefined ? s.pct : undefined }))} />
            <NumberField label="Or a percentage" value={typeof s.pct === "number" ? s.pct : null} min={0} max={100} onChange={(pct) => set(compact({ ...s, pct: pct ?? undefined, cents: pct === null ? s.cents : undefined }))} />
          </>
        )}
      />
    </Shell>
  );
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

function SharesField(p: FieldEditorProps) {
  const parties = entityChoices(p.doc, ["person", "business", "trust"]);
  const accounts = entityChoices(p.doc, ["account"]);
  const households = entityChoices(p.doc, ["household"]);
  const shares = recordsOf(p.value);
  const total = shares.reduce((sum, s) => sum + (typeof s.pct === "number" ? s.pct : 0), 0);
  return (
    <Shell label={label(p)} lint={p.lint}>
      {households.length > 0 ? <SelectField label="Split equally among a household's members" value="" empty="Choose a household" options={households} onChange={(h) => h !== "" && p.onChange(equalShares(householdMembers(p.doc, h)))} /> : null}
      <RecordList
        items={shares}
        add="+ Add a share"
        blank={{ party: "", pct: 0 }}
        onChange={p.onChange}
        row={(s, set) => (
          <>
            <SelectField label="Who" value={typeof s.party === "string" ? s.party : ""} empty="Choose" options={parties} onChange={(party) => set({ ...s, party })} />
            <NumberField label="Their part (%)" value={typeof s.pct === "number" ? s.pct : null} min={0} max={100} onChange={(pct) => set({ ...s, pct: pct ?? 0 })} />
            <SelectField label="Paid from" value={typeof s.from === "string" ? s.from : ""} empty="As their preferences choose" options={accounts} onChange={(from) => set(compact({ ...s, from }))} />
          </>
        )}
      />
      {shares.length > 0 ? <span class={total === 100 ? "lre-small lre-muted" : "lre-small lre-warn"}>Parts add up to {total}%{total === 100 ? "" : " (they should make 100%)"}.</span> : null}
    </Shell>
  );
}

/** Toggles over a fixed set of numbers (weekdays, months). */
function NumberToggles(p: FieldEditorProps & { choices: readonly Choice[] }) {
  const on = numbersOf(p.value);
  return (
    <Shell label={label(p)} lint={p.lint}>
      <div class="lre-seg" role="group" aria-label={label(p)}>
        {p.choices.map((c) => {
          const n = Number(c.value);
          const pressed = on.includes(n);
          return (
            <button key={c.value} type="button" aria-pressed={pressed} onClick={() => p.onChange(pressed ? on.filter((x) => x !== n) : [...on, n].sort((a, b) => a - b))}>
              {c.label.slice(0, 3)}
            </button>
          );
        })}
      </div>
    </Shell>
  );
}

const WeekdaysField = (p: FieldEditorProps) => <NumberToggles {...p} choices={WEEKDAY_CHOICES} />;
const MonthsField = (p: FieldEditorProps) => <NumberToggles {...p} choices={MONTH_CHOICES} />;

/** Days of the month as typed ("1, 15, -1"); -1 is the last day. */
export function monthDays(text: string): number[] | null {
  const parts = text.split(",").map((s) => s.trim()).filter((s) => s !== "");
  const days = parts.map(Number);
  return days.every((d) => Number.isInteger(d) && (d === -1 || (d >= 1 && d <= 31))) ? [...new Set(days)].sort((a, b) => a - b) : null;
}

function MonthDaysField(p: FieldEditorProps) {
  const now = numbersOf(p.value).join(", ");
  return (
    <Shell label={label(p)} lint={p.lint}>
      <TextField
        label="Days (comma separated; -1 is the last day)"
        value={now}
        onInput={(text) => {
          const days = monthDays(text);
          if (days !== null) p.onChange(days);
        }}
      />
    </Shell>
  );
}

function HolidaysField(p: FieldEditorProps) {
  const on = Array.isArray(p.value) ? p.value.filter((v): v is string => typeof v === "string") : [];
  return (
    <Shell label={label(p)} lint={p.lint}>
      {p.doc.calendar.holidays.length === 0 ? <span class="lre-small lre-muted">The calendar has no holidays.</span> : null}
      <div class="lre-inline">
        {p.doc.calendar.holidays.map((h) => {
          const pressed = on.includes(h.id);
          return (
            <button key={h.id} type="button" class={pressed ? "lre-btn small primary" : "lre-btn small"} aria-pressed={pressed} onClick={() => p.onChange(pressed ? on.filter((x) => x !== h.id) : [...on, h.id])}>
              {h.label}
            </button>
          );
        })}
      </div>
    </Shell>
  );
}

function LotsField(p: FieldEditorProps) {
  return (
    <Shell label={label(p)} lint={p.lint}>
      <RecordList
        items={recordsOf(p.value)}
        add="+ Add a lot"
        blank={{ qty: 1, cost: 0, at: p.doc.start.at.slice(0, 10) }}
        onChange={p.onChange}
        row={(l, set) => (
          <>
            <NumberField label="Units" value={typeof l.qty === "number" ? l.qty : null} min={0} onChange={(qty) => set({ ...l, qty: qty ?? 0 })} />
            <MinorMoneyInput label="What it cost in all" value={l.cost} currency={p.doc.currency} min={0} issues={[]} onChange={(cost) => set({ ...l, cost: cost ?? 0 })} />
            <TextField label="Bought" type="date" value={typeof l.at === "string" ? l.at.slice(0, 10) : ""} onInput={(at) => set({ ...l, at })} />
          </>
        )}
      />
    </Shell>
  );
}

function RouteField(p: FieldEditorProps) {
  const accounts = entityChoices(p.doc, ["account"]);
  return (
    <Shell label={label(p)} lint={p.lint}>
      <SelectField label="Distributions go to" value={typeof p.value === "string" ? p.value : ""} options={[{ value: "", label: "The usual place (its account's cash, else the deposit account)" }, { value: "reinvest", label: "Reinvested" }, ...accounts]} onChange={(to) => p.onChange(to === "" ? undefined : to)} />
    </Shell>
  );
}

function AssetField(p: FieldEditorProps) {
  const assets = p.doc.packs.economy?.config.assets;
  const own: Choice[] = isRecord(assets) ? Object.entries(assets).map(([id, def]) => ({ value: id, label: `${isRecord(def) && typeof def.label === "string" ? def.label : id} (${id})` })) : [];
  const value = typeof p.value === "string" ? p.value : "";
  return (
    <Shell label={label(p)} lint={p.lint}>
      <SelectField label="Asset (the economy pack's assets)" value={value} empty="Choose" options={own.some((o) => o.value === value) || value === "" ? own : [...own, { value, label: `${value} (not defined)` }]} onChange={(next) => p.onChange(next === "" ? undefined : next)} />
    </Shell>
  );
}

function DeductionsField(p: FieldEditorProps) {
  return (
    <Shell label={label(p)} lint={p.lint}>
      <RecordList
        items={recordsOf(p.value)}
        add="+ Add a deduction"
        blank={{ label: "401(k)", kind: "retirement", pretax: true, pct: 5 }}
        onChange={p.onChange}
        row={(d, set) => (
          <>
            <TextField label="Name" value={typeof d.label === "string" ? d.label : ""} onInput={(text) => set({ ...d, label: text })} />
            <SelectField label="Kind" value={typeof d.kind === "string" ? d.kind : "other"} options={["retirement", "health", "other"].map((k) => ({ value: k, label: humanize(k) }))} onChange={(kind) => set({ ...d, kind })} />
            <label class="lre-row">
              <span class="k">Taken before income tax</span>
              <span class="lre-check">
                <input type="checkbox" checked={d.pretax === true} onChange={(event) => set({ ...d, pretax: event.currentTarget.checked })} />
              </span>
            </label>
            <MinorMoneyInput label="Fixed amount each payday" value={d.cents} currency={p.doc.currency} min={0} optional issues={[]} onChange={(cents) => set(compact({ ...d, cents, pct: cents === undefined ? d.pct : undefined }))} />
            <NumberField label="Or a percentage of pay" value={typeof d.pct === "number" ? d.pct : null} min={0} max={100} onChange={(pct) => set(compact({ ...d, pct: pct ?? undefined, cents: pct === null ? d.cents : undefined }))} />
            <NumberField label="Employer match (% of pay)" value={typeof d.match_pct === "number" ? d.match_pct : null} min={0} max={100} onChange={(match) => set(compact({ ...d, match_pct: match ?? undefined }))} />
            <SelectField label="Goes to" value={typeof d.to === "string" ? d.to : ""} empty="An outside payee" options={entityChoices(p.doc, ["account"])} onChange={(to) => set(compact({ ...d, to }))} />
          </>
        )}
      />
    </Shell>
  );
}

function PlacesField(p: FieldEditorProps) {
  const on = Array.isArray(p.value) ? p.value.filter((v): v is string => typeof v === "string") : [];
  const places = Object.values(p.doc.places).map((pl) => ({ value: pl.id, label: pl.name }));
  return (
    <Shell label={label(p)} lint={p.lint}>
      {on.map((id) => (
        <button key={id} type="button" class="lre-btn small" aria-label={`Remove ${p.doc.places[id]?.name ?? id}`} onClick={() => p.onChange(on.length > 1 ? on.filter((x) => x !== id) : undefined)}>
          {p.doc.places[id]?.name ?? id} ✕
        </button>
      ))}
      <SelectField label="Add a place" value="" empty="+ Add…" options={places.filter((pl) => !on.includes(pl.value))} onChange={(id) => id !== "" && p.onChange([...on, id])} />
    </Shell>
  );
}

function PayPrefsField(p: FieldEditorProps) {
  const mine = Object.values(p.doc.entities).filter((e) => (kindIs(p.doc, e.kind, "account") && recordsOf(e.fields.owners).some((o) => o.party === p.entity.id)) || (kindIs(p.doc, e.kind, "card") && e.fields.holder === p.entity.id));
  const categories = Object.keys(p.doc.tables["economy.categories"]?.rows ?? {}).sort();
  const tiers: PayTier[] = recordsOf(p.value).flatMap((t) => (typeof t.use === "string" ? [{ use: t.use, ...(typeof t.min === "number" ? { min: t.min } : {}), ...(typeof t.max === "number" ? { max: t.max } : {}), ...(Array.isArray(t.categories) ? { categories: t.categories.filter((c): c is string => typeof c === "string") } : {}), ...(Array.isArray(t.except) ? { except: t.except.filter((c): c is string => typeof c === "string") } : {}) }] : []));
  return (
    <Shell label={label(p)} lint={p.lint}>
      <PayTiersEditor value={tiers} uses={mine.map((e) => ({ value: e.id, label: e.name }))} categories={categories} currency={p.doc.currency} unit="minor" onChange={(next) => p.onChange(next.length === 0 ? undefined : next.map((t) => compact({ use: t.use, min: t.min, max: t.max, categories: t.categories && t.categories.length > 0 ? t.categories : undefined, except: t.except && t.except.length > 0 ? t.except : undefined })))} />
    </Shell>
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

/** A place's cash machine: its bank, the operator's surcharge, the most it pays out at once, and whether it takes deposits. */
function AtmField(p: PlaceFieldEditorProps) {
  const atm = isRecord(p.value) ? p.value : null;
  if (!atm) {
    return (
      <button type="button" class="lre-btn small" onClick={() => p.onChange({ bank: "" })}>
        + A cash machine here
      </button>
    );
  }
  const set = (patch: Record<string, JsonValue | undefined>) => p.onChange(compact({ ...atm, ...patch, bank: typeof patch.bank === "string" ? patch.bank : atm.bank }) as JsonValue);
  return (
    <div class="lre-stack" data-lre-atm={p.place.id}>
      <TextField label="Bank (its customers pay no out-of-network fee)" value={typeof atm.bank === "string" ? atm.bank : ""} onInput={(bank) => set({ bank })} />
      <MinorMoneyInput label="Surcharge" value={atm.fee} currency={p.doc.currency} min={0} optional issues={p.lint.filter((i) => i.path.endsWith(".fee"))} onChange={(fee) => set({ fee })} />
      <MinorMoneyInput label="Most it pays out at once" value={atm.limit} currency={p.doc.currency} min={1} optional issues={p.lint.filter((i) => i.path.endsWith(".limit"))} onChange={(limit) => set({ limit })} />
      <label class="lre-row">
        <span class="k">Takes deposits (held for the account's hold days)</span>
        <span class="lre-check">
          <input type="checkbox" checked={atm.deposits === true} onChange={(event) => set({ deposits: event.currentTarget.checked || undefined })} />
        </span>
      </label>
      <button type="button" class="lre-btn small danger" onClick={() => p.onChange(undefined)}>
        No cash machine
      </button>
    </div>
  );
}

function BranchField(p: PlaceFieldEditorProps) {
  const branch = isRecord(p.value) ? p.value : null;
  if (!branch) {
    return (
      <button type="button" class="lre-btn small" onClick={() => p.onChange({ bank: "" })}>
        + A bank branch here
      </button>
    );
  }
  return (
    <div class="lre-stack" data-lre-branch={p.place.id}>
      <TextField label="Bank (its customers withdraw and deposit at the counter)" value={typeof branch.bank === "string" ? branch.bank : ""} onInput={(bank) => p.onChange({ bank })} />
      <button type="button" class="lre-btn small danger" onClick={() => p.onChange(undefined)}>
        No branch
      </button>
    </div>
  );
}

export const MONEY_PLACE_FIELDS: readonly PlaceFieldDef[] = [
  { field: "atm", label: "Cash machine", component: AtmField },
  { field: "branch", label: "Bank branch", component: BranchField },
];
