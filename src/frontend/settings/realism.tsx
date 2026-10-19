// Realism (DESIGN §9.1). For new chats (Settings → Realism): presets, per-domain levels on the host
// range slider and band caps, which fill in what a world's own realism leaves out (or replace it,
// with "Use my settings" on). For this chat (GM → This chat → Realism): promote or demote a domain
// on the running chat through a `resolve` marker, after a migration preview of what freezes,
// promotes or materializes (§9.2).

import { useEffect, useRef, useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { BANDS, DOMAINS } from "../../shared/ids";
import type { Band, DomainId, Level, RealismPresetId } from "../../shared/ids";
import type { ResolveScope } from "../../shared/ledger";
import type { MarkerPreview } from "../../shared/protocol";
import type { RealismSettings } from "../../shared/settings";
import type { ControlsView } from "../../shared/state-view";
import { BAND_LABEL } from "../../shared/tiers";
import { useApp } from "../app";
import { Banner, Button, Empty, HostSlider, HostSwitch, Seg, useBusy } from "../components";
import type { IconName } from "../icons";
import { Icon } from "../icons";
import { resolveMarker } from "../requests";
import { revealInScroller } from "../scroll";

export const DOMAIN_LABEL: Record<DomainId, string> = {
  money: "Money",
  gear: "Gear",
  vehicles: "Vehicles",
  castlife: "Cast life",
  relationships: "Relationships",
  space: "Space & travel",
  calendar: "Calendar & time",
  weather: "Weather",
  sheets: "Sheets & checks",
};

export const LEVEL_LABEL: Record<Level, string> = { 0: "Off", 1: "Narrative", 2: "Simple", 3: "Detailed", 4: "Simulation" };

const PRESETS: { value: RealismPresetId; label: string }[] = [
  { value: "story", label: "Story" },
  { value: "grounded", label: "Grounded" },
  { value: "simulation", label: "Simulation" },
  { value: "custom", label: "Custom" },
];

function asLevel(value: number): Level {
  const rounded = Math.max(0, Math.min(4, Math.round(value)));
  return rounded === 0 ? 0 : rounded === 1 ? 1 : rounded === 2 ? 2 : rounded === 3 ? 3 : 4;
}

/** The world ruleset's floors in words ("This world's ruleset needs Sheets & checks 3."), or null when it sets none. */
export function floorNote(floors: Partial<Record<DomainId, Level>>): string | null {
  const parts = DOMAINS.flatMap((domain) => {
    const floor = floors[domain] ?? 0;
    return floor > 0 ? [`${DOMAIN_LABEL[domain]} ${floor}`] : [];
  });
  if (parts.length === 0) return null;
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `This world's ruleset needs ${joined}.`;
}

/**
 * A domain level on the host slider. The label tracks a drag while it lasts; once the gesture
 * commits (or is cancelled) it shows `value` again, the level actually in force, so a change the
 * parent previews, cancels or refuses never leaves the dragged level on screen. `floor` is the
 * world ruleset's: the slider starts there, since the engine never plays the domain below it.
 */
function LevelSlider(props: { domain: DomainId; value: Level; floor?: Level; disabled?: boolean; onCommit(level: Level): void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const floor = props.floor ?? 0;
  const value = asLevel(Math.max(props.value, floor));
  const shown = asLevel(drag ?? value);
  return (
    <div class="lre-gm-level-slider" data-lre-domain={props.domain} role="group" aria-label={`${DOMAIN_LABEL[props.domain]} level`}>
      <div class="lre-gm-level-head">
        <span class="lre-gm-level-domain">{DOMAIN_LABEL[props.domain]}</span>
        <span class={shown === 0 ? "lre-gm-level-value lre-dim" : "lre-gm-level-value"} data-lre-level-label>
          {shown} · {LEVEL_LABEL[shown]}
          {floor > 0 ? <span class="lre-dim"> · ruleset floor {floor}</span> : null}
        </span>
      </div>
      <HostSlider
        min={floor}
        max={4}
        step={1}
        integer
        value={value}
        disabled={props.disabled || floor >= 4}
        onDrag={setDrag}
        onCommit={(next) => {
          setDrag(null);
          props.onCommit(asLevel(Math.max(next, floor)));
        }}
      />
    </div>
  );
}

/** The one switch for whether a new chat starts from these settings instead of its world's defaults (realism and time). */
export function OverrideWorldSwitch(props: { checked: boolean; busy: boolean; patch(patch: JsonObject): void }) {
  return (
    <div class="lre-field" data-lre-override-world>
      <HostSwitch label="Use my settings instead of a world's defaults for new chats" checked={props.checked} disabled={props.busy} onChange={(checked) => props.patch({ overrideWorldDefaults: checked })} />
      <span class="lre-field-help">{props.checked ? "New chats start from these realism and time settings, whatever their world sets." : "New chats start from their world's own realism and time defaults; these settings fill in only what a world leaves out."}</span>
    </div>
  );
}

export function RealismSeed(props: { realism: RealismSettings; overrideWorld: boolean; patch(patch: JsonObject): void; busy: boolean }) {
  const { realism } = props;
  return (
    <div class="lre-stack">
      <OverrideWorldSwitch checked={props.overrideWorld} busy={props.busy} patch={props.patch} />
      <Seg<RealismPresetId> label="Realism preset" value={realism.preset} options={PRESETS} disabled={props.busy} onChange={(preset) => props.patch({ realism: { preset } })} />
      <p class="lre-gm-note">Story is the default; any change makes it Custom.</p>
      {DOMAINS.map((domain) => (
        <LevelSlider key={domain} domain={domain} value={realism.levels[domain]} disabled={props.busy} onCommit={(level) => props.patch({ realism: { preset: "custom", levels: { [domain]: level } } })} />
      ))}
      <div class="lre-gm-subtitle">Band caps</div>
      <p class="lre-gm-note">A world's tiers each belong to a band; a band's cap limits how deeply its people are simulated. Your own character is never capped.</p>
      <div class="lre-gm-caps-wrap">
        <div class="lre-gm-caps" role="table" aria-label="Band caps" lang="en">
          {/* Rows use display:contents so the cells stay on the CSS grid while the table roles stay valid. */}
          <div role="row" class="lre-gm-caps-row">
            <span role="columnheader">
              <span class="lre-sr">Domain</span>
            </span>
            {BANDS.map((band) => (
              <span key={band} class="lre-gm-caps-band" role="columnheader">
                {BAND_LABEL[band]}
              </span>
            ))}
          </div>
          {DOMAINS.map((domain) => (
            <div key={domain} role="row" class="lre-gm-caps-row">
              <span role="rowheader">{DOMAIN_LABEL[domain]}</span>
              {BANDS.map((band) => {
                const cap = realism.tierCaps[band]?.[domain];
                return (
                  <span key={band} role="cell" class="lre-gm-caps-cell">
                    <select
                      class="lre-input"
                      aria-label={`${DOMAIN_LABEL[domain]} cap for ${BAND_LABEL[band]}`}
                      value={cap === undefined ? "" : String(cap)}
                      disabled={props.busy}
                      onChange={(event) => {
                        const raw = event.currentTarget.value;
                        props.patch({ realism: { preset: "custom", tierCaps: { [band]: { [domain]: raw === "" ? null : Number(raw) } } } });
                      }}
                    >
                      <option value="">—</option>
                      {[0, 1, 2, 3, 4].map((level) => (
                        <option key={level} value={String(level)}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type ScopeChoice = "all" | Band;

interface PendingChange {
  domain: DomainId;
  to: Level;
  scope: ResolveScope;
  preview: MarkerPreview | null;
}

const TONE_ICON: Record<MarkerPreview["lines"][number]["tone"], { icon: IconName; label: string }> = {
  freeze: { icon: "pause", label: "Freezes" },
  promote: { icon: "chevron-up", label: "Rises" },
  materialize: { icon: "sparkle", label: "Gains detail" },
  info: { icon: "info", label: "Note" },
};

/** Promote or demote a domain on the running chat, with the migration preview first. */
export function RealismThisChat(props: { chatId: string; controls: ControlsView | null }) {
  const app = useApp();
  const [scope, setScope] = useState<ScopeChoice>("all");
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, run] = useBusy();
  // The preview opens above the sliders, out of sight after a change further down: bring it into
  // view, and its Apply into reach once the preview's request has settled (Apply is disabled until then).
  const preview = useRef<HTMLDivElement>(null);
  const previewing = pending !== null;
  useEffect(() => {
    if (!previewing || busy) return;
    revealInScroller(preview.current, "center");
    preview.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [previewing, busy]);
  if (!props.controls) return <Empty icon="sliders">Open a world chat to change its realism.</Empty>;
  const realism = props.controls.realism;
  const floorOf = (domain: DomainId): Level => realism.floors[domain] ?? 0;
  // The level in force: the chat's (or the band's cap), never below the ruleset's floor.
  const levelFor = (domain: DomainId): Level => asLevel(Math.max(scope === "all" ? realism.levels[domain] : realism.tierCaps[scope]?.[domain] ?? realism.levels[domain], floorOf(domain)));
  const floors = floorNote(realism.floors);
  const resolveScope: ResolveScope = scope === "all" ? { all: true } : { tier: scope };
  const ask = (domain: DomainId, to: Level) =>
    run(async () => {
      const result = await app.request(resolveMarker(props.chatId, domain, resolveScope, to, true));
      if (result) setPending({ domain, to, scope: resolveScope, preview: result.preview ?? null });
    });
  const apply = () =>
    run(async () => {
      if (!pending) return;
      const result = await app.request(resolveMarker(props.chatId, pending.domain, pending.scope, pending.to));
      if (result) {
        app.toast(result.pending ? "Saved — the change applies when the reply finishes." : `${DOMAIN_LABEL[pending.domain]} is now ${LEVEL_LABEL[pending.to]}.`, "info");
        setPending(null);
      }
    });
  // Which of the world's tiers the chosen band's caps reach, unless that is just the band itself.
  const reached = scope === "all" ? [] : realism.bandTiers[scope];
  const tiersNote = scope === "all" ? "" : reached.length === 0 ? `No tier in this world belongs to ${BAND_LABEL[scope]}. ` : reached.length === 1 && reached[0] === BAND_LABEL[scope] ? "" : `Tiers in this band: ${reached.join(", ")}. `;
  return (
    <div class="lre-stack" data-lre-realism="chat">
      <p class="lre-gm-note">How deeply each part of the world is simulated in this chat. A change shows what it does first, and applies from the next turn.</p>
      <div class="lre-field">
        <span class="label">Applies to</span>
        <Seg<ScopeChoice> label="Applies to" value={scope} options={[{ value: "all", label: "Everyone" }, ...BANDS.map((band) => ({ value: band, label: BAND_LABEL[band] }))]} onChange={(next) => setScope(next)} />
      </div>
      {scope !== "all" ? (
        <p class="lre-gm-note" data-lre-band-tiers>
          {tiersNote}Your own character is never capped.
        </p>
      ) : null}
      {floors ? (
        <p class="lre-gm-note" data-lre-floors>
          {floors} Those sliders start there: the engine never plays a domain below its floor.
        </p>
      ) : null}
      {pending ? (
        <div ref={preview} data-lre-migration-preview>
          <Banner
            tone="info"
            title={`${DOMAIN_LABEL[pending.domain]}: ${LEVEL_LABEL[levelFor(pending.domain)]} → ${LEVEL_LABEL[pending.to]}`}
            actions={
              <>
                <Button variant="primary" busy={busy} onClick={apply}>
                  Apply to this chat
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                  Cancel
                </Button>
              </>
            }
          >
            {pending.preview && pending.preview.lines.length > 0 ? (
              <ul class="lre-gm-preview-lines">
                {pending.preview.lines.map((line, i) => (
                  <li key={i}>
                    <Icon name={TONE_ICON[line.tone].icon} size={16} label={TONE_ICON[line.tone].label} />
                    <span>{line.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              "Nothing freezes, rises or gains detail."
            )}
          </Banner>
        </div>
      ) : null}
      <div class="lre-gm-sliders">
        {DOMAINS.map((domain) => (
          <LevelSlider key={`${scope}:${domain}`} domain={domain} value={levelFor(domain)} floor={floorOf(domain)} disabled={busy || pending !== null} onCommit={(to) => (to === levelFor(domain) ? undefined : ask(domain, to))} />
        ))}
      </div>
    </div>
  );
}
