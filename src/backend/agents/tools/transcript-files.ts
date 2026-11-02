// The turns' transcripts as workspace files (DESIGN §4.6): one under `transcripts/` for each reply on
// the chat's chain whose active record keeps a transcript (`RecSession.transcript`), so they follow
// the chat's path as its workspace does: a swipe shows its own, and a Branch those of the chain it
// keeps. Each is the GM's alone to read, its size the length its record notes; none is a pin or part
// of the main session, and nothing writes, moves, deletes or pins one (`tools/writer.ts`).

import { transcriptPath } from "../../../shared/stores";
import { activeRecord } from "../../../engine/ledger/path";
import { recordSessionOf } from "../sessions";
import type { ChatHead, WorkspaceFile } from "./workspace";

/** The transcripts of the head's chain, in its order. */
export function transcriptFiles(head: ChatHead): WorkspaceFile[] {
  const out: WorkspaceFile[] = [];
  let turn = 0;
  for (const m of head.core.chain(head.observed)) {
    if (m.isUser) continue;
    turn++;
    const rec = activeRecord(m, head.core.journal.tombstones);
    const { transcript, transcriptChars } = recordSessionOf(rec);
    if (transcript === undefined) continue;
    out.push({ path: transcriptPath(turn), hash: transcript, size: transcriptChars ?? 0, pinned: false, readers: "gm", learned: false, transcript: true, provenance: { turn } });
  }
  return out;
}
