// Build → Packs → economy: the economy pack's own config fields, in the Build forms' idiom, above
// its config as JSON. The narrated-price cap (DESIGN §9.5) is the most a
// narrated price charges for something no catalog row prices, typed as the world's currency writes
// it and stored in whole minor units; left empty, the engine derives it from the tables. The region
// prices living and taxes for whoever names none; living costs are a week's spending per wealth
// band. The Custom toggles (DESIGN §25) switch a money feature on or off at the levels its floor
// allows, on a page of their own; products are the world's own account products and assets are
// what holdings hold (§27), each a row that opens as a sheet. Styles: styles/packs-money.ts.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../../shared/json";
import { hasOwn, isRecord } from "../../../shared/json";
import { ACCOUNT_CLASSES, ASSET_CLASSES, CLASS_TRAITS, FEATURE_DEFS, FINANCE_FEATURES, isAccountClass, OVERDRAFT_POLICIES, type FinanceFeature } from "../../../shared/finance";
import type { LintIssue } from "../../../shared/protocol";
import { formatMoneyInput } from "../../../shared/money";
import { formatMoney, type WorldCurrency, type WorldDoc } from "../../../shared/world";
import { Button, IconButton, IdText, Seg, type SegOption } from "../../../frontend/components";
import { FormGroup, FormSheet, Issues, ItemRow, RefPicker, type RefOption } from "../../../frontend/build/form-kit";
import type { FieldSpec } from "../../../frontend/build/schema";
import { ChoiceInput, DateInput, type FormCtx, lintAt, LintBadge, MinorMoneyInput, NewKey, SchemaFields } from "../../../frontend/build/schema-form";
import { humanize } from "../../../frontend/format";
import type { PackConfigProps } from "../../../frontend/registry";
import { derivedUnpricedCap, WEALTH_BANDS } from "../core/model";

/** A Custom toggle's state: as the level decides, or forced on or off. */
export type ToggleState = "level" | "on" | "off";

export function toggleOf(config: Readonly<JsonObject>, feature: FinanceFeature): ToggleState {
  const set = isRecord(config.features) ? config.features[feature] : undefined;
  return set === true ? "on" : set === false ? "off" : "level";
}

/** The config with one toggle set; "level" removes it, and an empty set of toggles goes too. */
export function withToggle(config: Readonly<JsonObject>, feature: FinanceFeature, state: ToggleState): JsonObject {
  const features: JsonObject = isRecord(config.features) ? { ...config.features } : {};
  if (state === "level") delete features[feature];
  else features[feature] = state === "on";
  const { features: _old, ...rest } = config;
  return Object.keys(features).length > 0 ? { ...rest, features } : { ...rest };
}

/** The regions a world can be in: the regions table's rows by name, the national baseline first. */
export function regionChoices(world: WorldDoc): RefOption[] {
  const rows = world.tables["economy.regions"]?.rows ?? {};
  const choices = Object.entries(rows).map(([id, row]) => ({ value: id, label: typeof row.name === "string" && row.name !== "" ? row.name : id, national: row.scope === "national" }));
  choices.sort((a, b) => Number(b.national) - Number(a.national) || a.label.localeCompare(b.label));
  return choices.map(({ value, label }) => ({ value, label }));
}

/** The config in `region`, or with none ("" removes it). */
export function withRegion(config: Readonly<JsonObject>, region: string): JsonObject {
  const { region: _old, ...rest } = config;
  return region === "" ? { ...rest } : { ...rest, region };
}

/** The config with a band's weekly living costs set, or removed; with no band left, `livingCosts` goes too. */
export function withLivingCost(config: Readonly<JsonObject>, band: string, cents: number | undefined): JsonObject {
  const costs: JsonObject = isRecord(config.livingCosts) ? { ...config.livingCosts } : {};
  if (cents === undefined) delete costs[band];
  else costs[band] = Math.round(cents);
  const { livingCosts: _old, ...rest } = config;
  return Object.keys(costs).length > 0 ? { ...rest, livingCosts: costs } : { ...rest };
}

const CONFIG = "packs.economy.config";
const isObject = (v: JsonValue | undefined): v is JsonObject => isRecord(v);

/** An object with one key set, or gone when `next` is undefined; a key it had keeps its place. */
function withKey(values: JsonObject, key: string, next: JsonValue | undefined): JsonObject {
  const out = { ...values };
  if (next === undefined) delete out[key];
  else out[key] = next;
  return out;
}

// Amounts are typed in the world's currency and stored in whole minor units.
const money = (key: string, label: string): FieldSpec => ({ kind: "money", key, label, min: 0, optional: true });
const pct = (key: string, label: string): FieldSpec => ({ kind: "number", key, label: `${label} (%)`, min: 0, optional: true });

/** A product's name, class and institution (`ProductDef`), above its credit limit. */
const PRODUCT_HEAD: FieldSpec[] = [
  { kind: "text", key: "label", label: "Name" },
  { kind: "enum", key: "class", label: "Class", values: ACCOUNT_CLASSES },
  { kind: "text", key: "institution", label: "Institution", optional: true },
];

/** The rest of a product's parameters, under its credit limit: what isn't set comes from its class's defaults in the finance tables. */
const PRODUCT_TAIL: FieldSpec[] = [
  pct("apr_pct", "APR"),
  pct("apy_pct", "APY"),
  { kind: "enum", key: "interest", label: "Interest method", values: ["monthly_simple", "average_daily"], optional: true },
  pct("penalty_apr_pct", "Penalty APR, from 60 days late"),
  pct("cash_advance_apr_pct", "Cash advance APR"),
  { kind: "number", key: "statement_day", label: "Statement day", min: 1, max: 28, step: 1, optional: true },
  { kind: "number", key: "due_days", label: "Days from statement to due date", min: 0, step: 1, optional: true },
  { kind: "object", key: "minimum", label: "Minimum payment", optional: true, fields: [pct("pct", "Of the statement balance"), money("floor", "At least"), { kind: "bool", key: "plus_interest", label: "Plus the cycle's interest and fees" }] },
  {
    kind: "object",
    key: "fees",
    label: "Fees",
    optional: true,
    fields: [money("annual", "Annual"), money("late_first", "Late, first"), money("late_repeat", "Late, again within six cycles"), money("overdraft", "Overdraft item"), money("nsf", "Returned item"), money("atm", "Other banks' machines"), pct("cash_advance_pct", "Cash advance"), money("cash_advance_min", "Cash advance at least"), money("maintenance", "Monthly maintenance"), money("maintenance_waive", "Maintenance waived from a balance of"), money("card_replacement", "Card replacement")],
  },
  pct("rewards_pct", "Rewards on purchases"),
  money("daily_purchase_limit", "Daily card purchases"),
  money("daily_atm_limit", "Daily cash machine withdrawals"),
  { kind: "number", key: "hold_days", label: "Days a machine deposit stays on hold", min: 0, step: 1, optional: true },
  { kind: "enum", key: "overdraft", label: "Overdraft policy", values: OVERDRAFT_POLICIES, optional: true },
  money("overdraft_limit", "How far a fee overdraft may go"),
  { kind: "number", key: "term_months", label: "Term (months)", min: 0, step: 1, optional: true },
  { kind: "bool", key: "secured", label: "Secured by an asset (a mortgage, a car loan)" },
];

/** An asset's class, price and price path (`AssetDef`), and a bond's face and coupon, above its maturity date. */
const ASSET_HEAD: FieldSpec[] = [
  { kind: "text", key: "label", label: "Name" },
  { kind: "enum", key: "class", label: "Class", values: ASSET_CLASSES },
  { kind: "text", key: "symbol", label: "Symbol", optional: true },
  money("price", "Price per unit at the start"),
  { kind: "text", key: "model", label: "Price path", optional: true, hint: "A finance table recipe; empty: the class's" },
  { kind: "number", key: "annual_return_pct", label: "Return a year (%)", optional: true },
  pct("annual_volatility_pct", "Volatility a year"),
  pct("yield_pct", "Pays out a year, of its value"),
  { kind: "number", key: "pays_per_year", label: "Payouts a year", min: 0, step: 1, optional: true },
  { kind: "number", key: "correlation", label: "Follows its class's market (0–1)", min: 0, max: 1, step: 0.05, optional: true },
  money("face", "Bond: face value"),
  pct("coupon_pct", "Bond: coupon"),
];

/** An option's underlying and strike, between the bond's maturity and the option's expiry. */
const ASSET_OPTION: FieldSpec[] = [{ kind: "text", key: "underlying", label: "Option: underlying asset id", optional: true }, money("strike", "Option: strike")];

/** The rest of an option, and what the asset stands for. */
const ASSET_TAIL: FieldSpec[] = [
  { kind: "enum", key: "right", label: "Option: right", values: ["call", "put"], optional: true },
  { kind: "number", key: "multiplier", label: "Units per contract", min: 1, step: 1, optional: true },
  { kind: "enum", key: "settlement", label: "Option: settled", values: ["physical", "cash"], optional: true },
  { kind: "ref", key: "entity", label: "Stands for (a business or a property)", collection: "entities", optional: true },
];

/** The narrated-price cap and the region: what prices, rents and taxes follow. */
function Prices(props: PackConfigProps) {
  const currency = props.world.currency;
  const derived = derivedUnpricedCap(props.world);
  const { unpricedCap, ...rest } = props.config;
  const region = typeof props.config.region === "string" ? props.config.region : "";
  const choices = regionChoices(props.world);
  // A region the table doesn't have stays shown as it is, so opening the form doesn't change it.
  const options = region === "" || choices.some((c) => c.value === region) ? choices : [{ value: region, label: `${region} (not in the regions table)` }, ...choices];
  return (
    <FormGroup title="Prices and region">
      <MinorMoneyInput
        label="Narrated-price cap"
        value={unpricedCap}
        currency={currency}
        min={1}
        optional
        placeholder={formatMoneyInput(derived, currency)}
        hint={`Empty uses ${formatMoney(derived, currency)}, the highest price band in the catalog and categories. A price the player states is never capped.`}
        issues={lintAt(props.lint, `${CONFIG}.unpricedCap`)}
        onChange={(value) => props.onChange(value === undefined ? rest : { ...rest, unpricedCap: value })}
      />
      <div class="lre-field">
        <RefPicker label="Region" value={region} none="Not set: the national averages" options={options} onChange={(v) => props.onChange(withRegion(props.config, v))} />
        <span class="lre-field-help">Prices, rents and taxes follow its cost of living and rates for anyone who doesn't name a region of their own.</span>
        <Issues issues={lintAt(props.lint, `${CONFIG}.region`)} />
      </div>
    </FormGroup>
  );
}

/**
 * A week of living costs per wealth band. The engine takes the world's amounts for every band once
 * any band has one (a band left empty then spends nothing), else prices each band's week from the
 * catalog's grocery baskets.
 */
function LivingCosts(props: PackConfigProps) {
  const currency = props.world.currency;
  const costs = isRecord(props.config.livingCosts) ? props.config.livingCosts : {};
  const own = Object.keys(costs).length > 0;
  return (
    <FormGroup title="Living costs">
      <span class="lre-field-help">{own ? "What someone in each wealth band spends a week. A band left empty spends nothing." : "Each band's week is priced from the catalog's grocery baskets. Set any band and these amounts replace that for every band."}</span>
      <div class="lre-money-build-bands">
        {WEALTH_BANDS.map((b) => (
          <MinorMoneyInput key={b.label} label={`${humanize(b.label)}, a week`} value={costs[b.label]} currency={currency} min={0} optional issues={lintAt(props.lint, `${CONFIG}.livingCosts.${b.label}`)} onChange={(v) => props.onChange(withLivingCost(props.config, b.label, typeof v === "number" ? v : undefined))} />
        ))}
      </div>
      <Issues issues={props.lint.filter((issue) => issue.path === `${CONFIG}.livingCosts`)} />
    </FormGroup>
  );
}

const TOGGLE_CHOICES: readonly SegOption<ToggleState>[] = [
  { value: "level", label: "By level" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const FEATURES_NOTE = "Each runs from its usual Money level; switch one on to run it from its lowest level, or off. The dashboards show the full books for what runs.";

/** The Custom toggles: a row naming the ones switched, which opens them all on a page of their own. */
function FeatureToggles(props: PackConfigProps) {
  const [open, setOpen] = useState(false);
  const lint = lintAt(props.lint, `${CONFIG}.features`);
  const on: string[] = [];
  const off: string[] = [];
  for (const f of FINANCE_FEATURES) {
    const state = toggleOf(props.config, f);
    if (state === "on") on.push(FEATURE_DEFS[f].label);
    else if (state === "off") off.push(FEATURE_DEFS[f].label);
  }
  const summary = on.length === 0 && off.length === 0 ? "Each as its Money level decides" : [on.length > 0 ? `On: ${on.join(", ")}` : null, off.length > 0 ? `Off: ${off.join(", ")}` : null].filter((s) => s !== null).join(" · ");
  return (
    <FormGroup title="Money features (Custom)">
      <span class="lre-field-help">{FEATURES_NOTE}</span>
      <div class="lre-form-items">
        <ItemRow title="Feature switches" subtitle={summary} badge={<LintBadge issues={lint} />} onOpen={() => setOpen(true)} openLabel="Edit the money feature switches" />
      </div>
      {open ? (
        <FormSheet title="Money features" subtitle="Custom switches" backLabel="Economy" onClose={() => setOpen(false)}>
          <span class="lre-field-help">{FEATURES_NOTE}</span>
          <div class="lre-form-items" data-lre-money-features>
            {FINANCE_FEATURES.map((f) => {
              const def = FEATURE_DEFS[f];
              return (
                <div key={f} class="lre-money-build-feature" data-lre-feature={f}>
                  <span class="lre-money-build-feature-text">
                    <span class="lre-money-build-feature-name">{def.label}</span>
                    <span class="lre-money-build-feature-sub">
                      Usually from Money {def.on} · can run from Money {def.floor}
                    </span>
                  </span>
                  <Seg<ToggleState> label={def.label} value={toggleOf(props.config, f)} options={TOGGLE_CHOICES} onChange={(state) => props.onChange(withToggle(props.config, f, state))} />
                </div>
              );
            })}
          </div>
          <Issues issues={lint} />
          <div class="lre-form-sheet-actions lre-money-build-done">
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </FormSheet>
      ) : null}
    </FormGroup>
  );
}

type LimitMode = "class" | "none" | "amount";

const LIMIT_MODES: readonly RefOption[] = [
  { value: "class", label: "By class" },
  { value: "none", label: "No limit" },
  { value: "amount", label: "An amount" },
];

/**
 * A product's credit limit (`ProductDef.limit`): its class's default when left out, none preset
 * when null (as a charge card has), else an amount in the world's currency. Picking an amount shows
 * the amount to type; the limit changes once one is typed.
 */
function CreditLimit(props: { value: JsonValue | undefined; currency: WorldCurrency; issues: readonly LintIssue[]; onChange(next: JsonValue | undefined): void }) {
  const [typing, setTyping] = useState(false);
  const mode: LimitMode = typing || (props.value !== undefined && props.value !== null) ? "amount" : props.value === null ? "none" : "class";
  const odd = props.value !== undefined && props.value !== null && typeof props.value !== "number" ? `Holds ${JSON.stringify(props.value)}, which isn't an amount.` : null;
  return (
    <>
      <ChoiceInput
        label="Credit limit"
        value={mode}
        options={LIMIT_MODES}
        hint="By class: the class's default from the finance tables. No limit: none preset, as on a charge card."
        issues={props.issues}
        onChange={(next) => {
          setTyping(next === "amount");
          if (next === "class") props.onChange(undefined);
          else if (next === "none") props.onChange(null);
        }}
      />
      {mode === "amount" ? (
        <MinorMoneyInput
          label="Limit"
          value={props.value}
          currency={props.currency}
          min={0}
          hint={odd ?? (typeof props.value === "number" ? undefined : "Until an amount is typed, the limit stays as it was.")}
          issues={[]}
          onChange={(next) => {
            if (typeof next === "number") props.onChange(next);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The world's own products or assets (id → definition), as Build lists a record: a row per entry
 * (its name, a summary, its id under Show ids, its lint) that opens it as a sheet. A new one asks
 * for its name and derives its id from it; the record stays, empty, when its last entry goes.
 */
function Definitions(props: {
  config: JsonObject;
  world: WorldDoc;
  lint: readonly LintIssue[];
  field: "products" | "assets";
  label: string;
  hint: string;
  noun: string;
  summary(def: JsonObject): string;
  sheet(def: JsonObject, set: (next: JsonObject) => void, ctx: FormCtx): ComponentChildren;
  onChange(next: JsonObject): void;
}) {
  const stored = props.config[props.field];
  const record: JsonObject = isObject(stored) ? stored : {};
  const keys = Object.keys(record);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const path = `${CONFIG}.${props.field}`;
  const titleOf = (key: string): string => {
    const def = record[key];
    return isObject(def) && typeof def.label === "string" && def.label !== "" ? def.label : key;
  };
  const put = (next: JsonObject) => props.onChange(withKey(props.config, props.field, next));
  const remove = (key: string) => {
    const next = { ...record };
    delete next[key];
    setOpen(null);
    put(next);
  };
  const entry = open !== null && hasOwn(record, open) ? record[open] : undefined;
  return (
    <div class="lre-field lre-form-list" data-lre-record={props.field}>
      <div class="lre-form-list-head">
        <span class="label">{props.label}</span>
        <span class="lre-badge">{keys.length}</span>
      </div>
      <span class="lre-field-help">{props.hint}</span>
      <div class="lre-form-items">
        {keys.length === 0 ? <span class="lre-form-items-none">None yet.</span> : null}
        {keys.map((key) => {
          const def = record[key];
          return (
            <ItemRow
              key={key}
              title={titleOf(key)}
              subtitle={
                <>
                  {props.summary(isObject(def) ? def : {})}
                  {titleOf(key) !== key ? <IdText id={key} /> : null}
                </>
              }
              badge={<LintBadge issues={lintAt(props.lint, `${path}.${key}`)} />}
              onOpen={() => setOpen(key)}
              openLabel={`Edit ${titleOf(key)}`}
              actions={<IconButton icon="trash" label={`Remove ${titleOf(key)}`} onClick={() => remove(key)} />}
            />
          );
        })}
      </div>
      <Issues issues={props.lint.filter((issue) => issue.path === path)} />
      {adding ? (
        <NewKey
          named
          keyLabel="Id"
          noun={props.noun}
          taken={new Set(keys)}
          suggestions={[]}
          onAdd={(key, label) => {
            put({ ...record, [key]: label !== undefined ? { label } : {} });
            setAdding(false);
            setOpen(key);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <div class="lre-form-list-add">
          <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
            Add {props.noun}
          </Button>
        </div>
      )}
      {open !== null && entry !== undefined ? (
        <FormSheet title={titleOf(open)} subtitle={titleOf(open) !== open ? <IdText id={open} /> : undefined} backLabel={props.label} onClose={() => setOpen(null)}>
          {props.sheet(isObject(entry) ? entry : {}, (next) => put({ ...record, [open]: next }), { doc: props.world, lint: props.lint, path: `${path}.${open}`, identifiers: [], functions: [] })}
          <Issues issues={props.lint.filter((issue) => issue.path === `${path}.${open}`)} />
          <div class="lre-form-sheet-actions">
            <Button variant="danger" icon="trash" onClick={() => remove(open)}>
              Remove {props.noun}
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

export function EconomyConfig(props: PackConfigProps) {
  const currency = props.world.currency;
  const calendar = props.world.calendar;
  return (
    <div class="lre-form-fields" data-lre-money-config>
      <Prices {...props} />
      <LivingCosts {...props} />
      <FeatureToggles {...props} />
      <Definitions
        config={props.config}
        world={props.world}
        lint={props.lint}
        field="products"
        label="Products"
        hint="The world's own kinds of account, which accounts name as their product. What a product leaves empty comes from its class's defaults in the finance tables."
        noun="product"
        summary={(def) => [isAccountClass(def.class) ? CLASS_TRAITS[def.class].label : typeof def.class === "string" ? `${def.class} (no such class)` : "No class", typeof def.institution === "string" ? def.institution : ""].filter((s) => s !== "").join(" · ")}
        sheet={(def, set, ctx) => (
          <>
            <SchemaFields specs={PRODUCT_HEAD} value={def} ctx={ctx} onChange={set} />
            <CreditLimit value={def.limit} currency={currency} issues={lintAt(props.lint, `${ctx.path}.limit`)} onChange={(limit) => set(withKey(def, "limit", limit))} />
            <SchemaFields specs={PRODUCT_TAIL} value={def} ctx={ctx} onChange={set} />
          </>
        )}
        onChange={props.onChange}
      />
      <Definitions
        config={props.config}
        world={props.world}
        lint={props.lint}
        field="assets"
        label="Assets"
        hint="What holdings hold: securities, funds, bonds, options and stakes, each with its price path."
        noun="asset"
        summary={(def) => [typeof def.class === "string" ? humanize(def.class) : "No class", typeof def.symbol === "string" ? def.symbol : "", typeof def.price === "number" ? formatMoney(def.price, currency) : ""].filter((s) => s !== "").join(" · ")}
        sheet={(def, set, ctx) => (
          <>
            <SchemaFields specs={ASSET_HEAD} value={def} ctx={ctx} onChange={set} />
            <DateInput label="Bond: matures" value={def.maturity} calendar={calendar} issues={lintAt(props.lint, `${ctx.path}.maturity`)} onChange={(next) => set(withKey(def, "maturity", next))} />
            <SchemaFields specs={ASSET_OPTION} value={def} ctx={ctx} onChange={set} />
            <DateInput label="Option: expires" value={def.expiry} calendar={calendar} issues={lintAt(props.lint, `${ctx.path}.expiry`)} onChange={(next) => set(withKey(def, "expiry", next))} />
            <SchemaFields specs={ASSET_TAIL} value={def} ctx={ctx} onChange={set} />
          </>
        )}
        onChange={props.onChange}
      />
    </div>
  );
}
