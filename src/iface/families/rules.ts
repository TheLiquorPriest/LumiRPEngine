// Setting a chat up for a tabletop rule set, and growing its data in play (the skill `ruleset-and-sheets`; RULESET-DESIGN §5.2): `rules_apply`
// puts a shipped rule set on this chat's world as the world's next revision this chat is moved to, and `rules_add` adds or changes a row of
// one of the rules' tables the same way. The work is `src/worlds/rules.ts`, which the World page's press shares; each answers in the lines
// of the answers' file named `rules_<code>`. The writes are the engine lane's, so the user's setting for that lane asks first.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import { RulesRefused, addRow, applyRules, type RulesDeps } from "../../worlds/rules";
import { type Call, OBJECT, type Reply, TEXT, TEXTS, type ToolSpec } from "../kit";
import { textArg } from "../ops";
import { refused } from "./world";

const FAMILY = "rules";

const FLAG: JsonObject = { type: "boolean" };

/** What a call works with, or the line that says it cannot (the world service is not reached from this run). */
function depsOf(call: Call, reply: Reply): RulesDeps | null {
  const worlds = call.deps.worlds;
  if (worlds === undefined) {
    reply.line("worlds_none", { tool: call.tool }).fail();
    return null;
  }
  return { worlds, s: call.deps.store, registry: call.deps.env.registry, writes: call.deps.writes, user: call.scope.user, chat: call.scope.chat };
}

/** Runs a call, what it could not do told as the line it names and a refusal of the world's own as the world tools tell it. */
async function guarded(call: Call, run: (reply: Reply, deps: RulesDeps) => Promise<Reply>): Promise<Reply> {
  const reply = call.reply();
  const deps = depsOf(call, reply);
  if (deps === null) return reply;
  try {
    return await run(reply, deps);
  } catch (error) {
    if (error instanceof RulesRefused) {
      reply.line(`rules_${error.code}`, error.fields).fail();
      const problems = error.fields.problems;
      if (Array.isArray(problems)) for (const p of problems) if (isRecord(p) && typeof p.line === "string" && isRecord(p.fields)) reply.line(p.line, p.fields as Record<string, JsonValue>);
      return reply;
    }
    return refused(call, reply, error);
  }
}

const apply: ToolSpec = {
  name: "rules_apply",
  family: FAMILY,
  tier: "write",
  lane: "engine",
  properties: { rules: TEXT, take: TEXTS, preview: FLAG },
  required: ["rules"],
  example: { rules: "srd35" },
  run: (args, call) =>
    guarded(call, async (reply, deps) => {
      const rules = textArg(args, "rules");
      if (rules === undefined) return reply.line("needs_field", { field: "rules" }).fail();
      const take = Array.isArray(args.take) ? args.take.filter((t): t is string => typeof t === "string") : [];
      const made = await applyRules(deps, { rules, take, preview: args.preview === true });
      const labels = (items: readonly { label: string }[]): string => items.map((i) => i.label).join(", ");
      if (made.preview) reply.line("rules_plan", { rules: made.rules.label, added: made.added.length, same: made.same, kept: made.kept.length, taken: made.taken.length });
      else if (made.revision !== null) reply.line("rules_done", { rules: made.rules.label, revision: made.revision, added: made.added.length, taken: made.taken.length });
      else reply.line("rules_already", { rules: made.rules.label });
      if (made.kept.length > 0) reply.line("rules_kept", { n: made.kept.length, one: made.kept.length === 1, labels: labels(made.kept) });
      if (made.level !== null) reply.line("rules_on", {});
      if (!made.preview && made.noSheet.count > 0) reply.line("rules_no_sheet", { count: made.noSheet.count, one: made.noSheet.count === 1, names: made.noSheet.names.join(", "), more: made.noSheet.count - made.noSheet.names.length });
      return reply.data({ rules: made.rules.id, added: made.added, kept: made.kept, taken: made.taken, same: made.same, revision: made.revision, undo: made.edit, noSheet: made.noSheet } as unknown as JsonValue);
    }),
};

const add: ToolSpec = {
  name: "rules_add",
  family: FAMILY,
  tier: "write",
  lane: "engine",
  properties: { table: TEXT, id: TEXT, row: OBJECT },
  required: ["table", "id", "row"],
  example: { table: "trait", id: "power_attack", row: { label: "Power Attack", kind: "feat", text: "Take a penalty to hit, add it to damage." } },
  run: (args, call) =>
    guarded(call, async (reply, deps) => {
      const table = textArg(args, "table");
      const id = textArg(args, "id");
      if (table === undefined || id === undefined) return reply.line("needs_field", { field: table === undefined ? "table" : "id" }).fail();
      if (!isRecord(args.row) || Array.isArray(args.row)) return reply.line("needs_field", { field: "row" }).fail();
      const made = await addRow(deps, { table, id, row: args.row as JsonObject });
      if (made.same) reply.line("rules_row_same", { id: made.id, table: made.table });
      else reply.line(made.replaced ? "rules_row_changed" : "rules_row_added", { id: made.id, table: made.table, revision: made.revision ?? "" });
      return reply.data({ table: made.table, id: made.id, role: made.role, replaced: made.replaced, revision: made.revision, undo: made.edit });
    }),
};

export const RULES_TOOLS: readonly ToolSpec[] = [apply, add];
