// The extension's own answer when RPE gives none (STANDALONE-PLAN §4.2, §9.6): today's fail-closed
// verdict, the same as today's World Info interceptor gives when a chat's state can't be read, with
// what RPE last kept out of the chat added.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { WorldInfoCandidate } from "../../src/shared/host";
import { worldInfoVerdict, type WorldInfoGate } from "../../src/secrecy/verdict";
import { failClosed, KeptOut } from "../../src/ext/fail-closed";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { ROOT } from "../removal/fates";
import { readTree } from "../removal/imports";
import recorded from "../secrecy/before-the-move.json";
import { books, candidateOf } from "../secrecy/fixture";
import type { Entry } from "../standin/lore";
import { StandIn } from "../standin/lumiverse";

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
/** What a World Info interceptor is handed of each entry, as the extension reads it into a candidate. */
type Handed = { id: string; world_book_id: string; disabled: boolean; extensions: Record<string, unknown>; comment: string; content: string };
const candidatesOf = (ctx: unknown): WorldInfoCandidate[] => (ctx as { entries: Handed[] }).entries.map((e) => ({ id: e.id, bookId: e.world_book_id, disabled: e.disabled, extensions: e.extensions as WorldInfoCandidate["extensions"], comment: e.comment, content: e.content }));

/**
 * The entries as Lumiverse's World Info chain leaves them, with this as the verdict of the interceptor registered on it: the candidates
 * are rows of a book the chat reads, the verdict is applied as Lumiverse applies one (`spindle/world-info-interceptor.ts:318-392`), and a dry run
 * gives back what the chain left for activation to work on.
 */
async function leftByChain(verdict: (candidates: WorldInfoCandidate[]) => Promise<{ disabled: string[]; enabled: string[]; mutated: { id: string; content: string }[] }>): Promise<Entry[]> {
  const lv = new StandIn();
  lv.connections.set("conn-coast", { id: "conn-coast", base: "http://127.0.0.1:7898/v1", key: "coast-key", model: "model" });
  lv.presets.set("preset-coast", { id: "preset-coast", name: "Coast", blocks: [] });
  const entries: Entry[] = ENTRIES.map((e) => ({ id: e.id, book: "book-coast", comment: e.comment, content: e.content, disabled: e.disabled, extensions: e.extensions as Record<string, unknown> }));
  lv.library.addBook({ id: "book-coast", name: "The coast", user: "user-coast", entries });
  lv.addChat({ id: "chat-coast", user: "user-coast", character: { id: "char-coast", name: "Coast", extensions: { world_book_ids: ["book-coast"] } }, messages: [{ id: "m0", role: "assistant", content: "GREET The coast is quiet." }] });
  lv.install(["generation"]).registerWorldInfoInterceptor(async (ctx) => await verdict(candidatesOf(ctx)), 10);
  const out = await lv.generate({ chat: "chat-coast", connection: "conn-coast", preset: "preset-coast", dryRun: true });
  expect(out.error).toBeNull();
  return out.worldInfo.entries;
}

describe("the fail-closed answer", () => {
  test("is today's: the same verdict today's World Info interceptor gives when the chat's state can't be read, entry for entry as Lumiverse's chain leaves them", async () => {
    const today = await leftByChain(async (entries) => {
      const verdict = await worldInfoVerdict(unreadable, { chatId: "chat-coast", userId: "user-coast", chatMetadata: {}, entries });
      return { disabled: verdict.disabled, enabled: verdict.enabled, mutated: verdict.mutated ?? [] };
    });
    const extension = await leftByChain(async (entries) => failClosed(entries, new Set()));
    expect(extension.map((e) => [e.id, e.disabled === true, e.content])).toEqual(today.map((e) => [e.id, e.disabled === true, e.content]));
    // The verdict did something: a whole-entry secret is off, a marked passage is cut.
    expect(extension.find((e) => e.id === "tunnel")!.disabled).toBe(true);
    expect(extension.find((e) => e.id === "lighthouse")!.content).not.toContain("KEEPER-SECRET");
  });

  test("is the answer recorded from today's interceptor before its rule moved, entry for entry on invented books, with no copy of the rule left in the extension", () => {
    expect(failClosed(books().map(candidateOf), new Set())).toEqual(recorded.blind as never);
    const source = readFileSync(resolve(import.meta.dir, "../../src/ext/fail-closed.ts"), "utf8");
    for (const copy of ["function blind", "function usersOwn"]) expect(source).not.toContain(copy);
    const edges = readTree(ROOT).edges.filter((edge) => edge.from === "src/ext/fail-closed.ts" && edge.to !== null).map((edge) => edge.to);
    expect(edges).toContain("src/secrecy/blind.ts");
    expect(edges.filter((to) => to?.startsWith("src/backend/"))).toEqual([]);
  });

  test("keeps every marked passage and every copy of a whole-entry secret out, and leaves the rest of each entry in", async () => {
    const left = await leftByChain(async (entries) => failClosed(entries, new Set()));
    const text = left.filter((e) => e.disabled !== true).map((e) => e.content).join("\n");
    for (const kept of ["KEEPER-SECRET", "TUNNEL-SECRET", "ICE-SECRET", "COPY-SECRET", "BROKEN-A", "BROKEN-B"]) expect(text).not.toContain(kept);
    for (const stays of ["The lighthouse is white.", "The harbor freezes in winter.", "The pier is old.", "The gulls are loud."]) expect(text).toContain(stays);
    // The engine's own sections are no secret's, as today.
    expect(left.find((e) => e.id === "engine")!.disabled).not.toBe(true);
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
