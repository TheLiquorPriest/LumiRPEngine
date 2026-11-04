// What an organization's Taxes adds beside `TaxesView` (DESIGN §26.3): the penalty taxes on kept
// earnings, what a corporation carries into the year, a private foundation's payout and taxes, and an
// S corporation's holders. Amounts are minor units.

/** A C corporation's penalty taxes: last year's from its close, and its earnings and profits now. */
export interface PenaltyTaxView {
  /** Whether the world taxes kept earnings (the economy config's `taxes.penaltyTaxes`). */
  on: boolean;
  /** Last year's: personal holding company tax or the accumulated earnings tax, as its close and its consent dividends read; null before its first close. */
  last: {
    year: number;
    kind: "phc" | "aet";
    /** Its taxable income less its federal tax and the dividends it paid, consent dividends among them. */
    kept: number;
    credit: number;
    base: number;
    cents: number;
    consent: number;
    /** Its passive income's share of its gross income, and what its five largest individual holders hold, in percent. */
    passivePct: number;
    top5: number;
    paid: boolean;
  } | null;
  /** Its accumulated earnings and profits at this year's start. */
  ep: number;
}

/** What a corporation carries into this year from its last close. */
export interface CarryView {
  nol: number;
  capitalLoss: number;
  /** Gifts over the cap, still within their five years. */
  gifts: number;
}

/** A private foundation's payout and taxes (its status's row: `payout_pct`, `excise_pct`, `undistributed_tax_pct`, `donor_limit_pct`). */
export interface FoundationView {
  payoutPct: number;
  excisePct: number;
  undistributedPct: number;
  donorLimitPct: number;
  year: number;
  /** The average of its assets as marked this year so far, and this year's payout on them so far. */
  assets: number;
  payoutSoFar: number;
  /** What it granted this year, last year's shortfall, and what of it these grants haven't covered yet. */
  granted: number;
  lastShortfall: number;
  leftOfLast: number;
  /** Last year's close, null before its first. */
  last: { year: number; assets: number; payout: number; grants: number; shortfall: number; nii: number; excise: number; undistributed: number; tax: number } | null;
  /** What it owes with its return on 15 May; null once paid, or when it owes none. */
  due: number | null;
}

/** An S corporation's holders against its limit, and why they can't hold it, in words. */
export interface SCorpView {
  holders: number;
  max: number;
  problem: string | null;
}

export interface TaxesExtra {
  penalty: PenaltyTaxView | null;
  carry: CarryView | null;
  foundation: FoundationView | null;
  scorp: SCorpView | null;
}

type Obj = Record<string, unknown>;

const objOf = (v: unknown): Obj | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null);
const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** `TaxesExtra` as a Taxes section arrives (the frontend's decoder of `TaxesView` adds it): anything missing or malformed reads as none. */
export function decodeTaxesExtra(value: unknown): TaxesExtra {
  const o = objOf(value) ?? {};
  const p = objOf(o.penalty);
  const last = objOf(p?.last);
  const c = objOf(o.carry);
  const f = objOf(o.foundation);
  const fl = objOf(f?.last);
  const s = objOf(o.scorp);
  return {
    penalty: p
      ? {
          on: p.on === true,
          last: last ? { year: n(last.year), kind: last.kind === "phc" ? "phc" : "aet", kept: n(last.kept), credit: n(last.credit), base: n(last.base), cents: n(last.cents), consent: n(last.consent), passivePct: n(last.passivePct), top5: n(last.top5), paid: last.paid === true } : null,
          ep: n(p.ep),
        }
      : null,
    carry: c ? { nol: n(c.nol), capitalLoss: n(c.capitalLoss), gifts: n(c.gifts) } : null,
    foundation: f
      ? {
          payoutPct: n(f.payoutPct),
          excisePct: n(f.excisePct),
          undistributedPct: n(f.undistributedPct),
          donorLimitPct: n(f.donorLimitPct),
          year: n(f.year),
          assets: n(f.assets),
          payoutSoFar: n(f.payoutSoFar),
          granted: n(f.granted),
          lastShortfall: n(f.lastShortfall),
          leftOfLast: n(f.leftOfLast),
          last: fl ? { year: n(fl.year), assets: n(fl.assets), payout: n(fl.payout), grants: n(fl.grants), shortfall: n(fl.shortfall), nii: n(fl.nii), excise: n(fl.excise), undistributed: n(fl.undistributed), tax: n(fl.tax) } : null,
          due: typeof f.due === "number" ? f.due : null,
        }
      : null,
    scorp: s ? { holders: n(s.holders), max: n(s.max), problem: typeof s.problem === "string" ? s.problem : null } : null,
  };
}
