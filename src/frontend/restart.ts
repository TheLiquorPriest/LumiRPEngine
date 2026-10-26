// A reply the engine prepared, started by the page it asks (DESIGN §5.1). The engine ran before a
// reply the guard stopped; a page showing that chat on screen claims the turn (`lre.restart`) and,
// on a yes, starts it with Lumiverse's own Regenerate or Continue, once. The backend says yes only to
// the page holding the turn while no generation took it, so a page that wakes with an old ask never
// starts a second reply. A claim that got no answer (Lumiverse dropped it, or the answer, with the
// socket) doesn't use the turn up: the next ask, which a page gets when it resyncs, claims it again,
// and whichever yes comes first starts it. A new reply after a reply only Send can start.

import type { GenerateAs } from "../shared/protocol";
import type { ProtocolClient } from "./protocol-client";

export interface ReplyPage {
  /** The chat the page shows now. */
  activeChat(): string | null;
  /** Runs Lumiverse's Regenerate or Continue here; false when it couldn't. */
  generate(as: Exclude<GenerateAs, "send">): Promise<boolean>;
  toast(text: string, tone: "info" | "error"): void;
}

/** How many turns a page remembers it started or told of. */
const REMEMBERED = 64;

function remember(turns: Set<string>, turn: string): void {
  turns.add(turn);
  if (turns.size > REMEMBERED) turns.delete(turns.values().next().value ?? "");
}

/** Starts the replies the engine asks this page to start; returns the unsubscribe. */
export function startPreparedReplies(client: Pick<ProtocolClient, "onGenerate" | "send" | "visible">, page: ReplyPage): () => void {
  const started = new Set<string>();
  const told = new Set<string>();
  return client.onGenerate((push) => {
    if (page.activeChat() !== push.chatId || !client.visible() || started.has(push.turn)) return;
    const as = push.as;
    if (as === "send") {
      if (!told.has(push.turn)) page.toast("The engine is ready: press Send for the reply.", "info");
      remember(told, push.turn);
      return;
    }
    void client.send({ type: "lre.restart", chatId: push.chatId, turn: push.turn }).then(async (claim) => {
      // Refused, failed or lost: the turn stays for the next ask.
      if (claim.type !== "lre.result" || claim.request !== "lre.restart" || !claim.body.start || started.has(push.turn)) return;
      remember(started, push.turn);
      const command = as === "continue" ? "Continue" : "Regenerate";
      if (!(await page.generate(as))) page.toast(`The engine is ready, but ${command} couldn't start here: use ${command} on the last message.`, "error");
    });
  });
}
