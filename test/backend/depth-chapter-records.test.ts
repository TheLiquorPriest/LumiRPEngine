// The bootstrap's chapter re-read (DEPTH-PLAN §5.2, §8.1 step 5) writes its drift checks and
// predictions as the author's records after the revision that closes the chapter, as a live
// reflection does: a prediction from the chapter with an id the poll scores it by, never a file of the
// notebook; the player character has no arc to drift from.

import { describe, expect, test } from "bun:test";
import type { LedgerEvent } from "../../src/shared/ledger";
import { AUTHOR_DRIFT, AUTHOR_PREDICT, predictionId } from "../../src/shared/author";
import { createRegistry } from "../../src/engine/registry-impl";
import { notebookOf } from "../../src/engine/notebook";
import { ALL_PACKS } from "../../src/packs/index";
import { authorChapter } from "../../src/backend/depth/notebook";
import type { ModelPort } from "../../src/backend/depth/port";
import { modernUsWorld } from "../packs/riverton";
import { fold, startState } from "../packs/support";

describe("a chapter's re-read", () => {
  test("lands its drift checks and predictions as the author's records after the revision that closes the chapter", async () => {
    const reg = createRegistry(ALL_PACKS);
    const w = modernUsWorld("w", "R");
    const s = startState(w);
    const asked: string[] = [];
    const model: ModelPort = async (_role, messages) => {
      asked.push(messages.map((m) => m.content).join("\n"));
      return {
        text: JSON.stringify({
          files: [{ path: "notebook/arcs/maya.md", text: "Maya: from the till to the truth." }],
          drift: [
            { who: "maya", drift: "some", note: "Warier than her arc." },
            { who: w.pov, drift: "strong", note: "not his" },
            { who: "nobody", drift: "none", note: "" },
          ],
          predictions: [{ text: "Maya puts the money back.", about: ["maya"] }, { text: "" }],
        }),
      };
    };
    const out = await authorChapter({ world: w, state: s, texts: {}, chapter: { index: 0, title: "The register", through: "m2" }, beats: [], notebook: { files: {}, pinned: [] }, cast: [{ id: "maya", name: "Maya", card: true, mind: true }] }, model);
    expect(asked[0]).not.toContain("notebook/predictions.md");
    expect(out.events.map((e) => e.type)).toEqual(["engine.ws.write", "engine.notebook", AUTHOR_DRIFT, AUTHOR_PREDICT]);
    expect(out.events[2]?.data).toEqual({ who: "maya", drift: "some", note: "Warier than her arc." });
    expect(out.events[3]?.data).toEqual({ id: predictionId("chapter", "0", "m2", "0"), text: "Maya puts the money back.", about: ["maya"], from: "chapter" });
    // They fold beside the revision, which closes the chapter.
    expect(notebookOf(fold(reg, w, s, out.events as LedgerEvent[])).chapters.map((c) => c.title)).toEqual(["The register"]);
  });
});
