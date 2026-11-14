// Item 9: GM → Assistant, as the page asks it (`lre.assistant`). On a classic or agents chat the
// engine's own agent answers and the thread is kept in the chat's metadata with its bodies in the
// engine's blobs; on a harness chat a LumiAH agent answers in a side session of its own.

import type { Ctx } from "../lib/context";

/** GM → Assistant: one question, waited for until the assistant has answered it. */
export async function askAssistant(ctx: Ctx, chatId: string, text: string): Promise<void> {
  const sent = await ctx.socket.lre<{ thread: { id: string; role: string }[] }>("lre.assistant", { chatId, op: "send", text });
  const asked = sent.thread.filter((m) => m.role === "user").at(-1);
  ctx.log.log({ step: "assistant", action: "created", kind: "GM assistant message", id: asked?.id ?? "?", detail: { chatId, text } });
  const began = Date.now();
  for (;;) {
    await Bun.sleep(5_000);
    const view = await ctx.socket.lre<{ thread: { id: string; role: string; status?: string; text: string }[]; running: unknown }>("lre.assistant", { chatId, op: "get" });
    const answer = view.thread.at(-1);
    if (view.running === null && answer?.role === "assistant") {
      ctx.log.log({ step: "assistant", action: "created", kind: "GM assistant answer", id: answer.id, detail: { chatId, status: answer.status ?? null, chars: answer.text.length } });
      return;
    }
    if (Date.now() - began > 15 * 60_000) throw new Error("the GM assistant gave no answer within 15 min");
  }
}
