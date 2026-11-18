// The Agents page's route of what each agent is given by name (plan §14, the Agents row: "what each is given"; §5.4 `given:`): for a
// chat, every definition in force with each name its `given:` lists, the kind of thing the name is (RPH's own: a file, a stretch of the
// chat, a lore entry, a slice of the prompt; or one of RPE's views: of the world, the story, the cast, the turn, the lore index, the
// ruleset, the map, or a view another area adds), and whether RPE gives it at the chat's newest turn, read through the resolver the
// turn uses (`givenViews`), so a name nothing provides is listed as missing. RPH's own kinds are found by RPH at the run: they are
// shown as its, never read here.

import type { AgentRef } from "rp-harness/contract";
import { route, RouteError, shape } from "../app";
import type { Turns } from "./lane";
import { CARRIED_SESSION, type RunRecord } from "./runs";
import { NO_SESSION } from "./turns";

const T = shape.text();

const GIVEN_KINDS = ["file", "chat", "lore", "prompt", "world", "story", "cast", "turn", "index", "ruleset", "map", "view"] as const;
type GivenKind = (typeof GIVEN_KINDS)[number];

/** The kinds RPH finds itself (`rp-harness`'s attachments): the host is never asked for them. */
const RPH_KINDS: Readonly<Partial<Record<GivenKind, true>>> = { file: true, chat: true, lore: true, prompt: true };

/** What kind of thing a name an agent is given is, by its form. */
function kindOf(ref: string): GivenKind {
  const prefixed = (["file", "lore", "prompt", "world", "story", "cast", "turn", "index", "map"] as const).find((kind) => ref.startsWith(`${kind}:`));
  if (prefixed !== undefined) return prefixed;
  if (ref.startsWith("chat:history[")) return "chat";
  return ref === "ruleset" ? "ruleset" : "view";
}

const givenName = shape.named(
  "GivenName",
  "A name a definition's `given:` lists: what kind of thing it is, who finds it (RPH its own kinds, RPE its views), and whether RPE gives it at the chat's newest turn (null for RPH's, found at the run).",
  shape.object({ name: T, kind: shape.oneOf(...GIVEN_KINDS), by: shape.oneOf("rph", "rpe"), found: shape.nullable(shape.yesNo()) }),
);

const givenReply = shape.named(
  "GivenReply",
  "What each agent definition in force for a chat is given by name, read at the chat's newest turn (null: it has none yet), and the names of RPE's that nothing provides.",
  shape.object({
    chat: T,
    turn: shape.nullable(T),
    definitions: shape.list(shape.object({ name: T, off: shape.yesNo(), given: shape.list(givenName), missing: shape.list(T) })),
  }),
);

export function givenRoutes(turns: Turns) {
  return [
    route({
      method: "GET",
      path: "/api/v1/chats/:chat/given",
      access: "page",
      group: "agents",
      does: "What each agent definition in force for a chat is given by name, each name's kind and whether it resolves at the chat's newest turn as the turn would give it, and the names nothing provides.",
      reply: givenReply,
      handle: async ({ user, params }) => {
        const store = turns.store.user(user);
        // The newest turn on the path that RPE ran, read in the session it played in; a turn a migration carried played in none.
        const path = store.path(params.chat);
        let run: RunRecord | null = null;
        for (let at = path.length - 1; at >= 0 && run === null; at--) {
          const turn = path[at]?.turn ?? null;
          const record = turn === null ? null : turns.runs.record(user, turn);
          run = record === null || record.session === CARRIED_SESSION ? null : record;
        }
        const turn = run?.turn ?? null;
        const scope = run === null ? { user, chat: params.chat, session: NO_SESSION } : { user, chat: params.chat, session: run.session, turn: run.turn };
        const definitions = await turns.harness.definitions.list(scope);
        return {
          chat: params.chat,
          turn,
          definitions: await Promise.all(
            definitions.map(async (d) => {
              const agent: AgentRef = { id: d.name, definition: d.name };
              const ours = d.given.filter((name) => RPH_KINDS[kindOf(name)] !== true);
              const read = new Map((await turns.given(scope, agent, ours, { task: "" })).map((g) => [g.ref, g.text]));
              const given = d.given.map((name) => {
                const kind = kindOf(name);
                const rph = RPH_KINDS[kind] === true;
                return { name, kind, by: rph ? ("rph" as const) : ("rpe" as const), found: rph ? null : (read.get(name) ?? null) !== null };
              });
              return { name: d.name, off: d.off, given, missing: given.flatMap((g) => (g.found === false ? [g.name] : [])) };
            }),
          ),
        };
      },
    }),
  ] as const;
}
