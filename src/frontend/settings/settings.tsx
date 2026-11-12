// Settings (DESIGN §12): a home list of pages in groups, each page under a header with Back, and a
// page with pages of its own opening each under its own header. Getting started: Helper model, Model
// use, Steps and connections, Minds, Narrator, Timeouts. The story engine: Story (the harness's
// models, budget, minds, preparing and the record's limits, `story.tsx`). Agents: Agents (a turn at a glance, every
// agent call's switches, and its sections, each a page of its own: Pipeline, Review card, System
// instructions, Budgets, Compaction, Recording, Throttles, Caching, Acceptance runs), Roles (a row
// per role, each opening the role's page), Context (what each role starts with, each row opening the
// role's page at What it reads), Main agent and Assistant (on the role page's template), Prompts,
// every text sent to a model (DESIGN §6.12), and Retention (how long the agents' stored texts are
// kept). Defaults for new chats: Realism, Checks, Time. Replies: Changes from the reply, Swipes. Your
// preset. Display: Show ids. About: Caveats, fetched on their own (a dry run of the chat) by home
// and the Caveats page, and Diagnostics (each turn's steps, model calls and failures; behind its own
// curtain). Where Settings is, is UI state (`ui.settings`, a `SettingsRoute`), so it holds while the
// drawer switches modes; Back and Escape go up one level (`settingsBack`), and focus returns to the
// row that opened the page left (`settingsFocus`). A running chat's own rules (realism, checks, time,
// pins and Upgrade) live in GM → This chat. While the open chat plays on the harness, Settings' list
// says so, and the pages that set up the classic and agents engines open with a note that says what
// of them the chat uses and where the harness's own agents are set up (`EngineNote`).

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { ROLE_IDS, ROLE_LABEL, type RoleId } from "../../shared/agent-roles";
import { hasOwn, type JsonObject, type JsonValue } from "../../shared/json";
import { mergeAdjusted, type MergeAdjustment } from "../../shared/json-patch";
import type { PromptDef } from "../../shared/prompts";
import type { PromptTestView, SettingsResult } from "../../shared/protocol";
import type { RouteSettings } from "../../shared/role-routes";
import { CHANGE_TYPES, stepConfigOf } from "../../shared/settings";
import type { StateView } from "../../shared/state-view";
import type { StepPurpose } from "../../shared/world";
import { ADJUDICATION_PRESET_LABEL } from "../../shared/adjudication";
import { STEP_LABEL } from "../../shared/steps";
import type { SettingsPage, SettingsRoute } from "../app";
import { settingsBack, settingsFocus, useApp, useUi, useView } from "../app";
import { Badge, Banner, Button, Empty, HostSwitch, List, ListRow, PageHeader, Section, useBusy, useShowIds } from "../components";
import { humanize } from "../format";
import type { IconName } from "../icons";
import { revealInScroller } from "../scroll";
import { HARNESS_MODE } from "../harness/mode";
import { useSelect } from "../store";
import { DiagnosticsPage } from "../diagnostics";
import { McpServerPage } from "../agents";
import { ChecksPage, RealismPage, TimePage } from "./defaults";
import { MindsSection } from "./minds";
import { NarratorPage, narratorViewSummary } from "./narrator";
import { PresetPage } from "./preset";
import { ExtractionPage, SwipesPage } from "./replies";
import { type Connection, HelperSection, helperSummary, ModelUseSection, StepsSection, useConnections } from "./steps";
import { AgentsHub, AgentsSubPage, agentsSummary } from "./agents";
import { AssistantPage, assistantSummary } from "./assistant";
import { ContextPage, contextSummary } from "./context";
import { MainAgentPage, mainSummary } from "./main-agent";
import { RolePage } from "./role-page";
import { RolesPage, rolesSummary } from "./roles";
import { assistantChanged, mainChanged, agentsChanged, rolesChanged } from "./changed";
import { adjustedText, AGENTS_SUB, AGENTS_SUBS, ENGINE_NOTE_PAGES, engineNote, ROLE_PLAIN, type AgentsSub } from "./labels";
import { limitText, TimeoutsSection } from "./timeouts";
import { RetentionPage, retentionSummary } from "./retention";
import { LorePage, loreSummary } from "./lore";
import { ownTextCount, promptTestRequest, PromptsPage } from "./agent-prompts";
import { SpeedPage, speedSummary } from "./speed";
import { narrationChanged, STORY_SUB, STORY_SUBS, storyChanged, StoryHub, StorySubPage, storySummary, type StorySub } from "./story";
import { speedChanged } from "../../shared/speed-presets";

type Page = Exclude<SettingsPage, "home">;
type Caveat = { code: string; message: string };

/** Caveats that say a check is still running, not a warning: shown as information and never counted as one. */
const STILL_CHECKING: Readonly<Record<string, true>> = { preset_lint_pending: true, step_model_unchecked: true };

/** The page a caveat's fix is on: its banner opens it (the connection pre-flight's, DESIGN §5.3). */
const CAVEAT_FIX: Readonly<Record<string, Page>> = { step_connection_missing: "steps", step_model_missing: "steps", step_model_unchecked: "steps" };

const PAGE: Record<Page, { title: string; subtitle: string; icon: IconName }> = {
  helper: { title: "Helper model", subtitle: "What the engine's model calls run on", icon: "sliders" },
  model: { title: "Model use", subtitle: "How much the engine asks a model", icon: "bolt" },
  steps: { title: "Steps and connections", subtitle: "Which model runs each step", icon: "branch" },
  minds: { title: "Minds", subtitle: "How characters think and remember", icon: "sparkle" },
  narrator: { title: "Narrator", subtitle: "What the narrator knows, and what of a secret", icon: "eye" },
  timeouts: { title: "Timeouts", subtitle: "How long each wait may run", icon: "hourglass" },
  agents: { title: "Agents", subtitle: "A turn at a glance, and what every agent runs under", icon: "function" },
  speed: { title: "Speed", subtitle: "How long a turn takes, and where the last one's time went", icon: "fast-forward" },
  roles: { title: "Roles", subtitle: "Each part of an agent turn, and where it runs", icon: "branch" },
  context: { title: "Context", subtitle: "What each role starts with", icon: "layers" },
  main: { title: "Main agent", subtitle: "Decides each turn, when the pipeline has one, and reviews the narrator's prompt", icon: "sparkle" },
  assistant: { title: "Assistant", subtitle: "The GM assistant's model and budget", icon: "message" },
  realism: { title: "Realism", subtitle: "For new chats", icon: "layers" },
  checks: { title: "Checks", subtitle: "For new chats", icon: "dice" },
  time: { title: "Time", subtitle: "For new chats", icon: "clock" },
  extraction: { title: "Changes from the reply", subtitle: "Auto, Confirm or Never, per type", icon: "checklist" },
  swipes: { title: "Swipes", subtitle: "What a swipe does", icon: "refresh" },
  preset: { title: "Preset", subtitle: "Your Lumiverse preset and LumiRPEngine", icon: "scroll" },
  lore: { title: "Lore", subtitle: "Which World Info books are read, and the lore index", icon: "book" },
  display: { title: "Display", subtitle: "How LumiRPEngine looks on this device", icon: "eye" },
  caveats: { title: "Caveats", subtitle: "What to know", icon: "info" },
  diagnostics: { title: "Diagnostics", subtitle: "What the engine did each turn, and what failed", icon: "list" },
  mcp: { title: "MCP server", subtitle: "Your agent's lumirpengine, and how it follows updates", icon: "branch" },
  prompts: { title: "Prompts", subtitle: "Every text sent to a model, yours to edit", icon: "edit" },
  retention: { title: "Retention", subtitle: "Which turns keep their transcripts, and how long the agents' stored texts are kept", icon: "box" },
  story: { title: "Story", subtitle: "The story engine: models, budget, minds, preparing and the record's limits", icon: "book" },
};

/** The home list's groups, in order, each with its pages. */
export const HOME_GROUPS: readonly { title: string; pages: readonly Page[] }[] = [
  { title: "Getting started", pages: ["helper", "model", "steps", "minds", "narrator", "timeouts"] },
  { title: "The story engine", pages: ["story"] },
  { title: "Agents", pages: ["agents", "speed", "roles", "context", "main", "assistant", "prompts", "retention"] },
  { title: "Defaults for new chats", pages: ["realism", "checks", "time"] },
  { title: "Replies", pages: ["extraction", "swipes"] },
  { title: "Your preset", pages: ["preset"] },
  { title: "World Info", pages: ["lore"] },
  { title: "Display", pages: ["display"] },
  { title: "Your agent", pages: ["mcp"] },
  { title: "About", pages: ["caveats", "diagnostics"] },
];

const STATIC_CAVEATS = [
  "Lumiverse's World Info works as usual in world chats. A secret mark in an entry's text ({{// Secret …: …}}) reaches the narrator marked as a secret, or not at all, as the chat's narrator view says; when LumiRPEngine fails on a prompt or runs out of time for it, Lumiverse strips the mark itself, so the secret stays out. An entry an earlier build keeps secret stays switched off in its book until that book's secrecy moves to marks (Build → Lore); one you switched back on yourself goes into such a prompt unmarked.",
  "Moving a book's secrecy to marks (Build → Lore → Secrecy in your World Info) writes each copy of a secret's text that an earlier build kept switched off as the same secret mark before it switches the copy back as it stood, so Lumiverse strips it from any prompt LumiRPEngine doesn't mark, even in a chat that reads the copy's book and not the secret's. A copy whose text a mark can't hold stays switched off.",
  "Realism, checks and time settings seed new chats only, after a world's own defaults unless you turn on Use my settings. Change a running chat in GM → This chat.",
  "Undo covers the latest reply; earlier changes go through Keep or Discard.",
];

/** A page within a page that names one of its own: an Agents section, a role on Roles or Context, or one of Story's pages. */
function subOf(route: SettingsRoute): { agents: AgentsSub } | { role: RoleId } | { story: StorySub } | null {
  const sub = route.sub;
  if (sub === undefined) return null;
  if (route.page === "agents") return (AGENTS_SUBS as readonly string[]).includes(sub) ? { agents: sub as AgentsSub } : null;
  if (route.page === "roles" || route.page === "context") return (ROLE_IDS as readonly string[]).includes(sub) ? { role: sub as RoleId } : null;
  if (route.page === "story") return (STORY_SUBS as readonly string[]).includes(sub) ? { story: sub as StorySub } : null;
  return null;
}

/** A page's header: its title and subtitle, and what its Back goes back to. Home has none. */
export function settingsHeader(route: SettingsRoute): { title: string; subtitle: string; backLabel: string } | null {
  if (route.page === "home") return null;
  const sub = subOf(route);
  if (sub === null) return { ...PAGE[route.page], backLabel: "Settings" };
  if ("agents" in sub) return { title: AGENTS_SUB[sub.agents].title, subtitle: AGENTS_SUB[sub.agents].subtitle, backLabel: PAGE[route.page].title };
  if ("story" in sub) return { title: STORY_SUB[sub.story].title, subtitle: STORY_SUB[sub.story].subtitle, backLabel: PAGE[route.page].title };
  return { title: ROLE_LABEL[sub.role], subtitle: ROLE_PLAIN[sub.role], backLabel: PAGE[route.page].title };
}

/** What a key press on a page does: Escape goes back, as it pops a sheet in Play, unless a control handled it first. */
export function settingsKeyDown(event: { key: string; defaultPrevented: boolean; preventDefault(): void }, back: () => void): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  event.preventDefault();
  back();
}

/** Each home row's one-line summary of the page behind it, and how many of its settings are changed; `caveats` is null while they're checked. */
function summaryOf(page: Page, data: SettingsResult, caveats: readonly Caveat[] | null, showIds: boolean, connections: readonly Connection[]): { subtitle?: string; value?: string; badge?: ComponentChildren } {
  const { settings } = data;
  const changed = (count: number) => (count > 0 ? { badge: <Badge tone="accent">{`${count} changed`}</Badge> } : {});
  switch (page) {
    case "helper":
      return { subtitle: helperSummary(settings.helper, connections) };
    case "model":
      return { subtitle: `${humanize(settings.modelUse.preset)} preset` };
    case "minds":
      return { subtitle: settings.minds.enabled ? `On · ${settings.minds.liveLimit === "none" ? "no Live limit" : `up to ${settings.minds.liveLimit} Live a turn`}` : "Off" };
    case "narrator":
      return { subtitle: narratorViewSummary(settings.narrator) };
    case "timeouts":
      return { subtitle: `Engine run ${limitText(settings.timeouts.engineRunMs)} · reading the reply ${limitText(settings.timeouts.postReplyMs)}` };
    case "agents":
      return { subtitle: agentsSummary(settings.agents), ...changed(agentsChanged(settings.agents)) };
    case "speed":
      return { subtitle: speedSummary(settings), ...changed(speedChanged(settings)) };
    case "roles":
      return { subtitle: rolesSummary(settings.agents), ...changed(rolesChanged(settings.agents)) };
    case "context":
      return { subtitle: contextSummary(settings.agents) };
    case "main":
      return { subtitle: mainSummary(settings.agents, connections), ...changed(mainChanged(settings.agents, settings.timeouts)) };
    case "assistant":
      return { subtitle: assistantSummary(settings.agents.assistant, connections), ...changed(assistantChanged(settings.agents)) };
    case "steps": {
      const purposes = Object.keys(STEP_LABEL) as StepPurpose[];
      const on = purposes.filter((purpose) => stepConfigOf(settings.modelUse.steps, purpose).enabled).length;
      return { subtitle: `${on} of ${purposes.length} steps on` };
    }
    case "realism":
      return { subtitle: settings.overrideWorldDefaults ? `${humanize(settings.realism.preset)} for new chats` : `World defaults, then ${humanize(settings.realism.preset)}` };
    case "checks":
      return { subtitle: settings.overrideWorldAdjudication ? `${ADJUDICATION_PRESET_LABEL[settings.adjudication.preset]} for new chats` : `World rules, then ${ADJUDICATION_PRESET_LABEL[settings.adjudication.preset]}` };
    case "time":
      return { subtitle: `${settings.time.scale}× scale · montage by ${settings.time.montage === "key" ? "key moments" : settings.time.montage}` };
    case "extraction": {
      const pinned = CHANGE_TYPES.filter((type) => data.extraction[type]?.source === "pinned").length;
      return { subtitle: pinned > 0 ? `${pinned} pinned, the rest learn` : "Every type learns from you" };
    }
    case "swipes":
      return { subtitle: `${settings.swipeDefault === "rerun" ? "Re-run by default" : "Re-narrate by default"}${settings.swipeAsk ? " · asks what should change" : ""} · Swipes send ${settings.swipeTexts === "turn" ? "the turn's texts" : "your current texts"}` };
    case "preset":
      return { subtitle: settings.hideJsonBlocks ? "JSON blocks hidden in world chats" : "JSON blocks shown" };
    case "lore":
      return { subtitle: loreSummary(settings.loreBooks, settings.loreIndex) };
    case "display":
      return { subtitle: "Show ids", value: showIds ? "On" : "Off" };
    case "caveats": {
      // A check still running isn't a warning: the row says it's checking until the dry run answers.
      const found = caveats?.filter((c) => !hasOwn(STILL_CHECKING, c.code)) ?? [];
      if (caveats === null || (found.length === 0 && caveats.length > 0)) return { subtitle: "Checking your preset…" };
      return found.length > 0 ? { subtitle: "Warnings and what to know", badge: <Badge tone="warn">{`${found.length} active`}</Badge> } : { subtitle: "What to know" };
    }
    case "diagnostics":
      return { subtitle: "Each turn's steps, model calls and errors" };
    case "mcp":
      return { subtitle: "The setup that follows LumiRPEngine, and each server's state" };
    case "prompts": {
      const own = ownTextCount(settings.prompts);
      return { subtitle: own === 0 ? "Every text as shipped" : `${own} ${own === 1 ? "text" : "texts"} of your own` };
    }
    case "retention":
      return { subtitle: retentionSummary(settings.retention) };
    case "story":
      return { subtitle: storySummary(settings.story), ...changed(storyChanged(settings.story) + narrationChanged(settings.narration)) };
  }
}

function Home(props: { data: SettingsResult; caveats: readonly Caveat[] | null; connections: readonly Connection[]; note: ComponentChildren; open(page: Page): void }) {
  const showIds = useShowIds();
  return (
    <div class="lre-stack lre-set-home" data-lre-settings-page="home">
      <PageHeader title="Settings" subtitle="Yours, for every world chat" />
      {props.note}
      {HOME_GROUPS.map((group) => (
        <Section key={group.title} title={group.title} flush>
          <List>
            {group.pages.map((page) => {
              const summary = summaryOf(page, props.data, props.caveats, showIds, props.connections);
              return (
                <div key={page} class="lre-set-home-row" data-lre-settings={page}>
                  <ListRow icon={PAGE[page].icon} title={PAGE[page].title} subtitle={summary.subtitle} value={summary.value} valueTone="muted" badge={summary.badge} chevron onClick={() => props.open(page)} />
                </div>
              );
            })}
          </List>
        </Section>
      ))}
    </div>
  );
}

function DisplayPage() {
  const app = useApp();
  const showIds = useShowIds();
  return (
    <div class="lre-stack" data-lre-settings-page="display">
      <Section>
        <div class="lre-field" data-lre-show-ids>
          <HostSwitch label="Show ids" checked={showIds} onChange={(next) => app.ui.update((ui) => ({ ...ui, showIds: next }))} />
          <span class="lre-field-help">Shows the id the engine and world files use beside each name, in Build and GM; never in Play, where an id can say what a name keeps back. Handy when you write rules or read a world's files. Kept on this device.</span>
        </div>
      </Section>
    </div>
  );
}

function CaveatsPage(props: { caveats: readonly Caveat[] | null; open(page: Page): void }) {
  return (
    <div class="lre-stack" data-lre-settings-page="caveats">
      {props.caveats === null ? (
        <Empty>Checking your preset against this chat…</Empty>
      ) : props.caveats.length > 0 ? (
        <div class="lre-stack">
          {props.caveats.map((caveat) => {
            const fix = hasOwn(CAVEAT_FIX, caveat.code) ? CAVEAT_FIX[caveat.code] : undefined;
            return (
              <div key={caveat.code} data-lre-caveat={caveat.code}>
                <Banner
                  tone={hasOwn(STILL_CHECKING, caveat.code) ? "info" : "warn"}
                  actions={
                    fix ? (
                      <Button size="sm" variant="secondary" icon={PAGE[fix].icon} onClick={() => props.open(fix)}>
                        {`Open ${PAGE[fix].title}`}
                      </Button>
                    ) : undefined
                  }
                >
                  {caveat.message}
                </Banner>
              </div>
            );
          })}
        </div>
      ) : (
        <Empty icon="check">No warnings right now.</Empty>
      )}
      <Section title="Good to know" flush>
        <List>
          {STATIC_CAVEATS.map((text) => (
            <ListRow key={text} icon="info" title={<span class="lre-set-caveat">{text}</span>} />
          ))}
        </List>
      </Section>
    </div>
  );
}

/** What a page needs besides the settings: the connections, the caveats, the open chat's view and Test, and the way to another page. */
export interface BodyContext {
  connections: readonly Connection[];
  caveats: readonly Caveat[] | null;
  view: StateView | null;
  test?: (def: PromptDef, text: string) => Promise<PromptTestView | null>;
  busy: boolean;
  patch(patch: JsonObject): void;
  go(route: SettingsRoute): void;
}

/**
 * The note a page opens with while the open chat plays on the harness, without hooks: on a page that
 * sets up the classic and agents engines, that this chat doesn't use it (or which part of it), what
 * the harness is, and the way to where its agents are set up; on Settings' own list, which engine
 * this chat plays. Nothing on any other page, on a section of Agents (the note on Agents names the
 * ones the harness reads), or for a chat on another engine. The page under it stays whole: the
 * user's other chats may play on it.
 */
export function EngineNote(props: { route: SettingsRoute; engine: StateView["engine"]; onOpen(): void }) {
  if (props.engine !== "harness") return null;
  if (props.route.page === "agents" && props.route.sub !== undefined) return null;
  const kind = ENGINE_NOTE_PAGES[props.route.page];
  if (kind === undefined) return null;
  const note = engineNote(kind);
  return (
    <div class="lre-set-engine-note" data-lre-engine-note={kind}>
      <Banner
        tone="info"
        title={note.title}
        actions={
          <Button icon={HARNESS_MODE.icon} onClick={props.onOpen}>
            {`Open ${HARNESS_MODE.label}`}
          </Button>
        }
      >
        {note.text}
      </Banner>
    </div>
  );
}

/** The body of the page `route` names, without hooks of its own: a page within a page where the route names one it has, else the page itself. */
export function SettingsBody(props: { route: SettingsRoute; data: SettingsResult; ctx: BodyContext }) {
  const { route, data, ctx } = props;
  const { settings } = data;
  const { busy, patch, go, connections } = ctx;
  const routes: RouteSettings = { modelUse: settings.modelUse, helper: settings.helper };
  const sub = subOf(route);
  if (sub !== null && "agents" in sub) return <AgentsSubPage sub={sub.agents} agents={settings.agents} connections={connections} busy={busy} patch={patch} go={go} />;
  if (sub !== null && "story" in sub) return <StorySubPage sub={sub.story} story={settings.story} narration={settings.narration} view={ctx.view} busy={busy} patch={patch} />;
  if (sub !== null) return <RolePage id={sub.role} agents={settings.agents} routes={routes} prompts={settings.prompts} connections={connections} busy={busy} patch={patch} go={go} />;
  switch (route.page) {
    case "home":
      return null;
    case "helper":
      return <HelperSection helper={settings.helper} modelUse={settings.modelUse} agents={settings.agents} patch={patch} busy={busy} />;
    case "model":
      return <ModelUseSection modelUse={settings.modelUse} meter={ctx.view?.meter ?? null} patch={patch} openTimeouts={() => go({ page: "timeouts" })} busy={busy} />;
    case "steps":
      return <StepsSection modelUse={settings.modelUse} helper={settings.helper} agents={settings.agents} jobs={settings.jobs} gates={settings.gates} prompts={settings.minds.prompts} patch={patch} openHelper={() => go({ page: "helper" })} busy={busy} />;
    case "minds":
      return <MindsSection minds={settings.minds} patch={patch} busy={busy} />;
    case "narrator":
      return <NarratorPage narrator={settings.narrator} statePrices={settings.statePrices} offstage={settings.offstage} patch={patch} busy={busy} />;
    case "timeouts":
      return <TimeoutsSection timeouts={settings.timeouts} patch={patch} busy={busy} />;
    case "agents":
      return <AgentsHub agents={settings.agents} routes={routes} connections={connections} busy={busy} patch={patch} go={go} speed={settings} />;
    case "speed":
      return <SpeedPage settings={settings} busy={busy} patch={patch} go={go} />;
    case "roles":
      return <RolesPage agents={settings.agents} timeouts={settings.timeouts} routes={routes} connections={connections} go={go} />;
    case "context":
      return <ContextPage agents={settings.agents} go={go} />;
    case "main":
      return <MainAgentPage agents={settings.agents} timeouts={settings.timeouts} prompts={settings.prompts} connections={connections} busy={busy} patch={patch} go={go} />;
    case "assistant":
      return <AssistantPage agents={settings.agents} prompts={settings.prompts} connections={connections} busy={busy} patch={patch} go={go} />;
    case "realism":
      return <RealismPage settings={settings} patch={patch} busy={busy} />;
    case "checks":
      return <ChecksPage settings={settings} skills={ctx.view?.controls?.skills ?? []} patch={patch} busy={busy} />;
    case "time":
      return <TimePage settings={settings} patch={patch} busy={busy} />;
    case "extraction":
      return <ExtractionPage data={data} patch={patch} busy={busy} />;
    case "swipes":
      return <SwipesPage value={settings.swipeDefault} ask={settings.swipeAsk} texts={settings.swipeTexts} patch={patch} busy={busy} />;
    case "preset":
      return <PresetPage hideJsonBlocks={settings.hideJsonBlocks} patch={patch} busy={busy} />;
    case "lore":
      return <LorePage loreBooks={settings.loreBooks} loreIndex={settings.loreIndex} patch={patch} busy={busy} />;
    case "display":
      return <DisplayPage />;
    case "diagnostics":
      return <DiagnosticsPage diagnostics={settings.diagnostics} patch={patch} busy={busy} />;
    case "mcp":
      return <McpServerPage />;
    case "prompts":
      return <PromptsPage prompts={settings.prompts} patch={patch} busy={busy} {...(ctx.test ? { test: ctx.test } : {})} {...(route.open ? { open: route.open } : {})} />;
    case "retention":
      return <RetentionPage retention={settings.retention} patch={patch} busy={busy} />;
    case "story":
      return <StoryHub story={settings.story} narration={settings.narration} busy={busy} patch={patch} go={go} />;
    case "caveats":
      return <CaveatsPage caveats={ctx.caveats} open={(page) => go({ page })} />;
  }
}

export function Settings() {
  const app = useApp();
  const view = useView();
  // The open chat, which a role text's Test on Prompts runs on.
  const chatId = useSelect(app.sync, (state) => state.chatId);
  const route = useUi((ui) => ui.settings);
  const connections = useConnections();
  const [data, setData] = useState<SettingsResult | null>(null);
  const [failed, setFailed] = useState(false);
  // The preset caveats, checked apart from settings (a dry run of the chat takes long on a long chat): null while checking.
  const [caveats, setCaveats] = useState<Caveat[] | null>(null);
  const caveatsAsked = useRef(0);
  const [busy, run] = useBusy();
  const [adjusted, setAdjusted] = useState<MergeAdjustment[]>([]);
  const where = `${route.page}/${route.sub ?? ""}/${route.at ?? ""}`;
  useEffect(() => setAdjusted([]), [where]);
  const root = useRef<HTMLDivElement>(null);
  // Where Settings was before, so Back returns focus to the row that opened the page left.
  const last = useRef<SettingsRoute | null>(null);
  useEffect(() => {
    void app.request({ type: "lre.settings.get" }).then((result) => {
      if (result) setData(result);
      else setFailed(true);
    });
  }, []);
  // Home and Caveats ask for the caveats each time they open; the latest ask wins.
  useEffect(() => {
    if (route.page !== "home" && route.page !== "caveats") return;
    const asked = (caveatsAsked.current += 1);
    setCaveats(null);
    void app.request({ type: "lre.settings.caveats" }).then((result) => {
      if (asked !== caveatsAsked.current) return;
      setCaveats(result ? result.caveats : [{ code: "preset_lint_failed", message: "The preset check didn't answer, so its warnings aren't known. Open Caveats again to retry." }]);
    });
  }, [route.page]);
  useEffect(() => {
    const el = root.current;
    if (!el || !data) return;
    const focus = settingsFocus(last.current, route);
    last.current = route;
    const target = el.querySelector<HTMLElement>(focus.selector);
    if (!target) return;
    target.focus({ preventScroll: true });
    revealInScroller(focus.selector === ".lre-page-header button" ? (target.closest(".lre-page-header") ?? target) : target, focus.reveal);
  }, [where, data !== null]);
  const go = (next: SettingsRoute) => app.ui.update((ui) => ({ ...ui, settings: next }));
  const patch = (body: JsonObject) =>
    run(async () => {
      const result = await app.request({ type: "lre.settings.set", patch: body });
      if (!result) return;
      setData(result);
      // What came out other than sent (a value out of range, of the wrong kind, a key it doesn't know), said here by each setting's name.
      setAdjusted(mergeAdjusted(body, result.settings as unknown as JsonValue));
    });
  if (!data) return failed ? <Empty icon="alert">Settings could not be loaded.</Empty> : <Empty>Loading settings…</Empty>;
  const header = settingsHeader(route);
  if (header === null) {
    return (
      <div ref={root} class="lre-set" data-lre-section="settings">
        <Home data={data} caveats={caveats} connections={connections} note={<EngineNote route={route} engine={view?.engine} onOpen={() => app.ui.update((ui) => ({ ...ui, mode: HARNESS_MODE.id }))} />} open={(page) => go({ page })} />
      </div>
    );
  }
  const back = () => go(settingsBack(route));
  const test = chatId ? async (def: PromptDef, text: string) => (await app.request<"lre.prompts">(promptTestRequest(chatId, def.id, text)))?.test ?? null : undefined;
  return (
    <div ref={root} class="lre-set" data-lre-section="settings" data-lre-settings-at={route.sub ?? route.page} onKeyDown={(event) => settingsKeyDown(event, back)}>
      <PageHeader title={header.title} subtitle={header.subtitle} onBack={back} backLabel={header.backLabel} />
      <EngineNote route={route} engine={view?.engine} onOpen={() => app.ui.update((ui) => ({ ...ui, mode: HARNESS_MODE.id }))} />
      {adjusted.length > 0 ? (
        <Banner tone="info">
          <span data-lre-settings-adjusted>{adjustedText(adjusted)}</span>
        </Banner>
      ) : null}
      <SettingsBody route={route} data={data} ctx={{ connections, caveats, view, ...(test ? { test } : {}), busy, patch, go }} />
    </div>
  );
}
