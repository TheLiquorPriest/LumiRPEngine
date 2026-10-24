// A new item's page in Build (a step template, say) isn't in the draft until Create: leaving it by
// Build's own navigation asks first, and stays put unless the user says to leave.

import { describe, expect, test } from "bun:test";
import { initialUi } from "../../src/frontend/app";
import { go, holdNew } from "../../src/frontend/build/chrome";
import { createStore } from "../../src/frontend/store";

function app(answer: boolean) {
  const asked: string[] = [];
  const ui = createStore(initialUi(false));
  const host = {
    confirm: async (title: string): Promise<boolean> => {
      asked.push(title);
      return answer;
    },
  };
  return { ui, host, asked };
}

const list = { view: "collection", worldId: "w", collection: "steps" } as const;

describe("leaving a new item's page", () => {
  test("asks first, and stays on the page when the user doesn't leave", async () => {
    const a = app(false);
    const before = a.ui.get().build;
    const release = holdNew(a, "step template");
    go(a, list);
    await Promise.resolve();
    await Promise.resolve();
    expect(a.asked).toHaveLength(1);
    expect(a.ui.get().build).toBe(before);
    release();
  });

  test("leaves once the user says to; with nothing held, or once released by Create, it goes at once", async () => {
    const a = app(true);
    const release = holdNew(a, "step template");
    go(a, list);
    await Promise.resolve();
    await Promise.resolve();
    expect(a.ui.get().build).toEqual(list);
    release();
    const b = app(false);
    const free = holdNew(b, "step template");
    free();
    go(b, list);
    expect(b.asked).toHaveLength(0);
    expect(b.ui.get().build).toEqual(list);
  });
});
