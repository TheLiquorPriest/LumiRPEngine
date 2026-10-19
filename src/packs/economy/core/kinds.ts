// The kinds the money foundation registers (DESIGN §25.1): accounts, payment cards, flows and the
// parties beyond people (businesses and trusts; a household is the relationships pack's group kind),
// plus the record kinds whose shapes the finance contract fixes for the work and holdings modules
// (jobs, holdings, property). Every money field is declared here, so Build forms, the GM view's
// edits and lint read it; the modules add their own through `FinanceRegistry.fields`.

import type { FieldDef, KindDef } from "../../../shared/world";
import { ACCOUNT_CLASSES, ACCOUNT_STATUSES, AUTOPAY_MODES, CARD_NETWORKS, CARD_STATES, FLOW_KINDS, FLOW_SHORTFALLS, FLOW_STATUSES, INVOICE_STATES, OVERDRAFT_POLICIES, PAY_BASES, PAY_EVERY } from "../../../shared/finance";
import type { FinanceKind } from "./module";

const OWNERS: FieldDef = { type: "list", label: "Owners ({party, role, share?})", domain: "money", level: 1 };

const ACCOUNT_FIELDS: Record<string, FieldDef> = {
  owners: OWNERS,
  product: { type: "text", label: `Product (a world product, or a class: ${ACCOUNT_CLASSES.join(", ")})`, domain: "money", level: 2 },
  institution: { type: "text", label: "Institution", domain: "money", level: 3 },
  opening: { type: "money", label: "Opening balance", locked: true },
  status: { type: "enum", label: "Status", values: [...ACCOUNT_STATUSES], default: "open", domain: "money", level: 2 },
  opened: { type: "date", label: "Opened", domain: "money", level: 4 },
  limit: { type: "money", label: "Credit limit", min: 0, domain: "money", level: 3 },
  apr_pct: { type: "number", label: "APR %", min: 0, domain: "money", level: 4 },
  apy_pct: { type: "number", label: "APY %", min: 0, domain: "money", level: 4 },
  statement_day: { type: "number", label: "Statement day", min: 1, max: 28, domain: "money", level: 3 },
  due_day: { type: "number", label: "Due day of month", min: 1, max: 31, domain: "money", level: 3 },
  min_pct: { type: "number", label: "Minimum payment % of balance", min: 0, max: 100, domain: "money", level: 4 },
  min_floor: { type: "money", label: "Minimum payment floor", min: 0, domain: "money", level: 4 },
  payment: { type: "money", label: "Monthly payment (loans)", min: 0, domain: "money", level: 3 },
  term_months: { type: "number", label: "Term in months", min: 0, domain: "money", level: 3 },
  months_left: { type: "number", label: "Months left (loans)", min: 0, domain: "money", level: 3 },
  secured_by: { type: "ref", label: "Secured by", domain: "money", level: 3 },
  overdraft: { type: "enum", label: "Overdraft policy", values: [...OVERDRAFT_POLICIES], domain: "money", level: 2 },
  overdraft_link: { type: "ref", label: "Overdraft from", ref: "account", domain: "money", level: 2 },
  overdraft_limit: { type: "money", label: "Overdraft limit", min: 0, domain: "money", level: 2 },
  autopay: { type: "enum", label: "Autopay", values: [...AUTOPAY_MODES], default: "none", domain: "money", level: 3 },
  autopay_from: { type: "ref", label: "Autopay from", ref: "account", domain: "money", level: 3 },
  autopay_cents: { type: "money", label: "Autopay amount (fixed)", min: 0, domain: "money", level: 3 },
};

const CARD_FIELDS: Record<string, FieldDef> = {
  account: { type: "ref", label: "Account", ref: "account", domain: "money", level: 2 },
  holder: { type: "ref", label: "Holder", domain: "money", level: 2 },
  network: { type: "enum", label: "Card type", values: [...CARD_NETWORKS], domain: "money", level: 2 },
  state: { type: "enum", label: "State", values: [...CARD_STATES], default: "active", domain: "money", level: 2 },
  item: { type: "ref", label: "The card in gear", domain: "money", level: 2 },
  last4: { type: "text", label: "Last four digits", domain: "money", level: 3 },
  daily_purchase_limit: { type: "money", label: "Daily purchase limit", min: 0, domain: "money", level: 4 },
  daily_atm_limit: { type: "money", label: "Daily cash machine limit", min: 0, domain: "money", level: 4 },
  replaces: { type: "ref", label: "Replaces", ref: "card", domain: "money", level: 2 },
  replaced_by: { type: "ref", label: "Replaced by", ref: "card", domain: "money", level: 2 },
};

const FLOW_FIELDS: Record<string, FieldDef> = {
  flow_kind: { type: "enum", label: "Kind", values: [...FLOW_KINDS], default: "bill", domain: "money", level: 2 },
  from: { type: "text", label: "From (an account, a party, or an outside payer)", domain: "money", level: 2 },
  to: { type: "text", label: "To (an account, a party, or an outside payee)", domain: "money", level: 2 },
  splits: { type: "list", label: "Splits ({to, cents?, pct?})", domain: "money", level: 3 },
  shares: { type: "list", label: "Shares ({party, pct, from?})", domain: "money", level: 3 },
  amount_cents: { type: "money", label: "Amount", min: 0, domain: "money", level: 2 },
  amount_formula: { type: "text", label: "Amount formula", domain: "money", level: 3 },
  amount_table: { type: "text", label: "Amount from a table (table.row.column)", domain: "money", level: 3 },
  amount_min: { type: "money", label: "Amount at least", min: 0, domain: "money", level: 3 },
  amount_max: { type: "money", label: "Amount at most", min: 0, domain: "money", level: 3 },
  amount_pct: { type: "number", label: "Percent of a balance", min: 0, max: 100, domain: "money", level: 3 },
  amount_of: { type: "ref", label: "Percent of this account's balance", ref: "account", domain: "money", level: 3 },
  amount_due: { type: "enum", label: "What's due on the credit account it pays", values: ["minimum", "statement", "balance"], domain: "money", level: 3 },
  every: { type: "enum", label: "Every", values: ["day", "week", "month", "year"], domain: "money", level: 2 },
  interval: { type: "number", label: "Every Nth period", min: 1, domain: "money", level: 2 },
  weekdays: { type: "list", label: "Weekdays (0 = Sunday)", of: "number", domain: "money", level: 2 },
  days: { type: "list", label: "Days of the month (-1 = the last)", of: "number", domain: "money", level: 2 },
  months: { type: "list", label: "Months (yearly)", of: "number", domain: "money", level: 2 },
  except: { type: "list", label: "Except holidays", of: "text", domain: "money", level: 3 },
  roll: { type: "enum", label: "Off a business day", values: ["none", "before", "after"], default: "none", domain: "money", level: 3 },
  at: { type: "text", label: "Time of day (HH:MM)", domain: "money", level: 2 },
  once: { type: "text", label: "Once, at (YYYY-MM-DDTHH:MM)", domain: "money", level: 2 },
  start: { type: "date", label: "Starts", domain: "money", level: 2 },
  end: { type: "date", label: "Ends", domain: "money", level: 2 },
  count: { type: "number", label: "Times at most", min: 1, domain: "money", level: 2 },
  shortfall: { type: "enum", label: "When the money isn't there", values: [...FLOW_SHORTFALLS], default: "skip", domain: "money", level: 3 },
  retry_days: { type: "number", label: "Retry after days", min: 1, domain: "money", level: 3 },
  retries: { type: "number", label: "Retries", min: 0, domain: "money", level: 3 },
  fallback: { type: "text", label: "Fallback (an account or a party)", domain: "money", level: 3 },
  category: { type: "text", label: "Category", domain: "money", level: 2 },
  link: { type: "ref", label: "Belongs to", domain: "money", level: 2 },
  status: { type: "enum", label: "Status", values: [...FLOW_STATUSES], default: "active", domain: "money", level: 2 },
  method: { type: "text", label: "Paid by (cash, card, checking, savings)", domain: "money", level: 3 },
};

const BUSINESS_FIELDS: Record<string, FieldDef> = {
  owners: OWNERS,
  places: { type: "list", label: "Places it trades at", of: "ref", domain: "money", level: 3 },
  collects_sales_tax: { type: "bool", label: "Collects sales tax", domain: "money", level: 4 },
  operating_account: { type: "ref", label: "Operating account", ref: "account", domain: "money", level: 3 },
  industry: { type: "text", label: "Industry", domain: "money", level: 3 },
  margin_pct: { type: "number", label: "Margin %", min: 0, max: 100, domain: "money", level: 4 },
  structure: { type: "enum", label: "Structure", values: ["sole_proprietorship", "partnership", "llc", "s_corp", "c_corp"], domain: "money", level: 4 },
  invoice_days: { type: "number", label: "Invoice terms (days)", min: 0, domain: "money", level: 3 },
  late_fee_pct: { type: "number", label: "Late fee %", min: 0, domain: "money", level: 4 },
  distribution_pct: { type: "number", label: "Profit paid out %", min: 0, max: 100, domain: "money", level: 4 },
  distribution_every: { type: "enum", label: "Paid out every", values: ["month", "quarter", "year"], domain: "money", level: 4 },
};

const JOB_FIELDS: Record<string, FieldDef> = {
  worker: { type: "ref", label: "Worker", ref: "person", domain: "money", level: 3 },
  employer: { type: "text", label: "Employer (a business, or an outside employer)", domain: "money", level: 3 },
  workplace: { type: "ref", label: "Workplace", domain: "money", level: 3 },
  title: { type: "text", label: "Title", domain: "money", level: 3 },
  occupation: { type: "text", label: "Occupation", domain: "money", level: 3, table: "economy.occupations" },
  basis: { type: "enum", label: "Paid by", values: [...PAY_BASES], default: "hourly", domain: "money", level: 3 },
  rate: { type: "money", label: "Rate (a year, an hour or a shift)", min: 0, domain: "money", level: 3 },
  hours: { type: "enum", label: "Hours counted", values: ["scheduled", "attended", "contract"], domain: "money", level: 3 },
  hours_per_week: { type: "number", label: "Hours a week", min: 0, domain: "money", level: 3 },
  shifts_per_week: { type: "number", label: "Shifts a week", min: 0, domain: "money", level: 3 },
  weeks_per_year: { type: "number", label: "Weeks a year", min: 0, max: 53, domain: "money", level: 3 },
  commission_pct: { type: "number", label: "Commission %", min: 0, domain: "money", level: 3 },
  tips_per_hour: { type: "money", label: "Tips an hour", min: 0, domain: "money", level: 3 },
  contractor: { type: "bool", label: "Contractor (nothing withheld)", domain: "money", level: 4 },
  season_from: { type: "text", label: "Season from (MM-DD)", domain: "money", level: 3 },
  season_to: { type: "text", label: "Season to (MM-DD)", domain: "money", level: 3 },
  pay_every: { type: "enum", label: "Paid", values: [...PAY_EVERY], default: "monthly", domain: "money", level: 3 },
  pay_anchor: { type: "date", label: "First payday", domain: "money", level: 3 },
  pay_days: { type: "list", label: "Paydays of the month", of: "number", domain: "money", level: 3 },
  pay_weekday: { type: "number", label: "Payday weekday (0 = Sunday)", min: 0, max: 6, domain: "money", level: 3 },
  pay_unit: { type: "enum", label: "Custom pay: every", values: ["day", "week", "month", "year"], domain: "money", level: 3 },
  pay_interval: { type: "number", label: "Custom pay: every Nth", min: 1, domain: "money", level: 3 },
  pay_weekdays: { type: "list", label: "Custom pay: weekdays", of: "number", domain: "money", level: 3 },
  pay_months: { type: "list", label: "Custom pay: months", of: "number", domain: "money", level: 3 },
  pay_except: { type: "list", label: "Custom pay: except holidays", of: "text", domain: "money", level: 3 },
  pay_roll: { type: "enum", label: "Payday off a business day", values: ["none", "before", "after"], default: "before", domain: "money", level: 3 },
  start: { type: "date", label: "Started", domain: "money", level: 3 },
  end: { type: "date", label: "Ends", domain: "money", level: 3 },
  deductions: { type: "list", label: "Deductions ({label, pretax, cents?, pct?, kind?, match_pct?, to?})", domain: "money", level: 4 },
  splits: { type: "list", label: "Pay goes to ({to, cents?, pct?})", domain: "money", level: 3 },
  status: { type: "enum", label: "Status", values: ["active", "leave", "ended"], default: "active", domain: "money", level: 3 },
  shift_pattern: { type: "text", label: "Shift pattern", domain: "money", level: 3, table: "calendar.shifts" },
};

const HOLDING_FIELDS: Record<string, FieldDef> = {
  account: { type: "ref", label: "Account", ref: "account", domain: "money", level: 4 },
  owners: OWNERS,
  asset: { type: "text", label: "Asset", domain: "money", level: 4 },
  lots: { type: "list", label: "Lots ({qty, cost, at})", domain: "money", level: 4 },
  route: { type: "text", label: "Distributions go to (an account, or reinvest)", domain: "money", level: 4 },
};

const PROPERTY_FIELDS: Record<string, FieldDef> = {
  place: { type: "ref", label: "Place", domain: "money", level: 3 },
  owners: OWNERS,
  value: { type: "money", label: "Value", min: 0, domain: "money", level: 3 },
  appreciation_pct: { type: "number", label: "Appreciation % a year", domain: "money", level: 4 },
  purchase_price: { type: "money", label: "Purchase price", min: 0, domain: "money", level: 4 },
  purchased: { type: "date", label: "Purchased", domain: "money", level: 4 },
  mortgage: { type: "ref", label: "Mortgage", ref: "account", domain: "money", level: 3 },
  tax_pct: { type: "number", label: "Property tax % a year", min: 0, domain: "money", level: 4 },
  insurance: { type: "money", label: "Insurance a month", min: 0, domain: "money", level: 4 },
  upkeep_pct: { type: "number", label: "Upkeep % a year", min: 0, domain: "money", level: 4 },
};

const INVOICE_FIELDS: Record<string, FieldDef> = {
  business: { type: "ref", label: "Business", ref: "business", domain: "money", level: 3 },
  customer: { type: "text", label: "Customer (a party, or an outside customer)", domain: "money", level: 3 },
  cents: { type: "money", label: "Amount", min: 0, domain: "money", level: 3 },
  memo: { type: "text", label: "For", domain: "money", level: 3 },
  issued: { type: "date", label: "Issued", domain: "money", level: 3 },
  due: { type: "date", label: "Due", domain: "money", level: 3 },
  state: { type: "enum", label: "State", values: [...INVOICE_STATES], default: "open", domain: "money", level: 3 },
  paid: { type: "money", label: "Paid", min: 0, domain: "money", level: 3 },
  late_fee: { type: "money", label: "Late fee charged", min: 0, domain: "money", level: 4 },
  fees: { type: "number", label: "Late fees charged", min: 0, locked: true, domain: "money", level: 4 },
  days_late: { type: "number", label: "Days late", min: 0, domain: "money", level: 4 },
  flow: { type: "text", label: "Paid by flow", domain: "money", level: 3 },
};

const BASE: Record<FinanceKind, Omit<KindDef, "fields"> & { fields: Record<string, FieldDef> }> = {
  account: { id: "account", label: "Account", pack: "economy", fields: ACCOUNT_FIELDS },
  card: { id: "card", label: "Payment card", pack: "economy", fields: CARD_FIELDS },
  flow: { id: "flow", label: "Money flow", pack: "economy", fields: FLOW_FIELDS },
  trust: { id: "trust", label: "Trust", extends: "thing", pack: "economy", fields: { owners: OWNERS } },
  business: { id: "business", label: "Business", extends: "thing", pack: "economy", fields: BUSINESS_FIELDS },
  job: { id: "job", label: "Job", pack: "economy", fields: JOB_FIELDS },
  holding: { id: "holding", label: "Holding", pack: "economy", fields: HOLDING_FIELDS },
  property: { id: "property", label: "Property", extends: "thing", pack: "economy", fields: PROPERTY_FIELDS },
  invoice: { id: "invoice", label: "Invoice", pack: "economy", fields: INVOICE_FIELDS },
};

/** The foundation's kinds, each with the fields modules added (a module's field never replaces a declared one). */
export function financeKinds(added: Readonly<Record<string, Record<string, FieldDef>>>): KindDef[] {
  return (Object.keys(BASE) as FinanceKind[]).map((id) => {
    const base = BASE[id];
    return { ...base, fields: { ...(added[id] ?? {}), ...base.fields } };
  });
}
