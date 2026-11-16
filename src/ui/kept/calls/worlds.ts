// Build's editor on RPE's typed routes (plan §4.4, §14; PlanChatUI-B6 item 4, B4 item 5): today's `lre.world` (every op, attach, a
// world's chats and an Upgrade among them), `lre.editor`, `lre.things` and `lre.character` in Build's scope, and the preview of an Upgrade
// (today's `lre.marker` of kind `migrate` with `preview`) go to the worlds routes, and the answer comes back as today's result body, so
// today's components are unchanged. A draft write that the route says found the draft moved on (nothing was written) is the `conflict`
// today's editor reloads on; a commit the world's errors block is `validation` with their lint. A draft change made anywhere else (RPE's
// live feed, kind `world` on the user's own channel) is today's `lre.draft.changed`.

import type { RequestBody } from "../../../frontend/registry";
import type { LiveEvent } from "../../../shared/api";
import type { JsonValue } from "../../../shared/json";
import { PROTOCOL_VERSION, type ResultBodies } from "../../../shared/protocol";
import type { LintIssue } from "../../../shared/lint";
import type { UpgradePreview } from "../../../shared/upgrade";
import type { CallContext, CallFile, ServedBody } from "../client";
import { Refusal } from "../client";
/** What a route answers, as the result body today's components read: the routes carry documents as JSON, whose shapes the world service holds. */
function todays<T>(answer: unknown): T {
  return answer as T;
}


type Of<T extends RequestBody["type"]> = Extract<RequestBody, { type: T }>;

/** What attaching a world to a chat that plays another one says: the page shows it as it shows any refusal. */
const otherWorld = (name: string, revision: string): string => `This chat plays ${name} already, at revision ${revision.slice(0, 8)}; a chat plays one world.`;

/** What a write that found the draft moved on says, as today's editor words its conflict. */
const moved = (version: number): Refusal => new Refusal("conflict", `the draft changed since you read it (it is at version ${version} now); reload and retry`);

async function world(request: Of<"lre.world">, ctx: CallContext): Promise<ResultBodies["lre.world"]> {
  const call = ctx.client.call;
  switch (request.op) {
    case "list":
      return await call("GET /api/v1/worlds", {});
    case "templates":
      return await call("GET /api/v1/worlds/templates", {});
    case "get":
      return todays(await call("GET /api/v1/worlds/:world", { world: request.worldId }, { query: request.revision === undefined ? {} : { revision: request.revision } }));
    case "create":
      return todays(await call("POST /api/v1/worlds", {}, { body: { name: request.name, template: request.template } }));
    case "import":
      return todays(await call("POST /api/v1/worlds/import", {}, { body: { file: request.file } }));
    case "delete":
      return await call("DELETE /api/v1/worlds/:world", { world: request.worldId });
    case "export":
      return await call("GET /api/v1/worlds/:world/export", { world: request.worldId }, { query: request.revision === undefined ? {} : { revision: request.revision } });
    case "lint":
      return todays(await call("GET /api/v1/worlds/:world/lint", { world: request.worldId }, { query: request.revision === undefined ? {} : { revision: request.revision } }));
    case "sheet":
      return todays(await call("POST /api/v1/worlds/:world/sheet", { world: request.worldId }, { body: { ruleset: request.ruleset, ...(request.entity === undefined ? {} : { entity: request.entity }) } }));
    case "updates":
      return todays(await call("GET /api/v1/worlds/:world/updates", { world: request.worldId }, { query: request.revision === undefined ? {} : { revision: request.revision } }));
    case "commit": {
      const made = await call("POST /api/v1/worlds/:world/commit", { world: request.worldId }, { body: { base: request.base, ...(request.note === undefined ? {} : { note: request.note }), ...(request.version === undefined ? {} : { version: request.version }) } });
      if (made.revision === null) throw new Refusal("validation", made.message ?? "the world has errors", made.lint as unknown as LintIssue[]);
      return { revision: made.revision, lint: made.lint as unknown as LintIssue[] };
    }
    case "attach": {
      const done = await call("POST /api/v1/worlds/:world/attach", { world: request.worldId }, { body: { chat: request.chatId } });
      if (done.attached || done.plays === undefined) return { revision: done.revision };
      if (done.plays.world !== request.worldId) throw new Refusal("conflict", otherWorld(done.plays.name, done.plays.revision));
      // It plays an older revision of this world: the Upgrade is offered, not refused.
      return { revision: done.plays.revision, chats: [{ chatId: request.chatId, name: "", worldId: request.worldId, revision: done.plays.revision, behind: done.plays.behind }] };
    }
    case "chats":
      return await call("GET /api/v1/worlds/chats", {}, { query: { ...(request.worldId === undefined ? {} : { world: request.worldId }), ...(request.chatId === undefined ? {} : { chat: request.chatId }) } }).then((answer) => ({
        chats: answer.chats.map((c) => ({ chatId: c.chat, name: c.name, worldId: c.world, revision: c.revision, behind: c.behind, head: c.head, ...(c.reason === undefined ? {} : { reason: c.reason }) })),
      }));
    case "upgrade": {
      const done = await call("POST /api/v1/chats/:chat/upgrade", { chat: request.chatId }, { body: { to: request.to, ...(request.merge === undefined ? {} : { merge: request.merge as unknown as JsonValue }) } });
      return { revision: done.revision, ...(done.waiting ? { pending: true } : {}), ...(done.edit === null ? {} : { undo: done.edit }) };
    }
    case "limits": {
      // The sizes Build's "Change the selected" writes its patch in: `engine.editOps` operations at a time, never more than one patch of a draft may carry.
      const read = await call("GET /api/v1/settings", {});
      const whole = (key: string): number => {
        const value = read.settings.find((s) => s.key === key)?.value;
        if (typeof value !== "number") throw new Refusal("internal", `RPE gave no value for ${key}.`);
        return value;
      };
      return { limits: { editOps: whole("engine.editOps"), patchOps: whole("worlds.patchOps") } };
    }
    case "undo_upgrade": {
      const done = await call("POST /api/v1/chats/:chat/upgrade/undo", { chat: request.chatId }, { body: { edit: request.edit } });
      return { undone: done.undone, words: done.words };
    }
    default:
      throw new Refusal("internal", "The worlds calls do not take this lre.world op.");
  }
}

async function editor(request: Of<"lre.editor">, ctx: CallContext): Promise<ResultBodies["lre.editor"]> {
  const call = ctx.client.call;
  const params = { world: request.worldId };
  const base = { base: request.base, ...(request.version === undefined ? {} : { version: request.version }) };
  const answer = async () => {
    switch (request.op) {
      case "get":
        return await call("GET /api/v1/worlds/:world/draft", params);
      case "discard":
        return await call("POST /api/v1/worlds/:world/draft/discard", params, { body: request.version === undefined ? {} : { version: request.version } });
      case "put":
        return await call("PUT /api/v1/worlds/:world/draft/items/:collection/:id", { ...params, collection: request.collection, id: request.id }, { body: { value: request.value, ...base } });
      case "remove":
        return await call("DELETE /api/v1/worlds/:world/draft/items/:collection/:id", { ...params, collection: request.collection, id: request.id }, { query: { ...(request.base === null ? {} : { base: request.base }), ...(request.version === undefined ? {} : { version: request.version }) } });
      case "set":
        return await call("PUT /api/v1/worlds/:world/draft/parts/:part", { ...params, part: request.part }, { body: { value: request.value, ...base } });
      case "profile":
        return await call("POST /api/v1/worlds/:world/draft/profile", params, { body: { profile: request.profile, choices: request.choices, ...base } });
      case "patch":
        return await call("POST /api/v1/worlds/:world/draft/patch", params, { body: { ops: request.ops as never, ...base } });
      case "restore":
        return await call("POST /api/v1/worlds/:world/draft/restore", params, { body: { revision: request.revision, ...base } });
      case "shipped":
        return await call("POST /api/v1/worlds/:world/draft/shipped", params, { body: { tables: request.tables, ...base } });
    }
  };
  const reply = await answer();
  if (reply.moved) throw moved(reply.version);
  return { draft: todays(reply.draft), lint: reply.lint as unknown as LintIssue[], base: reply.base, stored: reply.stored, version: reply.version };
}

async function things(request: Of<"lre.things">, ctx: CallContext): Promise<ResultBodies["lre.things"]> {
  if (request.scope !== "build") throw new Refusal("internal", "The worlds calls take Things in Build's scope alone.");
  const call = ctx.client.call;
  const params = { world: request.worldId };
  switch (request.op) {
    case "list":
      return (await call("GET /api/v1/worlds/:world/things", params)) as ResultBodies["lre.things"];
    case "types":
      return (await call("GET /api/v1/worlds/:world/things/types", params)) as ResultBodies["lre.things"];
    case "find":
      return (await call("GET /api/v1/worlds/:world/things/find", params, { query: { words: request.words } })) as ResultBodies["lre.things"];
    case "thing":
      return (await call("GET /api/v1/worlds/:world/things/:entity", { ...params, entity: request.entity })) as ResultBodies["lre.things"];
    case "person":
      return (await call("GET /api/v1/worlds/:world/people/:entity/things", { ...params, entity: request.entity })) as ResultBodies["lre.things"];
    default:
      throw new Refusal("bad_request", "the op is list, thing, person, find or types");
  }
}

export const calls: CallFile = {
  name: "worlds",
  takes: (request) => request.type === "lre.world" || request.type === "lre.editor" || (request.type === "lre.things" && request.scope === "build") || (request.type === "lre.character" && request.scope === "build") || (request.type === "lre.marker" && request.kind === "migrate" && request.preview === true),
  async serve(request, ctx): Promise<ServedBody> {
    switch (request.type) {
      case "lre.world":
        return await world(request, ctx);
      case "lre.editor":
        return await editor(request, ctx);
      case "lre.things":
        return await things(request, ctx);
      case "lre.character": {
        if (request.scope !== "build") throw new Refusal("internal", "The worlds calls take a character in Build's scope alone.");
        return (await ctx.client.call("GET /api/v1/worlds/:world/characters/:entity", { world: request.worldId, entity: request.entity })) as ServedBody;
      }
      case "lre.marker": {
        if (request.kind !== "migrate") throw new Refusal("internal", "The worlds calls take the preview of an Upgrade alone.");
        const upgrade = await ctx.client.call("GET /api/v1/chats/:chat/upgrade", { chat: request.chatId }, { query: { to: request.to } });
        return { pending: false, preview: { lines: [], upgrade: upgrade as unknown as UpgradePreview } };
      }
      default:
        throw new Refusal("internal", `The worlds calls do not take ${request.type}.`);
    }
  },
  live(event: LiveEvent): readonly unknown[] {
    if (event.kind !== "world" || event.data.part !== "draft") return [];
    return [{ lre: PROTOCOL_VERSION, type: "lre.draft.changed", worldId: event.data.world, version: event.data.version ?? 0, stored: event.data.stored ?? false, base: null }];
  },
};
