// A party's money pages: which module draws a page, by its path's head; whether the POV's own
// money holds what a page names (so a page opened from an organization's money opens as theirs,
// with their controls); and what a page is called for Back's label in GM mode. A page its module
// draws nothing for (its thing gone from the view, or its control no longer allowed) shows as gone.

import type { FinanceView } from "../../../shared/finance";
import { accountPages } from "./accounts";
import { assetPages } from "./assets";
import { creditPages } from "./credit";
import { flowPages } from "./flows";
import { summaryPages, type SectionProps } from "./hub";
import { findAccount, findCard, findFlow, findJob, possessive } from "./layout";
import { Gone, type HubPage, type HubPages } from "./nav";
import { workPages } from "./work";

const MODULES: readonly HubPages[] = [summaryPages, accountPages, flowPages, workPages, assetPages, creditPages];

/** Each path head's module; two modules drawing one head is a mistake in the build, caught on load. */
const BY_HEAD = new Map<string, HubPages>();
for (const module of MODULES) {
  for (const head of module.heads) {
    if (BY_HEAD.has(head)) throw new Error(`Two money modules draw "${head}" pages`);
    BY_HEAD.set(head, module);
  }
}

/** One page of a party's money, as the module its head names draws it, or as gone. */
export function HubPageView(props: SectionProps & { page: HubPage }) {
  const { page, view, controls, nav, reader } = props;
  const drawn = BY_HEAD.get(page.path[0] ?? "")?.render(page, { view, controls, nav, reader }) ?? null;
  if (drawn !== null) return <>{drawn}</>;
  return (
    <Gone nav={nav} name="gone" title="Not here any more" icon="info">
      {`This isn't in ${controls.mode === "player" ? "your" : possessive(view.name, view.partyKind === "household")} money any more, or it can't be done now.`}
    </Gone>
  );
}

/**
 * Whether `view` holds the thing a page names: an account, a card, a flow, a job, a holding, a
 * property, or a business with its controls. An organization's money in Play opens such a page as
 * the POV's own when their money holds it, with their controls on it; the rest as the
 * organization's.
 */
export function holds(view: FinanceView, page: HubPage): boolean {
  const [head, id] = page.path;
  if (id === undefined) return false;
  switch (head) {
    case "account":
      return findAccount(view, id) !== null;
    case "card":
      return findCard(view, id) !== null;
    case "flow":
      return findFlow(view, id) !== null;
    case "job":
      return findJob(view, id) !== null;
    case "holding":
      return view.investments?.holdings.some((h) => h.id === id) ?? false;
    case "property":
      return view.properties.some((p) => p.id === id);
    case "business":
      return view.businesses.some((b) => b.id === id);
    default:
      return false;
  }
}

/** What a page is called, for Back's label on the page over it ("Back to Checking"); null where it has no plain name. */
export function pageLabel(view: FinanceView, page: HubPage): string | null {
  const [head, id] = page.path;
  if (head === undefined) return null;
  if (page.type === "section") return head === "alerts" ? "Alerts" : head === "credit" && id === "report" ? "Credit report" : null;
  if (page.type !== "detail" || id === undefined) return null;
  switch (head) {
    case "account":
      return findAccount(view, id)?.name ?? null;
    case "card":
      return findCard(view, id)?.name ?? null;
    case "flow":
      return findFlow(view, id)?.label ?? null;
    case "job": {
      const found = findJob(view, id);
      return found ? found.job.title || found.job.employer : null;
    }
    case "stake":
      return view.businesses.find((b) => b.id === id)?.name ?? null;
    case "holding":
      return view.investments?.holdings.find((h) => h.id === id)?.asset.label ?? null;
    case "property":
      return view.properties.find((p) => p.id === id)?.name ?? null;
    default:
      return null;
  }
}
