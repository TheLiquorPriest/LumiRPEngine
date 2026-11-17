// Runtime (plan §4.4, §4.6, §14): how RPE runs. How it runs and a Restart that waits for what is running; its builds,
// the newest update stage by stage (read again while one goes on) and "Update now", and, in the web shell, when the web
// key this browser holds ends; RPE's own log, a page at a time, narrowed by level, area, chat, turn and job (the
// narrowing is in the address: `runtime/log/job/<id>`); and where the time goes across the latest turns.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { BuildsStatus } from "../../../shared/api";
import { type Route, useApp } from "../../app";
import { PageHeader } from "../../atoms";
import type { PageEntry } from "../../page-entry";
import { useRead } from "../../reading";
import { useUiSetting } from "../../ui-settings";
import { errorWords } from "../../words";
import { type BuildsReader, type BuildsShown, BuildsView, NO_BUILDS, readBuilds, readSession, SessionLine } from "./builds";
import { type LogFilter, logAt, logFilterOf, LogView } from "./logs";
import { NO_RESTART, type RestartShown, ServiceView } from "./service";
import { TimingsView } from "./timings";

export { NO_BUILDS, readBuilds, readSession } from "./builds";
export { logAt, logFilterOf } from "./logs";

export interface RuntimeViewProps {
  builds: BuildsShown;
  onUpdate(): void;
  /** When the web key this browser holds ends; null for none, or not known. */
  sessionEnds: number | null;
  /** How RPE runs, drawn above the builds. */
  service?: ComponentChildren;
  /** The sections the service's routes give after the builds: the log and the timings. */
  children?: ComponentChildren;
}

export function RuntimeView(props: RuntimeViewProps) {
  return (
    <div class="lre-stack rpe-page" data-page="runtime">
      <PageHeader title="Runtime" sub="How RPE runs, and which build." />
      {props.service}
      <SessionLine ends={props.sessionEnds} />
      <BuildsView shown={props.builds} onUpdate={props.onUpdate} />
      {props.children}
    </div>
  );
}

function ServicePart() {
  const app = useApp();
  const service = useRead(() => app.client.call("GET /api/v1/service", {}), []);
  const [restart, setRestart] = useState<RestartShown>(NO_RESTART);
  const restartNow = (): void => {
    if (restart.busy) return;
    setRestart({ busy: true, answer: null, problem: null });
    app.client.call("POST /api/v1/service/restart", {}).then(
      (answer: BuildsStatus) => {
        setRestart({ busy: false, answer, problem: null });
        service.again();
      },
      (error: unknown) => setRestart({ busy: false, answer: null, problem: errorWords(error) }),
    );
  };
  return <ServiceView how={service.value} problem={service.problem} restart={restart} onRestart={restartNow} />;
}

function LogPart(props: { route: Route }) {
  const app = useApp();
  const { route } = props;
  const perPage = useUiSetting("logLines");
  const filter = logFilterOf(route.at) ?? {};
  const filterKey = JSON.stringify(filter);
  const [asked, setAsked] = useState(perPage);
  useEffect(() => setAsked(perPage), [filterKey, perPage]);
  const log = useRead(() => app.client.call("GET /api/v1/service/log", {}, { query: { ...filter, limit: asked } }), [filterKey, asked]);
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
  const [sessionEnds, setSessionEnds] = useState<number | null>(null);
  const pollMs = useUiSetting("jobPollMs");
  useEffect(() => {
    const reading = readBuilds(app.client, setBuilds, { every: pollMs, timers: app.timers });
    setReader(reading);
    const forget = app.shell === "web" ? readSession(app.client, setSessionEnds) : () => undefined;
    return () => {
      reading.stop();
      forget();
    };
  }, []);
  return (
    <RuntimeView builds={builds} onUpdate={() => reader?.update()} sessionEnds={sessionEnds} service={<ServicePart />}>
      <LogPart route={route} />
      <TimingsPart chat={route.chat ?? null} />
    </RuntimeView>
  );
}

export const entry: PageEntry = { id: "runtime", title: "Runtime", icon: "hammer", shells: ["web", "drawer"], needsChat: false, withChat: true, often: false, order: 115, render: (route) => <RuntimePage route={route} /> };
