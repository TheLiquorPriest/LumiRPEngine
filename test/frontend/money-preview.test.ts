// The preview's money worlds as the browser preview serves them (dev/preview): `?money=<party>` makes
// the GM view Port Alder's own, so the GM's money pages read Port Alder's entities, kinds and places.
// The preview answers on timers, which the tests run on a fake clock.

import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { MockBackend } from "../../dev/preview/mock-backend";
import type { FrontendToBackend } from "../../src/shared/protocol";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { GmView } from "../../src/shared/state-view";
import { gmParties } from "../../src/packs/economy/ui/layout";

/** The preview's backend with the `?money=` party it is given, and every message it sends. */
function preview(money?: string): { send(message: FrontendToBackend): void; sent: unknown[] } {
  const sent: unknown[] = [];
  const backend = new MockBackend((payload) => sent.push(payload), { scenario: "play", ...(money ? { money } : {}), closeDrawer: () => {} });
  return { send: (message) => backend.receive(message), sent };
}

/** The body of the result for `reqId`, once the clock has run past the preview's answer. */
function resultOf(sent: unknown[], reqId: string): JsonObject {
  vi.advanceTimersByTime(100);
  const message = sent.find((m): m is JsonObject => isRecord(m) && m.reqId === reqId);
  if (!message) throw new Error(`no answer to ${reqId}`);
  if (message.type !== "lre.result" || !isRecord(message.body)) throw new Error(`${reqId} was refused: ${String(message.message)}`);
  return message.body;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the preview's ?money= worlds", () => {
  test("the GM view is Port Alder's: its people, its business with its fields, its household, and everyone's money", () => {
    const { send, sent } = preview("marcus_delgado");
    send({ lre: 1, type: "lre.hello", reqId: "hello", chatId: "chat" });
    resultOf(sent, "hello");
    send({ lre: 1, type: "lre.gm", reqId: "gm", chatId: "chat" });
    const gm = resultOf(sent, "gm") as unknown as GmView;
    const ids = gm.entities.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(["marcus_delgado", "alder_automotive_co", "acct_marcus_shop", "household_kowalczyk"]));
    // Nothing of the default preview world is left to answer for Port Alder.
    expect(ids).not.toContain("npc_rosie");
    // A business's fields page and Add a job read its entity; Add to a household and a payee read the kinds.
    expect(gm.entities.find((e) => e.id === "alder_automotive_co")?.fields.length).toBeGreaterThan(0);
    expect(gmParties(gm, ["business"]).map((p) => p.id)).toEqual(["alder_automotive_co"]);
    expect(gmParties(gm, ["household"]).map((p) => p.id)).toEqual(["household_kowalczyk"]);
    expect(gm.money[0]?.party).toBe("marcus_delgado");
  });
});
