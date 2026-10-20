// Play → Me → Money (DESIGN §12, §25): the POV's money hub. The view (`FinanceView`)
// is already at the POV's Money level; the hub lays it out, and each page it opens rides the sheet
// stack. Each control is an in-world action sent like a palette pick, so it plays as the next turn
// and the narrator hears of it.

import type { ChatId } from "../../../shared/ids";
import type { StateView } from "../../../shared/state-view";
import { DEFAULT_CURRENCY } from "../../../shared/world";
import { pushSheet, useApp } from "../../../frontend/app";
import { Empty, JsonView, useBusy } from "../../../frontend/components";
import type { PanelProps } from "../../../frontend/registry";
import { decodeFinanceView } from "./decode";
import { MoneyHub, type PlayerControls } from "./hub";
import { actionRequest } from "./requests";
import { routeOf } from "./routes";

/** The player's controls in a chat: each an in-world action, one at a time. */
export function usePlayerControls(chatId: ChatId, state: StateView): PlayerControls {
  const app = useApp();
  const [busy, run] = useBusy();
  return {
    mode: "player",
    busy,
    currency: state.currency ?? DEFAULT_CURRENCY,
    palette: state.palette,
    act: (body) => {
      // A tap while one is in flight is dropped (useBusy), so it answers false rather than never.
      if (busy) return Promise.resolve(false);
      const { promise, resolve } = Promise.withResolvers<boolean>();
      run(async () => resolve((await app.request(actionRequest(chatId, body))) !== null));
      return promise;
    },
  };
}

export function MoneyPanel(props: PanelProps) {
  const app = useApp();
  const controls = usePlayerControls(props.chatId, props.state);
  if (props.view === null || props.view === undefined) return <Empty icon="coins">Money is off in this world.</Empty>;
  const view = decodeFinanceView(props.view);
  if (!view) return <JsonView value={props.view} />;
  // The overview is the bottom level: its pages open as sheets over it, and Back from it goes nowhere.
  return (
    <div class="lre-money-root" data-lre-panel="economy.money">
      <MoneyHub view={view} label="Your money" controls={controls} nav={{ page: null, open: (page) => app.ui.update((ui) => pushSheet(ui, routeOf(page))), back: () => undefined, frame: "play", backLabel: null }} />
    </div>
  );
}
