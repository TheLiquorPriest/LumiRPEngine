// The output contract of each role's task (§16), by its id (`role.<role>.<task>`): the form of the
// answer its texts describe and classic's validator reads, which Test (R5's `testPrompt`) checks a
// role's answer against. The validators stay the engine's: a contract only says what form an answer
// must have for them to read it.

import { roleContractId, ROLE_TASKS } from "../../../shared/role-prompts";
import type { Schema } from "../../../shared/schema-check";
import type { PromptContract } from "../../prompts";

const STRINGS: Schema = { type: "array", items: { type: "string" } };
const OBJECTS: Schema = { type: "array", items: { type: "object" } };
const PROPOSALS: Schema = { type: "array", items: { type: "object", required: ["type"], properties: { type: { type: "string" } } } };
const ODDS: Schema = { type: "object", additionalProperties: { type: "number", minimum: 0 } };
/** The knowledge step's new facts (its answer's third version): each a claim saying why it matters and to whom, which the engine refuses a new fact without. */
const NEW_FACTS: Schema = { type: "array", items: { type: "object", required: ["claim", "matters"], properties: { ref: { type: "string" }, claim: { type: "string", minLength: 1 }, matters: { type: "string", minLength: 1 }, about: STRINGS } } };

const CONTRACTS: Readonly<Record<string, Schema>> = {
  [roleContractId("intent", "interpret")]: {
    type: "object",
    required: ["action", "params", "confidence"],
    properties: { action: { anyOf: [{ type: "string" }, { type: "null" }] }, params: { type: "object" }, text: { type: "string" }, thing: { type: "string" }, confidence: { type: "number", minimum: 0, maximum: 1 }, reason: { type: "string" }, more: OBJECTS, then: { type: "object" }, next: { type: "string" }, routine: OBJECTS },
  },
  [roleContractId("intent", "judge")]: { type: "object", required: ["rating", "reason"], properties: { rating: { type: "number", minimum: 0 }, reason: { type: "string" }, outcomes: ODDS } },
  [roleContractId("intent", "puzzle")]: { type: "object", required: ["correct"], properties: { correct: { type: "object", required: ["p"], properties: { p: { type: "number", minimum: 0, maximum: 1 } } } } },
  [roleContractId("scene", "scene")]: { type: "object", required: ["lore", "notes"], properties: { lore: STRINGS, notes: STRINGS } },
  [roleContractId("minds", "mind")]: { type: "object", required: ["monologue", "intent"], properties: { monologue: { type: "string" }, depiction: { type: "string" }, intent: { type: "string" }, mood: { type: "string" }, reactions: OBJECTS } },
  [roleContractId("knowledge", "knowledge")]: { type: "object", required: ["facts", "learned", "inferred", "doubted"], properties: { facts: NEW_FACTS, learned: OBJECTS, inferred: OBJECTS, doubted: OBJECTS } },
  [roleContractId("director", "decisions")]: { type: "object", additionalProperties: { type: "object", required: ["probabilities"], properties: { probabilities: ODDS } } },
  [roleContractId("director", "prose")]: { type: "object", properties: { brief: { type: "string" }, beats: STRINGS } },
  [roleContractId("director", "choices")]: { type: "object", required: ["choices"], properties: { choices: STRINGS } },
  [roleContractId("read", "extract")]: { type: "object", required: ["proposals"], properties: { proposals: PROPOSALS, where: { anyOf: [{ type: "string" }, { type: "null" }] } } },
  [roleContractId("memory", "memory")]: { type: "object", required: ["notes"], properties: { notes: OBJECTS, commitments: OBJECTS, resolved: { type: "array" }, plans: OBJECTS, told: OBJECTS, summary: { type: "string" } } },
  [roleContractId("memory", "consolidate")]: { type: "object", required: ["summary"], properties: { summary: { type: "string", minLength: 1 } } },
  [roleContractId("skip", "beats")]: { type: "object", required: ["beats"], properties: { beats: OBJECTS } },
  [roleContractId("skip", "plan")]: { type: "object", required: ["plans"], properties: { plans: OBJECTS } },
  [roleContractId("world", "effects")]: { type: "object", required: ["proposals"], properties: { proposals: PROPOSALS } },
};

// Every task of every role keeps a contract here: one missing would be a text Test can't check.
for (const [role, subs] of Object.entries(ROLE_TASKS)) for (const sub of subs) if (!CONTRACTS[roleContractId(role as keyof typeof ROLE_TASKS, sub)]) throw new Error(`the role task ${role}.${sub} has no output contract`);

/** The contract a role's task keeps, by its id; null for an id no role task has. */
export function roleContract(id: string): PromptContract | null {
  const schema = CONTRACTS[id];
  return schema ? { id, schema } : null;
}
