// The Org Chart's trees as plain data (item 8; DESIGN §29.11), and the walking every tree on the
// Orgs pages shares (the Chart's two, the home's):
// - Reporting: an organization's positions by whom each reports to, rooted where that is no one or
//   one it doesn't define, a loop broken where lint flags it (`reports_cycle`) at the position that
//   comes first, each with its holders (people, or organizations seated there), those the reader
//   doesn't know counted, and its vacant seats; then Staff and Members without a position (the
//   party's by tier), the owners by role, and the delegations;
// - Ownership and control: the chain up to the ultimate parent (the holder that controls it, else
//   the largest stake, else the first by id: the home's `under` rule), and from the root chosen
//   down what each holds, page by page (`below`), with its stake, votes, Controlled and role, the
//   seats it holds, and those the reader doesn't know counted;
// - each row's menu holds only what the reader may do there (GM → Orgs' page: everything), each an
//   existing editor (`org_edit`) or page the engine judges again;
// - rows show 4 deep and open 2 deep; past 4, "Show from here" re-roots a tree, with its path.
// Pure.

import { orgRoute, type SheetRoute } from "../../../frontend/app";
import type { IconName } from "../../../frontend/icons";
import { OWNER_ROLE_LABELS, type OwnerRole } from "../../../shared/finance";
import type { OrgLinkView, OrgPersonView, OrgPositionView, OrgRef, OrgView } from "../../../shared/org-view";
import { isPartyTier, PARTY_TIERS } from "../../../shared/party";
import { appointable, holds, isGmPage, mayRevoke, orgEditRoute, rulesControls } from "./edit";
import { count, linkWords, pct, powersText, seatWords, TIER_HEADINGS, TYPE_ICON } from "./words";

/** The rows a tree draws under a root before "Show from here" (the root's row is the first). */
export const CHART_DEPTH = 4;
/** How deep a tree is open when it is first drawn: its roots' rows show what is under them. */
export const CHART_OPEN = 2;
/** How far up and down an ownership chain is followed, as the engine's control resolver does. */
export const CONTROL_DEPTH = 8;

export type ChartTone = "neutral" | "accent" | "pos" | "neg" | "warn";

/** Something a row's menu does: opens an editor or a page over this one, switches this page to a tab, or re-roots the tree. */
export interface ChartAction {
  id: string;
  label: string;
  icon?: IconName;
  danger?: boolean;
  route?: SheetRoute;
  /** Switch this page to that tab (the Ownership forms, here). */
  tab?: string;
  /** Re-root the tree at this row. */
  reroot?: true;
}

/** One row of a tree and what is under it. `key` is unique in its tree. */
export interface ChartNode {
  key: string;
  label: string;
  detail: string | null;
  /** A short figure at its end (a title, a share). */
  value: string | null;
  icon: IconName;
  badges: { text: string; tone: ChartTone }[];
  /** What tapping it opens; null: it opens its menu, else it opens or closes. */
  open: SheetRoute | null;
  actions: ChartAction[];
  children: ChartNode[];
  /** Drawn quieter: a vacant seat, people the reader doesn't know. */
  muted?: boolean;
  /** The organization the page is about, in its own ownership tree. */
  current?: boolean;
}

/** A row as a tree draws it: where it sits, whether it is open, and whether its rows go past the depth drawn. */
export interface TreeRow {
  node: ChartNode;
  /** 1 for a root's row. */
  depth: number;
  parent: string | null;
  setSize: number;
  posInSet: number;
  open: boolean;
  /** At the deepest row drawn with rows under it: "Show from here" re-roots there. */
  deep: boolean;
}

function node(key: string, label: string, icon: IconName, rest: Partial<Omit<ChartNode, "key" | "label" | "icon">> = {}): ChartNode {
  return { key, label, icon, detail: rest.detail ?? null, value: rest.value ?? null, badges: rest.badges ?? [], open: rest.open ?? null, actions: rest.actions ?? [], children: rest.children ?? [], ...(rest.muted ? { muted: true } : {}), ...(rest.current ? { current: true } : {}) };
}

// ---------------------------------------------------------------- walking a tree

/** The keys open when a tree is first drawn: every row above `CHART_OPEN`, so its first two levels show. */
export function defaultOpen(nodes: readonly ChartNode[], depth = 1): string[] {
  if (depth >= CHART_OPEN) return [];
  return nodes.flatMap((n) => (n.children.length > 0 ? [n.key, ...defaultOpen(n.children, depth + 1)] : []));
}

/** The rows a tree draws, in order: each root, and under each open row its children, never deeper than `CHART_DEPTH`. */
export function treeRows(nodes: readonly ChartNode[], open: ReadonlySet<string>, depth = 1, parent: string | null = null): TreeRow[] {
  return nodes.flatMap((n, i) => {
    const deep = depth >= CHART_DEPTH && n.children.length > 0;
    const isOpen = !deep && n.children.length > 0 && open.has(n.key);
    const row: TreeRow = { node: n, depth, parent, setSize: nodes.length, posInSet: i + 1, open: isOpen, deep };
    return [row, ...(isOpen ? treeRows(n.children, open, depth + 1, n.key) : [])];
  });
}

/** The path from a root to the row `key` (both ends included); empty when no row has it. */
export function pathTo(nodes: readonly ChartNode[], key: string): ChartNode[] {
  for (const n of nodes) {
    if (n.key === key) return [n];
    const below = pathTo(n.children, key);
    if (below.length > 0) return [n, ...below];
  }
  return [];
}

/**
 * A tree re-rooted at `root` ("Show from here"): that row alone at the top, and the path to it from
 * the tree's own root, for its breadcrumb. With no root, or one it no longer has, the whole tree.
 */
export function rerooted(nodes: readonly ChartNode[], root: string | null): { nodes: readonly ChartNode[]; path: ChartNode[] } {
  if (root === null) return { nodes, path: [] };
  const path = pathTo(nodes, root);
  const at = path.at(-1);
  return at ? { nodes: [at], path } : { nodes, path: [] };
}

/** What tapping a row does: open its page, open its menu, re-root at it, open or close it, or nothing. */
export function rowPress(row: TreeRow): "open" | "menu" | "reroot" | "toggle" | null {
  const n = row.node;
  if (n.open !== null && n.actions.length === 0) return "open";
  if (n.actions.length > 0 || n.open !== null) return "menu";
  if (row.deep) return "reroot";
  return n.children.length > 0 ? "toggle" : null;
}

/** A row's menu as drawn: Open first where it opens something, its own actions, and Show from here at the deepest row drawn. */
export function rowMenu(row: TreeRow): ChartAction[] {
  const n = row.node;
  return [...(n.open !== null ? [{ id: "open", label: "Open", icon: "chevron-right" as const, route: n.open }] : []), ...n.actions, ...(row.deep ? [{ id: "reroot", label: "Show from here", icon: "branch" as const, reroot: true as const }] : [])];
}

// ---------------------------------------------------------------- reporting

/** Each position's parent in the chart (null: a root), the loops broken at the first position of each in the page's order, and those it broke. */
export function reportingParents(positions: readonly OrgPositionView[]): { parent: Map<string, string | null>; loops: Set<string> } {
  const ids = new Set(positions.map((p) => p.id));
  const parent = new Map<string, string | null>(positions.map((p) => [p.id, p.reportsTo && p.reportsTo.id !== p.id && ids.has(p.reportsTo.id) ? p.reportsTo.id : null]));
  const loops = new Set<string>();
  for (const p of positions) {
    const seen: string[] = [];
    let at: string | null = p.id;
    while (at !== null && !seen.includes(at)) {
      seen.push(at);
      at = parent.get(at) ?? null;
    }
    if (at === null) continue;
    const cycle = seen.slice(seen.indexOf(at));
    const first = positions.find((q) => cycle.includes(q.id))?.id ?? at;
    parent.set(first, null);
    loops.add(first);
  }
  return { parent, loops };
}

/** What the reader may do to fill a seat, and whether any is free. */
interface Fill {
  appoint: boolean;
  admit: boolean;
  hire: boolean;
}

/** Who may fill seats here, by power (GM → Orgs: all of it, as its parts do). */
function fillOf(org: OrgView): Fill {
  if (!org.exists || org.type === "party") return { appoint: false, admit: false, hire: false };
  if (isGmPage(org)) return { appoint: true, admit: true, hire: org.type === "company" };
  return { appoint: holds(org, "members.appoint"), admit: holds(org, "members.admit"), hire: org.level >= 3 && holds(org, "staff.hire") };
}

/** The words for adding a member on a trust (its officers and directors) and anywhere else. */
export function admitLabel(org: OrgView): string {
  return org.type === "trust" ? "Add an officer or director" : "Admit a member";
}

/** A free seat's fill actions on a position the organization defines: appointing someone already in it (a person or an organization), admitting someone new, hiring someone. */
function fillActions(org: OrgView, p: OrgPositionView, fill: Fill): ChartAction[] {
  if (p.implied || (p.seats > 0 && p.filled >= p.seats)) return [];
  const appointees = isGmPage(org) || org.people.some((person) => !p.holders.includes(person.id));
  return [
    ...(fill.appoint && appointees ? [{ id: "appoint", label: "Appoint someone to it", icon: "user" as const, route: orgEditRoute(org.id, "appoint", p.id) }] : []),
    ...(fill.admit ? [{ id: "admit", label: org.type === "trust" ? "Add an officer or director in it" : "Admit someone into it", icon: "user-plus" as const, route: orgEditRoute(org.id, "admit", p.id) }] : []),
    ...(fill.hire ? [{ id: "hire", label: "Hire someone into it", icon: "briefcase" as const, route: orgEditRoute(org.id, "hire", p.id) }] : []),
  ];
}

/** A position's own menu: Edit, Add one under it, Move, Remove where the reader governs it (`org.govern`). */
function positionActions(org: OrgView, p: OrgPositionView, positions: boolean): ChartAction[] {
  if (!positions || p.implied) return [];
  const elsewhere = org.positions.some((q) => !q.implied && q.id !== p.id) || p.reportsTo !== null;
  return [
    { id: "edit", label: "Edit the position", icon: "edit", route: orgEditRoute(org.id, "position", p.id) },
    { id: "under", label: "Add a position under it", icon: "plus", route: orgEditRoute(org.id, "under", p.id) },
    ...(elsewhere ? [{ id: "move", label: "Move it", icon: "branch" as const, route: orgEditRoute(org.id, "move", p.id) }] : []),
    { id: "remove", label: "Remove the position", icon: "trash", danger: true, route: orgEditRoute(org.id, "remove", p.id) },
  ];
}

/** Someone on the page as a row: a person opens their member sheet; an organization seated or belonging here too, with its own page in the menu. */
function personNode(org: OrgView, key: string, p: OrgPersonView, detail: string | null, value: string | null = null): ChartNode {
  return node(key, p.you ? `${p.name} (you)` : p.name, p.org !== null ? TYPE_ICON[p.org] : "user", {
    detail,
    value,
    open: orgEditRoute(org.id, "member", p.id),
    actions: p.org !== null ? [{ id: "page", label: `Open ${p.name}'s page`, icon: TYPE_ICON[p.org], route: orgRoute(p.id, "chart") }] : [],
  });
}

/** A holder's words under their position: their own title where it says more, and whether they're here. */
function holderDetail(p: OrgPersonView, position: OrgPositionView): string | null {
  const title = p.title !== "" && p.title.toLowerCase() !== position.title.toLowerCase() ? p.title : null;
  const where = p.you || p.org !== null ? null : p.here ? "Here" : "Away";
  return [title, where].filter((part) => part !== null).join(" · ") || null;
}

/** A position's row: its seats filled of all, its badges, its holders, the seats open and the positions under it. */
function positionNode(org: OrgView, p: OrgPositionView, under: readonly ChartNode[], loops: ReadonlySet<string>, fill: Fill, positions: boolean): ChartNode {
  const byId = new Map(org.people.map((x) => [x.id, x]));
  const holders = p.holders.flatMap((id) => {
    const person = byId.get(id);
    return person ? [personNode(org, `p:${p.id}/h:${id}`, person, holderDetail(person, p))] : [];
  });
  const fills = fillActions(org, p, fill);
  const free = p.seats === 0 ? 0 : Math.max(0, p.seats - p.filled);
  const rows = [
    ...holders,
    ...(p.hidden > 0 ? [node(`p:${p.id}/hidden`, `${count(p.hidden, "other", "others")} you don't know`, "user", { muted: true })] : []),
    ...(free > 0 ? [node(`p:${p.id}/vacant`, free === 1 ? "Vacant seat" : `${free} vacant seats`, "user", { muted: true, actions: fills })] : []),
    ...under,
  ];
  const mine = org.you.position?.id === p.id || org.people.some((x) => x.you && p.holders.includes(x.id));
  const badges: ChartNode["badges"] = [
    ...(mine ? [{ text: "Yours", tone: "accent" as const }] : []),
    ...(p.filled === 0 && p.hidden === 0 && !p.implied ? [{ text: "Vacant", tone: "warn" as const }] : []),
    ...(loops.has(p.id) ? [{ text: "Reports in a loop", tone: "warn" as const }] : []),
    ...(p.implied ? [{ text: "Built in", tone: "neutral" as const }] : []),
    ...(p.joinsIn ? [{ text: "New members", tone: "neutral" as const }] : []),
  ];
  const detail = [seatWords(p), p.scope === "below" ? "reaches only below it" : null].filter((part) => part !== null).join(" · ");
  return node(`p:${p.id}`, p.title, "scroll", { detail, badges, children: rows, actions: [...positionActions(org, p, positions), ...fills] });
}

/** The owners' groups, by role in the roles' order ("Owners", "Trustees", "Beneficiaries"), each with its share where it carries worth. */
function ownerGroups(org: OrgView): ChartNode[] {
  const owners = org.people.filter((p) => p.hows.includes("owner"));
  return (Object.keys(OWNER_ROLE_LABELS) as OwnerRole[]).flatMap((role) => {
    const rows = owners.filter((p) => (p.role ?? "owner") === role);
    if (rows.length === 0) return [];
    const title = org.type === "trust" && role === "owner" ? "Owners" : OWNER_ROLE_LABELS[role].many;
    return [node(`g:owner:${role}`, title, "users", { detail: count(rows.length, "holder", "holders"), children: rows.map((p) => personNode(org, `g:owner:${role}/${p.id}`, p, p.via ? `through ${p.via.name}` : null, p.share !== null && p.share > 0 ? pct(p.share) : null)) })];
  });
}

/** The delegations in force: who acts for it, with what powers, until when; each opens its page where the reader may change or revoke it. */
function delegationGroup(org: OrgView): ChartNode[] {
  if (org.delegations.length === 0) return [];
  const can = rulesControls(org);
  const rows = org.delegations.map((d, i) =>
    node(`g:delegations/${d.who.id}:${i}`, d.who.name, "key", {
      detail: [powersText(d.powers), d.by ? `granted by ${d.by.name}` : null].filter((part) => part !== null).join(" · "),
      value: d.until ? `until ${d.until}` : "until revoked",
      open: can.delegate || mayRevoke(org, d) ? orgEditRoute(org.id, "delegate", d.who.id) : null,
    }),
  );
  return [node("g:delegations", "Acting for it", "key", { detail: count(rows.length, "delegation", "delegations"), children: rows, actions: can.delegate ? [{ id: "delegate", label: "Delegate…", icon: "key", route: orgEditRoute(org.id, "delegate") }] : [] })];
}

/**
 * The Reporting tree (§29.2): the positions by `reports_to`, then Staff and Members (Board and
 * officers on a company or a trust; the party's tiers) with no position, the owners by role and the
 * delegations, each group only when it has someone.
 */
export function reportingTree(org: OrgView): ChartNode[] {
  const { parent, loops } = reportingParents(org.positions);
  const fill = fillOf(org);
  const can = rulesControls(org);
  const build = (p: OrgPositionView): ChartNode =>
    positionNode(
      org,
      p,
      org.positions.filter((q) => parent.get(q.id) === p.id).map(build),
      loops,
      fill,
      can.positions,
    );
  const roots = org.positions.filter((p) => parent.get(p.id) === null).map(build);
  const placed = new Set(org.positions.flatMap((p) => p.holders));
  const unplaced = org.people.filter((p) => !placed.has(p.id));
  const group = (key: string, title: string, people: readonly OrgPersonView[], actions: ChartAction[] = []): ChartNode[] =>
    people.length === 0 ? [] : [node(`g:${key}`, title, "users", { detail: count(people.length, "person", "people"), actions, children: people.map((p) => personNode(org, `g:${key}/${p.id}`, p, [p.title || null, p.via ? `through ${p.via.name}` : null].filter((part) => part !== null).join(" · ") || null)) })];
  const staff = group(
    "staff",
    "Staff",
    unplaced.filter((p) => p.hows.includes("staff")),
    fill.hire ? [{ id: "hire", label: "Hire someone", icon: "user-plus", route: orgEditRoute(org.id, "hire") }] : [],
  );
  const members =
    org.type === "party"
      ? PARTY_TIERS.flatMap((tier) => group(tier, TIER_HEADINGS[tier], unplaced.filter((p) => p.hows.includes(tier))))
      : group(
          "members",
          org.type === "company" || org.type === "trust" ? "Board and officers" : "Members",
          unplaced.filter((p) => p.hows.some((h) => h === "member" || h === "leader" || isPartyTier(h))),
          fill.admit ? [{ id: "admit", label: admitLabel(org), icon: "user-plus", route: orgEditRoute(org.id, "admit") }] : [],
        );
  return [...roots, ...staff, ...members, ...ownerGroups(org), ...delegationGroup(org)];
}

// ---------------------------------------------------------------- ownership and control

/** The holder an organization sits under: the one that controls it, else the largest stake, else the first by id (the home's `under`). */
export function mainHolder(above: readonly OrgLinkView[]): OrgLinkView | null {
  return [...above].sort((a, b) => Number(b.controlled) - Number(a.controlled) || (b.share ?? 0) - (a.share ?? 0) || a.id.localeCompare(b.id))[0] ?? null;
}

/** The chain up to the ultimate parent, the ultimate parent first and `org` last, as far as the pages the reader holds go (8 deep, a loop stopping it). */
export function controlChain(org: OrgView, pageOf: (id: string) => OrgView | null): OrgRef[] {
  const chain: OrgRef[] = [{ id: org.id, name: org.name }];
  let at: OrgView | null = org;
  while (at && chain.length <= CONTROL_DEPTH) {
    const up = mainHolder(at.above);
    if (!up || chain.some((c) => c.id === up.id)) break;
    chain.unshift({ id: up.id, name: up.name });
    at = pageOf(up.id);
  }
  return chain;
}

/** A link's badges: Controlled, its role on a trust, its seat. */
function linkBadges(link: OrgLinkView): ChartNode["badges"] {
  return [
    ...(link.controlled ? [{ text: "Controlled", tone: "accent" as const }] : []),
    ...(link.role !== null && link.role !== "owner" ? [{ text: OWNER_ROLE_LABELS[link.role].one, tone: "neutral" as const }] : []),
    ...(link.position ? [{ text: link.position.title, tone: "neutral" as const }] : []),
  ];
}

/** Where the Ownership forms are: the tab drawing the economy's `ownership` section, when the page has it. */
export type OwnershipTab = (org: OrgView) => string | null;

/**
 * What may be done to a holding from its holder: in Play, sell part of it or put more in, as the
 * holder (`shares.manage`), on the holder's Ownership tab; in GM → Orgs, edit its owners on its own
 * People tab.
 */
function holdingActions(holder: OrgView | null, child: OrgLinkView, here: OrgView, ownershipTab: OwnershipTab): ChartAction[] {
  if (!holder || child.share === null || child.share <= 0) return [];
  if (isGmPage(holder)) return [{ id: "owners", label: "Edit its owners", icon: "users", route: orgRoute(child.id, "people") }];
  const tab = ownershipTab(holder);
  if (child.type !== "company" || tab === null || !holds(holder, "shares.manage")) return [];
  return [holder.id === here.id ? { id: "stake", label: "Sell part, or put more in", icon: "coins", tab } : { id: "stake", label: "Sell part, or put more in", icon: "coins", route: orgRoute(holder.id, tab) }];
}

/** Starting a subsidiary or settling a trust, as the company (`org.govern`), on its Ownership tab (Play's: GM → Orgs draws it to read). */
function foundActions(org: OrgView, ownershipTab: OwnershipTab): ChartAction[] {
  const tab = ownershipTab(org);
  if (org.type !== "company" || org.ended !== null || isGmPage(org) || tab === null || !holds(org, "org.govern")) return [];
  return [
    { id: "subsidiary", label: "Start a subsidiary", icon: "briefcase", tab },
    { id: "settle", label: "Settle a trust", icon: "shield", tab },
  ];
}

/**
 * The Ownership and control tree from `root` (an organization on the chain up from `org`, or `org`
 * itself): each holding under its holder with its stake, votes, Controlled, role and seat, page by
 * page as far as the reader's pages go (8 deep, never round a loop), those the reader doesn't know
 * counted ("1 you don't know"); `org`'s own row marked current.
 */
export function controlTree(org: OrgView, pageOf: (id: string) => OrgView | null, root: string, ownershipTab: OwnershipTab): ChartNode[] {
  const pageFor = (id: string): OrgView | null => (id === org.id ? org : pageOf(id));
  const top = pageFor(root);
  if (!top) return [];
  const walk = (page: OrgView | null, ref: { id: string; name: string; type: OrgView["type"] }, key: string, link: OrgLinkView | null, holder: OrgView | null, seen: ReadonlySet<string>, depth: number): ChartNode => {
    const below = page && depth < CONTROL_DEPTH ? page.below.filter((l) => !seen.has(l.id)) : [];
    const children = below.map((l) => walk(pageFor(l.id), l, `${key}/o:${l.id}`, l, page, new Set([...seen, l.id]), depth + 1));
    const hidden = page && page.belowHidden > 0 ? [node(`${key}/hidden`, `${page.belowHidden} you don't know`, "briefcase", { muted: true })] : [];
    const here = ref.id === org.id;
    return node(key, ref.name, TYPE_ICON[ref.type], {
      detail: link ? linkWords(link) || null : here ? "This organization" : null,
      badges: link ? linkBadges(link) : [],
      open: here ? null : orgRoute(ref.id, "chart"),
      actions: [...(link ? holdingActions(holder, link, org, ownershipTab) : []), ...(here ? foundActions(org, ownershipTab) : [])],
      children: [...children, ...hidden],
      ...(here ? { current: true } : {}),
    });
  };
  return [walk(top, top, `o:${top.id}`, null, null, new Set([top.id]), 1)];
}

/** Whether a page has a Chart: positions of its own, or organizations above or below it. */
export function hasChart(org: OrgView): boolean {
  return org.positions.some((p) => !p.implied) || org.above.length > 0 || org.below.length > 0 || org.belowHidden > 0;
}
