// Build's inner place as the route's names (`at`) and back: the web shell keeps them in the page's address and
// the drawer in memory, so a reload or Back returns to the place. Kept apart from the Build view so the
// page that shows it (`page.tsx`) and the view itself (`build.tsx`) both read them.

import type { BuildRoute } from "../../frontend/app";
import type { JobKind } from "../../shared/jobs";
import type { WorldCollection, WorldPart } from "../../shared/world";

/** Build's inner place as the route's names (`at`). */
export function atOf(place: BuildRoute): string[] {
  switch (place.view) {
    case "worlds":
      return [];
    case "world":
      return [place.worldId];
    case "collection":
      return [place.worldId, "collection", place.collection];
    case "entities":
      return [place.worldId, "entities", place.group];
    case "item":
      return [place.worldId, "item", place.collection, place.id ?? "", ...(place.at === undefined ? [] : [place.at])];
    case "part":
      return [place.worldId, "part", place.part];
    case "check":
      return [place.worldId, "check"];
    case "job":
      return [place.worldId, "job", place.kind];
    case "secrecy":
      return [place.worldId, "secrecy"];
  }
}

/** The inner place the route's names lead to; names that lead nowhere Build knows are the list of worlds. */
export function placeOf(at: readonly string[] | undefined): BuildRoute {
  const [worldId, view, name, id, inner] = at ?? [];
  if (worldId === undefined || worldId === "") return { view: "worlds" };
  if (view === undefined) return { view: "world", worldId };
  if (view === "check" || view === "secrecy") return { view, worldId };
  if (name === undefined || name === "") return { view: "world", worldId };
  if (view === "collection") return { view, worldId, collection: name as WorldCollection };
  if (view === "entities") return { view, worldId, group: name as Extract<BuildRoute, { view: "entities" }>["group"] };
  if (view === "item") return { view, worldId, collection: name as WorldCollection, id: id === undefined || id === "" ? null : id, ...(inner === undefined ? {} : { at: inner }) };
  if (view === "part") return { view, worldId, part: name as WorldPart };
  if (view === "job") return { view, worldId, kind: name as JobKind };
  return { view: "world", worldId };
}

export function samePlace(a: BuildRoute, b: BuildRoute): boolean {
  return JSON.stringify(atOf(a)) === JSON.stringify(atOf(b));
}
