// The chat's preset as the story engine reads it (DEPTH2-PLAN §7). The engine reads the blocks of
// the preset Lumiverse generates the chat with (`presets.getActive`, with the block states its
// bindings set) and gives each agent its part, its macros resolved by Lumiverse's own engine: a
// story contract every agent reads; the author's direction; how to be a person, for characters;
// rulings for the game master; prose for the narrator; how lines are written, which the narrator
// reads with its prose and a character answering on the direct line with its own part; and
// presentation modules, listed for the author by name with one line each, whose text is given only
// for the modules asked for.
//
// A block's part comes from its category's name by a mapping that is a setting
// (`StoryPresetSettings.categories`, matched by `storyCategoryKey`); a block in no category the
// mapping names is the narrator's. A block's category is the one the preset editor files it under:
// the header above it, unless the block names another or none (`group`). A block is left out as
// prompt assembly leaves it out: switched off (after the chat's block states, and under a radio
// category all but its first switched-on block), for another generation type, or for other
// characters' tags. Its `//` note lines are the preset writer's and never sent, as the older
// engines' guidance blocks skip them; a module's first note line is its line in the author's list.
// Each part has a size limit: a block that would pass it is left out whole, and the read names it.
//
// Card markers give the card's text in their category's part, as prompt assembly puts it there;
// the chat history and lore markers give nothing (the engine gives its agents beats and recent
// prose itself, and lore is pulled with tools). The card's own post-history instructions go to the
// narrator unless a block names them, as assembly appends them unless a block does.
//
// Macros resolve on the path an extension has (`macros.resolve`, committing nothing), which knows
// the chat's character, persona, chat and messages and none of prompt assembly's own state. The
// reader gives it the preset's variables as assembly computes them (each switched-on block's
// definitions over the values the preset's user saved), seeded so {{var}}, {{getvar}}, {{hasVar}}
// and {{.name}} read them, and answers each multiselect `ison` query itself before the text is
// sent. Every block is resolved in one pass in the preset's order, as assembly does, so a variable
// one block sets is there for the blocks after it. A block whose braces don't match is resolved on
// its own (in one pass it would reach into the blocks after it, as it never does in assembly), and
// when the pass can't be split back into its blocks, each block is resolved on its own. Still empty
// on this path: {{varDefault}}; values a preset profile binding sets for the chat (an extension
// can't read them); Sovereign Hand's and Loom's macros ({{loomSovHand}} and the rest); lore
// ({{outlet}}, world info markers); memories, databank and Cortex; reasoning, council, OOC and
// Lumia macros; the context sizes; and a preset's activation scripts, which an extension can't run.

import type { ChatId, UserId } from "../../shared/ids";
import { PRESET_NOTE } from "../../shared/harness-texts-preset";
import type { PromptTexts } from "../../shared/prompts";
import { type StoryPart, type StoryPresetSettings, storyCategoryKey } from "../../shared/settings";
import type { HostPort, HostPresetBlock, HostPromptValues, HostPromptVariable } from "../host";
import { renderPrompt } from "../prompts";

/** What the reader asks of the host: the preset Lumiverse generates the chat with, its blocks and saved values, and its macro engine. A `HostPort` is one. */
export interface StoryPresetHost {
  presets: Pick<HostPort["presets"], "active" | "get" | "blocks">;
  macros: HostPort["macros"];
}

/** A part given as text: every part but the modules, which are given one by one. */
export type StoryTextPart = Exclude<StoryPart, "module">;

/** Who reads the preset: each agent, and `direct`, a character whose answer is the reply on the direct line. */
export type StoryReader = "author" | "character" | "direct" | "gm" | "narrator";

/** A presentation module: its name, its line in the author's list, and its text, given only when it is asked for. */
export interface StoryModule {
  name: string;
  line: string;
  text: string;
}

/** What the chat's preset gives the story engine's agents. */
export interface StoryPresetRead {
  /** The preset read; null when the chat generates with none, and then every part is empty. */
  preset: { id: string; name: string; revision: number } | null;
  /** Each part's text: its blocks in the preset's order, a blank line between them. */
  parts: Readonly<Record<StoryTextPart, string>>;
  /** The modules in the preset's order: those whose text is empty, too long or past the list's room are not among them. */
  modules: readonly StoryModule[];
  /** Blocks left out because they would pass their part's limit (`module`: a module's own, or the list's room). */
  over: readonly { part: StoryPart; block: string; chars: number }[];
  /** True when the one pass couldn't be split back into its blocks, so each was resolved alone, without the variables an earlier block sets. */
  separately: boolean;
  /** What Lumiverse's macro engine and the reader said besides, once each. */
  diagnostics: readonly string[];
}

const TEXT_PARTS: readonly StoryTextPart[] = ["contract", "author", "character", "gm", "narrator", "voice"];

/** What each reader is given, in the order it reads it. */
const READS: Readonly<Record<StoryReader, readonly StoryTextPart[]>> = {
  author: ["contract", "author"],
  character: ["contract", "character"],
  direct: ["contract", "character", "voice"],
  gm: ["contract", "gm"],
  narrator: ["contract", "voice", "narrator"],
};

/** Card markers: the card's text prompt assembly puts in their place. */
const CARD_MARKERS: Readonly<Record<string, string>> = {
  char_description: "{{description}}",
  char_personality: "{{personality}}",
  scenario: "{{scenario}}",
  persona_description: "{{persona}}",
  dialogue_examples: "{{mesExamples}}",
};

/** Markers that give nothing here: the chat's history and its lore, which the engine gives its agents in its own way. */
const NOTHING_MARKERS: Readonly<Record<string, true>> = { chat_history: true, world_info_before: true, world_info_after: true };

/** A block naming the card's post-history instructions: prompt assembly's own test. */
const NAMES_PHI = /\{\{\s*(?:jailbreak|charJailbreak|charInstruction|charPostHistoryInstructions)\s*(?:\}\}|::)/i;

/** A multiselect query, {{var::name::ison::key,key}}, with the macro's aliases. */
const ISON = /\{\{\s*(?:var|promptVar|presetVar)::([^:{}]+?)::\s*ison\s*::([^{}]*?)\}\}/gi;

/** The most diagnostics a read keeps. */
const MAX_DIAGNOSTICS = 20;

const NO_PARTS: Readonly<Record<StoryTextPart, string>> = Object.freeze({ contract: "", author: "", character: "", gm: "", narrator: "", voice: "" });

/** One piece of the pass: a block's text for its part, or the card's post-history instructions. */
interface Piece {
  part: StoryPart;
  name: string;
  /** The text sent: notes left out, card markers given their macro, multiselect queries answered. */
  text: string;
  /** Its own variables' values, set while it resolves and put back after (assembly's overlay). */
  own: ReadonlyMap<string, string>;
  /** A module's first note line. */
  note: string;
}

/** The preset's variables as prompt assembly computes them: the values every block reads, each block's own, and each multiselect's chosen options. */
interface Variables {
  flat: Map<string, string>;
  byBlock: Map<string, Map<string, string>>;
  chosen: Map<string, string[]>;
  chosenByBlock: Map<string, Map<string, string[]>>;
}

/**
 * The chat's preset as the story engine's agents read it (DEPTH2-PLAN §7): one read of the preset
 * through the host and one pass of Lumiverse's macro engine (one more for the character's tags when
 * a block is for some tags only; one call a block when the pass can't be split). Throws a plain
 * sentence when Lumiverse names a preset that is gone.
 */
export async function readStoryPreset(host: StoryPresetHost, chatId: ChatId, userId: UserId, settings: Readonly<StoryPresetSettings>, generationType = "normal"): Promise<StoryPresetRead> {
  const active = await host.presets.active(chatId, userId);
  if (active.presetId === null) return { preset: null, parts: NO_PARTS, modules: [], over: [], separately: false, diagnostics: [] };
  const preset = await host.presets.get(active.presetId, userId);
  if (!preset) throw new Error(`the preset Lumiverse names for this chat (${active.presetId}) is gone`);
  const stated = (await host.presets.blocks(preset.id, userId)).map((b) => (Object.hasOwn(active.blockStates, b.id) ? { ...b, enabled: active.blockStates[b.id] === true } : b));
  const blocks = radioKept(stated);
  const diagnostics = new Set<string>();
  const variables = presetVariables(blocks, preset.values ?? {});

  const partOf = new Map<string, StoryPart>();
  for (const [name, part] of Object.entries(settings.categories)) {
    const key = storyCategoryKey(name);
    if (key !== "" && !partOf.has(key)) partOf.set(key, part);
  }
  let pieces: (Piece & { block: HostPresetBlock })[] = [];
  let header: HostPresetBlock | null = null;
  for (const b of blocks) {
    if (b.marker === "category") header = b;
    else if (b.group !== undefined && b.group !== (header?.id ?? null)) header = null;
    if (!b.enabled || (b.injectionTrigger.length > 0 && !b.injectionTrigger.includes(generationType))) continue;
    if (b.marker !== null && Object.hasOwn(NOTHING_MARKERS, b.marker)) continue;
    const card = b.marker !== null && Object.hasOwn(CARD_MARKERS, b.marker) ? CARD_MARKERS[b.marker] : undefined;
    // Its `//` note lines are the preset writer's own, never sent.
    const text = card ?? b.content.split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
    if (text.trim() === "") continue;
    const part = header ? (partOf.get(storyCategoryKey(header.name)) ?? "narrator") : "narrator";
    pieces.push({ block: b, part, name: b.name.trim(), text: answerQueries(text, b.id, variables), own: variables.byBlock.get(b.id) ?? new Map(), note: firstNote(b.content) });
  }
  if (pieces.some((p) => p.block.characterTagTrigger.length > 0)) {
    const said = await host.macros.resolve("{{charTags}}", chatId, userId);
    const tags = said.text.split(",").map((t) => t.trim()).filter((t) => t !== "");
    pieces = pieces.filter((p) => matchesTags(p.block.characterTagTrigger, tags));
  }
  const all: Piece[] = [...pieces];
  if (!pieces.some((p) => NAMES_PHI.test(p.text))) all.push({ part: "narrator", name: "Post-history instructions", text: "{{charPostHistoryInstructions}}", own: new Map(), note: "" });

  const seeds = [...variables.flat].map(([name, value]) => seed(name, value, diagnostics)).join("");
  const sent = all.map((p) => [...p.own].map(([name, value]) => seed(name, value, diagnostics)).join("") + p.text + [...p.own.keys()].map((name) => seed(name, variables.flat.get(name) ?? "", diagnostics)).join(""));
  // A block whose braces don't pair would reach into the blocks after it in one pass, as it never does in assembly: it is resolved on its own.
  const alone = sent.map((t) => t.split("{{").length !== t.split("}}").length);
  all.forEach((p, i) => {
    if (alone[i]) diagnostics.add(`The preset's block "${p.name}" has a macro whose braces don't match, so it was read on its own.`);
  });
  const nonce = crypto.randomUUID().slice(0, 8);
  const mark = (i: number): string => `\u27E6${nonce}:${i}\u27E7`;
  const pass = await host.macros.resolve(`${seeds}${sent.map((t, i) => `${mark(i)}\n${alone[i] ? "" : t}\n`).join("")}${mark(sent.length)}`, chatId, userId);
  for (const d of pass.diagnostics) diagnostics.add(d);
  const split = splitPass(pass.text, sent.length, mark);
  const separately = split === null;
  const resolved: string[] = [];
  for (const [i, t] of sent.entries()) {
    if (split !== null && !alone[i]) {
      resolved.push(split[i] ?? "");
      continue;
    }
    const one = await host.macros.resolve(`${seeds}${t}`, chatId, userId);
    for (const d of one.diagnostics) diagnostics.add(d);
    resolved.push(one.text);
  }

  const limits = settings.limits;
  const texts: Record<StoryTextPart, string[]> = { contract: [], author: [], character: [], gm: [], narrator: [], voice: [] };
  const used: Record<StoryTextPart, number> = { contract: 0, author: 0, character: 0, gm: 0, narrator: 0, voice: 0 };
  const over: { part: StoryPart; block: string; chars: number }[] = [];
  const modules: StoryModule[] = [];
  const named = new Set<string>();
  let listed = 0;
  all.forEach((p, i) => {
    // The blank lines macros leave behind, closed up.
    const text = (resolved[i] ?? "").replace(/(?:[ \t]*\n){3,}/g, "\n\n").trim();
    if (text === "") return;
    if (p.part === "module") {
      const key = storyCategoryKey(p.name);
      if (key === "" || named.has(key)) return;
      const line = cut(p.note !== "" ? p.note : (text.split("\n").find((l) => l.trim() !== "") ?? "").trim(), limits.line);
      const entry = `- ${p.name}${line !== "" ? `: ${line}` : ""}`;
      if (text.length > limits.module || listed + entry.length + (listed > 0 ? 1 : 0) > limits.list) {
        over.push({ part: "module", block: p.name, chars: text.length });
        return;
      }
      named.add(key);
      listed += entry.length + (listed > 0 ? 1 : 0);
      modules.push({ name: p.name, line, text });
      return;
    }
    const add = text.length + (used[p.part] > 0 ? 2 : 0);
    if (used[p.part] + add > limits[p.part]) {
      over.push({ part: p.part, block: p.name, chars: text.length });
      return;
    }
    texts[p.part].push(text);
    used[p.part] += add;
  });
  const parts = Object.fromEntries(TEXT_PARTS.map((part) => [part, texts[part].join("\n\n")])) as Record<StoryTextPart, string>;
  return { preset: { id: preset.id, name: preset.name, revision: preset.revision }, parts, modules, over, separately, diagnostics: [...diagnostics].slice(0, MAX_DIAGNOSTICS) };
}

/** The module named `name` (case, spacing and marks ignored), or null when the preset has none of that name. */
export function findModule(read: StoryPresetRead, name: string): StoryModule | null {
  const key = storyCategoryKey(name);
  return read.modules.find((m) => storyCategoryKey(m.name) === key) ?? null;
}

/**
 * What `reader` is given of the preset: the contract, then its own parts; the author, the list of
 * the presentation modules too; the narrator and a character on the direct line, the text of each
 * module `asked` names. A name no module has is `refused`, in a sentence that names the modules
 * there are; the others are given.
 */
export function presetFor(read: StoryPresetRead, reader: StoryReader, texts: PromptTexts, asked: readonly string[] = []): { text: string; refused: string | null } {
  const out = READS[reader].map((part) => read.parts[part]).filter((t) => t !== "");
  if (reader === "author" && read.modules.length > 0) out.push(renderPrompt(PRESET_NOTE.modules, texts, { modules: read.modules.map((m) => `- ${m.name}${m.line !== "" ? `: ${m.line}` : ""}`).join("\n") }));
  let refused: string | null = null;
  if (reader === "narrator" || reader === "direct") {
    const given: StoryModule[] = [];
    const missing: string[] = [];
    for (const name of asked) {
      const m = findModule(read, name);
      if (!m) missing.push(name);
      else if (!given.includes(m)) given.push(m);
    }
    out.push(...given.map((m) => m.text));
    if (missing.length > 0) refused = renderPrompt(PRESET_NOTE.noModule, texts, { names: missing.join(", "), modules: read.modules.length > 0 ? read.modules.map((m) => m.name).join(", ") : "none" });
  }
  return { text: out.join("\n\n"), refused };
}

/** Each reader's text of the preset (`presetFor`, no module asked for): what each agent's definition carries. */
export function presetParts(read: StoryPresetRead, texts: PromptTexts): Readonly<Record<StoryReader, string>> {
  return { author: presetFor(read, "author", texts).text, character: presetFor(read, "character", texts).text, direct: presetFor(read, "direct", texts).text, gm: presetFor(read, "gm", texts).text, narrator: presetFor(read, "narrator", texts).text };
}

// ---------------------------------------------------------------- the blocks

/** Under a radio category, only its first switched-on block stays on (Lumiverse's `normalizeCategoryBlockStates`, by position). */
function radioKept(blocks: readonly HostPresetBlock[]): HostPresetBlock[] {
  let radio = false;
  let kept = false;
  return blocks.map((b) => {
    if (b.marker === "category") {
      radio = b.categoryMode === "radio";
      kept = false;
      return b;
    }
    if (!radio || !b.enabled) return b;
    if (kept) return { ...b, enabled: false };
    kept = true;
    return b;
  });
}

/** A block's first `//` note line, its slashes left out. */
function firstNote(content: string): string {
  const line = content.split("\n").find((l) => l.trimStart().startsWith("//"));
  return line === undefined ? "" : line.trimStart().replace(/^\/\/+/, "").trim();
}

/** A tag in Lumiverse's form for matching: compatibility-normalized, lower case, its separators left out. */
function tagKey(tag: string): string {
  return tag.normalize("NFKC").trim().toLowerCase().replace(/[\s._\-:/\\|()[\]{}+,;'"`~!?@#$%^&*=<>]+/g, "");
}

/** Whether a block for `trigger`'s tags is for a character with `tags` (Lumiverse's `promptBlockMatchesCharacterTags`). */
function matchesTags(trigger: readonly string[], tags: readonly string[]): boolean {
  const wanted = trigger.map(tagKey).filter((t) => t !== "");
  if (wanted.length === 0) return true;
  const have = tags.map(tagKey).filter((t) => t !== "");
  return have.some((t) => wanted.some((w) => t.includes(w)));
}

// ---------------------------------------------------------------- variables

/** Each switched-on block's variables over the preset's saved values (Lumiverse's `resolvePromptVariables`): a later block's value of a name wins. */
function presetVariables(blocks: readonly HostPresetBlock[], values: HostPromptValues): Variables {
  const out: Variables = { flat: new Map(), byBlock: new Map(), chosen: new Map(), chosenByBlock: new Map() };
  for (const b of blocks) {
    if (!b.enabled || !b.variables || b.variables.length === 0) continue;
    const saved = Object.hasOwn(values, b.id) ? values[b.id] : undefined;
    const own = new Map<string, string>();
    const chosen = new Map<string, string[]>();
    for (const def of b.variables) {
      const value = coerce(def, saved && Object.hasOwn(saved, def.name) ? saved[def.name] : undefined);
      own.set(def.name, value.rendered);
      out.flat.set(def.name, value.rendered);
      if (def.type === "multiselect") {
        chosen.set(def.name, value.chosen);
        out.chosen.set(def.name, value.chosen);
      }
    }
    out.byBlock.set(b.id, own);
    if (chosen.size > 0) out.chosenByBlock.set(b.id, chosen);
  }
  return out;
}

/** A variable's value from what was saved for it, else its default, as Lumiverse coerces it (`coercePromptVariable`): what macros read, and a choice's chosen option ids. */
function coerce(def: HostPromptVariable, raw: unknown): { rendered: string; chosen: string[] } {
  const num = (x: unknown, fallback: number): number => {
    const n = x === undefined || x === null ? fallback : Number(x);
    return clamp(Number.isFinite(n) ? n : fallback, def.min, def.max);
  };
  switch (def.type) {
    case "text":
    case "textarea":
      return { rendered: raw === undefined || raw === null ? (typeof def.defaultValue === "string" ? def.defaultValue : "") : String(raw), chosen: [] };
    case "number":
    case "slider":
      return { rendered: String(num(raw, typeof def.defaultValue === "number" ? def.defaultValue : 0)), chosen: [] };
    case "range": {
      const lo = def.min ?? 0;
      const hi = def.max ?? 0;
      const fallback = rangeOf(def.defaultValue, [lo, hi], def);
      const [a, b] = rangeOf(raw, fallback, def);
      return { rendered: `${a}, ${b}`, chosen: [] };
    }
    case "select": {
      const options = def.options ?? [];
      const ids = options.map((o) => o.id);
      const fallback = typeof def.defaultValue === "string" && ids.includes(def.defaultValue) ? def.defaultValue : (options[0]?.id ?? "");
      const candidate = raw === undefined || raw === null ? fallback : String(raw);
      const id = ids.includes(candidate) ? candidate : fallback;
      return { rendered: options.find((o) => o.id === id)?.value ?? "", chosen: id !== "" ? [id] : [] };
    }
    case "switch": {
      if (raw === undefined || raw === null) return { rendered: def.defaultValue === 1 ? "1" : "0", chosen: [] };
      const on = typeof raw === "boolean" ? raw : typeof raw === "number" ? raw === 1 : ["1", "true", "on", "yes"].includes(String(raw).trim().toLowerCase());
      return { rendered: on ? "1" : "0", chosen: [] };
    }
    case "multiselect": {
      const options = def.options ?? [];
      const picked = Array.isArray(raw) ? raw.map(String) : raw === undefined || raw === null ? (Array.isArray(def.defaultValue) ? def.defaultValue.map(String) : []) : typeof raw === "string" && raw !== "" ? raw.split(",").map((s) => s.trim()).filter((s) => s !== "") : [];
      const kept = options.filter((o) => picked.includes(o.id));
      return { rendered: kept.map((o) => o.value).join(typeof def.separator === "string" ? def.separator : "\n\n"), chosen: kept.map((o) => o.id) };
    }
  }
}

function clamp(n: number, min: number | undefined, max: number | undefined): number {
  return typeof min === "number" && n < min ? min : typeof max === "number" && n > max ? max : n;
}

/** A range's two ends as Lumiverse keeps them: each clamped, the lower first; `fallback` for anything else. */
function rangeOf(x: unknown, fallback: readonly [number, number], def: HostPromptVariable): [number, number] {
  if (!Array.isArray(x) || x.length !== 2) return [fallback[0], fallback[1]];
  const a = Number(x[0]);
  const b = Number(x[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return [fallback[0], fallback[1]];
  const lo = clamp(a, def.min, def.max);
  const hi = clamp(b, def.min, def.max);
  return lo <= hi ? [lo, hi] : [hi, lo];
}

/** `text` with each multiselect query answered as Lumiverse answers it: true when every key named is chosen (none named: true), false for anything that isn't a multiselect. A block's own variable answers before the others'. */
function answerQueries(text: string, blockId: string, variables: Variables): string {
  return text.replace(ISON, (_, rawName: string, rawKeys: string) => {
    const name = rawName.trim();
    const keys = rawKeys.split(",").map((k) => k.trim()).filter((k) => k !== "");
    if (keys.length === 0) return "true";
    const chosen = variables.chosenByBlock.get(blockId)?.get(name) ?? variables.chosen.get(name);
    return chosen !== undefined && keys.every((k) => chosen.includes(k)) ? "true" : "false";
  });
}

/** A variable set for the macros that follow; a name or value the macro syntax can't carry is left unset, and said once. */
function seed(name: string, value: string, diagnostics: Set<string>): string {
  if (name.includes("::") || name.includes("{") || name.includes("}") || value.includes("{{/setvar}}")) {
    diagnostics.add(`The preset's variable "${name}" can't be passed to Lumiverse's macros here, so it reads as empty.`);
    return "";
  }
  return `{{setvar::${name}}}${value}{{/setvar}}`;
}

// ---------------------------------------------------------------- the pass

/** The pass's text cut back into its pieces at the marks between them, or null when a mark is missing, repeated or out of order. */
function splitPass(text: string, count: number, mark: (i: number) => string): string[] | null {
  const at: number[] = [];
  for (let i = 0; i <= count; i++) {
    const m = mark(i);
    const first = text.indexOf(m);
    if (first < 0 || text.indexOf(m, first + m.length) >= 0 || (i > 0 && first < (at[i - 1] ?? 0))) return null;
    at.push(first);
  }
  return at.slice(0, count).map((start, i) => text.slice(start + mark(i).length, at[i + 1]));
}

/** `text` cut at a word to at most `max` characters. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const space = text.lastIndexOf(" ", max);
  return text.slice(0, space > max / 2 ? space : max).trimEnd();
}
