// Play → Money (DESIGN §12, §25): the POV's money hub. The view (`FinanceView`) is already at the
// POV's Money level; the hub lays it out. Each control is an in-world action sent like a palette
// pick, so it plays as the next turn and the narrator hears of it.

import { DEFAULT_CURRENCY } from "../../../shared/world";
import { useApp } from "../../../frontend/app";
import { Empty, JsonView, useBusy } from "../../../frontend/components";
import type { PanelProps } from "../../../frontend/registry";
import { decodeFinanceView } from "./decode";
import { MoneyHub, type PlayerControls } from "./hub";
import { actionRequest } from "./requests";

export function MoneyPanel(props: PanelProps) {
  const app = useApp();
  const [busy, run] = useBusy();
  if (props.view === null || props.view === undefined) return <Empty>Money is off in this world.</Empty>;
  const view = decodeFinanceView(props.view);
  if (!view) return <JsonView value={props.view} />;
  const controls: PlayerControls = {
    mode: "player",
    busy,
    currency: props.state.currency ?? DEFAULT_CURRENCY,
    palette: props.state.palette,
    // A tap while one is in flight is dropped (useBusy), so it answers false rather than never.
    act: (body) => (busy ? Promise.resolve(false) : new Promise<boolean>((resolve) => run(async () => resolve((await app.request(actionRequest(props.chatId, body))) !== null)))),
  };
  return (
    <div class="lre-stack" data-lre-panel="economy.money">
      <MoneyHub view={view} label="Your money" controls={controls} />
    </div>
  );
}
