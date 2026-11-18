// The Connections page, read from its view as drawn: which connection is the default, how each signs its
// calls and whether a key is set, never the key; its model's limits and where each comes from; what
// saving the form sends (a key typed once, kept when none is typed, taken away when asked; the user's own
// limits for its model; the rest of a connection sent whole, since a save replaces it); a test of a
// connection and what came of it; a removal that asks first; and RPE's refusals in its own words.

import { describe, expect, test } from "bun:test";
import { h } from "preact";
import { type ConnectionsAction, ConnectionsView, type ConnectionsViewProps, draftOf, limitsWords, testConnection } from "../../src/ui/pages/connections/index";
import { NO_SIGNIN, SignInPanel, signInCalls, signInSteps, signInWords } from "../../src/ui/pages/connections/signin";
import type { ConnectionShown, ConnectionsShown, SaveConnection } from "../../src/shared/api";
import { duration } from "../../src/ui/words";
import { SettingName } from "../../src/ui/pages/settings/names";
import { askingClient, settle } from "./asking";
import { banners, elements, expand, press, type Stand, textOf } from "./vnodes";

/** The setting's name is read through the app's settings route, which the view's expansion has no app for: it is drawn as its key here. */
const STAND: Stand = new Map([[SettingName, (props) => props.settingKey]]);

const KEYED: ConnectionShown = { id: "c-flash", name: "Flash", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", effort: "high", retries: 4, limits: { "deepseek-v4-flash": { contextWindow: 64_000 } }, default: true, key: { set: true }, limitsInForce: { contextWindow: { tokens: 64_000, from: "user" }, maxTokens: { tokens: 8_192, from: "pi" }, pictures: null, asked: ["pictures"] } };
const SIGNED: ConnectionShown = { id: "c-studio", name: "Studio", provider: "anthropic", auth: "signin", default: false, key: null, signedIn: false, limitsInForce: null };
const LIST: ConnectionsShown = {
  connections: [KEYED, SIGNED],
  default: "c-flash",
  providers: [
    { id: "deepseek", name: "DeepSeek", auth: ["key"], apis: [], needsBaseUrl: false, embeds: true },
    { id: "anthropic", name: "Anthropic", auth: ["key", "signin"], apis: [], needsBaseUrl: false, embeds: false },
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
    signIn: () => ({ shown: undefined, start: (id) => asked.push({ signInStart: id }), code: () => undefined, finish: (id, code) => asked.push({ signInFinish: id, code }), cancel: (id) => asked.push({ signInCancel: id }), out: (id) => asked.push({ signInOut: id }) }),
    ...over,
  };
  const tree = expand(h(ConnectionsView, props), STAND);
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
    const typed = { name: "Flash", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", effort: "max", baseUrl: "", api: "", retries: "4", contextWindow: "64000", maxTokens: "" };
    // A save replaces the connection whole: what the form shows starts as it is, and goes as the form leaves it.
    const kept = draftOf(entries({ ...typed, key: "" }), KEYED);
    expect(kept).toEqual({ connection: { name: "Flash", provider: "deepseek", auth: "key", baseUrl: null, api: null, model: "deepseek-v4-flash", effort: "max", serialTools: null, messageThreads: null, retries: 4, limits: { "deepseek-v4-flash": { contextWindow: 64_000 } } } });
    // A limit typed sets the user's own for the model, both left empty take them away, and another model's stay as they were.
    expect(draftOf(entries({ ...typed, key: "", maxTokens: "4096" }), KEYED).connection.limits).toEqual({ "deepseek-v4-flash": { contextWindow: 64_000, maxTokens: 4096 } });
    expect(draftOf(entries({ ...typed, key: "", contextWindow: "" }), KEYED).connection.limits).toBeNull();
    expect(draftOf(entries({ ...typed, key: "", contextWindow: "", model: "deepseek-v4-pro" }), KEYED).connection.limits).toEqual({ "deepseek-v4-flash": { contextWindow: 64_000 } });
    expect(draftOf(entries({ ...typed, key: " sk-not-a-real-key " }), KEYED).key).toBe("sk-not-a-real-key");
    expect(draftOf(entries({ ...typed, key: "", dropKey: "on" }), KEYED).key).toBeNull();
    // A new one: no effort chosen is the model's own, and no retries or limit typed sets none of the connection's own.
    expect(draftOf(entries({ ...typed, effort: "", retries: "", contextWindow: "", key: "sk-not-a-real-key" }), null)).toMatchObject({ connection: { effort: null, retries: null, limits: null }, key: "sk-not-a-real-key" });
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
    expect(textOf(elements(listed.tree).find((e) => e.props["data-limits"] === "c-flash")?.props.children)).toBe("Context window: 64,000 tokens, yours · Longest reply: 8,192 tokens, as pi lists it · Audio: not said, so it is sent · Video: not said, so it is sent.");
    expect(textOf(elements(listed.tree).find((e) => e.props["data-limits"] === "c-studio")?.props.children)).toBe("Context window: not known · Longest reply: not known · Audio: not said, so it is sent · Video: not said, so it is sent.");
    const flash = elements(listed.tree).find((e) => e.props["data-connection"] === "c-flash");
    press(flash, "Test it");
    expect(listed.asked).toEqual([{ test: "c-flash" }]);
    const answered = view({ tests: { "c-flash": { busy: false, tested: { ok: true, ms: 840, model: "deepseek-v4-flash", limits: { contextWindow: { tokens: 128_000, from: "pi" }, maxTokens: null, pictures: null, asked: ["maxTokens", "pictures"] } }, problem: null } } });
    expect(answered.text).toContain(`It answered in ${duration(840)}, as deepseek-v4-flash. Context window: 128,000 tokens, as pi lists it · Longest reply: not known · Audio: not said, so it is sent · Video: not said, so it is sent.`);
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

  test("a test that answers as another model than the connection names, with limits the catalogue lists, says so in one sentence and offers them; taking them opens the form with them filled in and writes nothing", () => {
    const tested = { ok: true as const, ms: 900, model: "deepseek-flash", limits: { contextWindow: { tokens: 1_000_000, from: "pi" as const }, maxTokens: { tokens: 384_000, from: "pi" as const }, pictures: null, asked: ["pictures" as const] } };
    const other = view({ tests: { "c-flash": { busy: false, tested, problem: null } } });
    const offer = elements(other.tree).find((e) => e.props["data-offer"] === "limits");
    expect(textOf(offer?.props.children)).toBe("The provider answered as deepseek-flash, not deepseek-v4-flash, so RPH does not use these figures for this connection unless you take them as its own.Take these limits");
    press(offer, "Take these limits");
    expect(other.asked).toEqual([{ kind: "form", id: "c-flash", fill: { contextWindow: 1_000_000, maxTokens: 384_000 } }]);
    // The same model, or a catalogue with nothing for it: no offer.
    expect(elements(view({ tests: { "c-flash": { busy: false, tested: { ...tested, model: "deepseek-v4-flash" }, problem: null } } }).tree).some((e) => e.props["data-offer"] === "limits")).toBe(false);
    expect(elements(view({ tests: { "c-flash": { busy: false, tested: { ...tested, limits: { contextWindow: null, maxTokens: null, pictures: null, asked: ["contextWindow", "maxTokens", "pictures"] } }, problem: null } } }).tree).some((e) => e.props["data-offer"] === "limits")).toBe(false);
    // The form opens with the figures filled in, says nothing is written until saved, and saving sends them as the connection's model's own.
    const form = view({ action: { kind: "form", id: "c-flash", fill: { contextWindow: 1_000_000, maxTokens: 384_000 } } });
    const field = (name: string) => elements(form.tree).find((e) => e.type === "input" && e.props.name === name)?.props.defaultValue;
    expect([field("contextWindow"), field("maxTokens")]).toEqual(["1000000", "384000"]);
    expect(elements(form.tree).some((e) => e.props["data-filled"] === "true")).toBe(true);
    expect(form.asked).toEqual([]);
    const save = draftOf(entries({ name: "Flash", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", contextWindow: "1000000", maxTokens: "384000" }), KEYED);
    expect(save.connection.limits).toEqual({ "deepseek-v4-flash": { contextWindow: 1_000_000, maxTokens: 384_000 } });
  });

  test("changing the form's model fills the two limit fields with that model's own figures, or empties them, so one model's figures never go under another's name", () => {
    const withTwo: ConnectionShown = { ...KEYED, limits: { "deepseek-v4-flash": { contextWindow: 64_000 }, "deepseek-v4-pro": { maxTokens: 16_000 } } };
    const form = view({ list: { ...LIST, connections: [withTwo, SIGNED] }, action: { kind: "form", id: "c-flash" } });
    const values: Record<string, { value: string }> = { contextWindow: { value: "64000" }, maxTokens: { value: "" } };
    const model = elements(form.tree).find((e) => e.type === "input" && e.props.name === "model");
    const type = (value: string): void => (model?.props.onInput as (event: unknown) => void)({ currentTarget: { value, form: { elements: { namedItem: (name: string) => values[name] } } } });
    type("deepseek-v4-pro");
    expect([values.contextWindow?.value, values.maxTokens?.value]).toEqual(["", "16000"]);
    type("some-other-model");
    expect([values.contextWindow?.value, values.maxTokens?.value]).toEqual(["", ""]);
    type("deepseek-v4-flash");
    expect([values.contextWindow?.value, values.maxTokens?.value]).toEqual(["64000", ""]);
  });

  test("limits that could not be read say why, apart from limits nobody knows", () => {
    const unread = view({ list: { ...LIST, connections: [{ ...KEYED, limitsInForce: null, limitsProblem: "The model catalogue could not be read: its file is not JSON." }] } });
    expect(textOf(elements(unread.tree).find((e) => e.props["data-limits"] === "c-flash")?.props.children)).toBe("Its limits could not be read: The model catalogue could not be read: its file is not JSON.");
    expect(limitsWords(null)).toBe("Context window: not known · Longest reply: not known · Audio: not said, so it is sent · Video: not said, so it is sent");
  });

  test("the form shows and saves retries, message threads and serial tools, and the model's figures he enters", () => {
    const own: ConnectionShown = { ...KEYED, retries: 4, messageThreads: true };
    const form = view({ list: { ...LIST, connections: [own, SIGNED] }, action: { kind: "form", id: "c-flash" } });
    const input = (name: string) => elements(form.tree).find((e) => e.type === "input" && e.props.name === name)?.props;
    expect([input("retries")?.defaultValue, input("messageThreads")?.defaultChecked, input("serialTools")?.defaultChecked, input("contextWindow")?.defaultValue]).toEqual(["4", true, false, "64000"]);
    // Each says its default where it is left empty or unticked: Appendix D.1's two tries again, and message threads off.
    expect(form.text).toContain("Left empty, the number in");
    expect(form.text).toContain("Message threads: off unless ticked (Appendix D.1)");
    const saved = draftOf(entries({ name: "Flash", provider: "deepseek", auth: "key", model: "deepseek-v4-flash", retries: "3", serialTools: "on", contextWindow: "48000", maxTokens: "6000", key: "" }), own);
    expect(saved.connection).toMatchObject({ retries: 3, serialTools: true, messageThreads: null, limits: { "deepseek-v4-flash": { contextWindow: 48_000, maxTokens: 6000 } } });
    expect(draftOf(entries({ name: "Flash", provider: "deepseek", auth: "key", retries: "", key: "" }), own).connection).toMatchObject({ retries: null, serialTools: null, messageThreads: null });
  });
});

describe("a connection that signs in", () => {
  test("its flow is started, finished with what he pastes, and shown signed in until when; sign-out reads it again", async () => {
    const { client, asked } = askingClient();
    const steps = signInSteps(signInCalls(client));
    const started = steps.start("c-studio", NO_SIGNIN);
    asked.find((a) => a.key === "POST /api/v1/connections/:id/signin")?.answer({ flow: "f1", url: "https://provider.example/sign-in", note: "Paste the code it shows." });
    const open = await started;
    expect(open.flow).toMatchObject({ flow: "f1" });
    const page = expand(h(SignInPanel, { name: "Studio", provider: "anthropic", shown: { ...open, state: { provider: "anthropic", signedIn: false, until: null, flow: "f1", ended: null } }, onStart: () => undefined, onCode: () => undefined, onFinish: () => undefined, onCancel: () => undefined, onOut: () => undefined }));
    expect(textOf(page)).toContain("https://provider.example/sign-in");
    expect(textOf(page)).toContain("Paste the code it shows.");
    const finished = steps.finish("c-studio", open, "the-code");
    const finish = asked.find((a) => a.key === "POST /api/v1/connections/:id/signin/finish");
    expect(finish?.body).toEqual({ flow: "f1", code: "the-code" });
    finish?.answer({ provider: "anthropic", signedIn: true, until: Date.UTC(2026, 11, 1), flow: null, ended: null });
    const done = await finished;
    expect(done.flow).toBeNull();
    expect(signInWords(done.state)).toContain("Signed in to its provider until");
  });

  test("a key held says where it would go and the line to run on the server", () => {
    const held: ConnectionShown = { ...KEYED, id: "c-held", name: "Held", baseUrl: "https://other.example/v1", key: { set: true, waiting: true } };
    const { text } = view({ list: { ...LIST, connections: [held] } });
    expect(text).toContain("Its key is held and sent nowhere");
    expect(text).toContain("https://other.example/v1");
    expect(text).toContain("rpe allow Held");
  });
});
