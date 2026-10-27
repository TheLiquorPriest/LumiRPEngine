// GM → This chat → Sections' preview (DESIGN §6.11): each section as the narrator would get it in
// the next turn, with its size and plain words for why it holds nothing, from `lre.sections`, which
// builds it the way a turn does. Behind the GM gate: a wider scope's lines carry their marks.

import { useEffect, useState } from "preact/hooks";
import type { ResultBodies, SectionPreview } from "../../shared/protocol";
import { SCOPE_LABEL } from "../../shared/world";
import { useApp } from "../app";
import { Badge, Empty } from "../components";

export type SectionsPreview = ResultBodies["lre.sections"];

/** What the turn itself writes into a section, which no preview can hold before it plays. */
const TURN_WRITES: Record<string, string> = {
  outcome: "When the turn plays, it opens with what your character's action resolved to: rolls, results and what the world did in answer.",
  montage: "Only a time skip fills it: the key events of the skipped time, for the narrator to tell as a montage.",
  outline: "When the turn plays, it holds the turn's plan for the reply, pointing only at the sections that went in.",
  scene: "When the turn plays, it also says how long the turn took.",
};

const STATUS_LABEL: Record<SectionPreview["status"], string> = {
  sent: "In the prompt",
  off: "Off",
  unplaced: "Not placed",
  empty: "Nothing now",
  clipped: "Over budget",
};

/**
 * The lines that say what a section holds, or why it holds nothing, in the GM's words: its size
 * against the budget, what its caps cut, its marked facts and hints, and what the turn adds itself.
 */
export function previewNotes(s: SectionPreview, budget: SectionsPreview["budget"]): string[] {
  const notes: string[] = [];
  if (s.status === "off") notes.push("Switched off for this chat or by the world: the narrator doesn't get it.");
  if (s.status === "unplaced") notes.push("It has no entry in the world's book to go into, so the narrator doesn't get it.");
  if (s.status === "empty") notes.push("Nothing to tell right now, so it stays out of the prompt.");
  if (s.status === "clipped") notes.push(s.slot === "minds" ? `Too big for the Minds budget of ${budget.minds} tokens, so it stays out.` : `Too big for what is left of the section budget of ${budget.sections} tokens, so it stays out.`);
  if (s.status === "sent" && s.tokens !== null) notes.push(`About ${s.tokens} tokens, of a section budget of ${budget.sections}.`);
  if (s.status !== "off" && s.scope !== "player") notes.push(`Whose knowledge: ${SCOPE_LABEL[s.scope].toLowerCase()}.`);
  if (s.marked > 0) notes.push(`${s.marked} ${s.marked === 1 ? "fact" : "facts"} your character doesn't know, each marked for the narrator.`);
  if (s.hints > 0) notes.push(`${s.hints} background ${s.hints === 1 ? "hint" : "hints"} at the end.`);
  if (s.cut > 0) notes.push(`${s.cut} ${s.cut === 1 ? "line" : "lines"} left out ${s.slot === "minds" ? "over its own budget" : "by its caps or the section budget"}.`);
  const turn = TURN_WRITES[s.slot];
  if (turn && s.status !== "off") notes.push(turn);
  return notes;
}

/** The chat's sections as the next turn would give them, asked again whenever `key` changes (an edit, a turn). */
export function useSectionsPreview(chatId: string, key: unknown): { preview: SectionsPreview | null; failed: boolean } {
  const app = useApp();
  const [preview, setPreview] = useState<SectionsPreview | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    void app.request({ type: "lre.sections", chatId }).then((result) => {
      if (!live) return;
      setFailed(result === null);
      if (result) setPreview(result);
    });
    return () => {
      live = false;
    };
  }, [chatId, key]);
  return { preview, failed };
}

/** One section's "What it holds now": its status, what explains it, and its text as the narrator reads it. */
export function SectionHolds(props: { section: SectionPreview; budget: SectionsPreview["budget"]; title?: string }) {
  const s = props.section;
  return (
    <div class="lre-section-preview" data-lre-section-preview={s.slot}>
      <div class="lre-section-preview-head">
        <span>{props.title ?? "What it holds now"}</span>
        <Badge tone={s.status === "sent" ? "pos" : s.status === "clipped" ? "warn" : "neutral"}>{STATUS_LABEL[s.status]}</Badge>
      </div>
      {previewNotes(s, props.budget).map((n) => (
        <span key={n} class="lre-small lre-muted">
          {n}
        </span>
      ))}
      {s.content !== null ? <pre class="lre-section-text">{s.content}</pre> : null}
    </div>
  );
}

/** Every section in prompt order, as the narrator would get them in the next turn. */
export function PreviewAll(props: { preview: SectionsPreview | null; failed: boolean }) {
  if (!props.preview) return props.failed ? <Empty icon="alert">The preview couldn't be built; the reason is in the notice above.</Empty> : <Empty icon="clock">Building the preview…</Empty>;
  const { sections, budget } = props.preview;
  return (
    <div class="lre-stack" data-lre-sections-preview>
      <span class="lre-small lre-muted">
        What the narrator would get if the next turn played now, in prompt order: built from the chat as it stands, the way a turn builds it, with no model call. The sections spend about {budget.used} of {budget.sections} tokens; what a turn writes itself (its outcome, a montage, its outline) comes when it plays.
      </span>
      {sections.map((s) => (
        <SectionHolds key={s.slot} section={s} budget={budget} title={s.label} />
      ))}
    </div>
  );
}
