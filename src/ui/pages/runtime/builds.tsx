// The builds line on Runtime (plan §4.6): which build RPE runs, which its app file on disk is, and which
// the extension in Lumiverse said it is, in the status's own words; the newest update stage by stage, from
// its arrival through its check and its start to the restart onto it, read again while one goes on, and a
// refused one shown with the build that goes on running; and "Update now", always there: it takes a new
// build that has passed its checks, or says there is none, or why the last one was refused.
//
// And, in the web shell, what this browser signs in with (the session route): the session it holds and when it ends, which the page renews
// while it is open, and the web key, which has no end unless a setting gives it one. The drawer's page token is renewed by the extension as it
// runs out, so its end is nothing the player acts on, and the drawer does not show it.

import type { ComponentChildren } from "preact";
import type { BuildsReply, BuildsStatus, RestartState, SessionReply, UpdateStage } from "../../../shared/api";
import { Badge, Banner, Button, Row, Section, type Tone } from "../../../frontend/components";
import type { RpeClient } from "../../client";
import type { Timers } from "../../roads";
import { errorWords, when } from "../../words";
import { SettingName } from "../settings/names";

export interface BuildsShown {
  reply: BuildsReply | null;
  loading: boolean;
  problem: string | null;
  updating: boolean;
  /** What "Update now" answered: where the builds stand after it. */
  updated: BuildsStatus | null;
  updateProblem: string | null;
}

export const NO_BUILDS: BuildsShown = { reply: null, loading: true, problem: null, updating: false, updated: null, updateProblem: null };

export interface BuildsReader {
  update(): void;
  stop(): void;
}

/** How the builds are read again while an update goes through its stages: every `every` milliseconds (`pages.jobPollMs`). */
export interface BuildsPoll {
  every: number;
  timers: Pick<Timers, "setTimeout" | "clearTimeout">;
}

/** Whether an update is on its way: a stage under way, or a restart onto it waiting or going. */
export function updating(builds: BuildsStatus): boolean {
  return builds.restart === "waiting" || builds.restart === "restarting" || builds.update?.stages.some((s) => s.state === "going" && s.stage !== "restart") === true;
}

/**
 * Reads the builds, and again every `poll.every` while an update is on its way, so each stage shows as it comes (a read that fails while RPE
 * restarts is tried again until the new build answers); "Update now" posts and shows its answer as the builds now stand.
 */
export function readBuilds(client: Pick<RpeClient, "call">, onChange: (shown: BuildsShown) => void, poll?: BuildsPoll): BuildsReader {
  let shown = NO_BUILDS;
  let alive = true;
  let timer: unknown = null;
  const show = (next: Partial<BuildsShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  const again = (builds: BuildsStatus | undefined): void => {
    if (!alive || poll === undefined || timer !== null || builds === undefined || !updating(builds)) return;
    timer = poll.timers.setTimeout(() => {
      timer = null;
      read();
    }, poll.every);
  };
  const read = (): void => {
    client.call("GET /api/v1/status/builds", {}).then(
      (reply) => {
        show({ reply, loading: false, problem: null });
        again(reply.builds);
      },
      (error: unknown) => {
        show({ loading: false, problem: errorWords(error) });
        again(shown.reply?.builds);
      },
    );
  };
  read();
  return {
    update() {
      if (shown.updating) return;
      show({ updating: true, updateProblem: null });
      client.call("POST /api/v1/update", {}).then(
        (builds) => {
          show({ updating: false, updated: builds, reply: shown.reply === null ? null : { ...shown.reply, builds } });
          again(builds);
        },
        (error: unknown) => show({ updating: false, updateProblem: errorWords(error) }),
      );
    },
    stop() {
      alive = false;
      if (timer !== null) poll?.timers.clearTimeout(timer);
    },
  };
}

/** Each stage of an update as the page names it. */
const STAGE_WORDS: Readonly<Record<UpdateStage["stage"], string>> = {
  arrived: "Arrived",
  checked: "Its files checked against what was stated for them",
  started: "Started for real on a scratch copy of RPE's data",
  restart: "Restart onto it",
};

/** Where an update stopped, as "Update now" says it. */
const STOPPED_AT: Readonly<Record<UpdateStage["stage"], string>> = { arrived: "its arrival", checked: "its check", started: "its start", restart: "its restart" };

const STATE_WORDS: Readonly<Record<UpdateStage["state"], string>> = { going: "under way", done: "passed", refused: "refused" };
const STATE_TONE: Readonly<Record<UpdateStage["state"], Tone>> = { going: "accent", done: "pos", refused: "neg" };

/** What the restart onto a build that has passed its checks waits for, while it waits. */
const RESTART_WORDS: Readonly<Record<RestartState, ComponentChildren>> = {
  none: null,
  waiting: "waits for the turns and jobs running to end",
  restarting: "restarting now",
  off: (
    <>
      waits for Update now: <SettingName settingKey="update.restart" /> is off
    </>
  ),
  "by hand": "RPE was started by hand, so nothing starts it again: stop it and start it again",
};

/** What "Update now" did, in a sentence: the restart onto a new build that has passed its checks, or that there is none, or why the last one was refused. */
export function updateAnswer(builds: BuildsStatus): string {
  if (builds.broken !== null) {
    const at = builds.update?.stages.find((s) => s.state === "refused")?.stage;
    return `There is no new build to take: the last one was refused${at === undefined ? "" : ` at ${STOPPED_AT[at]}`} (${builds.broken}). RPE runs build ${builds.running}, as it did.`;
  }
  if (builds.disk !== null && builds.disk !== builds.running) return builds.words;
  return `There is no new build that has passed its checks: RPE runs build ${builds.running}.`;
}

/** The newest update, stage by stage, and, where it was refused, that the running build stays as it was. */
export function UpdateStages(props: { builds: BuildsStatus }) {
  const { update, running, restart } = props.builds;
  if (update === null) return null;
  const refused = update.stages.some((s) => s.state === "refused");
  return (
    <div class="lre-stack" data-update="stages">
      <p class="rpe-line">{update.build === null ? "The newest update" : <>The update to build <code>{update.build}</code></>}</p>
      {update.stages.map((s) => {
        const waits = s.stage === "restart" && s.state === "going" ? RESTART_WORDS[restart] : null;
        return (
          <div key={s.stage} data-stage={s.stage} data-state={s.state}>
            <Row k={STAGE_WORDS[s.stage]} v={<Badge tone={STATE_TONE[s.state]}>{waits ?? STATE_WORDS[s.state]}</Badge>} sub={s.why === null ? `since ${when(s.at)}` : `${when(s.at)}: ${s.why}`} />
          </div>
        );
      })}
      {refused ? (
        <p class="rpe-line" data-update="kept">
          The refused file changed nothing: RPE goes on running build <code>{running}</code>.
        </p>
      ) : null}
    </div>
  );
}

export function BuildsView(props: { shown: BuildsShown; onUpdate(): void }) {
  const { shown } = props;
  const builds = shown.reply?.builds ?? null;
  return (
    <Section
      id="builds"
      title="Builds"
      aside={
        <Button size="sm" busy={shown.updating} onClick={props.onUpdate}>
          Update now
        </Button>
      }
    >
      {shown.problem === null ? null : (
        <Banner tone="neg" icon="alert" title="The builds could not be read">
          <span>{shown.problem}</span>
        </Banner>
      )}
      {shown.updateProblem === null ? null : (
        <Banner tone="neg" icon="alert" title="Not updated">
          <span>{shown.updateProblem}</span>
        </Banner>
      )}
      {shown.updated === null ? null : (
        <Banner tone="info" icon="refresh" title="Update now">
          <span>{updateAnswer(shown.updated)}</span>
        </Banner>
      )}
      {shown.reply === null || builds === null ? (
        shown.loading ? (
          <p class="lre-muted rpe-line">Reading the builds…</p>
        ) : null
      ) : (
        <>
          {shown.updated === null ? <p class="rpe-line">{builds.words}</p> : null}
          <Row k="RPE runs" v={<code>{builds.running}</code>} sub={`since ${when(shown.reply.started)}`} />
          <Row k="Its app file on disk" v={builds.disk === null ? (builds.broken ?? "gives no build") : <code>{builds.disk}</code>} />
          <Row k="The extension in Lumiverse" v={builds.extension === null ? "has not said yet" : <code>{builds.extension}</code>} />
          <UpdateStages builds={builds} />
        </>
      )}
    </Section>
  );
}

/** Reads what the page holds to sign in with, once: `onSession` hears it. A refused read leaves the lines out: a key RPE no longer takes signs the web shell out on its own. The returned function lets the answer go. */
export function readSession(client: Pick<RpeClient, "call">, onSession: (session: SessionReply) => void): () => void {
  let alive = true;
  client.call("GET /api/v1/status/session", {}).then(
    (session) => {
      if (alive) onSession(session);
    },
    () => undefined,
  );
  return () => {
    alive = false;
  };
}

/**
 * What this browser signs in with, each said as what it is: the session it holds (it ends, and is renewed while the page is open; when it has
 * ended you sign in again), and the web key (which has no end unless a setting gives it one). Nothing before the route has answered.
 */
export function SessionLine(props: { session: SessionReply | null; names: { session: string; webKey: string } }) {
  const { session, names } = props;
  if (session === null) return null;
  return (
    <>
      <p class="rpe-line" data-session="session">
        {session.holds === "web key" ? "This browser holds the web key itself." : null}
        {session.holds === "session" && session.ends !== null ? <>This browser holds a session, which ends on {when(session.ends)}. It is renewed while this page is open; once it has ended you sign in again with the web key or your Lumiverse account. </> : null}
        {session.holds === "session" ? (
          <>
            How long a session holds is "{names.session}" on the Settings page.
          </>
        ) : null}
      </p>
      {session.webKey === null ? null : session.webKey.ends === null ? (
        <p class="rpe-line" data-session="key">
          The web key has no end: it holds until you make a new one with <code>rpe key web</code> on the machine RPE runs on. How long it holds is "{names.webKey}" on the Settings page.
        </p>
      ) : (
        <p class="rpe-line" data-session="key">
          The web key ends on {when(session.webKey.ends)}. Make a new one with <code>rpe key web</code> on the machine RPE runs on before then.
        </p>
      )}
    </>
  );
}
