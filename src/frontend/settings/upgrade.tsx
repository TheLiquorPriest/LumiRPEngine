// Settings → Pins and upgrade → Upgrade (DESIGN §4.3 `migrate`, §12): what the Upgrade brings into
// the chat, entity by entity. Each change shows the chat's value, the revision's, and why it
// defaults to take (unchanged in play) or keep (changed in play); the owner flips any of them, and
// the Upgrade goes out with the picks that differ from the defaults. Changes that would give a
// secret away wait behind a spoiler gate, as the GM view does: each reads "A hidden change", with
// its pick still there, until the owner shows the spoilers.

import { useState } from "preact/hooks";
import type { EntityUpgradePick } from "../../shared/ledger";
import type { UpgradeChange, UpgradePreview } from "../../shared/protocol";
import { useApp } from "../app";
import { Row, Seg, useBusy } from "../components";
import { upgradeRequest } from "../requests";

const PICK_LABEL: Record<EntityUpgradePick, string> = { take: "Take", keep: "Keep", remove: "Remove" };
const WHY_LABEL: Record<UpgradeChange["why"], string> = { "changed in play": "Changed in play", unchanged: "Unchanged in play", new: "New in this revision", removed: "Gone from this revision" };
const STATUS_LABEL: Record<UpgradePreview["entities"][number]["status"], string> = { new: "New", changed: "Changed", removed: "Gone" };
/** What a change behind the spoiler gate reads as. */
const HIDDEN = "A hidden change";

export function UpgradePanel(props: { chatId: string; preview: UpgradePreview; onDone(): void }) {
  const app = useApp();
  const [choices, setChoices] = useState<Record<string, EntityUpgradePick>>({});
  const [inPlayOnly, setInPlayOnly] = useState(false);
  const [spoilers, setSpoilers] = useState(false);
  const [busy, run] = useBusy();
  const all = props.preview.entities.flatMap((row) => row.changes);
  const choiceOf = (c: UpgradeChange): EntityUpgradePick => choices[c.id] ?? c.pick;
  const inPlay = all.filter((c) => c.why === "changed in play").length;
  const taking = all.filter((c) => choiceOf(c) !== "keep").length;
  const secrets = props.preview.entities.some((row) => row.secret === true || row.changes.some((c) => c.secret === true)) || props.preview.tracks.some((t) => t.secret === true);
  const rows = props.preview.entities.map((row) => ({ ...row, changes: inPlayOnly ? row.changes.filter((c) => c.why === "changed in play") : row.changes })).filter((row) => row.changes.length > 0);
  const takeUnchanged = (): void =>
    setChoices((prev) => {
      const next = { ...prev };
      for (const c of all) if (c.why !== "changed in play" && c.options.includes("take")) next[c.id] = "take";
      return next;
    });
  const confirm = (): void =>
    run(async () => {
      const result = await app.request(upgradeRequest(props.chatId, props.preview, choices));
      if (!result) return;
      app.toast(`Upgraded to revision ${props.preview.to.slice(0, 8)}.`, "info");
      props.onDone();
    });
  return (
    <div class="lre-banner info" data-lre-upgrade-preview>
      <strong>Upgrade to revision {props.preview.to.slice(0, 8)}</strong>
      <span class="lre-small">
        {all.length === 0 ? "No person, thing or account changes; rules, schedules and tables apply from the next turn." : `${all.length} ${all.length === 1 ? "change" : "changes"} to people, things and accounts, ${inPlay} changed in play. ${taking} will be taken.`} Earlier turns keep what they showed.
      </span>
      {secrets ? (
        <div class="lre-inline">
          <span class="lre-small">{spoilers ? "Spoilers are shown." : "Changes that would give a secret away read as hidden; their picks still apply."}</span>
          <button type="button" class="lre-btn small" aria-pressed={spoilers} disabled={busy} onClick={() => setSpoilers(!spoilers)} data-lre-upgrade-spoilers>
            {spoilers ? "Hide spoilers" : "Show spoilers"}
          </button>
        </div>
      ) : null}
      {all.length > 0 ? (
        <div class="lre-inline">
          <button type="button" class="lre-btn" disabled={busy} onClick={takeUnchanged}>
            Take all unchanged
          </button>
          <button type="button" class={inPlayOnly ? "lre-btn primary" : "lre-btn"} aria-pressed={inPlayOnly} disabled={busy || inPlay === 0} onClick={() => setInPlayOnly(!inPlayOnly)}>
            Review changed in play ({inPlay})
          </button>
        </div>
      ) : null}
      {rows.map((row, index) => {
        const rowHidden = row.secret === true && !spoilers;
        return (
          <section key={row.entity} class="lre-card" data-lre-upgrade-entity={rowHidden ? `hidden-${index}` : row.entity}>
            {rowHidden ? <Row k={<strong>{HIDDEN}</strong>} v="" /> : <Row k={<strong>{row.name}</strong>} v={<span class="lre-badge">{STATUS_LABEL[row.status]}</span>} sub={row.kind} />}
            {row.changes.map((c, i) => {
              const hidden = rowHidden || (c.secret === true && !spoilers);
              return (
                <div key={c.id} class="lre-stack" data-lre-upgrade-change={hidden ? `hidden-${index}-${i}` : c.id}>
                  {hidden ? <Row k={HIDDEN} v={WHY_LABEL[c.why]} tone={c.why === "changed in play" ? "warn" : undefined} /> : <Row k={c.label} v={WHY_LABEL[c.why]} sub={`${c.from} → ${c.to}`} tone={c.why === "changed in play" ? "warn" : undefined} />}
                  <Seg<EntityUpgradePick> label={hidden ? HIDDEN : `${row.name}: ${c.label}`} value={choiceOf(c)} disabled={busy} options={c.options.map((o) => ({ value: o, label: PICK_LABEL[o] }))} onChange={(v) => setChoices((prev) => ({ ...prev, [c.id]: v }))} />
                </div>
              );
            })}
          </section>
        );
      })}
      {props.preview.tracks.map((line, i) => (
        <span key={`${i}`} class="lre-small">
          {line.secret === true && !spoilers ? HIDDEN : line.text}
        </span>
      ))}
      <div class="lre-inline">
        <button type="button" class="lre-btn primary" disabled={busy} onClick={confirm}>
          Upgrade with these picks
        </button>
        <button type="button" class="lre-btn ghost" disabled={busy} onClick={props.onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
