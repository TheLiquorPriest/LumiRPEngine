// The money family's writes (AGENT-LOOP-PLAN §6; INC1-SPEC R3b): the GM's, money into or out of an
// account against the outside correction account, and the GM effects the world's packs offer,
// proposed as the GM editor's Adjust and Effect; and the story's own (ITEMS-SPEC §7.3), a purchase
// (`purchase`, story tier), which the Curator's call notes for the reply's read, checked by the
// economy's `purchase` channel and settled with the read's changes, the goods and the money as one.

import { SIZES } from "../../../../shared/things";
import { gmEdit, missing, needId, noteFact, NUMBER, propose } from "../propose";
import type { ToolDefinition } from "../registry";
import { resolveEntity, resolvePerson, resolvePlace } from "../resolve";
import { argGiven, badValue, integer, intArg, jsonObject, needText, objectArg, objectSchema, text, textArg } from "../schema";

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
  {
    // The goods side of a purchase the reply establishes (ITEMS-SPEC §6.3, §7.3): the economy's purchase channel, which moves a seller's own thing and posts the money as one change, and makes a new thing only when the seller holds none.
    name: "purchase",
    family: "money",
    tier: "story",
    notes: true,
    parameters: () => objectSchema({ item: text(), category: text(), payer: text(), qty: integer({ minimum: 1 }), price: NUMBER, method: text(), seller: text(), size: text([...SIZES]), at: text() }, ["item", "category"]),
    async run(args, env) {
      const view = await env.reader.view();
      const item = needText(view, "purchase", args, "item");
      if (typeof item !== "string") return item;
      const category = needText(view, "purchase", args, "category");
      if (typeof category !== "string") return category;
      const fact: Record<string, string | number> = { type: "purchase", item, category };
      for (const key of ["payer", "seller"] as const) {
        if (!argGiven(args, key)) continue;
        const id = needId(view, "purchase", args, key, key === "payer" ? resolvePerson : resolveEntity);
        if (typeof id !== "string") return id;
        fact[key] = id;
      }
      const qty = intArg(args, "qty");
      if (qty !== null) fact.qty = qty;
      if (typeof args.price === "number" && Number.isFinite(args.price)) fact.price = args.price;
      const method = textArg(args, "method");
      if (method !== null) fact.method = method;
      const size = textArg(args, "size");
      if (size !== null) {
        if (!SIZES.some((s) => s === size)) return badValue(view, "purchase", "size", size, SIZES);
        fact.size = size;
      }
      const at = textArg(args, "at");
      if (at !== null) {
        // Home, or a place the view may name.
        if (at.toLowerCase() === "home") fact.at = "home";
        else {
          const place = needId(view, "purchase", args, "at", resolvePlace);
          if (typeof place !== "string") return place;
          fact.at = place;
        }
      }
      return noteFact(view, env, fact);
    },
  },
];
