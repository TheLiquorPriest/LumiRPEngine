// The organizations family's write (ORG-SPEC §7.2): `gm_org`, one change to an organization in the
// org op's vocabulary (`OrgOp`, `shared/org-ops.ts`), sent as the GM edit `{op: "org", change}` the
// orgs pack compiles to the packs' own effects, its History line with them (`packs/orgs/core/ops.ts`).
// GM tier. Each id the op names may be written as a name, resolved among what the view may name
// (`ORG_OP_SLOTS`: a person, an organization, any entity, a place; a proposal's decision's too); the
// op is then read for its shape, checked by the writer's dry run, and proposed outside a turn or
// staged in one (`propose`); with `dry` set it is only checked.

import { own } from "../../../../engine/pack-kit";
import { WRITE_NOTE } from "../../../../shared/agent-tools-write";
import { hasOwn, isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import { ORG_OP_SLOTS, parseOrgOp, type OrgOpDo } from "../../../../shared/org-ops";
import type { ToolOutcome } from "../../runtime";
import { BOOLEAN, boolArg, gmEdit, missing, needId, propose, refusedAnswer } from "../propose";
import type { ToolReadView } from "../read-view";
import { resolveOrg } from "../read/orgs";
import type { ToolDefinition } from "../registry";
import { type Resolved, resolveEntity, resolvePerson, resolvePlace } from "../resolve";
import { jsonObject, objectArg, objectSchema } from "../schema";

const TOOL = "gm_org";

/** The fields that name an organization, which the party in words ("your party") and an organization's name resolve. */
const ORG_FIELDS: Readonly<Record<string, true>> = { org: true };

/** Whether a read argument came back as its note. */
const isNote = (v: unknown): v is ToolOutcome => typeof v === "object" && v !== null && "text" in v && !Array.isArray(v);

/** One name resolved for a slot: an organization's field among the organizations, else as its slot takes it. */
function slotResolve(field: string, slot: string): (view: ToolReadView, said: string) => Resolved {
  if (own(ORG_FIELDS, field)) return resolveOrg;
  return slot === "person" ? resolvePerson : slot === "place" ? resolvePlace : resolveEntity;
}

/** The change with every id its op names resolved from the name the model wrote (a proposal's decision's as well), or the note why not (not found, several). */
function resolved(view: ToolReadView, change: JsonObject): JsonObject | ToolOutcome {
  const slots = typeof change.do === "string" && hasOwn(ORG_OP_SLOTS, change.do) ? ORG_OP_SLOTS[change.do as OrgOpDo] : null;
  if (!slots) return view.refuse(WRITE_NOTE.badOp);
  const out: JsonObject = { ...change };
  for (const [field, slot] of Object.entries(slots)) {
    const v = change[field];
    if (slot === "entities") {
      if (!Array.isArray(v)) continue;
      const ids: JsonValue[] = [];
      for (const said of v) {
        if (typeof said !== "string") return view.refuse(WRITE_NOTE.badOp);
        const id = needId(view, TOOL, { [field]: said }, field, resolveEntity);
        if (typeof id !== "string") return id;
        ids.push(id);
      }
      out[field] = ids;
      continue;
    }
    if (typeof v !== "string" || v.trim() === "") continue;
    const id = needId(view, TOOL, { [field]: v }, field, slotResolve(field, slot));
    if (typeof id !== "string") return id;
    out[field] = id;
  }
  if (change.do === "propose" && isRecord(change.change)) {
    const inner = resolved(view, change.change);
    if (isNote(inner)) return inner;
    out.change = inner;
  }
  return out;
}

export const ORGS_WRITES: readonly ToolDefinition[] = [
  {
    name: TOOL,
    family: "orgs",
    tier: "gm",
    parameters: () => objectSchema({ change: jsonObject(), dry: BOOLEAN }, ["change"]),
    async run(args, env) {
      const view = await env.reader.view();
      const raw = objectArg(args, "change");
      if (raw === null) return missing(view, TOOL, "change");
      const change = view.read(() => resolved(view, raw));
      if (isNote(change)) return change;
      const op = parseOrgOp(change);
      if (!op) return view.refuse(WRITE_NOTE.badOp);
      const edit = gmEdit({ op: "org", change: op as unknown as JsonObject });
      if (boolArg(args, "dry") !== true || !env.writer) return propose(view, env.writer, edit);
      const out = await env.writer.dryRun(edit);
      if ("refused" in out) return refusedAnswer(out);
      return view.answer({ checked: { key: out.key, changeType: out.changeType, mode: out.mode, lines: out.lines } });
    },
  },
];
