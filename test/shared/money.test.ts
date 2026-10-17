// Money typed in the world's currency (DESIGN §12): the one parser behind the palette's Amount, the
// ✎ cash editor, chip amounts and Build's money fields.

import { describe, expect, test } from "bun:test";
import { formatMoneyInput, minorUnitPlural, parseMoneyInput } from "../../src/shared/money";

const usd = { code: "USD", symbol: "$", minorUnit: "cent", decimals: 2, format: "{sign}{symbol}{amount}" };
const bits = { code: "BIT", symbol: "bits", minorUnit: "bit", decimals: 0, format: "{sign}{amount} bits" };
const pence = { code: "GBP", symbol: "d", minorUnit: "penny", decimals: 0, format: "{sign}{amount}d" };

describe("money typed in the world's currency", () => {
  test("Pay 5 is 5 of the currency's own amounts: 5 bits, 5d, $5.00", () => {
    expect(parseMoneyInput("5", bits)).toBe(5);
    expect(parseMoneyInput("5", pence)).toBe(5);
    expect(parseMoneyInput("5", usd)).toBe(500);
  });

  test("the symbol or unit and thousands separators are read; more decimals than the currency has are not", () => {
    expect(parseMoneyInput("$12.50", usd)).toBe(1250);
    expect(parseMoneyInput("1,200 bits", bits)).toBe(1200);
    expect(parseMoneyInput("12d", pence)).toBe(12);
    expect(parseMoneyInput("5.5", bits)).toBeNull();
    expect(parseMoneyInput("12.555", usd)).toBeNull();
    expect(parseMoneyInput("twelve", usd)).toBeNull();
  });

  test("an amount shown for editing reads back as itself", () => {
    expect(parseMoneyInput(formatMoneyInput(1250, usd), usd)).toBe(1250);
    expect(parseMoneyInput(formatMoneyInput(1200, bits), bits)).toBe(1200);
    expect(parseMoneyInput(formatMoneyInput(7, pence), pence)).toBe(7);
  });

  test("Build's stored amounts are whole minor units, named by the currency's minor unit", () => {
    expect(parseMoneyInput("1250", usd, "minor")).toBe(1250);
    expect(parseMoneyInput("12.5", usd, "minor")).toBeNull();
    expect([minorUnitPlural(usd), minorUnitPlural(bits), minorUnitPlural(pence)]).toEqual(["cents", "bits", "pennies"]);
  });
});
