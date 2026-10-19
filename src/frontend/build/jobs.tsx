// Background-lane jobs (DESIGN §13, §4.2): Import from lore, Build/Refine with AI, the lore indexing
// jobs, Playtest and Check world. A job's updates arrive as `lre.job.update`; proposals are reviewed
// one by one and the accepted ones are written to the draft as `lre.editor put` (an indexed entry's
// terms and topics join the lookup table in one more write), then committed from the Build bar. The
// backend keeps each job (`lre.job list`), so a reload or a restart shows the last run of each tool
// again, and a job a restart cut off as interrupted, with its proposals so far and Run it again.
// A job's page (redesign contract §4.6) leads with its status and results; Apply stays in reach in
// a sticky bar while the review scrolls.

import { useEffect, useId, useMemo, useState } from "preact/hooks";
import { hasOwn, isRecord } from "../../shared/json";
import type { JsonObject, JsonValue } from "../../shared/json";
import { addToLoreIndex, loreIndexJson, loreSourceOf } from "../../shared/lore";
import type { JobKind, JobProposal, JobResult, JobSummary } from "../../shared/protocol";
import type { LoreIndex } from "../../shared/world";
import type { App } from "../app";
import { useApp } from "../app";
import type { SegOption } from "../components";
import { Badge, Button, Disclosure, Empty, Field, IdText, JsonView, PageHeader, SaveBar, Section, Seg, useBusy, useShowIds } from "../components";
import { strings } from "../decode";
import { humanize } from "../format";
import type { IconName } from "../icons";
import { Icon } from "../icons";
import type { ProtocolClient } from "../protocol-client";
import type { Req } from "../requests";
import { createStore, useSelect } from "../store";
import { IssueRow } from "./check";
import { COLLECTION_INFO, itemLabel } from "./chrome";
import { draftSend } from "./draft";

export interface JobState {
  jobId: string;
  kind: JobKind;
  worldId: string;
  status: JobSummary["status"];
  progress: number;
  message?: string;
  result?: JobResult;
  /** What the job was started with (kept jobs), for Run it again. */
  input?: JsonObject;
}

/** Jobs by `${worldId}:${kind}`, the latest run of each. */
export const jobStore = createStore<Record<string, JobState>>({});

/** Folds job updates into `jobStore`; installed once at setup. */
export function trackJobs(client: ProtocolClient): () => void {
  return client.onJob((update) => {
    jobStore.update((all) => {
      const entry = Object.entries(all).find(([, job]) => job.jobId === update.jobId);
      if (!entry) return all;
      const [key, job] = entry;
      return { ...all, [key]: { ...job, status: update.status, progress: update.progress, message: update.message, result: update.result ?? job.result } };
    });
  });
}

/** The world's kept jobs (oldest first) as the store holds them: the latest of each kind. */
export function keptJobs(all: Readonly<Record<string, JobState>>, worldId: string, jobs: readonly JobSummary[]): Record<string, JobState> {
  const next = { ...all };
  for (const job of jobs) if (job.worldId === worldId) next[`${worldId}:${job.kind}`] = { jobId: job.jobId, kind: job.kind, worldId: job.worldId, status: job.status, progress: job.progress, message: job.message, result: job.result, input: job.input };
  return next;
}

/**
 * The draft writes for the accepted proposals, in proposal order. An entry an indexing job wrote
 * from pasted text is accepted as it is applied. When accepted lore proposals add terms or topics,
 * the lookup table (`index`, the draft's) takes them, merged, in one last write.
 */
export function proposalWrites(worldId: string, proposals: readonly JobProposal[], accepted: ReadonlySet<string>, index?: LoreIndex): Req<"lre.editor">[] {
  const chosen = proposals.filter((p) => accepted.has(p.id));
  const puts = chosen.map((p): Req<"lre.editor"> => {
    const value = p.value;
    const reviewed = p.collection === "lore" && typeof value === "object" && value !== null && !Array.isArray(value) && loreSourceOf(value.source).kind === "ai" ? { ...value, source: { kind: "ai", status: "accepted" } } : value;
    return { type: "lre.editor", worldId, base: null, op: "put", collection: p.collection, id: p.key, value: reviewed };
  });
  const filed = chosen.filter((p) => p.collection === "lore" && p.index !== undefined && (p.index.terms.length > 0 || p.index.topics.length > 0));
  if (!index || filed.length === 0) return puts;
  const merged = filed.reduce((acc, p) => (p.index ? addToLoreIndex(acc, p.key, p.index) : acc), index);
  return [...puts, { type: "lre.editor", worldId, base: null, op: "set", part: "loreIndex", value: loreIndexJson(merged) }];
}

/** Each tool as Build's Tools list and the job's page name it: its title, what it does, its icon. */
export const JOB_INFO: Readonly<Record<JobKind, { title: string; hint: string; icon: IconName }>> = {
  import_lore: { title: "Import from lore", hint: "Turn lore-book entries into entities, places and facts", icon: "download" },
  index_book: { title: "Index a World Info book", hint: "Lore entries, aliases, topics and lookup terms from one of your books", icon: "book" },
  index_text: { title: "Index this text", hint: "Lore entries from text you paste; review each one", icon: "scroll" },
  refine: { title: "Build / Refine with AI", hint: "Describe changes; review every proposal", icon: "sparkle" },
  describe_map: { title: "Describe a map", hint: "Write a place's inside in your words; the AI draws it as a map to review", icon: "map" },
  playtest: { title: "Playtest", hint: "Run scripted turns on the background lane", icon: "play" },
  check_world: { title: "Check world", hint: "Simulate days on the background lane; report drops, failures and leaks", icon: "pulse" },
};

const CHECK_DAYS: readonly SegOption<number>[] = [1, 3, 7].map((days) => ({ value: days, label: `${days} day${days === 1 ? "" : "s"}` }));

const STATUS: Record<JobState["status"], { label: string; tone: "accent" | "pos" | "neg" | "neutral" | "warn" }> = {
  running: { label: "Running", tone: "accent" },
  done: { label: "Done", tone: "pos" },
  failed: { label: "Failed", tone: "neg" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  interrupted: { label: "Interrupted", tone: "warn" },
};

/** A job's status in words. */
export function JobStatusBadge(props: { status: JobState["status"] }) {
  const status = STATUS[props.status];
  return <Badge tone={status.tone}>{status.label}</Badge>;
}

function JobInput(props: { kind: JobKind; onStart(input: Record<string, string | number | string[]>): void; busy: boolean }) {
  const app = useApp();
  const showIds = useShowIds();
  const [books, setBooks] = useState<{ id: string; name: string }[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [days, setDays] = useState(3);
  const draft = useSelect(app.drafts, (d) => d);
  const [scope, setScope] = useState("");
  const [mapId, setMapId] = useState("");
  const textId = useId();
  const placeId = useId();
  const mapIdId = useId();
  useEffect(() => {
    if (props.kind === "import_lore" || props.kind === "index_book") void app.host.worldBooks().then(setBooks, () => setBooks([]));
  }, [props.kind]);
  if (props.kind === "index_book") {
    return (
      <div class="lre-stack">
        <p class="lre-build-note">Pick one of your World Info books. Each entry with text becomes a lore entry to review, with aliases, topics, links and lookup terms, and keeps the book's own text; entries already in the world's lore are skipped. Nothing changes until you apply.</p>
        {books === null ? (
          <Empty icon="hourglass">Loading books…</Empty>
        ) : books.length === 0 ? (
          <Empty icon="book">No World Info books.</Empty>
        ) : (
          <div class="lre-build-picks" role="radiogroup" aria-label="World Info book">
            {books.map((book) => (
              <label key={book.id} class="lre-build-pick">
                <input type="radio" name="lre-index-book" checked={picked[0] === book.id} onChange={() => setPicked([book.id])} />
                <span>{book.name}</span>
              </label>
            ))}
          </div>
        )}
        <Button variant="primary" block disabled={picked.length === 0 || props.busy} onClick={() => props.onStart({ bookId: picked[0] ?? "" })}>
          Index the book
        </Button>
      </div>
    );
  }
  if (props.kind === "index_text") {
    return (
      <div class="lre-stack">
        <Field label="Text to index" for={textId} help="The helper splits it into lore entries in the text's own words, with aliases, topics, links and lookup terms. Each is marked as written by the AI, and counts as reviewed once you apply it. Nothing changes until you apply.">
          <textarea id={textId} class="lre-input lre-build-prose" rows={8} placeholder="Paste a setting document, a town history, character notes…" value={text} onInput={(event) => setText(event.currentTarget.value)} />
        </Field>
        <Button variant="primary" block disabled={!text.trim() || props.busy} onClick={() => props.onStart({ text: text.trim() })}>
          Index the text
        </Button>
      </div>
    );
  }
  if (props.kind === "import_lore") {
    return (
      <div class="lre-stack">
        <p class="lre-build-note">Choose lore books. Every entry becomes a reviewable proposal; nothing changes until you apply it.</p>
        {books === null ? (
          <Empty icon="hourglass">Loading lore books…</Empty>
        ) : books.length === 0 ? (
          <Empty icon="book">No lore books.</Empty>
        ) : (
          <div class="lre-build-picks" role="group" aria-label="Lore books">
            {books.map((book) => (
              <label key={book.id} class="lre-build-pick">
                <input type="checkbox" checked={picked.includes(book.id)} onChange={() => setPicked(picked.includes(book.id) ? picked.filter((id) => id !== book.id) : [...picked, book.id])} />
                <span>{book.name}</span>
              </label>
            ))}
          </div>
        )}
        <Button variant="primary" block disabled={picked.length === 0 || props.busy} onClick={() => props.onStart({ bookIds: picked })}>
          Import {picked.length > 0 ? `${picked.length} book${picked.length === 1 ? "" : "s"}` : ""}
        </Button>
      </div>
    );
  }
  if (props.kind === "describe_map") {
    const places = draft ? Object.values(draft.doc.places).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const chosen = scope || draft?.doc.start.place || "";
    // The map's id is the backend's to derive unless the author names one (D-UI6): an Advanced field.
    const mapIdField = (
      <Field label="Map id" for={mapIdId} help={`Left empty, it's ${chosen}_map.`}>
        <input id={mapIdId} class="lre-input lre-build-mono" placeholder={`${chosen}_map`} value={mapId} autoComplete="off" spellcheck={false} onInput={(event) => setMapId(event.currentTarget.value.replace(/[^\w-]/g, "_"))} />
      </Field>
    );
    return (
      <div class="lre-stack">
        <p class="lre-build-note">Describe a place's inside in your own words: rooms and how they connect, or a town's places and the walks between them. The AI draws it as an lre-map-v1 map; you see it as a proposal with its preview before it goes into the draft.</p>
        <Field label="The place to draw" for={placeId}>
          <select id={placeId} class="lre-input" value={chosen} onChange={(event) => setScope(event.currentTarget.value)}>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {showIds ? `${p.name} (${p.id})` : p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Describe it" for={textId}>
          <textarea id={textId} class="lre-input lre-build-prose" rows={6} placeholder="A narrow farmhouse: the front door opens into a hall, with the parlour on the left and the kitchen at the back; a door from the kitchen to the scullery…" value={text} onInput={(event) => setText(event.currentTarget.value)} />
        </Field>
        {showIds ? mapIdField : <Disclosure summary="Advanced">{mapIdField}</Disclosure>}
        <Button variant="primary" block disabled={!text.trim() || !chosen || props.busy} onClick={() => props.onStart({ scope: chosen, prose: text.trim(), ...(mapId.trim() ? { mapId: mapId.trim() } : {}) })}>
          Draw the map
        </Button>
      </div>
    );
  }
  if (props.kind === "refine") {
    return (
      <div class="lre-stack">
        <Field label="What should change?" for={textId}>
          <textarea id={textId} class="lre-input lre-build-prose" rows={4} placeholder="Add a night-shift nurse who knows Dev; give the diner a weekly schedule…" value={text} onInput={(event) => setText(event.currentTarget.value)} />
        </Field>
        <Button variant="primary" block disabled={!text.trim() || props.busy} onClick={() => props.onStart({ instructions: text.trim() })}>
          Propose changes
        </Button>
      </div>
    );
  }
  if (props.kind === "check_world") {
    return (
      <div class="lre-stack">
        <p class="lre-build-note">Runs the world forward one day per turn with no player input and reports what happened, dropped events, failures and leaks. Nothing is saved.</p>
        <Field label="Days">
          <Seg label="Days" value={days} options={CHECK_DAYS} onChange={(next) => setDays(next)} />
        </Field>
        <Button variant="primary" block disabled={props.busy} onClick={() => props.onStart({ days })}>
          Run check
        </Button>
      </div>
    );
  }
  const script = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 50);
  return (
    <div class="lre-stack">
      <Field label="Player turns (one per line, up to 50)" for={textId}>
        <textarea id={textId} class="lre-input lre-build-prose" rows={5} placeholder={"I walk to the diner.\nI order a coffee.\nI ask Rosie about the night shift."} value={text} onInput={(event) => setText(event.currentTarget.value)} />
      </Field>
      <Button variant="primary" block disabled={script.length === 0 || props.busy} onClick={() => props.onStart({ turns: script })}>
        Run playtest{script.length > 0 ? ` (${script.length} turn${script.length === 1 ? "" : "s"})` : ""}
      </Button>
    </div>
  );
}

/** Proposals grouped by pack for the review, packs in first-seen order; a proposal without one is "other". */
export function proposalGroups(proposals: readonly JobProposal[]): { pack: string; proposals: JobProposal[] }[] {
  const groups = new Map<string, JobProposal[]>();
  for (const p of proposals) {
    const pack = p.pack ?? "other";
    groups.set(pack, [...(groups.get(pack) ?? []), p]);
  }
  return [...groups].map(([pack, list]) => ({ pack, proposals: list }));
}

/**
 * A proposal's value as Show value lists it: each lore back-link (`bookId/entryId`) named by its
 * entry's title and its book ("Lighthouse · B2 Chat Lore"), an id standing in for a missing name,
 * the bare link when neither is known. The value applied to the draft keeps the links.
 */
export function shownValue(p: JobProposal, bookNames: Readonly<Record<string, string>>): JsonValue {
  if (!isRecord(p.value) || !Array.isArray(p.value.sources)) return p.value;
  const sources = p.value.sources.map((link) => {
    if (typeof link !== "string") return link;
    const [bookId = link, entryId = ""] = link.split("/");
    const title = p.sourceNames && hasOwn(p.sourceNames, link) ? p.sourceNames[link] : undefined;
    const book = hasOwn(bookNames, bookId) ? bookNames[bookId] : undefined;
    return title || book ? [title || entryId, book || bookId].filter((part) => part).join(" · ") : link;
  });
  return { ...p.value, sources };
}

/** The proposals the review starts ticked: 70% or more, unless the entity's kind is assumed (it needs an explicit accept). */
export function startTicked(proposals: readonly JobProposal[]): Set<string> {
  return new Set(proposals.filter((p) => p.confidence >= 0.7 && !strings(isRecord(p.value) ? p.value.assumed : undefined).includes("kind")).map((p) => p.id));
}

/** A lore proposal's lines in the review: where it came from, its aliases, topics and links, and the lookup terms it adds. */
function LoreProposalLines(props: { p: JobProposal; bookNames: Readonly<Record<string, string>>; names: Readonly<Record<string, string>> }) {
  const value = isRecord(props.p.value) ? props.p.value : {};
  const source = loreSourceOf(value.source);
  const link = source.kind === "book" ? `${source.bookId}/${source.entryId}` : "";
  const entry = source.kind === "book" ? ((props.p.sourceNames && hasOwn(props.p.sourceNames, link) ? props.p.sourceNames[link] : undefined) ?? source.entryId) : "";
  const lists: [string, string[]][] = [
    ["Aliases", strings(value.aliases)],
    ["Topics", strings(value.topics)],
    ["Links", strings(value.links).map((id) => (hasOwn(props.names, id) ? (props.names[id] ?? id) : id))],
    ["Lookup terms", props.p.index?.terms ?? []],
  ];
  return (
    <>
      <span class="lre-build-proposal-line" data-lre-proposal-from>
        {source.kind === "book" ? `From ${hasOwn(props.bookNames, source.bookId) ? props.bookNames[source.bookId] : source.bookId}: ${entry}` : "From the pasted text, in the AI's words"}
      </span>
      {lists
        .filter(([, items]) => items.length > 0)
        .map(([label, items]) => (
          <span key={label} class="lre-build-proposal-line lre-muted">
            {label}: {items.join(", ")}
          </span>
        ))}
      {props.p.note ? <span class="lre-build-proposal-line lre-warn">{props.p.note}</span> : null}
    </>
  );
}

function ProposalReview(props: { app: App; worldId: string; proposals: JobProposal[] }) {
  const [accepted, setAccepted] = useState<Set<string>>(() => startTicked(props.proposals));
  const [open, setOpen] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, run] = useBusy();
  const send = useMemo(() => draftSend(props.app), [props.app]);
  const draft = useSelect(props.app.drafts, (d) => d);
  // Lore proposals name the people and places they link by the draft's names.
  const doc = draft?.doc;
  const names = useMemo(() => Object.fromEntries([...Object.values(doc?.entities ?? {}), ...Object.values(doc?.places ?? {})].map((e) => [e.id, e.name])), [doc]);
  // Import back-links (DESIGN §9.7): `sources` are `bookId/entryId`; the review names the book.
  const [bookNames, setBookNames] = useState<Record<string, string>>({});
  useEffect(() => {
    void props.app.host.worldBooks().then(
      (books) => setBookNames(Object.fromEntries(books.map((book) => [book.id, book.name]))),
      () => setBookNames({}),
    );
  }, [props.app]);
  const toggle = (id: string) => {
    const next = new Set(accepted);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAccepted(next);
  };
  const groups = proposalGroups(props.proposals);
  return (
    <>
      <Section
        title="Proposals"
        aside={
          <span class="lre-build-count">
            {accepted.size} of {props.proposals.length} ticked
          </span>
        }
      >
        <div class="lre-build-actions">
          <Button size="sm" icon="check" onClick={() => setAccepted(new Set(props.proposals.map((p) => p.id)))}>
            Select all
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAccepted(new Set())}>
            None
          </Button>
        </div>
        {groups.map((group) => (
          <div key={group.pack} class="lre-build-group" data-lre-proposal-pack={group.pack}>
            {/* One pack's proposals need no heading of their own. */}
            {groups.length > 1 ? (
              <div class="lre-build-group-head">
                <span>{humanize(group.pack)}</span>
                <span class="lre-build-count">
                  {group.proposals.filter((p) => accepted.has(p.id)).length} of {group.proposals.length}
                </span>
              </div>
            ) : null}
            <div role="list">
              {group.proposals.map((p) => {
                const value = isRecord(p.value) ? p.value : {};
                const from = [...new Set(strings(value.sources).map((link) => link.split("/")[0] ?? link))].map((id) => bookNames[id] ?? id);
                const assumed = strings(value.assumed);
                const tableFields = assumed.filter((f) => f !== "kind");
                const noun = COLLECTION_INFO[p.collection].noun;
                const title = itemLabel(p.collection, p.key, p.value);
                const sure = Math.round(p.confidence * 100);
                // A pack draws what it can of a proposed value (a map as Play will show it).
                const Preview = props.app.catalog.previews.get(p.collection);
                return (
                  <div key={p.id} class="lre-build-proposal" role="listitem" data-lre-proposal={p.id}>
                    <label class="lre-check">
                      <input type="checkbox" aria-label={`Accept ${noun} “${title}”`} checked={accepted.has(p.id)} onChange={() => toggle(p.id)} />
                    </label>
                    <div class="lre-build-proposal-body">
                      <div class="lre-build-proposal-head">
                        <span class="lre-build-proposal-title">{title}</span>
                        <Badge tone={p.confidence >= 0.8 ? "pos" : p.confidence >= 0.5 ? "warn" : "neg"}>
                          {sure}%<span class="lre-sr"> sure</span>
                        </Badge>
                      </div>
                      <span class="lre-build-proposal-line lre-muted">{humanize(noun)}</span>
                      <IdText id={`${p.collection}.${p.key}`} />
                      {p.collection === "lore" ? (
                        <LoreProposalLines p={p} bookNames={bookNames} names={names} />
                      ) : (
                        <>
                          {/* A linked proposal's source is an entry id; "From lore" names its book instead. */}
                          {from.length === 0 || p.note ? <span class="lre-build-proposal-line lre-muted">{[from.length === 0 ? p.source : null, p.note].filter((part) => part).join(" — ")}</span> : null}
                          {from.length > 0 ? (
                            <span class="lre-build-proposal-line" data-lre-proposal-from>
                              From lore: {from.join(", ")}
                            </span>
                          ) : null}
                          {assumed.includes("kind") ? (
                            <span class="lre-build-proposal-line lre-warn" data-lre-proposal-assumed-kind>
                              <Icon name="alert" size={16} />
                              Assumed kind: {String(value.kind)} (the lore named none)
                            </span>
                          ) : null}
                          {tableFields.length > 0 ? (
                            <span class="lre-build-proposal-line lre-warn" data-lre-proposal-assumed>
                              <Icon name="alert" size={16} />
                              Assumed from a table: {tableFields.join(", ")}
                            </span>
                          ) : null}
                        </>
                      )}
                      <button type="button" class="lre-btn small ghost lre-build-reveal" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                        <Icon name={open === p.id ? "chevron-up" : "chevron-down"} size={16} />
                        {open === p.id ? "Hide value" : "Show value"}
                      </button>
                      {open === p.id ? (
                        <div class="lre-build-json">
                          <JsonView value={shownValue(p, bookNames)} />
                        </div>
                      ) : null}
                      {Preview && draft ? <Preview world={draft.doc} collection={p.collection} id={p.key} value={p.value} /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </Section>
      <SaveBar>
        <Button
          variant="primary"
          block
          icon={applied ? "check" : undefined}
          disabled={accepted.size === 0 || applied}
          busy={busy}
          onClick={() =>
            run(async () => {
              let ok = 0;
              for (const write of proposalWrites(props.worldId, props.proposals, accepted, props.app.drafts.get()?.doc.loreIndex)) {
                const message = await send(write);
                if (message.type === "lre.result" && write.op === "put") ok += 1;
              }
              props.app.toast(`Applied ${ok} of ${accepted.size} to the draft. Commit when ready.`, ok === accepted.size ? "info" : "error");
              setApplied(true);
            })
          }
        >
          {applied ? "Applied to the draft" : `Apply ${accepted.size} to the draft`}
        </Button>
      </SaveBar>
    </>
  );
}

/** A playtest's transcript, or what Check world saw day by day, then the issues the run found. */
function RunReport(props: { kind: JobKind; worldId: string; report: Extract<JobResult, { turns: unknown }> }) {
  const app = useApp();
  const doc = useSelect(app.drafts, (d) => (d?.worldId === props.worldId ? d.doc : undefined));
  const lint = props.report.lint;
  return (
    <>
      <Section title={props.kind === "playtest" ? "Transcript" : "Day by day"}>
        <ol class="lre-build-turns">
          {props.report.turns.map((turn, i) => (
            <li key={i} class="lre-build-turn">
              {props.kind === "playtest" ? (
                <span class="lre-build-turn-you">
                  <span class="lre-build-turn-who">You</span> {turn.user}
                </span>
              ) : (
                <strong class="lre-build-turn-label">{turn.user}</strong>
              )}
              <span class="lre-build-turn-reply">{turn.reply}</span>
              {turn.notes.length > 0 ? (
                <ul class="lre-build-notes">
                  {turn.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Issues found" aside={<Badge tone={lint.length > 0 ? "warn" : "neutral"}>{lint.length}</Badge>} flush>
        {lint.length === 0 ? (
          <Empty icon="check">None.</Empty>
        ) : (
          <div class="lre-build-issues" role="list">
            {lint.map((issue, i) => (
              <IssueRow key={i} issue={issue} worldId={props.worldId} doc={doc} />
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

export function JobView(props: { worldId: string; kind: JobKind }) {
  const app = useApp();
  const key = `${props.worldId}:${props.kind}`;
  const job = useSelect(jobStore, (all) => all[key] ?? null);
  const [busy, run] = useBusy();
  // The backend keeps each job: after a reload or a restart, the world's last runs come back from it.
  useEffect(() => {
    void app.request({ type: "lre.job", op: "list", worldId: props.worldId }).then((body) => {
      if (body?.jobs) {
        const jobs = body.jobs;
        jobStore.update((all) => keptJobs(all, props.worldId, jobs));
      }
    });
  }, [props.worldId]);
  const start = (input: JsonObject) =>
    run(async () => {
      const result = await app.request({ type: "lre.job", op: "start", kind: props.kind, worldId: props.worldId, input });
      const jobId = result?.jobId;
      if (jobId) jobStore.update((all) => ({ ...all, [key]: { jobId, kind: props.kind, worldId: props.worldId, status: "running", progress: 0, input } }));
    });
  // A running import keeps its proposals so far for a restart; they are reviewed once it ends.
  const result = job?.status === "running" ? undefined : job?.result;
  const info = JOB_INFO[props.kind];
  const input = <JobInput kind={props.kind} onStart={start} busy={busy} />;
  return (
    <div class="lre-build-page" data-lre-job={props.kind}>
      <PageHeader title={info.title} subtitle={info.hint} />
      {!job ? <Section title="Start">{input}</Section> : null}
      {job ? (
        <Section title="Status" aside={<JobStatusBadge status={job.status} />}>
          <div class="lre-progress" role="progressbar" aria-label={`${info.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
            <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          {job.message ? <p class="lre-build-note">{job.message}</p> : null}
          <div class="lre-build-actions">
            {job.status === "running" ? (
              <Button
                size="sm"
                busy={busy}
                onClick={() =>
                  run(async () => {
                    await app.request({ type: "lre.job", op: "cancel", jobId: job.jobId });
                  })
                }
              >
                Cancel
              </Button>
            ) : (
              <>
                {job.status === "interrupted" && job.input ? (
                  <Button size="sm" variant="primary" icon="refresh" disabled={busy} onClick={() => job.input && start(job.input)}>
                    Run it again
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      if (!(await app.request({ type: "lre.job", op: "dismiss", jobId: job.jobId }))) return;
                      jobStore.update((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)));
                    })
                  }
                >
                  Dismiss
                </Button>
              </>
            )}
          </div>
          {/* Its results lead the page; another run, with new input, is a tap away. */}
          {job.status !== "running" ? <Disclosure summary="Run again with new input">{input}</Disclosure> : null}
        </Section>
      ) : null}
      {result && "proposals" in result ? result.proposals.length === 0 ? <Empty icon="checklist">No proposals.</Empty> : <ProposalReview key={job?.jobId} app={app} worldId={props.worldId} proposals={result.proposals} /> : null}
      {result && "turns" in result ? <RunReport kind={props.kind} worldId={props.worldId} report={result} /> : null}
    </div>
  );
}
