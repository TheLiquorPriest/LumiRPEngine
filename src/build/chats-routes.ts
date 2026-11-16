// A world's chats, moving a chat on from its next turn, and attaching a world to a chat, on RPE's own typed routes (plan §4.4, §14;
// PlanChatUI-B4), over the world service's chats (`src/worlds/chats.ts`). Every route takes a chat, a world, a revision or his picks, never
// a turn id; an Upgrade and an attach are his own changes, taking effect from the chat's next turn. They answer only for the user this RPE
// belongs to.

import type { UpgradePicks } from "../shared/ledger";
import { route, shape } from "../app";
import type { WorldService } from "../worlds/service";
import { refusalOf } from "./worlds-routes";

const T = shape.text();
const field = shape.field;
const opt = shape.optional;

export const WORLD_CHATS_PATH = "/api/v1/worlds/chats";
export const CHAT_UPGRADE_PATH = "/api/v1/chats/:chat/upgrade";

const worldChat = shape.named(
  "WorldChat",
  "A chat that plays one of his worlds: its name, the world and the revision it plays now (a move that waits for its next turn counted), the world's head, and whether it is behind.",
  shape.object({
    chat: field(T, "The chat's id."),
    name: field(T, "Its name in Lumiverse; its id where Lumiverse gives none."),
    world: field(T, "The world it plays."),
    worldName: field(T, "The world's name."),
    revision: field(T, "The revision it plays now."),
    head: field(shape.nullable(T), "The world's head revision; null where the world is gone from his worlds."),
    behind: field(shape.yesNo(), "The world has a newer revision than the chat plays."),
    reason: opt(T, "Why the chat cannot be moved on."),
  }),
);

async function guarded<A>(work: () => Promise<A>): Promise<A> {
  try {
    return await work();
  } catch (error) {
    return refusalOf(error);
  }
}

export function chatsRoutes(service: WorldService) {
  return [
    route({
      method: "GET",
      path: WORLD_CHATS_PATH,
      access: "page",
      group: "worlds",
      does: "The chats that play one of his worlds (one world's, or one chat), each with its name, the revision it plays and whether that is behind the world's head.",
      query: { world: opt(T, "Only the chats that play this world."), chat: opt(T, "Only this chat, if it plays a world.") },
      reply: shape.object({ chats: shape.list(worldChat) }),
      handle: ({ query, user }) => guarded(async () => ({ chats: await service.chats.chatsOf(user, { ...(query.world === undefined ? {} : { world: query.world }), ...(query.chat === undefined ? {} : { chat: query.chat }) }) })),
    }),
    route({
      method: "POST",
      path: "/api/v1/worlds/:world/attach",
      access: "page",
      group: "worlds",
      does: "Attaches the world to a chat. A chat that plays no world takes the world's head revision from its next turn (a turn that runs now keeps the state it started with); one that plays an older revision of it is answered with where it stands, so the Upgrade is offered, and one that plays another world, with which. RPE writes nothing to Lumiverse for it.",
      body: shape.object({ chat: field(T, "The chat to attach it to.") }),
      reply: shape.named(
        "WorldAttached",
        "What attaching came to: whether the chat plays the world's head from its next turn, the revision it plays, where it stood if it played a world already, and whether a turn runs now.",
        shape.object({
          attached: field(shape.yesNo(), "The chat takes the world's head revision from its next turn."),
          revision: field(T, "The revision it plays, or will."),
          plays: opt(shape.object({ world: field(T, "The world it plays."), name: field(T, "That world's name."), revision: field(T, "The revision it plays."), behind: field(shape.yesNo(), "That world has a newer revision.") }), "For a chat that plays a world already."),
          waiting: field(shape.yesNo(), "A turn runs now, so the next turn is the first to play it."),
        }),
      ),
      handle: ({ params, body, user }) => guarded(async () => (await service.chats.attach(user, params.world, body.chat)) as never),
    }),
    route({
      method: "GET",
      path: CHAT_UPGRADE_PATH,
      access: "page",
      group: "worlds",
      does: "What moving the chat to a revision of its world would bring in, entity by entity and part by part, each with the pick it defaults to and why; a secret row is marked behind the spoiler gate.",
      query: { to: field(T, "The revision to move to.") },
      reply: shape.json(),
      handle: ({ params, query, user }) => guarded(async () => (await service.chats.preview(user, params.chat, query.to)) as never),
    }),
    route({
      method: "POST",
      path: CHAT_UPGRADE_PATH,
      access: "page",
      group: "worlds",
      does: "Moves the chat to a revision of its world from its next turn, with his picks (a change not named takes its default): his own change, placed after the newest reply while a run goes on. The turn that runs now keeps the revision it started with; the next plays the new one and tells the Author.",
      body: shape.object({ to: field(T, "The revision to move to."), merge: opt(shape.json(), "His picks by entity; none takes every default.") }),
      reply: shape.named(
        "ChatUpgraded",
        "What the move came to: the revision the chat plays from its next turn, the id its Undo takes (null where it already plays that revision), whether it took effect, and whether a turn runs now.",
        shape.object({ revision: field(T, "The revision from the next turn."), edit: field(shape.nullable(T), "The id its Undo takes."), applied: field(shape.yesNo(), "It took effect where it was recorded."), waiting: field(shape.yesNo(), "A turn runs now.") }),
      ),
      handle: ({ params, body, user }) => guarded(async () => await service.chats.upgrade(user, params.chat, body.to, (body.merge ?? {}) as UpgradePicks)),
    }),
    route({
      method: "POST",
      path: `${CHAT_UPGRADE_PATH}/undo`,
      access: "page",
      group: "worlds",
      does: "Takes an Upgrade of the chat back, whole: the chat goes to the revision it came from, from its next turn; what play changed since stays as played.",
      body: shape.object({ edit: field(T, "The id the Upgrade's answer gave.") }),
      reply: shape.named("ChatUpgradeUndone", "Whether the Upgrade was taken back, and why not where it was not.", shape.object({ undone: field(shape.yesNo(), "Something was recorded."), words: field(T, "Why not, in words; empty where it was.") })),
      handle: ({ params, body, user }) => guarded(async () => await service.chats.undoUpgrade(user, params.chat, body.edit)),
    }),
  ] as const;
}
