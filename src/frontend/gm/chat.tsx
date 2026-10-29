// GM → This chat: this chat's rules (Realism and Checks for this chat, the time
// controls, the sections' feed, its knowledge choices, Pins and upgrade), the Edits log behind the gate, and the Inspector with the call meter;
// a grouped list where each opens as a page. The rules and the Inspector show nothing the player
// mayn't see, so they don't wait behind the gate; Edits is the truth's (the `core.gm` panel).

import type { StateView } from "../../shared/state-view";
import { INFER_MODE_LABEL } from "../../shared/inferred";
import { ADJUDICATION_PRESET_LABEL } from "../../shared/adjudication";
import { useApp, useUi } from "../app";
import { Empty, List, ListRow, Section, useBusy } from "../components";
import { humanize } from "../format";
import type { PanelDef } from "../registry";
import { timeMarker } from "../requests";
import { AdjudicationThisChat } from "../settings/adjudication";
import { InferredThisChat } from "../settings/inferred";
import { RealismThisChat } from "../settings/realism";
import { TimeControlsEditor } from "../time-controls";
import { PinsAndUpgrade } from "./pins";
import { FeedThisChat } from "./feed";
import { KnowledgeThisChat, knowledgeSummary } from "./chat-knowledge";
import { GmPage, usePages } from "./ui";

type ChatPage = "realism" | "checks" | "time" | "sections" | "knowledge" | "pins" | "edits" | { panel: PanelDef };

/** This chat's time controls as `time` markers on the running chat (moved here from Play → Calendar). */
function TimeThisChat(props: { view: StateView }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const time = props.view.controls?.time;
  if (!time) return <Empty icon="clock">Time controls appear once the chat has started.</Empty>;
  return (
    <div class="lre-stack">
      <p class="lre-gm-note">Changes apply to this chat from the next turn; earlier turns keep their time. Pause or resume the clock in Play: Story → Calendar.</p>
      <TimeControlsEditor
        values={{ sceneTicks: time.sceneTicks, scale: time.scale, interrupts: time.interrupts, speedThrough: time.speedThrough, montage: time.montage, unitCap: time.unitCap }}
        currentSceneType={time.sceneType}
        disabled={busy}
        onChange={(change) =>
          run(async () => {
            const result = await app.request(timeMarker(props.view.chatId, change.control, change.scope, change.to));
            if (result?.pending) app.toast("Saved — it applies when the reply finishes.", "info");
          })
        }
      />
    </div>
  );
}

/**
 * This chat's list and the page open over it. `truth` is the GM view (`core.gm`), which shows the
 * Edits log for this section once the gate is open; `panels` are the other GM panels (the
 * Inspector, `core.context`, first), each a page of its own.
 */
export function ThisChat(props: { view: StateView; truth: PanelDef | undefined; panels: readonly PanelDef[] }) {
  const { view } = props;
  const app = useApp();
  const revealed = useUi((ui) => ui.gm.revealed);
  const pages = usePages<ChatPage>();
  const page = pages.page;
  const controls = view.controls;
  const panelProps = (panel: PanelDef) => ({ chatId: view.chatId, view: view.panels[panel.id] ?? null, state: view, send: app.send });
  const dot = (panel: PanelDef): boolean => view.pending.some((mark) => mark.panel === panel.id);
  return (
    <div ref={pages.host.ref} class="lre-gm-pages" onKeyDown={pages.host.onKeyDown} data-lre-gm-chat>
      <div class="lre-stack lre-gm-list" hidden={page !== null}>
        <Section title="Rules" flush>
          <List>
            <ListRow icon="sliders" title="Realism" subtitle={controls ? `${humanize(controls.realism.preset)} · how deeply each part of the world is simulated` : "How deeply each part of the world is simulated"} chevron onClick={() => pages.open("realism")} />
            <ListRow icon="dice" title="Checks" subtitle={controls ? `${ADJUDICATION_PRESET_LABEL[controls.adjudication.preset]} · inferred checks: ${INFER_MODE_LABEL[controls.inferred.mode].toLowerCase()}` : "How checks are decided"} chevron onClick={() => pages.open("checks")} />
            <ListRow icon="clock" title="Time" subtitle={controls ? `${controls.time.scale}× time scale · montage ${controls.time.montage === "key" ? "by key events" : `per ${controls.time.montage}`}${controls.time.paused ? " · clock paused" : ""}` : "Ticks, interrupts, Speed through, Montage"} chevron onClick={() => pages.open("time")} />
            <ListRow icon="scroll" title="Sections" subtitle="What goes into each section the narrator reads, and whose knowledge" chevron onClick={() => pages.open("sections")} />
            <ListRow icon="eye" title="Knowledge" subtitle={controls ? knowledgeSummary(controls.knowledge) : "Knowledge tracking, and what the narrator knows"} chevron onClick={() => pages.open("knowledge")} />
            <ListRow icon="layers" title="Pins and upgrade" subtitle="World revision, tables and generators" chevron onClick={() => pages.open("pins")} />
          </List>
        </Section>
        {props.truth ? (
          <Section title="Behind the curtain" flush>
            <List>
              <ListRow icon={revealed ? "edit" : "eye-off"} title="Edits" subtitle={revealed ? "Corrections in force on this chat's path" : "Corrections in force, behind the gate"} chevron onClick={() => pages.open("edits")} />
            </List>
          </Section>
        ) : null}
        {props.panels.length > 0 ? (
          <Section title="Inspector" flush>
            <List>
              {props.panels.map((panel) => (
                <ListRow key={panel.id} icon={panel.id === "core.context" ? "code" : "layers"} title={panel.label} subtitle={panel.id === "core.context" ? "What each reply was given, and the call meter" : undefined} badge={dot(panel) ? <span class="lre-dot" role="img" aria-label="pending" /> : undefined} chevron onClick={() => pages.open({ panel })} />
              ))}
            </List>
          </Section>
        ) : null}
      </div>
      {page === "realism" ? (
        <GmPage name="realism" title="Realism" subtitle="This chat" backLabel="This chat" onBack={pages.back}>
          <RealismThisChat chatId={view.chatId} controls={controls} />
        </GmPage>
      ) : page === "checks" ? (
        <GmPage name="checks" title="Checks" subtitle="This chat" backLabel="This chat" onBack={pages.back}>
          <AdjudicationThisChat chatId={view.chatId} controls={controls} />
          {controls ? <InferredThisChat chatId={view.chatId} controls={controls} /> : null}
        </GmPage>
      ) : page === "time" ? (
        <GmPage name="time" title="Time" subtitle="This chat" backLabel="This chat" onBack={pages.back}>
          <TimeThisChat view={view} />
        </GmPage>
      ) : page === "sections" ? (
        <GmPage name="sections" title="Sections" subtitle="This chat" backLabel="This chat" onBack={pages.back}>
          <FeedThisChat chatId={view.chatId} controls={controls} chips={view.chips} />
        </GmPage>
      ) : page === "knowledge" ? (
        <GmPage name="knowledge" title="Knowledge" subtitle="This chat" backLabel="This chat" onBack={pages.back}>
          <KnowledgeThisChat chatId={view.chatId} controls={controls} />
        </GmPage>
      ) : page === "pins" ? (
        <GmPage name="pins" title="Pins and upgrade" subtitle="This chat" backLabel="This chat" onBack={pages.back}>
          <PinsAndUpgrade view={view} />
        </GmPage>
      ) : page === "edits" && props.truth ? (
        <GmPage name="edits" title="Edits" subtitle="Corrections in force, newest first" backLabel="This chat" onBack={pages.back}>
          <props.truth.component {...panelProps(props.truth)} />
        </GmPage>
      ) : page !== null && typeof page === "object" ? (
        <GmPage name={page.panel.id} title={page.panel.label} subtitle="This chat" backLabel="This chat" onBack={pages.back}>
          <page.panel.component {...panelProps(page.panel)} />
        </GmPage>
      ) : null}
    </div>
  );
}
