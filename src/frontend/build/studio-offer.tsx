// A world from LumiRPEngine Studio (DESIGN §15): Build's world list reviews what the Studio offers
// (when the Studio says one is waiting, or on Import from Studio) and installs it only when the
// player taps Install. A new world goes in as an import does, a revision onto its world; then the
// chat the Studio named is offered Play's Attach, and the Studio is told what the offer became.

import { useEffect, useState } from "preact/hooks";
import type { LintIssue, StudioOfferView } from "../../shared/protocol";
import type { StudioInstalled } from "../../shared/studio-bridge";
import { STUDIO_INSTALLED_EVENT } from "../../shared/studio-bridge";
import type { WorldId } from "../../shared/ids";
import { useApp, useUi, useView } from "../app";
import { Card, useBusy } from "../components";

export interface StudioOfferState {
  offer: StudioOfferView | null;
  /** Why the last look found nothing to review. */
  message: string | null;
  busy: boolean;
  load(): void;
  dismiss(): void;
  install(offer: StudioOfferView): void;
}

/** The offer under review, read again whenever the Studio says one is waiting. */
export function useStudioOffer(props: { installed(): void; review(next: { worldId: WorldId; name: string; issues: LintIssue[] }): void }): StudioOfferState {
  const app = useApp();
  const view = useView();
  const asked = useUi((ui) => ui.studioOffer);
  const [offer, setOffer] = useState<StudioOfferView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, run] = useBusy();
  const load = () =>
    run(async () => {
      const result = await app.request({ type: "lre.studio", op: "offer" });
      setOffer(result?.offer ?? null);
      setMessage(result && !result.offer ? (result.message ?? null) : null);
    });
  useEffect(() => {
    if (asked > 0) load();
  }, [asked]);
  const install = (reviewed: StudioOfferView) =>
    run(async () => {
      const result = await app.request({ type: "lre.studio", op: "install", offerId: reviewed.offerId });
      const done = result?.installed;
      if (!done) return;
      setOffer(null);
      props.installed();
      if (result.lint && result.lint.length > 0) props.review({ worldId: done.worldId, name: done.name, issues: result.lint });
      const detail: StudioInstalled = { offerId: done.offerId, mode: done.mode, worldId: done.worldId, revision: done.revision };
      window.dispatchEvent(new CustomEvent(STUDIO_INSTALLED_EVENT, { detail }));
      app.toast(done.mode === "new" ? `Installed “${done.name}” as a new world.` : `“${done.name}” has a new revision. Upgrade its chats in Settings → Pins and upgrade.`, "info");
      if (!done.attachChatId) return;
      // Play's Attach, with its confirmation, for the chat the Studio named while it's the open one.
      if (view?.chatId !== done.attachChatId) {
        app.toast("Open the chat it was made for and attach it from Play.", "info");
        return;
      }
      if (view.status !== "not_world") {
        if (view.worldId !== done.worldId) app.toast("This chat already plays another world, so it stays as it is.", "info");
        return;
      }
      if (!(await app.host.confirm("Attach world", `Attach “${done.name}” to this chat? The world starts at its current revision.`, "info", "Attach"))) return;
      if (await app.request({ type: "lre.world", op: "attach", worldId: done.worldId, chatId: done.attachChatId })) void app.client.open(done.attachChatId);
    });
  return { offer, message, busy, load, dismiss: () => setOffer(null), install };
}

const COUNTED: readonly [string, string][] = [
  ["entities", "entities"],
  ["places", "places"],
  ["routes", "routes"],
  ["maps", "maps"],
  ["tracks", "tracks"],
  ["schedules", "schedules"],
  ["lore", "lore entries"],
  ["rules", "rules"],
  ["actions", "actions"],
];

/** The offer's review: what it is, what it holds, its problems and macros, and Install. */
export function StudioOfferReview(props: { state: StudioOfferState }) {
  const { offer, busy } = props.state;
  if (!offer) return null;
  const counts = COUNTED.flatMap(([key, label]) => (offer.counts[key] ? [`${offer.counts[key]} ${label}`] : []));
  const what = offer.mode === "new" ? "A new world" : offer.target?.name ? `The next revision of “${offer.target.name}”` : "A revision of a world you don't have";
  return (
    <Card title="From LumiRPEngine Studio" aside={offer.errors > 0 ? <span class="lre-badge neg">{offer.errors}</span> : null}>
      <div class="lre-stack" data-lre-studio-offer>
        <div class="lre-item" style={{ flexWrap: "wrap" }}>
          <span class="grow" style={{ minWidth: 0 }}>
            <span class="title" style={{ overflowWrap: "anywhere" }}>{offer.name}</span>
            <span class="sub">
              {what}
              {offer.attachChatId ? ", to attach to a chat" : ""}
            </span>
          </span>
        </div>
        {counts.length > 0 ? <span class="lre-small lre-muted">{counts.join(" · ")}</span> : null}
        {offer.installed ? <div class="lre-banner info">Already installed.</div> : offer.blocked ? <div class="lre-banner warn">{offer.blocked}</div> : null}
        {offer.lint.length > 0 ? (
          <div class="lre-list">
            {offer.lint.slice(0, 8).map((issue, i) => (
              <div key={i} class="lre-item" style={{ flexWrap: "wrap" }}>
                <span class={issue.severity === "error" ? "lre-badge neg" : "lre-badge warn"}>{issue.severity}</span>
                <span class="grow" style={{ flexBasis: "180px", minWidth: 0 }}>
                  <span class="title" style={{ overflowWrap: "anywhere" }}>{issue.message}</span>
                  <span class="sub">{issue.path}</span>
                </span>
              </div>
            ))}
            {offer.lint.length > 8 ? <span class="lre-small lre-muted">and {offer.lint.length - 8} more</span> : null}
          </div>
        ) : null}
        {offer.macros.length > 0 ? (
          <div class="lre-banner warn">
            Its lore and templates hold {offer.macros.length} macro{offer.macros.length === 1 ? "" : "s"} that Lumiverse runs when it builds a prompt; after installing, review each before you play.
          </div>
        ) : null}
        {offer.mode === "revision" && offer.blocked === null && !offer.installed ? <span class="lre-small lre-muted">Its chats stay on their revision until you Upgrade them in Settings → Pins and upgrade.</span> : null}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button type="button" class="lre-btn primary" disabled={busy || offer.blocked !== null || offer.installed !== null} onClick={() => props.state.install(offer)}>
            Install
          </button>
          <button type="button" class="lre-btn ghost" disabled={busy} onClick={props.state.dismiss}>
            Not now
          </button>
        </div>
      </div>
    </Card>
  );
}
