// Migration (plan §14, §15.3, §15.5, §15.6; R-80, R-180, R-327, R-328): before the swap, served by the copy that runs
// `rpe migrate`, and after it, in RPE. A rehearsal started here reads today's data and writes nothing; the running RPE holds
// its report beside the last real run's, and either can be read here a page at a time (its rows, its chats by their names in
// Lumiverse with each one's check and differences, the things found) and saved as a file. Then the backup with its checksum,
// what is waiting on him, the swap's steps, and going back's with the permissions the previous build asks for, by name:
// before any run as after. Every list is paged at `migration.page`, and every part lays out at phone width.

import { type ComponentChildren, Fragment } from "preact";
import { useState } from "preact/hooks";
import type { FoldDifference, MigrationChatShown, MigrationItemShown, MigrationReply, MigrationRowShown, MigrationSummaryShown, OffRpeShown, WaitingOnUser } from "../../shared/api";
import { useApp } from "../app";
import { Badge, Banner, Button, Disclosure, PageHeader, Pre, Row, Section } from "../../frontend/components";
import type { RpeClient } from "../client";
import { jobEnded } from "../job-watch";
import type { PageEntry } from "../page-entry";
import { type PagedReading, usePaged, useRead } from "../reading";
import { bytesWords, counted, errorWords } from "../words";
import { CarriedOffer } from "./bootstrap";
import { JobFollowLine, type JobRef, useJobFollow } from "./jobs/follow";
import { GoingBack } from "./migration-going-back";
import { ChatLabel, ChatName, type ChatNames, NO_NAMES, useChatNames } from "./chat-names";

/** Which report the lists read: the last real run's, or the rehearsal started from this page. */
type Of = "run" | "rehearsal";

/** "a, b and c". */
function andList(parts: readonly string[]): string {
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

const REASONS: Readonly<Record<string, string>> = {
  missing_placeholder: "a placeholder the previous build needs is missing from it",
  blank: "it is blank where a text may not be",
  unknown_id: "no build had a text of that id",
};

/** One thing waiting on the user, in words, with the chat it is about (where it is about one) set apart: what comes before its name, the chat, and what follows it. */
function waitingSplit(w: WaitingOnUser): { before: string; chat: string | null; after: string } {
  const plain = (words: string) => ({ before: words, chat: null, after: "" });
  const about = (chat: string, after: string) => ({ before: "Chat ", chat, after });
  switch (w.kind) {
    case "guidance":
      return plain(`Your GUIDANCE.md is at ${w.path}, switched off: one press puts it in force as AGENTS.md at the same level, or copy from it.`);
    case "agent":
      return plain(`Your agent ${w.id} is at ${w.path}, switched off.${w.pins.length > 0 ? ` ${counted(w.pins.length, "pin")} carried for it wait until it is on: ${w.pins.join(", ")}.` : ""}${w.deadTools.length > 0 ? ` Tools it names that no longer exist: ${w.deadTools.join(", ")}.` : ""}`);
    case "skill":
      return plain(`Your skill ${w.id} is at ${w.path}, switched off.`);
    case "connection":
      return plain(w.agent === null ? `${w.where} named ${w.connection}, a connection in Lumiverse: RPE has no place for that work, which its default connection does.` : `${w.where} named ${w.connection}, a connection in Lumiverse: pick one of RPE's for your agent ${w.agent}; until you do, its default connection does that work.`);
    case "paused":
      return about(w.chat, ` was paused on ${counted(w.questions, "edit", "edits")} waiting on keep or discard${w.answered === null ? "." : `: you answered ${w.answered}.`}`);
    case "staged":
      return about(w.chat, `: ${counted(w.staged, "staged change")} waiting for your next message, held as a request: keep it held, or drop it.`);
    case "chat":
      return about(w.chat, `: ${andList([w.chips > 0 ? counted(w.chips, "chip") : "", w.reviewCards > 0 ? counted(w.reviewCards, "review card") : "", w.rollback ? "a rollback never applied, archived" : ""].filter((p) => p !== ""))}, on its turns.`);
    case "filing":
      return about(w.chat, w.characters === 0 ? ": its notes are attached and not yet filed." : `: the mind files of ${counted(w.characters, "character")}${w.notes ? ", and its notes," : ""} are attached and not yet filed.`);
    case "row":
      return plain(`${w.path} is found and no row names it: give it a row, and the next rehearsal uses it.`);
    case "pin":
      return plain(`${w.file} was pinned for ${w.role}, which has no agent in RPE: it is pinned for the Author now. Pin and unpin it on the Files page.`);
    case "text":
      return plain(`Your text ${w.id} is set apart: ${REASONS[w.reason] ?? w.reason}${w.missing.length > 0 ? ` (${w.missing.join(", ")})` : ""}.`);
  }
}

/** One thing waiting on the user, in words; a chat it is about is named as `name` gives it, else by its id. */
export function waitingWords(w: WaitingOnUser, name: ChatNames = NO_NAMES): string {
  const { before, chat, after } = waitingSplit(w);
  return chat === null ? before : `${before}${name(chat) ?? chat}${after}`;
}

/** Where a chat that was off RPE stands now, in words after its name: what it is pinned to, whether that is one of RPE's connections, which one is active for you where it is pinned to none, whether RPE has played it, and what puts it on RPE where it is not. */
export function offRpeWords(o: OffRpeShown): string {
  const played = o.played ? " RPE has played it." : "";
  const choose = "In Lumiverse, choose one of RPE's connections for it, and it is on RPE.";
  if (o.pinned !== null) {
    const name = o.pinnedName ?? o.pinned;
    return o.done ? `pinned to ${name}, one of RPE's connections: it is on RPE.${played}` : `pinned to ${name}, which is not one of RPE's connections: it is off RPE. ${choose}${played}`;
  }
  if (o.active === null) return `pinned to no connection, so it follows the connection active for you; none is selected that RPE can read, so it can't say whether that is one of RPE's. ${choose}${played}`;
  const name = o.active.name ?? o.active.id;
  return o.active.rpe
    ? `pinned to no connection, so it follows the connection active for you, ${name}, which is one of RPE's: it is on RPE for as long as that stays so.${played}`
    : `pinned to no connection, so it follows the connection active for you, ${name}, which is not one of RPE's: it is off RPE. ${choose} Or make one of RPE's connections the one active for you.${played}`;
}

/** A press on the waiting list: its words, busy while it runs, and what came of it. */
function Press(props: { label: string; kind?: "primary" | "danger" | "ghost"; run(): Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  return (
    <>
      <Button size="sm" variant={props.kind ?? "ghost"} busy={busy} onClick={() => {
        setBusy(true);
        setSaid(null);
        props.run().then(
          (words) => {
            setBusy(false);
            setSaid(words);
          },
          (error: unknown) => {
            setBusy(false);
            setSaid(errorWords(error));
          },
        );
      }}>
        {props.label}
      </Button>
      {said === null ? null : <span class="rpe-meta">{said}</span>}
    </>
  );
}

/** A staged change held as a request for his next message: kept as it is, or dropped. */
function StagedRequests(props: { chat: string; onDone(): void }) {
  const app = useApp();
  const read = useRead(() => app.client.call("GET /api/v1/chats/:chat/requests", { chat: props.chat }), [props.chat]);
  const held = (read.value?.requests ?? []).filter((r) => r.id.startsWith("carried:") && r.turn === null);
  if (read.problem !== null) return <p class="rpe-line">{read.problem}</p>;
  if (read.value === null) return <p class="lre-muted rpe-line">Reading what waits for the next message…</p>;
  if (held.length === 0) return <p class="lre-muted rpe-line">Nothing carried waits for the next message now.</p>;
  return (
    <ul class="lre-stack rpe-plain">
      {held.map((r) => (
        <li key={r.id} class="lre-inline">
          <span class="rpe-line">{`Held since ${new Date(r.at).toISOString()}`}</span>
          <Press label="Keep it for my next message" run={async () => "Kept: it goes with your next message."} />
          <Press
            label="Drop it"
            kind="danger"
            run={async () => {
              await app.client.call("DELETE /api/v1/chats/:chat/requests/:request", { chat: props.chat, request: r.id });
              read.again();
              props.onDone();
              return "Dropped.";
            }}
          />
        </li>
      ))}
    </ul>
  );
}

/** RPE's connections to pick from for one of his agents' work. */
function PickConnection(props: { agent: string; onDone(): void }) {
  const app = useApp();
  const read = useRead(() => app.client.call("GET /api/v1/connections", {}), []);
  const [chosen, setChosen] = useState<string>("");
  const list = read.value?.connections ?? [];
  if (read.value === null) return <span class="lre-muted rpe-meta">{read.problem ?? "Reading RPE's connections…"}</span>;
  if (list.length === 0) return <span class="rpe-meta">RPE has no connection yet: add one on the Connections page.</span>;
  return (
    <span class="lre-inline">
      <select class="lre-input" value={chosen} onChange={(event) => setChosen((event.currentTarget as HTMLSelectElement).value)}>
        <option value="">One of RPE's connections</option>
        {list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <Press
        label="Use it"
        kind="primary"
        run={async () => {
          if (chosen === "") return "Pick one first.";
          const done = await app.client.call("POST /api/v1/migration/connection", {}, { body: { agent: props.agent, connection: chosen } });
          props.onDone();
          return `Written in ${done.written.join(" and ")}.`;
        }}
      />
    </span>
  );
}

/** The row he gives a path no row names: archived or attached, with his line saying what it is; added to `migration.rows`. */
function GiveRow(props: { path: string; given: MigrationReply["given"]; onDone(): void }) {
  const app = useApp();
  const [fate, setFate] = useState<"archived" | "attached">("archived");
  const [line, setLine] = useState("");
  return (
    <span class="lre-stack">
      <select class="lre-input" value={fate} onChange={(event) => setFate((event.currentTarget as HTMLSelectElement).value === "attached" ? "attached" : "archived")}>
        <option value="archived">Archived: kept in the backup</option>
        <option value="attached">Attached: kept beside what it belongs to</option>
      </select>
      <input class="lre-input" value={line} placeholder="what it is" onInput={(event) => setLine((event.currentTarget as HTMLInputElement).value)} />
      <Press
        label="Give it a row"
        kind="primary"
        run={async () => {
          if (line.trim() === "") return "Say what it is first.";
          await app.client.call("PUT /api/v1/settings", {}, { body: { level: "global", key: "migration.rows", value: [...props.given, { path: props.path, fate, line: line.trim() }] } });
          props.onDone();
          return "Given: the next rehearsal uses it.";
        }}
      />
    </span>
  );
}

/** One waiting line with its press; a done line struck. */
function WaitingLine(props: { w: WaitingOnUser; given: MigrationReply["given"]; onDone(): void; names?: ChatNames; open?(chat: string): void }) {
  const app = useApp();
  const { w } = props;
  const [open, setOpen] = useState(false);
  const [filing, setFiling] = useState<JobRef | null>(null);
  const following = useJobFollow(filing, () => props.onDone());
  // The press is made once while its job goes on: no second job is started beside the one under way.
  const filingJob = following?.job ?? filing?.view ?? null;
  const filingGoes = filingJob !== null && !jobEnded(filingJob.state);
  const split = waitingSplit(w);
  const words = (
    <span class="rpe-line">
      {split.before}
      {split.chat === null ? null : <ChatName chat={split.chat} name={(props.names ?? NO_NAMES)(split.chat)} {...(props.open === undefined ? {} : { onOpen: props.open })} />}
      {split.after}
    </span>
  );
  let press: ComponentChildren = null;
  const switchOn = (path: string): Promise<string> =>
    app.client.call("POST /api/v1/migration/switch-on", {}, { body: { path } }).then((r) => {
      props.onDone();
      return r.switched ? `On: written at ${r.to}.` : r.inForce.text === r.attached ? `Already on: ${r.to} is in force at the ${r.inForce.level} level with this text.` : `Not written: ${r.to} is in force at the ${r.inForce.level} level already. Compare the two on the Files page and choose.`;
    });
  if (w.kind === "guidance" || w.kind === "agent" || w.kind === "skill") press = <Press label="Switch it on" kind="primary" run={() => switchOn(w.path)} />;
  else if (w.kind === "connection" && w.agent !== null) press = <PickConnection agent={w.agent} onDone={props.onDone} />;
  else if (w.kind === "paused" && !w.done) {
    const answer = (choice: "keep" | "discard") => async (): Promise<string> => {
      const done = await app.client.call("POST /api/v1/migration/chats/:chat/answer", { chat: w.chat }, { body: { choice } });
      props.onDone();
      return done.held ? `${choice === "keep" ? "Kept" : "Discarded"}, and held as the previous build holds it while a reply is under way in that chat: it lands at the run after that reply is finished.` : `${choice === "keep" ? "Kept" : "Discarded"}: ${counted(done.turns.length, "turn")} took the held changes.`;
    };
    press = (
      <span class="lre-inline">
        <Press label="Keep" kind="primary" run={answer("keep")} />
        <Press label="Discard" kind="danger" run={answer("discard")} />
      </span>
    );
  } else if (w.kind === "staged")
    press = (
      <>
        <Button size="sm" variant="ghost" current={open} onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"} what waits
        </Button>
        {open ? <StagedRequests chat={w.chat} onDone={props.onDone} /> : null}
      </>
    );
  else if (w.kind === "chat")
    press = (
      <Button size="sm" variant="ghost" onClick={() => app.go({ page: "turns", chat: w.chat })}>
        Open its turns
      </Button>
    );
  else if (w.kind === "row" && !w.done) press = <GiveRow path={w.path} given={props.given} onDone={props.onDone} />;
  else if (w.kind === "filing" && !w.done)
    press = (
      <Press
        label="Start filing it"
        kind="primary"
        run={async () => {
          const job = await app.client.call("POST /api/v1/chats/:chat/bootstrap", { chat: w.chat }, { body: {} });
          setFiling({ id: job.id, chat: w.chat, view: job });
          props.onDone();
          return `Started job ${job.id}: the offer below follows it, and starts the rest at once.`;
        }}
      />
    );
  else if (w.kind === "pin" || w.kind === "text") {
    const file = w.kind === "pin" ? w.file : w.path;
    press = (
      <Button size="sm" variant="ghost" onClick={() => app.go({ page: "files", at: [file.startsWith("@") ? file : `@global/${file}`] })}>
        Open it on the Files page
      </Button>
    );
  }
  return (
    <li class="lre-stack" data-waiting={w.kind} data-done={w.done ? "true" : undefined}>
      {w.done ? <s>{words}</s> : words}
      {w.done || filingGoes ? null : press}
      {filing === null ? null : <JobFollowLine job={filing} what="The bootstrap job" watched={following} />}
    </li>
  );
}

/** A report in brief: when it read today's data, whether the real run may start on it, and the disk. */
function SummaryView(props: { summary: MigrationSummaryShown; onSave(): void; saving: boolean }) {
  const s = props.summary;
  return (
    <div class="lre-stack">
      <Row k="Read at" v={s.at} />
      {s.disowned.length === 0 ? null : (
        <div class="lre-stack" data-notice="no-runtime">
          {s.disowned.map((line, i) => (
            <p key={i} class="rpe-line">
              {line}
            </p>
          ))}
        </div>
      )}
      <Row k={s.mode === "real run" ? "What did not balance" : "The real run"} v={s.refusals.length === 0 ? (s.mode === "real run" ? "every row balances" : "may start") : counted(s.refusals.length, "reason it won't start", "reasons it won't start")} />
      {s.refusals.length === 0 ? null : (
        <ul class="rpe-reports">
          {s.refusals.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <Row k="Found" v={`${counted(s.counts.items, "thing")} in ${counted(s.counts.rows, "row")}, ${counted(s.counts.chats, "chat")}`} sub={`${s.counts.notClassified} found, not classified; ${s.counts.unreadable} could not be read; ${s.counts.differences} difference(s) from the previous build's fold; ${s.counts.offRpe} chat(s) still off RPE`} />
      <Row k="Disk" v={`${bytesWords(s.disk.total)} in all`} sub={`the backup ${bytesWords(s.disk.backup)}, the import ${bytesWords(s.disk.import)}${s.disk.free === null ? "" : `; ${bytesWords(s.disk.free)} free`}`} />
      {s.backup === null ? null : <Row k="Backup" v={s.backup.path} sub={<code class="rpe-hash">{s.backup.sha256}</code>} />}
      <div class="lre-inline">
        <Button size="sm" variant="ghost" busy={props.saving} onClick={props.onSave}>
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
        <Button size="sm" busy={read.loading} onClick={read.older}>
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
  return <PagedList read={read} label="differences" empty="It matched the previous build's fold everywhere." item={(d) => <DifferenceLine key={`${d.turn}${d.at === "head" ? "" : `${d.at.message}:${d.at.swipe}`}`} d={d} />} />;
}

/** One chat by its name in Lumiverse: what came of it, its check, and the one step that puts it on RPE where it is still off it. */
function ChatLine(props: { chat: MigrationChatShown; of: Of; names: ChatNames; open(chat: string): void }) {
  const c = props.chat;
  const [open, setOpen] = useState(false);
  const imported = c.outcome === "imported" || c.outcome === "replaced";
  const m = c.check?.matched ?? null;
  const clean = m !== null && m.head && c.check?.differences === 0;
  return (
    <li class="lre-stack rpe-migrated" data-chat={c.chat} key={c.chat}>
      <div class="lre-inline rpe-wrap">
        <ChatLabel chat={c.chat} name={c.name} {...(imported ? { onOpen: props.open } : {})} />
        {c.outcome === null ? null : <Badge tone={imported ? (clean ? "pos" : "warn") : undefined}>{c.outcome}</Badge>}
      </div>
      <p class="rpe-line">{`${counted(c.turns, "turn")} over ${counted(c.replies, "reply", "replies")}${c.engine === null ? "" : ` on the ${c.engine} engine`}${c.journal === null ? "" : `; journal ${c.journal}`}`}</p>
      {c.why === null ? null : <p class="rpe-meta">{c.why}</p>}
      {m === null || c.check === null ? null : (
        <p class="rpe-line">
          {counted(c.imported, "turn")} imported · matched at the head: {m.head ? "yes" : "no"}, at {m.swipes} of {m.of} swipes
          {c.shares === null ? null : (
            <>
              {` · shares ${counted(c.shares.messages, "message")} with `}
              <ChatName chat={c.shares.chat} name={props.names(c.shares.chat)} onOpen={props.open} />
            </>
          )}
        </p>
      )}
      {c.offRpe === null ? null : (
        <p class="rpe-line" data-off-rpe={c.offRpe.done ? "on" : "off"}>
          {`When the run read it, this chat was off RPE. Now it is ${offRpeWords(c.offRpe)}`}
        </p>
      )}
      {c.check !== null && c.check.differences > 0 ? (
        <>
          <Button size="sm" variant="ghost" current={open} onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Show"} {counted(c.check.differences, "difference")}
          </Button>
          {open ? <Differences of={props.of} chat={c.chat} /> : null}
        </>
      ) : null}
    </li>
  );
}

function Chats(props: { of: Of; names: ChatNames; open(chat: string): void }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const read = usePaged<MigrationChatShown>((cursor) => app.client.call("GET /api/v1/migration/:of/chats", { of: props.of }, { query: { ...(q.trim() === "" ? {} : { q }), ...(cursor === undefined ? {} : { cursor }) } }), [props.of, q]);
  return (
    <div class="lre-stack">
      <input class="lre-input" type="search" value={q} placeholder="a chat's name or id" onInput={(event) => setQ((event.currentTarget as HTMLInputElement).value)} />
      <PagedList read={read} label="chats" empty={q === "" ? "The report names no chat." : "No chat's name or id holds that."} item={(c) => <ChatLine key={c.chat} chat={c} of={props.of} names={props.names} open={props.open} />} />
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
      <Button size="sm" variant="ghost" current={only} onClick={() => setOnly(!only)}>
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
function ReportLists(props: { of: Of; names: ChatNames; open(chat: string): void }) {
  return (
    <>
      <Section title="Rows" id="rows">
        <Rows of={props.of} />
      </Section>
      <Section title="Chats" id="chats">
        <Chats of={props.of} names={props.names} open={props.open} />
      </Section>
      <Section title="What was found" id="items">
        <Items of={props.of} />
      </Section>
      <Disclosure summary="The report, as printed">
        <PrintedText of={props.of} />
      </Disclosure>
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
  /** Each waiting line with its press; left out, the lines alone. */
  line?: (w: WaitingOnUser) => ComponentChildren;
  /** Going back as its own part of the page draws it; left out, the steps and the permissions. */
  goingBack?: ComponentChildren;
  /** The name the Chats page gives a chat, where the lists show one; left out, each chat is shown by its id. */
  names?: ChatNames;
  /** Opens a chat, as the Chats page does; left out, a chat's name does not open it. */
  open?(chat: string): void;
}) {
  const { shown } = props;
  const names = props.names ?? NO_NAMES;
  const lumiverse = props.folder ?? shown.sources.lumiverse ?? "";
  const rehearsal = shown.rehearsal;
  const both = shown.run !== null && rehearsal.state === "ready";
  return (
    <div class="lre-stack rpe-page" data-page="migration">
      <PageHeader title="Migration" subtitle="A rehearsal over the previous build's data, the last real run, what waits on you, the switch and going back." />
      {shown.offRpe.length === 0 ? null : (
        <Section title={`Chats still off RPE (${shown.offRpe.filter((c) => !c.done).length})`} id="off-rpe">
          <p class="rpe-meta">Each chat was on the previous build and was on none of RPE's connections when the run read it, and each line says where it stands now. A chat pinned to another connection is off RPE until you choose one of RPE's connections for it in Lumiverse. A chat pinned to none follows the connection active for you, so it is on RPE while that is one of RPE's. RPE changes nothing in your chats.</p>
          <ul class="lre-stack rpe-plain">
            {shown.offRpe.map((c) => {
              const line = (
                <>
                  <ChatLabel chat={c.chat} name={names(c.chat)} {...(props.open === undefined ? {} : { onOpen: props.open })} />
                  {`: ${offRpeWords(c)}`}
                </>
              );
              return (
                <li key={c.chat} class="rpe-line" data-chat={c.chat} data-done={c.done ? "true" : undefined}>
                  {c.done ? <s>{line}</s> : line}
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <Section title="A rehearsal" id="rehearsal">
        <p class="rpe-meta">Reads the previous build's data as rpe migrate --rehearse does. It writes nothing: not the previous build's data, not RPE's database. Its report is held here until the next one, or until RPE stops.</p>
        <label class="lre-stack">
          <span class="rpe-meta">Lumiverse's data folder (the one holding lumiverse.db)</span>
          <input class="lre-input" value={lumiverse} placeholder="the folder" onInput={(event) => props.onFolder((event.currentTarget as HTMLInputElement).value)} />
        </label>
        {shown.sources.runtime === null ? <p class="rpe-meta">No runtime of the previous build is read.</p> : <p class="rpe-meta">{`The previous runtime is read from ${shown.sources.runtime.configDir} and ${shown.sources.runtime.dataDir}.`}</p>}
        <Button busy={props.starting || rehearsal.state === "running"} onClick={() => props.onRehearse(lumiverse.trim() === "" ? null : lumiverse.trim())}>
          Start a rehearsal
        </Button>
        {props.said === null ? null : <p class="rpe-line">{props.said}</p>}
        {rehearsal.state === "running" ? <p class="lre-muted rpe-line">Reading the previous build's data…</p> : null}
        {rehearsal.state === "failed" ? <p class="rpe-line">{`The last rehearsal stopped: ${rehearsal.why}`}</p> : null}
        {rehearsal.state === "ready" ? <SummaryView summary={rehearsal.summary} saving={props.saving === "rehearsal"} onSave={() => props.onSave("rehearsal")} /> : null}
      </Section>
      <Section title="The last real run" id="run">
        {shown.run === null ? <p class="rpe-line">No real run of the migration has been made in this data folder yet.</p> : <SummaryView summary={shown.run} saving={props.saving === "run"} onSave={() => props.onSave("run")} />}
      </Section>
      {both ? (
        <div class="lre-inline" data-of={props.of}>
          <Button size="sm" variant="ghost" current={props.of === "run"} onClick={() => props.onOf("run")}>
            Read the last real run
          </Button>
          <Button size="sm" variant="ghost" current={props.of === "rehearsal"} onClick={() => props.onOf("rehearsal")}>
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
            <Row k="Where" v={shown.backup.path} />
            <Row k="Size" v={bytesWords(shown.backup.bytes)} />
            <Row k="SHA-256" v={<code class="rpe-hash">{shown.backup.sha256}</code>} />
            <Row k="Still there, at that size" v={shown.backup.present ? "yes" : "no"} />
          </>
        )}
      </Section>
      <Section title={`Waiting on you (${shown.waiting.filter((w) => !w.done).length})`} id="waiting">
        {shown.waiting.length === 0 ? (
          <p class="lre-muted rpe-line">Nothing is waiting on you.</p>
        ) : (
          <ul class="lre-stack rpe-plain">
            {shown.waiting.map((w, i) =>
              props.line === undefined ? (
                <li key={i} data-waiting={w.kind} data-done={w.done ? "true" : undefined}>
                  {w.done ? <s>{waitingWords(w, names)}</s> : waitingWords(w, names)}
                </li>
              ) : (
                <Fragment key={i}>{props.line(w)}</Fragment>
              ),
            )}
          </ul>
        )}
        {props.offer}
      </Section>
      <Section title="The switch" id="swap">
        <ul class="lre-stack rpe-plain">
          {shown.swap.map((step, i) => (
            <li key={i} class="rpe-line">
              {step}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Going back" id="going-back">
        {props.goingBack ?? (
          <>
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
          </>
        )}
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
  const names = useChatNames();
  const open = (chat: string): void => app.go({ page: "live", chat });
  const shown = summary.value;
  if (shown === null) {
    return (
      <div class="lre-stack rpe-page" data-page="migration">
        <PageHeader title="Migration" subtitle="A rehearsal over the previous build's data, the last real run, what waits on you, the switch and going back." />
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
      lists={has ? <ReportLists key={of} of={of} names={names} open={open} /> : null}
      offer={shown.run === null ? null : <CarriedOffer />}
      line={(w) => <WaitingLine w={w} given={shown.given} onDone={summary.again} names={names} open={open} />}
      names={names}
      open={open}
      goingBack={<GoingBack />}
    />
  );
}

export const entry: PageEntry = { id: "migration", title: "Migration", icon: "download", shells: ["web", "drawer"], needsChat: false, often: false, order: 130, render: () => <MigrationPage /> };
