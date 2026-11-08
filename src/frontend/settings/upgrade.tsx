// GM → This chat → Pins and upgrade → Upgrade (DESIGN §4.3 `migrate`, §12): what the Upgrade
// brings into the chat, entity by entity. Each change shows the chat's value, the revision's, and
// why it defaults to take (unchanged in play) or keep (changed in play); the owner flips any of
// them, and the Upgrade goes out with the picks that differ from the defaults. Nothing is hidden
// from the player (DEPTH-PLAN §1.4, D-9): a change that would give a secret away shows as it is,
// marked Secret.

import { useState } from "preact/hooks";
import type { EntityUpgradePick } from "../../shared/ledger";
import type { UpgradeChange, UpgradePreview } from "../../shared/protocol";
import { useApp } from "../app";
import { Badge, Button, Seg, useBusy } from "../components";
import { ActionRow, ActionRows, GmCard } from "../gm/ui";
import { upgradeRequest } from "../requests";

const PICK_LABEL: Record<EntityUpgradePick, string> = { take: "Take", keep: "Keep", remove: "Remove" };
const WHY_LABEL: Record<UpgradeChange["why"], string> = { "changed in play": "Changed in play", unchanged: "Unchanged in play", new: "New in this revision", removed: "Gone from this revision" };
const STATUS_LABEL: Record<UpgradePreview["entities"][number]["status"], string> = { new: "New", changed: "Changed", removed: "Gone" };

export function UpgradePanel(props: { chatId: string; preview: UpgradePreview; onDone(): void }) {
  const app = useApp();
  const [choices, setChoices] = useState<Record<string, EntityUpgradePick>>({});
  const [inPlayOnly, setInPlayOnly] = useState(false);
  const [busy, run] = useBusy();
  const all = props.preview.entities.flatMap((row) => row.changes);
  const choiceOf = (c: UpgradeChange): EntityUpgradePick => choices[c.id] ?? c.pick;
  const inPlay = all.filter((c) => c.why === "changed in play").length;
  const taking = all.filter((c) => choiceOf(c) !== "keep").length;
  const rows = props.preview.entities.map((row) => ({ ...row, changes: inPlayOnly ? row.changes.filter((c) => c.why === "changed in play") : row.changes })).filter((row) => row.changes.length > 0);
  const to = props.preview.to.slice(0, 8);
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
      app.toast(`Upgraded to revision ${to}.`, "info");
      props.onDone();
    });
  return (
    <div class="lre-stack lre-gm-upgrade" data-lre-upgrade-preview>
      <div class="lre-gm-upgrade-head">
        <h3 class="lre-gm-card-title">Upgrade to revision {to}</h3>
        <p class="lre-gm-note">
          {all.length === 0 ? "No person, thing or account changes; rules, schedules and tables apply from the next turn." : `${all.length} ${all.length === 1 ? "change" : "changes"} to people, things and accounts, ${inPlay} changed in play. ${taking} will be taken.`} Earlier turns keep what they showed.
        </p>
      </div>
      {all.length > 0 ? (
        <div class="lre-inline">
          <Button size="sm" icon="check" disabled={busy} onClick={takeUnchanged}>
            Take all unchanged
          </Button>
          <button type="button" class={inPlayOnly ? "lre-btn small primary" : "lre-btn small"} aria-pressed={inPlayOnly} disabled={busy || inPlay === 0} onClick={() => setInPlayOnly(!inPlayOnly)}>
            Review changed in play ({inPlay})
          </button>
        </div>
      ) : null}
      {rows.map((row) => (
        <div key={row.entity} data-lre-upgrade-entity={row.entity}>
          <GmCard
            title={row.name}
            subtitle={row.kind}
            id={row.entity}
            badges={
              <>
                {row.secret === true ? <Badge tone="gm">Secret</Badge> : null}
                <Badge>{STATUS_LABEL[row.status]}</Badge>
              </>
            }
          >
            <ActionRows label={row.name}>
              {row.changes.map((c) => (
                <ActionRow key={c.id} title={c.secret === true ? `${c.label} (secret)` : c.label} subtitle={`${c.from} → ${c.to}`} value={WHY_LABEL[c.why]} tone={c.why === "changed in play" ? "warn" : "muted"}>
                  <div class="lre-gm-upgrade-pick" data-lre-upgrade-change={c.id}>
                    <Seg<EntityUpgradePick> label={`${row.name}: ${c.label}`} value={choiceOf(c)} disabled={busy} options={c.options.map((o) => ({ value: o, label: PICK_LABEL[o] }))} onChange={(v) => setChoices((prev) => ({ ...prev, [c.id]: v }))} />
                  </div>
                </ActionRow>
              ))}
            </ActionRows>
          </GmCard>
        </div>
      ))}
      {props.preview.tracks.length > 0 ? (
        <ul class="lre-gm-lines">
          {props.preview.tracks.map((line, i) => (
            <li key={`${i}`}>{line.secret === true ? `${line.text} (secret)` : line.text}</li>
          ))}
        </ul>
      ) : null}
      <div class="lre-inline">
        <Button variant="primary" busy={busy} onClick={confirm}>
          Upgrade with these picks
        </Button>
        <Button variant="ghost" disabled={busy} onClick={props.onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
