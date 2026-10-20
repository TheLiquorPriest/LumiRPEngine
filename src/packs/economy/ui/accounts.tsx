// Money → Accounts (DESIGN §25): every account the party holds or shares, by kind,
// each opening its own page: its balance and what's available, its limit and rate, what's due, a
// loan's payment and months left, autopay, its cards (each with a page of its own), its owners,
// the books the level shows (statements, pending lines, holds and terms at the top level) and its
// own lines. Every control opens a page of its own with one button: the player pays, transfers,
// sets autopay, takes cash out and puts it in, and freezes, unfreezes, reports lost and replaces
// cards, each an in-world action; the GM adds or takes money, sets the status, autopay, card states
// and every declared field, releases holds and closes an account. How the party pays (its payment
// tiers) ends the section.

import { useState } from "preact/hooks";
import { ACCOUNT_STATUSES, AUTOPAY_MODES, CARD_STATES, CLASS_TRAITS, type AccountView, type AutopayMode, type CardState, type CardView, type FinanceView, type PayTier } from "../../../shared/finance";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Button, Empty, IdText, List, ListRow, Meter, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import type { IconName } from "../../../frontend/icons";
import { ActionPage, AmountField, AmountPage, ChoiceField, SelectField, type Choice } from "./forms";
import type { GmControls, HubControls, PlayerControls, SectionProps } from "./hub";
import { accountBlocks, accountControls, accountGroups, cardControls, cardLimitsShown, groupOf, paySources, transferTargets, utilisation, type AccountGroup } from "./layout";
import { FieldsPage, OwnerRows, TxnRows } from "./lines";
import { actionPage, Controls, detailPage, Hero, MoneyPage, Note, type HubNav, type HubPages } from "./nav";
import { PayTiersEditor, tierText } from "./pay-prefs";
import { accountStatusOps, amountOf, autopayAction, autopayOps, cardAction, cashAction, closeAccountOps, payCardAction, payPrefsAction, payPrefsOps, releaseHoldOps, transferAction, type CardChange } from "./requests";

const GROUP_ICON: Readonly<Record<AccountGroup, IconName>> = { cash: "wallet", banking: "bank", credit: "card", loans: "receipt", investing: "layers" };

const CARD_CHANGE: Readonly<Record<CardChange, { go: string; title: string; icon: IconName }>> = {
  freeze: { go: "Freeze", title: "Freeze the card", icon: "lock" },
  unfreeze: { go: "Unfreeze", title: "Unfreeze the card", icon: "check" },
  lost: { go: "Report lost", title: "Report it lost", icon: "alert" },
  replace: { go: "Replace", title: "Replace the card", icon: "refresh" },
};

const AUTOPAY_LABEL: Readonly<Record<AutopayMode, string>> = { none: "Off", minimum: "The minimum due", statement: "The statement balance", full: "The whole balance", fixed: "A fixed amount" };

/** Autopay in words: "The minimum due, from Checking". */
function autopayText(autopay: NonNullable<AccountView["autopay"]>, currency: WorldCurrency): string {
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

/** A card's state as a badge: frozen warns, lost and cancelled are problems. */
function stateBadge(state: CardState) {
  return <Badge tone={state === "active" ? "neutral" : state === "frozen" ? "warn" : "neg"}>{humanize(state)}</Badge>;
}

/** A card in a line: its network and last digits, and whose hands it's in when they aren't the party's. */
function cardLine(view: FinanceView, card: CardView): string {
  return [humanize(card.network), card.last4 ? `··${card.last4}` : null, card.holderId === view.party ? null : `held by ${card.holder}`].filter((s) => s !== null).join(" · ");
}

/** Any card the view shows: the party's own, or one on an account of theirs in someone else's hands. */
function findCard(view: FinanceView, id: string | undefined): CardView | null {
  return view.cards.find((c) => c.id === id) ?? view.accounts.flatMap((a) => a.cards).find((c) => c.id === id) ?? null;
}

/** Whether the party's payment tiers show: from Money 2, where payment preferences run for them or they have some. */
function payPrefsShown(view: FinanceView): boolean {
  return view.level >= 2 && (view.features.includes("payment_prefs") || view.payPrefs.length > 0);
}

/** Ways of paying a tier can name: the party's cards and the accounts it may pay from. */
function payUses(view: FinanceView): Choice[] {
  return [...view.cards.filter((c) => c.state === "active").map((c) => ({ value: c.id, label: c.name })), ...paySources(view).map((a) => ({ value: a.id, label: a.name }))];
}

// ---------------------------------------------------------------- the section

function AccountRow(props: { account: AccountView; currency: WorldCurrency; onOpen(): void }) {
  const a = props.account;
  const fmt = (cents: number): string => formatMoney(cents, props.currency);
  const late = a.statements.some((s) => s.state === "late");
  const lost = a.cards.some((c) => c.state === "lost");
  return (
    <ListRow
      icon={GROUP_ICON[groupOf(a)]}
      title={a.name}
      subtitle={[a.classLabel || CLASS_TRAITS[a.class].label, a.institution, a.due ? `${a.due.label} ${fmt(a.due.cents)}, ${a.due.at}` : null].filter((s) => s !== null && s !== "").join(" · ")}
      id={a.id}
      badge={a.status !== "open" ? <Badge tone="warn">{humanize(a.status)}</Badge> : late ? <Badge tone="neg">Late</Badge> : lost ? <Badge tone="warn">Card lost</Badge> : undefined}
      value={fmt(a.cents)}
      valueTone={a.cents < 0 ? "neg" : undefined}
      chevron
      onClick={props.onOpen}
    />
  );
}

function CardRow(props: { view: FinanceView; card: CardView; onOpen(): void }) {
  return <ListRow icon="card" title={props.card.name} subtitle={cardLine(props.view, props.card)} id={props.card.id} badge={stateBadge(props.card.state)} chevron onClick={props.onOpen} />;
}

function PayPrefsSection(props: SectionProps) {
  const { view, controls, nav } = props;
  const uses = payUses(view);
  return (
    <Section
      title={controls.mode === "player" ? "How you pay" : "How they pay"}
      flush
      aside={
        <Button variant="ghost" size="sm" icon="edit" onClick={() => nav.open(actionPage("accounts", "pay-prefs"))}>
          Change
        </Button>
      }
    >
      {view.payPrefs.length === 0 ? (
        <Empty icon="card">The engine's defaults for their wealth and character.</Empty>
      ) : (
        <List>
          {view.payPrefs.map((t, i) => (
            <ListRow key={`${i}:${t.use}`} leading={<span class="lre-money-rank">{i + 1}</span>} title={tierText(t, uses, controls.currency)} />
          ))}
        </List>
      )}
    </Section>
  );
}

function AccountsPage(props: SectionProps) {
  const { view, controls, nav } = props;
  const groups = accountGroups(view.accounts);
  // Cards the party holds on someone else's account (an authorised user's) have no account page here.
  const loose = view.cards.filter((c) => !view.accounts.some((a) => a.id === c.account));
  return (
    <MoneyPage nav={nav} name="accounts" title="Accounts" subtitle={controls.mode === "gm" ? view.name : undefined}>
      {groups.length === 0 ? <Empty icon="bank">No accounts.</Empty> : null}
      {groups.map((g) => (
        <Section key={g.group} title={g.label} flush>
          <div data-lre-account-group={g.group}>
            <List>
              {g.accounts.map((a) => (
                <AccountRow key={a.id} account={a} currency={controls.currency} onOpen={() => nav.open(detailPage("account", a.id))} />
              ))}
            </List>
          </div>
        </Section>
      ))}
      {loose.length > 0 ? (
        <Section title="Cards on others' accounts" flush>
          <List>
            {loose.map((c) => (
              <CardRow key={c.id} view={view} card={c} onOpen={() => nav.open(detailPage("card", c.id))} />
            ))}
          </List>
        </Section>
      ) : null}
      {payPrefsShown(view) ? <PayPrefsSection {...props} /> : null}
    </MoneyPage>
  );
}

// ---------------------------------------------------------------- an account

function AccountPage(props: SectionProps & { account: AccountView }) {
  const { view, controls, nav, account: a } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const t = CLASS_TRAITS[a.class];
  const blocks = accountBlocks(view, a);
  const used = utilisation(a);
  const owed = t.liability && a.cents <= 0;
  const product = [a.product.label && a.product.label !== a.classLabel ? a.product.label : null, a.institution].filter((s) => s !== null && s !== "").join(" · ");
  const can = controls.mode === "player" ? accountControls(view, a) : [];
  const act = (action: string, ...within: string[]) => nav.open(actionPage("account", a.id, action, ...within));
  // Autopay is changed from its own row, the player's where they manage the account, the GM's wherever it's offered.
  const autopayOpens = a.autopay !== null && (controls.mode === "gm" || can.includes("autopay"));
  const details = [
    a.limit !== null ? <ListRow key="limit" title="Limit" subtitle={used !== null ? `${used}% used` : undefined} value={fmt(a.limit)} valueTone={used !== null && used > 30 ? "warn" : undefined} /> : null,
    a.aprPct !== null && t.liability ? <ListRow key="apr" title="Rate" value={`${a.aprPct}% APR`} /> : null,
    a.apyPct !== null && !t.liability ? <ListRow key="apy" title="Interest" value={`${a.apyPct}% APY`} /> : null,
    a.due ? <ListRow key="due" icon="calendar" title={a.due.label} subtitle={a.due.at} value={fmt(a.due.cents)} valueTone="warn" /> : null,
    a.loan ? <ListRow key="payment" title="Monthly payment" subtitle={`${a.loan.monthsLeft} month${a.loan.monthsLeft === 1 ? "" : "s"} left`} value={fmt(a.loan.payment)} /> : null,
    a.loan ? <ListRow key="payoff" title="To pay it off" value={fmt(a.loan.payoff)} /> : null,
    a.securedBy ? <ListRow key="secured" title="Secured by" value={a.securedBy.name} /> : null,
    a.autopay !== null ? <ListRow key="autopay" icon="refresh" title="Autopay" subtitle={autopayText(a.autopay, controls.currency)} chevron={autopayOpens} onClick={autopayOpens ? () => act("autopay") : undefined} /> : null,
  ].filter((row) => row !== null);
  const lines = a.transactions.filter((line) => line.accountId === a.id);
  return (
    <MoneyPage nav={nav} name="account" title={a.name} subtitle={[a.classLabel || t.label, product].filter((s) => s !== "").join(" · ")}>
      <IdText id={a.id} />
      <Hero label={t.liability ? (owed ? "Owed" : "In credit") : "Balance"} value={fmt(t.liability ? Math.abs(a.cents) : a.cents)} tone={a.cents < 0 ? "neg" : undefined} sub={blocks.available && a.available !== null ? `${fmt(a.available)} available` : undefined} badges={a.status !== "open" ? <Badge tone="warn">{humanize(a.status)}</Badge> : undefined}>
        {a.limit !== null && used !== null ? <Meter label={`${used}% of the limit used`} value={Math.min(used, 100)} max={100} tone={used > 30 ? "warn" : "accent"} /> : null}
      </Hero>
      {controls.mode === "player" ? (
        can.some((c) => c !== "autopay") ? (
          <Controls name={a.id}>
            {can.includes("pay") ? (
              <Button variant="primary" icon="coins" onClick={() => act("pay")}>
                Pay
              </Button>
            ) : null}
            {can.includes("transfer") ? (
              <Button icon="route" onClick={() => act("transfer")}>
                Transfer
              </Button>
            ) : null}
            {can.includes("withdraw") ? (
              <Button icon="wallet" onClick={() => act("withdraw")}>
                Withdraw cash
              </Button>
            ) : null}
            {can.includes("deposit") ? (
              <Button icon="bank" onClick={() => act("deposit")}>
                Deposit cash
              </Button>
            ) : null}
          </Controls>
        ) : null
      ) : (
        <Controls name={a.id}>
          <Button icon="plus" onClick={() => act("add")}>
            Add money
          </Button>
          <Button icon="minus" onClick={() => act("take")}>
            Take money
          </Button>
          <Button icon="sliders" onClick={() => act("status")}>
            Status
          </Button>
          <Button icon="list" onClick={() => act("fields")}>
            Account fields
          </Button>
          <Button variant="danger" icon="trash" onClick={() => act("close")}>
            Close
          </Button>
        </Controls>
      )}
      {details.length > 0 ? (
        <Section title="Details" flush>
          <List>{details}</List>
        </Section>
      ) : null}
      {a.cards.length > 0 ? (
        <Section title="Cards" flush>
          <List>
            {a.cards.map((c) => (
              <CardRow key={c.id} view={view} card={c} onOpen={() => nav.open(detailPage("card", c.id))} />
            ))}
          </List>
        </Section>
      ) : null}
      {blocks.owners ? (
        <Section title="Owners" flush>
          <List>
            <OwnerRows owners={a.owners} icon="user" />
          </List>
        </Section>
      ) : null}
      {blocks.statements ? (
        <Section title="Statements" flush>
          <List>
            {a.statements.map((s, i) => (
              <ListRow
                key={`${s.at}:${i}`}
                title={`Closed ${s.at}`}
                subtitle={[`due ${s.due}`, `minimum ${fmt(s.minimum)}`, `paid ${fmt(s.paid)}`, s.interest > 0 ? `interest ${fmt(s.interest)}` : null, s.fees > 0 ? `fees ${fmt(s.fees)}` : null, s.stage !== "current" ? `${humanize(s.stage)}${/^\d+$/.test(s.stage) ? " days late" : ""}` : null].filter((x) => x !== null).join(" · ")}
                badge={<Badge tone={s.state === "late" ? "neg" : s.state === "open" ? "warn" : "pos"}>{s.state === "minimum" ? "minimum paid" : s.state}</Badge>}
                value={fmt(s.closing)}
              />
            ))}
          </List>
        </Section>
      ) : null}
      {blocks.pending ? (
        <Section title="Pending" flush>
          <TxnRows lines={a.pending} max={blocks.transactions} currency={controls.currency} />
        </Section>
      ) : null}
      {blocks.holds ? (
        <Section title="Holds" flush>
          <List>
            {a.holds.map((h) => (
              <ListRow key={h.id} icon="lock" title={h.memo} subtitle={`${h.kind === "deposit" ? "deposit on hold" : "card payment held"} until ${h.until}`} value={fmt(h.cents)} chevron={controls.mode === "gm"} onClick={controls.mode === "gm" ? () => act("release", h.id) : undefined} />
            ))}
          </List>
        </Section>
      ) : null}
      {blocks.terms ? (
        <Section title="Terms" flush>
          <List>
            {a.terms.map((term) => (
              <ListRow key={term.label} title={term.label} value={term.value} />
            ))}
          </List>
        </Section>
      ) : null}
      <Section title="Transactions" flush>
        <TxnRows lines={lines} max={blocks.transactions} currency={controls.currency} />
      </Section>
    </MoneyPage>
  );
}

// ---------------------------------------------------------------- the player's account actions

/** A payment toward what's owed, from one of the party's accounts: the amount due, the whole balance, or an amount typed. */
function PayPage(props: { view: FinanceView; account: AccountView; controls: PlayerControls; nav: HubNav }) {
  const { account: a, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const sources = paySources(props.view).filter((x) => x.id !== a.id);
  const [from, setFrom] = useState(sources.find((x) => CLASS_TRAITS[x.class].transactional)?.id ?? sources[0]?.id ?? "");
  const [how, setHow] = useState<"due" | "all" | "other">(a.due ? "due" : "all");
  const [text, setText] = useState("");
  const typed = amountOf(text, controls.currency);
  const balance = Math.max(0, -a.cents);
  // The whole balance travels as no amount, so the engine pays what's owed when it runs.
  const cents = how === "due" && a.due ? a.due.cents : how === "other" ? typed : null;
  const problem = from === "" ? "Pick the account it's paid from." : how === "other" && typed === null ? (text.trim() === "" ? "Type the amount." : "Type an amount above zero.") : null;
  return (
    <ActionPage nav={props.nav} controls={controls} name="pay" title={`Pay ${a.name}`} subtitle={`${fmt(balance)} owed`} go={`Pay ${fmt(cents ?? balance)}`} problem={problem} submit={() => controls.act(payCardAction(a.id, from || null, cents))}>
      <SelectField label="From" value={from} options={sources.map((x) => ({ value: x.id, label: `${x.name} (${fmt(x.available ?? x.cents)})` }))} onChange={setFrom} />
      <ChoiceField
        label="How much"
        value={how}
        options={[...(a.due ? [{ value: "due", label: a.due.label, detail: `${fmt(a.due.cents)}, due ${a.due.at}` }] : []), { value: "all", label: "The whole balance", detail: fmt(balance) }, { value: "other", label: "Another amount" }]}
        onChange={(v) => setHow(v === "due" ? "due" : v === "other" ? "other" : "all")}
      />
      {how === "other" ? <AmountField label="Amount" value={text} currency={controls.currency} onInput={setText} invalid={text.trim() !== "" && typed === null} /> : null}
    </ActionPage>
  );
}

function TransferPage(props: { view: FinanceView; account: AccountView; controls: PlayerControls; nav: HubNav }) {
  const { account: a, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const targets = transferTargets(props.view, a.id);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const [text, setText] = useState("");
  const cents = amountOf(text, controls.currency);
  const problem = to === "" ? "Pick where it goes." : text.trim() !== "" && cents === null ? "Type an amount above zero." : null;
  return (
    <ActionPage nav={props.nav} controls={controls} name="transfer" title="Transfer" subtitle={`From ${a.name} · ${fmt(a.available ?? a.cents)} available`} go={cents !== null ? `Transfer ${fmt(cents)}` : "Transfer"} problem={problem} disabled={cents === null} submit={() => (cents === null ? Promise.resolve(false) : controls.act(transferAction(a.id, to, cents)))}>
      <SelectField label="To" value={to} options={targets.map((x) => ({ value: x.id, label: x.name }))} onChange={setTo} />
      <AmountField label="Amount" value={text} currency={controls.currency} onInput={setText} invalid={text.trim() !== "" && cents === null} />
    </ActionPage>
  );
}

/** Cash out of a bank account into the wallet, or in from it; where cash needs a machine or a branch, the engine says so if there's none where you are. */
function CashPage(props: { view: FinanceView; account: AccountView; controls: PlayerControls; nav: HubNav; kind: "withdraw" | "deposit" }) {
  const { view, account: a, controls, kind } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const cash = view.cash && "cents" in view.cash ? view.cash.cents : null;
  const bank = a.institution ?? "its bank";
  const machines = view.features.includes("atm");
  return (
    <AmountPage
      nav={props.nav}
      controls={controls}
      name={kind}
      title={kind === "withdraw" ? "Withdraw cash" : "Deposit cash"}
      subtitle={kind === "withdraw" ? `From ${a.name} · ${fmt(a.available ?? a.cents)} available` : `Into ${a.name}${cash !== null ? ` · ${fmt(cash)} in cash` : ""}`}
      label="Amount"
      go={kind === "withdraw" ? "Withdraw" : "Deposit"}
      help={machines ? (kind === "withdraw" ? `Where this world has bank branches or cash machines, you need one where you are: a branch of ${bank}, or a cash machine, which takes a card on this account (another bank's may charge a fee).` : `Where this world has bank branches or cash machines, you need one where you are: a branch of ${bank}, or one of its machines that takes deposits, which may hold the money for a few days.`) : undefined}
      submit={(cents) => (cents === null ? Promise.resolve(false) : controls.act(cashAction(kind, a.id, cents)))}
    />
  );
}

/** Autopay's mode, the account it pays from and a fixed amount: an action for the player, the account's fields for the GM. */
function AutopayPage(props: { view: FinanceView; account: AccountView; controls: HubControls; nav: HubNav }) {
  const { account: a, controls } = props;
  const was = a.autopay;
  const sources = paySources(props.view).filter((x) => x.id !== a.id && !CLASS_TRAITS[x.class].cash);
  const [mode, setMode] = useState<AutopayMode>(was?.mode ?? "none");
  const [from, setFrom] = useState<string>(was?.from ?? sources[0]?.id ?? "");
  const [amount, setAmount] = useState(was?.cents !== null && was?.cents !== undefined ? String(was.cents / 10 ** controls.currency.decimals) : "");
  const cents = mode === "fixed" ? amountOf(amount, controls.currency) : null;
  const problem = mode === "none" ? null : from === "" ? "Pick the account it pays from." : mode === "fixed" && cents === null ? "Type the amount it pays each month." : null;
  const submit = (): Promise<boolean> => {
    if (controls.mode === "player") return controls.act(autopayAction(a.id, mode, from || null, cents));
    const ops = autopayOps(a.id, was, mode, from || null, cents);
    return ops.length === 0 ? Promise.resolve(true) : controls.edit(ops);
  };
  return (
    <ActionPage nav={props.nav} controls={controls} name="autopay" title="Autopay" subtitle={a.name} go="Save autopay" problem={problem} submit={submit}>
      <ChoiceField label="Pays" value={mode} options={AUTOPAY_MODES.map((m) => ({ value: m, label: AUTOPAY_LABEL[m] }))} onChange={(v) => setMode(AUTOPAY_MODES.find((m) => m === v) ?? "none")} />
      {mode !== "none" ? <SelectField label="From" value={from} empty="Choose an account" options={sources.map((x) => ({ value: x.id, label: x.name }))} onChange={setFrom} /> : null}
      {mode === "fixed" ? <AmountField label="Amount each month" value={amount} currency={controls.currency} onInput={setAmount} invalid={amount.trim() !== "" && cents === null} /> : null}
    </ActionPage>
  );
}

// ---------------------------------------------------------------- the GM's account actions

function AdjustPage(props: { account: AccountView; controls: GmControls; nav: HubNav; take: boolean }) {
  const { account: a, controls, take } = props;
  return (
    <AmountPage
      nav={props.nav}
      controls={controls}
      name={take ? "take" : "add"}
      title={take ? "Take money" : "Add money"}
      subtitle={`${a.name} · ${formatMoney(a.cents, controls.currency)}`}
      label="Amount"
      go={take ? "Take" : "Add"}
      help="A correction against an outside account, so the books still balance."
      submit={(cents) => (cents === null ? Promise.resolve(false) : controls.edit([{ op: "adjust", account: a.id, cents: take ? -cents : cents }]))}
    />
  );
}

function StatusPage(props: { account: AccountView; controls: GmControls; nav: HubNav }) {
  const { account: a, controls } = props;
  const [status, setStatus] = useState<string>(a.status);
  return (
    <ActionPage nav={props.nav} controls={controls} name="status" title="Status" subtitle={a.name} go="Set the status" disabled={status === a.status} submit={() => controls.edit(accountStatusOps(a.id, status))}>
      <ChoiceField label="New status" value={status} options={ACCOUNT_STATUSES.map((s) => ({ value: s, label: humanize(s), detail: s === a.status ? "Now" : undefined }))} onChange={setStatus} />
    </ActionPage>
  );
}

function ClosePage(props: { account: AccountView; controls: GmControls; nav: HubNav }) {
  const { account: a, controls } = props;
  // The foundation closes only an account that holds and owes nothing (Add or Take money first).
  const problem = a.status === "closed" ? "It's closed already." : a.cents !== 0 ? "Empty it first: an account closes only when it holds and owes nothing." : null;
  return (
    <ActionPage nav={props.nav} controls={controls} name="close" title="Close the account" subtitle={a.name} go="Close" danger problem={problem} submit={() => controls.edit(closeAccountOps(a.id))}>
      <Note>Close {a.name}? Its cards are cancelled.</Note>
    </ActionPage>
  );
}

function ReleasePage(props: { account: AccountView; hold: AccountView["holds"][number]; controls: GmControls; nav: HubNav }) {
  const { account: a, hold: h, controls } = props;
  return (
    <ActionPage nav={props.nav} controls={controls} name="release" title="Release the hold" subtitle={a.name} go="Release" submit={() => controls.edit(releaseHoldOps(a.id, h.id))}>
      <Note>
        {h.memo}: {formatMoney(h.cents, controls.currency)} {h.kind === "deposit" ? "on hold" : "held"} until {h.until}. Release it now?
      </Note>
    </ActionPage>
  );
}

// ---------------------------------------------------------------- a card

function CardPage(props: SectionProps & { card: CardView }) {
  const { view, controls, nav, card } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const account = view.accounts.find((a) => a.id === card.account) ?? null;
  const limits = cardLimitsShown(view);
  const changes = controls.mode === "player" ? cardControls(view, card) : [];
  const act = (action: string) => nav.open(actionPage("card", card.id, action));
  return (
    <MoneyPage nav={nav} name="card" title={card.name} subtitle={cardLine(view, card)} actions={stateBadge(card.state)}>
      <IdText id={card.id} />
      {controls.mode === "player" ? (
        changes.length > 0 ? (
          <Controls name={card.id}>
            {changes.map((c) => (
              <Button key={c} variant={c === "lost" ? "danger" : "secondary"} icon={CARD_CHANGE[c].icon} onClick={() => act(c)}>
                {CARD_CHANGE[c].go}
              </Button>
            ))}
          </Controls>
        ) : null
      ) : (
        <Controls name={card.id}>
          <Button icon="sliders" onClick={() => act("state")}>
            State
          </Button>
          <Button icon="list" onClick={() => act("fields")}>
            Card fields
          </Button>
        </Controls>
      )}
      <Section title="Details" flush>
        <List>
          {account ? <ListRow icon="bank" title={account.name} subtitle="The account it pays from" chevron onClick={() => nav.open(detailPage("account", account.id))} /> : <ListRow icon="bank" title="Someone else's account" subtitle="The account it pays from" />}
          {card.holderId !== view.party ? <ListRow icon="user" title="Held by" value={card.holder} /> : null}
          {limits && card.dailyPurchaseLimit !== null ? <ListRow title="Spent today" value={`${fmt(card.spentToday)} of ${fmt(card.dailyPurchaseLimit)}`} /> : null}
          {limits && card.dailyAtmLimit !== null ? <ListRow title="Cash machines" value={`${fmt(card.dailyAtmLimit)} a day`} /> : null}
        </List>
      </Section>
    </MoneyPage>
  );
}

/** What each change does to a card, said on its page before it's sent (its confirmation). */
function changeText(change: CardChange, card: CardView, account: AccountView | null): string {
  switch (change) {
    case "freeze":
      return `${card.name} stops paying until it's unfrozen.`;
    case "unfreeze":
      return `${card.name} pays again.`;
    case "lost":
      return `Report ${card.name} lost? It stops working at once; you can ask for a replacement.`;
    case "replace":
      return `A new card${account ? ` on ${account.name}` : ""} takes its place, in the same hands, and ${card.name} is cancelled.`;
  }
}

function CardChangePage(props: { view: FinanceView; card: CardView; change: CardChange; controls: PlayerControls; nav: HubNav }) {
  const { card, change, controls } = props;
  return (
    <ActionPage nav={props.nav} controls={controls} name={`card-${change}`} title={CARD_CHANGE[change].title} subtitle={card.name} go={CARD_CHANGE[change].go} danger={change === "lost"} submit={() => controls.act(cardAction(card.id, change))}>
      <Note>{changeText(change, card, props.view.accounts.find((a) => a.id === card.account) ?? null)}</Note>
    </ActionPage>
  );
}

function CardStatePage(props: { card: CardView; controls: GmControls; nav: HubNav }) {
  const { card, controls } = props;
  const [state, setState] = useState<string>(card.state);
  return (
    <ActionPage nav={props.nav} controls={controls} name="card-state" title="Card state" subtitle={card.name} go="Set the state" disabled={state === card.state} submit={() => controls.edit([{ op: "set", entity: card.id, field: "state", value: state }])}>
      <ChoiceField label="New state" value={state} options={CARD_STATES.map((s) => ({ value: s, label: humanize(s), detail: s === card.state ? "Now" : undefined }))} onChange={setState} />
    </ActionPage>
  );
}

// ---------------------------------------------------------------- how the party pays

function PayPrefsPage(props: SectionProps) {
  const { view, controls, nav } = props;
  const [draft, setDraft] = useState<PayTier[]>(() => [...view.payPrefs]);
  const categories = [...new Set([...(view.overview?.cashFlow?.byCategory ?? []).map((b) => b.category), ...view.recent.flatMap((t) => (t.category ? [t.category] : []))])].sort();
  return (
    <ActionPage nav={nav} controls={controls} name="pay-prefs" title={controls.mode === "player" ? "How you pay" : "How they pay"} subtitle={controls.mode === "gm" ? view.name : undefined} go="Save" submit={() => (controls.mode === "player" ? controls.act(payPrefsAction(draft)) : controls.edit(payPrefsOps(view.party, draft)))}>
      <PayTiersEditor value={draft} uses={payUses(view)} categories={categories} currency={controls.currency} onChange={setDraft} />
    </ActionPage>
  );
}

// ---------------------------------------------------------------- pages

/** An account's action page, as its mode allows it now; null for one it doesn't (the router shows it gone). */
function accountActionPage(props: SectionProps, a: AccountView, action: string | undefined, within: string | undefined) {
  const { view, controls, nav } = props;
  if (controls.mode === "player") {
    const can = accountControls(view, a);
    switch (action) {
      case "pay":
        return can.includes("pay") ? <PayPage view={view} account={a} controls={controls} nav={nav} /> : null;
      case "transfer":
        return can.includes("transfer") ? <TransferPage view={view} account={a} controls={controls} nav={nav} /> : null;
      case "autopay":
        return can.includes("autopay") ? <AutopayPage view={view} account={a} controls={controls} nav={nav} /> : null;
      case "withdraw":
      case "deposit":
        return can.includes(action) ? <CashPage view={view} account={a} controls={controls} nav={nav} kind={action} /> : null;
      default:
        return null;
    }
  }
  switch (action) {
    case "add":
    case "take":
      return <AdjustPage account={a} controls={controls} nav={nav} take={action === "take"} />;
    case "autopay":
      return a.autopay !== null ? <AutopayPage view={view} account={a} controls={controls} nav={nav} /> : null;
    case "status":
      return <StatusPage account={a} controls={controls} nav={nav} />;
    case "fields":
      return <FieldsPage nav={nav} controls={controls} name="account-fields" title="Account fields" entity={a.id} subtitle={a.name} />;
    case "close":
      return <ClosePage account={a} controls={controls} nav={nav} />;
    case "release": {
      const hold = a.holds.find((h) => h.id === within);
      return hold ? <ReleasePage account={a} hold={hold} controls={controls} nav={nav} /> : null;
    }
    default:
      return null;
  }
}

/** A card's action page, as its mode allows it now; null for one it doesn't. */
function cardActionPage(props: SectionProps, card: CardView, action: string | undefined) {
  const { view, controls, nav } = props;
  if (controls.mode === "player") {
    const change = cardControls(view, card).find((c) => c === action);
    return change ? <CardChangePage view={view} card={card} change={change} controls={controls} nav={nav} /> : null;
  }
  if (action === "state") return <CardStatePage card={card} controls={controls} nav={nav} />;
  if (action === "fields") return <FieldsPage nav={nav} controls={controls} name="card-fields" title="Card fields" entity={card.id} subtitle={card.name} />;
  return null;
}

/** Accounts' pages: the section with how the party pays, each account and card, and each control's page. What the view no longer holds, or the mode may not do, draws nothing (gone). */
export const accountPages: HubPages = {
  heads: ["accounts", "account", "card"],
  render(page, props) {
    const [head, id, action, within] = page.path;
    if (head === "accounts") {
      if (page.type === "section") return <AccountsPage {...props} />;
      return id === "pay-prefs" && payPrefsShown(props.view) ? <PayPrefsPage {...props} /> : null;
    }
    if (head === "account") {
      const account = props.view.accounts.find((a) => a.id === id);
      if (!account) return null;
      return page.type === "detail" ? <AccountPage {...props} account={account} /> : accountActionPage(props, account, action, within);
    }
    const card = findCard(props.view, id);
    if (!card) return null;
    return page.type === "detail" ? <CardPage {...props} card={card} /> : cardActionPage(props, card, action);
  },
};
