// When a page asks the engine again (DESIGN §5.1): once Lumiverse has acknowledged its socket, and
// when its own engine starts again. The CONNECTED a socket emits as it opens comes before Lumiverse
// authenticated it (frontend/src/ws/client.ts), and Lumiverse drops what a page sends then
// (src/ws/handler.ts); its own acknowledgement names the user (useWebSocket.ts resyncs on it too).

import { describe, expect, test } from "bun:test";
import { watchReconnects, type HostEvents } from "../../src/frontend/reconnect";

function events(): HostEvents & { emit(event: string, payload: unknown): void; count(): number } {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  return {
    on(event, handler) {
      const set = handlers.get(event) ?? new Set();
      set.add(handler);
      handlers.set(event, set);
      return () => set.delete(handler);
    },
    emit(event, payload) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
    count: () => [...handlers.values()].reduce((n, set) => n + set.size, 0),
  };
}

describe("asking again", () => {
  test("a reconnect asks again once Lumiverse acknowledges the socket, not as it opens", () => {
    const ev = events();
    let asked = 0;
    watchReconnects(ev, "install-lre", () => asked++);
    ev.emit("CONNECTED", {});
    expect(asked).toBe(0);
    ev.emit("CONNECTED", { message: "Connected to Lumiverse event bus", userId: "u1", role: "user" });
    expect(asked).toBe(1);
  });

  test("its own engine starting again asks again; another extension's doesn't", () => {
    const ev = events();
    let asked = 0;
    watchReconnects(ev, "install-lre", () => asked++);
    ev.emit("SPINDLE_EXTENSION_LOADED", { extensionId: "install-other", identifier: "other", name: "Other" });
    expect(asked).toBe(0);
    ev.emit("SPINDLE_EXTENSION_LOADED", { extensionId: "install-lre", identifier: "lumi_rp_engine", name: "LumiRPEngine" });
    expect(asked).toBe(1);
  });

  test("a host that names no installation still asks again on reconnects; stopping unsubscribes everything", () => {
    const ev = events();
    let asked = 0;
    const stop = watchReconnects(ev, null, () => asked++);
    ev.emit("SPINDLE_EXTENSION_LOADED", { extensionId: "install-lre" });
    ev.emit("CONNECTED", { userId: "u1", role: "owner" });
    expect(asked).toBe(1);
    stop();
    expect(ev.count()).toBe(0);
  });
});
