// The packs' panels, sheets, editors and chip renderers as the kept views draw them, registered once when
// the kept chunk loads (`chunk.ts`). Only the chunk's views read it; the chat's surfaces in the light part
// draw none of a pack's.

import { UI_PACKS } from "../../frontend/packs";
import { buildCatalog } from "../../frontend/ui-registry";

export const CATALOG = buildCatalog(UI_PACKS);
