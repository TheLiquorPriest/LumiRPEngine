// The sections a turn gives the narrator (DESIGN §6.2, §6.11, §24.3), built in one place: the
// turn's delivery and the GM's preview of it (GM → This chat → Sections) read the same renderers,
// scopes, caps, sources, marks and budgets, so the preview is what the next prompt gets.

import type { SlotId } from "../shared/ids";
import { MINDS_SLOT, worldMindsOf } from "../shared/minds";
import type { ContextGeneration } from "../shared/state-view";
import type { SectionFeed, SectionTemplate, WorldDoc } from "../shared/world";
import { feedOf, linesOf, markedText, renderersOf } from "../engine/feed";
import { optionalQuery } from "../engine/pack-kit";
import { readPass } from "../engine/read-pass";
import type { Registry } from "../engine/registry-impl";
import type { WorldState } from "../engine/state";
import { findLeaks } from "../engine/visibility";
import { fitMindLines, mindLines } from "../packs/minds/core/section";
import { renderSection, sectionsOf } from "./book";
import { missingSections, withoutMissing } from "./section-refs";
import { spanText } from "../engine/action-words";

type Source = { bookId: string; entryId: string };

export interface SectionsInput {
  registry: Registry;
  world: WorldDoc;
  state: Readonly<WorldState>;
  /** What the player character doesn't know: a line naming one is screened out. */
  secrets: readonly string[];
  /** The shared section budget, and the Minds section's own (tokens). */
  budget: number;
  mindsBudget: number;
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
  status: SectionStatus;
  /** The text the narrator gets, its marked facts and hints included; null when nothing is sent. */
  content: string | null;
  tokens: number | null;
  /** Lines the section's caps (or the Minds budget) left out. */
  cut: number;
  /** Facts beyond the player character's riding in it, each marked, and background hints. */
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
  /** The World Info entries the delivered lines carry. */
  sources: Source[];
  used: number;
}

export function buildSections(input: SectionsInput): SectionsBuilt {
  const { registry, world, state, secrets } = input;
  const record: ContextGeneration["sections"] = [];
  const outcomes = new Map<SlotId, SectionOutcome>();
  const fills: { slot: SlotId; content: string }[] = [];
  const recorded: SlotId[] = [];
  const sources: Source[] = [];
  // Slots in rank order on the section budget; Outcome (rank 0) is never clipped (DESIGN §6.2).
  // The Minds section has its own budget and never spends the shared one (DESIGN §24.3).
  let budget = input.budget;
  const mindsBudget = input.mindsBudget;
  const fullMinds = worldMindsOf(world).secrecy === "full";
  // Sections with lines that ride once every section has its place: hints (Stance's cues, §6.6) and
  // facts beyond the POV's that a scope adds (§6.11), neither counted in what the player sees.
  const hinted: { fill: { slot: SlotId; content: string } | null; slot: SlotId; label: string; template: string; lines: string[]; marked: { text: string; source?: Source }[]; hints: string[]; cost: number; maxTokens: number | undefined; maxLines: number | undefined }[] = [];
  const outcome = (section: SectionTemplate, feed: SectionFeed, status: SectionStatus, more: Partial<SectionOutcome> = {}): void => {
    outcomes.set(section.id, { slot: section.id, label: section.label, rank: section.rank, feed, status, content: null, tokens: null, cut: 0, marked: 0, hints: 0, ...more });
  };
  // The sections all read the head's state, many times over: one read pass (DESIGN §9.6).
  readPass(() => {
    // The Minds section on its own budget (DESIGN §24.3): the best on the ladder first, the lowest left
    // out until it fits. Under `full` the narrator gets each mind whole, to depict and never state;
    // under `brief` the lines are leak-checked once more after their own screens. Only those it tells
    // of are out of Stance, which tells of everyone else: so it is fitted as it will go out, its
    // switch and its caps for this chat included, and a Minds section switched off, or with nowhere
    // to go, tells of no one and leaves everyone to Stance.
    const mindsSection = sectionsOf(world).find((s) => s.id === MINDS_SLOT);
    const mindsFeed = mindsSection ? feedOf(mindsSection, state) : null;
    const mindsOn = mindsSection !== undefined && mindsFeed?.enabled !== false && input.hasEntry(mindsSection);
    const read = registry.context(world, state);
    const allMinds = mindsOn ? mindLines(read).filter((l) => fullMinds || findLeaks(l.line, secrets).length === 0) : [];
    const ladder = (optionalQuery(read, "minds.fidelity")?.(read, { user: input.said, reply: "" }) ?? []).map((s) => s.entity);
    const mindsCap = Math.min(mindsBudget, mindsFeed?.maxTokens ?? Number.POSITIVE_INFINITY);
    const mindsFit = mindsSection && mindsOn ? fitMindLines(allMinds, ladder, mindsCap, (kept) => input.cost(renderSection(mindsSection.label, mindsSection.template, kept.map((l) => l.line)))).slice(0, mindsFeed?.maxLines ?? Number.POSITIVE_INFINITY) : [];
    const ctx = registry.context(world, state, { "minds.minded": () => mindsFit.map((l) => l.entity) });
    // The sections filled so far, in rank order: the Outline points only at those (DESIGN §9.5).
    const filled = new Set<string>();
    for (const section of sectionsOf(world)) {
      // The world's settings for the section, the GM's in this chat over them (§6.11).
      const feed = feedOf(section, state);
      if (feed.enabled === false) {
        outcome(section, feed, "off");
        continue;
      }
      if (!input.hasEntry(section)) {
        outcome(section, feed, "unplaced");
        continue;
      }
      const minds = section.id === MINDS_SLOT;
      const scope = feed.scope ?? "player";
      const lines: string[] = minds ? mindsFit.map((l) => l.line) : [];
      const lineSources: (Source | undefined)[] = lines.map(() => undefined);
      const hints: string[] = [];
      const marked: { text: string; source?: Source }[] = [];
      for (const r of renderersOf(registry.renderers, section, feed)) {
        if (minds) continue;
        try {
          if (r.hint) {
            hints.push(...r.render(ctx));
            continue;
          }
          for (const l of linesOf(r, ctx, scope)) {
            if (l.known === "pov") {
              lines.push(l.text);
              lineSources.push(l.source);
              continue;
            }
            // A fact beyond the POV's only in the scope that asks for it, marked for the narrator. Only
            // the GM scope's skip the leak screen, and only here: no player surface reads this copy.
            if (scope === "player" || (l.known === "gm" && scope !== "gm")) continue;
            if (scope !== "gm" && findLeaks(l.text, secrets).length > 0) continue;
            marked.push({ text: markedText(l), ...(l.source ? { source: l.source } : {}) });
          }
        } catch (error) {
          input.warn(`section ${section.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (section.id === "outline") lines.push(...withoutMissing(input.outline, missingSections(sectionsOf(world), section.rank, filled, mindsFit.length > 0 && mindsSection !== undefined && input.hasEntry(mindsSection))));
      // DESIGN §9.2: every turn has an elapsed time, and the Scene slot states it.
      if (section.id === "scene" && input.elapsed !== null) lines.push(input.elapsed > 0 ? `This turn took ${spanText(input.elapsed)}.` : "No time passes this turn.");
      // The turn's resolution leads the Outcome slot; a timelapse's Montage fills its own.
      if (section.id === "outcome") {
        lines.unshift(...input.planned.outcome);
        lineSources.unshift(...input.planned.outcome.map(() => undefined));
      }
      if (section.id === "montage") lines.push(...input.planned.montage);
      while (lineSources.length < lines.length) lineSources.push(undefined);
      const screened = lines.map((text, i) => ({ text, source: lineSources[i] })).filter((l) => minds || findLeaks(l.text, secrets).length === 0);
      // The section's own caps (§6.11): its first lines, then cut from the end to its tokens.
      const capped = feed.maxLines !== undefined ? screened.slice(0, feed.maxLines) : [...screened];
      const markedRoom = feed.maxLines !== undefined ? Math.max(0, feed.maxLines - capped.length) : marked.length;
      if (feed.maxTokens !== undefined) while (capped.length > 0 && input.cost(renderSection(section.label, section.template, capped.map((l) => l.text))) > feed.maxTokens) capped.pop();
      const safe = capped.map((l) => l.text);
      const facts = marked.slice(0, markedRoom);
      const safeHints = hints.filter((l) => findLeaks(l, secrets).length === 0);
      const cut = (minds ? allMinds.length - mindsFit.length : 0) + (screened.length - capped.length);
      if (safe.length === 0) {
        // A Minds section whose best line alone is over its budget is left out whole.
        if (minds && allMinds.length > 0) {
          record.push({ slot: section.id, label: section.label, tokens: input.cost(renderSection(section.label, section.template, allMinds.map((l) => l.line))), clipped: true, cut: allMinds.length, delivery: "unchecked" });
          outcome(section, feed, "clipped", { cut: allMinds.length });
        } else outcome(section, feed, "empty", { cut });
        // Hints alone never make a section: its being there would tell of them. Marked facts may,
        // in what the budget leaves, with no trace the player sees.
        if (facts.length > 0) hinted.push({ fill: null, slot: section.id, label: section.label, template: section.template, lines: [], marked: facts, hints: safeHints, cost: 0, maxTokens: feed.maxTokens, maxLines: feed.maxLines });
        continue;
      }
      const content = renderSection(section.label, section.template, safe);
      input.seen(content);
      const cost = input.cost(content);
      const clipped = minds ? cost > mindsBudget : section.rank > 0 && cost > budget;
      record.push({ slot: section.id, label: section.label, tokens: cost, clipped, ...(cut > 0 ? { cut } : {}), delivery: "unchecked" });
      if (clipped) {
        outcome(section, feed, "clipped", { tokens: cost, cut });
        continue;
      }
      if (!minds) budget -= cost;
      const fill = { slot: section.id, content };
      fills.push(fill);
      filled.add(section.id);
      recorded.push(section.id);
      sources.push(...capped.flatMap((l) => (l.source ? [l.source] : [])));
      outcome(section, feed, "sent", { content, tokens: cost, cut });
      if (safeHints.length > 0 || facts.length > 0) hinted.push({ fill, slot: section.id, label: section.label, template: section.template, lines: safe, marked: facts, hints: safeHints, cost, maxTokens: feed.maxTokens, maxLines: feed.maxLines });
    }
  });
  const used = input.budget - budget;
  // Hints follow what the POV doesn't know (a hidden flag, a lore gate), and marked facts go beyond
  // it, so both ride last, in what the budget has left, and the inspector counts none of them: no
  // clip, size or total the player sees moves when an off-screen secret changes (§6.2, §6.11).
  // Marked facts go first, one at a time while they fit; hints still all or none.
  for (const h of hinted) {
    const fits = (extra: number, total: number): boolean => extra <= budget && (h.maxTokens === undefined || total <= h.maxTokens);
    const costOf = (body: string[]): number => {
      const content = renderSection(h.label, h.template, body);
      input.seen(content);
      return input.cost(content);
    };
    const body = [...h.lines];
    let cost = h.cost;
    const carried: Source[] = [];
    let facts = 0;
    for (const m of h.marked) {
      const next = costOf([...body, m.text]);
      if (!fits(next - cost, next)) break;
      budget -= next - cost;
      cost = next;
      body.push(m.text);
      if (m.source) carried.push(m.source);
      facts++;
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
    sources.push(...carried);
    const was = outcomes.get(h.slot);
    if (was) outcomes.set(h.slot, { ...was, status: "sent", content, tokens: input.cost(content), marked: facts, hints });
  }
  return { sections: sectionsOf(world).flatMap((s) => outcomes.get(s.id) ?? []), record, fills, recorded, sources, used };
}
