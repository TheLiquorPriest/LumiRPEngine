// Where a hub page rides Play's sheet stack: an account's page is an `account`
// sheet with the account's id; every other page is a `money` sheet whose id is the page, its type
// then its path, each segment URI-encoded (flow ids hold colons, a name may hold a slash).

import type { SheetKind, SheetRoute } from "../../../frontend/app";
import type { HubPage, HubPageType } from "./nav";

const TYPES: readonly HubPageType[] = ["section", "detail", "action"];

export function routeOf(page: HubPage): SheetRoute {
  const [head, id] = page.path;
  if (page.type === "detail" && head === "account" && id !== undefined && page.path.length === 2) return { kind: "account", id };
  return { kind: "money", id: `${page.type}:${page.path.map(encodeURIComponent).join("/")}` };
}

/** The page a `money` or `account` sheet shows; null for an id that names none. */
export function pageOf(kind: SheetKind, id: string): HubPage | null {
  if (kind === "account") return id === "" ? null : { type: "detail", path: ["account", id] };
  if (kind !== "money") return null;
  const colon = id.indexOf(":");
  const type = colon < 0 ? undefined : TYPES.find((t) => t === id.slice(0, colon));
  const rest = id.slice(colon + 1);
  if (!type || rest === "") return null;
  try {
    return { type, path: rest.split("/").map(decodeURIComponent) };
  } catch {
    // A broken escape names no page.
    return null;
  }
}
