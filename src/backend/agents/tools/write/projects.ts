// Production projects' writes (DESIGN §26.5): the GM's `gm_project`, one change to a project in the
// org op's vocabulary (`{do: "project"}`: one started from a template or a planned one set going,
// paused, resumed, dropped, or a step set back or costing more), proposed as the GM edit `{op: "org",
// change}` the orgs pack compiles to the projects' own effects, each with its History line; and the
// story's `project_note` (story tier), a step set back up to 30 days or costing more up to the
// world's cap on unlisted prices as the reply tells it, noted for the reply's read and settled under
// its change type's mode with its receipt and Undo. No tool marks a step done: only its time does.

import { own, strOf } from "../../../../engine/pack-kit";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { JsonObject } from "../../../../shared/json";
import { PROJECT_KIND, PROJECT_NOTE } from "../../../../shared/projects";
import { projectTemplates } from "../../../../packs/economy/core/projects";
import { BOOLEAN, boolArg, gmEdit, missing, needId, noteFact, NUMBER, propose, refusedAnswer } from "../propose";
import type { ToolOutcome } from "../../runtime";
import type { ToolReadView } from "../read-view";
import { resolveOrg } from "../read/orgs";
import type { ToolDefinition } from "../registry";
import { type Resolved, resolveEntity } from "../resolve";
import { argGiven, badValue, integer, intArg, needText, objectSchema, text, textArg } from "../schema";

const TOOL = "gm_project";
const ACTS = ["start", "pause", "resume", "drop", "note"] as const;

/** A project by its id or its name, among the world's projects: a project and the thing it made may share a name, so only projects are looked at. */
export function resolveProject(view: ToolReadView, said: string): Resolved {
  const t = said.trim();
  const spaced = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
  const ids = Object.keys(view.state.entities)
    .filter((id) => own(view.state.entities, id)?.kind === PROJECT_KIND)
    .sort();
  const byId = ids.filter((id) => id === t || id.toLowerCase() === t.toLowerCase());
  const found = byId.length > 0 ? byId : ids.filter((id) => spaced(own(view.state.entities, id)?.name ?? "") === spaced(t));
  const [one] = found;
  if (one !== undefined && found.length === 1) return { id: one };
  if (found.length > 1) return { refused: view.refuse(TOOL_NOTE.ambiguous, { name: said, matches: found.map((id) => `${own(view.state.entities, id)?.name ?? id} (${id})`).join("; ") }) };
  return { refused: view.refuse(TOOL_NOTE.noThing, { name: said }) };
}

/** `gm_project`'s change as the org op `project` takes it, every name resolved, or the note why not. */
function changeOf(view: ToolReadView, args: JsonObject): JsonObject | ToolOutcome {
  const act = textArg(args, "act");
  if (act === null) return missing(view, TOOL, "act");
  if (!(ACTS as readonly string[]).includes(act)) return badValue(view, TOOL, "act", act, ACTS);
  const change: JsonObject = { do: "project", act };
  if (act === "start" && !argGiven(args, "project")) {
    const org = needId(view, TOOL, args, "org", resolveOrg);
    if (typeof org !== "string") return org;
    const template = needText(view, TOOL, args, "template");
    if (typeof template !== "string") return template;
    const rows = projectTemplates(view.ctx);
    if (!own(rows, template)) return badValue(view, TOOL, "template", template, Object.keys(rows).sort());
    change.org = org;
    change.template = template;
    const name = textArg(args, "name");
    if (name !== null) change.name = name;
    if (argGiven(args, "account")) {
      const account = needId(view, TOOL, args, "account", resolveEntity);
      if (typeof account !== "string") return account;
      change.account = account;
    }
  } else {
    const project = needId(view, TOOL, args, "project", resolveProject);
    if (typeof project !== "string") return project;
    change.project = project;
    change.org = strOf(own(view.state.entities, project)?.fields.org);
  }
  if (act === "note") {
    const step = textArg(args, "step");
    if (step !== null) change.step = step;
    for (const key of ["days", "cents"] as const) {
      const n = intArg(args, key);
      if (n !== null) change[key] = n;
    }
  }
  const why = textArg(args, "why");
  if (why !== null) change.why = why;
  return change;
}

/** Whether `changeOf` answered with its note rather than a change (a change always has its `do`). */
const isNote = (v: JsonObject | ToolOutcome): v is ToolOutcome => !("do" in v);

export const PROJECTS_WRITES: readonly ToolDefinition[] = [
  {
    name: TOOL,
    family: "orgs",
    tier: "gm",
    parameters: () => objectSchema({ act: text([...ACTS]), org: text(), template: text(), project: text(), name: text(), account: text(), step: text(), days: integer({ minimum: 0 }), cents: integer({ minimum: 0 }), why: text(), dry: BOOLEAN }, ["act"]),
    async run(args, env) {
      const view = await env.reader.view();
      const change = view.read(() => changeOf(view, args));
      if (isNote(change)) return change;
      const edit = gmEdit({ op: "org", change });
      if (boolArg(args, "dry") !== true || !env.writer) return propose(view, env.writer, edit);
      const out = await env.writer.dryRun(edit);
      if ("refused" in out) return refusedAnswer(out);
      return view.answer({ checked: { key: out.key, changeType: out.changeType, mode: out.mode, lines: out.lines } });
    },
  },
  {
    // A setback the reply tells (DESIGN §26.5): the projects' `project_note` channel checks it against the story's bounds, and it lands with the read's changes.
    name: PROJECT_NOTE,
    family: "orgs",
    tier: "story",
    notes: true,
    parameters: () => objectSchema({ project: text(), step: text(), days: integer({ minimum: 1, maximum: 30 }), amount: NUMBER, why: text() }, ["project", "why"]),
    async run(args, env) {
      const view = await env.reader.view();
      const project = needId(view, PROJECT_NOTE, args, "project", resolveProject);
      if (typeof project !== "string") return project;
      const why = needText(view, PROJECT_NOTE, args, "why");
      if (typeof why !== "string") return why;
      const fact: JsonObject = { type: PROJECT_NOTE, project, text: why };
      const step = textArg(args, "step");
      if (step !== null) fact.step = step;
      const days = intArg(args, "days");
      if (days !== null) fact.days = days;
      // A plain amount in the world's money, as the reply says it: minor units for the channel.
      if (typeof args.amount === "number" && Number.isFinite(args.amount)) fact.cents = Math.round(args.amount * 10 ** (view.world.currency?.decimals ?? 2));
      return noteFact(view, env, fact);
    },
  },
];
