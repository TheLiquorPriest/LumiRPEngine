// Play's money sheets (ORG-SPEC §5.3): every page of someone's money over Play rides the sheet
// stack, whose money it is and the page in the sheet's id (`routes.ts`), the POV's account page as
// an `account` sheet. The POV's own pages draw their money from the state, each control an
// in-world action, as on the segments. An organization's draw its own money from its page in Orgs
// (`orgs.org`'s money section, the page read when the sheet opens), read only, and what it shares
// with the POV opens the POV's own page.

import { useEffect } from "preact/hooks";
import type { SheetKind } from "../../../frontend/app";
import { useApp } from "../../../frontend/app";
import { Empty, PageHeader } from "../../../frontend/components";
import type { SheetProps } from "../../../frontend/registry";
import type { FinanceView } from "../../../shared/finance";
import type { EntityId } from "../../../shared/ids";
import { isRecord } from "../../../shared/json";
import type { OrgView } from "../../../shared/org-view";
import { useOrgPage } from "../../../frontend/org-page";
import { decodeFinanceView } from "./decode";
import type { HubControls, PlayerControls, Reader } from "./hub";
import type { HubPage } from "./nav";
import { HubPageView } from "./pages";
import { playElsewhere, usePlayerControls } from "./panel";
import { pageOf, routeFrom } from "./routes";

/** An organization's own money as its page in Orgs carries it (`orgs.org`'s money section): there only for a reader who may see it. */
function orgMoney(page: OrgView | null): FinanceView | null {
  const sections = isRecord(page) ? page.sections : undefined;
  return isRecord(sections) ? decodeFinanceView(sections.money) : null;
}

/** What a money sheet draws: the page, of the POV's own money with their controls, or of an organization's, read only beside theirs. */
export interface SheetMoney {
  page: HubPage;
  view: FinanceView;
  own: boolean;
  controls: HubControls;
  reader: Reader | null;
}

/**
 * Whose money a sheet's route shows, without hooks: the POV's own (an account sheet's, or one
 * naming them) with their controls, or an organization's as `orgView` finds it, read only with the
 * POV's own beside it; null when it's no one's the reader may see.
 */
export function sheetMoney(route: { party: EntityId | null; page: HubPage }, pov: FinanceView | null, controls: PlayerControls, orgView: (org: EntityId) => FinanceView | null): SheetMoney | null {
  const own = route.party === null || route.party === pov?.party;
  const view = own ? pov : orgView(route.party ?? "");
  if (!view) return null;
  return { page: route.page, view, own, controls: own ? controls : { mode: "read", busy: false, currency: controls.currency }, reader: !own && pov ? { view: pov, controls } : null };
}

function HubSheet(props: SheetProps & { kind: SheetKind }) {
  const app = useApp();
  const controls = usePlayerControls(props.chatId, props.state);
  const route = pageOf(props.kind, props.id);
  const raw = props.state.panels["economy.money"];
  const pov = raw === undefined || raw === null ? null : decodeFinanceView(raw);
  // An organization's money is its page's, read when the sheet opens (the state view carries only each page's summary).
  const org = route !== null && route.party !== null && route.party !== pov?.party ? route.party : null;
  const read = useOrgPage(props.chatId, org, props.state);
  const shown = route === null ? null : sheetMoney(route, pov, controls, () => (read.status === "read" ? orgMoney(read.page) : null));
  if (!route || !shown) {
    return (
      <div class="lre-money-page">
        <PageHeader title="Money" onBack={props.close} />
        <Empty icon={org !== null && read.status === "reading" ? "hourglass" : "coins"}>{!route ? "Nothing to show here." : org === null ? "Money is off in this world." : read.status === "reading" ? "Reading its money…" : read.status === "failed" ? "Its money could not be read." : "You don't see its money any more."}</Empty>
      </div>
    );
  }
  return (
    <div class="lre-money-root" data-lre-money-sheet={shown.page.type} data-lre-money-party={shown.view.party}>
      <HubPageView
        page={shown.page}
        view={shown.view}
        controls={shown.controls}
        reader={shown.reader}
        nav={{
          page: shown.page,
          open: (next) => props.open(routeFrom(shown.view.party, shown.own, shown.reader, next)),
          // Only while this sheet is on top: an answer that comes after Back was tapped mustn't close the sheet under it.
          back: () => {
            const top = app.ui.get().play.stack.at(-1);
            if (top?.kind === props.kind && top.id === props.id) props.close();
          },
          elsewhere: (to) => playElsewhere(app, to),
          frame: "play",
          backLabel: null,
        }}
      />
    </div>
  );
}

export function MoneySheet(props: SheetProps) {
  return <HubSheet {...props} kind="money" />;
}

export function AccountSheet(props: SheetProps) {
  return <HubSheet {...props} kind="account" />;
}
