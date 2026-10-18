// Hidden JSON blocks (DESIGN §6.7): each world chat keeps two regex scripts of the engine's own. One bakes
// a World Info exclusion around each <json>…</json> block of a reply: an inline span, nothing hidden, the
// block byte for byte as written, never twice. The other hides a block still raw on display, after the
// chat's other display scripts, so a preset's own tracker survives. Chats that aren't world chats get
// none. The scripts come with attaching, come back the first time the engine meets an older world chat
// after a restart (an earlier build's script is rewritten in place), and go with Settings' switch and
// with the world. While hiding is on, the engine's own reads skip every block the display hides, a
// Continue's against the whole message; a reply saved inside an earlier build's hidden wrapper is
// always read without its block.

import { describe, expect, test } from "bun:test";
import { JSON_HIDE_SORT_ORDER, readableReply } from "../../src/backend/json-hiding";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";

function scriptsOf(rig: Rig, chatId: string) {
  return [...rig.host.regexScripts.values()].filter((s) => s.chatId === chatId);
}

/** The chat's own script on `target`, applied as the host applies one. */
function apply(rig: Rig, chatId: string, target: "response" | "display", text: string): string {
  const found = scriptsOf(rig, chatId).filter((s) => s.mine && s.targets.includes(target));
  const [script] = found;
  if (!script || found.length !== 1) throw new Error(`expected one ${target} script, found ${found.length}`);
  return text.replace(new RegExp(script.findRegex, script.flags), script.replaceString);
}

const BLOCK = '<json>{"carrying": "Vex Morrow\'s ledger"}</json>';

describe("the JSON scripts", () => {
  test("a world chat keeps an exclusion on saved and edited replies and a hiding on display that runs last; a chat without a world gets none", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const plain = rig.host.createChat("Hi.");
    rig.body(await rig.send({ type: "lre.hello", chatId: plain }));
    const mine = scriptsOf(rig, chatId);
    expect(mine.map((s) => s.targets.join("+")).sort()).toEqual(["display", "response"]);
    expect(mine.find((s) => s.targets.includes("response"))?.runOnEdit).toBe(true);
    expect(mine.find((s) => s.targets.includes("display"))?.sortOrder).toBe(JSON_HIDE_SORT_ORDER);
    expect(mine.every((s) => s.placement.join() === "ai_output")).toBe(true);
    expect(scriptsOf(rig, plain)).toEqual([]);
    // Opening the chat again, or attaching the world again, keeps the two.
    rig.body(await rig.send({ type: "lre.hello", chatId }));
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId: run?.worldId ?? "", chatId }));
    expect(scriptsOf(rig, chatId)).toHaveLength(2);
  });

  test("a saved block is kept out of World Info as written, inline and never twice; only the display hides it, and only while it is still raw", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    // A closing tag inside a JSON string doesn't end the block; an attribute-free tag in any case is one.
    const first = '<json>{"note": "a </json> inside a string", "n": 1}</json>';
    const second = "<JSON>[1, 2]</JSON>";
    const saved = apply(rig, chatId, "response", `The ferry leaves.\n${first}\n*She smiles.*\n${second}`);
    expect(saved).toBe(`The ferry leaves.\n<span wi-exclude>${first}</span>\n*She smiles.*\n<span wi-exclude>${second}</span>`);
    expect(apply(rig, chatId, "response", saved)).toBe(saved);
    // A reply an earlier build saved inside its hidden wrapper isn't wrapped again on an edit.
    const old = `Rain.\n<div hidden wi-exclude>${first}</div>`;
    expect(apply(rig, chatId, "response", old)).toBe(old);
    expect(apply(rig, chatId, "display", saved)).toBe(`The ferry leaves.\n<span wi-exclude><span hidden>${first}</span></span>\n*She smiles.*\n<span wi-exclude><span hidden>${second}</span></span>`);
    // A preset's display script that drew the block as a tracker first leaves nothing raw to hide.
    expect(apply(rig, chatId, "display", 'The ferry leaves.\n<div class="tracker">n: 1</div>')).toBe('The ferry leaves.\n<div class="tracker">n: 1</div>');
    expect(apply(rig, chatId, "response", "I said <json> twice, no block.")).toBe("I said <json> twice, no block.");
  });

  test("a saved reply keeps its block as written, and the engine reads the reply without it", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const prompts: string[] = [];
    rig.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      if (text.includes(EXTRACT_MARK)) prompts.push(text);
      return '{"proposals": []}';
    };
    await rig.turn(chatId, "I look at the harbor.", `The ferry horn sounds over the water.\n${BLOCK}`);
    expect(rig.host.head(chatId)?.swipes[0]).toBe(`The ferry horn sounds over the water.\n<span wi-exclude>${BLOCK}</span>`);
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
    const prompts: string[] = [];
    rig.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      if (text.includes(EXTRACT_MARK)) prompts.push(text);
      return '{"proposals": []}';
    };
    await rig.turn(chatId, "I look at the harbor.", 'The rain eases.\n<json>{"carrying": "Vex');
    const g = await rig.host.start(chatId, { type: "continue" });
    await rig.host.finish(g, 'Morrow"}</json>\nShe smiles.');
    expect(rig.host.head(chatId)?.swipes[0]).toBe('The rain eases.\n<json>{"carrying": "Vex Morrow"}</json>\nShe smiles.');
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("She smiles.");
    expect(prompts[1]).not.toContain("Morrow");
  });

  test("Settings' switch removes every world chat's scripts and brings the open one's back; the user's own scripts stay", async () => {
    const rig = new Rig();
    const one = await rig.worldChat();
    const two = await rig.worldChat();
    rig.host.regexScripts.set("theirs", { id: "theirs", chatId: one, mine: false, scriptId: "their_script", findRegex: "x", replaceString: "y", flags: "g", placement: ["ai_output"], targets: ["display"], runOnEdit: false, sortOrder: 0, metadata: { [LEDGER_NAMESPACE]: { json: "hide" } }, disabled: false });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { hideJsonBlocks: false } }));
    expect([...rig.host.regexScripts.keys()]).toEqual(["theirs"]);
    // Nothing comes back while hiding is off, not even when a chat is opened.
    rig.body(await rig.send({ type: "lre.hello", chatId: two }));
    expect([...rig.host.regexScripts.keys()]).toEqual(["theirs"]);
    rig.host.activeChat = two;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { hideJsonBlocks: true } }));
    expect(scriptsOf(rig, two)).toHaveLength(2);
    rig.body(await rig.send({ type: "lre.hello", chatId: one }));
    await rig.host.settle();
    expect(scriptsOf(rig, one).filter((s) => s.mine)).toHaveLength(2);
  });

  test("an older world chat gets its scripts the first time the engine meets it after a restart; an earlier build's script is rewritten in place and copies go", async () => {
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
    const after = scriptsOf(old, chatId);
    expect(after).toHaveLength(2);
    expect(after.find((s) => s.id === "earlier")?.targets).toEqual(["display"]);
    expect(after.some((s) => s.id === "copy")).toBe(false);
  });

  test("deleting a world removes its chats' scripts; another world's chats keep theirs", async () => {
    const rig = new Rig();
    const gone = await rig.worldChat();
    const kept = await rig.worldChat();
    const run = await rig.rt.runOf(gone, rig.host.userId);
    rig.body(await rig.send({ type: "lre.world", op: "delete", worldId: run?.worldId ?? "" }));
    expect(scriptsOf(rig, gone)).toEqual([]);
    expect(scriptsOf(rig, kept)).toHaveLength(2);
  });
});

describe("deleted chats and worlds", () => {
  test("deleting a world chat removes its scripts; the other world chats keep theirs", async () => {
    const rig = new Rig();
    const gone = await rig.worldChat();
    const kept = await rig.worldChat();
    rig.host.deleteChat(gone);
    await rig.host.settle();
    expect(scriptsOf(rig, gone)).toEqual([]);
    expect(scriptsOf(rig, kept)).toHaveLength(2);
  });

  test("a deleted world's chats don't get their scripts back when the engine meets them again, after a restart too", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    rig.body(await rig.send({ type: "lre.world", op: "delete", worldId: run?.worldId ?? "" }));
    await rig.send({ type: "lre.hello", chatId });
    await rig.host.settle();
    expect(scriptsOf(rig, chatId)).toEqual([]);
    const next = rig.restart();
    await next.send({ type: "lre.hello", chatId });
    await next.host.settle();
    expect(scriptsOf(next, chatId)).toEqual([]);
  });
});
