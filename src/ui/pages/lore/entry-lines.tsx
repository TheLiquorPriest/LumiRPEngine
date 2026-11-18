// What an entry is, edited from the Lore page (plan §9.1): its kind, which is any one line (the shipped indexer's kinds and those the chat
// already holds are offered as choices, and another can be typed), its one line, and its related entries. Each is yours once you set it:
// it stands over an indexing run's and outlives a run that indexes the entry again, and each has a way back to the run's. RPE answers the
// entry as it now stands, or refuses in its words.

import { useState } from "preact/hooks";
import { Banner, Button } from "../../../frontend/components";
import type { LoreIndexRow } from "../../../shared/api";
import { SUGGESTED_LORE_KINDS } from "../../../shared/lore-kinds";
import { useApp } from "../../app";
import { errorWords } from "../../words";
import { type EntryLinesEdit, editEntryLines } from "./read";

/** The choices of a kind: the shipped indexer's own kinds first, as suggestions, then every other kind the chat's index holds, then the entry's own where it is none of those. Nothing holds an entry to them: another can be typed. */
export function kindChoices(held: readonly string[], current: string | null): string[] {
  return [...new Set<string>([...SUGGESTED_LORE_KINDS, ...held, ...(current === null ? [] : [current])])];
}

export interface EntryLinesProps {
  chat: string;
  row: LoreIndexRow;
  /** The kinds the chat's index holds now, to offer beside the suggested ones. */
  kinds: readonly string[];
  /** The titles of the entries the page has read, by id, to say which entry a related id is. */
  titles: ReadonlyMap<string, string>;
  /** Called with the entry as it now stands, after a change. */
  onChanged(row: LoreIndexRow): void;
}

export function EntryLines(props: EntryLinesProps) {
  const { row } = props;
  const client = useApp().client;
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [line, setLine] = useState(row.line ?? "");
  const [relate, setRelate] = useState("");
  const [another, setAnother] = useState("");
  const yours = (field: "kind" | "line" | "related"): boolean => row.edited.includes(field);
  const send = (what: string, edit: EntryLinesEdit, words: string, then?: (next: LoreIndexRow) => void): void => {
    if (busy !== null) return;
    setBusy(what);
    setProblem(null);
    setSaid(null);
    editEntryLines(client, props.chat, row.id, edit).then(
      (next) => {
        setBusy(null);
        setSaid(words);
        then?.(next);
        props.onChanged(next);
      },
      (error: unknown) => {
        setBusy(null);
        setProblem(errorWords(error));
      },
    );
  };
  const choices = kindChoices(props.kinds, row.kind);
  return (
    <div class="lre-stack" data-entry-lines={row.id}>
      <div class="lre-inline rpe-wrap" data-kind>
        <label class="lre-field">
          <span class="label">Its kind</span>
          <select
            class="lre-input"
            value={row.kind ?? ""}
            disabled={busy !== null}
            onChange={(event) => {
              const kind = event.currentTarget.value;
              if (kind !== "" && kind !== row.kind) send("kind", { kind }, `The kind of ${row.title} is now ${kind}; it is yours and a run that indexes the entry again leaves it.`);
            }}
          >
            {row.kind === null ? <option value="">None yet</option> : null}
            {choices.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label class="lre-field">
          <span class="label">Or another kind</span>
          <input class="lre-input" value={another} placeholder="one line, as you would name it" onInput={(event) => setAnother(event.currentTarget.value)} />
        </label>
        <Button size="sm" busy={busy === "kind another"} disabled={busy !== null || another.trim() === "" || another.trim() === row.kind} onClick={() => send("kind another", { kind: another.trim() }, `The kind of ${row.title} is now ${another.trim()}; it is yours and a run that indexes the entry again leaves it.`, () => setAnother(""))}>
          Use it
        </Button>
        {yours("kind") ? (
          <Button size="sm" variant="ghost" busy={busy === "kind off"} disabled={busy !== null} onClick={() => send("kind off", { kind: null }, `${row.title} has the indexing run's kind again.`)}>
            Use the indexing run's kind
          </Button>
        ) : null}
      </div>
      <div class="lre-inline rpe-wrap" data-line-edit>
        <label class="lre-field">
          <span class="label">What it is, in a line</span>
          <input class="lre-input" value={line} onInput={(event) => setLine(event.currentTarget.value)} />
        </label>
        <Button size="sm" busy={busy === "line"} disabled={busy !== null || line.trim() === "" || line.trim() === (row.line ?? "")} onClick={() => send("line", { line: line.trim() }, `${row.title} has your line; a run that indexes the entry again leaves it.`)}>
          Keep my line
        </Button>
        {yours("line") ? (
          <Button size="sm" variant="ghost" busy={busy === "line off"} disabled={busy !== null} onClick={() => send("line off", { line: null }, `${row.title} has the indexing run's line again.`, (next) => setLine(next.line ?? ""))}>
            Use the indexing run's line
          </Button>
        ) : null}
      </div>
      <div class="lre-stack" data-related-edit>
        {row.related.length === 0 ? <p class="lre-muted rpe-line">No entry is related to it.</p> : null}
        <ul class="rpe-plain lre-stack">
          {row.related.map((id) => (
            <li key={id} class="lre-inline rpe-wrap" data-related={id}>
              <span class="rpe-line">
                {props.titles.get(id) ?? <span class="lre-muted">an entry not read yet</span>} <code class="lre-id">{id}</code>
              </span>
              <Button size="sm" variant="ghost" busy={busy === `off ${id}`} disabled={busy !== null} onClick={() => send(`off ${id}`, { related: row.related.filter((r) => r !== id) }, `${id} is no longer related to ${row.title}; the list is yours and a run that indexes the entry again leaves it.`)}>
                Take it off
              </Button>
            </li>
          ))}
        </ul>
        <div class="lre-inline rpe-wrap">
          <label class="lre-field">
            <span class="label">Relate it to the entry</span>
            <input class="lre-input" value={relate} placeholder="e-12 or w-3" spellcheck={false} onInput={(event) => setRelate(event.currentTarget.value)} />
          </label>
          <Button size="sm" busy={busy === "relate"} disabled={busy !== null || relate.trim() === ""} onClick={() => send("relate", { related: [...row.related, relate.trim()] }, `${relate.trim()} is related to ${row.title}; the list is yours and a run that indexes the entry again leaves it.`, () => setRelate(""))}>
            Relate it
          </Button>
          {yours("related") ? (
            <Button size="sm" variant="ghost" busy={busy === "related off"} disabled={busy !== null} onClick={() => send("related off", { related: null }, `${row.title} has the indexing run's related entries again.`)}>
              Use the indexing run's related entries
            </Button>
          ) : null}
        </div>
      </div>
      {said === null ? null : (
        <Banner tone="info" icon="check" title="Done">
          <span data-said>{said}</span>
        </Banner>
      )}
      {problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not changed">
          <span data-problem>{problem}</span>
        </Banner>
      )}
    </div>
  );
}
