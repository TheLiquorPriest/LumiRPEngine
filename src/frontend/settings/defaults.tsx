// Settings → Defaults for new chats: realism, checks and time as seeds for new chats,
// behind a world's own defaults unless "Use my settings…" is on. The editors are GM mode's (S4's
// seed exports); a running chat's own rules are in GM → This chat, which each page points to.

import type { JsonObject } from "../../shared/json";
import type { UserSettings } from "../../shared/settings";
import { useApp } from "../app";
import { Banner, Button, Section } from "../components";
import { settingsTimePatch, TimeControlsEditor } from "../time-controls";
import { AdjudicationSeed } from "./adjudication";
import { OverrideWorldSwitch, RealismSeed } from "./realism";

interface DefaultsProps {
  settings: UserSettings;
  patch(patch: JsonObject): void;
  busy: boolean;
}

/** Where a running chat's rules went: GM → This chat, one tap away. */
function ThisChatPointer() {
  const app = useApp();
  return (
    <Banner
      tone="info"
      icon="sliders"
      actions={
        <Button size="sm" icon="eye" onClick={() => app.ui.update((ui) => ({ ...ui, mode: "gm", gm: { ...ui.gm, section: "chat" } }))}>
          Open GM → This chat
        </Button>
      }
    >
      Rules for this chat are in GM → This chat.
    </Banner>
  );
}

export function RealismPage(props: DefaultsProps) {
  return (
    <div class="lre-stack" data-lre-settings-page="realism">
      <p class="lre-set-lead">How closely the engine simulates each part of life, from Off to Simulation, for chats you start from now on.</p>
      <ThisChatPointer />
      <Section>
        <RealismSeed realism={props.settings.realism} overrideWorld={props.settings.overrideWorldDefaults} patch={props.patch} busy={props.busy} />
      </Section>
    </div>
  );
}

export function ChecksPage(props: DefaultsProps) {
  return (
    <div class="lre-stack" data-lre-settings-page="checks">
      <p class="lre-set-lead">How checks are decided, from story-led (Narrative-first) to dice-heavy (Crunchy), for chats you start from now on.</p>
      <ThisChatPointer />
      <Section>
        <AdjudicationSeed settings={props.settings} busy={props.busy} patch={props.patch} />
      </Section>
    </div>
  );
}

export function TimePage(props: DefaultsProps) {
  const { time } = props.settings;
  return (
    <div class="lre-stack" data-lre-settings-page="time">
      <p class="lre-set-lead">How fast time passes in a scene, what stops a timelapse, and how much a long one may cover, for chats you start from now on.</p>
      <ThisChatPointer />
      <Section>
        <div class="lre-stack">
          <OverrideWorldSwitch checked={props.settings.overrideWorldDefaults} busy={props.busy} patch={props.patch} />
          <p class="lre-small lre-muted" style={{ margin: 0 }}>
            The time scale and NPC calls always come from here. Pause the clock from the world status or Play → Story → Calendar.
          </p>
        </div>
      </Section>
      <TimeControlsEditor
        values={{ sceneTicks: time.sceneTicks, scale: time.scale, interrupts: time.interrupts, speedThrough: time.speedThrough, montage: time.montage, unitCap: time.unitCap }}
        disabled={props.busy}
        onChange={(change) => {
          const body = settingsTimePatch(change);
          if (Object.keys(body).length > 0) props.patch(body);
        }}
      />
    </div>
  );
}
