// The knowledge family (AGENT-LOOP-PLAN §6: "who knows X, what X knows: holdings with how, since,
// belief and discretion"; INC1-SPEC R3a, K1): who holds a fact, and what someone holds. The facts and
// who holds each are K1's (`factsOf`, `knowersOf`); each holding reads as GM → Minds reads it
// (`holdingsView`): how they came by it and from whom, since when, what they take it to be, how sure
// they are (under Settings → Minds → Knowledge's threshold it is a suspicion) and whom they keep it
// from. As each knowledge reads them:
//
// - `pov`: only what Play's player character holds, each fact with only its own holding; a teller,
//   or someone it keeps a fact from, that it can't name is left out, and no fact's id is given (one
//   can name a quest or a field it can't see). What anyone else knows is beyond it (the hidden note).
// - `everyone`: every fact with everyone who holds it, as the narrator would know them; a fact someone
//   holds surely and keeps from anyone is a secret, its claim marked as known to all who hold it
//   surely and kept from whom they keep it from (`factSecrecy`).
// - `gm`: everything, unmarked: each fact's kind, truth (the GM's: true, false or an open question)
//   and what it is about, and what each holding rests on, as GM → Minds words it.
//
// What `about` asks for: a fact by its id; else the facts about what it names (a person, a thing, a
// place or a quest the view may name, each kind tried in turn and none refused aloud, or a lore entry
// by its id), and the facts whose claims share its words as the lore search reads words (`wordsOf`:
// no stop words, no short ones, so a possessive's "s" aside): those about what it names first, then
// those sharing the most words.

import { wordsOf } from "../../../../engine/lore";
import { own } from "../../../../engine/pack-kit";
import { holdingsView } from "../../../../packs/minds/core/gm";
import { factsOf, knowersOf } from "../../../../packs/minds/core/knowledge";
import { readCharacter, readSlice } from "../../../../packs/minds/core/state";
import { TOOL_NOTE } from "../../../../shared/agent-tools";
import type { EntityId } from "../../../../shared/ids";
import { type FactId, type FactKind, type FactTruth, type HoldingBelief, type HoldingHow, type KnowledgeFact, type MindsGmHolding, parseFactId } from "../../../../shared/minds";
import type { Secrecy, ToolReadView, ViewRef } from "../read-view";
import type { ToolDefinition } from "../registry";
import { resolvePerson, resolvePlace, resolveThing, resolveTrack } from "../resolve";
import { needText, objectSchema, text, textArg } from "../schema";

/** A fact as these tools list it: its id, claim, kind and truth as GM → Minds reads them, and the ids it says it is about. */
interface Fact {
  id: FactId;
  claim: string;
  kind: FactKind;
  truth: FactTruth;
  about: readonly string[];
}

/** Someone the view may name, and their hold on a fact as GM → Minds reads it. */
interface Held {
  who: ViewRef;
  holding: MindsGmHolding;
}

/** A fact's part of an answer (`factPart`). */
interface FactAnswer {
  /** Its id; never under `pov`. */
  fact?: FactId;
  /** What it claims; under `everyone` marked when it is a secret. */
  claim: string;
  kind?: FactKind;
  truth?: FactTruth;
  about?: ViewRef[];
}

/** A holding's part of an answer (`holdingPart`). */
interface HoldingAnswer {
  how: HoldingHow;
  /** Who told them, or whom they had it from; null for no one, or for one the view can't name. */
  by: ViewRef | null;
  /** Since when they hold it, in the world's calendar. */
  since: string;
  belief: HoldingBelief;
  confidence: number;
  /** Held less surely than the threshold. */
  suspicion: boolean;
  /** Whom they keep it from, by name, or everyone; absent for no one. */
  keptFrom?: string[] | "everyone";
  /** What it rests on, as GM → Minds words it: under `gm` only, absent for nothing. */
  evidence?: string[];
}

/** knowledge_who_knows: each fact asked for, with everyone the view may list who holds it. */
interface WhoKnows {
  facts: (FactAnswer & { holders: (HoldingAnswer & { who: ViewRef })[] })[];
}

/** knowledge_what_knows: what one person holds. */
interface WhatKnows {
  who: ViewRef;
  facts: (FactAnswer & HoldingAnswer)[];
}

/** The chat's knowledge for one call: its facts, and each person's holdings, read once each. */
interface Knowing {
  facts: Readonly<Record<FactId, KnowledgeFact>>;
  /** What someone holds, newest first; nothing of one the view can't name. */
  heldBy(who: EntityId): Held[];
  /** Who holds a fact, in id order, among those the view can name. */
  holders(fact: FactId): Held[];
}

function knowing(view: ToolReadView): Knowing {
  const slice = readSlice(view.state);
  const read = new Map<EntityId, Held[]>();
  const heldBy = (id: EntityId): Held[] => {
    const known = read.get(id);
    if (known) return known;
    const who = view.entity(id);
    const held = who ? holdingsView(view.ctx, id, readCharacter(view.state, id).witness, view.threshold).map((holding) => ({ who, holding })) : [];
    read.set(id, held);
    return held;
  };
  return {
    facts: factsOf(slice),
    heldBy,
    holders: (fact) => knowersOf(slice, fact).flatMap((id) => heldBy(id).filter(({ holding }) => holding.fact === fact)),
  };
}

/** The fact a holding is of, as GM → Minds reads it (one the chat no longer records goes by its id). */
function heldFact(k: Knowing, holding: MindsGmHolding): Fact {
  return { id: holding.fact, claim: holding.claim, kind: holding.kind, truth: holding.truth, about: own(k.facts, holding.fact)?.about ?? [] };
}

/** The ids `about` names (see the header): a person, a thing, a place or a quest the view may name, each kind tried in turn and none refused aloud, or a lore entry by its id. */
function namedBy(view: ToolReadView, about: string): Set<string> {
  const ids = new Set<string>();
  for (const resolve of [resolvePerson, resolveThing, resolvePlace, resolveTrack]) {
    const got = resolve(view, about);
    if ("id" in got) ids.add(got.id);
  }
  const entry = own(view.world.lore, about);
  if (entry && (view.knowledge !== "pov" || view.povReadsLore(entry))) ids.add(about);
  return ids;
}

/** The ids a fact is about: those it says, and the quest, the entity or the lore entry its id is of. */
function aboutIds(fact: Fact): string[] {
  const ref = parseFactId(fact.id);
  const of = ref?.kind === "track" ? ref.track : ref?.kind === "field" ? ref.entity : ref?.kind === "lore" ? ref.lore : null;
  return of === null ? [...fact.about] : [...fact.about, of];
}

/** The facts among `facts` that `about` asks for (see the header), best first and otherwise in their order; a fact id asks for that fact alone. */
function matching<T extends Fact>(view: ToolReadView, about: string, facts: readonly T[]): T[] {
  if (parseFactId(about) !== null) return facts.filter((f) => f.id === about);
  const named = namedBy(view, about);
  const words = [...new Set(wordsOf(about))];
  return facts
    .map((fact) => {
      const claim = new Set(wordsOf(fact.claim));
      return { fact, names: aboutIds(fact).some((id) => named.has(id)) ? 1 : 0, words: words.filter((w) => claim.has(w)).length };
    })
    .filter((m) => m.names + m.words > 0)
    .sort((a, b) => b.names - a.names || b.words - a.words)
    .map((m) => m.fact);
}

/**
 * A fact's secrecy as the narrator would know it: none, a plain claim, unless someone who holds it
 * surely (no suspicion) keeps it from anyone; then known to all who hold it surely, and kept from
 * everyone if any of them keeps it from everyone, else from all they keep it from.
 */
function factSecrecy(view: ToolReadView, holders: readonly Held[]): Secrecy | null {
  const sure = holders.filter(({ holding }) => !holding.suspicion);
  const kept = sure.map(({ holding }) => holding.keptFromNames).filter((names) => names === "everyone" || names.length > 0);
  if (kept.length === 0) return null;
  return {
    known: sure.map(({ who }) => view.name(who.id)),
    kept: kept.includes("everyone") ? "everyone" : [...new Set(kept.flatMap((names) => (names === "everyone" ? [] : names)))],
  };
}

/** A fact's part of an answer (see the header); `secrecy` gives, under `everyone`, what marks its claim. */
function factPart(view: ToolReadView, fact: Fact, secrecy: () => Secrecy | null): FactAnswer {
  if (view.knowledge === "pov") return { claim: fact.claim };
  if (view.knowledge === "everyone") return { fact: fact.id, claim: view.mark(fact.claim, secrecy()) };
  return { fact: fact.id, claim: fact.claim, kind: fact.kind, truth: fact.truth, about: fact.about.map((id) => view.entity(id) ?? view.place(id) ?? view.track(id) ?? { id, name: view.name(id) }) };
}

/** A holding's part of an answer (see the header): anyone in it the view can't name is left out. */
function holdingPart(view: ToolReadView, h: MindsGmHolding): HoldingAnswer {
  const kept = h.keptFrom === "everyone" ? "everyone" : (h.keptFrom ?? []).flatMap((id) => view.entity(id)?.name ?? []);
  return {
    how: h.how,
    by: h.by === null ? null : view.entity(h.by),
    since: h.sinceText,
    belief: h.belief,
    confidence: h.confidence,
    suspicion: h.suspicion,
    keptFrom: kept === "everyone" || kept.length > 0 ? kept : undefined,
    evidence: view.knowledge === "gm" && h.evidenceShown.length > 0 ? h.evidenceShown.map((e) => e.text) : undefined,
  };
}

export const KNOWLEDGE_TOOLS: readonly ToolDefinition[] = [
  {
    name: "knowledge_who_knows",
    family: "knowledge",
    tier: "read",
    parameters: () => objectSchema({ about: text() }, ["about"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const about = needText(view, "knowledge_who_knows", args, "about");
      if (typeof about !== "string") return about;
      return view.read(() => {
        const k = knowing(view);
        // The player character's own holdings, each fact with only its holding; else every fact the chat records.
        const facts: (Fact & { holders: Held[] })[] =
          view.knowledge === "pov"
            ? k.heldBy(view.pov).map((held) => ({ ...heldFact(k, held.holding), holders: [held] }))
            : Object.values(k.facts).map((f) => ({ id: f.id, claim: f.claim, kind: f.kind, truth: f.truth, about: f.about, holders: k.holders(f.id) }));
        facts.sort((a, b) => a.claim.localeCompare(b.claim) || (a.id < b.id ? -1 : 1));
        return view.answer({
          facts: matching(view, about, facts).map((f) => ({ ...factPart(view, f, () => factSecrecy(view, f.holders)), holders: f.holders.map(({ who, holding }) => ({ who, ...holdingPart(view, holding) })) })),
        } satisfies WhoKnows);
      });
    },
  },
  {
    name: "knowledge_what_knows",
    family: "knowledge",
    tier: "read",
    parameters: () => objectSchema({ person: text(), about: text() }, ["person"]),
    run: async (args, env) => {
      const view = await env.reader.view();
      const said = needText(view, "knowledge_what_knows", args, "person");
      if (typeof said !== "string") return said;
      const about = textArg(args, "about");
      return view.read(() => {
        const person = resolvePerson(view, said);
        if ("refused" in person) return person.refused;
        // Anyone else's knowledge is beyond the player character.
        if (view.knowledge === "pov" && person.id !== view.pov) return view.refuse(TOOL_NOTE.hidden, { pov: view.name(view.pov) });
        const who = view.entity(person.id);
        if (!who) return view.refuse(TOOL_NOTE.noPerson, { name: said });
        const k = knowing(view);
        const held = k.heldBy(person.id).map(({ holding }) => ({ ...heldFact(k, holding), holding }));
        return view.answer({
          who,
          facts: (about === null ? held : matching(view, about, held)).map((f) => ({ ...factPart(view, f, () => factSecrecy(view, k.holders(f.id))), ...holdingPart(view, f.holding) })),
        } satisfies WhatKnows);
      });
    },
  },
];
