// Refused sign-ins in RPE's log: the first from an address is a line at once naming the address and no secret; the rest from it are one line with
// their number; another address has its own.

import { describe, expect, test } from "bun:test";
import { RefusedSignIns } from "../../src/app/refusals";

describe("refused sign-ins", () => {
  test("a run of refusals from one address is a first line and one line with the count, not a line each", () => {
    const said: { message: string; fields: unknown }[] = [];
    const warn = (message: string, fields?: unknown): void => void said.push({ message, fields });
    const refusals = new RefusedSignIns({ log: { debug: warn, info: warn, warn, error: warn }, seconds: 60 });
    refusals.refused("203.0.113.9", "token");
    expect(said).toHaveLength(1);
    expect(said[0]?.message).toBe("A call to RPE's web app was refused from 203.0.113.9: its token is not one RPE accepts, or it has ended.");
    for (let i = 0; i < 6; i++) refusals.refused("203.0.113.9", "token");
    refusals.refused("203.0.113.9", "account");
    refusals.refused("198.51.100.2", "account");
    expect(said).toHaveLength(2);
    expect(said[1]?.message).toBe("A sign-in to RPE's web app was refused from 198.51.100.2: the Lumiverse account or password was refused.");
    refusals.flush();
    expect(said.map((s) => s.message).slice(2)).toEqual(["7 more sign-ins or calls to RPE's web app were refused from 203.0.113.9 in the last 60 seconds."]);
    // Another run from the same address starts a first line again.
    refusals.refused("203.0.113.9", "token");
    expect(said).toHaveLength(4);
    refusals.flush();
  });
});
