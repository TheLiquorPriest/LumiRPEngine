// Play → Story → Journal: every derived note (L16), Montage lines included, newest first, filterable
// by what applied and what didn't. Notes explain what the fold didn't apply and why (dropped, made on
// another branch, not carried over by a swipe or a Re-read, discarded). "Save to lore…" (DESIGN §4.2)
// opens a small form that keeps the latest reply, or an excerpt of the chat, as a lore entry in the
// world's draft and opens the entry's form in Build.

import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { NoteKind } from "../../shared/ledger";
import { useApp } from "../app";
import { loadDraft } from "../build/draft";
import { Badge, Button, Empty, IconButton, Seg, useBusy } from "../components";
import type { IconName } from "../icons";
import { Icon } from "../icons";
import type { PanelProps } from "../registry";

const KIND: Record<NoteKind, { label: string; tone: "neutral" | "accent" | "warn" | "neg"; icon: IconName }> = {
  dropped: { label: "Dropped", tone: "neg", icon: "alert" },
  inert: { label: "Other branch", tone: "neutral", icon: "branch" },
  not_carried: { label: "Not carried", tone: "warn", icon: "undo" },
  tombstoned: { label: "Discarded", tone: "neg", icon: "trash" },
  note: { label: "Note", tone: "accent", icon: "scroll" },
  fix: { label: "Corrected", tone: "accent", icon: "edit" },
};

type Filter = "all" | "notes" | "issues";

/** The latest reply, or an excerpt selected in the chat or pasted here, saved as a draft lore entry; the entry's form opens in Build. */
function SaveToLore(props: { chatId: string; id: string; onClose(): void }) {
  const app = useApp();
  const [text, setText] = useState("");
  const [busy, run] = useBusy();
  const field = useRef<HTMLTextAreaElement>(null);
  // Read on pointer down: by the click, the tap may have moved the selection.
  const selection = useRef("");
  const excerpt = text.trim();
  useEffect(() => field.current?.focus(), []);
  const save = () =>
    run(async () => {
      const body = await app.request(excerpt === "" ? { type: "lre.lore", op: "save", chatId: props.chatId } : { type: "lre.lore", op: "save", chatId: props.chatId, text: excerpt });
      const worldId = body?.worldId;
      const id = body?.id;
      if (!worldId || !id) return;
      setText("");
      // The draft is read again so the form finds the new entry.
      if (!(await loadDraft(app, worldId))) return;
      app.ui.update((ui) => ({ ...ui, mode: "build", build: { view: "item", worldId, collection: "lore", id } }));
    });
  return (
    <section
      id={props.id}
      class="lre-play-lore"
      aria-label="Save to lore"
      data-lre-save-lore
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      <div class="lre-play-lore-head">
        <h3 class="lre-play-lore-title">Save to lore</h3>
        <IconButton icon="close" label="Close Save to lore" onClick={props.onClose} />
      </div>
      <p class="lre-play-lore-help">The latest reply, or an excerpt you select in the chat or paste here, becomes a lore entry in this world's draft. Its form opens so you can edit it before you commit.</p>
      <textarea ref={field} class="lre-input" rows={3} aria-label="Excerpt to save" placeholder="Excerpt (leave empty for the whole latest reply)" value={text} onInput={(event) => setText(event.currentTarget.value)} />
      <div class="lre-play-lore-actions">
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
        <Button variant="primary" size="sm" busy={busy} onClick={save}>
          {excerpt === "" ? "Save the latest reply" : "Save the excerpt"}
        </Button>
      </div>
    </section>
  );
}

export function JournalPanel(props: PanelProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [saving, setSaving] = useState(false);
  const formId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const journal = props.state.journal;
  const notes = [...journal].reverse().filter((note) => {
    // Applied lines (turns, montages, corrections) apart from what didn't apply.
    const applied = note.kind === "note" || note.kind === "fix";
    return filter === "all" || (filter === "notes") === applied;
  });
  const close = () => {
    setSaving(false);
    // Back to the action that opened the form, as the form leaves.
    toggle.current?.focus();
  };
  return (
    <div class="lre-play-journal" data-lre-panel="core.journal">
      <Seg<Filter>
        label="Filter"
        value={filter}
        options={[
          { value: "all", label: `All (${journal.length})` },
          { value: "notes", label: "Notes & montages" },
          { value: "issues", label: "Not applied" },
        ]}
        onChange={(next) => setFilter(next)}
      />
      {props.state.worldId ? (
        <div class="lre-play-journal-bar">
          <span class="lre-play-journal-order">Newest first</span>
          <button ref={toggle} type="button" class="lre-btn ghost small" aria-expanded={saving} aria-controls={saving ? formId : undefined} onClick={() => (saving ? close() : setSaving(true))}>
            <Icon name="book" size={16} />
            Save to lore…
          </button>
        </div>
      ) : null}
      {saving && props.state.worldId ? <SaveToLore chatId={props.chatId} id={formId} onClose={close} /> : null}
      {notes.length === 0 ? (
        journal.length === 0 ? (
          <Empty icon="scroll" title="Nothing in the journal yet">
            Each turn's notes, montages and anything that didn't apply show here.
          </Empty>
        ) : (
          <Empty icon="filter" title="Nothing matches this filter" />
        )
      ) : (
        <ol class="lre-play-notes">
          {notes.map((note, i) => (
            <li key={`${note.messageId}:${i}`} class="lre-play-note" data-kind={note.kind}>
              <Icon name={KIND[note.kind].icon} class={`lre-play-note-icon ${KIND[note.kind].tone}`} />
              <div class="lre-play-note-body">
                <p class="lre-play-note-text">{note.text}</p>
                <Badge tone={KIND[note.kind].tone}>{KIND[note.kind].label}</Badge>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
