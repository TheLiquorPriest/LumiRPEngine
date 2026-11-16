// What the panels read beside the chat's state (plan §14, PlanChatUI-P1 item 5, PlanChatUI-P4 item 1), each from RPE's own
// records: the HUD's meter (this turn's calls, tokens, wall time and lore lookups, with the average and 95th percentile over the
// chat's last turns, from the `usage` rows of its runs), the decisions under the replies (each question a lane set to Confirm
// waits on, from the `approval` table, and the cards and chips the earlier engine kept for a carried turn on the path, from the
// `chip` table), each newest reply's clock (its turn's story time), and his changes made while a turn runs, marked pending until
// that run ends (R-22). Reads only.

import type { Database } from "bun:sqlite";
import { calendarOf, formatClock, placeOffset } from "../engine/calendar";
import { placeOfEntity } from "../engine/scope";
import type { WorldState } from "../engine/state";
import { isRecord } from "../shared/json";
import type { CallMeterView, Chip, PendingMark } from "../shared/state-view";
import type { WorldDoc } from "../shared/world";
import type { UserStore } from "../store";

type Measure = CallMeterView["turn"];

/** The value at the 95th percentile of `values`, by nearest rank. */
function p95(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

/**
 * The HUD's meter: the chat's newest turn that spent anything (its runs summed: calls, tokens read and written, wall time from start
 * to end, lore searches and reads), with the average and 95th percentile over its last `turns` such turns; null before any.
 */
export function meterOf(db: Database, user: string, chat: string, turns: number): CallMeterView | null {
  const rows = db
    .query<Measure, [string, string, number]>(
      `SELECT SUM(u.calls) AS calls, SUM(u.input + u.cache_read + u.cache_write + u.output) AS tokens,
         SUM(MAX(0, COALESCE(r.ended, u.at) - COALESCE(r.started, r.received, u.at))) AS ms, SUM(u.lore_searches + u.lore_reads) AS lookups
       FROM usage u LEFT JOIN turn_run r ON r.user = u.user AND r.id = u.run
       WHERE u.user = ?1 AND u.chat = ?2 GROUP BY u.turn ORDER BY MAX(u.at) DESC LIMIT ?3`,
    )
    .all(user, chat, turns);
  const newest = rows[0];
  if (newest === undefined) return null;
  const of = (pick: (m: Measure) => number): number[] => rows.map(pick);
  const keys = ["calls", "tokens", "ms", "lookups"] as const;
  const average = Object.fromEntries(keys.map((k) => [k, Math.round(of((m) => m[k]).reduce((a, b) => a + b, 0) / rows.length)])) as Measure;
  const high = Object.fromEntries(keys.map((k) => [k, p95(of((m) => m[k]))])) as Measure;
  return { turn: { calls: newest.calls, tokens: newest.tokens, ms: newest.ms, lookups: newest.lookups }, average, p95: high };
}

/** A carried chip as the earlier engine kept it, when it holds what a chip shows; null for anything else (a tool approved for the chat). */
function carriedChip(data: unknown): Chip | null {
  if (!isRecord(data) || typeof data.kind !== "string" || typeof data.messageId !== "string" || typeof data.label !== "string") return null;
  return data as unknown as Chip;
}

/**
 * The chips under the chat's replies on its path, for the swipe shown: each question a lane set to Confirm waits on (Go ahead or
 * No, under the reply of its turn, else the path's last message while that turn has none), and the chips and cards the earlier
 * engine kept for a carried turn on the path, as records: the engine that would have answered them is gone, so they ask nothing.
 */
export function chipsOf(db: Database, s: UserStore, user: string, chat: string): Chip[] {
  if (s.chat(chat) === null) return [];
  const path = s.path(chat);
  const onPath = new Set(path.flatMap((e) => (e.turn === null ? [] : [e.turn])));
  const out: Chip[] = [];
  const carried = db.query<{ id: string; turn: string; data: string }, [string, string]>("SELECT id, turn, data FROM chip WHERE user = ?1 AND chat = ?2 AND source = 'import' AND turn IS NOT NULL ORDER BY at, id").all(user, chat);
  for (const row of carried) {
    if (!onPath.has(row.turn)) continue;
    const chip = carriedChip(JSON.parse(row.data));
    if (chip === null || chip.kind === "keep_report") continue;
    out.push({ ...chip, id: row.id, actions: [], expires: "never" });
  }
  const waiting = db
    .query<{ id: string; turn: string | null; tool: string; lane: string }, [string, string]>("SELECT id, turn, tool, lane FROM approval WHERE user = ?1 AND chat = ?2 AND state = 'waiting' ORDER BY asked, id")
    .all(user, chat);
  const last = path.at(-1)?.message ?? "";
  for (const q of waiting) {
    const message = (q.turn === null ? null : s.turn(q.turn)?.message) ?? last;
    out.push({
      id: `approval:${q.id}`,
      kind: "confirm",
      messageId: message,
      label: q.tool,
      detail: q.lane,
      actions: [
        { id: "go", label: "Go ahead", style: "primary" },
        { id: "no", label: "No", style: "danger" },
      ],
      expires: "next_send",
      ...(q.turn === null ? {} : { turns: [q.turn] }),
    });
  }
  return out;
}

/** The world's date and time at the end of each of the newest `most` replies' turns on the path, local to where his character is now. */
export function replyClocks(s: UserStore, chat: string, world: WorldDoc, state: WorldState, most: number): Record<string, string> {
  const cal = calendarOf(world);
  const place = placeOfEntity(state, world.pov);
  const out: Record<string, string> = {};
  for (const entry of s
    .path(chat)
    .filter((e) => !e.user && e.turn !== null)
    .slice(-Math.max(1, most))) {
    const minutes = entry.turn === null ? null : (s.turn(entry.turn)?.storyTime ?? null);
    if (minutes !== null) out[entry.message] = formatClock(cal, minutes, placeOffset(world, minutes, place));
  }
  return out;
}

/** His changes made since the running turn of the chat began, marked pending until it ends; none while no turn runs. */
export function pendingOf(db: Database, s: UserStore, user: string, chat: string): PendingMark[] {
  const running = db.query<{ received: number }, [string, string]>("SELECT received FROM turn_run WHERE user = ?1 AND chat = ?2 AND ended IS NULL ORDER BY received DESC LIMIT 1").get(user, chat);
  if (running === null) return [];
  return s.ownerChanges(chat).some((c) => c.source === "player" && c.created >= running.received) ? [{ panel: "*", entity: null }] : [];
}
