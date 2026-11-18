// Lore (plan §9, §14): his books and the world's own lore as RPE understands them. The index, a page at a time and
// searchable: each entry with its book, kind, the one line that says what it is, what it defines and the records
// it is bound to; entries no run has indexed yet shown by title and keys; "Index now", naming the connection the
// indexing runs on; and where this chat's story moved past an entry, each overlay with its turn.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { LoreIndexRow, LoreIndexStatus, LoreOverlays } from "../../../shared/api";
import { useApp } from "../../app";
import { Badge, Banner, Button, Disclosure, Empty, PageHeader, Row, Section } from "../../../frontend/components";
import { EntryBindings } from "../../bindings";
import type { PageEntry } from "../../page-entry";
import { usePaged, useRead } from "../../reading";
import { counted, errorWords } from "../../words";
import { JobFollow } from "../jobs/follow";
import { EntryLines } from "./entry-lines";
import { ProjectionSection } from "./projection";
import { ProposalsSection, WritesSection } from "./proposals";
import { readIndex, readIndexStatus, readOverlays, startIndexing } from "./read";

const ACTIVATION_WORDS: Readonly<Record<string, string>> = { constant: "always in", keyword: "by its keys", vector: "by meaning" };
const BY_WORDS: Readonly<Record<string, string>> = { run: "an indexing run", casting: "casting", bootstrap: "the bootstrap", owner: "you", pin: "the world's own pin" };

/** Whether an entry matches what he typed: its title, book, keys, kind, line and what it defines. */
export function loreMatches(row: LoreIndexRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = [row.title, row.source, row.kind ?? "", row.line ?? "", ...row.keys, ...row.defines.map((d) => `${d.what} ${d.aspect}`)];
  return hay.some((h) => h.toLowerCase().includes(q));
}

/** Where indexing stands, in a line: the entries, those not indexed as they stand now, and how many of those were indexed at an earlier revision and have changed since. */
export function indexWords(status: LoreIndexStatus): string {
  const entries = counted(status.entries, "entry", "entries");
  if (status.unindexed === 0) return `${entries}; every one is indexed.`;
  const now = `${status.unindexed} not indexed as ${status.unindexed === 1 ? "it stands" : "they stand"} now`;
  if (status.stale === 0) return `${entries}; ${now}.`;
  const earlier = status.stale < status.unindexed ? `${status.stale} of them indexed at an earlier revision and changed since` : status.unindexed === 1 ? "it was indexed at an earlier revision and has changed since" : "all of them indexed at an earlier revision and changed since";
  return `${entries}; ${now}, ${earlier}.`;
}

/** The press that starts indexing again from an entry's own line: the job indexes every entry not indexed as it stands now, this one with them. */
interface IndexAgain {
  busy: boolean;
  disabled: boolean;
  press(): void;
}

function EntryLine(props: { row: LoreIndexRow; edit?: ((row: LoreIndexRow) => ComponentChildren) | undefined; bindings?: ((row: LoreIndexRow) => ComponentChildren) | undefined; again?: IndexAgain | undefined }) {
  const { row } = props;
  const how = row.activation.length === 0 ? "never by itself" : row.activation.map((a) => ACTIVATION_WORDS[a] ?? a).join(", ");
  return (
    <li class="lre-stack rpe-entry" data-entry={row.id}>
      <Row k={row.title} v={row.source} sub={`${row.id} · ${counted(row.size, "character")} · ${how}`} />
      {row.kind === null && row.line === null ? null : (
        <p class="rpe-line" data-line>
          {row.kind === null ? null : <Badge>{row.kind}</Badge>} {row.line ?? ""}
          {row.stale ? <Badge tone="warn" title="Its lines were written for an earlier revision of the entry, which has changed since">out of date</Badge> : null}
          {row.edited.length === 0 ? null : <Badge tone="accent" title={`Your own: ${row.edited.join(", ")}`}>yours</Badge>}
        </p>
      )}
      {row.stale ? (
        <p class="lre-inline rpe-wrap rpe-meta" data-stale>
          <span>{`Indexed at an earlier revision; the entry has changed since${row.line === null || row.edited.includes("line") ? "" : ", so the line above is of its earlier text"}.`}</span>
          {props.again === undefined ? null : (
            <Button size="sm" variant="ghost" busy={props.again.busy} disabled={props.again.disabled} title="Indexes this entry again, and any other that is not indexed as it stands now" onClick={props.again.press}>
              Index again
            </Button>
          )}
        </p>
      ) : row.indexed ? null : (
        <p class="rpe-meta" data-unindexed>
          Not indexed yet{row.keys.length === 0 ? "" : `; its keys: ${row.keys.join(", ")}`}.
        </p>
      )}
      {row.defines.length === 0 ? null : (
        <p class="rpe-meta" data-defines>
          Defines: {row.defines.map((d) => `${d.what} (${d.aspect})`).join(", ")}
        </p>
      )}
      {row.related.length === 0 ? null : <p class="rpe-meta">Related: {row.related.join(", ")}</p>}
      {row.links.length === 0 ? null : (
        <p class="rpe-meta" data-links>
          Bound to: {row.links.map((l) => `${l.record}${l.linked ? "" : " (not found)"}, ${l.aspect}, by ${BY_WORDS[l.by] ?? l.by}`).join("; ")}
        </p>
      )}
      {props.edit === undefined ? null : (
        <Disclosure summary="Change what it is" class="rpe-open">
          {props.edit(row)}
        </Disclosure>
      )}
      {props.bindings === undefined ? null : (
        <Disclosure summary="Change what it is bound to" class="rpe-open">
          {props.bindings(row)}
        </Disclosure>
      )}
    </li>
  );
}

export interface IndexingShown {
  busy: boolean;
  /** The job a start made, or why RPE refused to make one. */
  job: string | null;
  problem: string | null;
}

export interface LoreViewProps {
  chat: string;
  index: { items: readonly LoreIndexRow[]; more: boolean; loading: boolean; problem: string | null };
  query: string;
  status: LoreIndexStatus | null;
  statusProblem: string | null;
  overlays: LoreOverlays | null;
  overlaysProblem: string | null;
  indexing: IndexingShown;
  onQuery(query: string): void;
  onMore(): void;
  onIndex(): void;
  /** The indexing job ended: the index and where it stands are read again. */
  onIndexEnded(): void;
  onTurn(turn: string): void;
  /** The proposals waiting on him, above the index. */
  top?: ComponentChildren;
  /** The writes made to his lore and the projection switch, below the overlays. */
  bottom?: ComponentChildren;
  /** What edits an entry's kind, line and related entries, drawn under the entry's own lines; none where the view is only read. */
  edit?(row: LoreIndexRow): ComponentChildren;
  /** What edits an entry's bindings, drawn under the entry's own lines; none where the view is only read. */
  bindings?(row: LoreIndexRow): ComponentChildren;
}

export function LoreView(props: LoreViewProps) {
  const { index, status } = props;
  const rows = index.items.filter((row) => loreMatches(row, props.query));
  return (
    <div class="lre-stack rpe-page" data-page="lore">
      <PageHeader title="Lore" subtitle="Your books and the world's own lore, as RPE understands them." />
      {props.top}
      <Section title="Indexing" id="indexing">
        {props.statusProblem === null ? null : (
          <Banner tone="neg" icon="alert" title="Where indexing stands could not be read">
            <span>{props.statusProblem}</span>
          </Banner>
        )}
        {status === null ? null : (
          <div class="lre-stack" data-status>
            <p class="rpe-line">{indexWords(status)}</p>
            <p class="rpe-meta" data-connection>
              {status.connection === null
                ? "No connection is there for the indexer to run on: add one on Connections."
                : `Indexing runs as ${status.agent} on the connection ${status.connection.name}${status.model === null ? "" : `, model ${status.model}`}.`}
            </p>
          </div>
        )}
        <div class="lre-inline rpe-wrap">
          <Button busy={props.indexing.busy} disabled={status?.connection === null} onClick={props.onIndex}>
            Index now
          </Button>
          {props.indexing.job === null ? null : <JobFollow job={{ id: props.indexing.job, chat: props.chat }} what="The indexing job" onEnded={props.onIndexEnded} />}
        </div>
        {props.indexing.problem === null ? null : (
          <Banner tone="warn" icon="alert" title="RPE did not start it">
            <span>{props.indexing.problem}</span>
          </Banner>
        )}
      </Section>
      <Section title="The index" id="index">
        <label class="lre-field">
          <span>Search the entries</span>
          <input class="lre-input" type="search" value={props.query} placeholder="a title, a key, a kind, what it defines" onInput={(event) => props.onQuery((event.currentTarget as HTMLInputElement).value)} />
        </label>
        {index.problem === null ? null : (
          <Banner tone="neg" icon="alert" title="The index could not be read">
            <span>{index.problem}</span>
          </Banner>
        )}
        {index.items.length === 0 && !index.loading && index.problem === null ? (
          <Empty icon="book" title="No lore in this chat">
            <span>The books attached to the chat and the world's own lore show here.</span>
          </Empty>
        ) : null}
        {rows.length === 0 && index.items.length > 0 ? <p class="lre-muted rpe-line">{index.more ? "Nothing among the entries read so far; reading on." : "No entry matches."}</p> : null}
        <ul class="rpe-plain lre-stack" data-entries>
          {rows.map((row) => (
            <EntryLine key={row.id} row={row} edit={props.edit} bindings={props.bindings} again={{ busy: props.indexing.busy, disabled: status?.connection === null, press: props.onIndex }} />
          ))}
        </ul>
        {index.more ? (
          <Button busy={index.loading} onClick={props.onMore}>
            More entries
          </Button>
        ) : null}
      </Section>
      <Section title="Where the story moved past an entry" id="overlays">
        {props.overlaysProblem === null ? null : (
          <Banner tone="neg" icon="alert" title="The overlays could not be read">
            <span>{props.overlaysProblem}</span>
          </Banner>
        )}
        {props.overlays === null ? null : props.overlays.overlays.length === 0 ? (
          <p class="lre-muted rpe-line">No entry has been moved past on this chat's path.</p>
        ) : (
          <ul class="rpe-plain lre-stack" data-overlays>
            {props.overlays.overlays.map((o) => (
              <li key={o.id} class="lre-stack rpe-entry" data-overlay={o.id}>
                <Row k={o.title ?? o.entry} v={`turn ${o.turn}`} sub={o.by === null ? undefined : `by ${o.by}${o.agent === null ? "" : `, the agent ${o.agent}`}`} />
                <p class="rpe-line">{o.note}</p>
                <Button size="sm" variant="ghost" onClick={() => props.onTurn(o.turnId)}>
                  Open turn {o.turn}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {props.bottom}
    </div>
  );
}

export function LorePage(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const [query, setQuery] = useState("");
  const [indexing, setIndexing] = useState<IndexingShown>({ busy: false, job: null, problem: null });
  const [written, setWritten] = useState(0);
  const [edited, setEdited] = useState<ReadonlyMap<string, LoreIndexRow>>(new Map());
  const changed = (next: LoreIndexRow): void => setEdited((held) => new Map(held).set(next.id, next));
  const index = usePaged((cursor) => readIndex(app.client, chat, cursor), [chat]);
  const titles = new Map(index.items.map((row) => [row.id, row.title]));
  const status = useRead(() => readIndexStatus(app.client, chat), [chat, indexing.job]);
  const overlays = useRead(() => readOverlays(app.client, chat), [chat]);
  // The rows as the page shows them (an entry just changed by hand over the row read), and the kinds the chat's index holds: the whole index's by the status, and those of the rows shown.
  const shown = index.items.map((row) => edited.get(row.id) ?? row);
  const kinds = [...new Set([...(status.value?.kinds ?? []), ...shown.flatMap((row) => (row.kind === null ? [] : [row.kind]))])];
  // A search looks across every entry, so while one is typed the pages not yet read are read on.
  useEffect(() => {
    if (query.trim() !== "" && index.more && !index.loading && index.problem === null) index.older();
  }, [query, index.more, index.loading, index.items.length]);
  return (
    <LoreView
      index={{ ...index, items: shown }}
      edit={(row) => <EntryLines chat={chat} row={row} titles={titles} kinds={kinds} onChanged={changed} />}
      bindings={(row) => <EntryBindings chat={chat} row={row} onChanged={changed} />}
      query={query}
      status={status.value}
      statusProblem={status.problem}
      overlays={overlays.value}
      overlaysProblem={overlays.problem}
      indexing={indexing}
      chat={chat}
      onIndexEnded={() => {
        status.again();
        setEdited(new Map());
        index.again();
      }}
      onQuery={setQuery}
      onMore={index.older}
      onIndex={() => {
        setIndexing({ busy: true, job: null, problem: null });
        startIndexing(app.client, chat).then(
          (job) => setIndexing({ busy: false, job: job.job, problem: null }),
          (error: unknown) => setIndexing({ busy: false, job: null, problem: errorWords(error) }),
        );
      }}
      onTurn={(turn) => app.go({ page: "turns", chat, at: [turn] })}
      top={<ProposalsSection chat={chat} onTurn={(turn) => app.go({ page: "turns", chat, at: [turn] })} onWritten={() => setWritten((n) => n + 1)} />}
      bottom={
        <>
          <WritesSection reload={written} />
          <ProjectionSection chat={chat} />
        </>
      }
    />
  );
}

export const entry: PageEntry = { id: "lore", title: "Lore", icon: "book", shells: ["web", "drawer"], needsChat: true, often: false, order: 65, render: (route) => <LorePage chat={route.chat} /> };
