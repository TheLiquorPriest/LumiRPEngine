// What writes the quests area (plan §8.3, §6.2): a call's writes to quests, recorded in order as one write of the store, in the engine
// lane, each a change of the area. A quest the call opens is given its id from its first change (`q-` and that change's number), and
// the writes after it in the same call name it by `stand`, the stand-in the call gave it. A write with a turn belongs to that turn,
// so a swipe or a delete takes it away; with none, it is the writer's own change after the chat's newest reply (a job of his own, or
// the assistant's call), as the story's writes are. The store's own refusal of a joined turn stands.

import type { JsonObject } from "../shared/json";
import type { ChangeInput, Source, Store } from "../store";
import { nextChange } from "../story/record";
import { newQuestId, QUEST_OPS } from "./record";

/** The operations of the area, by their names in a call (`quest.<op>` in the changes). */
export type QuestOp = keyof typeof QUEST_OPS;

/** One write of a quest a call asks for: the operation and its value, the quest by id, or by the stand-in a quest opened earlier in the call was given. */
export interface QuestWrite {
  op: QuestOp;
  /** The operation's value without `quest`, which `quest` below names. */
  value: JsonObject;
  /** The quest's id; `stand` of an opening write of this call stands for a quest not yet made. */
  quest: string;
}

/** An opening write: it names the quest it makes by `stand`, which the writes after it may use as `quest`. */
export interface QuestOpening extends QuestWrite {
  op: "open";
  stand: string;
}

/** Who writes, and where: as the story's writers are. */
export interface QuestWriter {
  user: string;
  chat: string;
  turn: string | null;
  by: string | null;
  agent: string | null;
  job: string | null;
  source?: Source | null;
}

/** What one write came to: its change, and the quest it wrote (the id a new one was given). */
export interface QuestRecorded {
  change: number;
  quest: string;
}

/** Records a call's writes to quests on the writer's turn (or as his own change), inside the caller's queued write. */
export function recordQuests(store: Store, writer: QuestWriter, list: readonly (QuestWrite | QuestOpening)[]): QuestRecorded[] {
  const first = nextChange(store);
  const given = new Map<string, string>();
  const quests: string[] = [];
  const inputs = list.map((w, i): ChangeInput => {
    const quest = given.get(w.quest) ?? w.quest;
    // A quest this call opens is given its id from its change; the writes after it that name its stand-in write to it.
    const id = "stand" in w ? newQuestId(first + i) : quest;
    if ("stand" in w) given.set(w.stand, id);
    quests.push(id);
    return { lane: "engine", op: QUEST_OPS[w.op], value: { ...w.value, quest: id }, by: writer.by, handle: writer.agent, source: writer.source ?? null };
  });
  const u = store.user(writer.user);
  const { changes } = u.record(u.writeTarget({ chat: writer.chat, turn: writer.turn, job: writer.job }), inputs);
  return changes.map((c, i) => ({ change: c.id, quest: quests[i] as string }));
}
