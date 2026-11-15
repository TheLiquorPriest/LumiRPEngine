// What the migration reads of a chat's agents (DESIGN §4.4, §4.5): the learned area's index, the GM
// assistant's thread and a rollback asked for, kept in the chat's metadata under LRE's key, beside
// the chat's run and never in its ledger, read as today's build left them
// (src/migrate/today/chat-agent-meta.ts, used by src/migrate/chats.ts and rehearse.ts). The old
// writer's own checks, its refusals and its one queue of writes, went with it
// (src/backend/chat-agent-meta.ts), and the blob sweep's list of what a chat names went with the agents
// engine (src/backend/agents/sweep.ts).

import { describe, expect, test } from "bun:test";
import { AGENTS_KEY, agentMetaOf } from "../../../src/migrate/today/chat-agent-meta";
import { chatKnowledgePrefsOf, PREFS_KEY } from "../../../src/migrate/today/chat-knowledge-prefs";
import type { JsonObject } from "../../../src/shared/json";
import { LEDGER_NAMESPACE } from "../../../src/shared/ledger";
import { blobHash } from "../../../src/shared/stores";

/** A chat's metadata holding `own` under LRE's key. */
const bag = (own: JsonObject): JsonObject => ({ [LEDGER_NAMESPACE]: own });

describe("the learned area, as the migration reads it", () => {
  test("an entry that doesn't read is left out, an earlier build's readers are read and dropped, and a chat that plays no world has none", () => {
    const hash = blobHash("kept");
    const kept = { hash, readers: "gm" };
    const meta = bag({
      [AGENTS_KEY]: {
        learned: {
          "learned/a.md": kept,
          "notes/b.md": kept,
          "learned/c.md": { hash: "not a hash", readers: "gm" },
          "learned/d.md": { hash, readers: "nobody" },
          "learned/e.md": hash,
          "learned/../f.md": { hash },
          "learned/g.md": { hash, role: "assistant", pinned: true },
          "learned/h.md": { hash, pinned: "yes" },
        },
      },
    });
    expect(agentMetaOf(meta).learned).toEqual({ "learned/a.md": { hash }, "learned/d.md": { hash }, "learned/g.md": { hash, role: "assistant", pinned: true } });
    expect(agentMetaOf({})).toEqual({ learned: {}, assistant: { messages: [], proposals: {} }, rollback: null });
  });

  test("only the agents' own key is read: a learned index beside it, among the run's fields, is not the learned area", () => {
    const hash = blobHash("Sam takes tea without sugar.");
    const meta = bag({ learned: { "learned/people/sam.md": { hash } }, [AGENTS_KEY]: { learned: { "learned/places/pier.md": { hash } } } });
    expect(agentMetaOf(meta).learned).toEqual({ "learned/places/pier.md": { hash } });
  });

  test("what three writers left at once reads whole: the narrator choice, the assistant's thread and a learned file", () => {
    const message = blobHash("A message of the GM assistant's thread.");
    const jordan = blobHash("Jordan Ellis asks before acting.");
    const meta = bag({
      [PREFS_KEY]: { narrator: { knowledge: "pov", secrets: "omit" } },
      [AGENTS_KEY]: { assistant: { messages: [message], proposals: {} }, learned: { "learned/jordan.md": { hash: jordan, role: "assistant" } } },
    });
    expect(agentMetaOf(meta).assistant.messages).toEqual([message]);
    expect(Object.keys(agentMetaOf(meta).learned)).toEqual(["learned/jordan.md"]);
    expect(chatKnowledgePrefsOf(meta).narrator).toEqual({ knowledge: "pov", secrets: "omit" });
  });

  test("the assistant's thread, its side session and a rollback asked for read as they stand, and a part that doesn't read is left out", () => {
    const message = blobHash("Ask Jordan about the pier.");
    const proposal = blobHash("Add the pier's opening hours.");
    const base = blobHash("The summary the rollback undoes.");
    const archived = blobHash("The span the compaction archived.");
    const meta = bag({ [AGENTS_KEY]: { assistant: { messages: [message, "not a hash"], proposals: { pier: proposal, "": proposal, hours: "nope" }, side: "side-1" }, rollback: { base, archived } } });
    expect(agentMetaOf(meta)).toEqual({ learned: {}, assistant: { messages: [message], proposals: { pier: proposal }, side: "side-1" }, rollback: { base, archived } });
    // A rollback missing either half was never asked for, which is what the migration counts (src/migrate/chats.ts).
    expect(agentMetaOf(bag({ [AGENTS_KEY]: { rollback: { base } } })).rollback).toBeNull();
  });
});
