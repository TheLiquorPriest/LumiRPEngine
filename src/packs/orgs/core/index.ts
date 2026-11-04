// The orgs pack (ORG-SPEC): organizations as the player's Orgs tab reads them. It declares the
// delegation link (`acts_for`, §3.5), the organizations' lint (§6.4) and the panels `orgs.list` (the
// home) and `orgs.org` (each organization's page), over the engine's model (`engine/org.ts`) and the
// sections other packs register (`r.orgSection`); GM → Orgs' read (`orgs.gm`, §6.1); an
// organization's own records (`packs.orgs`): its History (`orgs.log`) and what each person spent for
// it by month (`orgs.spent`), which other packs' acts for it write through `orgs.acted`; its own
// actions (`org_*`: members, positions, titles, delegation, renaming); the party's own actions and
// section (`party.ts`, §3.12); founding a company or a group (`found.ts`, §3.13); the agents' op and
// the reply's membership and employment channels (`ops.ts`, `story.ts`, §7.2-7.3); and its life (lane
// L, §3.14-3.15): succession (`seats.ts`), alerts, Coming up, People titles and minds' Your
// organizations (`feed.ts`), the Plan (`agenda.ts`, assess-party §6.2) and its follow-through off
// screen (`follow.ts`).

import type { JsonValue } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { ACTS_FOR, type OrgAct } from "../../../shared/org";
import { ORGS_LIST_PANEL, ORGS_ORG_PANEL, type OrgGmView } from "../../../shared/org-view";
import { strOf } from "../../../engine/pack-kit";
import type { PackDef, ReadContext } from "../../../engine/registry";
import { registerAccess } from "./access";
import { registerOrgActions } from "./actions";
import { registerFound } from "./found";
import { buildOrgsGm } from "./gm";
import { ORG_LINTS } from "./lint";
import { ORG_EVENTS, orgLog, orgsActed } from "./log";
import { registerFeed } from "./feed";
import { registerParty } from "./party";
import { registerPlan } from "./agenda";
import { registerFollow } from "./follow";
import { ORGS_CONFIG_EVENT, SEATS_PROCESS, SUCCESSION_EFFECT } from "./seats";
import { registerStory } from "./story";
import { buildOrgList, buildOrgPages } from "./view";

declare module "../../../engine/registry" {
  interface QueryMap {
    /** Every organization for the GM view (`core.gm`, GM → Orgs): its page as the GM sees it, and who holds each power there and why. */
    "orgs.gm": (ctx: ReadContext) => OrgGmView[];
  }
  interface ServiceMap {
    /** What an act for an organization records beside its effects, in their unit: a payment counted toward its payer's month (`orgs.spent`), and its History line (`orgs.log`). */
    "orgs.acted": (ctx: ReadContext, act: OrgAct) => LedgerEvent[];
  }
}

export const orgsPack: PackDef = {
  id: "orgs",
  label: "Organizations",
  version: 1,
  domain: null,
  requires: ["space", "economy", "relationships"],
  register(r) {
    // Someone acting for an organization (§3.5): the powers they hold by it, their limits, and who granted it; the link's `until` ends it.
    r.relation({
      id: ACTS_FOR,
      label: "Acts for",
      from: "*",
      to: "*",
      cardinality: "many_many",
      symmetric: false,
      fields: {
        powers: { type: "list", label: "Powers", of: "text" },
        payment: { type: "money", label: "Each payment at most", min: 0 },
        month: { type: "money", label: "Each month at most", min: 0 },
        accounts: { type: "list", label: "Only these accounts", of: "ref" },
        by: { type: "ref", label: "Granted by" },
      },
      pack: "orgs",
    });
    for (const rule of ORG_LINTS) r.lint(rule);
    for (const def of ORG_EVENTS) r.event(def);
    r.service("orgs.acted", orgsActed);
    // A History line the GM writes, beside a change made in GM → Orgs or by an agent's org op (§6.1, §7.2), with the people its words name (`names`), as `orgLog` keeps them.
    r.effect({ type: "orgs.note", args: ["org", "text", "by?", "names?"], gm: true, resolve: (a, ctx) => (strOf(a.org) !== "" && strOf(a.text) !== "" ? [orgLog(ctx, strOf(a.org), strOf(a.text), { ...(strOf(a.by) !== "" ? { by: strOf(a.by) } : {}), names: Array.isArray(a.names) ? a.names.filter((n): n is string => typeof n === "string" && n !== "") : [] })] : { code: "bad_args", reason: "a History line needs an organization and its words" }) });
    r.view({ panel: ORGS_LIST_PANEL, build: (ctx) => buildOrgList(ctx) as unknown as JsonValue });
    r.view({ panel: ORGS_ORG_PANEL, build: (ctx) => buildOrgPages(ctx) as unknown as JsonValue });
    r.query("orgs.gm", (ctx) => buildOrgsGm(ctx));
    registerOrgActions(r);
    registerParty(r);
    registerFound(r);
    // Entry to places, keys and trespass (ORG-SPEC §3.9), the Premises section and Change entry (lane X).
    registerAccess(r);
    // The agents' organization op (`orgs.op`) and the reply's membership and employment channels (lanes T and R).
    registerStory(r);
    // Succession each slot, this chat's own switch for it, alerts and Coming up, People titles, Your organizations, the Plan and its follow-through off screen (lane L).
    r.event(ORGS_CONFIG_EVENT);
    r.effect(SUCCESSION_EFFECT);
    r.process(SEATS_PROCESS);
    registerFeed(r);
    registerPlan(r);
    registerFollow(r);
  },
};

export default orgsPack;
