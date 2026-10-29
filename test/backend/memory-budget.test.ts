// The engine's own memory budget (DESIGN §9.6): past the limit it lets go of the chats not in use
// and collects, once until the RSS grows again; every whole read of a chat is collected after.

import { describe, expect, test } from "bun:test";
import { MEMORY_LIMIT_BYTES, MEMORY_REGROWTH_BYTES, MemoryBudget, watchMemory, type TrimReport } from "../../src/backend/memory-budget";

const MB = 1024 * 1024;
const GONE: TrimReport = { messages: 2, ledgers: 1, views: 3, bridges: 4 };

function probe(rss: number): { at: { rss: number; collected: number; trims: number }; rss: () => number; collect: () => void; trim: () => TrimReport } {
  const at = { rss, collected: 0, trims: 0 };
  return {
    at,
    rss: () => at.rss,
    collect: () => {
      at.collected++;
    },
    trim: () => {
      at.trims++;
      return GONE;
    },
  };
}

describe("the memory budget", () => {
  test("past the limit, lets go of the chats not in use and collects, again only once the RSS has grown or fallen back below", () => {
    const p = probe(MEMORY_LIMIT_BYTES);
    const lines: string[] = [];
    const budget = new MemoryBudget(p, p.trim, (line) => lines.push(line));
    expect(budget.check()).toBe(false);
    p.at.rss = MEMORY_LIMIT_BYTES + 10 * MB;
    expect(budget.check()).toBe(true);
    expect(p.at).toEqual({ rss: MEMORY_LIMIT_BYTES + 10 * MB, collected: 1, trims: 1 });
    expect(lines).toEqual([`memory: RSS ${Math.round(MEMORY_LIMIT_BYTES / MB) + 10} MB is past the ${Math.round(MEMORY_LIMIT_BYTES / MB)} MB budget; let go of the copies of 2 chats' messages, 1 open ledgers, 3 views and 4 turn bridges of chats not in use`]);
    p.at.rss += MEMORY_REGROWTH_BYTES - 1;
    expect(budget.check()).toBe(false);
    p.at.rss += 1;
    expect(budget.check()).toBe(true);
    p.at.rss = MEMORY_LIMIT_BYTES - MB;
    expect(budget.check()).toBe(false);
    p.at.rss = MEMORY_LIMIT_BYTES + MB;
    expect(budget.check()).toBe(true);
    expect(p.at.trims).toBe(3);
  });

  test("as the backend runs it: every whole read is collected after, and the RSS looked at", () => {
    const p = probe(MB);
    const listeners: (() => void)[] = [];
    const budget = watchMemory(
      {
        trimIdle: p.trim,
        onChatRead: (listener) => {
          listeners.push(listener);
        },
      },
      p,
      () => undefined,
    );
    const read = (): void => {
      for (const listener of listeners) listener();
    };
    try {
      read();
      expect(p.at).toEqual({ rss: MB, collected: 1, trims: 0 });
      p.at.rss = MEMORY_LIMIT_BYTES + MB;
      read();
      expect(p.at).toEqual({ rss: MEMORY_LIMIT_BYTES + MB, collected: 2, trims: 1 });
    } finally {
      budget.stop();
    }
  });
});
