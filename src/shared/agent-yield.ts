// What a role's run gave the engine that the engine didn't take as given, and why (DESIGN §4.6, "What
// a run gave"): nothing a run answered drops silently. The changes it staged (landing when the turn
// commits, held for the review card, or refused), what the knowledge step refused of its answer, what
// the read didn't read of its proposals and the things they name that the world has no entity for,
// and the director's lines withheld for contradicting the state it was given, each with how many.
// Each reason is a registry text on the Main agent page with its default and its reset, worded alike
// in the main agent's run_role and revise answers, in Diagnostics and in the host log. Pure data.

import { MAIN_AGENT_PAGE } from "./main-agent-prompts";
import type { PromptDef, PromptVar } from "./prompts";

/** Why the knowledge step refused part of an answer (`checkKnowledge`), or the state refused what it made of it (`state`). */
export const KNOWLEDGE_REFUSALS = ["matters", "facts_limit", "learnings_limit", "no_fact", "teller", "witnesses", "missed", "pov", "absent", "part_time", "holders", "inference", "confidence", "evidence", "already", "doubt", "state"] as const;
export type KnowledgeRefusal = (typeof KNOWLEDGE_REFUSALS)[number];

/** Why the read took fewer changes than its answer proposed (`extractAnswer`). */
export const READ_DROPS = ["type", "time", "same", "shape"] as const;
export type ReadDrop = (typeof READ_DROPS)[number];

/** How a director's line contradicts the state it was given (`proseClashes`), each withheld from the narrator. */
export const PROSE_CLASHES = ["here", "gone", "holds", "lies"] as const;
export type ProseClashKind = (typeof PROSE_CLASHES)[number];

/** How many of each, by kind; a kind with none is absent. */
export type Counts<K extends string> = Partial<Record<K, number>>;

export const YIELD_TEXT = {
  writes: "main.ran.writes",
  lost: "main.ran.lost",
  staged: "main.writes.staged",
  review: "main.writes.review",
  refused: "main.writes.refused",
  knowledge: (kind: KnowledgeRefusal): string => `main.lost.knowledge.${kind}`,
  knowledgeCalls: "main.lost.knowledge.calls",
  knowledgeEmpty: "main.lost.knowledge.empty",
  knowledgeOff: "main.lost.knowledge.off",
  read: (kind: ReadDrop): string => `main.lost.read.${kind}`,
  readEmpty: "main.lost.read.empty",
  readUntracked: "main.lost.read.untracked",
  sceneLore: "main.lost.scene.lore",
  prose: (kind: ProseClashKind): string => `main.lost.prose.${kind}`,
} as const;

const page = MAIN_AGENT_PAGE.id;
const GROUP = "What a run gave";
const count: PromptVar = { name: "count", text: "how many", required: true };
const def = (id: string, label: string, note: string, text: string, vars: readonly PromptVar[] = [count]): PromptDef => ({ id, page, group: GROUP, label, note: `${note} Worded alike to the main agent (run_role's and revise's answers), in Diagnostics and in the host log.`, text, vars });

const KNOWLEDGE: Readonly<Record<KnowledgeRefusal, { label: string; note: string; text: string }>> = {
  matters: { label: "Knowledge: no reason it matters", note: "A new fact that doesn't say why it matters and to whom (matters), which the knowledge step refuses, with every learning of it.", text: "{{count}} refused (no matters: a new fact says why it matters and to whom)" },
  facts_limit: { label: "Knowledge: past the new facts", note: "A new fact past the new facts a turn or a chat may hold (Settings → Minds → Knowledge), all of a turn's calls together.", text: "{{count}} refused (past the new facts a turn or a chat may hold, Settings → Minds → Knowledge)" },
  learnings_limit: { label: "Knowledge: past the learnings", note: "A learning past the learnings a turn may hold (Settings → Minds → Knowledge), all of a turn's calls together.", text: "{{count}} refused (past the learnings a turn may hold, Settings → Minds → Knowledge)" },
  no_fact: { label: "Knowledge: no such fact", note: "A learning naming no fact the answer gave (by its ref) or the chat holds (by its id), or neither witnessed nor told.", text: "{{count}} refused (a learning of no fact the answer gave by its ref or the chat holds by its id, or neither witnessed nor told)" },
  teller: { label: "Knowledge: no teller", note: "A telling whose teller is no one in the world, or someone who doesn't hold what they told.", text: "{{count}} refused (a telling by no one in the world, or by someone who doesn't hold it)" },
  witnesses: { label: "Knowledge: witnesses not names", note: "A witnessing whose who isn't a name or a list of names.", text: "{{count}} refused (a witnessing whose who isn't names)" },
  missed: { label: "Knowledge: who missed it unknown", note: "A witnessing whose missed names someone the world doesn't have, or a name more than one person goes by: who missed it is never guessed at.", text: "{{count}} refused (a witnessing whose missed names someone the world doesn't have, or a name more than one person goes by)" },
  pov: { label: "Knowledge: beyond the player character", note: "What the player character would learn names someone they can't know of, or carries only part of a secret, or more than one.", text: "{{count}} refused (what the player character would learn names someone they can't know of, or carries part of a secret or more than one)" },
  absent: { label: "Knowledge: not there", note: "Someone who wasn't there to witness it, or a telling neither side of which was there.", text: "{{count}} refused (someone who wasn't there to witness it or be told it)" },
  part_time: { label: "Knowledge: there for part of the turn", note: "A witnessing by someone there for only part of the turn, who witnesses none of it, though they may be told.", text: "{{count}} refused (a witnessing by someone there for only part of the turn)" },
  holders: { label: "Knowledge: past a fact's holders", note: "A learning past the holders a fact may have (Settings → Minds → Knowledge).", text: "{{count}} refused (past the holders a fact may have, Settings → Minds → Knowledge)" },
  inference: { label: "Knowledge: an inference by no one", note: "An inference by no one the call was about, of no fact it gave or the chat holds, or by the player character, who never infers here.", text: "{{count}} refused (an inference by no one the call was about, of no fact it gave, or by the player character)" },
  confidence: { label: "Knowledge: no confidence", note: "An inference or a doubt with no confidence from 0 to 1.", text: "{{count}} refused (an inference or a doubt with no confidence from 0 to 1)" },
  evidence: { label: "Knowledge: unheld evidence", note: "An inference resting on what its person neither holds nor witnessed, or on nothing.", text: "{{count}} refused (an inference resting on what its person neither holds nor witnessed)" },
  already: { label: "Knowledge: held already", note: "An inference of what its person already holds at least as surely.", text: "{{count}} refused (an inference of what its person already holds at least as surely)" },
  doubt: { label: "Knowledge: a doubt of nothing held", note: "A doubt of what its person doesn't hold, or the player character's, who never doubts here.", text: "{{count}} refused (a doubt of what its person doesn't hold, or the player character's)" },
  state: { label: "Knowledge: refused by the state", note: "A learning the engine's own check of the world refused as it was recorded.", text: "{{count}} dropped (the engine's check of the world refused it)" },
};

const READ: Readonly<Record<ReadDrop, { label: string; note: string; text: string; vars?: readonly PromptVar[] }>> = {
  type: { label: "Read: not a change it reads", note: "A proposal whose type isn't one the read takes now (its change types, less the knowledge step's own).", text: "{{count}} not read ({{types}}: not a change type the read takes now)", vars: [count, { name: "types", text: "the types it gave, each once" }] },
  time: { label: "Read: time already passed", note: "Narrated time no longer than the time the turn already applied.", text: "{{count}} not read (narrated time the turn had already passed)" },
  same: { label: "Read: a repeat", note: "A proposal the same as another, or a handover or payment a purchase it proposed already holds.", text: "{{count}} not read (the same as another, or a handover or payment a purchase already holds)" },
  shape: { label: "Read: not a change", note: "An item of its proposals that isn't a change: no type.", text: "{{count}} not read (not a change: no type)" },
};

/** The director's lines, as the main agent may read them, follow each reason: quoted after a colon, or nothing where its knowledge doesn't reach the director's. */
const lines: PromptVar = { name: "lines", text: "the lines, quoted, after a colon; empty where the main agent's knowledge doesn't reach the director's" };

const PROSE: Readonly<Record<ProseClashKind, { label: string; note: string; text: string }>> = {
  here: { label: "Director: someone here who isn't", note: "A line of the brief or the outline that has someone in the scene whom the engine has elsewhere: withheld from the narrator.", text: "{{count}} withheld (it has someone here whom the engine has elsewhere{{lines}})" },
  gone: { label: "Director: someone gone who is here", note: "A line of the brief or the outline that has someone the engine has in the scene gone from it: withheld from the narrator.", text: "{{count}} withheld (it has someone gone whom the engine has here{{lines}})" },
  holds: { label: "Director: a thing someone doesn't have", note: "A line of the brief or the outline that has someone hold or hand over a thing the engine says they don't have: withheld from the narrator.", text: "{{count}} withheld (it has someone hold or hand over a thing the engine says they don't have{{lines}})" },
  lies: { label: "Director: a thing lying where it isn't", note: "A line of the brief or the outline that has a thing lying in the scene that the engine has on someone or elsewhere: withheld from the narrator.", text: "{{count}} withheld (it has a thing lying here that the engine has on someone or elsewhere{{lines}})" },
};

export const AGENT_YIELD_PROMPTS: readonly PromptDef[] = [
  def(YIELD_TEXT.writes, "Its changes", "Follows a run's answer when it staged a change, or a change it asked for was refused: each part below, joined.", "Its changes: {{writes}}.", [{ name: "writes", text: "the parts below that it has, joined", required: true }]),
  def(YIELD_TEXT.staged, "Changes staged", "The changes a run staged that land when the turn commits (their mode Auto).", "{{count}} staged, landing when the turn commits"),
  def(YIELD_TEXT.review, "Changes held for the review card", "The changes a run staged whose mode is Confirm: they wait for the GM's Apply on the turn's review card.", "{{count}} held for the review card, waiting for the GM's Apply"),
  def(YIELD_TEXT.refused, "Changes refused", "The changes a run asked for that were refused, with the writer's reasons.", "{{count}} refused ({{reasons}})", [count, { name: "reasons", text: "each refusal's reason, in the tool layer's words", required: true }]),
  def(YIELD_TEXT.lost, "What the engine didn't take", "Follows a run's answer when the engine took less of it than it gave, or it gave nothing: each reason below, joined.", "What the engine didn't take: {{lost}}.", [{ name: "lost", text: "the reasons below that apply, joined", required: true }]),
  ...Object.entries(KNOWLEDGE).map(([kind, t]) => def(YIELD_TEXT.knowledge(kind as KnowledgeRefusal), t.label, t.note, t.text)),
  def(YIELD_TEXT.knowledgeCalls, "Knowledge: calls with no answer", "Calls of the knowledge step (one per person, or one for the scene) whose agent gave no answer the engine takes; Diagnostics has each call.", "{{count}} of its calls gave no answer the engine takes (see Diagnostics)"),
  def(YIELD_TEXT.knowledgeEmpty, "Knowledge: an empty answer", "A knowledge run whose answers held no fact and no learning, so it recorded nothing and refused nothing.", "its answers held no new fact and no learning", []),
  def(YIELD_TEXT.knowledgeOff, "Knowledge: no step", "A knowledge run that made no call: the knowledge step is off in Settings → Steps and connections, or no one could perceive the turn.", "the knowledge step made no call: it is off in Settings → Steps and connections, or no one could perceive the turn", []),
  ...Object.entries(READ).map(([kind, t]) => def(YIELD_TEXT.read(kind as ReadDrop), t.label, t.note, t.text, t.vars)),
  def(YIELD_TEXT.readEmpty, "Read: an empty answer", "A read whose answer proposed no change at all.", "its answer proposed no change", []),
  def(
    YIELD_TEXT.readUntracked,
    "Read: a thing the world doesn't have",
    "Changes to a thing (taken, dropped, used up, worn, lost, damaged or counted) that the world has no entity for, or none the player character knows of: each is only a Not tracked note to the player, since no such change makes a thing; a give by someone other than the player character, with the thing in the reply's words, or a purchase, makes one.",
    "{{count}} name a thing the world doesn't have ({{things}}): each changes nothing but a Not tracked note; only a give by someone other than the player character, the thing in the reply's words, or a purchase makes one",
    [count, { name: "things", text: "each thing as the read named it; one named by an id the player character doesn't know, as something they don't know", required: true }],
  ),
  def(YIELD_TEXT.sceneLore, "Scene: lore it doesn't have", "Lore ids a scene run chose that the world has no entry for.", "{{count}} lore ids not taken (the world has no such entry: {{ids}})", [count, { name: "ids", text: "the ids it gave", required: true }]),
  ...Object.entries(PROSE).map(([kind, t]) => def(YIELD_TEXT.prose(kind as ProseClashKind), t.label, t.note, t.text, [count, lines])),
];
