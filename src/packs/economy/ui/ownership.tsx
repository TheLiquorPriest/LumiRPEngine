// A company's Ownership tab in Orgs (ORG-SPEC §4.4, §3.10, §3.13; `r.orgTab`, the economy's
// `ownership` section): its structure and how its decisions are made, the cap table (each holder's
// class, units, share of the worth, votes and, at Money 4, value), its classes, its valuation and
// value a unit, its Structure (who owns it, the subsidiaries it holds and what they add up to
// together), the reader's payouts (Pay out profit, an owner's draw, where their share goes), and its
// share and corporate controls: Sell shares (the reader's own stake), Issue shares, Buy back,
// Classes, Start a subsidiary and Change structure, each off with why where the reader may not, and
// on each subsidiary, selling part of the stake or putting more in, as the company. Everything but
// Classes plays as a turn. GM → Orgs draws it to read.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { FINANCE_ACTIONS, ROLE_RIGHTS, STRUCTURE_LABELS, type OwnershipView, type StructureLink } from "../../../shared/finance";
import type { JsonObject } from "../../../shared/json";
import { parseMoneyInput } from "../../../shared/money";
import { ORG_ACTIONS } from "../../../shared/org";
import type { OrgView } from "../../../shared/org-view";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../../../shared/world";
import { orgRoute, useApp, type SheetRoute } from "../../../frontend/app";
import { Button, Disclosure, Empty, Field, JsonView, List, ListRow, Row, Section } from "../../../frontend/components";
import { MoneyInput } from "../../../frontend/money-input";
import type { OrgGmTabProps, OrgTabProps } from "../../../frontend/registry";
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

/** One control's form, folded: off with why where the reader may not use it. */
function Form(props: { summary: string; why: string | null; children: ComponentChildren }) {
  return (
    <Disclosure summary={props.summary}>
      <div class="lre-stack" data-lre-ownership-form={props.summary}>
        {props.why !== null ? <span class="lre-field-help">{props.why}</span> : null}
        {props.children}
      </div>
    </Disclosure>
  );
}

/** Issue shares: to whom, how many units, at what price a unit (empty: its value a unit), in which class. */
function IssueForm(props: { org: OrgView; section: OwnershipView; people: readonly { value: string; label: string }[]; currency: WorldCurrency; why: string | null; act: OwnershipAct; to?: string; as?: string }) {
  const [to, setTo] = useState(props.to ?? "");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const [cls, setCls] = useState("");
  const n = wholeOf(units);
  const each = price.trim() === "" ? null : parseMoneyInput(price, props.currency);
  const ok = props.why === null && to !== "" && n !== null && (price.trim() === "" || (each !== null && each >= 0));
  return (
    <>
      {props.to === undefined ? <PickField label="To" value={to} options={props.people} empty="Choose who buys in" onChange={setTo} /> : null}
      <UnitsField label="Units" value={units} onInput={setUnits} help={props.section.units === null ? "It doesn't count units yet: its holders are counted in them first." : `Of ${props.section.units} now.`} />
      <Field label="Price a unit" help={props.section.valuation?.perUnit != null ? `Empty: its value a unit, ${formatMoney(Math.round(props.section.valuation.perUnit), props.currency)}.` : "Empty: its value a unit."}>
        <MoneyInput currency={props.currency} value={price} label="Price a unit" onInput={setPrice} />
      </Field>
      {props.section.classes ? <PickField label="Class" value={cls} options={props.section.classes.map((c) => ({ value: c.id, label: `${c.label} (${c.votes} votes a unit)` }))} empty="As theirs, else the first" onChange={setCls} /> : null}
      <Button variant="primary" disabled={!ok} onClick={() => props.act(FINANCE_ACTIONS.sharesIssue, { business: props.org.id, to, units: n ?? 0, ...(each !== null ? { price: each } : {}), ...(cls !== "" ? { class: cls } : {}), ...(props.as ? { as: props.as } : {}) })}>
        Issue the shares
      </Button>
    </>
  );
}

/** Buy back: whose units, how many, at what price a unit (empty: its value a unit). */
function BuyBackForm(props: { org: OrgView; section: OwnershipView; currency: WorldCurrency; why: string | null; act: OwnershipAct }) {
  const holders = props.section.owners.flatMap((o) => (o.party !== null && (o.units ?? 0) > 0 ? [{ value: o.party, label: `${o.name} (${o.units} units)` }] : []));
  const [from, setFrom] = useState("");
  const [units, setUnits] = useState("");
  const [price, setPrice] = useState("");
  const n = wholeOf(units);
  const each = price.trim() === "" ? null : parseMoneyInput(price, props.currency);
  const ok = props.why === null && from !== "" && n !== null && (price.trim() === "" || (each !== null && each >= 0));
  return (
    <>
      <PickField label="From" value={from} options={holders} empty="Choose whose units" onChange={setFrom} />
      <UnitsField label="Units" value={units} onInput={setUnits} />
      <Field label="Price a unit" help="Empty: its value a unit.">
        <MoneyInput currency={props.currency} value={price} label="Price a unit" onInput={setPrice} />
      </Field>
      <Button variant="primary" disabled={!ok} onClick={() => props.act(FINANCE_ACTIONS.sharesBuyBack, { business: props.org.id, from, units: n ?? 0, ...(each !== null ? { price: each } : {}) })}>
        Buy them back
      </Button>
    </>
  );
}

/** Classes: a class by name with its votes a unit, optionally a holder's units moved into it; at once. */
function ClassesForm(props: { org: OrgView; section: OwnershipView; why: string | null; act: OwnershipAct }) {
  const holders = props.section.owners.flatMap((o) => (o.party !== null && ROLE_RIGHTS[o.role].worth ? [{ value: o.party, label: o.name }] : []));
  const [label, setLabel] = useState("");
  const [votes, setVotes] = useState("1");
  const [holder, setHolder] = useState("");
  const id = useId();
  const v = Number(votes);
  const ok = props.why === null && label.trim() !== "" && votes.trim() !== "" && Number.isFinite(v) && v >= 0;
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
      <Button variant="primary" disabled={!ok} onClick={() => props.act(FINANCE_ACTIONS.sharesClasses, { business: props.org.id, label: label.trim(), votes: v, ...(holder !== "" ? { holder } : {}) })}>
        Save the class
      </Button>
    </>
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
function StructureForm(props: { org: OrgView; section: OwnershipView; why: string | null; act: OwnershipAct }) {
  const [structure, setStructure] = useState("");
  const options = Object.entries(STRUCTURE_LABELS).flatMap(([value, label]) => (value === props.section.structure ? [] : [{ value, label }]));
  return (
    <>
      <PickField label="Become" value={structure} options={options} empty="Choose a structure" onChange={setStructure} />
      <span class="lre-field-help">Draws and payouts change at once; its taxes from the next estimated-tax period.</span>
      <Button variant="primary" disabled={props.why !== null || structure === ""} onClick={() => props.act(ORG_ACTIONS.restructure, { org: props.org.id, structure })}>
        Change it
      </Button>
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

/** A subsidiary's row in Structure and its own below it, indented; with what it adds where values show. */
function ChildRows(props: { link: StructureLink; depth: number; currency: WorldCurrency; open(route: SheetRoute): void }): ComponentChildren {
  const l = props.link;
  const figures = [l.value !== null ? `worth ${formatMoney(l.value, props.currency)}` : null, l.cash !== null ? `cash ${formatMoney(l.cash, props.currency)}` : null, l.profit !== null ? `profit ${formatMoney(l.profit, props.currency)}` : null].filter((x) => x !== null);
  return (
    <>
      <ListRow id={l.id} icon="briefcase" title={`${"· ".repeat(props.depth)}${l.name}`} subtitle={[l.controlled ? "Controlled" : `${pct(l.votes)} of its votes`, ...figures].join(" · ")} value={pct(l.share)} chevron onClick={() => props.open(orgRoute(l.id))} />
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
export function OrgOwnership(props: { org: OrgView; section: OwnershipView; reader: Reader | null; nav: HubNav; currency?: WorldCurrency; act?: OwnershipAct; open?(route: SheetRoute): void }) {
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
                key={o.party ?? `someone:${i}`}
                icon="user"
                title={o.name}
                subtitle={[o.role !== "owner" ? o.role.replace(/_/g, " ") : null, section.classes && o.class ? o.class : null, o.units !== undefined ? `${o.units} units` : null, o.votes !== undefined && Math.abs(o.votes - o.share) > 0.005 ? `${pct(o.votes)} of the votes` : null].filter((x) => x !== null).join(" · ") || undefined}
                value={[o.share > 0 ? pct(o.share) : null, o.value !== undefined ? formatMoney(o.value, currency) : null].filter((x) => x !== null).join(" · ") || undefined}
              />
            ))}
          </List>
        )}
      </Section>
      {section.valuation ? (
        <Section title="Valuation">
          <div class="lre-stack" data-lre-ownership-valuation>
            <Row k="Value" v={formatMoney(section.valuation.value, currency)} sub={section.valuation.set ? "Set for it" : `Its books, ${formatMoney(section.valuation.book, currency)}, and ${section.valuation.multiple} × the last 12 months' profit, ${formatMoney(section.valuation.profit, currency)}`} />
            {section.valuation.perUnit !== null ? <Row k="A unit" v={formatMoney(Math.round(section.valuation.perUnit), currency)} /> : null}
          </div>
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
              <Row k="Net worth, with them at their books" v={formatMoney(section.consolidated.netWorth, currency)} />
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
              <Form summary="Issue shares" why={acts.decide}>
                <IssueForm org={org} section={section} people={people} currency={currency} why={acts.decide} act={act} />
              </Form>
              {section.units !== null ? (
                <Form summary="Buy back" why={acts.decide}>
                  <BuyBackForm org={org} section={section} currency={currency} why={acts.decide} act={act} />
                </Form>
              ) : null}
              <Form summary="Classes" why={acts.decide}>
                <ClassesForm org={org} section={section} why={acts.decide} act={act} />
              </Form>
              <Form summary="Start a subsidiary" why={acts.found}>
                <SubsidiaryForm org={org} section={section} currency={currency} act={act} />
              </Form>
              <Form summary="Change structure" why={acts.restructure}>
                <StructureForm org={org} section={section} why={acts.restructure} act={act} />
              </Form>
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

export function OrgOwnershipTab(props: OrgTabProps) {
  const app = useApp();
  const reader = useReader(props);
  const section = decodeOwnership(props.section);
  if (!section) return <JsonView value={props.section} />;
  const act: OwnershipAct | undefined = reader ? (action, params) => void reader.controls.act({ action, params }) : undefined;
  return <OrgOwnership org={props.org} section={section} reader={reader} nav={orgNav(props.org, reader, props.open, (to) => playElsewhere(app, to))} currency={props.state.currency ?? DEFAULT_CURRENCY} {...(act ? { act } : {})} open={props.open} />;
}

/** Ownership in GM → Orgs, to read: the cap table and the rest as Play draws them, which GM → Orgs edits; a person's route for their share is on their stake in GM → Money. */
export function GmOrgOwnershipTab(props: OrgGmTabProps) {
  const section = decodeOwnership(props.section);
  if (!section) return <JsonView value={props.section} />;
  const nav: HubNav = { page: null, open: () => undefined, back: () => undefined, elsewhere: () => undefined, frame: "gm", backLabel: null };
  return <OrgOwnership org={props.org} section={section} reader={null} nav={nav} currency={props.gm.currency} />;
}
