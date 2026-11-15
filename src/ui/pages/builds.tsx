// The builds line on Settings (plan §4.6): which build RPE runs, which its app file on disk is, and which
// the extension in Lumiverse said it is, in the status's own words; and "Update now" where the build on
// disk is another one and nothing else will restart RPE onto it (its restart is off, or none is under
// way). While RPE waits or restarts it is already on its way, and started by hand it cannot be.
//
// And, in the web shell, when the web key this browser holds ends (the session route): nothing for a
// key with no end. The drawer's page token is renewed by the extension as it runs out, so its end is
// nothing the player acts on, and the drawer does not show it.

import type { BuildsReply, BuildsStatus } from "../../shared/api";
import { Banner, Button, Row, Section } from "../atoms";
import type { RpeClient } from "../client";
import { errorWords, when } from "../words";

export interface BuildsShown {
  reply: BuildsReply | null;
  loading: boolean;
  problem: string | null;
  updating: boolean;
  /** What "Update now" answered: what RPE will do, in its words. */
  updated: BuildsStatus | null;
  updateProblem: string | null;
}

export const NO_BUILDS: BuildsShown = { reply: null, loading: true, problem: null, updating: false, updated: null, updateProblem: null };

export interface BuildsReader {
  update(): void;
  stop(): void;
}

/** Reads the builds once; "Update now" posts and shows its answer as the builds now stand. */
export function readBuilds(client: Pick<RpeClient, "call">, onChange: (shown: BuildsShown) => void): BuildsReader {
  let shown = NO_BUILDS;
  let alive = true;
  const show = (next: Partial<BuildsShown>): void => {
    if (!alive) return;
    shown = { ...shown, ...next };
    onChange(shown);
  };
  client.call("GET /api/v1/status/builds", {}).then(
    (reply) => show({ reply, loading: false, problem: null }),
    (error: unknown) => show({ loading: false, problem: errorWords(error) }),
  );
  return {
    update() {
      if (shown.updating) return;
      show({ updating: true, updateProblem: null });
      client.call("POST /api/v1/update", {}).then(
        (builds) => show({ updating: false, updated: builds, reply: shown.reply === null ? null : { ...shown.reply, builds } }),
        (error: unknown) => show({ updating: false, updateProblem: errorWords(error) }),
      );
    },
    stop() {
      alive = false;
    },
  };
}

/** Whether "Update now" does anything: the build on disk is another one, and RPE is not already on its way to it. */
export function canUpdate(builds: BuildsStatus): boolean {
  return builds.disk !== null && builds.disk !== builds.running && (builds.restart === "off" || builds.restart === "none");
}

export function BuildsView(props: { shown: BuildsShown; onUpdate(): void }) {
  const { shown } = props;
  const builds = shown.reply?.builds ?? null;
  return (
    <Section id="builds" title="Builds" actions={builds !== null && canUpdate(builds) ? <Button small busy={shown.updating} onClick={props.onUpdate}>Update now</Button> : undefined}>
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
          <span>{shown.updated.words}</span>
        </Banner>
      )}
      {shown.reply === null || builds === null ? (
        shown.loading ? (
          <p class="lre-muted rpe-line">Reading the builds…</p>
        ) : null
      ) : (
        <>
          {shown.updated === null ? <p class="rpe-line">{builds.words}</p> : null}
          <Row label="RPE runs" value={<code>{builds.running}</code>} sub={`since ${when(shown.reply.started)}`} />
          <Row label="Its app file on disk" value={builds.disk === null ? (builds.broken ?? "gives no build") : <code>{builds.disk}</code>} />
          <Row label="The extension in Lumiverse" value={builds.extension === null ? "has not said yet" : <code>{builds.extension}</code>} />
        </>
      )}
    </Section>
  );
}

/** Reads when the credential the page holds ends, once: `onEnds` hears it (null: it has no end). A refused read leaves the line out: a key RPE no longer takes signs the web shell out on its own. The returned function lets the answer go. */
export function readSession(client: Pick<RpeClient, "call">, onEnds: (ends: number | null) => void): () => void {
  let alive = true;
  client.call("GET /api/v1/status/session", {}).then(
    (session) => {
      if (alive) onEnds(session.ends);
    },
    () => undefined,
  );
  return () => {
    alive = false;
  };
}

/** When the web key ends, or nothing where it has no end (or it is not known yet). */
export function SessionLine(props: { ends: number | null }) {
  if (props.ends === null) return null;
  return (
    <p class="rpe-line" data-session="ends">
      This browser's web key ends on {when(props.ends)}. Make a new one with <code>rpe key web</code> on the machine RPE runs on before then.
    </p>
  );
}
