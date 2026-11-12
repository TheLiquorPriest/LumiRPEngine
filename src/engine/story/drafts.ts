// Drafts the story needs now (DEPTH2-PLAN §5, `drafts_due`): an open draft whose time has come, and
// one gone stale. A draft goes stale when the point of the chat it was written against left the path,
// or when beats were played after it was opened, at or past its time, in a place it names or with
// someone it names: those beats are returned for the author to judge, since whether they contradict
// it is a judgement, never the engine's. Bookkeeping only: what becomes of each is the author's. Pure.

import type { Beat, DraftBasis } from "../../shared/ledger";
import type { PathDraft, StoryPath } from "./record";

/** An open draft as `drafts_due` answers it: due, and why it is stale where it is. */
export interface DraftDue extends PathDraft {
  /** Its time has come. */
  due: boolean;
  /** The point of the chat it was written against is no longer on the path. */
  basisGone: boolean;
  /** Beats played since it was opened, at or past its time, in its places or with its people. */
  beats: Beat[];
}

/** Whether `beat` is in a place `where` names or with someone `who` names: by them, to them, or reaching them. */
function touches(beat: Beat, who: readonly string[], where: readonly string[]): boolean {
  if (beat.where !== null && where.includes(beat.where)) return true;
  return who.includes(beat.by) || (beat.to ?? []).some((id) => who.includes(id)) || beat.exposure.some((e) => who.includes(e.who));
}

/**
 * Each open draft on `path` as it stands now (`now`, story time), with whether its basis is still on
 * the path (`onPath`); with `all`, every one, else only those due or stale. A draft its own beat
 * settles is no contradiction of it.
 */
export function draftsDue(path: StoryPath, now: number, onPath: (basis: DraftBasis) => boolean, all = false): DraftDue[] {
  const out: DraftDue[] = [];
  for (const { draft, opened } of path.drafts) {
    if (draft.state !== "open" && draft.state !== "stale") continue;
    const where = draft.where ?? [];
    const beats = path.beats.filter(({ beat, step }) => step > opened && beat.struck === undefined && beat.settles !== draft.id && beat.at >= draft.when && touches(beat, draft.who, where)).map((b) => b.beat);
    const entry: DraftDue = { draft, opened, due: draft.when <= now, basisGone: !onPath(draft.basis), beats };
    if (all || entry.due || entry.basisGone || beats.length > 0 || draft.state === "stale") out.push(entry);
  }
  return out;
}
