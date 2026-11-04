// The economy's modules, in the order the pack registers them (DESIGN §25.12). Each module adds
// one import and one entry here; nothing else of the foundation names it.

import { registerExempt } from "./exempt";
import { registerListing } from "./listing";
import type { FinanceModule } from "./module";
import { registerShares } from "./shares";
import { registerTreasury } from "./treasury";
import { registerUnemployment } from "./unemployment";
import { registerWork } from "./work";
import { registerAssets } from "./wealth";
import { registerWinding } from "./winding";

export const FINANCE_MODULES: readonly { id: string; register: FinanceModule }[] = [
  { id: "work", register: registerWork },
  { id: "unemployment", register: registerUnemployment },
  { id: "exempt", register: registerExempt },
  { id: "assets", register: registerAssets },
  { id: "treasury", register: registerTreasury },
  { id: "winding", register: registerWinding },
  { id: "shares", register: registerShares },
  { id: "listing", register: registerListing },
];
