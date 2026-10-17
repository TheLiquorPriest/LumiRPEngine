// Display formatting. Money arrives as integer cents, durations as game minutes, odds as exact
// probabilities; nothing here derives world state.

import { DEFAULT_CURRENCY, formatMoney } from "../shared/world";
import type { WorldCurrency } from "../shared/world";

let current: WorldCurrency = DEFAULT_CURRENCY;

/** The attached world's currency (`StateView.currency`); setup sets it before each render pass. */
export function setCurrency(currency: WorldCurrency | null): void {
  current = currency ?? DEFAULT_CURRENCY;
}

/** Integer minor units in the attached world's currency (the shared formatter). */
export function formatCents(cents: number): string {
  return formatMoney(cents, current);
}

/** Game minutes as a compact span: 30 s, 12 min, 2 h 5 min, 3 d 4 h. */
export function formatMinutes(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
}

/** An exact probability with one decimal; never rounds a possible outcome to 0% or a sure one to 100%. */
export function formatOdds(p: number): string {
  if (p <= 0) return "0%";
  if (p >= 1) return "100%";
  if (p < 0.001) return "<0.1%";
  if (p > 0.999) return ">99.9%";
  return `${(p * 100).toFixed(1)}%`;
}

/** `time_advance` → "Time advance". */
export function humanize(id: string): string {
  const words = id.replace(/[_.]+/g, " ").trim();
  return words.length === 0 ? id : words[0]?.toUpperCase() + words.slice(1);
}
