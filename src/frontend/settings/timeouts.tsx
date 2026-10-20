// Settings → Timeouts (DESIGN §5.6): every wall clock the engine keeps, in groups, each with what it
// limits, what happens when it runs out, its default and its value in seconds, with no ceiling. One
// that may be lifted has a No limit switch; one that runs inside a Lumiverse limit says where
// Lumiverse stops it, and the page ends with Lumiverse's own limits, which no setting changes. The
// definitions and Lumiverse's limits are one table each, in shared/timeouts.ts. Styles: styles/settings.ts.

import type { JsonObject } from "../../shared/json";
import type { Limit } from "../../shared/minds";
import { limitOf } from "../../shared/minds";
import type { HostLimit, TimeoutGroup, TimeoutKey, TimeoutSettings } from "../../shared/timeouts";
import { formatMs, HOST_LIMITS, TIMEOUT_KEYS, TIMEOUTS, TIMER_MAX_MS } from "../../shared/timeouts";
import { Button, HostSwitch, NumberStepper, Section } from "../components";

const GROUPS: readonly { group: TimeoutGroup; title: string; lead: string }[] = [
  { group: "turn", title: "Turns", lead: "How long the engine may work on a turn before the reply, and after it." },
  { group: "app", title: "This tab", lead: "How long LumiRPEngine's tab waits for the engine." },
  { group: "work", title: "Jobs and background work", lead: "Build's model jobs, minds runs you start, and the engine's work in the background." },
];

/** The −/+ step of each setting's seconds. */
const STEP_S: Record<TimeoutKey, number> = { engineRunMs: 30, preLookupMs: 15, postReplyMs: 30, postLookupMs: 15, guardMs: 10, requestMs: 30, caveatsMs: 10, mindsRunMs: 60, jobCallMs: 60, tokenCountMs: 5, laneStartupMs: 10, laneHeartbeatMs: 10 };

/** A limit as the page says it: "5 min", or "No limit". */
export function limitText(limit: Limit): string {
  return limit === "none" ? "No limit" : formatMs(limit);
}

/** Where Lumiverse stops a setting that runs inside one of its limits, and what the value set comes to there. */
function hostNote(key: TimeoutKey, value: Limit): string | null {
  const def = TIMEOUTS[key];
  if (!def.host) return null;
  const host: HostLimit = HOST_LIMITS[def.host];
  const asked = value === "none" ? host.noneMs : undefined;
  const cap = `Lumiverse caps this at ${formatMs(host.maxMs)}, its own limit.`;
  if (asked === 0) return `${cap} No limit asks it to check none.`;
  return limitOf(value) > host.maxMs ? `${cap} What's set here runs as ${formatMs(host.maxMs)}.` : cap;
}

function TimeoutRow(props: { id: TimeoutKey; value: Limit; busy: boolean; set(value: Limit | null): void }) {
  const { id, value } = props;
  const def = TIMEOUTS[id];
  const fallback = def.defaultMs === "none" ? def.minMs : def.defaultMs;
  const host = hostNote(id, value);
  return (
    <div class="lre-set-ext lre-set-timeout" data-lre-timeout={id}>
      <div class="lre-set-ext-head">
        <span class="lre-set-ext-title">{def.label}</span>
        {value === def.defaultMs ? null : (
          <Button size="sm" variant="ghost" icon="undo" label={`Reset ${def.label} to its default, ${limitText(def.defaultMs)}`} disabled={props.busy} onClick={() => props.set(null)}>
            Default
          </Button>
        )}
      </div>
      <span class="lre-set-timeout-text">{def.limits}</span>
      <span class="lre-small lre-muted">When it runs out: {def.fires}</span>
      {def.none !== null ? <HostSwitch label={`${def.label}: no limit`} checked={value === "none"} disabled={props.busy} onChange={(none) => props.set(none ? "none" : fallback)} /> : null}
      {value === "none" ? null : <NumberStepper label={`${def.label} (seconds)`} value={value / 1000} min={def.minMs / 1000} step={STEP_S[id]} disabled={props.busy} onChange={(seconds) => props.set(Math.round(seconds * 1000))} />}
      <span class="lre-small lre-muted">
        Default {limitText(def.defaultMs)}
        {def.zero ? `; 0 means ${def.zero}` : ""}
        {value === "none" && def.none ? `; no limit: ${def.none}` : ""}.
        {value !== "none" && value >= TIMER_MAX_MS ? " Longer than a timer can wait (about 24 days), so it runs as no limit." : ""}
      </span>
      {host ? <span class="lre-small lre-warn">{host}</span> : null}
    </div>
  );
}

export function TimeoutsSection(props: { timeouts: TimeoutSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const set = (id: TimeoutKey) => (value: Limit | null) => props.patch({ timeouts: { [id]: value } });
  return (
    <div class="lre-stack" data-lre-settings-page="timeouts">
      <p class="lre-set-lead">Every wait the engine keeps is yours to set, in seconds, with no ceiling; No limit lifts one where that can't break anything. Picking a Model use preset never changes these.</p>
      {GROUPS.map(({ group, title, lead }) => (
        <Section key={group} title={title} flush>
          <div class="lre-set-rows" data-lre-timeout-group={group}>
            <p class="lre-set-timeout-lead">{lead}</p>
            {TIMEOUT_KEYS.filter((id) => TIMEOUTS[id].group === group).map((id) => (
              <TimeoutRow key={id} id={id} value={props.timeouts[id]} busy={props.busy} set={set(id)} />
            ))}
          </div>
        </Section>
      ))}
      <Section title="Lumiverse's own limits" flush>
        <div class="lre-set-rows" data-lre-host-limits>
          <p class="lre-set-timeout-lead">Lumiverse limits some waits itself. No setting here changes these; the settings above that run inside one say so.</p>
          {Object.entries(HOST_LIMITS).map(([id, host]) => (
            <div key={id} class="lre-set-ext lre-set-timeout" data-lre-host-limit={id}>
              <div class="lre-set-ext-head">
                <span class="lre-set-ext-title">{host.what}</span>
                <span class="lre-set-timeout-cap">{`minMs` in host ? `${formatMs(host.minMs)} to ${formatMs(host.maxMs)}` : formatMs(host.maxMs)}</span>
              </div>
              <span class="lre-small lre-muted">{host.effect}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
