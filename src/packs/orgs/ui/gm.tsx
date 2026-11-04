// GM → Orgs (ORG-SPEC §6.1; GM tab `orgs.orgs`, order 28, behind the gate): every organization, the
// party first, with search and type chips, each opening the same page Play's Orgs draws (`OrgPage`),
// as the GM sees it (every member named, every pack's section built), with the GM's controls:
// - People: its members by `member_of` (add one; set their title, position, rank and since; remove
//   them), a company's or a trust's owners (add one, set their role and share, remove them), and a
//   company's jobs (add one, edit its fields, end it);
// - Who may…: pick a person and a power; the answer is the chain of bases it rests on, or the reason;
// - History: its own History (`orgs.log`), then this chat's edits in force that name it, newest first;
// - Fields: every field it declares, each with ✎.
// Each save is one `lre.edit`, with its GM edit chip, and the GM view's notice says it with its Undo.
// A pack's tab drawn here is its `gm` component when it has one (`OrgTabDef.gm`), else its Play one.

import { createContext, type ComponentChildren, type ComponentType } from "preact";
import { useContext, useId, useState } from "preact/hooks";
import { orgRouteOf, pushSheet, useApp, useView, type SheetRoute } from "../../../frontend/app";
import { Chip, RefPicker } from "../../../frontend/build/form-kit";
import { Badge, Button, Empty, Field, List, ListRow, Section } from "../../../frontend/components";
import { decodeOrgView } from "./decode";
import { humanize } from "../../../frontend/format";
import { FieldRow } from "../../../frontend/gm/entity";
import { gmOpen } from "../../../frontend/gm/gate";
import { ActionRow, ActionRows, GmPage, useGmFocus, usePages } from "../../../frontend/gm/ui";
import { Icon } from "../../../frontend/icons";
import { MoneyInput } from "../../../frontend/money-input";
import type { GmSectionProps, OrgTabDef, OrgTabProps } from "../../../frontend/registry";
import { OWNER_ROLES, PAY_BASES, PAY_CHOICE_LABELS, PAY_CHOICES, UNPAID, type OwnerRole } from "../../../shared/finance";
import { isRecord, type JsonObject, type JsonValue } from "../../../shared/json";
import { parseMoneyInput } from "../../../shared/money";
import { ORG_BASES, ORG_POWER_FAMILIES, ORG_POWERS, POWER_FAMILY_LABELS, POWER_WORDS, isOrgPower, positionsIn, powersIn, type OrgPower, type OrgPowerFamily, type OrgType } from "../../../shared/org";
import type { OrgGmView, OrgMayPowerView, OrgRef, OrgView } from "../../../shared/org-view";
import type { EditOp } from "../../../shared/protocol";
import type { GmEntity, GmView } from "../../../shared/state-view";
import { delegationDraft, delegationEditOps, delegationProblem, delegationRevokeOps, duesDraft, duesEditOps, duesProblem, GM_PART, orgEditOf, payoutOps, payoutProblem, positionDraft, positionEditOps, positionProblem, positionRemoveOps, staffJobOf } from "./edit";
import { MemberDetails } from "./member";
import { OrgPage } from "./org";
import { TYPE_ICON } from "./home";
import { DelegationFields, DuesFields, PositionFields } from "./rules";
import { count, powersText } from "./words";

/** The GM tab's id (`r.gm`). */
export const GM_ORGS_SECTION = "orgs.orgs";

/** The types in the list's order, each as its chip and heading name it. */
const TYPES: readonly { type: OrgType; label: string }[] = [
  { type: "party", label: "Party" },
  { type: "household", label: "Households" },
  { type: "company", label: "Companies" },
  { type: "group", label: "Groups" },
  { type: "trust", label: "Trusts" },
];

/** An owner's role as its picker names it. */
const ROLE_LABELS: Readonly<Record<OwnerRole, string>> = { owner: "Owner", joint: "Joint owner", custodian: "Custodian", beneficiary: "Beneficiary", trustee: "Trustee", authorized_user: "Authorized user" };

/**
 * What opens over an organization's page: a member's, an owner's or a job's sheet, or one adding each
 * (`null`); someone's every way of belonging there; a position (`null` adds one), a delegation
 * (`null` grants one) and the dues. An owner's sheet is one holding of theirs: their row for `class`
 * (none: their row that names no class), since someone issued another class holds a row for each.
 */
export type GmOrgSheet = { kind: "member"; who: string | null } | { kind: "owner"; party: string | null; class?: string } | { kind: "job"; id: string | null } | { kind: "person"; who: string } | { kind: "position"; id: string | null } | { kind: "delegation"; who: string | null } | { kind: "dues" } | { kind: "payout" };

// ---------------------------------------------------------------- reading the GM view

/** The GM view's organizations as this build draws them; one it can't read is left out. */
export function decodeGmOrgs(value: unknown): OrgGmView[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const page = decodeOrgView(raw.page);
    if (!page) return [];
    const may = (Array.isArray(raw.may) ? raw.may : []).flatMap((m) => {
      if (!isRecord(m) || !isRecord(m.who) || typeof m.who.id !== "string") return [];
      const powers = (Array.isArray(m.powers) ? m.powers : []).flatMap((p): OrgMayPowerView[] =>
        isRecord(p) && isOrgPower(p.power) ? [{ power: p.power, basis: ORG_BASES.find((b) => b === p.basis) ?? "member", chain: Array.isArray(p.chain) ? p.chain.filter((s): s is string => typeof s === "string") : [] }] : [],
      );
      return [{ who: { id: m.who.id, name: typeof m.who.name === "string" ? m.who.name : m.who.id }, powers }];
    });
    return [{ page, may }];
  });
}

/** Whether a kind is `base` or extends it, as the GM view's kinds chain them. */
function kindIs(gm: GmView, kind: string, base: string): boolean {
  const seen = new Set<string>();
  for (let k: string | null = kind; k !== null && !seen.has(k); k = gm.kinds.find((d) => d.id === k)?.extends ?? null) {
    if (k === base) return true;
    seen.add(k);
  }
  return false;
}

/** Everyone in the world the GM may name: people who aren't removed, by name. */
function peopleIn(gm: GmView): GmEntity[] {
  return gm.entities.filter((e) => e.person && !e.gone).sort((a, b) => a.name.localeCompare(b.name));
}

function fieldValue(entity: GmEntity | undefined, field: string): JsonValue | undefined {
  return entity?.fields.find((f) => f.id === field)?.value;
}

/** The `member_of` link from `who` to `org`, with its fields; null when there is none. */
function memberLink(gm: GmView, who: string, org: string): JsonObject | null {
  const link = gm.entities.find((e) => e.id === who)?.relations.find((r) => r.type === "member_of" && r.to === org);
  return link ? (link.fields ?? {}) : null;
}

/** An organization's owners as its `owners` field holds them. */
export function ownersOf(gm: GmView, org: string): JsonObject[] {
  const value = fieldValue(
    gm.entities.find((e) => e.id === org),
    "owners",
  );
  return Array.isArray(value) ? value.filter((o): o is JsonObject => isRecord(o)) : [];
}

/** The class an owners row holds: its own, or null for a row that names none (the one class, or the common one). */
function ownerClassOf(o: JsonObject): string | null {
  return typeof o.class === "string" && o.class !== "" ? o.class : null;
}

/** The sheet of one owners row: its party's holding of its class. */
function ownerSheetOf(o: JsonObject, party: string): GmOrgSheet {
  const cls = ownerClassOf(o);
  return { kind: "owner", party, ...(cls !== null ? { class: cls } : {}) };
}

/** The jobs whose employer is `org`, ended ones last. */
export function jobsOf(gm: GmView, org: string): GmEntity[] {
  return gm.entities
    .filter((e) => !e.gone && kindIs(gm, e.kind, "job") && fieldValue(e, "employer") === org)
    .sort((a, b) => Number(fieldValue(a, "status") === "ended") - Number(fieldValue(b, "status") === "ended") || a.name.localeCompare(b.name));
}

/** Which of the GM's People controls a type takes: members by `member_of` (any group: a household, a group, a company's officers), owners (a company, a trust), jobs (a company). */
export function gmControlsFor(org: OrgView): { members: boolean; owners: boolean; jobs: boolean } {
  const real = org.exists && org.type !== "party";
  return { members: real && org.type !== "trust", owners: real && (org.type === "company" || org.type === "trust"), jobs: real && org.type === "company" };
}

// ---------------------------------------------------------------- the edits

export interface MemberForm {
  title: string;
  position: string;
  rank: string;
  since: string;
}

/** A rank as typed: a number, nothing, or null for text that is no number. */
function rankOf(text: string): number | undefined | null {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Adding `who` to `org`, or setting their link's fields, as one `member_of` link (a link replaces the fields it had). */
export function memberOps(org: string, who: string, form: MemberForm): EditOp[] {
  const rank = rankOf(form.rank);
  const fields: JsonObject = {
    ...(form.title.trim() !== "" ? { role: form.title.trim() } : {}),
    ...(form.position !== "" ? { position: form.position } : {}),
    ...(typeof rank === "number" ? { rank } : {}),
    ...(form.since.trim() !== "" ? { since: form.since.trim() } : {}),
  };
  return [{ op: "link", rel: "member_of", from: who, to: org, ...(Object.keys(fields).length > 0 ? { fields } : {}) }];
}

/** Taking `who` out of `org`. */
export function memberRemoveOps(org: string, who: string): EditOp[] {
  return [{ op: "unlink", rel: "member_of", from: who, to: org }];
}

/**
 * The owners with one holding, `at` (a party's row for a class, null for their row that names none),
 * as `role` with `share` percent: that row rewritten, or added last when there is none. Its units and
 * class stay as they were, or as `rows` sets them (null takes one off); the party's rows for other
 * classes stay as they are.
 */
export function ownerOps(org: string, owners: readonly JsonObject[], at: { party: string; class: string | null }, role: OwnerRole, share: number, rows: { units?: number | null; class?: string | null } = {}): EditOp[] {
  const write = (o: JsonObject): JsonObject => {
    const out: JsonObject = { ...o, role, share };
    for (const key of ["units", "class"] as const) {
      const v = rows[key];
      if (v === null) delete out[key];
      else if (v !== undefined) out[key] = v;
    }
    return out;
  };
  const index = owners.findIndex((o) => o.party === at.party && ownerClassOf(o) === at.class);
  const next = index < 0 ? [...owners, write({ party: at.party })] : owners.map((o, i) => (i === index ? write(o) : o));
  return [{ op: "set", entity: org, field: "owners", value: next }];
}

/** The owners without `party`. */
export function ownerRemoveOps(org: string, owners: readonly JsonObject[], party: string): EditOp[] {
  return [{ op: "set", entity: org, field: "owners", value: owners.filter((o) => o.party !== party) }];
}

export interface JobForm {
  worker: string;
  title: string;
  position: string;
  basis: string;
  rate: number;
  every: string;
}

/** A new job's id: `job_` and its words, unique among the world's ids. */
export function jobIdFor(words: string, taken: ReadonlySet<string>): string {
  const base = `job_${words.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "new"}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** A new job at `org`: spawned under its title and employer, its fields set, active, in one edit. An unpaid title sets no rate. */
export function jobAddOps(org: OrgView, id: string, form: JobForm): EditOp[] {
  const title = form.title.trim();
  const fields: JsonObject = { worker: form.worker, employer: org.id, ...(title !== "" ? { title } : {}), ...(form.position !== "" ? { position: form.position } : {}), basis: form.basis, ...(form.every !== UNPAID ? { rate: form.rate } : {}), pay_every: form.every, status: "active" };
  return [{ op: "spawn", kind: "job", name: `${title || humanize(form.basis)} at ${org.name}`, id }, ...Object.entries(fields).map(([field, value]): EditOp => ({ op: "set", entity: id, field, value }))];
}

/** Ending a job. */
export function jobEndOps(id: string): EditOp[] {
  return [{ op: "set", entity: id, field: "status", value: "ended" }];
}

// ---------------------------------------------------------------- the list

export interface GmOrgsListProps {
  orgs: readonly OrgGmView[];
  query: string;
  type: OrgType | null;
  /** A person whose organizations only are listed (a link from their GM pages). */
  person: { id: string; name: string } | null;
  onQuery(query: string): void;
  onType(type: OrgType | null): void;
  onClearPerson(): void;
  onOpen(id: string): void;
}

/** Every organization, grouped by type, searched by name or id and filtered by type and by a person in it. */
export function GmOrgsList(props: GmOrgsListProps) {
  const q = props.query.trim().toLowerCase();
  const person = props.person;
  const shown = props.orgs.filter(({ page }) => (q === "" || page.name.toLowerCase().includes(q) || page.id.toLowerCase().includes(q)) && (props.type === null || page.type === props.type) && (person === null || page.people.some((p) => p.id === person.id)));
  const present = TYPES.filter((t) => props.orgs.some((o) => o.page.type === t.type));
  return (
    <div class="lre-stack" data-lre-gm-orgs-list>
      <div class="lre-gm-tools">
        <label class="lre-gm-search">
          <Icon name="search" size={16} />
          <input class="lre-input" type="search" aria-label="Search organizations" placeholder="Search by name" value={props.query} onInput={(event) => props.onQuery(event.currentTarget.value)} />
        </label>
      </div>
      <div class="lre-form-chips" role="group" aria-label="Types">
        {present.map((t) => (
          <Chip key={t.type} pressed={props.type === t.type} onToggle={() => props.onType(props.type === t.type ? null : t.type)}>
            {t.label}
          </Chip>
        ))}
        {person ? (
          <Chip onRemove={props.onClearPerson} removeLabel={`Show every organization, not only ${person.name}'s`}>
            {`${person.name}'s`}
          </Chip>
        ) : null}
      </div>
      {props.orgs.length === 0 ? (
        <Empty icon="briefcase">The world has no organizations.</Empty>
      ) : shown.length === 0 ? (
        <Empty icon="search">No organization matches.</Empty>
      ) : (
        TYPES.map((t) => {
          const rows = shown.filter((o) => o.page.type === t.type);
          return rows.length === 0 ? null : (
            <div key={t.type} data-lre-gm-orgs-type={t.type}>
              <Section title={`${t.label} (${rows.length})`} flush>
                <List>
                  {rows.map(({ page }) => (
                    <ListRow key={page.id} id={page.id} icon={TYPE_ICON[page.type]} title={page.name} subtitle={[page.badge, count(page.people.length, "person", "people")].join(" · ")} badge={page.exists ? undefined : <Badge>Not yet in the world</Badge>} chevron onClick={() => props.onOpen(page.id)} />
                  ))}
                </List>
              </Section>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------------------------------------------------------------- an organization's GM parts

/** What every GM part and tab of a page reads: the organization, the GM view and its edit, and opening a sheet over the page. */
export interface GmOrgBodyProps {
  entry: OrgGmView;
  section: GmSectionProps;
  open(sheet: GmOrgSheet): void;
}

const GmOrgContext = createContext<GmOrgBodyProps | null>(null);

function useGmOrg(): GmOrgBodyProps {
  const ctx = useContext(GmOrgContext);
  if (!ctx) throw new Error("A GM → Orgs part drawn outside its page");
  return ctx;
}

/** Its members by `member_of`, each opening their sheet, and Add a member. */
export function GmMembers(props: GmOrgBodyProps) {
  const { entry, section } = props;
  const org = entry.page;
  const members = section.gm.entities.filter((e) => memberLink(section.gm, e.id, org.id) !== null);
  return (
    <div class="lre-stack" data-lre-gm-org-members={org.id}>
      {members.length === 0 ? (
        <Empty icon="users">No one is linked to it as a member.</Empty>
      ) : (
        <List>
          {members.map((e) => {
            const f = memberLink(section.gm, e.id, org.id) ?? {};
            const position = org.positions.find((p) => p.id === f.position)?.title ?? (typeof f.position === "string" ? f.position : null);
            return <ListRow key={e.id} id={e.id} icon={e.person ? "user" : "users"} title={e.name} subtitle={[typeof f.role === "string" ? f.role : null, position, typeof f.rank === "number" ? `rank ${f.rank}` : null, typeof f.since === "string" ? `since ${f.since}` : null].filter((p) => p !== null).join(" · ") || "Member"} chevron onClick={() => props.open({ kind: "member", who: e.id })} />;
          })}
        </List>
      )}
      <Button icon="user-plus" disabled={section.busy} onClick={() => props.open({ kind: "member", who: null })}>
        Add a member
      </Button>
    </div>
  );
}

/** Its owners with their roles and shares, each opening their sheet, and Add an owner. */
export function GmOwners(props: GmOrgBodyProps) {
  const { entry, section } = props;
  const org = entry.page;
  const owners = ownersOf(section.gm, org.id);
  const nameOf = (id: string): string => section.gm.entities.find((e) => e.id === id)?.name ?? id;
  return (
    <div class="lre-stack" data-lre-gm-org-owners={org.id}>
      {owners.length === 0 ? (
        <Empty icon="user">It has no owners.</Empty>
      ) : (
        <List>
          {owners.map((o, i) => {
            const party = typeof o.party === "string" ? o.party : "";
            const role = OWNER_ROLES.find((r) => r === o.role) ?? "owner";
            const cls = ownerClassOf(o);
            return <ListRow key={party ? `${party}:${cls ?? ""}` : `owner:${i}`} id={party} icon="user" title={nameOf(party)} subtitle={cls !== null ? `${ROLE_LABELS[role]} · ${cls}` : ROLE_LABELS[role]} value={typeof o.share === "number" ? `${o.share}%` : undefined} valueTone="muted" chevron onClick={() => props.open(ownerSheetOf(o, party))} />;
          })}
        </List>
      )}
      <Button icon="user-plus" disabled={section.busy} onClick={() => props.open({ kind: "owner", party: null })}>
        Add an owner
      </Button>
      {org.type === "trust" ? (
        <Button icon="coins" disabled={section.busy} onClick={() => props.open({ kind: "payout" })}>
          Pay out to its beneficiaries
        </Button>
      ) : null}
    </div>
  );
}

/** Its jobs, each opening its sheet, and Add a job. */
export function GmJobs(props: GmOrgBodyProps) {
  const { entry, section } = props;
  const org = entry.page;
  const jobs = jobsOf(section.gm, org.id);
  const nameOf = (id: JsonValue | undefined): string => (typeof id === "string" ? (section.gm.entities.find((e) => e.id === id)?.name ?? id) : "No one");
  return (
    <div class="lre-stack" data-lre-gm-org-jobs={org.id}>
      {jobs.length === 0 ? (
        <Empty icon="briefcase">No jobs here.</Empty>
      ) : (
        <List>
          {jobs.map((j) => {
            const status = fieldValue(j, "status");
            const title = fieldValue(j, "title");
            return <ListRow key={j.id} id={j.id} icon="briefcase" title={nameOf(fieldValue(j, "worker"))} subtitle={typeof title === "string" && title !== "" ? title : j.name} badge={status === "active" || status === undefined ? undefined : <Badge>{humanize(String(status))}</Badge>} chevron onClick={() => props.open({ kind: "job", id: j.id })} />;
          })}
        </List>
      )}
      <Button icon="plus" disabled={section.busy} onClick={() => props.open({ kind: "job", id: null })}>
        Add a job
      </Button>
    </div>
  );
}

/** The family a power is in. */
function familyOf(power: OrgPower): OrgPowerFamily {
  return (Object.keys(ORG_POWER_FAMILIES) as OrgPowerFamily[]).find((f) => (ORG_POWER_FAMILIES[f] as readonly OrgPower[]).includes(power)) ?? "governance";
}

const POWER_CHOICES = ORG_POWERS.map((p) => ({ value: p, label: `${POWER_FAMILY_LABELS[familyOf(p)]}: ${POWER_WORDS[p]}` }));

export interface WhoMayProps {
  entry: OrgGmView;
  gm: GmView;
  who: string;
  power: string;
  onWho(who: string): void;
  onPower(power: string): void;
}

/**
 * Who may… (§6.1): pick a person and a power; the answer is the chain of bases it rests on, or the
 * reason they may not. With only a power picked, everyone who holds it; with only a person, every
 * power they hold.
 */
export function WhoMay(props: WhoMayProps) {
  const { entry, gm } = props;
  const org = entry.page;
  const person = gm.entities.find((e) => e.id === props.who);
  const power = isOrgPower(props.power) ? props.power : null;
  const theirs = entry.may.find((m) => m.who.id === props.who)?.powers ?? [];
  const held = power ? theirs.find((p) => p.power === power) : undefined;
  const answer =
    person && power ? (
      <div data-lre-gm-who-may-answer={held ? "yes" : "no"}>
        <Section title={held ? `Yes: ${person.name} may ${POWER_WORDS[power]}` : `No: ${person.name} may not ${POWER_WORDS[power]}`}>
          {held ? (
            <ActionRows label="Why">
              {held.chain.map((step, i) => (
                <ActionRow key={i} title={step} />
              ))}
            </ActionRows>
          ) : (
            <span class="lre-small lre-muted">{`No owner role, position, delegation or member's default at ${org.name} gives them that.`}</span>
          )}
        </Section>
      </div>
    ) : person ? (
      <div data-lre-gm-who-may-answer="person">
        <Section title={`What ${person.name} may do`}>
          {theirs.length === 0 ? (
            <span class="lre-small lre-muted">{`Nothing at ${org.name}.`}</span>
          ) : (
            <ActionRows label={`${person.name}'s powers`}>
              {theirs.map((p) => (
                <ActionRow key={p.power} title={POWER_WORDS[p.power]} subtitle={p.chain.join(" · ")} />
              ))}
            </ActionRows>
          )}
        </Section>
      </div>
    ) : power ? (
      <div data-lre-gm-who-may-answer="power">
        <Section title={`Who may ${POWER_WORDS[power]}`}>
          {entry.may.filter((m) => m.powers.some((p) => p.power === power)).length === 0 ? (
            <span class="lre-small lre-muted">No one.</span>
          ) : (
            <ActionRows label="Who holds it">
              {entry.may.flatMap((m) => {
                const p = m.powers.find((x) => x.power === power);
                return p ? [<ActionRow key={m.who.id} title={m.who.name} subtitle={p.chain.join(" · ")} />] : [];
              })}
            </ActionRows>
          )}
        </Section>
      </div>
    ) : null;
  return (
    <div class="lre-stack" data-lre-gm-who-may={org.id}>
      <RefPicker label="Person" value={props.who} options={peopleIn(gm).map((e) => ({ value: e.id, label: e.name }))} none="Anyone" onChange={props.onWho} />
      <RefPicker label="Power" value={props.power} options={POWER_CHOICES} none="Any power" onChange={props.onPower} />
      {answer ?? <Empty icon="help">Pick a person, a power, or both.</Empty>}
    </div>
  );
}

/** History: its own History (`orgs.log`), every line and everyone named, newest first; then this chat's edits in force whose lines name it, newest first. */
export function GmOrgHistory(props: { org: OrgView; gm: GmView }) {
  const { org } = props;
  const edits = props.gm.edits.filter((e) => e.lines.some((line) => line.includes(org.name)));
  return (
    <div data-lre-gm-org-history={org.id}>
      {org.history.length > 0 ? (
        <ActionRows label={`${org.name}: its History`}>
          {org.history.map((line, i) => (
            <ActionRow key={i} title={line.text} subtitle={[line.at, line.by ? line.by.name : null].filter((part) => part !== null).join(" · ")} />
          ))}
        </ActionRows>
      ) : null}
      {edits.length === 0 ? (
        <Empty icon="clock">No edits in force name it.</Empty>
      ) : (
        <ActionRows label={`${org.name}: history`}>
          {edits.map((e) => (
            <ActionRow key={`${e.messageId}:${e.seq}`} title={e.lines.join(" · ")} subtitle={e.by ? `The player's action: ${e.by}` : "A GM edit or ✎ fix"} />
          ))}
        </ActionRows>
      )}
    </div>
  );
}

/** Fields: every field it declares, each with ✎, saved as one GM edit. */
export function GmOrgFields(props: { org: OrgView; section: GmSectionProps }) {
  const { org, section } = props;
  const entity = section.gm.entities.find((e) => e.id === org.id);
  if (!entity) return <Empty icon="info">It isn't in the world yet: its fields come with it.</Empty>;
  if (entity.fields.length === 0) return <Empty icon="info">It declares no fields.</Empty>;
  return (
    <div data-lre-gm-org-fields={org.id}>
      <ActionRows label={`${entity.name}: fields`}>
        {entity.fields.map((f) => (
          <FieldRow key={f.id} entity={entity} field={f} editor={section} />
        ))}
      </ActionRows>
    </div>
  );
}

// Each part and tab as the page draws it, its GM props from the page's context.
function MembersPart() {
  return <GmMembers {...useGmOrg()} />;
}
function OwnersPart() {
  return <GmOwners {...useGmOrg()} />;
}
function JobsPart() {
  return <GmJobs {...useGmOrg()} />;
}
function WhoMayTab() {
  const { entry, section } = useGmOrg();
  const [who, setWho] = useState("");
  const [power, setPower] = useState("");
  return <WhoMay entry={entry} gm={section.gm} who={who} power={power} onWho={setWho} onPower={setPower} />;
}
function HistoryTab() {
  const { entry, section } = useGmOrg();
  return <GmOrgHistory org={entry.page} gm={section.gm} />;
}
function FieldsTab() {
  const { entry, section } = useGmOrg();
  return <GmOrgFields org={entry.page} section={section} />;
}

/** A pack's tab with a GM component, drawn with the GM section's props; one per def, so a tab keeps its state across renders. */
const GM_TABS = new WeakMap<OrgTabDef, ComponentType<OrgTabProps>>();

/** A pack's tab as GM → Orgs draws it: by its `gm` component where it has one, else as Play does. */
function forGm(def: OrgTabDef): OrgTabDef {
  const Gm = def.gm;
  if (!Gm) return def;
  let component = GM_TABS.get(def);
  if (!component) {
    component = (p: OrgTabProps) => <Gm {...p} gm={useGmOrg().section} />;
    GM_TABS.set(def, component);
  }
  return { ...def, component };
}

/** Every tab and part of a page in GM → Orgs: the GM's parts of People (ahead of the packs' parts there), the packs' tabs, then Who may…, History and Fields after Rules. */
export function gmPageDefs(org: OrgView, packs: readonly OrgTabDef[]): OrgTabDef[] {
  const has = gmControlsFor(org);
  return [
    ...(has.members ? [{ id: "orgs.gm_members", label: "GM: members", order: 0, section: GM_PART, within: "people", component: MembersPart } satisfies OrgTabDef] : []),
    ...(has.owners ? [{ id: "orgs.gm_owners", label: "GM: owners", order: 1, section: GM_PART, within: "people", component: OwnersPart } satisfies OrgTabDef] : []),
    ...(has.jobs ? [{ id: "orgs.gm_jobs", label: "GM: jobs", order: 2, section: GM_PART, within: "people", component: JobsPart } satisfies OrgTabDef] : []),
    ...packs.map(forGm),
    { id: "orgs.gm_who", label: "Who may…", order: 92, section: GM_PART, component: WhoMayTab },
    { id: "orgs.gm_history", label: "History", order: 94, section: GM_PART, component: HistoryTab },
    { id: "orgs.gm_fields", label: "Fields", order: 96, section: GM_PART, component: FieldsTab },
  ];
}

/** The page as GM → Orgs hands it to `OrgPage`: holding the GM's part, so its parts and tabs show. */
export function gmPage(org: OrgView): OrgView {
  return { ...org, sections: { ...org.sections, [GM_PART]: true } };
}

// ---------------------------------------------------------------- sheets over the page

/** A sheet's frame: Back to the page, its fields, why it can't be saved yet, its button and, for one that has one, its danger button. */
function SheetForm(props: { name: string; title: string; subtitle: string; backLabel: string; onBack(): void; go: string; problem: string | null; busy: boolean; onGo(): void; danger?: { label: string; onClick(): void }; children: ComponentChildren }) {
  return (
    <GmPage name={props.name} title={props.title} subtitle={props.subtitle} backLabel={props.backLabel} onBack={props.onBack}>
      <form
        class="lre-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (props.problem === null) props.onGo();
        }}
      >
        {props.children}
        {props.problem !== null ? <span class="lre-small lre-muted">{props.problem}</span> : null}
        <Button type="submit" variant="primary" block disabled={props.busy || props.problem !== null}>
          {props.go}
        </Button>
        {props.danger ? (
          <Button variant="danger" icon="close" block disabled={props.busy} onClick={props.danger.onClick}>
            {props.danger.label}
          </Button>
        ) : null}
      </form>
    </GmPage>
  );
}

function TextInput(props: { label: string; value: string; type?: "text" | "date"; placeholder?: string; onInput(value: string): void }) {
  const id = useId();
  return (
    <Field label={props.label} for={id}>
      {props.type === "date" ? (
        <input id={id} class="lre-input" type="date" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      ) : (
        <input id={id} class="lre-input" type="text" placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
      )}
    </Field>
  );
}

interface SheetProps {
  org: OrgView;
  section: GmSectionProps;
  back(): void;
}

/** Sends the edit and, once it applied, goes back to the page. */
async function save(props: SheetProps, ops: EditOp[]): Promise<void> {
  if (await props.section.edit(ops)) props.back();
}

/** A member's sheet: who (when adding), their title, position, rank and since; Remove for one already in. Opened on someone not yet linked, it links them. */
function MemberSheet(props: SheetProps & { who: string | null }) {
  const { org, section } = props;
  const link = props.who === null ? null : memberLink(section.gm, props.who, org.id);
  const [who, setWho] = useState(props.who ?? "");
  const [form, setForm] = useState<MemberForm>({ title: typeof link?.role === "string" ? link.role : "", position: typeof link?.position === "string" ? link.position : "", rank: typeof link?.rank === "number" ? String(link.rank) : "", since: typeof link?.since === "string" ? link.since : "" });
  const set = (patch: Partial<MemberForm>) => setForm((f) => ({ ...f, ...patch }));
  const candidates = section.gm.entities.filter((e) => !e.gone && e.id !== org.id && (e.person || kindIs(section.gm, e.kind, "group")) && memberLink(section.gm, e.id, org.id) === null).sort((a, b) => a.name.localeCompare(b.name));
  const name = section.gm.entities.find((e) => e.id === props.who)?.name ?? props.who ?? "";
  const problem = who === "" ? "Choose who joins." : rankOf(form.rank) === null ? "A rank is a number." : null;
  return (
    <SheetForm
      name={link === null ? "org-member-add" : "org-member"}
      title={props.who === null ? "Add a member" : name}
      subtitle={link === null && props.who !== null ? `A member of ${org.name}` : org.name}
      backLabel={org.name}
      onBack={props.back}
      go={link === null ? "Add" : "Save"}
      problem={problem}
      busy={section.busy}
      onGo={() => void save(props, memberOps(org.id, who, form))}
      danger={link === null ? undefined : { label: `Remove from ${org.name}`, onClick: () => void save(props, memberRemoveOps(org.id, who)) }}
    >
      {props.who === null ? <RefPicker label="Who" value={who} options={candidates.map((e) => ({ value: e.id, label: e.name, ...(e.person ? {} : { sublabel: section.gm.kinds.find((k) => k.id === e.kind)?.label ?? e.kind }) }))} onChange={setWho} /> : null}
      <TextInput label="Title" value={form.title} placeholder="Head, Treasurer…" onInput={(title) => set({ title })} />
      <RefPicker label="Position" value={form.position} options={org.positions.filter((p) => !p.implied).map((p) => ({ value: p.id, label: p.title }))} none="No position" onChange={(position) => set({ position })} />
      <TextInput label="Rank" value={form.rank} onInput={(rank) => set({ rank })} />
      <TextInput label="Since" type="date" value={form.since} onInput={(since) => set({ since })} />
    </SheetForm>
  );
}

/** An owner's sheet: who (when adding), their role, share, units and class; Remove for one already an owner. Opened on someone not yet an owner, it adds them; on one holding of theirs (`heldClass`), it edits that row only. */
function OwnerSheet(props: SheetProps & { party: string | null; heldClass: string | null }) {
  const { org, section } = props;
  const owners = ownersOf(section.gm, org.id);
  const had = props.party === null ? undefined : owners.find((o) => o.party === props.party && ownerClassOf(o) === props.heldClass);
  const [party, setParty] = useState(props.party ?? "");
  const [role, setRole] = useState<string>(typeof had?.role === "string" ? had.role : "owner");
  const [share, setShare] = useState(typeof had?.share === "number" ? String(had.share) : "");
  const [units, setUnits] = useState(typeof had?.units === "number" ? String(had.units) : "");
  const [shareClass, setShareClass] = useState(typeof had?.class === "string" ? had.class : "");
  const candidates = section.gm.entities.filter((e) => !e.gone && e.id !== org.id && (e.person || kindIs(section.gm, e.kind, "group") || kindIs(section.gm, e.kind, "trust")) && !owners.some((o) => o.party === e.id)).sort((a, b) => a.name.localeCompare(b.name));
  const percent = share.trim() === "" ? 0 : Number(share);
  const unitCount = units.trim() === "" ? null : Number(units);
  const ownerRole = OWNER_ROLES.find((r) => r === role) ?? "owner";
  const name = section.gm.entities.find((e) => e.id === props.party)?.name ?? props.party ?? "";
  const problem = party === "" ? "Choose the owner." : !Number.isFinite(percent) || percent < 0 || percent > 100 ? "A share is a percent from 0 to 100." : unitCount !== null && (!Number.isInteger(unitCount) || unitCount < 0) ? "Units are a whole number." : null;
  return (
    <SheetForm
      name={had === undefined ? "org-owner-add" : "org-owner"}
      title={props.party === null ? "Add an owner" : name}
      subtitle={org.name}
      backLabel={org.name}
      onBack={props.back}
      go={had === undefined ? "Add" : "Save"}
      problem={problem}
      busy={section.busy}
      onGo={() => void save(props, ownerOps(org.id, owners, { party, class: props.heldClass }, ownerRole, percent, { units: unitCount, class: shareClass.trim() === "" ? null : shareClass.trim() }))}
      danger={had === undefined ? undefined : { label: "No longer an owner", onClick: () => void save(props, ownerRemoveOps(org.id, owners, party)) }}
    >
      {props.party === null ? <RefPicker label="Owner" value={party} options={candidates.map((e) => ({ value: e.id, label: e.name }))} onChange={setParty} /> : null}
      <RefPicker label="Role" value={ownerRole} options={OWNER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} onChange={setRole} />
      <TextInput label="Share (%)" value={share} placeholder="0" onInput={setShare} />
      <TextInput label="Units" value={units} placeholder="None counted" onInput={setUnits} />
      <TextInput label="Class" value={shareClass} placeholder="The one class" onInput={setShareClass} />
    </SheetForm>
  );
}

/** A new job: the worker, the title, the position, how it pays, the rate and how often. */
function NewJobSheet(props: SheetProps) {
  const { org, section } = props;
  const [worker, setWorker] = useState("");
  const [title, setTitle] = useState("");
  const [position, setPosition] = useState("");
  const [basis, setBasis] = useState<string>("hourly");
  const [rate, setRate] = useState("");
  const [every, setEvery] = useState<string>("biweekly");
  const cents = parseMoneyInput(rate, section.currency);
  const problem = worker === "" ? "Choose who works it." : every !== UNPAID && (cents === null || cents <= 0) ? "Type the rate." : null;
  const go = () => {
    if (cents === null && every !== UNPAID) return;
    const workerName = section.gm.entities.find((e) => e.id === worker)?.name ?? worker;
    const id = jobIdFor(`${workerName} ${title || basis}`, new Set(section.gm.entities.map((e) => e.id)));
    void save(props, jobAddOps(org, id, { worker, title, position, basis, rate: cents ?? 0, every }));
  };
  return (
    <SheetForm name="org-job-add" title="Add a job" subtitle={org.name} backLabel={org.name} onBack={props.back} go="Add the job" problem={problem} busy={section.busy} onGo={go}>
      <RefPicker label="Worker" value={worker} options={peopleIn(section.gm).map((e) => ({ value: e.id, label: e.name }))} onChange={setWorker} />
      <TextInput label="Title" value={title} placeholder="Mechanic" onInput={setTitle} />
      <RefPicker label="Position" value={position} options={org.positions.filter((p) => !p.implied).map((p) => ({ value: p.id, label: p.title }))} none="No position" onChange={setPosition} />
      <RefPicker label="Paid by" value={basis} options={PAY_BASES.map((b) => ({ value: b, label: humanize(b) }))} onChange={setBasis} />
      <Field label="Rate (a year, an hour or a shift)">
        <MoneyInput currency={section.currency} value={rate} onInput={setRate} label="Rate" invalid={rate.trim() !== "" && cents === null} />
      </Field>
      <RefPicker label="Paid" value={every} options={PAY_CHOICES.map((p) => ({ value: p, label: PAY_CHOICE_LABELS[p] }))} onChange={setEvery} />
    </SheetForm>
  );
}

/** A job's title and position as the GM sets them: a `set` of each that changed, none clearing it. */
export function jobTitleOps(job: GmEntity, title: string, position: string): EditOp[] {
  const was = (field: string): string => (typeof fieldValue(job, field) === "string" ? String(fieldValue(job, field)) : "");
  const ops: EditOp[] = [];
  if (title.trim() !== was("title")) ops.push({ op: "set", entity: job.id, field: "title", value: title.trim() === "" ? null : title.trim() });
  if (position !== was("position")) ops.push({ op: "set", entity: job.id, field: "position", value: position === "" ? null : position });
  return ops;
}

/** A job's sheet: its title and position (Appoint), every field it declares, each with ✎, and End the job while it runs. */
export function JobSheet(props: SheetProps & { id: string }) {
  const { org, section } = props;
  const job = section.gm.entities.find((e) => e.id === props.id);
  const [title, setTitle] = useState(typeof fieldValue(job, "title") === "string" ? String(fieldValue(job, "title")) : "");
  const [position, setPosition] = useState(typeof fieldValue(job, "position") === "string" ? String(fieldValue(job, "position")) : "");
  if (!job) {
    return (
      <GmPage name="org-job" title="Job" subtitle={org.name} backLabel={org.name} onBack={props.back}>
        <Empty icon="briefcase">It isn't in the world any more.</Empty>
      </GmPage>
    );
  }
  const changes = jobTitleOps(job, title, position);
  return (
    <GmPage name="org-job" title={job.name} subtitle={org.name} backLabel={org.name} onBack={props.back}>
      <div class="lre-stack" data-lre-gm-org-job={job.id}>
        <form
          class="lre-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (changes.length > 0) void section.edit(changes);
          }}
        >
          <TextInput label="Title" value={title} placeholder="Its occupation's" onInput={setTitle} />
          <RefPicker label="Position" value={position} options={org.positions.filter((p) => !p.implied).map((p) => ({ value: p.id, label: p.title }))} none="No position" onChange={setPosition} />
          <Button type="submit" variant="primary" block disabled={section.busy || changes.length === 0}>
            Save title and position
          </Button>
        </form>
        <ActionRows label={`${job.name}: fields`}>
          {job.fields.map((f) => (
            <FieldRow key={f.id} entity={job} field={f} editor={section} />
          ))}
        </ActionRows>
        {fieldValue(job, "status") !== "ended" ? (
          <Button variant="danger" icon="close" block disabled={section.busy} onClick={() => void save(props, jobEndOps(job.id))}>
            End the job
          </Button>
        ) : null}
      </div>
    </GmPage>
  );
}

/** `who`'s `acts_for` link to `org`, with its fields and end; null when there is none. */
function delegationLink(gm: GmView, who: string, org: string): { fields: JsonObject; until: number | null } | null {
  const link = gm.entities.find((e) => e.id === who)?.relations.find((r) => r.type === "acts_for" && r.to === org);
  return link ? { fields: link.fields ?? {}, until: link.until ?? null } : null;
}

/** Everyone the GM may name, as references. */
function refsIn(gm: GmView): OrgRef[] {
  return peopleIn(gm).map((e) => ({ id: e.id, name: e.name }));
}

/**
 * Someone's every way of belonging there (§6.1), each opening its own sheet: their membership (or
 * Make them a member), each job of theirs there, their owner's row where it has owners (or Make them
 * an owner), and the delegation they hold (or Let them act for it); above them, what Play's member
 * sheet shows of them.
 */
function PersonSheet(props: SheetProps & { who: string }) {
  const { org, section } = props;
  // Each way of belonging opens over this sheet, and its Back (or its save) comes back here.
  const [inner, setInner] = useState<GmOrgSheet | null>(null);
  if (inner !== null) return <SheetView key={JSON.stringify(inner)} org={org} section={section} sheet={inner} back={() => setInner(null)} open={setInner} />;
  const open = (sheet: GmOrgSheet) => setInner(sheet);
  const gm = section.gm;
  const person = org.people.find((p) => p.id === props.who);
  const name = gm.entities.find((e) => e.id === props.who)?.name ?? person?.name ?? props.who;
  const link = memberLink(gm, props.who, org.id);
  const jobs = jobsOf(gm, org.id).filter((j) => fieldValue(j, "worker") === props.who);
  const holdings = ownersOf(gm, org.id).filter((o) => o.party === props.who);
  const acts = delegationLink(gm, props.who, org.id);
  const has = gmControlsFor(org);
  const linkWords = link ? [typeof link.role === "string" ? link.role : null, org.positions.find((p) => p.id === link.position)?.title ?? null].filter((p) => p !== null).join(" · ") || "Member" : "Not linked as a member";
  return (
    <GmPage name="org-person" title={name} subtitle={org.name} backLabel={org.name} onBack={props.back}>
      <div class="lre-stack" data-lre-gm-org-person={props.who}>
        {person ? <MemberDetails org={org} person={person} job={staffJobOf(org, person.job)} /> : null}
        <Section title="How they belong" flush>
          <List>
            {has.members ? <ListRow icon="users" title={link ? "Membership" : "Make them a member"} subtitle={linkWords} chevron onClick={() => open({ kind: "member", who: props.who })} /> : null}
            {jobs.map((j) => (
              <ListRow key={j.id} icon="briefcase" title={typeof fieldValue(j, "title") === "string" ? String(fieldValue(j, "title")) : j.name} subtitle={fieldValue(j, "status") === "ended" ? "Ended" : (org.positions.find((p) => p.id === fieldValue(j, "position"))?.title ?? "Staff")} chevron onClick={() => open({ kind: "job", id: j.id })} />
            ))}
            {has.owners
              ? holdings.length > 0
                ? holdings.map((o) => {
                    const cls = ownerClassOf(o);
                    return <ListRow key={`owner:${cls ?? ""}`} icon="user" title="Owner" subtitle={`${ROLE_LABELS[OWNER_ROLES.find((r) => r === o.role) ?? "owner"]}${typeof o.share === "number" ? ` · ${o.share}%` : ""}${cls !== null ? ` · ${cls}` : ""}`} chevron onClick={() => open(ownerSheetOf(o, props.who))} />;
                  })
                : <ListRow icon="user" title="Make them an owner" chevron onClick={() => open({ kind: "owner", party: props.who })} />
              : null}
            <ListRow icon="key" title={acts ? "Acts for it" : "Let them act for it"} subtitle={acts ? powersText(powersIn(acts.fields.powers)) : undefined} chevron onClick={() => open({ kind: "delegation", who: props.who })} />
          </List>
        </Section>
      </div>
    </GmPage>
  );
}

/** A position as the GM adds or changes it, or removes it: the organization's own effect, its History line and checks with it. */
function GmPositionSheet(props: SheetProps & { id: string | null }) {
  const { org, section } = props;
  const positions = positionsIn(fieldValue(section.gm.entities.find((e) => e.id === org.id), "positions"));
  const before = props.id === null ? null : (positions.find((p) => p.id === props.id) ?? null);
  const [draft, setDraft] = useState(() => positionDraft(before, section.currency));
  return (
    <SheetForm
      name="org-position"
      title={before ? before.title : "Add position"}
      subtitle={org.name}
      backLabel={org.name}
      onBack={props.back}
      go={before ? "Save" : "Add the position"}
      problem={props.id !== null && !before ? "It has no such position any more." : positionProblem(draft, positions, section.currency)}
      busy={section.busy}
      onGo={() => void save(props, positionEditOps(org.id, draft, before, section.currency))}
      {...(before ? { danger: { label: "Remove the position", onClick: () => void save(props, positionRemoveOps(org.id, before.id)) } } : {})}
    >
      <PositionFields draft={draft} positions={positions} people={refsIn(section.gm)} offer={ORG_POWERS} currency={section.currency} onChange={setDraft} />
    </SheetForm>
  );
}

/** A delegation as the GM grants or changes it, with whoever granted it, or ends it. */
function GmDelegationSheet(props: SheetProps & { who: string | null }) {
  const { org, section } = props;
  const link = props.who === null ? null : delegationLink(section.gm, props.who, org.id);
  const f = link?.fields ?? {};
  const [draft, setDraft] = useState(() =>
    delegationDraft(props.who ?? "", link ? { powers: powersIn(f.powers), ...(typeof f.payment === "number" ? { payment: f.payment } : {}), ...(typeof f.month === "number" ? { month: f.month } : {}), until: link.until, by: typeof f.by === "string" ? f.by : null } : null, section.currency),
  );
  const name = section.gm.entities.find((e) => e.id === props.who)?.name ?? props.who;
  const kept = org.delegations.find((d) => d.who.id === props.who)?.until ?? null;
  return (
    <SheetForm
      name="org-delegation"
      title={name ? `${name} acts for it` : "Delegate"}
      subtitle={org.name}
      backLabel={org.name}
      onBack={props.back}
      go={link ? "Save" : "Delegate"}
      problem={delegationProblem(draft, section.currency)}
      busy={section.busy}
      onGo={() => void save(props, delegationEditOps(org.id, draft, section.currency))}
      {...(link && props.who !== null ? { danger: { label: "Revoke", onClick: () => void save(props, delegationRevokeOps(org.id, props.who ?? "")) } } : {})}
    >
      <DelegationFields draft={draft} people={props.who === null ? refsIn(section.gm) : null} offer={ORG_POWERS} granters={refsIn(section.gm)} kept={kept} currency={section.currency} onChange={setDraft} />
    </SheetForm>
  );
}

/** Its dues as the GM sets them (its `dues` field); none clears them. */
function GmDuesSheet(props: SheetProps) {
  const { org, section } = props;
  const [draft, setDraft] = useState(() => duesDraft(org.dues, section.currency));
  return (
    <SheetForm name="org-dues" title="Dues" subtitle={org.name} backLabel={org.name} onBack={props.back} go="Set dues" problem={duesProblem(draft, section.currency)} busy={section.busy} onGo={() => void save(props, duesEditOps(org.id, draft, section.currency))}>
      <DuesFields draft={draft} currency={section.currency} onChange={setDraft} />
    </SheetForm>
  );
}

/** A trust's payout as the GM makes it (`economy.distribute`, DESIGN §29.7): a stated amount of its money, to its beneficiaries by their shares. */
function GmPayoutSheet(props: SheetProps) {
  const { org, section } = props;
  const [text, setText] = useState("");
  const beneficiaries = ownersOf(section.gm, org.id).filter((o) => o.role === "beneficiary" && typeof o.party === "string");
  return (
    <SheetForm name="org-payout" title="Pay out to its beneficiaries" subtitle={org.name} backLabel={org.name} onBack={props.back} go="Pay it out by share" problem={beneficiaries.length === 0 ? "It has no beneficiaries." : payoutProblem(text, section.currency)} busy={section.busy} onGo={() => void save(props, payoutOps(org.id, text, section.currency))}>
      <List>
        {beneficiaries.map((o) => (
          <ListRow key={String(o.party)} icon="user" title={section.gm.entities.find((e) => e.id === o.party)?.name ?? String(o.party)} value={typeof o.share === "number" ? `${o.share}%` : undefined} valueTone="muted" />
        ))}
      </List>
      <Field label="Amount">
        <MoneyInput currency={section.currency} value={text} label="Amount" onInput={setText} invalid={text.trim() !== "" && payoutProblem(text, section.currency) !== null} />
      </Field>
    </SheetForm>
  );
}

function SheetView(props: SheetProps & { sheet: GmOrgSheet; open(sheet: GmOrgSheet): void }) {
  const { sheet } = props;
  switch (sheet.kind) {
    case "member":
      return <MemberSheet {...props} who={sheet.who} />;
    case "owner":
      return <OwnerSheet {...props} party={sheet.party} heldClass={sheet.class ?? null} />;
    case "job":
      return sheet.id === null ? <NewJobSheet {...props} /> : <JobSheet {...props} id={sheet.id} />;
    case "person":
      return <PersonSheet {...props} who={sheet.who} />;
    case "position":
      return <GmPositionSheet {...props} id={sheet.id} />;
    case "delegation":
      return <GmDelegationSheet {...props} who={sheet.who} />;
    case "dues":
      return <GmDuesSheet {...props} />;
    case "payout":
      return <GmPayoutSheet {...props} />;
  }
}

/** The GM's sheet for one of Play's editors (`org_edit`) on GM → Orgs' page: a member's sheet is their every way of belonging there; a position, a delegation and the dues their own; Hire someone and Admit a member are People's Add a job and Add a member. Null for any other route. */
export function gmSheetFor(route: SheetRoute): GmOrgSheet | null {
  if (route.kind !== "org_edit") return null;
  const target = orgEditOf(route.id);
  if (!target) return null;
  switch (target.form) {
    case "member":
      return target.id === null ? null : { kind: "person", who: target.id };
    case "position":
      return { kind: "position", id: target.id };
    case "delegate":
      return { kind: "delegation", who: target.id };
    case "dues":
      return { kind: "dues" };
    case "payout":
      return { kind: "payout" };
    case "hire":
      return { kind: "job", id: null };
    case "admit":
      return { kind: "member", who: null };
  }
}

// ---------------------------------------------------------------- the tab

/** GM → Orgs: the list, an organization's page over it, and a sheet over the page. */
export function GmOrgsSection(props: GmSectionProps) {
  const app = useApp();
  const state = useView();
  const orgs = decodeGmOrgs(props.gm.orgs);
  const [query, setQuery] = useState("");
  const [type, setType] = useState<OrgType | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");
  const panelId = useId();
  const pages = usePages<string>();
  const sheets = usePages<GmOrgSheet>();
  const openOrg = (id: string, at: string | null = null) => {
    setTab(at ?? "overview");
    sheets.back();
    pages.open(id);
  };
  // A link from another GM page: an organization opens (its id, or its `orgRoute` id with a tab); a person lists only theirs.
  useGmFocus((id) => {
    const target = orgRouteOf(id);
    if (orgs.some((o) => o.page.id === target.org)) openOrg(target.org, target.tab);
    else setPerson(id);
  });
  const entry = pages.page === null ? null : (orgs.find((o) => o.page.id === pages.page) ?? null);
  const personRef = person === null ? null : { id: person, name: props.gm.entities.find((e) => e.id === person)?.name ?? person };
  const back = () => {
    sheets.back();
    pages.back();
  };
  // Within the page, an organization opens here, on the tab its route names (`orgRoute`), and a person on their World page; anything else as Play opens it.
  const open = (route: SheetRoute) => {
    const target = route.kind === "org" ? orgRouteOf(route.id) : null;
    const sheet = gmSheetFor(route);
    if (sheet) sheets.open(sheet);
    else if (target && orgs.some((o) => o.page.id === target.org)) openOrg(target.org, target.tab);
    else if (route.kind !== "org" && route.kind !== "org_edit" && props.gm.entities.some((e) => e.id === route.id)) app.ui.update((ui) => gmOpen(ui, "world", route.id));
    else app.ui.update((ui) => pushSheet(ui, route));
  };
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown} data-lre-gm-orgs>
      <div class="lre-stack lre-gm-list" hidden={pages.page !== null}>
        <GmOrgsList orgs={orgs} query={query} type={type} person={personRef} onQuery={setQuery} onType={setType} onClearPerson={() => setPerson(null)} onOpen={openOrg} />
      </div>
      {pages.page !== null ? (
        <div class="lre-gm-page" data-lre-gm-page="org">
          {entry && state ? (
            <div ref={sheets.host.ref} onKeyDown={sheets.host.onKeyDown}>
              <div hidden={sheets.page !== null}>
                <GmOrgContext.Provider value={{ entry, section: props, open: sheets.open }}>
                  <OrgPage org={gmPage(entry.page)} figure={null} defs={gmPageDefs(entry.page, app.catalog.orgTabs)} tab={tab} panelId={panelId} onTab={setTab} onBack={back} chatId={props.chatId} state={state} send={props.send} open={open} />
                </GmOrgContext.Provider>
              </div>
              {sheets.page !== null ? <SheetView key={JSON.stringify(sheets.page)} sheet={sheets.page} org={entry.page} section={props} back={sheets.back} open={sheets.open} /> : null}
            </div>
          ) : (
            <GmPage name="org-gone" title="Organization" backLabel="Organizations" onBack={back}>
              <Empty icon="briefcase">It isn't in the world any more.</Empty>
            </GmPage>
          )}
        </div>
      ) : null}
    </div>
  );
}
