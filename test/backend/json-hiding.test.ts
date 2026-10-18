// Hidden JSON blocks (DESIGN §6.6): each world chat keeps one regex script of the engine's own that
// wraps a reply's <json>…</json> block in an element the display hides and World Info skips, the block
// itself byte for byte as written and never wrapped twice. Chats that aren't world chats get none. The
// script comes with attaching, comes back the first time the engine meets an older world chat after a
// restart, goes with Settings' switch and with the world. The engine's own reads of a reply skip
// exactly the wrapper and the block in it.

import { describe, expect, test } from "bun:test";
import { withoutHiddenJson } from "../../src/backend/json-hiding";
import { LEDGER_NAMESPACE } from "../../src/shared/ledger";
import { Rig } from "../support/rig";

const EXTRACT_MARK = "You read a narrator's roleplay reply";

function scriptsOf(rig: Rig, chatId: string) {
  return [...rig.host.regexScripts.values()].filter((s) => s.chatId === chatId);
}

/** The chat's one script, applied as the host applies it. */
function bake(rig: Rig, chatId: string, text: string): string {
  const [script, ...rest] = scriptsOf(rig, chatId);
  if (!script || rest.length > 0) throw new Error(`expected one script, found ${rest.length + (script ? 1 : 0)}`);
  return text.replace(new RegExp(script.findRegex, script.flags), script.replaceString);
}

describe("the JSON-hiding script", () => {
  test("a world chat keeps one, on replies as they're saved, shown and edited; a chat without a world gets none", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const plain = rig.host.createChat("Hi.");
    rig.body(await rig.send({ type: "lre.hello", chatId: plain }));
    const [script] = scriptsOf(rig, chatId);
    expect(scriptsOf(rig, chatId)).toHaveLength(1);
    expect([...(script?.targets ?? [])].sort()).toEqual(["display", "response"]);
    expect(script?.placement).toEqual(["ai_output"]);
    expect(script?.runOnEdit).toBe(true);
    expect(scriptsOf(rig, plain)).toEqual([]);
    // Opening the chat again, or attaching the world again, keeps the one script.
    rig.body(await rig.send({ type: "lre.hello", chatId }));
    const run = await rig.rt.runOf(chatId, rig.host.userId);
    rig.body(await rig.send({ type: "lre.world", op: "attach", worldId: run?.worldId ?? "", chatId }));
    expect(scriptsOf(rig, chatId)).toHaveLength(1);
  });

  test("it wraps each block whole, leaves it byte for byte as written, and never wraps it twice", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    // A closing tag inside a JSON string doesn't end the block; an attribute-free tag in any case is one.
    const first = '<json>{"note": "a </json> inside a string", "n": 1}</json>';
    const second = '<JSON>[1, 2]</JSON>';
    const reply = `The ferry leaves.\n${first}\nThen the gulls.\n${second}`;
    const once = bake(rig, chatId, reply);
    expect(once).toBe(`The ferry leaves.\n<div hidden wi-exclude>${first}</div>\nThen the gulls.\n<div hidden wi-exclude>${second}</div>`);
    expect(bake(rig, chatId, once)).toBe(once);
    // Text that only looks like a block stays as it is.
    expect(bake(rig, chatId, "I said <json> twice, no block.")).toBe("I said <json> twice, no block.");
  });

  test("a saved reply's block is hidden as written, and the engine reads the reply without it", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const prompts: string[] = [];
    rig.host.quietReply = (req) => {
      const text = req.messages.map((m) => m.content).join("\n");
      if (text.includes(EXTRACT_MARK)) prompts.push(text);
      return '{"proposals": []}';
    };
    const block = '<json>{"tracker": "Zebulon owes Sam 5 coins"}</json>';
    await rig.turn(chatId, "I look at the harbor.", `The ferry horn sounds over the water.\n${block}`);
    const saved = rig.host.head(chatId)?.swipes[0] ?? "";
    expect(saved).toBe(`The ferry horn sounds over the water.\n<div hidden wi-exclude>${block}</div>`);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("The ferry horn sounds over the water.");
    expect(prompts[0]).not.toContain("Zebulon");
    expect(rig.rt.ledger.errors).toEqual([]);
  });

  test("the engine skips exactly the wrapper it writes, nothing else", () => {
    expect(withoutHiddenJson('Rain. <div hidden wi-exclude><json>{"a": 1}</json></div> Road.')).toBe("Rain.   Road.");
    // A block the script didn't wrap, and other hidden or excluded text, are read as before.
    for (const text of ['Rain. <json>{"a": 1}</json>', "Rain. <div hidden wi-exclude>a note</div>", '<div hidden><json>{"a": 1}</json></div>', '<span wi-exclude><json>{"a": 1}</json></span>']) expect(withoutHiddenJson(text)).toBe(text);
  });

  test("Settings' switch removes every world chat's script and brings the open one's back; the user's own scripts stay", async () => {
    const rig = new Rig();
    const one = await rig.worldChat();
    const two = await rig.worldChat();
    rig.host.regexScripts.set("theirs", { id: "theirs", chatId: one, mine: false, scriptId: "their_script", findRegex: "x", replaceString: "y", flags: "g", placement: ["ai_output"], targets: ["display"], runOnEdit: false, metadata: { [LEDGER_NAMESPACE]: { json: "hide" } }, disabled: false });
    rig.body(await rig.send({ type: "lre.settings.set", patch: { hideJsonBlocks: false } }));
    expect([...rig.host.regexScripts.keys()]).toEqual(["theirs"]);
    // Nothing comes back while hiding is off, not even on attach or when a chat is opened.
    rig.body(await rig.send({ type: "lre.hello", chatId: two }));
    expect([...rig.host.regexScripts.keys()]).toEqual(["theirs"]);
    rig.host.activeChat = two;
    rig.body(await rig.send({ type: "lre.settings.set", patch: { hideJsonBlocks: true } }));
    expect(scriptsOf(rig, two)).toHaveLength(1);
    rig.body(await rig.send({ type: "lre.hello", chatId: one }));
    await rig.host.settle();
    expect(scriptsOf(rig, one).filter((s) => s.mine)).toHaveLength(1);
  });

  test("an older world chat gets its script the first time the engine meets it after a restart; a stale one is rewritten in place and copies go", async () => {
    const rig = new Rig();
    const chatId = await rig.worldChat();
    const old = rig.restart();
    // As before this build: no script at all.
    old.host.regexScripts.clear();
    old.body(await old.send({ type: "lre.hello", chatId }));
    await old.host.settle();
    expect(scriptsOf(old, chatId)).toHaveLength(1);
    // An earlier build's script and a second copy of it: the first is rewritten, the copy removed.
    const [kept] = scriptsOf(old, chatId);
    if (!kept) throw new Error("no script");
    old.host.regexScripts.set(kept.id, { ...kept, findRegex: "<json>[\\s\\S]*?</json>" });
    old.host.regexScripts.set("copy", { ...kept, id: "copy", scriptId: "copy" });
    const next = old.restart();
    next.body(await next.send({ type: "lre.hello", chatId }));
    await next.host.settle();
    expect(scriptsOf(next, chatId).map((s) => s.id)).toEqual([kept.id]);
    expect(scriptsOf(next, chatId)[0]?.findRegex).not.toBe("<json>[\\s\\S]*?</json>");
  });

  test("deleting a world removes its chats' scripts; another world's chats keep theirs", async () => {
    const rig = new Rig();
    const gone = await rig.worldChat();
    const kept = await rig.worldChat();
    const run = await rig.rt.runOf(gone, rig.host.userId);
    rig.body(await rig.send({ type: "lre.world", op: "delete", worldId: run?.worldId ?? "" }));
    expect(scriptsOf(rig, gone)).toEqual([]);
    expect(scriptsOf(rig, kept)).toHaveLength(1);
  });
});
