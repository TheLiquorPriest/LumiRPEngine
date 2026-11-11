// The game master's surfaces no tool of the old engines reaches, as the harness gives them: a place
// made in play taken out again and a saved set forgotten (both ops the engine has had, with no tool
// to send them), the list of the effects `gm_effect` runs (which an agent could only run by knowing
// their ids), and what the reply's writer is given of the world, section by section (GM → This chat
// → Sections). The writes go through the turn's writer, as the old engines' write tools do: the
// same op, the same checks, the same change types and modes.

import { SURFACE_NOTE, SURFACE_TOOL } from "../../../../shared/harness-texts-surfaces";
import { HARNESS_FAMILY } from "../../../../shared/harness-text-kit";
import type { JsonObject } from "../../../../shared/json";
import { type ItemOp, nameKey, type PlaceOp, setsOf } from "../../../../shared/things";
import type { SectionFeed } from "../../../../shared/world";
import { chatFeed, feedOf } from "../../../../engine/feed";
import { own } from "../../../../engine/pack-kit";
import { sectionsOf } from "../../../book";
import { WorldError } from "../../../worlds";
import { boolArg, needId } from "../propose";
import { resolvePerson, resolvePlace } from "../resolve";
import { needText, objectSchema, text, textArg } from "../schema";
import { checkOrPropose } from "../write/items";
import type { HarnessToolDefinition } from "./kit";

const boolean = (): JsonObject => ({ type: "boolean" });

/** A section's settings in this chat, as `gm_feed` takes them, and whether the chat set them over the world's. */
function feedView(feed: SectionFeed, chat: boolean): JsonObject {
  return { ...(feed.enabled === false ? { enabled: false } : {}), ...(feed.maxLines !== undefined ? { maxLines: feed.maxLines } : {}), ...(feed.maxTokens !== undefined ? { maxTokens: feed.maxTokens } : {}), ...(feed.include !== undefined ? { include: feed.include } : {}), ...(feed.scope !== undefined ? { scope: feed.scope } : {}), ...(chat ? { setInThisChat: true } : {}) };
}

export const SURFACE_TOOLS: readonly HarnessToolDefinition[] = [
  {
    name: SURFACE_TOOL.placeRemove,
    family: HARNESS_FAMILY.places,
    tier: "write",
    parameters: () => objectSchema({ place: text(), dry: boolean() }, ["place"]),
    async run(args, env) {
      const view = await env.reader.view();
      const place = needId(view, SURFACE_TOOL.placeRemove, args, "place", resolvePlace);
      if (typeof place !== "string") return place;
      const change: PlaceOp = { do: "remove", place };
      return checkOrPropose(view, env, { place: change as unknown as JsonObject }, boolArg(args, "dry") === true);
    },
  },
  {
    name: SURFACE_TOOL.setDrop,
    family: HARNESS_FAMILY.items,
    tier: "write",
    parameters: () => objectSchema({ who: text(), set: text(), dry: boolean() }, ["who", "set"]),
    async run(args, env) {
      const view = await env.reader.view();
      const who = needId(view, SURFACE_TOOL.setDrop, args, "who", resolvePerson);
      if (typeof who !== "string") return who;
      const said = needText(view, SURFACE_TOOL.setDrop, args, "set");
      if (typeof said !== "string") return said;
      // A saved set by its id, or its name as the story says it, as `set_apply` finds one.
      const sets = setsOf(view.state.entities[who]?.fields);
      const key = nameKey(said);
      const id = own(sets, said) !== undefined ? said : (Object.keys(sets).find((s) => sets[s]?.name.trim().toLowerCase() === said.trim().toLowerCase()) ?? Object.keys(sets).find((s) => key !== null && nameKey(sets[s]?.name ?? "")?.words.every((w) => key.words.includes(w)) === true));
      if (id === undefined) return view.refuse(SURFACE_NOTE.noSet, { who: view.name(who), set: said, sets: Object.values(sets).map((s) => s.name).join(", ") || view.text(SURFACE_NOTE.noSets) });
      const change: ItemOp = { do: "set_drop", who, set: id };
      return checkOrPropose(view, env, change, boolArg(args, "dry") === true);
    },
  },
  {
    name: SURFACE_TOOL.gmEffects,
    family: HARNESS_FAMILY.money,
    tier: "read",
    parameters: () => objectSchema({ search: text() }, []),
    async run(args, env) {
      const view = await env.reader.view();
      const search = (textArg(args, "search") ?? "").toLowerCase().split(/\s+/).filter((word) => word !== "");
      const effects = [...view.registry.effects.values()]
        .filter((def) => def.gm === true && search.every((word) => def.type.toLowerCase().includes(word)))
        .sort((a, b) => a.type.localeCompare(b.type))
        .map((def) => {
          const optional = def.args.filter((a) => a.endsWith("?")).map((a) => a.slice(0, -1));
          return { effect: def.type, args: def.args.filter((a) => !a.endsWith("?")), ...(optional.length > 0 ? { optional } : {}) };
        });
      if (effects.length === 0) return view.refuse(SURFACE_NOTE.noEffect, { search: search.join(" ") });
      return view.answer({ effects, note: view.text(SURFACE_NOTE.effectsNext) });
    },
  },
  {
    name: SURFACE_TOOL.sectionsRead,
    family: HARNESS_FAMILY.knowledge,
    tier: "read",
    parameters: (world) => objectSchema({ section: text(sectionsOf(world).map((s) => s.id)) }, []),
    async run(args, env) {
      const view = await env.reader.view();
      const sections = sectionsOf(view.world);
      const named = textArg(args, "section");
      if (named !== null && !sections.some((s) => s.id === named)) return view.refuse(SURFACE_NOTE.noSection, { section: named, sections: sections.map((s) => s.id).join(", ") });
      const set = chatFeed(view.state);
      // The sections as the writer would get them now come from the runtime's own builder, where the call reaches it.
      const built = env.build
        ? await env.build.sections().catch((error: unknown) => {
            if (error instanceof WorldError) return null;
            throw error;
          })
        : null;
      const rows = sections
        .filter((s) => named === null || s.id === named)
        .map((s) => {
          const made = built?.sections.find((b) => b.slot === s.id);
          return {
            section: s.id,
            ...(made ? { label: made.label, status: made.status, ...(made.tokens !== null ? { tokens: made.tokens } : {}), ...(made.cut > 0 ? { cut: made.cut } : {}), ...(named !== null && made.content !== null ? { text: made.content } : {}) } : {}),
            settings: feedView(feedOf(s, view.state), own(set, s.id) !== undefined),
          };
        });
      return view.answer({ sections: rows, ...(built ? { budget: built.budget } : { note: view.text(SURFACE_NOTE.noPreview) }) });
    },
  },
];
