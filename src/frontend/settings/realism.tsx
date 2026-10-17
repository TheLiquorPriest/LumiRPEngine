// Settings → Realism (DESIGN §9.1): presets, per-domain levels on the host range slider and tier
// caps for new chats; and "This chat": promote or demote a domain on the running chat through a
// `resolve` marker, after a migration preview of what freezes, promotes or materializes (§9.2).

import { useState } from "preact/hooks";
import type { JsonObject } from "../../shared/json";
import { DOMAINS } from "../../shared/ids";
import type { DomainId, Level, RealismPresetId, Tier } from "../../shared/ids";
import type { ResolveScope } from "../../shared/ledger";
import type { MarkerPreview } from "../../shared/protocol";
import type { RealismSettings } from "../../shared/settings";
import type { ControlsView } from "../../shared/state-view";
import { useApp } from "../app";
import { Empty, HostSlider, Seg, useBusy } from "../components";
import { resolveMarker } from "../requests";

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

const CAPPED_TIERS = ["principal", "supporting", "background"] as const satisfies readonly Exclude<Tier, "pov">[];

function asLevel(value: number): Level {
  const rounded = Math.max(0, Math.min(4, Math.round(value)));
  return rounded === 0 ? 0 : rounded === 1 ? 1 : rounded === 2 ? 2 : rounded === 3 ? 3 : 4;
}

/** A domain level on the host slider, with the level's name tracking the drag. */
function LevelSlider(props: { domain: DomainId; value: Level; disabled?: boolean; onCommit(level: Level): void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = asLevel(drag ?? props.value);
  return (
    <div class="lre-field" style={{ marginBottom: "4px" }} data-lre-domain={props.domain} role="group" aria-label={`${DOMAIN_LABEL[props.domain]} level`}>
      <div class="lre-spread">
        <span>{DOMAIN_LABEL[props.domain]}</span>
        <span class={shown === 0 ? "lre-dim" : "lre-muted"}>
          {shown} · {LEVEL_LABEL[shown]}
        </span>
      </div>
      <HostSlider min={0} max={4} step={1} integer value={props.value} disabled={props.disabled} onDrag={setDrag} onCommit={(value) => props.onCommit(asLevel(value))} />
    </div>
  );
}

export function RealismSeed(props: { realism: RealismSettings; patch(patch: JsonObject): void; busy: boolean }) {
  const { realism } = props;
  return (
    <div class="lre-stack">
      <Seg<RealismPresetId> label="Realism preset" value={realism.preset} options={PRESETS} disabled={props.busy} onChange={(preset) => props.patch({ realism: { preset } })} />
      <p class="lre-small lre-muted" style={{ margin: 0 }}>
        Seeds new chats. Story is the default; any change makes it Custom.
      </p>
      {DOMAINS.map((domain) => (
        <LevelSlider key={domain} domain={domain} value={realism.levels[domain]} disabled={props.busy} onCommit={(level) => props.patch({ realism: { preset: "custom", levels: { [domain]: level } } })} />
      ))}
      <div class="lre-h">Tier caps</div>
      <div class="lre-tier-wrap">
        <div class="lre-tier-grid" role="table" aria-label="Tier caps" lang="en">
          {/* Rows use display:contents so the cells stay on the CSS grid while the table roles stay valid. */}
          <div role="row" style={{ display: "contents" }}>
            <span role="columnheader">
              <span class="lre-sr">Domain</span>
            </span>
            {CAPPED_TIERS.map((tier) => (
              <span key={tier} class="lre-muted" role="columnheader">
                {tier[0]?.toUpperCase()}
                {tier.slice(1)}
              </span>
            ))}
          </div>
          {DOMAINS.map((domain) => (
            <div key={domain} role="row" style={{ display: "contents" }}>
              <span role="rowheader">{DOMAIN_LABEL[domain]}</span>
              {CAPPED_TIERS.map((tier) => {
                const cap = realism.tierCaps[tier]?.[domain];
                return (
                  <span key={tier} role="cell" style={{ display: "contents" }}>
                    <select
                      class="lre-input"
                      aria-label={`${DOMAIN_LABEL[domain]} cap for ${tier}`}
                      value={cap === undefined ? "" : String(cap)}
                      disabled={props.busy}
                      onChange={(event) => {
                        const raw = event.currentTarget.value;
                        props.patch({ realism: { preset: "custom", tierCaps: { [tier]: { [domain]: raw === "" ? null : Number(raw) } } } });
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

type ScopeChoice = "all" | Exclude<Tier, "pov">;

interface PendingChange {
  domain: DomainId;
  to: Level;
  scope: ResolveScope;
  preview: MarkerPreview | null;
}

const TONE_ICON: Record<MarkerPreview["lines"][number]["tone"], string> = { freeze: "❄", promote: "⬆", materialize: "✦", info: "ℹ" };

/** Promote or demote a domain on the running chat, with the migration preview first. */
export function RealismThisChat(props: { chatId: string; controls: ControlsView | null }) {
  const app = useApp();
  const [scope, setScope] = useState<ScopeChoice>("all");
  const [pending, setPending] = useState<PendingChange | null>(null);
  const [busy, run] = useBusy();
  if (!props.controls) return <Empty>Open a world chat to change its realism.</Empty>;
  const realism = props.controls.realism;
  const levelFor = (domain: DomainId): Level => (scope === "all" ? realism.levels[domain] : realism.tierCaps[scope]?.[domain] ?? realism.levels[domain]);
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
  return (
    <div class="lre-stack" data-lre-realism="chat">
      <Seg<ScopeChoice>
        label="Applies to"
        value={scope}
        options={[
          { value: "all", label: "Everyone" },
          { value: "principal", label: "Principal" },
          { value: "supporting", label: "Supporting" },
          { value: "background", label: "Background" },
        ]}
        onChange={(next) => setScope(next)}
      />
      {pending ? (
        <div class="lre-banner info" data-lre-migration-preview>
          <strong>
            {DOMAIN_LABEL[pending.domain]}: {LEVEL_LABEL[levelFor(pending.domain)]} → {LEVEL_LABEL[pending.to]}
          </strong>
          {pending.preview && pending.preview.lines.length > 0 ? (
            pending.preview.lines.map((line, i) => (
              <div key={i} class="lre-row">
                <span class="k">
                  <span aria-hidden="true">{TONE_ICON[line.tone]}</span> {line.text}
                </span>
              </div>
            ))
          ) : (
            <span class="lre-muted">Nothing freezes, promotes or materializes.</span>
          )}
          <div class="lre-inline">
            <button type="button" class="lre-btn primary" disabled={busy} onClick={apply}>
              Apply to this chat
            </button>
            <button type="button" class="lre-btn ghost" disabled={busy} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {DOMAINS.map((domain) => (
        <LevelSlider key={`${scope}:${domain}`} domain={domain} value={levelFor(domain)} disabled={busy || pending !== null} onCommit={(to) => (to === levelFor(domain) ? undefined : ask(domain, to))} />
      ))}
    </div>
  );
}
