// The money hub's navigation: the pages it opens over its overview, the navigator
// that opens them, and the pieces every page is built from. One set of section, detail and action
// pages serves Play, where each page rides the sheet stack as a `money` sheet (an account's page as
// an `account` one), and GM mode, where the pages stack over the Money tab under Whose money.

import type { ComponentChildren } from "preact";
import { Empty, PageHeader, Stat } from "../../../frontend/components";
import { GmPage } from "../../../frontend/gm/ui";
import type { IconName } from "../../../frontend/icons";
import type { SectionProps } from "./hub";
import type { HubSection } from "./layout";

/** Where a page sits: a section of the hub, one thing in it, or an action's form. */
export type HubPageType = "section" | "detail" | "action";

/**
 * A page of the hub over its overview, named by a path: a section (`["accounts"]`), one thing
 * (`["account", id]`), or an action's form on one (`["account", id, "pay"]`, `["flows", "new"]`).
 * The path's first segment, its head, names the module that draws the page (`HubPages`).
 */
export interface HubPage {
  type: HubPageType;
  path: readonly string[];
}

export function sectionPage(section: Exclude<HubSection, "overview">): HubPage {
  return { type: "section", path: [section] };
}

export function detailPage(thing: string, id: string): HubPage {
  return { type: "detail", path: [thing, id] };
}

/** An action's form: what it acts on (a thing and its id, or a section), then the action, then anything it acts on within (a hold, an invoice). */
export function actionPage(...path: string[]): HubPage {
  return { type: "action", path };
}

/** How the hub's pages move, passed to every section, detail and action page. */
export interface HubNav {
  /** The page showing; null on the overview. */
  page: HubPage | null;
  /** Opens a page over the one showing. */
  open(page: HubPage): void;
  /** Back one level, from this page to the one it was opened from (the overview under the first); nothing once this page isn't showing. */
  back(): void;
  /** Where the pages show: Play's sheet stack, or GM mode's pages. */
  frame: "play" | "gm";
  /** What Back returns to, by name ("Accounts"), for its label; null when there's no name to give. */
  backLabel: string | null;
}

/**
 * The pages one module draws: the path heads it answers ("flows", "flow"; no two modules share
 * one) and, for a path with one of them, the whole page with its frame (`MoneyPage`, `ActionPage`).
 * It gives null when the path names nothing the view holds (a flow deleted since, a card replaced)
 * or nothing this mode may do there, and the router shows the page as gone.
 */
export interface HubPages {
  heads: readonly string[];
  render(page: HubPage, props: SectionProps): ComponentChildren;
}

/** A hub page's frame: its header (Back, the title and subtitle, its actions), then its content. */
export function MoneyPage(props: { nav: HubNav; name: string; title: ComponentChildren; subtitle?: ComponentChildren; actions?: ComponentChildren; children?: ComponentChildren }) {
  const { nav } = props;
  if (nav.frame === "gm") {
    return (
      <GmPage name={props.name} title={props.title} subtitle={props.subtitle} backLabel={nav.backLabel ?? "Money"} onBack={nav.back} actions={props.actions}>
        <div class="lre-money-page-body" data-lre-money-page={props.name}>
          {props.children}
        </div>
      </GmPage>
    );
  }
  return (
    <div class="lre-money-page" data-lre-money-page={props.name}>
      <PageHeader title={props.title} subtitle={props.subtitle} onBack={nav.back} backLabel={nav.backLabel ?? undefined} actions={props.actions} />
      <div class="lre-money-page-body">{props.children}</div>
    </div>
  );
}

/** A page's lead figure, large, with its state beside it, in a card of its own; `children` go under the figure (a meter, the figures beside it). */
export function Hero(props: { label: string; value: ComponentChildren; sub?: ComponentChildren; tone?: "pos" | "neg" | "warn"; badges?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <div class="lre-money-hero">
      <div class="lre-money-hero-main">
        <Stat label={props.label} value={props.value} sub={props.sub} tone={props.tone} />
        {props.badges !== undefined ? <span class="lre-money-hero-badges">{props.badges}</span> : null}
      </div>
      {props.children}
    </div>
  );
}

/** A page's controls: buttons that wrap, each opening the control's own page. */
export function Controls(props: { name: string; children: ComponentChildren }) {
  return (
    <div class="lre-money-controls" data-lre-money-controls={props.name}>
      {props.children}
    </div>
  );
}

/** A quiet line: why there's nothing to do here, or what happens otherwise. */
export function Note(props: { children: ComponentChildren }) {
  return <p class="lre-money-note">{props.children}</p>;
}

/** A page whose thing is gone from the view (sold, ended, deleted) or whose control no longer applies. */
export function Gone(props: { nav: HubNav; name: string; title: string; icon: IconName; children: ComponentChildren }) {
  return (
    <MoneyPage nav={props.nav} name={props.name} title={props.title}>
      <Empty icon={props.icon}>{props.children}</Empty>
    </MoneyPage>
  );
}
