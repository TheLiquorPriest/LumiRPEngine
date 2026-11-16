// What waits for the server on a hook file or a tool's manifest: each thing in the file that runs a command or
// calls out, with its switch (waiting, on, off) and, while it waits, the line to run on the server. No page
// switches one: only `rpe allow` and `rpe deny` on the server do (plan §16, R-46).

import type { SwitchEntry } from "../../../shared/api";
import { Badge, Banner } from "../../atoms";
import { useApp } from "../../app";
import { replyOf } from "../../client";
import { useRead } from "../../reading";

/** Whether a file holds definitions that run a command or call out: a hook file, a tool's manifest. */
export function runsThings(path: string): boolean {
  return /(^|\/)(\.?hooks)\//.test(path) || /(^|\/)\.tools\/[^/]*\.json$/.test(path) || /(^|\/)\.tools\/[^/]*\.ya?ml$/.test(path);
}

/** The switches the file's text names. */
export function switchesIn(text: string, all: readonly SwitchEntry[]): SwitchEntry[] {
  return all.filter((entry) => text.includes(entry.name));
}

const STATE_WORDS: Readonly<Record<SwitchEntry["state"], string>> = { waiting: "waiting for rpe allow", on: "on", off: "off" };

export function SwitchList(props: { entries: readonly SwitchEntry[] }) {
  if (props.entries.length === 0) return null;
  return (
    <div class="lre-stack" data-switches>
      <span class="rpe-caption">What runs or calls out from this file</span>
      <ul class="rpe-reports">
        {props.entries.map((entry) => (
          <li key={`${entry.user}-${entry.name}`} data-switch={entry.name}>
            <code class="lre-id">{entry.name}</code> <Badge tone={entry.state === "waiting" ? "warn" : entry.state === "on" ? "pos" : undefined}>{STATE_WORDS[entry.state]}</Badge> <span class="rpe-meta">{entry.what}</span>
            {entry.state === "waiting" ? <code class="lre-id"> rpe allow {entry.name}</code> : null}
          </li>
        ))}
      </ul>
      <p class="rpe-meta">Only the command line on the server switches one on; no page can.</p>
    </div>
  );
}

/** The switch of each thing in the open file that runs a command or calls out, read when the file is opened and again after it is saved. */
export function Waiting(props: { path: string; text: string }) {
  const app = useApp();
  const on = runsThings(props.path);
  const read = useRead(on ? async () => replyOf(await app.client.call("GET /api/v1/switches", {})).switches : null, [props.path, props.text, on]);
  if (!on) return null;
  if (read.problem !== null) {
    return (
      <Banner tone="neg" icon="alert" title="What waits for the server could not be read">
        <span>{read.problem}</span>
      </Banner>
    );
  }
  return <SwitchList entries={switchesIn(props.text, read.value ?? [])} />;
}
