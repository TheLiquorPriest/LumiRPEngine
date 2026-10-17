// Money as people type it (DESIGN §9.5, §12): an amount in a world's currency, read into integer
// minor units and written back for editing. The palette's amounts, the ✎ cash fix and chip amounts
// are typed as the currency writes them, in major units with its own number of decimals ("12.50",
// "$12.50", "12 bits"); Build's stored values are typed as whole minor units ("1250" cents).

import type { WorldCurrency } from "./world";

/** How an amount is typed: as the currency writes it, or as whole minor units (Build's stored values). */
export type MoneyUnit = "major" | "minor";

/** The decimals an amount is typed with: the currency's (a whole number from 0 to 6, as `formatMoney` reads them), or none for minor units. */
function places(currency: WorldCurrency, unit: MoneyUnit): number {
  return unit === "minor" ? 0 : Math.max(0, Math.min(6, Math.trunc(currency.decimals)));
}

/**
 * What a money input shows around the number, from the currency's display format: "$" before it
 * for `{symbol}{amount}`, "bits" after it for `{amount} bits`. A format that splits the amount into
 * `{major}` and `{minor}` shows the currency's code after it.
 */
export function moneyAffixes(currency: WorldCurrency): { prefix: string; suffix: string } {
  const at = "\u0000";
  const shown = currency.format.replace(/\{(sign|symbol|code|amount)\}/g, (_, key: string) => (key === "amount" ? at : key === "symbol" ? currency.symbol : key === "code" ? currency.code : ""));
  const index = shown.indexOf(at);
  if (index < 0 || /\{(major|minor)\}/.test(currency.format)) return { prefix: "", suffix: currency.code };
  return { prefix: shown.slice(0, index).trim(), suffix: shown.slice(index + 1).trim() };
}

/** A number with optional thousands separators (groups of three) and an optional decimal part. */
const AMOUNT = /^(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d*))?$/;

/**
 * Typed text as integer minor units, or null when it isn't an amount. A major-unit amount may carry
 * the currency's symbol, code or format text on either side ("$12.50", "12 bits", "12d", "12 USD"),
 * thousands separators ("1,200") and at most the currency's decimals: "5.5" is refused in a currency
 * without a minor unit, and "5.255" in dollars. Minor units are whole numbers. A leading minus is
 * kept; callers check their own range.
 */
export function parseMoneyInput(text: string, currency: WorldCurrency, unit: MoneyUnit = "major"): number | null {
  let t = text.trim().replace(/\u2212/g, "-");
  const negative = t.startsWith("-");
  if (negative) t = t.slice(1).trim();
  if (unit === "major") {
    const { prefix, suffix } = moneyAffixes(currency);
    const words = [...new Set([currency.symbol, currency.code, prefix, suffix].map((w) => w.trim().toLowerCase()).filter((w) => w !== ""))].sort((a, b) => b.length - a.length);
    const lower = t.toLowerCase();
    const word = words.find((w) => lower.startsWith(w) || lower.endsWith(w));
    if (word) t = (lower.startsWith(word) ? t.slice(word.length) : t.slice(0, t.length - word.length)).trim();
  }
  const m = AMOUNT.exec(t);
  const whole = m?.[1];
  const fraction = m?.[2];
  if (!m || (whole === undefined && (fraction === undefined || fraction === ""))) return null;
  const decimals = places(currency, unit);
  if (fraction !== undefined && (decimals === 0 || fraction.length > decimals)) return null;
  const minor = Number((whole ?? "0").replace(/,/g, "")) * 10 ** decimals + Number((fraction ?? "").padEnd(decimals, "0") || "0");
  if (!Number.isSafeInteger(minor)) return null;
  return negative && minor !== 0 ? -minor : minor;
}

/** Integer minor units as editable text: the plain amount with the currency's decimals and no symbol or separators ("12.50", "1050"), or whole minor units. */
export function formatMoneyInput(minor: number, currency: WorldCurrency, unit: MoneyUnit = "major"): string {
  const decimals = places(currency, unit);
  const units = Math.abs(Math.trunc(minor));
  const scale = 10 ** decimals;
  const fraction = decimals > 0 ? `.${String(units % scale).padStart(decimals, "0")}` : "";
  return `${minor < 0 && units !== 0 ? "-" : ""}${Math.floor(units / scale)}${fraction}`;
}

/** The minor unit's plural, as a label names it ("cents", "bits", "pennies"); the currency's code when it names none. */
export function minorUnitPlural(currency: WorldCurrency): string {
  const unit = currency.minorUnit.trim();
  if (unit === "") return currency.code;
  if (/[^aeiou]y$/i.test(unit)) return `${unit.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(unit)) return `${unit}es`;
  return `${unit}s`;
}
