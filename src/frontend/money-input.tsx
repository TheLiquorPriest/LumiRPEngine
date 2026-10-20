// The one money input (DESIGN §12): an amount typed in the world's currency, with the currency's
// symbol or unit inside the field beside the number ("$ 12.50", "12 bits", "12 d") and its own number
// of decimals; for Build's stored values, whole minor units. The caller keeps the text, so a partly
// typed amount survives a state push; `parseMoneyInput` reads it.
import { moneyAffixes, type MoneyUnit } from "../shared/money";
import type { WorldCurrency } from "../shared/world";

export function MoneyInput(props: {
  currency: WorldCurrency;
  /** The typed text. */
  value: string;
  onInput(text: string): void;
  /** The accessible name ("Amount", "Price of tin kazoo"). */
  label: string;
  /** "minor": whole minor units, as Build stores them (the label names the unit). Default: the currency's own amounts. */
  unit?: MoneyUnit;
  placeholder?: string;
  invalid?: boolean;
  autoFocus?: boolean;
  onBlur?(): void;
}) {
  const unit = props.unit ?? "major";
  const { prefix, suffix } = unit === "major" ? moneyAffixes(props.currency) : { prefix: "", suffix: "" };
  return (
    <span class={props.invalid ? "lre-money invalid" : "lre-money"} data-lre-money>
      {prefix ? (
        <span class="lre-money-affix" aria-hidden="true">
          {prefix}
        </span>
      ) : null}
      <input
        class={props.invalid ? "lre-input invalid" : "lre-input"}
        inputMode={unit === "minor" || props.currency.decimals <= 0 ? "numeric" : "decimal"}
        aria-label={props.label}
        aria-invalid={props.invalid ? true : undefined}
        placeholder={props.placeholder}
        autoFocus={props.autoFocus}
        value={props.value}
        onInput={(event) => props.onInput(event.currentTarget.value)}
        onBlur={props.onBlur}
      />
      {suffix ? (
        <span class="lre-money-affix" aria-hidden="true">
          {suffix}
        </span>
      ) : null}
    </span>
  );
}
