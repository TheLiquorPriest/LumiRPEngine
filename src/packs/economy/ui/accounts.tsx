// Money → Accounts (DESIGN §25): every account the party holds or shares, by kind, each with its
// balance and what's available, its cards, and the books the level shows (terms, statements,
// pending lines and holds at the top level). The player pays, transfers, sets autopay, takes cash
// out and puts it in, and freezes, reports and replaces cards, each an in-world action; the GM adds
// or takes money, sets the status, autopay, card states and every declared field, and closes it.

import { useState } from "preact/hooks";
import { ACCOUNT_STATUSES, AUTOPAY_MODES, CARD_STATES, CLASS_TRAITS, type AccountView, type AutopayMode, type CardView, type FinanceView, type PayTier } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { Card, Empty, Row } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import { AmountField, Reveal, SelectField, type Choice } from "./forms";
import type { HubControls, SectionProps } from "./hub";
import { accountBlocks, accountControls, accountGroups, cardControls, groupOf, paySources, transferTargets, utilisation, type AccountGroup } from "./layout";
import { AmountAction, EntityFields, TxnRows } from "./lines";
import { PayTiersEditor, tierText } from "./pay-prefs";
import { accountStatusOps, amountOf, autopayAction, autopayOps, cardAction, cashAction, closeAccountOps, payCardAction, payPrefsAction, payPrefsOps, releaseHoldOps, transferAction, type CardChange } from "./requests";

const GROUP_ICON: Readonly<Record<AccountGroup, string>> = { cash: "💵", banking: "🏦", credit: "💳", loans: "📄", investing: "📈" };

const CARD_CHANGE_LABEL: Readonly<Record<CardChange, string>> = { freeze: "Freeze", unfreeze: "Unfreeze", lost: "Report lost", replace: "Replace" };

/** Autopay in words: "The minimum, from Checking". */
export function autopayText(autopay: NonNullable<AccountView["autopay"]>, currency: WorldCurrency): string {
  const from = autopay.fromName ? `, from ${autopay.fromName}` : "";
  switch (autopay.mode) {
    case "none":
      return "Off";
    case "minimum":
      return `The minimum due${from}`;
    case "statement":
      return `The statement balance${from}`;
    case "full":
      return `The whole balance${from}`;
    case "fixed":
      return `${autopay.cents !== null ? formatMoney(autopay.cents, currency) : "A fixed amount"}${from}`;
  }
}

const AUTOPAY_LABEL: Readonly<Record<AutopayMode, string>> = { none: "Off", minimum: "The minimum due", statement: "The statement balance", full: "The whole balance", fixed: "A fixed amount" };

/** Autopay's mode, the account it pays from and a fixed amount: an action for the player, the account's fields for the GM. */
function AutopayForm(props: { view: FinanceView; account: AccountView; controls: HubControls; onDone(): void }) {
  const { account, controls } = props;
  const was = account.autopay;
  const sources = paySources(props.view).filter((a) => a.id !== account.id && !CLASS_TRAITS[a.class].cash);
  const [mode, setMode] = useState<AutopayMode>(was?.mode ?? "none");
  const [from, setFrom] = useState<string>(was?.from ?? sources[0]?.id ?? "");
  const [amount, setAmount] = useState(was?.cents !== null && was?.cents !== undefined ? String(was.cents / 10 ** controls.currency.decimals) : "");
  const cents = mode === "fixed" ? amountOf(amount, controls.currency) : null;
  const ok = mode === "none" || (from !== "" && (mode !== "fixed" || cents !== null));
  const submit = async (): Promise<boolean> => {
    if (controls.mode === "player") return controls.act(autopayAction(account.id, mode, from || null, cents));
    const ops = autopayOps(account.id, was, mode, from || null, cents);
    return ops.length === 0 || controls.edit(ops);
  };
  return (
    <form
      class="lre-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (ok) void submit().then((done) => done && props.onDone());
      }}
    >
      <SelectField label="Pays" value={mode} options={AUTOPAY_MODES.map((m) => ({ value: m, label: AUTOPAY_LABEL[m] }))} onChange={(v) => setMode(AUTOPAY_MODES.find((m) => m === v) ?? "none")} />
      {mode !== "none" ? <SelectField label="From" value={from} empty="Choose an account" options={sources.map((a) => ({ value: a.id, label: a.name }))} onChange={setFrom} /> : null}
      {mode === "fixed" ? <AmountField label="Amount each month" value={amount} currency={controls.currency} onInput={setAmount} invalid={amount.trim() !== "" && cents === null} /> : null}
      <button type="submit" class="lre-btn primary" disabled={controls.busy || !ok}>
        Save autopay
      </button>
    </form>
  );
}

/** A payment toward what's owed: from one of the party's accounts, the amount typed or the whole balance. */
function PayForm(props: { view: FinanceView; account: AccountView; controls: Extract<HubControls, { mode: "player" }>; onDone(): void }) {
  const { account, controls } = props;
  const sources = paySources(props.view).filter((a) => a.id !== account.id);
  const [from, setFrom] = useState(sources.find((a) => CLASS_TRAITS[a.class].transactional)?.id ?? sources[0]?.id ?? "");
  return (
    <div class="lre-stack">
      {account.due ? (
        <button type="button" class="lre-btn" disabled={controls.busy || from === ""} onClick={() => void controls.act(payCardAction(account.id, from || null, account.due?.cents ?? null)).then((ok) => ok && props.onDone())}>
          Pay {account.due.label.toLowerCase()} ({formatMoney(account.due.cents, controls.currency)})
        </button>
      ) : null}
      <SelectField label="From" value={from} options={sources.map((a) => ({ value: a.id, label: `${a.name} (${formatMoney(a.available ?? a.cents, controls.currency)})` }))} onChange={setFrom} />
      <AmountAction label="Amount" go="Pay" optional="The whole balance" currency={controls.currency} busy={controls.busy || from === ""} submit={(cents) => controls.act(payCardAction(account.id, from || null, cents))} onDone={props.onDone} />
    </div>
  );
}

function TransferForm(props: { view: FinanceView; account: AccountView; controls: Extract<HubControls, { mode: "player" }>; onDone(): void }) {
  const { account, controls } = props;
  const targets = transferTargets(props.view, account.id);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  return (
    <div class="lre-stack">
      <SelectField label="To" value={to} options={targets.map((a) => ({ value: a.id, label: a.name }))} onChange={setTo} />
      <AmountAction label="Amount" go="Transfer" currency={controls.currency} busy={controls.busy || to === ""} submit={(cents) => (cents === null ? Promise.resolve(false) : controls.act(transferAction(account.id, to, cents)))} onDone={props.onDone} />
    </div>
  );
}

function CardRow(props: { view: FinanceView; card: CardView; controls: HubControls }) {
  const app = useApp();
  const { view, card, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const limits = accountBlocks(view, view.accounts.find((a) => a.id === card.account) ?? view.accounts[0] ?? emptyAccount(card.account)).cardLimits;
  const sub = [humanize(card.network), card.last4 ? `··${card.last4}` : null, card.holderId === view.party ? null : `held by ${card.holder}`, limits && card.dailyPurchaseLimit !== null ? `${fmt(card.spentToday)} of ${fmt(card.dailyPurchaseLimit)} spent today` : null, limits && card.dailyAtmLimit !== null ? `cash machines ${fmt(card.dailyAtmLimit)} a day` : null].filter((s) => s !== null);
  const tone = card.state === "active" ? "lre-badge" : card.state === "frozen" ? "lre-badge warn" : "lre-badge neg";
  const change = (c: CardChange) => async () => {
    if (controls.mode !== "player") return;
    if (c === "lost" && !(await app.host.confirm("Report lost", `Report ${card.name} lost? It stops working at once; you can ask for a replacement.`, "warning", "Report lost"))) return;
    await controls.act(cardAction(card.id, c));
  };
  return (
    <div class="lre-stack" data-lre-card={card.id}>
      <Row k={`💳 ${card.name}`} sub={sub.join(" · ")} v={<span class={tone}>{humanize(card.state)}</span>} />
      {controls.mode === "player" ? (
        <div class="lre-inline">
          {cardControls(view, card).map((c) => (
            <button key={c} type="button" class={c === "lost" ? "lre-btn small danger" : "lre-btn small"} disabled={controls.busy} onClick={() => void change(c)()}>
              {CARD_CHANGE_LABEL[c]}
            </button>
          ))}
        </div>
      ) : (
        <div class="lre-stack">
          <SelectField label={`${card.name}: state`} value={card.state} options={CARD_STATES.map((s) => ({ value: s, label: humanize(s) }))} disabled={controls.busy} onChange={(v) => void controls.edit([{ op: "set", entity: card.id, field: "state", value: v }])} />
          <Reveal label="Card fields">{() => <EntityFields controls={controls} entity={card.id} />}</Reveal>
        </div>
      )}
    </div>
  );
}

/** A stand-in account for a card whose account the view doesn't list (another party's, which an authorised user holds a card on). */
function emptyAccount(id: EntityId): AccountView {
  return { id, name: id, class: "checking", classLabel: "", product: { id: "", label: "" }, institution: null, status: "open", cents: 0, available: null, owners: [], role: null, limit: null, aprPct: null, apyPct: null, terms: [], autopay: null, due: null, statements: [], cards: [], pending: [], holds: [], transactions: [], securedBy: null, loan: null };
}

function AccountCard(props: { view: FinanceView; account: AccountView; controls: HubControls }) {
  const app = useApp();
  const { view, account: a, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const t = CLASS_TRAITS[a.class];
  const blocks = accountBlocks(view, a);
  const used = utilisation(a);
  const owed = t.liability && a.cents <= 0;
  const detailLine = [a.product.label && a.product.label !== a.classLabel ? a.product.label : null, a.institution].filter((s) => s !== null && s !== "").join(" · ");
  return (
    <Card title={`${GROUP_ICON[groupOf(a)]} ${a.name}`} aside={<span class={a.status === "open" ? "lre-badge" : "lre-badge warn"}>{a.status === "open" ? a.classLabel || t.label : humanize(a.status)}</span>}>
      <Row k={t.liability ? (owed ? "Owed" : "In credit") : "Balance"} sub={detailLine || undefined} v={fmt(t.liability ? Math.abs(a.cents) : a.cents)} tone={(t.liability && a.cents < 0) || (!t.liability && a.cents < 0) ? "neg" : undefined} />
      {blocks.available && a.available !== null ? <Row k="Available" v={fmt(a.available)} /> : null}
      {a.limit !== null ? <Row k="Limit" sub={used !== null ? `${used}% used` : undefined} v={fmt(a.limit)} tone={used !== null && used > 30 ? "warn" : undefined} /> : null}
      {a.aprPct !== null && t.liability ? <Row k="Rate" v={`${a.aprPct}% APR`} /> : null}
      {a.apyPct !== null && !t.liability ? <Row k="Interest" v={`${a.apyPct}% APY`} /> : null}
      {a.due ? <Row k={a.due.label} sub={a.due.at} v={fmt(a.due.cents)} tone="warn" /> : null}
      {a.loan ? <Row k="Monthly payment" sub={`${a.loan.monthsLeft} month${a.loan.monthsLeft === 1 ? "" : "s"} left`} v={fmt(a.loan.payment)} /> : null}
      {a.loan ? <Row k="To pay it off" v={fmt(a.loan.payoff)} /> : null}
      {a.securedBy ? <Row k="Secured by" v={a.securedBy.name} /> : null}
      {a.autopay !== null ? <Row k="Autopay" v={autopayText(a.autopay, controls.currency)} /> : null}
      {blocks.owners ? (
        <>
          <div class="lre-h">Owners</div>
          {a.owners.map((o) => (
            <Row key={o.party} k={o.name} sub={humanize(o.role)} v={o.share > 0 ? `${Math.round(o.share * 10) / 10}%` : undefined} />
          ))}
        </>
      ) : null}
      {blocks.terms ? (
        <>
          <div class="lre-h">Terms</div>
          {a.terms.map((term) => (
            <Row key={term.label} k={term.label} v={term.value} />
          ))}
        </>
      ) : null}
      {blocks.statements ? (
        <>
          <div class="lre-h">Statements</div>
          {a.statements.map((s, i) => (
            <Row
              key={`${s.at}:${i}`}
              k={`Closed ${s.at}`}
              sub={[`due ${s.due}`, `minimum ${fmt(s.minimum)}`, `paid ${fmt(s.paid)}`, s.interest > 0 ? `interest ${fmt(s.interest)}` : null, s.fees > 0 ? `fees ${fmt(s.fees)}` : null, s.stage !== "current" ? `${humanize(s.stage)}${/^\d+$/.test(s.stage) ? " days late" : ""}` : null].filter((x) => x !== null).join(" · ")}
              v={
                <span class="lre-inline">
                  {fmt(s.closing)}
                  <span class={s.state === "late" ? "lre-badge neg" : s.state === "open" ? "lre-badge warn" : "lre-badge pos"}>{s.state === "minimum" ? "minimum paid" : s.state}</span>
                </span>
              }
            />
          ))}
        </>
      ) : null}
      {blocks.pending ? (
        <>
          <div class="lre-h">Pending</div>
          <TxnRows lines={a.pending} max={blocks.transactions} currency={controls.currency} />
        </>
      ) : null}
      {blocks.holds ? (
        <>
          <div class="lre-h">Holds</div>
          {a.holds.map((h) => (
            <Row
              key={h.id}
              k={h.memo}
              sub={`${h.kind === "deposit" ? "deposit on hold" : "card payment held"} until ${h.until}`}
              v={
                <span class="lre-inline">
                  {fmt(h.cents)}
                  {controls.mode === "gm" ? (
                    <button type="button" class="lre-btn small" disabled={controls.busy} onClick={() => void controls.edit(releaseHoldOps(a.id, h.id))}>
                      Release
                    </button>
                  ) : null}
                </span>
              }
            />
          ))}
        </>
      ) : null}
      {a.cards.map((c) => (
        <CardRow key={c.id} view={view} card={c} controls={controls} />
      ))}
      <div class="lre-h">Transactions</div>
      <TxnRows lines={a.transactions} max={blocks.transactions} currency={controls.currency} />
      {controls.mode === "player" ? (
        <div class="lre-inline" data-lre-account-controls={a.id}>
          {accountControls(view, a).map((c) => {
            switch (c) {
              case "pay":
                return <Reveal key={c} label="Pay" primary>{(close) => <PayForm view={view} account={a} controls={controls} onDone={close} />}</Reveal>;
              case "transfer":
                return <Reveal key={c} label="Transfer">{(close) => <TransferForm view={view} account={a} controls={controls} onDone={close} />}</Reveal>;
              case "autopay":
                return <Reveal key={c} label="Autopay">{(close) => <AutopayForm view={view} account={a} controls={controls} onDone={close} />}</Reveal>;
              case "withdraw":
              case "deposit":
                return (
                  <Reveal key={c} label={c === "withdraw" ? "Withdraw cash" : "Deposit cash"}>
                    {(close) => <AmountAction label="Amount" go={c === "withdraw" ? "Withdraw" : "Deposit"} currency={controls.currency} busy={controls.busy} submit={(cents) => (cents === null ? Promise.resolve(false) : controls.act(cashAction(c, a.id, cents)))} onDone={close} />}
                  </Reveal>
                );
            }
          })}
        </div>
      ) : (
        <div class="lre-stack" data-lre-account-controls={a.id}>
          <div class="lre-inline">
            <Reveal label="Add money">{(close) => <AmountAction label="Amount" go="Add" currency={controls.currency} busy={controls.busy} submit={(cents) => (cents === null ? Promise.resolve(false) : controls.edit([{ op: "adjust", account: a.id, cents }]))} onDone={close} />}</Reveal>
            <Reveal label="Take money">{(close) => <AmountAction label="Amount" go="Take" currency={controls.currency} busy={controls.busy} submit={(cents) => (cents === null ? Promise.resolve(false) : controls.edit([{ op: "adjust", account: a.id, cents: -cents }]))} onDone={close} />}</Reveal>
            {a.autopay !== null ? <Reveal label="Autopay">{(close) => <AutopayForm view={view} account={a} controls={controls} onDone={close} />}</Reveal> : null}
            <button
              type="button"
              class="lre-btn small danger"
              // The foundation closes only an account that holds and owes nothing (Add or Take money first).
              disabled={controls.busy || a.status === "closed" || a.cents !== 0}
              title={a.cents !== 0 ? "Empty it first: an account closes only when it holds and owes nothing." : undefined}
              onClick={() =>
                void (async () => {
                  if (await app.host.confirm("Close account", `Close ${a.name}? Its cards are cancelled.`, "danger", "Close")) await controls.edit(closeAccountOps(a.id));
                })()
              }
            >
              Close
            </button>
          </div>
          <SelectField label={`${a.name}: status`} value={a.status} options={ACCOUNT_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} disabled={controls.busy} onChange={(v) => void controls.edit(accountStatusOps(a.id, v))} />
          <Reveal label="Account fields">{() => <EntityFields controls={controls} entity={a.id} />}</Reveal>
        </div>
      )}
    </Card>
  );
}

/** Ways of paying a tier can name: the party's cards and the accounts it may pay from. */
export function payUses(view: FinanceView): Choice[] {
  return [...view.cards.filter((c) => c.state === "active").map((c) => ({ value: c.id, label: c.name })), ...paySources(view).map((a) => ({ value: a.id, label: a.name }))];
}

function PayPrefsCard(props: SectionProps) {
  const { view, controls } = props;
  const [draft, setDraft] = useState<PayTier[] | null>(null);
  const uses = payUses(view);
  const categories = [...new Set([...(view.overview?.cashFlow?.byCategory ?? []).map((b) => b.category), ...view.recent.flatMap((t) => (t.category ? [t.category] : []))])].sort();
  const save = async (tiers: PayTier[]): Promise<void> => {
    const ok = controls.mode === "player" ? await controls.act(payPrefsAction(tiers)) : await controls.edit(payPrefsOps(view.party, tiers));
    if (ok) setDraft(null);
  };
  return (
    <Card title="How they pay" aside={draft === null ? <button type="button" class="lre-btn small" onClick={() => setDraft([...view.payPrefs])}>Change</button> : null}>
      {draft === null ? (
        view.payPrefs.length === 0 ? (
          <Empty>The engine's defaults for their wealth and character.</Empty>
        ) : (
          view.payPrefs.map((t, i) => <Row key={`${i}:${t.use}`} k={`${i + 1}. ${tierText(t, uses, controls.currency)}`} />)
        )
      ) : (
        <>
          <PayTiersEditor value={draft} uses={uses} categories={categories} currency={controls.currency} onChange={setDraft} />
          <div class="lre-inline">
            <button type="button" class="lre-btn primary" disabled={controls.busy} onClick={() => void save(draft)}>
              Save
            </button>
            <button type="button" class="lre-btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

export function AccountsSection(props: SectionProps) {
  const { view, controls } = props;
  const groups = accountGroups(view.accounts);
  // Cards the party holds on someone else's account (an authorised user's) have no account card here.
  const loose = view.cards.filter((c) => !view.accounts.some((a) => a.id === c.account));
  return (
    <>
      {groups.length === 0 ? <Empty>No accounts.</Empty> : null}
      {groups.map((g) => (
        <section key={g.group} class="lre-stack" data-lre-account-group={g.group}>
          <div class="lre-h">{g.label}</div>
          {g.accounts.map((a) => (
            <AccountCard key={a.id} view={view} account={a} controls={controls} />
          ))}
        </section>
      ))}
      {loose.length > 0 ? (
        <Card title="Cards on others' accounts">
          {loose.map((c) => (
            <CardRow key={c.id} view={view} card={c} controls={controls} />
          ))}
        </Card>
      ) : null}
      {view.level >= 2 && (view.features.includes("payment_prefs") || view.payPrefs.length > 0) ? <PayPrefsCard {...props} /> : null}
    </>
  );
}
