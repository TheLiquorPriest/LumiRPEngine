// Settings → Agents (AGENT-LOOP-PLAN §12, §15; INC1-SPEC R1): what the agent runtime runs under.
// Thinking in agent tool loops; the budgets, each with what it limits, what happens when it's
// reached, its default and a No limit switch where one may be lifted; throttles per connection;
// caching for every role and each role's own, with Bust; and acceptance runs: the connections they
// guard, the estimate factor, and the run itself, opened and closed here only, with its counter.
// The drawer's AcceptanceBanner shows the same counter while a run is open. Every number and word
// a limit shows comes from shared/agent-settings.ts. Settings save as a merge patch, so the
// per-connection lists go whole and a role's own caching is dropped with null. Styles: styles/settings.ts.

import { useEffect, useId, useState } from "preact/hooks";
import type { AcceptanceConnection, AcceptanceRunView, AcceptanceState, AgentBudget, AgentLimitDef, AgentLimitUnit, AgentSettings, ConnectionThrottle, TurnBudget } from "../../shared/agent-settings";
import { AGENT_ROLES, BUDGET_DEFS, CEILING_MIN, DEFAULT_ACCEPTANCE, defaultAgentSettings, ESTIMATE_FACTOR_MIN, LOOP_DEFS, roleCaching, THROTTLE_MIN, TURN_DEFS } from "../../shared/agent-settings";
import { hasOwn, type JsonObject } from "../../shared/json";
import type { Limit } from "../../shared/minds";
import { formatMs } from "../../shared/timeouts";
import { useApp } from "../app";
import { Badge, Banner, Button, Empty, Field, HostSwitch, NumberStepper, Row, Section, useBusy } from "../components";
import { type Connection, useConnections } from "./steps";

/** The defaults each row's Default resets to (a reset deletes the stored value, so the reader falls back to these). */
const DEFAULTS = defaultAgentSettings();

/** The −/+ step of each unit, in what the stepper shows (seconds for "ms"): a convenience, not a limit; typing takes any value. */
export const STEP: Record<AgentLimitUnit, number> = { tokens: 1000, ms: 5, count: 1, chars: 500 };

/** The estimate factor's −/+ step. */
const FACTOR_STEP = 0.5;

const n = (value: number): string => value.toLocaleString("en-US");

/** A limit as the page says it: "100,000 tokens", "2 min", "4,000 characters", or "No limit". */
export function amountText(value: Limit, unit: AgentLimitUnit): string {
  if (value === "none") return "No limit";
  if (unit === "ms") return formatMs(value);
  return unit === "tokens" ? `${n(value)} tokens` : unit === "chars" ? `${n(value)} characters` : n(value);
}

/** A connection's name, or its id while the names haven't come or when Lumiverse no longer has it. */
function nameOf(id: string, connections: readonly Connection[]): string {
  return connections.find((c) => c.id === id)?.name ?? id;
}

/**
 * A fresh cache nonce. From getRandomValues rather than randomUUID, which a page served over plain
 * http (Lumiverse on a home network) doesn't have.
 */
function freshNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Settings home's line for this page: thinking in tool loops, and the turn's prompt budget. */
export function agentsSummary(agents: AgentSettings): string {
  return `Thinking in tool loops ${agents.thinkingInToolLoops ? "on" : "off"} · ${TURN_DEFS.tokensIn.label.toLowerCase()} ${amountText(agents.turn.tokensIn, TURN_DEFS.tokensIn.unit).toLowerCase()}`;
}

/** One limit: what it limits, what happens when it's reached, No limit where it may be lifted, its value, and Default. */
export function LimitRow(props: { id: string; def: AgentLimitDef; value: Limit; standard: Limit; busy: boolean; set(value: Limit | null): void }) {
  const { def, value, standard } = props;
  const seconds = def.unit === "ms";
  // Turning No limit off starts from the default when it's a number, else from the least the limit takes.
  const onValue = standard === "none" ? def.min : standard;
  const unitLabel = seconds ? "seconds" : def.unit === "tokens" ? "tokens" : def.unit === "chars" ? "characters" : null;
  return (
    <div class="lre-set-ext lre-set-timeout" data-lre-agent-limit={props.id}>
      <div class="lre-set-ext-head">
        <span class="lre-set-ext-title">{def.label}</span>
        {value === standard ? null : (
          <Button size="sm" variant="ghost" icon="undo" label={`Reset ${def.label} to its default, ${amountText(standard, def.unit)}`} disabled={props.busy} onClick={() => props.set(null)}>
            Default
          </Button>
        )}
      </div>
      <span class="lre-set-timeout-text">{def.limits}</span>
      <span class="lre-small lre-muted">When it's reached: {def.fires}</span>
      {def.none !== null ? <HostSwitch label={`${def.label}: no limit`} checked={value === "none"} disabled={props.busy} onChange={(none) => props.set(none ? "none" : onValue)} /> : null}
      {value === "none" ? null : (
        <NumberStepper
          label={unitLabel ? `${def.label} (${unitLabel})` : def.label}
          value={seconds ? value / 1000 : value}
          min={seconds ? def.min / 1000 : def.min}
          step={STEP[def.unit]}
          integer={!seconds}
          disabled={props.busy}
          onChange={(next) => props.set(seconds ? Math.round(next * 1000) : next)}
        />
      )}
      <span class="lre-small lre-muted">
        Default {amountText(standard, def.unit)}
        {value === "none" && def.none ? `; no limit: ${def.none}` : ""}.
      </span>
    </div>
  );
}

/** A per-minute throttle or a run's ceiling: an Off or No limit switch, and the number while it's set. */
function OptionalLimit(props: { label: string; offLabel: string; value: Limit; min: number; onValue: number; step: number; busy: boolean; set(value: Limit): void }) {
  return (
    <div class="lre-set-timeout">
      <HostSwitch label={`${props.label}: ${props.offLabel}`} checked={props.value === "none"} disabled={props.busy} onChange={(off) => props.set(off ? "none" : props.onValue)} />
      {props.value === "none" ? null : <NumberStepper label={props.label} value={props.value} min={props.min} step={props.step} integer disabled={props.busy} onChange={props.set} />}
    </div>
  );
}

/** Add one of the connections not yet listed. */
function AddConnection(props: { taken: readonly string[]; connections: readonly Connection[]; action: string; busy: boolean; add(id: string): void }) {
  const id = useId();
  const [choice, setChoice] = useState("");
  const free = props.connections.filter((c) => !props.taken.includes(c.id));
  const first = free[0];
  if (!first) return <p class="lre-set-timeout-lead">No other connection to add.</p>;
  const chosen = free.some((c) => c.id === choice) ? choice : first.id;
  return (
    <div class="lre-set-ext">
      <Field label="Connection" for={id}>
        <select id={id} class="lre-input" value={chosen} disabled={props.busy} onChange={(event) => setChoice(event.currentTarget.value)}>
          {free.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.model ? ` — ${c.model}` : ""}
            </option>
          ))}
        </select>
      </Field>
      <div>
        <Button size="sm" icon="plus" disabled={props.busy} onClick={() => props.add(chosen)}>
          {props.action}
        </Button>
      </div>
    </div>
  );
}

function BudgetGroup<K extends string>(props: { title: string; lead: string; defs: Readonly<Record<K, AgentLimitDef>>; values: Readonly<Record<K, Limit>>; standard: Readonly<Record<K, Limit>>; busy: boolean; set(key: K, value: Limit | null): void }) {
  const keys = Object.keys(props.defs) as K[];
  return (
    <div class="lre-set-rows lre-set-group" data-lre-agent-group={props.title}>
      <p class="lre-set-timeout-lead">
        <strong>{props.title}.</strong> {props.lead}
      </p>
      {keys.map((key) => (
        <LimitRow key={key} id={key} def={props.defs[key]} value={props.values[key]} standard={props.standard[key]} busy={props.busy} set={(value) => props.set(key, value)} />
      ))}
    </div>
  );
}

function ThrottlesSection(props: { throttles: readonly ConnectionThrottle[]; connections: readonly Connection[]; patch(patch: JsonObject): void; busy: boolean }) {
  // The list goes whole: a merge patch replaces an array, it never merges one.
  const save = (next: readonly ConnectionThrottle[]) => props.patch({ agents: { throttles: next.map((t) => ({ id: t.id, requestsPerMinute: t.requestsPerMinute, tokensPerMinute: t.tokensPerMinute })) } });
  const change = (id: string, part: Partial<Omit<ConnectionThrottle, "id">>) => save(props.throttles.map((t) => (t.id === id ? { ...t, ...part } : t)));
  return (
    <Section title="Throttles" flush>
      <div class="lre-set-rows" data-lre-agent-throttles>
        <p class="lre-set-timeout-lead">Per connection, how many requests and tokens (sent and written) the agents may use each minute; a call past either waits for the minute to turn. A connection not listed has none.</p>
        {props.throttles.map((t) => {
          const name = nameOf(t.id, props.connections);
          return (
            <div key={t.id} class="lre-set-ext lre-set-timeout" data-lre-agent-throttle={t.id}>
              <div class="lre-set-ext-head">
                <span class="lre-set-ext-title">{name}</span>
                <Button size="sm" variant="ghost" icon="trash" label={`Remove ${name}'s throttle`} disabled={props.busy} onClick={() => save(props.throttles.filter((x) => x.id !== t.id))}>
                  Remove
                </Button>
              </div>
              <OptionalLimit label={`${name}: requests per minute`} offLabel="off" value={t.requestsPerMinute} min={THROTTLE_MIN} onValue={THROTTLE_MIN} step={STEP.count} busy={props.busy} set={(requestsPerMinute) => change(t.id, { requestsPerMinute })} />
              <OptionalLimit label={`${name}: tokens per minute`} offLabel="off" value={t.tokensPerMinute} min={THROTTLE_MIN} onValue={THROTTLE_MIN} step={STEP.tokens} busy={props.busy} set={(tokensPerMinute) => change(t.id, { tokensPerMinute })} />
            </div>
          );
        })}
        <AddConnection taken={props.throttles.map((t) => t.id)} connections={props.connections} action="Add a throttle" busy={props.busy} add={(id) => save([...props.throttles, { id, requestsPerMinute: "none", tokensPerMinute: "none" }])} />
      </div>
    </Section>
  );
}

function CachingSection(props: { agents: AgentSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { caching } = props.agents;
  const setRole = (id: string, own: { on: boolean; nonce: string } | null) => props.patch({ agents: { caching: { roles: { [id]: own } } } });
  return (
    <Section title="Caching" flush>
      <div class="lre-set-rows" data-lre-agent-caching>
        <p class="lre-set-timeout-lead">Marks where the provider may keep the start of a prompt, so the next call that starts the same reads it for less. Bust makes the next calls miss the provider's cached prompt once; they're sent whole and cached again.</p>
        <div class="lre-set-ext lre-set-timeout">
          <div class="lre-set-ext-head">
            <span class="lre-set-ext-title">Every role</span>
            <Button size="sm" variant="secondary" icon="refresh" label="Bust every role's cache" disabled={props.busy} onClick={() => props.patch({ agents: { caching: { nonce: freshNonce() } } })}>
              Bust
            </Button>
          </div>
          <HostSwitch label="Caching for every role" checked={caching.on} disabled={props.busy} onChange={(on) => props.patch({ agents: { caching: { on } } })} />
          <span class="lre-small lre-muted">Default {DEFAULTS.caching.on ? "on" : "off"}. A role with its own caching below keeps its own.</span>
        </div>
        {AGENT_ROLES.map((role) => {
          const own = hasOwn(caching.roles, role.id);
          const now = roleCaching(props.agents, role.id);
          return (
            <div key={role.id} class="lre-set-ext lre-set-timeout" data-lre-agent-role-caching={role.id}>
              <div class="lre-set-ext-head">
                <span class="lre-set-ext-title">{role.label}</span>
                <Badge tone={own ? "accent" : "neutral"}>{own ? "Its own" : "Every role's"}</Badge>
              </div>
              <HostSwitch label={`Caching for ${role.label}`} checked={now.on} disabled={props.busy} onChange={(on) => setRole(role.id, { on, nonce: now.nonce })} />
              <div class="lre-row-actions">
                <Button size="sm" variant="secondary" icon="refresh" label={`Bust ${role.label}'s cache`} disabled={props.busy} onClick={() => setRole(role.id, { on: now.on, nonce: freshNonce() })}>
                  Bust
                </Button>
                {own ? (
                  <Button size="sm" variant="ghost" icon="undo" disabled={props.busy} onClick={() => setRole(role.id, null)}>
                    Follow every role's
                  </Button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** The open run and the last one closed: asked for on mount, then followed by its push. */
function useAcceptance(): [AcceptanceState | null, (state: AcceptanceState) => void] {
  const app = useApp();
  const [state, setState] = useState<AcceptanceState | null>(null);
  useEffect(() => {
    let live = true;
    // A push that came while `get` was out is newer than its answer.
    let pushed = false;
    const off = app.client.onAcceptance((next) => {
      pushed = true;
      setState(next);
    });
    void app.request({ type: "lre.acceptance", op: "get" }).then((result) => {
      if (live && !pushed && result) setState(result);
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return [state, setState];
}

function ceilingText(ceiling: Limit | undefined): string {
  return ceiling === undefined ? "no ceiling" : ceiling === "none" ? "no limit" : n(ceiling);
}

/** One connection's spend in a run, against its ceilings; what calls in flight hold while the run is open. */
function SpendCard(props: { spend: AcceptanceRunView["connections"][number]; name: string; open: boolean }) {
  const { spent, reserved, ceiling } = props.spend;
  return (
    <div class="lre-set-ext lre-set-timeout" data-lre-acceptance-connection={props.spend.id}>
      <div class="lre-set-ext-head">
        <span class="lre-set-ext-title">{props.name}</span>
        {spent.estimated ? <Badge tone="warn">Estimated</Badge> : null}
      </div>
      <Row k="In" sub={`${n(spent.cachedIn)} cached`} v={`${n(spent.tokensIn)} / ${ceilingText(ceiling?.tokensIn)}`} tone={ceiling && ceiling.tokensIn !== "none" && spent.tokensIn >= ceiling.tokensIn ? "warn" : undefined} />
      <Row k="Out" v={`${n(spent.tokensOut)} / ${ceilingText(ceiling?.tokensOut)}`} tone={ceiling && ceiling.tokensOut !== "none" && spent.tokensOut >= ceiling.tokensOut ? "warn" : undefined} />
      <Row k="Calls" v={n(spent.calls)} />
      <Row k="Refused" v={n(spent.refused)} tone={spent.refused > 0 ? "warn" : undefined} />
      {props.open ? <Row k="Reserved now" v={`in ${n(reserved.tokensIn)} · out ${n(reserved.tokensOut)}`} /> : null}
      {ceiling === null ? <span class="lre-small lre-muted">Not under Acceptance runs now, so no ceiling holds it.</span> : null}
      {spent.estimated ? <span class="lre-small lre-muted">Some of this is the runtime's own estimate: the provider didn't report it.</span> : null}
    </div>
  );
}

function RunPanel(props: { connections: readonly Connection[] }) {
  const app = useApp();
  const [state, setState] = useAcceptance();
  const [label, setLabel] = useState("");
  const [busy, run] = useBusy();
  const id = useId();
  if (state === null) return <Empty>Loading the acceptance run…</Empty>;
  const open = state.run;
  return (
    <>
      {open === null ? (
        <div class="lre-set-ext" data-lre-acceptance-run="closed">
          <Field label="Label" for={id} help="Names the run in its report.">
            <input id={id} class="lre-input" value={label} disabled={busy} onInput={(event) => setLabel(event.currentTarget.value)} />
          </Field>
          <div>
            <Button
              variant="primary"
              icon="play"
              disabled={busy || label.trim() === ""}
              onClick={() =>
                run(async () => {
                  const result = await app.request({ type: "lre.acceptance", op: "open", label: label.trim() });
                  if (!result) return;
                  setState(result);
                  setLabel("");
                })
              }
            >
              Open an acceptance run
            </Button>
          </div>
        </div>
      ) : (
        <div data-lre-acceptance-run="open">
          <div class="lre-set-ext">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">{open.label}</span>
              <Badge tone="accent">Open</Badge>
            </div>
            <span class="lre-small lre-muted">Opened {new Date(open.openedAt).toLocaleString()}</span>
          </div>
          {open.connections.length === 0 ? <p class="lre-set-timeout-lead">No guarded connection has made a call in this run yet.</p> : null}
          {open.connections.map((spend) => (
            <SpendCard key={spend.id} spend={spend} name={nameOf(spend.id, props.connections)} open />
          ))}
          <div class="lre-row-actions">
            <Button
              variant="secondary"
              icon="pause"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await app.request({ type: "lre.acceptance", op: "close" });
                  if (result) setState(result);
                })
              }
            >
              Close the run
            </Button>
          </div>
        </div>
      )}
      {state.last ? (
        <div data-lre-acceptance-last>
          <p class="lre-set-timeout-lead">
            <strong>Last run: {state.last.label}.</strong> {new Date(state.last.openedAt).toLocaleString()}
            {state.last.closedAt === null ? "" : ` to ${new Date(state.last.closedAt).toLocaleString()}`}
          </p>
          {state.last.connections.length === 0 ? <p class="lre-set-timeout-lead">No guarded connection made a call in it.</p> : null}
          {state.last.connections.map((spend) => (
            <SpendCard key={spend.id} spend={spend} name={nameOf(spend.id, props.connections)} open={false} />
          ))}
        </div>
      ) : null}
    </>
  );
}

function AcceptanceSection(props: { acceptance: AgentSettings["acceptance"]; connections: readonly Connection[]; patch(patch: JsonObject): void; busy: boolean }) {
  const { connections: guarded, estimateFactor } = props.acceptance;
  // The list goes whole: a merge patch replaces an array, it never merges one.
  const save = (next: readonly AcceptanceConnection[]) => props.patch({ agents: { acceptance: { connections: next.map((c) => ({ id: c.id, only: c.only, tokensIn: c.tokensIn, tokensOut: c.tokensOut })) } } });
  const change = (id: string, part: Partial<Omit<AcceptanceConnection, "id">>) => save(guarded.map((c) => (c.id === id ? { ...c, ...part } : c)));
  return (
    <>
      <Section title="Acceptance runs" flush>
        <div class="lre-set-rows" data-lre-acceptance-connections>
          <p class="lre-set-timeout-lead">The connections acceptance runs guard. One that's only in acceptance runs is refused unless a run is open. While a run is open, every call reserves its estimated prompt plus its max tokens before it goes, and a call that would pass a ceiling isn't sent.</p>
          {guarded.map((c) => {
            const name = nameOf(c.id, props.connections);
            return (
              <div key={c.id} class="lre-set-ext lre-set-timeout" data-lre-acceptance-guard={c.id}>
                <div class="lre-set-ext-head">
                  <span class="lre-set-ext-title">{name}</span>
                  <Button size="sm" variant="ghost" icon="trash" label={`Stop guarding ${name}`} disabled={props.busy} onClick={() => save(guarded.filter((x) => x.id !== c.id))}>
                    Remove
                  </Button>
                </div>
                <HostSwitch label={`${name}: only in acceptance runs`} checked={c.only} disabled={props.busy} onChange={(only) => change(c.id, { only })} />
                <OptionalLimit label={`${name}: input tokens per run`} offLabel="no limit" value={c.tokensIn} min={CEILING_MIN} onValue={DEFAULT_ACCEPTANCE.tokensIn === "none" ? CEILING_MIN : DEFAULT_ACCEPTANCE.tokensIn} step={STEP.tokens} busy={props.busy} set={(tokensIn) => change(c.id, { tokensIn })} />
                <OptionalLimit label={`${name}: output tokens per run`} offLabel="no limit" value={c.tokensOut} min={CEILING_MIN} onValue={DEFAULT_ACCEPTANCE.tokensOut === "none" ? CEILING_MIN : DEFAULT_ACCEPTANCE.tokensOut} step={STEP.tokens} busy={props.busy} set={(tokensOut) => change(c.id, { tokensOut })} />
              </div>
            );
          })}
          <AddConnection taken={guarded.map((c) => c.id)} connections={props.connections} action="Add a connection" busy={props.busy} add={(id) => save([...guarded, { ...DEFAULT_ACCEPTANCE, id }])} />
          <div class="lre-set-ext lre-set-timeout" data-lre-agent-limit="estimateFactor">
            <div class="lre-set-ext-head">
              <span class="lre-set-ext-title">Estimate factor</span>
              {estimateFactor === DEFAULTS.acceptance.estimateFactor ? null : (
                <Button size="sm" variant="ghost" icon="undo" label={`Reset Estimate factor to its default, ${DEFAULTS.acceptance.estimateFactor}`} disabled={props.busy} onClick={() => props.patch({ agents: { acceptance: { estimateFactor: null } } })}>
                  Default
                </Button>
              )}
            </div>
            <span class="lre-set-timeout-text">A model the runtime hasn't seen answer yet reserves its estimated prompt times this, until its first call reports real usage.</span>
            <NumberStepper label="Estimate factor" value={estimateFactor} min={ESTIMATE_FACTOR_MIN} step={FACTOR_STEP} disabled={props.busy} onChange={(next) => props.patch({ agents: { acceptance: { estimateFactor: next } } })} />
            <span class="lre-small lre-muted">Default {DEFAULTS.acceptance.estimateFactor}.</span>
          </div>
        </div>
      </Section>
      <Section title="The acceptance run" flush>
        <div class="lre-set-rows" data-lre-acceptance-counter>
          <p class="lre-set-timeout-lead">Open a run before calls on a guarded connection, and close it when you're done; its report stays here until the next one closes.</p>
          <RunPanel connections={props.connections} />
        </div>
      </Section>
    </>
  );
}

export function AgentsSection(props: { agents: AgentSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { agents, busy } = props;
  const connections = useConnections();
  return (
    <div class="lre-stack" data-lre-settings-page="agents">
      <p class="lre-set-lead">What the agent runtime runs under: its budgets, throttles, caching and acceptance runs. No classic step reads any of these.</p>
      <Section title="Thinking in agent tool loops">
        <HostSwitch label="Thinking in agent tool loops" checked={agents.thinkingInToolLoops} disabled={busy} onChange={(on) => props.patch({ agents: { thinkingInToolLoops: on } })} />
        <span class="lre-small lre-muted">
          Off until Lumiverse passes a reasoning model's thinking back after a tool call. While off, every agent call that offers tools goes with reasoning off, whatever the role's effort; calls without tools keep it. Default {DEFAULTS.thinkingInToolLoops ? "on" : "off"}.
        </span>
      </Section>
      <Section title="Budgets" flush>
        <BudgetGroup<keyof AgentBudget> title="Each agent" lead="Each agent's own budget, for the turn it runs in." defs={BUDGET_DEFS} values={agents.budget} standard={DEFAULTS.budget} busy={busy} set={(key, value) => props.patch({ agents: { budget: { [key]: value } } })} />
        <BudgetGroup<keyof TurnBudget> title="Each turn, every agent together" lead="What a turn's agents use between them." defs={TURN_DEFS} values={agents.turn} standard={DEFAULTS.turn} busy={busy} set={(key, value) => props.patch({ agents: { turn: { [key]: value } } })} />
        <BudgetGroup<keyof typeof LOOP_DEFS> title="Loops and large results" lead="An agent repeating itself, and a tool result too long to send whole." defs={LOOP_DEFS} values={{ loopRepeats: agents.loopRepeats, clipChars: agents.clipChars }} standard={{ loopRepeats: DEFAULTS.loopRepeats, clipChars: DEFAULTS.clipChars }} busy={busy} set={(key, value) => props.patch({ agents: { [key]: value } })} />
      </Section>
      <ThrottlesSection throttles={agents.throttles} connections={connections} patch={props.patch} busy={busy} />
      <CachingSection agents={agents} patch={props.patch} busy={busy} />
      <AcceptanceSection acceptance={agents.acceptance} connections={connections} patch={props.patch} busy={busy} />
    </div>
  );
}

/** Spend and ceilings summed over a run's connections; a ceiling is "none" when any connection's is, or none has one. */
function runTotals(run: AcceptanceRunView): { tokensIn: number; tokensOut: number; ceilingIn: Limit; ceilingOut: Limit; estimated: boolean } {
  let tokensIn = 0;
  let tokensOut = 0;
  let ceilingIn: Limit = 0;
  let ceilingOut: Limit = 0;
  let ceilings = 0;
  let estimated = false;
  for (const c of run.connections) {
    tokensIn += c.spent.tokensIn;
    tokensOut += c.spent.tokensOut;
    estimated ||= c.spent.estimated;
    if (c.ceiling === null) continue;
    ceilings += 1;
    ceilingIn = ceilingIn === "none" || c.ceiling.tokensIn === "none" ? "none" : ceilingIn + c.ceiling.tokensIn;
    ceilingOut = ceilingOut === "none" || c.ceiling.tokensOut === "none" ? "none" : ceilingOut + c.ceiling.tokensOut;
  }
  return ceilings === 0 ? { tokensIn, tokensOut, ceilingIn: "none", ceilingOut: "none", estimated } : { tokensIn, tokensOut, ceilingIn, ceilingOut, estimated };
}

/** The drawer's counter while an acceptance run is open: its label and what its guarded connections spent, summed, against their ceilings. */
export function AcceptanceBanner() {
  const app = useApp();
  const [state] = useAcceptance();
  const open = state?.run ?? null;
  if (open === null) return null;
  const t = runTotals(open);
  return (
    <div class="lre-acceptance-banner" data-lre-acceptance-banner>
      <Banner
        tone="info"
        actions={
          <Button size="sm" variant="ghost" icon="sliders" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "settings", settings: { page: "agents" } }))}>
            Settings → Agents
          </Button>
        }
      >
        <span class="lre-num">
          {`Acceptance run open · ${open.label} · in ${n(t.tokensIn)}/${ceilingText(t.ceilingIn)} · out ${n(t.tokensOut)}/${ceilingText(t.ceilingOut)}`}
          {t.estimated ? " · estimated" : ""}
        </span>
      </Banner>
    </div>
  );
}
