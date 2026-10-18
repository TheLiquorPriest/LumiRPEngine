// Hidden JSON blocks (DESIGN §6.7). A world chat's replies are saved with each <json>…</json> block inside
// a span World Info's scans skip, after every other response script; the user's two global unwraps take it
// off again before every other display and prompt script, so a preset's tracker, a prompt script that
// strips old blocks, markdown and the narrator read the reply as the AI wrote it; last on display, a block
// still raw is hidden while hiding is on. Turning hiding off removes only the hiding. Chats that aren't
// world chats get no scripts of their own; a deleted world's or chat's go, and the unwraps stay. The
// engine's own reads skip every block the display hides, a Continue's against the whole message, and a
// reply saved inside an earlier build's hidden wrapper is always read without its block.

import { describe, expect, test } from "bun:test";
import { readableReply } from "../../src/backend/json-hiding";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";
const BLOCK = '<json>{"carrying": "Vex Morrow\'s ledger"}</json>';

/** The scripts scoped to one chat. */
function chatScriptsOf(rig: Rig, chatId: string) {
  return [...rig.host.regexScripts.values()].filter((s) => s.chatId === chatId);
}

/** The engine's global scripts. */
function globalsOf(rig: Rig) {
  return [...rig.host.regexScripts.values()].filter((s) => s.chatId === null && s.mine);
}

/** Plants a global script of the user's own, as a preset brings one, at the host's default sort order. */
function presetScript(rig: Rig, id: string, target: "response" | "display" | "prompt", findRegex: string, replaceString: string, flags = "g"): void {
  rig.host.regexScripts.set(id, { id, chatId: null, mine: false, scriptId: id, findRegex, replaceString, flags, placement: ["ai_output"], targets: [target], runOnEdit: false, sortOrder: 0, metadata: {}, disabled: false });
}

/** The extract helper's prompts, as they are sent. */
function extractPrompts(rig: Rig): string[] {
  const prompts: string[] = [];
  rig.host.quietReply = (req) => {
    const text = req.messages.map((m) => m.content).join("\n");
    if (text.includes(EXTRACT_MARK)) prompts.push(text);
    return '{"proposals": []}';
  };
  return prompts;
}

describe("the JSON scripts", () => {
  test("a world chat keeps an exclusion on saved and edited replies and a hiding on display, the user an unwrap on display and one in the prompt; a chat without a world gets none of its own", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const plain = rig.host.createChat("Hi.");
    rig.body(await rig.send({ type: "lre.hello", chatId: plain }));
    const own = chatScriptsOf(rig, chatId);
    expect(own.map((s) => s.targets.join("+")).sort()).toEqual(["display", "response"]);
    expect(own.find((s) => s.targets.includes("response"))?.runOnEdit).toBe(true);
    expect(globalsOf(rig).map((s) => s.targets.join("+")).sort()).toEqual(["display", "prompt"]);
    expect([...own, ...globalsOf(rig)].every((s) => s.placement.join() === "ai_output")).toBe(true);
    expect(chatScriptsOf(rig, plain)).toEqual([]);
    // Opening the chat again, or attaching the world again, keeps the four.
    rig.body(await rig.send({ type: "lre.hello", chatId }));
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId: run?.worldId ?? "", chatId }));
    expect(chatScriptsOf(rig, chatId)).toHaveLength(2);
    expect(globalsOf(rig)).toHaveLength(2);
  });

  test("a preset's own scripts, made before the engine's or after, read each reply as the AI wrote it on save, in the chat and in the prompt; only a block left raw is hidden", async () => {
    const rig = new Rig();
    // A tracker anchored on the block, made before the engine's scripts...
    const tracker = { find: String.raw`^<json>([\s\S]*?)<\/json>\s*$`, replace: '<div class="tracker">$1</div>' };
    presetScript(rig, "tracker", "display", tracker.find, tracker.replace, "m");
    const chatId = await rig.worldChat();
    // ...and, made after them, a response script that trims what follows the block and a prompt script that strips it from the history.
    presetScript(rig, "trim", "response", String.raw`(<\/json>)\s*$`, "$1");
    presetScript(rig, "strip", "prompt", String.raw`\s*<json>[\s\S]*?<\/json>\s*$`, "");
    await rig.turn(chatId, "I look at the harbor.", `The ferry horn sounds over the water.\n${BLOCK}\n\n`);
    const saved = rig.host.head(chatId)?.swipes[0] ?? "";
    expect(saved).toBe(`The ferry horn sounds over the water.\n<span wi-exclude>${BLOCK}</span>`);
    // The chat draws the tracker exactly as it would without the engine, and no wrapper reaches markdown.
    const shown = rig.host.scripted(chatId, "display", saved);
    expect(shown).toBe(`The ferry horn sounds over the water.\n${BLOCK}`.replace(new RegExp(tracker.find, "m"), tracker.replace));
    expect(shown).not.toContain("wi-exclude");
    expect(rig.host.scripted(chatId, "prompt", saved)).toBe("The ferry horn sounds over the water.");
    // A block the tracker doesn't draw is hidden, after it.
    expect(rig.host.scripted(chatId, "display", `She waves. <span wi-exclude>${BLOCK}</span>`)).toBe(`She waves. <span hidden>${BLOCK}</span>`);
  });

  test("a block is wrapped once, inline, as the host reads one, on save and on every edit; one inside an earlier build's hidden wrapper isn't wrapped again", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    // A closing tag inside a JSON string doesn't end the block; an attribute-free tag in any case is one.
    const first = '<json>{"note": "a </json> inside a string", "n": 1}</json>';
    const second = "<JSON>[1, 2]</JSON>";
    const saved = rig.host.scripted(chatId, "response", `The ferry leaves.\n${first}\n*She smiles.*\n${second}`);
    expect(saved).toBe(`The ferry leaves.\n<span wi-exclude>${first}</span>\n*She smiles.*\n<span wi-exclude>${second}</span>`);
    expect(rig.host.scripted(chatId, "response", saved, true)).toBe(saved);
    expect(rig.host.scripted(chatId, "display", saved)).toBe(`The ferry leaves.\n<span hidden>${first}</span>\n*She smiles.*\n<span hidden>${second}</span>`);
    const old = `Rain.\n<div hidden wi-exclude>${first}</div>`;
    expect(rig.host.scripted(chatId, "response", old, true)).toBe(old);
    expect(rig.host.scripted(chatId, "response", "I said <json> twice, no block.")).toBe("I said <json> twice, no block.");
    // Editing a saved reply, its span kept or taken out, leaves one span.
    await rig.turn(chatId, "I look at the harbor.", `The ferry horn sounds.\n${BLOCK}`);
    const messageId = rig.host.head(chatId)?.id ?? "";
    rig.host.editMessage(chatId, messageId, `The ferry horn sounds twice.\n<span wi-exclude>${BLOCK}</span>`);
    await rig.host.settle();
    expect(rig.host.head(chatId)?.swipes[0]).toBe(`The ferry horn sounds twice.\n<span wi-exclude>${BLOCK}</span>`);
    rig.host.editMessage(chatId, messageId, `The ferry horn sounds again.\n${BLOCK}`);
    await rig.host.settle();
    expect(rig.host.head(chatId)?.swipes[0]).toBe(`The ferry horn sounds again.\n<span wi-exclude>${BLOCK}</span>`);
  });

  test("the engine reads a saved reply without its block", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const prompts = extractPrompts(rig);
    await rig.turn(chatId, "I look at the harbor.", `The ferry horn sounds over the water.\n${BLOCK}`);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The ferry horn sounds over the water.");
    expect(prompts[0]).not.toContain("Vex");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("while hiding is on the engine skips every block the display hides; with it off, only those inside an earlier build's wrapper", () => {
    const hidden = [`Rain.\n${BLOCK}`, `Rain.\n<span wi-exclude>${BLOCK}</span>`, `Rain.\n<div hidden wi-exclude>${BLOCK}</div>`, `Rain.\n<div hidden wi-exclude>${BLOCK}\n</div>`];
    for (const text of hidden) {
      expect(readableReply(text, true)).not.toContain("Vex");
      expect(readableReply(text, true)).not.toContain("wi-exclude");
      expect(readableReply(text, true).startsWith("Rain.")).toBe(true);
    }
    expect(readableReply(hidden[3] ?? "", false)).not.toContain("Vex");
    expect(readableReply(hidden[0] ?? "", false)).toContain("Vex");
    expect(readableReply(hidden[1] ?? "", false)).toContain("Vex");
  });

  test("a Continue that splits a block is read against the whole message", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const prompts = extractPrompts(rig);
    await rig.turn(chatId, "I look at the harbor.", 'The rain eases.\n<json>{"carrying": "Vex');
    const g = await rig.host.start(chatId, { type: "continue" });
    await rig.host.finish(g, 'Morrow"}</json>\nShe smiles.');
    expect(rig.host.head(chatId)?.swipes[0]).toBe('The rain eases.\n<json>{"carrying": "Vex Morrow"}</json>\nShe smiles.');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("She smiles.");
    expect(prompts[1]).not.toContain("Morrow");
  });

  test("turning hiding off removes only the hiding: replies show their blocks as the AI wrote them and World Info still skips them; on again brings the hiding back", async () => {
    const rig = new Rig();
    const one = await rig.worldChat();
    const two = await rig.worldChat();
    rig.host.regexScripts.set("theirs", { id: "theirs", chatId: one, mine: false, scriptId: "their_script", findRegex: "zzz", replaceString: "y", flags: "g", placement: ["ai_output"], targets: ["display"], runOnEdit: false, sortOrder: 0, metadata: { [LEDGER_NAMESPACE]: { json: "hide" } }, disabled: false });
    const ownTargets = (chatId: string) => chatScriptsOf(rig, chatId).filter((s) => s.mine).map((s) => s.targets.join("+")).sort();
    rig.body(await rig.send({ type: "lre.settings.set", patch: { hideJsonBlocks: false } }));
    expect(ownTargets(one)).toEqual(["response"]);
    expect(ownTargets(two)).toEqual(["response"]);
    expect(rig.host.regexScripts.has("theirs")).toBe(true);
    expect(globalsOf(rig)).toHaveLength(2);
    // A new reply is still saved with the span; the chat and the prompt get it as written.
    await rig.turn(one, "I look at the harbor.", `The ferry horn sounds.\n${BLOCK}`);
    const saved = rig.host.head(one)?.swipes[0] ?? "";
    expect(saved).toBe(`The ferry horn sounds.\n<span wi-exclude>${BLOCK}</span>`);
    expect(rig.host.scripted(one, "display", saved)).toBe(`The ferry horn sounds.\n${BLOCK}`);
    expect(rig.host.scripted(one, "prompt", saved)).toBe(`The ferry horn sounds.\n${BLOCK}`);
    // Nothing hides while it is off, not even in a chat opened now.
    rig.body(await rig.send({ type: "lre.hello", chatId: two }));
    await rig.host.settle();
    expect(ownTargets(two)).toEqual(["response"]);
    rig.host.activeChat = two;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { hideJsonBlocks: true } }));
    expect(ownTargets(two)).toEqual(["display", "response"]);
    rig.body(await rig.send({ type: "lre.hello", chatId: one }));
    await rig.host.settle();
    expect(ownTargets(one)).toEqual(["display", "response"]);
    expect(rig.host.scripted(one, "display", saved)).toBe(`The ferry horn sounds.\n<span hidden>${BLOCK}</span>`);
  });

  test("after a restart an older world chat gets its scripts the first time the engine meets it: an earlier build's are rewritten in place, copies go, and the unwraps come back", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const worldId = (await rig.rt.runOf(chatId, rig.host.userId))?.worldId ?? "";
    const old = rig.restart();
    // As an earlier build left it: one script on both targets, wrapping in a hidden div, and a copy of it.
    old.host.regexScripts.clear();
    const earlier = { id: "earlier", chatId, mine: true, scriptId: `lre_json_${chatId}`, findRegex: "(?<!<div hidden wi-exclude>)<json>[\\s\\S]*?</json>", replaceString: "<div hidden wi-exclude>$&</div>", flags: "g", placement: ["ai_output"], targets: ["response", "display"], runOnEdit: true, sortOrder: 0, metadata: { [LEDGER_NAMESPACE]: { json: "hide", worldId } }, disabled: false };
    old.host.regexScripts.set("earlier", earlier);
    old.host.regexScripts.set("copy", { ...earlier, id: "copy", scriptId: "copy" });
    old.body(await old.send({ type: "lre.hello", chatId }));
    await old.host.settle();
    const after = chatScriptsOf(old, chatId);
    expect(after).toHaveLength(2);
    expect(after.find((s) => s.id === "earlier")?.targets).toEqual(["display"]);
    expect(after.some((s) => s.id === "copy")).toBe(false);
    expect(globalsOf(old)).toHaveLength(2);
  });

  test("deleting a world removes its chats' scripts, and they still show their replies as written; another world's chats keep theirs", async () => {
    const rig = new Rig();
    const gone = await rig.worldChat();
    const kept = await rig.worldChat();
    await rig.turn(gone, "I look at the harbor.", `The ferry horn sounds.\n${BLOCK}`);
    const run = await rig.rt.runOf(gone, rig.host.userId);
    rig.body(await rig.send({ type: "lre.world", op: "delete", worldId: run?.worldId ?? "" }));
    expect(chatScriptsOf(rig, gone)).toEqual([]);
    expect(chatScriptsOf(rig, kept)).toHaveLength(2);
    expect(rig.host.scripted(gone, "display", rig.host.head(gone)?.swipes[0] ?? "")).toBe(`The ferry horn sounds.\n${BLOCK}`);
  });
});

describe("deleted chats and worlds", () => {
  test("deleting a world chat removes its scripts; the other world chats keep theirs", async () => {
    const rig = new Rig();
    const gone = await rig.worldChat();
    const kept = await rig.worldChat();
    rig.host.deleteChat(gone);
    await rig.host.settle();
    expect(chatScriptsOf(rig, gone)).toEqual([]);
    expect(chatScriptsOf(rig, kept)).toHaveLength(2);
  });

  test("a deleted world's chats don't get their scripts back when the engine meets them again, after a restart too", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    rig.body(await rig.send({ type: "lre.world", op: "delete", worldId: run?.worldId ?? "" }));
    await rig.send({ type: "lre.hello", chatId });
    await rig.host.settle();
    expect(chatScriptsOf(rig, chatId)).toEqual([]);
    const next = rig.restart();
    await next.send({ type: "lre.hello", chatId });
    await next.host.settle();
    expect(chatScriptsOf(next, chatId)).toEqual([]);
  });
});
