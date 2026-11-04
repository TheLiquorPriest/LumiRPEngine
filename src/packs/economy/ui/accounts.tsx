// Money → Accounts (DESIGN §25, ORG-SPEC §5.1): Move money (Transfer, Pay a card or loan, Cash
// out, Cash in), every account the party holds or shares by kind, the cards it holds on others'
// accounts, Activity (every line across its accounts, by account and category, with pending lines
// and holds where holds run) and how it pays. Each account opens its own page: its balance and
// what's available, its limit, what's due, a loan's payment and months left, autopay, its interest
// (the rate, how it's worked out, this year's, the last and the next), its cards, its owners, the
// books the level shows (statements, pending lines, holds and terms at the top level) and its own
// lines. Every control opens a page of its own with one button: the player pays, transfers, sets
// autopay, takes cash out and puts it in, sets up a standing payment from it, and freezes,
// unfreezes, reports lost and replaces a card (on the card's own page, the change picked there),
// each an in-world action; the GM adds or takes money, sets the status, autopay, card states and
// every declared field, releases holds, closes an account and opens one for an organization. The same pages serve a business's
// own accounts, which its owner manages from the business's Money in Orgs (`managed`): autopay,
// cards and standing payments, but no spending, which follows the party's own role on an account.

import { useState } from "preact/hooks";
import { ACCOUNT_STATUSES, AUTOPAY_MODES, CARD_STATES, CLASS_TRAITS, DEFAULT_ACCOUNT_PRODUCT, type AccountClass, type AccountView, type AutopayMode, type CardState, type CardView, type FinanceView, type InterestView, type PartyKind, type PayTier } from "../../../shared/finance";
import type { EditOp } from "../../../shared/protocol";
import { formatMoney, type WorldCurrency } from "../../../shared/world";
import { Badge, Button, Empty, IdText, List, ListRow, Meter, Section } from "../../../frontend/components";
import { humanize } from "../../../frontend/format";
import type { IconName } from "../../../frontend/icons";
import { ActionPage, AmountField, AmountPage, amountProblem, ChoiceField, SelectField, TextField, unchangedProblem, type Choice } from "./forms";
import type { GmControls, PlayerControls, SectionProps, SegmentProps } from "./hub";
import { accountBlocks, accountControls, accountGroups, activityChoices, activityOf, autopaySources, businessAccounts, cardControls, cardLimitsShown, findAccount, findCard, flowSources, gmAutopaySources, groupOf, MOVE_CONTROLS, moveFrom, overviewBlocks, ownBusiness, paySources, possessive, transferTargets, utilisation, type AccountGroup, type MoveControl } from "./layout";
import { FieldsPage, MoneyFilters, OwnerRows, TxnRows } from "./lines";
import { actionPage, Controls, detailPage, Hero, MoneyPage, Note, type HubNav, type HubPages } from "./nav";
import { PayTiersEditor, tierText } from "./pay-prefs";
import { accountStatusOps, amountOf, autopayAction, autopayOps, cardAction, cashAction, closeAccountOps, payCardAction, payPrefsAction, payPrefsOps, releaseHoldOps, transferAction, type CardChange } from "./requests";

const GROUP_ICON: Readonly<Record<AccountGroup, IconName>> = { cash: "wallet", banking: "bank", credit: "card", loans: "receipt", investing: "layers" };

const CARD_CHANGE: Readonly<Record<CardChange, { go: string; title: string }>> = {
  freeze: { go: "Freeze", title: "Freeze the card" },
  unfreeze: { go: "Unfreeze", title: "Unfreeze the card" },
  lost: { go: "Report lost", title: "Report it lost" },
  replace: { go: "Replace", title: "Replace the card" },
};

/** Move money's controls (ORG-SPEC §5.1): what each is called on its button, its icon, and what its page picks the account as. */
const MOVE: Readonly<Record<MoveControl, { label: string; icon: IconName; pick: string }>> = {
  transfer: { label: "Transfer", icon: "route", pick: "From" },
  pay: { label: "Pay a card or loan", icon: "coins", pick: "Pay off" },
  withdraw: { label: "Cash out", icon: "wallet", pick: "From" },
  deposit: { label: "Cash in", icon: "bank", pick: "Into" },
};

const AUTOPAY_LABEL: Readonly<Record<AutopayMode, string>> = { none: "Off", minimum: "The minimum due", statement: "The statement balance", full: "The whole balance", fixed: "A fixed amount" };

/** Autopay in words: "The minimum due, from Checking". */
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

/** A card's state as a badge: frozen warns, lost and cancelled are problems. */
function stateBadge(state: CardState) {
  return <Badge tone={state === "active" ? "neutral" : state === "frozen" ? "warn" : "neg"}>{humanize(state)}</Badge>;
}

/** A card in a line: its network and last digits, and whose hands it's in when they aren't the party's. */
function cardLine(view: FinanceView, card: CardView): string {
  return [humanize(card.network), card.last4 ? `··${card.last4}` : null, card.holderId === view.party ? null : `held by ${card.holder}`].filter((s) => s !== null).join(" · ");
}

/** Whether the party's payment tiers show, with their Change: a person's, where payment preferences run for them, as setting them does (the view sends tiers only there). */
function payPrefsShown(view: FinanceView): boolean {
  return view.partyKind === "person" && view.features.includes("payment_prefs");
}

/** Ways of paying a tier can name: the party's cards and the accounts it may pay from. */
function payUses(view: FinanceView): Choice[] {
  return [...view.cards.filter((c) => c.state === "active").map((c) => ({ value: c.id, label: c.name })), ...paySources(view).map((a) => ({ value: a.id, label: a.name }))];
}

// ---------------------------------------------------------------- the segment

/** An account as a row: its kind and bank, then what's due, else a loan's payment and months left; its balance; it opens the account's page. */
export function AccountRow(props: { account: AccountView; currency: WorldCurrency; onOpen(): void }) {
  const a = props.account;
  const fmt = (cents: number): string => formatMoney(cents, props.currency);
  const late = a.statements.some((s) => s.state === "late");
  const lost = a.cards.some((c) => c.state === "lost");
  const owing = a.due ? `${a.due.label} ${fmt(a.due.cents)}, ${a.due.at}` : a.loan ? `${fmt(a.loan.payment)} a month, ${a.loan.monthsLeft} month${a.loan.monthsLeft === 1 ? "" : "s"} left` : null;
  return (
    <ListRow
      icon={GROUP_ICON[groupOf(a)]}
      title={a.name}
      subtitle={[a.classLabel || CLASS_TRAITS[a.class].label, a.institution, owing].filter((s) => s !== null && s !== "").join(" · ")}
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
        controls.mode !== "read" ? (
          <Button variant="ghost" size="sm" icon="edit" onClick={() => nav.open(actionPage("accounts", "pay-prefs"))}>
            Change
          </Button>
        ) : undefined
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

/** Activity: every line across the party's accounts, newest first, by direction, account and category as the filter picks, with what's still pending and the holds where holds run. */
function ActivitySection(props: SegmentProps) {
  const { view, controls, filter } = props;
  if (view.level < 2) return null;
  const choices = activityChoices(view);
  const shown = activityOf(view, filter);
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  return (
    <div class="lre-stack" data-lre-money-activity>
      <Section title="Activity" flush>
        {view.recent.length > 0 ? <MoneyFilters filter={filter} onFilter={props.onFilter} accounts={choices.accounts} categories={choices.categories} /> : null}
        <TxnRows lines={shown.lines} max={overviewBlocks(view).recent} currency={controls.currency} account />
      </Section>
      {shown.pending.length > 0 ? (
        <Section title="Pending" flush>
          <TxnRows lines={shown.pending} max={overviewBlocks(view).recent} currency={controls.currency} account />
        </Section>
      ) : null}
      {shown.holds.length > 0 ? (
        <Section title="Holds" flush>
          <List>
            {shown.holds.map(({ account, hold }) => (
              <ListRow key={hold.id} icon="lock" title={hold.memo} subtitle={`${account.name} · ${hold.kind === "deposit" ? "deposit on hold" : "card payment held"} until ${hold.until}`} value={fmt(hold.cents)} />
            ))}
          </List>
        </Section>
      ) : null}
    </div>
  );
}

/**
 * Accounts: Move money, each way the party may move it opening its page; the accounts by kind,
 * each opening its page; the cards the party holds on others' accounts; Activity; how it pays. A
 * business's own accounts in Orgs list those the reader holds or runs as the reader's own, and the
 * rest as the business's.
 */
export function AccountsSegment(props: SegmentProps) {
  const { view, controls, nav, reader } = props;
  const own = ownBusiness(view);
  const business = own && reader ? reader.view.businesses.find((b) => b.id === own.id) : undefined;
  const listed = business && reader ? businessAccounts(reader.view, business) : null;
  const accounts = listed ? [...listed.shown, ...view.accounts.filter((a) => listed.others.includes(a.id))] : view.accounts;
  const groups = accountGroups(accounts);
  // Cards the party holds on someone else's account (an authorised user's) have no account page here.
  const loose = view.cards.filter((c) => !view.accounts.some((a) => a.id === c.account));
  const moves = controls.mode === "player" ? MOVE_CONTROLS.filter((c) => moveFrom(view, c).length > 0) : [];
  return (
    <>
      {moves.length > 0 ? (
        <Section title="Move money">
          <Controls name="move">
            {moves.map((c) => (
              <Button key={c} icon={MOVE[c].icon} onClick={() => nav.open(actionPage("accounts", c))}>
                {MOVE[c].label}
              </Button>
            ))}
          </Controls>
        </Section>
      ) : null}
      {groups.length === 0 ? <Empty icon="bank">No accounts.</Empty> : null}
      {controls.mode === "gm" && view.partyKind !== "person" ? (
        <Controls name="open-account">
          <Button icon="bank" onClick={() => nav.open(actionPage("accounts", "open"))}>
            Open an account
          </Button>
        </Controls>
      ) : null}
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
      <ActivitySection {...props} />
      {payPrefsShown(view) ? <PayPrefsSection {...props} /> : null}
    </>
  );
}

/** An account's interest: what it earns or charges at what rate and how, what it came to this year, the last it posted and about what the next comes to. */
export function InterestSection(props: { interest: InterestView; currency: WorldCurrency }) {
  const i = props.interest;
  const fmt = (cents: number): string => formatMoney(cents, props.currency);
  const earns = i.way === "earns";
  return (
    <Section title="Interest" flush>
      <div data-lre-account-interest={i.way}>
        <List>
          <ListRow title={earns ? "Earns" : "Charges"} subtitle={i.basis} value={`${i.ratePct}% ${earns ? "APY" : "APR"}`} />
          <ListRow title={earns ? "Earned this year" : "Charged this year"} value={fmt(i.thisYear)} valueTone={i.thisYear > 0 ? (earns ? "pos" : "neg") : undefined} />
          {i.last ? <ListRow title={earns ? "Last paid" : "Last charged"} subtitle={i.last.at} value={fmt(i.last.cents)} /> : null}
          {i.next ? <ListRow title={earns ? "Next paid" : "Next charged"} subtitle={i.next.cents > 0 ? `${i.next.at}, if nothing changes before then` : `${i.next.at}: nothing, as things stand`} value={`about ${fmt(i.next.cents)}`} valueTone="muted" /> : null}
        </List>
      </div>
    </Section>
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
  // A standing payment from it opens the standing payment form with the account as From, where flows run and it may pay one.
  const newFlow = controls.mode === "player" && view.features.includes("flows") && flowSources(view).some((s) => s.id === a.id);
  // A business's own account the party manages for it without a role on it, which is why it offers nothing to spend.
  const runFor = a.role === null && a.manages ? (view.businesses.find((b) => b.managed.some((m) => m.id === a.id)) ?? null) : null;
  // Autopay is changed from its own row, the player's where they manage the account, the GM's wherever it's offered.
  const autopayOpens = a.autopay !== null && (controls.mode === "gm" || can.includes("autopay"));
  const details = [
    a.limit !== null ? <ListRow key="limit" title="Limit" subtitle={used !== null ? `${used}% used` : undefined} value={fmt(a.limit)} valueTone={used !== null && used > 30 ? "warn" : undefined} /> : null,
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
      {runFor ? <Note>{`${possessive(runFor.name, false)} own account, which ${controls.mode === "player" ? "you manage" : `${view.name} manages`} for the business.`}</Note> : null}
      {controls.mode === "player" && (can.some((c) => c !== "autopay") || newFlow) ? (
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
          {newFlow ? (
            <Button icon="refresh" onClick={() => nav.open(actionPage("flows", "new", a.id))}>
              New standing payment
            </Button>
          ) : null}
        </Controls>
      ) : null}
      {controls.mode === "gm" ? (
        <Controls name={a.id}>
          <Button icon="plus" onClick={() => act("add")}>
            {adjustWords(a).add}
          </Button>
          <Button icon="minus" onClick={() => act("take")}>
            {adjustWords(a).take}
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
      ) : null}
      {details.length > 0 ? (
        <Section title="Details" flush>
          <List>{details}</List>
        </Section>
      ) : null}
      {a.interest ? <InterestSection interest={a.interest} currency={controls.currency} /> : null}
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

/** On a page Move money opened: the account it acts on, picked among those that offer it; picking another starts the form again for it. */
interface AccountPick {
  label: string;
  value: string;
  options: Choice[];
  onChange(id: string): void;
}

function PickField(props: { pick: AccountPick | undefined }) {
  const { pick } = props;
  return pick ? <SelectField label={pick.label} value={pick.value} options={pick.options} onChange={pick.onChange} /> : null;
}

/** A payment toward what's owed, from one of the party's accounts: the amount due, the whole balance, or an amount typed. */
function PayPage(props: { view: FinanceView; account: AccountView; controls: PlayerControls; nav: HubNav; pick?: AccountPick }) {
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
  const body = payCardAction(a.id, from || null, cents);
  return (
    <ActionPage nav={props.nav} controls={controls} name="pay" title={`Pay ${a.name}`} subtitle={`${fmt(balance)} owed`} go={`Pay ${fmt(cents ?? balance)}`} problem={problem} action={body} submit={(tell) => controls.act(body, tell)}>
      <PickField pick={props.pick} />
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

function TransferPage(props: { view: FinanceView; account: AccountView; controls: PlayerControls; nav: HubNav; pick?: AccountPick }) {
  const { account: a, controls } = props;
  const fmt = (cents: number): string => formatMoney(cents, controls.currency);
  const targets = transferTargets(props.view, a.id);
  const [to, setTo] = useState(targets[0]?.id ?? "");
  const [text, setText] = useState("");
  const cents = amountOf(text, controls.currency);
  const problem = to === "" ? "Pick where it goes." : amountProblem(text, controls.currency, "an amount");
  const body = cents === null ? null : transferAction(a.id, to, cents);
  return (
    <ActionPage nav={props.nav} controls={controls} name="transfer" title="Transfer" subtitle={`From ${a.name} · ${fmt(a.available ?? a.cents)} available`} go={cents !== null ? `Transfer ${fmt(cents)}` : "Transfer"} problem={problem} action={body} submit={(tell) => (body === null ? Promise.resolve(false) : controls.act(body, tell))}>
      <PickField pick={props.pick} />
      <SelectField label="To" value={to} options={targets.map((x) => ({ value: x.id, label: x.name }))} onChange={setTo} />
      <AmountField label="Amount" value={text} currency={controls.currency} onInput={setText} invalid={text.trim() !== "" && cents === null} />
    </ActionPage>
  );
}

/** Cash out of a bank account into the wallet, or in from it; where cash needs a machine or a branch, the engine says so if there's none where you are. */
function CashPage(props: { view: FinanceView; account: AccountView; controls: PlayerControls; nav: HubNav; kind: "withdraw" | "deposit"; pick?: AccountPick }) {
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
      action={(cents) => (cents === null ? null : cashAction(kind, a.id, cents))}
      submit={(cents, tell) => (cents === null ? Promise.resolve(false) : controls.act(cashAction(kind, a.id, cents), tell))}
    >
      <PickField pick={props.pick} />
    </AmountPage>
  );
}

/** One of Move money's pages: its account picked among those that offer the control (the first to start with), then that control's own form for it. */
function MovePage(props: { view: FinanceView; controls: PlayerControls; nav: HubNav; control: MoveControl; from: readonly AccountView[] }) {
  const { view, controls, nav, control } = props;
  const [picked, setPicked] = useState(props.from[0]?.id ?? "");
  const account = props.from.find((a) => a.id === picked) ?? props.from[0];
  if (!account) return null;
  const pick: AccountPick = { label: MOVE[control].pick, value: account.id, options: props.from.map((a) => ({ value: a.id, label: a.name })), onChange: setPicked };
  // Each account starts its form afresh (its sources, what's due on it), so the form is keyed by it.
  if (control === "transfer") return <TransferPage key={account.id} view={view} account={account} controls={controls} nav={nav} pick={pick} />;
  if (control === "pay") return <PayPage key={account.id} view={view} account={account} controls={controls} nav={nav} pick={pick} />;
  return <CashPage key={account.id} view={view} account={account} controls={controls} nav={nav} kind={control} pick={pick} />;
}

/**
 * Autopay's mode, the account it pays from and a fixed amount: an action for the player, the
 * account's fields for the GM, who gets the debtor's sources whichever party's page the account was
 * opened from. A source in force that isn't offered stays shown under its name: the player is told
 * it can't pay, and the GM may keep it.
 */
function AutopayPage(props: { view: FinanceView; account: AccountView; controls: PlayerControls | GmControls; nav: HubNav }) {
  const { account: a, controls } = props;
  const was = a.autopay;
  const sources = (controls.mode === "gm" ? gmAutopaySources(controls.gm.money, a.id) : autopaySources(props.view, a)).map((x) => ({ value: x.id, label: x.name }));
  const [mode, setMode] = useState<AutopayMode>(was?.mode ?? "none");
  const [from, setFrom] = useState<string>(was?.from ?? sources[0]?.value ?? "");
  const [amount, setAmount] = useState(was?.cents !== null && was?.cents !== undefined ? String(was.cents / 10 ** controls.currency.decimals) : "");
  const cents = mode === "fixed" ? amountOf(amount, controls.currency) : null;
  const offered = from === "" || sources.some((s) => s.value === from);
  const choices = offered ? sources : [...sources, { value: from, label: was?.from === from ? (was.fromName ?? "Its account now") : "Its account now" }];
  const problem = mode === "none" ? null : from === "" ? "Pick the account it pays from." : !offered && controls.mode === "player" ? "That account can't pay it: pick one of these." : mode === "fixed" && cents === null ? "Type the amount it pays each month." : null;
  const body = autopayAction(a.id, mode, from || null, cents);
  const submit = (tell?: boolean): Promise<boolean> => {
    if (controls.mode === "player") return controls.act(body, tell);
    const ops = autopayOps(a.id, was, mode, from || null, cents);
    return ops.length === 0 ? Promise.resolve(true) : controls.edit(ops);
  };
  return (
    <ActionPage nav={props.nav} controls={controls} name="autopay" title="Autopay" subtitle={a.name} go="Save autopay" problem={problem} action={body} submit={submit}>
      <ChoiceField label="Pays" value={mode} options={AUTOPAY_MODES.map((m) => ({ value: m, label: AUTOPAY_LABEL[m] }))} onChange={(v) => setMode(AUTOPAY_MODES.find((m) => m === v) ?? "none")} />
      {mode !== "none" ? <SelectField label="From" value={from} empty="Choose an account" options={choices} onChange={setFrom} /> : null}
      {mode === "fixed" ? <AmountField label="Amount each month" value={amount} currency={controls.currency} onInput={setAmount} invalid={amount.trim() !== "" && cents === null} /> : null}
    </ActionPage>
  );
}

// ---------------------------------------------------------------- the GM's account actions

/** The GM's two corrections on an account as its class reads them: on a loan, a card or a line, money in pays it down and money out adds to what's owed. */
export function adjustWords(a: Pick<AccountView, "class">): { add: string; take: string } {
  return CLASS_TRAITS[a.class].liability ? { add: "Pay down", take: "Add to what's owed" } : { add: "Add money", take: "Take money" };
}

function AdjustPage(props: { account: AccountView; controls: GmControls; nav: HubNav; take: boolean }) {
  const { account: a, controls, take } = props;
  const words = adjustWords(a);
  const owed = CLASS_TRAITS[a.class].liability;
  return (
    <AmountPage
      nav={props.nav}
      controls={controls}
      name={take ? "take" : "add"}
      title={take ? words.take : words.add}
      subtitle={`${a.name} · ${owed ? `${formatMoney(Math.max(0, -a.cents), controls.currency)} owed` : formatMoney(a.cents, controls.currency)}`}
      label="Amount"
      go={take ? (owed ? "Add it" : "Take") : owed ? "Pay it down" : "Add"}
      help="A correction against an outside account, so the books still balance; it isn't income or spending."
      submit={(cents) => (cents === null ? Promise.resolve(false) : controls.edit([{ op: "adjust", account: a.id, cents: take ? -cents : cents }]))}
    />
  );
}

function StatusPage(props: { account: AccountView; controls: GmControls; nav: HubNav }) {
  const { account: a, controls } = props;
  const [status, setStatus] = useState<string>(a.status);
  return (
    <ActionPage nav={props.nav} controls={controls} name="status" title="Status" subtitle={a.name} go="Set the status" problem={status === a.status ? unchangedProblem(a.status, "status") : null} submit={() => controls.edit(accountStatusOps(a.id, status))}>
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

/** The products Open an account offers a party: its kind's own first, then checking and savings. */
export function openProducts(kind: PartyKind): AccountClass[] {
  const first = DEFAULT_ACCOUNT_PRODUCT[kind];
  return [first, ...(["checking", "savings"] as const).filter((c) => c !== first)];
}

/** The GM's new account for a party: one `economy.open_account`, empty, owned by it; with no name, the engine names it after the party and its product. */
export function openAccountOps(party: string, product: AccountClass, name: string): EditOp[] {
  return [{ op: "effect", effect: "economy.open_account", args: { party, product, ...(name.trim() !== "" ? { name: name.trim() } : {}) } }];
}

function OpenAccountPage(props: { view: FinanceView; controls: GmControls; nav: HubNav }) {
  const { view, controls } = props;
  const products = openProducts(view.partyKind);
  const [product, setProduct] = useState<AccountClass>(products[0] ?? "checking");
  const [name, setName] = useState("");
  return (
    <ActionPage nav={props.nav} controls={controls} name="open-account" title="Open an account" subtitle={view.name} go="Open it" submit={() => controls.edit(openAccountOps(view.party, product, name))}>
      <ChoiceField label="Kind" value={product} options={products.map((c) => ({ value: c, label: CLASS_TRAITS[c].label }))} onChange={(v) => setProduct(products.find((c) => c === v) ?? product)} />
      <TextField label="Name" value={name} placeholder={`${view.name} ${product === "business_checking" ? "checking" : product === "trust" ? "trust account" : product}`} onInput={setName} help="It opens empty, owned by it." />
    </ActionPage>
  );
}

// ---------------------------------------------------------------- a card

/** What each change does to a card, said on its page before it's sent (its confirmation). */
function changeText(change: CardChange, card: CardView, account: AccountView | null): string {
  switch (change) {
    case "freeze":
      return `${card.name} stops paying until it's unfrozen.`;
    case "unfreeze":
      return `${card.name} pays again.`;
    case "lost":
      return `It stops working at once; you can ask for a replacement.`;
    case "replace":
      return `A new card${account ? ` on ${account.name}` : ""} takes its place, in the same hands, and ${card.name} is cancelled.`;
  }
}

/** A card's details: the account it pays from (which opens that account's page where the view holds it), whose hands it's in, its state and its daily limits where they run. */
function CardDetails(props: { view: FinanceView; card: CardView; currency: WorldCurrency; nav: HubNav }) {
  const { view, card, nav } = props;
  const fmt = (cents: number): string => formatMoney(cents, props.currency);
  const account = findAccount(view, card.account);
  const limits = cardLimitsShown(view);
  return (
    <Section title="Details" flush>
      <List>
        {account ? <ListRow icon="bank" title={account.name} subtitle="The account it pays from" chevron onClick={() => nav.open(detailPage("account", account.id))} /> : <ListRow icon="bank" title="Someone else's account" subtitle="The account it pays from" />}
        <ListRow icon="card" title="State" badge={stateBadge(card.state)} />
        {card.holderId !== view.party ? <ListRow icon="user" title="Held by" value={card.holder} /> : null}
        {limits && card.dailyPurchaseLimit !== null ? <ListRow title="Spent today" value={`${fmt(card.spentToday)} of ${fmt(card.dailyPurchaseLimit)}`} /> : null}
        {limits && card.dailyAtmLimit !== null ? <ListRow title="Cash machines" value={`${fmt(card.dailyAtmLimit)} a day`} /> : null}
      </List>
    </Section>
  );
}

/** The player's card, with the changes its state allows: its details, then the change to make, picked, and its button (the page is its confirmation). */
function CardChangePage(props: { view: FinanceView; card: CardView; changes: readonly CardChange[]; controls: PlayerControls; nav: HubNav }) {
  const { view, card, changes, controls, nav } = props;
  const [change, setChange] = useState<CardChange>(changes[0] ?? "freeze");
  const picked = changes.includes(change) ? change : (changes[0] ?? "freeze");
  const account = findAccount(view, card.account);
  return (
    <ActionPage nav={nav} controls={controls} name="card" title={card.name} subtitle={cardLine(view, card)} go={CARD_CHANGE[picked].go} danger={picked === "lost"} action={cardAction(card.id, picked)} submit={(tell) => controls.act(cardAction(card.id, picked), tell)}>
      <IdText id={card.id} />
      <CardDetails view={view} card={card} currency={controls.currency} nav={nav} />
      <ChoiceField label="Change" value={picked} options={changes.map((c) => ({ value: c, label: CARD_CHANGE[c].title, detail: changeText(c, card, account) }))} onChange={(v) => setChange(changes.find((c) => c === v) ?? picked)} />
    </ActionPage>
  );
}

/** A card's page: for the player, where cards run, the change to make on it; for the GM its state and fields; otherwise its details. */
function CardPage(props: SectionProps & { card: CardView }) {
  const { view, controls, nav, card } = props;
  const changes = controls.mode === "player" ? cardControls(view, card) : [];
  if (controls.mode === "player" && changes.length > 0) return <CardChangePage view={view} card={card} changes={changes} controls={controls} nav={nav} />;
  return (
    <MoneyPage nav={nav} name="card" title={card.name} subtitle={cardLine(view, card)} actions={stateBadge(card.state)}>
      <IdText id={card.id} />
      {controls.mode === "gm" ? (
        <Controls name={card.id}>
          <Button icon="sliders" onClick={() => nav.open(actionPage("card", card.id, "state"))}>
            State
          </Button>
          <Button icon="list" onClick={() => nav.open(actionPage("card", card.id, "fields"))}>
            Card fields
          </Button>
        </Controls>
      ) : null}
      <CardDetails view={view} card={card} currency={controls.currency} nav={nav} />
    </MoneyPage>
  );
}

function CardStatePage(props: { card: CardView; controls: GmControls; nav: HubNav }) {
  const { card, controls } = props;
  const [state, setState] = useState<string>(card.state);
  return (
    <ActionPage nav={props.nav} controls={controls} name="card-state" title="Card state" subtitle={card.name} go="Set the state" problem={state === card.state ? unchangedProblem(card.state, "state") : null} submit={() => controls.edit([{ op: "set", entity: card.id, field: "state", value: state }])}>
      <ChoiceField label="New state" value={state} options={CARD_STATES.map((s) => ({ value: s, label: humanize(s), detail: s === card.state ? "Now" : undefined }))} onChange={setState} />
    </ActionPage>
  );
}

// ---------------------------------------------------------------- how the party pays

function PayPrefsPage(props: SectionProps & { controls: PlayerControls | GmControls }) {
  const { view, controls, nav } = props;
  const [draft, setDraft] = useState<PayTier[]>(() => [...view.payPrefs]);
  const categories = [...new Set([...(view.overview?.cashFlow?.byCategory ?? []).map((b) => b.category), ...view.recent.flatMap((t) => (t.category ? [t.category] : []))])].sort();
  return (
    <ActionPage nav={nav} controls={controls} name="pay-prefs" title={controls.mode === "player" ? "How you pay" : "How they pay"} subtitle={controls.mode === "gm" ? view.name : undefined} go="Save" action={payPrefsAction(draft)} submit={(tell) => (controls.mode === "player" ? controls.act(payPrefsAction(draft), tell) : controls.edit(payPrefsOps(view.party, draft)))}>
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
  if (controls.mode !== "gm") return null;
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

/** Accounts' pages: Move money's, how the party pays, each account and card, and each control's page. What the view no longer holds, or the mode may not do, draws nothing (gone). */
export const accountPages: HubPages = {
  heads: ["accounts", "account", "card"],
  render(page, props) {
    const { view, controls, nav } = props;
    const [head, id, action, within] = page.path;
    if (head === "accounts") {
      // The GM opens an organization's accounts, in GM → Orgs → Money (6.15).
      if (page.type === "action" && id === "open") return controls.mode === "gm" && view.partyKind !== "person" ? <OpenAccountPage view={view} controls={controls} nav={nav} /> : null;
      if (page.type !== "action") return null;
      if (id === "pay-prefs") return payPrefsShown(view) && controls.mode !== "read" ? <PayPrefsPage {...props} controls={controls} /> : null;
      const move = MOVE_CONTROLS.find((c) => c === id);
      const from = move ? moveFrom(view, move) : [];
      return move && controls.mode === "player" && from.length > 0 ? <MovePage view={view} controls={controls} nav={nav} control={move} from={from} /> : null;
    }
    if (head === "account") {
      const account = findAccount(view, id);
      if (!account) return null;
      return page.type === "detail" ? <AccountPage {...props} account={account} /> : accountActionPage(props, account, action, within);
    }
    const card = findCard(view, id);
    if (!card) return null;
    if (page.type === "detail") return <CardPage {...props} card={card} />;
    if (controls.mode !== "gm") return null;
    if (action === "state") return <CardStatePage card={card} controls={controls} nav={nav} />;
    if (action === "fields") return <FieldsPage nav={nav} controls={controls} name="card-fields" title="Card fields" entity={card.id} subtitle={card.name} />;
    return null;
  },
};
