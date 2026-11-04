// The turns' transcripts as workspace files (DESIGN §4.6): one under `transcripts/` for each reply on
// the chat's chain whose active record keeps a transcript (`RecSession.transcript`), so they follow
// the chat's path as its workspace does: a swipe shows its own, and a Branch those of the chain it
// keeps. Every agent reads them, as the GM does; each one's size is the length its record notes; none
// is a pin or part of the main session, and nothing writes, moves, deletes or pins one
// (`tools/writer.ts`).
//
// Which a chat keeps is the user's (Settings → Agents → Retention, `turnTranscripts` and
// `turnTranscriptDays`; every one by default): those of its latest replies, written within the days
// it keeps them. One past it is listed no more and the sweep (`sweep.ts`) no longer counts it
// referenced, so it goes once nothing else needs it; no record changes.

import type { MessageId } from "../../../shared/ids";
import { DAY_MS, type RetentionSettings, transcriptPath } from "../../../shared/stores";
import { activeRecord } from "../../../engine/ledger/path";
import { recordSessionOf } from "../sessions";
import type { ChatHead, WorkspaceFile } from "./workspace";

/** What decides which of a chat's transcripts are kept: the user's retention, at `now` (epoch ms). */
export interface TranscriptKeep {
  retention: Pick<RetentionSettings, "turnTranscripts" | "turnTranscriptDays">;
  now: number;
}

/** Each reply of a chat's messages by its place from the chat's end, the latest 0: the replies Settings → Agents → Retention's turn limit counts. */
export function repliesFromEnd(messages: readonly { id: MessageId; isUser: boolean }[]): Map<MessageId, number> {
  const out = new Map<MessageId, number>();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && !m.isUser) out.set(m.id, out.size);
  }
  return out;
}

/**
 * Whether a turn's transcript is kept: its reply among the chat's latest `turnTranscripts`
 * (`fromEnd`, its place from the chat's end, 0 the latest), and written (`at`) within
 * `turnTranscriptDays` of `now`. A limit at "none" keeps every one, and a reply whose place isn't
 * known, or a transcript whose record never noted when it was written, is kept for want of it.
 */
export function transcriptKept(keep: TranscriptKeep, fromEnd: number | null, at: number | undefined): boolean {
  const { turnTranscripts: turns, turnTranscriptDays: days } = keep.retention;
  return !(turns !== "none" && fromEnd !== null && fromEnd >= turns) && !(days !== "none" && at !== undefined && keep.now - at > days * DAY_MS);
}

/** The transcripts of the head's chain that `keep` keeps, in its order. */
export function transcriptFiles(head: ChatHead, keep: TranscriptKeep): WorkspaceFile[] {
  const chain = head.core.chain(head.observed);
  const places = repliesFromEnd(chain);
  const out: WorkspaceFile[] = [];
  let turn = 0;
  for (const m of chain) {
    if (m.isUser) continue;
    turn++;
    const rec = activeRecord(m, head.core.journal.tombstones);
    const { transcript, transcriptChars, transcriptAt } = recordSessionOf(rec);
    if (transcript === undefined || !transcriptKept(keep, places.get(m.id) ?? null, transcriptAt)) continue;
    out.push({ path: transcriptPath(turn), hash: transcript, size: transcriptChars ?? 0, pinned: false, learned: false, transcript: true, provenance: { turn } });
  }
  return out;
}
