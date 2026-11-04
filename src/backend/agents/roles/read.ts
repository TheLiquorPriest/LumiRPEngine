// The read role, agent-backed (INC2-SPEC C9, AGENT-LOOP-PLAN §5): after the reply, the changes it
// states actually happened, and where it leaves the player character, read as classic's extract step
// reads them: the same world lists, change types, rules and state before, in the role's texts, with
// the engine's clock as the Scene tells it (when the player's message came, and now, after the
// minutes the turn's own actions took), which it measures narrated time against; the organization
// facts and their rules while one of their types is read, and the plans' open items while agenda
// is (ORG-SPEC §7.3). Its answer is classic's `ExtractRead`, by classic's own parser (enabled
// channels only, narrated time beyond what the turn applied, money in minor units, duplicates gone;
// on an agent chat with the Curator on, its changes of the Curator's types held aside for where the
// Curator's own work doesn't cover them), with the things its changes name that the world has no
// entity for (`untracked`), which its run reports; the engine then checks each proposal against the
// world and the player's settings, as it does classic's.

import { isRecord } from "../../../shared/json";
import { EXTRACT_ITEM_TEXT, EXTRACT_ORG_TEXT, ORG_FACT_TYPES, roleTaskTextId } from "../../../shared/role-prompts";
import { SIZES } from "../../../shared/things";
import { lifeStatesOf } from "../../../shared/world";
import { spanText } from "../../../engine/action-words";
import { own } from "../../../engine/pack-kit";
import { axesOf } from "../../../packs/relationships/core/index";
import { renderPrompt } from "../../prompts";
import type { Runtime } from "../../runtime";
import { type ExtractRead, extractAnswer, worldLists } from "../../steps";
import type { ExtractTask, TurnAgentCtx } from "../turn-ctx";
import { type RoleAnswer, runRoleAgent } from "./agent";

/** The reply's read as the read role's agent works it, with the tools of its families. */
export async function extractRun(rt: Runtime, task: ExtractTask, ctx: TurnAgentCtx): Promise<RoleAnswer<ExtractRead>> {
  const i = task.input;
  const ownTexts = ctx.texts ?? (await rt.settings.get(ctx.userId)).prompts.texts;
  const text = (part: string, vars: Readonly<Record<string, string>> = {}): string => renderPrompt(roleTaskTextId("read", "extract", part), ownTexts, vars);
  const moves = i.channels.length === 0 || i.channels.includes("location");
  const routines = moves && i.usual.length > 0;
  const lists = worldLists(i.world, i.places);
  const said = i.said.trim();
  const orgFacts = i.channels.length === 0 || ORG_FACT_TYPES.some((t) => i.channels.includes(t));
  return runRoleAgent(
    rt,
    ctx,
    {
      sub: "extract",
      phase: "read",
      names: { world: i.world.name, pov: own(i.world.entities, i.world.pov)?.name ?? i.world.pov },
      vars: {
        pov_id: i.world.pov,
        instructions: i.instructions ?? "",
        entities: lists.entities,
        places: lists.places,
        types: text("types", {
          axes: axesOf({ world: i.world })
            .map((a) => `${a.id} (${a.min}..${a.max})`)
            .join("|"),
          kinds: i.personKinds.length > 0 ? `; kind: ${i.personKinds.join("|")}` : "",
          life: lifeStatesOf(i.world)
            .map(([id]) => id)
            .join("|"),
          sizes: SIZES.join("|"),
          // The thing facts (ITEMS-SPEC §5.2), the registry text classic's extract step reads too.
          items: renderPrompt(EXTRACT_ITEM_TEXT.facts, ownTexts, {}),
          // The organization facts (ORG-SPEC §7.3), the registry text classic's extract step reads too.
          orgs: orgFacts ? ` · ${renderPrompt(EXTRACT_ORG_TEXT.facts, ownTexts, {})}` : "",
        }),
        enabled: i.channels.length > 0 ? text("enabled", { types: i.channels.join(", ") }) : "",
        currency: i.world.currency.code,
        symbol: i.world.currency.symbol,
        item_rules: renderPrompt(EXTRACT_ITEM_TEXT.rules, ownTexts, {}),
        org_rules: orgFacts ? renderPrompt(EXTRACT_ORG_TEXT.rules, ownTexts, {}) : "",
        where: moves ? text("where") : "",
        usual_rule: routines ? text("usual_rule") : "",
        state: JSON.stringify(i.prefix),
        clock: text("clock", { start: i.clock.start, now: i.clock.now, took: i.appliedMinutes > 0 ? spanText(i.appliedMinutes) : "no time" }),
        usual: routines ? text("usual", { lines: i.usual.join("\n") }) : "",
        plan: i.plan.length > 0 ? renderPrompt(EXTRACT_ORG_TEXT.plan, ownTexts, { lines: i.plan.join("\n") }) : "",
        message: said !== "" ? text("message", { text: said }) : "",
        reply: task.reply,
      },
      tools: task.world,
      // Classic's parser reads an answer that isn't one as no change; the role's contract is the proposals' list.
      check: (raw) => {
        if (!isRecord(raw) || !Array.isArray(raw.proposals)) return null;
        const read = extractAnswer(raw, { world: i.world, appliedMinutes: i.appliedMinutes, channels: i.channels, moves, held: i.held ?? [] });
        // A change to a thing the world has no entity for lands only as a Not tracked note: its run says so.
        const untracked = rt.untrackedThings(task.world, task.state, read.proposals);
        return untracked.length > 0 ? { ...read, untracked } : read;
      },
    },
  );
}
