// Player claims' control (DESIGN §9.4) in its three places, each round-tripping through the
// backend: Settings → Realism saves the user's policy for new chats, GM → This chat → Realism
// changes the running chat's with a `claims` marker, and Build's Realism defaults commit the
// world's, which a new chat then plays by. The controls are walked as rendered trees (no DOM),
// their buttons and switches pressed through the props the screen hands them.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { FieldInput, type FormCtx } from "../../src/frontend/build/schema-form";
import { PART_SPECS } from "../../src/frontend/build/schema";
import { HostSwitch, Seg } from "../../src/frontend/components";
import { chatClaimsChange, ClaimsControl, RealismSeed } from "../../src/frontend/settings/realism";
import type { ClaimsPolicy } from "../../src/shared/claims";
import type { JsonObject, JsonValue } from "../../src/shared/json";
import type { UserSettings } from "../../src/shared/settings";
import type { WorldDoc } from "../../src/shared/world";
import { Rig } from "../support/rig";
import { expand, labelled, press, propsOf } from "../support/tree";

const MODE = "When you say you have something the world doesn't";
const CAP = "Ask first above the world's claim cap";

/** What a press on the claims control in `tree` hands its screen: a mode picked, or the cap switched. */
function pick(tree: unknown, control: "mode" | "cap", value: string | boolean): ClaimsPolicy {
  const props = propsOf(tree, ClaimsControl)[0];
  if (!props) throw new Error("no claims control");
  let picked: ClaimsPolicy | null = null;
  const rendered = ClaimsControl({ ...(props as Parameters<typeof ClaimsControl>[0]), onChange: (next) => (picked = next) });
  press(control === "mode" ? labelled(rendered, Seg, MODE) : labelled(rendered, HostSwitch, CAP), value);
  if (!picked) throw new Error("the control handed nothing on");
  (props.onChange as (next: ClaimsPolicy) => void)(picked);
  return picked;
}

describe("the player claims control", () => {
  test("Settings → Realism saves the user's policy for new chats, and a preset picked there sets its own", async () => {
    const rig = new Rig();
    const settings = async (): Promise<UserSettings> => rig.body(await rig.send({ type: "lre.settings.get" })).settings as UserSettings;
    const save = async (press: (tree: unknown) => void): Promise<UserSettings> => {
      let patch: JsonObject | null = null;
      press(RealismSeed({ realism: (await settings()).realism, overrideWorld: false, busy: false, patch: (p) => (patch = p) }));
      if (!patch) throw new Error("nothing saved");
      return rig.body(await rig.send({ type: "lre.settings.set", patch })).settings as UserSettings;
    };
    expect((await settings()).realism.claims).toEqual({ mode: "real", capped: false });
    const asked = await save((tree) => pick(tree, "mode", "ask"));
    expect([asked.realism.preset, asked.realism.claims]).toEqual(["custom", { mode: "ask", capped: false }]);
    await save((tree) => pick(tree, "mode", "real"));
    const capped = await save((tree) => pick(tree, "cap", true));
    expect(capped.realism.claims).toEqual({ mode: "real", capped: true });
    // A restart reads the saved policy back.
    expect((rig.body(await rig.restart().send({ type: "lre.settings.get" })).settings as UserSettings).realism.claims).toEqual({ mode: "real", capped: true });
    const simulation = await save((tree) => press(labelled(tree, Seg, "Realism preset"), "simulation"));
    expect(simulation.realism.claims).toEqual({ mode: "ask", capped: true });
  });

  test("GM → This chat → Realism changes the running chat's policy with a marker; picking the one in force sends nothing", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    await rig.turn(chatId, "I look around.", "The street is quiet.");
    const claims = async (): Promise<ClaimsPolicy | undefined> => (await rig.rt.view(chatId, rig.host.userId)).controls?.realism.claims;
    const before = await claims();
    if (!before) throw new Error("no controls");
    let next: ClaimsPolicy | null = null;
    pick(h(ClaimsControl, { value: before, onChange: (p: ClaimsPolicy) => (next = p) }), "mode", "hold");
    if (!next) throw new Error("nothing picked");
    const change = chatClaimsChange(chatId, before, next);
    if (!change) throw new Error("no marker");
    rig.body(await rig.send(change));
    expect(await claims()).toEqual({ mode: "hold", capped: before.capped });
    expect(chatClaimsChange(chatId, { mode: "hold", capped: before.capped }, { mode: "hold", capped: before.capped })).toBeNull();
  });

  test("Build's Realism defaults commit the world's policy, which a new chat plays by over the user's", async () => {
    const rig = new Rig();
    const worldId = await rig.newWorld();
    const draft = rig.body(await rig.send({ type: "lre.editor", op: "get", worldId, base: null }));
    const doc = draft.draft as WorldDoc;
    const spec = PART_SPECS.realism.find((s) => s.kind === "claims");
    if (!spec) throw new Error("Build's Realism defaults have no claims field");
    const ctx: FormCtx = { doc, lint: [], path: "realism", identifiers: [], functions: [] };
    let realism = structuredClone(doc.realism) as unknown as JsonObject;
    const field = () => FieldInput({ spec, value: realism.claims, ctx, path: "realism", parent: realism, onChange: (v: JsonValue | undefined) => (realism = withClaims(realism, v)) });
    expect(realism.claims).toBeUndefined();
    // Switched on, the world starts from what its realism preset plays claims by.
    press(labelled(expand(field()), HostSwitch, "This world sets what new chats make of them"), true);
    expect(realism.claims).toEqual({ mode: "real", capped: false });
    pick(expand(field()), "mode", "ask");
    expect(realism.claims).toEqual({ mode: "ask", capped: false });
    rig.body(await rig.send({ type: "lre.editor", op: "set", worldId, base: draft.base, part: "realism", value: realism }));
    rig.body(await rig.send({ type: "lre.world", op: "commit", worldId, base: draft.base }));
    const chatId = rig.host.createChat("Morning, Sam.");
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId, chatId }));
    expect((await rig.rt.view(chatId, rig.host.userId)).controls?.realism.claims).toEqual({ mode: "ask", capped: false });
  });
});

/** The realism part with its claims set, or gone when the switch is off. */
function withClaims(realism: JsonObject, claims: JsonValue | undefined): JsonObject {
  const { claims: _old, ...rest } = realism;
  return claims === undefined ? rest : { ...rest, claims };
}
