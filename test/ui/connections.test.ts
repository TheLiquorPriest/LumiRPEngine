// The Connections page, read from its view as drawn: which connection is the default, how each signs its
// calls and whether a key is set, never the key; its model's limits and where each comes from; what
// saving the form sends (a key typed once, kept when none is typed, taken away when asked; the user's own
// limits for its model; the rest of a connection sent whole, since a save replaces it); a test of a
// connection and what came of it; a removal that asks first; and RPE's refusals in its own words.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { type ConnectionsAction, ConnectionsView, type ConnectionsViewProps, draftOf, testConnection } from "../../src/ui/pages/connections";
import type { ConnectionShown, ConnectionsShown, SaveConnection } from "../../src/ui/api";
import { duration } from "../../src/ui/words";
import { askingClient, settle } from "./asking";
import { banners, elements, expand, press, textOf } from "./vnodes";

const KEYED: ConnectionShown = { id: "c-flash", name: "Flash", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", effort: "high", retries: 4, limits: { "deepseek-v4-flash": { contextWindow: 64_000 } }, default: true, key: { set: true }, limitsInForce: { contextWindow: { tokens: 64_000, from: "user" }, maxTokens: { tokens: 8_192, from: "pi" } } };
const SIGNED: ConnectionShown = { id: "c-studio", name: "Studio", provider: "anthropic", auth: "signin", default: false, key: null, signedIn: false, limitsInForce: null };
const LIST: ConnectionsShown = {
  connections: [KEYED, SIGNED],
  default: "c-flash",
  providers: [
    { id: "deepseek", name: "DeepSeek", auth: ["key"], apis: [], needsBaseUrl: false },
    { id: "anthropic", name: "Anthropic", auth: ["key", "signin"], apis: [], needsBaseUrl: false },
  ],
};

function view(over: Partial<ConnectionsViewProps> = {}) {
  const asked: unknown[] = [];
  const props: ConnectionsViewProps = {
    list: LIST,
    loading: false,
    problem: null,
    action: { kind: "none" },
    saving: false,
    refusal: null,
    onAction: (action: ConnectionsAction) => asked.push(action),
    onSave: (save: SaveConnection, id: string | null) => asked.push({ save, id }),
    onRemove: (id) => asked.push({ remove: id }),
    onDefault: (id) => asked.push({ default: id }),
    tests: {},
    onTest: (id) => asked.push({ test: id }),
    ...over,
  };
  const tree = expand(h(ConnectionsView, props));
  return { tree, text: textOf(tree), asked };
}

const entries = (fields: Record<string, string>): [string, string][] => Object.entries(fields);

describe("the Connections page", () => {
  test("it says which connection is the default and how each signs its calls, and shows no key", () => {
    const { tree, text, asked } = view();
    expect(text).toContain("Flashdefault");
    expect(text).toContain("deepseek · deepseek-v4-flash · thinks at high");
    expect(text).toContain("A key is set.");
    expect(text).toContain("Not signed in to its provider.");
    expect(text).not.toContain("9f3c");
    // Only the connection that is not the default offers to become it.
    press(tree, "Make it the default");
    expect(asked).toEqual([{ default: "c-studio" }]);
  });

  test("the form to change a connection starts with its values and an empty key field; a key typed is sent, none typed keeps it, and one can be taken away", () => {
    const { tree, text } = view({ action: { kind: "form", id: "c-flash" } });
    const inputs = elements(tree).filter((e) => e.type === "input");
    expect(inputs.find((e) => e.props.name === "name")?.props.defaultValue).toBe("Flash");
    expect(inputs.find((e) => e.props.name === "key")?.props).toMatchObject({ type: "password", defaultValue: "" });
    expect(text).not.toContain("9f3c");
    // Each select starts at the connection's own choice, so a save that does not touch it keeps it.
    const chosen = (select: string): unknown[] => elements(elements(tree).find((e) => e.type === "select" && e.props.name === select)?.props.children).filter((e) => e.type === "option" && e.props.selected === true).map((e) => e.props.value);
    expect([chosen("provider"), chosen("auth"), chosen("effort")]).toEqual([["deepseek"], ["key"], ["high"]]);
    // The user's own limits for its model start as they are set.
    expect([inputs.find((e) => e.props.name === "contextWindow")?.props.defaultValue, inputs.find((e) => e.props.name === "maxTokens")?.props.defaultValue]).toEqual(["64000", ""]);
    const typed = { name: "Flash", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", effort: "max", baseUrl: "", api: "", contextWindow: "64000", maxTokens: "" };
    // What the form does not show goes as it was: a save replaces the connection whole.
    const kept = draftOf(entries({ ...typed, key: "" }), KEYED);
    expect(kept).toEqual({ connection: { name: "Flash", provider: "deepseek", auth: "key", baseUrl: null, api: null, model: "deepseek-v4-flash", effort: "max", serialTools: null, messageThreads: null, retries: 4, limits: { "deepseek-v4-flash": { contextWindow: 64_000 } } } });
    // A limit typed sets the user's own for the model, both left empty take them away, and another model's stay as they were.
    expect(draftOf(entries({ ...typed, key: "", maxTokens: "4096" }), KEYED).connection.limits).toEqual({ "deepseek-v4-flash": { contextWindow: 64_000, maxTokens: 4096 } });
    expect(draftOf(entries({ ...typed, key: "", contextWindow: "" }), KEYED).connection.limits).toBeNull();
    expect(draftOf(entries({ ...typed, key: "", contextWindow: "", model: "deepseek-v4-pro" }), KEYED).connection.limits).toEqual({ "deepseek-v4-flash": { contextWindow: 64_000 } });
    expect(draftOf(entries({ ...typed, key: " sk-not-a-real-key " }), KEYED).key).toBe("sk-not-a-real-key");
    expect(draftOf(entries({ ...typed, key: "", dropKey: "on" }), KEYED).key).toBeNull();
    // A new one: no effort chosen is the model's own, and no limit typed sets none of the user's own.
    expect(draftOf(entries({ ...typed, effort: "", contextWindow: "", key: "sk-not-a-real-key" }), null)).toMatchObject({ connection: { effort: null, retries: null, limits: null }, key: "sk-not-a-real-key" });
  });

  test("removing asks first, and RPE's refusal is shown in its words, in the form when one is open", () => {
    const listed = view();
    const removes = elements(listed.tree).filter((e) => e.type === "button" && textOf(e.props.children) === "Remove");
    (removes[1]?.props.onClick as () => void)();
    expect(listed.asked).toEqual([{ kind: "remove", id: "c-studio" }]);
    const asking = view({ action: { kind: "remove", id: "c-studio" } });
    expect(asking.text).toContain("Remove Studio?");
    press(asking.tree, "Remove it");
    press(asking.tree, "Keep it");
    expect(asking.asked).toEqual([{ remove: "c-studio" }, { kind: "none" }]);
    const refusal = "A connection needs a name.";
    expect(banners(view({ refusal }).tree)).toEqual([{ title: "RPE did not make that change", text: `RPE did not make that change${refusal}` }]);
    expect(banners(view({ refusal, action: { kind: "form", id: null } }).tree).map((b) => b.title)).toEqual(["RPE did not save it"]);
  });

  test("each connection shows its model's limits and where each comes from; a test says how long it took and which model answered, or the provider's words", async () => {
    const listed = view();
    expect(textOf(elements(listed.tree).find((e) => e.props["data-limits"] === "c-flash")?.props.children)).toBe("Context window: 64,000 tokens, yours · Longest reply: 8,192 tokens, as pi lists it.");
    expect(textOf(elements(listed.tree).find((e) => e.props["data-limits"] === "c-studio")?.props.children)).toBe("Context window: not known · Longest reply: not known.");
    const flash = elements(listed.tree).find((e) => e.props["data-connection"] === "c-flash");
    press(flash, "Test it");
    expect(listed.asked).toEqual([{ test: "c-flash" }]);
    const answered = view({ tests: { "c-flash": { busy: false, tested: { ok: true, ms: 840, model: "deepseek-v4-flash", limits: { contextWindow: { tokens: 128_000, from: "pi" }, maxTokens: null } }, problem: null } } });
    expect(answered.text).toContain(`It answered in ${duration(840)}, as deepseek-v4-flash. Context window: 128,000 tokens, as pi lists it · Longest reply: not known.`);
    const refused = view({ tests: { "c-studio": { busy: false, tested: { ok: false, ms: 120, error: "401: the key (the key) is not valid.", limits: null }, problem: null } } });
    expect(banners(refused.tree)).toEqual([{ title: "It did not answer", text: `It did not answer401: the key (the key) is not valid. (${duration(120)})` }]);
    // The test calls its route for the connection; RPE's own refusal is said in its words.
    const { client, asked } = askingClient();
    const done = testConnection(client, "c-flash");
    expect(asked.map((a) => [a.key, a.params])).toEqual([["POST /api/v1/connections/:id/test", { id: "c-flash" }]]);
    asked[0]?.fail(new Error("RPE has no connection c-flash."));
    await settle();
    expect(await done).toEqual({ busy: false, tested: null, problem: "RPE has no connection c-flash." });
  });
});
