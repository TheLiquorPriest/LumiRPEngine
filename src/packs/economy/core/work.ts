// The work module (DESIGN §26): employment and payroll, businesses, and taxes, plugged into the
// money foundation through one registration the economy pack calls (`modules.ts`).

import { registerBusiness } from "./business";
import { registerEmployment } from "./employment";
import type { FinanceRegistry } from "./module";
import { registerTaxes } from "./taxes";

export function registerWork(r: FinanceRegistry): void {
  registerEmployment(r);
  registerBusiness(r);
  registerTaxes(r);
}
