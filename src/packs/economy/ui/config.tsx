// Build → Packs → economy: the economy pack's own config fields, above its config as JSON. The
// narrated-price cap (DESIGN §9.5) is the most a narrated price charges for something no catalog
// row prices, in the world's minor units; left empty, the engine derives it from the tables. The
// Custom toggles (DESIGN §25) switch a money feature on or off at the levels its floor allows;
// products are the world's own account products; assets are what holdings hold (§27).

import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import { ACCOUNT_CLASSES, ASSET_CLASSES, FEATURE_DEFS, FINANCE_FEATURES, OVERDRAFT_POLICIES, type FinanceFeature } from "../../../shared/finance";
import { formatMoneyInput, minorUnitPlural } from "../../../shared/money";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Card, Row } from "../../../frontend/components";
import type { FieldSpec } from "../../../frontend/build/schema";
import { lintAt, MinorMoneyInput, SchemaFields } from "../../../frontend/build/schema-form";
import type { PackConfigProps } from "../../../frontend/registry";
import { derivedUnpricedCap } from "../core/model";

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

const money = (key: string, label: string, unit: string): FieldSpec => ({ kind: "number", key, label: `${label} (${unit})`, min: 0, step: 1, optional: true });
const pct = (key: string, label: string): FieldSpec => ({ kind: "number", key, label: `${label} (%)`, min: 0, optional: true });

/** A product's parameters as Build edits them (`ProductDef`): what isn't set comes from its class's defaults in the finance tables. */
export function productSpecs(currency: WorldCurrency): FieldSpec[] {
  const unit = minorUnitPlural(currency);
  return [
    { kind: "text", key: "label", label: "Name" },
    { kind: "enum", key: "class", label: "Class", values: ACCOUNT_CLASSES },
    { kind: "text", key: "institution", label: "Institution", optional: true },
    { kind: "json", key: "limit", label: `Credit limit (${unit}; null: no preset limit, as a charge card)`, optional: true },
    pct("apr_pct", "APR"),
    pct("apy_pct", "APY"),
    { kind: "enum", key: "interest", label: "Interest method", values: ["monthly_simple", "average_daily"], optional: true },
    pct("penalty_apr_pct", "Penalty APR, from 60 days late"),
    pct("cash_advance_apr_pct", "Cash advance APR"),
    { kind: "number", key: "statement_day", label: "Statement day", min: 1, max: 28, step: 1, optional: true },
    { kind: "number", key: "due_days", label: "Days from statement to due date", min: 0, step: 1, optional: true },
    { kind: "object", key: "minimum", label: "Minimum payment", optional: true, fields: [pct("pct", "Of the statement balance"), money("floor", "At least", unit), { kind: "bool", key: "plus_interest", label: "Plus the cycle's interest and fees" }] },
    {
      kind: "object",
      key: "fees",
      label: "Fees",
      optional: true,
      fields: [money("annual", "Annual", unit), money("late_first", "Late, first", unit), money("late_repeat", "Late, again within six cycles", unit), money("overdraft", "Overdraft item", unit), money("nsf", "Returned item", unit), money("atm", "Other banks' machines", unit), pct("cash_advance_pct", "Cash advance"), money("cash_advance_min", "Cash advance at least", unit), money("maintenance", "Monthly maintenance", unit), money("maintenance_waive", "Maintenance waived from a balance of", unit), money("card_replacement", "Card replacement", unit)],
    },
    pct("rewards_pct", "Rewards on purchases"),
    money("daily_purchase_limit", "Daily card purchases", unit),
    money("daily_atm_limit", "Daily cash machine withdrawals", unit),
    { kind: "number", key: "hold_days", label: "Days a machine deposit stays on hold", min: 0, step: 1, optional: true },
    { kind: "enum", key: "overdraft", label: "Overdraft policy", values: OVERDRAFT_POLICIES, optional: true },
    money("overdraft_limit", "How far a fee overdraft may go", unit),
    { kind: "number", key: "term_months", label: "Term (months)", min: 0, step: 1, optional: true },
    { kind: "bool", key: "secured", label: "Secured by an asset (a mortgage, a car loan)" },
  ];
}

/** An asset's parameters (`AssetDef`): its class, price and price path; a bond's face, coupon and maturity; an option's underlying, strike and expiry. */
export function assetSpecs(currency: WorldCurrency): FieldSpec[] {
  const unit = minorUnitPlural(currency);
  return [
    { kind: "text", key: "label", label: "Name" },
    { kind: "enum", key: "class", label: "Class", values: ASSET_CLASSES },
    { kind: "text", key: "symbol", label: "Symbol", optional: true },
    money("price", "Price per unit at the start", unit),
    { kind: "text", key: "model", label: "Price path (a finance table recipe; empty: the class's)", optional: true },
    { kind: "number", key: "annual_return_pct", label: "Return a year (%)", optional: true },
    pct("annual_volatility_pct", "Volatility a year"),
    pct("yield_pct", "Pays out a year, of its value"),
    { kind: "number", key: "pays_per_year", label: "Payouts a year", min: 0, step: 1, optional: true },
    { kind: "number", key: "correlation", label: "Follows its class's market (0–1)", min: 0, max: 1, step: 0.05, optional: true },
    money("face", "Bond: face value", unit),
    pct("coupon_pct", "Bond: coupon"),
    { kind: "text", key: "maturity", label: "Bond: matures (YYYY-MM-DD)", optional: true },
    { kind: "text", key: "underlying", label: "Option: underlying asset id", optional: true },
    money("strike", "Option: strike", unit),
    { kind: "text", key: "expiry", label: "Option: expires (YYYY-MM-DD)", optional: true },
    { kind: "enum", key: "right", label: "Option: right", values: ["call", "put"], optional: true },
    { kind: "number", key: "multiplier", label: "Units per contract", min: 1, step: 1, optional: true },
    { kind: "enum", key: "settlement", label: "Option: settled", values: ["physical", "cash"], optional: true },
    { kind: "ref", key: "entity", label: "Stands for (a business or a property)", collection: "entities", optional: true },
  ];
}

function FeatureToggles(props: PackConfigProps) {
  return (
    <Card title="Money features (Custom)">
      <span class="lre-small lre-muted">Each runs from its usual Money level; switch one on to run it from its lowest level, or off. The dashboards show the full books for what runs.</span>
      {FINANCE_FEATURES.map((f) => {
        const def = FEATURE_DEFS[f];
        return (
          <Row
            key={f}
            k={def.label}
            sub={`usually from Money ${def.on}; can run from ${def.floor}`}
            v={
              <select class="lre-input" style={{ width: "auto" }} aria-label={def.label} value={toggleOf(props.config, f)} onChange={(event) => props.onChange(withToggle(props.config, f, event.currentTarget.value === "on" ? "on" : event.currentTarget.value === "off" ? "off" : "level"))}>
                <option value="level">By level</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            }
          />
        );
      })}
    </Card>
  );
}

export function EconomyConfig(props: PackConfigProps) {
  const currency = props.world.currency;
  const derived = derivedUnpricedCap(props.world);
  const { unpricedCap, ...rest } = props.config;
  const ctx = { doc: props.world, lint: props.lint, path: "packs.economy.config", identifiers: [], functions: [] };
  const specs: FieldSpec[] = [
    { kind: "record", key: "products", label: "Products: the world's own accounts, by id", keyLabel: "Product id", item: { kind: "object", key: "", label: "Product", fields: productSpecs(currency) } },
    { kind: "record", key: "assets", label: "Assets: what holdings hold, by id", keyLabel: "Asset id", item: { kind: "object", key: "", label: "Asset", fields: assetSpecs(currency) } },
  ];
  return (
    <>
      <Card title="Narrated prices">
        <MinorMoneyInput
          label="Narrated-price cap"
          value={unpricedCap}
          currency={currency}
          min={1}
          optional
          placeholder={formatMoneyInput(derived, currency, "minor")}
          hint={`Empty uses ${formatMoney(derived, currency)}, the highest price band in the catalog and categories. A price the player states is never capped.`}
          issues={lintAt(props.lint, "packs.economy.config.unpricedCap")}
          onChange={(value) => props.onChange(value === undefined ? rest : { ...rest, unpricedCap: value })}
        />
      </Card>
      <FeatureToggles {...props} />
      <Card title="Products and assets">
        <SchemaFields specs={specs} value={props.config} ctx={ctx} onChange={(next: JsonObject) => props.onChange(next)} />
      </Card>
    </>
  );
}
