// The agent tool layer's shared half (AGENT-LOOP-PLAN §6, §9; INC1-SPEC C6): the tiers, families and
// knowledge a tool is given under, and every text a tool shows a model. Each tool's description, the
// description of each of its arguments and the notes the tool layer answers with are registry texts
// (`shared/prompts.ts` makes them from `TOOL_TEXTS` and `TOOL_NOTES`, the way it makes each section's
// guidance), edited on Settings → Agents → Prompts on the GM agent page: so the page lists exactly the
// tools there are, and the backend (`backend/agents/tools/registry.ts`, `toolsFor`) sends each one with
// the user's own text where they wrote one. The JSON Schemas themselves are fixed output contracts
// (§16): only their descriptions are texts.

import { READ_TOOL_TEXTS } from "./agent-tools-read";
import { WRITE_TOOL_NOTES, WRITE_TOOL_TEXTS } from "./agent-tools-write";
import type { PromptVar } from "./prompts";

/**
 * What a tool may do: read; make the story's own changes to the world's fabric (`story`: a thing, a
 * place made in play, a walk-on, a purchase's goods, ITEMS-SPEC §7.3), which a role at the story tier
 * may stage; or change the world as the GM's edits do (`gm`, always held and previewed).
 */
export type ToolTier = "read" | "story" | "gm";

/** The families of AGENT-LOOP-PLAN §6's table, and organizations (ORG-SPEC §7.1); a role is given tools by family. */
export type ToolFamily = "people" | "places" | "items" | "money" | "orgs" | "quests" | "knowledge" | "time" | "checks" | "minds" | "lore" | "workspace";

export const TOOL_FAMILY_LABEL: Readonly<Record<ToolFamily, string>> = {
  people: "People",
  places: "Places and travel",
  items: "Items",
  money: "Money",
  orgs: "Organizations",
  quests: "Quests and secrets",
  knowledge: "Knowledge",
  time: "Time",
  checks: "Checks",
  minds: "Minds and memory",
  lore: "Lore",
  workspace: "Workspace",
};

/**
 * A knowledge as stored data names it (a file's old readers, an old session message's or review
 * item's knowledge): the player character's, everyone in the world's (secrets marked), or the GM's.
 * Read and ignored by every agent since secrecy became guidance (DESIGN §7.1).
 */
export type AgentKnowledge = "pov" | "everyone" | "gm";
export const AGENT_KNOWLEDGE: readonly AgentKnowledge[] = ["pov", "everyone", "gm"];

/**
 * How an agent's tools read the world (DESIGN §7.1). Neither leaves anything out: `everyone` reads
 * everything with each secret marked in the user's wording of a mark (the narrator's view); `gm`
 * reads everything, each restricted thing with its visibility: unmarked for the GM's own tools, and
 * with every secret marked besides (`ToolEnv.marks`) for every turn agent, the roles and the main
 * agent alike.
 */
export type ToolView = "everyone" | "gm";

/** Whether what `k` reads is within what `of` reads: the player character's knowledge is within everyone's, and everyone's within the GM's. */
export function knowledgeWithin(k: AgentKnowledge, of: AgentKnowledge): boolean {
  return AGENT_KNOWLEDGE.indexOf(k) <= AGENT_KNOWLEDGE.indexOf(of);
}

export function isAgentKnowledge(v: unknown): v is AgentKnowledge {
  return typeof v === "string" && (AGENT_KNOWLEDGE as readonly string[]).includes(v);
}

/** One argument's description: `path` names its property, dotted through nested `properties` and `items` ("op.field"). */
export interface ToolArgText {
  path: string;
  text: string;
}

/**
 * A tool's texts as shipped: its name as the model calls it, its family and tier, a line for the
 * Prompts page (`note`), its description (`text`, the registry text `tool.<name>`) and each argument's
 * (`tool.<name>.<path>`). Every argument its schema has is here, and nothing else: the schema carries
 * no description of its own.
 */
export interface ToolText {
  name: string;
  family: ToolFamily;
  tier: ToolTier;
  note: string;
  text: string;
  args: readonly ToolArgText[];
}

/** A note the tool layer answers with (not found, several match, …): a registry text of the GM agent page's "Tool answers". */
export interface ToolNote {
  id: string;
  label: string;
  note: string;
  text: string;
  vars: readonly PromptVar[];
}

/** The registry text of a tool's description. */
export function toolTextId(name: string): string {
  return `tool.${name}`;
}

/** The registry text of one argument's description. */
export function toolArgTextId(name: string, path: string): string {
  return `tool.${name}.${path}`;
}

/** The tool layer's notes' ids, so code names them once. */
export const TOOL_NOTE = {
  noPerson: "tool.note.no_person",
  noPlace: "tool.note.no_place",
  noThing: "tool.note.no_thing",
  noOrg: "tool.note.no_org",
  noTrack: "tool.note.no_track",
  noFact: "tool.note.no_fact",
  ambiguous: "tool.note.ambiguous",
  missing: "tool.note.missing",
  badValue: "tool.note.bad_value",
  badValueUnlisted: "tool.note.bad_value_unlisted",
} as const;

const asked: PromptVar = { name: "name", text: "the name or id the model asked for, as it wrote it" };

/** The notes every tool may answer with: a name the view can't resolve, a missing or wrong argument. */
const LAYER_NOTES: readonly ToolNote[] = [
  { id: TOOL_NOTE.noPerson, label: "No such person", note: "A tool's answer when a person's name or id names no one the agent's knowledge can see: a hidden person reads exactly as one who doesn't exist.", text: "No such person here: {{name}}.", vars: [asked] },
  { id: TOOL_NOTE.noPlace, label: "No such place", note: "A tool's answer when a place's name or id names no place the agent's knowledge can see.", text: "No such place here: {{name}}.", vars: [asked] },
  { id: TOOL_NOTE.noThing, label: "No such thing", note: "A tool's answer when a thing's name or id names nothing the agent's knowledge can see.", text: "No such thing here: {{name}}.", vars: [asked] },
  { id: TOOL_NOTE.noOrg, label: "No such organization", note: "A tool's answer when an organization's name or id names none the world has: a company, a household, a group, a trust or the party.", text: "No such organization here: {{name}}.", vars: [asked] },
  { id: TOOL_NOTE.noTrack, label: "No such quest or secret", note: "A tool's answer when a quest, secret, puzzle or agenda's id or label names none the agent's knowledge can see.", text: "No such quest, secret, puzzle or agenda here: {{name}}.", vars: [asked] },
  { id: TOOL_NOTE.noFact, label: "No such fact", note: "A tool's answer when a fact's id names no fact the chat records.", text: "No such fact here: {{name}}.", vars: [asked] },
  {
    id: TOOL_NOTE.ambiguous,
    label: "Several match",
    note: "A tool's answer when a name fits more than one, listing only those the agent's knowledge can see.",
    text: "{{name}} could be any of these; ask again with one of their ids: {{matches}}.",
    vars: [asked, { name: "matches", text: "each match the agent may see, as its name and id", required: true }],
  },
  {
    id: TOOL_NOTE.missing,
    label: "A missing argument",
    note: "A tool's answer when the call leaves out an argument the tool needs.",
    text: "{{tool}} needs {{arg}}: {{text}}",
    vars: [
      { name: "tool", text: "the tool" },
      { name: "arg", text: "the argument left out", required: true },
      { name: "text", text: "that argument's description" },
    ],
  },
  {
    id: TOOL_NOTE.badValue,
    label: "A value it doesn't take",
    note: "A tool's answer when an argument holds a value the tool doesn't take.",
    text: "{{tool}} doesn't take {{value}} as {{arg}}; it takes one of: {{values}}.",
    vars: [
      { name: "tool", text: "the tool" },
      { name: "arg", text: "the argument" },
      { name: "value", text: "the value given", required: true },
      { name: "values", text: "the values it takes" },
    ],
  },
  {
    id: TOOL_NOTE.badValueUnlisted,
    label: "A value it doesn't take, with none to list",
    note: "A tool's answer when an argument holds a value the tool doesn't take and there is none it may list.",
    text: "{{tool}} doesn't take {{value}} as {{arg}}.",
    vars: [
      { name: "tool", text: "the tool" },
      { name: "arg", text: "the argument" },
      { name: "value", text: "the value given", required: true },
    ],
  },
];

/** Every note the tool layer answers with: the layer's own, then the write, workspace and lore tools'. */
export const TOOL_NOTES: readonly ToolNote[] = [...LAYER_NOTES, ...WRITE_TOOL_NOTES];

/** Every tool's texts, in the order the Prompts page lists them: the read families', then the writes', the workspace's and the lore's. */
export const TOOL_TEXTS: readonly ToolText[] = [...READ_TOOL_TEXTS, ...WRITE_TOOL_TEXTS];

const BY_NAME: ReadonlyMap<string, ToolText> = new Map(TOOL_TEXTS.map((t) => [t.name, t]));

export function toolText(name: string): ToolText | undefined {
  return BY_NAME.get(name);
}
