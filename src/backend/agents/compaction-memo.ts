// The compaction made ahead (Build C item 2): the summary the main session's next compaction needs,
// made once for its inputs and kept in memory for the turns that need it. A turn whose session is
// settled, and whose next turn will compact, starts that fold in the background (`MainTurn` with
// Settings → Agents → Main agent → Session's Summarize: ahead of time); the next turn adopts it, or
// joins it while it runs, and a swipe, a Re-run or a Re-narrate of that turn reads the session at
// the same parent, so it finds the same fold. A turn that finds none makes it there and then (the
// blocking path), through the same memo, so two turns asking at once share one call.
//
// Every input of the call is in its key (`foldKey`): the user, the route the summary is written on
// and its cap, its instructions and its message (the summary so far and the turns it folds), so a
// key that hits is the very call that would be made now. A summary cut off at its limit, or one that
// stops mid-sentence, stays as the failure it is, so the turns that find it go on whole without
// calling again, and the next turn, whose fold is another, tries again; any other failure goes, so
// whoever asks next calls again. Nothing here survives a restart: the next turn then makes its fold
// as it starts, once (BUILD-C §10).

import { hashParts } from "../../shared/hash";
import type { UserId } from "../../shared/ids";
import type { Limit } from "../../shared/minds";

/** A fold's outcome: the summary, or why there is none (`cut`: its reply stopped at its limit, or mid-sentence). */
export type FoldResult = { summary: string } | { failed: string; cut?: true };

/** Everything a compaction's call is made from: whose it is, where it is sent, and what. */
export interface FoldInputs {
  userId: UserId;
  route: { connectionId: string | null; model: string | null; effort: string; callTokensOut: Limit };
  /** The call's system prompt: the compaction instructions, with the main agent's system files. */
  system: string;
  /** Its message: the summary so far and the turns that fold into it. */
  message: string;
}

/** The fold's key: a digest of every input of its call. */
export function foldKey(f: FoldInputs): string {
  return hashParts("lre.fold", f.userId, f.route.connectionId ?? "", f.route.model ?? "", f.route.effort, String(f.route.callTokensOut), f.system, f.message);
}

/** How many folds are kept, the latest used first: a few chats' next turns, each a summary within its Summary length. */
export const FOLDS_KEPT = 32;

/** How a fold was found: made already, under way, or not at all (it starts now). */
export type FoldFound = "made" | "running" | null;

interface Entry {
  result: Promise<FoldResult>;
  done: boolean;
}

export class CompactionMemo {
  private readonly folds = new Map<string, Entry>();

  constructor(private readonly cap: number = FOLDS_KEPT) {}

  /** The fold under `key` when one was made or is under way; undefined on a miss. */
  find(key: string): { result: Promise<FoldResult>; found: Exclude<FoldFound, null> } | undefined {
    const entry = this.folds.get(key);
    if (!entry) return undefined;
    this.touch(key, entry);
    return { result: entry.result, found: entry.done ? "made" : "running" };
  }

  /** The fold under `key`: the one made or under way, else `make`'s, started now, once for every asker (single-flight). */
  run(key: string, make: () => Promise<FoldResult>): { result: Promise<FoldResult>; found: FoldFound } {
    const had = this.find(key);
    if (had) return had;
    const entry: Entry = { result: Promise.resolve<FoldResult>({ failed: "" }), done: false };
    entry.result = make()
      .catch((error: unknown): FoldResult => ({ failed: error instanceof Error ? error.message : String(error) }))
      .then((result) => {
        entry.done = true;
        // A failure that isn't a cut summary goes, so the next asker calls again.
        if ("failed" in result && result.cut !== true && this.folds.get(key) === entry) this.folds.delete(key);
        return result;
      });
    this.touch(key, entry);
    return { result: entry.result, found: null };
  }

  /** How many folds are kept now. */
  get size(): number {
    return this.folds.size;
  }

  private touch(key: string, entry: Entry): void {
    this.folds.delete(key);
    this.folds.set(key, entry);
    while (this.folds.size > this.cap) this.folds.delete(this.folds.keys().next().value ?? "");
  }
}
