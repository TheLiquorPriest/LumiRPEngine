// The economy's modules, in the order the pack registers them (DESIGN §25.12). Each module adds
// one import and one entry here; nothing else of the foundation names it.

import type { FinanceModule } from "./module";
import { registerAssets } from "./wealth";

export const FINANCE_MODULES: readonly { id: string; register: FinanceModule }[] = [{ id: "assets", register: registerAssets }];
