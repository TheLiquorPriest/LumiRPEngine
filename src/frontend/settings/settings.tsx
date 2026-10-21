// Settings (DESIGN §12): a home list of pages in groups, each page under a header with
// Back. Getting started: Helper model, Model use, Steps and connections, Minds, Timeouts. Defaults
// for new chats: Realism, Checks, Time. Replies: Changes from the reply, Swipes. Your preset.
// Display: Show ids. About: Caveats, fetched on their own (a dry run of the chat) by home and the
// Caveats page, and Diagnostics (each turn's steps, model calls and failures; behind its own curtain).
// The page is UI state (`ui.settings.page`), so it holds while the drawer switches modes. A running
// chat's own rules (realism, checks, time, pins and Upgrade) live in GM → This chat.

import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { SettingsResult } from "../../shared/protocol";
import { EXTRACTION_TYPES, stepConfigOf } from "../../shared/settings";
import type { AdjudicationPresetId, StepPurpose } from "../../shared/world";
import type { SettingsPage } from "../app";
import { useApp, useUi, useView } from "../app";
import { Badge, Banner, Empty, HostSwitch, List, ListRow, PageHeader, Section, useBusy, useShowIds } from "../components";
import { humanize } from "../format";
import type { IconName } from "../icons";
import { revealInScroller } from "../scroll";
import { ChecksPage, RealismPage, TimePage } from "./defaults";
import { MindsSection } from "./minds";
import { PresetPage } from "./preset";
import { ExtractionPage, SwipesPage } from "./replies";
import { type Connection, HelperSection, helperSummary, ModelUseSection, STEP_LABEL, StepsSection, useConnections } from "./steps";
import { limitText, TimeoutsSection } from "./timeouts";
import { DiagnosticsPage } from "../diagnostics";
import { McpServerPage } from "../agents";

type Page = Exclude<SettingsPage, "home">;
type Caveat = { code: string; message: string };

const PAGE: Record<Page, { title: string; subtitle: string; icon: IconName }> = {
  helper: { title: "Helper model", subtitle: "What the engine's model calls run on", icon: "sliders" },
  model: { title: "Model use", subtitle: "How much the engine asks a model", icon: "bolt" },
  steps: { title: "Steps and connections", subtitle: "Which model runs each step", icon: "branch" },
  minds: { title: "Minds", subtitle: "How characters think and remember", icon: "sparkle" },
  timeouts: { title: "Timeouts", subtitle: "How long each wait may run", icon: "hourglass" },
  realism: { title: "Realism", subtitle: "For new chats", icon: "layers" },
  checks: { title: "Checks", subtitle: "For new chats", icon: "dice" },
  time: { title: "Time", subtitle: "For new chats", icon: "clock" },
  extraction: { title: "Changes from the reply", subtitle: "Auto, Confirm or Never, per type", icon: "checklist" },
  swipes: { title: "Swipes", subtitle: "What a swipe does", icon: "refresh" },
  preset: { title: "Preset", subtitle: "Your Lumiverse preset and LumiRPEngine", icon: "scroll" },
  display: { title: "Display", subtitle: "How LumiRPEngine looks on this device", icon: "eye" },
  caveats: { title: "Caveats", subtitle: "What to know", icon: "info" },
  diagnostics: { title: "Diagnostics", subtitle: "What the engine did each turn, and what failed", icon: "list" },
  mcp: { title: "MCP server", subtitle: "Your agent's lumirpengine, and how it follows updates", icon: "branch" },
};

/** The home list's groups, in order. */
const GROUPS: readonly { title: string; pages: readonly Page[] }[] = [
  { title: "Getting started", pages: ["helper", "model", "steps", "minds", "timeouts"] },
  { title: "Defaults for new chats", pages: ["realism", "checks", "time"] },
  { title: "Replies", pages: ["extraction", "swipes"] },
  { title: "Your preset", pages: ["preset"] },
  { title: "Display", pages: ["display"] },
  { title: "Your agent", pages: ["mcp"] },
  { title: "About", pages: ["caveats", "diagnostics"] },
];

const PRESET_LABEL: Record<AdjudicationPresetId, string> = { narrative: "Narrative-first", balanced: "Balanced", crunchy: "Crunchy", custom: "Custom" };

const STATIC_CAVEATS = [
  "LumiRPEngine does not manage lore; Lumiverse's World Info works as usual in world chats.",
  "Realism, checks and time settings seed new chats only, after a world's own defaults unless you turn on Use my settings. Change a running chat in GM → This chat.",
  "Undo covers the latest reply; earlier changes go through Keep or Discard.",
];

/** Each home row's one-line summary of the page behind it; `caveats` is null while they're checked. */
function summaryOf(page: Page, data: SettingsResult, caveats: readonly Caveat[] | null, showIds: boolean, connections: readonly Connection[]): { subtitle?: string; value?: string; badge?: ComponentChildren } {
  const { settings } = data;
  switch (page) {
    case "helper":
      return { subtitle: helperSummary(settings.helper, connections) };
    case "model":
      return { subtitle: `${humanize(settings.modelUse.preset)} preset` };
    case "minds":
      return { subtitle: settings.minds.enabled ? `On · ${settings.minds.liveLimit === "none" ? "no Live limit" : `up to ${settings.minds.liveLimit} Live a turn`}` : "Off" };
    case "timeouts":
      return { subtitle: `Engine run ${limitText(settings.timeouts.engineRunMs)} · reading the reply ${limitText(settings.timeouts.postReplyMs)}` };
    case "steps": {
      const purposes = Object.keys(STEP_LABEL) as StepPurpose[];
      const on = purposes.filter((purpose) => stepConfigOf(settings.modelUse.steps, purpose).enabled).length;
      return { subtitle: `${on} of ${purposes.length} steps on` };
    }
    case "realism":
      return { subtitle: settings.overrideWorldDefaults ? `${humanize(settings.realism.preset)} for new chats` : `World defaults, then ${humanize(settings.realism.preset)}` };
    case "checks":
      return { subtitle: settings.overrideWorldAdjudication ? `${PRESET_LABEL[settings.adjudication.preset]} for new chats` : `World rules, then ${PRESET_LABEL[settings.adjudication.preset]}` };
    case "time":
      return { subtitle: `${settings.time.scale}× scale · montage by ${settings.time.montage === "key" ? "key moments" : settings.time.montage}` };
    case "extraction": {
      const pinned = EXTRACTION_TYPES.filter((type) => data.extraction[type]?.source === "pinned").length;
      return { subtitle: pinned > 0 ? `${pinned} pinned, the rest learn` : "Every type learns from you" };
    }
    case "swipes":
      return { subtitle: settings.swipeDefault === "rerun" ? "Re-run by default" : "Re-narrate by default" };
    case "preset":
      return { subtitle: settings.hideJsonBlocks ? "JSON blocks hidden in world chats" : "JSON blocks shown" };
    case "display":
      return { subtitle: "Show ids", value: showIds ? "On" : "Off" };
    case "caveats": {
      // A check still running isn't a warning: the row says it's checking until the dry run answers.
      const found = caveats?.filter((c) => c.code !== "preset_lint_pending") ?? [];
      if (caveats === null || (found.length === 0 && caveats.length > 0)) return { subtitle: "Checking your preset…" };
      return found.length > 0 ? { subtitle: "Warnings and what to know", badge: <Badge tone="warn">{`${found.length} active`}</Badge> } : { subtitle: "What to know" };
    }
    case "diagnostics":
      return { subtitle: "Each turn's steps, model calls and errors" };
    case "mcp":
      return { subtitle: "The setup that follows LumiRPEngine, and each server's state" };
  }
}

function Home(props: { data: SettingsResult; caveats: readonly Caveat[] | null; open(page: Page): void }) {
  const showIds = useShowIds();
  const connections = useConnections();
  return (
    <div class="lre-stack lre-set-home" data-lre-settings-page="home">
      <PageHeader title="Settings" subtitle="Yours, for every world chat" />
      {GROUPS.map((group) => (
        <Section key={group.title} title={group.title} flush>
          <List>
            {group.pages.map((page) => {
              const summary = summaryOf(page, props.data, props.caveats, showIds, connections);
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

function CaveatsPage(props: { caveats: readonly Caveat[] | null }) {
  return (
    <div class="lre-stack" data-lre-settings-page="caveats">
      {props.caveats === null ? (
        <Empty>Checking your preset against this chat…</Empty>
      ) : props.caveats.length > 0 ? (
        <div class="lre-stack">
          {props.caveats.map((caveat) => (
            <Banner key={caveat.code} tone={caveat.code === "preset_lint_pending" ? "info" : "warn"}>
              {caveat.message}
            </Banner>
          ))}
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

export function Settings() {
  const app = useApp();
  const view = useView();
  const page = useUi((ui) => ui.settings.page);
  const [data, setData] = useState<SettingsResult | null>(null);
  const [failed, setFailed] = useState(false);
  // The preset caveats, checked apart from settings (a dry run of the chat takes long on a long chat): null while checking.
  const [caveats, setCaveats] = useState<Caveat[] | null>(null);
  const caveatsAsked = useRef(0);
  const [busy, run] = useBusy();
  const root = useRef<HTMLDivElement>(null);
  // The page last opened from home, so Back returns focus to its row.
  const opener = useRef<Page | null>(null);
  useEffect(() => {
    void app.request({ type: "lre.settings.get" }).then((result) => {
      if (result) setData(result);
      else setFailed(true);
    });
  }, []);
  // Home and Caveats ask for the caveats each time they open; the latest ask wins.
  useEffect(() => {
    if (page !== "home" && page !== "caveats") return;
    const asked = (caveatsAsked.current += 1);
    setCaveats(null);
    void app.request({ type: "lre.settings.caveats" }).then((result) => {
      if (asked !== caveatsAsked.current) return;
      setCaveats(result ? result.caveats : [{ code: "preset_lint_failed", message: "The preset check didn't answer, so its warnings aren't known. Open Caveats again to retry." }]);
    });
  }, [page]);
  useEffect(() => {
    const el = root.current;
    if (!el || !data) return;
    // A page opens at its header, with focus on Back; returning home puts focus back on the row that opened it.
    const target = page === "home" ? (opener.current ? el.querySelector<HTMLElement>(`[data-lre-settings="${opener.current}"] button`) : null) : el.querySelector<HTMLElement>(".lre-page-header button");
    if (!target) return;
    target.focus({ preventScroll: true });
    revealInScroller(page === "home" ? target : (target.closest(".lre-page-header") ?? target), page === "home" ? "nearest" : "start");
  }, [page, data !== null]);
  const go = (next: SettingsPage) => app.ui.update((ui) => ({ ...ui, settings: { page: next } }));
  const patch = (body: JsonObject) =>
    run(async () => {
      const result = await app.request({ type: "lre.settings.set", patch: body });
      if (result) setData(result);
    });
  if (!data) return failed ? <Empty icon="alert">Settings could not be loaded.</Empty> : <Empty>Loading settings…</Empty>;
  if (page === "home") {
    return (
      <div ref={root} class="lre-set" data-lre-section="settings">
        <Home
          data={data}
          caveats={caveats}
          open={(next) => {
            opener.current = next;
            go(next);
          }}
        />
      </div>
    );
  }
  const { settings } = data;
  const body =
    page === "helper" ? (
      <HelperSection helper={settings.helper} patch={patch} busy={busy} />
    ) : page === "model" ? (
      <ModelUseSection modelUse={settings.modelUse} meter={view?.meter ?? null} patch={patch} openTimeouts={() => go("timeouts")} busy={busy} />
    ) : page === "steps" ? (
      <StepsSection modelUse={settings.modelUse} helper={settings.helper} patch={patch} openHelper={() => go("helper")} busy={busy} />
    ) : page === "minds" ? (
      <MindsSection minds={settings.minds} patch={patch} busy={busy} />
    ) : page === "timeouts" ? (
      <TimeoutsSection timeouts={settings.timeouts} patch={patch} busy={busy} />
    ) : page === "realism" ? (
      <RealismPage settings={settings} patch={patch} busy={busy} />
    ) : page === "checks" ? (
      <ChecksPage settings={settings} skills={view?.controls?.skills ?? []} patch={patch} busy={busy} />
    ) : page === "time" ? (
      <TimePage settings={settings} patch={patch} busy={busy} />
    ) : page === "extraction" ? (
      <ExtractionPage data={data} patch={patch} busy={busy} />
    ) : page === "swipes" ? (
      <SwipesPage value={settings.swipeDefault} patch={patch} busy={busy} />
    ) : page === "preset" ? (
      <PresetPage hideJsonBlocks={settings.hideJsonBlocks} patch={patch} busy={busy} />
    ) : page === "display" ? (
      <DisplayPage />
    ) : page === "diagnostics" ? (
      <DiagnosticsPage />
    ) : page === "mcp" ? (
      <McpServerPage />
    ) : (
      <CaveatsPage caveats={caveats} />
    );
  return (
    <div
      ref={root}
      class="lre-set"
      data-lre-section="settings"
      onKeyDown={(event) => {
        // Escape goes back home, as it pops a sheet in Play; a control that handled it first keeps it.
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        go("home");
      }}
    >
      <PageHeader title={PAGE[page].title} subtitle={PAGE[page].subtitle} onBack={() => go("home")} backLabel="Settings" />
      {body}
    </div>
  );
}
