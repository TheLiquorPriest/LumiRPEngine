// The world's document as the agents that may write it work on it (the skill `world`, searchable tools; plan §6.8, §14 "Build, as
// today"): read it (`world_read`, `world_shape`, `world_status`, `world_history`) and change the world's draft (`world_put`,
// `world_set`, `world_patch`, `world_remove`, `world_discard`, `world_restore`) and commit it as the world's next revision
// (`world_commit`), through the world service Build's routes call. The same checks refuse the same writes; what the world's own
// rules refuse is told as the refusal with its lint issues, never changed. None of these decides anything: each reads or writes
// what its call names. A world is named by its id, and left out it is the one this chat plays. The writes are the engine lane's, so
// the user's setting for that lane asks first.

import type { JsonObject, JsonValue } from "rp-harness/contract";
import { isRecord } from "../../shared/json";
import { getAt, parsePointer } from "../../shared/json-patch";
import type { JsonPatchOp } from "../../shared/json-patch";
import type { LintIssue } from "../../shared/lint";
import type { WorldCollection, WorldPart } from "../../shared/world";
import { nameOf } from "../../shared/world-diff";
import { DraftMoved, WORLD_COLLECTIONS, WorldError } from "../../worlds/worlds";
import type { EditorResult } from "../../worlds/worlds";
import { OBJECT, type Call, type Reply, TEXT, type ToolSpec, WHOLE } from "../kit";
import { numberArg, textArg } from "../ops";
import { Reading, saysUnreadable } from "../reading";
import { textOf } from "../texts";

const FAMILY = "world";

const COLLECTIONS = Object.keys(WORLD_COLLECTIONS) as WorldCollection[];
const PARTS: readonly WorldPart[] = ["calendar", "realism", "time", "meta", "tiers", "ruleset", "loreIndex", "minds", "lorePins", "routineSettings", "needs"];
const SOURCES = ["draft", "playing", "revision"] as const;

/** Where each part sits in the document; `meta` is members of the root itself. */
const PART_AT: Readonly<Record<WorldPart, readonly string[]>> = {
  calendar: ["calendar"],
  realism: ["realism"],
  time: ["time"],
  meta: [],
  tiers: ["tiers"],
  ruleset: ["ruleset"],
  loreIndex: ["loreIndex"],
  minds: ["minds"],
  lorePins: ["lorePins"],
  routineSettings: ["routineSettings"],
  needs: ["needs"],
};

/** How many of a collection's items `world_shape` points to as examples. */
const EXAMPLES = 3;

/** What the call works on: the user, the world (named, or the chat's), and the service. A line has said why not where it is null. */
interface Target {
  user: string;
  world: string;
  service: NonNullable<Call["deps"]["worlds"]>;
}

function targetOf(call: Call, reply: Reply, args: JsonObject): Target | null {
  const service = call.deps.worlds;
  if (service === undefined) {
    reply.line("worlds_none", { tool: call.tool }).fail();
    return null;
  }
  const named = textArg(args, "world");
  const world = named ?? call.deps.store.chat(call.scope.chat)?.world ?? null;
  if (world === null) {
    reply.line("world_not_named", {}).fail();
    return null;
  }
  return { user: call.scope.user, world, service };
}

/** The issues of a lint by severity, and the first of them, as many as `worldListed` allows. */
function lintData(call: Call, lint: readonly LintIssue[]): JsonObject {
  const count = (severity: LintIssue["severity"]): number => lint.filter((i) => i.severity === severity).length;
  const rank = { error: 0, warning: 1, info: 2 } as const;
  const shown = [...lint].sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, call.settings.worldListed);
  return { errors: count("error"), warnings: count("warning"), info: count("info"), issues: shown.map((i) => ({ severity: i.severity, path: i.path, code: i.code, message: i.message })), ...(lint.length > shown.length ? { more: lint.length - shown.length } : {}) };
}

/** A refusal of the world service, as the answer says it: the code, its reason, and the lint issues it carries. */
function refused(call: Call, reply: Reply, error: unknown): Reply {
  if (!(error instanceof WorldError)) throw error;
  reply.line(`world_${error.code}`, { why: error.message }).fail();
  if (error.lint.length > 0) reply.data({ lint: lintData(call, error.lint) });
  // A draft that moved is told as it now stands, so the write can be made again on it.
  if (error instanceof DraftMoved) reply.data({ draft: { version: error.current.version, base: error.current.base, stored: error.current.stored } });
  return reply;
}

/** Runs a call on the service, a refusal of the world's own told as the answer. */
async function guarded(call: Call, run: (reply: Reply) => Promise<Reply>): Promise<Reply> {
  const reply = call.reply();
  try {
    return await run(reply);
  } catch (error) {
    return refused(call, reply, error);
  }
}

/** The collection a call names, or what says it takes one of the list. */
function collectionOf(reply: Reply, args: JsonObject): WorldCollection | null {
  const said = textArg(args, "collection");
  if (said === undefined) {
    reply.line("needs_field", { field: "collection" }).fail();
    return null;
  }
  const found = COLLECTIONS.find((c) => c === said);
  if (found === undefined) reply.line("unreadable", { field: "collection", value: JSON.stringify(said), choices: textOf(COLLECTIONS) }).fail();
  return found ?? null;
}

/** What a value holds, as an outline shows it: how many members, items or characters; a number, true, false and null as they are. */
function held(value: JsonValue): JsonValue {
  if (typeof value === "string") return { text: value.length };
  if (Array.isArray(value)) return { list: value.length };
  if (value !== null && typeof value === "object") return { object: Object.keys(value).length };
  return value;
}

/** The answer to a write of the draft: where it stands now, its lint, and what changed. */
function wrote(call: Call, reply: Reply, target: Target, done: EditorResult, what: JsonObject): Reply {
  return reply.data({ world: target.world, ...what, draft: { version: done.version, base: done.base, stored: done.stored }, lint: lintData(call, done.lint) });
}

// ---------------------------------------------------------------- the reads

const read: ToolSpec = {
  name: "world_read",
  family: FAMILY,
  tier: "read",
  properties: { world: TEXT, source: { type: "string", enum: [...SOURCES] }, revision: TEXT, at: TEXT },
  required: [],
  example: { at: "/entities/bram" },
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const source = textArg(args, "source") ?? "draft";
      if (!(SOURCES as readonly string[]).includes(source)) return reply.line("unreadable", { field: "source", value: JSON.stringify(source), choices: textOf(SOURCES) }).fail();
      const revision = textArg(args, "revision");
      let tokens: string[];
      try {
        tokens = parsePointer(textArg(args, "at") ?? "");
      } catch (error) {
        return reply.line("world_bad_pointer", { at: JSON.stringify(args.at), why: error instanceof Error ? error.message : String(error) }).fail();
      }
      // The draft as it stands, what the chat plays now, or a revision as it was kept.
      let doc: JsonValue;
      if (source === "playing") {
        const playing = Reading.of(call);
        if (!(playing instanceof Reading)) return saysUnreadable(reply, playing);
        doc = playing.doc as unknown as JsonValue;
      } else if (source === "revision") {
        if (revision === undefined) return reply.line("needs_field", { field: "revision" }).fail();
        doc = (await target.service.read(target.user, target.world, revision)).world as unknown as JsonValue;
      } else doc = (await target.service.draft(target.user, target.world, { op: "get" })).draft as unknown as JsonValue;
      const value = getAt(doc, tokens);
      if (value === undefined) {
        const parent = getAt(doc, tokens.slice(0, -1));
        const names = isRecord(parent) ? Object.keys(parent) : [];
        return reply.line("world_nothing_at", { at: textArg(args, "at") ?? "", near: textOf(names.slice(0, call.settings.nearMatches)) }).fail();
      }
      const text = JSON.stringify(value);
      // A value longer than one answer holds is answered as an outline to read further into.
      if (text.length > call.settings.worldChars) {
        const outline = isRecord(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, held(v)])) : Array.isArray(value) ? { list: value.length } : { text: text.length };
        reply.line("world_outline", { at: textArg(args, "at") ?? "", size: text.length });
        return reply.data({ world: target.world, source, at: textArg(args, "at") ?? "", outline: outline as JsonValue });
      }
      return reply.data({ world: target.world, source, at: textArg(args, "at") ?? "", value });
    }),
};

const shape: ToolSpec = {
  name: "world_shape",
  family: FAMILY,
  tier: "read",
  properties: { world: TEXT, collection: TEXT, part: TEXT },
  required: [],
  example: { collection: "entities" },
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const draft = (await target.service.draft(target.user, target.world, { op: "get" })).draft as unknown as JsonValue;
      const part = textArg(args, "part");
      if (part !== undefined) {
        const found = PARTS.find((p) => p === part);
        if (found === undefined) return reply.line("unreadable", { field: "part", value: JSON.stringify(part), choices: textOf(PARTS) }).fail();
        const at = PART_AT[found];
        const value = at.length === 0 ? draft : getAt(draft, at);
        const members = isRecord(value) ? Object.entries(value).map(([key, v]) => ({ key, holds: held(v) })) : [];
        return reply.data({ world: target.world, part: found, kept: value !== undefined, members: members as unknown as JsonValue });
      }
      if (textArg(args, "collection") === undefined) return reply.data({ world: target.world, collections: COLLECTIONS.map((c) => ({ collection: c, items: Object.keys((draft as JsonObject)[c] ?? {}).length })) as unknown as JsonValue, parts: [...PARTS] });
      const collection = collectionOf(reply, args);
      if (collection === null) return reply;
      const items = (draft as JsonObject)[collection];
      const entries = isRecord(items) ? Object.entries(items) : [];
      // What varies between items: each member some item holds, with how many do.
      const members = new Map<string, number>();
      for (const [, item] of entries) if (isRecord(item)) for (const key of Object.keys(item)) members.set(key, (members.get(key) ?? 0) + 1);
      return reply.data({
        world: target.world,
        collection,
        items: entries.length,
        members: [...members].map(([key, items]) => ({ key, items })) as unknown as JsonValue,
        examples: entries.slice(0, EXAMPLES).map(([id, item]) => ({ id, name: nameOf(item) })) as unknown as JsonValue,
      });
    }),
};

const status: ToolSpec = {
  name: "world_status",
  family: FAMILY,
  tier: "read",
  properties: { world: TEXT },
  required: [],
  example: {},
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const [now, head] = await Promise.all([target.service.draft(target.user, target.world, { op: "get" }), target.service.read(target.user, target.world)]);
      return reply.data({ world: target.world, head: head.revision, base: now.base, stored: now.stored, behind: now.base !== null && now.base !== head.revision, version: now.version, lint: lintData(call, now.lint) });
    }),
};

const history: ToolSpec = {
  name: "world_history",
  family: FAMILY,
  tier: "read",
  properties: { world: TEXT, limit: WHOLE },
  required: [],
  example: { limit: 5 },
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const asked = args.limit === undefined || args.limit === null ? call.settings.worldListed : numberArg(args, "limit");
      if (asked === undefined || !Number.isInteger(asked) || asked < 1) return reply.line("unreadable", { field: "limit", value: JSON.stringify(args.limit), wants: call.lines.line("wants_qty") ?? "" }).fail();
      const all = (await target.service.read(target.user, target.world)).history;
      // Newest first, as many as asked and the setting allows.
      const shown = [...all].reverse().slice(0, Math.min(asked, call.settings.worldListed));
      return reply.data({ world: target.world, revisions: shown.map((n) => ({ revision: n.revision, at: n.at, source: n.source, ...(n.note !== undefined ? { note: n.note } : {}) })) as unknown as JsonValue, ...(all.length > shown.length ? { more: all.length - shown.length } : {}) });
    }),
};

// ---------------------------------------------------------------- the writes

/** A write tool: it names its lane, the engine's, and records nothing of the store's: it changes the world's draft. */
function writing(spec: Omit<ToolSpec, "family" | "tier" | "lane">): ToolSpec {
  return { family: FAMILY, tier: "write", lane: "engine", ...spec };
}

/** The `value` argument as the object an item or part is. */
function objectValue(call: Call, reply: Reply, args: JsonObject): JsonObject | null {
  if (args.value === undefined || args.value === null) {
    reply.line("needs_field", { field: "value" }).fail();
    return null;
  }
  if (!isRecord(args.value) || Array.isArray(args.value)) {
    reply.line("unreadable", { field: "value", value: JSON.stringify(args.value), wants: call.lines.line("wants_fields") ?? "" }).fail();
    return null;
  }
  return args.value as JsonObject;
}

const put = writing({
  name: "world_put",
  properties: { world: TEXT, collection: TEXT, id: TEXT, value: OBJECT },
  required: ["collection", "id", "value"],
  example: { collection: "entities", id: "bram", value: { name: "Bram", kind: "character" } },
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const collection = collectionOf(reply, args);
      if (collection === null) return reply;
      const id = textArg(args, "id");
      if (id === undefined) return reply.line("needs_field", { field: "id" }).fail();
      const value = objectValue(call, reply, args);
      if (value === null) return reply;
      const done = await target.service.draft(target.user, target.world, { op: "put", collection, id, value });
      return wrote(call, reply, target, done, { put: { collection, id } });
    }),
});

const set = writing({
  name: "world_set",
  properties: { world: TEXT, part: TEXT, value: {} },
  required: ["part", "value"],
  example: { part: "realism", value: { levels: { money: 2 } } },
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const said = textArg(args, "part");
      if (said === undefined) return reply.line("needs_field", { field: "part" }).fail();
      const part = PARTS.find((p) => p === said);
      if (part === undefined) return reply.line("unreadable", { field: "part", value: JSON.stringify(said), choices: textOf(PARTS) }).fail();
      if (args.value === undefined) return reply.line("needs_field", { field: "value" }).fail();
      const done = await target.service.draft(target.user, target.world, { op: "set", part, value: args.value });
      return wrote(call, reply, target, done, { set: part });
    }),
});

const patch = writing({
  name: "world_patch",
  properties: { world: TEXT, ops: { type: "array", items: OBJECT } },
  required: ["ops"],
  example: { ops: [{ op: "replace", path: "/entities/bram/name", value: "Bram Coyle" }] },
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      if (!Array.isArray(args.ops) || args.ops.length === 0 || !args.ops.every((o) => isRecord(o) && typeof o.op === "string" && typeof o.path === "string")) return reply.line("unreadable", { field: "ops", value: JSON.stringify(args.ops ?? null), wants: call.lines.line("wants_patch") ?? "" }).fail();
      const done = await target.service.draft(target.user, target.world, { op: "patch", ops: args.ops as unknown as JsonPatchOp[] });
      return wrote(call, reply, target, done, { patched: args.ops.length });
    }),
});

const remove = writing({
  name: "world_remove",
  properties: { world: TEXT, collection: TEXT, id: TEXT },
  required: ["collection", "id"],
  example: { collection: "entities", id: "bram" },
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const collection = collectionOf(reply, args);
      if (collection === null) return reply;
      const id = textArg(args, "id");
      if (id === undefined) return reply.line("needs_field", { field: "id" }).fail();
      const done = await target.service.draft(target.user, target.world, { op: "remove", collection, id });
      return wrote(call, reply, target, done, { removed: { collection, id } });
    }),
});

const discard = writing({
  name: "world_discard",
  properties: { world: TEXT },
  required: [],
  example: {},
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const done = await target.service.draft(target.user, target.world, { op: "discard" });
      return wrote(call, reply, target, done, { discarded: true });
    }),
});

const restore = writing({
  name: "world_restore",
  properties: { world: TEXT, revision: TEXT },
  required: ["revision"],
  example: { revision: "r-3" },
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const revision = textArg(args, "revision");
      if (revision === undefined) return reply.line("needs_field", { field: "revision" }).fail();
      const done = await target.service.draft(target.user, target.world, { op: "restore", revision });
      return wrote(call, reply, target, done, { restored: revision });
    }),
});

const commit = writing({
  name: "world_commit",
  properties: { world: TEXT, note: TEXT },
  required: [],
  example: { note: "Bram's inn, and the road to it" },
  run: (args, call) =>
    guarded(call, async (reply) => {
      const target = targetOf(call, reply, args);
      if (target === null) return reply;
      const now = await target.service.draft(target.user, target.world, { op: "get" });
      const note = textArg(args, "note");
      const done = await target.service.commit(target.user, target.world, { base: now.base, ...(note !== undefined ? { note } : {}), source: "agent" });
      return reply.data({ world: target.world, committed: done.revision, lint: lintData(call, done.lint) });
    }),
});

export const WORLD_TOOLS: readonly ToolSpec[] = [read, shape, status, history, put, set, patch, remove, discard, restore, commit];
