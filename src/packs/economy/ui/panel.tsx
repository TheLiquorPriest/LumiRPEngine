// Play → Me → Money (DESIGN §12, §25; ORG-SPEC §5.1): the POV's own money, as its segments under
// Me's tabs. The view (`FinanceView`) is already at the POV's Money level; the segments lay it out,
// and each page they open rides the sheet stack. Each control is an in-world action sent like a
// palette pick: done at once, off screen, with its Undo (DESIGN §11), told to the next reply or not
// as Settings → Narrator → Out-of-play actions has it; `buy` and typed words still play as a turn.

import { useId, useState } from "preact/hooks";
import type { ChatId } from "../../../shared/ids";
import type { StateView } from "../../../shared/state-view";
import { DEFAULT_CURRENCY } from "../../../shared/world";
import { openAt, orgRoute, playAt, pushSheet, showPanel, useApp, type App } from "../../../frontend/app";
import { Empty, JsonView, useBusy } from "../../../frontend/components";
import type { PanelProps } from "../../../frontend/registry";
import { decodeFinanceView } from "./decode";
import { MoneyHub, type PlayerControls } from "./hub";
import { ALL_ACTIVITY, type ActivityFilter, type MoneySegment } from "./layout";
import type { Elsewhere, HubNav } from "./nav";
import { actionRequest } from "./requests";
import { routeOf } from "./routes";
import { toastQueued } from "../../../frontend/queued";

/** The player's controls in a chat: each an in-world action, one at a time. */
export function usePlayerControls(chatId: ChatId, state: StateView): PlayerControls {
  const app = useApp();
  const [busy, run] = useBusy();
  return {
    mode: "player",
    busy,
    currency: state.currency ?? DEFAULT_CURRENCY,
    palette: state.palette,
    act: (body, tell) => {
      // A tap while one is in flight is dropped (useBusy), so it answers false rather than never.
      if (busy) return Promise.resolve(false);
      const { promise, resolve } = Promise.withResolvers<boolean>();
      run(async () => {
        const result = await app.request({ ...actionRequest(chatId, body), ...(tell !== undefined ? { tell } : {}) });
        // Done at once (DESIGN §11), it waits for a reply already under way, as a ✎ fix does.
        if (result && "pending" in result) toastQueued(app, result);
        resolve(result !== null);
      });
      return promise;
    },
  };
}

/**
 * Opens the POV's money, whose detail is the POV's to materialize (DESIGN §9.2; an account has
 * none of its own), as picking the Money tab does: for a money page that opens elsewhere (over Now
 * from the glance, over Orgs from an organization's page) and an organization's tabs that read it.
 */
export function observeMoney(app: App, chatId: ChatId): void {
  void app.request({ type: "lre.view.open", chatId, panel: "economy.money", entity: null }).then((result) => {
    toastQueued(app, result);
  });
}

/** In Play, where money's links outside money lead: an organization's page in Orgs, on the tab named (none: the Orgs home), or a panel on its tab. */
export function playElsewhere(app: App, to: Elsewhere): void {
  app.ui.update((ui) => ("panel" in to ? showPanel(ui, app.catalog, to.panel) : to.org === null ? playAt(ui, "orgs") : openAt(ui, "orgs", orgRoute(to.org, to.tab))));
}

export function MoneyPanel(props: PanelProps) {
  const app = useApp();
  const controls = usePlayerControls(props.chatId, props.state);
  const [segment, setSegment] = useState<MoneySegment>("summary");
  const [filter, setFilter] = useState<ActivityFilter>(ALL_ACTIVITY);
  const panelId = useId();
  if (props.view === null || props.view === undefined) return <Empty icon="coins">Money is off in this world.</Empty>;
  const view = decodeFinanceView(props.view);
  if (!view) return <JsonView value={props.view} />;
  // The segments are the bottom level: their pages open as sheets over them, and Back from them goes nowhere.
  const nav: HubNav = { page: null, open: (page) => app.ui.update((ui) => pushSheet(ui, routeOf(page, view.party, true))), back: () => undefined, elsewhere: (to) => playElsewhere(app, to), frame: "play", backLabel: null };
  return (
    <div class="lre-money-root" data-lre-panel="economy.money">
      <MoneyHub view={view} controls={controls} nav={nav} segment={segment} onSegment={setSegment} filter={filter} onFilter={setFilter} now={props.state.hud?.clock.minutes ?? null} garage={(props.state.panels["vehicles.garage"] ?? null) !== null} panelId={panelId} />
    </div>
  );
}
