// Lumiverse's own breakdown of a prompt, as the hint for the names of its blocks (STANDALONE-PLAN §4.2,
// §4.8, the first workaround): the breakdown Lumiverse stored with the chat's latest reply
// (`services/generate.service.ts:4448-4476`), or, before any is stored, one dry-run assembly of the chat
// on the same connection, preset and persona (`POST /api/v1/generate/dry-run`, `routes/generate.routes.ts
// :20-43`; its answer carries the breakdown, `generate.service.ts:424-486`). A dry run builds the whole
// prompt again, so it is given a deadline, and a reply goes on without names when it passes.

import { readBlocksHint, type BlocksHint } from "./layout";
import type { LumiverseReads } from "./reads";
import type { LumiverseSession } from "./session";
import type { Tag } from "./wire";

/** Fixed: how long a dry run is waited for before the reply goes on without the hint. */
export const DRY_RUN_MS = 10_000;

export interface HintDeps {
  reads: LumiverseReads;
  session: LumiverseSession;
  log(message: string): void;
  /** `DRY_RUN_MS` when not said. */
  dryRunMs?: number;
}

/** The hint for a tagged reply's prompt; null when Lumiverse has stored none and the dry run gave none in time. */
export function blocksHint(deps: HintDeps): (tag: Tag, signal: AbortSignal) => Promise<BlocksHint | null> {
  return async (tag, signal) => {
    const stored = readBlocksHint(await deps.reads.breakdown(tag.chat), "breakdown");
    if (stored !== null) return stored;
    const stop = AbortSignal.any([signal, AbortSignal.timeout(deps.dryRunMs ?? DRY_RUN_MS)]);
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
