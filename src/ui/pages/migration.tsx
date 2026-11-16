// Migration (plan §14, §15.3, §15.5, §15.6; R-80, R-180, R-327, R-328): before the swap, served by the copy that runs
// `rpe migrate`, and after it, in RPE. A rehearsal started here reads today's data and writes nothing; the running RPE holds
// its report beside the last real run's, and either can be read here a page at a time (its rows, its chats by their names in
// Lumiverse with each one's check and differences, the things found) and saved as a file. Then the backup with its checksum,
// what is waiting on him, the swap's steps, and going back's with the permissions the previous build asks for, by name:
// before any run as after. Every list is paged at `migration.page`, and every part lays out at phone width.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { FoldDifference, MigrationChatShown, MigrationItemShown, MigrationReply, MigrationRowShown, MigrationSummaryShown, WaitingOnUser } from "../../shared/api";
import { useApp } from "../app";
import { Badge, Banner, Button, Fold, PageHeader, Pre, Row, Section } from "../atoms";
import type { RpeClient } from "../client";
import type { PageEntry } from "../page-entry";
import { type PagedReading, usePaged, useRead } from "../reading";
import { bytesWords, counted, errorWords } from "../words";
import { CarriedOffer } from "./bootstrap";

/** Which report the lists read: the last real run's, or the rehearsal started from this page. */
type Of = "run" | "rehearsal";

/** "a, b and c". */
function andList(parts: readonly string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** One thing waiting on the user, in words. */
export function waitingWords(w: WaitingOnUser): string {
  if (w.kind === "guidance") return `Your GUIDANCE.md is at ${w.path}, switched off.`;
  if (w.kind === "connection") return `The setting ${w.setting} names ${w.connection}, a connection in Lumiverse: pick one of RPE's for it.`;
  if (w.kind === "own") return `Your own ${andList([counted(w.agents, "agent"), counted(w.skills, "skill"), counted(w.texts, "text")])} are attached and switched off.`;
  if (w.kind === "filing") return `Chat ${w.chat}: the mind files of ${counted(w.characters, "character")}${w.notes ? ", and its notes," : ""} are attached and not yet filed.`;
  const parts = [
    w.questions > 0 ? counted(w.questions, "edit waiting on keep or discard", "edits waiting on keep or discard") : null,
    w.staged > 0 ? counted(w.staged, "staged action") : null,
    w.chips > 0 ? counted(w.chips, "chip") : null,
    w.reviewCards > 0 ? counted(w.reviewCards, "review card") : null,
    w.rollback ? "a rollback never applied" : null,
  ].filter((part) => part !== null);
  return `Chat ${w.chat}: ${andList(parts)}.`;
}

/** A report in brief: when it read today's data, whether the real run may start on it, and the disk. */
function SummaryView(props: { summary: MigrationSummaryShown; onSave(): void; saving: boolean }) {
  const s = props.summary;
  return (
    <div class="lre-stack">
      <Row label="Read at" value={s.at} />
      <Row label={s.mode === "real run" ? "What did not balance" : "The real run"} value={s.refusals.length === 0 ? (s.mode === "real run" ? "every row balances" : "may start") : counted(s.refusals.length, "reason it won't start", "reasons it won't start")} />
      {s.refusals.length === 0 ? null : (
        <ul class="rpe-reports">
          {s.refusals.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <Row label="Found" value={`${counted(s.counts.items, "thing")} in ${counted(s.counts.rows, "row")}, ${counted(s.counts.chats, "chat")}`} sub={`${s.counts.notClassified} found, not classified; ${s.counts.unreadable} could not be read; ${s.counts.differences} difference(s) from today's fold; ${s.counts.offRpe} chat(s) still off RPE`} />
      <Row label="Disk" value={`${bytesWords(s.disk.total)} in all`} sub={`the backup ${bytesWords(s.disk.backup)}, the import ${bytesWords(s.disk.import)}${s.disk.free === null ? "" : `; ${bytesWords(s.disk.free)} free`}`} />
      {s.backup === null ? null : <Row label="Backup" value={s.backup.path} sub={<code class="rpe-hash">{s.backup.sha256}</code>} />}
      <div class="lre-inline">
        <Button small kind="ghost" busy={props.saving} onClick={props.onSave}>
          Save the report as a file
        </Button>
      </div>
    </div>
  );
}

/** Saves a report as two files, its JSON and its printed text, through the shell's own download. */
async function saveReport(client: Pick<RpeClient, "call">, of: Of, download: (name: string, text: string) => void): Promise<void> {
  const file = await client.call("GET /api/v1/migration/:of/file", { of });
  download(file.name, JSON.stringify(file.report, null, 2));
  download(file.name.replace(/\.json$/, ".txt"), file.text);
}

/** A list read a page at a time, with its More press. */
function PagedList<T>(props: { read: PagedReading<T>; empty: string; item(item: T): ComponentChildren; label: string }) {
  const { read } = props;
  return (
    <div class="lre-stack">
      {read.problem === null ? null : (
        <Banner tone="neg" icon="alert" title={`The ${props.label} could not be read`}>
          <span>{read.problem}</span>
        </Banner>
      )}
      {read.items.length === 0 && !read.loading ? <p class="lre-muted rpe-line">{props.empty}</p> : <ul class="lre-stack rpe-plain">{read.items.map((item) => props.item(item))}</ul>}
      {read.more ? (
        <Button small busy={read.loading} onClick={read.older}>
          More {props.label}
        </Button>
      ) : null}
    </div>
  );
}

function RowLine(props: { row: MigrationRowShown }) {
  const r = props.row;
  const c = r.count;
  const inside = r.inside as { count?: number; unit?: string; ends?: { carried: number; attached: number; archived: number } } | null;
  return (
    <li class="lre-stack rpe-entry" data-row={r.row}>
      <span class="rpe-strong">{r.what}</span>
      <p class="rpe-line">{r.found === "not read" ? `Not read: ${r.why ?? ""}` : `${c.found} found = ${c.carried} carried + ${c.attached} attached + ${c.archived} archived${c.backup > 0 ? ` + ${c.backup} kept in the backup only` : ""} (${bytesWords(r.bytes)})`}</p>
      {inside === null || inside.count === undefined ? null : <p class="rpe-meta">{`Inside other rows' things: ${inside.count} ${inside.unit ?? ""}${inside.ends === undefined ? "" : ` = ${inside.ends.carried} carried + ${inside.ends.attached} attached + ${inside.ends.archived} archived`}`}</p>}
      {r.stranded === null ? null : <p class="rpe-line rpe-neg">{`${r.stranded.count} with no place: ${r.stranded.why.join("; ")}`}</p>}
      {r.landed === null ? null : <p class="rpe-meta">{r.landed}</p>}
    </li>
  );
}

function DifferenceLine(props: { d: FoldDifference }) {
  const d = props.d;
  return (
    <li>
      {d.kept ? "differs" : "differs (not kept: the turn is the chat it was made from's)"} at {d.at === "head" ? "the head" : `message ${d.at.message}, swipe ${d.at.swipe}`}: {d.values.join(", ")}
    </li>
  );
}

/** A chat's differences from today's fold, a page at a time. */
function Differences(props: { of: Of; chat: string }) {
  const app = useApp();
  const read = usePaged<FoldDifference>((cursor) => app.client.call("GET /api/v1/migration/:of/chats/:chat/differences", { of: props.of, chat: props.chat }, { query: cursor === undefined ? {} : { cursor } }), [props.of, props.chat]);
  return <PagedList read={read} label="differences" empty="It matched today's fold everywhere." item={(d) => <DifferenceLine key={`${d.turn}${d.at === "head" ? "" : `${d.at.message}:${d.at.swipe}`}`} d={d} />} />;
}

/** One chat by its name in Lumiverse: what came of it, its check, and the one step that puts it on RPE where it is still off it. */
function ChatLine(props: { chat: MigrationChatShown; of: Of }) {
  const c = props.chat;
  const [open, setOpen] = useState(false);
  const imported = c.outcome === "imported" || c.outcome === "replaced";
  const m = c.check?.matched ?? null;
  const clean = m !== null && m.head && c.check?.differences === 0;
  return (
    <li class="lre-stack rpe-migrated" data-chat={c.chat} key={c.chat}>
      <div class="lre-inline">
        <span class="rpe-strong">{c.name ?? c.chat}</span>
        {c.outcome === null ? null : <Badge tone={imported ? (clean ? "pos" : "warn") : undefined}>{c.outcome}</Badge>}
      </div>
      {c.name === null ? null : <p class="rpe-meta">{c.chat}</p>}
      <p class="rpe-line">{`${counted(c.turns, "turn")} over ${counted(c.replies, "reply", "replies")}${c.engine === null ? "" : ` on the ${c.engine} engine`}${c.journal === null ? "" : `; journal ${c.journal}`}`}</p>
      {c.why === null ? null : <p class="rpe-meta">{c.why}</p>}
      {m === null || c.check === null ? null : (
        <p class="rpe-line">
          {counted(c.imported, "turn")} imported · matched at the head: {m.head ? "yes" : "no"}, at {m.swipes} of {m.of} swipes
          {c.shares === null ? "" : ` · shares ${counted(c.shares.messages, "message")} with ${c.shares.chat}`}
        </p>
      )}
      {c.offRpe ? <p class="rpe-line">Still off RPE: in Lumiverse, choose one of RPE's connections for this chat, and it is on RPE. RPE changes nothing in it.</p> : null}
      {c.check !== null && c.check.differences > 0 ? (
        <>
          <Button small kind="ghost" current={open} onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Show"} {counted(c.check.differences, "difference")}
          </Button>
          {open ? <Differences of={props.of} chat={c.chat} /> : null}
        </>
      ) : null}
    </li>
  );
}

function Chats(props: { of: Of }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const read = usePaged<MigrationChatShown>((cursor) => app.client.call("GET /api/v1/migration/:of/chats", { of: props.of }, { query: { ...(q.trim() === "" ? {} : { q }), ...(cursor === undefined ? {} : { cursor }) } }), [props.of, q]);
  return (
    <div class="lre-stack">
      <input class="lre-input" type="search" value={q} placeholder="a chat's name or id" onInput={(event) => setQ((event.currentTarget as HTMLInputElement).value)} />
      <PagedList read={read} label="chats" empty={q === "" ? "The report names no chat." : "No chat's name or id holds that."} item={(c) => <ChatLine key={c.chat} chat={c} of={props.of} />} />
    </div>
  );
}

function ItemLine(props: { item: MigrationItemShown }) {
  const i = props.item;
  return (
    <li class="lre-stack rpe-entry">
      <span class="rpe-line">{`${i.where}: ${i.path}`}</span>
      <p class="rpe-meta">
        {i.row === null ? "found, not classified" : `${i.row}, ${i.fate ?? ""}`} · {bytesWords(i.bytes)} · <code class="rpe-hash">{i.sha256}</code>
      </p>
      {i.note === undefined ? null : <p class="rpe-meta">{i.note}</p>}
    </li>
  );
}

function Items(props: { of: Of }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState(false);
  const read = usePaged<MigrationItemShown>(
    (cursor) => app.client.call("GET /api/v1/migration/:of/items", { of: props.of }, { query: { ...(q.trim() === "" ? {} : { q }), ...(only ? { row: "none" } : {}), ...(cursor === undefined ? {} : { cursor }) } }),
    [props.of, q, only],
  );
  return (
    <div class="lre-stack">
      <input class="lre-input" type="search" value={q} placeholder="a path, a row, a note" onInput={(event) => setQ((event.currentTarget as HTMLInputElement).value)} />
      <Button small kind="ghost" current={only} onClick={() => setOnly(!only)}>
        Only what was found, not classified
      </Button>
      <PagedList read={read} label="things" empty="Nothing found here." item={(i) => <ItemLine key={`${i.where}: ${i.path}`} item={i} />} />
    </div>
  );
}

function Rows(props: { of: Of }) {
  const app = useApp();
  const read = usePaged<MigrationRowShown>((cursor) => app.client.call("GET /api/v1/migration/:of/rows", { of: props.of }, { query: cursor === undefined ? {} : { cursor } }), [props.of]);
  return <PagedList read={read} label="rows" empty="The report has no rows." item={(r) => <RowLine key={r.row} row={r} />} />;
}

function PrintedText(props: { of: Of }) {
  const app = useApp();
  const read = useRead(() => app.client.call("GET /api/v1/migration/:of/text", { of: props.of }), [props.of]);
  return read.problem !== null ? <p class="rpe-line">{read.problem}</p> : read.value === null ? <p class="lre-muted rpe-line">Reading the printed report…</p> : <Pre text={read.value.text} />;
}

/** The report the lists read, a page at a time. */
function ReportLists(props: { of: Of }) {
  return (
    <>
      <Section title="Rows" id="rows">
        <Rows of={props.of} />
      </Section>
      <Section title="Chats" id="chats">
        <Chats of={props.of} />
      </Section>
      <Section title="What was found" id="items">
        <Items of={props.of} />
      </Section>
      <Fold summary="The report, as printed">
        <PrintedText of={props.of} />
      </Fold>
    </>
  );
}

/** The parts of the page that need no list: the rehearsal's start, both reports in brief, the backup, what waits, the swap and going back. */
export function MigrationView(props: {
  shown: MigrationReply;
  starting: boolean;
  said: string | null;
  saving: Of | null;
  of: Of;
  onOf(of: Of): void;
  onRehearse(lumiverse: string | null): void;
  onSave(of: Of): void;
  /** The Lumiverse folder typed for the next rehearsal; null: none typed, the summary's is shown. */
  folder: string | null;
  onFolder(folder: string): void;
  lists?: ComponentChildren;
  offer?: ComponentChildren;
}) {
  const { shown } = props;
  const lumiverse = props.folder ?? shown.sources.lumiverse ?? "";
  const rehearsal = shown.rehearsal;
  const both = shown.run !== null && rehearsal.state === "ready";
  return (
    <div class="lre-stack rpe-page" data-page="migration">
      <PageHeader title="Migration" sub="A rehearsal over today's data, the last real run, what waits on you, the swap and going back." />
      <Section title="A rehearsal" id="rehearsal">
        <p class="rpe-meta">Reads today's data as rpe migrate --rehearse does. It writes nothing: not today's data, not RPE's database. Its report is held here until the next one, or until RPE stops.</p>
        <label class="lre-stack">
          <span class="rpe-meta">Lumiverse's data folder (the one holding lumiverse.db)</span>
          <input class="lre-input" value={lumiverse} placeholder="the folder" onInput={(event) => props.onFolder((event.currentTarget as HTMLInputElement).value)} />
        </label>
        {shown.sources.runtime === null ? <p class="rpe-meta">No runtime of today's build is read.</p> : <p class="rpe-meta">{`Today's runtime is read from ${shown.sources.runtime.configDir} and ${shown.sources.runtime.dataDir}.`}</p>}
        <Button busy={props.starting || rehearsal.state === "running"} onClick={() => props.onRehearse(lumiverse.trim() === "" ? null : lumiverse.trim())}>
          Start a rehearsal
        </Button>
        {props.said === null ? null : <p class="rpe-line">{props.said}</p>}
        {rehearsal.state === "running" ? <p class="lre-muted rpe-line">Reading today's data…</p> : null}
        {rehearsal.state === "failed" ? <p class="rpe-line">{`The last rehearsal stopped: ${rehearsal.why}`}</p> : null}
        {rehearsal.state === "ready" ? <SummaryView summary={rehearsal.summary} saving={props.saving === "rehearsal"} onSave={() => props.onSave("rehearsal")} /> : null}
      </Section>
      <Section title="The last real run" id="run">
        {shown.run === null ? <p class="rpe-line">No real run of the migration has been made in this data folder yet.</p> : <SummaryView summary={shown.run} saving={props.saving === "run"} onSave={() => props.onSave("run")} />}
      </Section>
      {both ? (
        <div class="lre-inline" data-of={props.of}>
          <Button small kind="ghost" current={props.of === "run"} onClick={() => props.onOf("run")}>
            Read the last real run
          </Button>
          <Button small kind="ghost" current={props.of === "rehearsal"} onClick={() => props.onOf("rehearsal")}>
            Read the rehearsal
          </Button>
        </div>
      ) : null}
      {props.lists}
      <Section title="The backup" id="backup">
        {shown.backup === null ? (
          <p class="lre-muted rpe-line">No real run has taken a backup yet.</p>
        ) : (
          <>
            <Row label="Where" value={shown.backup.path} />
            <Row label="Size" value={bytesWords(shown.backup.bytes)} />
            <Row label="SHA-256" value={<code class="rpe-hash">{shown.backup.sha256}</code>} />
            <Row label="Still there, at that size" value={shown.backup.present ? "yes" : "no"} />
          </>
        )}
      </Section>
      <Section title={`Waiting on you (${shown.waiting.length})`} id="waiting">
        {shown.waiting.length === 0 ? (
          <p class="lre-muted rpe-line">Nothing is waiting on you.</p>
        ) : (
          <ul class="rpe-reports">
            {shown.waiting.map((w, i) => (
              <li key={i}>{waitingWords(w)}</li>
            ))}
          </ul>
        )}
        {props.offer}
      </Section>
      <Section title="The swap" id="swap">
        <ul class="lre-stack rpe-plain">
          {shown.swap.map((step, i) => (
            <li key={i} class="rpe-line">
              {step}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Going back" id="going-back">
        <ul class="lre-stack rpe-plain">
          {shown.goingBack.steps.map((step, i) => (
            <li key={i} class="rpe-line">
              {step}
            </li>
          ))}
        </ul>
        <p class="rpe-meta">The permissions the previous build asks for, to approve again ({shown.goingBack.permissions.length}):</p>
        <ul class="rpe-files" data-permissions="true">
          {shown.goingBack.permissions.map((p) => (
            <li key={p}>
              <code>{p}</code>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

export function MigrationPage() {
  const app = useApp();
  const summary = useRead(() => app.client.call("GET /api/v1/migration", {}), []);
  const [starting, setStarting] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [saving, setSaving] = useState<Of | null>(null);
  const [chosen, setChosen] = useState<Of>("run");
  const [folder, setFolder] = useState<string | null>(null);
  const shown = summary.value;
  if (shown === null) {
    return (
      <div class="lre-stack rpe-page" data-page="migration">
        <PageHeader title="Migration" sub="A rehearsal over today's data, the last real run, what waits on you, the swap and going back." />
        {summary.problem === null ? (
          <p class="lre-muted rpe-line">Reading the migration's summary…</p>
        ) : (
          <Banner tone="neg" icon="alert" title="The migration's summary could not be read">
            <span>{summary.problem}</span>
          </Banner>
        )}
      </div>
    );
  }
  // The lists read the report chosen, or the one there is.
  const of: Of = shown.run === null ? "rehearsal" : shown.rehearsal.state === "ready" ? chosen : "run";
  const has = of === "run" ? shown.run !== null : shown.rehearsal.state === "ready";
  const rehearse = (lumiverse: string | null): void => {
    setStarting(true);
    setSaid(null);
    app.client.call("POST /api/v1/migration/rehearsals", {}, { body: lumiverse === null ? {} : { lumiverse } }).then(
      () => {
        setStarting(false);
        setChosen("rehearsal");
        summary.again();
      },
      (error: unknown) => {
        setStarting(false);
        setSaid(errorWords(error));
        summary.again();
      },
    );
  };
  const save = (which: Of): void => {
    setSaving(which);
    const host = app.keptHost();
    saveReport(app.client, which, (name, text) => host.download(name, text))
      .then(
        () => setSaid(null),
        (error: unknown) => setSaid(errorWords(error)),
      )
      .finally(() => {
        host.dispose();
        setSaving(null);
      });
  };
  return (
    <MigrationView
      shown={shown}
      starting={starting}
      said={said}
      saving={saving}
      of={of}
      onOf={setChosen}
      onRehearse={rehearse}
      onSave={save}
      folder={folder}
      onFolder={setFolder}
      lists={has ? <ReportLists key={of} of={of} /> : null}
      offer={shown.run === null ? null : <CarriedOffer />}
    />
  );
}

export const entry: PageEntry = { id: "migration", title: "Migration", icon: "download", shells: ["web", "drawer"], needsChat: false, often: false, order: 130, render: () => <MigrationPage /> };
