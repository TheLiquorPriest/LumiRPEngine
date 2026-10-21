// Port Alder chats with character minds, for the tests of what a mind reads (DESIGN §24.5): a fake
// helper that answers every mind and memory and keeps what each was given, a chat with the people
// asked for Live beside the player character, and a story whose memories leave a note, a commitment,
// a plan, a summary and something another character told them.

import type { QuietRequest } from "../../src/backend/host";
import { toChain } from "../../src/backend/ledger-io";
import type { JsonObject } from "../../src/shared/json";
import type { WorldDoc } from "../../src/shared/world";
import { placeOfEntity } from "../../src/engine/scope";
import type { WorldState } from "../../src/engine/state";
import type { Rig } from "./rig";

export const DANNY = "danny_okafor";
export const PRIYA = "priya_nair";
export const MARCUS = "marcus_delgado";
const MIND = /You are the private mind of (.+?) in the roleplay world/;
const MEMORY = /You keep the memory of (.+?) in the roleplay world/;

/** What each mind and each memory call was given, by name, in the order asked. */
export interface Seen {
  minds: { name: string; context: string }[];
  memories: { name: string; context: string }[];
}

/** Minds answer plainly; a memory answers as `memory` says for its character, else with nothing; every other step says nothing. */
export function fakeModels(rig: Rig, memory: (name: string) => JsonObject = () => ({})): Seen {
  const seen: Seen = { minds: [], memories: [] };
  rig.host.quietReply = (req: QuietRequest) => {
    const system = req.messages[0]?.content ?? "";
    const context = req.messages[1]?.content ?? "";
    const mind = MIND.exec(system)?.[1];
    if (mind) {
      seen.minds.push({ name: mind, context });
      return JSON.stringify({ monologue: `THOUGHT-MARK of ${mind}.`, depiction: `${mind} looks up`, intent: "Wait and see.", reactions: [], mood: "calm" });
    }
    const remembers = MEMORY.exec(system)?.[1];
    if (remembers) {
      seen.memories.push({ name: remembers, context });
      return JSON.stringify({ notes: [], commitments: [], resolved: [], plans: [], told: [], ...memory(remembers) });
    }
    if (system.includes("You map a player's typed input")) return JSON.stringify({ action: null, params: {}, confidence: 0.9 });
    return JSON.stringify({ proposals: [] });
  };
  return seen;
}

/** The latest context `name` was given in `list`, or "". */
export function lastFor(list: readonly { name: string; context: string }[], name: string): string {
  return list.findLast((c) => c.name === name)?.context ?? "";
}

export async function stateOf(rig: Rig, chatId: string): Promise<{ state: WorldState; world: WorldDoc }> {
  const core = await rig.rt.ledger.core(chatId, rig.host.userId);
  if (!core) throw new Error("no ledger");
  const state = core.fold(toChain(await rig.host.chats.messages(chatId, rig.host.userId))).state;
  const world = core.worldAt(state.revision);
  if (!world) throw new Error("no world");
  return { state, world };
}

export type Put = (collection: string, id: string, value: JsonObject) => Promise<void>;

/**
 * Port Alder with `people` Live beside the POV (the author's `always`; everyone else Background, no
 * refreshes); `setup` writes lore and pins into the draft before the commit.
 */
export async function alderChat(rig: Rig, setup: (put: Put, worldId: string) => Promise<void>, people: readonly string[] = [DANNY, PRIYA]): Promise<string> {
  const worldId = await rig.newWorld("Alder", "modern_slice_of_life");
  rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "minds", value: { thresholds: { live: 900, near: 900, far: 900 }, always: { ids: [...people] } } }));
  const put: Put = async (collection, id, value) => void rig.body(await rig.send({ type: "lre.editor", op: "put", worldId, base: null, collection, id, value }));
  await setup(put, worldId);
  rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: null }));
  const chatId = rig.host.createChat("Morning.");
  rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
  rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { refreshLimit: 0 } } }));
  const here = placeOfEntity((await stateOf(rig, chatId)).state, "pov");
  if (!here) throw new Error("the POV is nowhere");
  rig.body(await rig.send({ type: "lre.edit", chatId, ops: people.map((entity) => ({ op: "move", entity, to: here })) }));
  return chatId;
}

/** Lore for the story as it stands: pinned to Danny, keyed by what the player says, about Danny only, sharing the player's words only, and two secrets keyed alike, one of them his. */
export const STORY_LORE: Readonly<Record<string, JsonObject>> = {
  spare_key: { id: "spare_key", title: "Danny's spare key", content: "PIN-MARK: Danny keeps a spare key under the third paving stone.", keys: [], links: [] },
  lighthouse: { id: "lighthouse", title: "The lighthouse", content: "ACTIVE-MARK: the lighthouse has been dark since the spring storm.", keys: ["lighthouse"], links: [] },
  danny_bench: { id: "danny_bench", title: "The workbench", content: "LINK-MARK: the workbench is Danny's pride.", keys: [], links: [DANNY] },
  stones: { id: "stones", title: "Old stones", content: "WORDS-MARK: the breakwater stones came from the quarry upriver.", keys: [], links: [] },
  wreck: { id: "wreck", title: "The wreck", content: "SECRET-MARK: the keeper wrecked the lighthouse lamp himself.", keys: ["lighthouse"], links: [], secret: true, gate: "false" },
  danny_debt: { id: "danny_debt", title: "Danny's debt", content: "HELD-MARK: Danny owes the lighthouse keeper money.", keys: ["lighthouse"], links: [], secret: true, gate: "false", holders: [DANNY] },
};

/** Priya's memory says she told Danny something; Danny's own writes notes, a commitment, a plan and a summary. */
export function storyMemories(name: string): JsonObject {
  if (name === "Priya Nair") return { told: [{ to: ["Danny Okafor"], what: "TOLD-MARK come to dinner at seven" }] };
  if (name !== "Danny Okafor") return {};
  return {
    notes: [
      { text: "NOTE-MARK the lamp was dark again", salience: 4 },
      { text: "NOTE2-MARK Priya had her clipboard out early", salience: 3 },
    ],
    commitments: [{ kind: "plan", with: ["Priya Nair"], text: "COMMIT-MARK dinner with Priya at seven" }],
    plans: [{ what: "PLAN-MARK dinner at Priya's", kind: "meet", when: { from: "19:00", to: "20:30" }, with: ["Priya Nair"], priority: 3 }],
    summary: "SUMMARY-MARK Danny fixes things and keeps score.",
  };
}

/** What the player says on the story's second turn: it names the lighthouse, and the breakwater only by a word. */
export const ASK = "I ask Danny about the lighthouse by the breakwater.";

/** Port Alder with the story lore, Danny's pin, `reads` as what minds read, a first turn whose memories write all of the above, and a second turn that names the lighthouse. */
export async function storyChat(rig: Rig, reads: JsonObject = {}): Promise<{ chatId: string; seen: Seen }> {
  const seen = fakeModels(rig, storyMemories);
  const chatId = await alderChat(rig, async (put, worldId) => {
    for (const [id, value] of Object.entries(STORY_LORE)) await put("lore", id, value);
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: null, part: "lorePins", value: { characters: { [DANNY]: [{ lore: "spare_key" }] }, places: {} } }));
  });
  if (Object.keys(reads).length > 0) rig.body(await rig.send({ type: "lre.settings.set", patch: { minds: { reads } } }));
  await rig.turn(chatId, "Morning, both of you.", "FIRST-REPLY-MARK: Danny nods; Priya waves a clipboard.");
  await rig.turn(chatId, ASK, "SECOND-REPLY-MARK: Danny squints at the window.");
  return { chatId, seen };
}
