// Play → Now's parts around the scene (contract §4.4): the status banners (a paused chat with its
// Keep report, a turn running), what needs the player's answer, and the quick actions. Scene
// (scene.tsx) assembles the hub from these and its own card and Here list.

import type { Chip, ChipKind, StateView } from "../../shared/state-view";
import { playAt, useApp } from "../app";
import { KeepReportChip } from "../chips";
import { chipRole, chipTone } from "../chip-roles";
import { Badge, Banner, Button, List, ListRow, Section, useBusy } from "../components";
import type { IconName } from "../icons";
import { Icon } from "../icons";
import { isMobile } from "../layout";
import { visiblePanels } from "./play";

/**
 * What needs the player (contract §4.4): the Keep report while it stands, then every decision that
 * lapses at the next send, in chat order. A decision kept past the send (an overdue loan) waits in
 * its own place instead.
 */
export function needsYou(chips: readonly Chip[]): Chip[] {
  return [...chips.filter((chip) => chip.kind === "keep_report"), ...chips.filter((chip) => chip.kind !== "keep_report" && chip.expires === "next_send" && chipRole(chip) === "decision")];
}

const DECISION_ICON: Partial<Record<ChipKind, IconName>> = {
  keep_report: "flag",
  confirm: "help",
  retry: "refresh",
  retry_read: "refresh",
  reread: "eye",
  overdue: "clock",
};

/** Paused with the Keep report, or a turn running; nothing otherwise. */
export function StatusBanners(props: { state: StateView }) {
  const app = useApp();
  const { state } = props;
  if (state.status === "paused") {
    const keep = state.chips.find((chip) => chip.kind === "keep_report");
    // The Keep report says what was edited and holds Keep and Discard; without it, the banner says it.
    return (
      <div class="lre-play-status" data-lre-status="paused">
        <Banner tone="warn" icon="pause" title="Paused" actions={keep ? <KeepReportChip chip={keep} chatId={state.chatId} send={app.send} /> : undefined}>
          {keep ? undefined : "A user message was edited. Later turns don't change the world until you keep or discard them."}
        </Banner>
      </div>
    );
  }
  if (state.status === "in_flight") {
    return (
      <div class="lre-play-status" data-lre-status="in_flight">
        <Banner tone="info" icon="hourglass" title="A turn is running">
          Changes you make now apply when it finishes.
        </Banner>
      </div>
    );
  }
  return null;
}

/** The decisions waiting under replies; tapping one shows that reply in the chat, closing the drawer first on a phone, where it covers the chat. */
export function NeedsYou(props: { state: StateView }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const chips = needsYou(props.state.chips);
  if (chips.length === 0) return null;
  const reveal = (chip: Chip) =>
    run(async () => {
      if (isMobile(app.host.viewport.get())) await app.send({ type: "lre.ui", op: "close_drawer" });
      if (!app.host.revealMessage(chip.messageId)) app.toast("That reply isn't loaded in the chat. Scroll to it to answer.", "info");
    });
  return (
    <div class="lre-play-needs">
      <Section title="Needs you" aside={<Badge tone="warn">{chips.length}</Badge>} flush>
        <List>
          {chips.map((chip) => (
            <ListRow
              key={chip.id}
              leading={<Icon name={DECISION_ICON[chip.kind] ?? "alert"} class={chipTone(chip) === "neg" ? "lre-neg" : "lre-warn"} />}
              title={
                <>
                  {chip.label}
                  <span class="lre-sr"> (show in the chat)</span>
                </>
              }
              subtitle={chip.detail}
              chevron
              disabled={busy}
              onClick={() => reveal(chip)}
            />
          ))}
        </List>
      </Section>
    </div>
  );
}

/** Act (the action sheet), Timelapse (its tab, when the chat offers one) and Map (Play → Places, when the world has a map). */
export function QuickActions(props: { state: StateView }) {
  const app = useApp();
  const { state } = props;
  const places = visiblePanels(app.catalog, state).some((panel) => panel.home === "places");
  return (
    <div class="lre-play-quick" role="group" aria-label="Quick actions">
      <Button variant="primary" icon="bolt" onClick={() => void app.overlays.openPalette("actions")}>
        Act
      </Button>
      {state.palette?.timelapse ? (
        <Button icon="fast-forward" onClick={() => void app.overlays.openPalette("timelapse")}>
          Timelapse
        </Button>
      ) : null}
      {places ? (
        <Button icon="map" onClick={() => app.ui.update((ui) => playAt(ui, "places"))}>
          Map
        </Button>
      ) : null}
    </div>
  );
}
