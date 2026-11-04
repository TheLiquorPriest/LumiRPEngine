// The organizations family (ORG-SPEC §7.1): where someone belongs, one organization's page, and who
// may use a power there, read with the orgs pack's own readers. Secrecy is marks, never a filter
// (DESIGN §7.1): every view reads every member and every part whole, and only the player's own Orgs
// page counts the people they can't see (§3.16).
//
// - `orgs_list`: the organizations someone belongs to (the player character by default), each with
//   its type, their title and position there, the powers they hold and since when; under the GM's
//   view with no one named, every organization, with who runs it.
// - `orgs_read`: one organization's page (`orgs.org`), whole or one part of it (overview, people,
//   money, property, ownership, taxes, rules, log), as the GM's page reads it (every member named,
//   every section, its dues and its whole History), with the player character's own place there
//   (`you`); each person and place on it named as the view names them: marked as a secret, with who
//   knows it, where the view marks (the story view's, and a turn agent's GM view), and under the
//   GM's view each restricted person with their visibility.
// - `orgs_who_may`: whether someone may use a power there now, on what basis and within what
//   limits, or why not; with no one named, every holder with the chain of bases it rests on (GM →
//   Orgs' Who may…), each named as the view names them.

import { buildOrgsGm } from "../../../../packs/orgs/core/gm";
import { dateWords, partyIdOf, powersAt, rowsAt, buildOrgView } from "../../../../packs/orgs/core/view";
import { controlThrough, delegationsOf, heldPositions, HOW_WORDS, mayAct, orgTitle, orgTypeOf } from "../../../../engine/org";
import { own } from "../../../../engine/pack-kit";
import { isGone } from "../../../../engine/scope";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { EntityId } from "../../../../shared/ids";
import { isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import { isOrgPower, ORG_POWERS, POWER_WORDS, type OrgLimits, type OrgPower, type OrgType } from "../../../../shared/org";
import { ORG_PARTS, orgPart, type OrgPart, type OrgPersonView, type OrgView, type OrgYouView } from "../../../../shared/org-view";
import { formatMoney } from "../../../../shared/world";
import type { ToolOutcome } from "../../runtime";
import type { ToolReadView, ViewRef } from "../read-view";
import type { ToolDefinition } from "../registry";
import { type Resolved, resolvePerson } from "../resolve";
import { badValue, objectSchema, text, textArg } from "../schema";

const LIST = "orgs_list";
const READ = "orgs_read";
const WHO_MAY = "orgs_who_may";

/** Words for the party, before it has an entity of its own. */
const PARTY_WORDS: Readonly<Record<string, true>> = { party: true, "the party": true, "your party": true, "my party": true, "our party": true };

/** An organization as the view names it: the party before it has an entity, under the id it will take. */
function orgRef(view: ToolReadView, id: EntityId): ViewRef | null {
  const party = partyIdOf(view.ctx);
  if (!party.exists && id === party.id) return { id, name: "Your party" };
  return orgTypeOf(view.ctx, id) !== null ? view.entity(id) : null;
}

/** Every organization in the world, the party first (under the id it will take, before it has an entity), then by id. */
function everyOrg(view: ToolReadView): EntityId[] {
  const party = partyIdOf(view.ctx);
  const orgs = Object.keys(view.state.entities)
    .sort()
    .filter((id) => orgTypeOf(view.ctx, id) !== null && (view.knowledge === "gm" || !isGone(view.state, id)));
  return party.exists ? orgs : [party.id, ...orgs];
}

/** The organization an argument names: its id or its name, or the party in words ("your party"); the organizations' writes resolve with it too. */
export function resolveOrg(view: ToolReadView, said: string): Resolved {
  const t = said.trim();
  const party = partyIdOf(view.ctx);
  if (own(PARTY_WORDS, t.toLowerCase()) || t === party.id) return { id: party.id };
  const spaced = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
  const orgs = everyOrg(view).filter((id) => id !== party.id || party.exists);
  const byId = orgs.filter((id) => id === t || id.toLowerCase() === t.toLowerCase());
  const named = byId.length > 0 ? byId : orgs.filter((id) => spaced(own(view.state.entities, id)?.name ?? "") === spaced(t));
  const [one] = named;
  if (one !== undefined && named.length === 1 && orgRef(view, one)) return { id: one };
  if (named.length > 1) return { refused: view.refuse(TOOL_NOTE.ambiguous, { name: said, matches: named.map((id) => `${orgRef(view, id)?.name ?? id} (${id})`).join("; ") }) };
  return { refused: view.refuse(TOOL_NOTE.noOrg, { name: said }) };
}

/** The organization a tool's argument names, or the note why not. */
function needOrg(view: ToolReadView, tool: string, said: string | null): EntityId | ToolOutcome {
  if (said === null) return view.refuse(TOOL_NOTE.missing, { tool, arg: "org", text: view.text(`tool.${tool}.org`) });
  const r = resolveOrg(view, said);
  return "refused" in r ? r.refused : r.id;
}

/** Whoever an argument names (a person), else the player character when it is left out. */
function whoOf(view: ToolReadView, said: string | null): Resolved {
  return said === null ? { id: view.pov } : resolvePerson(view, said);
}

/** An organization one belongs to, as `orgs_list` gives it: what it is, their title and position there, the powers they hold and since when. */
interface Belonging extends ViewRef {
  type: OrgType;
  title: string;
  position: { id: string; title: string } | null;
  powers: { power: OrgPower; basis: string; words: string }[];
  since: string | null;
}

function belonging(view: ToolReadView, who: EntityId, org: EntityId, ref: ViewRef): Belonging | null {
  const ctx = view.ctx;
  const rows = rowsAt(ctx, org).filter((r) => r.who === who);
  if (rows.length === 0) return null;
  const type: OrgType = orgTypeOf(ctx, org) ?? "party";
  const held = type === "party" && orgTypeOf(ctx, org) === null ? undefined : heldPositions(ctx, who, org)[0];
  const since = held?.row.since ?? rows.find((r) => r.since !== undefined)?.since;
  const title = (orgTypeOf(ctx, org) !== null ? orgTitle(ctx, who, org) : null) ?? (rows.some((r) => r.how === "leader") ? "Leader" : HOW_WORDS[rows[0]?.how ?? "member"]);
  return {
    ...ref,
    type,
    title,
    position: held ? { id: held.position.id, title: held.position.title } : rows.some((r) => r.how === "leader") ? { id: "leader", title: "Leader" } : null,
    powers: powersAt(ctx, org, who).map(({ power, grant }) => ({ power, basis: grant.basis, words: POWER_WORDS[power] })),
    since: since === undefined ? null : dateWords(ctx, since),
  };
}

/**
 * `value`, read from the GM's data, as the view names what it holds: each person, thing and place
 * it names as a ref (`{id, name}`, or a name beside its id, as a payroll's `worker` and `workerId`)
 * named as the view names them, and every other text with each name of someone or somewhere
 * restricted in it marked so (a History line, a chain of bases); as it is under a view that marks
 * nothing. A secret is marked once: `value` must hold the GM's own words, never a view's marks.
 */
function named<T>(view: ToolReadView, value: T): T {
  if (!view.marked) return value;
  const nameOf = (id: string): string | null => (view.seesEntity(id) ? view.entity(id)?.name : view.seesPlace(id) ? view.place(id)?.name : undefined) ?? null;
  // Each restricted name as the view names it, the longest first, so a text's names are marked in one pass.
  const shown = new Map<string, string>();
  for (const id of Object.keys(view.state.entities)) {
    const name = own(view.state.entities, id)?.name ?? "";
    if (name !== "" && !shown.has(name) && view.entitySecrecy(id) !== null) shown.set(name, nameOf(id) ?? name);
  }
  for (const [id, place] of Object.entries(view.world.places)) if (place.name !== "" && !shown.has(place.name) && view.placeSecrecy(id) !== null) shown.set(place.name, nameOf(id) ?? place.name);
  const names = [...shown.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const words = names.length > 0 ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.join("|")})(?![\\p{L}\\p{N}])`, "gu") : null;
  const mark = (text: string): string => (words ? text.replace(words, (name) => shown.get(name) ?? name) : text);
  const walk = (v: JsonValue): JsonValue => {
    if (typeof v === "string") return mark(v);
    if (Array.isArray(v)) return v.map(walk);
    if (!isRecord(v)) return v;
    const out: JsonObject = {};
    for (const [k, x] of Object.entries(v)) {
      const id = k === "name" ? v.id : typeof v[`${k}Id`] === "string" ? v[`${k}Id`] : undefined;
      // A ref's name, or a name beside its id; ids as they are; anything else walked.
      out[k] = typeof x === "string" && typeof id === "string" ? (nameOf(id) ?? x) : k === "id" || k.endsWith("Id") ? x : walk(x);
    }
    return out;
  };
  return walk(value as unknown as JsonValue) as unknown as T;
}

/** The player character's own place there (Your place here), read from the whole page: their row, the holders of the position theirs reports to, their powers and the delegations they hold. */
function youOf(view: ToolReadView, page: OrgView): OrgYouView {
  const me = page.people.find((p) => p.id === view.pov);
  const reports = me?.position ? page.positions.find((p) => p.id === me.position?.id)?.reportsTo : null;
  const above = reports ? (page.positions.find((p) => p.id === reports.id)?.holders ?? []) : [];
  return {
    belongs: me !== undefined,
    title: me?.title ?? null,
    position: me?.position ?? null,
    since: me?.since ?? null,
    reportsTo: above.map((id) => ({ id, name: view.name(id) })),
    powers: powersAt(view.ctx, page.id, view.pov).map(({ power, grant }) => ({ power, basis: grant.basis, id: grant.id ?? null, words: POWER_WORDS[power] })),
    delegations: page.delegations.filter((d) => d.who.id === view.pov),
    through: controlThrough(view.ctx, view.pov, page.id).map((id) => ({ id, name: view.name(id) })),
  };
}

/** A person on a page: the player character's row is theirs (`you`), and under the GM's view a restricted one carries their visibility. */
function personShown(view: ToolReadView, p: OrgPersonView): OrgPersonView & { visibility?: string } {
  const visibility = view.knowledge === "gm" ? view.entity(p.id)?.visibility : undefined;
  return { ...p, you: p.id === view.pov, ...(visibility !== undefined ? { visibility } : {}) };
}

/** The page the view reads: the GM's whole page, with the player character's own place there, as the view names what it holds. */
function pageOf(view: ToolReadView, org: EntityId): OrgView | null {
  const page = buildOrgView(view.ctx, org, null);
  return page ? named(view, { ...page, you: youOf(view, page), people: page.people.map((p) => personShown(view, p)) }) : null;
}

/** An organization's dues as its rules give them: so much each, every period. */
function duesOf(view: ToolReadView, org: EntityId): string | null {
  const raw = own(view.state.entities, org)?.fields.dues;
  const d = Array.isArray(raw) ? raw[0] : raw;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const cents = (d as Record<string, JsonValue>).cents;
  const every = (d as Record<string, JsonValue>).every;
  return typeof cents === "number" && cents > 0 ? `${formatMoney(cents, view.world.currency)} a ${typeof every === "string" ? every : "month"} from each member` : null;
}

/** One part of a page (`orgPart`), a section it has none of reading null; its rules with its dues. */
function partOf(view: ToolReadView, page: OrgView, part: OrgPart): Record<string, unknown> {
  const out = orgPart(page, part);
  return part === "rules" ? { ...out, dues: duesOf(view, page.id) } : out;
}

/** A holder of a power as `orgs_who_may` answers: on what it rests, the chain in words, and its limits. */
interface Holder {
  who: ViewRef;
  basis: string;
  chain: string[];
  limits?: OrgLimits;
}

/** The limits the power `who` holds rests under: its position's, or its delegation's. */
function limitsOf(view: ToolReadView, who: EntityId, org: EntityId, power: OrgPower, basis: string, id: string | null): OrgLimits | undefined {
  if (orgTypeOf(view.ctx, org) === null) return undefined;
  if (basis === "position") return heldPositions(view.ctx, who, org).find((h) => h.position.id === id)?.position.limits;
  if (basis === "delegate") return delegationsOf(view.ctx, org).find((d) => d.who === who && d.powers.includes(power))?.limits;
  return undefined;
}

/** The organizations family, in the order of its texts (`shared/agent-tools-read.ts`). */
export const ORGS_TOOLS: readonly ToolDefinition[] = [
  {
    name: LIST,
    family: "orgs",
    tier: "read",
    parameters: () => objectSchema({ who: text() }),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = textArg(args, "who");
      return view.read(() => {
        // The GM's view with no one named: every organization, with who runs it and how many are in it.
        if (said === null && view.knowledge === "gm") {
          const orgs = everyOrg(view).flatMap((id) => {
            const ref = orgRef(view, id);
            const page = ref ? buildOrgView(view.ctx, id, null) : null;
            return ref && page ? [{ ...ref, type: page.type, kind: page.kind, runBy: page.runBy.map((r) => view.entity(r.id) ?? r), members: page.people.length }] : [];
          });
          return view.answer({ organizations: orgs });
        }
        const r = whoOf(view, said);
        if ("refused" in r) return r.refused;
        const who = view.entity(r.id);
        if (!who) return view.refuse(TOOL_NOTE.noPerson, { name: said ?? view.name(r.id) });
        const orgs = everyOrg(view).flatMap((id) => {
          const ref = orgRef(view, id);
          const row = ref ? belonging(view, r.id, id, ref) : null;
          return row ? [row] : [];
        });
        return view.answer({ who, organizations: orgs });
      });
    },
  },
  {
    name: READ,
    family: "orgs",
    tier: "read",
    parameters: () => objectSchema({ org: text(), part: text([...ORG_PARTS]) }, ["org"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      return view.read(() => {
        const org = needOrg(view, READ, textArg(args, "org"));
        if (typeof org !== "string") return org;
        const said = textArg(args, "part");
        const part = said === null ? null : ORG_PARTS.find((p) => p === said.toLowerCase());
        if (said !== null && part === undefined) return badValue(view, READ, "part", said, ORG_PARTS);
        const page = pageOf(view, org);
        const ref = orgRef(view, org);
        if (!page || !ref) return view.refuse(TOOL_NOTE.noOrg, { name: textArg(args, "org") ?? org });
        if (part === null || part === undefined) return view.answer({ org: ref, page });
        return view.answer({ org: ref, part, ...partOf(view, page, part) });
      });
    },
  },
  {
    name: WHO_MAY,
    family: "orgs",
    tier: "read",
    parameters: () => objectSchema({ org: text(), power: text([...ORG_POWERS]), who: text() }, ["org", "power"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      return view.read(() => {
        const org = needOrg(view, WHO_MAY, textArg(args, "org"));
        if (typeof org !== "string") return org;
        const ref = orgRef(view, org);
        if (!ref) return view.refuse(TOOL_NOTE.noOrg, { name: textArg(args, "org") ?? org });
        const said = textArg(args, "power");
        if (said === null) return view.refuse(TOOL_NOTE.missing, { tool: WHO_MAY, arg: "power", text: view.text(`tool.${WHO_MAY}.power`) });
        const power = said.trim().toLowerCase();
        if (!isOrgPower(power)) return badValue(view, WHO_MAY, "power", said, ORG_POWERS);
        const gm = buildOrgsGm(view.ctx).find((g) => g.page.id === org);
        const holders = (gm?.may ?? []).flatMap((m) => {
          const held = m.powers.find((p) => p.power === power);
          return held ? [{ who: m.who.id, basis: held.basis, chain: held.chain }] : [];
        });
        // Its words name the organization as the GM's data does: the answer is named as the view names it once, at the end.
        const orgName = orgTypeOf(view.ctx, org) === null ? ref.name : view.name(org);
        const whoSaid = textArg(args, "who");
        if (whoSaid !== null) {
          const r = resolvePerson(view, whoSaid);
          if ("refused" in r) return r.refused;
          const who = view.entity(r.id);
          if (!who) return view.refuse(TOOL_NOTE.noPerson, { name: whoSaid });
          // The party before it has an entity has no rules of its own to ask: its roster's powers answer.
          const may = orgTypeOf(view.ctx, org) !== null ? mayAct(view.ctx, r.id, org, power) : null;
          const held = holders.find((h) => h.who === r.id);
          if (may ? !may.ok : !held) return view.answer(named(view, { org: ref, power, words: POWER_WORDS[power], who, may: false, why: may && !may.ok ? may.reason : `${view.name(r.id)} may not ${POWER_WORDS[power]} for ${orgName}` }));
          const basis = may?.ok ? may.grant.basis : (held?.basis ?? "member");
          const limits = limitsOf(view, r.id, org, power, basis, may?.ok ? (may.grant.id ?? null) : null);
          return view.answer(named(view, { org: ref, power, words: POWER_WORDS[power], who, may: true, basis, chain: held?.chain ?? [], ...(limits ? { limits } : {}) }));
        }
        const shown = holders.flatMap((h): Holder[] => {
          const who = view.entity(h.who);
          const limits = limitsOf(view, h.who, org, power, h.basis, heldPositions(view.ctx, h.who, org).find((p) => p.position.powers.includes(power))?.position.id ?? null);
          return who ? [{ who, basis: h.basis, chain: h.chain, ...(limits ? { limits } : {}) }] : [];
        });
        return view.answer(named(view, { org: ref, power, words: POWER_WORDS[power], holders: shown }));
      });
    },
  },
];
