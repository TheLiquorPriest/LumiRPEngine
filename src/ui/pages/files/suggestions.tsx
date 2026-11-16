// The agents' suggestions on the Files page: each with its file, who filed it and when, why, and what it would
// change; accepted at a level (shown before the press) as proposed or edited, or dismissed.

import type { SuggestionShown } from "../../../shared/api";
import { Banner, Button, Section } from "../../atoms";
import { when } from "../../words";
import type { FilesShown, WriteLevel } from "./model";
import { SUGGESTION_LEVELS, suggestedLevel } from "./model";
import { DiffLines, WRITE_WORDS } from "./open";

export interface SuggestionActions {
  onEdit(id: number | null): void;
  onEditText(text: string): void;
  onLevel(id: number, level: WriteLevel): void;
  onAccept(id: number): void;
  onDismiss(id: number): void;
}

/** A suggestion: its file, who filed it and when, why, and what it would change; accepted at a level as proposed or edited, or dismissed. */
function SuggestionItem(props: SuggestionActions & { chat: string | null; shown: FilesShown; suggestion: SuggestionShown }) {
  const { suggestion: s, shown } = props;
  const editing = shown.suggestions.editing?.id === s.id ? shown.suggestions.editing : null;
  const level = shown.suggestions.levels[s.id] ?? suggestedLevel(s.path, s.level);
  const levels = (s.levels ?? SUGGESTION_LEVELS).filter((l): l is WriteLevel => l !== "shipped");
  const refusal = shown.refusal !== null && shown.refusal.at === s.id ? shown.refusal.words : null;
  const filed = [`From the ${s.agent.definition} (${s.agent.id}) ${s.turn === null ? "outside a turn" : `in ${s.turn}`}`, when(s.at), props.chat === null ? `chat ${s.chat}` : null].filter((part) => part !== null).join(" · ");
  return (
    <li class="lre-stack rpe-suggestion" data-suggestion={s.id}>
      <p class="rpe-line rpe-strong">{s.path}</p>
      <p class="rpe-meta">{filed}</p>
      <p class="rpe-line">{s.reason}</p>
      {editing === null ? (
        <>
          <p class="rpe-meta">What it would change:</p>
          <DiffLines lines={s.lines} />
        </>
      ) : (
        <label class="lre-field">
          <span class="label">The text you accept</span>
          <textarea class="lre-input rpe-editor" spellcheck={false} value={editing.text} onInput={(event) => props.onEditText(event.currentTarget.value)} />
        </label>
      )}
      <label class="lre-field">
        <span class="label">Write it as</span>
        <select class="lre-input" onChange={(event) => props.onLevel(s.id, levels.find((l) => l === event.currentTarget.value) ?? level)}>
          {levels.map((l) => (
            <option key={l} value={l} selected={l === level}>
              {WRITE_WORDS[l]}
            </option>
          ))}
        </select>
      </label>
      {refusal === null ? null : (
        <Banner tone="neg" icon="alert" title="RPE did not make that change">
          <span>{refusal}</span>
        </Banner>
      )}
      <div class="lre-inline rpe-wrap">
        {editing === null ? (
          <>
            <Button small kind="primary" busy={shown.busy} onClick={() => props.onAccept(s.id)}>
              Accept
            </Button>
            <Button small onClick={() => props.onEdit(s.id)}>
              Edit, then accept
            </Button>
          </>
        ) : (
          <>
            <Button small kind="primary" busy={shown.busy} onClick={() => props.onAccept(s.id)}>
              Accept as edited
            </Button>
            <Button small kind="ghost" onClick={() => props.onEdit(null)}>
              Cancel
            </Button>
          </>
        )}
        <Button small kind="ghost" busy={shown.busy} onClick={() => props.onDismiss(s.id)}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}

export function SuggestionsSection(props: SuggestionActions & { chat: string | null; shown: FilesShown }) {
  const { list, problem } = props.shown.suggestions;
  if (list === null && problem === null) return null;
  return (
    <Section title={list === null ? "Suggestions" : `Suggestions (${list.length})`} id="suggestions">
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The suggestions could not be read">
          <span>{problem}</span>
        </Banner>
      )}
      {list === null ? null : list.length === 0 ? (
        <p class="lre-muted rpe-line">No suggestion is open.</p>
      ) : (
        <ul class="lre-stack rpe-plain">
          {list.map((s) => (
            <SuggestionItem key={s.id} {...props} suggestion={s} />
          ))}
        </ul>
      )}
    </Section>
  );
}
