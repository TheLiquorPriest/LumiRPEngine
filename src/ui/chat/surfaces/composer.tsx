// The composer's two controls (plan §10.3, §10.10, §14), in Lumiverse's input-bar tools row
// (`chat_input_tools_right`): the depth the next message is asked to be played at, and how the next
// swipe is played with a line of feedback. What each offers is what the shipped file lists
// (`../choices.ts`); an ask is held in RPE for the next message (`../asks.ts`), shown as set until the
// turn takes it, and cleared with the control's own "none". Each draws at a phone's width too: the
// panel opens above the control, kept inside the screen (`../popover.tsx`).

import { render } from "preact";
import { useRef, useState } from "preact/hooks";
import { type Asks, useAsks } from "../asks";
import { type Choice, useChoices } from "../choices";
import { Popover } from "../popover";
import type { DecoratorContext, FrameEnv, SurfaceDef } from "../surface";

const SCOPE = /^chat:(.+):input-tools-right$/;

/** The chat a composer anchor is for: Lumiverse names it in the anchor's scope. */
export function chatOfScope(scope: string): string | null {
  return SCOPE.exec(scope)?.[1] ?? null;
}

function DepthControl(props: { asks: Asks; choices: readonly Choice[] }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const set = props.asks.of("depth");
  const chosen = set?.asked.choice ?? null;
  return (
    <span class="rpe-chat-ctl">
      <button ref={anchor} type="button" class="lre-btn rpe-chat-ctl-btn" data-set={chosen !== null} aria-haspopup="dialog" aria-expanded={open} aria-label={chosen === null ? "Depth for the next message" : `Depth for the next message: ${chosen}`} onClick={() => setOpen(!open)}>
        <span class="rpe-chat-ctl-name">Depth</span>
        {chosen === null ? null : <span class="rpe-chat-ctl-value">{chosen}</span>}
      </button>
      {open ? (
        <Popover anchor={anchor.current} label="Depth for the next message" onClose={() => setOpen(false)}>
          <div class="rpe-chat-pop-head">Depth for the next message</div>
          <div role="radiogroup" aria-label="Depth">
            <button type="button" role="radio" aria-checked={chosen === null} class="rpe-chat-opt" onClick={() => void props.asks.withdraw("depth").then(() => setOpen(false))}>
              <span class="rpe-chat-opt-name">None</span>
              <span class="rpe-chat-opt-about">The Author chooses.</span>
            </button>
            {props.choices.map((choice) => (
              <button key={choice.name} type="button" role="radio" aria-checked={chosen === choice.name} class="rpe-chat-opt" onClick={() => void props.asks.hold("depth", choice.name, null).then(() => setOpen(false))}>
                <span class="rpe-chat-opt-name">{choice.name}</span>
                <span class="rpe-chat-opt-about">{choice.about}</span>
              </button>
            ))}
          </div>
          {props.asks.failed === null ? null : <div class="rpe-chat-note">{props.asks.failed}</div>}
        </Popover>
      ) : null}
    </span>
  );
}

function SwipeControl(props: { asks: Asks; choices: readonly Choice[] }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const set = props.asks.of("swipe");
  const [mode, setMode] = useState<string | null>(null);
  const [words, setWords] = useState("");
  const chosen = set?.asked.choice ?? null;
  const picked = mode ?? chosen ?? props.choices[0]?.name ?? null;
  const opened = (): void => {
    if (!open) {
      setMode(chosen);
      setWords(set?.asked.words ?? "");
    }
    setOpen(!open);
  };
  return (
    <span class="rpe-chat-ctl">
      <button ref={anchor} type="button" class="lre-btn rpe-chat-ctl-btn" data-set={chosen !== null} aria-haspopup="dialog" aria-expanded={open} aria-label={chosen === null ? "How the next swipe is played" : `How the next swipe is played: ${chosen}`} onClick={opened}>
        <span class="rpe-chat-ctl-name">Swipe</span>
        {chosen === null ? null : <span class="rpe-chat-ctl-value">{chosen}</span>}
      </button>
      {open ? (
        <Popover anchor={anchor.current} label="How the next swipe is played" onClose={() => setOpen(false)}>
          <div class="rpe-chat-pop-head">How the next swipe is played</div>
          <div role="radiogroup" aria-label="Swipe mode">
            {props.choices.map((choice) => (
              <button key={choice.name} type="button" role="radio" aria-checked={picked === choice.name} class="rpe-chat-opt" onClick={() => setMode(choice.name)}>
                <span class="rpe-chat-opt-name">{choice.name}</span>
                <span class="rpe-chat-opt-about">{choice.about}</span>
              </button>
            ))}
          </div>
          <textarea class="rpe-chat-words" aria-label="Feedback for the next swipe" placeholder="What was wrong with it? (optional)" value={words} onInput={(event) => setWords(event.currentTarget.value)} />
          {props.asks.failed === null ? null : <div class="rpe-chat-note">{props.asks.failed}</div>}
          <div class="rpe-chat-row">
            {chosen === null ? null : (
              <button type="button" class="lre-btn" onClick={() => void props.asks.withdraw("swipe").then(() => setOpen(false))}>
                Clear
              </button>
            )}
            <button type="button" class="lre-btn lre-btn-primary" disabled={picked === null} onClick={() => picked !== null && void props.asks.hold("swipe", picked, words).then(() => setOpen(false))}>
              Set for the next swipe
            </button>
          </div>
        </Popover>
      ) : null}
    </span>
  );
}

/** Both controls for `chat`: each is offered only where its file lists choices. */
export function Composer(props: { env: FrameEnv; chat: string }) {
  const { client } = props.env;
  const asks = useAsks(client, props.chat);
  const depths = useChoices(client, props.chat, "depth");
  const modes = useChoices(client, props.chat, "swipe");
  if (depths.length === 0 && modes.length === 0) return null;
  return (
    <div class="lre rpe-chat-controls">
      {depths.length === 0 ? null : <DepthControl asks={asks} choices={depths} />}
      {modes.length === 0 ? null : <SwipeControl asks={asks} choices={modes} />}
    </div>
  );
}

function draw(env: FrameEnv, root: HTMLElement, ctx: DecoratorContext): void {
  const chat = chatOfScope(ctx.scope);
  render(chat === null ? null : <Composer key={chat} env={env} chat={chat} />, root);
}

export const surface: SurfaceDef = {
  id: "composer",
  surfaces: (env) => [
    {
      key: "composer",
      placement: "dom-decorator",
      options: {
        mount: "chat_input_tools_right",
        render(root, ctx) {
          draw(env, root, ctx);
          return () => render(null, root);
        },
        update: (root, ctx) => draw(env, root, ctx),
      },
    },
  ],
};
