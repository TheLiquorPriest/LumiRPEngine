// The Org Chart (item 8; DESIGN §29.11) and the tree every Orgs page draws with it: a collapsible
// list, not a canvas, so it reads at 390 px, to a screen reader and to the harness alike. The tree
// (`role=tree`) has 44 px rows indented 12 px a level, 4 levels drawn and 2 open at first; past 4,
// "Show from here" re-roots it under a breadcrumb. Arrow keys move and open, Enter does what a tap
// does: opens the row's page, or its menu of what the reader may do there, Open first. The Chart tab
// draws two such trees: Reporting (positions by whom they report to, their holders and vacant seats,
// staff, members, owners by role, delegations) and Ownership and control (a breadcrumb up to the
// ultimate parent, a tap re-rooting there, then what each holds, with its stake, votes, Controlled,
// role and seat). The same component draws in GM → Orgs, whose page gives the GM every control;
// every edit opens an existing editor, which the engine judges again.

import { useState } from "preact/hooks";
import { orgRoute, type SheetRoute } from "../../../frontend/app";
import { Badge, Button, Section } from "../../../frontend/components";
import { Icon } from "../../../frontend/icons";
import type { OrgView } from "../../../shared/org-view";
import { controlChain, controlTree, defaultOpen, reportingTree, rerooted, rowMenu, rowPress, treeRows, type ChartAction, type ChartNode, type OwnershipTab, type TreeRow } from "./chart-model";
import { orgEditRoute, rulesControls } from "./edit";
import { linkWords } from "./words";

/** A tree's state: which rows are open, which has focus, whose menu is open, and the row it is re-rooted at. */
export interface TreeState {
  open: ReadonlySet<string>;
  focus: string | null;
  menu: string | null;
  root: string | null;
}

export interface TreeViewProps {
  label: string;
  nodes: readonly ChartNode[];
  state: TreeState;
  /** The breadcrumb's first crumb, the whole tree, while it is re-rooted. */
  top: string;
  onState(next: TreeState): void;
  /** A row's page, or one of its actions: an editor or a page over this one, or a tab of this page. */
  onGo(action: ChartAction): void;
}

/** The state a tree starts in: open two levels deep, nothing focused, no menu, not re-rooted. */
export function treeStart(nodes: readonly ChartNode[]): TreeState {
  return { open: new Set(defaultOpen(nodes)), focus: null, menu: null, root: null };
}

/** The tree item element of a row, to move focus to it. */
function itemOf(tree: Element, key: string): HTMLElement | null {
  for (const el of tree.querySelectorAll<HTMLElement>("[data-lre-tree-key]")) if (el.dataset.lreTreeKey === key) return el;
  return null;
}

/** One row and what is open under it, drawn as a tree item. */
function TreeItem(props: TreeViewProps & { row: TreeRow; rows: readonly TreeRow[]; tabStop: string | null }) {
  const { row, state } = props;
  const n = row.node;
  const press = rowPress(row);
  const menu = state.menu === n.key ? rowMenu(row) : null;
  const kids = props.rows.filter((r) => r.parent === n.key);
  const set = (patch: Partial<TreeState>) => props.onState({ ...state, ...patch });
  const toggle = () => {
    const open = new Set(state.open);
    if (open.has(n.key)) open.delete(n.key);
    else open.add(n.key);
    set({ open, focus: n.key, menu: null });
  };
  const activate = () => {
    if (press === "open" && n.open) props.onGo({ id: "open", label: "Open", route: n.open });
    else if (press === "menu") set({ menu: state.menu === n.key ? null : n.key, focus: n.key });
    else if (press === "reroot") set({ root: n.key, focus: n.key, menu: null });
    else if (press === "toggle") toggle();
  };
  const trail = press === "open" ? "chevron-right" : press === "menu" ? "more" : null;
  return (
    <li
      role="treeitem"
      class={n.muted ? "lre-tree-item muted" : "lre-tree-item"}
      style={{ "--lre-tree-indent": `${(row.depth - 1) * 12}px` }}
      aria-level={row.depth}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-expanded={n.children.length > 0 && !row.deep ? row.open : undefined}
      aria-current={n.current ? "true" : undefined}
      aria-label={[n.label, n.detail, n.value, ...n.badges.map((b) => b.text)].filter((part) => part).join(", ")}
      tabIndex={props.tabStop === n.key ? 0 : -1}
      data-lre-tree-key={n.key}
      onFocus={(event) => {
        if (event.target === event.currentTarget && state.focus !== n.key) set({ focus: n.key });
      }}
    >
      <div class={["lre-tree-row", n.current ? "current" : null, press === null ? "inert" : null].filter((c) => c !== null).join(" ")} onClick={activate}>
        {n.children.length > 0 ? (
          <span
            class="lre-tree-toggle"
            aria-hidden="true"
            title={row.deep ? "Show from here" : row.open ? "Close" : "Open"}
            onClick={(event) => {
              event.stopPropagation();
              if (row.deep) set({ root: n.key, focus: n.key, menu: null });
              else toggle();
            }}
          >
            <Icon name={row.deep ? "branch" : row.open ? "chevron-down" : "chevron-right"} size={16} />
          </span>
        ) : (
          <span class="lre-tree-toggle" aria-hidden="true" />
        )}
        <span class="lre-tree-icon" aria-hidden="true">
          <Icon name={n.icon} size={18} />
        </span>
        <span class="lre-tree-text" aria-hidden="true">
          <span class="lre-tree-label">{n.label}</span>
          {n.detail !== null ? <span class="lre-tree-detail">{n.detail}</span> : null}
          {n.badges.length > 0 ? (
            <span class="lre-tree-badges">
              {n.badges.map((b) => (
                <Badge key={b.text} tone={b.tone}>
                  {b.text}
                </Badge>
              ))}
            </span>
          ) : null}
        </span>
        {n.value !== null ? (
          <span class="lre-tree-value" aria-hidden="true">
            {n.value}
          </span>
        ) : null}
        {trail ? <Icon name={trail} size={16} class="lre-tree-trail" /> : null}
      </div>
      {menu ? (
        <div class="lre-tree-menu" role="group" aria-label={`${n.label}: what you may do`} data-lre-tree-menu={n.key}>
          {menu.map((action, i) => (
            <button
              key={action.id}
              type="button"
              class={action.danger ? "lre-tree-action danger" : "lre-tree-action"}
              data-lre-tree-action={action.id}
              ref={
                i === 0
                  ? (el: HTMLButtonElement | null) => {
                      if (el && !el.parentElement?.contains(document.activeElement)) el.focus();
                    }
                  : undefined
              }
              onClick={(event) => {
                event.stopPropagation();
                if (action.reroot) set({ root: n.key, focus: n.key, menu: null });
                else {
                  set({ menu: null });
                  props.onGo(action);
                }
              }}
            >
              {action.icon ? <Icon name={action.icon} size={16} /> : null}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      {row.open && kids.length > 0 ? (
        <ul role="group" class="lre-tree-group">
          {kids.map((kid) => (
            <TreeItem key={kid.node.key} {...props} row={kid} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * A tree, drawn from its state (`TreeState`), which `onState` keeps: its breadcrumb while it is
 * re-rooted ("Show from here"), then its rows. Arrow keys move between rows and open and close them
 * (Right on the deepest row drawn re-roots there), Home and End go to the first and last, Enter and
 * Space do what a tap does, Escape closes a menu.
 */
export function TreeView(props: TreeViewProps) {
  const { state } = props;
  const shown = rerooted(props.nodes, state.root);
  const rows = treeRows(shown.nodes, state.open);
  const tabStop = rows.some((r) => r.node.key === state.focus) ? state.focus : (rows[0]?.node.key ?? null);
  const set = (patch: Partial<TreeState>) => props.onState({ ...state, ...patch });
  const onKeyDown = (event: KeyboardEvent) => {
    const tree = event.currentTarget as HTMLElement;
    const at = rows.findIndex((r) => r.node.key === tabStop);
    const row = rows[at];
    if (!row) return;
    const move = (to: TreeRow | undefined) => {
      if (!to) return;
      set({ focus: to.node.key, menu: null });
      itemOf(tree, to.node.key)?.focus();
    };
    const inMenu = (event.target as HTMLElement).closest?.("[data-lre-tree-menu]") !== null;
    if (event.key === "Escape" && state.menu !== null) {
      event.preventDefault();
      const key = state.menu;
      set({ menu: null, focus: key });
      itemOf(tree, key)?.focus();
      return;
    }
    if (inMenu) return;
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(rows[at + 1]),
      ArrowUp: () => move(rows[at - 1]),
      Home: () => move(rows[0]),
      End: () => move(rows.at(-1)),
      ArrowRight: () => {
        if (row.deep) set({ root: row.node.key, focus: row.node.key, menu: null });
        else if (row.node.children.length > 0 && !row.open) set({ open: new Set([...state.open, row.node.key]) });
        else if (row.open) move(rows[at + 1]);
      },
      ArrowLeft: () => {
        if (row.open) set({ open: new Set([...state.open].filter((k) => k !== row.node.key)) });
        else move(rows.find((r) => r.node.key === row.parent));
      },
      Enter: () => (itemOf(tree, row.node.key)?.querySelector<HTMLElement>(".lre-tree-row") ?? null)?.click(),
      " ": () => (itemOf(tree, row.node.key)?.querySelector<HTMLElement>(".lre-tree-row") ?? null)?.click(),
    };
    const go = keys[event.key];
    if (!go || (event.target as HTMLElement) !== itemOf(tree, row.node.key)) return;
    event.preventDefault();
    go();
  };
  return (
    <div class="lre-tree-frame">
      {shown.path.length > 0 ? (
        <nav class="lre-tree-crumbs" aria-label={`${props.label}: where this is`} data-lre-tree-crumbs>
          <button type="button" class="lre-tree-crumb" onClick={() => set({ root: null, menu: null })}>
            {props.top}
          </button>
          {shown.path.map((n, i) => (
            <span key={n.key} class="lre-tree-crumb-step">
              <Icon name="chevron-right" size={14} class="lre-tree-crumb-sep" />
              {i === shown.path.length - 1 ? (
                <span class="lre-tree-crumb current" aria-current="location">
                  {n.label}
                </span>
              ) : (
                <button type="button" class="lre-tree-crumb" onClick={() => set({ root: n.key, menu: null })}>
                  {n.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <ul role="tree" class="lre-tree" aria-label={props.label} onKeyDown={onKeyDown}>
        {rows
          .filter((r) => r.parent === null)
          .map((r) => (
            <TreeItem key={r.node.key} {...props} row={r} rows={rows} tabStop={tabStop} />
          ))}
      </ul>
    </div>
  );
}

/** A tree that keeps its own state, starting open two levels deep. */
export function Tree(props: Omit<TreeViewProps, "state" | "onState">) {
  const [state, setState] = useState<TreeState | null>(null);
  return <TreeView {...props} state={state ?? treeStart(props.nodes)} onState={setState} />;
}

export interface OrgChartProps {
  org: OrgView;
  /** Every page the reader holds, by id (Play's `orgs.org`, GM → Orgs' every one). */
  pageOf(id: string): OrgView | null;
  /** The tab drawing a page's Ownership, where its forms are. */
  ownershipTab: OwnershipTab;
  open(route: SheetRoute): void;
  onTab(id: string): void;
}

/** What a row's page or action opens: a sheet or page over this one, or a tab of this page. */
function goTo(props: Pick<OrgChartProps, "open" | "onTab">, action: ChartAction): void {
  if (action.route) props.open(action.route);
  else if (action.tab) props.onTab(action.tab);
}

/**
 * The Ownership and control part, from the root chosen on its breadcrumb (`root`, the page's own by
 * default): the chain up to the ultimate parent, each crumb re-rooting the tree there, the direct
 * holders with how each holds it, then the tree.
 */
export function ControlPart(props: OrgChartProps & { root: string; onRoot(id: string): void; tree: TreeState | null; onTree(next: TreeState): void }) {
  const { org } = props;
  const chain = controlChain(org, props.pageOf);
  const nodes = controlTree(org, props.pageOf, props.root, props.ownershipTab);
  return (
    <div class="lre-stack" data-lre-chart-control={org.id}>
      {chain.length > 1 ? (
        <nav class="lre-tree-crumbs" aria-label="Up to the ultimate parent" data-lre-chart-chain>
          {chain.map((c, i) => (
            <span key={c.id} class="lre-tree-crumb-step">
              {i > 0 ? <Icon name="chevron-right" size={14} class="lre-tree-crumb-sep" /> : null}
              {c.id === props.root ? (
                <span class="lre-tree-crumb current" aria-current="location">
                  {c.name}
                </span>
              ) : (
                <button type="button" class="lre-tree-crumb" onClick={() => props.onRoot(c.id)}>
                  {c.name}
                </button>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      {org.above.length > 0 ? (
        <ul class="lre-tree lre-tree-flat" aria-label="Held by" data-lre-chart-above>
          {org.above.map((l) => (
            <li key={l.id} class="lre-tree-item">
              <button type="button" class="lre-tree-row" style={{ "--lre-tree-indent": "0px" }} onClick={() => props.open(orgRoute(l.id, "chart"))}>
                <span class="lre-tree-toggle" aria-hidden="true">
                  <Icon name="chevron-up" size={16} />
                </span>
                <span class="lre-tree-text">
                  <span class="lre-tree-label">{l.name}</span>
                  <span class="lre-tree-detail">{["Holds it", linkWords(l)].filter((part) => part !== "").join(" · ")}</span>
                </span>
                {l.controlled ? <Badge tone="accent">Controls it</Badge> : null}
                <Icon name="chevron-right" size={16} class="lre-tree-trail" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {nodes.length > 0 ? <TreeView key={props.root} label="Ownership and control" top={nodes[0]?.label ?? org.name} nodes={nodes} state={props.tree ?? treeStart(nodes)} onState={props.onTree} onGo={(a) => goTo(props, a)} /> : null}
    </div>
  );
}

/** The Chart tab: Reporting, with Add position for a reader who may add one, and Ownership and control where it has a structure. */
export function OrgChart(props: OrgChartProps) {
  const { org } = props;
  const [reporting, setReporting] = useState<TreeState | null>(null);
  const [control, setControl] = useState<TreeState | null>(null);
  const [root, setRoot] = useState(org.id);
  const report = reportingTree(org);
  const structure = org.above.length > 0 || org.below.length > 0 || org.belowHidden > 0;
  const add = rulesControls(org).positions;
  return (
    <div class="lre-stack" data-lre-org-chart={org.id}>
      <div data-lre-chart="reporting">
        <Section
          title="Reporting"
          aside={
            add ? (
              <Button variant="ghost" size="sm" icon="plus" onClick={() => props.open(orgEditRoute(org.id, "position"))}>
                Add position
              </Button>
            ) : undefined
          }
          flush
        >
          {report.length > 0 ? <TreeView label="Reporting lines" top="Everyone" nodes={report} state={reporting ?? treeStart(report)} onState={setReporting} onGo={(a) => goTo(props, a)} /> : <span class="lre-small lre-muted">No one is on its chart yet.</span>}
        </Section>
      </div>
      {structure ? (
        <div data-lre-chart="control">
          <Section title="Ownership and control" flush>
            <ControlPart
              {...props}
              root={root}
              onRoot={(id) => {
                setRoot(id);
                setControl(null);
              }}
              tree={control}
              onTree={setControl}
            />
          </Section>
        </div>
      ) : null}
    </div>
  );
}
