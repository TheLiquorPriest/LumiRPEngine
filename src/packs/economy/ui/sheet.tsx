// Play's money sheets (contract D-UI9): every page of the hub over Play rides the sheet stack, the
// page in the sheet's id (`routes.ts`), an account's page as an `account` sheet. The view is the
// POV's, from the state, and each control an in-world action, as on the overview.

import { useEffect } from "preact/hooks";
import type { SheetKind } from "../../../frontend/app";
import { useApp } from "../../../frontend/app";
import { Empty, PageHeader } from "../../../frontend/components";
import type { SheetProps } from "../../../frontend/registry";
import { decodeFinanceView } from "./decode";
import type { HubNav } from "./nav";
import { HubPageView } from "./pages";
import { usePlayerControls } from "./panel";
import { pageOf, routeOf } from "./routes";

function HubSheet(props: SheetProps & { kind: SheetKind }) {
  const app = useApp();
  const controls = usePlayerControls(props.chatId, props.state);
  const page = pageOf(props.kind, props.id);
  // Every money page shows the POV's money, whose detail is the POV's to materialize (DESIGN §9.2;
  // an account has none of its own). The first money page in the stack observes it on mount, as the
  // Money tab does, which matters when it opens over Now from the glance; pages over it don't ask again.
  useEffect(() => {
    const stack = app.ui.get().play.stack;
    const first = stack.find((route) => route.kind === "money" || route.kind === "account");
    if (first?.kind !== props.kind || first.id !== props.id) return;
    void app.request({ type: "lre.view.open", chatId: props.chatId, panel: "economy.money", entity: null }).then((result) => {
      if (result?.pending) app.toast("Details appear when the reply finishes.", "info");
    });
  }, [props.chatId]);
  const raw = props.state.panels["economy.money"];
  const view = raw === undefined || raw === null ? null : decodeFinanceView(raw);
  if (!view || !page) {
    return (
      <div class="lre-money-page">
        <PageHeader title="Money" onBack={props.close} />
        <Empty icon="coins">{view ? "Nothing to show here." : "Money is off in this world."}</Empty>
      </div>
    );
  }
  const nav: HubNav = {
    page,
    open: (next) => props.open(routeOf(next)),
    // Only while this sheet is on top: an answer that comes after Back was tapped mustn't close the sheet under it.
    back: () => {
      const top = app.ui.get().play.stack.at(-1);
      if (top?.kind === props.kind && top.id === props.id) props.close();
    },
    frame: "play",
    backLabel: null,
  };
  return (
    <div class="lre-money-root" data-lre-money-sheet={page.type}>
      <HubPageView page={page} view={view} controls={controls} nav={nav} />
    </div>
  );
}

export function MoneySheet(props: SheetProps) {
  return <HubSheet {...props} kind="money" />;
}

export function AccountSheet(props: SheetProps) {
  return <HubSheet {...props} kind="account" />;
}
