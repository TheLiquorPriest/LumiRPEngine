// Settings → Agents → Prompts (DESIGN §6.12): every editable text has its editor on its page, once;
// saving sends the user's own text, the shipped text word for word sends none and Reset sends null;
// a text with a bad placeholder, without one it must keep or past the length allowed can't be saved;
// and the patch it sends lands as the backend stores it. A role's text has Test, which sends
// `lre.prompts test` with the text as written and shows whether it passed or, in words, why not.
// The page finds a text by its name, its words or its id, lists the user's own (Yours) and those
// that need a fix, counts every page so the counts sum, folds a long heading, and mounts one editor
// at a time, a text left unsaved keeping its draft; Compare with shipped reads as a line diff; and a
// link opens a page and a text.

import { describe, expect, test } from "bun:test";
import { findTexts, fixCount, FOLD_OVER, openTarget, ownTextCount, promptGroups, promptIndex, PromptRow, PromptsView, type PromptsViewProps, PromptTestRow, promptTestRequest, promptTextPatch, savedProblems, testable } from "../../src/frontend/settings/agent-prompts";
import { PromptEditor } from "../../src/frontend/settings/prompt-editor";
import { Chip } from "../../src/frontend/build/form-kit";
import { Button, ListRow, SearchField, TextDiff } from "../../src/frontend/components";
import { FINAL_OUTPUT_PAGE, OFFSTAGE_TEXT_ID, PROMPT_PAGES, PROMPTS, promptDef, promptProblems, sectionPromptId, type PromptDef, type PromptSettings } from "../../src/shared/prompts";
import type { PromptTestView } from "../../src/shared/protocol";
import { Rig } from "../support/rig";
import { labelled, propsOf } from "../support/tree";

function def(id: string): PromptDef {
  const found = promptDef(id);
  if (!found) throw new Error(`no text ${id}`);
  return found;
}

describe("the Prompts page", () => {
  test("lists every editable text on its own page, once", () => {
    const listed = PROMPT_PAGES.flatMap((page) => promptGroups(page).flatMap((group) => group.defs.map((d) => d.id)));
    expect([...listed].sort()).toEqual(PROMPTS.map((d) => d.id).sort());
  });

  test("saves your own text, none for the shipped text, null on Reset, and nothing it can't send", () => {
    const scene = def(sectionPromptId("scene"));
    const id = scene.id;
    expect(promptTextPatch(scene, "Mine.\n{{lines}}", 20_000)).toEqual({ prompts: { texts: { [id]: "Mine.\n{{lines}}" } } });
    expect(promptTextPatch(scene, `${scene.text}\n`, 20_000)).toEqual({ prompts: { texts: { [id]: null } } });
    expect(promptTextPatch(scene, null, 20_000)).toEqual({ prompts: { texts: { [id]: null } } });
    expect(promptTextPatch(scene, "No lines.", 20_000)).toBeNull();
    expect(promptTextPatch(scene, "{{lines}} and {{nope}}", 20_000)).toBeNull();
    expect(promptTextPatch(scene, "Longer.\n{{lines}}", 5)).toBeNull();
    // A part of the narrator rules left empty is the user's own: that part is no longer sent.
    expect(promptTextPatch(def("narrator.preset_lead"), "", 20_000)).toEqual({ prompts: { texts: { "narrator.preset_lead": "" } } });
  });

  test("what it saves is what the backend keeps, and the home row counts your own texts", async () => {
    const rig = new Rig();
    const mine = promptTextPatch(def("narrator.preset_lead"), "", 20_000);
    if (!mine) throw new Error("not saved");
    rig.body(await rig.send({ type: "lre.settings.set", patch: mine }));
    const { prompts } = await rig.rt.settings.get(rig.host.userId);
    expect(prompts.texts["narrator.preset_lead"]).toBe("");
    expect(ownTextCount(prompts)).toBe(1);
  });
});

describe("Test for a role's text", () => {
  const answer = def("role.read.extract.answer");
  /** Every text the row shows, flattened. */
  const words = (node: unknown): string => JSON.stringify(node);

  test("is on every role text, and on no other page's", () => {
    expect(testable(answer)).toBe(true);
    expect(testable(def("role.intent.system"))).toBe(true);
    expect(PROMPTS.filter((d) => d.page === "main" || d.page === "gm").some(testable)).toBe(false);
  });

  test("its button sends lre.prompts test with the text as written, on the open chat", () => {
    const sent: unknown[] = [];
    const row = PromptTestRow({ label: answer.label, text: "Output JSON only.", problems: [], busy: false, state: undefined, send: (text) => sent.push(promptTestRequest("chat-1", answer.id, text)) });
    const button = labelled(row, Button, `Test ${answer.label} on this chat`);
    expect(button.disabled).toBe(false);
    (button.onClick as () => void)();
    expect(sent).toEqual([{ type: "lre.prompts", op: "test", chatId: "chat-1", id: answer.id, text: "Output JSON only." }]);
  });

  test("can't be pressed while the text has a problem or a Test runs, and shows what the last one found", () => {
    const row = (state: "running" | PromptTestView | undefined, problems: string[] = []) => PromptTestRow({ label: answer.label, text: "x", problems, busy: false, state, send: () => undefined });
    expect(labelled(row(undefined, ["unknown placeholder {{nope}}"]), Button, `Test ${answer.label} on this chat`).disabled).toBe(true);
    expect(labelled(row("running"), Button, `Test ${answer.label} on this chat`).disabled).toBe(true);
    expect(words(row({ ok: true, problems: [], left: [] }))).toContain("Passed: the role's answer kept its contract.");
    expect(words(row({ ok: true, problems: [], left: [] }))).not.toContain("Left out");
    expect(words(row({ ok: true, problems: [], left: ["the player's message: none comes right before the latest reply"] }))).toContain("Left out of its task: the player's message: none comes right before the latest reply.");
    const failed = words(row({ ok: false, problems: ["the answer breaks its contract: proposals: is required"], left: [] }));
    expect(failed).toContain("Failed: ");
    expect(failed).toContain("The answer breaks its contract: proposals: is required");
    expect(propsOf(row(undefined), Button).length).toBe(1);
  });
});

/** Prompt settings with these texts of the user's own. */
function settings(texts: Record<string, string> = {}, maxChars = 20_000): PromptSettings {
  return { texts, maxChars };
}

/** The page as `over` leaves its state, and each press it heard, by name. */
function view(over: Partial<PromptsViewProps> = {}): { tree: unknown; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const heard =
    (name: string) =>
    (...args: unknown[]): void => {
      calls.push([name, ...args]);
    };
  const props: PromptsViewProps = {
    prompts: settings(),
    busy: false,
    query: "",
    filter: "all",
    pageId: null,
    openId: null,
    drafts: {},
    unfolded: new Set(),
    tests: {},
    canTest: false,
    onQuery: heard("query"),
    onFilter: heard("filter"),
    onPage: heard("page"),
    onEditor: heard("editor"),
    onDraft: heard("draft"),
    onFold: heard("fold"),
    onTest: heard("test"),
    patch: heard("patch"),
    ...over,
  };
  return { tree: PromptsView(props), calls };
}

const ids = (defs: readonly PromptDef[]) => defs.map((d) => d.id);

describe("finding a text", () => {
  test("by its id, its name (any case, its words in any order), its shipped words or the user's own", () => {
    const none = settings();
    expect(ids(findTexts("role.read.extract.answer", "all", none))).toEqual(["role.read.extract.answer"]);
    expect(ids(findTexts("ORDER of Authority", "all", none))[0]).toBe("narrator.authority");
    expect(ids(findTexts("authority order", "all", none))[0]).toBe("narrator.authority");
    // Words only the shipped text has.
    expect(def("narrator.marked_facts").label.toLowerCase()).not.toContain("steering");
    expect(ids(findTexts("steering the story", "all", none))).toContain("narrator.marked_facts");
    // Words only the user's own text has.
    expect(findTexts("lighthouse keeper", "all", none)).toEqual([]);
    expect(ids(findTexts("lighthouse keeper", "all", settings({ "narrator.preset_lead": "Before the rules: the lighthouse keeper's word." })))).toEqual(["narrator.preset_lead"]);
    // A part of an id finds every text under it.
    expect(ids(findTexts("lore.index.", "all", none)).every((id) => id.startsWith("lore.index."))).toBe(true);
  });

  test("a text named by the query comes before one that only says it", () => {
    const found = ids(findTexts("prices", "all", settings()));
    expect(found[0]).toBe("narrator.prices");
    expect(found.length).toBeGreaterThan(1);
  });

  test("Yours lists the user's own texts and Needs a fix those that can't stand as saved, the chips counting each", () => {
    const scene = sectionPromptId("scene");
    const prompts = settings({ "narrator.preset_lead": "", [scene]: "Mine.\n{{lines}}", "narrator.authority": "Mine {{nope}}" });
    expect(ownTextCount(prompts)).toBe(3);
    expect(ids(findTexts("", "yours", prompts))).toEqual(["narrator.authority", "narrator.preset_lead", scene]);
    expect(ids(findTexts("mine", "yours", prompts))).toEqual(["narrator.authority", scene]);
    expect(fixCount(prompts)).toBe(1);
    expect(ids(findTexts("", "fix", prompts))).toEqual(["narrator.authority"]);
    expect(savedProblems(def("narrator.authority"), prompts)).toEqual(promptProblems(def("narrator.authority"), "Mine {{nope}}").map((p) => p.message));
    // Lowering the limit past a saved text puts it among those to fix.
    const lowered = settings(prompts.texts, 5);
    expect(ids(findTexts("", "fix", lowered))).toEqual(["narrator.authority", scene]);
    expect(savedProblems(def(scene), lowered)).toEqual(["it is longer than the 5 characters a text of your own may hold"]);

    const chips = (over: Partial<PromptsViewProps>) => propsOf(view(over).tree, Chip).map((c) => ({ label: c.children, pressed: c.pressed, disabled: c.disabled === true }));
    expect(chips({ prompts })).toEqual([
      { label: "All", pressed: true, disabled: false },
      { label: "Yours (3)", pressed: false, disabled: false },
      { label: "Needs a fix (1)", pressed: false, disabled: false },
    ]);
    // With none of the user's own, there is nothing to list under either.
    expect(chips({}).map((c) => c.disabled)).toEqual([false, true, true]);
    // A press picks a chip, and pressing it again goes back to All.
    const pressed = view({ prompts });
    (propsOf(pressed.tree, Chip)[1]?.onToggle as () => void)();
    const again = view({ prompts, filter: "yours" });
    (propsOf(again.tree, Chip)[1]?.onToggle as () => void)();
    expect([...pressed.calls, ...again.calls]).toEqual([
      ["filter", "yours"],
      ["filter", "all"],
    ]);
    // The search box hears what is typed and says what it found.
    const searching = propsOf(view({ prompts, query: "mine", filter: "yours" }).tree, SearchField)[0];
    expect(searching?.status).toBe("2 texts found");
  });
});

describe("the index", () => {
  test("lists every page once, in its section, and its counts sum to every text, the user's own and those that need a fix", () => {
    const prompts = settings({ "narrator.preset_lead": "", "narrator.authority": "Mine {{nope}}", "gm.system": "Help the GM." });
    const pages = promptIndex(prompts).flatMap((s) => s.pages);
    expect(pages.map((p) => p.page.id).sort()).toEqual(PROMPT_PAGES.map((p) => p.id).sort());
    expect(pages.reduce((n, p) => n + p.count, 0)).toBe(PROMPTS.length);
    expect(pages.reduce((n, p) => n + p.own, 0)).toBe(ownTextCount(prompts));
    expect(pages.reduce((n, p) => n + p.fix, 0)).toBe(fixCount(prompts));
    for (const p of pages) expect({ page: p.page.id, count: p.count }).toEqual({ page: p.page.id, count: PROMPTS.filter((d) => d.page === p.page.id).length });
    // Its rows say so, and open their page.
    const { tree, calls } = view({ prompts });
    const rows = propsOf(tree, ListRow);
    expect(rows.map((r) => r.title)).toEqual(pages.map((p) => p.page.label));
    const final = pages.find((p) => p.page.id === FINAL_OUTPUT_PAGE.id);
    expect(rows[0]?.subtitle).toBe(`${final?.count} texts, 2 your own`);
    (rows[0]?.onClick as () => void)();
    expect(calls).toEqual([["page", FINAL_OUTPUT_PAGE.id]]);
  });
});

describe("one editor at a time", () => {
  const page = FINAL_OUTPUT_PAGE.id;
  const scene = sectionPromptId("scene");

  test("only the open text has its editor; every other is a row, and a heading over the fold is folded", () => {
    const groups = promptGroups(FINAL_OUTPUT_PAGE);
    const sections = groups.find((g) => g.title === "Sections");
    expect(sections?.defs.length).toBeGreaterThan(FOLD_OVER);
    const open = view({ pageId: page, openId: "narrator.authority" }).tree;
    expect(propsOf(open, PromptEditor).map((e) => e.id)).toEqual(["narrator.authority"]);
    const rows = propsOf(open, PromptRow).map((r) => r.id);
    expect(rows).not.toContain("narrator.authority");
    expect(rows).not.toContain(scene);
    expect(rows.length + 1).toBe(groups.filter((g) => g.defs.length <= FOLD_OVER).reduce((n, g) => n + g.defs.length, 0));
    // Nothing open, no editor; the folded heading opens when asked, or with a text of it open.
    expect(propsOf(view({ pageId: page }).tree, PromptEditor)).toEqual([]);
    expect(propsOf(view({ pageId: page, unfolded: new Set([`${page}/Sections`]) }).tree, PromptRow).map((r) => r.id)).toContain(scene);
    expect(propsOf(view({ pageId: page, openId: scene }).tree, PromptEditor).map((e) => e.id)).toEqual([scene]);
    // In what a search found, too.
    const found = view({ query: "system prompt", openId: "gm.system" }).tree;
    expect(propsOf(found, PromptEditor).map((e) => e.id)).toEqual(["gm.system"]);
  });

  test("a row opens its text and the editor closes it", () => {
    const rows = view({ pageId: page });
    (propsOf(rows.tree, PromptRow).find((r) => r.id === "narrator.prices")?.onOpen as () => void)();
    const open = view({ pageId: page, openId: "narrator.prices" });
    (propsOf(open.tree, PromptEditor)[0]?.onOpenChange as (open: boolean) => void)(false);
    expect([...rows.calls, ...open.calls]).toEqual([
      ["editor", "narrator.prices", true],
      ["editor", "narrator.prices", false],
    ]);
  });

  test("a text left unsaved keeps its draft while another is open, until the text it was written over changes", () => {
    const shipped = def("narrator.authority").text;
    const drafts = { "narrator.authority": { text: "Draft.", base: shipped } };
    const row = (over: Partial<PromptsViewProps>) => propsOf(view({ pageId: page, ...over }).tree, PromptRow).find((r) => r.id === "narrator.authority");
    expect(row({ drafts, openId: "narrator.prices" })?.unsaved).toBe(true);
    expect(row({ drafts, prompts: settings({ "narrator.authority": "Saved since." }) })?.unsaved).toBe(false);
    const open = view({ pageId: page, openId: "narrator.authority", drafts });
    const editor = propsOf(open.tree, PromptEditor)[0];
    expect(editor?.text).toBe("Draft.");
    (editor?.onText as (text: string) => void)("Draft, again.");
    expect(open.calls).toEqual([["draft", "narrator.authority", { text: "Draft, again.", base: shipped }]]);
  });
});

describe("Compare with shipped", () => {
  const named = { before: "the shipped text", after: "yours" };
  test("reads the text as written against the shipped one, line by line", () => {
    const diff = TextDiff({ before: "a\nb\nc", after: "a\nB\nc\nd", named });
    expect(propsOf(diff, "del").length).toBe(1);
    expect(propsOf(diff, "ins").length).toBe(2);
    expect(JSON.stringify(diff)).toContain("Against the shipped text, yours takes out 1 line and adds 2 lines.");
    expect(JSON.stringify(TextDiff({ before: "same", after: "same", named }))).toContain("No difference: yours is the shipped text, line for line.");
  });
});

describe("a link to the page", () => {
  test("opens its page, and its text where that page holds it", () => {
    expect(openTarget({ page: "role.intent", text: "role.intent.system" })).toEqual({ pageId: "role.intent", openId: "role.intent.system" });
    expect(openTarget({ page: "role.intent" })).toEqual({ pageId: "role.intent", openId: null });
    expect(openTarget({ page: "role.intent", text: "gm.system" })).toEqual({ pageId: "role.intent", openId: null });
    expect(openTarget({ page: "nowhere" })).toEqual({ pageId: null, openId: null });
    expect(openTarget(undefined)).toEqual({ pageId: null, openId: null });
  });
});

describe("the out-of-play line", () => {
  test("is a Final output text that must keep what was done", () => {
    const offstage = def(OFFSTAGE_TEXT_ID);
    expect({ page: offstage.page, group: offstage.group }).toEqual({ page: FINAL_OUTPUT_PAGE.id, group: "Out-of-play actions" });
    expect(promptTextPatch(offstage, "Done off screen.", 20_000)).toBeNull();
    expect(promptTextPatch(offstage, "Off screen: {{what}}.", 20_000)).toEqual({ prompts: { texts: { [OFFSTAGE_TEXT_ID]: "Off screen: {{what}}." } } });
  });
});
