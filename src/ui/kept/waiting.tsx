// What waits for your next message from a panel (plan §10.10, "A panel action"): a press of the palette,
// the map or a panel that is no tap that manages is held by RPE as a request until your next message, and
// the Author is told then what was pressed and on what. It is shown where you play (the HUD, the Play
// page's strip, the phone's status line) and in the view that was pressed (the palette's action as chosen,
// the map's square as marked): what waits, in the words the briefing gives the Author (`StateView.staged`),
// with Send now, which puts its line in the chat as your message and starts the reply, and Take it back.
// A press is matched to the one that waits by its action and values, an amount of money as the world
// prints it, as RPE keeps it. A press a turn was told and did not carry out (`StateView.notCarried`) is
// shown where you play as not carried out, with Send again, which holds it for your next message once
// more, and Drop, until you choose one.

import { useApp } from "../../frontend/app";
import { Button, IconButton, useBusy } from "../../frontend/components";
import type { JsonObject } from "../../shared/json";
import type { StagedPress, StateView } from "../../shared/state-view";
import { DEFAULT_CURRENCY, formatMoney, type WorldCurrency } from "../../shared/world";
import { errorWords } from "../words";

/** What Send now says once its line is in the chat: the reply comes there. */
export const SENT_NOW = "Sent as your message: the reply is on its way in the chat.";

/** Whether a press of `action` with `params` is the one that waits: the same action, the same values (an amount as the world prints it). */
export function isStaged(staged: StagedPress | null | undefined, action: string, params: JsonObject, currency: WorldCurrency | null): boolean {
  if (!staged || staged.action !== action) return false;
  for (const key of new Set([...Object.keys(staged.values), ...Object.keys(params)])) {
    const held = staged.values[key];
    const pressed = params[key];
    if (typeof pressed === "number" && typeof held === "string" && held === formatMoney(pressed, currency ?? DEFAULT_CURRENCY)) continue;
    if (JSON.stringify(held) !== JSON.stringify(pressed)) return false;
  }
  return true;
}

/** Whether the press that waits is of `action` and holds the picks `params` (an option of the palette, with those before it): that option shows chosen. */
export function holdsPick(staged: StagedPress | null | undefined, action: string, params: JsonObject): boolean {
  return !!staged && staged.action === action && Object.entries(params).every(([key, value]) => JSON.stringify(staged.values[key]) === JSON.stringify(value));
}

/** Whether a turn of the chat runs now: Lumiverse would stop its reply to start another, so nothing is sent now meanwhile. */
export function turnRuns(view: StateView): boolean {
  return view.status === "in_flight" || view.status === "paused";
}

/** Why Send now waits while a turn runs. */
export const TURN_RUNS = "A turn is running: send it once the reply is in.";

/**
 * What waits for your next message, with Send now and Take it back; nothing while none waits. `block`: laid out in a view's body
 * (the palette, the map) rather than in the HUD's strip.
 */
export function WaitingPress(props: { view: StateView; block?: boolean }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const staged = props.view.staged;
  if (!staged) return null;
  const next = app.next;
  const press = (sendNow: boolean): void =>
    run(async () => {
      if (next === undefined) return;
      try {
        if (sendNow) {
          await next.sendNow(props.view.chatId, staged.request);
          app.toast(SENT_NOW, "info");
        } else await next.takeBack(props.view.chatId, staged.request);
      } catch (error) {
        app.toast(errorWords(error), "error");
      }
    });
  return (
    <span class={props.block ? "lre-chat-staged lre-chat-staged-block" : "lre-chat-staged"} data-lre-staged={staged.request} role="group" aria-label="With your next message">
      <span class="lre-chat-staged-text" title={`With your next message: ${staged.label}. The Author is told what you pressed and on what, and plays it with your words.`}>
        With your next message: {staged.label}
      </span>
      {next === undefined ? null : (
        <>
          <Button variant="secondary" size="sm" icon="send" busy={busy} disabled={turnRuns(props.view)} title={turnRuns(props.view) ? TURN_RUNS : "Put it in the chat as your message now, and start the reply"} onClick={() => press(true)}>
            Send now
          </Button>
          <IconButton icon="close" label="Take it back" disabled={busy} onClick={() => press(false)} />
        </>
      )}
    </span>
  );
}

/**
 * Each press a turn was told and did not carry out, with Send again (held for your next message once more, in place of one that
 * waits) and Drop; nothing while none is.
 */
export function NotCarriedPresses(props: { view: StateView }) {
  const app = useApp();
  const [busy, run] = useBusy();
  const missed = props.view.notCarried ?? [];
  if (missed.length === 0) return null;
  const next = app.next;
  const press = (request: string, again: boolean): void =>
    run(async () => {
      if (next === undefined) return;
      try {
        if (again) await next.again(props.view.chatId, request);
        else await next.drop(props.view.chatId, request);
      } catch (error) {
        app.toast(errorWords(error), "error");
      }
    });
  return (
    <>
      {missed.map((p) => (
        <span key={p.request} class="lre-chat-staged lre-chat-staged-missed" data-lre-not-carried={p.request} role="group" aria-label="Not carried out">
          <span class="lre-chat-staged-text" title={`Not carried out: ${p.label}. The turn you pressed it for did not carry it out, nor had the world refuse it.`}>
            Not carried out: {p.label}
          </span>
          {next === undefined ? null : (
            <>
              <Button variant="secondary" size="sm" icon="send" busy={busy} title="Hold it for your next message once more" onClick={() => press(p.request, true)}>
                Send again
              </Button>
              <IconButton icon="close" label="Drop it" disabled={busy} onClick={() => press(p.request, false)} />
            </>
          )}
        </span>
      ))}
    </>
  );
}
