// Where a page of someone's money rides Play's sheet stack (ORG-SPEC §5.3): the POV's account page
// is an `account` sheet with the account's id; every other page is a `money` sheet whose id names
// whose money it is, then the page, its type then its path (`<party>|<type>:<path>`), the party and
// each segment URI-encoded (flow ids hold colons, a name may hold a slash).

import type { SheetKind, SheetRoute } from "../../../frontend/app";
import type { EntityId } from "../../../shared/ids";
import type { Reader } from "./hub";
import type { HubPage, HubPageType } from "./nav";
import { holds } from "./pages";

const TYPES: readonly HubPageType[] = ["section", "detail", "action"];

/** The sheet for a page of `party`'s money; `pov` says it's the POV's own, whose account pages are `account` sheets. */
export function routeOf(page: HubPage, party: EntityId, pov: boolean): SheetRoute {
  const [head, id] = page.path;
  if (pov && page.type === "detail" && head === "account" && id !== undefined && page.path.length === 2) return { kind: "account", id };
  return { kind: "money", id: `${encodeURIComponent(party)}|${page.type}:${page.path.map(encodeURIComponent).join("/")}` };
}

/**
 * Where a page opened from `party`'s money goes: on the POV's own (`own`), to theirs; on an
 * organization's, to the POV's own page where their money (`reader`) holds what it names, with
 * their controls on it, else to the organization's.
 */
export function routeFrom(party: EntityId, own: boolean, reader: Reader | null, next: HubPage): SheetRoute {
  if (own) return routeOf(next, party, true);
  return reader !== null && holds(reader.view, next) ? routeOf(next, reader.view.party, true) : routeOf(next, party, false);
}

/** Whose money a `money` or `account` sheet shows (null: the POV's, an account sheet's) and the page; null for an id that names none. */
export function pageOf(kind: SheetKind, id: string): { party: EntityId | null; page: HubPage } | null {
  if (kind === "account") return id === "" ? null : { party: null, page: { type: "detail", path: ["account", id] } };
  if (kind !== "money") return null;
  const bar = id.indexOf("|");
  const colon = id.indexOf(":", bar + 1);
  if (bar <= 0 || colon < 0) return null;
  const type = TYPES.find((t) => t === id.slice(bar + 1, colon));
  const rest = id.slice(colon + 1);
  if (!type || rest === "") return null;
  try {
    return { party: decodeURIComponent(id.slice(0, bar)), page: { type, path: rest.split("/").map(decodeURIComponent) } };
  } catch {
    // A broken escape names no page.
    return null;
  }
}
