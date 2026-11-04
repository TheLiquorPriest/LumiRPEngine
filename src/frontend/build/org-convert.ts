// Changing what an organization is (6.16; Build → Organizations → Basics → Change what it is), as
// plain data: the preview of a conversion between a company and a trust, in words, and the one draft
// patch that makes it. Nothing changes in a running chat until its Upgrade takes the new revision,
// which shows the conversion as one change (`backend/upgrade-preview.ts`); there is no kind change in
// play (B decision 3).
// - A company becomes a trust: its managing owners become its trustees, the owners of its worth its
//   beneficiaries by their shares; the fields only a company reads are listed and dropped; a listed
//   company is refused (take it off the market first), and so is one with no owner to be trustee.
// - A trust becomes a company: its beneficiaries become its owners by their shares, and its trustees
//   hold a Director position with every power (a membership each, made where they have none); the
//   fields only a trust reads are listed and dropped; one with no beneficiary is refused.
// - Either is refused while something else names it where only its old kind may stand (a company's
//   invoices), each by name, so the world lints clean after it.
// Positions, members, staff and delegations stay as they are: both kinds read them. Pure.

import type { JsonObject, JsonValue } from "../../shared/json";
import { isRecord } from "../../shared/json";
import { pointerOf } from "../../shared/json-patch";
import { listingIn, ownersIn, OWNER_ROLE_LABELS, ROLE_RIGHTS, worthShares, type Owner, type OwnerRole } from "../../shared/finance";
import { DIRECTOR, ORG_POWERS, positionIdOf, positionsIn } from "../../shared/org";
import type { JsonPatchOp } from "../../shared/protocol";
import type { WorldDoc } from "../../shared/world";
import { entityPatch } from "./character-model";
import { kindFields } from "./schema-form";
import { kindIs } from "./selector-editor";

/** What an organization may be changed into from Build. */
export type ConvertTo = "company" | "trust";

/** Each one's kind, as a new organization of it takes. */
const KIND_OF: Readonly<Record<ConvertTo, string>> = { company: "business", trust: "trust" };

/** A conversion's preview and its patch. */
export interface OrgConversion {
  to: ConvertTo;
  /** Why it can't be done, in words; null when it can. */
  why: string | null;
  /** Who becomes what: "Marcus Delgado", "Owner (100%)" → "Trustee and Beneficiary (100%)". */
  people: { name: string; from: string; to: string }[];
  /** The fields the new kind doesn't read, by their labels, dropped. */
  dropped: string[];
  /** Anything else it does, in words. */
  notes: string[];
  /** The one draft patch: the organization's kind, owners and fields, and each trustee's membership. */
  ops: JsonPatchOp[];
}

/** The link a member holds to an organization (the engine's `member_of`). */
const MEMBER_OF = "member_of";

/** What an organization of `kind` may become: a company a trust, a trust a company; nothing for any other. */
export function conversionTargets(doc: WorldDoc, kind: string): ConvertTo[] {
  if (kindIs(doc, kind, "trust")) return ["company"];
  return kindIs(doc, kind, "business") ? ["trust"] : [];
}

/** A row's role and share in words: "Owner (60%)", "Trustee". */
function rowWords(o: Owner, shares: Readonly<Record<string, number>>): string {
  const role = OWNER_ROLE_LABELS[o.role].one;
  return ROLE_RIGHTS[o.role].worth ? `${role} (${round(shares[o.party] ?? 0)}%)` : role;
}

/** A share kept to two places. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Each party once, in the order the rows name them. */
function partiesOf(rows: readonly Owner[]): string[] {
  return [...new Set(rows.map((o) => o.party))];
}

/** The entities naming `id` in a field only an organization of another kind than `kind` may fill (a company's invoices, for a trust), each by name. */
function dependents(doc: WorldDoc, id: string, kind: string): string[] {
  return Object.entries(doc.entities).flatMap(([eid, e]) => {
    if (eid === id || !isRecord(e.fields)) return [];
    const defs = kindFields(doc, e.kind);
    const named = Object.entries(e.fields).some(([f, v]) => {
      const ref = defs[f]?.type === "ref" ? defs[f]?.ref : undefined;
      return v === id && ref !== undefined && !kindIs(doc, kind, ref);
    });
    return named ? [e.name || eid] : [];
  });
}

/** Why a conversion would leave something naming it where it may no longer stand; null when nothing does. */
function dependentWhy(doc: WorldDoc, id: string, to: ConvertTo): string | null {
  const names = dependents(doc, id, KIND_OF[to]);
  if (names.length === 0) return null;
  const shown = names.length > 3 ? [...names.slice(0, 3), `${names.length - 3} more`] : names;
  const list = shown.length === 1 ? (shown[0] ?? "") : `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
  return `${list} ${names.length === 1 ? "names" : "name"} it where a ${to === "trust" ? "company" : "trust"} must stand: change or remove ${names.length === 1 ? "it" : "them"} first.`;
}

/** The fields `from` declares and `to` doesn't, among those set, by label. */
function onlyOf(doc: WorldDoc, fields: Readonly<JsonObject>, from: string, to: string): { keys: string[]; labels: string[] } {
  const was = kindFields(doc, from);
  const next = kindFields(doc, to);
  const keys = Object.keys(fields).filter((k) => k in was && !(k in next) && fields[k] !== undefined);
  return { keys, labels: keys.map((k) => was[k]?.label ?? k) };
}

/** Each party's old rows and new ones, in words. */
function peopleWords(doc: WorldDoc, before: readonly Owner[], after: readonly Owner[], extra: Readonly<Record<string, string>> = {}): OrgConversion["people"] {
  const was = worthShares(before);
  const now = worthShares(after);
  return [...new Set([...partiesOf(before), ...partiesOf(after)])].map((party) => {
    const from = before.filter((o) => o.party === party).map((o) => rowWords(o, was));
    const to = [...after.filter((o) => o.party === party).map((o) => rowWords(o, now)), ...(extra[party] ? [extra[party]] : [])];
    return { name: doc.entities[party]?.name || party, from: from.join(" and ") || "Nothing", to: to.join(" and ") || "Nothing: dropped" };
  });
}

/** A company as a trust: managing owners its trustees, the owners of its worth its beneficiaries. */
function toTrust(doc: WorldDoc, id: string, entity: JsonObject, fields: JsonObject, owners: readonly Owner[]): OrgConversion {
  const out: OrgConversion = { to: "trust", why: null, people: [], dropped: [], notes: [], ops: [] };
  if (listingIn(fields)) return { ...out, why: "It is listed on a market: take it off the market first; a trust has no stockholders." };
  const trustees = partiesOf(owners.filter((o) => ROLE_RIGHTS[o.role].manage));
  if (trustees.length === 0) return { ...out, why: "No owner manages it, so no one would be its trustee." };
  const shares = worthShares(owners);
  const beneficiaries = partiesOf(owners.filter((o) => ROLE_RIGHTS[o.role].worth && (shares[o.party] ?? 0) > 0));
  const after: Owner[] = [...trustees.map((party): Owner => ({ party, role: "trustee" })), ...beneficiaries.map((party): Owner => ({ party, role: "beneficiary", share: round(shares[party] ?? 0) }))];
  const only = onlyOf(doc, fields, String(entity.kind), KIND_OF.trust);
  const next: JsonObject = { ...fields, owners: after.map((o) => ({ ...o }) as unknown as JsonValue) };
  for (const k of only.keys) delete next[k];
  const units = owners.some((o) => o.units !== undefined || o.class !== undefined);
  return {
    ...out,
    people: peopleWords(doc, owners, after),
    dropped: only.labels,
    notes: [...(units ? ["Its units and share classes go: a trust's beneficiaries hold shares of its worth."] : []), "Its positions, members, staff and delegations stay."],
    ops: entityPatch(id, entity, { ...entity, kind: KIND_OF.trust, fields: next }),
  };
}

/** A trust as a company: its beneficiaries its owners by share, its trustees seated as its Director. */
function toCompany(doc: WorldDoc, id: string, entity: JsonObject, fields: JsonObject, owners: readonly Owner[]): OrgConversion {
  const out: OrgConversion = { to: "company", why: null, people: [], dropped: [], notes: [], ops: [] };
  const shares = worthShares(owners);
  const beneficiaries = partiesOf(owners.filter((o) => ROLE_RIGHTS[o.role].worth && (shares[o.party] ?? 0) > 0));
  if (beneficiaries.length === 0) return { ...out, why: "It has no beneficiary to own the company." };
  const trustees = partiesOf(owners.filter((o) => ROLE_RIGHTS[o.role].manage && !ROLE_RIGHTS[o.role].worth));
  const after: Owner[] = beneficiaries.map((party): Owner => ({ party, role: "owner", share: round(shares[party] ?? 0) }));
  // The trustees' seat: Director, every power, one seat each; another id where the trust has a position of that id already.
  const positions = positionsIn(fields.positions);
  const taken = new Set(positions.map((p) => p.id));
  let seat: string = DIRECTOR;
  for (let n = 2; taken.has(seat); n++) seat = positionIdOf(`${DIRECTOR} ${n}`);
  const links: JsonPatchOp[] = [];
  const seated: Record<string, string> = {};
  for (const party of trustees) {
    const holder = doc.entities[party];
    if (!holder) continue;
    const at = holder.relations.findIndex((r) => r.type === MEMBER_OF && r.to === id);
    const link = at < 0 ? undefined : holder.relations[at];
    const linked = isRecord(link?.fields) ? (link.fields as JsonObject) : {};
    if (link && typeof linked.position === "string" && linked.position !== "") {
      seated[party] = `keeps their seat (${positions.find((p) => p.id === linked.position)?.title ?? linked.position})`;
      continue;
    }
    seated[party] = "Director";
    const value: JsonObject = { type: MEMBER_OF, to: id, fields: { ...linked, position: seat }, ...(link?.until !== undefined ? { until: link.until } : {}) };
    links.push(at < 0 ? { op: "add", path: pointerOf(["entities", party, "relations", "-"]), value } : { op: "replace", path: pointerOf(["entities", party, "relations", String(at)]), value });
  }
  const director = Object.values(seated).some((s) => s === "Director");
  const only = onlyOf(doc, fields, String(entity.kind), KIND_OF.company);
  const next: JsonObject = { ...fields, owners: after.map((o) => ({ ...o }) as unknown as JsonValue), ...(director ? { positions: [...(Array.isArray(fields.positions) ? fields.positions : []), { id: seat, title: "Director", powers: [...ORG_POWERS], seats: 0 }] } : {}) };
  for (const k of only.keys) delete next[k];
  // A company's votes go by shares, never by its trustees.
  const trusteeVotes = next.vote_by === "trustees";
  if (trusteeVotes) delete next.vote_by;
  const dropped = owners.filter((o) => !ROLE_RIGHTS[o.role].worth && !ROLE_RIGHTS[o.role].manage).map((o) => o.role as OwnerRole);
  return {
    ...out,
    people: peopleWords(doc, owners, after, seated),
    dropped: [...only.labels, ...(trusteeVotes ? ["Votes by its trustees"] : [])],
    notes: [...(director ? ["Adds a Director position, with every power, which its trustees hold."] : []), ...(dropped.length > 0 ? [`Its ${[...new Set(dropped)].map((r) => OWNER_ROLE_LABELS[r].many.toLowerCase()).join(" and ")} go: a company has owners.`] : []), "Its positions, members, staff and delegations stay; set its structure under Ownership."],
    ops: [...entityPatch(id, entity, { ...entity, kind: KIND_OF.company, fields: next }), ...links],
  };
}

/** The conversion of `id` into `to`, as the draft holds it now; refused, with why, where it can't be done. */
export function orgConversion(doc: WorldDoc, id: string, to: ConvertTo): OrgConversion {
  const e = doc.entities[id];
  const none: OrgConversion = { to, why: null, people: [], dropped: [], notes: [], ops: [] };
  if (!e) return { ...none, why: "It isn't in the draft any more." };
  if (!conversionTargets(doc, e.kind).includes(to)) return { ...none, why: `A ${doc.kinds[e.kind]?.label ?? e.kind} can't become a ${to}.` };
  const entity = e as unknown as JsonObject;
  const fields: JsonObject = isRecord(e.fields) ? (e.fields as JsonObject) : {};
  const owners = ownersIn(fields);
  const out = to === "trust" ? toTrust(doc, id, entity, fields, owners) : toCompany(doc, id, entity, fields, owners);
  const why = out.why ?? dependentWhy(doc, id, to);
  return why === null ? out : { ...out, why, ops: [] };
}
