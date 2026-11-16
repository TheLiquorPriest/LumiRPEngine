// What an earlier build recorded on a migrated turn (the skill `world`, a searchable read): the engine that played the reply, why it
// stood unplayed, each place where it said something against what its turn decided, the parts of its record by name and the texts
// they name, word for word, as the Turn page shows them. Read-only: nothing is changed. A part is read in slices of
// `engine.carriedChars`, the rest from where the answer stops (`from`). A turn joined to another is told, never followed.

import type { JsonObject } from "rp-harness/contract";
import { TEXT, type ToolSpec, WHOLE } from "../kit";
import { numberArg, textArg } from "../ops";
import { nearestOf, saysUnreadable } from "../reading";
import { textOf } from "../texts";

/** The record's own parts besides its fields and texts, named as `part` takes them. */
const UNPLAYED = "unplayed";
const DEPARTURES = "departures";

const TURN_CARRIED: ToolSpec = {
  name: "turn_carried",
  family: "carried",
  tier: "read",
  properties: { turn: TEXT, part: TEXT, from: WHOLE },
  required: [],
  example: { turn: "t-12", part: "session" },
  async run(args, call) {
    const reply = call.reply();
    const { store } = call.deps;
    const id = textArg(args, "turn") ?? call.scope.turn;
    if (id === undefined) return reply.line("needs_field", { field: "turn" }).fail();
    const turn = store.turn(id);
    if (turn === null || turn.chat !== call.scope.chat) return saysUnreadable(reply, { missing: "turn", id, exist: store.line(call.scope.chat).slice(-call.settings.nearMatches).map((t) => t.turn) });
    if (turn.joined !== null) return saysUnreadable(reply, { missing: "joined", id: turn.id, into: turn.joined });
    const record = call.deps.carried?.record(call.scope.user, turn.id) ?? null;
    if (record === null) return reply.line("carried_none", { turn: turn.id });

    // The parts a record has, by the name `part` takes: its fields, its unplayed reason and departures where it has them, each text by its path.
    const parts = new Map<string, string>();
    for (const f of record.fields) parts.set(f.name, JSON.stringify(f.value));
    if (record.unplayed !== null) parts.set(UNPLAYED, record.unplayed);
    if (record.departures.length > 0) parts.set(DEPARTURES, record.departures.join("\n"));
    for (const t of record.texts) if (t.text !== null) parts.set(t.path, t.text);

    const part = textArg(args, "part");
    if (part === undefined) {
      const sizes = (name: string): number => (parts.get(name) ?? "").length;
      return reply.data({
        turn: record.turn,
        message: record.message,
        swipe: record.swipe,
        engine: record.engine,
        unplayed: record.unplayed,
        departures: record.departures.length,
        fields: record.fields.map((f) => ({ part: f.name, chars: sizes(f.name) }) as JsonObject),
        texts: record.texts.map((t) => ({ part: t.path, of: t.part, ...(t.text === null ? { removed: true } : { chars: t.text.length }) }) as JsonObject),
      });
    }
    const words = parts.get(part);
    if (words === undefined) {
      const names = [...parts.keys(), ...record.texts.filter((t) => t.text === null).map((t) => t.path)];
      const gone = record.texts.some((t) => t.text === null && t.path === part);
      if (gone) return reply.line("carried_removed", { part, turn: turn.id });
      return reply.line("carried_unknown", { part, turn: turn.id, near: textOf(nearestOf(part, names, call.settings).slice(0, call.settings.nearMatches)), parts: textOf(names) }).fail();
    }
    const asked = args.from === undefined || args.from === null ? 0 : numberArg(args, "from");
    if (asked === undefined || !Number.isInteger(asked) || asked < 0) return reply.line("unreadable", { field: "from", value: JSON.stringify(args.from), wants: call.lines.line("wants_qty") ?? "" }).fail();
    const to = Math.min(words.length, asked + call.settings.carriedChars);
    reply.data({ turn: record.turn, part, from: asked, to, of: words.length, text: words.slice(asked, to) } as JsonObject);
    if (to < words.length) reply.line("carried_cut", { part, to, of: words.length });
    return reply;
  },
};

export const CARRIED_TOOLS: readonly ToolSpec[] = [TURN_CARRIED];
