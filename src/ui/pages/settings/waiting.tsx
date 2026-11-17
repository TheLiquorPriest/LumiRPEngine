// What waits for the server (plan §16, R-46): anything that runs a command or calls out is switched on by the
// server's own command line and by no page. This lists each name, waiting, on or off, with what it runs or calls,
// since when, and the line to run on the server.

import type { SwitchEntry } from "../../../shared/api";
import { Badge, Section } from "../../../frontend/components";
import { when } from "../../words";

const STATE_WORDS: Readonly<Record<SwitchEntry["state"], string>> = { waiting: "waiting for you", on: "on", off: "off" };

/** The line to run on the server that moves a name to where it is not now. */
export function lineFor(s: SwitchEntry): string {
  const name = /\s/.test(s.name) ? `"${s.name}"` : s.name;
  return s.state === "on" ? `rpe deny ${name}` : `rpe allow ${name}`;
}

export function WaitingSection(props: { switches: readonly SwitchEntry[] | null; problem: string | null }) {
  const { switches } = props;
  return (
    <Section title="Anything that runs a command or calls out" id="waiting">
      <p class="rpe-line">A page cannot switch these on: only the server's own command line does, with the line shown under each.</p>
      {props.problem === null ? null : <p class="rpe-line" data-waiting-problem>{props.problem}</p>}
      {switches === null ? null : switches.length === 0 ? (
        <p class="lre-muted rpe-line">Nothing runs a command or calls out.</p>
      ) : (
        <ul class="rpe-plain lre-stack" data-switches>
          {[...switches]
            .sort((a, b) => Number(b.state === "waiting") - Number(a.state === "waiting") || a.name.localeCompare(b.name))
            .map((s) => (
              <li key={`${s.user}:${s.name}`} class="lre-stack rpe-entry" data-switch={s.name}>
                <p class="rpe-line">
                  <strong>{s.name}</strong> <Badge tone={s.state === "waiting" ? "warn" : s.state === "on" ? "pos" : undefined}>{STATE_WORDS[s.state]}</Badge>
                </p>
                <p class="rpe-meta">
                  {s.kind}: {s.what} · listed {when(s.listed)}
                  {s.changed === null ? "" : ` · last switched ${when(s.changed)}`}
                </p>
                <p class="rpe-meta">
                  On the server: <code>{lineFor(s)}</code>
                </p>
              </li>
            ))}
        </ul>
      )}
    </Section>
  );
}
