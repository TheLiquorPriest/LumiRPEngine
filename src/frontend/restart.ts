// A reply the engine prepared, started by the page it asks (DESIGN §5.1). The engine ran before a
// reply the guard stopped; a page showing that chat on screen claims the turn (`lre.restart`) and,
// on a yes, starts it with Lumiverse's own Regenerate or Continue, once. The backend says yes only to
// the page holding the turn while no generation took it, so a page that wakes with an old ask never
// starts a second reply. A claim that got no answer (Lumiverse dropped it, or the answer, with the
// socket) doesn't use the turn up: the next ask, which a page gets when it resyncs, claims it again,
// and whichever yes comes first starts it. A new reply after a reply only Send can start.
// A swipe the backend says to ask about first (`push.ask`: Settings → Swipes → Ask what should change
// on each swipe) asks the player once (`ReplyPage.ask`, swipe-ask.tsx), and its claim carries the
// answer (`direction`), which only the narrator reads (Build C item 1).

import type { GenerateAs } from "../shared/protocol";
import type { ProtocolClient } from "./protocol-client";

export interface ReplyPage {
  /** The chat the page shows now. */
  activeChat(): string | null;
  /** Runs Lumiverse's Regenerate or Continue here; false when it couldn't. */
  generate(as: Exclude<GenerateAs, "send">): Promise<boolean>;
  toast(text: string, tone: "info" | "error"): void;
  /** Asks what should change before a swipe's reply starts: the answer, "" for none (Swipe as it is, or the sheet closed). */
  ask?(): Promise<string>;
}

/** How many turns a page remembers it started, told of or asked about. */
const REMEMBERED = 64;

function remember(turns: Set<string>, turn: string): void {
  turns.add(turn);
  if (turns.size > REMEMBERED) turns.delete(turns.values().next().value ?? "");
}

/** Starts the replies the engine asks this page to start; returns the unsubscribe. */
export function startPreparedReplies(client: Pick<ProtocolClient, "onGenerate" | "send" | "visible">, page: ReplyPage): () => void {
  const started = new Set<string>();
  const told = new Set<string>();
  /** Each turn's answer to the ask, so an ask that comes again (a resync, a lost claim) claims with it, asking nothing. */
  const answers = new Map<string, string>();
  /** The turns whose ask is open: one sheet per turn. */
  const asking = new Set<string>();
  return client.onGenerate((push) => {
    if (page.activeChat() !== push.chatId || !client.visible() || started.has(push.turn) || asking.has(push.turn)) return;
    const as = push.as;
    if (as === "send") {
      if (!told.has(push.turn)) page.toast("The engine is ready: press Send for the reply.", "info");
      remember(told, push.turn);
      return;
    }
    const claim = (direction: string): void => {
      void client.send({ type: "lre.restart", chatId: push.chatId, turn: push.turn, ...(direction !== "" ? { direction } : {}) }).then(async (answer) => {
        // Refused, failed or lost: the turn stays for the next ask.
        if (answer.type !== "lre.result" || answer.request !== "lre.restart" || !answer.body.start || started.has(push.turn)) return;
        remember(started, push.turn);
        const command = as === "continue" ? "Continue" : "Regenerate";
        if (!(await page.generate(as))) page.toast(`The engine is ready, but ${command} couldn't start here: use ${command} on the last message.`, "error");
      });
    };
    const known = answers.get(push.turn);
    if (!push.ask || !page.ask || known !== undefined) {
      claim(known ?? "");
      return;
    }
    asking.add(push.turn);
    // An ask that fails (the host's sheet couldn't open) is a swipe as it is: it never holds the reply up.
    void Promise.resolve()
      .then(() => page.ask?.() ?? "")
      .catch(() => "")
      .then((answer) => {
        asking.delete(push.turn);
        const direction = answer.trim();
        answers.set(push.turn, direction);
        if (answers.size > REMEMBERED) answers.delete(answers.keys().next().value ?? "");
        // The player moved to another chat while the sheet was open: that chat's page isn't this turn's, and the next ask here claims with the answer.
        if (page.activeChat() !== push.chatId || started.has(push.turn)) return;
        claim(direction);
      });
  });
}
