// How RPE runs (plan §4.4 the `service` group, §14 Runtime): under its service unit or started by hand, since when,
// the addresses it listens on, the build it runs and whether its service put the known-good copy back; a Restart
// that waits for the turns and jobs running and says so; and the lines only the server's own command line runs,
// to copy. Everything is in the route's words; nothing here decides whether RPE may restart.

import type { BuildsStatus, RestartState, ServiceHow } from "../../../shared/api";
import { Badge, Banner, Button, Row, Section } from "../../../frontend/components";
import { when } from "../../words";

export interface RestartShown {
  busy: boolean;
  /** What the restart answered: where it stands, in RPE's words. */
  answer: BuildsStatus | null;
  problem: string | null;
}

export const NO_RESTART: RestartShown = { busy: false, answer: null, problem: null };

/** Where a restart stands, in a line. */
export const RESTART_WORDS: Readonly<Record<RestartState, string>> = {
  none: "Nothing is waiting for a restart.",
  waiting: "A restart is waiting for the turns and jobs running to end.",
  restarting: "RPE is restarting now.",
  off: "A restart is needed to take the build on disk, and update.restart is off.",
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
      {restart.answer === null ? null : (
        <Banner tone="info" icon="refresh" title="Restart">
          <span data-restart>{restart.answer.words}</span>
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
