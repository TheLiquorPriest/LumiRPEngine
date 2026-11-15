// The extension's own answer when RPE gives none (STANDALONE-PLAN §4.2, §9.6): today's fail-closed
// verdict, the same as today's World Info interceptor gives when a chat's state can't be read, with
// what RPE last kept out of the chat added.

import { describe, expect, test } from "bun:test";
import type { WorldInfoCandidate } from "../../src/shared/host";
import { worldInfoVerdict, type WorldInfoGate } from "../../src/backend/wi-interceptor";
import { failClosed, KeptOut } from "../../src/ext/fail-closed";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";

const candidate = (id: string, content: string, extensions: Record<string, unknown> = {}, disabled = false): WorldInfoCandidate => ({ id, bookId: "book-coast", disabled, extensions: extensions as WorldInfoCandidate["extensions"], comment: id, content });

const ENTRIES: WorldInfoCandidate[] = [
  candidate("lighthouse", "The lighthouse is white.\n{{// Secret (known to Ilsa): KEEPER-SECRET the keeper cannot see}}"),
  candidate("tunnel", "{{// Secret: TUNNEL-SECRET a tunnel runs under the inn}}"),
  candidate("rumor", "  TUNNEL-SECRET   a tunnel runs under the inn\n"),
  candidate("harbor", "The harbor freezes in winter.\n{{// Secret (known to Ilsa; kept from everyone): ICE-SECRET the ice hides a wreck}}"),
  candidate("older", "OLDER-SECRET the bell was stolen", { [LEDGER_NAMESPACE]: { lore: { secret: true, gate: "true" } } }, true),
  candidate("copy", "COPY-SECRET a copy of a secret elsewhere", { [LEDGER_NAMESPACE]: { secretCopyOf: { entry: "book-far/elsewhere", off: false } } }),
  candidate("broken", "The pier is old.\n{{// Secret: BROKEN-A {{user}} BROKEN-B}}"),
  candidate("engine", "{{// Secret: ENGINE-TEXT}}", { [LEDGER_NAMESPACE]: { slot: "scene" } }),
  candidate("plain", "The gulls are loud."),
];

/** Today's interceptor when the chat's state can't be read: the gate's other parts are never reached on that path. */
const unreadable: WorldInfoGate = {
  registry: undefined as never,
  playsWorld: () => true,
  head: async () => Promise.reject(new Error("no state")),
  narrator: async () => Promise.reject(new Error("not reached")),
  log: () => undefined,
};

describe("the fail-closed answer", () => {
  test("is today's: the same verdict today's World Info interceptor gives when the chat's state can't be read", async () => {
    const today = await worldInfoVerdict(unreadable, { chatId: "chat-coast", userId: "user-coast", chatMetadata: {}, entries: ENTRIES });
    expect(failClosed(ENTRIES, new Set())).toEqual({ disabled: today.disabled, enabled: today.enabled, mutated: today.mutated ?? [] });
  });

  test("keeps every marked passage and every copy of a whole-entry secret out, and leaves the rest of each entry in", () => {
    const verdict = failClosed(ENTRIES, new Set());
    const shown = ENTRIES.filter((e) => !verdict.disabled.includes(e.id)).map((e) => verdict.mutated.find((m) => m.id === e.id)?.content ?? e.content);
    const text = shown.join("\n");
    for (const kept of ["KEEPER-SECRET", "TUNNEL-SECRET", "ICE-SECRET", "COPY-SECRET", "BROKEN-A", "BROKEN-B"]) expect(text).not.toContain(kept);
    for (const left of ["The lighthouse is white.", "The harbor freezes in winter.", "The pier is old.", "The gulls are loud."]) expect(text).toContain(left);
    // The engine's own sections are no secret's, as today.
    expect(verdict.disabled).not.toContain("engine");
  });

  test("adds what RPE last kept out of the chat, and only for this chat", () => {
    const kept = new KeptOut(8);
    kept.heard("user-coast", "chat-coast", { secrecy: { disabled: ["plain"], enabled: [], mutated: [] }, cut: null });
    expect(failClosed(ENTRIES, kept.of("user-coast", "chat-coast")).disabled).toContain("plain");
    expect(failClosed(ENTRIES, kept.of("user-coast", "chat-other")).disabled).not.toContain("plain");
    // The latest answer replaces the one before.
    kept.heard("user-coast", "chat-coast", { secrecy: { disabled: [], enabled: [], mutated: [] }, cut: null });
    expect(failClosed(ENTRIES, kept.of("user-coast", "chat-coast")).disabled).not.toContain("plain");
  });

  test("remembers where RPE last said to cut a chat, through an answer that could not say", () => {
    const kept = new KeptOut(8);
    const none = { disabled: [], enabled: [], mutated: [] };
    kept.heard("u", "chat-coast", { secrecy: none, cut: { keep: { id: "m7", index: 7 } } });
    kept.heard("u", "chat-coast", { secrecy: none, cut: null });
    expect(kept.cutOf("u", "chat-coast")).toEqual({ id: "m7", index: 7 });
    expect(kept.cutOf("u", "chat-other")).toBeNull();
    kept.heard("u", "chat-coast", { secrecy: none, cut: { keep: null } });
    expect(kept.cutOf("u", "chat-coast")).toBeNull();
  });

  test("remembers no more chats than it is given, forgetting the one answered longest ago", () => {
    const kept = new KeptOut(2);
    for (const chat of ["a", "b", "c"]) kept.heard("u", chat, { secrecy: { disabled: [`${chat}-entry`], enabled: [], mutated: [] }, cut: null });
    expect([...kept.of("u", "a")]).toEqual([]);
    expect([...kept.of("u", "b")]).toEqual(["b-entry"]);
    expect([...kept.of("u", "c")]).toEqual(["c-entry"]);
  });
});
