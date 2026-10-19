// What the active preset says in world chats (DESIGN §6.8; docs/PRESETS.md). A preset may place the
// engine's sections itself: `{{outlet::lre_<slot>}}` in an enabled block routes that section to the
// outlet for the generation, through the section's outlet twin in the world's book, and
// `{{outlet::lre_narrator}}` the narrator rules. Switched-off blocks named "RPEngine · <step>" give
// that helper style and rules, appended to its prompt after the world's step template or the built-in
// one, and "RPEngine · narrator" gives the narrator rules for world chats only. The engine reads them as
// text: it resolves no host macro in them (their braces are neutralized), skips their `//` note lines
// and bounds their length. Each preset revision is read once.
//
// The preset is the one the host assembles with, as far as the engine can tell: the active Loom preset,
// which only the frontend can read (`loom.activePresetId`, sent with each hello and when it changes),
// else the preset the generation's connection links, else the one the chat's last reply was assembled
// with. Presets and block states the host binds to a chat, persona, character or connection aren't
// visible to the engine.

import type { ChatId, UserId } from "../shared/ids";
import { neutralizeMacros } from "../shared/macros";
import type { StepPurpose } from "../shared/world";
import type { HostPort, HostPresetBlock } from "./host";

/** What a preset may guide: each helper step, and the narrator. */
export type GuidanceTarget = StepPurpose | "narrator";

/** In the order Settings lists them. */
export const GUIDANCE_TARGETS: readonly GuidanceTarget[] = ["interpret", "extract", "brief", "outline", "choices", "npc.choose", "judge", "contradiction", "puzzle.answer", "mind", "memory", "skip", "consolidate", "narrator"];

/** A guidance block's name is this and its target: "RPEngine · extract". */
export const GUIDANCE_PREFIX = "RPEngine · ";

/** The category "Add RPEngine blocks" files them under. */
export const GUIDANCE_CATEGORY = "RPEngine";

/** The most of a block the engine reads (its notes left out): style and rules, not pages. */
export const GUIDANCE_MAX_CHARS = 1500;

/** The outlet the narrator rules go to when the preset names it. */
export const NARRATOR_OUTLET = "lre_narrator";

export type Guidance = Readonly<Partial<Record<GuidanceTarget, string>>>;

/** A guidance block as Settings shows it: not in the preset, switched off with nothing to read (or text the engine reads), or switched on, which the engine doesn't read. */
export type GuidanceState = "missing" | "empty" | "read" | "enabled";

export interface PresetConfig {
  /** The preset world chats assemble with and the revision read; null when the engine can't tell. */
  preset: { id: string; name: string; revision: number } | null;
  /** The `lre_` outlets its enabled blocks hold, lowercase, as the host matches them. */
  outlets: ReadonlySet<string>;
  guidance: Guidance;
  blocks: Readonly<Record<GuidanceTarget, GuidanceState>>;
}

const MISSING = Object.fromEntries(GUIDANCE_TARGETS.map((t) => [t, "missing"])) as Record<GuidanceTarget, GuidanceState>;

export const NO_PRESET: PresetConfig = { preset: null, outlets: new Set(), guidance: {}, blocks: MISSING };

/** The outlet a section's twin fills: `lre_<slot>`, lowercase as the host matches it. */
export function outletOf(slot: string): string {
  return `lre_${slot}`.toLowerCase();
}

/** The host's own outlet pattern (src/services/prompt-assembly.service.ts resolveWorldInfoOutlets). */
const OUTLET = /\{\{outlet::([^}]*)\}\}/gi;

/** A guidance block's text as the engine reads it: its `//` note lines left out, cut at a word to `GUIDANCE_MAX_CHARS`, its macros neutralized. */
export function guidanceText(content: string): string {
  const text = content
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= GUIDANCE_MAX_CHARS) return neutralizeMacros(text);
  const space = text.lastIndexOf(" ", GUIDANCE_MAX_CHARS);
  return neutralizeMacros(text.slice(0, space > GUIDANCE_MAX_CHARS / 2 ? space : GUIDANCE_MAX_CHARS).trimEnd());
}

/**
 * What a preset's blocks say (pure). The first block of a guidance name counts. A section is routed
 * only to an outlet in a block the host assembles in every prompt: switched on, for every generation
 * type and every character, and under a radio category only its first switched-on block, the one the
 * host keeps. A section routed to an outlet some prompts leave out would go missing from them.
 */
export function readPreset(blocks: readonly HostPresetBlock[]): Omit<PresetConfig, "preset"> {
  const outlets = new Set<string>();
  const guidance: Partial<Record<GuidanceTarget, string>> = {};
  const states = { ...MISSING };
  let radio = false;
  let chosen = false;
  for (const b of blocks) {
    if (b.marker === "category") {
      radio = b.categoryMode === "radio";
      chosen = false;
      continue;
    }
    if (b.enabled) {
      const assembled = !(radio && chosen) && b.injectionTrigger.length === 0 && b.characterTagTrigger.length === 0;
      if (radio) chosen = true;
      if (assembled) {
        for (const m of b.content.matchAll(OUTLET)) {
          const name = (m[1] ?? "").trim().toLowerCase();
          if (name.startsWith("lre_")) outlets.add(name);
        }
      }
    }
    const name = b.name.trim().replace(/\s+/g, " ").toLowerCase();
    const target = GUIDANCE_TARGETS.find((t) => name === `${GUIDANCE_PREFIX}${t}`.toLowerCase());
    if (!target || states[target] !== "missing") continue;
    // A switched-on block already reaches the narrator in every chat; the engine reads only switched-off ones.
    if (b.enabled) {
      states[target] = "enabled";
      continue;
    }
    const text = guidanceText(b.content);
    states[target] = text === "" ? "empty" : "read";
    if (text !== "") guidance[target] = text;
  }
  return { outlets, guidance, blocks: states };
}

/** What each block "Add RPEngine blocks" makes says it is for, in `//` notes the engine skips, so it reads as empty until written. */
const STARTER: Record<GuidanceTarget, string> = {
  interpret: "It reads the player's typed message and picks the engine action it describes. Say how messages read with this preset: who \"I\" and \"you\" are, how actions are marked (*asterisks*, brackets), what is only speech.",
  extract: "It reads the narrator's reply for what changed: money, places, time, things, who learned what. Say how this preset's narrator writes: person and tense, any tags or trackers it adds, what it tells that doesn't happen (dreams, plans, offers).",
  brief: "It briefs the narrator in a few sentences before each reply. Say what this preset wants stressed, and what to leave to the narrator.",
  outline: "It outlines the narrator's next reply in a few beats. Say how this preset paces a reply and how much happens in one.",
  choices: "It suggests a few things the player could do next. Say their tone, length and person (\"I go…\", \"You go…\").",
  "npc.choose": "It picks what NPCs do on close calls. Say how this preset's characters behave: how bold or kind, what they would never do.",
  judge: "It rates how well the player's described approach suits the action. Say how generous to be, and what a good plan looks like in this preset's genre.",
  contradiction: "It checks the reply against the engine's facts. Say what this preset's narrator may add without it counting (weather, small talk, inner thoughts).",
  "puzzle.answer": "It judges whether a typed answer matches a puzzle's. Say how loose to be about wording and spelling.",
  mind: "It thinks as one character at a time, from only what that character knows, and gives the narrator their mind. Say how this preset's characters think: how candid, how scheming, how far ahead they plan.",
  memory: "It writes down, as each character, what they will remember of a reply. Say what this preset's characters hold on to: slights, kindnesses, money, promises.",
  skip: "It finds the moments worth stopping at inside a time skip. Say how often this preset wants a skip interrupted.",
  consolidate: "It folds a character's older notes into their summary. Say what a summary should keep in this preset's story.",
  narrator:
    "In world chats the engine gives this to the narrator with its sections, before the character, or where an enabled block holds {{outlet::lre_narrator}}. Write rules for using the sections: trust the Outcome and narrate the result it states, invent no prices or events.",
};

function starterText(target: GuidanceTarget): string {
  const helper = target === "narrator" ? "the narrator" : `its ${target} helper`;
  return [`// LumiRPEngine reads this block while it stays switched off and, in world chats, gives what you write below to ${helper} as style and rules. Lines starting with // are notes it skips.`, `// ${STARTER[target]}`, ""].join("\n");
}

/** The active preset's say, read once per preset revision. */
export class PresetBinding {
  /** What each revision says, by `user \0 preset \0 revision`. */
  private readonly said = new Map<string, Omit<PresetConfig, "preset">>();
  /** Each user's latest read, for a read of a reply that had no pre phase. */
  private readonly latest = new Map<UserId, PresetConfig>();
  /** Each user's active Loom preset, as their frontend last reported it (null: none is active). */
  private readonly loom = new Map<UserId, string | null>();

  constructor(private readonly host: HostPort) {}

  /** The frontend's report of the user's active Loom preset (`loom.activePresetId`). */
  useLoom(userId: UserId, presetId: string | null): void {
    this.loom.delete(userId);
    this.loom.set(userId, presetId);
    if (this.loom.size > 1024) this.loom.delete(this.loom.keys().next().value ?? "");
  }

  /** The preset prompts assemble with, in the host's order: the active Loom preset, else the one the generation's connection links, else the one the chat's last reply used. */
  private async resolve(chatId: ChatId | null, userId: UserId, connectionId: string | null): Promise<{ id: string; name: string; revision: number } | null> {
    const candidates = [async () => this.loom.get(userId) ?? null, async () => (connectionId ? this.host.presets.ofConnection(connectionId, userId) : null), async () => (chatId ? this.host.presets.lastUsed(chatId, userId) : null)];
    for (const candidate of candidates) {
      const id = await candidate();
      // One that no longer exists (deleted since) is skipped for the next.
      const preset = id ? await this.host.presets.get(id, userId) : null;
      if (preset) return preset;
    }
    return null;
  }

  /** What the preset prompts assemble with says now; nothing when the engine can't tell (logged). `connectionId` is the generation's, when it has one. */
  async current(chatId: ChatId | null, userId: UserId, connectionId: string | null = null): Promise<PresetConfig> {
    try {
      const preset = await this.resolve(chatId, userId, connectionId);
      if (!preset) return NO_PRESET;
      const key = `${userId}\u0000${preset.id}\u0000${preset.revision}`;
      let said = this.said.get(key);
      if (!said) {
        said = readPreset(await this.host.presets.blocks(preset.id, userId));
        this.said.set(key, said);
        if (this.said.size > 64) this.said.delete(this.said.keys().next().value ?? "");
      }
      const config = { preset, ...said };
      this.latest.set(userId, config);
      if (this.latest.size > 256) this.latest.delete(this.latest.keys().next().value ?? "");
      return config;
    } catch (error) {
      this.host.log("warn", `[LumiRPEngine] the active preset couldn't be read (${error instanceof Error ? error.message : String(error)}); the world places every section and no helper gets the preset's guidance`, userId);
      return NO_PRESET;
    }
  }

  /** What the user's latest read found (nothing before one), without asking the host. */
  last(userId: UserId): PresetConfig {
    return this.latest.get(userId) ?? NO_PRESET;
  }

  /**
   * Adds the guidance blocks the active preset lacks, switched off and holding only their notes, under
   * an "RPEngine" category: after the category's last block when the preset has one, else in a new one
   * at the end. Null when there is no active preset.
   */
  async addBlocks(chatId: ChatId | null, userId: UserId): Promise<PresetConfig | null> {
    const preset = await this.resolve(chatId, userId, null);
    if (!preset) return null;
    const blocks = await this.host.presets.blocks(preset.id, userId);
    const missing = GUIDANCE_TARGETS.filter((t) => readPreset(blocks).blocks[t] === "missing");
    if (missing.length > 0) {
      const category = blocks.findIndex((b) => b.marker === "category" && b.name.trim() === GUIDANCE_CATEGORY);
      const next = category < 0 ? -1 : blocks.findIndex((b, i) => i > category && b.marker === "category");
      const added = missing.map((target) => ({ kind: "text" as const, name: `${GUIDANCE_PREFIX}${target}`, content: starterText(target) }));
      // One write: a new category at the end with the blocks after it, or the blocks after the category's last one.
      await this.host.presets.insertBlocks(preset.id, preset.revision, category < 0 || next < 0 ? null : next, category < 0 ? [{ kind: "category", name: GUIDANCE_CATEGORY }, ...added] : added, userId);
    }
    return this.current(chatId, userId);
  }
}
