// The revenue writes (DESIGN §26.2, Revenue streams), on a stream whose author opened it to the
// agents (`ai: bounded`): the GM's `gm_revenue`, an adjustment proposed as the GM effect
// `economy.revenue_adjust` (checked by its dry run with `dry`), and the story's `revenue_note`, what
// the reply says of a stream, quoted, noted for the reply's read as a `revenue` change, which asks
// first. Either way the engine holds it to its bounds: a factor of 0.25 to 4 or one period's
// amount, for up to 31 days, at most four at once, and what it brings from outside in a month at
// most the world's cap on unlisted prices.

import type { JsonObject } from "../../../../shared/json";
import { BOOLEAN, boolArg, gmEdit, needId, noteFact, NUMBER, propose, refusedAnswer } from "../propose";
import type { ToolDefinition } from "../registry";
import { resolveEntity } from "../resolve";
import { integer, intArg, needText, objectSchema, text } from "../schema";

const GM_TOOL = "gm_revenue";
const STORY_TOOL = "revenue_note";

/** The adjustment's amount and length as the tool was given them: a factor or minor units, and days. */
function amountArgs(args: JsonObject): JsonObject {
  const out: JsonObject = {};
  if (typeof args.factor === "number" && Number.isFinite(args.factor)) out.factor = args.factor;
  const cents = intArg(args, "cents");
  if (cents !== null) out.cents = cents;
  const days = intArg(args, "days");
  if (days !== null) out.days = days;
  return out;
}

export const REVENUE_WRITES: readonly ToolDefinition[] = [
  {
    name: GM_TOOL,
    family: "money",
    tier: "gm",
    parameters: () => objectSchema({ stream: text(), factor: NUMBER, cents: integer(), days: integer({ minimum: 1, maximum: 31 }), reason: text(), dry: BOOLEAN }, ["stream", "reason"]),
    async run(args, env) {
      const view = await env.reader.view();
      const stream = needId(view, GM_TOOL, args, "stream", resolveEntity);
      if (typeof stream !== "string") return stream;
      const reason = needText(view, GM_TOOL, args, "reason");
      if (typeof reason !== "string") return reason;
      const edit = gmEdit({ op: "effect", effect: "economy.revenue_adjust", args: { stream, reason, ...amountArgs(args) } });
      if (boolArg(args, "dry") !== true || !env.writer) return propose(view, env.writer, edit);
      const out = await env.writer.dryRun(edit);
      if ("refused" in out) return refusedAnswer(out);
      return view.answer({ checked: { key: out.key, changeType: out.changeType, mode: out.mode, lines: out.lines } });
    },
  },
  {
    name: STORY_TOOL,
    family: "money",
    tier: "story",
    notes: true,
    parameters: () => objectSchema({ stream: text(), factor: NUMBER, cents: integer(), days: integer({ minimum: 1, maximum: 31 }), said: text() }, ["stream", "said"]),
    async run(args, env) {
      const view = await env.reader.view();
      const stream = needId(view, STORY_TOOL, args, "stream", resolveEntity);
      if (typeof stream !== "string") return stream;
      const said = needText(view, STORY_TOOL, args, "said");
      if (typeof said !== "string") return said;
      return noteFact(view, env, { type: "revenue", stream, said, ...amountArgs(args) });
    },
  },
];
