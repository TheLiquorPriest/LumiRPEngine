// Payment preferences (DESIGN §25): the ordered tiers a person pays by, each a way of paying (or a
// card or an account) for amounts and categories that fit. One editor for Build's person form, the
// player's Money → Accounts and the GM view; an amount is typed in the world's currency.

import { useState } from "preact/hooks";
import type { PayTier } from "../../../shared/finance";
import { formatMoneyInput, parseMoneyInput, type MoneyUnit } from "../../../shared/money";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { humanize } from "../../../frontend/format";
import { MoneyInput } from "../../../frontend/money-input";
import type { Choice } from "./forms";

/** The ways of paying a tier can name besides a specific card or account. */
export const PAY_METHODS: readonly Choice[] = [
  { value: "cash", label: "Cash" },
  { value: "debit", label: "Debit card" },
  { value: "credit", label: "Credit card" },
  { value: "charge", label: "Charge card" },
  { value: "checking", label: "From checking" },
  { value: "savings", label: "From savings" },
];

/** A tier in words: how it pays, for which amounts and categories. */
export function tierText(tier: PayTier, uses: readonly Choice[], currency: WorldCurrency): string {
  const how = [...PAY_METHODS, ...uses].find((u) => u.value === tier.use)?.label ?? tier.use;
  const parts = [how];
  if (tier.min !== undefined) parts.push(`from ${formatMoney(tier.min, currency)}`);
  if (tier.max !== undefined) parts.push(`up to ${formatMoney(tier.max, currency)}`);
  if (tier.categories && tier.categories.length > 0) parts.push(`for ${tier.categories.map(humanize).join(", ")}`);
  if (tier.except && tier.except.length > 0) parts.push(`not ${tier.except.map(humanize).join(", ")}`);
  return parts.join(" · ");
}

/** Comma-separated words as a list, blanks dropped. */
function listOf(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function TierRow(props: { tier: PayTier; index: number; count: number; uses: readonly Choice[]; categories: readonly string[]; currency: WorldCurrency; unit: MoneyUnit; onChange(next: PayTier | null, move?: -1 | 1): void }) {
  const { tier } = props;
  const [min, setMin] = useState(tier.min === undefined ? "" : formatMoneyInput(tier.min, props.currency, props.unit));
  const [max, setMax] = useState(tier.max === undefined ? "" : formatMoneyInput(tier.max, props.currency, props.unit));
  const options = [...PAY_METHODS, ...props.uses];
  const amount = (text: string): number | undefined | null => (text.trim() === "" ? undefined : parseMoneyInput(text, props.currency, props.unit));
  const listId = `lre-pay-categories-${props.index}`;
  return (
    <div class="lre-card lre-stack" data-lre-pay-tier={props.index}>
      <div class="lre-spread">
        <span class="lre-small lre-muted">Tier {props.index + 1}</span>
        <span class="lre-inline">
          <button type="button" class="lre-btn small ghost" aria-label={`Move tier ${props.index + 1} up`} disabled={props.index === 0} onClick={() => props.onChange(tier, -1)}>
            ↑
          </button>
          <button type="button" class="lre-btn small ghost" aria-label={`Move tier ${props.index + 1} down`} disabled={props.index === props.count - 1} onClick={() => props.onChange(tier, 1)}>
            ↓
          </button>
          <button type="button" class="lre-btn small danger" aria-label={`Remove tier ${props.index + 1}`} onClick={() => props.onChange(null)}>
            ✕
          </button>
        </span>
      </div>
      <label class="lre-field">
        <span class="label">Pay with</span>
        <select class="lre-input" value={tier.use} onChange={(event) => props.onChange({ ...tier, use: event.currentTarget.value })}>
          {options.some((o) => o.value === tier.use) ? null : <option value={tier.use}>{tier.use}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <div class="lre-inline">
        <div class="lre-field" style={{ flex: 1 }}>
          <span class="label">From (amount)</span>
          <MoneyInput
            currency={props.currency}
            unit={props.unit}
            label={`Tier ${props.index + 1} from`}
            value={min}
            invalid={amount(min) === null}
            onInput={(text) => {
              setMin(text);
              const n = amount(text);
              if (n !== null) props.onChange({ ...tier, min: n });
            }}
          />
        </div>
        <div class="lre-field" style={{ flex: 1 }}>
          <span class="label">Up to (amount)</span>
          <MoneyInput
            currency={props.currency}
            unit={props.unit}
            label={`Tier ${props.index + 1} up to`}
            value={max}
            invalid={amount(max) === null}
            onInput={(text) => {
              setMax(text);
              const n = amount(text);
              if (n !== null) props.onChange({ ...tier, max: n });
            }}
          />
        </div>
      </div>
      <label class="lre-field">
        <span class="label">Only for (categories, comma separated; empty: anything)</span>
        <input class="lre-input" list={listId} value={(tier.categories ?? []).join(", ")} onChange={(event) => props.onChange({ ...tier, categories: listOf(event.currentTarget.value) })} />
      </label>
      <label class="lre-field">
        <span class="label">Never for (categories)</span>
        <input class="lre-input" list={listId} value={(tier.except ?? []).join(", ")} onChange={(event) => props.onChange({ ...tier, except: listOf(event.currentTarget.value) })} />
      </label>
      <datalist id={listId}>
        {props.categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

/** Tiers in order, as a whole: the first that fits and covers the amount pays. Build types amounts as whole minor units (`unit`), play as the currency writes them. */
export function PayTiersEditor(props: { value: readonly PayTier[]; uses: readonly Choice[]; categories: readonly string[]; currency: WorldCurrency; unit?: MoneyUnit; onChange(next: PayTier[]): void }) {
  const tiers = props.value;
  const change = (index: number, next: PayTier | null, move?: -1 | 1) => {
    const out = [...tiers];
    if (next === null) out.splice(index, 1);
    else if (move !== undefined) {
      const to = index + move;
      if (to < 0 || to >= out.length) return;
      out.splice(index, 1);
      out.splice(to, 0, next);
    } else out[index] = next;
    props.onChange(out.map((t) => ({ use: t.use, ...(t.min !== undefined ? { min: t.min } : {}), ...(t.max !== undefined ? { max: t.max } : {}), ...(t.categories && t.categories.length > 0 ? { categories: t.categories } : {}), ...(t.except && t.except.length > 0 ? { except: t.except } : {}) })));
  };
  return (
    <div class="lre-stack" data-lre-pay-prefs>
      {tiers.length === 0 ? <span class="lre-small lre-muted">No tiers: the engine's defaults for their wealth and character pay.</span> : null}
      {tiers.map((tier, i) => (
        // Keyed by place and way of paying, so a moved tier's typed amounts move with it.
        <TierRow key={`${i}:${tier.use}`} tier={tier} index={i} count={tiers.length} uses={props.uses} categories={props.categories} currency={props.currency} unit={props.unit ?? "major"} onChange={(next, move) => change(i, next, move)} />
      ))}
      <button type="button" class="lre-btn small" onClick={() => props.onChange([...tiers, { use: "debit" }])}>
        + Add a tier
      </button>
      <span class="lre-small lre-muted">When no tier fits or covers the amount, any account they may spend from that covers it pays.</span>
    </div>
  );
}
