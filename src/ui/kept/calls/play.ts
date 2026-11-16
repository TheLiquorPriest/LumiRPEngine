// The play panels' taps, on RPE's typed routes (plan §14, §15.4; PlanChatUI-P2): a panel's action (money,
// a group, gear, a vehicle, the palette's), each ✎ correction and an edit of operations ("Make this a
// property") go to `POST /api/v1/chats/:chat/taps` as typed calls carrying the panel's Tell choice. RPE
// tells what each is: one that manages is his own edit, recorded at once; one that goes with his next
// message is held as his request (or taken back, where the same tap is pressed again); one with words, a
// chip or Send now is played now. An Undo goes by the id the answer gave, to
// `POST /api/v1/chats/:chat/edits/:edit/undo`, not as today's Undo chip. RPE answers a tap it turns down
// with `applied: false` and its words, which come back as the refusal they are.

import type { RequestBody } from "../../../frontend/registry";
import type { TapAsk } from "../../../shared/api";
import type { JsonValue } from "../../../shared/json";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

type Of<T extends RequestBody["type"]> = Extract<RequestBody, { type: T }>;

/** The chat a request is for: the one it names, else the App's. */
function chatOf(request: { chatId?: string }, ctx: CallContext): string {
  const chat = request.chatId ?? ctx.chat();
  if (chat === null) throw new Refusal("not_found", "No chat is open to do that in.");
  return chat;
}

/** What the tap's own variant of `lre.fix` is as the route takes it. */
function fixOf(request: Of<"lre.fix">): { hint: string } | { time: string } | { thing: JsonValue } | { things: JsonValue[]; label: string } | { entity: string; field: string; value: JsonValue } {
  if ("hint" in request) return { hint: request.hint };
  if ("time" in request) return { time: request.time };
  if ("thing" in request) return { thing: request.thing as unknown as JsonValue };
  if ("things" in request) return { things: request.things as unknown as JsonValue[], label: request.label };
  return { entity: request.entity, field: request.field, value: request.value };
}

/** Sends a tap; its refusal, answered as `applied: false` with its words, is thrown as one. */
async function tap(ctx: CallContext, chat: string, body: TapAsk) {
  const reply = await ctx.client.call("POST /api/v1/chats/:chat/taps", { chat }, { body });
  if (!reply.applied) throw new Refusal("bad_request", reply.words);
  return reply;
}

export const calls: CallFile = {
  name: "play",
  takes: (request) => request.type === "lre.action" || request.type === "lre.fix" || request.type === "lre.edit" || (request.type === "lre.chip" && request.choice === "undo"),
  async serve(request, ctx): Promise<ServedBody> {
    switch (request.type) {
      case "lre.action": {
        const chat = chatOf(request, ctx);
        const { undo } = await tap(ctx, chat, { kind: "action", action: request.action, params: request.params, source: request.source, ...(request.text === undefined ? {} : { text: request.text }), ...(request.now === true ? { now: true } : {}), ...(request.tell === undefined ? {} : { tell: request.tell }) });
        return { applied: true, pending: false, undo };
      }
      case "lre.fix": {
        const chat = chatOf(request, ctx);
        const { undo } = await tap(ctx, chat, { kind: "fix", fix: fixOf(request), ...("tell" in request && request.tell !== undefined ? { tell: request.tell } : {}) });
        return { pending: false, undo };
      }
      case "lre.edit": {
        const chat = chatOf(request, ctx);
        const { undo } = await tap(ctx, chat, { kind: "ops", ops: request.ops as unknown as JsonValue[] });
        return { pending: false, undo };
      }
      case "lre.chip": {
        const chat = chatOf(request, ctx);
        const reply = await ctx.client.call("POST /api/v1/chats/:chat/edits/:edit/undo", { chat, edit: request.chip });
        return { applied: reply.applied, pending: false, ...(reply.words === "" ? {} : { said: reply.words }) };
      }
      default:
        throw new Refusal("internal", `The play calls do not take ${request.type}.`);
    }
  },
};
