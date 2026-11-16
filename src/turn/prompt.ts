// RPH's prompt port (`PromptPort` in `rp-harness/contract`; plan §4.8): the raw layout of the prompt
// each turn's request carried, as the adapter laid it out when the request came, and the prompt maps,
// one per preset, kept for every chat on that preset. Also where the lore that activated for a turn is
// kept (Lumiverse's own event said it, before the request or after), which the lore lane asks for (`LoreTurns`),
// with the speaker and the persona the turn's generation named. A turn's prompt and where its slices were
// are kept only while its folder is kept whole (`prune`); the maps stay.

import type { Database } from "bun:sqlite";
import type { AgentRef, LocatedSlices, Log, PromptMap, PromptPort, RawLayout, Scope } from "rp-harness/contract";
import type { ActivatedEntry, LoreTurns } from "../lore";
import { isRecord } from "../shared/json";
import type { Writes } from "./kv";

/** What a turn's request carried that the prompt port and the lore keep: its layout, the lore that activated, and the window's cut. */
export interface Received {
  user: string;
  turn: string;
  chat: string;
  layout: RawLayout;
  lore: readonly ActivatedEntry[];
  cut: unknown;
  /** The messages Lumiverse's memory stood in for with a summary in this prompt. */
  summarized: readonly string[];
  /** The character the generation spoke as, by Lumiverse's id, and the persona it named; null where the tag named none. */
  speaker: string | null;
  persona: string | null;
  at: number;
}

export interface TurnPrompts extends PromptPort {
  /** Keeps what a turn's request carried; inside a queued write. */
  keep(db: Database, received: Received): void;
  /** Joins lore Lumiverse said activated for a turn's generation, heard after its request was kept, to the turn's record; inside a queued write. */
  addLore(db: Database, user: string, turn: string, lore: readonly ActivatedEntry[]): void;
  /** The messages Lumiverse's memory stands in for with a summary in the chat's latest prompt. */
  summarized(user: string, chat: string): ReadonlySet<string>;
  /** The first history message a turn's prompt kept, by the cut its request carried; null where the window cut nothing, or none was kept. */
  keptFrom(user: string, turn: string): string | null;
  /** Where the slices of the chat's prompts were found, by turn, as RPH saved it; null for a turn that has none kept. */
  located(user: string, turn: string): LocatedSlices | null;
  /**
   * Lets go of the prompts the chat's turns carried, and where their slices were, but for the newest `keep` of them and those of turns
   * going on (`going`); inside a queued write.
   */
  prune(db: Database, user: string, chat: string, keep: number, going: ReadonlySet<string>): void;
  /** The lore that activated for each turn's prompt, as the lore lane asks for it. */
  readonly lore: LoreTurns;
  /**
   * Brings the chat's `PROMPT-MAP.md` up to date with the map of the preset its latest turn was played on, or that turn's raw layout
   * where no map is learned yet; the file is written only where its text changed. A failure is logged.
   */
  mapFile(user: string, chat: string): Promise<void>;
}

/** Writes a chat's `PROMPT-MAP.md` from its preset's map (undefined: none learned yet) and its latest layout. */
export type MapFileWriter = (user: string, chat: string, map: PromptMap | undefined, layout: RawLayout | null) => Promise<void>;

/** The prompt part `PROMPT-MAP.md` is laid out by, and the file's name at the top of the chat's folder. */
export const PROMPT_MAP_FILE = "prompt-map-file";
export const PROMPT_MAP_FILENAME = "PROMPT-MAP.md";

export function turnPrompts(db: Database, writes: Writes, now: () => number, writeMapFile?: MapFileWriter, log?: Log): TurnPrompts {
  const layoutOf = (user: string, turn: string): RawLayout | null => {
    const row = db.query<{ layout: string }, [string, string]>("SELECT layout FROM turn_prompt WHERE user = ? AND turn = ?").get(user, turn);
    return row === null ? null : (JSON.parse(row.layout) as RawLayout);
  };
  /** The preset the scope's turn was played on; for a scope with no turn, the chat's latest turn's. */
  const presetOf = (scope: Scope): string | null => {
    const row =
      scope.turn !== undefined
        ? db.query<{ preset: string | null }, [string, string]>("SELECT preset FROM turn_prompt WHERE user = ? AND turn = ?").get(scope.user, scope.turn)
        : db.query<{ preset: string | null }, [string, string]>("SELECT preset FROM turn_prompt WHERE user = ? AND chat = ? ORDER BY received DESC LIMIT 1").get(scope.user, scope.chat);
    return row?.preset ?? null;
  };
  const mapOf = (user: string, preset: string | null): PromptMap | undefined => {
    const row = preset === null ? null : db.query<{ map: string }, [string, string]>("SELECT map FROM prompt_map WHERE user = ? AND preset = ?").get(user, preset);
    return row === null ? undefined : (JSON.parse(row.map) as PromptMap);
  };
  const mapFile = async (user: string, chat: string): Promise<void> => {
    if (writeMapFile === undefined) return;
    const row = db.query<{ layout: string; preset: string | null }, [string, string]>("SELECT layout, preset FROM turn_prompt WHERE user = ? AND chat = ? ORDER BY received DESC LIMIT 1").get(user, chat);
    if (row === null) return;
    await writeMapFile(user, chat, mapOf(user, row.preset), JSON.parse(row.layout) as RawLayout).catch((error: unknown) =>
      log?.error("A chat's PROMPT-MAP.md could not be written.", { chat, error: error instanceof Error ? error.message : String(error) }),
    );
  };
  return {
    mapFile,
    keep(into, r) {
      into.run("INSERT OR REPLACE INTO turn_prompt (user, turn, chat, preset, layout, lore, cut, received, summarized, speaker, persona) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        r.user,
        r.turn,
        r.chat,
        r.layout.preset?.id ?? null,
        JSON.stringify(r.layout),
        JSON.stringify(r.lore),
        JSON.stringify(r.cut ?? null),
        r.at,
        JSON.stringify(r.summarized),
        r.speaker,
        r.persona,
      ]);
    },

    addLore(into, user, turn, lore) {
      const row = into.query<{ lore: string }, [string, string]>("SELECT lore FROM turn_prompt WHERE user = ? AND turn = ?").get(user, turn);
      if (row === null) return;
      const had = JSON.parse(row.lore) as ActivatedEntry[];
      const known = new Set(had.map((e) => e.id));
      into.run("UPDATE turn_prompt SET lore = ? WHERE user = ? AND turn = ?", [JSON.stringify([...had, ...lore.filter((e) => !known.has(e.id))]), user, turn]);
    },

    summarized(user, chat) {
      const row = db.query<{ summarized: string }, [string, string]>("SELECT summarized FROM turn_prompt WHERE user = ? AND chat = ? ORDER BY received DESC LIMIT 1").get(user, chat);
      return new Set(row === null ? [] : (JSON.parse(row.summarized) as string[]));
    },

    keptFrom(user, turn) {
      const row = db.query<{ cut: string }, [string, string]>("SELECT cut FROM turn_prompt WHERE user = ? AND turn = ?").get(user, turn);
      const cut: unknown = row === null ? null : JSON.parse(row.cut);
      return isRecord(cut) && isRecord(cut.keep) && typeof cut.keep.id === "string" ? cut.keep.id : null;
    },

    located(user, turn) {
      const row = db.query<{ located: string }, [string, string]>("SELECT located FROM prompt_located WHERE user = ? AND turn = ?").get(user, turn);
      return row === null ? null : (JSON.parse(row.located) as LocatedSlices);
    },

    prune(into, user, chat, keep, going) {
      const old = into
        .query<{ turn: string }, [string, string, number]>("SELECT turn FROM turn_prompt WHERE user = ? AND chat = ? ORDER BY received DESC LIMIT -1 OFFSET ?")
        .all(user, chat, keep)
        .flatMap((r) => (going.has(r.turn) ? [] : [r.turn]));
      if (old.length === 0) return;
      const turns = JSON.stringify(old);
      into.run("DELETE FROM prompt_located WHERE user = ? AND turn IN (SELECT value FROM json_each(?))", [user, turns]);
      into.run("DELETE FROM turn_prompt WHERE user = ? AND turn IN (SELECT value FROM json_each(?))", [user, turns]);
    },

    async layout(scope) {
      if (scope.turn === undefined) throw new Error("A prompt's layout is asked for a turn, and this scope names none.");
      const layout = layoutOf(scope.user, scope.turn);
      if (layout === null) throw new Error(`RPE received no prompt for turn ${scope.turn}.`);
      return layout;
    },

    async map(scope) {
      return mapOf(scope.user, presetOf(scope));
    },

    async saveMap(scope, map: PromptMap, by: AgentRef) {
      await writes.run(
        (into) =>
          into.run("INSERT INTO prompt_map (user, preset, map, by, saved) VALUES (?, ?, ?, ?, ?) ON CONFLICT (user, preset) DO UPDATE SET map = excluded.map, by = excluded.by, saved = excluded.saved", [
            scope.user,
            map.preset.id,
            JSON.stringify(map),
            JSON.stringify(by),
            now(),
          ]),
        "keeping a prompt map",
      );
      // Each chat played on the preset now shows the map as saved.
      const chats = db
        .query<{ chat: string; preset: string | null }, [string]>("SELECT chat, preset FROM turn_prompt t WHERE user = ? AND received = (SELECT max(received) FROM turn_prompt u WHERE u.user = t.user AND u.chat = t.chat)")
        .all(scope.user);
      for (const c of chats) if (c.preset === map.preset.id) await mapFile(scope.user, c.chat);
    },

    async saveLocated(scope, located: LocatedSlices) {
      if (scope.turn === undefined) throw new Error("Where the slices were found is kept for a turn, and this scope names none.");
      const turn = scope.turn;
      await writes.run(
        (into) => into.run("INSERT OR REPLACE INTO prompt_located (user, turn, located, saved) VALUES (?, ?, ?, ?)", [scope.user, turn, JSON.stringify(located), now()]),
        "keeping where the prompt's slices were found",
      );
    },

    lore: {
      async activated(user, chat, turn) {
        const row = db.query<{ lore: string }, [string, string, string]>("SELECT lore FROM turn_prompt WHERE user = ? AND chat = ? AND turn = ?").get(user, chat, turn);
        return row === null ? null : (JSON.parse(row.lore) as ActivatedEntry[]);
      },
      async generation(user, chat, turn) {
        const row = db.query<{ speaker: string | null; persona: string | null }, [string, string, string]>("SELECT speaker, persona FROM turn_prompt WHERE user = ? AND chat = ? AND turn = ?").get(user, chat, turn);
        return row === null ? null : { speaker: row.speaker, persona: row.persona };
      },
    },
  };
}
