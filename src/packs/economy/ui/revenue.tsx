// Revenue streams in Build → Organizations and GM → Orgs → Money (DESIGN §26.2, Revenue streams):
// an organization's streams, each a `flow` entity with a `revenue` model; a new one starts from a
// template (walk-in, one product, a catalog, an oil, gas or water royalty, fees, custom) and is
// shaped in plain fields, with a deterministic preview of its next twelve months beside it. The
// host mounts the editor (Build → Organizations; GM → Orgs → Money, its streams read from the GM
// view by `gmStreamDrafts`) and keeps what it saves: Build writes the stream into the draft, the GM
// sends `revenueSpawnOps`, `revenueEditOps` or a Remove. `RevenueStreams` lists a party's streams on
// Play's money pages, with what each earned and is set to earn.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { EntityId } from "../../../shared/ids";
import { hasOwn, type JsonObject, type JsonValue } from "../../../shared/json";
import { formatMoneyInput, parseMoneyInput } from "../../../shared/money";
import type { EditOp } from "../../../shared/protocol";
import {
  CATALOG_MAX,
  REVENUE_TEMPLATE_IDS,
  REVENUE_TEMPLATES,
  oneRecord,
  revenueOf,
  revenueProblems,
  type RevenueStreamView,
  type RevenueTemplateId,
  type RevenueType,
} from "../../../shared/revenue";
import type { GmView } from "../../../shared/state-view";
import { formatMoney, type WorldCurrency, type WorldDoc } from "../../../shared/world";
import { Badge, Button, Disclosure, Empty, List, ListRow, Section } from "../../../frontend/components";
import { draftPreview } from "../core/revenue";
import { ChoiceField, MONTH_CHOICES, NumberField, SelectField, TextField, ToggleField, WEEKDAY_CHOICES } from "./forms";
import { FLOW_CLEARABLE, newIdFor } from "./requests";

/** A stream as the editor holds it: a flow entity's id, name and fields. */
export interface RevenueStreamDraft {
  id: string;
  name: string;
  fields: JsonObject;
}

const TYPE_LABELS: Readonly<Record<RevenueType, string>> = { product: "One product", catalog: "Catalog", royalty: "Royalty", fees: "Fees", custom: "Custom formula" };

// ---------------------------------------------------------------- reading and writing a draft

/** The draft's model record (its `revenue`, read as one record). */
function modelRecord(draft: RevenueStreamDraft): JsonObject {
  return oneRecord(draft.fields.revenue) ?? { type: "product" };
}

/** The draft with its model changed: keys set to `undefined` are taken off. */
function withModel(draft: RevenueStreamDraft, patch: Readonly<Record<string, JsonValue | undefined>>): RevenueStreamDraft {
  const next: JsonObject = { ...modelRecord(draft) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return { ...draft, fields: { ...draft.fields, revenue: [next] } };
}

function withFields(draft: RevenueStreamDraft, patch: Readonly<Record<string, JsonValue | undefined>>): RevenueStreamDraft {
  const fields: JsonObject = { ...draft.fields };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete fields[k];
    else fields[k] = v;
  }
  return { ...draft, fields };
}

/** A driver as its field shows it: a number, or the formula as typed. */
function driverText(v: JsonValue | undefined): string {
  return typeof v === "number" ? String(v) : typeof v === "string" ? v : "";
}

/** A driver's text as the model keeps it: a number when it reads as one, else a formula; nothing when empty. */
function driverValue(text: string): JsonValue | undefined {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

/** A new stream from a template, paying into `earner`. */
export function streamFromTemplate(template: RevenueTemplateId, earner: EntityId, taken: ReadonlySet<string>): RevenueStreamDraft {
  const t = REVENUE_TEMPLATES[template];
  return { id: newIdFor("stream", `${earner} ${t.label}`, taken), name: t.label, fields: { ...structuredClone(t.fields), to: earner, status: "active" } };
}

/** The GM's new stream: spawned under its name, its fields set, in one edit. */
export function revenueSpawnOps(draft: RevenueStreamDraft): EditOp[] {
  return [{ op: "spawn", kind: "flow", name: draft.name.trim(), id: draft.id }, ...Object.entries(draft.fields).map(([field, value]): EditOp => ({ op: "set", entity: draft.id, field, value }))];
}

/**
 * The GM's change to a stream, as `flowEditOps` makes a flow's: a `set` for each field the editor
 * changed; what it emptied, which a set can't unset: a schedule list (its day of the month, once it
 * pays daily) set empty, and its time or start cleared, with a new name, by `economy.flow_edit`.
 */
export function revenueEditOps(was: RevenueStreamDraft, now: RevenueStreamDraft): EditOp[] {
  const ops: EditOp[] = [];
  for (const [field, value] of Object.entries(now.fields)) if (JSON.stringify(was.fields[field] ?? null) !== JSON.stringify(value)) ops.push({ op: "set", entity: now.id, field, value });
  const emptied = Object.keys(was.fields).filter((field) => !hasOwn(now.fields, field) && was.fields[field] !== null);
  for (const field of emptied) if (Array.isArray(was.fields[field]) && was.fields[field].length > 0) ops.push({ op: "set", entity: now.id, field, value: [] });
  const clear = FLOW_CLEARABLE.filter((field) => emptied.includes(field));
  const name = now.name.trim();
  const renamed = name !== "" && name !== was.name;
  if (renamed || clear.length > 0) ops.push({ op: "effect", effect: "economy.flow_edit", args: { flow: now.id, ...(renamed ? { name } : {}), ...(clear.length > 0 ? { clear: clear.join(",") } : {}) } });
  return ops;
}

/** A party's streams (its money view's, `streams`) as the GM's editor holds them: each flow as the GM view has it, with its fields as stored (none derived, none empty), by name. One the GM view doesn't hold, or holds removed, isn't the GM's to edit. */
export function gmStreamDrafts(gm: Pick<GmView, "entities">, streams: readonly RevenueStreamView[]): RevenueStreamDraft[] {
  return streams
    .flatMap((s) => {
      const e = gm.entities.find((x) => x.id === s.id);
      if (!e || e.gone) return [];
      const fields: JsonObject = {};
      for (const f of e.fields) if (f.derived === undefined && f.value !== null) fields[f.id] = f.value;
      return [{ id: e.id, name: e.name, fields }];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  return `${MONTH_CHOICES[Number(m) - 1]?.label.slice(0, 3) ?? m} ${y ?? ""}`;
}

/** Twelve months of a stream, a row each, and their total. */
function PreviewList(props: { months: readonly { month: string; cents: number }[]; currency: WorldCurrency; title: ComponentChildren }) {
  const total = props.months.reduce((a, m) => a + m.cents, 0);
  return (
    <Section title={props.title} aside={formatMoney(total, props.currency)}>
      <List>
        {props.months.map((m) => (
          <ListRow key={m.month} title={monthLabel(m.month)} value={formatMoney(m.cents, props.currency)} valueTone={m.cents > 0 ? undefined : "muted"} />
        ))}
      </List>
    </Section>
  );
}

// ---------------------------------------------------------------- fields

/** A money field holding its own text while it is typed, sending minor units once they read. */
function MoneyInput(props: { label: string; cents: number | undefined; currency: WorldCurrency; onChange(cents: number | undefined): void; help?: ComponentChildren }) {
  const [text, setText] = useState(props.cents === undefined ? "" : formatMoneyInput(props.cents, props.currency));
  return (
    <TextField
      label={props.label}
      value={text}
      help={props.help}
      onInput={(t) => {
        setText(t);
        props.onChange(t.trim() === "" ? undefined : (parseMoneyInput(t, props.currency) ?? props.cents));
      }}
    />
  );
}

function PctField(props: { label: string; value: JsonValue | undefined; onChange(v: number | undefined): void; help?: ComponentChildren }) {
  return <NumberField label={props.label} value={typeof props.value === "number" ? props.value : null} min={0} max={100} step={0.1} help={props.help} onChange={(v) => props.onChange(v ?? undefined)} />;
}

/** Factors a list long (twelve months, seven weekdays), 1 for each unset. */
function FactorFields(props: { summary: string; labels: readonly string[]; value: JsonValue | undefined; onChange(v: number[] | undefined): void }) {
  const list = Array.isArray(props.value) ? props.value : [];
  const at = (i: number): number => (typeof list[i] === "number" ? (list[i] as number) : 1);
  return (
    <Disclosure summary={props.summary}>
      {props.labels.map((label, i) => (
        <NumberField
          key={label}
          label={label}
          value={at(i)}
          min={0}
          step={0.05}
          onChange={(v) => {
            const next = props.labels.map((_, j) => (j === i ? (v ?? 1) : at(j)));
            props.onChange(next.every((x) => x === 1) ? undefined : next);
          }}
        />
      ))}
    </Disclosure>
  );
}

/** Units × price × buyers, and how they swing (product, fees). */
function DriverFields(props: { draft: RevenueStreamDraft; currency: WorldCurrency; set(patch: Record<string, JsonValue | undefined>): void }) {
  const m = modelRecord(props.draft);
  const fees = m.type === "fees";
  return (
    <>
      <MoneyInput label={fees ? "Fee" : "Price a unit"} cents={typeof m.price === "number" ? m.price : undefined} currency={props.currency} onChange={(price) => props.set({ price })} />
      <TextField label="Units each buyer takes" value={driverText(m.units)} placeholder="1" help="A number, or a formula (=…) read when it pays." onInput={(t) => props.set({ units: driverValue(t) })} />
      <TextField label={fees ? "Clients" : "Buyers each time"} value={driverText(m.buyers)} placeholder="1" help="A number, or a formula (=…) read when it pays." onInput={(t) => props.set({ buyers: driverValue(t) })} />
      {fees ? null : <PctField label="Margin kept %" value={m.margin_pct} help="The rest is the cost of the goods, owed to suppliers. Unset: the business's own." onChange={(v) => props.set({ margin_pct: v })} />}
      <TextField label={fees ? "Category" : "Tax category"} value={typeof m.category === "string" ? m.category : ""} placeholder={fees ? "fee_income" : "general"} onInput={(t) => props.set({ category: t.trim() === "" ? undefined : t.trim() })} />
    </>
  );
}

/** A catalog's items, up to 50, each with its price, units, margin and tax category. */
function CatalogFields(props: { draft: RevenueStreamDraft; currency: WorldCurrency; set(patch: Record<string, JsonValue | undefined>): void }) {
  const m = modelRecord(props.draft);
  const items = (Array.isArray(m.items) ? m.items : []).filter((x): x is JsonObject => typeof x === "object" && x !== null && !Array.isArray(x));
  const setItem = (i: number, patch: JsonObject): void => props.set({ items: items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <>
      <TextField label="Buyers each time" value={driverText(m.buyers)} placeholder="1" help="A number, or a formula (=…) read when it pays." onInput={(t) => props.set({ buyers: driverValue(t) })} />
      {items.map((item, i) => (
        <Disclosure key={String(item.id ?? i)} summary={`${typeof item.name === "string" && item.name !== "" ? item.name : `Item ${i + 1}`}${typeof item.price === "number" ? `, ${formatMoney(item.price, props.currency)}` : ""}`}>
          <TextField label="Name" value={typeof item.name === "string" ? item.name : ""} onInput={(name) => setItem(i, { name })} />
          <MoneyInput label="Price a unit" cents={typeof item.price === "number" ? item.price : undefined} currency={props.currency} onChange={(price) => setItem(i, { price: price ?? 0 })} />
          <TextField label="Units each buyer takes" value={driverText(item.units)} placeholder="1" onInput={(t) => setItem(i, { units: driverValue(t) ?? 1 })} />
          <PctField label="Margin kept %" value={item.margin_pct} onChange={(v) => setItem(i, v === undefined ? {} : { margin_pct: v })} />
          <TextField label="Tax category" value={typeof item.category === "string" ? item.category : ""} placeholder="groceries" help="Untaxed where the region exempts the category." onInput={(t) => setItem(i, { category: t.trim() })} />
          <Button variant="ghost" size="sm" icon="trash" onClick={() => props.set({ items: items.filter((_, j) => j !== i) })}>
            Remove {typeof item.name === "string" && item.name !== "" ? item.name : "this item"}
          </Button>
        </Disclosure>
      ))}
      <Button variant="secondary" size="sm" icon="plus" disabled={items.length >= CATALOG_MAX} onClick={() => props.set({ items: [...items, { id: `item_${items.length + 1}`, name: `Item ${items.length + 1}`, price: 1000, units: 1 }] })}>
        {items.length >= CATALOG_MAX ? `A catalog sells at most ${CATALOG_MAX}` : "Add an item"}
      </Button>
    </>
  );
}

type ProductionMode = "steady" | "decline" | "series";
type PriceMode = "fixed" | "series" | "asset";

function listText(v: JsonValue | undefined): string {
  return Array.isArray(v) ? v.map(String).join(", ") : "";
}

function listValue(text: string): number[] | undefined {
  const out = text.split(/[,\s]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n));
  return out.length > 0 ? out : undefined;
}

/** A royalty: production, price, share, deductions, severance and lag. */
function RoyaltyFields(props: { world: WorldDoc; draft: RevenueStreamDraft; set(patch: Record<string, JsonValue | undefined>): void }) {
  const m = modelRecord(props.draft);
  const p = m.production;
  const pmode: ProductionMode = Array.isArray(p) ? "series" : typeof p === "object" && p !== null ? "decline" : "steady";
  const decline = pmode === "decline" ? (p as JsonObject) : {};
  const price = m.price;
  const qmode: PriceMode = Array.isArray(price) ? "series" : typeof price === "object" && price !== null ? "asset" : "fixed";
  const unit = typeof m.unit === "string" && m.unit !== "" ? m.unit : "unit";
  const assets = Object.keys((props.world.packs.economy?.config.assets ?? {}) as JsonObject).sort();
  const setDecline = (patch: JsonObject): void => props.set({ production: { qi: 1000, di_pct: 50, ...decline, ...patch } });
  return (
    <>
      <TextField label="Counted in" value={typeof m.unit === "string" ? m.unit : ""} placeholder="bbl" onInput={(t) => props.set({ unit: t.trim() === "" ? undefined : t.trim() })} />
      <SelectField
        label="Production"
        value={pmode}
        options={[
          { value: "steady", label: "The same each month" },
          { value: "decline", label: "Declining, as a well does" },
          { value: "series", label: "Month by month" },
        ]}
        onChange={(v) => props.set({ production: v === "steady" ? 1000 : v === "decline" ? { qi: 1000, di_pct: 50, b: 1 } : [1000, 900, 800] })}
      />
      {pmode === "steady" ? <NumberField label={`${unit} a month`} value={typeof p === "number" ? p : null} min={0} onChange={(v) => props.set({ production: v ?? 0 })} /> : null}
      {pmode === "decline" ? (
        <>
          <NumberField label={`First month, ${unit}`} value={typeof decline.qi === "number" ? decline.qi : null} min={0} onChange={(v) => setDecline({ qi: v ?? 0 })} />
          <NumberField label="Falls by % a year" value={typeof decline.di_pct === "number" ? decline.di_pct : null} min={0} help="The nominal decline rate." onChange={(v) => setDecline({ di_pct: v ?? 0 })} />
          <NumberField label="Curve (b)" value={typeof decline.b === "number" ? decline.b : 0} min={0} max={2} step={0.1} help="0 falls steadily (exponential), 1 flattens out (harmonic), between is hyperbolic." onChange={(v) => setDecline({ b: v ?? 0 })} />
        </>
      ) : null}
      {pmode === "series" ? <TextField label={`${unit} each month from the start`} value={listText(p)} placeholder="1000, 950, 900" onInput={(t) => props.set({ production: listValue(t) ?? [] })} /> : null}
      <SelectField
        label="Price"
        value={qmode}
        options={[
          { value: "fixed", label: "A set price" },
          { value: "series", label: "Month by month" },
          ...(assets.length > 0 ? [{ value: "asset", label: "An asset's market price" }] : []),
        ]}
        onChange={(v) => props.set({ price: v === "fixed" ? 5000 : v === "series" ? [5000] : { asset: assets[0] ?? "" } })}
      />
      {qmode === "fixed" ? <MoneyInput label={`Price a ${unit}`} cents={typeof price === "number" ? price : undefined} currency={props.world.currency} onChange={(v) => props.set({ price: v ?? 0 })} /> : null}
      {qmode === "series" ? <TextField label={`Price a ${unit} each month, minor units`} value={listText(price)} placeholder="7000, 7100, 6900" onInput={(t) => props.set({ price: listValue(t) ?? [] })} /> : null}
      {qmode === "asset" ? <SelectField label="Asset" value={typeof price === "object" && price !== null && !Array.isArray(price) ? String((price as JsonObject).asset ?? "") : ""} options={assets.map((a) => ({ value: a, label: a }))} onChange={(asset) => props.set({ price: { asset } })} /> : null}
      <PctField label="Royalty share %" value={m.share_pct} help="The share of production's value it pays." onChange={(v) => props.set({ share_pct: v })} />
      <PctField label="Deductions %" value={m.deductions_pct} help="Post-production costs taken off the gross." onChange={(v) => props.set({ deductions_pct: v })} />
      <PctField label="Severance tax %" value={m.severance_pct} onChange={(v) => props.set({ severance_pct: v })} />
      <NumberField label="Paid months after production" value={typeof m.lag_months === "number" ? m.lag_months : 0} min={0} max={24} onChange={(v) => props.set({ lag_months: v ?? undefined })} />
    </>
  );
}

/** When it pays: every day, week or month, at a time, from a start date. */
function ScheduleFields(props: { draft: RevenueStreamDraft; setFields(patch: Record<string, JsonValue | undefined>): void }) {
  const f = props.draft.fields;
  const every = typeof f.every === "string" ? f.every : "day";
  const day = Array.isArray(f.days) && typeof f.days[0] === "number" ? f.days[0] : 1;
  const weekday = Array.isArray(f.weekdays) && typeof f.weekdays[0] === "number" ? f.weekdays[0] : 5;
  return (
    <>
      <ChoiceField
        label="Pays"
        value={every}
        options={[
          { value: "day", label: "Every day" },
          { value: "week", label: "Every week" },
          { value: "month", label: "Every month" },
        ]}
        onChange={(v) => props.setFields({ every: v, days: v === "month" ? [day] : undefined, weekdays: v === "week" ? [weekday] : undefined })}
      />
      {every === "month" ? <NumberField label="On day of the month" value={day} min={1} max={31} onChange={(v) => props.setFields({ days: [v ?? 1] })} /> : null}
      {every === "week" ? <SelectField label="On" value={String(weekday)} options={WEEKDAY_CHOICES} onChange={(v) => props.setFields({ weekdays: [Number(v)] })} /> : null}
      <TextField label="At" type="time" value={typeof f.at === "string" ? f.at : "09:00"} onInput={(at) => props.setFields({ at: at === "" ? undefined : at })} />
      <TextField label="Starts" type="date" value={typeof f.start === "string" ? f.start : ""} help="Growth counts from here, and a royalty's production." onInput={(start) => props.setFields({ start: start === "" ? undefined : start })} />
    </>
  );
}

const MONTH_LABELS = MONTH_CHOICES.map((c) => c.label);
const WEEKDAY_LABELS = WEEKDAY_CHOICES.map((c) => c.label);

/** One stream's form: its name, its model's fields by type, how it swings, when it pays, the agents' say, and its preview. */
export function StreamForm(props: { world: WorldDoc; draft: RevenueStreamDraft; preview?: readonly number[]; onChange(draft: RevenueStreamDraft): void; onSave(): void; onCancel(): void; onRemove?(): void; saving?: boolean }) {
  const { draft, world } = props;
  const m = modelRecord(draft);
  const type = (typeof m.type === "string" ? m.type : "product") as RevenueType;
  const set = (patch: Record<string, JsonValue | undefined>): void => props.onChange(withModel(draft, patch));
  const setFields = (patch: Record<string, JsonValue | undefined>): void => props.onChange(withFields(draft, patch));
  const problems = revenueProblems(draft.fields.revenue);
  const months = draftPreview(world, draft);
  const shaped = type === "product" || type === "catalog" || type === "fees";
  return (
    <>
      <Section title={TYPE_LABELS[type]}>
        <TextField label="Name" value={draft.name} onInput={(name) => props.onChange({ ...draft, name })} />
        <TextField label="Paid by" value={typeof draft.fields.from === "string" ? draft.fields.from : ""} placeholder="Customers" help="Who pays: an outside name, or an account or party in the world." onInput={(from) => setFields({ from })} />
        {type === "product" || type === "fees" ? <DriverFields draft={draft} currency={world.currency} set={set} /> : null}
        {type === "catalog" ? <CatalogFields draft={draft} currency={world.currency} set={set} /> : null}
        {type === "royalty" ? <RoyaltyFields world={world} draft={draft} set={set} /> : null}
        {type === "custom" ? <TextField label="Each payment, minor units" value={typeof m.formula === "string" ? m.formula : ""} placeholder="100000 * season" help="A formula: `season`, `growth`, `weekday_factor`, `t` (months since it started) and the clock names are there; `self` is whoever earns it." onInput={(t) => set({ formula: t.trim() === "" ? undefined : t })} /> : null}
      </Section>
      {shaped ? (
        <Section title="How it swings">
          <FactorFields summary="Busier and quieter months" labels={MONTH_LABELS} value={m.season} onChange={(season) => set({ season })} />
          {type !== "fees" ? <FactorFields summary="Busier and quieter days" labels={WEEKDAY_LABELS} value={m.weekdays} onChange={(weekdays) => set({ weekdays })} /> : null}
          <NumberField label="Grows by % a year" value={typeof m.growth_pct === "number" ? m.growth_pct : null} step={0.5} onChange={(v) => set({ growth_pct: v ?? undefined })} />
          <NumberField label="Varies by up to ± %" value={typeof m.spread_pct === "number" ? m.spread_pct : 0} min={0} max={100} help="0: every payment is exactly what the model gives." onChange={(v) => set({ spread_pct: v ? v : undefined })} />
        </Section>
      ) : null}
      <Section title="When it pays">
        <ScheduleFields draft={draft} setFields={setFields} />
      </Section>
      <Section title="In play">
        <ToggleField label="The agents may adjust it" help="Within bounds: a factor of 0.25 to 4 or one period's amount, for up to 31 days, at most four at once; what the story says asks you first." checked={m.ai === "bounded"} onChange={(on) => set({ ai: on ? "bounded" : undefined })} />
      </Section>
      {problems.length > 0 ? (
        <Section title="To fix">
          <List>
            {problems.map((p) => (
              <ListRow key={p} title={`It ${p}.`} icon="alert" />
            ))}
          </List>
        </Section>
      ) : null}
      {props.preview && props.preview.length > 0 ? (
        <PreviewList title="Next twelve months, as it stands in play" currency={world.currency} months={props.preview.map((cents, i) => ({ month: months[i]?.month ?? String(i + 1), cents }))} />
      ) : months.length > 0 ? (
        <PreviewList title="Its first twelve months" currency={world.currency} months={months} />
      ) : null}
      <div class="lre-form-actions">
        <Button variant="primary" busy={props.saving} disabled={problems.length > 0 || draft.name.trim() === ""} onClick={props.onSave}>
          Save {draft.name.trim() || "the stream"}
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>
          Cancel
        </Button>
        {props.onRemove ? (
          <Button variant="danger" icon="trash" onClick={props.onRemove}>
            Remove it
          </Button>
        ) : null}
      </div>
    </>
  );
}

/** A month's amount, roughly, for a stream's row: its preview's average. */
function aMonth(months: readonly { cents: number }[]): number {
  return months.length === 0 ? 0 : Math.round(months.reduce((a, m) => a + m.cents, 0) / months.length);
}

/**
 * An organization's streams in Build or the GM's Money tab: each with what it earns a month, opened
 * into its form; "Add a stream" starts one from a template. `views` are the engine's rows for them in
 * play (their preview as things stand, and whether the agents adjusted them); `taken`, ids a new
 * stream mustn't take besides the world's (the chat's, in GM); `save` and `remove` are the host's.
 */
export function RevenueEditor(props: { world: WorldDoc; earner: { id: EntityId; name: string }; streams: readonly RevenueStreamDraft[]; views?: readonly RevenueStreamView[]; taken?: ReadonlySet<string>; save(draft: RevenueStreamDraft, was: RevenueStreamDraft | null): void; remove?(id: string): void; saving?: boolean }) {
  const [draft, setDraft] = useState<RevenueStreamDraft | null>(null);
  const [was, setWas] = useState<RevenueStreamDraft | null>(null);
  const [template, setTemplate] = useState<RevenueTemplateId | null>(null);
  const currency = props.world.currency;
  if (draft) {
    const view = props.views?.find((v) => v.id === draft.id);
    const unchanged = was !== null && JSON.stringify(was) === JSON.stringify(draft);
    return (
      <StreamForm
        world={props.world}
        draft={draft}
        {...(view && unchanged ? { preview: view.preview } : {})}
        saving={props.saving}
        onChange={setDraft}
        onCancel={() => {
          setDraft(null);
          setWas(null);
        }}
        onSave={() => {
          props.save(draft, was);
          setDraft(null);
          setWas(null);
        }}
        {...(was && props.remove ? { onRemove: () => (props.remove?.(was.id), setDraft(null), setWas(null)) } : {})}
      />
    );
  }
  if (template) {
    const t = REVENUE_TEMPLATES[template];
    return (
      <Section title="Add a stream">
        <ChoiceField label="Start from" value={template} options={REVENUE_TEMPLATE_IDS.map((id) => ({ value: id, label: REVENUE_TEMPLATES[id].label, detail: REVENUE_TEMPLATES[id].hint }))} onChange={(v) => setTemplate(v as RevenueTemplateId)} />
        <p class="lre-field-help">{t.hint}</p>
        <div class="lre-form-actions">
          <Button
            variant="primary"
            onClick={() => {
              setDraft(streamFromTemplate(template, props.earner.id, new Set([...Object.keys(props.world.entities), ...props.streams.map((s) => s.id), ...(props.taken ?? [])])));
              setWas(null);
              setTemplate(null);
            }}
          >
            Start from {t.label.toLowerCase()}
          </Button>
          <Button variant="ghost" onClick={() => setTemplate(null)}>
            Cancel
          </Button>
        </div>
      </Section>
    );
  }
  return (
    <Section title="Revenue streams" aside={<Button variant="secondary" size="sm" icon="plus" onClick={() => setTemplate("walk_in")}>Add a stream</Button>}>
      {props.streams.length === 0 ? (
        <Empty icon="briefcase" title={`Nothing earns for ${props.earner.name} yet`}>
          A stream is income worked out each time it pays: walk-in customers, a product, a catalog, a royalty, fees or your own formula.
        </Empty>
      ) : (
        <List>
          {props.streams.map((s) => {
            const model = revenueOf(s.fields.revenue);
            const view = props.views?.find((v) => v.id === s.id);
            const month = view ? aMonth(view.preview.map((cents) => ({ cents }))) : aMonth(draftPreview(props.world, s));
            return (
              <ListRow
                key={s.id}
                title={s.name}
                subtitle={model ? TYPE_LABELS[model.type] : "Not a stream's model yet"}
                value={`${formatMoney(month, currency)} a month`}
                badge={view && view.adjustments.length > 0 ? <Badge tone="warn">Adjusted</Badge> : model?.ai === "bounded" ? <Badge tone="accent">Agents may adjust</Badge> : undefined}
                chevron
                onClick={() => {
                  setDraft(s);
                  setWas(s);
                }}
              />
            );
          })}
        </List>
      )}
    </Section>
  );
}

/**
 * A party's streams on its money pages (a business's page lists its own): each with this month so
 * far, last month and the next twelve as things stand, and the agents' adjustments in force.
 */
export function RevenueStreams(props: { streams: readonly RevenueStreamView[]; currency: WorldCurrency }) {
  if (props.streams.length === 0) return null;
  return (
    <Section title="Revenue streams">
      <List>
        {props.streams.map((s) => {
          const now = s.months[s.months.length - 1];
          const last = s.months[s.months.length - 2];
          const ahead = s.preview.reduce((a, c) => a + c, 0);
          return (
            <Disclosure
              key={s.id}
              summary={
                <ListRow
                  title={s.label}
                  subtitle={`${TYPE_LABELS[s.type]}${s.status !== "active" ? `, ${s.status}` : ""}${last ? ` · last month ${formatMoney(last.cents, props.currency)}` : ""}`}
                  value={now ? formatMoney(now.cents, props.currency) : formatMoney(0, props.currency)}
                  badge={s.adjustments.length > 0 ? <Badge tone="warn">Adjusted</Badge> : s.ai === "bounded" ? <Badge tone="neutral">Agents may adjust</Badge> : undefined}
                />
              }
            >
              <List>
                {s.adjustments.map((a) => (
                  <ListRow key={a.id} title={a.factor !== undefined ? `×${a.factor}` : formatMoney(a.cents ?? 0, props.currency)} subtitle={a.reason} icon="alert" />
                ))}
                <ListRow title="Next twelve months" value={formatMoney(ahead, props.currency)} />
                {s.months.slice(-12).map((m) => (
                  <ListRow key={m.month} title={monthLabel(m.month)} subtitle={s.type === "royalty" && m.units > 0 ? `${Math.round(m.units).toLocaleString()} ${s.unit ?? "units"} counted, ${formatMoney(m.net, props.currency)} after deductions and tax` : undefined} value={formatMoney(m.cents, props.currency)} />
                ))}
              </List>
            </Disclosure>
          );
        })}
      </List>
    </Section>
  );
}
