// Older worlds' money in the foundation's shapes (DESIGN §25.13): an account's single `owner`
// becomes its owners list and its `type` a product; a loan's `remaining_months` its `months_left`;
// an autopay sentence ("minimum from acct_x") a mode and the account it pays from; a deposit's
// `apr_pct` its `apy_pct`; a party's `bills` list flow entities; and a person's pay (their
// occupation and the payroll fields beside it) a job entity. Read on every revision
// (`migrateWorld`), so a world stored before the rebuild plays as one authored after it. A world
// with none of the old shapes is returned as it is: an author's choice not to give someone a job
// is never overridden.

import { CLASS_TRAITS, LEGACY_TYPE_CLASS, PAY_EVERY, type AccountClass } from "../shared/finance";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "../shared/json";
import type { EntityDef, WorldDoc } from "../shared/world";

const AUTOPAY = /^\s*(minimum|statement|full)?\s*(?:from\s+(\S+))?\s*$/i;

/** The payroll fields an older world kept on the person; the job carries them now. */
const PAYROLL = ["hourly_cents", "hours_per_week", "pay_frequency", "payday", "deposit_to", "annual_income_cents"] as const;

const WEEKDAYS: Readonly<Record<string, number>> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };

function classOfLegacy(fields: Readonly<JsonObject>): AccountClass | null {
  const t = fields.type;
  return typeof t === "string" && hasOwn(LEGACY_TYPE_CLASS, t) ? (LEGACY_TYPE_CLASS[t] ?? null) : null;
}

function isLegacy(doc: WorldDoc): boolean {
  return Object.values(doc.entities).some(
    (e) =>
      Array.isArray(e.fields.bills) ||
      // A job keeps its own pay fields; only a person carrying them is the older shape.
      (e.kind !== "job" && PAYROLL.some((k) => e.fields[k] !== undefined)) ||
      (e.kind === "account" && (typeof e.fields.owner === "string" || (typeof e.fields.type === "string" && e.fields.product === undefined) || e.fields.remaining_months !== undefined || (typeof e.fields.autopay === "string" && / from /i.test(` ${e.fields.autopay}`)))),
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

/** A party's old bills as flow entities; a lender's bill a loan's own autopay already pays is dropped. */
function billFlows(doc: WorldDoc, owner: EntityDef, taken: Set<string>): EntityDef[] {
  const bills = Array.isArray(owner.fields.bills) ? owner.fields.bills : [];
  const holds = (a: EntityDef): boolean => a.fields.owner === owner.id || (Array.isArray(a.fields.owners) && a.fields.owners.some((o) => isRecord(o) && o.party === owner.id));
  const loans = Object.values(doc.entities).filter((a) => {
    const cls = a.kind === "account" ? classOfLegacy(a.fields) : null;
    return cls !== null && CLASS_TRAITS[cls].installment && holds(a);
  });
  const vehicle = Object.values(doc.entities).find((v) => v.kind === "vehicle" && v.fields.owner === owner.id)?.id;
  const out: EntityDef[] = [];
  for (const raw of bills) {
    if (!isRecord(raw)) continue;
    const label = typeof raw.label === "string" && raw.label !== "" ? raw.label : "Bill";
    const payee = typeof raw.payee === "string" ? raw.payee : "";
    if (loans.some((l) => l.fields.institution === payee && l.fields.autopay !== undefined && l.fields.autopay !== "none")) continue;
    const fields: JsonObject = { flow_kind: "bill", from: typeof raw.from === "string" && raw.from !== "" ? raw.from : owner.id, to: payee, amount_cents: typeof raw.amountCents === "number" ? raw.amountCents : 0, shortfall: "skip", status: "active", every: typeof raw.every === "string" ? raw.every : "month" };
    // An old weekly bill's `day` was its weekday; a monthly one's its day of the month.
    if (typeof raw.day === "number") fields[fields.every === "week" ? "weekdays" : "days"] = [raw.day];
    if (typeof raw.weekday === "number") fields.weekdays = [raw.weekday];
    if (typeof raw.month === "number") fields.months = [raw.month];
    for (const k of ["start", "end", "category"] as const) if (typeof raw[k] === "string") fields[k] = raw[k];
    // The old premium check named car insurance by its label; such a bill belongs to the owner's vehicle.
    if (vehicle && /insurance/i.test(label) && /auto|car|vehicle/i.test(label)) fields.link = vehicle;
    out.push({ id: freeId(doc, taken, `flow_${owner.id}_${slug(label)}`), kind: "flow", name: label, tier: "background", fields, relations: [] });
  }
  return out;
}

/** A person's old pay as a job: what they did, for whom, at what rate, how often, and where it went. */
function jobOf(doc: WorldDoc, person: EntityDef, taken: Set<string>): EntityDef | null {
  const f = person.fields;
  const occupation = typeof f.occupation === "string" ? f.occupation : "";
  if (occupation === "" || occupation === "retired") return null;
  // Without an employer, the occupation in words: an outside employer by name (an id-shaped name lints as a misspelt reference).
  const employer = typeof f.employer === "string" && f.employer !== "" ? f.employer : occupation.replace(/_/g, " ");
  const job: JsonObject = { worker: person.id, employer, occupation, status: "active" };
  if (typeof f.hourly_cents === "number") {
    job.basis = "hourly";
    job.rate = f.hourly_cents;
  } else if (typeof f.annual_income_cents === "number") {
    job.basis = "salary";
    job.rate = f.annual_income_cents;
  }
  if (typeof f.hours_per_week === "number") job.hours_per_week = f.hours_per_week;
  const every = typeof f.pay_frequency === "string" ? f.pay_frequency : "";
  if ((PAY_EVERY as readonly string[]).includes(every)) job.pay_every = every;
  const payday = typeof f.payday === "string" ? f.payday.toLowerCase() : "";
  const weekday = Object.entries(WEEKDAYS).find(([name]) => payday.includes(name))?.[1];
  if (weekday !== undefined) job.pay_weekday = weekday;
  if (every === "semimonthly") job.pay_days = [15, -1];
  else if (every === "monthly") job.pay_days = [-1];
  if (typeof f.deposit_to === "string" && f.deposit_to !== "") job.splits = [{ to: f.deposit_to, pct: 100 }];
  if (typeof f.shift_pattern === "string") job.shift_pattern = f.shift_pattern;
  return { id: freeId(doc, taken, `job_${person.id}`), kind: "job", name: `${person.name}'s work`, tier: "background", fields: job, relations: [] };
}

/** The world with its money in the foundation's shapes; the same document when nothing is older. */
export function migrateMoney(doc: WorldDoc): WorldDoc {
  if (!isLegacy(doc)) return doc;
  const entities: Record<string, EntityDef> = {};
  const taken = new Set<string>();
  const added: EntityDef[] = [];
  const employed = new Set(Object.values(doc.entities).flatMap((e) => (e.kind === "job" && typeof e.fields.worker === "string" ? [e.fields.worker] : [])));
  for (const [id, e] of Object.entries(doc.entities)) {
    let next = e.kind === "account" ? account(e) : e;
    if (Array.isArray(e.fields.bills)) added.push(...billFlows(doc, e, taken));
    if (e.kind !== "job" && !employed.has(id) && typeof e.fields.occupation === "string") {
      const job = jobOf(doc, e, taken);
      if (job) added.push(job);
    }
    if (Array.isArray(e.fields.bills) || (e.kind !== "job" && PAYROLL.some((k) => e.fields[k] !== undefined))) {
      const fields: JsonObject = { ...next.fields };
      delete fields.bills;
      for (const k of PAYROLL) delete fields[k];
      next = { ...next, fields };
    }
    entities[id] = next;
  }
  for (const e of added) entities[e.id] = e;
  return { ...doc, entities };
}
