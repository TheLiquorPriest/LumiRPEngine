// A page starts a reply the engine prepared (DESIGN §5.1): asked with `lre.generate`, it claims the
// turn (`lre.restart`) and starts Lumiverse's Regenerate or Continue on a yes, once. A claim that got
// no answer (Lumiverse dropped it, or its answer, with the socket) doesn't use the turn up: the next
// ask, which a page gets when it resyncs, claims it again.

import { describe, expect, test } from "bun:test";
import { startPreparedReplies } from "../../src/frontend/restart";
import type { ErrorMessage, GeneratePush, ResultMessage } from "../../src/shared/protocol";

interface Claim {
  turn: string;
  answer(message: ResultMessage | ErrorMessage): void;
}

function page() {
  let push: (p: GeneratePush) => void = () => undefined;
  const claims: Claim[] = [];
  const started: string[] = [];
  const toasts: string[] = [];
  let visible = true;
  const stop = startPreparedReplies(
    {
      onGenerate(listener) {
        push = listener;
        return () => {
          push = () => undefined;
        };
      },
      send(request) {
        const { promise, resolve } = Promise.withResolvers<ResultMessage | ErrorMessage>();
        if (request.type === "lre.restart") claims.push({ turn: request.turn, answer: resolve });
        return promise;
      },
      visible: () => visible,
    },
    {
      activeChat: () => "c1",
      generate: async (as) => {
        started.push(as);
        return true;
      },
      toast: (text) => toasts.push(text),
    },
  );
  return {
    ask: (turn: string, as: GeneratePush["as"] = "regenerate") => push({ lre: 1, type: "lre.generate", chatId: "c1", as, turn }),
    claims,
    started,
    toasts,
    hide: () => {
      visible = false;
    },
    stop,
  };
}

const yes = (reqId: string): ResultMessage => ({ lre: 1, type: "lre.result", reqId, request: "lre.restart", body: { start: true } }) as ResultMessage;
const lost = (reqId: string): ErrorMessage => ({ lre: 1, type: "lre.error", reqId, code: "unavailable", message: "No reply from the engine" });

/** Lets the claims' answers run. */
async function answered(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

describe("starting a prepared reply", () => {
  test("a claim lost with the socket is made again on the next ask, and the reply starts once", async () => {
    const p = page();
    p.ask("t1");
    expect(p.claims).toHaveLength(1);
    // The resync after the reconnect asks again while the first claim still waits.
    p.ask("t1");
    expect(p.claims).toHaveLength(2);
    p.claims[1]?.answer(yes("r2"));
    await answered();
    expect(p.started).toEqual(["regenerate"]);
    // The first claim's answer arrives after all: a yes again, and nothing starts twice.
    p.claims[0]?.answer(yes("r1"));
    await answered();
    p.ask("t1");
    expect(p.claims).toHaveLength(2);
    expect(p.started).toEqual(["regenerate"]);
  });

  test("a claim that failed leaves the turn to the next ask", async () => {
    const p = page();
    p.ask("t1", "continue");
    p.claims[0]?.answer(lost("r1"));
    await answered();
    expect(p.started).toEqual([]);
    p.ask("t1", "continue");
    p.claims[1]?.answer(yes("r2"));
    await answered();
    expect(p.started).toEqual(["continue"]);
  });

  test("a page out of view claims nothing; a reply only Send can start is said once", async () => {
    const p = page();
    p.ask("t2", "send");
    p.ask("t2", "send");
    expect(p.claims).toHaveLength(0);
    expect(p.toasts).toEqual(["The engine is ready: press Send for the reply."]);
    p.hide();
    p.ask("t3");
    expect(p.claims).toHaveLength(0);
    p.stop();
  });
});
