// Settings → Depth (DEPTH-PLAN §7; `shared/depth-settings.ts`): one page, phone-first at 390 px, every
// row in the settings kit (Changed, its default, Default). At the top the presets, Deepest, Balanced
// and Lean, each listing what it changes (from → to) before Apply, as Settings → Speed does. Then the
// two models you name once, Strong and Fast; a row per role (Author, Character agents, GM, Render
// check, Point-of-view render, Narrator, Historian, and real time's two: the character's answer and
// the author's watch), each on Strong, Fast or a model of its own, so every place depth uses a model
// is yours to choose (owner D-3); how often the author is offered a notebook revision; the budget
// dial with its ceilings; the narrator's window, redrafts, the preset's absorption and what the
// thinking block shows; how real-time dialogue starts; the background lanes; and the bootstrap's own
// settings. The body is hook-free, so tests press what it renders; `DepthSettingsPage` holds the
// preset being looked at.

import { useState } from "preact/hooks";
import type { AgentLimitDef } from "../../shared/agent-settings";
import { currentDepthPreset, DEPTH_CADENCE_LABEL, DEPTH_PRESET_WORDS, DEPTH_PRESETS, DEPTH_REASONING, DEPTH_ROLE_WORDS, DEPTH_ROLES, DEPTH_THRESHOLD_DEFAULT, DEPTH_TREATMENT_LABEL, DEPTH_TREATMENTS, DEPTH_USES_LABEL, defaultDepthSettings, depthPresetChanges, type DepthCadence, type DepthLimit, type DepthModel, type DepthPresetId, type DepthRole, type DepthSettings, type DepthUses } from "../../shared/depth-settings";
import type { JsonObject, JsonValue } from "../../shared/json";
import { Banner, Button, Field, HostModelPicker, HostSwitch, NumberStepper, Section, Seg } from "../components";
import { LimitRow, SettingRow } from "./kit";
import { type Connection, ConnectionSelect, EFFORT_LABEL } from "./steps";

/** The shipped settings the page compares against and resets to. */
const SHIPPED: Readonly<DepthSettings> = defaultDepthSettings();

/** A patch under `depth`. */
function depthPatch(fields: JsonObject): JsonObject {
  return { depth: fields };
}

const n = (value: number): string => value.toLocaleString("en-US");

/** A model in a line: "Its connection, its model · High" or "The helper model's · High". */
export function modelText(m: Readonly<DepthModel>, connections: readonly Connection[]): string {
  const connection = m.connectionId === null ? "The helper model's connection" : (connections.find((c) => c.id === m.connectionId)?.name ?? "A connection that's gone");
  return `${connection}${m.connectionId !== null && m.model ? `, ${m.model}` : ""} · ${EFFORT_LABEL[m.effort]} reasoning`;
}

/** Whether two models differ in anything the page sets. */
function modelChanged(a: Readonly<DepthModel>, b: Readonly<DepthModel>): boolean {
  return a.connectionId !== b.connectionId || a.model !== b.model || a.effort !== b.effort || a.maxTokens !== b.maxTokens;
}

/** How many of the page's settings differ from the shipped ones: Settings home's Changed count. */
export function depthChanged(depth: Readonly<DepthSettings>): number {
  const leaves = (value: JsonValue, base: JsonValue): number => {
    if (value !== null && base !== null && typeof value === "object" && typeof base === "object" && !Array.isArray(value) && !Array.isArray(base)) {
      return [...new Set([...Object.keys(value), ...Object.keys(base)])].reduce((sum, key) => sum + leaves(value[key] ?? null, base[key] ?? null), 0);
    }
    return JSON.stringify(value) === JSON.stringify(base) ? 0 : 1;
  };
  return leaves(depth as unknown as JsonValue, SHIPPED as unknown as JsonValue);
}

/** Settings home's line for Depth: the preset the settings are, or your own mix. */
export function depthSummary(depth: Readonly<DepthSettings>): string {
  const current = currentDepthPreset(depth);
  return current === null ? "Your own mix of models" : `${DEPTH_PRESET_WORDS[current].label} preset`;
}

/** One model's rows: its connection and model, its reasoning, and the room an answer gets. `set` patches the model's own fields. */
export function ModelRows(props: { id: string; owner: string; value: Readonly<DepthModel>; standard: Readonly<DepthModel>; connections: readonly Connection[]; busy: boolean; set(fields: JsonObject): void }) {
  const { value, standard, owner } = props;
  const connectionChanged = value.connectionId !== standard.connectionId || value.model !== standard.model;
  return (
    <div class="lre-depth-model" data-lre-depth-model={props.id}>
      <SettingRow
        id={`${props.id}.connection`}
        label="Connection and model"
        bare
        changed={connectionChanged}
        help={value.connectionId ? "Pick from the connection's models, or type one. Empty uses the connection's own model." : "None picked: the helper model's connection and model (Settings → Helper model)."}
        reset={{ label: `Reset ${owner}'s connection and model to their default, the helper model's`, to: "The helper model's", onClick: () => props.set({ connectionId: null, model: null }) }}
        busy={props.busy}
      >
        <ConnectionSelect value={value.connectionId} connections={props.connections} firstLabel="The helper model's" disabled={props.busy} onChange={(connectionId) => props.set({ connectionId, model: null })} />
        {value.connectionId ? <HostModelPicker connectionId={value.connectionId} value={value.model ?? ""} label={`${owner}: model`} onChange={(model) => props.set({ model: model || null })} /> : null}
      </SettingRow>
      <SettingRow id={`${props.id}.effort`} label="Reasoning" bare changed={value.effort !== standard.effort} reset={{ label: `Reset ${owner}'s reasoning to its default, ${EFFORT_LABEL[standard.effort]}`, to: EFFORT_LABEL[standard.effort], onClick: () => props.set({ effort: standard.effort }) }} busy={props.busy}>
        <label class="lre-field">
          <span class="label">{`${owner}: reasoning`}</span>
          <select class="lre-input" value={value.effort} disabled={props.busy} onChange={(event) => props.set({ effort: event.currentTarget.value })}>
            {DEPTH_REASONING.map((effort) => (
              <option key={effort} value={effort}>
                {EFFORT_LABEL[effort]}
              </option>
            ))}
          </select>
        </label>
      </SettingRow>
      <SettingRow id={`${props.id}.maxTokens`} label="Answer room" bare changed={value.maxTokens !== standard.maxTokens} help="The most tokens one answer may take, reasoning included." reset={{ label: `Reset ${owner}'s answer room to its default, ${n(standard.maxTokens)} tokens`, to: `${n(standard.maxTokens)} tokens`, onClick: () => props.set({ maxTokens: standard.maxTokens }) }} busy={props.busy}>
        <NumberStepper label={`${owner}: answer room (tokens)`} value={value.maxTokens} min={256} max={1_000_000} step={1024} integer disabled={props.busy} onChange={(maxTokens) => props.set({ maxTokens })} />
      </SettingRow>
    </div>
  );
}

/** A role's row: what it does, which model it runs on, and its own model's rows while it has one. */
export function RoleRow(props: { role: DepthRole; depth: Readonly<DepthSettings>; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void }) {
  const { role, depth } = props;
  const row = depth.roles[role];
  const standard = SHIPPED.roles[role];
  const words = DEPTH_ROLE_WORDS[role];
  const set = (fields: JsonObject) => props.patch(depthPatch({ roles: { [role]: fields } }));
  const runsOn = row.uses === "own" ? "its own model" : DEPTH_USES_LABEL[row.uses];
  return (
    <div class="lre-depth-role" data-lre-depth-role={role}>
      <SettingRow
        id={`role.${role}`}
        label={words.label}
        changed={row.uses !== standard.uses || (row.uses === "own" && modelChanged(row.own, standard.own))}
        help={<>{words.help} Runs on {runsOn}: {modelText(row.uses === "own" ? row.own : depth[row.uses], props.connections)}.</>}
        reset={{ label: `Reset ${words.label} to its default, the ${DEPTH_USES_LABEL[standard.uses]}`, to: DEPTH_USES_LABEL[standard.uses], onClick: () => set({ uses: standard.uses, own: { ...standard.own } }) }}
        busy={props.busy}
      >
        <Seg<DepthUses> label={`${words.label}: runs on`} value={row.uses} options={(["strong", "fast", "own"] as const).map((u) => ({ value: u, label: DEPTH_USES_LABEL[u] }))} disabled={props.busy} onChange={(uses) => set({ uses })} />
      </SettingRow>
      {row.uses === "own" ? <ModelRows id={`role.${role}.own`} owner={words.label} value={row.own} standard={standard.own} connections={props.connections} busy={props.busy} set={(fields) => set({ own: fields })} /> : null}
    </div>
  );
}

/** What a limit in tokens or a count reads as on the page. */
const LIMITS: Readonly<Record<"perTurn" | "perDay" | DepthTreatmentKey, AgentLimitDef>> = {
  perTurn: { label: "Per turn", limits: "All of depth's model work one turn may spend, on screen and off.", fires: "The author is told what the turn has left and spends by it. Once the ceiling binds, it plays itself the characters who had their own agents, and the scene goes on as far as it judges. A real-time line plays as a scene. The step after the reply puts off what it hasn't started. Each is said; nothing is skipped silently.", unit: "tokens", min: 1000, none: "a turn spends what its work takes" },
  perDay: { label: "Per day", limits: "All of depth's model work in one UTC day (midnight to midnight UTC, whatever your clock says), in every chat, the bootstrap apart.", fires: "As per turn, for every turn: the author spends less and says what it put off, until the day turns at midnight UTC.", unit: "tokens", min: 1000, none: "a day spends what its turns take" },
  live: { label: DEPTH_TREATMENT_LABEL.live, limits: "Events and characters played live off screen per story interval.", fires: "The author picks a cheaper treatment, or asks you when it judges the moment major.", unit: "count", min: 0, none: "as many as the author judges" },
  campfire: { label: DEPTH_TREATMENT_LABEL.campfire, limits: "Campfire treatments per story interval.", fires: "The author picks a cheaper treatment, or asks you.", unit: "count", min: 0, none: "as many as the author judges" },
  room: { label: DEPTH_TREATMENT_LABEL.room, limits: "Room treatments per story interval.", fires: "The author picks a cheaper treatment, or asks you.", unit: "count", min: 0, none: "as many as the author judges" },
  written: { label: DEPTH_TREATMENT_LABEL.written, limits: "Written treatments per story interval.", fires: "The author leaves the rest unwritten until it matters, and says so.", unit: "count", min: 0, none: "as many as the author judges" },
};
type DepthTreatmentKey = (typeof DEPTH_TREATMENTS)[number];

/** A limit row under `depth`: `path` is where its value sits, a reset puts the shipped one back. */
function DepthLimitRow(props: { id: string; def: AgentLimitDef; value: DepthLimit; standard: DepthLimit; busy: boolean; set(value: DepthLimit): void }) {
  return <LimitRow id={props.id} def={props.def} value={props.value} standard={props.standard} busy={props.busy} set={(value) => props.set(value ?? props.standard)} />;
}

/** A whole number as one setting: its stepper, its help, its default. */
function NumberRow(props: { id: string; label: string; unit: string; value: number; standard: number; min: number; max: number; step: number; help?: string; busy: boolean; set(value: number): void }) {
  const to = `${n(props.standard)}${props.unit ? ` ${props.unit}` : ""}`;
  return (
    <SettingRow id={props.id} label={props.label} bare changed={props.value !== props.standard} help={props.help} reset={{ label: `Reset ${props.label} to its default, ${to}`, to, onClick: () => props.set(props.standard) }} busy={props.busy}>
      <NumberStepper label={props.unit ? `${props.label} (${props.unit})` : props.label} value={props.value} min={props.min} max={props.max} step={props.step} integer disabled={props.busy} onChange={props.set} />
    </SettingRow>
  );
}

/** One of a few choices as one setting. */
function ChoiceRow<T extends string>(props: { id: string; label: string; value: T; standard: T; options: readonly { value: T; label: string }[]; help?: string; busy: boolean; set(value: T): void }) {
  const to = props.options.find((o) => o.value === props.standard)?.label ?? props.standard;
  return (
    <SettingRow id={props.id} label={props.label} changed={props.value !== props.standard} help={props.help} reset={{ label: `Reset ${props.label} to its default, ${to}`, to, onClick: () => props.set(props.standard) }} busy={props.busy}>
      <Seg<T> label={props.label} value={props.value} options={props.options} disabled={props.busy} onChange={props.set} />
    </SettingRow>
  );
}

/** The presets: the one the settings are, what the one you picked would change, Apply. */
export function DepthPresets(props: { depth: Readonly<DepthSettings>; picked: DepthPresetId | null; busy: boolean; onPick(id: DepthPresetId | null): void; patch(patch: JsonObject): void }) {
  const current = currentDepthPreset(props.depth);
  const pending = props.picked === null ? null : depthPresetChanges(props.depth, props.picked);
  const shown = props.picked ?? current;
  return (
    <Section title="Presets">
      <div class="lre-stack" data-lre-depth-presets>
        <Seg<DepthPresetId> label="Depth preset" value={shown} options={DEPTH_PRESETS.map((id) => ({ value: id, label: DEPTH_PRESET_WORDS[id].label }))} disabled={props.busy} onChange={(id) => props.onPick(id)} />
        <p class="lre-small lre-muted lre-depth-preset-summary">{shown === null ? "Your own mix: a role or the notebook's cadence differs from every preset." : DEPTH_PRESET_WORDS[shown].summary} Every preset simulates everything; they differ only in models and how often the author revises its notebook.</p>
        {pending && props.picked ? (
          pending.changes.length === 0 ? (
            <Banner tone="info" title={`Already ${DEPTH_PRESET_WORDS[props.picked].label}`} actions={<Button size="sm" variant="ghost" onClick={() => props.onPick(null)}>Close</Button>}>
              Every role and the cadence are as this preset sets them.
            </Banner>
          ) : (
            <div data-lre-depth-preset-changes={props.picked}>
              <Banner
                tone="info"
                title={`${DEPTH_PRESET_WORDS[props.picked].label} changes ${pending.changes.length} ${pending.changes.length === 1 ? "setting" : "settings"}`}
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      busy={props.busy}
                      onClick={() => {
                        props.patch(depthPatch(pending.patch as unknown as JsonObject));
                        props.onPick(null);
                      }}
                    >
                      Apply
                    </Button>
                    <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onPick(null)}>
                      Cancel
                    </Button>
                  </>
                }
              >
                <ul class="lre-depth-changes">
                  {pending.changes.map((c) => (
                    <li key={c.key} data-lre-depth-change={c.key}>
                      <span class="lre-depth-change-label">{c.label}</span>
                      <span class="lre-depth-change-move">
                        {c.from} → {c.to}
                      </span>
                    </li>
                  ))}
                </ul>
              </Banner>
            </div>
          )
        ) : null}
      </div>
    </Section>
  );
}

/** The page's body, hook-free: `picked` is the preset being looked at, `onPick` picks or closes one. */
export function DepthPage(props: { depth: Readonly<DepthSettings>; connections: readonly Connection[]; busy: boolean; picked: DepthPresetId | null; onPick(id: DepthPresetId | null): void; patch(patch: JsonObject): void }) {
  const { depth, busy, connections } = props;
  const set = (fields: JsonObject) => props.patch(depthPatch(fields));
  const b = depth.budget;
  const sb = SHIPPED.budget;
  const boot = depth.bootstrap;
  const sboot = SHIPPED.bootstrap;
  const cap = boot.cap === "none" ? null : boot.cap;
  const standardCap = sboot.cap === "none" ? null : sboot.cap;
  return (
    <div class="lre-stack lre-depth-settings" data-lre-settings-page="depth">
      <p class="lre-set-lead">Depth simulates each chat that opts in (GM → This chat → Depth): an author who runs each scene, characters who play from minds of their own, a GM who resolves and keeps the truth, and a narrator who renders what was decided. Every place it uses a model is yours to choose here.</p>
      <DepthPresets depth={depth} picked={props.picked} busy={busy} onPick={props.onPick} patch={props.patch} />
      <Section title="Models" flush>
        <div class="lre-set-rows" data-lre-depth-group="models">
          <p class="lre-small lre-muted lre-depth-note">Name two models once; each role below runs on one of them, or on a model of its own.</p>
          <h4 class="lre-depth-subhead">Strong model</h4>
          <ModelRows id="strong" owner="Strong model" value={depth.strong} standard={SHIPPED.strong} connections={connections} busy={busy} set={(fields) => set({ strong: fields })} />
          <h4 class="lre-depth-subhead">Fast model</h4>
          <ModelRows id="fast" owner="Fast model" value={depth.fast} standard={SHIPPED.fast} connections={connections} busy={busy} set={(fields) => set({ fast: fields })} />
        </div>
      </Section>
      <Section title="Roles" flush>
        <div class="lre-set-rows" data-lre-depth-group="roles">
          {DEPTH_ROLES.map((role) => (
            <RoleRow key={role} role={role} depth={depth} connections={connections} busy={busy} patch={props.patch} />
          ))}
          <NumberRow id="catchUpBatch" label="Beats per catch-up" unit="" value={depth.catchUpBatch} standard={SHIPPED.catchUpBatch} min={1} max={1000} step={5} help="The most beats one catch-up call lives when a character lives what reached them; more waiting are lived over several calls, in order." busy={busy} set={(catchUpBatch) => set({ catchUpBatch })} />
        </div>
      </Section>
      <Section title="The author" flush>
        <div class="lre-set-rows" data-lre-depth-group="author">
          <ChoiceRow<DepthCadence> id="cadence" label="Notebook revisions" value={depth.cadence} standard={SHIPPED.cadence} options={(["turns", "scenes", "chapters"] as const).map((c) => ({ value: c, label: DEPTH_CADENCE_LABEL[c] }))} help="The lightest revision the author is offered: it still judges whether anything moved enough to revise." busy={busy} set={(cadence) => set({ cadence })} />
          <ChoiceRow<"judged" | "chip"> id="realtime" label="Real-time dialogue starts" value={depth.realtime} standard={SHIPPED.realtime} options={[{ value: "judged", label: "When the author judges" }, { value: "chip", label: "Only from the chip" }]} help="Talking with someone line by line: the author enters it when the moment is a conversation, or only when you tap the chip." busy={busy} set={(realtime) => set({ realtime })} />
          <NumberRow id="steps" label="Steps per turn" unit="" value={depth.steps} standard={SHIPPED.steps} min={1} max={100} step={1} help="The most steps the author takes between beats in one turn. It is told as the turn nears them, and past them you answer and the scene goes on next turn." busy={busy} set={(steps) => set({ steps })} />
        </div>
      </Section>
      <Section title="Budget" flush>
        <div class="lre-set-rows" data-lre-depth-group="budget">
          <ChoiceRow<"day" | "week" | "month"> id="budget.interval" label="Allowances per" value={b.interval} standard={sb.interval} options={[{ value: "day", label: "Story day" }, { value: "week", label: "Story week" }, { value: "month", label: "Story month" }]} help="The story-time interval the allowances below count over." busy={busy} set={(interval) => set({ budget: { interval } })} />
          {DEPTH_TREATMENTS.map((t) => (
            <DepthLimitRow key={t} id={`budget.${t}`} def={LIMITS[t]} value={b.allowances[t]} standard={sb.allowances[t]} busy={busy} set={(value) => set({ budget: { allowances: { [t]: value } } })} />
          ))}
          <SettingRow id="budget.ask" label="Ask me" bare changed={b.ask !== sb.ask} help="When an allowance is spent and the author judges a moment major, it asks you with a chip before spending more." reset={{ label: "Reset Ask me to its default, on", to: "On", onClick: () => set({ budget: { ask: sb.ask } }) }} busy={busy}>
            <HostSwitch label="Ask me before spending past an allowance" checked={b.ask} disabled={busy} onChange={(ask) => set({ budget: { ask } })} />
          </SettingRow>
          <SettingRow id="budget.threshold" label="What deserves more than written" changed={b.threshold !== sb.threshold} help="Guidance in your words: the author grades each candidate against it, and every grade shows with its reason." reset={{ label: "Reset the threshold to its shipped words", to: "the shipped words", onClick: () => set({ budget: { threshold: DEPTH_THRESHOLD_DEFAULT } }) }} busy={busy}>
            <Field label="Threshold">
              <textarea class="lre-input lre-depth-threshold" rows={3} value={b.threshold} disabled={busy} aria-label="What deserves more than written" onChange={(event) => set({ budget: { threshold: event.currentTarget.value } })} />
            </Field>
          </SettingRow>
          <DepthLimitRow id="budget.perTurn" def={LIMITS.perTurn} value={b.perTurn} standard={sb.perTurn} busy={busy} set={(perTurn) => set({ budget: { perTurn } })} />
          <DepthLimitRow id="budget.perDay" def={LIMITS.perDay} value={b.perDay} standard={sb.perDay} busy={busy} set={(perDay) => set({ budget: { perDay } })} />
        </div>
      </Section>
      <Section title="The narrator" flush>
        <div class="lre-set-rows" data-lre-depth-group="narrator">
          <NumberRow id="window.messages" label="Recent messages" unit="" value={depth.window.messages} standard={SHIPPED.window.messages} min={0} max={200} step={1} help="The raw window the narrator reads for voice and continuity: the latest messages, up to the tokens below." busy={busy} set={(messages) => set({ window: { messages } })} />
          <NumberRow id="window.tokens" label="Recent window" unit="tokens" value={depth.window.tokens} standard={SHIPPED.window.tokens} min={0} max={1_000_000} step={1000} busy={busy} set={(tokens) => set({ window: { tokens } })} />
          <NumberRow id="redrafts" label="Redrafts per passage" unit="" value={depth.redrafts} standard={SHIPPED.redrafts} min={0} max={10} step={1} help="A passage that still departs from its beat after these streams with a chip naming where; Re-narrate renders it again." busy={busy} set={(redrafts) => set({ redrafts })} />
          <ChoiceRow<"keep" | "narrator"> id="absorption" label="Your preset" value={depth.absorption} standard={SHIPPED.absorption} options={[{ value: "keep", label: "Keep it" }, { value: "narrator", label: "LRE's only" }]} help="Keep it: every block of your preset stays, the history replaced by depth's context. LRE's only: the narrator's own template." busy={busy} set={(absorption) => set({ absorption })} />
          <ChoiceRow<"whole" | "progress"> id="thinking" label="The thinking block shows" value={depth.thinking} standard={SHIPPED.thinking} options={[{ value: "whole", label: "Everything" }, { value: "progress", label: "Progress only" }]} help="Everything: the author's whole thinking, each beat as it is decided and each passage's check. Progress only: a line per stage." busy={busy} set={(thinking) => set({ thinking })} />
        </div>
      </Section>
      <Section title="Background lanes" flush>
        <div class="lre-set-rows" data-lre-depth-group="background">
          <SettingRow id="background.on" label="Background lanes" bare changed={depth.background.on !== SHIPPED.background.on} help="On, the author's poll runs after each reply, with the catch-ups, reflections, notebook revisions and work off screen it asks for. Off, only what the next turn reads runs after a reply: each character who played remembers it, and the GM's truth links. The rest waits until you turn this back on, and the next poll then reads every turn since the last one; meanwhile what reached each character waits to be lived (GM → Minds), and a scene that reaches an open draft still settles it first." reset={{ label: "Reset Background lanes to its default, on", to: "On", onClick: () => set({ background: { on: SHIPPED.background.on } }) }} busy={busy}>
            <HostSwitch label="Work between turns" checked={depth.background.on} disabled={busy} onChange={(on) => set({ background: { on } })} />
          </SettingRow>
          <NumberRow id="background.atOnce" label="Background calls at once" unit="" value={depth.background.atOnce} standard={SHIPPED.background.atOnce} min={1} max={16} step={1} help="Depth's calls between turns (after a reply, off screen, your presses in GM → Minds and Depth) under way at once on one connection; more wait their turn. A turn's own calls never wait behind them: they go first, and where a connection's Calls at once (Settings → Agents → Throttles) is full, a background call gives its place to the turn's and is asked again after, its prompt counted as spent. The bootstrap keeps to its own at-once settings below, and gives way the same." busy={busy} set={(atOnce) => set({ background: { atOnce } })} />
        </div>
      </Section>
      <Section title="Bootstrap" flush>
        <div class="lre-set-rows" data-lre-depth-group="bootstrap">
          <p class="lre-small lre-muted lre-depth-note">Onboarding a chat with history (GM → This chat → Depth): canon beats from the prose, minds from each character's own experience, the author's notebook chapter by chapter.</p>
          <NumberRow id="bootstrap.chunkTokens" label="Chunk size" unit="tokens" value={boot.chunkTokens} standard={sboot.chunkTokens} min={2000} max={200_000} step={1000} help="Whole messages up to this many tokens make one chunk of history. The historian asks for all the room its model takes (only what it uses is spent), or the Historian's own answer room where you set one, and an answer cut off at it is asked once more at twice it. A chunk the model can't finish within its output limit keeps being cut: make it smaller." busy={busy} set={(chunkTokens) => set({ bootstrap: { chunkTokens } })} />
          <NumberRow id="bootstrap.historian" label="Historian chunks at once" unit="" value={boot.atOnce.historian} standard={sboot.atOnce.historian} min={1} max={8} step={1} busy={busy} set={(historian) => set({ bootstrap: { atOnce: { historian } } })} />
          <NumberRow id="bootstrap.minds" label="Minds at once" unit="" value={boot.atOnce.minds} standard={sboot.atOnce.minds} min={1} max={16} step={1} help="Memory grows with the jobs in flight, not with the chat." busy={busy} set={(minds) => set({ bootstrap: { atOnce: { minds } } })} />
          <NumberRow id="bootstrap.author" label="Author chunks at once" unit="" value={boot.atOnce.author} standard={sboot.atOnce.author} min={1} max={4} step={1} busy={busy} set={(author) => set({ bootstrap: { atOnce: { author } } })} />
          <SettingRow id="bootstrap.cap" label="The run's cap" changed={JSON.stringify(boot.cap) !== JSON.stringify(sboot.cap)} help="At the cap the run pauses and says how far it got and what the rest would cost. Each run's own cap is set before it starts." reset={{ label: "Reset the run's cap to its default", to: standardCap ? `${n(standardCap.value)} ${standardCap.unit === "money" ? "in money" : "tokens"}` : "No cap", onClick: () => set({ bootstrap: { cap: sboot.cap } }) }} busy={busy}>
            <HostSwitch label="No cap" checked={cap === null} disabled={busy} onChange={(none) => set({ bootstrap: { cap: none ? "none" : (standardCap ?? { unit: "tokens", value: 20_000_000 }) } })} />
            {cap ? (
              <>
                <Seg<"tokens" | "money"> label="Cap in" value={cap.unit} options={[{ value: "tokens", label: "Tokens" }, { value: "money", label: "Money" }]} disabled={busy} onChange={(unit) => set({ bootstrap: { cap: { unit, value: unit === cap.unit ? cap.value : unit === "money" ? 20 : 20_000_000 } } })} />
                <NumberStepper label={cap.unit === "money" ? "Cap (in your connection's money)" : "Cap (tokens)"} value={cap.value} min={1} step={cap.unit === "money" ? 5 : 1_000_000} integer={cap.unit === "tokens"} disabled={busy} onChange={(value) => set({ bootstrap: { cap: { unit: cap.unit, value } } })} />
              </>
            ) : null}
          </SettingRow>
          <NumberRow id="bootstrap.sample" label="Spot checks per chapter" unit="" value={boot.sample} standard={sboot.sample} min={0} max={50} step={1} help="A random sample beside its source, plus everything the run flagged as uncertain." busy={busy} set={(sample) => set({ bootstrap: { sample } })} />
          <NumberRow id="bootstrap.pauseAfterWrong" label="Wrong marks that pause it" unit="" value={boot.pauseAfterWrong} standard={sboot.pauseAfterWrong} min={1} max={50} step={1} help="Marks in a row: the run pauses and offers Redo from that chapter with other models." busy={busy} set={(pauseAfterWrong) => set({ bootstrap: { pauseAfterWrong } })} />
        </div>
      </Section>
    </div>
  );
}

/** Settings → Depth: the body with the preset being looked at. */
export function DepthSettingsPage(props: { depth: Readonly<DepthSettings>; connections: readonly Connection[]; busy: boolean; patch(patch: JsonObject): void }) {
  const [picked, setPicked] = useState<DepthPresetId | null>(null);
  return <DepthPage depth={props.depth} connections={props.connections} busy={props.busy} picked={picked} onPick={setPicked} patch={props.patch} />;
}
