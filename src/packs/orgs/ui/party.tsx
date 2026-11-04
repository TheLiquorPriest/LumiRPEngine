// The party's page (ORG-SPEC §4.5; assess-party §6.1), from its own section (`party`). Its Overview:
// the roster by tier, each with where they are as you know it, the order they're on (from its Plan)
// and since when; a hired hand whose job with the party has ended, offered Leave the party or Stay
// as a companion; and the leader's controls: Add someone you know (with a tier), Change a tier (or
// take them out), Name the party, Start a purse or, once it has one, Share out, and Hire a hand. The
// roster, the name and the purse are the leader's bookkeeping, applied at once with Undo; hiring and
// sharing out play as turns. Rules' part: what each tier means.

import { useId, useState } from "preact/hooks";
import type { SheetRoute } from "../../../frontend/app";
import { Banner, Button, Disclosure, Field, List, ListRow, Row, Section } from "../../../frontend/components";
import { list, str } from "../../../frontend/decode";
import { MoneyInput } from "../../../frontend/money-input";
import type { OrgTabProps } from "../../../frontend/registry";
import { isRecord, type JsonObject } from "../../../shared/json";
import { parseMoneyInput } from "../../../shared/money";
import type { OrgPersonView, OrgView } from "../../../shared/org-view";
import { isPlanStatusLive, PLAN_SECTION } from "../../../shared/org-feed";
import { isPartyTier, PARTY_OUT, PARTY_SECTION, PARTY_TIERS, TIER_LABELS, TIER_MEANINGS, type PartyCan, type PartySectionView, type PartyTier } from "../../../shared/party";
import type { WorldCurrency } from "../../../shared/world";
import { decodePlan } from "./decode";
import { andList, TIER_HEADINGS } from "./words";

/** A party action as the page sends it: its id and params; the sheet plays it (`OrgPageProps.act`). */
export type PartyAct = (action: string, params: JsonObject) => void;

/** The economy's share-out, which pays the party's core and companions equally. */
export const SHARE_OUT_ACTION = "org_share_out";

/** The pay bases Hire a hand offers, the first the default. */
const BASES: readonly { id: string; label: string }[] = [
  { id: "hourly", label: "By the hour" },
  { id: "per_shift", label: "By the shift" },
  { id: "salary", label: "A salary" },
  { id: "stipend", label: "A set sum each payday" },
];

function named(v: unknown): { id: string; name: string } | null {
  return isRecord(v) && typeof v.id === "string" ? { id: v.id, name: str(v.name, v.id) } : null;
}

function reason(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** The party's section of its page; null for a shape it isn't. */
export function decodePartySection(value: unknown): PartySectionView | null {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.members)) return null;
  const leader = named(value.leader);
  const can = isRecord(value.can) ? value.can : {};
  const purse = isRecord(value.purse) && typeof value.purse.account === "string" ? { account: value.purse.account, name: str(value.purse.name, value.purse.account), balance: str(value.purse.balance) } : null;
  return {
    id: value.id,
    exists: value.exists === true,
    leader: leader ?? { id: "", name: "" },
    members: list(value.members, (m) => (typeof m.id === "string" && isPartyTier(m.tier) ? { id: m.id, tier: m.tier, where: reason(m.where) } : null)),
    candidates: list(value.candidates, named),
    offers: list(value.offers, (o) => (typeof o.id === "string" && typeof o.job === "string" ? { id: o.id, name: str(o.name, o.id), job: o.job } : null)),
    purse,
    sources: list(value.sources, (s) => (typeof s.id === "string" ? { id: s.id, name: str(s.name, s.id), balance: str(s.balance) } : null)),
    shareOut: list(value.shareOut, named),
    can: { manage: reason(can.manage), name: reason(can.name), purse: reason(can.purse), hire: reason(can.hire), shareOut: reason(can.shareOut) } satisfies PartyCan,
  };
}

/** The party's section on its page, read; null on any other page. */
export function partySectionOf(org: OrgView): PartySectionView | null {
  return org.type === "party" ? decodePartySection(org.sections[PARTY_SECTION]) : null;
}

/** A member's row line: where they are when away, the order they're on, and since when. */
function memberLine(p: OrgPersonView, where: string | null, order: string | null): string | undefined {
  const parts = [p.here ? null : where ? `${where[0]?.toUpperCase()}${where.slice(1)}` : null, order ? `On: ${order}` : null, p.since ? `Since ${p.since}` : null].filter((x) => x !== null);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

/** The roster by tier (Core, Companions, Hired, Allies): each with where they are as you know it, the order they're on and since when, opening their person sheet. */
export function PartyRoster(props: { org: OrgView; section: PartySectionView | null; open(route: SheetRoute): void }) {
  const others = props.org.people.filter((p) => !p.you);
  const where = (id: string): string | null => props.section?.members.find((m) => m.id === id)?.where ?? null;
  const plan = decodePlan(props.org.sections[PLAN_SECTION]);
  const orders = plan ? [...plan.goals.flatMap((g) => g.orders), ...plan.orders].filter((o) => isPlanStatusLive(o.status)) : [];
  const order = (id: string): string | null => orders.find((o) => o.to.some((t) => t.id === id))?.text ?? null;
  return (
    <div class="lre-stack" data-lre-party-roster={props.org.id}>
      {PARTY_TIERS.map((tier) => {
        const roster = others.filter((p) => p.hows.includes(tier));
        return roster.length === 0 ? null : (
          <Section key={tier} title={TIER_HEADINGS[tier]} flush>
            <List>
              {roster.map((p) => (
                <ListRow key={p.id} id={p.id} icon="user" title={p.name} subtitle={memberLine(p, where(p.id), order(p.id))} value={p.here ? "Here" : "Away"} valueTone="muted" chevron onClick={() => props.open({ kind: "person", id: p.id })} />
              ))}
            </List>
          </Section>
        );
      })}
    </div>
  );
}

/** A hired hand whose job with the party has ended, asked whether they leave it (§3.12): Leave the party, or Stay as a companion. */
export function PartyOffers(props: { section: PartySectionView; act?: PartyAct }) {
  const { act } = props;
  return (
    <div class="lre-stack" data-lre-party-offers>
      {props.section.offers.map((o) => (
        <div key={o.id} data-lre-party-offer={o.id}>
          <Banner
            tone="info"
            icon="users"
            title={`${o.name}'s job with the party has ended`}
            actions={
              act && props.section.can.manage === null ? (
                <>
                  <Button size="sm" onClick={() => act("party_tier", { who: o.id, tier: PARTY_OUT })}>
                    Leave the party
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => act("party_tier", { who: o.id, tier: "companion" })}>
                    Stay as a companion
                  </Button>
                </>
              ) : undefined
            }
          >
            Do they leave the party, or stay on unpaid?
          </Banner>
        </div>
      ))}
    </div>
  );
}

/** The tiers as a select offers them, and, for a change, Out of the party. */
function TierSelect(props: { id: string; value: string; out?: boolean; onChange(value: string): void }) {
  return (
    <select id={props.id} class="lre-input" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
      {PARTY_TIERS.map((t) => (
        <option key={t} value={t}>
          {TIER_LABELS[t]}
        </option>
      ))}
      {props.out ? <option value={PARTY_OUT}>Out of the party</option> : null}
    </select>
  );
}

/** Someone picked from a list, by name. */
function PersonSelect(props: { id: string; value: string; people: readonly { id: string; name: string }[]; onChange(value: string): void }) {
  return (
    <select id={props.id} class="lre-input" value={props.value} onChange={(event) => props.onChange(event.currentTarget.value)}>
      {props.people.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

/**
 * The leader's controls (§4.5): Add someone you know, Change a tier, Name the party, Start a purse
 * or Share out, Hire a hand. Each is disabled with why while the leader may not, and each sends one
 * action.
 */
export function PartyControls(props: { org: OrgView; section: PartySectionView; currency: WorldCurrency; act: PartyAct }) {
  const { section, act, currency } = props;
  const { can } = section;
  const field = { add: useId(), addTier: useId(), who: useId(), tier: useId(), name: useId(), from: useId(), hand: useId(), title: useId(), basis: useId() };
  const people = props.org.people.filter((p) => !p.you);
  const [add, setAdd] = useState("");
  const [addTier, setAddTier] = useState<PartyTier>("companion");
  const [who, setWho] = useState("");
  const [tier, setTier] = useState<string>("core");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState("");
  const [shared, setShared] = useState("");
  const [hand, setHand] = useState("");
  const [title, setTitle] = useState("");
  const [rate, setRate] = useState("");
  const [basis, setBasis] = useState(BASES[0]?.id ?? "hourly");
  const adding = add || section.candidates[0]?.id || "";
  const changing = who || people[0]?.id || "";
  const source = from || section.sources[0]?.id || "";
  const hands = [...section.candidates, ...people.filter((p) => !p.hows.includes("hired")).map((p) => ({ id: p.id, name: p.name }))].sort((a, b) => a.name.localeCompare(b.name));
  const hiring = hand || hands[0]?.id || "";
  const cents = (text: string): number | null => {
    const n = parseMoneyInput(text, currency);
    return n !== null && n > 0 ? n : null;
  };
  return (
    <div class="lre-stack" data-lre-party-controls={section.id}>
      {can.manage === null ? (
        <Disclosure summary="Add someone you know">
          <div class="lre-stack" data-lre-party-control="add">
            {section.candidates.length === 0 ? (
              <span>There's no one you know who isn't in it already.</span>
            ) : (
              <>
                <Field label="Who" for={field.add}>
                  <PersonSelect id={field.add} value={adding} people={section.candidates} onChange={setAdd} />
                </Field>
                <Field label="Tier" for={field.addTier} help={isPartyTier(addTier) ? TIER_MEANINGS[addTier] : undefined}>
                  <TierSelect id={field.addTier} value={addTier} onChange={(v) => setAddTier(isPartyTier(v) ? v : "companion")} />
                </Field>
                <Button variant="primary" disabled={adding === ""} onClick={() => act("party_tier", { who: adding, tier: addTier })}>
                  Add to the party
                </Button>
              </>
            )}
          </div>
        </Disclosure>
      ) : null}
      {can.manage === null && people.length > 0 ? (
        <Disclosure summary="Change a tier">
          <div class="lre-stack" data-lre-party-control="tier">
            <Field label="Who" for={field.who}>
              <PersonSelect id={field.who} value={changing} people={people} onChange={setWho} />
            </Field>
            <Field label="Tier" for={field.tier}>
              <TierSelect id={field.tier} value={tier} out onChange={setTier} />
            </Field>
            <Button disabled={changing === ""} onClick={() => act("party_tier", { who: changing, tier })}>
              {tier === PARTY_OUT ? "Take out of the party" : "Change tier"}
            </Button>
          </div>
        </Disclosure>
      ) : null}
      {can.name === null ? (
        <Disclosure summary={section.exists ? "Rename the party" : "Name the party"}>
          <div class="lre-stack" data-lre-party-control="name">
            <Field label="Name" for={field.name}>
              <input id={field.name} class="lre-input" value={name} placeholder={props.org.name} maxLength={60} onInput={(event) => setName(event.currentTarget.value)} />
            </Field>
            <Button disabled={name.trim() === ""} onClick={() => act("party_name", { name: name.trim() })}>
              {section.exists ? "Rename it" : "Name it"}
            </Button>
          </div>
        </Disclosure>
      ) : null}
      {section.purse ? (
        <Disclosure summary="Share out">
          <div class="lre-stack" data-lre-party-control="share">
            <Field label="Amount" help={can.shareOut ?? `Paid equally to ${andList(section.shareOut.map((p) => p.name))}`}>
              <MoneyInput currency={currency} value={shared} label="Amount to share out" onInput={setShared} />
            </Field>
            <Button disabled={can.shareOut !== null || cents(shared) === null} onClick={() => act(SHARE_OUT_ACTION, { org: section.id, amount: cents(shared) ?? 0 })}>
              Share out
            </Button>
          </div>
        </Disclosure>
      ) : can.manage === null ? (
        <Disclosure summary="Start a purse">
          <div class="lre-stack" data-lre-party-control="purse">
            <Field label="Your deposit" help={can.purse ?? "An account the party owns: core members see it, and you spend from it."}>
              <MoneyInput currency={currency} value={amount} label="Your deposit" onInput={setAmount} />
            </Field>
            {section.sources.length > 1 ? (
              <Field label="From" for={field.from}>
                <select id={field.from} class="lre-input" value={source} onChange={(event) => setFrom(event.currentTarget.value)}>
                  {section.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.balance})
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <Button variant="primary" disabled={can.purse !== null || cents(amount) === null || source === ""} onClick={() => act("party_purse", { amount: cents(amount) ?? 0, from: source })}>
              Start a purse
            </Button>
          </div>
        </Disclosure>
      ) : null}
      {can.manage === null ? (
        <Disclosure summary="Hire a hand">
          <div class="lre-stack" data-lre-party-control="hire">
            {can.hire !== null ? (
              <span>{can.hire}</span>
            ) : (
              <>
                <Field label="Who" for={field.hand}>
                  <PersonSelect id={field.hand} value={hiring} people={hands} onChange={setHand} />
                </Field>
                <Field label="As" for={field.title}>
                  <input id={field.title} class="lre-input" value={title} placeholder="Deckhand, guide, driver…" onInput={(event) => setTitle(event.currentTarget.value)} />
                </Field>
                <Field label="Paid" for={field.basis}>
                  <select id={field.basis} class="lre-input" value={basis} onChange={(event) => setBasis(event.currentTarget.value)}>
                    {BASES.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Rate">
                  <MoneyInput currency={currency} value={rate} label="Pay rate" onInput={setRate} />
                </Field>
                <Button disabled={hiring === "" || cents(rate) === null} onClick={() => act("party_hire", { worker: hiring, ...(title.trim() !== "" ? { title: title.trim() } : {}), basis, rate: cents(rate) ?? 0 })}>
                  Hire them
                </Button>
              </>
            )}
          </div>
        </Disclosure>
      ) : null}
    </div>
  );
}

/** The party's own part of its Overview: its roster, the offers to a hired hand whose job ended, its purse, and the leader's controls when the page can play them. */
export function PartyOverview(props: { org: OrgView; currency: WorldCurrency | null; act?: PartyAct; open(route: SheetRoute): void }) {
  const section = partySectionOf(props.org);
  const { act, currency } = props;
  return (
    <div class="lre-stack" data-lre-party={props.org.id}>
      <PartyRoster org={props.org} section={section} open={props.open} />
      {section && section.offers.length > 0 ? <PartyOffers section={section} {...(act ? { act } : {})} /> : null}
      {section?.purse ? (
        <Section title="Purse">
          <Row k={section.purse.name} v={section.purse.balance} />
        </Section>
      ) : null}
      {section && act && currency ? <PartyControls org={props.org} section={section} currency={currency} act={act} /> : null}
    </div>
  );
}

/** Rules' part for the party: what each tier means. */
export function PartyTiers(props: OrgTabProps) {
  if (props.org.type !== "party") return null;
  return (
    <div data-lre-party-tiers={props.org.id}>
      <List>
        {PARTY_TIERS.map((t) => (
          <ListRow key={t} title={TIER_LABELS[t]} subtitle={TIER_MEANINGS[t]} />
        ))}
      </List>
    </div>
  );
}
