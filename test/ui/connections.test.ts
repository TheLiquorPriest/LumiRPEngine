// The Connections page, read from its view as drawn: which connection is the default, how each signs its
// calls and whether a key is set, never the key; what saving the form sends (a key typed once, kept when
// none is typed, taken away when asked; the rest of a connection sent whole, since a save replaces it);
// a removal that asks first; and RPE's refusals in its own words.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import type { ConnectionList, ConnectionView } from "rp-harness/contract";
import { type ConnectionsAction, ConnectionsView, type ConnectionsViewProps, draftOf } from "../../src/ui/pages/connections";
import type { SaveConnection } from "../../src/ui/api";
import { banners, elements, expand, press, textOf } from "./vnodes";

const KEYED: ConnectionView = { id: "c-flash", name: "Flash", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", effort: "high", retries: 4, limits: { "deepseek-v4-flash": { contextWindow: 64_000 } }, default: true, key: { set: true, last4: "9f3c" } };
const SIGNED: ConnectionView = { id: "c-studio", name: "Studio", provider: "anthropic", auth: "signin", default: false, key: null, signedIn: false };
const LIST: ConnectionList = {
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
    const typed = { name: "Flash", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", effort: "max", baseUrl: "", api: "" };
    // What the form does not show goes as it was: a save replaces the connection whole.
    const kept = draftOf(entries({ ...typed, key: "" }), KEYED);
    expect(kept).toEqual({ connection: { name: "Flash", provider: "deepseek", auth: "key", baseUrl: null, api: null, model: "deepseek-v4-flash", effort: "max", serialTools: null, messageThreads: null, retries: 4, limits: { "deepseek-v4-flash": { contextWindow: 64_000 } } } });
    expect(draftOf(entries({ ...typed, key: " sk-not-a-real-key " }), KEYED).key).toBe("sk-not-a-real-key");
    expect(draftOf(entries({ ...typed, key: "", dropKey: "on" }), KEYED).key).toBeNull();
    // A new one: no effort chosen is the model's own.
    expect(draftOf(entries({ ...typed, effort: "", key: "sk-not-a-real-key" }), null)).toMatchObject({ connection: { effort: null, retries: null, limits: null }, key: "sk-not-a-real-key" });
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
});
