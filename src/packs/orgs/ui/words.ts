// The Orgs tab's words (ORG-SPEC §4.2-4.4) for what its views hold: lists of names, counts, the
// party's tiers, the page's first line, here and away, a position's seats, limits and successor,
// and powers by family with what each rests on. Pure.

import { formatCents } from "../../../frontend/format";
import { ORG_POWER_FAMILIES, ORG_POWERS, POWER_FAMILY_LABELS, POWER_WORDS, type OrgLimits, type OrgPower, type OrgPowerFamily } from "../../../shared/org";
import type { OrgPositionView, OrgPowerView, OrgRef, OrgView } from "../../../shared/org-view";
import type { PartyTier } from "../../../shared/party";

/** "Danny", "Danny and Jess", "Danny, Jess and Maddie". */
export function andList(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "1 companion", "2 companions". */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Each tier as a roster heads it. */
export const TIER_HEADINGS: Readonly<Record<PartyTier, string>> = { core: "Core", companion: "Companions", hired: "Hired", ally: "Allies" };

/** "1 here · 2 away", leaving out a side with nobody; null with nobody at all. */
export function hereAway(here: number, away: number): string | null {
  const parts = [here > 0 ? `${here} here` : null, away > 0 ? `${away} away` : null].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Who runs it, as the page's first line says it (§4.4): "Marcus Delgado runs it", "you run it",
 * "you and Helen Kowalczyk run it"; null when nobody governs it. `you` is the reader's id.
 */
export function runsIt(runBy: readonly OrgRef[], you: string | null): string | null {
  if (runBy.length === 0) return null;
  const mine = runBy.some((r) => r.id === you);
  const names = [...(mine ? ["you"] : []), ...runBy.filter((r) => r.id !== you).map((r) => r.name)];
  return `${andList(names)} ${names.length === 1 && !mine ? "runs" : "run"} it`;
}

/** The page's first line (§4.4, §11 Live): your title and since when, and who runs it: "Mechanic since 12 Jan 2026; Marcus Delgado runs it". */
export function placeLine(org: OrgView): string | null {
  const place = org.you.belongs && org.you.title ? (org.you.since ? `${org.you.title} since ${org.you.since}` : org.you.title) : null;
  const line = [place, runsIt(org.runBy, org.people.find((p) => p.you)?.id ?? null)].filter((p) => p !== null).join("; ");
  return line === "" ? null : line[0]?.toUpperCase() + line.slice(1);
}

/** A position's seats: "1 of 1", or how many hold one that takes any number. */
export function seatWords(p: OrgPositionView): string {
  return p.seats === 0 ? `${p.filled} held` : `${p.filled} of ${p.seats}`;
}

/** Spending limits, each in words. */
export function limitWords(limits: OrgLimits): string[] {
  const n = limits.accounts?.length ?? 0;
  return [limits.payment !== undefined ? `Each payment up to ${formatCents(limits.payment)}` : null, limits.month !== undefined ? `Each month up to ${formatCents(limits.month)}` : null, n > 0 ? `Only ${count(n, "account", "accounts")}` : null].filter((w) => w !== null);
}

/** Who fills a position when it falls vacant. */
export function successorWords(successor: string): string {
  return successor === "next" ? "The next in rank" : successor === "vacant" ? "Nobody: it stays vacant" : successor;
}

/** Powers family by family, each with what it lets one do; every power at once is "Every power", with no words. */
export function powerFamilies(powers: readonly OrgPower[]): { family: string; powers: OrgPower[]; words: string[] }[] {
  if (ORG_POWERS.every((p) => powers.includes(p))) return [{ family: "Every power", powers: [...ORG_POWERS], words: [] }];
  return (Object.keys(ORG_POWER_FAMILIES) as OrgPowerFamily[]).flatMap((family) => {
    const held = (ORG_POWER_FAMILIES[family] as readonly OrgPower[]).filter((p) => powers.includes(p));
    return held.length > 0 ? [{ family: POWER_FAMILY_LABELS[family], powers: held, words: held.map((p) => POWER_WORDS[p]) }] : [];
  });
}

/** Powers in words, family by family: "Money: see its money, spend its money; Staff: hire staff", "Every power" or "None". */
export function powersText(powers: readonly OrgPower[]): string {
  const families = powerFamilies(powers);
  return families.length === 0 ? "None" : families.map((f) => (f.words.length > 0 ? `${f.family}: ${f.words.join(", ")}` : f.family)).join("; ");
}

/** What the powers held rest on, in words, each basis once: "As owner", "As Head and by delegation from Marcus Delgado", "As a member". */
export function basisWords(org: OrgView, held: readonly OrgPowerView[]): string {
  const words = held.map((h) => {
    if (h.basis === "owner") return "as owner";
    if (h.basis === "position") return `as ${org.positions.find((p) => p.id === h.id)?.title ?? org.you.position?.title ?? "its officer"}`;
    if (h.basis === "delegate") {
      const by = org.you.delegations.find((d) => d.by?.id === h.id)?.by?.name;
      return by ? `by delegation from ${by}` : "by delegation";
    }
    return "as a member";
  });
  const text = andList([...new Set(words)]);
  return text === "" ? "" : text[0]?.toUpperCase() + text.slice(1);
}
