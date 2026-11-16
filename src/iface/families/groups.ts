// Groups (the skill `groups`): one change to an organization in today's vocabulary (`OrgOp`: a group
// founded, members admitted or removed, positions and titles, powers delegated, people hired, fired
// and paid, shares, dues, rules, votes, a group wound up or merged), as today's `gm_org` sends it,
// which the orgs pack compiles to the packs' own effects. Names in it are found as the call says
// them. A change that is so already (a member admitted twice) changes nothing and the answer says so.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { hasOwn, isRecord } from "../../shared/json";
import { isOrgPower, ORG_POWERS } from "../../shared/org";
import { ORG_OP_DOS, ORG_OP_SLOTS, type OrgOp, type OrgOpDo, parseOrgOp } from "../../shared/org-ops";
import { listingIn } from "../../shared/finance";
import { mayAct } from "../../engine/org";
import { own } from "../../engine/pack-kit";
import { buildOrgsGm } from "../../packs/orgs/core/gm";
import { jobOf, orgOpFindings } from "../../packs/orgs/core/ops";
import { OBJECT, oneOf, TEXT } from "../kit";
import { find, isUnread, named, notOneOf, type OpContext, type Unread } from "../ops";
import type { Want } from "../reading";
import { editChange, foundIn, isAlready, notApplicable, readTool, type WriteDef, writeTool } from "./run";
import { textOf } from "../texts";

const FAMILY = "groups";

/** What each kind of slot an organization's change names is found as. */
const SLOT_WANT: Readonly<Record<string, Want>> = { person: "person", place: "place", entity: "entity", org: "organization" };

/** The change with every name its op names found as its slot takes it (a proposal's change too); or what could not be read. */
function withIds(o: OpContext, change: JsonObject): JsonObject | Unread {
  const kind = change.do;
  if (typeof kind !== "string" || !hasOwn(ORG_OP_SLOTS, kind)) return notOneOf(o, "change.do", kind ?? null, ORG_OP_DOS);
  const out: JsonObject = { ...change };
  for (const [field, slot] of Object.entries(ORG_OP_SLOTS[kind as OrgOpDo])) {
    const v = change[field];
    if (slot === "entities") {
      if (!Array.isArray(v)) continue;
      const ids: JsonValue[] = [];
      for (const said of v) {
        const found = find(o, `change.${field}`, "entity", false, said);
        if (isUnread(found)) return found;
        ids.push(found.id);
      }
      out[field] = ids;
      continue;
    }
    if (typeof v !== "string" || v.trim() === "") continue;
    const found = field === "job" ? jobFound(o, `change.${field}`, v) : find(o, `change.${field}`, SLOT_WANT[field === "org" ? "org" : slot] ?? "entity", false, v);
    if (isUnread(found)) return found;
    out[field] = typeof found === "string" ? found : found.id;
  }
  if (kind === "propose" && isRecord(change.change)) {
    const inner = withIds(o, change.change as JsonObject);
    if (isUnread(inner)) return inner;
    out.change = inner;
  }
  return out;
}

/**
 * One change to an organization as the call gives it, every name found and the op's findings reported: what could not be read, when it
 * could not. A change that is so already changes nothing and the answer says so.
 */
export function orgChange(o: OpContext, raw: JsonValue | undefined): Unread | undefined {
  if (!isRecord(raw)) return changeTakes(o, raw ?? null, null);
  const change = withIds(o, raw as JsonObject);
  if (isUnread(change)) return change;
  const op = parseOrgOp(change);
  if (op === null) return changeTakes(o, raw as JsonObject, change);
  // What an op needs to read, said as the fields it takes: neither units nor a share, no way in or keys, no other party off a market.
  const lacks = lacksOf(o, op);
  if (lacks !== null) return lacks;
  const ctx = o.draft.w.ctx;
  const findings = orgOpFindings(ctx, op);
  const from = o.draft.w.events.length;
  const refused = editChange(o, { op: "org", change: op });
  if (refused !== null) {
    if (!isAlready(refused.code)) return notApplicable(o, refused.code);
    o.reply.line("already_so", { n: o.n, op: o.op, what: named(o.reading, typeof change.who === "string" ? change.who : typeof change.org === "string" ? change.org : o.op) });
  } else for (const f of findings) o.reply.report(f.code, { n: o.n, op: o.op, ...f.values });
  o.draft.record(o.n, o.op, "engine", o.prov, from);
  return undefined;
}

const org: WriteDef = {
  name: "gm_org",
  family: FAMILY,
  lane: "engine",
  properties: { change: { ...OBJECT, properties: { do: { type: "string", enum: [...ORG_OP_DOS] } }, required: ["do"] } },
  required: ["change"],
  example: { change: { do: "admit", org: "The Lamplighters", who: "tam", title: "Apprentice", why: "sworn in at the lamp-house" }, source: { from: "prose", message: "m-0401" } },
  run: (o) => orgChange(o, o.args.change),
};

/** A change that cannot be read: what a change is (its `do` and the fields that op names), and which of those were not given. */
function changeTakes(o: OpContext, value: JsonValue, change: JsonObject | null): Unread {
  const dos = textOf(ORG_OP_DOS);
  const kind = change !== null && typeof change.do === "string" && hasOwn(ORG_OP_SLOTS, change.do) ? (change.do as OrgOpDo) : null;
  if (kind === null || change === null) return { line: "org_change_takes", fields: { n: o.n, op: o.op, value: JSON.stringify(value), dos } };
  const slots = ORG_OP_SLOTS[kind];
  const takes = Object.entries(slots).map(([field, slot]) => `${field} (${o.call.lines.line(slot === "entities" ? "wants_list" : `want_${slot}`) ?? slot})`);
  const missing = Object.keys(slots).filter((field) => change[field] === undefined || change[field] === null || change[field] === "");
  return { line: "org_change_takes", fields: { n: o.n, op: o.op, value: JSON.stringify(value), dos, do: kind, takes: textOf(takes), missing: textOf(missing) } };
}

/** What an op cannot be read without, as the fields it takes: or null when it has them. */
function lacksOf(o: OpContext, op: OrgOp): Unread | null {
  const needs = (fields: readonly string[]): Unread => ({ line: "needs_any", fields: { n: o.n, op: o.op, fields: fields.map((f) => `change.${f}`) } });
  if (op.do === "entry" && op.entry === undefined && op.keys === undefined) return needs(["entry", "keys"]);
  if (op.do === "transfer" && op.units === undefined && op.pct === undefined) return needs(["units", "pct"]);
  if (op.do === "trade" && op.with === undefined && listingIn(own(o.draft.w.ctx.state.entities, op.org)?.fields ?? {}) === null) return { line: "needs", fields: { n: o.n, op: o.op, fields: ["change.with"] } };
  return null;
}

/** Each name of a job, found as one of the jobs there are; or the jobs, when it names none. */
function jobFound(o: OpContext, field: string, said: string): string | Unread {
  const ctx = o.draft.w.ctx;
  const jobs = Object.keys(ctx.state.entities).filter((id) => jobOf(ctx, id) !== null).sort();
  const key = said.trim().toLowerCase();
  const hit = jobs.find((id) => id.toLowerCase() === key || (own(ctx.state.entities, id)?.name ?? "").toLowerCase() === key);
  if (hit !== undefined) return hit;
  return { line: "unknown_job", fields: { n: o.n, op: o.op, field, name: said, jobs: textOf(jobs.map((id) => `${own(ctx.state.entities, id)?.name ?? id} [${id}]`)) } };
}

/** Who may use a power in an organization (today's `orgs_who_may`): every holder with the basis it rests on, as GM → Orgs lists them; or whether one person may. */
const whoMay = readTool({
  name: "orgs_who_may",
  family: FAMILY,
  properties: { org: TEXT, power: oneOf(ORG_POWERS), who: TEXT },
  required: ["org", "power"],
  example: { org: "The Lamplighters", power: "org.govern", who: "bram" },
  read(r, args, reply) {
    const group = foundIn(r, "org", args.org, "entity");
    if (isUnread(group)) return group;
    const power = String(args.power).trim().toLowerCase();
    if (!isOrgPower(power)) return { line: "unreadable", fields: { field: "power", value: JSON.stringify(args.power), choices: textOf(ORG_POWERS) } };
    const page = buildOrgsGm(r.ctx).find((g) => g.page.id === group.id);
    const holders = (page?.may ?? []).flatMap((m) => {
      const held = m.powers.find((p) => p.power === power);
      return held ? [{ who: `${r.nameOf(m.who.id)} [${m.who.id}]`, basis: held.basis }] : [];
    });
    const org = `${group.name} [${group.id}]`;
    if (args.who === undefined || args.who === null || args.who === "") {
      reply.data({ org, power, holders });
      return undefined;
    }
    const who = foundIn(r, "who", args.who, "person");
    if (isUnread(who)) return who;
    const may = mayAct(r.ctx, who.id, group.id, power);
    reply.data({ org, power, who: `${who.name} [${who.id}]`, may: may.ok, ...(may.ok ? { basis: may.grant.basis } : {}), holders });
    return undefined;
  },
});

/** The family's tools, as RPH's search finds them. */
export const GROUP_TOOLS = [writeTool(org), whoMay];
