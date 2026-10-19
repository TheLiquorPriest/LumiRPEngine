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
import { Badge, Banner, Button, Section, useBusy } from "../components";
import { Icon } from "../icons";
import { IssueRow } from "./check";

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
      const result = await app.request({ type: "lre.studio", op: "install", offerId: reviewed.offerId, hash: reviewed.hash, ...(reviewed.headMoved ? { acceptMovedHead: true } : {}) });
      const done = result?.installed;
      if (!done) return;
      setOffer(null);
      props.installed();
      if (result.lint && result.lint.length > 0) props.review({ worldId: done.worldId, name: done.name, issues: result.lint });
      const detail: StudioInstalled = { offerId: done.offerId, mode: done.mode, worldId: done.worldId, revision: done.revision };
      window.dispatchEvent(new CustomEvent(STUDIO_INSTALLED_EVENT, { detail }));
      app.toast(done.mode === "new" ? `Installed “${done.name}” as a new world.` : `“${done.name}” has a new revision. Upgrade its chats in GM → This chat.`, "info");
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
  const open = offer.blocked === null && offer.installed === null;
  return (
    <Section title="From LumiRPEngine Studio" aside={offer.errors > 0 ? <Badge tone="neg">{offer.errors === 1 ? "1 error" : `${offer.errors} errors`}</Badge> : null}>
      <div class="lre-stack" data-lre-studio-offer>
        <div class="lre-build-offer">
          <span class="lre-build-tile">
            <Icon name="sparkle" />
          </span>
          <span class="lre-build-offer-text">
            <strong class="lre-build-offer-name">{offer.name}</strong>
            <span class="lre-build-note">
              {what}
              {offer.attachChatId ? ", to attach to a chat" : ""}
            </span>
          </span>
        </div>
        {counts.length > 0 ? <p class="lre-build-note">{counts.join(" · ")}</p> : null}
        {offer.installed ? (
          <Banner tone="info" icon="check">
            Already installed.
          </Banner>
        ) : offer.blocked ? (
          <Banner tone="warn">{offer.blocked}</Banner>
        ) : null}
        {offer.lint.length > 0 ? (
          <div class="lre-build-issues lre-build-well" role="list">
            {offer.lint.slice(0, 8).map((issue, i) => (
              <IssueRow key={i} issue={issue} />
            ))}
            {offer.lint.length > 8 ? <p class="lre-build-note">and {offer.lint.length - 8} more</p> : null}
          </div>
        ) : null}
        {offer.macros.length > 0 ? (
          <Banner tone="warn" title="Macros to review">
            Its lore and templates hold {offer.macros.length} macro{offer.macros.length === 1 ? "" : "s"} that Lumiverse runs when it builds a prompt; after installing, review each before you play.
          </Banner>
        ) : null}
        {offer.mode === "revision" && open ? <p class="lre-build-note">Its chats stay on their revision until you Upgrade them in GM → This chat.</p> : null}
        {offer.headMoved && open ? (
          <Banner tone="warn" title="Changed in Build since">
            “{offer.target?.name ?? "This world"}” changed in Build since LumiRPEngine Studio took it. Installing makes this the new head without what was committed since; that revision stays, and so do its chats. To keep both, take the world into the Studio again.
          </Banner>
        ) : null}
        <div class="lre-build-actions">
          <Button variant="primary" disabled={busy || !open} onClick={() => props.state.install(offer)}>
            {offer.headMoved ? "Install anyway" : "Install"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={props.state.dismiss}>
            Not now
          </Button>
        </div>
      </div>
    </Section>
  );
}
