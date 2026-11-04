// Organizations' lint (ORG-SPEC §6.4): positions and delegations an author wrote, read as a chat
// starts, each problem told in plain words, with the fix Problems offers in one press where one
// mends it (a draft patch of only what it changes): powers there are none of taken out, a report
// to no one, seats for every holder, a position taken off a link or a job, a delegation cut to what
// its granter holds, shares set from units, a company group made a business, and a Head position
// for the member titled head. A pass-through company's profit owned by an organization that pays
// no income tax is told too, with no fix: who should be taxed on it is the author's to say; an
// exempt holder isn't, its exemption saying why. Exempt statuses (§3.11, Phase 5): one the world's
// exempt table doesn't hold, or one on a household or the party, is told with a fix that takes it
// off, and an exempt company whose owners hold its worth is told. Pure.

import { ownersIn, worthShares } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import type { JsonValue } from "../../../shared/json";
import { pointerOf } from "../../../shared/json-patch";
import { objOf, own } from "../../../engine/pack-kit";
import { ACTS_FOR, isOrgPower, ORG_POWERS, positionIn, positionsIn, POWER_WORDS, type OrgPower } from "../../../shared/org";
import type { LintFix, LintIssue } from "../../../shared/protocol";
import type { WorldDoc } from "../../../shared/world";
import { headOf, HEAD, jobsAt, orgPower, orgTypeOf, placesOf, positionsOf } from "../../../engine/org";
import { siteOf } from "../../../engine/presence";
import { placeWithin } from "../../../engine/scope";
import type { LintRule, ReadContext } from "../../../engine/registry";
import type { Registry } from "../../../engine/registry-impl";
import { kindIs } from "../../../engine/scope";
import { MEMBER_OF } from "../../../engine/selector";
import { initialState } from "../../../engine/world-state";

/** A fix replacing (or adding) one value of the document. */
function setFix(label: string, tokens: readonly string[], value: JsonValue): LintFix {
  return { label, ops: [{ op: "add", path: pointerOf(tokens), value }] };
}

/** A fix taking one value out of the document. */
function dropFix(label: string, tokens: readonly string[]): LintFix {
  return { label, ops: [{ op: "remove", path: pointerOf(tokens) }] };
}

/** The organizations' lint codes. */
export const ORG_LINT = {
  positionUnknown: "orgs.position_unknown",
  seats: "orgs.seats",
  reportsCycle: "orgs.reports_cycle",
  powerUnknown: "orgs.power_unknown",
  jobPosition: "orgs.job_position",
  delegateEscalation: "orgs.delegate_escalation",
  unitsShare: "orgs.units_share",
  companyGroup: "orgs.company_group",
  headTitle: "orgs.head_title",
  profitUntaxed: "orgs.profit_untaxed",
  exemptUnknown: "orgs.exempt_unknown",
  exemptType: "orgs.exempt_type",
  exemptOwners: "orgs.exempt_owners",
  placeSpans: "orgs.place_spans",
} as const;

/** The world as a chat starts on it. */
function startOf(world: WorldDoc, registry: Registry): ReadContext {
  return registry.context(world, initialState(world, "", registry));
}

function nameOf(world: WorldDoc, id: EntityId): string {
  return own(world.entities, id)?.name ?? id;
}

/** Each organization's positions: unknown powers, an unknown or circular `reports_to`, more holders than seats. */
function positionIssues(world: WorldDoc, ctx: ReadContext): LintIssue[] {
  const out: LintIssue[] = [];
  for (const id of Object.keys(world.entities).sort()) {
    if (orgTypeOf(ctx, id) === null) continue;
    const raw = own(world.entities, id)?.fields.positions;
    const positions = positionsOf(ctx, id);
    const org = nameOf(world, id);
    const list = Array.isArray(raw) ? raw : [];
    list.forEach((p, i) => {
      const named = Array.isArray(objOf(p).powers) ? (objOf(p).powers as unknown[]) : [];
      const fix = setFix("Take out the powers there are none of", ["entities", id, "fields", "positions", String(i), "powers"], named.filter(isOrgPower));
      for (const power of named) {
        if (!isOrgPower(power)) out.push({ severity: "error", code: ORG_LINT.powerUnknown, path: `entities.${id}.fields.positions[${i}].powers`, message: `${org}'s position ${String(objOf(p).title ?? objOf(p).id ?? i)} names a power "${String(power)}" there is none of.`, fix });
      }
    });
    for (const p of positions) {
      // Where it is in the field as written: each fix changes that one.
      const at = String(list.findIndex((r) => positionIn(r)?.id === p.id));
      const unreport = dropFix(`Have ${p.title} report to no one`, ["entities", id, "fields", "positions", at, "reports_to"]);
      if (p.reports_to !== undefined && !positions.some((q) => q.id === p.reports_to)) out.push({ severity: "warning", code: ORG_LINT.positionUnknown, path: `entities.${id}.fields.positions`, message: `${org}'s ${p.title} reports to "${p.reports_to}", a position ${org} doesn't define.`, fix: unreport });
      // A cycle: following reports_to from it comes back to it.
      const seen = new Set<string>([p.id]);
      for (let cur = p.reports_to, guard = 0; cur !== undefined && guard <= positions.length; cur = positions.find((q) => q.id === cur)?.reports_to, guard++) {
        if (cur === p.id) {
          out.push({ severity: "error", code: ORG_LINT.reportsCycle, path: `entities.${id}.fields.positions`, message: `${org}'s ${p.title} reports, up the line, to itself.`, fix: unreport });
          break;
        }
        if (seen.has(cur)) break;
        seen.add(cur);
      }
      const holders = Object.keys(world.entities).filter((who) => own(world.entities, who)?.relations.some((r) => r.type === MEMBER_OF && r.to === id && objOf(r.fields).position === p.id)).length + jobsAt(ctx, id).filter((job) => own(ctx.state.entities, job)?.fields.position === p.id).length;
      if (p.seats > 0 && holders > p.seats) out.push({ severity: "warning", code: ORG_LINT.seats, path: `entities.${id}.fields.positions`, message: `${org}'s ${p.title} has ${p.seats} seat${p.seats === 1 ? "" : "s"} and ${holders} holders.`, fix: setFix(`Give ${p.title} ${holders} seats`, ["entities", id, "fields", "positions", at, "seats"], holders) });
    }
  }
  return out;
}

/** Member links and jobs that name a position their organization doesn't define. */
function holderIssues(world: WorldDoc, ctx: ReadContext): LintIssue[] {
  const out: LintIssue[] = [];
  for (const id of Object.keys(world.entities).sort()) {
    const e = own(world.entities, id);
    if (!e) continue;
    e.relations.forEach((r, i) => {
      const position = objOf(r.fields).position;
      if (r.type !== MEMBER_OF || typeof position !== "string" || position === "") return;
      if (!positionsOf(ctx, r.to).some((p) => p.id === position)) out.push({ severity: "warning", code: ORG_LINT.positionUnknown, path: `entities.${id}.relations[${i}]`, message: `${e.name} holds "${position}" in ${nameOf(world, r.to)}, which defines no such position.`, fix: dropFix(`Take ${e.name} out of "${position}"`, ["entities", id, "relations", String(i), "fields", "position"]) });
    });
    const position = e.fields.position;
    if (!kindIs(ctx.registry, ctx.world, e.kind, "job") || typeof position !== "string" || position === "") continue;
    const employer = typeof e.fields.employer === "string" ? e.fields.employer : "";
    if (!positionsIn(own(world.entities, employer)?.fields.positions).some((p) => p.id === position)) out.push({ severity: "warning", code: ORG_LINT.jobPosition, path: `entities.${id}.fields.position`, message: `${e.name} is in the position "${position}", which ${own(world.entities, employer) ? nameOf(world, employer) : "its employer"} doesn't define.`, fix: dropFix(`Take the job out of "${position}"`, ["entities", id, "fields", "position"]) });
  }
  return out;
}

/** Authored delegations: powers there are none of, and powers their granter doesn't hold. */
function delegationIssues(world: WorldDoc, ctx: ReadContext): LintIssue[] {
  const out: LintIssue[] = [];
  for (const id of Object.keys(world.entities).sort()) {
    own(world.entities, id)?.relations.forEach((r, i) => {
      if (r.type !== ACTS_FOR) return;
      const f = objOf(r.fields);
      const path = `entities.${id}.relations[${i}]`;
      const powers = Array.isArray(f.powers) ? f.powers : [];
      const known = powers.filter(isOrgPower);
      for (const p of powers) if (!isOrgPower(p)) out.push({ severity: "error", code: ORG_LINT.powerUnknown, path, message: `${nameOf(world, id)} acts for ${nameOf(world, r.to)} with a power "${String(p)}" there is none of.`, fix: setFix("Take out the powers there are none of", ["entities", id, "relations", String(i), "fields", "powers"], known) });
      const by = typeof f.by === "string" ? f.by : "";
      if (by === "") return;
      const lacking = known.filter((p) => orgPower(ctx, by, r.to, p) === null);
      const kept = known.filter((p) => !lacking.includes(p));
      const fix = kept.length > 0 ? setFix(`Give only what ${nameOf(world, by)} may`, ["entities", id, "relations", String(i), "fields", "powers"], kept) : dropFix(`End the delegation: ${nameOf(world, by)} may give none of it`, ["entities", id, "relations", String(i)]);
      if (lacking.length > 0) out.push({ severity: "warning", code: ORG_LINT.delegateEscalation, path, message: `${nameOf(world, by)} lets ${nameOf(world, id)} ${lacking.map((p) => POWER_WORDS[p]).join(", ")} for ${nameOf(world, r.to)}, which ${nameOf(world, by)} may not do.`, fix });
    });
  }
  return out;
}

/** Owners rows whose units and share disagree: a company counting units keeps each row's share at its units over all of them. */
function unitIssues(world: WorldDoc): LintIssue[] {
  const out: LintIssue[] = [];
  for (const id of Object.keys(world.entities).sort()) {
    const raw = own(world.entities, id)?.fields.owners;
    const owners = ownersIn(own(world.entities, id)?.fields ?? {});
    if (!owners.some((o) => o.units !== undefined)) continue;
    const total = owners.reduce((a, o) => a + (o.units ?? 0), 0);
    const off = owners.filter((o) => o.units === undefined || total === 0 || o.share === undefined || Math.abs(o.share - ((o.units ?? 0) * 100) / total) > 0.01);
    // Each row's share set from its units, where every row counts them.
    const fix = total > 0 && Array.isArray(raw) && owners.every((o) => o.units !== undefined) ? setFix("Set each share from its units", ["entities", id, "fields", "owners"], raw.map((row) => (typeof objOf(row).units === "number" ? { ...objOf(row), share: Math.round(((objOf(row).units as number) * 10000) / total) / 100 } : row))) : undefined;
    if (off.length > 0) out.push({ severity: "error", code: ORG_LINT.unitsShare, path: `entities.${id}.fields.owners`, message: `${nameOf(world, id)}'s owners count units, but ${off.map((o) => nameOf(world, o.party)).join(", ")}'s share isn't their units over all ${total}.`, ...(fix ? { fix } : {}) });
  }
  return out;
}

/** The exempt status an entity's `tax_exempt` names in the world's exempt table (ORG-SPEC §3.11, Phase 5), its row; undefined for none or an unknown one. */
function exemptRow(world: WorldDoc, id: EntityId): Record<string, JsonValue> | undefined {
  const status = own(world.entities, id)?.fields.tax_exempt;
  return typeof status === "string" && status.trim() !== "" ? own(world.tables["economy.exempt"]?.rows ?? {}, status.trim()) : undefined;
}

/**
 * A pass-through company (any structure but a C corporation's) whose owners include an organization
 * that is neither a person nor a company (a household, a group, a trust, the party): its profit, and
 * what companies under it pass up, reaches that holder, and no one pays income tax on that share
 * (§3.11). A company holder passes it on up, or as a C corporation pays it, so it is told where it
 * holds; an exempt holder, or an exempt company, keeps it untaxed by its exemption (Phase 5).
 */
function untaxedIssues(world: WorldDoc, ctx: ReadContext): LintIssue[] {
  const out: LintIssue[] = [];
  for (const id of Object.keys(world.entities).sort()) {
    const e = own(world.entities, id);
    if (!e || orgTypeOf(ctx, id) !== "company" || e.fields.structure === "c_corp" || exemptRow(world, id)) continue;
    const untaxed = Object.entries(worthShares(ownersIn(e.fields))).filter(([holder, share]) => share > 0 && holder !== id && orgTypeOf(ctx, holder) !== null && orgTypeOf(ctx, holder) !== "company" && !exemptRow(world, holder));
    if (untaxed.length === 0) continue;
    const names = untaxed.map(([holder, share]) => `${nameOf(world, holder)} (${Math.round(share * 100) / 100}%)`);
    const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const one = names.length === 1;
    out.push({ severity: "warning", code: ORG_LINT.profitUntaxed, path: `entities.${id}.fields.owners`, message: `${e.name} passes its profit through to its owners, and ${who} ${one ? "pays" : "pay"} no income tax on ${one ? "its share" : "their shares"}, so no one does: only people and C corporations pay it.` });
  }
  return out;
}

/**
 * Exempt statuses (§3.11, Phase 5): one the world's exempt table doesn't hold (Fix: take it off), on a
 * household or the party, which can't be exempt (Fix: take it off), and on a company whose owners
 * hold shares of its worth, as an exempt organization pays no one its profit.
 */
function exemptIssues(world: WorldDoc, ctx: ReadContext): LintIssue[] {
  const out: LintIssue[] = [];
  const known = Object.keys(world.tables["economy.exempt"]?.rows ?? {});
  for (const id of Object.keys(world.entities).sort()) {
    const e = own(world.entities, id);
    const status = e?.fields.tax_exempt;
    if (!e || typeof status !== "string" || status.trim() === "") continue;
    const path = `entities.${id}.fields.tax_exempt`;
    const drop = dropFix("Take the status off", ["entities", id, "fields", "tax_exempt"]);
    const row = exemptRow(world, id);
    if (!row) {
      out.push({ severity: "error", code: ORG_LINT.exemptUnknown, path, message: `${e.name}'s tax-exempt status "${status}" isn't one of the world's (${known.length > 0 ? known.join(", ") : "its tables hold none: take the Data update"}).`, fix: drop });
      continue;
    }
    const type = orgTypeOf(ctx, id);
    if (type === "household" || type === "party") {
      out.push({ severity: "warning", code: ORG_LINT.exemptType, path, message: `${e.name} is a ${type}, which can't be exempt from income tax: only a company, a group or a trust can.`, fix: drop });
      continue;
    }
    const owners = type === "company" ? Object.entries(worthShares(ownersIn(e.fields))).filter(([holder, share]) => share > 0 && holder !== id) : [];
    if (owners.length > 0) out.push({ severity: "warning", code: ORG_LINT.exemptOwners, path: `entities.${id}.fields.owners`, message: `${e.name} is exempt as ${typeof row.name === "string" ? row.name : status}, but ${owners.map(([holder]) => nameOf(world, holder)).join(", ")} ${owners.length === 1 ? "holds a share" : "hold shares"} of its worth: an exempt organization pays no one its profit, and no one is taxed on it.` });
  }
  return out;
}

/** A `company` group with owners or staff, which a business would run; a household member titled "head" while no Head position is defined. */
function kindIssues(world: WorldDoc, ctx: ReadContext): LintIssue[] {
  const out: LintIssue[] = [];
  for (const id of Object.keys(world.entities).sort()) {
    const e = own(world.entities, id);
    if (!e) continue;
    const type = orgTypeOf(ctx, id);
    if (type === "group" && kindIs(ctx.registry, ctx.world, e.kind, "company") && (ownersIn(e.fields).length > 0 || jobsAt(ctx, id).length > 0)) out.push({ severity: "warning", code: ORG_LINT.companyGroup, path: `entities.${id}.kind`, message: `${e.name} is a company group with owners or staff: make it a business, so its money, payroll and ownership run.`, fix: setFix("Make it a business", ["entities", id, "kind"], "business") });
    if (type === "household" && !positionsOf(ctx, id).some((p) => p.id === HEAD)) {
      const head = headOf(ctx, id);
      const link = head === null ? -1 : (own(world.entities, head)?.relations.findIndex((r) => r.type === MEMBER_OF && r.to === id) ?? -1);
      const listed = Array.isArray(e.fields.positions);
      // The Head every household has, written out: every power, one seat, held by the member titled head, so nothing changes in play.
      const position = { id: HEAD, title: "Head", powers: [...ORG_POWERS], seats: 1 };
      const fix: LintFix | undefined =
        head !== null && link >= 0 ? { label: `Add a Head position, held by ${nameOf(world, head)}`, ops: [{ op: "add", path: pointerOf(listed ? ["entities", id, "fields", "positions", "-"] : ["entities", id, "fields", "positions"]), value: listed ? position : [position] }, { op: "add", path: pointerOf(["entities", head, "relations", String(link), "fields"]), value: { ...objOf(own(world.entities, head)?.relations[link]?.fields), position: HEAD } }] } : undefined;
      if (head !== null) out.push({ severity: "info", code: ORG_LINT.headTitle, path: `entities.${id}.fields.positions`, message: `${nameOf(world, head)} heads ${e.name} by the title "head"; a Head position would say what that lets them do.`, ...(fix ? { fix } : {}) });
    }
  }
  return out;
}

/**
 * A business trading at a place that takes in other buildings or sites (a whole town): a purchase is
 * its sale only within the same building or site as one of its places (`businessAt`), so its
 * author should name the buildings it trades in. Past sales stay as they were.
 */
function spanIssues(world: WorldDoc, ctx: ReadContext): LintIssue[] {
  const out: LintIssue[] = [];
  for (const id of Object.keys(world.entities).sort()) {
    if (orgTypeOf(ctx, id) !== "company") continue;
    for (const place of placesOf(ctx, id)) {
      const site = siteOf(world, place);
      const others = Object.keys(world.places).filter((p) => p !== place && placeWithin(world, p, place) && siteOf(world, p) !== site);
      if (others.length === 0) continue;
      const name = own(world.places, place)?.name ?? place;
      out.push({ severity: "warning", code: ORG_LINT.placeSpans, path: `entities.${id}.fields.places`, message: `${nameOf(world, id)} trades at ${name}, which takes in other buildings (${others.slice(0, 3).map((p) => own(world.places, p)?.name ?? p).join(", ")}${others.length > 3 ? ", …" : ""}): a purchase counts as its sale only in its own building or site. Name the buildings it trades in.` });
    }
  }
  return out;
}

/** The organizations' lint rules. */
export const ORG_LINTS: readonly LintRule[] = [
  {
    code: "orgs.positions",
    check(world, registry) {
      if (!registry) return [];
      const ctx = startOf(world, registry);
      return [...positionIssues(world, ctx), ...holderIssues(world, ctx)];
    },
  },
  { code: "orgs.delegations", check: (world, registry) => (registry ? delegationIssues(world, startOf(world, registry)) : []) },
  { code: "orgs.owners", check: (world, registry) => [...unitIssues(world), ...(registry ? untaxedIssues(world, startOf(world, registry)) : [])] },
  {
    code: "orgs.kinds",
    check(world, registry) {
      if (!registry) return [];
      const ctx = startOf(world, registry);
      return [...kindIssues(world, ctx), ...spanIssues(world, ctx)];
    },
  },
  { code: "orgs.taxes", check: (world, registry) => (registry ? exemptIssues(world, startOf(world, registry)) : []) },
];
