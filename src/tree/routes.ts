// The Files and Storage pages' routes (plan §5, §14), in three groups: the files (`routes-files.ts`), the
// agents' suggestions (`routes-suggestions.ts`) and storage (`routes-storage.ts`). Every route is a page's:
// an agent has no way to them, and reaches the tree only through the file port, held to where it may
// write. Every path is a path of the chat's view, normalized and held inside the tree by the view
// (`locate`), links refused. Each route is declared in the route form with the shapes of `./shapes.ts`.

import { routeKit, type TreeRoutesDeps } from "./route-kit";
import { fileRoutes } from "./routes-files";
import { storageRoutes } from "./routes-storage";
import { suggestionRoutes } from "./routes-suggestions";

export type { TreeRoutesDeps };

export function treeRoutes(deps: TreeRoutesDeps) {
  const kit = routeKit(deps);
  return [...storageRoutes(kit), ...fileRoutes(kit), ...suggestionRoutes(kit)] as const;
}
