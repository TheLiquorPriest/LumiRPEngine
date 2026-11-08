// A lexical index (DEPTH-PLAN §4.3): excerpts of text, ranked by BM25 against a query's words. It
// answers a search someone asked for (the author's and the GM's archive search, a character's own
// recall cue over what it lived); it never decides what anyone recalls. Deterministic: the same
// excerpts and query rank the same.

/** Words too common to tell excerpts apart. */
const STOP = new Set(
  "a an and are as at be been but by for from had has have he her hers him his i if in into is it its me my of on or our she so than that the their them then there they this to too was we were what when where which who whom why will with you your".split(" "),
);

/** A word's plain stem: lower case, a few English endings off, so "boats" finds "boat" and "sold" stays itself. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** A text's index words, in order: letters and digits, lower case, stemmed, common words and single letters left out. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[\p{L}\p{N}]+(?:'[\p{L}]+)?/gu)) {
    const word = m[0].replace(/'s$/u, "");
    if (word.length < 2 || STOP.has(word)) continue;
    out.push(stem(word));
  }
  return out;
}

/** A passage of a text: where it starts and ends in it. */
export interface Passage {
  start: number;
  end: number;
}

/** Cuts `text` into a passage every `size` characters or so, at paragraph, then sentence, bounds. */
export function passagesOf(text: string, size = 600): Passage[] {
  const out: Passage[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const para = text.lastIndexOf("\n", end);
      const sentence = Math.max(text.lastIndexOf(". ", end), text.lastIndexOf("! ", end), text.lastIndexOf("? ", end));
      if (para > start + size / 3) end = para + 1;
      else if (sentence > start + size / 3) end = sentence + 2;
    }
    out.push({ start, end });
    start = end;
  }
  return out;
}

export interface LexicalHit<K> {
  key: K;
  passage: Passage;
  score: number;
}

/** A passage as indexed: where it is, its word count and each word's count, so a stored index loads without tokenizing again. */
export interface IndexedPassage {
  passage: Passage;
  length: number;
  words: [string, number][];
}

/** `text` cut into pieces (`passagesOf`) and each one tokenized, as `LexicalIndex.add` indexes it. */
export function indexPieces(text: string, size?: number): IndexedPassage[] {
  return passagesOf(text, size).map((passage) => {
    const words = tokenize(text.slice(passage.start, passage.end));
    const tf = new Map<string, number>();
    for (const w of words) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { passage, length: words.length, words: [...tf] };
  });
}

const K1 = 1.2;
const B = 0.75;

/**
 * Each passage under a key (a message, a mind file): added and removed by key, ranked by BM25.
 * Removal marks each entry of a key dead; past a quarter dead the postings are rebuilt.
 */
export class LexicalIndex<K> {
  private entries: { key: K; passage: Passage; length: number; dead: boolean }[] = [];
  private postings = new Map<string, number[]>();
  private byKey = new Map<K, number[]>();
  private dead = 0;
  private totalLength = 0;

  get size(): number {
    return this.entries.length - this.dead;
  }

  has(key: K): boolean {
    return this.byKey.has(key);
  }

  /** Indexes `text` under `key`, replacing what the key held. */
  add(key: K, text: string, size?: number): void {
    this.addIndexed(key, indexPieces(text, size));
  }

  /** Indexes pieces already tokenized (`indexPieces`, or a stored copy of them) under `key`, replacing what the key held. */
  addIndexed(key: K, pieces: readonly IndexedPassage[]): void {
    this.remove(key);
    const ids: number[] = [];
    for (const { passage, length, words } of pieces) {
      const id = this.entries.length;
      this.entries.push({ key, passage, length, dead: false });
      this.totalLength += length;
      ids.push(id);
      for (const [w, n] of words) {
        const list = this.postings.get(w);
        if (list) list.push(id, n);
        else this.postings.set(w, [id, n]);
      }
    }
    this.byKey.set(key, ids);
  }

  remove(key: K): void {
    const ids = this.byKey.get(key);
    if (!ids) return;
    for (const id of ids) {
      const p = this.entries[id];
      if (p && !p.dead) {
        p.dead = true;
        this.dead++;
        this.totalLength -= p.length;
      }
    }
    this.byKey.delete(key);
    if (this.dead > 64 && this.dead * 4 > this.entries.length) this.compact();
  }

  /** The best passage of each key matching `query`, best first; `keep` filters keys. */
  search(query: string, keep: (key: K) => boolean = () => true): LexicalHit<K>[] {
    const words = [...new Set(tokenize(query))];
    const live = this.size;
    if (words.length === 0 || live === 0) return [];
    const avg = this.totalLength / live || 1;
    const scores = new Map<number, number>();
    for (const w of words) {
      const list = this.postings.get(w);
      if (!list) continue;
      let df = 0;
      for (let i = 0; i < list.length; i += 2) if (!this.entries[list[i] as number]?.dead) df++;
      if (df === 0) continue;
      const idf = Math.log(1 + (live - df + 0.5) / (df + 0.5));
      for (let i = 0; i < list.length; i += 2) {
        const id = list[i] as number;
        const p = this.entries[id];
        if (!p || p.dead) continue;
        const tf = list[i + 1] as number;
        const score = (idf * tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * p.length) / avg));
        scores.set(id, (scores.get(id) ?? 0) + score);
      }
    }
    const best = new Map<K, LexicalHit<K>>();
    for (const [id, score] of scores) {
      const p = this.entries[id];
      if (!p || !keep(p.key)) continue;
      const known = best.get(p.key);
      if (!known || score > known.score) best.set(p.key, { key: p.key, passage: p.passage, score });
    }
    return [...best.values()].sort((a, b) => b.score - a.score);
  }

  /** Drops the dead entries: ids are remapped and every posting list keeps only live ones. */
  private compact(): void {
    const old = this.entries;
    this.entries = [];
    this.dead = 0;
    const remap = new Map<number, number>();
    old.forEach((p, i) => {
      if (p.dead) return;
      remap.set(i, this.entries.length);
      this.entries.push(p);
    });
    for (const [key, ids] of this.byKey) this.byKey.set(key, ids.flatMap((i) => (remap.has(i) ? [remap.get(i) as number] : [])));
    for (const [w, list] of this.postings) {
      const kept: number[] = [];
      for (let i = 0; i < list.length; i += 2) {
        const id = remap.get(list[i] as number);
        if (id !== undefined) kept.push(id, list[i + 1] as number);
      }
      if (kept.length > 0) this.postings.set(w, kept);
      else this.postings.delete(w);
    }
  }
}
