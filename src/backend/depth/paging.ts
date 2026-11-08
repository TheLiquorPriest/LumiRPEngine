// Reading more than one call holds, a page at a time (W5): the items cut into pages of `size` in the
// order given (story order, by the caller), each page read with what the pages before it came to, so
// each verdict accumulates; never refused or dropped for size. The settle read past its pins' bound
// reads its pins this way; a chapter read past its beats' bound can too. What each page comes to, and
// what the reader decides with all of them, is the model's: this only pages.

/** One page of a paged read: 1-based `index` of `of`, and its items. */
export interface Page<T> {
  index: number;
  of: number;
  items: readonly T[];
}

/** `items` cut into pages of at most `size` (at least one page, empty when there is nothing). */
export function pagesOf<T>(items: readonly T[], size: number): Page<T>[] {
  const per = Math.max(1, Math.floor(size));
  const of = Math.max(1, Math.ceil(items.length / per));
  return Array.from({ length: of }, (_, i) => ({ index: i + 1, of, items: items.slice(i * per, (i + 1) * per) }));
}

/** Reads `items` page by page, in order: each page read with every verdict before it; the verdicts, in page order. */
export async function readPaged<T, V>(items: readonly T[], size: number, read: (page: Page<T>, before: readonly V[]) => Promise<V>, signal?: AbortSignal): Promise<V[]> {
  const verdicts: V[] = [];
  for (const page of pagesOf(items, size)) {
    signal?.throwIfAborted();
    verdicts.push(await read(page, verdicts.slice()));
  }
  return verdicts;
}
