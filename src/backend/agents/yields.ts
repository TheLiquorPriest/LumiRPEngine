// What a role's run left the engine, in words (DESIGN §4.6, "What a run gave"): the changes it
// staged, landing when the turn commits or held for the review card, and those it asked for that were
// refused, each with why; and what of its answer the engine didn't take, and why: the knowledge step's refusals, the
// read's proposals it didn't read and the things they name that the world has no entity for, the
// scene's lore the world doesn't have, the director's lines flagged (and kept) for contradicting the
// state it was given, or an answer that held nothing. Nothing a run answered drops silently: the main agent's
// run_role and revise answers carry these words, and Diagnostics and the host log carry the same, on
// either pipeline. Every reason is a registry text on the Main agent page (`shared/agent-yield.ts`),
// rendered in the user's own texts.

import { ROLE_LABEL, type RoleId } from "../../shared/agent-roles";
import { KNOWLEDGE_REFUSALS, PROSE_CLASHES, READ_DROPS, YIELD_TEXT } from "../../shared/agent-yield";
import type { DiagPhase } from "../../shared/diagnostics";
import type { MainRequestKind } from "../../shared/main-agent-prompts";
import { MINDS_EVENTS } from "../../shared/minds";
import type { PromptTexts } from "../../shared/prompts";
import type { DiagAt } from "../diagnostics";
import type { RunMindsResult } from "../minds";
import { renderPrompt } from "../prompts";
import type { Runtime } from "../runtime";
import type { ExtractRead } from "../steps";
import type { OpRefusal } from "./tools/writer";
import type { DirectorProse, SceneOut } from "./turn-ctx";
import type { StagedOp } from "./turn-writer";

/** What a run left the engine, in words: its changes (`writes`), and what of its answer the engine didn't take (`lost`); each empty when there is nothing to say. */
export interface RunYield {
  writes: string;
  lost: string;
}

/** A run's changes as the turn's draft holds them: those it staged that the turn hasn't committed, and those it asked for that were refused as they were staged. */
export interface RunWrites {
  staged: readonly StagedOp[];
  refused: readonly OpRefusal[];
}

/**
 * What a run of `kind` that answered `out` left the engine, with its changes (`writes`), in `texts`.
 * A refused change gives the writer's reason, everyone's with its secrets marked, whoever reads it.
 */
export function runYield(texts: PromptTexts, kind: MainRequestKind, out: unknown, writes: RunWrites): RunYield {
  const say = (id: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(id, texts, vars);
  const parts: string[] = [];
  const lands = writes.staged.filter((o) => o.mode !== "confirm").length;
  const held = writes.staged.length - lands;
  if (lands > 0) parts.push(say(YIELD_TEXT.staged, { count: String(lands) }));
  if (held > 0) parts.push(say(YIELD_TEXT.review, { count: String(held) }));
  if (writes.refused.length > 0) parts.push(say(YIELD_TEXT.refused, { count: String(writes.refused.length), reasons: [...new Set(writes.refused.map((r) => r.reason))].join("; ") }));
  const lost = lostOf(say, kind, out);
  return { writes: parts.length > 0 ? say(YIELD_TEXT.writes, { writes: parts.join("; ") }) : "", lost: lost.length > 0 ? say(YIELD_TEXT.lost, { lost: lost.join("; ") }) : "" };
}

/** A run's yield in Diagnostics and the host log, when it has anything to say: what the engine didn't take makes it a warning. */
export function recordYield(rt: Pick<Runtime, "diag" | "host">, at: DiagAt, phase: DiagPhase, role: RoleId, y: RunYield): void {
  const words = [y.writes, y.lost].filter((t) => t !== "").join(" ");
  if (words === "") return;
  rt.diag.yielded(at, phase, ROLE_LABEL[role], words, y.lost !== "");
  rt.host.log("info", `[LumiRPEngine] turn ${(at.turn ?? "").slice(0, 8)}: the ${ROLE_LABEL[role]} role's run: ${words}`, at.userId);
}

/** Where a phase's commit lands what its roles staged, as Diagnostics places it: the pre phase's inside the plan, the plan phase's with the prose, the post phase's in the read. */
const COMMIT_PHASE: Readonly<Record<StagedOp["phase"], DiagPhase>> = { pre: "plan", plan: "prose", post: "read" };

/**
 * What a phase's commit didn't land as its roles staged it, by role, in Diagnostics and the host log:
 * a change that no longer held there (refused), and one set aside for the review card that was staged
 * to land (its mode turned Confirm meanwhile). A change staged under Confirm went to the card as its
 * run said, so it isn't told again.
 */
export function recordCommit(rt: Pick<Runtime, "diag" | "host">, at: DiagAt, texts: PromptTexts, out: { confirm: readonly StagedOp[]; refused: readonly { op: StagedOp; refusal: OpRefusal }[] }): void {
  const say = (id: string, vars: Readonly<Record<string, string>>): string => renderPrompt(id, texts, vars);
  for (const { op, refusal } of out.refused) rt.host.log("info", `[LumiRPEngine] turn ${(at.turn ?? "").slice(0, 8)}: the ${ROLE_LABEL[op.role]} role's change ${op.key.slice(0, 12)} didn't land (${refusal.code}: ${refusal.reason})`, at.userId);
  const byRole = new Map<string, { op: StagedOp; held: number; refused: OpRefusal[] }>();
  const of = (op: StagedOp): { op: StagedOp; held: number; refused: OpRefusal[] } => {
    const key = `${op.role}:${op.phase}`;
    const r = byRole.get(key) ?? { op, held: 0, refused: [] };
    byRole.set(key, r);
    return r;
  };
  for (const o of out.confirm) if (o.mode !== "confirm") of(o).held++;
  for (const { op, refusal } of out.refused) of(op).refused.push(refusal);
  for (const { op, held, refused } of byRole.values()) {
    const parts = [...(held > 0 ? [say(YIELD_TEXT.review, { count: String(held) })] : []), ...(refused.length > 0 ? [say(YIELD_TEXT.refused, { count: String(refused.length), reasons: [...new Set(refused.map((r) => r.reason))].join("; ") })] : [])];
    rt.diag.yielded(at, COMMIT_PHASE[op.phase], ROLE_LABEL[op.role], say(YIELD_TEXT.writes, { writes: parts.join("; ") }), refused.length > 0);
  }
}

/** What of a run's answer the engine didn't take, each reason with how many; an answer that held nothing says so. A director's flagged line stays in the reply's prompt: it is told here with its words. */
function lostOf(say: (id: string, vars?: Readonly<Record<string, string>>) => string, kind: MainRequestKind, out: unknown): string[] {
  switch (kind) {
    case "knowledge": {
      const k = (out as RunMindsResult).knowledge;
      if (!k) return [say(YIELD_TEXT.knowledgeOff)];
      const lost = KNOWLEDGE_REFUSALS.flatMap((why) => {
        const n = k.refused?.[why] ?? 0;
        return n > 0 ? [say(YIELD_TEXT.knowledge(why), { count: String(n) })] : [];
      });
      if ((k.failed ?? 0) > 0) lost.push(say(YIELD_TEXT.knowledgeCalls, { count: String(k.failed) }));
      if (lost.length === 0 && k.events.length === 0 && k.proposals.length === 0) lost.push(say(YIELD_TEXT.knowledgeEmpty));
      return lost;
    }
    case "extract": {
      const read = out as ExtractRead;
      const dropped = read.dropped;
      const lost = READ_DROPS.flatMap((why) => {
        const n = dropped?.why[why] ?? 0;
        return n > 0 ? [say(YIELD_TEXT.read(why), { count: String(n), types: dropped?.types.join(", ") ?? "" })] : [];
      });
      const untracked = read.untracked ?? [];
      if (untracked.length > 0) lost.push(say(YIELD_TEXT.readUntracked, { count: String(untracked.length), things: [...new Set(untracked)].join(", ") }));
      if (lost.length === 0 && read.proposals.length === 0) lost.push(say(YIELD_TEXT.readEmpty));
      return lost;
    }
    case "prose": {
      const flagged = (out as DirectorProse).flagged ?? [];
      return PROSE_CLASHES.flatMap((why) => {
        const of = flagged.filter((f) => f.kind === why);
        return of.length > 0 ? [say(YIELD_TEXT.prose(why), { count: String(of.length), lines: `: ${of.map((f) => `"${f.line}"`).join("; ")}` })] : [];
      });
    }
    case "scene": {
      const unknown = (out as SceneOut).unknown ?? [];
      return unknown.length > 0 ? [say(YIELD_TEXT.sceneLore, { count: String(unknown.length), ids: unknown.join(", ") })] : [];
    }
    default:
      return [];
  }
}

/** The run's facts and learnings as the main agent sees a knowledge run's answer: the new facts they rest on, everyone else's learnings, and the player character's own changes. */
export function knowledgeAnswer(out: RunMindsResult): { facts: number; learnings: number; yours: number } {
  const k = out.knowledge;
  if (!k) return { facts: 0, learnings: 0, yours: 0 };
  const facts = new Set<string>();
  let learnings = 0;
  for (const e of k.events) {
    if (!("data" in e)) continue;
    const data = e.data as { fact?: { id?: unknown }; who?: unknown };
    if (e.type === MINDS_EVENTS.fact && typeof data.fact?.id === "string") facts.add(data.fact.id);
    if (e.type === MINDS_EVENTS.learn && Array.isArray(data.who)) learnings += data.who.length;
  }
  for (const p of k.proposals) for (const f of p.facts) facts.add(f.id);
  return { facts: facts.size, learnings, yours: k.proposals.length };
}
