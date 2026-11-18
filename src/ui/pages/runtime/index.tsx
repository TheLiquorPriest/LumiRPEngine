// Runtime (plan §4.4, §4.6, §14): how RPE runs. How it runs and a Restart that waits for what is running; its builds,
// the newest update stage by stage (read again while one goes on) and "Update now", and, in the web shell, what this browser
// signs in with (the session it holds and when it ends, and the web key); RPE's own log, a page at a time, narrowed by level, area, chat, turn and job (the
// narrowing is in the address: `runtime/log/job/<id>`); and where the time goes across the latest turns.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { BuildsStatus, SessionReply } from "../../../shared/api";
import { type Route, useApp } from "../../app";
import { PageHeader } from "../../../frontend/components";
import type { PageEntry } from "../../page-entry";
import { useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { useSettingView } from "../settings/names";
import { errorWords } from "../../words";
import { type BuildsReader, type BuildsShown, BuildsView, NO_BUILDS, readBuilds, readSession, SessionLine } from "./builds";
import { type LogFilter, logAt, logFilterOf, LogView } from "./logs";
import { NO_RESTART, type RestartShown, ServiceView, watchRestart } from "./service";
import { TimingsView } from "./timings";

export { NO_BUILDS, readBuilds, readSession } from "./builds";
export { logAt, logFilterOf } from "./logs";

export interface RuntimeViewProps {
  builds: BuildsShown;
  onUpdate(): void;
  /** What this browser signs in with, as the session route says it; null where it is not known (or the page is not the web shell's). */
  session: SessionReply | null;
  /** The Settings page's names for how long a session holds and how long the web key holds, which the lines on what the browser signs in with point to. */
  names: { session: string; webKey: string };
  /** How RPE runs, drawn above the builds. */
  service?: ComponentChildren;
  /** The sections the service's routes give after the builds: the log and the timings. */
  children?: ComponentChildren;
}

export function RuntimeView(props: RuntimeViewProps) {
  return (
    <div class="lre-stack rpe-page" data-page="runtime">
      <PageHeader title="Runtime" subtitle="How RPE runs, and which build." />
      {props.service}
      <SessionLine session={props.session} names={props.names} />
      <BuildsView shown={props.builds} onUpdate={props.onUpdate} />
      {props.children}
    </div>
  );
}

function ServicePart(props: { onBack(): void }) {
  const app = useApp();
  const service = useRead(() => app.client.call("GET /api/v1/service", {}), []);
  const [restart, setRestart] = useState<RestartShown>(NO_RESTART);
  const pollMs = useUiSetting("jobPollMs");
  const watching = useRef<(() => void) | null>(null);
  useEffect(() => () => watching.current?.(), []);
  const restartNow = (): void => {
    if (restart.busy || service.value === null) return;
    const since = service.value.since;
    const pressed = app.timers.now();
    setRestart({ busy: true, answer: null, problem: null });
    app.client.call("POST /api/v1/service/restart", {}).then(
      (answer: BuildsStatus) => {
        const coming = answer.restart === "waiting" || answer.restart === "restarting";
        setRestart({ busy: false, answer, problem: null, ...(coming ? { waiting: true as const } : {}) });
        if (!coming) {
          service.again();
          return;
        }
        // RPE goes down and comes back: the page waits for the process that started after this one, then says which build it runs and how long it took, and reads again what it shows.
        watching.current = watchRestart(app.client, since, pressed, { every: pollMs, timers: app.timers }, (back) => {
          setRestart((now) => ({ ...now, back }));
          service.again();
          props.onBack();
        });
      },
      (error: unknown) => setRestart({ busy: false, answer: null, problem: errorWords(error) }),
    );
  };
  return <ServiceView how={service.value} problem={service.problem} restart={restart} onRestart={restartNow} />;
}

function LogPart(props: { route: Route; reload: number }) {
  const app = useApp();
  const { route } = props;
  const perPage = useUiSetting("logLines");
  const filter = logFilterOf(route.at) ?? {};
  const filterKey = JSON.stringify(filter);
  const [asked, setAsked] = useState(perPage);
  useEffect(() => setAsked(perPage), [filterKey, perPage]);
  const log = useRead(() => app.client.call("GET /api/v1/service/log", {}, { query: { ...filter, limit: asked } }), [filterKey, asked, props.reload]);
  const go = (next: LogFilter): void => app.go({ page: "runtime", chat: route.chat ?? null, at: Object.keys(next).length === 0 ? [] : logAt(next) });
  return (
    <LogView
      filter={filter}
      log={log.value}
      asked={asked}
      loading={log.loading}
      problem={log.problem}
      onFilter={go}
      onMore={() => setAsked((n) => n + perPage)}
      onTurn={(logChat, turn) => app.go({ page: "turns", chat: logChat, at: [turn] })}
    />
  );
}

function TimingsPart(props: { chat: string | null }) {
  const app = useApp();
  const [ofChat, setOfChat] = useState(false);
  const { chat } = props;
  const timings = useRead(() => app.client.call("GET /api/v1/service/timings", {}, { query: ofChat && chat !== null ? { chat } : {} }), [ofChat, chat]);
  return <TimingsView timings={timings.value} loading={timings.loading} problem={timings.problem} chat={chat} ofChat={ofChat} onScope={setOfChat} />;
}

export function RuntimePage(props: { route?: Route }) {
  const app = useApp();
  const route = props.route ?? { page: "runtime" };
  const [builds, setBuilds] = useState<BuildsShown>(NO_BUILDS);
  const [reader, setReader] = useState<BuildsReader | null>(null);
  const [session, setSession] = useState<SessionReply | null>(null);
  /** How many times RPE restarted while the page was open and came back: what the page reads again then. */
  const [restarted, setRestarted] = useState(0);
  const names = { session: useSettingView("auth.webSessionMinutes")?.name ?? "the setting", webKey: useSettingView("auth.webKeyDays")?.name ?? "the setting" };
  const pollMs = useUiSetting("jobPollMs");
  useEffect(() => {
    const reading = readBuilds(app.client, setBuilds, { every: pollMs, timers: app.timers });
    setReader(reading);
    const forget = app.shell === "web" ? readSession(app.client, setSession) : () => undefined;
    return () => {
      reading.stop();
      forget();
    };
  }, [restarted]);
  return (
    <RuntimeView builds={builds} onUpdate={() => reader?.update()} session={session} names={names} service={<ServicePart onBack={() => setRestarted((n) => n + 1)} />}>
      <LogPart route={route} reload={restarted} />
      <TimingsPart chat={route.chat ?? null} />
    </RuntimeView>
  );
}

export const entry: PageEntry = { id: "runtime", title: "Runtime", icon: "hammer", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 115, render: (route) => <RuntimePage route={route} /> };
