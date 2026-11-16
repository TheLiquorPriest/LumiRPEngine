// The working marker (plan §14, PlanChatUI-6 item 3): under the newest reply, from its release to the
// run's end, it says the Author is still working, with the run's newest progress line and a way to the Live
// page. It draws in the `message_body_after` slot of the message the newest turn is tied to, once in either
// display mode (a row and its card both carry the message id: the first slot of a message draws, the
// other stays empty), and again whenever that row mounts.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Readable } from "../../store";
import { type Working, working } from "../working";
import type { FrameEnv, SurfaceDef } from "../surface";

/** The message id a `message_body_after` anchor is for: `message:<id>:<mode>:body-after`. */
export function messageOfScope(scope: string): string | null {
  return /^message:(.+):(?:bubble|minimal)(?::[a-z-]+)?:body-after$/.exec(scope)?.[1] ?? null;
}

function useWorking(store: Readable<Working>): Working {
  const [now, setNow] = useState(store.get());
  useEffect(() => store.subscribe(setNow), [store]);
  return now;
}

function Marker(props: { env: FrameEnv; message: string }) {
  const now = useWorking(working(props.env));
  const chat = props.env.chat.get();
  if (!now.on || now.message !== props.message) return null;
  return (
    <div class="lre rpe-chat-marker" data-rpe-marker="working" role="status" aria-live="polite">
      <span class="lre-chat-pulse" aria-hidden="true" />
      <span class="rpe-chat-marker-text">{now.line ?? "The Author is still working."}</span>
      {chat === null ? null : (
        <button type="button" class="rpe-chat-marker-link" onClick={() => props.env.open({ page: "live", chat })}>
          Live
        </button>
      )}
    </div>
  );
}

/**
 * The anchors of a message that have claimed it: in the display mode where a row and its card both carry the message id, the first
 * anchor to mount draws and the other stays empty, so the marker draws once; when the first is gone the next that mounts claims it.
 */
const claimed = new Map<string, HTMLElement>();

function claim(message: string, root: HTMLElement): boolean {
  const holder = claimed.get(message);
  if (holder !== undefined && holder !== root && holder.isConnected) return false;
  claimed.set(message, root);
  return true;
}

function draw(env: FrameEnv, root: HTMLElement, scope: string): void {
  const message = messageOfScope(scope);
  render(message === null || !claim(message, root) ? null : <Marker env={env} message={message} />, root);
}

export const surface: SurfaceDef = {
  id: "working",
  surfaces: (env) => [
    {
      key: "working",
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
  ],
};
