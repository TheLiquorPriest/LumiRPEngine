// The Prompt page, read from its view as drawn: a mapped chat's parts with their kinds, the notices of a
// turn in the notices file's words, the front report, the old engines' blocks flagged, Lumiverse's clipping
// said, and the five edits sent as RPH takes them.

import { describe, expect, test } from "bun:test";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AppContext, type UiApp } from "../../src/ui/app";
import type { RpeClient } from "../../src/ui/client";
import { createGate } from "../../src/ui/gate";
import { parseNoticeLines } from "../../src/ui/notice-words";
import { PromptView, type PromptViewProps } from "../../src/ui/pages/prompt";
import { SliceTools } from "../../src/ui/pages/prompt/tools";
import type { PromptShown, SliceShown } from "../../src/ui/wanted";
import { settle } from "./asking";
import { openPage, PageEvent, type PageElement } from "./kept/dom";
import { CHAT } from "./recorded";
import { elements, expand, textOf } from "./vnodes";

const slice = (marker: string, over: Partial<SliceShown> = {}): SliceShown => ({ marker, kind: "instructions", line: `What ${marker} is.`, behaviour: "fixed", edited: false, text: `The words of ${marker}.`, length: 20, found: [{ message: 0, start: 0, end: 20 }], how: "signature", breakdown: "confirmed", ...over });

const SHOWN: PromptShown = {
  preset: { id: "preset-1", name: "Harbor preset", revision: "r2" },
  mapped: true,
  complete: true,
  turn: "turn-9",
  slices: [slice("preset.style", { kind: "style" }), slice("persona", { kind: "persona", edited: true, breakdown: "corrected", how: "block" })],
  unclaimed: [{ message: 2, start: 10, end: 30, text: "a stray line" }],
  notices: [{ kind: "changed", marker: "preset.style" }, { kind: "unclaimed", message: 2, start: 10, end: 30 }],
  front: { length: 4200, brokenBy: "persona" },
  clipped: { left: 3, reason: "context_size", turns: ["turn-8", "turn-9"] },
  old: [{ kind: "block", name: "RPEngine · world", in: "the main prompt" }, { kind: "outlet", name: "{{outlet::lre_state}}", in: "Scene block" }],
};

const LINES = parseNoticeLines("---\nformat: lines\n---\nnotice_changed: The text of {{marker}}, which the map says is fixed, has changed.\nnotice_unclaimed: Text that belongs to no part: in message[{{message}}], {{length}} characters.\ncut_clipped_context_size: {{count}} of the messages in the window are not in the prompt.\n");

function view(over: Partial<PromptViewProps> = {}) {
  const props: PromptViewProps = { shown: SHOWN, loading: false, problem: null, lines: LINES, history: { items: [], more: false, loading: false, problem: null, onOlder: () => undefined }, gateOpen: false, onOpenGate: () => undefined, onCloseGate: () => undefined, turn: null, onPickTurn: () => undefined, onOpenTurn: () => undefined, ...over };
  return expand(h(PromptView, props));
}

describe("the Prompt page", () => {
  test("a mapped chat lists its parts with their kinds and how each was found, its text only behind the gate", () => {
    const tree = view();
    const text = textOf(tree);
    expect(elements(tree).filter((e) => typeof e.props["data-slice"] === "string").map((e) => e.props["data-slice"])).toEqual(["preset.style", "persona"]);
    expect(text).toContain("Open the spoiler gate to read its text.");
    expect(text).toContain("20 characters, found by a signature of its text; the chat application's breakdown confirmed it.");
    expect(text).toContain("found by the chat application's block name; the chat application's breakdown corrected it.");
    expect(text).toContain("edited by you");
    expect(text).not.toContain("The words of persona.");
    expect(textOf(view({ gateOpen: true }))).toContain("The words of persona.");
  });

  test("the notices stand in the notices file's words, the front says which part broke it, and the old engines' blocks and Lumiverse's clipping are flagged", () => {
    const text = textOf(view());
    expect(text).toContain("The text of preset.style, which the map says is fixed, has changed.");
    expect(text).toContain("Text that belongs to no part: in message[2], 20 characters.");
    expect(text).toContain("The prompt's front held for 4,200 characters; persona broke it.");
    expect(text).toContain("3 of the messages in the window are not in the prompt.");
    expect(text).toContain("RPEngine · world");
    expect(text).toContain("{{outlet::lre_state}}");
    expect(text).toContain("RPE does not edit presets");
  });

  test("before a map is learned it says so, and shows the raw layout's parts", () => {
    const text = textOf(view({ shown: { ...SHOWN, mapped: false } }));
    expect(text).toContain("This preset has no prompt map yet");
    expect(text).toContain("preset.style");
  });
});

describe("the Prompt page's edits", () => {
  test("rename, line, kind, merge and split are each sent as RPH takes them, and a refusal is shown in its words", async () => {
    const sent: unknown[] = [];
    let refuse = false;
    const client = {
      call: ((_key: string, _params: unknown, options?: { body?: unknown }) => {
        sent.push(options?.body);
        return refuse ? Promise.reject(new Error("The map has no part called nowhere.")) : Promise.resolve(SHOWN);
      }) as RpeClient["call"],
    };
    const gate = createGate();
    gate.open(CHAT);
    const page = openPage();
    try {
      const root = page.document.createElement("div") as PageElement;
      const edited: PromptShown[] = [];
      await act(() => {
        render(h(AppContext.Provider, { value: { client, gate } as unknown as UiApp }, h(SliceTools, { chat: CHAT, slice: slice("persona"), all: SHOWN.slices, onEdited: (s) => edited.push(s) })), root as unknown as HTMLElement);
      });
      const click = async (label: string): Promise<void> => {
        const button = root.querySelectorAll("button").find((b) => b.textContent.trim() === label);
        if (button === undefined) throw new Error(`no button ${label}`);
        await act(() => button.click());
      };
      const type = async (selector: string, value: string): Promise<void> => {
        const field = root.querySelector(selector) as PageElement;
        field.value = value;
        await act(() => void field.dispatchEvent(new PageEvent("input")));
      };
      await click("Rename");
      await type("input", "persona.main");
      await click("Keep this edit");
      await act(() => settle());
      expect(sent.at(-1)).toEqual({ edit: "rename", marker: "persona", to: "persona.main" });
      expect(edited.length).toBe(1);
      refuse = true;
      await click("Correct its line");
      await type("textarea", "Who the player is.");
      await click("Keep this edit");
      await act(() => settle());
      expect(sent.at(-1)).toEqual({ edit: "line", marker: "persona", line: "Who the player is." });
      expect(root.textContent).toContain("The map was not changed");
      expect(root.textContent).toContain("The map has no part called nowhere.");
      await act(() => render(null, root as unknown as HTMLElement));
    } finally {
      page.close();
    }
  });
});
