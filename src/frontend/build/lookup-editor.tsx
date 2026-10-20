// Build → Lore lookup table (DESIGN §4.2): terms that lead RPEngine's lore lookups to entries, and
// topics as a table of contents. Each term and topic is a group with its entries as chips and a
// picker of the rest; suggestions come from the entries: their titles, aliases and keywords for
// terms, the topics they name for topics. Edits stay local until Save to draft. Styles: the lore
// block of styles/forms.ts.

import { useId, useMemo, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { hasOwn } from "../../shared/json";
import { addToLoreIndex, loreIndexJson, loreTerm, termSuggestions, topicIdOf, topicSuggestions } from "../../shared/lore";
import type { LintIssue } from "../../shared/protocol";
import type { LoreIndex, WorldDoc } from "../../shared/world";
import { Badge, Banner, Button, Empty, Field, IconButton, IdText, PageHeader, SaveBar, Seg, useBusy } from "../components";
import { Icon } from "../icons";
import type { RefOption } from "./form-kit";
import { AddPicker, Chip, FormGroup, Issues, ItemRow, RefPicker } from "./form-kit";
import { useHeld } from "./held";
import { refOptions } from "./schema-form";

/** Suggestions listed at once; the rest wait behind "Show all". */
const SUGGESTIONS_SHOWN = 12;

/** An item's entries as removable chips, named by title, plus a picker of the rest. */
function EntryChips(props: { ids: readonly string[]; doc: WorldDoc; options: readonly RefOption[]; label: string; onChange(next: string[]): void }) {
  const titleOf = (id: string): string => (hasOwn(props.doc.lore, id) ? props.doc.lore[id]?.title || id : `${id} (missing)`);
  const rest = props.options.filter((o) => !props.ids.includes(o.value));
  return (
    <>
      {props.ids.length > 0 ? (
        <div class="lre-form-chips">
          {props.ids.map((id) => (
            <Chip key={id} tone={hasOwn(props.doc.lore, id) ? undefined : "neg"} removeLabel={`Remove ${titleOf(id)} from ${props.label}`} onRemove={() => props.onChange(props.ids.filter((other) => other !== id))}>
              {titleOf(id)}
            </Chip>
          ))}
        </div>
      ) : null}
      {rest.length > 0 ? <AddPicker label={`Add an entry to ${props.label}`} options={rest} placeholder="Add an entry…" onAdd={(id) => props.onChange([...props.ids, id])} /> : null}
    </>
  );
}

/** A list's heading outside the cards, in the section style, with an optional count. */
function ListHead(props: { title: string; count?: number }) {
  return (
    <div class="lre-section-head">
      <h3 class="lre-section-title">{props.title}</h3>
      {props.count !== undefined ? <Badge>{props.count}</Badge> : null}
    </div>
  );
}

function TermsPanel(props: { doc: WorldDoc; lint: readonly LintIssue[]; value: LoreIndex; onChange(next: LoreIndex): void }) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [entry, setEntry] = useState("");
  const [all, setAll] = useState(false);
  const termId = useId();
  const { value } = props;
  const options = useMemo(() => refOptions(props.doc, "lore"), [props.doc]);
  const titleOf = (id: string): string => (hasOwn(props.doc.lore, id) ? props.doc.lore[id]?.title || id : id);
  const q = loreTerm(query);
  const count = Object.keys(value.terms).length;
  const terms = Object.entries(value.terms).filter(([t, ids]) => q === "" || t.includes(q) || ids.some((id) => titleOf(id).toLowerCase().includes(q)));
  const suggestions = termSuggestions({ lore: props.doc.lore, loreIndex: value });
  const aliases = suggestions.filter((s) => s.from === "alias");
  const setTerms = (terms: LoreIndex["terms"]) => props.onChange({ ...value, terms });
  const adopt = (picked: readonly { term: string; entry: string }[]) => props.onChange(picked.reduce((index, s) => addToLoreIndex(index, s.entry, { terms: [s.term], topics: [] }), value));
  const added = loreTerm(term);
  return (
    <>
      <div class="lre-form-lore-fields">
        <ListHead title="Terms" />
        {count > 8 ? (
          <div class="lre-build-search">
            <Icon name="search" size={16} />
            <input class="lre-input" type="search" placeholder="Search terms and entries" aria-label="Search terms" value={query} onInput={(event) => setQuery(event.currentTarget.value)} />
          </div>
        ) : null}
        {terms.length === 0 ? (
          count === 0 ? (
            <Empty icon="search" title="No terms yet">
              Add one below, or take a suggestion.
            </Empty>
          ) : (
            <Empty icon="search" title="No matches">
              No term or entry matches “{query.trim()}”.
            </Empty>
          )
        ) : null}
        {terms.map(([t, ids]) => (
          // The wrapper only carries the term's hook for scripts and tests; it takes no box.
          <div key={t} class="lre-form-lore-wrap" data-lre-term={t}>
            <FormGroup
              title={t}
              aside={
                <IconButton
                  icon="trash"
                  label={`Remove the term “${t}”`}
                  onClick={() => {
                    const next = { ...value.terms };
                    delete next[t];
                    setTerms(next);
                  }}
                />
              }
            >
              <div class="lre-field">
                <span class="label">Leads to</span>
                <EntryChips ids={ids} doc={props.doc} options={options} label={`“${t}”`} onChange={(next) => setTerms({ ...value.terms, [t]: next })} />
              </div>
              {/* Only the term's own path: a term may hold dots, so lintAt's prefix match could take another term's lint. */}
              <Issues issues={props.lint.filter((issue) => issue.path === `loreIndex.terms.${t}`)} />
            </FormGroup>
          </div>
        ))}
        <FormGroup title="Add a term">
          <form
            class="lre-form-lore-fields"
            onSubmit={(event) => {
              event.preventDefault();
              if (added === "" || entry === "") return;
              adopt([{ term: added, entry }]);
              setTerm("");
            }}
          >
            <Field label="Term" for={termId} help="What a lookup matches: lowercase, single spaces">
              <input id={termId} class="lre-input" placeholder="e.g. the old lighthouse" autoComplete="off" value={term} onInput={(event) => setTerm(event.currentTarget.value)} />
            </Field>
            <div class="lre-form-add">
              <RefPicker label="Leads to" value={entry} options={options} placeholder="Choose an entry…" disabled={options.length === 0} onChange={setEntry} />
              <Button type="submit" variant="primary" icon="plus" disabled={added === "" || entry === ""}>
                Add
              </Button>
            </div>
          </form>
        </FormGroup>
      </div>
      <div class="lre-form-lore-fields" data-lre-term-suggestions>
        <ListHead title="Suggestions" count={suggestions.length} />
        {suggestions.length === 0 ? (
          <Empty icon="check">Every title, alias and keyword already leads to its entry.</Empty>
        ) : (
          <>
            <span class="lre-form-lore-note">From the entries' titles, aliases and keywords.</span>
            {aliases.length > 0 ? (
              <span class="lre-form-lore-actions">
                <Button size="sm" icon="plus" onClick={() => adopt(aliases)}>
                  Add all aliases as terms ({aliases.length})
                </Button>
              </span>
            ) : null}
            <div class="lre-form-items">
              {(all ? suggestions : suggestions.slice(0, SUGGESTIONS_SHOWN)).map((s) => (
                <ItemRow
                  key={`${s.term}:${s.entry}`}
                  title={
                    <>
                      {s.term} → {titleOf(s.entry)} <span class="lre-form-lore-from">· {s.from}</span>
                    </>
                  }
                  actions={
                    <Button size="sm" label={`Add ${s.term} for ${titleOf(s.entry)}`} onClick={() => adopt([s])}>
                      Add
                    </Button>
                  }
                />
              ))}
            </div>
            {!all && suggestions.length > SUGGESTIONS_SHOWN ? (
              <span class="lre-form-lore-actions">
                <Button size="sm" variant="ghost" icon="chevron-down" onClick={() => setAll(true)}>
                  Show all {suggestions.length}
                </Button>
              </span>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}

function TopicsPanel(props: { doc: WorldDoc; lint: readonly LintIssue[]; value: LoreIndex; onChange(next: LoreIndex): void }) {
  const [label, setLabel] = useState("");
  const labelId = useId();
  const { value } = props;
  const options = useMemo(() => refOptions(props.doc, "lore"), [props.doc]);
  const suggestions = topicSuggestions({ lore: props.doc.lore, loreIndex: value });
  const setTopics = (topics: LoreIndex["topics"]) => props.onChange({ ...value, topics });
  const adopt = (picked: readonly { id: string; label: string; entries: string[] }[]) => props.onChange(picked.reduce((index, s) => s.entries.reduce((acc, entry) => addToLoreIndex(acc, entry, { terms: [], topics: [{ id: s.id, label: s.label }] }), index), value));
  // A new topic's id comes from its label; a taken one gets a number.
  const base = topicIdOf(label);
  let id = base;
  for (let n = 2; id !== "" && hasOwn(value.topics, id); n++) id = `${base}_${n}`;
  return (
    <>
      <div class="lre-form-lore-fields">
        <ListHead title="Topics" />
        {Object.keys(value.topics).length === 0 ? (
          <Empty icon="list" title="No topics yet">
            Add one below, or take a suggestion.
          </Empty>
        ) : null}
        {Object.entries(value.topics).map(([topicId, topic]) => (
          // The wrapper only carries the topic's hook for scripts and tests; it takes no box.
          <div key={topicId} class="lre-form-lore-wrap" data-lre-topic={topicId}>
            <FormGroup>
              <div class="lre-form-add">
                <Field label="Topic">
                  <input class="lre-input" aria-label={`Label of topic ${topic.label || topicId}`} value={topic.label} onInput={(event) => setTopics({ ...value.topics, [topicId]: { ...topic, label: event.currentTarget.value } })} />
                </Field>
                <IconButton
                  icon="trash"
                  label={`Remove the topic ${topic.label || topicId}`}
                  onClick={() => {
                    const next = { ...value.topics };
                    delete next[topicId];
                    setTopics(next);
                  }}
                />
              </div>
              <IdText id={topicId} />
              <div class="lre-field">
                <span class="label">Entries</span>
                <EntryChips ids={topic.entries} doc={props.doc} options={options} label={topic.label || topicId} onChange={(next) => setTopics({ ...value.topics, [topicId]: { ...topic, entries: next } })} />
              </div>
              <Issues issues={props.lint.filter((issue) => issue.path === `loreIndex.topics.${topicId}`)} />
            </FormGroup>
          </div>
        ))}
        <FormGroup title="Add a topic">
          <form
            class="lre-form-add"
            onSubmit={(event) => {
              event.preventDefault();
              if (id === "") return;
              setTopics({ ...value.topics, [id]: { label: label.trim(), entries: [] } });
              setLabel("");
            }}
          >
            <Field label="Topic" for={labelId}>
              <input id={labelId} class="lre-input" placeholder="e.g. Harbor law" autoComplete="off" value={label} onInput={(event) => setLabel(event.currentTarget.value)} />
            </Field>
            <Button type="submit" variant="primary" icon="plus" disabled={id === ""}>
              Add
            </Button>
          </form>
          {id !== "" ? <IdText id={id} /> : null}
        </FormGroup>
      </div>
      <div class="lre-form-lore-fields" data-lre-topic-suggestions>
        <ListHead title="Suggestions" count={suggestions.length} />
        {suggestions.length === 0 ? (
          <Empty icon="check">Every topic an entry names already lists it.</Empty>
        ) : (
          <>
            <span class="lre-form-lore-note">Topics the entries name.</span>
            {suggestions.length > 1 ? (
              <span class="lre-form-lore-actions">
                <Button size="sm" icon="plus" onClick={() => adopt(suggestions)}>
                  File them all ({suggestions.length})
                </Button>
              </span>
            ) : null}
            <div class="lre-form-items">
              {suggestions.map((s) => (
                <ItemRow
                  key={s.id}
                  title={s.label}
                  subtitle={`${s.entries.length} entr${s.entries.length === 1 ? "y" : "ies"}`}
                  actions={
                    <Button size="sm" label={`File entries under ${s.label}`} onClick={() => adopt([s])}>
                      Add
                    </Button>
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

export function LookupTableEditor(props: { doc: WorldDoc; lint: readonly LintIssue[]; save(value: JsonObject): Promise<unknown> }) {
  const initial = props.doc.loreIndex;
  const [value, setValue] = useState<LoreIndex>(initial);
  const [tab, setTab] = useState<"terms" | "topics">("terms");
  const [busy, run] = useBusy();
  useHeld(value, setValue, initial, `${props.doc.id}/loreIndex`);
  const changed = JSON.stringify(value) !== JSON.stringify(initial);
  return (
    <div class="lre-build-page" data-lre-editor="part:loreIndex">
      <PageHeader
        title="Lore lookup table"
        subtitle="Terms lead the engine's lore lookups to entries; topics are its table of contents. It steers the helpers' searches, including the brief's and the outline's, which draw on public entries for the narrator's Outline."
      />
      <Seg<"terms" | "topics">
        label="Show"
        value={tab}
        options={[
          { value: "terms", label: `Terms (${Object.keys(value.terms).length})` },
          { value: "topics", label: `Topics (${Object.keys(value.topics).length})` },
        ]}
        onChange={(next) => setTab(next)}
      />
      {Object.keys(props.doc.lore).length === 0 ? <Banner tone="info">The world has no lore entries yet; terms and topics lead to entries.</Banner> : null}
      {tab === "terms" ? <TermsPanel doc={props.doc} lint={props.lint} value={value} onChange={setValue} /> : <TopicsPanel doc={props.doc} lint={props.lint} value={value} onChange={setValue} />}
      <SaveBar>
        <Button variant="primary" disabled={!changed} busy={busy} onClick={() => run(() => props.save(loreIndexJson(value)))}>
          Save to draft
        </Button>
        <Button variant="ghost" disabled={!changed || busy} onClick={() => setValue(initial)}>
          Revert
        </Button>
      </SaveBar>
    </div>
  );
}
