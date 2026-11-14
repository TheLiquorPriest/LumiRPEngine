// Groups (the skill `groups`): one change to an organization in today's vocabulary (`OrgOp`: a group
// founded, members admitted or removed, positions and titles, powers delegated, people hired, fired
// and paid, shares, dues, rules, votes, a group wound up or merged), as today's `gm_org` sends it,
// which the orgs pack compiles to the packs' own effects. Names in it are found as the call says
// them. A change that is so already (a member admitted twice) changes nothing and is reported.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { hasOwn, isRecord } from "../../shared/json";
import { isOrgPower, ORG_POWERS } from "../../shared/org";
import { ORG_OP_DOS, ORG_OP_SLOTS, type OrgOpDo, parseOrgOp } from "../../shared/org-ops";
import { mayAct } from "../../engine/org";
import { buildOrgsGm } from "../../packs/orgs/core/gm";
import { OBJECT, oneOf, TEXT } from "../kit";
import { find, isUnread, named, notOneOf, type OpContext, type Unread } from "../ops";
import type { Found, Reading, Want } from "../reading";
import { editChange, isAlready, notApplicable, readTool, type WriteDef, writeTool } from "./run";

const FAMILY = "groups";

/** What each kind of slot an organization's change names is found as. */
const SLOT_WANT: Readonly<Record<string, Want>> = { person: "person", place: "place", entity: "entity", org: "entity" };

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
    const found = find(o, `change.${field}`, SLOT_WANT[field === "org" ? "org" : slot] ?? "entity", false, v);
    if (isUnread(found)) return found;
    out[field] = found.id;
  }
  if (kind === "propose" && isRecord(change.change)) {
    const inner = withIds(o, change.change as JsonObject);
    if (isUnread(inner)) return inner;
    out.change = inner;
  }
  return out;
}

const org: WriteDef = {
  name: "gm_org",
  family: FAMILY,
  lane: "engine",
  properties: { change: { ...OBJECT, properties: { do: { type: "string", enum: [...ORG_OP_DOS] } }, required: ["do"] } },
  required: ["change"],
  example: { change: { do: "admit", org: "The Lamplighters", who: "tam", title: "Apprentice", why: "sworn in at the lamp-house" }, source: { from: "prose", message: "m-0401" } },
  run(o) {
    const raw = o.args.change;
    if (!isRecord(raw)) return notOneOf(o, "change", raw ?? null, []);
    const change = withIds(o, raw as JsonObject);
    if (isUnread(change)) return change;
    const op = parseOrgOp(change);
    if (op === null) return notOneOf(o, "change", raw as JsonObject, []);
    const from = o.draft.w.events.length;
    const refused = editChange(o, { op: "org", change: op });
    if (refused !== null) {
      if (!isAlready(refused.code)) return notApplicable(o, refused.code);
      o.reply.report("already_so", { n: o.n, op: o.op, what: named(o.reading, typeof change.who === "string" ? change.who : typeof change.org === "string" ? change.org : o.op) });
    }
    o.draft.record(o.n, o.op, "engine", o.prov, from);
    return undefined;
  },
};

/** A name a read's argument gives, found as wanted; or the line that says it is not there or fits several. */
function foundOr(r: Reading, field: string, said: JsonValue | undefined, want: Want): Found | Unread {
  if (typeof said !== "string" || said.trim() === "") return { line: "needs_field", fields: { field } };
  const f = r.find(said, want);
  if ("id" in f) return f;
  if (f.several.length > 0) return { line: "several", fields: { field, name: f.name, several: f.several.map((x) => `${x.name} [${x.id}]`) } };
  return { line: "unknown", fields: { field, name: f.name, wanted: want, near: f.near.map((x) => `${x.name} [${x.id}]`) } };
}

/** Who may use a power in an organization (today's `orgs_who_may`): every holder with the basis it rests on, as GM → Orgs lists them; or whether one person may. */
const whoMay = readTool({
  name: "orgs_who_may",
  family: FAMILY,
  properties: { org: TEXT, power: oneOf(ORG_POWERS), who: TEXT },
  required: ["org", "power"],
  example: { org: "The Lamplighters", power: "org.govern", who: "bram" },
  read(r, args, reply) {
    const group = foundOr(r, "org", args.org, "entity");
    if (isUnread(group)) return group;
    const power = String(args.power).trim().toLowerCase();
    if (!isOrgPower(power)) return { line: "unreadable", fields: { field: "power", value: JSON.stringify(args.power), choices: [...ORG_POWERS] } };
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
    const who = foundOr(r, "who", args.who, "person");
    if (isUnread(who)) return who;
    const may = mayAct(r.ctx, who.id, group.id, power);
    reply.data({ org, power, who: `${who.name} [${who.id}]`, may: may.ok, ...(may.ok ? { basis: may.grant.basis } : {}), holders });
    return undefined;
  },
});

/** The family's tools, as RPH's search finds them. */
export const GROUP_TOOLS = [writeTool(org), whoMay];
