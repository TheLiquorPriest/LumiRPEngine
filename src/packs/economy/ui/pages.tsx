// The money hub's pages: which module draws a page, by its path's head, and what a
// page is called for Back's label in GM mode. A page its module draws nothing for (its thing gone
// from the view, or its control no longer allowed) shows as gone.

import type { FinanceView } from "../../../shared/finance";
import { accountPages } from "./accounts";
import { assetPages } from "./assets";
import { creditPages } from "./credit";
import { flowPages } from "./flows";
import type { SectionProps } from "./hub";
import { SECTION_LABELS, type HubSection } from "./layout";
import { Gone, type HubPage, type HubPages } from "./nav";
import { workPages } from "./work";

const MODULES: readonly HubPages[] = [accountPages, flowPages, workPages, assetPages, creditPages];

/** Each path head's module; two modules drawing one head is a mistake in the build, caught on load. */
const BY_HEAD = new Map<string, HubPages>();
for (const module of MODULES) {
  for (const head of module.heads) {
    if (BY_HEAD.has(head)) throw new Error(`Two money modules draw "${head}" pages`);
    BY_HEAD.set(head, module);
  }
}

/** One page of the hub, as the module its head names draws it, or as gone. */
export function HubPageView(props: SectionProps & { page: HubPage }) {
  const { page, view, controls, nav } = props;
  const drawn = BY_HEAD.get(page.path[0] ?? "")?.render(page, { view, controls, nav }) ?? null;
  if (drawn !== null) return <>{drawn}</>;
  return (
    <Gone nav={nav} name="gone" title="Not here any more" icon="info">
      {`This isn't in ${controls.mode === "player" ? "your" : `${view.name}'s`} money any more, or it can't be done now.`}
    </Gone>
  );
}

function isSection(head: string): head is HubSection {
  return Object.hasOwn(SECTION_LABELS, head);
}

/** What a page is called, for Back's label on the page over it ("Back to Checking"); null where it has no plain name. */
export function pageLabel(view: FinanceView, page: HubPage): string | null {
  const [head, id] = page.path;
  if (head === undefined) return null;
  if (page.type === "section") return isSection(head) ? SECTION_LABELS[head] : null;
  if (page.type !== "detail") return null;
  switch (head) {
    case "account":
      return view.accounts.find((a) => a.id === id)?.name ?? null;
    case "card":
      return [...view.cards, ...view.accounts.flatMap((a) => a.cards)].find((c) => c.id === id)?.name ?? null;
    case "flow":
      return [...view.flows, ...view.properties.flatMap((p) => p.costs), ...(view.household?.flows ?? [])].find((f) => f.id === id)?.label ?? null;
    case "job": {
      const job = [...view.jobs, ...view.businesses.flatMap((b) => b.employees)].find((j) => j.id === id);
      return job ? job.title || job.employer : null;
    }
    case "business":
      return view.businesses.find((b) => b.id === id)?.name ?? null;
    case "holding":
      return view.investments?.holdings.find((h) => h.id === id)?.asset.label ?? null;
    case "property":
      return view.properties.find((p) => p.id === id)?.name ?? null;
    default:
      return isSection(head) ? SECTION_LABELS[head] : null;
  }
}
