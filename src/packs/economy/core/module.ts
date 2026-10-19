// How the economy's modules plug into the money foundation (DESIGN §25.12). The work module
// (employment, payroll, businesses, taxes) and the holdings module (holdings, prices, options,
// distributions, property) each export one `register…(r: FinanceRegistry)` function, listed in
// `modules.ts`; the economy pack calls each from its own registration, once per registry.
//
// `r.core` is the economy pack's registry: a module's kinds, events (`economy.*`), effects,
// actions, processes, queries and lints go there. The hooks below feed the foundation's own
// engines: the flow engine processes a module's derived flows with the same schedule, shortfall
// and journal as authored ones; net worth adds what a module values; a purchase asks the sale hooks
// who sells; every party's dashboard view takes the sections modules fill. `r.api` is the
// foundation's money surface, the one way a module moves or reads money.

import type { EntityId } from "../../../shared/ids";
import type { LedgerEvent, PostingLine } from "../../../shared/ledger";
import type { AccountClass, AlertLine, ClassTraits, FinanceFeature, FinanceView, Flow, FlowSchedule, FlowSplit, Owner, PartyKind, ResolvedProduct, TxnKind, UpcomingLine } from "../../../shared/finance";
import type { FieldDef } from "../../../shared/world";
import type { CoreRegistry, ReadContext, Rejection } from "../../../engine/registry";
import type { WorldState } from "../../../engine/state";

/** One occurrence's money, as a module's amount provider gives it. */
export interface FlowPosting {
  /** What it moves in all (the gross), for the flow's record and views. */
  cents: number;
  /**
   * The whole posting, when it isn't simply `from` to `to` (payroll's gross, net, withholding and
   * deductions; a dividend reinvested). Its lines balance. Absent: the engine posts `cents` from the
   * flow's `from` to its `to` and splits, as for any flow.
   */
  lines?: PostingLine[];
  memo?: string;
  kind?: TxnKind;
  category?: string;
  /** Bookkeeping that goes with the posting as one unit (a lot bought, a business's books). */
  extra?: LedgerEvent[];
}

/**
 * Builds an occurrence of a flow whose amount is `{provider: id}`. Null skips the occurrence (no pay
 * this period); a rejection is a shortfall the flow's policy handles.
 */
export type AmountProvider = (ctx: ReadContext, flow: Flow, at: number) => FlowPosting | Rejection | null;

/** Flows a module derives from its records each time the engine reads them (paychecks from jobs, rent from leases, property tax). */
export interface FlowSource {
  id: string;
  flows(ctx: ReadContext): Flow[];
}

/** What a module adds to a party's net worth beyond its accounts' balances: holdings at market, property and business shares, the debts against them. */
export type WorthSource = (ctx: ReadContext, party: EntityId) => { assets: number; liabilities: number; lines: { label: string; cents: number }[] };

/** A purchase about to post. */
export interface Sale {
  payer: EntityId;
  place: string | null;
  category: string;
  /** The price, before any sales tax. */
  cents: number;
  item: string;
}

/** Who sells it, and what tax comes on top: the business's party and account the price lands in, and the tax to its authority. */
export interface SaleTerms {
  seller?: EntityId;
  deposit?: EntityId;
  tax: number;
  /** The outside account the tax goes to (`economy.external:tax:sales:<region>`). */
  taxAccount?: string;
  /** Bookkeeping that goes with the sale (the business's books). */
  extra?: LedgerEvent[];
}

export type SaleHook = (ctx: ReadContext, sale: Sale) => SaleTerms | null;

/** The sections of a party's dashboard view a module fills, and its lines in the overview. */
export interface ViewSectionResult extends Partial<Pick<FinanceView, "jobs" | "businesses" | "investments" | "properties">> {
  upcoming?: UpcomingLine[];
  alerts?: AlertLine[];
}

export type ViewSection = (ctx: ReadContext, party: EntityId, view: Readonly<FinanceView>) => ViewSectionResult;

/** Sentences a module adds to a character's money summary (their job, their business, their investments). */
export type SummarySource = (ctx: ReadContext, who: EntityId) => string[];

/** A payment between parties (or a party and the outside), paid the way the foundation pays everything. */
export interface Payment {
  /** A party (paying as their preferences choose), or one of their accounts. */
  from: EntityId;
  /** A party (into their deposit account), an account of theirs, or an outside payee by name. */
  to: string;
  cents: number;
  memo: string;
  kind?: TxnKind;
  category?: string;
  /** How the payer pays (`cash`, `card`, `checking`, `savings`, `account`: a bill's way, never wallet cash). */
  method?: string;
  /** The payee's account it lands in. */
  deposit?: EntityId;
  /** The outside counterparty, when `to` isn't one. */
  counterparty?: string;
  flow?: string;
}

/** What a posting is, for its journal lines. */
export interface PostMeta {
  memo: string;
  kind?: TxnKind;
  category?: string;
  counterparty?: string;
  flow?: string;
  /** Skip the funds check (an opening balance, a correction); a posting is otherwise refused when a paying account can't cover its line. */
  unchecked?: boolean;
}

/** Opening an account from a product: a loan's disbursement, a new card, a mortgage secured by a property. */
export interface OpenAccount {
  id?: EntityId;
  name: string;
  product: string;
  owners: Owner[];
  /** A loan's principal paid out to `into` (or to the outside, when buying something), or a card's limit. */
  cents?: number;
  into?: string;
  term_months?: number;
  apr_pct?: number;
  secured_by?: EntityId;
  /** Issue a card (a debit card on checking, a credit card on a card account), with its gear item. */
  card?: boolean;
}

/** The foundation's money surface for modules. Every function is pure. */
export interface FinanceApi {
  classOf(state: Readonly<WorldState>, account: EntityId): AccountClass | null;
  traitsOf(state: Readonly<WorldState>, account: EntityId): ClassTraits | null;
  /** The owners of any entity with an `owners` list (accounts, businesses, holdings, properties); an older single `owner` reads as the owner. */
  ownersOf(state: Readonly<WorldState>, entity: EntityId): Owner[];
  /** A party's share of an entity's worth, percent (0 when its role carries none). */
  shareOf(state: Readonly<WorldState>, entity: EntityId, party: EntityId): number;
  /** The accounts a party holds with a right (`spend`, `worth` or `sees`), in class order. */
  accountsOf(state: Readonly<WorldState>, party: EntityId, right?: "spend" | "worth" | "sees"): EntityId[];
  balance(state: Readonly<WorldState>, account: EntityId): number;
  /** What can be spent or drawn now: the balance (or credit left), less holds, plus overdraft room. */
  available(ctx: ReadContext, account: EntityId): number;
  product(ctx: ReadContext, account: EntityId): ResolvedProduct | null;
  /** Where money paid to a party lands by default: their best deposit account, never `except`. */
  depositAccount(ctx: ReadContext, party: EntityId, except?: EntityId): EntityId | null;
  partyKind(ctx: ReadContext, id: EntityId): PartyKind | null;
  /** Whether a feature runs for a party at its Money level and the world's toggles. */
  feature(ctx: ReadContext, party: EntityId, feature: FinanceFeature): boolean;
  /** The outside account for a counterparty (`employer:acme`, `tax:federal`). */
  outside(id: string): string;
  pay(ctx: ReadContext, payment: Payment): LedgerEvent[] | Rejection;
  /** A posting of any number of lines with its journal lines, as one unit. */
  post(ctx: ReadContext, lines: PostingLine[], meta: PostMeta): LedgerEvent[] | Rejection;
  /** A payday, bill or decline note: a signal for the POV, a secret note in anyone else's record. */
  note(ctx: ReadContext, who: EntityId, cls: "bill" | "decline", text: string): LedgerEvent[];
  money(ctx: ReadContext, cents: number): string;
  /** Splits an amount: fixed amounts first, then percentages of the rest; what's left to `rest`. */
  split(cents: number, splits: readonly FlowSplit[], rest: string): { to: string; cents: number }[];
  /** The clock instants a schedule falls due in `(from, to]`, counting intervals from `start`. */
  occurrences(ctx: ReadContext, schedule: FlowSchedule, from: number, to: number, start?: string): number[];
  /** The business day a day rolls to (`before` or `after` a weekend or day-off holiday). */
  businessDay(ctx: ReadContext, day: number, roll: "before" | "after"): number;
  /** Every flow in force: flow entities and every module's derived flows. */
  flows(ctx: ReadContext): Flow[];
  openAccount(ctx: ReadContext, spec: OpenAccount): LedgerEvent[] | Rejection;
  /** The loans and mortgages an asset secures. */
  securedBy(state: Readonly<WorldState>, asset: EntityId): EntityId[];
  /** A party's net worth with every module's assets. */
  netWorth(ctx: ReadContext, party: EntityId): number;
}

/** What a module registers. */
export interface FinanceRegistry {
  readonly core: CoreRegistry;
  readonly api: FinanceApi;
  /** Declared fields a module adds to one of the economy's kinds (`business`, `account`, `trust`). */
  fields(kind: "business" | "account" | "trust" | "card" | "flow", fields: Record<string, FieldDef>): void;
  flows(source: FlowSource): void;
  amount(id: string, provider: AmountProvider): void;
  worth(source: WorthSource): void;
  sale(hook: SaleHook): void;
  view(section: ViewSection): void;
  summary(source: SummarySource): void;
}

export type FinanceModule = (r: FinanceRegistry) => void;

/** The hooks every module registered, as the foundation reads them. */
export interface FinanceHooks {
  fields: Record<string, Record<string, FieldDef>>;
  flows: FlowSource[];
  amounts: Record<string, AmountProvider>;
  worth: WorthSource[];
  sales: SaleHook[];
  views: ViewSection[];
  summaries: SummarySource[];
}
