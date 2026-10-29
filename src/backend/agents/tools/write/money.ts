// The money family's GM writes (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): money into or out of an account
// against the outside correction account, and the GM effects the world's packs offer, proposed as
// the GM editor's Adjust and Effect.

import { gmEdit, missing, needId, propose } from "../propose";
import type { ToolDefinition } from "../registry";
import { resolveEntity } from "../resolve";
import { argGiven, integer, intArg, jsonObject, needText, objectArg, objectSchema, text } from "../schema";

export const MONEY_WRITES: readonly ToolDefinition[] = [
  {
    name: "gm_adjust_money",
    family: "money",
    tier: "gm",
    parameters: () => objectSchema({ account: text(), cents: integer() }, ["account", "cents"]),
    async run(args, env) {
      const view = await env.reader.view();
      const account = needId(view, "gm_adjust_money", args, "account", resolveEntity);
      if (typeof account !== "string") return account;
      const cents = intArg(args, "cents");
      if (cents === null) return missing(view, "gm_adjust_money", "cents");
      return propose(view, env.writer, gmEdit({ op: "adjust", account, cents }));
    },
  },
  {
    name: "gm_effect",
    family: "money",
    tier: "gm",
    parameters: () => objectSchema({ effect: text(), args: jsonObject() }, ["effect"]),
    async run(args, env) {
      const view = await env.reader.view();
      const effect = needText(view, "gm_effect", args, "effect");
      if (typeof effect !== "string") return effect;
      const given = objectArg(args, "args");
      if (argGiven(args, "args") && given === null) return missing(view, "gm_effect", "args");
      return propose(view, env.writer, gmEdit({ op: "effect", effect, args: given ?? {} }));
    },
  },
];
