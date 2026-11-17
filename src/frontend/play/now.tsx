// Play → Now's parts around the scene: the status banners (a paused chat with its
// Keep report, a turn running), what needs the player's answer, and the quick actions. Scene
// (scene.tsx) assembles the hub from these and its own card and Here list.

import type { Chip, ChipKind, StateView } from "../../shared/state-view";
import { playAt, useApp } from "../app";
import { chipRole, chipTone } from "../chip-roles";
import { Badge, Banner, Button, List, ListRow, Section, useBusy } from "../components";
import type { IconName } from "../../ui/icons";
import { Icon } from "../../ui/icons";
import { isMobile } from "../layout";
import { visiblePanels } from "./play";

/**
 * What needs the player: the Keep report while it stands, then every decision that
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

/** The way to the Live page, where a running turn is watched, paused and let go on; none where the App has no shell to ask. */
function useWatch(chatId: string): (() => void) | null {
  const { open } = useApp();
  return open === undefined ? null : () => open({ page: "live", chat: chatId });
}

/** A turn paused on the Live page, or running; nothing otherwise. */
export function StatusBanners(props: { state: StateView }) {
  const { state } = props;
  const watch = useWatch(state.chatId);
  if (state.status === "paused") {
    return (
      <div class="lre-play-status" data-lre-status="paused">
        <Banner tone="warn" icon="pause" title="Paused" actions={watch === null ? undefined : <Button size="sm" onClick={watch}>Open Live</Button>}>
          The turn is held on the Live page and goes on when you resume it there. A change you make now still applies at once.
        </Banner>
      </div>
    );
  }
  if (state.status === "in_flight") return <TurnRunning onWatch={watch} />;
  return null;
}

/** A turn under way, without hooks: a change made now applies at once and the running turn goes on from where it began; the way to watch it on Live, where there is one. */
export function TurnRunning(props: { onWatch: (() => void) | null }) {
  return (
    <div class="lre-play-status" data-lre-status="in_flight">
      <Banner tone="info" icon="hourglass" title="A turn is running" actions={props.onWatch === null ? undefined : <Button icon="eye" size="sm" onClick={props.onWatch}>Watch it work</Button>}>
        A change you make now applies at once, and the running turn goes on from where it began.
      </Banner>
    </div>
  );
}

/** What a Needs you row says under its label: a review card's label already counts its changes, and the card under the reply lists them, so its row says where to answer; every other chip, its detail. */
export function needsYouDetail(chip: Chip): string | undefined {
  return chip.kind === "review" ? "Under the reply: apply them or turn them down." : chip.detail;
}

/** The decisions waiting under replies; tapping one shows that reply in the chat (on a phone the drawer closes first, so the reply is in view). */
export function NeedsYou(props: { state: StateView }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const chips = needsYou(props.state.chips);
  if (chips.length === 0) return null;
  const reveal = (chip: Chip) =>
    run(async () => {
      if (!(await app.host.revealMessage(chip.messageId))) app.toast("That reply isn't loaded in the chat. Scroll to it to answer.", "info");
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
              subtitle={needsYouDetail(chip)}
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
