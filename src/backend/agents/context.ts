// What a role starts with besides its task (DESIGN §4.6, "A role's context"): the narrator's sections
// Settings → Agents → Context names for it, built by delivery's own builder (`buildSections`) from
// the head the role reads, with the scene role's lore and notes so far this turn, so a role sees a
// section as the narrator would get it now: its caps, its secrets marked as the narrator's knowledge
// says. Only the sections asked for are built (each other one is unplaced), so they share the section
// budget among themselves alone, and the Minds section keeps its own. Model-free.

import { buildSections } from "../sections-build";
import { sectionTokens } from "../book";
import { narratorView } from "../chat-knowledge-prefs";
import { markWording } from "../prompts";
import type { Runtime } from "../runtime";
import type { ChatHead } from "./tools/workspace";
import { loreReadable } from "../../engine/lore";
import { unrevealedSecrets } from "../../engine/visibility";
import type { ChatId, UserId } from "../../shared/ids";
import type { PromptTexts } from "../../shared/prompts";
import type { SceneOut } from "./turn-ctx";

/** The sections `slots` names, rendered whole in rank order and joined; "" when it names none, none holds anything, or there is no head yet. */
export async function roleSections(rt: Runtime, input: { userId: UserId; chatId: ChatId; head: ChatHead | null; slots: readonly string[]; scene: SceneOut | null; said: string; texts?: PromptTexts }): Promise<string> {
  const { head, slots } = input;
  if (slots.length === 0 || !head) return "";
  const settings = await rt.settings.get(input.userId);
  const world = await rt.readLore(input.chatId, input.userId, head.world);
  const { state } = head;
  const texts = input.texts ?? settings.prompts.texts;
  const chat = await rt.chatKnowledge.get(input.chatId, input.userId);
  // The scene role's lore as the brief may read it, then its notes, as delivery tells them in the Scene section.
  const lore = (input.scene?.lore ?? []).flatMap((id) => {
    const entry = world.lore[id];
    return entry && loreReadable(rt.registry, world, state, entry, "brief") ? [`${entry.title}: ${entry.content}`] : [];
  });
  const notes = input.scene?.notes ?? [];
  const built = buildSections({
    registry: rt.registry,
    world,
    state,
    secrets: unrevealedSecrets(rt.registry, world, state),
    budget: settings.modelUse.tokens.sections,
    mindsBudget: settings.minds.tokens,
    narrator: { chat: chat.narrator ?? null, view: narratorView(chat, world, settings) },
    wording: markWording(texts),
    texts,
    knowledge: settings.minds.knowledge,
    prices: settings.statePrices,
    said: input.said,
    planned: { outcome: [], montage: [], scene: lore, ...(notes.length > 0 ? { notes } : {}) },
    outline: [],
    elapsed: null,
    hasEntry: (section) => slots.includes(section.id),
    cost: sectionTokens,
    seen: () => {},
    warn: (message) => rt.host.log("warn", `[LumiRPEngine] a role's sections: ${message}`, input.userId),
  });
  return built.fills.map((f) => f.content).join("\n\n");
}
