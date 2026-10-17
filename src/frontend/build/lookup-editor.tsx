// Build → Lore lookup table (DESIGN §4.2): terms that lead RPEngine's lore lookups to entries, and
// topics as a table of contents. Edits stay local until Save to draft. Suggestions come from the
// entries: their titles, aliases and keywords for terms, the topics they name for topics.

import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { hasOwn } from "../../shared/json";
import { addToLoreIndex, loreIndexJson, loreTerm, termSuggestions, topicIdOf, topicSuggestions } from "../../shared/lore";
import type { LintIssue } from "../../shared/protocol";
import type { LoreIndex, WorldDoc } from "../../shared/world";
import { Card, Empty, Seg, useBusy } from "../components";

/** Suggestions listed at once; the rest wait behind "Show all". */
const SUGGESTIONS_SHOWN = 12;

function Issues(props: { lint: readonly LintIssue[]; path: string }) {
  const issues = props.lint.filter((issue) => issue.path === props.path);
  return (
    <>
      {issues.map((issue) => (
        <span key={issue.code} class={issue.severity === "error" ? "lre-small lre-neg" : "lre-small lre-warn"} style={{ display: "block" }}>
          {issue.message}
        </span>
      ))}
    </>
  );
}

/** An item's entries as removable chips, plus a picker of the rest. */
function EntryChips(props: { ids: readonly string[]; doc: WorldDoc; label: string; onChange(next: string[]): void }) {
  const titleOf = (id: string): string => (hasOwn(props.doc.lore, id) ? props.doc.lore[id]?.title || id : `${id} (missing)`);
  const rest = Object.keys(props.doc.lore).filter((id) => !props.ids.includes(id));
  return (
    <div class="lre-stack" style={{ gap: "4px" }}>
      {props.ids.length > 0 ? (
        <div class="lre-inline" style={{ flexWrap: "wrap" }}>
          {props.ids.map((id) => (
            <button key={id} type="button" class="lre-btn small" aria-label={`Remove ${titleOf(id)} from ${props.label}`} onClick={() => props.onChange(props.ids.filter((other) => other !== id))}>
              {titleOf(id)} ✕
            </button>
          ))}
        </div>
      ) : null}
      {rest.length > 0 ? (
        <select class="lre-input" value="" aria-label={`Add an entry to ${props.label}`} onChange={(event) => (event.currentTarget.value ? props.onChange([...props.ids, event.currentTarget.value]) : undefined)}>
          <option value="">+ Entry…</option>
          {rest.map((id) => (
            <option key={id} value={id}>
              {titleOf(id)}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function TermsPanel(props: { doc: WorldDoc; lint: readonly LintIssue[]; value: LoreIndex; onChange(next: LoreIndex): void }) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [entry, setEntry] = useState("");
  const [all, setAll] = useState(false);
  const { value } = props;
  const titleOf = (id: string): string => (hasOwn(props.doc.lore, id) ? props.doc.lore[id]?.title || id : id);
  const q = loreTerm(query);
  const terms = Object.entries(value.terms).filter(([t, ids]) => q === "" || t.includes(q) || ids.some((id) => titleOf(id).toLowerCase().includes(q)));
  const suggestions = termSuggestions({ lore: props.doc.lore, loreIndex: value });
  const aliases = suggestions.filter((s) => s.from === "alias");
  const setTerms = (terms: LoreIndex["terms"]) => props.onChange({ ...value, terms });
  const adopt = (picked: readonly { term: string; entry: string }[]) => props.onChange(picked.reduce((index, s) => addToLoreIndex(index, s.entry, { terms: [s.term], topics: [] }), value));
  const added = loreTerm(term);
  return (
    <div class="lre-stack">
      {Object.keys(value.terms).length > 8 ? <input class="lre-input" placeholder="Search terms and entries" aria-label="Search terms" value={query} onInput={(event) => setQuery(event.currentTarget.value)} /> : null}
      <Card title="Terms" aside={<span class="lre-badge">{Object.keys(value.terms).length}</span>}>
        {terms.length === 0 ? <Empty>{Object.keys(value.terms).length === 0 ? "No terms yet. Add one below, or take a suggestion." : "No matches."}</Empty> : null}
        {terms.map(([t, ids]) => (
          <div key={t} class="lre-stack" style={{ gap: "4px", padding: "8px 0", borderBottom: "1px solid rgba(127,127,127,.15)" }} data-lre-term={t}>
            <div class="lre-spread">
              <code style={{ overflowWrap: "anywhere" }}>{t}</code>
              <button
                type="button"
                class="lre-btn small ghost"
                aria-label={`Remove the term ${t}`}
                onClick={() => {
                  const next = { ...value.terms };
                  delete next[t];
                  setTerms(next);
                }}
              >
                Remove
              </button>
            </div>
            <EntryChips ids={ids} doc={props.doc} label={`“${t}”`} onChange={(next) => setTerms({ ...value.terms, [t]: next })} />
            <Issues lint={props.lint} path={`loreIndex.terms.${t}`} />
          </div>
        ))}
        <form
          class="lre-stack"
          style={{ gap: "6px", marginTop: "8px" }}
          onSubmit={(event) => {
            event.preventDefault();
            if (added === "" || entry === "") return;
            adopt([{ term: added, entry }]);
            setTerm("");
          }}
        >
          <input class="lre-input" placeholder="New term, e.g. the old lighthouse" aria-label="New term" value={term} onInput={(event) => setTerm(event.currentTarget.value)} />
          <div class="lre-inline">
            <select class="lre-input" style={{ flex: 1, minWidth: 0 }} aria-label="Entry the new term leads to" value={entry} onChange={(event) => setEntry(event.currentTarget.value)}>
              <option value="">Leads to…</option>
              {Object.keys(props.doc.lore).map((id) => (
                <option key={id} value={id}>
                  {titleOf(id)}
                </option>
              ))}
            </select>
            <button type="submit" class="lre-btn primary" disabled={added === "" || entry === ""}>
              + Add
            </button>
          </div>
        </form>
      </Card>
      <Card title="Suggestions" aside={<span class="lre-badge">{suggestions.length}</span>}>
        {suggestions.length === 0 ? (
          <Empty>Every title, alias and keyword already leads to its entry.</Empty>
        ) : (
          <div class="lre-stack" data-lre-term-suggestions>
            <span class="lre-small lre-muted">From the entries' titles, aliases and keywords.</span>
            {aliases.length > 0 ? (
              <button type="button" class="lre-btn small" onClick={() => adopt(aliases)}>
                Add all aliases as terms ({aliases.length})
              </button>
            ) : null}
            {(all ? suggestions : suggestions.slice(0, SUGGESTIONS_SHOWN)).map((s) => (
              <div key={`${s.term}:${s.entry}`} class="lre-spread">
                <span style={{ flex: "1 1 0", minWidth: 0, overflowWrap: "anywhere" }}>
                  <code>{s.term}</code> → {titleOf(s.entry)} <span class="lre-small lre-muted">· {s.from}</span>
                </span>
                <button type="button" class="lre-btn small" aria-label={`Add ${s.term} for ${titleOf(s.entry)}`} onClick={() => adopt([s])}>
                  Add
                </button>
              </div>
            ))}
            {!all && suggestions.length > SUGGESTIONS_SHOWN ? (
              <button type="button" class="lre-btn small ghost" onClick={() => setAll(true)}>
                Show all {suggestions.length}
              </button>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

function TopicsPanel(props: { doc: WorldDoc; lint: readonly LintIssue[]; value: LoreIndex; onChange(next: LoreIndex): void }) {
  const [label, setLabel] = useState("");
  const { value } = props;
  const suggestions = topicSuggestions({ lore: props.doc.lore, loreIndex: value });
  const setTopics = (topics: LoreIndex["topics"]) => props.onChange({ ...value, topics });
  const adopt = (picked: readonly { id: string; label: string; entries: string[] }[]) => props.onChange(picked.reduce((index, s) => s.entries.reduce((acc, entry) => addToLoreIndex(acc, entry, { terms: [], topics: [{ id: s.id, label: s.label }] }), index), value));
  // A new topic's id comes from its label; a taken one gets a number.
  const base = topicIdOf(label);
  let id = base;
  for (let n = 2; id !== "" && hasOwn(value.topics, id); n++) id = `${base}_${n}`;
  return (
    <div class="lre-stack">
      <Card title="Topics" aside={<span class="lre-badge">{Object.keys(value.topics).length}</span>}>
        {Object.keys(value.topics).length === 0 ? <Empty>No topics yet. Add one below, or take a suggestion.</Empty> : null}
        {Object.entries(value.topics).map(([topicId, topic]) => (
          <div key={topicId} class="lre-stack" style={{ gap: "4px", padding: "8px 0", borderBottom: "1px solid rgba(127,127,127,.15)" }} data-lre-topic={topicId}>
            <div class="lre-inline">
              <input class="lre-input" style={{ flex: 1, minWidth: 0 }} aria-label={`Label of topic ${topicId}`} value={topic.label} onInput={(event) => setTopics({ ...value.topics, [topicId]: { ...topic, label: event.currentTarget.value } })} />
              <button
                type="button"
                class="lre-btn small ghost"
                aria-label={`Remove the topic ${topic.label || topicId}`}
                onClick={() => {
                  const next = { ...value.topics };
                  delete next[topicId];
                  setTopics(next);
                }}
              >
                Remove
              </button>
            </div>
            <span class="lre-small lre-muted">
              <code>{topicId}</code>
            </span>
            <EntryChips ids={topic.entries} doc={props.doc} label={topic.label || topicId} onChange={(next) => setTopics({ ...value.topics, [topicId]: { ...topic, entries: next } })} />
            <Issues lint={props.lint} path={`loreIndex.topics.${topicId}`} />
          </div>
        ))}
        <form
          class="lre-inline"
          style={{ marginTop: "8px" }}
          onSubmit={(event) => {
            event.preventDefault();
            if (id === "") return;
            setTopics({ ...value.topics, [id]: { label: label.trim(), entries: [] } });
            setLabel("");
          }}
        >
          <input class="lre-input" style={{ flex: 1, minWidth: 0 }} placeholder="New topic, e.g. Harbor law" aria-label="New topic" value={label} onInput={(event) => setLabel(event.currentTarget.value)} />
          <button type="submit" class="lre-btn primary" disabled={id === ""}>
            + Add
          </button>
        </form>
      </Card>
      <Card title="Suggestions" aside={<span class="lre-badge">{suggestions.length}</span>}>
        {suggestions.length === 0 ? (
          <Empty>Every topic an entry names already lists it.</Empty>
        ) : (
          <div class="lre-stack" data-lre-topic-suggestions>
            <span class="lre-small lre-muted">Topics the entries name.</span>
            {suggestions.length > 1 ? (
              <button type="button" class="lre-btn small" onClick={() => adopt(suggestions)}>
                File them all ({suggestions.length})
              </button>
            ) : null}
            {suggestions.map((s) => (
              <div key={s.id} class="lre-spread">
                <span style={{ flex: "1 1 0", minWidth: 0, overflowWrap: "anywhere" }}>
                  {s.label} <span class="lre-small lre-muted">· {s.entries.length} entr{s.entries.length === 1 ? "y" : "ies"}</span>
                </span>
                <button type="button" class="lre-btn small" aria-label={`File entries under ${s.label}`} onClick={() => adopt([s])}>
                  Add
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function LookupTableEditor(props: { doc: WorldDoc; lint: readonly LintIssue[]; save(value: JsonObject): Promise<unknown> }) {
  const initial = props.doc.loreIndex;
  const [value, setValue] = useState<LoreIndex>(initial);
  const [tab, setTab] = useState<"terms" | "topics">("terms");
  const [busy, run] = useBusy();
  useEffect(() => setValue(initial), [JSON.stringify(initial)]);
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <div class="lre-stack" data-lre-editor="part:loreIndex">
      <div class="lre-h2">Lore lookup table</div>
      <span class="lre-small lre-muted">Terms lead RPEngine's lore lookups to entries; topics are its table of contents. Like the entries, it isn't delivered to the AI yet.</span>
      <Seg<"terms" | "topics">
        label="Show"
        value={tab}
        options={[
          { value: "terms", label: `Terms (${Object.keys(value.terms).length})` },
          { value: "topics", label: `Topics (${Object.keys(value.topics).length})` },
        ]}
        onChange={(next) => setTab(next)}
      />
      {Object.keys(props.doc.lore).length === 0 ? <div class="lre-banner info">The world has no lore entries yet; terms and topics lead to entries.</div> : null}
      {tab === "terms" ? <TermsPanel doc={props.doc} lint={props.lint} value={value} onChange={setValue} /> : <TopicsPanel doc={props.doc} lint={props.lint} value={value} onChange={setValue} />}
      <div class="lre-inline" style={{ position: "sticky", bottom: 0, padding: "8px 0", background: "var(--lre-fill)" }}>
        <button type="button" class="lre-btn primary" disabled={!changed || busy} onClick={() => run(() => props.save(loreIndexJson(value)))}>
          Save to draft
        </button>
        <button type="button" class="lre-btn ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </button>
      </div>
    </div>
  );
}
