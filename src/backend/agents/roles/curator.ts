// The Curator, agent-backed (ITEMS-SPEC §7, I9): after the read on an agent chat, it keeps the
// world's fabric true to the reply (its things, the places it makes, its walk-ons and a purchase's
// goods), working from the GM's view with every secret marked, the turn's own changes told in words
// so it never makes one twice, and the Place, Gear and People sections its context starts it with.
// Each change to a thing or a place is one tool call, checked and staged in the turn (its writer),
// committed after the read's in role order; a walk-on, a purchase and a place someone is put in are
// noted for the read's own path (`ReadNotes`), and so is a thing fact its answer gives for a change
// its tools couldn't make, each settled as the read's are. Its answer is classic's `ExtractRead`, by
// classic's own parser on the Curator's channels; prompt-only, it is classic's item read
// (`task.classic`: classic's extract on those channels alone), which the reconciler settles exactly
// as classic's.

import { isRecord, type JsonObject } from "../../../shared/json";
import { EXTRACT_ITEM_TEXT, roleTaskTextId } from "../../../shared/role-prompts";
import { own } from "../../../engine/pack-kit";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { type ExtractRead, extractAnswer } from "../../steps";
import type { ReadNotes } from "../tools/registry";
import type { CurateTask, TurnAgentCtx } from "../turn-ctx";
import { type RoleAnswer, runRoleAgent } from "./agent";

/** The reply's fabric as the Curator's agent works it, with the tools of its families. */
export async function curateRun(rt: Runtime, task: CurateTask, ctx: TurnAgentCtx): Promise<RoleAnswer<ExtractRead>> {
  const i = task.input;
  const texts = ctx.texts ?? (await rt.settings.get(ctx.userId)).prompts.texts;
  // What its tools noted for the read, each fact once, in the order noted.
  const noted = new Map<string, JsonObject>();
  const notes: ReadNotes = {
    add(fact) {
      const key = JSON.stringify(fact);
      if (noted.has(key)) return false;
      noted.set(key, fact);
      return true;
    },
  };
  const said = i.said.trim();
  return runRoleAgent(rt, ctx, {
    sub: "curate",
    purpose: "extract",
    phase: "read",
    names: { world: i.world.name, pov: own(i.world.entities, i.world.pov)?.name ?? i.world.pov },
    vars: {
      pov_id: i.world.pov,
      instructions: i.instructions ?? "",
      events: task.events.length > 0 ? task.events.join("\n") : "-",
      // The player's message as the read's task gives it: context, never a change of its own.
      message: said !== "" ? renderPrompt(roleTaskTextId("read", "extract", "message"), texts, { text: said }) : "",
      reply: task.reply,
    },
    answer: { part: "answer", vars: { facts: renderPrompt(EXTRACT_ITEM_TEXT.facts, texts, {}) } },
    tools: task.world,
    notes,
    check: (raw) => {
      if (!isRecord(raw) || !Array.isArray(raw.proposals)) return null;
      const read = extractAnswer(raw, { world: i.world, appliedMinutes: i.appliedMinutes, channels: i.channels, moves: false });
      return { ...read, proposals: [...noted.values(), ...read.proposals], where: null };
    },
  });
}
