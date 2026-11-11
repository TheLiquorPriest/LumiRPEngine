// Arguments of the old engines' tools that sit below an argument's top level. Those engines' texts
// stop at the top: what lies under it (a vehicle's make, one spec's label, one domain's level) is
// told in the description above it, and goes out with none of its own. On the harness every
// argument a model is sent has a text of its own, at every depth, which the user may replace
// (Prompts → Harness engine). They are added for the harness alone (`tools/harness.ts`): the
// classic and agents engines send exactly what they sent.

import { toolArgTextId } from "./agent-tools";
import { HARNESS_GROUP, HARNESS_PAGE } from "./harness-text-kit";
import { DOMAIN_LABEL, DOMAINS } from "./ids";
import type { PromptDef } from "./prompts";

const SPEC_LABEL = "What the spec is of: Engine, Seats.";
const SPEC_VALUE = "What it is, as written: 5.0L V8, 5.";

/** Each such argument: the tool, its dotted path through nested objects and an array's items, and its description as shipped. */
export const NESTED_ARG_TEXTS: readonly { tool: string; path: string; text: string }[] = [
  ...DOMAINS.map((domain) => ({ tool: "gm_set_entity", path: `levels.${domain}`, text: `${DOMAIN_LABEL[domain]} for this one: 0 (off), 1 (narrative), 2 (simple), 3 (detailed) or 4 (simulation), or -1 to follow their tier.` })),
  { tool: "item_make", path: "details.make", text: "Who made it, as the reply names the maker." },
  { tool: "item_make", path: "details.model", text: "Its model, as the reply names it." },
  { tool: "item_make", path: "details.year", text: "The year it was made, a whole number." },
  { tool: "item_make", path: "details.colour", text: "Its colour." },
  { tool: "item_make", path: "details.plate", text: "Its plate or registration, as written." },
  { tool: "item_make", path: "details.specs", text: "What else the reply tells of it, each as a label and a value." },
  { tool: "item_make", path: "details.specs.label", text: SPEC_LABEL },
  { tool: "item_make", path: "details.specs.value", text: SPEC_VALUE },
  { tool: "item_label", path: "specs.label", text: SPEC_LABEL },
  { tool: "item_label", path: "specs.value", text: SPEC_VALUE },
];

/** Their registry texts, listed with the harness engine's tools. */
export const NESTED_ARG_PROMPTS: readonly PromptDef[] = NESTED_ARG_TEXTS.map(
  (a): PromptDef => ({
    id: toolArgTextId(a.tool, a.path),
    page: HARNESS_PAGE.id,
    group: HARNESS_GROUP.tools,
    label: `${a.tool}: ${a.path}`,
    note: `The description of ${a.tool}'s ${a.path} argument. Harness engine only: the classic and agents engines tell it in the description of the argument above it.`,
    text: a.text,
    vars: [],
  }),
);
