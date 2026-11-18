// The minds screens that remain (DESIGN §24): Play → What you know, and Build → World → Minds saving its defaults as no config.

import { describe, expect, test } from "bun:test";
import { Badge, Empty } from "../../src/frontend/components";
import { ActionRow } from "../../src/frontend/gm/ui";
import type { PanelProps } from "../../src/frontend/registry";
import { decodeKnownView, KnownPanel } from "../../src/packs/minds/ui/known";
import { mindsPartValue } from "../../src/frontend/build/minds-editor";
import type { KnownItem, WorldMindsConfig } from "../../src/shared/minds";
import { DEFAULT_WORLD_MINDS } from "../../src/shared/minds";
import { propsOf } from "../support/tree";

describe("Play → What you know", () => {
  const item = { key: "known_marina", claim: "Marcus Delgado owes the marina three months' rent", how: "told", byName: "Priya Nair", sinceText: "Tue 07:42", belief: "uncertain", confidence: 0.4, suspicion: true, open: false, keptFrom: ["Danny Okafor"] } satisfies KnownItem;
  const panel = (view: PanelProps["view"]) => KnownPanel({ chatId: "chat", view } as PanelProps);

  test("it shows the view's holdings as given, and says so when the chat doesn't track knowledge", () => {
    expect(decodeKnownView({ tracking: true, items: [item] })).toEqual({ tracking: true, items: [item] });
    const off = panel({ tracking: false, items: [] });
    expect(propsOf(off, Empty).map((p) => p.title)).toEqual(["Knowledge tracking is off for this chat"]);
    expect(propsOf(panel({ tracking: true, items: [] }), Empty).map((p) => p.children)).toEqual(["You haven't learned anything the story tracks yet."]);
    const on = panel({ tracking: true, items: [item] });
    expect(propsOf(on, ActionRow).map((p) => [p.title, p.subtitle])).toEqual([[item.claim, "Told by Priya Nair · Tue 07:42"]]);
    expect(propsOf(on, Badge).map((p) => p.children)).toEqual(["Suspicion", "Unsure"]);
  });
});

describe("Build → World → Minds", () => {
  test("the defaults save as no config; anything else saves whole, an unset selector left out", () => {
    expect(mindsPartValue(structuredClone(DEFAULT_WORLD_MINDS) as WorldMindsConfig)).toEqual({});
    const edited: WorldMindsConfig = { ...structuredClone(DEFAULT_WORLD_MINDS), secrecy: "brief", always: { tag: ["lead"] } } as WorldMindsConfig;
    const value = mindsPartValue(edited);
    expect(value.secrecy).toBe("brief");
    expect(value.always).toEqual({ tag: ["lead"] });
    expect("never" in value).toBe(false);
  });
});
