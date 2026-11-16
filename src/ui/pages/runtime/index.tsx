// Runtime (plan §4.4, §4.6, §14): how RPE runs. Here are its builds with "Update now" and, in the web shell,
// when the web key this browser holds ends. What the server's service group will add (the service and its
// restart, RPE's log, the timings across turns) waits for those routes (PlanOps-9) and is not drawn before them.

import { useEffect, useState } from "preact/hooks";
import { useApp } from "../../app";
import { PageHeader } from "../../atoms";
import type { PageEntry } from "../../page-entry";
import { type BuildsReader, type BuildsShown, BuildsView, NO_BUILDS, readBuilds, readSession, SessionLine } from "./builds";

export { NO_BUILDS, readBuilds, readSession } from "./builds";

export interface RuntimeViewProps {
  builds: BuildsShown;
  onUpdate(): void;
  /** When the web key this browser holds ends; null for none, or not known. */
  sessionEnds: number | null;
}

export function RuntimeView(props: RuntimeViewProps) {
  return (
    <div class="lre-stack rpe-page" data-page="runtime">
      <PageHeader title="Runtime" sub="How RPE runs, and which build." />
      <SessionLine ends={props.sessionEnds} />
      <BuildsView shown={props.builds} onUpdate={props.onUpdate} />
    </div>
  );
}

export function RuntimePage() {
  const app = useApp();
  const [builds, setBuilds] = useState<BuildsShown>(NO_BUILDS);
  const [reader, setReader] = useState<BuildsReader | null>(null);
  const [sessionEnds, setSessionEnds] = useState<number | null>(null);
  useEffect(() => {
    const reading = readBuilds(app.client, setBuilds);
    setReader(reading);
    const forget = app.shell === "web" ? readSession(app.client, setSessionEnds) : () => undefined;
    return () => {
      reading.stop();
      forget();
    };
  }, []);
  return <RuntimeView builds={builds} onUpdate={() => reader?.update()} sessionEnds={sessionEnds} />;
}

export const entry: PageEntry = { id: "runtime", title: "Runtime", icon: "hammer", shells: ["web", "drawer"], needsChat: false, often: false, order: 115, render: () => <RuntimePage /> };
