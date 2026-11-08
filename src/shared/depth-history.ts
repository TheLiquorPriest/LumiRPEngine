// GM → This chat → Depth → History: a depth turn's request never carries the whole history. The turn
// tagger takes every chat message before the chat's cutoff out of the prompt core sends the loopback,
// so neither core's body nor the narrator's prompt holds them. Nothing is lost: the author and the GM
// search and quote the whole chat on demand with the archive tools (`archive_search`,
// `archive_quote`), which read the chat itself, and the author hands the narrator what it quotes.

/** `last`: only the latest `count` messages go; `from`: every message before the one the chat numbers `index` stays out. */
export type HistoryCut = { keep: "last"; count: number } | { keep: "from"; index: number };

/** A new chat's cutoff: the latest 40 messages go, far more than the narrator's recent window reads. */
export const HISTORY_KEEP_DEFAULT = 40;
export const HISTORY_CUT_DEFAULT: Readonly<HistoryCut> = Object.freeze({ keep: "last", count: HISTORY_KEEP_DEFAULT });

/** The most messages `last` keeps. */
export const HISTORY_KEEP_MOST = 10_000;

/** A cutoff as stored or asked for; null when it isn't one. `last` keeps at least the latest message. */
export function historyCutOf(raw: unknown): HistoryCut | null {
  if (typeof raw !== "object" || raw === null || !("keep" in raw)) return null;
  if (raw.keep === "last" && "count" in raw && Number.isSafeInteger(raw.count) && (raw.count as number) >= 1 && (raw.count as number) <= HISTORY_KEEP_MOST) return { keep: "last", count: raw.count as number };
  if (raw.keep === "from" && "index" in raw && Number.isSafeInteger(raw.index) && (raw.index as number) >= 0) return { keep: "from", index: raw.index as number };
  return null;
}

/** The cutoff in words, for the chat's Depth tab. */
export function historyCutWords(cut: Readonly<HistoryCut>): string {
  return cut.keep === "last" ? `only the latest ${cut.count} message${cut.count === 1 ? "" : "s"}` : `every message from #${cut.index} on`;
}

/**
 * The places, in an assembled prompt, of the history messages the cutoff hides: under `last`, all but
 * the latest `count` history messages; under `from`, each whose chat index is below `index` (a message
 * with no index stays), the latest always kept, so a cutoff past the chat's end never leaves a turn
 * (a Continue's reply above all) without the message it goes on from. Blocks that aren't history (the
 * card, World Info, an author's note) all stay.
 */
export function hiddenByCut(messages: readonly { history: boolean; sourceIndex?: number }[], cut: Readonly<HistoryCut>): number[] {
  const history = messages.flatMap((m, i) => (m.history ? [i] : []));
  if (cut.keep === "last") return history.slice(0, Math.max(0, history.length - cut.count));
  return history.slice(0, -1).filter((i) => {
    const at = messages[i]?.sourceIndex;
    return at !== undefined && at < cut.index;
  });
}
