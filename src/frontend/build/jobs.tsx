// Background-lane jobs (DESIGN §13): Import from lore, Build/Refine with AI, Playtest and Check world. A job's
// updates arrive as `lre.job.update`; proposals are reviewed one by one and the accepted ones are
// written to the draft as `lre.editor put` (then committed from the Build bar). The backend keeps
// each job (`lre.job list`), so a reload or a restart shows the last run of each tool again, and a
// job a restart cut off as interrupted, with its proposals so far and Run it again.

import { useEffect, useMemo, useState } from "preact/hooks";
import { hasOwn, isRecord } from "../../shared/json";
import type { JsonObject, JsonValue } from "../../shared/json";
import type { JobKind, JobProposal, JobResult, JobSummary } from "../../shared/protocol";
import type { App } from "../app";
import { useApp } from "../app";
import type { SegOption } from "../components";
import { Card, Empty, JsonView, Row, Seg, useBusy } from "../components";
import type { ProtocolClient } from "../protocol-client";
import { strings } from "../decode";
import type { Req } from "../requests";
import { createStore, useSelect } from "../store";
import { issueTarget } from "./check";
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

/** The draft writes for the accepted proposals, in proposal order. */
export function proposalWrites(worldId: string, proposals: readonly JobProposal[], accepted: ReadonlySet<string>): Req<"lre.editor">[] {
  return proposals.filter((p) => accepted.has(p.id)).map((p) => ({ type: "lre.editor", worldId, base: null, op: "put", collection: p.collection, id: p.key, value: p.value }));
}

const TITLE: Record<JobKind, string> = { import_lore: "Import from lore", refine: "Build / Refine with AI", describe_map: "Describe a map", playtest: "Playtest", check_world: "Check world" };
const CHECK_DAYS: readonly SegOption<number>[] = [1, 3, 7].map((days) => ({ value: days, label: `${days} day${days === 1 ? "" : "s"}` }));
const STATUS_TONE: Record<JobState["status"], string> = { running: "accent", done: "pos", failed: "neg", cancelled: "", interrupted: "warn" };

function JobInput(props: { kind: JobKind; onStart(input: Record<string, string | number | string[]>): void; busy: boolean }) {
  const app = useApp();
  const [books, setBooks] = useState<{ id: string; name: string }[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [days, setDays] = useState(3);
  const draft = useSelect(app.drafts, (d) => d);
  const [scope, setScope] = useState("");
  const [mapId, setMapId] = useState("");
  useEffect(() => {
    if (props.kind === "import_lore") void app.host.worldBooks().then(setBooks, () => setBooks([]));
  }, [props.kind]);
  if (props.kind === "import_lore") {
    return (
      <div class="lre-stack">
        <span class="lre-small lre-muted">Choose lore books. Every entry becomes a reviewable proposal; nothing changes until you apply it.</span>
        {books === null ? (
          <Empty>Loading lore books…</Empty>
        ) : books.length === 0 ? (
          <Empty>No lore books.</Empty>
        ) : (
          <div class="lre-list">
            {books.map((book) => (
              <label key={book.id} class="lre-item">
                <span class="lre-check">
                  <input type="checkbox" checked={picked.includes(book.id)} onChange={() => setPicked(picked.includes(book.id) ? picked.filter((id) => id !== book.id) : [...picked, book.id])} />
                </span>
                <span class="grow">{book.name}</span>
              </label>
            ))}
          </div>
        )}
        <button type="button" class="lre-btn primary" disabled={picked.length === 0 || props.busy} onClick={() => props.onStart({ bookIds: picked })}>
          Import {picked.length > 0 ? `${picked.length} book${picked.length === 1 ? "" : "s"}` : ""}
        </button>
      </div>
    );
  }
  if (props.kind === "describe_map") {
    const places = draft ? Object.values(draft.doc.places).sort((a, b) => a.name.localeCompare(b.name)) : [];
    const chosen = scope || draft?.doc.start.place || "";
    return (
      <div class="lre-stack">
        <span class="lre-small lre-muted">Describe a place's inside in your own words: rooms and how they connect, or a town's places and the walks between them. The AI draws it as an lre-map-v1 map; you see it as a proposal with its preview before it goes into the draft.</span>
        <label class="lre-field">
          <span class="label">The place to draw</span>
          <select class="lre-input" value={chosen} onChange={(event) => setScope(event.currentTarget.value)}>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.id})
              </option>
            ))}
          </select>
        </label>
        <label class="lre-field">
          <span class="label">Map id</span>
          <input class="lre-input" placeholder={`${chosen}_map`} value={mapId} onInput={(event) => setMapId(event.currentTarget.value.replace(/[^\w-]/g, "_"))} />
        </label>
        <label class="lre-field">
          <span class="label">Describe it</span>
          <textarea class="lre-input" rows={6} style={{ fontFamily: "inherit" }} placeholder="A narrow farmhouse: the front door opens into a hall, with the parlour on the left and the kitchen at the back; a door from the kitchen to the scullery…" value={text} onInput={(event) => setText(event.currentTarget.value)} />
        </label>
        <button type="button" class="lre-btn primary" disabled={!text.trim() || !chosen || props.busy} onClick={() => props.onStart({ scope: chosen, prose: text.trim(), ...(mapId.trim() ? { mapId: mapId.trim() } : {}) })}>
          Draw the map
        </button>
      </div>
    );
  }
  if (props.kind === "refine") {
    return (
      <div class="lre-stack">
        <label class="lre-field">
          <span class="label">What should change?</span>
          <textarea class="lre-input" rows={4} style={{ fontFamily: "inherit" }} placeholder="Add a night-shift nurse who knows Dev; give the diner a weekly schedule…" value={text} onInput={(event) => setText(event.currentTarget.value)} />
        </label>
        <button type="button" class="lre-btn primary" disabled={!text.trim() || props.busy} onClick={() => props.onStart({ instructions: text.trim() })}>
          Propose changes
        </button>
      </div>
    );
  }
  if (props.kind === "check_world") {
    return (
      <div class="lre-stack">
        <span class="lre-small lre-muted">Runs the world forward one day per turn with no player input and reports what happened, dropped events, failures and leaks. Nothing is saved.</span>
        <Seg label="Days" value={days} options={CHECK_DAYS} onChange={(next) => setDays(next)} />
        <button type="button" class="lre-btn primary" disabled={props.busy} onClick={() => props.onStart({ days })}>
          Run check
        </button>
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
      <label class="lre-field">
        <span class="label">Player turns (one per line, up to 50)</span>
        <textarea class="lre-input" rows={5} style={{ fontFamily: "inherit" }} placeholder={"I walk to the diner.\nI order a coffee.\nI ask Rosie about the night shift."} value={text} onInput={(event) => setText(event.currentTarget.value)} />
      </label>
      <button type="button" class="lre-btn primary" disabled={script.length === 0 || props.busy} onClick={() => props.onStart({ turns: script })}>
        Run playtest{script.length > 0 ? ` (${script.length} turn${script.length === 1 ? "" : "s"})` : ""}
      </button>
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

function ProposalReview(props: { app: App; worldId: string; proposals: JobProposal[] }) {
  const [accepted, setAccepted] = useState<Set<string>>(() => startTicked(props.proposals));
  const [open, setOpen] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [busy, run] = useBusy();
  const send = useMemo(() => draftSend(props.app), [props.app]);
  const draft = useSelect(props.app.drafts, (d) => d);
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
  return (
    <Card title="Proposals" aside={<span class="lre-badge">{accepted.size} / {props.proposals.length}</span>}>
      <div class="lre-inline" style={{ marginBottom: "8px" }}>
        <button type="button" class="lre-btn small" onClick={() => setAccepted(new Set(props.proposals.map((p) => p.id)))}>
          Select all
        </button>
        <button type="button" class="lre-btn small" onClick={() => setAccepted(new Set())}>
          None
        </button>
      </div>
      {proposalGroups(props.proposals).map((group) => (
        <div key={group.pack} data-lre-proposal-pack={group.pack} style={{ marginTop: "6px" }}>
          <div class="lre-spread">
            <span class="lre-small lre-muted" style={{ textTransform: "uppercase", letterSpacing: ".06em" }}>{group.pack}</span>
            <span class="lre-small lre-muted">
              {group.proposals.filter((p) => accepted.has(p.id)).length} / {group.proposals.length}
            </span>
          </div>
          {group.proposals.map((p) => {
            const value = isRecord(p.value) ? p.value : {};
            const from = [...new Set(strings(value.sources).map((link) => link.split("/")[0] ?? link))].map((id) => bookNames[id] ?? id);
            const assumed = strings(value.assumed);
            const tableFields = assumed.filter((f) => f !== "kind");
            // A pack draws what it can of a proposed value (a map as Play will show it).
            const Preview = props.app.catalog.previews.get(p.collection);
            return (
              <div key={p.id} class="lre-lint" data-lre-proposal={p.id}>
                <label class="lre-check">
                  <input type="checkbox" aria-label={`Accept ${p.collection}.${p.key}`} checked={accepted.has(p.id)} onChange={() => toggle(p.id)} />
                </label>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span class="lre-spread">
                    <code>
                      {p.collection}.{p.key}
                    </code>
                    <span class={p.confidence >= 0.8 ? "lre-badge pos" : p.confidence >= 0.5 ? "lre-badge warn" : "lre-badge neg"}>{Math.round(p.confidence * 100)}%</span>
                  </span>
                  {/* A linked proposal's source is an entry id; "From lore" names its book instead. */}
                  {from.length === 0 || p.note ? (
                    <span class="lre-small lre-muted" style={{ display: "block" }}>
                      {[from.length === 0 ? p.source : null, p.note].filter((part) => part).join(" — ")}
                    </span>
                  ) : null}
                  {from.length > 0 ? (
                    <span class="lre-small" style={{ display: "block" }} data-lre-proposal-from>
                      From lore: {from.join(", ")}
                    </span>
                  ) : null}
                  {assumed.includes("kind") ? (
                    <span class="lre-small lre-warn" style={{ display: "block" }} data-lre-proposal-assumed-kind>
                      Assumed kind: {String(value.kind)} (the lore named none)
                    </span>
                  ) : null}
                  {tableFields.length > 0 ? (
                    <span class="lre-small lre-warn" style={{ display: "block" }} data-lre-proposal-assumed>
                      Assumed from a table: {tableFields.join(", ")}
                    </span>
                  ) : null}
                  <button type="button" class="lre-btn small ghost" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                    {open === p.id ? "Hide value" : "Show value"}
                  </button>
                  {open === p.id ? <JsonView value={shownValue(p, bookNames)} /> : null}
                  {Preview && draft ? <Preview world={draft.doc} collection={p.collection} id={p.key} value={p.value} /> : null}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <button
        type="button"
        class="lre-btn primary block"
        style={{ marginTop: "8px" }}
        disabled={accepted.size === 0 || busy || applied}
        onClick={() =>
          run(async () => {
            let ok = 0;
            for (const write of proposalWrites(props.worldId, props.proposals, accepted)) {
              const message = await send(write);
              if (message.type === "lre.result") ok += 1;
            }
            props.app.toast(`Applied ${ok} of ${accepted.size} to the draft. Commit when ready.`, ok === accepted.size ? "info" : "error");
            setApplied(true);
          })
        }
      >
        {applied ? "Applied to the draft" : `Apply ${accepted.size} to the draft`}
      </button>
    </Card>
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
  return (
    <div class="lre-stack" data-lre-job={props.kind}>
      <div class="lre-h2">{TITLE[props.kind]}</div>
      {!job || job.status !== "running" ? (
        <Card title={job ? "Run again" : "Start"}>
          <JobInput kind={props.kind} onStart={start} busy={busy} />
        </Card>
      ) : null}
      {job ? (
        <Card title="Status" aside={<span class={`lre-badge ${STATUS_TONE[job.status]}`}>{job.status}</span>}>
          <div class="lre-progress" role="progressbar" aria-label={`${TITLE[props.kind]} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.progress * 100)}>
            <span style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          {job.message ? <div class="lre-small lre-muted" style={{ marginTop: "6px" }}>{job.message}</div> : null}
          {job.status === "running" ? (
            <button
              type="button"
              class="lre-btn small"
              style={{ marginTop: "8px" }}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await app.request({ type: "lre.job", op: "cancel", jobId: job.jobId });
                })
              }
            >
              Cancel
            </button>
          ) : (
            <div class="lre-inline" style={{ marginTop: "8px" }}>
              {job.status === "interrupted" && job.input ? (
                <button type="button" class="lre-btn small primary" disabled={busy} onClick={() => job.input && start(job.input)}>
                  Run it again
                </button>
              ) : null}
              <button
                type="button"
                class="lre-btn small ghost"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    if (!(await app.request({ type: "lre.job", op: "dismiss", jobId: job.jobId }))) return;
                    jobStore.update((all) => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key)));
                  })
                }
              >
                Dismiss
              </button>
            </div>
          )}
        </Card>
      ) : null}
      {result && "proposals" in result ? result.proposals.length === 0 ? <Empty>No proposals.</Empty> : <ProposalReview key={job?.jobId} app={app} worldId={props.worldId} proposals={result.proposals} /> : null}
      {result && "turns" in result ? (
        <>
          <Card title="Transcript">
            {result.turns.map((turn, i) => (
              <div key={i} class="lre-stack" style={{ padding: "8px 0", borderBottom: "1px solid rgba(127,127,127,.15)" }}>
                <span>
                  <strong>You:</strong> {turn.user}
                </span>
                <span style={{ whiteSpace: "pre-wrap" }}>{turn.reply}</span>
                {turn.notes.map((note) => (
                  <span key={note} class="lre-small lre-muted">
                    • {note}
                  </span>
                ))}
              </div>
            ))}
          </Card>
          <Card title="Issues found" aside={<span class="lre-badge">{result.lint.length}</span>}>
            {result.lint.length === 0 ? (
              <Empty>None.</Empty>
            ) : (
              result.lint.map((issue, i) => {
                const target = issueTarget(issue.path);
                return <Row key={i} k={issue.message} sub={issue.path} v={target ? <button type="button" class="lre-btn small" onClick={() => app.ui.update((ui) => ({ ...ui, build: { view: "item", worldId: props.worldId, collection: target.collection, id: target.id } }))}>Open</button> : undefined} />;
              })
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
