// The world's keys found in the messages Lumiverse scans for lore (plan §9.2: the lore map lists the world's entries whose keys come up
// there), kept message by message. A message is looked through once: what was found in it is kept by its id, with the marks that say its
// text is still the same (its revision, its showing swipe and that swipe's hash) and the keys it was looked through for. At each map only
// the messages new or changed since are read and looked through; where the world's keys changed, the others are looked through for the
// keys gained alone, and the keys lost are let go. What is found is what looking through every message at once finds (`keyMatcher`: a
// key never matches across two messages). The reading and the looking through are done in stretches, the thread let go between them.

import { letGo, STRETCH_MS } from "../store";
import { type KeyMatching, keyMatcher } from "./keys";

/** A message Lumiverse scans for lore, as the lore map is given it: its id, and the marks that say its text is as when it was last read. */
export interface ScannedMessage {
  id: string;
  mark: string;
}

/** The texts of the messages asked for, as Lumiverse scans them, by id; a message no longer there is left out. */
export type ScannedTexts = (ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;

/** The marks of a message's text as a chat's path gives them: its revision, its showing swipe, and that swipe's hash. */
export function scanMark(step: { revision: number; swipe: number; shown: { hash: string } }): string {
  return `${step.revision}:${step.swipe}:${step.shown.hash}`;
}

/** The keys one map looked for: how they are matched, and the keys, each once. */
interface KeySet {
  how: string;
  /** What tells this set from another: how, and the keys in order. */
  said: string;
  keys: ReadonlySet<string>;
  list: readonly string[];
  /** Made at the first message looked through for every key of the set. */
  all: ((text: string) => string[]) | null;
}

/** What was found in one message: at its marks, for a set of keys. */
interface Found {
  mark: string;
  set: KeySet;
  keys: readonly string[];
}

/** One message to read and look through: for every key of the set (`more` null), or for the keys gained since, beside what was found. */
interface Work {
  message: ScannedMessage;
  had: readonly string[];
  more: { keys: readonly string[]; match: (text: string) => string[] } | null;
}

export class KeysSaid {
  /** By user and chat: the keys the chat's last map looked for, and what was found in each message it scanned. */
  readonly #chats = new Map<string, { set: KeySet | null; found: Map<string, Found> }>();
  /** By user and chat: the look going on, which the next one for the chat waits for, so that neither looks through over the other. */
  readonly #going = new Map<string, Promise<unknown>>();

  /** Which of `keys` come up in `messages` (the chat's, by `chat`), as looking through all of them at once for every key finds them. */
  found(chat: string, messages: readonly ScannedMessage[], texts: ScannedTexts, how: KeyMatching, keys: readonly string[]): Promise<Set<string>> {
    const look = (this.#going.get(chat) ?? Promise.resolve()).catch(() => undefined).then(() => this.#look(chat, messages, texts, how, keys));
    this.#going.set(chat, look);
    void look.finally(() => {
      if (this.#going.get(chat) === look) this.#going.delete(chat);
    }).catch(() => undefined);
    return look;
  }

  async #look(chat: string, messages: readonly ScannedMessage[], texts: ScannedTexts, how: KeyMatching, keys: readonly string[]): Promise<Set<string>> {
    const kept = this.#chats.get(chat) ?? { set: null, found: new Map<string, Found>() };
    this.#chats.set(chat, kept);
    const list = [...new Set(keys)].sort();
    const manner = `${how.caseSensitive ? "cased" : "folded"} ${how.wholeWords ? "words" : "anywhere"}`;
    const said = JSON.stringify([manner, list]);
    const set: KeySet = kept.set?.said === said ? kept.set : { how: manner, said, keys: new Set(list), list, all: null };
    kept.set = set;
    // What each message needs: nothing (looked through for these keys at its marks), the keys gained since (looked through for others
    // at its marks, matched alike), or every key (new, changed, or looked through as keys are matched no longer).
    const gained = new Map<KeySet, { keys: readonly string[]; match: (text: string) => string[] }>();
    const work: Work[] = [];
    for (const message of messages) {
      const was = kept.found.get(message.id);
      if (was?.mark !== message.mark || was.set.how !== manner) {
        work.push({ message, had: [], more: null });
        continue;
      }
      if (was.set === set) continue;
      let more = gained.get(was.set);
      if (more === undefined) {
        const keys = list.filter((k) => !was.set.keys.has(k));
        more = { keys, match: keyMatcher(how, keys) };
        gained.set(was.set, more);
      }
      const had = was.keys.filter((k) => set.keys.has(k));
      if (more.keys.length === 0) kept.found.set(message.id, { mark: message.mark, set, keys: had });
      else work.push({ message, had, more });
    }
    // Read and looked through in stretches: each read as many messages as the one before it showed fit in a stretch.
    let size = 1;
    for (let at = 0; at < work.length; ) {
      const began = performance.now();
      const part = work.slice(at, at + size);
      const read = await texts(part.map((w) => w.message.id));
      for (const w of part) {
        const text = read.get(w.message.id);
        // A message gone from Lumiverse since the path was read is looked for at the next map.
        if (text === undefined) continue;
        const keys = w.more === null ? (set.all ??= keyMatcher(how, list))(text) : [...w.had, ...w.more.match(text)];
        kept.found.set(w.message.id, { mark: w.message.mark, set, keys });
      }
      at += part.length;
      const took = performance.now() - began;
      size = Math.max(1, Math.min(part.length * 2, Math.floor((part.length * STRETCH_MS) / Math.max(1, took))));
      if (at < work.length) await letGo();
    }
    // What the chat scans no longer is let go.
    const scanned = new Set(messages.map((m) => m.id));
    for (const id of kept.found.keys()) if (!scanned.has(id)) kept.found.delete(id);
    // A message gone from Lumiverse since the path was read gives nothing, as one not read.
    const out = new Set<string>();
    for (const message of messages) {
      const was = kept.found.get(message.id);
      if (was?.mark === message.mark && was.set === set) for (const key of was.keys) out.add(key);
    }
    return out;
  }
}
