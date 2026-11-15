// What the page itself shows of one reply, noted by the page's own clock (PlanScenarios-3 item 9; the floor's
// `PageTimes`, `scripts/testbed/floor-measure.ts`): an observer the driver puts in a chat page that notes
// `performance.now()` at each change the page shows, and is read back once the generation has ended. It never
// listens to a socket: the moments are the page's, the ones a person watching would see.
//
// What it watches is Lumiverse's chat page as its source gives it (`MESSAGE_DOM`, the one place those words
// are): Send pressed (a click on the send button, in the capture phase, before the page's own handler); a
// message that was not there before Send and is not the player's, which is the reply; the reply's reasoning
// block showing (the button that opens it mounts once there is reasoning); the reply's text showing; its text
// last changing; and the message ended: no longer marked as streaming, with no stop button in the composer and
// its display no longer pending.
//
// It runs inside the page, self-contained but for the words it is given; `installMoments` is stringified into
// the page, as `page.ts` is.

/** Lumiverse's chat page, as the observer finds what it notes in it. Each is a selector and where the page's source sets it. */
export interface MessageDom {
  /** A message of the chat, the player's or a reply: `BubbleMessageDefault.tsx:393-397` and `MinimalMessageDefault.tsx:370-383` set `data-part` (`user`, `streaming`, `character`) and `data-message-id`. */
  message: string;
  /** What `data-part` is on a player's message, and while a reply streams. */
  parts: { user: string; streaming: string };
  /** The message's text: `MessageContent.tsx:2505`. */
  content: string;
  /** Set on the content while its display is pending after the stream ended: `MessageContent.tsx:2510`. */
  pending: string;
  /** The button that opens a reply's reasoning, mounted when there is reasoning: `ReasoningBlock.tsx:145`. */
  reasoning: string;
  /** The composer's Send button and, while a reply generates, its Stop: `InputArea.tsx:4296-4340`. */
  send: string;
  stop: string;
}

export const MESSAGE_DOM: MessageDom = {
  message: "[data-part][data-message-id]",
  parts: { user: "user", streaming: "streaming" },
  content: '[data-component="MessageContent"]',
  pending: "[data-display-pending]",
  reasoning: "[data-reasoning-toggle]",
  send: 'button[aria-label="Send message"]',
  stop: 'button[aria-label="Stop generation"]',
};

/** What the page noted, on its own clock in ms, null for a moment that did not come. */
export interface Noted {
  sent: number | null;
  firstThinking: number | null;
  firstWord: number | null;
  lastWord: number | null;
  ended: number | null;
  /** The finest step of the page's clock, in ms. */
  resolution: number;
  /** The reply's message id and its text when it ended, for the caller to check against what Lumiverse saved. */
  reply: string | null;
  text: string;
}

export interface MomentsLib {
  /** Starts noting: every message already there is not the reply. Sent is noted at the next click on Send. */
  arm(): void;
  /** What has been noted so far. */
  read(): Noted;
  /** Stops noting. */
  disarm(): void;
}

/** Installs the observer in the page it runs in, at `window.__moments`, with the words of `dom`. */
export function installMoments(dom: MessageDom): void {
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
  let observer: MutationObserver | null = null;
  let onClick: ((event: Event) => void) | null = null;
  let seen = new Set<string>();
  let noted: Noted = { sent: null, firstThinking: null, firstWord: null, lastWord: null, ended: null, resolution: 0, reply: null, text: "" };
  let lastChange: number | null = null;

  const granularity = (): number => {
    // The smallest step the clock is seen to take: read it until it has moved a number of times.
    let smallest = Infinity;
    let before = performance.now();
    for (let moved = 0, spins = 0; moved < 20 && spins < 2_000_000; spins++) {
      const now = performance.now();
      if (now !== before) {
        smallest = Math.min(smallest, now - before);
        before = now;
        moved++;
      }
    }
    return smallest === Infinity ? 1 : Math.round(smallest * 1000) / 1000;
  };

  const scan = (): void => {
    const now = performance.now();
    if (noted.sent === null) return;
    const all = Array.from(document.querySelectorAll(dom.message));
    if (noted.reply === null) {
      const fresh = all.find((el) => el.getAttribute("data-part") !== dom.parts.user && !seen.has(el.getAttribute("data-message-id") ?? ""));
      if (fresh === undefined) return;
      noted.reply = fresh.getAttribute("data-message-id");
    }
    const el = all.find((candidate) => candidate.getAttribute("data-message-id") === noted.reply);
    if (el === undefined) return;
    if (noted.firstThinking === null && el.querySelector(dom.reasoning) !== null) noted.firstThinking = now;
    const content = el.querySelector(dom.content);
    const text = content === null ? "" : norm(content.textContent ?? "");
    if (text !== "" && noted.firstWord === null) noted.firstWord = now;
    if (text !== noted.text) {
      noted.text = text;
      lastChange = now;
    }
    const streaming = el.getAttribute("data-part") === dom.parts.streaming || document.querySelector(dom.stop) !== null || content?.matches(dom.pending) === true || el.querySelector(dom.pending) !== null;
    if (!streaming && text !== "" && noted.ended === null) {
      noted.ended = now;
      noted.lastWord = lastChange ?? now;
    }
  };

  const lib: MomentsLib = {
    arm() {
      lib.disarm();
      seen = new Set(Array.from(document.querySelectorAll(dom.message)).map((el) => el.getAttribute("data-message-id") ?? ""));
      noted = { sent: null, firstThinking: null, firstWord: null, lastWord: null, ended: null, resolution: granularity(), reply: null, text: "" };
      lastChange = null;
      onClick = (event) => {
        const target = event.target instanceof Element ? event.target.closest(dom.send) : null;
        if (target !== null && noted.sent === null) noted.sent = performance.now();
      };
      document.addEventListener("click", onClick, true);
      observer = new MutationObserver(scan);
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    },
    read() {
      scan();
      return { ...noted };
    },
    disarm() {
      observer?.disconnect();
      observer = null;
      if (onClick !== null) document.removeEventListener("click", onClick, true);
      onClick = null;
    },
  };
  Object.assign(window, { __moments: lib });
}

/** The script that installs the observer in a page, with Lumiverse's words. */
export const MOMENTS_SCRIPT: string = `(${installMoments.toString()})(${JSON.stringify(MESSAGE_DOM)});`;
