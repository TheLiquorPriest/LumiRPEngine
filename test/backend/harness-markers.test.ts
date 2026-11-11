// The marked spans of a harness prompt (`backend/harness/markers.ts`), as plain text in and out: a
// part between its turn's markers, swapped whole for the turn's own; what a span keeps when no turn
// made anything; what goes where nothing marked a place; and the author's brief as the outline.

import { describe, expect, test } from "bun:test";
import { briefLines, markedText, markerNonce, placeParts, withoutBrief } from "../../src/backend/harness/markers";
import type { ModelMessage } from "../../src/backend/harness/shapes";

const NONCE = markerNonce("generation-one");
const OTHER = markerNonce("generation-two");
const system = (content: string): ModelMessage => ({ role: "system", content });
const user = (content: string): ModelMessage => ({ role: "user", content });

describe("marked spans", () => {
  test("a part is held between a start and an end marker of its turn, each a comment line of its own", () => {
    const held = markedText("scene", NONCE, "[Scene]\nThe kitchen, early.");
    const lines = held.split("\n");
    expect(lines.length).toBe(4);
    expect(lines[0]).toMatch(/^\/\/ lre:[0-9a-f]{8}:[0-9a-f]{8}$/);
    expect(lines[3]).toBe(`${lines[0]}:end`);
    expect(lines.slice(1, 3)).toEqual(["[Scene]", "The kitchen, early."]);
    // A part with nothing to tell is marked all the same, so the turn's own can be put there.
    expect(markedText("outcome", NONCE, "").split("\n")).toEqual([expect.stringMatching(/^\/\/ lre:[0-9a-f]{8}:[0-9a-f]{8}$/), expect.stringMatching(/:end$/)]);
    // Each turn marks its own, and each part its own, whatever a world calls the part.
    expect(markerNonce("generation-one")).toBe(NONCE);
    expect(OTHER).not.toBe(NONCE);
    expect(markedText("scene", NONCE, "x")).not.toBe(markedText("people", NONCE, "x"));
    expect(markedText("a part: with {{braces}} <and> spaces", NONCE, "x").split("\n")[0]).toMatch(/^\/\/ lre:[0-9a-f]{8}:[0-9a-f]{8}$/);
  });

  test("the turn's part takes its span's place whole; an empty one leaves nothing, and a message it empties goes", () => {
    const messages = [system(`Story so far.\n${markedText("scene", NONCE, "[Scene]\nAs it stood.")}\n${markedText("outcome", NONCE, "")}\nEnd.`), system(markedText("people", NONCE, "[People]\nAs they stood.")), system(markedText("montage", NONCE, "[Montage]\nEarlier.")), user("I wait.")];
    const out = placeParts(
      messages,
      [
        { part: "scene", text: "[Scene]\nAs the turn left it." },
        { part: "people", text: "[People]\nAs the turn left them." },
      ],
      NONCE,
    );
    expect(out.messages).toEqual([system("Story so far.\n[Scene]\nAs the turn left it.\n\nEnd."), system("[People]\nAs the turn left them."), user("I wait.")]);
    expect(out.placed.sort()).toEqual(["people", "scene"]);
    // A message that holds nothing of the engine's is the same message, untouched.
    expect(out.messages[2]).toBe(messages[3]);
  });

  test("a part no span placed goes before the last user message, with the others like it, or at the end without one", () => {
    const parts = [
      { part: "scene", text: "[Scene]\nNow." },
      { part: "people", text: "[People]\nNow." },
      { part: "outcome", text: "" },
    ];
    const out = placeParts([system("Rules."), user("First."), { role: "assistant", content: "Reply." }, user("I wait.")], parts, NONCE);
    expect(out.messages.map((m) => m.content)).toEqual(["Rules.", "First.", "Reply.", "[Scene]\nNow.\n\n[People]\nNow.", "I wait."]);
    expect(out.messages[3]?.role).toBe("system");
    expect(out.placed).toEqual([]);
    expect(placeParts([system("Rules.")], parts, NONCE).messages.map((m) => m.content)).toEqual(["Rules.", "[Scene]\nNow.\n\n[People]\nNow."]);
  });

  test("another turn's span is taken out whole, and a marker with no partner alone", () => {
    const stale = markedText("scene", OTHER, "[Scene]\nSTALE");
    const [open, , , close] = markedText("people", NONCE, "[People]\nHeld.").split("\n");
    const out = placeParts([system(`Before.\n${stale}\nAfter.`), system(`${open}\nNo end marker follows.`), system(`A lone end.\n${close}`)], [{ part: "people", text: "[People]\nNow." }], NONCE);
    expect(out.messages.map((m) => m.content)).toEqual(["Before.\n\nAfter.", "[People]\nNow.\nNo end marker follows.", "A lone end.\n"]);
    expect(out.placed).toEqual(["people"]);
  });

  test("with no turn's parts at all, each span of the prompt keeps what it holds and loses its marker lines", () => {
    const messages = [system(`Story so far.\n${markedText("scene", NONCE, "[Scene]\nAs it stood.")}\nEnd.`), system(markedText("outcome", NONCE, "")), system(markedText("scene", OTHER, "[Scene]\nSTALE")), user("I wait.")];
    const out = placeParts(messages, null, NONCE);
    expect(out.messages).toEqual([system("Story so far.\n[Scene]\nAs it stood.\nEnd."), user("I wait.")]);
    expect(out.placed).toEqual([]);
    // Parts given, a span whose part the turn made nothing for is empty now, whatever the head had.
    expect(placeParts(messages, [], NONCE).messages).toEqual([system("Story so far.\n\nEnd."), user("I wait.")]);
  });

  test("a message's text parts are resolved as its content is", () => {
    const held = markedText("scene", NONCE, "[Scene]\nAs it stood.");
    const out = placeParts([{ role: "user", content: held, parts: [{ type: "text", text: held }, { type: "media", media: "image", data: "AA==", mimeType: "image/png" }] }], [{ part: "scene", text: "[Scene]\nNow." }], NONCE);
    expect(out.messages).toEqual([{ role: "user", content: "[Scene]\nNow.", parts: [{ type: "text", text: "[Scene]\nNow." }, { type: "media", media: "image", data: "AA==", mimeType: "image/png" }] }]);
  });
});

describe("the author's brief", () => {
  test("each line of the brief is a line of the outline, without its list marker", () => {
    expect(briefLines("- Mara says noon.\n\n  * Okoro arrives early.\n2. Joss says nothing.\nA plain line.")).toEqual(["Mara says noon.", "Okoro arrives early.", "Joss says nothing.", "A plain line."]);
    expect(briefLines(null)).toEqual([]);
    expect(briefLines("  \n")).toEqual([]);
  });

  test("the message the core put the brief in goes only when it is the one system message that holds it", () => {
    const brief = "- Mara says noon.";
    const framed = system(`The brief:\n${brief}`);
    expect(withoutBrief([system("Rules."), framed, user("I wait.")], brief)).toEqual([system("Rules."), user("I wait.")]);
    // Inside the player's own message, held twice, or no brief at all: the messages stay as they are.
    const inUser = [user(`I wait.\n${brief}`)];
    expect(withoutBrief(inUser, brief)).toEqual(inUser);
    const twice = [framed, system(`Again: ${brief}`), user("I wait.")];
    expect(withoutBrief(twice, brief)).toEqual(twice);
    expect(withoutBrief([framed], null)).toEqual([framed]);
  });
});
