// Build's secrecy page (DESIGN §4.2), drawn from a book's real move as the backend answers it, with no
// DOM: at each step the page marks the step the book is at and ticks those before it, lists the
// entries LumiRPEngine switched off, and offers only the presses that step takes, Restore asking first.

import { describe, expect, test } from "bun:test";
import type { HostBookEntryInput } from "../../src/backend/host";
import { MoveSteps, MoveView } from "../../src/frontend/build/lore-secrecy";
import { Button } from "../../src/frontend/components";
import { ActionRow } from "../../src/frontend/gm/ui";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import type { SecrecyBookPlan } from "../../src/shared/protocol";
import { Rig } from "../support/rig";

const DEBT = "Marcus owes the bank four thousand dollars on the shop.";
const SECRET = { secret: true, gate: "stage.shop_debt == 'out'", holders: ["marcus"] };

const entry = (comment: string, over: Partial<HostBookEntryInput>): HostBookEntryInput => ({ comment, content: DEBT, keys: ["shop"], disabled: true, constant: false, position: 0, depth: 4, role: null, order: 100, extensions: {}, ...over });

interface Drawn {
  type: unknown;
  props: Record<string, unknown>;
}

/** Every element of a drawn tree, through each element's props (its children, a banner's actions, a row's title), components left undrawn. */
function elements(node: unknown): Drawn[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (typeof node !== "object" || node === null || !("type" in node) || !("props" in node)) return [];
  const drawn = node as Drawn;
  return [drawn, ...Object.values(drawn.props).flatMap(elements)];
}

/** A book with a secret LumiRPEngine stored off, and its twin, which was on before: preview, then each step in turn. */
async function moves(): Promise<{ rig: Rig; legacy: SecrecyBookPlan; applied: SecrecyBookPlan; confirmed: SecrecyBookPlan; restored: SecrecyBookPlan }> {
  const rig = new Rig();
  const user = rig.host.userId;
  const bookId = await rig.host.books.create("Port Alder notes", "", user);
  const debt = await rig.host.books.createEntry(bookId, entry("The shop debt", { extensions: { [LEDGER_NAMESPACE]: { lore: SECRET } } }), user);
  await rig.host.books.createEntry(bookId, entry("The shop debt (card copy)", { extensions: { [LEDGER_NAMESPACE]: { lore: SECRET, secretCopyOf: { entry: `${bookId}/${debt}`, off: false, fields: null } } } }), user);
  const step = async (request: Record<string, unknown>): Promise<SecrecyBookPlan> => rig.body(await rig.send({ type: "lre.secrecy", bookId, ...request })).book as SecrecyBookPlan;
  const legacy = await step({ op: "preview" });
  const applied = await step({ op: "apply", version: legacy.version });
  const confirmed = await step({ op: "confirm", version: applied.version });
  const restored = await step({ op: "restore", version: confirmed.version });
  return { rig, legacy, applied, confirmed, restored };
}

/** The page's view of `plan`: the steps as marked, the entries listed as switched off, and what each press it offers asks for. */
function shown(plan: SecrecyBookPlan, asking = false): { steps: unknown[]; off: unknown[]; presses: string[] } {
  const presses: string[] = [];
  const tree = MoveView({ plan, nameOf: (id) => (id === "marcus" ? "Marcus" : id), bookName: () => "Port Alder notes", busy: false, asking, onStep: (s) => presses.push(s), onAsk: (open) => presses.push(open ? "ask" : "cancel") });
  const at = elements(tree).find((e) => e.type === MoveSteps)?.props.at as 0 | 1 | 2 | 3 | undefined;
  const steps = at === undefined ? [] : elements(MoveSteps({ at })).flatMap((e) => (e.type === "li" ? [e.props["data-lre-step"]] : []));
  const group = elements(tree).find((e) => e.type === "div" && e.props["data-lre-secrecy-off"] !== undefined);
  const off = elements(group).flatMap((e) => (e.type === ActionRow ? [e.props.title] : []));
  for (const button of elements(tree)) if (button.type === Button && button.props.disabled !== true) (button.props.onClick as () => void)();
  return { steps, off, presses };
}

describe("Build's secrecy page", () => {
  test("before the move: looking is done, Apply is the step at hand, and the entry LRE switched off is listed to stay off", async () => {
    const { legacy } = await moves();
    expect(shown(legacy)).toEqual({ steps: ["done", "now", "next"], off: ["The shop debt"], presses: ["apply"] });
  });

  test("once applied: the check is the step at hand, offering Confirm and Restore, with the entry still off listed", async () => {
    const { applied } = await moves();
    expect(shown(applied)).toEqual({ steps: ["done", "done", "now"], off: ["The shop debt"], presses: ["confirm", "ask"] });
  });

  test("Restore asks first, and only Restore or Cancel can be pressed while it asks", async () => {
    const { applied, confirmed } = await moves();
    expect(shown(applied, true).presses).toEqual(["restore", "cancel"]);
    expect(shown(confirmed, true).presses).toEqual(["restore", "cancel"]);
  });

  test("once confirmed every step is done, and Restore still stands; once restored the book can be moved again", async () => {
    const { confirmed, restored } = await moves();
    expect(shown(confirmed)).toEqual({ steps: ["done", "done", "done"], off: ["The shop debt"], presses: ["ask"] });
    expect(shown(restored)).toEqual({ steps: ["done", "now", "next"], off: ["The shop debt"], presses: ["apply"] });
  });
});
