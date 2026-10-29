// The knowledge step's change types as proposal channels (DESIGN §24.11, C4), with their mode and
// learning in Settings → Changes from the reply as every type has: `learn`, a fact the player
// character learned, and `reveal`, a secret the story revealed to them, which opens it on the
// player's screens (`engine/visibility.ts`). A proposal carries its events whole
// (`KnowledgeProposal`): every fact it names that the turn's start didn't hold, and the learning, for
// the player character alone. The knowledge step checked it before proposing it (perception, the
// teller, the evidence: `backend/knowledge-step.ts`), so the channel checks only that it is what it
// says, and each event checks itself against the state it lands on (`minds.know`).

import type { JsonObject, JsonValue } from "../../../shared/json";
import { isRecord } from "../../../shared/json";
import type { LedgerEvent } from "../../../shared/ledger";
import { KNOWLEDGE_CHANGES, MINDS_EVENTS } from "../../../shared/minds";
import type { EffectDef, ProposalChannelDef, ReadContext, Rejection } from "../../../engine/registry";
import { isFact } from "./events";

/** Why a knowledge proposal isn't one, or null: its facts whole, and a learning for the player character alone. */
function knowledgeProblem(p: JsonObject, ctx: ReadContext): Rejection | null {
  const learn = p.learn;
  if (!Array.isArray(p.facts) || !p.facts.every((f) => isFact(f))) return { code: "bad_proposal", reason: "a knowledge change carries its facts whole" };
  if (!isRecord(learn) || typeof learn.fact !== "string" || !Array.isArray(learn.who) || learn.who.length !== 1 || learn.who[0] !== ctx.world.pov) return { code: "bad_proposal", reason: "a knowledge change is the player character's own learning" };
  return null;
}

/** `minds.know`: a knowledge change's events, the facts first, then the learning; each checks itself as it applies. */
export const knowEffect: EffectDef = {
  type: "minds.know",
  args: ["facts", "learn"],
  resolve: (a) => {
    if (!Array.isArray(a.facts) || !isRecord(a.learn)) return { code: "bad_effect", reason: "minds.know needs the facts and the learning" };
    const facts: LedgerEvent[] = a.facts.map((fact: JsonValue) => ({ type: MINDS_EVENTS.fact, data: { fact } }));
    return [...facts, { type: MINDS_EVENTS.learn, data: a.learn }];
  },
};

/** The `learn` and `reveal` channels. */
export const KNOWLEDGE_CHANNELS: readonly ProposalChannelDef[] = KNOWLEDGE_CHANGES.map((type) => ({
  type,
  boundField: "knowledge" as const,
  validate: knowledgeProblem,
  toEffects: (p) => [{ type: "minds.know", args: { facts: p.facts ?? [], learn: p.learn ?? null } }],
}));
