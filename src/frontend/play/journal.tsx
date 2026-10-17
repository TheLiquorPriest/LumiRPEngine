// Play → Journal: every derived note (L16), Montage lines included, newest first, filterable by
// kind. Notes explain what the fold didn't apply and why (dropped, made on another branch,
// tombstoned, expired confirms, regenerated detail).

import { useState } from "preact/hooks";
import type { NoteKind } from "../../shared/ledger";
import { Card, Empty, Seg } from "../components";
import type { PanelProps } from "../registry";

const KIND_LABEL: Record<NoteKind, string> = {
  dropped: "Dropped",
  inert: "Other branch",
  renarrate_drop: "Re-narrate",
  tombstoned: "Discarded",
  expired: "Expired",
  regenerated: "Regenerated",
  note: "Note",
  fix: "Corrected",
};

const KIND_TONE: Record<NoteKind, string> = {
  dropped: "neg",
  inert: "",
  renarrate_drop: "warn",
  tombstoned: "neg",
  expired: "warn",
  regenerated: "accent",
  note: "accent",
  fix: "accent",
};

type Filter = "all" | "notes" | "issues";

export function JournalPanel(props: PanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const notes = [...props.state.journal].reverse().filter((note) => {
    // Applied lines (turns, montages, corrections) apart from what didn't apply.
    const applied = note.kind === "note" || note.kind === "regenerated" || note.kind === "fix";
    return filter === "all" || (filter === "notes") === applied;
  });
  return (
    <div class="lre-stack" data-lre-panel="core.journal">
      <Seg<Filter>
        label="Filter"
        value={filter}
        options={[
          { value: "all", label: `All (${props.state.journal.length})` },
          { value: "notes", label: "Notes & montages" },
          { value: "issues", label: "Not applied" },
        ]}
        onChange={(next) => setFilter(next)}
      />
      {notes.length === 0 ? (
        <Empty>Nothing in the journal yet.</Empty>
      ) : (
        <Card>
          {notes.map((note, i) => (
            <div key={`${note.messageId}:${i}`} class="lre-row" style={{ alignItems: "flex-start" }}>
              <span class="k" style={{ whiteSpace: "pre-wrap" }}>
                {note.text}
              </span>
              <span class={`lre-badge ${KIND_TONE[note.kind]}`}>{KIND_LABEL[note.kind]}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
