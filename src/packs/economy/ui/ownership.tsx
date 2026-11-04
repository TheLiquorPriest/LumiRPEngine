// A company's Ownership tab in Orgs (ORG-SPEC §4.4, §3.10, §3.13; `r.orgTab`, the economy's
// `ownership` section): its structure and how its decisions are made, the cap table (each holder's
// class, units, share of the worth, votes and, at Money 4, what their shares are worth), its classes,
// its Worth (from Money 3 its net worth, below zero where it owes more; at Money 4 the value of its
// shares, never below nothing, and a unit), its Structure (who owns it, the subsidiaries it holds,
// each with its net worth and the value of its shares, and what they add up to together), the
// reader's payouts (Pay out profit, an owner's draw, where their share goes), and its
// share and corporate controls: Sell shares (the reader's own stake), Issue shares, Buy back,
// Classes, Start a subsidiary and Change structure, each off with why where the reader may not, and
// on each subsidiary, selling part of the stake or putting more in, as the company. Its Market
// (§27.10 Listing): a listed company's ticker, price, market capitalization and float, its holders on
// the market in the cap table, and List on the market (or Offer more units), Sell on the market and
// Take it off the market. Everything but Classes plays as a turn. GM → Orgs draws it to read, with
// the GM's own List and Take it off the market as GM edits.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { FINANCE_ACTIONS, OWNER_ROLE_LABELS, ROLE_RIGHTS, STRUCTURE_LABELS, type ListingView, type MergeView, type OwnershipView, type StructureLink, type WindingView, type WindLine } from "../../../shared/finance";
import type { JsonObject } from "../../../shared/json";
import { parseMoneyInput } from "../../../shared/money";
import { ORG_ACTIONS } from "../../../shared/org";
import type { OrgOp } from "../../../shared/org-ops";
import type { OrgView } from "../../../shared/org-view";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../../../shared/world";
import { orgRoute, useApp, type SheetRoute } from "../../../frontend/app";
import { Banner, Button, Disclosure, Empty, Field, JsonView, List, ListRow, Row, Section, Seg } from "../../../frontend/components";
import { MoneyInput } from "../../../frontend/money-input";
import type { GmSectionProps, OrgGmTabProps, OrgTabProps } from "../../../frontend/registry";
import { RouteRow } from "./assets";
import { decodeOwnership } from "./decode";
import type { Reader } from "./hub";
import { businessControls, knownPeople } from "./layout";
import { actionPage, Controls, type HubNav } from "./nav";
import { orgNav, theirBusiness, useReader } from "./orgs";
import { playElsewhere } from "./panel";
import { shareRouteLabel } from "./work";

/** Plays a share or corporate action, as a turn (or, for Classes, at once). */
export type OwnershipAct = (action: string, params: JsonObject) => void;

function pct(n: number): string {
  return `${Math.round(n * 100) / 100}%`;
}

/** A whole number typed, or null; "" reads as null, as does anything that isn't one above nothing. */
function wholeOf(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** A field for a count of units. */
function UnitsField(props: { label: string; value: string; onInput(v: string): void; help?: string }) {
  const id = useId();
  return (
    <Field label={props.label} for={id} {...(props.help ? { help: props.help } : {})}>
      <input id={id} class="lre-input" type="number" inputMode="numeric" min={1} step={1} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
    </Field>
  );
}

/** A choice among people and organizations by id. */
function PickField(props: { label: string; value: string; options: readonly { value: string; label: string }[]; empty: string; onChange(v: string): void }) {
  const id = useId();
  return (
    <Field label={props.label} for={id}>
      <select id={id} class="lre-input" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
        <option value="">{props.empty}</option>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** One control's form, folded: off with why where the reader may not use it; where their votes alone fall short, it may be put to a vote (`vote`). */
function Form(props: { summary: string; why: string | null; vote?: boolean; children: ComponentChildren }) {
  return (
    <Disclosure summary={props.summary}>
      <div class="lre-stack" data-lre-ownership-form={props.summary}>
        {props.why !== null ? <span class="lre-field-help">{props.vote ? `${props.why}. You may put it to a vote: it is done if the vote passes.` : props.why}</span> : null}
        {props.children}
      </div>
    </Disclosure>
  );
}

/** A decision's button: the act itself, or, short of the votes, putting it to a vote (`voteLabel`, else "Put it to a vote"). */
export function DecideButton(props: { ok: boolean; vote: boolean; label: string; voteLabel?: string; variant?: "primary" | "danger"; onGo(vote: boolean): void }) {
  return (
    <Button variant={props.variant ?? "primary"} disabled={!props.ok} onClick={() => props.onGo(props.vote)}>
      {props.vote ? (props.voteLabel ?? "Put it to a vote") : props.label}
    </Button>
  );
}

/** Issue shares: to whom, how many units, at what price a unit (empty: its value a unit), in which class. */
function IssueForm(props: { org: OrgView; section: OwnershipView; people: readonly { value: string; label: string }[]; currency: WorldCurrency; why: string | null; vote?: boolean; act: OwnershipAct; to?: string; as?: string }) {
  const [to, setTo] = useState(props.to ?? "");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [cls, setCls] = useState("");
  const n = wholeOf(units);
  const each = price.trim() === "" ? null : parseMoneyInput(price, props.currency);
  const ok = (props.why === null || props.vote === true) && to !== "" && n !== null && (price.trim() === "" || (each !== null && each >= 0));
  return (
    <>
      {props.to === undefined ? <PickField label="To" value={to} options={props.people} empty="Choose who buys in" onChange={setTo} /> : null}
      <UnitsField label="Units" value={units} onInput={setUnits} help={props.section.units === null ? "It doesn't count units yet: its holders are counted in them first." : `Of ${props.section.units} now.`} />
      <Field label="Price a unit" help={props.section.valuation?.perUnit != null ? `Empty: its value a unit, ${formatMoney(Math.round(props.section.valuation.perUnit), props.currency)}.` : "Empty: its value a unit."}>
        <MoneyInput currency={props.currency} value={price} label="Price a unit" onInput={setPrice} />
      </Field>
      {props.section.classes ? <PickField label="Class" value={cls} options={props.section.classes.map((c) => ({ value: c.id, label: `${c.label} (${c.votes} votes a unit)` }))} empty="As theirs, else the first" onChange={setCls} /> : null}
      <DecideButton ok={ok} vote={props.vote === true} label="Issue the shares" onGo={(vote) => props.act(FINANCE_ACTIONS.sharesIssue, { business: props.org.id, to, units: n ?? 0, ...(each !== null ? { price: each } : {}), ...(cls !== "" ? { class: cls } : {}), ...(props.as ? { as: props.as } : {}), ...(vote ? { vote: true } : {}) })} />
    </>
  );
}

/** Buy back: whose units, how many, at what price a unit (empty: its value a unit). */
function BuyBackForm(props: { org: OrgView; section: OwnershipView; currency: WorldCurrency; why: string | null; vote?: boolean; act: OwnershipAct }) {
  // The cap table's own rows: a holder on the market sells there, not back to the company.
  const holders = props.section.owners.flatMap((o) => (o.party !== null && o.public !== true && (o.units ?? 0) > 0 ? [{ value: o.party, label: `${o.name} (${o.units} units)` }] : []));
  const [from, setFrom] = useState("");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const n = wholeOf(units);
  const each = price.trim() === "" ? null : parseMoneyInput(price, props.currency);
  const ok = (props.why === null || props.vote === true) && from !== "" && n !== null && (price.trim() === "" || (each !== null && each >= 0));
  return (
    <>
      <PickField label="From" value={from} options={holders} empty="Choose whose units" onChange={setFrom} />
      <UnitsField label="Units" value={units} onInput={setUnits} />
      <Field label="Price a unit" help="Empty: its value a unit.">
        <MoneyInput currency={props.currency} value={price} label="Price a unit" onInput={setPrice} />
      </Field>
      <DecideButton ok={ok} vote={props.vote === true} label="Buy them back" onGo={(vote) => props.act(FINANCE_ACTIONS.sharesBuyBack, { business: props.org.id, from, units: n ?? 0, ...(each !== null ? { price: each } : {}), ...(vote ? { vote: true } : {}) })} />
    </>
  );
}

/** Classes: a class by name with its votes a unit, optionally a holder's units moved into it; at once. */
function ClassesForm(props: { org: OrgView; section: OwnershipView; why: string | null; vote?: boolean; act: OwnershipAct }) {
  const holders = props.section.owners.flatMap((o) => (o.party !== null && o.public !== true && ROLE_RIGHTS[o.role].worth ? [{ value: o.party, label: o.name }] : []));
  const [label, setLabel] = useState("");
  const [votes, setVotes] = useState("1");
  const [holder, setHolder] = useState("");
  const id = useId();
  const v = Number(votes);
  const ok = (props.why === null || props.vote === true) && label.trim() !== "" && votes.trim() !== "" && Number.isFinite(v) && v >= 0;
  return (
    <>
      {(props.section.classes ?? []).map((c) => (
        <Row key={c.id} k={c.label} v={`${c.votes} votes a unit`} />
      ))}
      <Field label="Class" for={id}>
        <input id={id} class="lre-input" value={label} maxLength={40} placeholder="Non-voting" onInput={(event) => setLabel(event.currentTarget.value)} />
      </Field>
      <UnitsField label="Votes a unit" value={votes} onInput={setVotes} help="0 makes it non-voting." />
      <PickField label="Move a holder's units into it" value={holder} options={holders} empty="No one's" onChange={setHolder} />
      <DecideButton ok={ok} vote={props.vote === true} label="Save the class" onGo={(vote) => props.act(FINANCE_ACTIONS.sharesClasses, { business: props.org.id, label: label.trim(), votes: v, ...(holder !== "" ? { holder } : {}), ...(vote ? { vote: true } : {}) })} />
    </>
  );
}

/** List on the market or, listed, offer more units: how many new units, at what price a unit, under what ticker; short of the votes, put to a vote (`vote`). */
function ListForm(props: { section: OwnershipView; currency: WorldCurrency; why: string | null; vote?: boolean; go(params: { units: number; price?: number; symbol?: string }, vote: boolean): void }) {
  const listed = props.section.listing;
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [symbol, setSymbol] = useState("");
  const id = useId();
  const n = wholeOf(units);
  const each = price.trim() === "" ? null : parseMoneyInput(price, props.currency);
  const ok = (props.why === null || props.vote === true) && n !== null && (price.trim() === "" || (each !== null && each > 0));
  return (
    <>
      <UnitsField label="New units for the public" value={units} onInput={setUnits} help={props.section.units !== null ? `It has ${props.section.units} now.` : "Its holders are counted in units first."} />
      <Field label="Price a unit" help={listed ? `Empty: its market price, ${formatMoney(Math.round(listed.price), props.currency)}.` : "Empty: its books a unit."}>
        <MoneyInput currency={props.currency} value={price} label="Price a unit" onInput={setPrice} />
      </Field>
      {listed ? null : (
        <Field label="Ticker" for={id} help="Empty: its initials.">
          <input id={id} class="lre-input" value={symbol} maxLength={6} placeholder="EMR" onInput={(event) => setSymbol(event.currentTarget.value.toUpperCase())} />
        </Field>
      )}
      <DecideButton ok={ok} vote={props.vote === true} label={listed ? "Offer them" : "List it"} onGo={(vote) => props.go({ units: n ?? 0, ...(each !== null ? { price: each } : {}), ...(!listed && symbol.trim() !== "" ? { symbol: symbol.trim() } : {}) }, vote)} />
    </>
  );
}

/** Sell on the market: some of the reader's own cap-table units, at its market price. */
function OfferForm(props: { org: OrgView; listing: ListingView; max: number; currency: WorldCurrency; why: string | null; act: OwnershipAct }) {
  const [units, setUnits] = useState("");
  const n = wholeOf(units);
  const ok = props.why === null && n !== null && n <= props.max;
  return (
    <>
      <UnitsField label="Units" value={units} onInput={setUnits} help={`Up to ${props.max}, at its market price, ${formatMoney(Math.round(props.listing.price), props.currency)} a unit.`} />
      <Button variant="primary" disabled={!ok} onClick={() => props.act(FINANCE_ACTIONS.stakeSell, { business: props.org.id, units: n ?? 0, price: 0 })}>
        Sell them
      </Button>
    </>
  );
}

/** Take it off the market: every public unit bought back at a price a unit, its market price when left empty, never less; short of the votes, put to a vote (`vote`). */
function DelistForm(props: { listing: ListingView; currency: WorldCurrency; why: string | null; vote?: boolean; go(params: { price?: number }, vote: boolean): void }) {
  const [price, setPrice] = useState("");
  const market = Math.round(props.listing.price);
  const each = price.trim() === "" ? null : parseMoneyInput(price, props.currency);
  const ok = (props.why === null || props.vote === true) && (price.trim() === "" || (each !== null && each >= market));
  return (
    <>
      <span class="lre-field-help">
        It buys back all {props.listing.float} public units from its account: about {formatMoney((each ?? market) * props.listing.float, props.currency)}.
      </span>
      <Field label="Price a unit" help={`Empty: its market price, ${formatMoney(market, props.currency)}; never less.`}>
        <MoneyInput currency={props.currency} value={price} label="Price a unit" onInput={setPrice} />
      </Field>
      <DecideButton ok={ok} vote={props.vote === true} label="Take it off the market" onGo={(vote) => props.go(each !== null ? { price: each } : {}, vote)} />
    </>
  );
}

/** A listed company's market: its ticker, its price and this month's change, its market capitalization, what the public holds and the market sells, and its books a unit where values show. */
function MarketRows(props: { listing: ListingView; currency: WorldCurrency }) {
  const l = props.listing;
  const month = l.performance?.month ?? null;
  return (
    <div class="lre-stack" data-lre-ownership-market>
      <Row k="Ticker" v={l.symbol} sub={`Listed ${l.since}`} />
      <Row k="Price a unit" v={formatMoney(Math.round(l.price), props.currency)} {...(month !== null ? { sub: `${month >= 0 ? "+" : ""}${pct(month)} this month`, tone: month >= 0 ? ("pos" as const) : ("neg" as const) } : {})} />
      <Row k="Market capitalization" v={formatMoney(l.marketCap, props.currency)} />
      <Row k="The public holds" v={`${l.float} units`} sub={`${l.held} of them in the world; ${l.available} for sale`} />
      {l.fair !== null ? <Row k="Its books a unit" v={formatMoney(Math.round(l.fair), props.currency)} sub="Its price returns toward it" /> : null}
    </div>
  );
}

/** GM → Orgs: list it (or offer more units) or take it off the market, as GM edits: no one's powers or votes asked. */
function GmMarket(props: { org: OrgView; section: OwnershipView; currency: WorldCurrency; gm: GmSectionProps }) {
  const { org, section, gm } = props;
  const edit = (change: OrgOp): void => void gm.edit([{ op: "org", change }]);
  const busy = gm.busy ? "Busy…" : null;
  return (
    <div class="lre-stack" data-lre-gm-market={org.id}>
      <Form summary={section.listing ? "GM: offer more units" : "GM: list on the market"} why={busy ?? (section.structure === "c_corp" ? null : `Only a C corporation lists on a market: change ${org.name}'s structure first`)}>
        <ListForm section={section} currency={props.currency} why={busy ?? (section.structure === "c_corp" ? null : "")} go={(p) => edit({ do: "list", org: org.id, ...p })} />
      </Form>
      {section.listing ? (
        <Form summary="GM: take it off the market" why={busy}>
          <DelistForm listing={section.listing} currency={props.currency} why={busy} go={(p) => edit({ do: "delist", org: org.id, ...p })} />
        </Form>
      ) : null}
    </div>
  );
}

/** Start a subsidiary: its name, its capital from the company's own account, its units when asked. */
function SubsidiaryForm(props: { org: OrgView; section: OwnershipView; currency: WorldCurrency; act: OwnershipAct }) {
  const acts = props.section.acts;
  const [name, setName] = useState("");
  const [capital, setCapital] = useState("");
  const [from, setFrom] = useState("");
  const [units, setUnits] = useState("");
  const id = useId();
  const cents = parseMoneyInput(capital, props.currency);
  const source = from || acts?.sources[0]?.id || "";
  const n = wholeOf(units);
  const ok = acts?.found === null && name.trim() !== "" && cents !== null && cents > 0 && source !== "" && (units.trim() === "" || n !== null);
  return (
    <>
      <Field label="Its name" for={id}>
        <input id={id} class="lre-input" value={name} maxLength={60} placeholder="Ellis Towing" onInput={(event) => setName(event.currentTarget.value)} />
      </Field>
      <Field label="Capital" help={`From ${props.org.name}'s own money; ${props.org.name} owns all of it.`}>
        <MoneyInput currency={props.currency} value={capital} label="Capital" onInput={setCapital} />
      </Field>
      {(acts?.sources.length ?? 0) > 1 ? <PickField label="From" value={source} options={(acts?.sources ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.balance})` }))} empty="Its first account" onChange={setFrom} /> : null}
      <UnitsField label="Units" value={units} onInput={setUnits} help="Optional: count its shares in units." />
      <Button variant="primary" disabled={!ok} onClick={() => props.act(ORG_ACTIONS.found, { type: "company", name: name.trim(), amount: cents ?? 0, from: source, ...(n !== null ? { units: n } : {}), as: props.org.id })}>
        Start it
      </Button>
    </>
  );
}

/** Change structure: one of the five; its taxes follow from the next estimated-tax period. */
function StructureForm(props: { org: OrgView; section: OwnershipView; why: string | null; vote?: boolean; act: OwnershipAct }) {
  const [structure, setStructure] = useState("");
  const options = Object.entries(STRUCTURE_LABELS).flatMap(([value, label]) => (value === props.section.structure ? [] : [{ value, label }]));
  return (
    <>
      <PickField label="Become" value={structure} options={options} empty="Choose a structure" onChange={setStructure} />
      <span class="lre-field-help">Draws and payouts change at once; its taxes from the next estimated-tax period.</span>
      <DecideButton ok={(props.why === null || props.vote === true) && structure !== ""} vote={props.vote === true} label="Change it" onGo={(vote) => props.act(ORG_ACTIONS.restructure, { org: props.org.id, structure, ...(vote ? { vote: true } : {}) })} />
    </>
  );
}

/** Selling part of the company's stake in a subsidiary, as the company: units or a percent, a price, a buyer. */
function StakeForm(props: { parent: string; child: StructureLink; people: readonly { value: string; label: string }[]; currency: WorldCurrency; act: OwnershipAct }) {
  const [share, setShare] = useState("");
  const [price, setPrice] = useState("");
  const [buyer, setBuyer] = useState("");
  const s = Number(share);
  const cents = parseMoneyInput(price, props.currency);
  const ok = share.trim() !== "" && s > 0 && s <= props.child.share + 1e-9 && cents !== null && cents >= 0;
  return (
    <>
      <UnitsField label="Share to sell (%)" value={share} onInput={setShare} help={`It holds ${pct(props.child.share)}.`} />
      <Field label="Price">
        <MoneyInput currency={props.currency} value={price} label="Price" onInput={setPrice} />
      </Field>
      <PickField label="Buyer" value={buyer} options={props.people} empty="Whoever buys (all of it only)" onChange={setBuyer} />
      <Button variant="primary" disabled={!ok} onClick={() => props.act(FINANCE_ACTIONS.stakeSell, { business: props.child.id, share: s, price: cents ?? 0, ...(buyer !== "" ? { buyer } : {}), as: props.parent })}>
        Sell it
      </Button>
    </>
  );
}

/**
 * A subsidiary's row in Structure and its own below it, indented; with what it adds where values
 * show: its net worth, below zero where it owes more than it holds, beside the value of its shares,
 * never below nothing (a trust's worth is its net worth alone), so the two read apart.
 */
function ChildRows(props: { link: StructureLink; depth: number; currency: WorldCurrency; open(route: SheetRoute): void }): ComponentChildren {
  const l = props.link;
  const money = (cents: number): string => formatMoney(cents, props.currency);
  const figures = [l.netWorth !== null ? `net worth ${money(l.netWorth)}` : null, l.value !== null && !l.trust ? `value of the shares ${money(l.value)}` : null, l.cash !== null ? `cash ${money(l.cash)}` : null, l.profit !== null ? `profit ${money(l.profit)}` : null].filter((x) => x !== null);
  return (
    <>
      <ListRow id={l.id} icon={l.trust ? "shield" : "briefcase"} title={`${"· ".repeat(props.depth)}${l.name}`} subtitle={[l.trust ? `Trust · ${OWNER_ROLE_LABELS[l.trust.role].one}` : l.controlled ? "Controlled" : `${pct(l.votes)} of its votes`, ...figures].join(" · ")} value={l.share > 0 ? pct(l.share) : undefined} chevron onClick={() => props.open(orgRoute(l.id))} />
      {l.children.map((c) => (
        <ChildRows key={c.id} link={c} depth={props.depth + 1} currency={props.currency} open={props.open} />
      ))}
    </>
  );
}

/**
 * A company's Ownership, drawn from its section and, in Play, beside the reader's own money
 * (`reader`): their payouts and Sell shares go by their own role on it, as from Money; the rest by
 * what the section says they may decide. Without `act` (GM → Orgs) it only reads.
 */
export function OrgOwnership(props: { org: OrgView; section: OwnershipView; reader: Reader | null; nav: HubNav; currency?: WorldCurrency; act?: OwnershipAct; change?(op: OrgOp, vote?: boolean): void; open?(route: SheetRoute): void; gm?: GmSectionProps }) {
  const { org, section, reader, nav } = props;
  const currency = props.currency ?? DEFAULT_CURRENCY;
  const theirs = theirBusiness(org, reader);
  const can = reader && theirs ? businessControls(reader.view, theirs) : [];
  const payouts = can.filter((c) => c === "distribute" || c === "draw");
  const worth = theirs !== null && theirs.role !== null && ROLE_RIGHTS[theirs.role].worth;
  const acts = section.acts;
  const act = props.act;
  const open = props.open ?? (() => undefined);
  const known = reader ? knownPeople(reader.controls.palette).map((p) => ({ value: p.id, label: p.label })) : [];
  const people = [...known, ...section.owners.flatMap((o) => (o.party !== null && !known.some((k) => k.value === o.party) ? [{ value: o.party, label: o.name }] : []))];
  const head = [STRUCTURE_LABELS[section.structure] ?? section.structure, section.units !== null ? `${section.units} units` : "not counted in units", `decisions need more than ${section.decidePct === 50 ? "half" : pct(section.decidePct)} of the votes`];
  // Two figures read apart (DESIGN §27.10): its net worth, below zero where it owes more than it
  // holds, and the value of its shares, never below nothing (limited liability).
  const valuation = section.valuation;
  const books = valuation ? `its net worth, ${formatMoney(valuation.book, currency)}, and ${valuation.multiple} × the last 12 months' operating profit, ${formatMoney(valuation.profit, currency)}` : "";
  return (
    <div class="lre-stack" data-lre-org-ownership={org.id}>
      <Section>
        <div class="lre-stack" data-lre-ownership-head>
          <span>{head.join(" · ")}</span>
          {acts !== null && section.votes > 0 ? <span>You hold {pct(section.votes)} of the votes.</span> : null}
        </div>
      </Section>
      <Section title="Cap table" flush>
        {section.owners.length === 0 ? (
          <Empty icon="users">No owners on record.</Empty>
        ) : (
          <List>
            {section.owners.map((o, i) => (
              <ListRow
                key={`${o.public === true ? "market:" : ""}${o.party ?? `someone:${i}`}`}
                icon={o.public === true && o.party === null ? "globe" : "user"}
                title={o.name}
                subtitle={[o.public === true ? "on the market" : null, o.role !== "owner" ? OWNER_ROLE_LABELS[o.role].one : null, section.classes && o.class ? o.class : null, o.units !== undefined ? `${o.units} units` : null, o.votes !== undefined && Math.abs(o.votes - o.share) > 0.005 ? `${pct(o.votes)} of the votes` : null].filter((x) => x !== null).join(" · ") || undefined}
                value={[ROLE_RIGHTS[o.role].worth && o.share > 0 ? pct(o.share) : null, o.value !== undefined ? `shares worth ${formatMoney(o.value, currency)}` : null].filter((x) => x !== null).join(" · ") || undefined}
              />
            ))}
          </List>
        )}
      </Section>
      {section.netWorth !== null || valuation ? (
        <Section title="Worth">
          <div class="lre-stack" data-lre-ownership-valuation>
            {section.netWorth !== null ? <Row k="Net worth" v={formatMoney(section.netWorth, currency)} sub="What it holds, less what it owes" {...(section.netWorth < 0 ? { tone: "neg" as const } : {})} /> : null}
            {valuation ? <Row k="Value of the shares" v={formatMoney(valuation.value, currency)} sub={valuation.market ? `At the market: ${formatMoney(Math.round(valuation.market.price), currency)} a unit × ${valuation.market.units} units; ${books}` : valuation.set ? "Set for it" : valuation.floored ? `Net worth is below zero: ${books} come to less than nothing, and limited liability keeps the shares at ${formatMoney(0, currency)}, never less` : `From ${books}`} /> : null}
            {valuation && valuation.perUnit !== null ? <Row k="A unit" v={formatMoney(Math.round(valuation.perUnit), currency)} /> : null}
          </div>
        </Section>
      ) : null}
      {section.listing || (act && section.market) || props.gm ? (
        <Section title="Market">
          {section.listing ? <MarketRows listing={section.listing} currency={currency} /> : <span>Not on a market.</span>}
          {act && section.market ? (
            <div class="lre-stack" data-lre-ownership-market-controls={org.id}>
              <Form summary={section.listing ? "Offer more units" : "List on the market"} why={section.market.list} vote={section.market.voteList === true}>
                <ListForm section={section} currency={currency} why={section.market.list} vote={section.market.voteList === true} go={(p, vote) => act(FINANCE_ACTIONS.sharesList, { business: org.id, ...p, ...(vote ? { vote: true } : {}) })} />
              </Form>
              {section.listing ? (
                <>
                  <Form summary="Sell on the market" why={section.market.offer}>
                    <OfferForm org={org} listing={section.listing} max={section.market.units} currency={currency} why={section.market.offer} act={act} />
                  </Form>
                  <Form summary="Take it off the market" why={section.market.delist} vote={section.market.voteDelist === true}>
                    <DelistForm listing={section.listing} currency={currency} why={section.market.delist} vote={section.market.voteDelist === true} go={(p, vote) => act(FINANCE_ACTIONS.sharesDelist, { business: org.id, ...p, ...(vote ? { vote: true } : {}) })} />
                  </Form>
                </>
              ) : null}
            </div>
          ) : null}
          {props.gm ? <GmMarket org={org} section={section} currency={currency} gm={props.gm} /> : null}
        </Section>
      ) : null}
      {section.parents.length > 0 || section.children.length > 0 ? (
        <Section title="Structure" flush>
          <List>
            {section.parents.map((p) => (
              <ListRow key={p.id} id={p.id} icon="briefcase" title={p.name} subtitle={p.controlled ? "Owns it, and controls it" : "Owns part of it"} value={pct(p.share)} chevron onClick={() => open(orgRoute(p.id))} />
            ))}
            <ListRow icon="briefcase" title={org.name} subtitle="This company" current />
            {section.children.map((c) => (
              <ChildRows key={c.id} link={c} depth={1} currency={currency} open={open} />
            ))}
          </List>
          {section.consolidated ? (
            <div class="lre-stack" data-lre-ownership-consolidated>
              <Row k="Cash, with its subsidiaries" v={formatMoney(section.consolidated.cash, currency)} />
              <Row k="Profit this year, with them" v={formatMoney(section.consolidated.profit, currency)} />
              <Row k="Net worth with its subsidiaries" v={formatMoney(section.consolidated.netWorth, currency)} sub="Each company it controls at its net worth, not the value of its shares (a value set for it, or the market's, stays)" {...(section.consolidated.netWorth < 0 ? { tone: "neg" as const } : {})} />
            </div>
          ) : null}
          {act && acts?.holdings === null
            ? section.children.map((c) => (
                <Disclosure key={c.id} summary={`${c.name}: sell part, or put more in`}>
                  <div class="lre-stack" data-lre-ownership-child={c.id}>
                    <StakeForm parent={org.id} child={c} people={people} currency={currency} act={act} />
                    {c.controlled ? <IssueForm org={{ ...org, id: c.id, name: c.name }} section={{ ...section, units: null, classes: null, valuation: null }} people={people} currency={currency} why={null} act={act} to={org.id} as={org.id} /> : null}
                  </div>
                </Disclosure>
              ))
            : null}
        </Section>
      ) : null}
      {payouts.length > 0 || (reader && theirs && worth) ? (
        <Section title="Payouts">
          <Controls name={`${org.id}-payouts`}>
            {payouts.includes("distribute") ? (
              <Button icon="coins" onClick={() => nav.open(actionPage("business", org.id, "distribute"))}>
                Pay out profit
              </Button>
            ) : null}
            {payouts.includes("draw") ? (
              <Button icon="wallet" onClick={() => nav.open(actionPage("business", org.id, "draw"))}>
                Owner's draw
              </Button>
            ) : null}
          </Controls>
          {reader && theirs && worth ? <RouteRow view={reader.view} controls={reader.controls} nav={nav} route={theirs.route} reinvest label={shareRouteLabel({ view: reader.view, controls: reader.controls, nav })} page={actionPage("business", org.id, "route")} /> : null}
        </Section>
      ) : null}
      {can.includes("stake") || (act && acts) ? (
        <Section title="Shares">
          {can.includes("stake") ? (
            <Controls name={`${org.id}-shares`}>
              <Button icon="users" onClick={() => nav.open(actionPage("business", org.id, "stake"))}>
                Sell shares
              </Button>
            </Controls>
          ) : null}
          {act && acts ? (
            <div class="lre-stack" data-lre-ownership-controls={org.id}>
              <Form summary="Issue shares" why={acts.decide} vote={acts.vote === true}>
                <IssueForm org={org} section={section} people={people} currency={currency} why={acts.decide} vote={acts.vote === true} act={act} />
              </Form>
              {section.units !== null ? (
                <Form summary="Buy back" why={acts.decide} vote={acts.vote === true}>
                  <BuyBackForm org={org} section={section} currency={currency} why={acts.decide} vote={acts.vote === true} act={act} />
                </Form>
              ) : null}
              <Form summary="Classes" why={acts.decide} vote={acts.vote === true}>
                <ClassesForm org={org} section={section} why={acts.decide} vote={acts.vote === true} act={act} />
              </Form>
              <Form summary="Start a subsidiary" why={acts.found}>
                <SubsidiaryForm org={org} section={section} currency={currency} act={act} />
              </Form>
              <Form summary="Change structure" why={acts.restructure} vote={acts.voteRestructure === true}>
                <StructureForm org={org} section={section} why={acts.restructure} vote={acts.voteRestructure === true} act={act} />
              </Form>
            </div>
          ) : null}
        </Section>
      ) : null}
      {section.winding && section.winding.dissolved === null ? <WindingPart org={org} winding={section.winding} currency={currency} {...(props.change ? { change: props.change } : {})} /> : null}
      {section.merge ? <MergePart org={org} merge={section.merge} currency={currency} {...(props.change ? { change: props.change } : {})} /> : null}
    </div>
  );
}

/** A line of the reckoning: its words and amount. */
function lineRows(lines: readonly WindLine[], currency: WorldCurrency, tone?: "neg" | "muted"): ComponentChildren {
  return lines.map((l, i) => <Row key={`${l.label}:${i}`} k={l.label} v={formatMoney(l.cents, currency)} {...(tone ? { tone } : {})} />);
}

/**
 * Winding up (§3.13): what finishing would do now (its cash with what it would sell, the debts it
 * pays, what it writes off, what it holds and where each goes, the staff and standing payments that
 * end, each holder's payout, and what it is short), and the controls: all at once or begin, its
 * property handed out or sold, its things to whom; once begun, Finish and Resume. Short only of the
 * votes (`vote`), each puts it to a vote instead.
 */
export function WindingPart(props: { org: OrgView; winding: WindingView; currency: WorldCurrency; change?(op: OrgOp, vote?: boolean): void }) {
  const { org, winding: w, currency } = props;
  const [stage, setStage] = useState<"all" | "begin">("all");
  const [property, setProperty] = useState<"distribute" | "sell">("distribute");
  const [to, setTo] = useState("");
  const begun = w.since !== null;
  const holders = w.payouts.flatMap((p) => (p.party !== null ? [{ value: p.party, label: p.name }] : []));
  const change = props.change;
  const vote = props.winding.vote === true;
  const go = (s: "all" | "begin" | "finish" | "resume"): void => change?.({ do: "wind_up", org: org.id, stage: s, ...(s === "begin" || s === "resume" ? {} : { property }), ...(to !== "" && s !== "begin" && s !== "resume" ? { to } : {}) }, vote);
  const barred = w.why !== null && !vote;
  const blocked = barred || w.short > 0;
  return (
    <Section title={begun ? "Finish winding up" : "Wind up"}>
      <div class="lre-stack" data-lre-ownership-winding={org.id}>
        {w.why !== null ? <span class="lre-field-help">{vote ? `${w.why}. You may put it to a vote: it is done if the vote passes.` : w.why}</span> : null}
        <Row k="Cash, with what it would sell" v={formatMoney(w.cash, currency)} />
        {w.debts.length > 0 ? (
          <Disclosure summary={`It would pay ${formatMoney(w.debts.reduce((a, d) => a + d.cents, 0), currency)} it owes`}>
            <div class="lre-stack">{lineRows(w.debts, currency, "neg")}</div>
          </Disclosure>
        ) : null}
        {w.owed.length > 0 ? (
          <Disclosure summary={`It would write off ${formatMoney(w.owed.reduce((a, d) => a + d.cents, 0), currency)} owed it`}>
            <div class="lre-stack">{lineRows(w.owed, currency, "muted")}</div>
          </Disclosure>
        ) : null}
        {w.assets.length > 0 ? (
          <Disclosure summary="What it holds">
            <List>
              {w.assets.map((a) => (
                <ListRow key={a.id} icon="box" title={a.label} subtitle={a.goes} {...(a.value !== null ? { value: formatMoney(a.value, currency) } : {})} />
              ))}
            </List>
          </Disclosure>
        ) : null}
        {w.staff.length > 0 ? <Row k="Staff who would go" v={w.staff.map((s) => s.name).join(", ")} /> : null}
        {w.payments.length > 0 ? <Row k="Standing payments that would end" v={w.payments.map((p) => p.label).join(", ")} /> : null}
        {w.payouts.length > 0 ? (
          <List>
            {w.payouts.map((p, i) => (
              <ListRow key={p.party ?? `someone:${i}`} icon="user" title={p.name} subtitle={`${pct(p.share)} of what is left`} value={formatMoney(p.cents, currency)} />
            ))}
          </List>
        ) : null}
        {w.short > 0 ? <Banner tone="warn" title={`It is ${formatMoney(w.short, currency)} short`}>It can't be wound up until it can pay what it owes: sell something as it first, or put money in.</Banner> : null}
        {change ? (
          <>
            {begun ? null : <Seg<"all" | "begin"> label="How" value={stage} options={[{ value: "all", label: "All at once" }, { value: "begin", label: "Begin winding up" }]} onChange={setStage} />}
            {begun || stage === "all" ? <Seg<"distribute" | "sell"> label="Its property" value={property} options={[{ value: "distribute", label: "Hand to its owners" }, { value: "sell", label: "Sell it" }]} onChange={setProperty} /> : null}
            {(begun || stage === "all") && holders.length > 1 && w.assets.some((a) => a.value === null) ? <PickField label="Its things go to" value={to} options={holders} empty="Its largest owner" onChange={setTo} /> : null}
            <Controls name={`${org.id}-winding`}>
              {begun ? (
                <>
                  <DecideButton variant="danger" ok={!blocked} vote={vote} label="Finish and dissolve" voteLabel="Put finishing it to a vote" onGo={() => go("finish")} />
                  <Button disabled={barred} onClick={() => go("resume")}>
                    {vote ? "Put resuming to a vote" : "Resume trading"}
                  </Button>
                </>
              ) : (
                <DecideButton variant="danger" ok={stage === "all" ? !blocked : !barred} vote={vote} label={stage === "all" ? "Wind it up" : "Begin winding up"} onGo={() => go(stage)} />
              )}
            </Controls>
          </>
        ) : null}
      </div>
    </Section>
  );
}

/**
 * Merging (§3.13): another company the reader decides for, which way (fold it in, fold this one into
 * it, or take it over as a subsidiary), the ratio (by their values a unit unless said) and any cash;
 * short only of this company's votes (`vote`), put to its vote instead.
 */
export function MergePart(props: { org: OrgView; merge: MergeView; currency: WorldCurrency; change?(op: OrgOp, vote?: boolean): void }) {
  const { org, merge: m, currency } = props;
  const [other, setOther] = useState("");
  const [way, setWay] = useState<"in" | "out" | "keep">("in");
  const [ratio, setRatio] = useState("");
  const [cash, setCash] = useState("");
  const chosen = m.with.find((c) => c.id === other) ?? null;
  const self = { id: org.id, name: org.name, units: m.units, perUnit: m.perUnit };
  const [from, into] = way === "out" ? [self, chosen] : [chosen, self];
  // By their values a unit: units of the survivor for each of the merged company's.
  const byValue = from && into && into.perUnit > 0 ? from.perUnit / into.perUnit : null;
  const said = ratio.trim() === "" ? null : Number(ratio);
  const cents = cash.trim() === "" ? null : parseMoneyInput(cash, currency);
  const vote = m.vote === true;
  const ok = (m.why === null || vote) && chosen !== null && from !== null && into !== null && (said === null || (Number.isFinite(said) && said >= 0)) && (cents === null || cents >= 0) && (said !== null || byValue !== null || (cents ?? 0) > 0);
  const change = props.change;
  return (
    <Form summary="Merge" why={m.why} vote={vote}>
      <div class="lre-stack" data-lre-ownership-merge={org.id}>
        {(m.why === null || vote) && m.with.length === 0 ? <span class="lre-field-help">You decide for no other company to merge it with.</span> : null}
        <PickField label="With" value={other} options={m.with.map((c) => ({ value: c.id, label: c.name }))} empty="Choose a company" onChange={setOther} />
        <Seg<"in" | "out" | "keep"> label="Which way" value={way} options={[{ value: "in", label: "Fold it in here" }, { value: "out", label: `Fold ${org.name} into it` }, { value: "keep", label: "Take it over" }]} onChange={setWay} />
        <Field label={from && into ? `Units of ${into.name} for each of ${from.name}'s` : "Units for each unit"} help={byValue !== null ? `Empty: by their values a unit, ${Math.round(byValue * 10000) / 10000}.` : "Empty: by their values a unit."}>
          <input class="lre-input" type="number" inputMode="decimal" min={0} step="any" value={ratio} onInput={(event) => setRatio(event.currentTarget.value)} />
        </Field>
        <Field label="Cash to its holders, in all" help={into ? `From ${into.name}'s own account.` : undefined}>
          <MoneyInput currency={currency} value={cash} label="Cash to its holders" onInput={setCash} />
        </Field>
        {change ? (
          <DecideButton ok={ok} vote={vote} label={way === "keep" ? "Take it over" : "Merge them"} onGo={(v) => from && into && change({ do: "merge", org: from.id, into: into.id, ...(said !== null ? { ratio: said } : {}), ...(cents !== null && cents > 0 ? { cash: cents } : {}), ...(way === "keep" ? { keep: true } : {}) }, v)} />
        ) : null}
      </div>
    </Form>
  );
}

/** A wind-up or merger as the player's action (`org_wind_up`, `org_merge`), played as a turn; short of the votes, put to a vote (`vote`). */
export function asAction(act: OwnershipAct): (op: OrgOp, vote?: boolean) => void {
  return (op, vote) => {
    const asked: JsonObject = vote === true ? { vote: true } : {};
    if (op.do === "wind_up") act(ORG_ACTIONS.windUp, { org: op.org, ...(op.stage !== undefined ? { stage: op.stage } : {}), ...(op.property !== undefined ? { property: op.property } : {}), ...(op.to !== undefined ? { to: op.to } : {}), ...asked });
    else if (op.do === "merge") act(ORG_ACTIONS.merge, { org: op.org, into: op.into, ...(op.ratio !== undefined ? { ratio: op.ratio } : {}), ...(op.cash !== undefined ? { cash: op.cash } : {}), ...(op.keep === true ? { keep: true } : {}), ...asked });
  };
}

export function OrgOwnershipTab(props: OrgTabProps) {
  const app = useApp();
  const reader = useReader(props);
  const section = decodeOwnership(props.section);
  if (!section) return <JsonView value={props.section} />;
  const act: OwnershipAct | undefined = reader ? (action, params) => void reader.controls.act({ action, params }) : undefined;
  return <OrgOwnership org={props.org} section={section} reader={reader} nav={orgNav(props.org, reader, props.open, (to) => playElsewhere(app, to))} currency={props.state.currency ?? DEFAULT_CURRENCY} {...(act ? { act, change: asAction(act) } : {})} open={props.open} />;
}

/** Ownership in GM → Orgs: the cap table and the rest as Play draws them, which GM → Orgs edits; a person's route for their share is on their stake in GM → Money; winding up and merging as GM edits (an org op each). */
export function GmOrgOwnershipTab(props: OrgGmTabProps) {
  const section = decodeOwnership(props.section);
  if (!section) return <JsonView value={props.section} />;
  const nav: HubNav = { page: null, open: () => undefined, back: () => undefined, elsewhere: () => undefined, frame: "gm", backLabel: null };
  return <OrgOwnership org={props.org} section={section} reader={null} nav={nav} currency={props.gm.currency} change={(change) => void props.gm.edit([{ op: "org", change }])} open={props.open} gm={props.gm} />;
}
