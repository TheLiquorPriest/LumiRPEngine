// A chat's turns, and one turn (plan §14, Turn): its timings and token counts, each of its runs by its
// own id (a continue runs a turn again) and what each sent to the chat, and behind the spoiler gate its
// intent record, the trace of each run, what each agent's first call was sent, and the turn's folder,
// each file opened on demand; kept up to date while it runs. The Turn page is a list of sections
// (`TURN_SECTIONS`): what later lanes add (the prompt by slice, the changes in each lane, perceptions)
// are sections of their own in that list, behind the gate or not as each says. Both pages offer Settle
// now, the Turn page on the newest turn of the chat's path, which is the turn the settle route takes:
// the Author settles an edit then, and nothing is written to the chat.

import { useEffect, useRef, useState } from "preact/hooks";
import type { CarriedTurnsReply, SettleReply, StageTurn, TurnLoreRow, TurnReply, TurnRow } from "../../../shared/api";
import { useSelect } from "../../store";
import { useApp, useNow } from "../../app";
import { replyOf, type RpeClient, RpeError } from "../../client";
import { Badge, Banner, Button, Empty, Gated, PageHeader, Section } from "../../../frontend/components";
import { type RunNode, runsOf } from "../../live-model";
import { NOTHING_WATCHED, onChatChange, watchTurn, type WatchLimits, type Watched } from "../../live-watch";
import { type NoticeLines, useNoticeLines } from "../../notice-words";
import { replyErrorWords, statusWords, TURN_KIND_WORDS } from "../../trace-view";
import { latestOf, liveTurn } from "../../turn-model";
import { useUiSetting } from "../../ui-settings";
import { counted, duration, errorWords, tokenWords, when } from "../../words";
import type { PageEntry } from "../../page-entry";
import { type JobsReader, type JobsShown, JobsView, NO_JOBS, readJobs } from "../jobs";
import { useRead } from "../../reading";
import { readFolder } from "./folder";
import { type ReviewShown, useReview } from "./review";
import { CarriedRecord, ENGINE_WORDS } from "./sections/carried";
import { TURN_SECTIONS } from "./sections/list";
import { type FolderShown, NO_FOLDER, type RequestShown, type TurnParts, type TurnSection } from "./types";

export { NO_FOLDER, readFolder, TURN_SECTIONS };
export type { FolderShown, OpenShown, RequestShown, TurnParts, TurnSection } from "./types";

/** A turn the migration carried, as the carried route lists it. */
export type CarriedRow = CarriedTurnsReply["turns"][number];

/** What the migration kept of one carried turn, in a line: the engine that played it, why no turn was played, how many lines say something against it. */
export function carriedWords(row: CarriedRow): string {
  const engine = row.engine === null ? "engine not read" : ENGINE_WORDS[row.engine];
  return `carried from the previous build, played by ${engine}${row.unplayed === null ? "" : `; no turn was played: ${row.unplayed}`}${row.departures === 0 ? "" : `; ${counted(row.departures, "line")} say something against its turn`}`;
}

function TurnLine(props: { turn: TurnRow; carried?: CarriedRow | undefined; onOpen: () => void }) {
  const { turn } = props;
  const status = statusWords(turn.kind, turn.status);
  const end = turn.timings.ended ?? turn.timings.released;
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={props.onOpen} data-turn={turn.id}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">
              {TURN_KIND_WORDS[turn.kind]} · {when(turn.timings.received)}
            </span>
            <span class="lre-listrow-sub lre-num">
              {end === null ? "" : `${duration(end - turn.timings.received)} · `}
              {counted(turn.usage.calls, "call")} · {tokenWords(turn.usage)}
            </span>
            {props.carried === undefined ? null : <span class="lre-listrow-sub" data-carried-line>{carriedWords(props.carried)}</span>}
          </span>
          <span class="lre-inline">
            {props.carried === undefined ? null : <Badge title={carriedWords(props.carried)}>carried</Badge>}
            {turn.onPath ? null : <Badge>off the path</Badge>}
            <Badge tone={status.tone}>{status.words}</Badge>
          </span>
        </span>
      </button>
    </li>
  );
}

/** What an old engine recorded on a carried turn, read when it is opened and the spoiler gate is open. */
function CarriedBody(props: { chat: string; turn: string }) {
  const app = useApp();
  const { chat, turn } = props;
  const gate = useSelect(app.gate, (open) => open.has(chat));
  const read = useRead(gate ? () => app.client.call("GET /api/v1/chats/:chat/turns/:turn/carried", { chat, turn }).then(replyOf) : null, [chat, turn, gate]);
  if (!gate) {
    return (
      <Banner tone="gm" icon="eye-off" title="What the old engine recorded is hidden" actions={<Button onClick={() => app.gate.open(chat)}>Show it for this chat</Button>}>
        <span>It can give away what comes next.</span>
      </Banner>
    );
  }
  if (read.problem !== null) return <p class="rpe-line">{read.problem}</p>;
  return read.value === null ? <p class="lre-muted rpe-line">Reading the old record…</p> : <CarriedRecord carried={read.value} />;
}

/** A turn the migration carried that the chat's list of runs does not hold: the engine that played it and why no turn was played; opened, what the old record kept of it. */
function CarriedLine(props: { chat: string; row: CarriedRow }) {
  const { row } = props;
  const [open, setOpen] = useState(false);
  return (
    <li class="lre-listrow">
      <button type="button" class="lre-listrow-hit" onClick={() => setOpen(!open)} data-carried-turn={row.turn} aria-expanded={open}>
        <span class="lre-listrow-content">
          <span class="lre-listrow-text">
            <span class="lre-listrow-title">Message {row.message}, swipe {row.swipe + 1}</span>
            <span class="lre-listrow-sub">
              {carriedWords(row)} · {counted(row.texts, "text")} kept
            </span>
          </span>
          <Badge>carried</Badge>
        </span>
      </button>
      {open ? <CarriedBody chat={props.chat} turn={row.turn} /> : null}
    </li>
  );
}

/** Settle now as a page holds it: a request out, the run it began, or RPE's refusal in its own words. */
export interface SettleShown {
  busy: boolean;
  started: SettleReply | null;
  problem: string | null;
}

export const NO_SETTLE: SettleShown = { busy: false, started: null, problem: null };

/** Asks RPE to settle the newest turn of the chat's path now; `onChange` hears the request go out and what came of it. */
export function settleNow(client: Pick<RpeClient, "call">, chat: string, onChange: (shown: SettleShown) => void): void {
  onChange({ busy: true, started: null, problem: null });
  client.call("POST /api/v1/chats/:chat/settle", { chat }).then(
    (started) => onChange({ busy: false, started, problem: null }),
    (error: unknown) => onChange({ busy: false, started: null, problem: errorWords(error) }),
  );
}

/** The newest turn on the chat's path, the one Settle now settles, read at once; null where the chat has no turn of its own on its path. */
export async function newestOnPath(client: Pick<RpeClient, "call">, chat: string): Promise<Pick<TurnRow, "id" | "status"> | null> {
  try {
    const turn = replyOf(await client.call("GET /api/v1/chats/:chat/newest", { chat }));
    return { id: turn.id, status: turn.status };
  } catch (error) {
    if (error instanceof RpeError && error.status === 404) return null;
    throw error;
  }
}

/** Settle now: the button, disabled while a run of the chat goes on, and what came of the last press. */
export function SettleControl(props: { shown: SettleShown; running: boolean; onSettle(): void }) {
  return (
    <Button size="sm" busy={props.shown.busy} disabled={props.running} title={props.running ? "A run of this chat is going on." : "The Author settles the newest turn's edit now; nothing is written to the chat."} onClick={props.onSettle}>
      Settle now
    </Button>
  );
}

/** What came of the last Settle now: the run it began, or RPE's refusal in its own words. */
export function SettleNotice(props: { shown: SettleShown; onOpen?(turn: string): void }) {
  const { started, problem } = props.shown;
  if (problem !== null) {
    return (
      <Banner tone="neg" icon="alert" title="Not settled">
        <span>{problem}</span>
      </Banner>
    );
  }
  if (started === null) return null;
  const open = props.onOpen;
  return (
    <Banner tone="info" icon="check" title="A settle run began" actions={open === undefined ? undefined : <Button onClick={() => open(started.turn)}>Watch it</Button>}>
      <span>
        Run {started.run} on turn {started.turn}. It writes nothing to the chat.
      </span>
    </Banner>
  );
}

export interface TurnsViewProps {
  turns: readonly TurnRow[];
  more: boolean;
  loading: boolean;
  /** The chat the list is of, where it lists carried turns that open in place. */
  chat?: string;
  problem: string | null;
  /** How many turns of this chat the last migration carried from today's build; null where it carried none, or that is not known. */
  carried?: number | null;
  /** The turns the migration carried into this chat, each as the carried route lists it. */
  carriedTurns?: readonly CarriedRow[];
  settle?: { shown: SettleShown; onSettle(): void };
  /** The chat's jobs, with Cancel. */
  jobs?: { shown: JobsShown; onCancel(job: string): void };
  onOpen(turn: string): void;
  onMore(): void;
}

export function TurnsView(props: TurnsViewProps) {
  const { settle } = props;
  const running = props.turns.some((turn) => turn.status === "running");
  const carried = props.carried ?? null;
  const carriedById = new Map((props.carriedTurns ?? []).map((row) => [row.turn, row] as const));
  const listed = new Set(props.turns.map((t) => t.id));
  // Older turns of the list may yet hold some of them: the rest are listed once the list has been read to its oldest.
  const unlisted = props.more || props.chat === undefined ? [] : (props.carriedTurns ?? []).filter((row) => !listed.has(row.turn));
  return (
    <div class="lre-stack rpe-page" data-page="turns">
      <PageHeader title="Turns" subtitle="Every turn RPE has played in this chat, newest first." actions={settle === undefined || (props.turns.length === 0 && carried === null) ? undefined : <SettleControl shown={settle.shown} running={running} onSettle={settle.onSettle} />} />
      {settle === undefined ? null : <SettleNotice shown={settle.shown} onOpen={props.onOpen} />}
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The turns could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {props.turns.length === 0 ? (
        props.loading ? (
          <p class="lre-muted rpe-line">Reading this chat's turns…</p>
        ) : props.problem === null ? (
          <Empty icon="list" title="No turn played on RPE yet">
            <span>A turn shows here once RPE plays a reply in this chat.</span>
            {carried === null ? null : <span>The migration carried {counted(carried, "turn")} of it from the previous build: they made its world, cast and story as they stand{unlisted.length > 0 ? ", and each is listed below." : ", and are not runs of RPE's, so none is listed here."}</span>}
          </Empty>
        ) : null
      ) : (
        <div class="lre-section flush">
          <ul class="lre-section-body lre-rowlist rpe-turns">
            {props.turns.map((turn) => (
              <TurnLine key={turn.id} turn={turn} carried={carriedById.get(turn.id)} onOpen={() => props.onOpen(turn.id)} />
            ))}
          </ul>
        </div>
      )}
      {unlisted.length === 0 ? null : (
        <Section id="carried" title="Carried from the previous build">
          <p class="rpe-meta">Turns the migration carried that RPE holds no run of: each opens to what the old engine recorded of it.</p>
          <ul class="lre-rowlist" data-carried-turns>
            {unlisted.map((row) => (
              <CarriedLine key={row.turn} chat={props.chat ?? ""} row={row} />
            ))}
          </ul>
        </Section>
      )}
      {props.more ? (
        <Button busy={props.loading} onClick={props.onMore}>
          Older turns
        </Button>
      ) : null}
      {props.jobs === undefined ? null : <JobsView shown={props.jobs.shown} everyChat={false} onCancel={props.jobs.onCancel} />}
    </div>
  );
}

/** A chat's turns as read so far, newest first. */
export interface TurnsRead {
  turns: TurnRow[];
  /** Older turns remain to be read. */
  more: boolean;
  loading: boolean;
  problem: string | null;
}

/**
 * The newest page of a chat's turns put in front of those held: a turn run again since moves up, and what was read further back
 * stays. A page that does not reach back to the turns held (more turns came meanwhile than a page holds) leaves a gap between
 * them, so it stands alone, and older turns are read from it.
 */
export function withNewest(held: TurnsRead, page: { turns: readonly TurnRow[]; more: boolean }): Pick<TurnsRead, "turns" | "more"> {
  const oldest = page.turns.at(-1);
  const reached = oldest === undefined ? -1 : held.turns.findIndex((t) => t.id === oldest.id);
  if (!page.more || reached < 0) return { turns: [...page.turns], more: page.more };
  const fresh = new Set(page.turns.map((t) => t.id));
  const tail = held.turns.slice(reached + 1).filter((t) => !fresh.has(t.id));
  return { turns: [...page.turns, ...tail], more: tail.length === 0 ? page.more : held.more };
}

/**
 * Reads a chat's turns, newest first, older ones on `more()`, and the newest again on `refresh()`, merged in front of those held
 * (`withNewest`) so the list never empties while it reads. Every answer is for this chat alone: once `stop()` is called (the page
 * has left the chat), what comes back is let go.
 */
export function readTurns(client: Pick<RpeClient, "call">, chat: string, limit: number, onChange: (read: TurnsRead) => void): { more(): void; refresh(): void; stop(): void } {
  let read: TurnsRead = { turns: [], more: false, loading: true, problem: null };
  let alive = true;
  const show = (next: Partial<TurnsRead>): void => {
    if (!alive) return;
    read = { ...read, ...next };
    onChange(read);
  };
  const page = async (before: string | undefined) => replyOf(await client.call("GET /api/v1/chats/:chat/turns", { chat }, { query: { limit, ...(before === undefined ? {} : { before }) } }));
  /** `first`: the first read, the one `loading` waits for before any turn is held. */
  const newest = (first: boolean): void => {
    page(undefined).then(
      (list) => show({ ...withNewest(read, list), problem: null, ...(first ? { loading: false } : {}) }),
      (error: unknown) => show({ problem: errorWords(error), ...(first ? { loading: false } : {}) }),
    );
  };
  // A page moving to this chat shows it as unread at once, not the last chat's turns.
  onChange(read);
  newest(true);
  return {
    more() {
      const last = read.turns.at(-1);
      if (read.loading || last === undefined) return;
      show({ loading: true, problem: null });
      page(last.id).then(
        (list) => {
          // A refresh may have come back meanwhile: the older turns go after whatever is held now.
          const held = new Set(read.turns.map((t) => t.id));
          show({ turns: [...read.turns, ...list.turns.filter((t) => !held.has(t.id))], more: list.more, loading: false, problem: null });
        },
        (error: unknown) => show({ loading: false, problem: errorWords(error) }),
      );
    },
    refresh() {
      newest(false);
    },
    stop() {
      alive = false;
    },
  };
}

/** Every turn the migration carried into a chat, its pages read one after another to the end. */
export async function readCarried(client: Pick<RpeClient, "call">, chat: string, limit: number): Promise<{ rows: CarriedRow[]; total: number }> {
  const rows: CarriedRow[] = [];
  for (;;) {
    const page = await client.call("GET /api/v1/chats/:chat/carried", { chat }, { query: { from: rows.length, limit } });
    rows.push(...page.turns);
    if (!page.more || page.turns.length === 0) return { rows, total: page.total };
  }
}

export function TurnsPage(props: { chat: string }) {
  const app = useApp();
  const { chat } = props;
  const turnsAtATime = useUiSetting("turnsAtATime");
  const [read, setRead] = useState<TurnsRead>({ turns: [], more: false, loading: true, problem: null });
  const [settle, setSettle] = useState<SettleShown>(NO_SETTLE);
  // The turns a migration carried into the chat, read to the end: each marks its row in the list, and the rest are listed after it. A chat none was carried into answers none.
  const carriedRead = useRead(() => readCarried(app.client, chat, turnsAtATime), [chat]);
  const reader = useRef<{ more(): void } | null>(null);
  const [jobs, setJobs] = useState<JobsShown>(NO_JOBS);
  const jobsReader = useRef<JobsReader | null>(null);
  useEffect(() => {
    setSettle(NO_SETTLE);
    setJobs(NO_JOBS);
    const reading = readTurns(app.client, chat, turnsAtATime, setRead);
    reader.current = reading;
    const jobsReading = readJobs(app.client, chat, setJobs);
    jobsReader.current = jobsReading;
    // A run that begins or ends changes the list, whether Settle now can be pressed, and how the chat's jobs stand: they are read again then.
    const off = onChatChange(app.client, chat, () => {
      reading.refresh();
      jobsReading.refresh();
    });
    return () => {
      off();
      reading.stop();
      jobsReading.stop();
    };
  }, [chat, turnsAtATime]);
  const total = carriedRead.value?.total ?? 0;
  return (
    <TurnsView
      {...read}
      chat={chat}
      carried={total > 0 ? total : null}
      carriedTurns={carriedRead.value?.rows ?? []}
      settle={{ shown: settle, onSettle: () => settleNow(app.client, chat, setSettle) }}
      jobs={{ shown: jobs, onCancel: (job) => jobsReader.current?.cancel(job) }}
      onOpen={(turn) => app.go({ page: "turns", chat, at: [turn] })}
      onMore={() => reader.current?.more()}
    />
  );
}

function SectionsOf(props: { parts: TurnParts; sections: readonly TurnSection[] }) {
  return (
    <>
      {props.sections.map((section) => {
        const body = section.body(props.parts);
        return body === null ? null : (
          <Section key={section.id} id={section.id} title={section.title}>
            {body}
          </Section>
        );
      })}
    </>
  );
}

export interface TurnViewProps {
  turn: TurnReply;
  /** Its runs, the first first: more than one when it was continued. */
  runs: readonly RunNode[];
  now: number;
  /** What a later read could not read, in RPE's words; null when all was. */
  problem: string | null;
  gateOpen: boolean;
  /** The turn's folder, read once the spoiler gate is open. */
  folder: FolderShown;
  onOpenGate(): void;
  onCloseGate(): void;
  onBack(): void;
  onLive(): void;
  onRead(): void;
  onOpenFile(name: string): void;
  /** The notices file's words, for the records of a run's trace that are notices. */
  notices?: NoticeLines;
  /** The lead's first request, rebuilt as it was sent, read once the spoiler gate is open; null until read. */
  lead?: RequestShown | null;
  /** The lore Lumiverse activated for the turn's prompt, entry by entry; null until read. */
  loreRows?: readonly TurnLoreRow[] | null;
  /** Who was on stage for the turn and who has a perception of it; null until read. */
  stage?: StageTurn | null;
  /** The turn's review card and, for a turn carried in, the record an old engine kept; read once the gate is open. */
  review?: ReviewShown;
  onOpenQuest?(id: string): void;
  onOpenRequest(name: string, held: string | null): void;
  onCloseFile(): void;
  sections?: readonly TurnSection[];
  /** Settle now, where this turn is the newest on the chat's path: what came of the last press, and whether a run of the chat goes on. */
  settle?: { shown: SettleShown; running: boolean; onSettle(): void };
}

export function TurnView(props: TurnViewProps) {
  const { turn, settle } = props;
  const sections = props.sections ?? TURN_SECTIONS;
  // How it stands is its latest run's: a settle run's ending with no reply is how it is meant to end.
  const kind = turn.runs.at(-1)?.kind ?? turn.kind;
  const status = statusWords(kind, turn.status);
  const failure = turn.error === null || (kind === "settle" && turn.status === "no-reply") ? null : replyErrorWords(turn.error, turn.status);
  const parts: TurnParts = { turn, runs: props.runs, now: props.now, folder: props.folder, notices: props.notices, lead: props.lead, loreRows: props.loreRows, stage: props.stage, review: props.review, onOpenQuest: props.onOpenQuest, onOpenFile: props.onOpenFile, onOpenRequest: props.onOpenRequest, onCloseFile: props.onCloseFile };
  return (
    <div class="lre-stack rpe-page" data-page="turn" data-turn={turn.id}>
      <PageHeader
        title={`${TURN_KIND_WORDS[turn.kind]}, ${when(turn.timings.received)}`}
        subtitle={
          <span class="lre-inline">
            <span class={`lre-badge ${status.tone}`}>{status.words}</span>
            {turn.onPath ? null : <span class="lre-badge">off the path</span>}
            {turn.message !== null ? <span class="lre-id">message {turn.message}</span> : turn.status === "running" || turn.timings.released !== null ? <span>not tied to a message yet</span> : <span>no message</span>}
          </span>
        }
        onBack={props.onBack}
        backLabel="the turns"
        actions={
          <>
            {settle === undefined ? null : <SettleControl shown={settle.shown} running={settle.running} onSettle={settle.onSettle} />}
            {turn.status === "running" ? (
              <Button size="sm" onClick={props.onLive}>
                Watch it live
              </Button>
            ) : (
              <Button size="sm" variant="ghost" onClick={props.onRead}>
                Read again
              </Button>
            )}
          </>
        }
      />
      {settle === undefined ? null : <SettleNotice shown={settle.shown} />}
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Part of this turn could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {failure === null ? null : (
        <Banner tone="neg" icon="alert" title="Why it ended">
          <span>{failure}</span>
        </Banner>
      )}
      <SectionsOf parts={parts} sections={sections.filter((s) => !s.spoiler)} />
      <Gated open={props.gateOpen} onOpen={props.onOpenGate} onClose={props.onCloseGate}>
        <SectionsOf parts={parts} sections={sections.filter((s) => s.spoiler)} />
      </Gated>
    </div>
  );
}

/** One turn, kept up to date while it runs, and while a continue runs it again; its folder is read once the spoiler gate is open. */
export function TurnPage(props: { chat: string; turn: string }) {
  const app = useApp();
  const { chat, turn } = props;
  const [watched, setWatched] = useState<Watched>(NOTHING_WATCHED);
  const [reads, setReads] = useState(0);
  const [folder, setFolder] = useState<FolderShown>(NO_FOLDER);
  const reader = useRef<{ open(name: string): void; openRequest(name: string, held: string | null): void; close(): void } | null>(null);
  const gateOpen = useSelect(app.gate, (opened) => opened.has(chat));
  const [newest, setNewest] = useState<Pick<TurnRow, "id" | "status"> | null>(null);
  const [settle, setSettle] = useState<SettleShown>(NO_SETTLE);
  const notices = useNoticeLines(chat);
  // What the watch is held to is read when it is used, so a setting changed meanwhile holds at once.
  const limits = useRef<WatchLimits>({ renderMs: 0, keepRuns: 0, keepFailures: 0 });
  limits.current = { renderMs: useUiSetting("redrawMs"), keepRuns: useUiSetting("keepRuns"), keepFailures: useUiSetting("keepFailures") };
  useEffect(() => {
    setWatched(NOTHING_WATCHED);
    return watchTurn(app.client, chat, turn, app.timers, setWatched, () => limits.current);
  }, [chat, turn, reads]);
  useEffect(() => {
    setSettle(NO_SETTLE);
    setNewest(null);
    // Which turn is the newest on the chat's path, and whether a run of it goes on: Settle now is offered on that turn alone. Read again when a run begins or ends.
    let alive = true;
    const read = (): void => {
      newestOnPath(app.client, chat).then(
        (found) => {
          if (alive) setNewest(found);
        },
        () => undefined,
      );
    };
    read();
    const off = onChatChange(app.client, chat, read);
    return () => {
      alive = false;
      off();
    };
  }, [chat, turn]);
  useEffect(() => {
    setFolder(NO_FOLDER);
    if (!gateOpen) return;
    const reading = readFolder(app.client, chat, turn, setFolder);
    reader.current = reading;
    return () => {
      reading.stop();
      reader.current = null;
    };
  }, [chat, turn, reads, gateOpen]);
  // What the prompt's slices are made of: the lead's first request as it was sent, and the entries Lumiverse activated; read once the gate is open.
  const firstRun = watched.detail?.runs[0];
  const leadFile = firstRun?.requests[0]?.file ?? null;
  const leadHeld = firstRun?.held ?? turn;
  const lead = useRead(
    gateOpen && leadFile !== null
      ? async () => {
          const { same, messages, tools } = replyOf(await app.client.call("GET /api/v1/chats/:chat/turns/:turn/requests/*", { chat, turn: leadHeld, "*": leadFile as string }));
          return { same, messages, tools };
        }
      : null,
    [chat, turn, leadHeld, leadFile, gateOpen],
  );
  const loreRead = useRead(gateOpen ? async () => replyOf(await app.client.call("GET /api/v1/chats/:chat/turns/:turn/lore", { chat, turn })).entries : null, [chat, turn, gateOpen, reads]);
  const stageRead = useRead(async () => replyOf(await app.client.call("GET /api/v1/chats/:chat/perceptions", { chat }, { query: { turn, count: 1 } })).turns.at(-1) ?? null, [chat, turn, reads]);
  const review = useReview(chat, turn, watched.detail?.carried != null, gateOpen, reads, () => setReads((n) => n + 1));
  const runs = runsOf(watched.model, turn);
  const latest = watched.detail === null ? runs.at(-1) : latestOf(watched.detail, runs);
  const detail = watched.detail === null ? null : liveTurn(watched.detail, latest);
  const now = useNow(detail?.status === "running");
  const back = (): void => app.go({ page: "turns", chat });
  if (detail === null) {
    return (
      <div class="lre-stack rpe-page" data-page="turn">
        <PageHeader title="Turn" onBack={back} backLabel="the turns" />
        {watched.problem === null ? (
          <p class="lre-muted rpe-line">Reading the turn…</p>
        ) : (
          <Banner tone="neg" icon="alert" title="The turn could not be read" actions={<Button onClick={() => setReads((n) => n + 1)}>Try again</Button>}>
            <span>{watched.problem}</span>
          </Banner>
        )}
      </div>
    );
  }
  return (
    <TurnView
      turn={detail}
      runs={runs}
      now={Math.max(now, latest?.lastAt ?? 0)}
      problem={watched.problem}
      gateOpen={gateOpen}
      folder={folder}
      notices={notices}
      lead={lead.value}
      loreRows={loreRead.value}
      stage={stageRead.value}
      review={review}
      onOpenQuest={(id) => app.go({ page: "quests", chat, at: [id] })}
      onOpenGate={() => app.gate.open(chat)}
      onCloseGate={() => app.gate.close(chat)}
      onBack={back}
      onLive={() => app.go({ page: "live", chat })}
      onRead={() => setReads((n) => n + 1)}
      onOpenFile={(name) => reader.current?.open(name)}
      onOpenRequest={(name, held) => reader.current?.openRequest(name, held)}
      onCloseFile={() => reader.current?.close()}
      settle={
        newest?.id !== turn
          ? undefined
          : {
              shown: settle,
              running: newest.status === "running",
              onSettle: () =>
                settleNow(app.client, chat, (shown) => {
                  setSettle(shown);
                  // The settle run is the turn's latest run: the page reads the turn again to follow it.
                  if (shown.started !== null) setReads((n) => n + 1);
                }),
            }
      }
    />
  );
}

/** The Turns page: the chat's turns, and a turn's own page as its inner place (`at: [turn]`), which is part of its address. */
export const entry: PageEntry = {
  id: "turns",
  title: "Turns",
  icon: "list",
  shells: ["web", "drawer"],
  needsChat: true,
  often: true,
  order: 30,
  render: (route) => {
    const turn = route.at?.[0];
    return turn === undefined ? <TurnsPage chat={route.chat} /> : <TurnPage chat={route.chat} turn={turn} />;
  },
};
