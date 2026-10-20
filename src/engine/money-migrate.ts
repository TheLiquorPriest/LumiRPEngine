// Older worlds' money in the foundation's shapes (DESIGN §25.14): an account's single `owner`
// becomes its owners list and its `type` a product; a loan's `remaining_months` its `months_left`;
// an autopay sentence ("minimum from acct_x") a mode and the account it pays from; a deposit's
// `apr_pct` its `apy_pct`; a party's `bills` list flow entities; a person's pay (their
// occupation and the payroll fields beside it) a job entity; a brokerage's units of a symbol
// a holding of that asset; and an economy that names no region the POV's. Read on every revision
// (`migrateWorld`), so a world stored before the rebuild plays as one authored after it. A world
// with none of the old shapes is returned as it is: an author's choice not to give someone a job
// is never overridden.

import { CLASS_TRAITS, LEGACY_TYPE_CLASS, PAY_EVERY, type AccountClass } from "../shared/finance";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "../shared/json";
import type { EntityDef, WorldDoc } from "../shared/world";

const AUTOPAY = /^\s*(minimum|statement|full)?\s*(?:from\s+(\S+))?\s*$/i;

/** The payroll fields an older world kept on the person; the job carries them now. */
const PAYROLL = ["hourly_cents", "salary_cents", "annual_income_cents", "hours_per_week", "pay_frequency", "payday", "deposit_to"] as const;

const WEEKDAYS: Readonly<Record<string, number>> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function classOfLegacy(fields: Readonly<JsonObject>): AccountClass | null {
  const t = fields.type;
  return typeof t === "string" && hasOwn(LEGACY_TYPE_CLASS, t) ? (LEGACY_TYPE_CLASS[t] ?? null) : null;
}

/** Whether a kind is a person's, or extends one: the old payroll paid people, and only them. */
function isPerson(doc: WorldDoc, kind: string): boolean {
  let k: string | undefined = kind;
  for (let depth = 0; k !== undefined && depth < 16; depth++) {
    if (k === "person") return true;
    k = doc.kinds[k]?.extends;
  }
  return false;
}

function isLegacy(doc: WorldDoc): boolean {
  return Object.values(doc.entities).some(
    (e) =>
      Array.isArray(e.fields.bills) ||
      (isPerson(doc, e.kind) && PAYROLL.some((k) => e.fields[k] !== undefined)) ||
      (e.kind === "account" && (typeof e.fields.owner === "string" || typeof e.fields.units === "number" || (typeof e.fields.type === "string" && e.fields.product === undefined) || e.fields.remaining_months !== undefined || (typeof e.fields.autopay === "string" && / from /i.test(` ${e.fields.autopay}`)))),
  );
}

function account(e: EntityDef): EntityDef {
  const f: JsonObject = { ...e.fields };
  const cls = classOfLegacy(f);
  if (typeof f.owner === "string" && !Array.isArray(f.owners)) f.owners = [{ party: f.owner, role: "owner" }];
  delete f.owner;
  if (cls && f.product === undefined) f.product = cls;
  delete f.type;
  if (f.remaining_months !== undefined) {
    if (f.months_left === undefined) f.months_left = f.remaining_months;
    delete f.remaining_months;
  }
  const traits = cls ? CLASS_TRAITS[cls] : null;
  if (typeof f.autopay === "string") {
    const m = AUTOPAY.exec(f.autopay);
    if (m) {
      // A loan's "from <account>" paid its instalment; a card's paid the statement.
      f.autopay = (m[1]?.toLowerCase() ?? (traits?.installment ? "minimum" : "statement")) as JsonValue;
      if (m[2]) f.autopay_from = m[2];
    }
  }
  if (traits?.asset && !traits.liability && f.apr_pct !== undefined && f.apy_pct === undefined) {
    f.apy_pct = f.apr_pct;
    delete f.apr_pct;
  }
  return { ...e, fields: f };
}

function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40) || "bill"
  );
}

function freeId(doc: WorldDoc, taken: Set<string>, base: string): string {
  let id = base;
  for (let n = 2; taken.has(id) || hasOwn(doc.entities, id); n++) id = `${base}_${n}`;
  taken.add(id);
  return id;
}

/**
 * A loan payment the loan's own autopay already makes, as the old bills read it: the bill names the
 * loan (`to`), or its payee is the lender and its amount the loan's payment.
 */
function paidByLoanAutopay(loans: readonly EntityDef[], bill: JsonObject): boolean {
  return loans.some((loan) => {
    const f = loan.fields;
    if (typeof f.autopay !== "string" || f.autopay === "" || f.autopay === "none") return false;
    if (bill.to === loan.id) return true;
    return typeof bill.payee === "string" && bill.payee !== "" && bill.payee === f.institution && typeof bill.amountCents === "number" && Math.round(bill.amountCents) === Math.round(typeof f.payment === "number" ? f.payment : Number.NaN);
  });
}

/** The old premium check's reading of a bill's label: vehicle insurance of any kind. */
const VEHICLE_INSURANCE = /auto|car|vehicle|truck|motor|boat|marine/i;

/**
 * A party's old bills as flow entities. A lender's bill a loan's own autopay already pays is
 * dropped. A vehicle insurance bill becomes an insurance flow linked to nothing, which insures every
 * vehicle its payer owns, as the old bill did.
 */
function billFlows(doc: WorldDoc, owner: EntityDef, taken: Set<string>): EntityDef[] {
  const bills = Array.isArray(owner.fields.bills) ? owner.fields.bills : [];
  const holds = (a: EntityDef): boolean => a.fields.owner === owner.id || (Array.isArray(a.fields.owners) && a.fields.owners.some((o) => isRecord(o) && o.party === owner.id));
  const loans = Object.values(doc.entities).filter((a) => {
    const cls = a.kind === "account" ? classOfLegacy(a.fields) : null;
    return cls !== null && CLASS_TRAITS[cls].installment && holds(a);
  });
  const out: EntityDef[] = [];
  for (const raw of bills) {
    if (!isRecord(raw) || paidByLoanAutopay(loans, raw)) continue;
    const label = typeof raw.label === "string" && raw.label !== "" ? raw.label : "Bill";
    const payee = typeof raw.payee === "string" ? raw.payee : "";
    const fields: JsonObject = { flow_kind: "bill", from: typeof raw.from === "string" && raw.from !== "" ? raw.from : owner.id, to: payee, amount_cents: typeof raw.amountCents === "number" ? raw.amountCents : 0, shortfall: "skip", status: "active", every: typeof raw.every === "string" ? raw.every : "month" };
    // An old weekly bill's `day` was its weekday, by number or by name; a monthly one's its day of the month.
    const weekday = typeof raw.day === "string" ? WEEKDAYS[raw.day.trim().toLowerCase()] : undefined;
    if (typeof raw.day === "number") fields[fields.every === "week" ? "weekdays" : "days"] = [raw.day];
    else if (weekday !== undefined && fields.every === "week") fields.weekdays = [weekday];
    if (typeof raw.weekday === "number") fields.weekdays = [raw.weekday];
    if (typeof raw.month === "number") fields.months = [raw.month];
    for (const k of ["start", "end", "category"] as const) if (typeof raw[k] === "string") fields[k] = raw[k];
    if (/insurance/i.test(label) && VEHICLE_INSURANCE.test(label)) {
      fields.flow_kind = "premium";
      fields.category = "insurance";
    }
    out.push({ id: freeId(doc, taken, `flow_${owner.id}_${slug(label)}`), kind: "flow", name: label, tier: "background", fields, relations: [] });
  }
  return out;
}

/**
 * A person's old pay as a job: what they did, for whom, at what rate, how often, and where it went.
 * As the old payroll read it, an hourly rate wins, then `salary_cents`, then `annual_income_cents`,
 * else the occupation's typical pay; someone with a stated pay and no occupation is still paid.
 */
function jobOf(doc: WorldDoc, person: EntityDef, taken: Set<string>): EntityDef | null {
  const f = person.fields;
  const occupation = typeof f.occupation === "string" ? f.occupation : "";
  const hourly = typeof f.hourly_cents === "number" && f.hourly_cents > 0 ? f.hourly_cents : null;
  const salary = typeof f.salary_cents === "number" ? f.salary_cents : typeof f.annual_income_cents === "number" ? f.annual_income_cents : null;
  if (occupation === "retired" || (occupation === "" && hourly === null && salary === null)) return null;
  // Without an employer, the occupation in words: an outside employer by name (an id-shaped name lints as a misspelt reference).
  const employer = typeof f.employer === "string" && f.employer !== "" ? f.employer : occupation !== "" ? occupation.replace(/_/g, " ") : "Employer";
  const job: JsonObject = { worker: person.id, employer, ...(occupation !== "" ? { occupation } : {}), status: "active" };
  if (hourly !== null) {
    job.basis = "hourly";
    job.rate = hourly;
  } else if (salary !== null) {
    job.basis = "salary";
    job.rate = salary;
  }
  if (typeof f.hours_per_week === "number") job.hours_per_week = f.hours_per_week;
  const every = typeof f.pay_frequency === "string" ? f.pay_frequency : "";
  if ((PAY_EVERY as readonly string[]).includes(every)) job.pay_every = every;
  // The payday's weekday by number, or by a name in it ("Friday", "every other Friday").
  const payday = typeof f.payday === "string" ? f.payday.toLowerCase() : "";
  const weekday = typeof f.payday === "number" ? f.payday : Object.entries(WEEKDAYS).find(([name]) => payday.includes(name))?.[1];
  if (weekday !== undefined) job.pay_weekday = weekday;
  if (every === "semimonthly") job.pay_days = [15, -1];
  else if (every === "monthly") job.pay_days = [-1];
  if (typeof f.deposit_to === "string" && f.deposit_to !== "") job.splits = [{ to: f.deposit_to, pct: 100 }];
  if (typeof f.shift_pattern === "string") job.shift_pattern = f.shift_pattern;
  return { id: freeId(doc, taken, `job_${person.id}`), kind: "job", name: `${person.name}'s work`, tier: "background", fields: job, relations: [] };
}

/** The id the holdings module's trades look up, so a later buy of the asset adds to this holding. */
function holdingId(account: string, asset: string): string {
  return `${account}:${asset}`;
}

/**
 * A brokerage's old units of a symbol as a holding of that asset, bought at the symbol's starting
 * price of 100 on the world's start date; the asset is added to the world's assets when missing.
 */
function holdingOf(doc: WorldDoc, account: EntityDef, assets: JsonObject): EntityDef | null {
  const units = account.fields.units;
  const symbol = typeof account.fields.symbol === "string" && account.fields.symbol !== "" ? account.fields.symbol : "broad_us_equity_index";
  if (typeof units !== "number" || !(units > 0)) return null;
  if (!hasOwn(assets, symbol)) assets[symbol] = { label: symbol.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), class: "fund", price: 10000, model: symbol };
  return { id: holdingId(account.id, symbol), kind: "holding", name: account.name, tier: "background", fields: { account: account.id, asset: symbol, lots: [{ qty: units, cost: Math.round(units * 10000), at: doc.start.at.slice(0, 10) }] }, relations: [] };
}

/** The world with its money in the foundation's shapes; the same document when nothing is older, or the world runs no economy (nothing then becomes a job or a flow). */
export function migrateMoney(doc: WorldDoc): WorldDoc {
  if (!doc.packs.economy || !isLegacy(doc)) return doc;
  const economy = doc.packs.economy;
  const assets: JsonObject = { ...(isRecord(economy?.config.assets) ? economy.config.assets : {}) };
  const entities: Record<string, EntityDef> = {};
  const taken = new Set<string>();
  const added: EntityDef[] = [];
  const employed = new Set(Object.values(doc.entities).flatMap((e) => (e.kind === "job" && typeof e.fields.worker === "string" ? [e.fields.worker] : [])));
  for (const [id, e] of Object.entries(doc.entities)) {
    let next = e.kind === "account" ? account(e) : e;
    const holding = e.kind === "account" ? holdingOf(doc, e, assets) : null;
    if (holding && !hasOwn(doc.entities, holding.id)) {
      added.push(holding);
      const fields: JsonObject = { ...next.fields };
      delete fields.units;
      next = { ...next, fields };
    }
    if (Array.isArray(e.fields.bills)) added.push(...billFlows(doc, e, taken));
    const person = isPerson(doc, e.kind);
    if (person && !employed.has(id) && (typeof e.fields.occupation === "string" || PAYROLL.some((k) => e.fields[k] !== undefined))) {
      const job = jobOf(doc, e, taken);
      if (job) added.push(job);
    }
    if (Array.isArray(e.fields.bills) || (person && PAYROLL.some((k) => e.fields[k] !== undefined))) {
      const fields: JsonObject = { ...next.fields };
      delete fields.bills;
      if (person) for (const k of PAYROLL) delete fields[k];
      next = { ...next, fields };
    }
    entities[id] = next;
  }
  for (const e of added) entities[e.id] = e;
  const config: JsonObject = { ...economy?.config };
  if (Object.keys(assets).length > 0) config.assets = assets;
  // A world saved before templates gave the economy their region kept it only on its people, so its
  // sales tax ran at the national rate while their income tax ran at the region's.
  const pov = hasOwn(doc.entities, doc.pov) ? doc.entities[doc.pov] : undefined;
  if (!(typeof config.region === "string" && config.region !== "") && typeof pov?.fields.region === "string" && pov.fields.region !== "") config.region = pov.fields.region;
  const packs = economy ? { ...doc.packs, economy: { ...economy, config } } : doc.packs;
  return { ...doc, entities, packs };
}
