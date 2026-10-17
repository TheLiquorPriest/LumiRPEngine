// Build → Packs → economy: the economy pack's own config fields, above its config as JSON. The
// narrated-price cap (DESIGN §9.5) is the most a narrated price charges for something no catalog
// row prices, in the world's minor units; left empty, the engine derives it from the tables.

import { Card } from "../../../frontend/components";
import { lintAt, MinorMoneyInput } from "../../../frontend/build/schema-form";
import type { PackConfigProps } from "../../../frontend/registry";
import { formatMoneyInput } from "../../../shared/money";
import { formatMoney } from "../../../shared/world";
import { derivedUnpricedCap } from "../core/model";

export function EconomyConfig(props: PackConfigProps) {
  const currency = props.world.currency;
  const derived = derivedUnpricedCap(props.world);
  const { unpricedCap, ...rest } = props.config;
  return (
    <Card title="Narrated prices">
      <MinorMoneyInput
        label="Narrated-price cap"
        value={unpricedCap}
        currency={currency}
        min={1}
        optional
        placeholder={formatMoneyInput(derived, currency, "minor")}
        hint={`Empty uses ${formatMoney(derived, currency)}, the highest price band in the catalog and categories. A price the player states is never capped.`}
        issues={lintAt(props.lint, "packs.economy.config.unpricedCap")}
        onChange={(value) => props.onChange(value === undefined ? rest : { ...rest, unpricedCap: value })}
      />
    </Card>
  );
}
