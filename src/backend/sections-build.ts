// The sections a turn gives the narrator (DESIGN §6.2, §6.11, §24.3), built in one place: the
// turn's delivery and the GM's preview of it (GM → This chat → Sections) read the same renderers,
// scopes, caps, marks and budgets, so the preview is what the next prompt gets.

import type { SlotId } from "../shared/ids";
import { KNOWLEDGE_DEFAULTS, KNOWLEDGE_SLOT, MINDS_SLOT, type KnowledgeSettings } from "../shared/minds";
import { secretMarkText, type SecretMarkWording } from "../shared/secret-marks";
import type { NarratorView } from "../shared/settings";
import type { ContextGeneration } from "../shared/state-view";
import type { FeedScope, SectionFeed, SectionTemplate, WorldDoc } from "../shared/world";
import { feedOf, linesOf, markedText, renderersOf, sectionScope, secretLineText, sourceOf } from "../engine/feed";
import { optionalQuery } from "../engine/pack-kit";
import { readPass } from "../engine/read-pass";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { findLeaks } from "../engine/visibility";
import { hiddenNameCheck } from "../engine/player-events";
import { fitMindLines, mindLines } from "../packs/minds/core/section";
import { renderSection, sectionsOf } from "./book";
import { missingSections, withoutMissing } from "./section-refs";
import { spanText } from "../engine/action-words";

export interface SectionsInput {
  registry: Registry;
  world: WorldDoc;
  state: Readonly<WorldState>;
  /** What the player character doesn't know: a line carrying one's words is marked as a secret, or left out, as the narrator's knowledge says. */
  secrets: readonly string[];
  /** The narrator's knowledge (`backend/chat-knowledge-prefs.ts`): this chat's own choice (null when it follows), and the knowledge in force. */
  narrator: { chat: NarratorView | null; view: NarratorView };
  /** The wording of a secret's mark (Settings → Narrator). */
  wording: SecretMarkWording;
  /** The shared section budget, and the Minds section's own (tokens). */
  budget: number;
  mindsBudget: number;
  /**
   * The user's knowledge settings (DESIGN §24.11): the Who knows what section's limits and wording
   * (`minds.knowing`), and its own token cap (`narratorTokens`); absent, the defaults.
   */
  knowledge?: KnowledgeSettings;
  /** The player's words this turn, which order the minds ladder; empty for none yet. */
  said: string;
  /** What the turn itself tells: its resolution and a timelapse's Montage. */
  planned: { outcome: readonly string[]; montage: readonly string[] };
  outline: readonly string[];
  /** The minutes the turn took, for Scene's elapsed-time line; null without a turn. */
  elapsed: number | null;
  /** Whether the book has an entry for the section to fill: one without is never delivered. */
  hasEntry(section: SectionTemplate): boolean;
  /** A section's size in tokens: the host's count when known, else the estimate. */
  cost(content: string): number;
  /** Told of each text a section may go out as, so the host can count it for next time. */
  seen(content: string): void;
  warn(message: string): void;
}

/** Why a section holds what it does, or nothing. */
export type SectionStatus = "sent" | "off" | "unplaced" | "empty" | "clipped";

/** One section as the turn gives it: its text when sent, its size, and what its caps and budget left out. */
export interface SectionOutcome {
  slot: SlotId;
  label: string;
  rank: number;
  feed: SectionFeed;
  /** Whose knowledge it reads: its own scope, else the narrator's knowledge (`sectionScope`). */
  scope: FeedScope;
  status: SectionStatus;
  /** The text the narrator gets, its marked facts and hints included; null when nothing is sent. */
  content: string | null;
  tokens: number | null;
  /** Lines the section's caps (or the Minds budget) left out. */
  cut: number;
  /** Facts beyond the player character's riding in it, each marked (a secret's words among them), and background hints. */
  marked: number;
  hints: number;
}

export interface SectionsBuilt {
  sections: SectionOutcome[];
  /** The inspector's rows (`core.context`): never a trace of a marked fact or a hint. */
  record: ContextGeneration["sections"];
  /** What goes into the book, in the order it's written, and the slots a row stands for. */
  fills: { slot: SlotId; content: string }[];
  recorded: SlotId[];
  used: number;
}

/** A line of a section as it is built, with the fact it tells part of (`FeedLine.group`, under its renderer's name); none, and it stands alone. */
interface Told {
  text: string;
  group?: string;
}

/** Lines a section keeps or leaves out whole: one fact's, or a line on its own. */
interface Unit {
  group: string | undefined;
  lines: string[];
}

/** Lines as units: each fact's lines together, where its first line stands; every other line on its own. */
function unitsOf(lines: readonly Told[]): Unit[] {
  const units: Unit[] = [];
  const facts = new Map<string, Unit>();
  for (const { text, group } of lines) {
    const known = group === undefined ? undefined : facts.get(group);
    if (known) {
      known.lines.push(text);
      continue;
    }
    const unit: Unit = { group, lines: [text] };
    units.push(unit);
    if (group !== undefined) facts.set(group, unit);
  }
  return units;
}

/** The lines units hold, in order. */
const linesIn = (units: readonly Unit[]): string[] => units.flatMap((u) => u.lines);

/** The first units within `max` lines (all of them without one): the first past it is left out whole, with every one after it. */
function withinLines(units: readonly Unit[], max: number | undefined): Unit[] {
  if (max === undefined) return [...units];
  const out: Unit[] = [];
  let count = 0;
  for (const unit of units) {
    count += unit.lines.length;
    if (count > max) break;
    out.push(unit);
  }
  return out;
}

export function buildSections(input: SectionsInput): SectionsBuilt {
  const { registry, world, state, secrets } = input;
  const record: ContextGeneration["sections"] = [];
  const outcomes = new Map<SlotId, SectionOutcome>();
  const fills: { slot: SlotId; content: string }[] = [];
  const recorded: SlotId[] = [];
  // Slots in rank order on the section budget; Outcome (rank 0) is never clipped (DESIGN §6.2). A
  // later section over what is left is trimmed by whole lines from its end until it fits (a fact told
  // in several lines, `FeedLine.group`, by all of them at once), and left out whole only when not
  // even its header and first line fit. The Minds section has its own budget and never spends the
  // shared one (DESIGN §24.3).
  let budget = input.budget;
  const mindsBudget = input.mindsBudget;
  // A line carrying a secret's words (the leak screen's, `findLeaks`): under "marked" it goes in
  // marked as a secret kept from the player character, whatever the scope; under "omit" it is left
  // out, in every scope.
  const marking = input.narrator.view.secrets === "marked";
  const carries = (text: string): boolean => findLeaks(text, secrets).length > 0;
  const pov = state.entities[world.pov]?.name ?? world.entities[world.pov]?.name ?? world.pov;
  const secret = (text: string): string => secretMarkText(text, [], [pov], input.wording);
  // Sections with lines that ride once every section has its place: hints (Stance's cues, §6.6) and
  // facts beyond the POV's, a secret's lines among them (§6.11), none counted in what the player sees.
  const hinted: { fill: { slot: SlotId; content: string } | null; slot: SlotId; label: string; template: string; lines: string[]; marked: Unit[]; hints: string[]; cost: number; maxTokens: number | undefined; maxLines: number | undefined }[] = [];
  const outcome = (section: SectionTemplate, feed: SectionFeed, scope: FeedScope, status: SectionStatus, more: Partial<SectionOutcome> = {}): void => {
    outcomes.set(section.id, { slot: section.id, label: section.label, rank: section.rank, feed, scope, status, content: null, tokens: null, cut: 0, marked: 0, hints: 0, ...more });
  };
  // The sections all read the head's state, many times over: one read pass (DESIGN §9.6).
  readPass(() => {
    // The Minds section on its own budget (DESIGN §24.3): the best on the ladder first, the lowest left
    // out until it fits. A mind's line that carries a secret's words, or names someone or something
    // the POV can't see, goes in marked as a secret known to whose mind it is and kept from the POV,
    // or is left out, whatever the world's minds secrecy (`full` lines skip the minds' own screens).
    // Only those it tells of are out of Stance, which tells of everyone else: so it is fitted as it
    // will go out, its switch and its caps for this chat included, and a Minds section switched off,
    // or with nowhere to go, tells of no one and leaves everyone to Stance.
    const mindsSection = sectionsOf(world).find((s) => s.id === MINDS_SLOT);
    const mindsFeed = mindsSection ? feedOf(mindsSection, state) : null;
    const mindsOn = mindsSection !== undefined && mindsFeed?.enabled !== false && input.hasEntry(mindsSection);
    const read = registry.context(world, state);
    const hidden = hiddenNameCheck(registry, world, state, world.pov);
    const allMinds = mindsOn ? mindLines(read).flatMap((l) => (!carries(l.line) && !hidden(l.line) ? [l] : marking ? [{ ...l, line: secretMarkText(l.line, [l.name], [pov], input.wording) }] : [])) : [];
    const ladder = (optionalQuery(read, "minds.fidelity")?.(read, { user: input.said, reply: "" }) ?? []).map((s) => s.entity);
    const mindsCap = Math.min(mindsBudget, mindsFeed?.maxTokens ?? Number.POSITIVE_INFINITY);
    const mindsFit = mindsSection && mindsOn ? fitMindLines(allMinds, ladder, mindsCap, (kept) => input.cost(renderSection(mindsSection.label, mindsSection.template, kept.map((l) => l.line)))).slice(0, mindsFeed?.maxLines ?? Number.POSITIVE_INFINITY) : [];
    // The user's knowledge settings reach the Who knows what section through its query (DESIGN §24.11).
    const ctx = registry.context(world, state, { "minds.minded": () => mindsFit.map((l) => l.entity), ...(input.knowledge ? { "minds.knowing": () => input.knowledge as KnowledgeSettings } : {}) });
    const nameOf = (id: string): string => state.entities[id]?.name ?? world.entities[id]?.name ?? id;
    // The sections filled so far, in rank order: the Outline points only at those (DESIGN §9.5).
    const filled = new Set<string>();
    for (const section of sectionsOf(world)) {
      // The world's settings for the section, the GM's in this chat over them (§6.11); its scope
      // follows the narrator's knowledge unless one of them sets its own.
      const feed = feedOf(section, state);
      const scope = sectionScope(section, state, input.narrator);
      if (feed.enabled === false) {
        outcome(section, feed, scope, "off");
        continue;
      }
      if (!input.hasEntry(section)) {
        outcome(section, feed, scope, "unplaced");
        continue;
      }
      const minds = section.id === MINDS_SLOT;
      // Each line with the fact it tells part of (`FeedLine.group`), under its renderer's name so two
      // renderers' facts never meet: those the player character knows, counted in what the player
      // sees of the section, and those beyond them, marked.
      const lines: Told[] = minds ? mindsFit.map((l) => ({ text: l.line })) : [];
      const hints: string[] = [];
      const beyond: Told[] = [];
      // The facts a secret left a line of out: their other lines beyond the player character's go with it.
      const lost = new Set<string>();
      for (const r of renderersOf(registry.renderers, section, feed)) {
        if (minds) continue;
        try {
          if (r.hint) {
            hints.push(...r.render(ctx));
            continue;
          }
          for (const l of linesOf(r, ctx, scope)) {
            const group = l.group === undefined ? undefined : `${sourceOf(r)}\u0000${l.group}`;
            // A secret line (DESIGN §24.11) goes in marked with whom it is known to and kept from, or
            // not at all, as the narrator's knowledge says; never in the player scope.
            if (l.secret) {
              if (scope === "player") continue;
              const text = secretLineText(l, input.narrator.view.secrets, input.wording, nameOf);
              if (text !== null) beyond.push({ text, group });
              else if (group !== undefined) lost.add(group);
              continue;
            }
            if (l.known === "pov") {
              lines.push({ text: l.text, group });
              continue;
            }
            // A fact beyond the POV's only in the scope that asks for it, marked for the narrator: no
            // player surface reads this copy. Without marks, one carrying a secret's words goes.
            if (scope === "player" || (l.known === "gm" && scope !== "gm")) continue;
            if (!marking && carries(l.text)) {
              if (group !== undefined) lost.add(group);
              continue;
            }
            beyond.push({ text: markedText(l), group });
          }
        } catch (error) {
          input.warn(`section ${section.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (section.id === "outline") lines.push(...withoutMissing(input.outline, missingSections(sectionsOf(world), section.rank, filled, mindsFit.length > 0 && mindsSection !== undefined && input.hasEntry(mindsSection))).map((text) => ({ text })));
      // DESIGN §9.2: every turn has an elapsed time, and the Scene slot states it.
      if (section.id === "scene" && input.elapsed !== null) lines.push({ text: input.elapsed > 0 ? `This turn took ${spanText(input.elapsed)}.` : "No time passes this turn." });
      // The turn's resolution leads the Outcome slot; a timelapse's Montage fills its own.
      if (section.id === "outcome") lines.unshift(...input.planned.outcome.map((text) => ({ text })));
      if (section.id === "montage") lines.push(...input.planned.montage.map((text) => ({ text })));
      // A plain line carrying a secret's words rides first among the marked facts, marked as a
      // secret, so no size the player sees counts it; without marks it is left out, as ever. Its
      // fact's other lines go with it either way. The Minds section's lines were screened above.
      const units = unitsOf(lines);
      const carrying = new Set(minds ? [] : units.filter((u) => u.lines.some(carries)));
      if (!marking) for (const u of carrying) if (u.group !== undefined) lost.add(u.group);
      const plain = units.filter((u) => !carrying.has(u));
      const moved: Told[] = marking ? [...carrying].flatMap((u) => u.lines.map((text) => ({ text: carries(text) ? secret(text) : text, group: u.group }))) : [];
      // A fact's marked lines go whole, and not at all where a secret left one of them out.
      const marked = unitsOf([...moved, ...beyond]).filter((u) => u.group === undefined || !lost.has(u.group));
      // The section's own caps (§6.11): its first lines, then cut from the end to its tokens, a
      // fact's lines whole either way.
      const capped = withinLines(plain, feed.maxLines);
      const markedRoom = feed.maxLines !== undefined ? Math.max(0, feed.maxLines - linesIn(capped).length) : undefined;
      const costOf = (body: readonly Unit[]): number => input.cost(renderSection(section.label, section.template, linesIn(body)));
      // Who knows what has the user's own cap beside any the section sets (DESIGN §24.11).
      const maxTokens = section.id === KNOWLEDGE_SLOT ? Math.min(feed.maxTokens ?? Number.POSITIVE_INFINITY, (input.knowledge ?? KNOWLEDGE_DEFAULTS).narratorTokens) : feed.maxTokens;
      if (maxTokens !== undefined) while (capped.length > 0 && costOf(capped) > maxTokens) capped.pop();
      // Then the shared budget (§6.2): a section over what is left loses whole lines from its end,
      // each counted among its cut lines as its caps' are.
      const kept = [...capped];
      if (!minds && section.rank > 0) while (kept.length > 1 && costOf(kept) > budget) kept.pop();
      // A fact's marked lines ride only with its plain ones, where it has any.
      const cutFacts = new Set(plain.flatMap((u) => (u.group !== undefined && !kept.includes(u) ? [u.group] : [])));
      const facts = withinLines(marked.filter((u) => u.group === undefined || !cutFacts.has(u.group)), markedRoom);
      const safeHints = marking ? hints.map((l) => (carries(l) ? secret(l) : l)) : hints.filter((l) => !carries(l));
      const cut = (minds ? allMinds.length - mindsFit.length : 0) + (linesIn(plain).length - linesIn(kept).length);
      if (kept.length === 0) {
        // A Minds section whose best line alone is over its budget is left out whole.
        if (minds && allMinds.length > 0) {
          record.push({ slot: section.id, label: section.label, tokens: input.cost(renderSection(section.label, section.template, allMinds.map((l) => l.line))), clipped: true, cut: allMinds.length, delivery: "unchecked" });
          outcome(section, feed, scope, "clipped", { cut: allMinds.length });
        } else outcome(section, feed, scope, "empty", { cut });
        // Hints alone never make a section: its being there would tell of them. Marked facts may,
        // in what the budget leaves, with no trace the player sees.
        if (facts.length > 0) hinted.push({ fill: null, slot: section.id, label: section.label, template: section.template, lines: [], marked: facts, hints: safeHints, cost: 0, maxTokens, maxLines: feed.maxLines });
        continue;
      }
      const content = renderSection(section.label, section.template, linesIn(kept));
      input.seen(content);
      const cost = input.cost(content);
      if (minds ? cost > mindsBudget : section.rank > 0 && cost > budget) {
        // Only a section whose header and first line alone are over what is left is left out whole:
        // told at its size as its caps leave it, with only their cut.
        const whole = minds ? cost : costOf(capped);
        const capsCut = cut - (linesIn(capped).length - linesIn(kept).length);
        record.push({ slot: section.id, label: section.label, tokens: whole, clipped: true, ...(capsCut > 0 ? { cut: capsCut } : {}), delivery: "unchecked" });
        outcome(section, feed, scope, "clipped", { tokens: whole, cut: capsCut });
        continue;
      }
      record.push({ slot: section.id, label: section.label, tokens: cost, clipped: false, ...(cut > 0 ? { cut } : {}), delivery: "unchecked" });
      if (!minds) budget -= cost;
      const fill = { slot: section.id, content };
      fills.push(fill);
      filled.add(section.id);
      recorded.push(section.id);
      outcome(section, feed, scope, "sent", { content, tokens: cost, cut });
      if (safeHints.length > 0 || facts.length > 0) hinted.push({ fill, slot: section.id, label: section.label, template: section.template, lines: linesIn(kept), marked: facts, hints: safeHints, cost, maxTokens, maxLines: feed.maxLines });
    }
  });
  const used = input.budget - budget;
  // Hints follow what the POV doesn't know (a hidden flag, a lore gate), and marked facts go beyond
  // it, so both ride last, in what the budget has left, and the inspector counts none of them: no
  // clip, size or total the player sees moves when an off-screen secret changes (§6.2, §6.11).
  // Marked facts go first, a fact's lines at a time while they fit; hints still all or none.
  for (const h of hinted) {
    const fits = (extra: number, total: number): boolean => extra <= budget && (h.maxTokens === undefined || total <= h.maxTokens);
    const costOf = (body: string[]): number => {
      const content = renderSection(h.label, h.template, body);
      input.seen(content);
      return input.cost(content);
    };
    const body = [...h.lines];
    let cost = h.cost;
    let facts = 0;
    for (const m of h.marked) {
      const next = costOf([...body, ...m.lines]);
      if (!fits(next - cost, next)) break;
      budget -= next - cost;
      cost = next;
      body.push(...m.lines);
      facts += m.lines.length;
    }
    // The section's line cap holds for its hints too: they go in whole or not at all.
    let hints = 0;
    if (h.hints.length > 0 && (h.maxLines === undefined || body.length + h.hints.length <= h.maxLines)) {
      const next = costOf([...body, ...h.hints]);
      if (fits(Math.max(0, next - cost), next)) {
        budget -= Math.max(0, next - cost);
        body.push(...h.hints);
        hints = h.hints.length;
      }
    }
    if (body.length === h.lines.length) continue;
    const content = renderSection(h.label, h.template, body);
    if (h.fill) h.fill.content = content;
    else fills.push({ slot: h.slot, content });
    const was = outcomes.get(h.slot);
    if (was) outcomes.set(h.slot, { ...was, status: "sent", content, tokens: input.cost(content), marked: facts, hints });
  }
  return { sections: sectionsOf(world).flatMap((s) => outcomes.get(s.id) ?? []), record, fills, recorded, used };
}
