// The things browser's reads, Belongings' + Add's catalog, Tidy up and Keep in the world, on RPE's typed routes (plan §14, §15.4;
// PlanChatUI-P3 item 3, -P6, -P7): in the GM scope, GM → Things' list with where the player character is and why each thing is had,
// a thing's page with the GM's rest, history and findings, a person's things, a search and the catalog; Tidy up's run, and Leave it
// or bring back, written to the chat's leave list; what the chat made in play beside the world's draft, and Keep in the world, whose
// draft patch goes to Build's draft route as one write, refused unchanged where the draft moved on. In the play scope, the catalog.
// A fix Tidy up offers is an edit of his (`lre.edit`), the play call file's. Build's own things, of a world's draft, are the worlds'
// call file's.

import type { RequestBody } from "../../../frontend/registry";
import type { ResultBodies } from "../../../shared/protocol";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";

type Things = Extract<RequestBody, { type: "lre.things" }>;
type Body = ResultBodies["lre.things"];

function isChats(request: RequestBody): request is Things & { scope: "gm" | "play" } {
  return request.type === "lre.things" && (request.scope === "gm" || request.scope === "play");
}

/** Tidy up's own control of how many findings a run shows: today's user setting `tidy.findings`, now RPE's global `things.tidyRunMost`. */
function runMostOf(request: RequestBody): number | null {
  if (request.type !== "lre.settings.set") return null;
  const { patch } = request;
  const tidy = patch.tidy;
  if (Object.keys(patch).length !== 1 || typeof tidy !== "object" || tidy === null || Array.isArray(tidy) || Object.keys(tidy).length !== 1) return null;
  return typeof tidy.findings === "number" ? tidy.findings : null;
}

/** The world's draft as Build holds it now: its parts the readers take, and what a write names of it. */
async function draftOf(ctx: CallContext): Promise<{ world: string; draft: { entities: unknown; places: unknown }; base: string | null; version: number }> {
  const world = ctx.world();
  if (world === null) throw new Refusal("not_world_chat", "This chat plays no world to keep anything in.");
  const held = (await ctx.client.call("GET /api/v1/worlds/:world/draft", { world })) as unknown as { draft: { entities: unknown; places: unknown }; base: string | null; version: number };
  return { world, draft: { entities: held.draft.entities, places: held.draft.places }, base: held.base, version: held.version };
}

export const calls: CallFile = {
  name: "things",
  takes: (request) => isChats(request) || runMostOf(request) !== null,
  async serve(request, ctx): Promise<ServedBody> {
    const runMost = runMostOf(request);
    if (runMost !== null) {
      await ctx.client.call("PUT /api/v1/settings", {}, { body: { level: "global", key: "things.tidyRunMost", value: runMost } });
      return {} as ServedBody;
    }
    if (!isChats(request)) throw new Refusal("internal", "The things calls do not take that request.");
    const chat = request.chatId;
    const { client } = ctx;
    switch (request.op) {
      case "list":
        return (await client.call("GET /api/v1/chats/:chat/gm/things", { chat })) as unknown as Body;
      case "types": {
        const catalog = (await client.call("GET /api/v1/chats/:chat/things/types", { chat })) as unknown as { types: NonNullable<Body["types"]> };
        return { types: catalog.types };
      }
      case "find":
        return { found: (await client.call("GET /api/v1/chats/:chat/things/find", { chat }, { query: { words: request.words } })) as unknown as NonNullable<Body["found"]> };
      case "thing":
        return (await client.call("GET /api/v1/chats/:chat/gm/things/:entity", { chat, entity: request.entity })) as unknown as Body;
      case "person":
        return (await client.call("GET /api/v1/chats/:chat/gm/people/:entity/things", { chat, entity: request.entity })) as unknown as Body;
      case "tidy":
        return (await client.call("GET /api/v1/chats/:chat/tidy", { chat })) as unknown as Body;
      case "leave":
        return (await client.call("POST /api/v1/chats/:chat/tidy/left", { chat }, { body: { key: request.key, left: request.left } })) as unknown as Body;
      case "made": {
        const { draft } = await draftOf(ctx);
        return (await client.call("POST /api/v1/chats/:chat/made", { chat }, { body: { draft: draft as never } })) as unknown as Body;
      }
      case "keep": {
        const { world, draft, base, version } = await draftOf(ctx);
        const keep = (await client.call("POST /api/v1/chats/:chat/made/keep", { chat }, { body: { draft: draft as never, things: request.things, places: request.places } })) as unknown as { ops: unknown[]; kept: NonNullable<Body["kept"]> };
        if (keep.ops.length > 0) {
          const wrote = (await client.call("POST /api/v1/worlds/:world/draft/patch", { world }, { body: { ops: keep.ops as never, base, version } })) as unknown as { moved: boolean };
          if (wrote.moved) throw new Refusal("conflict", "The world's draft changed while this was kept: nothing was copied. Keep them again.");
        }
        const after = await draftOf(ctx);
        const made = (await client.call("POST /api/v1/chats/:chat/made", { chat }, { body: { draft: after.draft as never } })) as unknown as Body;
        return { kept: keep.kept, ...made };
      }
      default:
        throw new Refusal("internal", "The things calls do not take that request.");
    }
  },
};
