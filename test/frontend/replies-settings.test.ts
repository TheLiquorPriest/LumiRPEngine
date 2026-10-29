// Settings → Changes from the reply (D4 learning, DESIGN §11; AGENT-LOOP-PLAN §6): each type's row shows
// its mode, where that mode comes from, and Unpin once pinned. The GM assistant's change types read as
// its role learned them on its connection, through the real settings store, apart from the reply's
// types, which keep their own per-connection learning.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { recordOutcome } from "../../src/backend/settings-store";
import { Button, Seg } from "../../src/frontend/components";
import { ExtractionPage, modeSource } from "../../src/frontend/settings/replies";
import type { JsonObject } from "../../src/shared/json";
import type { ExtractionModeView, SettingsResult } from "../../src/shared/protocol";
import { EXTRACTION_LEARNING } from "../../src/shared/settings";
import { Rig } from "../support/rig";
import { propsOf, type Props } from "../support/tree";

const DEEPSEEK = { id: "deepseek", name: "Deepseek" };

/** One type's row as the page lays it out: the props it was given, and the row rendered. */
function row(tree: unknown, type: string): { props: Props; out: unknown } {
  const found: { props: Props; out: unknown }[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object" || !("props" in node)) return;
    const v = node as VNode<Props>;
    if (typeof v.type === "function" && v.props.type === type && v.props.view !== undefined) found.push({ props: v.props, out: (v.type as (p: Props) => unknown)(v.props) });
    walk(v.props.children);
  };
  walk(tree);
  const [one] = found;
  if (found.length !== 1 || !one) throw new Error(`${found.length} rows for ${type}`);
  return one;
}

/** The page as the backend's settings make it, and the patches its controls send. */
async function page(rig: Rig): Promise<{ tree: unknown; patches: JsonObject[] }> {
  const data = rig.body(await rig.send({ type: "lre.settings.get" })) as unknown as SettingsResult;
  const patches: JsonObject[] = [];
  return { tree: ExtractionPage({ data, patch: (p) => void patches.push(p), busy: false }), patches };
}

describe("Settings → Changes from the reply: the GM assistant's changes", () => {
  test("each shows its mode as the assistant's role learned it on its connection, where it came from, and Unpin once pinned", async () => {
    const rig = new Rig();
    rig.host.activeConnection = DEEPSEEK;
    const user = rig.host.userId;
    // The assistant's money adjustments applied often enough to learn them, on the user's default connection, which it runs on.
    const settings = await rig.rt.settings.get(user);
    const learning = await rig.rt.settings.learningOf(user);
    for (let i = 0; i < EXTRACTION_LEARNING.minProposals; i++) recordOutcome(settings, learning, DEEPSEEK.id, "money_adjust", "accepted", i, "assistant");
    await rig.rt.settings.saveLearning(user);

    const learned = await page(rig);
    const money = row(learned.tree, "money_adjust");
    const view: ExtractionModeView = { mode: "auto", source: "learned", connection: DEEPSEEK, accepted: EXTRACTION_LEARNING.minProposals, rejected: 0 };
    expect([money.props.view, money.props.agent]).toEqual([view, true]);
    expect(propsOf(money.out, Seg).map((p) => p.value)).toEqual(["auto"]);
    expect(modeSource(view)).toBe(`Learned on Deepseek (${EXTRACTION_LEARNING.minProposals} kept, 0 rejected)`);
    expect(propsOf(money.out, "span").some((p) => p.children === modeSource(view))).toBe(true);
    expect(propsOf(money.out, Button)).toEqual([]);
    // A type it hasn't learned keeps its default; the reply's own types hold none of the assistant's learning.
    expect(row(learned.tree, "despawn").props.view).toEqual({ mode: "confirm", source: "default", connection: DEEPSEEK, accepted: 0, rejected: 0 });
    expect(row(learned.tree, "purchase").props.view).toMatchObject({ source: "default", accepted: 0, rejected: 0 });

    // Pinned, it says so and offers Unpin, which sends null for it, so learning decides it again.
    rig.body(await rig.send({ type: "lre.settings.set", patch: { extraction: { money_adjust: { mode: "never" } } } }));
    const after = await page(rig);
    const pinned = row(after.tree, "money_adjust");
    expect(pinned.props.view).toMatchObject({ mode: "never", source: "pinned" });
    expect(propsOf(pinned.out, Seg).map((p) => p.value)).toEqual(["never"]);
    const unpin = propsOf(pinned.out, Button).find((p) => p.children === "Unpin");
    if (typeof unpin?.onClick !== "function") throw new Error("no Unpin");
    unpin.onClick();
    expect(after.patches).toEqual([{ extraction: { money_adjust: null } }]);
  });
});
