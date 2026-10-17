// Settings (DESIGN §12): model use and budgets, realism (new chats and this chat), time, per-type
// extraction modes with D4 learning, steps and connections, pins and Upgrade, the swipe default
// and caveats. Realism and time settings seed new chats behind a world's own defaults (or instead of
// them, with "Use my settings" on); running-chat changes are markers.

import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import type { BoundMode } from "../../shared/ids";
import type { ExtractionModeView, SettingsResult, UpgradePreview } from "../../shared/protocol";
import { EXTRACTION_TYPES } from "../../shared/settings";
import type { ExtractionType } from "../../shared/settings";
import type { WorldDoc, WorldIndex } from "../../shared/world";
import { useApp, useView } from "../app";
import { Empty, Row, Seg, useBusy } from "../components";
import { humanize } from "../format";
import { settingsTimePatch, TimeControlsEditor } from "../time-controls";
import { OverrideWorldSwitch, RealismSeed, RealismThisChat } from "./realism";
import { ModelUseSection, StepsSection } from "./steps";
import { UpgradePanel } from "./upgrade";

type SectionId = "model" | "realism" | "time" | "extraction" | "steps" | "pins" | "swipes" | "caveats";

function Fold(props: { id: SectionId; title: string; summary?: string; open: SectionId | null; setOpen(id: SectionId | null): void; children: ComponentChildren }) {
  const expanded = props.open === props.id;
  return (
    <section class="lre-card" data-lre-settings={props.id}>
      <button type="button" class="lre-item" style={{ border: 0, background: "transparent", padding: 0 }} aria-expanded={expanded} onClick={() => props.setOpen(expanded ? null : props.id)}>
        <span class="grow">
          <span class="title">{props.title}</span>
          {props.summary ? <span class="sub">{props.summary}</span> : null}
        </span>
        <span class="lre-dim" aria-hidden="true">
          {expanded ? "▴" : "▾"}
        </span>
      </button>
      {expanded ? <div style={{ marginTop: "10px" }}>{props.children}</div> : null}
    </section>
  );
}

const EXTRACTION_LABEL: Record<ExtractionType, string> = {
  time_advance: "Time passing",
  location: "Moving somewhere",
  condition: "Conditions (hurt, tired…)",
  knows: "Learning a fact",
  give: "Giving things",
  purchase: "Purchases",
  transfer: "Money transfers",
  regard: "Feelings toward others",
  quantity: "Quantities",
  spawn: "New people",
};

const MODE_OPTIONS: { value: BoundMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "confirm", label: "Confirm" },
  { value: "never", label: "Never" },
];

/** Where an effective mode comes from, in words (D4 learning precedence). */
export function modeSource(view: ExtractionModeView): string {
  switch (view.source) {
    case "pinned":
      return "Pinned by you";
    case "learned":
      return `Learned on ${view.connection?.name ?? "this connection"} (${view.accepted} kept, ${view.rejected} rejected)`;
    case "default":
      return view.accepted + view.rejected > 0 ? `Default · learning (${view.accepted} kept, ${view.rejected} rejected)` : "Default";
    case "bound":
      return "From the field's bound";
  }
}

function ExtractionSection(props: { data: SettingsResult; patch(patch: JsonObject): void; busy: boolean }) {
  return (
    <div class="lre-stack">
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        What the engine may change from the reply's text. Setting a mode pins it; unpinned types learn from your confirms and undos on each connection.
      </p>
      {EXTRACTION_TYPES.map((type) => {
        const view = props.data.extraction[type];
        if (!view) return null;
        return (
          <div key={type} class="lre-field" data-lre-extraction={type} style={{ paddingBottom: "6px", borderBottom: "1px solid rgba(127,127,127,.15)" }}>
            <div class="lre-spread">
              <span>{EXTRACTION_LABEL[type]}</span>
              {view.source === "pinned" ? (
                <button type="button" class="lre-btn small ghost" aria-label={`Unpin ${EXTRACTION_LABEL[type]} and let it learn`} disabled={props.busy} onClick={() => props.patch({ extraction: { [type]: null } })}>
                  Unpin · let it learn
                </button>
              ) : null}
            </div>
            <Seg<BoundMode> label={EXTRACTION_LABEL[type]} value={view.mode} options={MODE_OPTIONS} disabled={props.busy} onChange={(mode) => props.patch({ extraction: { [type]: { mode } } })} />
            <span class={view.source === "learned" ? "lre-small lre-pos" : "lre-small lre-muted"}>{modeSource(view)}</span>
          </div>
        );
      })}
    </div>
  );
}

function PinsSection() {
  const app = useApp();
  const view = useView();
  const [world, setWorld] = useState<WorldDoc | null>(null);
  const [index, setIndex] = useState<WorldIndex | null>(null);
  const [preview, setPreview] = useState<UpgradePreview | null>(null);
  const [busy, run] = useBusy();
  const worldId = view?.worldId ?? null;
  useEffect(() => {
    if (!worldId) return;
    void app.request({ type: "lre.world", op: "get", worldId, revision: view?.revision ?? undefined }).then((result) => setWorld(result?.world ?? null));
    void app.request({ type: "lre.world", op: "list" }).then((result) => setIndex(result?.worlds?.find((w) => w.id === worldId) ?? null));
  }, [worldId, view?.revision]);
  if (!view || !worldId) return <Empty>Open a world chat to see its pins.</Empty>;
  const lagging = view.definitionsFrom;
  // An earlier Upgrade that didn't bring the definitions in leaves them to bring in, even at the head.
  const behind = index !== null && view.revision !== null && (index.head !== view.revision || lagging !== undefined);
  return (
    <div class="lre-stack">
      <Row k="World" v={index?.name ?? world?.name ?? worldId} />
      <Row k="This chat's revision" v={<code>{view.revision?.slice(0, 8) ?? "—"}</code>} sub={index !== null && index.head !== view.revision ? "A newer revision exists." : lagging ? "Up to date, but its people, things and accounts aren't." : "Up to date."} tone={behind ? "warn" : undefined} />
      {lagging ? (
        <div class="lre-banner warn" data-lre-definitions-lag>
          People, things and accounts in this chat still follow revision {lagging.slice(0, 8)}: an earlier Upgrade didn't bring their changes in. Upgrade to review them and bring them in.
        </div>
      ) : null}
      {behind && index && !preview ? (
        <button
          type="button"
          class="lre-btn primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const result = await app.request({ type: "lre.marker", chatId: view.chatId, kind: "migrate", to: index.head, preview: true });
              if (result?.preview?.upgrade) setPreview(result.preview.upgrade);
            })
          }
        >
          Upgrade to the latest revision
        </button>
      ) : null}
      {preview ? <UpgradePanel chatId={view.chatId} preview={preview} onDone={() => setPreview(null)} /> : null}
      {world ? (
        <>
          <div class="lre-h">Generators</div>
          {Object.keys(world.pins.generators).length === 0 ? <Empty>None pinned.</Empty> : Object.entries(world.pins.generators).map(([id, version]) => <Row key={id} k={id} v={`v${version}`} />)}
          <div class="lre-h">Tables</div>
          {Object.keys(world.pins.tables).length === 0 ? <Empty>None pinned.</Empty> : Object.entries(world.pins.tables).map(([id, revision]) => <Row key={id} k={id} v={<code>{revision.slice(0, 8)}</code>} />)}
        </>
      ) : null}
    </div>
  );
}

const STATIC_CAVEATS = [
  "LumiRPEngine does not manage lore; Lumiverse's World Info works as usual in world chats.",
  "Realism and time settings seed new chats only, after a world's own defaults unless you turn on Use my settings. Change a running chat from Play (Calendar, realism for this chat).",
  "Undo covers the latest reply; earlier changes go through Keep or Discard.",
];

export function Settings() {
  const app = useApp();
  const view = useView();
  const [data, setData] = useState<SettingsResult | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<SectionId | null>("model");
  const [realismScope, setRealismScope] = useState<"seed" | "chat">("seed");
  const [busy, run] = useBusy();
  useEffect(() => {
    void app.request({ type: "lre.settings.get" }).then((result) => {
      if (result) setData(result);
      else setFailed(true);
    });
  }, []);
  const patch = (body: JsonObject) =>
    run(async () => {
      const result = await app.request({ type: "lre.settings.set", patch: body });
      if (result) setData(result);
    });
  if (!data) return failed ? <Empty>Settings could not be loaded.</Empty> : <Empty>Loading settings…</Empty>;
  const { settings } = data;
  const fold = { open, setOpen };
  return (
    <div class="lre-stack" data-lre-section="settings">
      <Fold id="model" title="Model use" summary={`${humanize(settings.modelUse.preset)} preset`} {...fold}>
        <ModelUseSection modelUse={settings.modelUse} meter={view?.meter ?? null} patch={patch} busy={busy} />
      </Fold>
      <Fold id="realism" title="Realism" summary={settings.overrideWorldDefaults ? `${humanize(settings.realism.preset)} for new chats` : `World defaults, then ${humanize(settings.realism.preset)}`} {...fold}>
        <div class="lre-stack">
          <Seg<"seed" | "chat">
            label="Realism scope"
            value={realismScope}
            options={[
              { value: "seed", label: "New chats" },
              { value: "chat", label: "This chat" },
            ]}
            onChange={(next) => setRealismScope(next)}
          />
          {realismScope === "seed" ? <RealismSeed realism={settings.realism} overrideWorld={settings.overrideWorldDefaults} patch={patch} busy={busy} /> : <RealismThisChat chatId={view?.chatId ?? ""} controls={view?.status === "not_world" ? null : view?.controls ?? null} />}
        </div>
      </Fold>
      <Fold id="time" title="Time" summary={`${settings.time.scale}× · montage ${settings.time.montage}`} {...fold}>
        <div class="lre-stack" style={{ marginBottom: "8px" }}>
          <OverrideWorldSwitch checked={settings.overrideWorldDefaults} busy={busy} patch={patch} />
          <p class="lre-small lre-muted" style={{ margin: 0 }}>
            The time scale and NPC calls always come from here. Pause the clock from the HUD or Play → Calendar (this chat only).
          </p>
        </div>
        <TimeControlsEditor
          values={{ sceneTicks: settings.time.sceneTicks, scale: settings.time.scale, interrupts: settings.time.interrupts, speedThrough: settings.time.speedThrough, montage: settings.time.montage, unitCap: settings.time.unitCap, npcCalls: settings.time.npcCallsPerTimelapse }}
          disabled={busy}
          onChange={(change) => {
            const body = settingsTimePatch(change);
            if (Object.keys(body).length > 0) patch(body);
          }}
        />
      </Fold>
      <Fold id="extraction" title="Changes from the reply" summary="Auto, confirm or never, per type" {...fold}>
        <ExtractionSection data={data} patch={patch} busy={busy} />
      </Fold>
      <Fold id="steps" title="Steps and connections" summary="Which model runs each step" {...fold}>
        <StepsSection modelUse={settings.modelUse} patch={patch} busy={busy} />
      </Fold>
      <Fold id="pins" title="Pins and upgrade" summary="World revision, tables and generators" {...fold}>
        <PinsSection />
      </Fold>
      <Fold id="swipes" title="Swipes" summary={settings.swipeDefault === "rerun" ? "Re-run by default" : "Re-narrate by default"} {...fold}>
        <Seg<"rerun" | "renarrate">
          label="Swipe default"
          value={settings.swipeDefault}
          options={[
            { value: "rerun", label: "Re-run (new roll)" },
            { value: "renarrate", label: "Re-narrate (same outcome)" },
          ]}
          disabled={busy}
          onChange={(swipeDefault) => patch({ swipeDefault })}
        />
      </Fold>
      <Fold id="caveats" title="Caveats" summary={data.caveats.length > 0 ? `${data.caveats.length} active warning${data.caveats.length === 1 ? "" : "s"}` : undefined} {...fold}>
        <div class="lre-stack">
          {data.caveats.map((caveat) => (
            <div key={caveat.code} class="lre-banner warn">
              {caveat.message}
            </div>
          ))}
          {STATIC_CAVEATS.map((text) => (
            <Row key={text} k={text} />
          ))}
        </div>
      </Fold>
    </div>
  );
}
