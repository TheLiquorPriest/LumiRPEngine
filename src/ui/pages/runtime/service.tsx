// How RPE runs (plan §4.4 the `service` group, §14 Runtime): under its service unit or started by hand, since when,
// the addresses it listens on, the build it runs and whether its service put the known-good copy back; the memory it
// holds now, at its highest and against its service's limit; a Restart that waits for the turns and jobs running and
// says so; and the lines only the server's own command line runs, to copy. Everything is in the route's words; nothing
// here decides whether RPE may restart.

import type { ComponentChildren } from "preact";
import type { BuildsStatus, RestartState, ServiceHow, ServiceMemory } from "../../../shared/api";
import { Badge, Banner, Button, Row, Section } from "../../../frontend/components";
import { bytesWords, counted, duration, when } from "../../words";
import type { RpeClient } from "../../client";
import type { Timers } from "../../roads";
import { SettingName } from "../settings/names";

export interface RestartShown {
  busy: boolean;
  /** What the restart answered: where it stands, in RPE's words. */
  answer: BuildsStatus | null;
  problem: string | null;
  /** Set once RPE has answered the restart and is not back yet: the page waits for it, and reads it again at each poll. */
  waiting?: true;
  /** Set once RPE answers again on a process that started after the restart: the build it runs, and how long it was from the press to that answer. */
  back?: { build: string; tookMs: number };
}

export const NO_RESTART: RestartShown = { busy: false, answer: null, problem: null };

/**
 * Waits for RPE to come back after a restart: asks how RPE runs every `poll.every` (a read that fails while RPE is down is tried again), and when the
 * process that answers started after `since` (the one the press was made against) says which build it runs and how long it took from the press.
 * The returned function stops the waiting.
 */
export function watchRestart(client: Pick<RpeClient, "call">, since: number, pressed: number, poll: { every: number; timers: Timers }, onBack: (back: { build: string; tookMs: number }) => void): () => void {
  let alive = true;
  let timer: unknown = null;
  const later = (): void => {
    if (alive) timer = poll.timers.setTimeout(look, poll.every);
  };
  const look = (): void => {
    timer = null;
    client.call("GET /api/v1/service", {}).then(
      (how) => {
        if (!alive) return;
        // The process pressed against answers for as long as it waits for the turns and jobs running: only one that started later is the restarted one.
        if (how.since > since + 1000) onBack({ build: how.build, tookMs: poll.timers.now() - pressed });
        else later();
      },
      later,
    );
  };
  later();
  return () => {
    alive = false;
    if (timer !== null) poll.timers.clearTimeout(timer);
  };
}

/** Where a restart stands, in a line. */
export const RESTART_WORDS: Readonly<Record<RestartState, ComponentChildren>> = {
  none: "Nothing is waiting for a restart.",
  waiting: "A restart is waiting for the turns and jobs running to end.",
  restarting: "RPE is restarting now.",
  off: (
    <>
      A restart is needed to take the build on disk, and <SettingName settingKey="update.restart" /> is off.
    </>
  ),
  "by hand": "A restart is needed, and RPE was started by hand: nothing starts it again.",
};

/** The lines only the server's own command line runs. */
export const SERVER_LINES: readonly { line: string; about: string }[] = [
  { line: "rpe up --systemd", about: "Installs RPE as a service of your account, or takes the update into the one running." },
  { line: "rpe down", about: "Stops RPE." },
  { line: "rpe allow <name>", about: "Lets a hook, a rule's command, a tool or a server that runs a command or calls out run (Settings lists what waits)." },
];

/** Restart is offered where RPE runs as a service that starts again, and none is under way. */
export function canRestart(how: ServiceHow): boolean {
  return how.runs === "service" && how.restart !== "waiting" && how.restart !== "restarting";
}

export interface ServiceViewProps {
  how: ServiceHow | null;
  problem: string | null;
  restart: RestartShown;
  onRestart(): void;
}

export function ServiceView(props: ServiceViewProps) {
  const { how, restart } = props;
  return (
    <Section id="service" title="How RPE runs" aside={how !== null && canRestart(how) ? <Button size="sm" busy={restart.busy} onClick={props.onRestart}>Restart</Button> : undefined}>
      {props.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="How RPE runs could not be read">
          <span>{props.problem}</span>
        </Banner>
      )}
      {restart.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not restarted">
          <span>{restart.problem}</span>
        </Banner>
      )}
      {restart.answer === null || restart.back !== undefined ? null : (
        <Banner tone="info" icon="refresh" title="Restart">
          <span data-restart>{restart.answer.words}</span>
          {restart.waiting === true && restart.back === undefined ? <p class="lre-muted rpe-line" data-restart-waiting>Waiting for RPE to answer again…</p> : null}
        </Banner>
      )}
      {restart.back === undefined ? null : (
        <Banner tone="info" icon="check" title="RPE is back">
          <span data-restart-back>
            RPE is back on build {restart.back.build}; the restart took {duration(restart.back.tookMs)}.
          </span>
        </Banner>
      )}
      {how === null ? (
        props.problem === null ? <p class="lre-muted rpe-line">Reading how RPE runs…</p> : null
      ) : (
        <>
          {how.fellBack === null ? null : (
            <Banner tone="warn" icon="alert" title="The known-good copy was put back">
              <span data-fell-back>{how.fellBack}</span>
            </Banner>
          )}
          <Row
            k="RPE runs"
            v={how.runs === "service" ? <span>as a service <code>{how.unit}</code></span> : <Badge tone="warn">started by hand</Badge>}
            sub={`since ${when(how.since)}`}
          />
          <Row k="Its build" v={<code>{how.build}</code>} />
          <Row k="It listens on" v={<span data-listens>{how.listens.map((a) => <code key={a} class="lre-id"> {a}</code>)}</span>} />
          <MemoryRows memory={how.memory} />
          <p class="rpe-line" data-restart-state>
            {RESTART_WORDS[how.restart]}
            {how.runs === "by hand" ? " Restart is not offered: nothing starts RPE again once it stops." : ""}
          </p>
        </>
      )}
      <div class="lre-stack" data-server-lines>
        <p class="rpe-meta">What only the server's own command line does, with the line to run there:</p>
        <ul class="rpe-plain lre-stack">
          {SERVER_LINES.map((l) => (
            <li key={l.line} class="rpe-meta">
              <code>{l.line}</code> {l.about}
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/** What RPE holds now, and against its service's limit where it runs as a service whose count can be read. */
function MemoryRows(props: { memory: ServiceMemory }) {
  const { holds, peak, threads, service } = props.memory;
  return (
    <>
      <Row k="Memory it holds" v={<span data-memory>{bytesWords(holds)}</span>} sub={`at most ${bytesWords(peak)} since it started; ${counted(threads, "worker thread")} running`} />
      {service === null ? null : (
        <Row
          k="Against its service's limit"
          v={<span data-memory-limit>{service.limit === null ? `${bytesWords(service.holds)}, with no limit` : `${bytesWords(service.holds)} of ${bytesWords(service.limit)}`}</span>}
          sub={service.peak === null ? undefined : `at most ${bytesWords(service.peak)}`}
        />
      )}
      <p class="rpe-meta" data-memory-about>
        {service === null ? "" : "The service's count takes in the pages of the files RPE wrote that the system keeps in memory, and the system gives them back before the limit is reached. "}
        You change the limit with <code>rpe up --memory</code>; the service holds to it from the next <code>rpe up --systemd</code>. A worker thread with nothing to do ends after a while and lets its memory go: how long is on the Settings page, under Worker threads.
      </p>
    </>
  );
}
