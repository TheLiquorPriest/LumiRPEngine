// Play → Orgs (ORG-SPEC §4.2): the organizations the player character belongs to and knows of, as
// the `orgs.list` view gives them. From the top: the party's card (who is in it by tier, who is here
// and who is away, and its purse when it has one), where they belong as a tree from each ultimate
// parent down (any type under any type, each held one under the holder it sits under, `under`, with
// how that one holds it), its roots grouped Households, Companies, Groups and Trusts, each with their
// title and the one figure they may see; folded, the organizations they know of, with whom they know
// there; and Start something…: Start a company, Settle a trust, Start a nonprofit, Start a group (of
// one of the world's group kinds) and Name your party. A row whose organization has an alert that
// needs the player character says so (`feed.tsx`). Each opens its page, the `org` sheet (org.tsx).

import { useId, useState } from "preact/hooks";
import { orgRoute, orgRouteOf, pushSheet, useApp } from "../../../frontend/app";
import { CheckField } from "../../../frontend/build/form-kit";
import { Badge, Button, Disclosure, Empty, Field, JsonView, List, ListRow, Section } from "../../../frontend/components";
import { MoneyInput } from "../../../frontend/money-input";
import type { PanelProps } from "../../../frontend/registry";
import { parseMoneyInput } from "../../../shared/money";
import { ORG_ACTIONS, type OrgType } from "../../../shared/org";
import { ORGS_ORG_PANEL, type OrgListView, type OrgRowView } from "../../../shared/org-view";
import { PARTY_TIERS, TIER_NOUNS } from "../../../shared/party";
import type { WorldCurrency } from "../../../shared/world";
import type { ChartNode } from "./chart-model";
import { Tree } from "./chart";
import { decodeOrgList } from "./decode";
import { needsYouOf } from "./feed";
import { playOrgAction } from "./org";
import type { PartyAct } from "./party";
import { andList, count, hereAway, linkWords, TYPE_ICON } from "./words";

/** Where one belongs, in the home's order and under its headings. */
const BELONG_GROUPS: readonly { type: OrgType; label: string }[] = [
  { type: "household", label: "Households" },
  { type: "company", label: "Companies" },
  { type: "group", label: "Groups" },
  { type: "trust", label: "Trusts" },
];

/** A row's type in a word: a group's own kind ("Faction"), else the type's. */
function typeWord(row: OrgRowView): string {
  return row.type === "group" ? row.kind || "Group" : row.type === "company" ? "Company" : row.type === "household" ? "Household" : row.type === "trust" ? "Trust" : "Party";
}

/**
 * The home's rows as trees (§4.2, item 4b): each row under the one it sits under (`under`) when that
 * one is among `rows`, a loop broken where it would close, the rest roots in their order. A root says
 * what kind of group it is; a row under another says its type and how that one holds it ("Company ·
 * 60% · Controlled"), then its figure, with the reader's title at its end; `whom` names whom the
 * reader knows there; one with an alert that needs the reader says so.
 */
export function homeTree(rows: readonly (OrgRowView & { whom?: readonly { name: string }[] })[], needs?: ReadonlySet<string>): ChartNode[] {
  const ids = new Set(rows.map((r) => r.id));
  const parent = new Map<string, string | null>();
  for (const r of rows) {
    // Its line up, as far as `rows` go: a holder already on that line would close a loop, so it starts one here instead.
    const seen = new Set([r.id]);
    let up = r.under !== null && ids.has(r.under) ? r.under : null;
    for (let at = up; at !== null; at = parent.get(at) ?? null) {
      if (seen.has(at)) {
        up = null;
        break;
      }
      seen.add(at);
    }
    parent.set(r.id, up);
  }
  const build = (r: OrgRowView & { whom?: readonly { name: string }[] }): ChartNode => {
    const nested = parent.get(r.id) !== null;
    const via = nested && r.via ? linkWords(r.via) : "";
    const whom = r.whom && r.whom.length > 0 ? `You know ${andList(r.whom.map((p) => p.name))}` : null;
    return {
      key: r.id,
      label: r.name,
      detail: [nested || r.type === "group" || r.whom !== undefined ? typeWord(r) : null, via || null, r.figure, whom].filter((part) => part !== null).join(" · ") || null,
      value: r.title,
      icon: TYPE_ICON[r.type],
      badges: [...(nested && r.via?.controlled ? [{ text: "Controlled", tone: "neutral" as const }] : []), ...(needs?.has(r.id) ? [{ text: "Needs you", tone: "accent" as const }] : [])],
      open: orgRoute(r.id),
      actions: [],
      children: rows.filter((c) => parent.get(c.id) === r.id).map(build),
    };
  };
  return rows.filter((r) => parent.get(r.id) === null).map(build);
}

/**
 * The party's card lines (§4.2): who is in it, by first name and then by tier ("Danny · 1
 * companion"; "Just you" alone), and how many are here and away. Those the player character
 * can't see are counted, tier unknown.
 */
export function partyLines(party: OrgListView["party"]): { who: string; where: string | null } {
  const { members, hidden } = party;
  if (members.length === 0 && hidden === 0) return { who: "Just you", where: null };
  const names = members.slice(0, 3).map((m) => m.name.split(/\s+/)[0] || m.name);
  const more = members.length - names.length + hidden;
  const who = andList(more > 0 ? [...names, count(more, "other", "others")] : names);
  const tiers = PARTY_TIERS.flatMap((tier) => {
    const n = members.filter((m) => m.tier === tier).length;
    return n > 0 ? [count(n, ...TIER_NOUNS[tier])] : [];
  });
  const here = members.filter((m) => m.here).length;
  return { who: [who, ...tiers].join(" · "), where: hereAway(here, members.length - here) };
}

/** The money a founding puts in, and the account it comes from where there is more than one. */
function FundFields(props: { currency: WorldCurrency; label: string; help: string; amount: string; onAmount(v: string): void; sources: OrgListView["start"]["company"]["sources"]; from: string; onFrom(v: string): void }) {
  const id = useId();
  return (
    <>
      <Field label={props.label} help={props.help}>
        <MoneyInput currency={props.currency} value={props.amount} label={props.label} onInput={props.onAmount} />
      </Field>
      {props.sources.length > 1 ? (
        <Field label="From" for={id}>
          <select id={id} class="lre-input" value={props.from || props.sources[0]?.id} onChange={(event) => props.onFrom(event.currentTarget.value)}>
            {props.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.balance})
              </option>
            ))}
          </select>
        </Field>
      ) : null}
    </>
  );
}

/**
 * Settle a trust (`org_found` with `type: "trust"`, from Money 3): its name, what you put in (none
 * is fine) and from where, what it is for, whether you may take it back, and the day it ends; you
 * are its first trustee and beneficiary, and more join as its officers and owners.
 */
function TrustStart(props: { start: OrgListView["start"]["trust"]; currency: WorldCurrency; act: PartyAct }) {
  const { start, currency } = props;
  const ids = { name: useId(), purpose: useId(), until: useId() };
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  const [purpose, setPurpose] = useState("");
  const [until, setUntil] = useState("");
  const [revocable, setRevocable] = useState(false);
  const cents = amount.trim() === "" ? 0 : parseMoneyInput(amount, currency);
  const source = from || start.sources[0]?.id || "";
  return (
    <div class="lre-stack" data-lre-orgs-start-kind="trust">
      <Field label="Its name" for={ids.name}>
        <input id={ids.name} class="lre-input" value={name} maxLength={60} placeholder="The Ellis Family Trust" onInput={(event) => setName(event.currentTarget.value)} />
      </Field>
      <FundFields currency={currency} label="Put in" help={start.why ?? "Optional. You are its first trustee and its beneficiary; add others as its officers and owners later."} amount={amount} onAmount={setAmount} sources={start.sources} from={from} onFrom={setFrom} />
      <Field label="What it is for" for={ids.purpose}>
        <input id={ids.purpose} class="lre-input" value={purpose} maxLength={200} placeholder="The children's schooling" onInput={(event) => setPurpose(event.currentTarget.value)} />
      </Field>
      <Field label="Ends on" for={ids.until} help="Optional: the day it ends.">
        <input id={ids.until} class="lre-input" type="date" value={until} onInput={(event) => setUntil(event.currentTarget.value)} />
      </Field>
      <CheckField label="Revocable" help="You may take it back." checked={revocable} onChange={setRevocable} />
      <Button variant="primary" disabled={start.why !== null || name.trim() === "" || cents === null || cents < 0 || (cents > 0 && source === "")} onClick={() => props.act(ORG_ACTIONS.found, { type: "trust", name: name.trim(), ...(cents !== null && cents > 0 ? { amount: cents, from: source } : {}), ...(purpose.trim() !== "" ? { purpose: purpose.trim() } : {}), ...(until !== "" ? { until } : {}), ...(revocable ? { revocable: true } : {}) })}>
        Settle the trust
      </Button>
    </div>
  );
}

/** Start a nonprofit (`org_found` with `type: "nonprofit"`, from Money 3): its name and what you give it, if anything; no one owns its worth, and you are its Director. */
function NonprofitStart(props: { start: OrgListView["start"]["nonprofit"]; currency: WorldCurrency; act: PartyAct }) {
  const { start, currency } = props;
  const id = useId();
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  const cents = amount.trim() === "" ? 0 : parseMoneyInput(amount, currency);
  const source = from || start.sources[0]?.id || "";
  return (
    <div class="lre-stack" data-lre-orgs-start-kind="nonprofit">
      <Field label="Its name" for={id}>
        <input id={id} class="lre-input" value={name} maxLength={60} placeholder="Port Alder Food Bank" onInput={(event) => setName(event.currentTarget.value)} />
      </Field>
      <FundFields currency={currency} label="Give it" help={start.why ?? "Optional: a gift into its account. No one owns its worth; you are its Director."} amount={amount} onAmount={setAmount} sources={start.sources} from={from} onFrom={setFrom} />
      <Button variant="primary" disabled={start.why !== null || name.trim() === "" || cents === null || cents < 0 || (cents > 0 && source === "")} onClick={() => props.act(ORG_ACTIONS.found, { type: "nonprofit", name: name.trim(), ...(cents !== null && cents > 0 ? { amount: cents, from: source } : {}) })}>
        Start the nonprofit
      </Button>
    </div>
  );
}

/**
 * Start something… (§4.2, §3.13): Start a company (its name, its capital and the account it comes
 * from, and the units its shares are counted in when asked; off with why below Money 3, and not
 * offered where the world shows no money), Settle a trust and Start a nonprofit (likewise), Start a
 * group (its name and kind; there only when the world has group kinds), and Name your party. Each
 * is done at once, off screen, with its Undo.
 */
export function StartSomething(props: { list: OrgListView; currency: WorldCurrency | null; act: PartyAct }) {
  const { list, currency, act } = props;
  const { company, group } = list.start;
  const field = { company: useId(), from: useId(), units: useId(), group: useId(), kind: useId(), party: useId() };
  const [companyName, setCompanyName] = useState("");
  const [capital, setCapital] = useState("");
  const [from, setFrom] = useState("");
  const [units, setUnits] = useState("");
  const [groupName, setGroupName] = useState("");
  const [kind, setKind] = useState("");
  const [partyName, setPartyName] = useState("");
  const cents = currency ? parseMoneyInput(capital, currency) : null;
  const source = from || company.sources[0]?.id || "";
  const ofKind = kind || group?.kinds[0]?.id || "";
  const count = units.trim() === "" ? null : Number(units);
  const countOk = count === null || (Number.isSafeInteger(count) && count > 0);
  return (
    <div data-lre-orgs-start>
      <Section title="Start something…">
        <div class="lre-stack">
          {currency ? (
            <Disclosure summary="Start a company">
              <div class="lre-stack" data-lre-orgs-start-kind="company">
                <Field label="Its name" for={field.company}>
                  <input id={field.company} class="lre-input" value={companyName} maxLength={60} placeholder="Ellis Mobile Repair" onInput={(event) => setCompanyName(event.currentTarget.value)} />
                </Field>
                <Field label="Capital" help={company.why ?? "You put it in, and you own all of it."}>
                  <MoneyInput currency={currency} value={capital} label="Capital" onInput={setCapital} />
                </Field>
                {company.sources.length > 1 ? (
                  <Field label="From" for={field.from}>
                    <select id={field.from} class="lre-input" value={source} onChange={(event) => setFrom(event.currentTarget.value)}>
                      {company.sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.balance})
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                <Field label="Units" for={field.units} help="Optional: count its shares in units, so partners can buy in by the unit later. Empty, you simply own all of it.">
                  <input id={field.units} class="lre-input" type="number" inputMode="numeric" min={1} step={1} value={units} placeholder="1000" aria-invalid={!countOk} onInput={(event) => setUnits(event.currentTarget.value)} />
                </Field>
                <Button variant="primary" disabled={company.why !== null || companyName.trim() === "" || cents === null || cents <= 0 || source === "" || !countOk} onClick={() => act(ORG_ACTIONS.found, { type: "company", name: companyName.trim(), amount: cents ?? 0, from: source, ...(count !== null ? { units: count } : {}) })}>
                  Start the company
                </Button>
              </div>
            </Disclosure>
          ) : null}
          {currency ? (
            <Disclosure summary="Settle a trust">
              <TrustStart start={list.start.trust} currency={currency} act={act} />
            </Disclosure>
          ) : null}
          {currency ? (
            <Disclosure summary="Start a nonprofit">
              <NonprofitStart start={list.start.nonprofit} currency={currency} act={act} />
            </Disclosure>
          ) : null}
          {group ? (
            <Disclosure summary="Start a group">
              <div class="lre-stack" data-lre-orgs-start-kind="group">
                <Field label="Its name" for={field.group}>
                  <input id={field.group} class="lre-input" value={groupName} maxLength={60} onInput={(event) => setGroupName(event.currentTarget.value)} />
                </Field>
                <Field label="Kind" for={field.kind} help="You lead it, with every power over it.">
                  <select id={field.kind} class="lre-input" value={ofKind} onChange={(event) => setKind(event.currentTarget.value)}>
                    {group.kinds.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button variant="primary" disabled={groupName.trim() === "" || ofKind === ""} onClick={() => act(ORG_ACTIONS.found, { type: "group", name: groupName.trim(), kind: ofKind })}>
                  Start the group
                </Button>
              </div>
            </Disclosure>
          ) : null}
          <Disclosure summary="Name your party">
            <div class="lre-stack" data-lre-orgs-start-kind="party">
              <Field label="Its name" for={field.party}>
                <input id={field.party} class="lre-input" value={partyName} maxLength={60} placeholder={list.party.name} onInput={(event) => setPartyName(event.currentTarget.value)} />
              </Field>
              <Button disabled={partyName.trim() === ""} onClick={() => act("party_name", { name: partyName.trim() })}>
                Name it
              </Button>
            </div>
          </Disclosure>
        </div>
      </Section>
    </div>
  );
}

/** The Needs you dot on the party's row when it has an alert that asks something of the reader. */
function needsDot(needs: ReadonlySet<string> | undefined, id: string) {
  return needs?.has(id) ? <span class="lre-dot" role="img" aria-label="Needs you" /> : undefined;
}

/**
 * The Orgs home, from its view; `onOpen` opens an organization's page, and with `act` and `currency`
 * Start something… plays. `needs` holds the organizations with an alert that needs the reader: their
 * rows say so.
 */
export function OrgsHome(props: { list: OrgListView; onOpen(id: string): void; act?: PartyAct; currency?: WorldCurrency | null; needs?: ReadonlySet<string> }) {
  const { party, belong, known } = props.list;
  const lines = partyLines(party);
  const roots = homeTree(belong, props.needs);
  const go = (a: { route?: { id: string } }) => (a.route ? props.onOpen(orgRouteOf(a.route.id).org) : undefined);
  return (
    <div class="lre-stack" data-lre-panel="orgs.list">
      <div data-lre-orgs-party={party.id}>
        <Section flush>
          <List>
            <ListRow icon={TYPE_ICON.party} title={party.name} subtitle={lines.who} value={lines.where ?? undefined} valueTone="muted" badge={needsDot(props.needs, party.id)} chevron id={party.exists ? party.id : undefined} onClick={() => props.onOpen(party.id)} />
            {party.purse !== null ? <ListRow icon="wallet" title="Purse" value={party.purse} onClick={() => props.onOpen(party.id)} /> : null}
          </List>
        </Section>
      </div>
      {belong.length === 0 ? <Empty icon="briefcase">You don't belong to any organization yet.</Empty> : null}
      {BELONG_GROUPS.map(({ type, label }) => {
        const nodes = roots.filter((n) => belong.find((r) => r.id === n.key)?.type === type);
        return nodes.length === 0 ? null : (
          <div key={type} data-lre-orgs-group={type}>
            <Section title={label} flush>
              <Tree label={label} top={label} nodes={nodes} onGo={go} />
            </Section>
          </div>
        );
      })}
      {known.length > 0 ? (
        <div data-lre-orgs-known>
          <Disclosure
            summary={
              <span>
                Known organizations <Badge>{known.length}</Badge>
              </span>
            }
          >
            <Tree label="Known organizations" top="Known organizations" nodes={homeTree(known, props.needs)} onGo={go} />
          </Disclosure>
        </div>
      ) : null}
      {props.act ? <StartSomething list={props.list} currency={props.currency ?? null} act={props.act} /> : null}
    </div>
  );
}

export function OrgsPanel(props: PanelProps) {
  const app = useApp();
  if (props.view === null || props.view === undefined) return <Empty icon="briefcase">No organizations here.</Empty>;
  const list = decodeOrgList(props.view);
  if (!list) return <JsonView value={props.view} />;
  const needs = new Set(needsYouOf(props.state.panels[ORGS_ORG_PANEL]).map((n) => n.org));
  return <OrgsHome list={list} onOpen={(id) => app.ui.update((ui) => pushSheet(ui, orgRoute(id)))} act={playOrgAction(app, props.chatId)} currency={props.state.currency} needs={needs} />;
}
