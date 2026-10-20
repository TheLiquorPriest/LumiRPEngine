// Payment preferences (DESIGN §25): the ordered tiers a person pays by, each a way of paying (or a
// card or an account) for amounts and categories that fit. The player's How you pay and the GM's
// How they pay edit them on their own page; an amount is typed in the world's currency.

import { useId, useState } from "preact/hooks";
import type { PayTier } from "../../../shared/finance";
import { formatMoneyInput, parseMoneyInput } from "../../../shared/money";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Button, Field, IconButton } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { AmountField, type Choice } from "./forms";

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

function TierRow(props: { tier: PayTier; index: number; count: number; uses: readonly Choice[]; listId: string; currency: WorldCurrency; onChange(next: PayTier | null, move?: -1 | 1): void }) {
  const { tier, index } = props;
  const id = useId();
  const [min, setMin] = useState(tier.min === undefined ? "" : formatMoneyInput(tier.min, props.currency));
  const [max, setMax] = useState(tier.max === undefined ? "" : formatMoneyInput(tier.max, props.currency));
  const options = [...PAY_METHODS, ...props.uses];
  const amount = (text: string): number | undefined | null => (text.trim() === "" ? undefined : parseMoneyInput(text, props.currency));
  const n = index + 1;
  return (
    <div class="lre-money-tier" role="group" aria-label={`Tier ${n}`} data-lre-pay-tier={index}>
      <div class="lre-money-tier-head">
        <span class="lre-money-tier-title">Tier {n}</span>
        <IconButton icon="chevron-up" label={`Move tier ${n} up`} disabled={index === 0} onClick={() => props.onChange(tier, -1)} />
        <IconButton icon="chevron-down" label={`Move tier ${n} down`} disabled={index === props.count - 1} onClick={() => props.onChange(tier, 1)} />
        <IconButton icon="trash" label={`Remove tier ${n}`} onClick={() => props.onChange(null)} />
      </div>
      <Field label="Pay with" for={`${id}-use`}>
        <select id={`${id}-use`} class="lre-input" value={tier.use} onChange={(event) => props.onChange({ ...tier, use: event.currentTarget.value })}>
          {options.some((o) => o.value === tier.use) ? null : <option value={tier.use}>{tier.use}</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <div class="lre-money-tier-range">
        <AmountField
          label="From (amount)"
          value={min}
          currency={props.currency}
          invalid={amount(min) === null}
          onInput={(text) => {
            setMin(text);
            const cents = amount(text);
            if (cents !== null) props.onChange({ ...tier, min: cents });
          }}
        />
        <AmountField
          label="Up to (amount)"
          value={max}
          currency={props.currency}
          invalid={amount(max) === null}
          onInput={(text) => {
            setMax(text);
            const cents = amount(text);
            if (cents !== null) props.onChange({ ...tier, max: cents });
          }}
        />
      </div>
      <Field label="Only for" help="Categories, comma separated; empty: anything." for={`${id}-only`}>
        <input id={`${id}-only`} class="lre-input" list={props.listId} value={(tier.categories ?? []).join(", ")} onChange={(event) => props.onChange({ ...tier, categories: listOf(event.currentTarget.value) })} />
      </Field>
      <Field label="Never for" help="Categories, comma separated." for={`${id}-never`}>
        <input id={`${id}-never`} class="lre-input" list={props.listId} value={(tier.except ?? []).join(", ")} onChange={(event) => props.onChange({ ...tier, except: listOf(event.currentTarget.value) })} />
      </Field>
    </div>
  );
}

/** Tiers in order, as a whole: the first that fits and covers the amount pays. */
export function PayTiersEditor(props: { value: readonly PayTier[]; uses: readonly Choice[]; categories: readonly string[]; currency: WorldCurrency; onChange(next: PayTier[]): void }) {
  const tiers = props.value;
  const listId = useId();
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
    <div class="lre-money-tiers" data-lre-pay-prefs>
      {tiers.length === 0 ? <p class="lre-money-note">No tiers: the engine's defaults for their wealth and character pay.</p> : null}
      {tiers.map((tier, i) => (
        // Keyed by place and way of paying, so a moved tier's typed amounts move with it.
        <TierRow key={`${i}:${tier.use}`} tier={tier} index={i} count={tiers.length} uses={props.uses} listId={listId} currency={props.currency} onChange={(next, move) => change(i, next, move)} />
      ))}
      <datalist id={listId}>
        {props.categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Button icon="plus" onClick={() => props.onChange([...tiers, { use: "debit" }])}>
        Add a tier
      </Button>
      <p class="lre-money-note">When no tier fits or covers the amount, any account they may spend from that covers it pays.</p>
    </div>
  );
}
