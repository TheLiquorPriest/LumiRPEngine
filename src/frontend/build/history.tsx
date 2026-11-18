// Build → a world's history (DESIGN §23): what the draft changes against the world's last revision, the one line of note a commit takes,
// the world's revisions newest first (when, the note, how many things each changed, the chats that play it), the difference between two
// of them, and putting an earlier one in the draft. A difference is read part by part, as the server gives it (`lre.world changes`):
// for each part of the world how many things were added, changed and removed, and the first of them by name. The world bar draws the
// first two (`UncommittedPanel`, `CommitPanel`); the world home draws the list (`RevisionsSection`).

import { Fragment } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { RevisionId, WorldId } from "../../shared/ids";
import { hasOwn } from "../../shared/json";
import type { WorldChangesInfo, WorldRevisionInfo } from "../../shared/protocol";
import type { WorldCollection } from "../../shared/world";
import { useSelect } from "../../ui/store";
import { useApp } from "../app";
import { Badge, Button, Empty, Field, List, ListRow, Section, useBusy } from "../components";
import { humanize } from "../format";
import { issuePart } from "./check";
import { COLLECTION_INFO, PART_INFO } from "./chrome";
import { restoreRevision } from "./draft";

/** A time as Build writes one: a day and the minute. */
function when(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const SOURCE_WORDS: Record<NonNullable<WorldRevisionInfo["source"]>, string> = {
  create: "Where the world started",
  build: "Committed in Build",
  agent: "Committed by an outside agent",
  import: "Imported from a file",
};

const things = (n: number): string => (n === 1 ? "1 thing" : `${n} things`);

// ---------------------------------------------------------------- a difference, part by part

/** The part of the world a change belongs to, in Build's words: a collection, a part of the world, or a pack's own list. */
function partLabel(part: string): string {
  if (hasOwn(COLLECTION_INFO, part)) return COLLECTION_INFO[part as WorldCollection].label;
  const named = issuePart(part);
  return named === null ? humanize(part) : PART_INFO[named].label;
}

interface Group {
  label: string;
  added: number;
  changed: number;
  removed: number;
  named: WorldChangesInfo["parts"][number]["things"];
  more: number;
}

/** The parts under the words Build uses for them: the world's own fields (its name, its start, its currency…) are one part, World. */
function groups(changes: WorldChangesInfo): Group[] {
  const found = new Map<string, Group>();
  for (const part of changes.parts) {
    const label = partLabel(part.part);
    const group = found.get(label) ?? { label, added: 0, changed: 0, removed: 0, named: [], more: 0 };
    found.set(label, group);
    group.added += part.added;
    group.changed += part.changed;
    group.removed += part.removed;
    group.named.push(...part.things);
    group.more += part.more;
  }
  return [...found.values()];
}

/** How many things a part gained, changed and lost, then the first of them by name. */
function groupWords(group: Group): { counts: string; names: string } {
  const counts = ([["added", group.added], ["changed", group.changed], ["removed", group.removed]] as const).filter(([, n]) => n > 0).map(([kind, n]) => `${n} ${kind}`);
  const names = (["added", "changed", "removed"] as const)
    .map((kind) => ({ kind, who: group.named.filter((t) => t.kind === kind).map((t) => t.name ?? humanize(t.id)) }))
    .filter((k) => k.who.length > 0)
    .map((k) => `${humanize(k.kind)}: ${k.who.join(", ")}`);
  return { counts: counts.join(" · "), names: [...names, ...(group.more > 0 ? [`${group.more} more not named`] : [])].join(" · ") };
}

/** What changed, part by part. `none` says so when nothing did. */
function ChangesList(props: { changes: WorldChangesInfo; none: string }) {
  if (props.changes.total === 0) return <p class="lre-build-note">{props.none}</p>;
  return (
    <div class="lre-stack" data-lre-changes>
      <p class="lre-build-note">{things(props.changes.total)} changed, part by part:</p>
      <div class="lre-build-well">
        <List>
          {groups(props.changes).map((group) => {
            const words = groupWords(group);
            return (
              <ListRow
                key={group.label}
                title={group.label}
                subtitle={
                  <>
                    {words.counts}
                    {words.names === "" ? null : (
                      <>
                        <br />
                        {words.names}
                      </>
                    )}
                  </>
                }
              />
            );
          })}
        </List>
      </div>
    </div>
  );
}

/**
 * Reads what changed from one version of the world to another (`range`: the head to the draft where it names none; null reads nothing).
 * The same comparison read again, because `watch` moved, keeps what it shows until the new answer comes; another comparison starts empty.
 */
function useChanges(worldId: WorldId, range: { from?: RevisionId; to?: RevisionId } | null, watch = 0): { changes: WorldChangesInfo | null; failed: boolean; again(): void } {
  const app = useApp();
  const [read, setRead] = useState<{ changes: WorldChangesInfo | null; failed: boolean }>({ changes: null, failed: false });
  const [tries, setTries] = useState(0);
  const asked = useRef("");
  const wanted = JSON.stringify([worldId, range]);
  useEffect(() => {
    if (range === null) return undefined;
    let current = true;
    if (asked.current !== wanted) setRead({ changes: null, failed: false });
    asked.current = wanted;
    void app.request({ type: "lre.world", op: "changes", worldId, ...(range.from === undefined ? {} : { from: range.from }), ...(range.to === undefined ? {} : { to: range.to }) }).then((result) => {
      if (current) setRead(result?.changes ? { changes: result.changes, failed: false } : { changes: null, failed: true });
    });
    return () => {
      current = false;
    };
  }, [wanted, watch, tries]);
  return {
    ...read,
    again: () => {
      setRead({ changes: null, failed: false });
      setTries((n) => n + 1);
    },
  };
}

// ---------------------------------------------------------------- the world bar: Commit and what is uncommitted

/** What the draft changes against the world's last revision; it follows the draft while it is open (`version` is the draft's). */
export function UncommittedPanel(props: { worldId: WorldId; version: number; onClose(): void }) {
  const read = useChanges(props.worldId, {}, props.version);
  return (
    <Section
      title="Uncommitted changes"
      aside={
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      }
    >
      <div class="lre-stack" data-lre-uncommitted>
        {read.failed ? (
          <Empty icon="alert" title="What changed could not be read." action={<Button onClick={read.again}>Try again</Button>} />
        ) : read.changes === null ? (
          <p class="lre-build-note">Reading what changed…</p>
        ) : (
          <>
            <p class="lre-build-note">Your draft set against the world's last revision.</p>
            <ChangesList changes={read.changes} none="Your draft is the same as the last revision." />
          </>
        )}
      </div>
    </Section>
  );
}

/** Commit: one line for a note, which is optional and is kept with the revision. A note is cut to the length `worlds.noteChars` gives, so the box stops there. */
export function CommitPanel(props: { busy: boolean; onCommit(note: string): void; onClose(): void }) {
  const app = useApp();
  const [note, setNote] = useState("");
  const [most, setMost] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const noteId = useId();
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    void app.send({ type: "lre.world", op: "limits" }).then((message) => {
      if (message.type === "lre.result" && message.request === "lre.world") setMost(message.body.limits?.noteChars ?? null);
    });
  }, []);
  return (
    <form
      class="lre-build-new"
      aria-label="Commit"
      data-lre-commit
      onSubmit={(event) => {
        event.preventDefault();
        props.onCommit(note);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        props.onClose();
      }}
    >
      {most === 0 ? (
        <p class="lre-build-note">Your settings keep no note with a commit.</p>
      ) : (
        <Field label="Note (optional)" for={noteId} help="One line on what changed. It is kept with the revision.">
          <input ref={input} id={noteId} class="lre-input" value={note} maxLength={most ?? undefined} autoComplete="off" disabled={props.busy} onInput={(event) => setNote(event.currentTarget.value)} />
        </Field>
      )}
      <div class="lre-build-actions">
        <Button type="submit" variant="primary" busy={props.busy}>
          Commit
        </Button>
        <Button variant="ghost" disabled={props.busy} onClick={props.onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- the world home: the revisions

/** A revision in words, for a choice between revisions and a question about one: when it was made, and its note. */
function describe(row: WorldRevisionInfo): string {
  return `${row.at === undefined ? "An earlier revision" : when(row.at)}${row.note === undefined ? "" : `: ${row.note}`}`;
}

const placeOf = (row: WorldRevisionInfo): string => `${row.at ?? 0}~${row.revision}`;

/**
 * One revision opened: the chats that play it by name, what it changed against the revision before it (or against another you choose from
 * the revisions listed), and Put this revision in the draft.
 */
function RevisionDetail(props: { worldId: WorldId; row: WorldRevisionInfo; rows: readonly WorldRevisionInfo[]; busy: boolean; onRestore(): void }) {
  const { row } = props;
  const [against, setAgainst] = useState("");
  const selectId = useId();
  const from = against === "" ? row.before : against;
  const read = useChanges(props.worldId, from === null ? null : { from, to: row.revision });
  const others = props.rows.filter((r, i, all) => r.revision !== row.revision && all.findIndex((x) => x.revision === r.revision) === i);
  const chosen = others.find((r) => r.revision === against);
  return (
    <div class="lre-build-detail" role="listitem" data-lre-revision-detail>
      <p class="lre-build-note">{row.chats.length === 0 ? "None of your chats plays this revision." : `Played by ${row.chats.map((c) => c.name).join(", ")}.`}</p>
      {others.length > 0 ? (
        <Field label="Compare with" for={selectId}>
          <select id={selectId} class="lre-input" value={against} onChange={(event) => setAgainst(event.currentTarget.value)}>
            <option value="">{row.before === null ? "Nothing: the world started here" : "The revision before it"}</option>
            {others.map((other) => (
              <option key={placeOf(other)} value={other.revision}>
                {describe(other)}
              </option>
            ))}
          </select>
        </Field>
      ) : null}
      {from === null ? (
        <p class="lre-build-note">The world started here, so there is nothing before it to compare with.</p>
      ) : read.failed ? (
        <Empty icon="alert" title="What changed could not be read." action={<Button onClick={read.again}>Try again</Button>} />
      ) : read.changes === null ? (
        <p class="lre-build-note">Reading what changed…</p>
      ) : (
        <>
          <p class="lre-build-note">Changes from {chosen === undefined ? "the revision before it" : describe(chosen)} to this revision.</p>
          <ChangesList changes={read.changes} none="These two revisions are the same." />
        </>
      )}
      {row.head ? null : (
        <div class="lre-build-actions">
          <Button icon="undo" disabled={props.busy} onClick={props.onRestore}>
            Put this revision in the draft
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The world's revisions, newest first and a page at a time: when each was made, its note, how many things it changed and which of your
 * chats play it. A press opens one (`RevisionDetail`). The list is read again when the world's head moves.
 */
export function RevisionsSection(props: { worldId: WorldId }) {
  const app = useApp();
  const head = useSelect(app.drafts, (d) => (d?.worldId === props.worldId ? d.base : null));
  const [rows, setRows] = useState<WorldRevisionInfo[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const latest = useRef(0);
  const load = async (cursor?: string): Promise<void> => {
    const mine = ++latest.current;
    const result = await app.request({ type: "lre.world", op: "revisions", worldId: props.worldId, ...(cursor === undefined ? {} : { cursor }) });
    if (mine !== latest.current) return;
    const page = result?.revisions;
    if (page === undefined) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setRows((held) => (cursor === undefined || held === null ? page : [...held, ...page]));
    setNext(result?.next ?? null);
  };
  useEffect(() => {
    void load();
  }, [props.worldId, head]);
  return (
    <div data-lre-revisions>
      <Section title="Revisions" flush>
        {failed && rows === null ? (
          <Empty icon="alert" title="This world's revisions could not be read." action={<Button onClick={() => void load()}>Try again</Button>} />
        ) : rows === null ? (
          <Empty icon="hourglass">Reading this world's revisions…</Empty>
        ) : (
          <List>
            {rows.map((row, i) => {
              const key = placeOf(row);
              const opened = open === key;
              const chats = row.chats.length;
              return (
                <Fragment key={key}>
                  <ListRow
                    icon="clock"
                    title={row.note ?? (row.source === undefined ? "An earlier revision" : SOURCE_WORDS[row.source])}
                    subtitle={[row.at === undefined ? "Made before the history was kept" : when(row.at), row.note !== undefined && row.source !== undefined ? SOURCE_WORDS[row.source] : null, row.changed === null ? null : row.changed === 0 ? "No changes" : `${things(row.changed)} changed`].filter((s) => s !== null).join(" · ")}
                    badge={
                      <>
                        {row.head ? <Badge tone="accent">{i === 0 ? "Latest" : "Same as the latest"}</Badge> : null}
                        {chats > 0 ? <Badge>{chats === 1 ? "1 chat" : `${chats} chats`}</Badge> : null}
                      </>
                    }
                    chevron
                    current={opened}
                    onClick={() => setOpen(opened ? null : key)}
                  />
                  {opened ? (
                    <RevisionDetail
                      worldId={props.worldId}
                      row={row}
                      rows={rows}
                      busy={busy}
                      onRestore={() =>
                        run(async () => {
                          if (await restoreRevision(app, row.revision, `the revision ${row.at === undefined ? "made before the history was kept" : `of ${when(row.at)}`}`)) setOpen(null);
                        })
                      }
                    />
                  ) : null}
                </Fragment>
              );
            })}
          </List>
        )}
      </Section>
      {next !== null && rows !== null ? (
        <div class="lre-build-actions">
          <Button size="sm" disabled={busy} onClick={() => run(() => load(next))}>
            Show older revisions
          </Button>
        </div>
      ) : null}
    </div>
  );
}
