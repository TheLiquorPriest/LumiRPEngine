// An agent turn's narrator-facing outputs (AGENT-LOOP-PLAN §4; INC2-SPEC C11): what the turn tells
// its narrator besides the state, recorded as events in the engine pack among the turn's planned
// (`pre`) events, so a Re-narrate copies them with the rest of `pre` and tells exactly what the turn
// it re-narrates told, after a restart or a Branch too. Classic turns keep these lines outside the
// record (`backend/plan-notes.ts`); agent turns record them here instead.
//
// - `engine.out.lines {kind, lines}`: the Outcome lines, a timelapse's Montage, the Outline's beats
//   (the engine's, then the prose's), or the brief that leads the Outline.
// - `engine.out.scene {lore, notes, knowledge}`: the live lore ids the scene picked for the narrator,
//   its notes on the scene, and the knowledge it wrote them with (`AgentKnowledge`), which the
//   narrator's sections hold them to (`backend/sections-build.ts`); absent, everyone's.
//
// They fold into nothing that changes the world's state, so a classic turn after them, a replay and a
// chat switched back to classic read the world exactly as without them. How long each text may be is
// a setting (Settings → Agents → Recording), checked where the turn makes them, never here: a limit
// never changes how a past turn folds. Pure.

import { type AgentKnowledge, AGENT_KNOWLEDGE, isAgentKnowledge } from "../shared/agent-tools";
import { isRecord } from "../shared/json";
import type { LedgerEvent, PackEvent } from "../shared/ledger";
import type { EventTypeDef } from "./registry";

export const OUT_LINES = "engine.out.lines";
export const OUT_SCENE = "engine.out.scene";

/** Which narrator-facing lines an `engine.out.lines` event holds. */
export type OutputKind = "outcome" | "montage" | "outline" | "brief";
export const OUTPUT_KINDS: readonly OutputKind[] = ["outcome", "montage", "outline", "brief"];

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

export function outLines(kind: OutputKind, lines: readonly string[]): PackEvent {
  return { type: OUT_LINES, data: { kind, lines: [...lines] } };
}

export function outScene(lore: readonly string[], notes: readonly string[], knowledge: AgentKnowledge): PackEvent {
  return { type: OUT_SCENE, data: { lore: [...lore], notes: [...notes], knowledge } };
}

/** `engine.out.lines`: lines the turn tells its narrator; nothing in the world changes. */
export const outLinesEvent: EventTypeDef<PackEvent> = {
  type: OUT_LINES,
  validate: (e) => {
    if (typeof e.data.kind !== "string" || !(OUTPUT_KINDS as readonly string[]).includes(e.data.kind)) return { code: "bad_event", reason: "an output's lines are the outcome, the montage, the outline or the brief" };
    return strings(e.data.lines) ? null : { code: "bad_event", reason: "an output's lines are texts" };
  },
  apply: () => undefined,
  // The narrator's own input, not a fact of the story: the player's Journal has no line for it.
  describe: (e, _ctx, viewer) => (viewer !== undefined ? "" : `${String(e.data.kind)} lines told to the narrator`),
};

/** `engine.out.scene`: the lore and notes the scene gives its narrator; nothing in the world changes. */
export const outSceneEvent: EventTypeDef<PackEvent> = {
  type: OUT_SCENE,
  validate: (e) => (strings(e.data.lore) && strings(e.data.notes) && (e.data.knowledge === undefined || isAgentKnowledge(e.data.knowledge)) ? null : { code: "bad_event", reason: "a scene's lore is entry ids, its notes are texts, and its knowledge is pov, everyone or gm" }),
  apply: () => undefined,
  describe: (_e, _ctx, viewer) => (viewer !== undefined ? "" : "the scene's lore and notes told to the narrator"),
};

/** What a turn's planned events tell its narrator, when they are an agent turn's: each kind's lines, and the scene's lore and notes, with the widest knowledge its notes were written with; null when they hold no output event, as a classic turn's never do. */
export interface TurnOutputs {
  outcome: string[];
  montage: string[];
  outline: string[];
  brief: string | null;
  scene: { lore: string[]; notes: string[]; knowledge: AgentKnowledge };
}

export function outputsOf(events: readonly LedgerEvent[]): TurnOutputs | null {
  let out: TurnOutputs | null = null;
  for (const e of events) {
    if ((e.type !== OUT_LINES && e.type !== OUT_SCENE) || !("data" in e) || !isRecord(e.data)) continue;
    out ??= { outcome: [], montage: [], outline: [], brief: null, scene: { lore: [], notes: [], knowledge: "pov" } };
    if (e.type === OUT_SCENE) {
      if (strings(e.data.lore)) out.scene.lore.push(...e.data.lore);
      if (strings(e.data.notes)) out.scene.notes.push(...e.data.notes);
      const knowledge = isAgentKnowledge(e.data.knowledge) ? e.data.knowledge : "everyone";
      if (AGENT_KNOWLEDGE.indexOf(knowledge) > AGENT_KNOWLEDGE.indexOf(out.scene.knowledge)) out.scene.knowledge = knowledge;
      continue;
    }
    if (!strings(e.data.lines)) continue;
    if (e.data.kind === "brief") out.brief = e.data.lines.join(" ").trim() || null;
    else if (e.data.kind === "outcome" || e.data.kind === "montage" || e.data.kind === "outline") out[e.data.kind].push(...e.data.lines);
  }
  return out;
}
