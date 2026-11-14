// RPH's prompt port (`PromptPort` in `rp-harness/contract`; plan §4.8): the raw layout of the prompt
// each turn's request carried, as the adapter laid it out when the request came, and the prompt maps,
// one per preset, kept for every chat on that preset. Also where the lore that activated for a turn is
// kept (the tag carried it), which the lore lane asks for (`LoreTurns`).

import type { Database } from "bun:sqlite";
import type { AgentRef, LocatedSlices, PromptMap, PromptPort, RawLayout, Scope } from "rp-harness/contract";
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
  at: number;
}

export interface TurnPrompts extends PromptPort {
  /** Keeps what a turn's request carried; inside a queued write. */
  keep(db: Database, received: Received): void;
  /** The messages Lumiverse's memory stands in for with a summary in the chat's latest prompt. */
  summarized(user: string, chat: string): ReadonlySet<string>;
  /** The first history message a turn's prompt kept, by the cut its request carried; null where the window cut nothing, or none was kept. */
  keptFrom(user: string, turn: string): string | null;
  /** The lore that activated for each turn's prompt, as the lore lane asks for it. */
  readonly lore: LoreTurns;
}

export function turnPrompts(db: Database, writes: Writes, now: () => number): TurnPrompts {
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
  return {
    keep(into, r) {
      into.run("INSERT OR REPLACE INTO turn_prompt (user, turn, chat, preset, layout, lore, cut, received, summarized) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        r.user,
        r.turn,
        r.chat,
        r.layout.preset?.id ?? null,
        JSON.stringify(r.layout),
        JSON.stringify(r.lore),
        JSON.stringify(r.cut ?? null),
        r.at,
        JSON.stringify(r.summarized),
      ]);
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

    async layout(scope) {
      if (scope.turn === undefined) throw new Error("A prompt's layout is asked for a turn, and this scope names none.");
      const layout = layoutOf(scope.user, scope.turn);
      if (layout === null) throw new Error(`RPE received no prompt for turn ${scope.turn}.`);
      return layout;
    },

    async map(scope) {
      const preset = presetOf(scope);
      if (preset === null) return undefined;
      const row = db.query<{ map: string }, [string, string]>("SELECT map FROM prompt_map WHERE user = ? AND preset = ?").get(scope.user, preset);
      return row === null ? undefined : (JSON.parse(row.map) as PromptMap);
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
    },
  };
}
