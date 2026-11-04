// Build → Organizations (ORG-SPEC §6.3), mobile first: the world home's list of organizations, in
// Companies, Households, Groups and Trusts (and a party a world authors), each with how many it
// holds and its issues, with + New (a type, a group's kind, a name), and an organization's editor:
// - Basics: its name, kind, structure, places, hours and who knows of it;
// - People: its members by `member_of` (title, position, rank, since), its staff as jobs (Add a
//   job), its owners (role, share, units, class) and who acts for it (`acts_for`);
// - Positions: title, powers by family, seats, reports to, reach, limits, successor, new members;
// - Money: its accounts as the Money records list them, its pay schedule and account, dues, payouts
//   and invoice terms;
// - Ownership: share classes and the votes a decision needs;
// - Decisions: how its motions count votes, their quorum, pass mark and days, standing votes, and
//   how long a request for approval waits (ORG-SPEC Phase 5);
// - Property and entry: its properties, and its places with who may enter them;
// - All fields.
// The organization's own fields save with Save to draft, as a patch of only what changed; a
// member's link, a job and a delegation are other entities', each saved to the draft from its sheet.

import { useMemo, useState } from "preact/hooks";
import type { JsonObject, JsonValue } from "../../shared/json";
import { hasOwn, isRecord } from "../../shared/json";
import { pointerOf } from "../../shared/json-patch";
import { parseMoneyInput } from "../../shared/money";
import { ACTS_FOR, limitsIn, ORG_POWERS, positionsIn, powersIn, type OrgType, type Position } from "../../shared/org";
import type { OrgRef } from "../../shared/org-view";
import type { JsonPatchOp, LintIssue } from "../../shared/protocol";
import { PAY_BASES } from "../../shared/finance";
import { DEFAULT_CURRENCY, playedKinds, type WorldDoc } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, Empty, Field, List, ListRow, PageHeader, SaveBar, Section, Seg, useBusy } from "../components";
import { humanize } from "../format";
import { Icon } from "../icons";
import { MoneyInput } from "../money-input";
import type { EditorProps } from "../registry";
import { useSelect } from "../store";
import { delegationDraft, delegationProblem, positionDraft, positionProblem, positionRecord, type DelegationDraft, type PositionDraft } from "../../packs/orgs/ui/edit";
import { DelegationFields, PositionFields } from "../../packs/orgs/ui/rules";
import { limitWords, powersText } from "../../packs/orgs/ui/words";
import { entityPatch } from "./character-model";
import { deleteItem, go, ItemHeader } from "./chrome";
import { FormSheet, RefPicker } from "./form-kit";
import { useHeld } from "./held";
import { COLLECTION_SPECS, deriveId, newItem } from "./schema";
import { clockLocal, DefInput, kindFields, lintAt, localClock, SchemaFields, worldIdentifiers, type FormCtx } from "./schema-form";
import { kindIs } from "./selector-editor";
import { entityGroups } from "./things-model";

/** What an organization is, by its kind, as the engine tells it (`orgTypeOf`): a business is a company; a household, a trust and the party are themselves; any other group is a group. */
export function orgTypeOfKind(doc: WorldDoc, kind: string): OrgType | null {
  if (kindIs(doc, kind, "business")) return "company";
  if (kindIs(doc, kind, "household")) return "household";
  if (kindIs(doc, kind, "trust")) return "trust";
  if (kindIs(doc, kind, "party")) return "party";
  return kindIs(doc, kind, "group") ? "group" : null;
}

/** The list's groups, in order, each with its heading and the type's noun. */
export const ORG_GROUPS: readonly { type: OrgType; title: string; noun: string }[] = [
  { type: "company", title: "Companies", noun: "Company" },
  { type: "household", title: "Households", noun: "Household" },
  { type: "group", title: "Groups", noun: "Group" },
  { type: "trust", title: "Trusts", noun: "Trust" },
  { type: "party", title: "Parties", noun: "Party" },
];

/** The kinds a new group may take: the world's group kinds that make a group (not a business, household, trust or party). */
export function groupKinds(doc: WorldDoc): { id: string; label: string }[] {
  return Object.entries(doc.kinds)
    .filter(([id]) => orgTypeOfKind(doc, id) === "group")
    .map(([id, def]) => ({ id, label: def.label ?? humanize(id) }))
    .sort((a, b) => (a.id === "group" ? -1 : b.id === "group" ? 1 : a.label.localeCompare(b.label)));
}

/** The kind a new organization of `type` takes: its type's own, or for a group the kind chosen. */
export function newOrgKind(type: Exclude<OrgType, "party">, groupKind: string): string {
  return type === "company" ? "business" : type === "household" ? "household" : type === "trust" ? "trust" : groupKind || "group";
}

/** The draft's organizations by type, each by name: id, name and kind's label. */
export function orgRows(doc: WorldDoc): Record<OrgType, { id: string; name: string; kind: string }[]> {
  const out: Record<OrgType, { id: string; name: string; kind: string }[]> = { company: [], household: [], group: [], trust: [], party: [] };
  for (const id of entityGroups(doc).orgs) {
    const e = doc.entities[id];
    const type = e ? orgTypeOfKind(doc, e.kind) : null;
    if (!e || type === null) continue;
    out[type].push({ id, name: e.name || id, kind: doc.kinds[e.kind]?.label ?? humanize(e.kind) });
  }
  for (const rows of Object.values(out)) rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return out;
}

/** How many issues an organization has (its own, and on links that name it), in the colour of the worst. */
function Issues(props: { issues: readonly LintIssue[] }) {
  const n = props.issues.length;
  if (n === 0) return null;
  const tone = props.issues.some((i) => i.severity === "error") ? "neg" : props.issues.some((i) => i.severity === "warning") ? "warn" : "neutral";
  return (
    <Badge tone={tone}>
      <Icon name="alert" size={12} />
      {n}
      <span class="lre-sr">{n === 1 ? " issue" : " issues"}</span>
    </Badge>
  );
}

/** The lint about an organization: its own entity's, and that of the links and jobs that name it (`position_unknown`, `job_position`, `delegate_escalation`). */
export function orgIssues(doc: WorldDoc, lint: readonly LintIssue[], org: string): LintIssue[] {
  return lint.filter((issue) => {
    const [head, id, part] = issue.path.split(".");
    if (head !== "entities" || id === undefined) return false;
    if (id === org) return true;
    const e = doc.entities[id];
    if (!e) return false;
    if (part?.startsWith("relations[")) return e.relations[Number(part.slice(10, -1))]?.to === org;
    return part === "fields" && e.fields.employer === org;
  });
}

// ---------------------------------------------------------------- the list

/** Build → Organizations: every organization by type, with counts and issues, a search past eight, and + New. */
export function OrganizationsPage() {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  if (!draft) return null;
  const doc: WorldDoc = { ...draft.doc, kinds: playedKinds(draft.packKinds, draft.doc.kinds) };
  const rows = orgRows(doc);
  const all = Object.values(rows).flat();
  const q = query.trim().toLowerCase();
  const shown = (type: OrgType) => rows[type].filter((r) => q === "" || r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q));
  return (
    <div class="lre-build-page" data-lre-organizations>
      <PageHeader
        title="Organizations"
        subtitle="Companies, households, groups and trusts"
        actions={
          adding ? undefined : (
            <Button size="sm" variant="primary" icon="plus" label="New organization" onClick={() => setAdding(true)}>
              New
            </Button>
          )
        }
      />
      {adding ? <NewOrganization doc={doc} onDone={() => setAdding(false)} /> : null}
      {all.length > 8 ? (
        <div class="lre-build-search">
          <Icon name="search" size={16} />
          <input class="lre-input" type="search" placeholder="Search organizations" aria-label="Search organizations" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
        </div>
      ) : null}
      {all.length === 0 && !adding ? (
        <Empty
          icon="users"
          title="No organizations yet"
          action={
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
              New organization
            </Button>
          }
        >
          Companies, households, groups and trusts.
        </Empty>
      ) : null}
      {ORG_GROUPS.map((group) => {
        const list = shown(group.type);
        return list.length === 0 ? null : (
          <div key={group.type} data-lre-organizations-type={group.type}>
            <Section title={`${group.title} (${rows[group.type].length})`} flush>
              <List>
                {list.map((r) => (
                  <ListRow key={r.id} id={r.id} icon="users" title={r.name} subtitle={r.kind} badge={<Issues issues={orgIssues(doc, draft.lint, r.id)} />} chevron onClick={() => go(app, { view: "item", worldId: draft.worldId, collection: "entities", id: r.id })} />
                ))}
              </List>
            </Section>
          </div>
        );
      })}
      {all.length > 0 && q !== "" && ORG_GROUPS.every((g) => shown(g.type).length === 0) ? (
        <Empty icon="search" title="No matches">
          Nothing here matches “{query.trim()}”.
        </Empty>
      ) : null}
    </div>
  );
}

/** + New: its type, a group's kind, and a name, from which its id comes; it opens in its editor. */
function NewOrganization(props: { doc: WorldDoc; onDone(): void }) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const [type, setType] = useState<Exclude<OrgType, "party">>("company");
  const [groupKind, setGroupKind] = useState("group");
  const [name, setName] = useState("");
  const [busy, run] = useBusy();
  if (!draft) return null;
  const kinds = groupKinds(props.doc);
  const create = () =>
    run(async () => {
      const id = deriveId(name.trim(), new Set(Object.keys(props.doc.entities)));
      const value: JsonObject = { ...newItem("entities", id, props.doc, name.trim()), kind: newOrgKind(type, groupKind) };
      const sent = await app.request({ type: "lre.editor", worldId: draft.worldId, base: null, op: "put", collection: "entities", id, value });
      if (!sent) return;
      props.onDone();
      go(app, { view: "item", worldId: draft.worldId, collection: "entities", id });
    });
  return (
    <form
      class="lre-stack"
      data-lre-organizations-new
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim() !== "") create();
      }}
    >
      <Seg
        label="What it is"
        value={type}
        options={[
          { value: "company", label: "Company" },
          { value: "household", label: "Household" },
          { value: "group", label: "Group" },
          { value: "trust", label: "Trust" },
        ]}
        onChange={(next) => setType(next as Exclude<OrgType, "party">)}
      />
      {type === "group" ? <RefPicker label="Kind" value={groupKind} options={kinds.map((k) => ({ value: k.id, label: k.label }))} onChange={setGroupKind} /> : null}
      <Field label="Name">
        <input class="lre-input" placeholder="Harbor Rowing Club" autoComplete="off" value={name} onInput={(event) => setName(event.currentTarget.value)} />
      </Field>
      <Button type="submit" variant="primary" block disabled={name.trim() === ""} busy={busy}>
        Create
      </Button>
      <Button variant="ghost" block onClick={props.onDone}>
        Cancel
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- the editor's reads and writes

/** The entity keys Basics lays out (the rest are under All fields). */
const BASIC_KEYS: ReadonlySet<string> = new Set(["name", "kind", "visibility", "knownBy", "tags"]);

/** Each section's fields, as the organization's kind declares them. */
const SECTION_FIELDS = {
  basics: ["structure", "industry", "place", "places", "open_at", "close_at", "trading_days"],
  people: ["owners"],
  money: ["operating_account", "payroll", "payroll_account", "dues", "distribution_pct", "distribution_every", "invoice_days", "late_fee_pct", "collects_sales_tax", "margin_pct"],
  ownership: ["share_classes", "decide_pct"],
  decisions: ["vote_by", "quorum_pct", "pass_pct", "motion_days", "vote_rules", "approval_days"],
} as const;

/** A link to `org` of `type` on someone's entity, with where it is among their relations. */
export interface OrgLink {
  who: string;
  name: string;
  index: number;
  fields: JsonObject;
  until: number | null;
}

/** The draft's links of `type` (`member_of`, `acts_for`) to `org`, by name. */
export function linksTo(doc: WorldDoc, org: string, type: string): OrgLink[] {
  return Object.entries(doc.entities)
    .flatMap(([who, e]) =>
      e.relations.flatMap((r, index) => (r.type === type && r.to === org ? [{ who, name: e.name || who, index, fields: isRecord(r.fields) ? (r.fields as JsonObject) : {}, until: typeof r.until === "number" ? r.until : null }] : [])),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.who.localeCompare(b.who));
}

/** The draft's entities of `kind` that `org` holds (its jobs by `employer`; accounts and properties among whose `owners` it is). */
export function heldBy(doc: WorldDoc, org: string, kind: "job" | "account" | "property"): { id: string; name: string; fields: JsonObject }[] {
  return Object.entries(doc.entities)
    .filter(([, e]) => kindIs(doc, e.kind, kind) && (kind === "job" ? e.fields.employer === org : Array.isArray(e.fields.owners) && e.fields.owners.some((o) => isRecord(o) && o.party === org)))
    .map(([id, e]) => ({ id, name: e.name || id, fields: e.fields as JsonObject }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface MemberLinkForm {
  title: string;
  position: string;
  rank: string;
  since: string;
}

/** A member's link written into the draft: in place where it is (its end kept), else added to their relations. */
export function memberLinkOps(org: string, who: string, index: number | null, until: number | null, form: MemberLinkForm): JsonPatchOp[] {
  const rank = Number(form.rank);
  const fields: JsonObject = {
    ...(form.title.trim() !== "" ? { role: form.title.trim() } : {}),
    ...(form.position !== "" ? { position: form.position } : {}),
    ...(form.rank.trim() !== "" && Number.isFinite(rank) ? { rank } : {}),
    ...(form.since.trim() !== "" ? { since: form.since.trim() } : {}),
  };
  const link: JsonObject = { type: "member_of", to: org, ...(Object.keys(fields).length > 0 ? { fields } : {}), ...(until !== null ? { until } : {}) };
  return index === null ? [{ op: "add", path: pointerOf(["entities", who, "relations", "-"]), value: link }] : [{ op: "replace", path: pointerOf(["entities", who, "relations", String(index)]), value: link }];
}

/** A link taken out of the draft. */
export function unlinkOps(who: string, index: number): JsonPatchOp[] {
  return [{ op: "remove", path: pointerOf(["entities", who, "relations", String(index)]) }];
}

/** A delegation written into the draft as an `acts_for` link: its powers, limits (the accounts it had among them) and granter, and its end at the end of the day typed (or the one it had). */
export function delegationLinkOps(doc: WorldDoc, org: string, index: number | null, draft: DelegationDraft): JsonPatchOp[] {
  const currency = doc.currency ?? DEFAULT_CURRENCY;
  const payment = draft.payment.trim() === "" ? null : parseMoneyInput(draft.payment, currency);
  const month = draft.month.trim() === "" ? null : parseMoneyInput(draft.month, currency);
  const until = draft.until !== "" ? localClock(`${draft.until}T23:59`, doc.calendar) : draft.kept;
  const fields: JsonObject = { powers: ORG_POWERS.filter((p) => draft.powers.includes(p)), ...(payment !== null && payment > 0 ? { payment } : {}), ...(month !== null && month > 0 ? { month } : {}), ...(draft.accounts !== null ? { accounts: [...draft.accounts] } : {}), ...(draft.by !== "" ? { by: draft.by } : {}) };
  const link: JsonObject = { type: ACTS_FOR, to: org, fields, ...(until !== null ? { until } : {}) };
  return index === null ? [{ op: "add", path: pointerOf(["entities", draft.to, "relations", "-"]), value: link }] : [{ op: "replace", path: pointerOf(["entities", draft.to, "relations", String(index)]), value: link }];
}

export interface JobDraft {
  worker: string;
  title: string;
  position: string;
  basis: string;
  rate: string;
}

/** A new job at `org`, added to the draft: its worker, title, position and pay, in force. */
export function jobAddPatch(doc: WorldDoc, org: string, form: JobDraft): JsonPatchOp[] {
  const rate = parseMoneyInput(form.rate, doc.currency ?? DEFAULT_CURRENCY);
  const title = form.title.trim();
  const orgName = doc.entities[org]?.name ?? org;
  const workerName = doc.entities[form.worker]?.name ?? form.worker;
  const id = deriveId(`job ${workerName} ${title || "work"}`, new Set(Object.keys(doc.entities)));
  const fields: JsonObject = { worker: form.worker, employer: org, ...(title !== "" ? { title } : {}), ...(form.position !== "" ? { position: form.position } : {}), basis: form.basis, ...(rate !== null && rate > 0 ? { rate } : {}), status: "active" };
  const value: JsonObject = { ...newItem("entities", id, doc, `${title || "Work"} at ${orgName}`), kind: "job", tier: "background", fields };
  return [{ op: "add", path: pointerOf(["entities", id]), value }];
}

/** The organization's positions with `draft` in place of the one it edits, or added last; `remove` takes it out (and anyone reporting to it reports to no one). */
export function positionsWith(positions: readonly Position[], draft: PositionDraft, currency: WorldDoc["currency"], remove = false): JsonValue[] {
  const record = positionRecord(draft, currency ?? DEFAULT_CURRENCY);
  const id = String(record.id);
  const clear = (p: Position): JsonObject => {
    const out = { ...(p as unknown as JsonObject) };
    if (remove && out.reports_to === id) delete out.reports_to;
    if (record.default === true && out.id !== id) delete out.default;
    return out;
  };
  const rest = positions.filter((p) => p.id !== id).map(clear);
  if (remove) return rest;
  const at = positions.findIndex((p) => p.id === id);
  return at < 0 ? [...rest, record] : positions.map((p) => (p.id === id ? record : clear(p)));
}

// ---------------------------------------------------------------- the editor

type OrgSheet = { kind: "member"; link: OrgLink | null } | { kind: "job" } | { kind: "position"; id: string | null } | { kind: "delegation"; link: OrgLink | null };

/** An organization's editor in Build (§6.3), as its sections lay it out. */
export function OrgEditor(props: EditorProps) {
  const app = useApp();
  const draft = useSelect(app.drafts, (d) => d);
  const id = props.id ?? "";
  const stored = (props.world.entities as Record<string, unknown>)[id];
  const initial: JsonObject = isRecord(stored) ? (stored as JsonObject) : {};
  const [value, setValue] = useState<JsonObject>(initial);
  const [sheet, setSheet] = useState<OrgSheet | null>(null);
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.world.id}/entities/${id}`, JSON.stringify(stored ?? null));
  const formDoc: WorldDoc = useMemo(() => ({ ...props.world, kinds: playedKinds(draft?.packKinds, props.world.kinds), relations: { ...draft?.packRelations, ...props.world.relations } }), [props.world, draft?.packKinds, draft?.packRelations]);
  const identifiers = useMemo(() => worldIdentifiers(props.world), [props.world]);
  const path = `entities.${id}`;
  const lint = draft?.lint ?? [];
  const ctx: FormCtx = { doc: formDoc, lint, path, identifiers, functions: draft?.functions ?? [], fieldEditors: app.catalog.fields };
  const kind = typeof value.kind === "string" ? value.kind : "";
  const type = orgTypeOfKind(formDoc, kind);
  const defs = kindFields(formDoc, kind);
  const fields: JsonObject = isRecord(value.fields) ? value.fields : {};
  const currency = props.world.currency ?? DEFAULT_CURRENCY;
  const positions = positionsIn(fields.positions);
  const setField = (field: string, next: JsonValue | undefined): void => {
    const out: JsonObject = { ...fields };
    if (next === undefined) delete out[field];
    else out[field] = next;
    setValue({ ...value, fields: out });
  };
  const changed = JSON.stringify(value) !== JSON.stringify(stored ?? null);
  const name = typeof value.name === "string" && value.name !== "" ? value.name : id;
  /** Another entity's change, into the draft at once. */
  const patch = (ops: JsonPatchOp[]) =>
    run(async () => {
      if (ops.length === 0) return;
      const sent = await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "patch", ops });
      if (sent.type === "lre.result") setSheet(null);
    });
  const save = () =>
    run(async () => {
      const ops = entityPatch(id, initial, value);
      if (ops.length > 0) await props.send({ type: "lre.editor", worldId: props.world.id, base: null, op: "patch", ops });
    });
  const inputs = (names: readonly string[]) =>
    names.flatMap((n) => {
      const def = hasOwn(defs, n) ? defs[n] : undefined;
      return def ? [<DefInput key={n} name={n} def={def} defs={defs} value={fields[n]} ctx={ctx} path={`${path}.fields.${n}`} onChange={(next) => setField(n, next)} />] : [];
    });
  const people: OrgRef[] = Object.entries(formDoc.entities)
    .filter(([, e]) => kindIs(formDoc, e.kind, "person"))
    .map(([who, e]) => ({ id: who, name: e.name || who }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sheet !== null) {
    const close = () => setSheet(null);
    if (sheet.kind === "position") return <PositionSheet positions={positions} id={sheet.id} people={people} currency={currency} onClose={close} onDone={(list) => (setField("positions", list), close())} />;
    if (sheet.kind === "member") return <MemberLinkSheet doc={formDoc} org={id} orgName={name} positions={positions} link={sheet.link} busy={busy} onClose={close} onSave={patch} />;
    if (sheet.kind === "job") return <JobAddSheet doc={formDoc} org={id} orgName={name} positions={positions} people={people} busy={busy} onClose={close} onSave={patch} />;
    return <DelegationSheet doc={formDoc} org={id} orgName={name} link={sheet.link} people={people} busy={busy} onClose={close} onSave={patch} />;
  }
  const members = linksTo(formDoc, id, "member_of");
  const delegations = linksTo(formDoc, id, ACTS_FOR);
  const jobs = heldBy(formDoc, id, "job");
  const accounts = heldBy(formDoc, id, "account");
  const properties = heldBy(formDoc, id, "property");
  const places = [...new Set([...(typeof fields.place === "string" ? [fields.place] : []), ...(Array.isArray(fields.places) ? fields.places.filter((p): p is string => typeof p === "string") : [])])];
  const open = (to: string, collection: "entities" | "places" = "entities") => go(app, { view: "item", worldId: props.world.id, collection, id: to });
  const titled = (o: OrgLink) => [typeof o.fields.role === "string" ? o.fields.role : null, positions.find((p) => p.id === o.fields.position)?.title ?? null, typeof o.fields.rank === "number" ? `rank ${o.fields.rank}` : null, typeof o.fields.since === "string" ? `since ${o.fields.since}` : null].filter((part) => part !== null).join(" · ") || "Member";
  return (
    <div class="lre-build-page" data-lre-editor="organization" data-lre-org-type={type ?? "none"}>
      <ItemHeader title={name} id={id} subtitle={ORG_GROUPS.find((g) => g.type === type)?.noun} onDelete={() => run(() => deleteItem(app, props.send, { worldId: props.world.id, collection: "entities", id, name }))} busy={busy} />
      {lintAt(lint, path)
        .filter((issue) => issue.path === path)
        .map((issue) => (
          <Banner key={issue.code} tone={issue.severity === "error" ? "neg" : issue.severity === "warning" ? "warn" : "info"}>
            {issue.message}
          </Banner>
        ))}
      <Section title="Basics">
        <SchemaFields specs={COLLECTION_SPECS.entities.filter((s) => BASIC_KEYS.has(s.key))} value={value} ctx={ctx} onChange={setValue} />
        {inputs(SECTION_FIELDS.basics)}
      </Section>
      <div data-lre-org-build="people">
        <Section title="People" flush>
          <List>
            {members.map((m) => (
              <ListRow key={`${m.who}:${m.index}`} id={m.who} icon="user" title={m.name} subtitle={titled(m)} chevron onClick={() => setSheet({ kind: "member", link: m })} />
            ))}
            {type !== "trust" ? <ListRow icon="user-plus" title="Add a member" chevron onClick={() => setSheet({ kind: "member", link: null })} /> : null}
          </List>
        </Section>
        {type !== "trust" || jobs.length > 0 ? (
          <Section title="Staff" flush>
            <List>
              {jobs.map((j) => (
                <ListRow key={j.id} id={j.id} icon="briefcase" title={formDoc.entities[String(j.fields.worker ?? "")]?.name ?? String(j.fields.worker ?? "No one")} subtitle={[typeof j.fields.title === "string" ? j.fields.title : null, positions.find((p) => p.id === j.fields.position)?.title ?? null, j.fields.status === "ended" ? "ended" : null].filter((part) => part !== null).join(" · ") || j.name} chevron onClick={() => open(j.id)} />
              ))}
              <ListRow icon="plus" title="Add a job" chevron onClick={() => setSheet({ kind: "job" })} />
            </List>
          </Section>
        ) : null}
        {inputs(SECTION_FIELDS.people)}
        <Section title="Acting for it" flush>
          <List>
            {delegations.map((d) => (
              <ListRow key={`${d.who}:${d.index}`} id={d.who} icon="key" title={d.name} subtitle={[powersText(powersIn(d.fields.powers)), ...limitWords({ ...(typeof d.fields.payment === "number" ? { payment: d.fields.payment } : {}), ...(typeof d.fields.month === "number" ? { month: d.fields.month } : {}) })].join(" · ")} chevron onClick={() => setSheet({ kind: "delegation", link: d })} />
            ))}
            <ListRow icon="key" title="Let someone act for it" chevron onClick={() => setSheet({ kind: "delegation", link: null })} />
          </List>
        </Section>
      </div>
      <div data-lre-org-build="positions">
        <Section title="Positions" flush>
          <List>
            {positions.map((p) => (
              <ListRow key={p.id} id={p.id} icon="scroll" title={p.title} subtitle={[powersText(p.powers), p.seats === 0 ? "any number" : `${p.seats} seat${p.seats === 1 ? "" : "s"}`, p.reports_to ? `reports to ${positions.find((q) => q.id === p.reports_to)?.title ?? p.reports_to}` : null, ...(p.limits ? limitWords(p.limits) : [])].filter((part) => part !== null).join(" · ")} badge={p.default ? <Badge tone="accent">New members</Badge> : undefined} chevron onClick={() => setSheet({ kind: "position", id: p.id })} />
            ))}
            <ListRow icon="plus" title="Add position" chevron onClick={() => setSheet({ kind: "position", id: null })} />
          </List>
        </Section>
      </div>
      <Section title="Money">
        <div class="lre-stack">
          {accounts.length > 0 ? (
            <List>
              {accounts.map((a) => (
                <ListRow key={a.id} id={a.id} icon="wallet" title={a.name} subtitle={typeof a.fields.class === "string" ? humanize(a.fields.class) : undefined} chevron onClick={() => open(a.id)} />
              ))}
            </List>
          ) : (
            <span class="lre-small lre-muted">It holds no accounts in the Money records.</span>
          )}
          {inputs(SECTION_FIELDS.money)}
        </div>
      </Section>
      {type === "company" ? <Section title="Ownership">{inputs(SECTION_FIELDS.ownership)}</Section> : null}
      <Section title="Decisions">{inputs(SECTION_FIELDS.decisions)}</Section>
      <Section title="Property and entry" flush>
        <List>
          {properties.map((p) => (
            <ListRow key={p.id} id={p.id} icon="home" title={p.name} chevron onClick={() => open(p.id)} />
          ))}
          {places.map((place) => {
            const fieldsAt = formDoc.places[place]?.fields;
            const entry = isRecord(fieldsAt) && typeof fieldsAt.entry === "string" ? fieldsAt.entry : null;
            return <ListRow key={place} id={place} icon="map" title={formDoc.places[place]?.name ?? place} subtitle={entry ? `Entry: ${humanize(entry)}` : "Entry as its kind has it"} chevron onClick={() => open(place, "places")} />;
          })}
          {properties.length === 0 && places.length === 0 ? <ListRow title="It holds no property or places" /> : null}
        </List>
      </Section>
      <Disclosure summary="All fields">
        <SchemaFields specs={COLLECTION_SPECS.entities} value={value} ctx={ctx} onChange={setValue} />
      </Disclosure>
      <SaveBar>
        <Button variant="primary" disabled={!changed} busy={busy} onClick={save}>
          Save to draft
        </Button>
        <Button variant="ghost" disabled={busy || !changed} onClick={() => setValue(initial)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}

// ---------------------------------------------------------------- the editor's sheets

/** A position, added or edited into the organization's positions (saved with the organization), or removed. */
function PositionSheet(props: { positions: readonly Position[]; id: string | null; people: readonly OrgRef[]; currency: WorldDoc["currency"]; onClose(): void; onDone(list: JsonValue[]): void }) {
  const currency = props.currency ?? DEFAULT_CURRENCY;
  const before = props.id === null ? null : (props.positions.find((p) => p.id === props.id) ?? null);
  const [draft, setDraft] = useState(() => positionDraft(before, currency));
  const problem = positionProblem(draft, props.positions, currency);
  return (
    <FormSheet title={before ? before.title : "Add position"} subtitle="Saved with the organization" onClose={props.onClose}>
      <div class="lre-stack" data-lre-org-build-sheet="position">
        <PositionFields draft={draft} positions={props.positions} people={props.people} offer={ORG_POWERS} currency={currency} onChange={setDraft} />
        {problem !== null ? <span class="lre-small lre-muted">{problem}</span> : null}
        <Button variant="primary" block disabled={problem !== null} onClick={() => props.onDone(positionsWith(props.positions, draft, currency))}>
          {before ? "Done" : "Add the position"}
        </Button>
        {before ? (
          <Button variant="danger" icon="trash" block onClick={() => props.onDone(positionsWith(props.positions, draft, currency, true))}>
            Remove the position
          </Button>
        ) : null}
      </div>
    </FormSheet>
  );
}

/** A member's link: who (when adding), their title, position, rank and since; Remove for one already linked. Saved to the draft at once. */
function MemberLinkSheet(props: { doc: WorldDoc; org: string; orgName: string; positions: readonly Position[]; link: OrgLink | null; busy: boolean; onClose(): void; onSave(ops: JsonPatchOp[]): void }) {
  const { link } = props;
  const f = link?.fields ?? {};
  const [who, setWho] = useState(link?.who ?? "");
  const [form, setForm] = useState<MemberLinkForm>({ title: typeof f.role === "string" ? f.role : "", position: typeof f.position === "string" ? f.position : "", rank: typeof f.rank === "number" ? String(f.rank) : "", since: typeof f.since === "string" ? f.since : "" });
  const set = (patch: Partial<MemberLinkForm>) => setForm((x) => ({ ...x, ...patch }));
  const linked = new Set(linksTo(props.doc, props.org, "member_of").map((l) => l.who));
  const candidates = Object.entries(props.doc.entities)
    .filter(([id, e]) => id !== props.org && !linked.has(id) && (kindIs(props.doc, e.kind, "person") || kindIs(props.doc, e.kind, "group")))
    .map(([id, e]) => ({ value: id, label: e.name || id }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const problem = who === "" ? "Choose who belongs." : form.rank.trim() !== "" && !Number.isFinite(Number(form.rank)) ? "A rank is a number." : null;
  return (
    <FormSheet title={link ? link.name : "Add a member"} subtitle={`${props.orgName} · saved to the draft at once`} onClose={props.onClose}>
      <div class="lre-stack" data-lre-org-build-sheet="member">
        {link ? null : <RefPicker label="Who" value={who} options={candidates} onChange={setWho} />}
        <Field label="Title">
          <input class="lre-input" placeholder="Treasurer" value={form.title} onInput={(event) => set({ title: event.currentTarget.value })} />
        </Field>
        <RefPicker label="Position" value={form.position} options={props.positions.map((p) => ({ value: p.id, label: p.title }))} none="No position" onChange={(position) => set({ position })} />
        <Field label="Rank">
          <input class="lre-input" type="number" value={form.rank} onInput={(event) => set({ rank: event.currentTarget.value })} />
        </Field>
        <Field label="Since">
          <input class="lre-input" type="date" value={form.since} onInput={(event) => set({ since: event.currentTarget.value })} />
        </Field>
        {problem !== null ? <span class="lre-small lre-muted">{problem}</span> : null}
        <Button variant="primary" block disabled={problem !== null} busy={props.busy} onClick={() => props.onSave(memberLinkOps(props.org, who, link?.index ?? null, link?.until ?? null, form))}>
          {link ? "Save to draft" : "Add"}
        </Button>
        {link ? (
          <Button variant="danger" icon="trash" block disabled={props.busy} onClick={() => props.onSave(unlinkOps(link.who, link.index))}>
            {`Remove from ${props.orgName}`}
          </Button>
        ) : null}
      </div>
    </FormSheet>
  );
}

/** Add a job: who works it, as what, in which position, and its pay. Saved to the draft at once; the job's own page has the rest. */
function JobAddSheet(props: { doc: WorldDoc; org: string; orgName: string; positions: readonly Position[]; people: readonly OrgRef[]; busy: boolean; onClose(): void; onSave(ops: JsonPatchOp[]): void }) {
  const [form, setForm] = useState<JobDraft>({ worker: "", title: "", position: "", basis: "hourly", rate: "" });
  const set = (patch: Partial<JobDraft>) => setForm((x) => ({ ...x, ...patch }));
  const currency = props.doc.currency ?? DEFAULT_CURRENCY;
  const problem = form.worker === "" ? "Choose who works it." : form.rate.trim() !== "" && parseMoneyInput(form.rate, currency) === null ? "Type the rate as an amount." : null;
  return (
    <FormSheet title="Add a job" subtitle={`${props.orgName} · saved to the draft at once`} onClose={props.onClose}>
      <div class="lre-stack" data-lre-org-build-sheet="job">
        <RefPicker label="Worker" value={form.worker} options={props.people.map((p) => ({ value: p.id, label: p.name }))} onChange={(worker) => set({ worker })} />
        <Field label="Title">
          <input class="lre-input" placeholder="Receptionist" value={form.title} onInput={(event) => set({ title: event.currentTarget.value })} />
        </Field>
        <RefPicker label="Position" value={form.position} options={props.positions.map((p) => ({ value: p.id, label: p.title }))} none="No position" onChange={(position) => set({ position })} />
        <RefPicker label="Paid by" value={form.basis} options={PAY_BASES.map((b) => ({ value: b, label: humanize(b) }))} onChange={(basis) => set({ basis })} />
        <Field label="Rate (a year, an hour or a shift)">
          <MoneyInput currency={currency} value={form.rate} label="Rate" onInput={(rate) => set({ rate })} />
        </Field>
        {problem !== null ? <span class="lre-small lre-muted">{problem}</span> : null}
        <Button variant="primary" block disabled={problem !== null} busy={props.busy} onClick={() => props.onSave(jobAddPatch(props.doc, props.org, form))}>
          Add the job
        </Button>
      </div>
    </FormSheet>
  );
}

/** Someone acting for it (`acts_for`): who, the powers, limits, until when and who granted it; Remove for one there already. Saved to the draft at once. */
function DelegationSheet(props: { doc: WorldDoc; org: string; orgName: string; link: OrgLink | null; people: readonly OrgRef[]; busy: boolean; onClose(): void; onSave(ops: JsonPatchOp[]): void }) {
  const { link } = props;
  const currency = props.doc.currency ?? DEFAULT_CURRENCY;
  const f = link?.fields ?? {};
  const [draft, setDraft] = useState(() => {
    const accounts = limitsIn(f)?.accounts;
    return delegationDraft(link?.who ?? "", link ? { powers: powersIn(f.powers), ...(typeof f.payment === "number" ? { payment: f.payment } : {}), ...(typeof f.month === "number" ? { month: f.month } : {}), ...(accounts !== undefined ? { accounts } : {}), until: link.until, by: typeof f.by === "string" ? f.by : null } : null, currency);
  });
  const kept = link?.until !== null && link?.until !== undefined ? (clockLocal(link.until, props.doc.calendar)?.slice(0, 10) ?? null) : null;
  const problem = delegationProblem(draft, currency);
  return (
    <FormSheet title={link ? `${link.name} acts for it` : "Let someone act for it"} subtitle={`${props.orgName} · saved to the draft at once`} onClose={props.onClose}>
      <div class="lre-stack" data-lre-org-build-sheet="delegation">
        <DelegationFields draft={draft} people={link ? null : props.people} offer={ORG_POWERS} granters={props.people} kept={kept} currency={currency} onChange={setDraft} />
        {problem !== null ? <span class="lre-small lre-muted">{problem}</span> : null}
        <Button variant="primary" block disabled={problem !== null} busy={props.busy} onClick={() => props.onSave(delegationLinkOps(props.doc, props.org, link?.index ?? null, draft))}>
          {link ? "Save to draft" : "Add"}
        </Button>
        {link ? (
          <Button variant="danger" icon="trash" block disabled={props.busy} onClick={() => props.onSave(unlinkOps(link.who, link.index))}>
            No longer acts for it
          </Button>
        ) : null}
      </div>
    </FormSheet>
  );
}

/** Whether Build opens an entity on an organization's editor: one in the draft whose kind makes it an organization. */
export function opensOrgPage(doc: WorldDoc, collection: string, id: string | null): boolean {
  if (collection !== "entities" || id === null || id.startsWith("new:")) return false;
  const e = hasOwn(doc.entities, id) ? doc.entities[id] : undefined;
  return e !== undefined && orgTypeOfKind(doc, e.kind) !== null;
}
