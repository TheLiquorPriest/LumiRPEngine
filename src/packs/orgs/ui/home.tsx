// Play → Orgs (ORG-SPEC §4.2): the organizations the player character belongs to and knows of, as
// the `orgs.list` view gives them. From the top: the party's card (who is in it by tier, who is here
// and who is away, and its purse when it has one), where they belong, grouped Households, Companies,
// Groups and Trusts, each with their title and the one figure they may see, folded, the
// organizations they know of with whom they know there, and Start something…: Start a company,
// Start a group (of one of the world's group kinds) and Name your party. A row whose organization has
// an alert that needs the player character carries the Needs you dot (`feed.tsx`). Each opens its
// page, the `org` sheet (org.tsx).

import { useId, useState } from "preact/hooks";
import { orgRoute, pushSheet, useApp } from "../../../frontend/app";
import { Badge, Button, Disclosure, Empty, Field, JsonView, List, ListRow, Section } from "../../../frontend/components";
import type { IconName } from "../../../frontend/icons";
import { MoneyInput } from "../../../frontend/money-input";
import type { PanelProps } from "../../../frontend/registry";
import { parseMoneyInput } from "../../../shared/money";
import { ORG_ACTIONS, type OrgType } from "../../../shared/org";
import { ORGS_ORG_PANEL, type OrgListView, type OrgRowView } from "../../../shared/org-view";
import { PARTY_TIERS, TIER_NOUNS } from "../../../shared/party";
import type { WorldCurrency } from "../../../shared/world";
import { decodeOrgList } from "./decode";
import { needsYouOf } from "./feed";
import { playOrgAction } from "./org";
import type { PartyAct } from "./party";
import { andList, count, hereAway } from "./words";

/** Each type's icon. */
export const TYPE_ICON: Readonly<Record<OrgType, IconName>> = { household: "home", company: "briefcase", group: "flag", trust: "shield", party: "users" };

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

/**
 * Start something… (§4.2, §3.13): Start a company (its name, its capital and the account it comes
 * from, and the units its shares are counted in when asked; off with why below Money 3, and not
 * offered where the world shows no money), Start a group (its name and kind; there only when the
 * world has group kinds), and Name your party. Founding plays as a turn; naming the party applies at
 * once.
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

/** The Needs you dot on a row whose organization has an alert that asks something of the reader. */
function needsDot(needs: ReadonlySet<string> | undefined, id: string) {
  return needs?.has(id) ? <span class="lre-dot" role="img" aria-label="Needs you" /> : undefined;
}

/**
 * The Orgs home, from its view; `onOpen` opens an organization's page, and with `act` and `currency`
 * Start something… plays. `needs` holds the organizations with an alert that needs the reader: their
 * rows carry the Needs you dot.
 */
export function OrgsHome(props: { list: OrgListView; onOpen(id: string): void; act?: PartyAct; currency?: WorldCurrency | null; needs?: ReadonlySet<string> }) {
  const { party, belong, known } = props.list;
  const lines = partyLines(party);
  const row = (r: OrgRowView, subtitle: string | undefined) => <ListRow key={r.id} id={r.id} icon={TYPE_ICON[r.type]} title={r.name} subtitle={subtitle} value={r.title ?? undefined} valueTone="muted" badge={needsDot(props.needs, r.id)} chevron onClick={() => props.onOpen(r.id)} />;
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
        const rows = belong.filter((r) => r.type === type);
        return rows.length === 0 ? null : (
          <div key={type} data-lre-orgs-group={type}>
            <Section title={label} flush>
              <List>{rows.map((r) => row(r, [type === "group" ? typeWord(r) : null, r.figure].filter((p) => p !== null).join(" · ") || undefined))}</List>
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
            <List>{known.map((r) => row(r, [typeWord(r), r.whom.length > 0 ? `You know ${andList(r.whom.map((p) => p.name))}` : null].filter((p) => p !== null).join(" · ")))}</List>
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
