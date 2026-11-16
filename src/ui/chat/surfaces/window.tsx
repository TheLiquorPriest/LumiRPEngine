// The window marker (plan §14, PlanChatUI-6 item 2): a thin line where the history window ends, saying how
// many messages above it the record does not cover yet, or that all are. It stands in the
// `message_body_after` slot of the message just above the first the window keeps, once per message in
// either display mode, and again whenever that row mounts; where that message is not on the page (the
// window reaches above what Lumiverse has loaded) it shows at the top of the chat, in the toolbar.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Readable } from "../../store";
import type { FrameEnv, SurfaceDef } from "../surface";
import { type WindowState, windowOf, windowWords } from "../window";
import { messageOfScope } from "./working";

function useWindow(store: Readable<WindowState>): WindowState {
  const [now, setNow] = useState(store.get());
  useEffect(() => store.subscribe(setNow), [store]);
  return now;
}

function Line(props: { text: string }) {
  return (
    <div class="lre rpe-chat-window" data-rpe-marker="window" role="separator" aria-label={props.text}>
      <span class="rpe-chat-window-text">{props.text}</span>
    </div>
  );
}

/** The marker under `message`, when it is the one the window's end stands under. */
function Under(props: { env: FrameEnv; message: string }) {
  const { shown } = useWindow(windowOf(props.env));
  if (shown === null || !shown.on || shown.before !== props.message) return null;
  return <Line text={windowWords(shown)} />;
}

/** The marker at the top of the chat, where the message it stands under is not on the page. */
function AtTop(props: { env: FrameEnv }) {
  const { shown } = useWindow(windowOf(props.env));
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    const check = (): void => setMounted(shown?.before == null || document.querySelector(`[data-message-id="${CSS.escape(shown.before)}"]`) !== null);
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [shown?.before]);
  if (shown === null || !shown.on || shown.above === 0 || mounted) return null;
  return <Line text={windowWords(shown)} />;
}

const claimed = new Map<string, HTMLElement>();

function claim(message: string, root: HTMLElement): boolean {
  const holder = claimed.get(message);
  if (holder !== undefined && holder !== root && holder.isConnected) return false;
  claimed.set(message, root);
  return true;
}

function draw(env: FrameEnv, root: HTMLElement, scope: string): void {
  const message = messageOfScope(scope);
  render(message === null || !claim(message, root) ? null : <Under env={env} message={message} />, root);
}

export const surface: SurfaceDef = {
  id: "window",
  surfaces: (env) => [
    {
      key: "window:under",
      placement: "dom-decorator",
      options: {
        mount: "message_body_after",
        render(root, ctx) {
          draw(env, root, ctx.scope);
          return () => {
            const message = messageOfScope(ctx.scope);
            if (message !== null && claimed.get(message) === root) claimed.delete(message);
            render(null, root);
          };
        },
        update: (root, ctx) => draw(env, root, ctx.scope),
      },
    },
    {
      key: "window:top",
      placement: "dom-decorator",
      options: {
        mount: "chat_toolbar",
        render(root) {
          render(<AtTop env={env} />, root);
          return () => render(null, root);
        },
      },
    },
  ],
};
