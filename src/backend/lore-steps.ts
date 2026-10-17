// The world's lore for RPEngine's own helpers (DESIGN §5.4). Each step run gets a `StepLore`: its
// lore policy and token budget, the reader it searches with (the step's purpose decides what it
// may read, and `engine/lore.ts` enforces it), the prefetch built from the step's own inputs at no
// extra call, and the trace the inspector shows (§6.5).

import type { StepLore as StepLoreSetting } from "../shared/settings";
import type { LoreStepTrace } from "../shared/state-view";
import type { StepPurpose } from "../shared/world";
import { loreSearch, type LoreHit, type LoreReader, type LoreResult } from "../engine/lore";
import { findLeaks } from "../engine/visibility";

/** What a step's prefetch searches with: its own inputs. */
export interface LoreInputs {
  /** What the step reads: the player's message, the reply, the decision's question… */
  text: string;
  /** The people and places it is about. */
  links: string[];
}

/** Hits a prefetch may give; the token budget usually binds first. */
const PREFETCH_LIMIT = 6;
/** How much of a query the trace keeps. */
const TRACE_CHARS = 120;

export class StepLore {
  readonly trace: LoreStepTrace;
  /** The entries given so far, in the order given. */
  private readonly given = new Map<string, LoreHit>();
  /** An `effects` template reads no secret, whatever its purpose. */
  private readonly effects: boolean;
  /** Called with the snippets of new hits, for the host to count their tokens. */
  private readonly counted: (texts: readonly string[]) => void;

  constructor(
    readonly purpose: StepPurpose,
    readonly setting: Readonly<StepLoreSetting>,
    private readonly reader: LoreReader,
    phase: "pre" | "post",
    /** The unrevealed secrets: a query in the trace that carries one is withheld. */
    private readonly secrets: readonly string[],
    options: { effects?: boolean; counted?: (texts: readonly string[]) => void } = {},
  ) {
    this.effects = options.effects === true;
    this.counted = options.counted ?? (() => undefined);
    this.trace = { step: purpose, phase, policy: setting.policy, transport: "none", queries: [], entries: [], lookups: 0, notes: [] };
  }

  /** The prefetch: the index searched with the step's own inputs, at no extra call. */
  prefetch(inputs: LoreInputs): void {
    if (this.setting.policy !== "prefetch" && this.setting.policy !== "prefetch+lookup") return;
    this.take("prefetch", inputs.text, loreSearch(this.reader, { query: inputs.text, links: inputs.links, purpose: this.purpose, effects: this.effects, limit: PREFETCH_LIMIT, tokenBudget: this.setting.tokens }));
  }

  /** Records a search in the trace and keeps the hits the step hasn't been given yet. */
  private take(kind: LoreStepTrace["queries"][number]["kind"], text: string, result: LoreResult): LoreHit[] {
    const shown = text.replace(/\s+/g, " ").trim();
    this.trace.queries.push({ kind, text: findLeaks(shown, this.secrets).length > 0 ? "(withheld: it carries a secret)" : shown.length > TRACE_CHARS ? `${shown.slice(0, TRACE_CHARS)}…` : shown, matched: result.matched });
    const fresh = result.hits.filter((h) => !this.given.has(h.id));
    for (const h of fresh) {
      this.given.set(h.id, h);
      this.trace.entries.push({ title: h.secret ? "A secret entry" : h.title, tokens: h.tokens, cut: h.cut, secret: h.secret });
    }
    if (fresh.length > 0) this.counted(fresh.map((h) => h.snippet));
    return fresh;
  }

  /** The lore given so far, a line per entry, with its id. */
  lines(): string[] {
    return [...this.given.values()].map((h) => `[${h.id}] ${h.snippet}`);
  }

  /** The block a helper prompt carries; empty when the step was given none. */
  block(): string {
    const lines = this.lines();
    return lines.length === 0 ? "" : `World lore (reference notes; they may be incomplete):\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }
}
