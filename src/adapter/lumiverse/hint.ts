// Lumiverse's own breakdown of a prompt, as the hint for the names of its blocks (STANDALONE-PLAN §4.2,
// §4.8, the first workaround): the breakdown Lumiverse stored with the chat's latest reply
// (`services/generate.service.ts:4448-4476`), or, before any is stored, one dry-run assembly of the chat
// on the same connection, preset and persona (`POST /api/v1/generate/dry-run`, `routes/generate.routes.ts
// :20-43`; its answer carries the breakdown, `generate.service.ts:424-486`). A dry run builds the whole
// prompt again, so it is given a deadline, and a reply goes on without names when it passes.

import { isRecord } from "../../shared/json";
import { presetMarkers, readBlocksHint, type BlocksHint } from "./layout";
import type { LumiverseReads } from "./reads";
import type { LumiverseSession } from "./session";
import type { Tag } from "./wire";

/** The default of `lumiverse.dryRun.wait`: how long a dry run is waited for before the reply goes on without the hint. */
export const DRY_RUN_MS = 10_000;

export interface HintDeps {
  reads: LumiverseReads;
  session: LumiverseSession;
  log(message: string): void;
  /** The dry run's wait, read at each reply (the door's settings); `DRY_RUN_MS` when not given. */
  dryRunMs?: () => number;
}

/**
 * The hint for a tagged reply's prompt; null when Lumiverse has stored none and the dry run gave none in time. A stored breakdown's
 * entries may not carry their blocks' markers, so its preset's blocks are read for them (a dry run's carry their own).
 */
export function blocksHint(deps: HintDeps): (tag: Tag, signal: AbortSignal) => Promise<BlocksHint | null> {
  return async (tag, signal) => {
    const breakdown = await deps.reads.breakdown(tag.chat);
    if (breakdown !== null) {
      const preset = isRecord(breakdown) && typeof breakdown.presetId === "string" ? breakdown.presetId : tag.preset;
      const markers = preset === null ? new Map<string, string | null>() : presetMarkers((await deps.reads.preset(preset))?.promptOrder);
      const stored = readBlocksHint(breakdown, "breakdown", markers);
      if (stored !== null) return stored;
    }
    const stop = AbortSignal.any([signal, AbortSignal.timeout(deps.dryRunMs?.() ?? DRY_RUN_MS)]);
    try {
      const body = { chat_id: tag.chat, connection_id: tag.connection, ...(tag.preset !== null ? { preset_id: tag.preset } : {}), ...(tag.persona !== null ? { persona_id: tag.persona } : {}) };
      const hint = readBlocksHint(await deps.session.json("POST", "/api/v1/generate/dry-run", body, stop), "dry-run");
      // A dry run's answer does not name its preset: it is the one asked for.
      return hint === null ? null : { ...hint, presetId: hint.presetId ?? tag.preset };
    } catch (error) {
      deps.log(`Lumiverse's dry run of chat ${tag.chat} gave no names for its prompt's blocks: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
}
