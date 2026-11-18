// The World page's reads, kept on RPE's typed routes (plan §14; PlanChatUI-P6, -P4 item 4): one part of the GM view at the chat's
// head (`lre.gm.part`), the whole view's world parts where today's page asks for all of it (`lre.gm`), and a person's usual day as the
// player character may know it or as the GM sees it, with whose routines this chat changed (`lre.routine`).

import type { RequestBody } from "../../../frontend/registry";
import type { ResultBodies } from "../../../shared/protocol";
import type { GmView } from "../../../shared/state-view";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

type Of<T extends RequestBody["type"]> = Extract<RequestBody, { type: T }>;

/** The parts of the GM view RPE gives, in the view's order: the characters' minds are the cast record's, on the Cast page. */
const WHOLE = ["entities", "kinds", "tiers", "lifeStates", "domains", "classifications", "places", "tracks", "relationTypes", "money", "orgs", "encounter", "routineRoles", "edits", "refused", "held"] as const;

async function part(ctx: CallContext, request: Of<"lre.gm.part">): Promise<ResultBodies["lre.gm.part"]> {
  const query = {
    ...(request.id !== undefined ? { id: request.id } : {}),
    ...(request.ids !== undefined ? { ids: request.ids.join(",") } : {}),
    ...(request.kind !== undefined ? { kind: request.kind } : {}),
    ...(request.since !== undefined ? { since: request.since } : {}),
    ...(request.bytes === true ? { bytes: "true" } : {}),
  };
  return (await ctx.client.call("GET /api/v1/chats/:chat/gm/parts/:part", { chat: request.chatId, part: request.part }, { query })) as unknown as ResultBodies["lre.gm.part"];
}

async function whole(ctx: CallContext, chat: string): Promise<GmView> {
  const parts = await Promise.all(WHOLE.map((p) => ctx.client.call("GET /api/v1/chats/:chat/gm/parts/:part", { chat, part: p }) as unknown as Promise<{ part: string; value: unknown }>));
  const view = Object.fromEntries(parts.map((p) => [p.part, p.value]));
  return { ...view, minds: { characters: [] } } as unknown as GmView;
}

async function routine(ctx: CallContext, request: Of<"lre.routine">): Promise<ResultBodies["lre.routine"]> {
  const chat = request.chatId;
  if (request.op === "changed") return (await ctx.client.call("GET /api/v1/chats/:chat/routines/changed", { chat })) as unknown as ResultBodies["lre.routine"];
  const query = { view: request.view, ...(request.day !== undefined ? { day: String(request.day) } : {}) };
  return (await ctx.client.call("GET /api/v1/chats/:chat/people/:entity/day", { chat, entity: request.entity }, { query })) as unknown as ResultBodies["lre.routine"];
}

export const calls: CallFile = {
  name: "gm",
  takes: (request) => request.type === "lre.gm.part" || request.type === "lre.gm" || request.type === "lre.routine",
  async serve(request, ctx): Promise<ServedBody> {
    switch (request.type) {
      case "lre.gm.part":
        return await part(ctx, request);
      case "lre.gm":
        return await whole(ctx, request.chatId);
      case "lre.routine":
        return await routine(ctx, request);
      default:
        throw new Refusal("internal", `The GM calls do not take ${request.type}.`);
    }
  },
};
