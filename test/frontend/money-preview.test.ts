// The preview's money as the browser preview serves it (dev/preview): `?money=<party>` makes the GM
// view Port Alder's own, so the GM's money pages read Port Alder's entities, kinds and places, and
// Pay another way on the declined purchase pays from the money view as it is. The preview answers
// on timers, which the tests run on a fake clock.

import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { MockBackend } from "../../dev/preview/mock-backend";
import { DECLINED_PURCHASE } from "../../dev/preview/fixtures";
import { applyDelta } from "../../src/frontend/delta";
import type { DeltaOp, FrontendToBackend } from "../../src/shared/protocol";
import { isRecord, type JsonObject } from "../../src/shared/json";
import type { GmView, StateView } from "../../src/shared/state-view";
import { decodeFinanceView } from "../../src/packs/economy/ui/decode";
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

/** Play's view as the frontend holds it: the backend's last snapshot with every delta since applied. */
function heldView(sent: unknown[]): StateView {
  let view: unknown = null;
  for (const m of sent) {
    if (!isRecord(m)) continue;
    if (m.type === "lre.state.snapshot") view = m.view;
    else if (m.type === "lre.state.delta" && Array.isArray(m.ops)) view = applyDelta(view, m.ops as DeltaOp[]);
  }
  return view as StateView;
}

describe("the preview's Pay another way", () => {
  test("the declined catering order is paid from savings, the first way with room for it, and the money hub shows it", () => {
    const { send, sent } = preview();
    send({ lre: 1, type: "lre.hello", reqId: "hello", chatId: "chat" });
    resultOf(sent, "hello");
    const before = decodeFinanceView(heldView(sent).panels["economy.money"] ?? null);
    send({ lre: 1, type: "lre.chip", reqId: "other", chatId: "chat", chip: "c-decline", choice: "other" });
    expect(resultOf(sent, "other")).toEqual({ applied: true, pending: false });
    const after = decodeFinanceView(heldView(sent).panels["economy.money"] ?? null);
    const balance = (v: typeof after, id: string): number | undefined => v?.accounts.find((a) => a.id === id)?.cents;
    // The Visa had $787.45 of room, less than the $850.00 order; savings comes first anyway.
    expect(balance(after, "sav")).toBe((balance(before, "sav") ?? 0) - DECLINED_PURCHASE.cents);
    expect(balance(after, "visa")).toBe(balance(before, "visa"));
    expect(after?.recent[0]).toMatchObject({ memo: DECLINED_PURCHASE.name, cents: -DECLINED_PURCHASE.cents, accountId: "sav" });
    expect(after?.overview?.netWorth).toBe((before?.overview?.netWorth ?? 0) - DECLINED_PURCHASE.cents);
  });
});
