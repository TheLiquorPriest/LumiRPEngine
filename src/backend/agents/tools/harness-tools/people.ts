// A person made whole in play: their sheet, where they are, what they hold, how their mind starts.
// One call that makes the person and then gives them what the call says, each part the operation
// the single tools send (`gm_spawn`, `gm_set_field`, `gm_classify`, `gm_link`, `item_make`,
// `item_wear`, `gm_mind_edit`), through the same writer: the same checks, change types, modes and
// caps. The call saves the author a dozen calls and threads the new person's id through them; it
// decides nothing, and adds two rules the single tools don't have: no one is made twice, and an id
// the call gives is in the form the engine mints its own in (`slug`), since every later call, a
// mind's own folder among them, names the person by it.
//
// The person is made first, under an id the call knows (given, or made from their name), so every
// part after names them. In a turn each part is checked on what the call staged before it. A part
// the engine refuses is answered with why and the tool that fixes it, and the rest stand: someone
// who exists with one field wrong is better fixed than made again. A person whose making waits for
// the game master's Apply takes the parts that name them to the review card (`commitStaged`).

import { WRITE_NOTE } from "../../../../shared/agent-tools-write";
import { HARNESS_FAMILY } from "../../../../shared/harness-text-kit";
import { HARNESS_NOTE } from "../../../../shared/harness-texts";
import { PEOPLE_NOTE, PEOPLE_TOOL } from "../../../../shared/harness-texts-people";
import { isRecord, type JsonObject, type JsonValue } from "../../../../shared/json";
import { FIDELITIES, MIND_APPROACHES } from "../../../../shared/minds";
import { own } from "../../../../engine/pack-kit";
import { slug } from "../../../../engine/places-in-play";
import { isGone } from "../../../../engine/scope";
import { contentsOf } from "../../../../engine/things";
import { BOOLEAN, boolArg, gmEdit, missing, refusedAnswer, wordsArg } from "../propose";
import { resolvePlace } from "../resolve";
import { argGiven, badValue, fieldEnum, intArg, integer, jsonObject, kindEnum, needText, objectArg, objectSchema, schemaWorld, text, textArg } from "../schema";
import { relationEnd, tierIds } from "../write/people";
import type { AgentOp } from "../writer";
import { type HarnessToolDefinition, list, words } from "./kit";

const TOOL = PEOPLE_TOOL.personMake;

/** The kind a person is when the call names none, as `person_add` has it. */
const PERSON = "person";

/** A list argument whose items are objects (a tie, a thing held): empty when left out, null when it is anything else. */
const records = (v: JsonValue | undefined): JsonObject[] | null => (v === undefined ? [] : Array.isArray(v) && v.every((x) => isRecord(x)) ? (v as JsonObject[]) : null);

export const PEOPLE_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: TOOL,
    family: HARNESS_FAMILY.people,
    tier: "write",
    parameters: (world) =>
      objectSchema(
        {
          name: text(),
          kind: text(kindEnum(world, PERSON)),
          id: text(),
          place: text(),
          tier: text(tierIds(world)),
          agent: BOOLEAN,
          fields: jsonObject(),
          tags: words(),
          class: jsonObject(),
          relations: list(objectSchema({ relation: text(), to: text(), fields: jsonObject() }, ["relation", "to"])),
          holds: list(objectSchema({ name: text(), type: text(), qty: integer({ minimum: 1 }), worn: BOOLEAN, description: text() }, ["name"])),
          mind: objectSchema({ intent: text(), approach: text(MIND_APPROACHES), notes: words(), level: text(FIDELITIES) }),
          why: text(),
        },
        ["name", "why"],
      ),
    async run(args, env) {
      const view = await env.reader.view();
      if (!env.turn) return view.refuse(HARNESS_NOTE.noTurn);
      const writer = env.writer;
      const stage = writer?.stage?.bind(writer);
      if (!stage) return view.refuse(WRITE_NOTE.noWriter);

      // Everything the call says is read before anything is staged: an argument that can't be read makes no one.
      const name = needText(view, TOOL, args, "name");
      if (typeof name !== "string") return name;
      const why = needText(view, TOOL, args, "why");
      if (typeof why !== "string") return why;
      const world = schemaWorld(view.world, view.registry);
      const kind = textArg(args, "kind") ?? PERSON;
      const kinds = kindEnum(world, PERSON);
      if (!kinds.includes(kind)) return badValue(view, TOOL, "kind", kind, kinds);
      const same = Object.keys(view.state.entities).find((id) => view.isPerson(id) && !isGone(view.state, id) && view.state.entities[id]?.name.trim().toLowerCase() === name.toLowerCase());
      if (same !== undefined) return view.refuse(PEOPLE_NOTE.exists, { name: view.name(same), id: same });
      const given = textArg(args, "id");
      if (given !== null && (given !== slug(given) || own(view.state.entities, given) !== undefined)) return view.refuse(PEOPLE_NOTE.badId, { id: given });
      // The engine's slug falls back on a place's word for a name with no letter or digit in it.
      const base = /[a-z0-9]/i.test(name.normalize("NFD")) ? slug(name) : PERSON;
      let id = given ?? base;
      for (let n = 2; given === null && own(view.state.entities, id) !== undefined; n++) id = `${base}_${n}`;
      let place: string | null = null;
      if (argGiven(args, "place")) {
        const at = resolvePlace(view, textArg(args, "place") ?? "");
        if ("refused" in at) return at.refused;
        place = at.id;
      }
      const tier = textArg(args, "tier");
      const tiers = tierIds(view.world);
      if (tier !== null && !tiers.includes(tier)) return badValue(view, TOOL, "tier", tier, tiers);
      const agent = boolArg(args, "agent");
      const fields = objectArg(args, "fields");
      if (argGiven(args, "fields") && fields === null) return missing(view, TOOL, "fields");
      const known = fieldEnum(world, kind);
      const stray = Object.keys(fields ?? {}).find((field) => !known.includes(field));
      if (stray !== undefined) return view.refuse(PEOPLE_NOTE.noField, { field: stray, kind, fields: known.join(", ") });
      const classes = objectArg(args, "class");
      if (argGiven(args, "class") && classes === null) return missing(view, TOOL, "class");
      const tags = wordsArg(args, "tags");
      const ties: { rel: string; to: string; fields: JsonObject | null }[] = [];
      const said = records(args.relations);
      if (said === null) return missing(view, TOOL, "relations");
      for (const [i, tie] of said.entries()) {
        const rel = textArg(tie, "relation");
        const end = textArg(tie, "to");
        const with_ = objectArg(tie, "fields");
        if (rel === null || end === null || (argGiven(tie, "fields") && with_ === null)) return view.refuse(PEOPLE_NOTE.badItem, { n: String(i + 1), list: "relations", needs: "relation, to" });
        const to = relationEnd(view, end);
        if ("refused" in to) return to.refused;
        ties.push({ rel, to: to.id, fields: with_ });
      }
      const things = records(args.holds);
      if (things === null) return missing(view, TOOL, "holds");
      const nameless = things.findIndex((thing) => textArg(thing, "name") === null);
      if (nameless >= 0) return view.refuse(PEOPLE_NOTE.badItem, { n: String(nameless + 1), list: "holds", needs: "name" });
      const mind = args.mind === undefined ? {} : isRecord(args.mind) ? (args.mind as JsonObject) : null;
      if (mind === null) return missing(view, TOOL, "mind");
      const approach = textArg(mind, "approach");
      if (approach !== null && !MIND_APPROACHES.some((a) => a === approach)) return badValue(view, TOOL, "mind.approach", approach, MIND_APPROACHES);
      const level = textArg(mind, "level");
      if (level !== null && !FIDELITIES.some((f) => f === level)) return badValue(view, TOOL, "mind.level", level, FIDELITIES);
      const intent = textArg(mind, "intent");
      const notes = wordsArg(mind, "notes") ?? [];

      const spawn = await stage(gmEdit({ op: "spawn", kind, name, id, ...(tier !== null ? { tier } : {}), ...(place !== null ? { place } : {}), ...(agent !== null ? { agent } : {}) }));
      if ("refused" in spawn) return refusedAnswer(spawn);

      const parts: object[] = [];
      const refused: object[] = [];
      /** One part staged as the single tool `fix` stages it; a refusal is kept for the answer, and the call goes on. */
      const give = async (part: string, fix: string, op: AgentOp): Promise<boolean> => {
        const out = await stage(op);
        if ("refused" in out) refused.push({ part, code: out.code, reason: out.reason, fix });
        else parts.push({ part, changeType: out.changeType, lines: out.lines });
        return !("refused" in out);
      };
      for (const [field, value] of Object.entries(fields ?? {})) await give(`fields.${field}`, "gm_set_field", gmEdit({ op: "set", entity: id, field, value }));
      if (classes !== null || (tags !== null && tags.length > 0)) await give("class", "gm_classify", gmEdit({ op: "classify", entity: id, class: classes ?? {}, tags: tags ?? [] }));
      for (const tie of ties) await give(`relations.${tie.rel}`, "gm_link", gmEdit({ op: "link", rel: tie.rel, from: id, to: tie.to, ...(tie.fields !== null ? { fields: tie.fields } : {}) }));
      for (const thing of things) {
        const what = textArg(thing, "name") ?? "";
        const type = textArg(thing, "type");
        const qty = intArg(thing, "qty");
        const description = textArg(thing, "description");
        const made = await give(`holds.${what}`, "item_make", gmEdit({ op: "item", change: { do: "make", name: what, at: { in: id }, why, ...(type !== null ? { type } : {}), ...(qty !== null ? { qty } : {}), ...(description !== null ? { description } : {}) } }));
        if (!made || boolArg(thing, "worn") !== true) continue;
        // The engine gave the thing its id: it is found where the make put it, on the person, as the call's next read has it.
        const now = (await env.reader.view()).state;
        const item = contentsOf(now, id).find((held) => own(now.entities, held)?.name.trim().toLowerCase() === what.toLowerCase());
        if (item === undefined) refused.push({ part: `holds.${what}.worn`, code: "not_held", reason: view.text(PEOPLE_NOTE.notOnThem), fix: "item_wear" });
        else await give(`holds.${what}.worn`, "item_wear", gmEdit({ op: "item", change: { do: "wear", item, who: id } }));
      }
      if (intent !== null || approach !== null) await give("mind.intent", "gm_mind_edit", { kind: "mind_edit", edit: { op: "mind_intent", entity: id, ...(intent !== null ? { text: intent } : {}), ...(approach !== null ? { approach } : {}) } });
      for (const [i, note] of notes.entries()) await give(`mind.notes.${i + 1}`, "gm_mind_edit", { kind: "mind_edit", edit: { op: "mind_memory", entity: id, part: "note", id: null, value: { text: note } } });
      if (level !== null) await give("mind.level", "gm_mind_edit", { kind: "mind_edit", edit: { op: "mind_pin", entity: id, level } });

      const waits = spawn.mode === "confirm";
      return view.answer({
        made: { id, name, changeType: spawn.changeType, lines: spawn.lines, lands: waits ? view.text(WRITE_NOTE.stagedReview) : (spawn.written ?? view.text(WRITE_NOTE.staged)) },
        ...(parts.length > 0 ? { parts } : {}),
        ...(refused.length > 0 ? { refused } : {}),
        next: view.text(waits ? PEOPLE_NOTE.nextReview : PEOPLE_NOTE.next, { name, id }),
      });
    },
  },
];
