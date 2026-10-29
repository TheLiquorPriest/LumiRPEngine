// Every text LumiRPEngine sends to a model, editable (DESIGN §6.12): one registry of what each text
// is, its shipped default, the placeholders it may use and the output contract its answer keeps. The
// backend resolves and renders them (`backend/prompts.ts`) and Settings → Agents → Prompts edits
// them, both from this table, so the page offers exactly what is sent. A text's id, the placeholder
// syntax `{{name}}` and the placeholders a text requires are stored formats (the user's own texts and
// each turn's prompt set are kept by them), so they never change once shipped.

import { AGENT_FAILURE_PROMPTS } from "./agent-failures";
import { RUNTIME_PROMPT_PAGE, RUNTIME_PROMPTS } from "./agent-prompts";
import { MAIN_AGENT_PAGE, MAIN_AGENT_PROMPTS } from "./main-agent-prompts";
import { ROLE_PROMPT_PAGES, ROLE_PROMPTS } from "./role-prompts";
import { TOOL_FAMILY_LABEL, TOOL_NOTES, TOOL_TEXTS, toolArgTextId, toolTextId } from "./agent-tools";
import type { SlotId } from "./ids";
import { isRecord } from "./json";
import { DEFAULT_SECTIONS } from "./sections";
import { SECRET_MARK_WORDING, type SecretMarkWording } from "./secret-marks";

/** A placeholder a text may use: `{{name}}`, filled with what `text` says it holds; `required` when the text can't work without it. */
export interface PromptVar {
  name: string;
  text: string;
  required?: true;
}

/** One editable text. */
export interface PromptDef {
  /** Dotted and stable: the user's own text and each turn's prompt set are stored by it. */
  id: string;
  /** The Prompts page it is edited on (`PROMPT_PAGES`). */
  page: string;
  /** The heading it sits under on its page. */
  group?: string;
  label: string;
  /** Where it goes and what it does, in a line. */
  note: string;
  /** The shipped text: the default, which Reset brings back. */
  text: string;
  vars: readonly PromptVar[];
  /** The output contract a Test checks the answer against, where the text's answer has one. */
  contract?: string;
  /**
   * Whether a world has its own text for it, and whose comes first: `first`, the world's over the
   * user's (the final output's sections, which a world words for its own story); `after-user`, the
   * user's over the world's, as step prompts read. Absent: no world level.
   */
  world?: "first" | "after-user";
  /** The text can't be empty (a secret's mark always needs words): an empty one is never saved or sent. */
  nonEmpty?: true;
}

/** A Prompts page: the final output, or an agent's. */
export interface PromptPage {
  id: string;
  label: string;
  note: string;
}

/** The user's own texts, or a turn's prompt set, by id. */
export type PromptTexts = Readonly<Record<string, string>>;

/** Where the narrator rules come from, and how the engine's sections are marked in the prompt: the shipped text. */
export const NARRATOR_SOURCE = "These rules come from LumiRPEngine, the engine that keeps this roleplay's world; its sections in this prompt each start with their name in square brackets.";

/**
 * The order of authority (DESIGN D36, §6.8), the narrator's top rule, as shipped: the player's own
 * directives come first, the dice they chose deciding uncertain attempts; then what the story has
 * established; then the sections, the world as it stands, which the player may direct away from.
 * Everything after it, the marked facts' guidance included, works under it. What the story brings in
 * becomes part of the world.
 */
export const NARRATOR_AUTHORITY = [
  "Order of authority, highest first; every rule after it works under it:",
  "1. The player's own instructions: what they say out of character (OOC), and what they write their character does. An attempt the engine rolled for goes as the roll says: the player chose to play with dice.",
  "2. What the story has already established.",
  "3. The engine's sections: the world as it stands now, kept up with the story and with the player's own changes. Follow them unless the player directs otherwise.",
  "People, places and things the story brings in become part of the world.",
].join("\n");

/**
 * What the narrator is told of marked facts (DESIGN §6.8, §6.11), as shipped: knowledge guidance under
 * the order of authority, since the player's own directives come first. The marks `markedText`
 * (`engine/feed.ts`) writes say who knows a fact, so every character stays consistent with what they
 * know until the story or the player makes it known; and since knowledge barriers matter for the reply
 * the player reads, a marked fact isn't told to them unless they direct it or the story brings it out.
 * The same text in every world and on every turn, marked facts or not, so the prompt tells nothing of
 * whether a world keeps secrets.
 */
export const MARKED_FACTS_RULE =
  "What each person knows, under that order: a fact marked [unknown to you; known to …] or [unknown to you; GM only] is one the player character doesn't know, and the mark says who does. Keep every character consistent with what they know: no one says, acts on or is narrated as knowing a fact they don't, until the story reveals it to them or the player's own instructions make it known. Unless the player's own instructions say otherwise, don't tell a marked fact in the narration or have the reply reveal it; it becomes known only through what the story has already established or what the player character does or finds. Marked facts are for steering the story and the people who do know them.";

/** What leads the preset's own narrator rules (`RPEngine · narrator`), as shipped: they are the player's. */
export const PRESET_RULES_LEAD = "The player's own rules for the narrator, from their preset:";

/**
 * The registry id of each part of a secret's mark (`SecretMarkWording`), the Secret marks group: the
 * wording a turn's sections, its narrator rules and the World Info entries in its prompt mark a
 * secret in, and the narrator rules' sentence on a mark (`rule`, one of `NARRATOR_RULE_IDS`).
 */
export const MARK_TEXT_IDS = { known: "narrator.mark.known", kept: "narrator.mark.kept", both: "narrator.mark.both", everyone: "narrator.mark.everyone", rule: "narrator.secret_marks" } as const satisfies Record<keyof SecretMarkWording, string>;

/** The narrator rules' parts, in the order they're sent (`narratorRules`), each before the preset's rules. */
export const NARRATOR_RULE_IDS = ["narrator.source", "narrator.authority", "narrator.marked_facts", MARK_TEXT_IDS.rule] as const;

/** What leads the preset's rules, sent only when the preset has some. */
export const PRESET_RULES_LEAD_ID = "narrator.preset_lead";

/** A built-in section's guidance: its template, which leads its lines and says where they go. */
export function sectionPromptId(slot: SlotId): string {
  return `section.${slot}`;
}

export const FINAL_OUTPUT_PAGE: PromptPage = {
  id: "final",
  label: "Final output",
  note: "What LumiRPEngine puts into the narrator's prompt: the narrator rules, how a secret is marked, and the guidance that leads each section's lines. A world's own wording of a section (Build → Sections) comes before yours in its chats.",
};

export const GM_AGENT_PAGE: PromptPage = {
  id: "gm",
  label: "GM agent",
  note: "The game master's assistant (GM → Assistant): its system prompt, its instructions, the descriptions of its tools and the notes its tools answer with.",
};

const NARRATOR_GROUP = "Narrator rules";
const MARKS_GROUP = "Secret marks";
const SECTIONS_GROUP = "Sections";

/** Every built-in section's guidance, the Minds section's and any later built-in's included. */
const SECTION_PROMPTS: readonly PromptDef[] = Object.values(DEFAULT_SECTIONS).map((s): PromptDef => ({
  id: sectionPromptId(s.id),
  page: FINAL_OUTPUT_PAGE.id,
  group: SECTIONS_GROUP,
  label: s.label,
  note: `Leads the ${s.label} section's lines: what it holds and how the narrator writes from it.`,
  text: s.template,
  vars: [{ name: "lines", text: "where the section's lines go, one to a row", required: true }],
  world: "first",
}));

const TOOLS_GROUP = "Tools";
const TOOL_ANSWERS_GROUP = "Tool answers";

/**
 * Each tool's description and its arguments', made from the tools' own texts (`TOOL_TEXTS`) as the
 * sections' guidance is made from the sections, so the GM agent page lists exactly the tools there
 * are; then the notes the tool layer answers with (`TOOL_NOTES`).
 */
export const TOOL_PROMPTS: readonly PromptDef[] = [
  ...TOOL_TEXTS.flatMap((t): PromptDef[] => [
    { id: toolTextId(t.name), page: GM_AGENT_PAGE.id, group: TOOLS_GROUP, label: `${t.name}: what it does`, note: `${t.note} ${TOOL_FAMILY_LABEL[t.family]}; ${t.tier === "read" ? "reads only" : "GM tier: a change, previewed and held"}.`, text: t.text, vars: [] },
    ...t.args.map((a): PromptDef => ({ id: toolArgTextId(t.name, a.path), page: GM_AGENT_PAGE.id, group: TOOLS_GROUP, label: `${t.name}: ${a.path}`, note: `The description of ${t.name}'s ${a.path} argument.`, text: a.text, vars: [] })),
  ]),
  ...TOOL_NOTES.map((n): PromptDef => ({ ...n, page: GM_AGENT_PAGE.id, group: TOOL_ANSWERS_GROUP })),
];

/** What a mark's placeholders hold; each part needs those it has. */
const MARK_TEXT_VAR: PromptVar = { name: "text", text: "the secret's words", required: true };
const MARK_KNOWN_VAR: PromptVar = { name: "known", text: "who knows it, names joined with commas", required: true };
const MARK_KEPT_VAR: PromptVar = { name: "kept", text: "whom it is kept from, names joined with commas, or the word for everyone when it is kept from everyone but its holders", required: true };

/**
 * How a secret is marked for the narrator (DESIGN §6.11), in a turn's sections and the World Info
 * entries in its prompt alike, each part with the placeholders it needs; then the narrator rules'
 * sentence on a mark, which names every form the parts make (`{{forms}}`, `secretMarkForms`), so an
 * edited wording is still explained.
 */
const MARK_PROMPTS: readonly PromptDef[] = [
  { id: MARK_TEXT_IDS.known, page: FINAL_OUTPUT_PAGE.id, group: MARKS_GROUP, label: "Known to some", note: "A secret some people know, marked with who knows it.", text: SECRET_MARK_WORDING.known, vars: [MARK_TEXT_VAR, MARK_KNOWN_VAR], nonEmpty: true },
  { id: MARK_TEXT_IDS.kept, page: FINAL_OUTPUT_PAGE.id, group: MARKS_GROUP, label: "Kept from some", note: "A secret marked with whom it is kept from.", text: SECRET_MARK_WORDING.kept, vars: [MARK_TEXT_VAR, MARK_KEPT_VAR], nonEmpty: true },
  { id: MARK_TEXT_IDS.both, page: FINAL_OUTPUT_PAGE.id, group: MARKS_GROUP, label: "Known to some, kept from others", note: "A secret marked with both who knows it and whom it is kept from.", text: SECRET_MARK_WORDING.both, vars: [MARK_TEXT_VAR, MARK_KNOWN_VAR, MARK_KEPT_VAR], nonEmpty: true },
  { id: MARK_TEXT_IDS.everyone, page: FINAL_OUTPUT_PAGE.id, group: MARKS_GROUP, label: "The word for everyone", note: "Used for {{kept}} when a secret is kept from everyone but its holders.", text: SECRET_MARK_WORDING.everyone, vars: [], nonEmpty: true },
  {
    id: MARK_TEXT_IDS.rule,
    page: FINAL_OUTPUT_PAGE.id,
    group: MARKS_GROUP,
    label: "What a mark means",
    note: "The narrator rules' sentence on a secret's mark, every turn: it names each form the texts above make, so the narrator keeps a marked secret as a marked fact.",
    text: SECRET_MARK_WORDING.rule,
    vars: [
      { name: "forms", text: 'each form a secret\'s mark takes in the texts above, … for its words and names, joined with "or"', required: true },
      { name: "everyone", text: "the word for everyone, as above" },
    ],
    nonEmpty: true,
  },
];

/** The final output's texts: the narrator rules' parts, how a secret is marked, then each section's guidance. */
export const FINAL_OUTPUT_PROMPTS: readonly PromptDef[] = [
  { id: "narrator.source", page: FINAL_OUTPUT_PAGE.id, group: NARRATOR_GROUP, label: "Where the rules come from", note: "Opens the narrator rules: that LumiRPEngine sends them, and how its sections are marked.", text: NARRATOR_SOURCE, vars: [] },
  { id: "narrator.authority", page: FINAL_OUTPUT_PAGE.id, group: NARRATOR_GROUP, label: "Order of authority", note: "The narrator's top rule: whose word comes first. Every rule after it works under it.", text: NARRATOR_AUTHORITY, vars: [] },
  { id: "narrator.marked_facts", page: FINAL_OUTPUT_PAGE.id, group: NARRATOR_GROUP, label: "Marked facts", note: "What a fact marked as unknown to the player character means, and how each character keeps to what they know.", text: MARKED_FACTS_RULE, vars: [] },
  { id: PRESET_RULES_LEAD_ID, page: FINAL_OUTPUT_PAGE.id, group: NARRATOR_GROUP, label: "Before your preset's rules", note: "Leads the rules of your preset's RPEngine · narrator block, when it has them.", text: PRESET_RULES_LEAD, vars: [] },
  ...MARK_PROMPTS,
  ...SECTION_PROMPTS,
];

/** The GM agent's text ids, so code names them once. */
export const GM_TEXT = {
  system: "gm.system",
  instructions: "gm.instructions",
  historyNote: "gm.history_note",
  knowledge: { pov: "gm.knowledge.pov", everyone: "gm.knowledge.everyone", gm: "gm.knowledge.gm" },
} as const;

/** What the GM agent's prompts may name. */
const GM_VARS: readonly PromptVar[] = [
  { name: "world", text: "the world's name" },
  { name: "pov", text: "the player character's name" },
];

/** What the system prompt may name besides: what the assistant's tools show it, in the words of its knowledge's text below. */
const GM_SYSTEM_VARS: readonly PromptVar[] = [...GM_VARS, { name: "knowledge", text: "what the assistant's tools show it: the text below for the knowledge it reads with (Settings → Agents → Assistant → Knowledge)" }];

const GM_INSTRUCTIONS = "Instructions";
const GM_KNOWLEDGE = "What it sees";
const GM_THREAD = "The conversation";

/** The GM agent's own texts; its tools' descriptions join them with the tools. */
export const GM_AGENT_PROMPTS: readonly PromptDef[] = [
  {
    id: GM_TEXT.system,
    page: GM_AGENT_PAGE.id,
    group: GM_INSTRUCTIONS,
    label: "System prompt",
    note: "Who the assistant is, whom it works for, and what it may rely on.",
    text: "You are the game master's assistant for {{world}}, a roleplay world that LumiRPEngine keeps; {{pov}} is the player character. You work for the game master, outside the story: you answer their questions about the world and make the changes they ask for. You never narrate the story or speak as one of its characters.\n\nYou see the world through your tools, as it stands now, and they show you {{knowledge}}. They are your only source. Look things up before you answer, and answer only from what the tools give back: when they don't show something, say that you can't see it, and never guess or fill a gap from memory. A secret the tools mark stays marked in what you say: say whom it is known to and whom it is kept from.",
    vars: GM_SYSTEM_VARS,
  },
  {
    id: GM_TEXT.instructions,
    page: GM_AGENT_PAGE.id,
    group: GM_INSTRUCTIONS,
    label: "Role instructions",
    note: "How it works through a question or a change.",
    text: "How to work:\n- Find whom and what a request is about first, by the names the game master uses, then read only what you need. A name the tools don't find is one you can't see: say so.\n- Answer briefly and concretely, naming people, places, things and amounts as the tools give them.\n- To change the world, use the edit tools. An edit tool changes nothing by itself: it checks the change against the world as it stands now and gives back a preview. The game master then applies it, with an Undo, or turns it down; if they chose so, it applies as soon as you have answered. Propose only what the game master asked for, and say in plain words what you propose. When a tool refuses a change, say why, in its words.\n- Write a workspace note only when the game master asks you to keep something.",
    vars: GM_VARS,
  },
  {
    id: GM_TEXT.historyNote,
    page: GM_AGENT_PAGE.id,
    group: GM_THREAD,
    label: "Earlier messages left out",
    note: "Leads what is sent of the conversation when any of it isn't sent, past History tokens (Settings → Agents → Assistant) or written with more knowledge than the assistant reads with now: how many of its earlier messages aren't sent.",
    text: "({{count}} earlier {{messages}} of this conversation left out. If you need what was said there, ask the game master.)",
    vars: [...GM_VARS, { name: "count", text: "how many of the conversation's earlier messages aren't sent" }, { name: "messages", text: '"message" for 1, else "messages"' }],
  },
  {
    id: GM_TEXT.knowledge.pov,
    page: GM_AGENT_PAGE.id,
    group: GM_KNOWLEDGE,
    label: "Your character's knowledge",
    note: "Fills {{knowledge}} in the system prompt while the assistant reads with your character's knowledge.",
    text: "only what {{pov}}, the player character, knows: nobody and nothing they haven't met, seen or been told of",
    vars: GM_VARS,
  },
  {
    id: GM_TEXT.knowledge.everyone,
    page: GM_AGENT_PAGE.id,
    group: GM_KNOWLEDGE,
    label: "Everyone's knowledge, secrets marked",
    note: "Fills {{knowledge}} in the system prompt while the assistant reads with what everyone in the world knows.",
    text: "what everyone in the world knows, each secret marked with whom it is known to and whom it is kept from",
    vars: GM_VARS,
  },
  {
    id: GM_TEXT.knowledge.gm,
    page: GM_AGENT_PAGE.id,
    group: GM_KNOWLEDGE,
    label: "The GM's knowledge",
    note: "Fills {{knowledge}} in the system prompt while the assistant reads with the game master's knowledge.",
    text: "everything, as the game master sees it: every secret, plan and hidden person, place and thing",
    vars: GM_VARS,
  },
];

/** The Prompts pages, in the order Settings lists them. */
export const PROMPT_PAGES: readonly PromptPage[] = [FINAL_OUTPUT_PAGE, GM_AGENT_PAGE, MAIN_AGENT_PAGE, RUNTIME_PROMPT_PAGE, ...ROLE_PROMPT_PAGES];

/** Every editable text. */
export const PROMPTS: readonly PromptDef[] = [...FINAL_OUTPUT_PROMPTS, ...GM_AGENT_PROMPTS, ...TOOL_PROMPTS, ...MAIN_AGENT_PROMPTS, ...AGENT_FAILURE_PROMPTS, ...RUNTIME_PROMPTS, ...ROLE_PROMPTS];

/** The pages whose texts a turn's prompt set records (DESIGN §6.12): what the narrator's prompt is made from. */
export const TURN_PROMPT_PAGES: readonly string[] = [FINAL_OUTPUT_PAGE.id];

const BY_ID: ReadonlyMap<string, PromptDef> = new Map(PROMPTS.map((d) => [d.id, d]));

export function promptDef(id: string): PromptDef | undefined {
  return BY_ID.get(id);
}

/** Anything in double braces: a placeholder when it is exactly `{{name}}` of one the text has, else an unknown one, which Settings flags and never saves. */
export const PROMPT_BRACES = /\{\{[\s\S]*?\}\}/g;

/** The placeholder token for a name. */
export function placeholder(name: string): string {
  return `{{${name}}}`;
}

/** What is wrong with a text as written, in plain words. */
export interface PromptProblem {
  code: "unknown_placeholder" | "missing_placeholder" | "too_long" | "empty";
  message: string;
}

/** The placeholders `text` lacks that its text requires: without one it can't be used, so it is never sent. */
export function missingPlaceholders(def: PromptDef, text: string): PromptVar[] {
  return def.vars.filter((v) => v.required && !text.includes(placeholder(v.name)));
}

/** Whether `text` can be sent as `def`'s: it keeps every placeholder its text requires, and isn't blank where the text can't be. */
export function sendable(def: PromptDef, text: string): boolean {
  return missingPlaceholders(def, text).length === 0 && !(def.nonEmpty === true && text.trim() === "");
}

/**
 * Why `text` can't be saved as `def`'s (DESIGN §6.12): a placeholder it doesn't have (today's step
 * templates send one as nothing, so it is flagged rather than lost silently), one it requires that is
 * missing, nothing at all where the text can't be empty, or more than `maxChars` characters.
 */
export function promptProblems(def: PromptDef, text: string, maxChars?: number): PromptProblem[] {
  const out: PromptProblem[] = [];
  const known = new Set(def.vars.map((v) => placeholder(v.name)));
  const flagged = new Set<string>();
  for (const m of text.matchAll(PROMPT_BRACES)) {
    const token = m[0];
    if (known.has(token) || flagged.has(token)) continue;
    flagged.add(token);
    const shown = token.length > 80 ? `${token.slice(0, 77)}…` : token;
    out.push({ code: "unknown_placeholder", message: def.vars.length > 0 ? `${shown} isn't one of this text's placeholders (${def.vars.map((v) => placeholder(v.name)).join(", ")})` : `${shown} isn't a placeholder: this text has none` });
  }
  for (const v of missingPlaceholders(def, text)) out.push({ code: "missing_placeholder", message: `it must keep ${placeholder(v.name)}: ${v.text}` });
  if (def.nonEmpty === true && text.trim() === "") out.push({ code: "empty", message: "it can't be empty" });
  if (maxChars !== undefined && text.length > maxChars) out.push({ code: "too_long", message: `it is longer than the ${maxChars.toLocaleString("en-US")} characters a text of your own may hold` });
  return out;
}

/** Settings → Agents → Prompts (DESIGN §6.12). */
export interface PromptSettings {
  /** The user's own texts by id: only those that differ from the shipped text. */
  texts: Record<string, string>;
  /** The longest text of the user's own, in characters. */
  maxChars: number;
}

/** No texts of the user's own yet; a text of their own may run as long as a step's own prompt does (20,000 characters). */
export const PROMPT_SETTINGS_DEFAULTS: Readonly<PromptSettings> = Object.freeze({ texts: {}, maxChars: 20_000 });

/** What a Re-narrate is sent (Settings → Swipes): the texts its turn was made with, or the user's current ones. */
export type SwipeTexts = "turn" | "current";
export const SWIPE_TEXTS: readonly SwipeTexts[] = ["turn", "current"];

/**
 * `UserSettings.prompts` as stored, checked: a text of a known id kept as written, except one that is
 * the shipped text word for word (not the user's own) or can't be sent (`sendable`: it lacks a
 * placeholder its text requires, or is blank where the text can't be). Length isn't checked here, so
 * lowering the limit never cuts a text already saved; a write past it is refused (`promptsWritten`).
 */
export function promptSettingsOf(raw: unknown, base: Readonly<PromptSettings> = PROMPT_SETTINGS_DEFAULTS): PromptSettings {
  const v = isRecord(raw) ? raw : {};
  const maxChars = typeof v.maxChars === "number" && Number.isInteger(v.maxChars) && v.maxChars >= 1 ? v.maxChars : base.maxChars;
  if (!isRecord(v.texts)) return { texts: { ...base.texts }, maxChars };
  const texts: Record<string, string> = {};
  for (const [id, text] of Object.entries(v.texts)) {
    const def = promptDef(id);
    if (!def || typeof text !== "string" || text === def.text || !sendable(def, text)) continue;
    texts[def.id] = text;
  }
  return { texts, maxChars };
}

/**
 * The prompt settings a write leaves (DESIGN §6.12): each text it changed that can't be saved as
 * written (`promptProblems`: an unknown placeholder, or past the limit in force after the write)
 * stays as it was, so a page or a tool that skipped the checks can't store one.
 */
export function promptsWritten(before: Readonly<PromptSettings>, after: Readonly<PromptSettings>): PromptSettings {
  const texts: Record<string, string> = { ...after.texts };
  for (const [id, now] of Object.entries(after.texts)) {
    const was: string | undefined = before.texts[id];
    const def = promptDef(id);
    if (now === was || !def || promptProblems(def, now, after.maxChars).length === 0) continue;
    if (was === undefined) delete texts[id];
    else texts[id] = was;
  }
  return { texts, maxChars: after.maxChars };
}
