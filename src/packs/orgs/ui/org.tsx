// An organization's page (ORG-SPEC §4.3; the `org` sheet): Back, its name, its type badge and your
// title there, then a tab row with only the tabs it has and you may see: Overview, People and Rules,
// drawn here, and the packs' tabs (`r.orgTab`: Money, Ownership, Taxes…), each while the page holds
// the section it draws, which the backend builds only for a reader who holds its power. A pack's part
// of one of the three (People's Payroll) follows that tab's own content. The page is the `orgs.org`
// view's, as the player character may see the organization, opened on the tab its route names
// (`orgRoute`), else on Overview. The header's overflow holds Rename where you may govern it (at
// once), Leave where you're a member of your own (as a turn) and Open in GM, which shows it in
// GM → Orgs.

import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";
import { orgRouteOf, useApp, type App, type SheetRoute } from "../../../frontend/app";
import { OverflowMenu, type MenuItem } from "../../../frontend/build/chrome";
import { Button, Empty, Field, IdText, PageHeader, Section, Tabs, tabPanel, useBusy } from "../../../frontend/components";
import { gmOpen } from "../../../frontend/gm/gate";
import type { OrgShellTab, OrgTabDef, Send, SheetProps } from "../../../frontend/registry";
import type { ChatId } from "../../../shared/ids";
import type { JsonObject } from "../../../shared/json";
import { ORG_ACTIONS } from "../../../shared/org";
import { ORGS_LIST_PANEL, ORGS_ORG_PANEL, type OrgView } from "../../../shared/org-view";
import type { StateView } from "../../../shared/state-view";
import { decodeOrgList, decodeOrgPage } from "./decode";
import { GM_ORGS_SECTION } from "./gm";
import { OrgOverview } from "./overview";
import type { PartyAct } from "./party";
import { OrgPeople } from "./people";
import { OrgRules } from "./rules";

/** The page's own tabs, placed among the packs' by `order`. */
const SHELL_TABS: readonly { id: OrgShellTab; label: string; order: number }[] = [
  { id: "overview", label: "Overview", order: 10 },
  { id: "people", label: "People", order: 20 },
  { id: "rules", label: "Rules", order: 90 },
];

/** The tabs a page shows, in order: its own three, and each pack's whose section it holds. */
export function orgTabs(org: OrgView, defs: readonly OrgTabDef[]): { id: string; label: string; def: OrgTabDef | null }[] {
  const packs = defs.filter((d) => d.within === undefined && org.sections[d.section] !== undefined);
  return [...SHELL_TABS.map((t) => ({ ...t, def: null })), ...packs.map((def) => ({ id: def.id, label: def.label, order: def.order, def }))]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(({ id, label, def }) => ({ id, label, def }));
}

export interface OrgPageProps {
  org: OrgView;
  /** The one figure the home shows for it (`orgs.list`), under the Overview's first line. */
  figure: string | null;
  /** Every pack's tab and part (the UI catalog's `orgTabs`). */
  defs: readonly OrgTabDef[];
  /** The tab chosen; one the page doesn't show reads as Overview. */
  tab: string;
  panelId: string;
  onTab(id: string): void;
  onBack(): void;
  chatId: ChatId;
  state: StateView;
  send: Send;
  open(route: SheetRoute): void;
  /** The header's overflow (Play's: Rename, Leave, Open in GM); none in GM → Orgs. */
  menu?: readonly MenuItem[];
  /** Drawn under the header, above the tabs: Rename's form while it is open. */
  above?: ComponentChildren;
  /** Plays one of the party's own controls (Play's sheet); absent, the party's page reads only, as GM → Orgs draws it. */
  act?: PartyAct;
}

/** What the header's overflow does, as the sheet wires it. */
export interface OrgMenuActions {
  rename(): void;
  leave(): void;
  openInGm(): void;
}

/**
 * The header's overflow (§4.3): Rename where the reader may govern it (`org.govern`) and it is in the
 * world, Leave where they're a member by a link of their own (an owner sells, staff quit their job),
 * and Open in GM.
 */
export function orgMenu(org: OrgView, actions: OrgMenuActions): MenuItem[] {
  const governs = org.exists && org.you.powers.some((p) => p.power === "org.govern");
  const member = org.type !== "party" && org.people.some((p) => p.you && p.hows.includes("member"));
  const items: MenuItem[] = [];
  if (governs) items.push({ label: "Rename", icon: "edit", onSelect: actions.rename });
  if (member) items.push({ label: "Leave", icon: "minus", danger: true, onSelect: actions.leave });
  items.push({ label: "Open in GM", icon: "eye", onSelect: actions.openInGm });
  return items;
}

/** Rename's form: the new name, applied at once. */
export function OrgRenameForm(props: { name: string; busy: boolean; onSave(name: string): void; onCancel(): void }) {
  const [name, setName] = useState(props.name);
  const id = useId();
  const next = name.trim();
  const changed = next !== "" && next !== props.name;
  return (
    <form
      class="lre-stack"
      data-lre-org-rename
      onSubmit={(event) => {
        event.preventDefault();
        if (changed) props.onSave(next);
      }}
    >
      <Field label="New name" for={id}>
        <input id={id} class="lre-input" type="text" maxLength={80} value={name} onInput={(event) => setName(event.currentTarget.value)} />
      </Field>
      <Button variant="primary" type="submit" block disabled={!changed} busy={props.busy}>
        Rename
      </Button>
      <Button variant="ghost" block onClick={props.onCancel}>
        Cancel
      </Button>
    </form>
  );
}

export function OrgPage(props: OrgPageProps) {
  const { org, defs } = props;
  const tabs = orgTabs(org, defs);
  // A tab the page no longer shows (its section went with a change in powers) reads as Overview.
  const current = tabs.some((t) => t.id === props.tab) ? props.tab : "overview";
  const def = tabs.find((t) => t.id === current)?.def ?? null;
  const draw = (d: OrgTabDef) => <d.component chatId={props.chatId} org={org} section={org.sections[d.section] ?? null} state={props.state} send={props.send} open={props.open} />;
  const ownership = tabs.find((t) => t.def?.section === "ownership")?.id;
  const body = def ? (
    draw(def)
  ) : current === "people" ? (
    <OrgPeople org={org} ownership={ownership === undefined ? null : () => props.onTab(ownership)} open={props.open} />
  ) : current === "rules" ? (
    <OrgRules org={org} currency={props.state.currency ?? null} open={props.open} />
  ) : (
    <OrgOverview org={org} figure={props.figure} currency={props.state.currency ?? null} {...(props.act ? { act: props.act } : {})} tabs={tabs.map(({ id, label }) => ({ id, label }))} onTab={props.onTab} open={props.open} />
  );
  const parts = defs.filter((d) => d.within === current && org.sections[d.section] !== undefined);
  return (
    <div class="lre-stack" data-lre-sheet-org={org.id} data-lre-org-type={org.type}>
      <PageHeader title={org.name} subtitle={[org.badge, org.you.title].filter((part) => part).join(" · ") || undefined} onBack={props.onBack} actions={props.menu && props.menu.length > 0 ? <OverflowMenu label={`${org.name}: more`} items={props.menu} /> : undefined} />
      {org.exists ? <IdText id={org.id} /> : null}
      {props.above}
      <Tabs label={`${org.name}: tabs`} panelId={props.panelId} value={current} tabs={tabs.map(({ id, label }) => ({ id, label }))} onChange={props.onTab} />
      <div {...tabPanel(props.panelId, current)} class="lre-stack" data-lre-org-tab={current}>
        {body}
        {parts.map((part) => (
          <div key={part.id} data-lre-org-part={part.id}>
            <Section title={part.label}>{draw(part)}</Section>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Plays a control of the party's page or of Start something… as the palette plays an action:
 * bookkeeping at once with its Undo, a hire, a share-out or a founding staged for the next message.
 */
export function playOrgAction(app: App, chatId: ChatId): PartyAct {
  return (action, params) =>
    void app.request({ type: "lre.action", chatId, action, params, source: "palette" }).then((result) => {
      if (result && "pending" in result && result.pending) app.toast("Saved — it applies when the reply finishes.", "info");
    });
}

/** The `org` sheet: the page of the organization the route names, opened on the tab it names (Overview while the page doesn't show that one), the tab chosen kept while the sheet is open, and the header's overflow. */
export function OrgSheet(props: SheetProps) {
  const app = useApp();
  const target = orgRouteOf(props.id);
  const [tab, setTab] = useState<string>(target.tab ?? "overview");
  const [renaming, setRenaming] = useState(false);
  const [busy, run] = useBusy();
  const panelId = useId();
  const org = decodeOrgPage(props.state.panels[ORGS_ORG_PANEL], target.org);
  if (!org) {
    return (
      <div class="lre-stack">
        <PageHeader title="Organization" onBack={props.close} />
        <Empty icon="briefcase">You don't know of it any more.</Empty>
      </div>
    );
  }
  const list = decodeOrgList(props.state.panels[ORGS_LIST_PANEL]);
  const figure = [...(list?.belong ?? []), ...(list?.known ?? [])].find((r) => r.id === org.id)?.figure ?? null;
  // Rename applies at once (bookkeeping, §4.6); Leave is staged to play as the next turn.
  const act = (action: string, params: JsonObject, done?: () => void) =>
    run(async () => {
      const result = await app.request({ type: "lre.action", chatId: props.chatId, action, params, source: "palette" });
      if (result && "pending" in result && result.pending) app.toast("Saved — it applies when the reply finishes.", "info");
      if (result !== null) done?.();
    });
  const menu = orgMenu(org, {
    rename: () => setRenaming(true),
    leave: () => void app.host.confirm("Leave", `Leave ${org.name}? It plays as your next turn.`, "danger", "Leave").then((yes) => (yes ? act(ORG_ACTIONS.leave, { org: org.id }) : undefined)),
    openInGm: () => app.ui.update((ui) => ({ ...gmOpen(ui, GM_ORGS_SECTION, org.id), mode: "gm" })),
  });
  const above = renaming ? <OrgRenameForm name={org.name} busy={busy} onSave={(name) => act(ORG_ACTIONS.rename, { org: org.id, name }, () => setRenaming(false))} onCancel={() => setRenaming(false)} /> : null;
  return <OrgPage org={org} figure={figure} defs={app.catalog.orgTabs} tab={tab} panelId={panelId} onTab={setTab} onBack={props.close} chatId={props.chatId} state={props.state} send={props.send} open={props.open} menu={menu} above={above} act={playOrgAction(app, props.chatId)} />;
}
