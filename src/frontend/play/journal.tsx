// Play → Journal: every derived note (L16), Montage lines included, newest first, filterable by
// kind. Notes explain what the fold didn't apply and why (dropped, made on another branch,
// tombstoned, expired confirms, regenerated detail). Save to lore (DESIGN §4.2) keeps the latest
// reply, or an excerpt of the chat, as a lore entry in the world's draft and opens its form.

import { useRef, useState } from "preact/hooks";
import type { NoteKind } from "../../shared/ledger";
import { useApp } from "../app";
import { loadDraft } from "../build/draft";
import { Card, Empty, Seg, useBusy } from "../components";
import type { PanelProps } from "../registry";

const KIND_LABEL: Record<NoteKind, string> = {
  dropped: "Dropped",
  inert: "Other branch",
  not_carried: "Not carried",
  tombstoned: "Discarded",
  expired: "Expired",
  regenerated: "Regenerated",
  note: "Note",
  fix: "Corrected",
};

const KIND_TONE: Record<NoteKind, string> = {
  dropped: "neg",
  inert: "",
  not_carried: "warn",
  tombstoned: "neg",
  expired: "warn",
  regenerated: "accent",
  note: "accent",
  fix: "accent",
};

type Filter = "all" | "notes" | "issues";

/** The latest reply, or an excerpt selected in the chat or pasted here, saved as a draft lore entry; the entry's form opens in Build. */
function SaveToLore(props: { chatId: string }) {
  const app = useApp();
  const [text, setText] = useState("");
  const [busy, run] = useBusy();
  // Read on pointer down: by the click, the tap may have moved the selection.
  const selection = useRef("");
  const excerpt = text.trim();
  const save = () =>
    run(async () => {
      const body = await app.request(excerpt === "" ? { type: "lre.lore", op: "save", chatId: props.chatId } : { type: "lre.lore", op: "save", chatId: props.chatId, text: excerpt });
      const worldId = body?.worldId;
      const id = body?.id;
      if (!worldId || !id) return;
      setText("");
      // The draft is read again so the form finds the new entry.
      if (!(await loadDraft(app, worldId))) return;
      app.ui.update((ui) => ({ ...ui, section: "build", build: { view: "item", worldId, collection: "lore", id } }));
    });
  return (
    <Card title="Save to lore">
      <div class="lre-stack" data-lre-save-lore>
        <span class="lre-small lre-muted">The latest reply, or an excerpt you select in the chat or paste here, becomes a lore entry in this world's draft. Its form opens so you can edit it before you commit.</span>
        <textarea class="lre-input" rows={3} style={{ fontFamily: "inherit" }} aria-label="Excerpt to save" placeholder="Excerpt (leave empty for the whole latest reply)" value={text} onInput={(event) => setText(event.currentTarget.value)} />
        <div class="lre-inline" style={{ flexWrap: "wrap" }}>
          <button
            type="button"
            class="lre-btn small"
            onPointerDown={() => {
              selection.current = window.getSelection()?.toString().trim() ?? "";
            }}
            onClick={() => {
              const picked = selection.current || (window.getSelection()?.toString().trim() ?? "");
              if (picked === "") app.toast("Select some text in the chat first.", "info");
              else setText(picked);
            }}
          >
            Use selected text
          </button>
          <button type="button" class="lre-btn small primary" disabled={busy} onClick={save}>
            {excerpt === "" ? "Save the latest reply" : "Save the excerpt"}
          </button>
        </div>
      </div>
    </Card>
  );
}

export function JournalPanel(props: PanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const notes = [...props.state.journal].reverse().filter((note) => {
    // Applied lines (turns, montages, corrections) apart from what didn't apply.
    const applied = note.kind === "note" || note.kind === "regenerated" || note.kind === "fix";
    return filter === "all" || (filter === "notes") === applied;
  });
  return (
    <div class="lre-stack" data-lre-panel="core.journal">
      {props.state.worldId ? <SaveToLore chatId={props.chatId} /> : null}
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
