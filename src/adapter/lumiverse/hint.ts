// Lumiverse's own breakdown of a prompt, as the hint for the names of its blocks (STANDALONE-PLAN §4.2, §4.8, the first workaround): the
// breakdown Lumiverse stored with the chat's latest reply that has one (`services/generate.service.ts:4432-4476`; it exists only for a generation that
// saved a message and counted its tokens, lands after `GENERATION_ENDED` and is pushed as `GENERATION_BREAKDOWN_READY`, and goes for every later message
// when one is deleted, `services/chats.service.ts:3236-3240`), or, where there is none, one dry-run assembly of the chat as the generation played is
// asked (`POST /api/v1/generate/dry-run`, `routes/generate.routes.ts:20-43`; its answer carries the breakdown, `generate.service.ts:424-486`).
//
// A dry run builds the whole prompt again, so a reply never waits for one (§22: slow reads are kept off the reply's path): the turn's layout names its
// parts by place, the dry run goes on beside the turn, and its names are kept for the next turn and for the prompt's mapping job, which reads that
// turn's layout named by them (`named`). A dry run's macros are not committed, so a random macro may read differently in it (`generate.service.ts:1131`).

import type { RawLayout } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import { presetMarkers, readBlocksHint, type BlocksHint, withBlocks } from "./layout";
import { readBodyMessages } from "./overlay";
import type { LumiverseReads } from "./reads";
import type { LumiverseSession } from "./session";
import type { ReplyKind, Tag } from "./wire";

/** The default of `lumiverse.dryRun.waitSeconds`: how long a dry run is given before it is let go. */
export const DRY_RUN_MS = 10_000;

export interface HintDeps {
  reads: LumiverseReads;
  session: LumiverseSession;
  log(message: string): void;
  /** The dry run's deadline, read at each dry run (the door's settings); `DRY_RUN_MS` when not given. */
  dryRunMs?: () => number;
}

/** What a tagged reply's layout is given: the names Lumiverse's breakdown holds, where there are any now, and the revision of its preset. */
export interface HintFor {
  hint: BlocksHint | null;
  /** The preset's revision as the adapter reads it (R-18: its update time and its cache revision), where the preset is read. */
  revision: string | null;
}

/** Lumiverse's generation type for a reply kind (`InterceptorGenerationType`). */
const GENERATION_TYPES: Readonly<Record<ReplyKind, string>> = { new: "normal", swipe: "swipe", regenerate: "regenerate", continue: "continue", impersonate: "impersonate" };

interface Kept {
  hint: BlocksHint;
  /** The revision of the preset it was asked for, for a dry run; null for a breakdown Lumiverse made, which names the blocks as that generation had them. */
  revision: string | null;
  /** How many deletes had been heard in the chat when it was made. */
  deletes: number;
}

export class Hints {
  readonly #kept = new Map<string, Kept>();
  /** Deletes heard, by chat, and the chats where one was heard since a breakdown landed: the breakdown stored may be of a prompt that is gone. */
  readonly #deletes = new Map<string, number>();
  readonly #stale = new Set<string>();
  readonly #asking = new Set<string>();

  constructor(private readonly deps: HintDeps) {}

  /** The names of the blocks of the chat's prompt as far as they are known now, never waiting for a dry run; one is started where the hint is missing or out of date. */
  async forReply(tag: Tag): Promise<HintFor> {
    const preset = tag.preset === null ? null : await this.deps.reads.preset(tag.preset).catch(() => null);
    const revision = preset === null ? null : `${preset.updatedAt}.${preset.revision}`;
    const deletes = this.#deletes.get(tag.chat) ?? 0;
    if (!this.#stale.has(tag.chat)) {
      const stored = await this.#stored(tag);
      if (stored !== null) {
        this.#kept.set(tag.chat, { hint: stored, revision: null, deletes });
        return { hint: stored, revision };
      }
    }
    const kept = this.#kept.get(tag.chat);
    const fits = kept !== undefined && kept.hint.presetId === tag.preset && kept.deletes === deletes && (kept.revision === null || kept.revision === revision);
    if (!fits) this.#ask(tag, revision, deletes);
    return { hint: fits ? kept.hint : null, revision };
  }

  /**
   * A turn's layout made before the names of its prompt's blocks were known, named by those found since for its chat (a breakdown, or the dry run
   * that went on beside the turn) where they are of its preset as it then stood: what the prompt's mapping job reads, and the Prompt page. `prompt`:
   * the turn's messages as they were passed on. The layout as it was where it had names already, or none fit.
   */
  named(chat: string, layout: RawLayout, prompt: readonly { role: string; content: string | unknown[] }[]): RawLayout {
    const kept = this.#kept.get(chat);
    const preset = layout.preset;
    if (kept === undefined || layout.blocksFrom !== null || preset === null || kept.hint.presetId !== preset.id) return layout;
    if (kept.revision !== null && preset.revision !== undefined && kept.revision !== preset.revision) return layout;
    const texts = readBodyMessages(prompt)?.map((m) => m.text);
    return texts === undefined ? layout : withBlocks(layout, texts, kept.hint);
  }

  /** A message of the chat was deleted: Lumiverse then drops the breakdowns of every message after it, so the one that is left is of an earlier prompt. */
  deleted(chat: string): void {
    this.#deletes.set(chat, (this.#deletes.get(chat) ?? 0) + 1);
    this.#stale.add(chat);
  }

  /** An event Lumiverse sent: its breakdown, pushed when it lands (`GENERATION_BREAKDOWN_READY`), is the hint from then on. */
  async heard(event: string, payload: unknown): Promise<void> {
    if (event !== "GENERATION_BREAKDOWN_READY" || !isRecord(payload) || typeof payload.chatId !== "string") return;
    const chat = payload.chatId;
    this.#stale.delete(chat);
    const hint = await this.#read(payload.breakdown, null);
    if (hint !== null) this.#kept.set(chat, { hint, revision: null, deletes: this.#deletes.get(chat) ?? 0 });
  }

  /** A breakdown as a hint: its blocks' markers read from the preset it names, where the breakdown's entries do not carry them. */
  async #read(breakdown: unknown, fallbackPreset: string | null): Promise<BlocksHint | null> {
    const preset = isRecord(breakdown) && typeof breakdown.presetId === "string" ? breakdown.presetId : fallbackPreset;
    const markers = preset === null ? new Map<string, string | null>() : presetMarkers((await this.deps.reads.preset(preset))?.promptOrder);
    return readBlocksHint(breakdown, "breakdown", markers);
  }

  async #stored(tag: Tag): Promise<BlocksHint | null> {
    try {
      const breakdown = await this.deps.reads.breakdown(tag.chat);
      return breakdown === null ? null : await this.#read(breakdown, tag.preset);
    } catch (error) {
      this.deps.log(`Lumiverse's breakdown of chat ${tag.chat} was not read: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /** One dry run of the chat at a time, asked for the generation played (its type, its message and its speaker), kept when it lands. */
  #ask(tag: Tag, revision: string | null, deletes: number): void {
    if (this.#asking.has(tag.chat)) return;
    this.#asking.add(tag.chat);
    const body = {
      chat_id: tag.chat,
      connection_id: tag.connection,
      generation_type: GENERATION_TYPES[tag.kind],
      ...(tag.target.message !== null ? { message_id: tag.target.message } : {}),
      ...(tag.speaker.id !== null ? { target_character_id: tag.speaker.id } : {}),
      ...(tag.preset !== null ? { preset_id: tag.preset } : {}),
      ...(tag.persona !== null ? { persona_id: tag.persona } : {}),
    };
    this.deps.session
      .json("POST", "/api/v1/generate/dry-run", body, AbortSignal.timeout(this.deps.dryRunMs?.() ?? DRY_RUN_MS))
      .then((answer) => {
        const hint = readBlocksHint(answer, "dry-run");
        // A dry run's answer does not name its preset: it is the one asked for.
        if (hint !== null) this.#kept.set(tag.chat, { hint: { ...hint, presetId: hint.presetId ?? tag.preset }, revision, deletes });
      })
      .catch((error: unknown) => this.deps.log(`Lumiverse's dry run of chat ${tag.chat} gave no names for its prompt's blocks: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => this.#asking.delete(tag.chat));
  }
}
