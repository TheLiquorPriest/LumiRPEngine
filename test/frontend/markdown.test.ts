// The safe Markdown subset a model's answer is shown in (GM → Assistant): every character reaches the
// page as text, never as markup, and only paragraphs, lists, bold, italics and inline code become
// elements; a link is its words and address, an image its description.

import { describe, expect, test } from "bun:test";
import type { VNode } from "preact";
import { markdown, markdownBlocks } from "../../src/frontend/markdown";
import { propsOf, type Props } from "../support/tree";

function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** Every element in a tree: its type, and each prop it carries. */
function elements(node: unknown): { type: unknown; props: string[] }[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const v = node as VNode<Props>;
  return [{ type: v.type, props: Object.keys(v.props) }, ...elements(v.props.children)];
}

const ALLOWED = ["div", "p", "ul", "ol", "li", "strong", "em", "code", "pre", "blockquote"];

describe("an answer's Markdown", () => {
  test("HTML in it stays text: no script, tag or image becomes an element, and nothing is set as raw HTML", () => {
    const text = '<script>alert("x")</script> and <b>bold</b>, <img src=x onerror="alert(1)"> and <a href="javascript:alert(1)">a link</a>\n\n- <i>one</i>';
    const tree = markdown(text, "answer");
    const all = elements(tree);
    expect(all.every((e) => ALLOWED.includes(String(e.type)))).toBe(true);
    expect(all.some((e) => e.props.includes("dangerouslySetInnerHTML"))).toBe(false);
    for (const tag of ["script", "b", "img", "a", "i"]) expect(propsOf(tree, tag)).toEqual([]);
    expect(textOf(tree)).toContain('<script>alert("x")</script> and <b>bold</b>, <img src=x onerror="alert(1)"> and <a href="javascript:alert(1)">a link</a>');
    expect(propsOf(tree, "li").map((p) => textOf(p.children))).toEqual(["<i>one</i>"]);
  });

  test("bold, italics and inline code become their elements; code keeps what is in it as written", () => {
    const tree = markdown("**Danny** knows, __Priya__ doesn't; *maybe* _Jordan_ suspects. Ask `people_where` or `**not bold**`.", "answer");
    expect(propsOf(tree, "strong").map((p) => textOf(p.children))).toEqual(["Danny", "Priya"]);
    expect(propsOf(tree, "em").map((p) => textOf(p.children))).toEqual(["maybe", "Jordan"]);
    expect(propsOf(tree, "code").map((p) => textOf(p.children))).toEqual(["people_where", "**not bold**"]);
    expect(textOf(tree)).toBe("Danny knows, Priya doesn't; maybe Jordan suspects. Ask people_where or **not bold**.");
    // Emphasis nests; an underscore inside a word, a lone star, an unclosed mark and an escaped one stay as written.
    const nested = markdown("**bold *and italic* too**", "answer");
    expect(propsOf(propsOf(nested, "strong")[0]?.children, "em").map((p) => textOf(p.children))).toEqual(["and italic"]);
    const plain = markdown("snake_case_name, 2 * 3 * 4, **unclosed and \\*stars\\*", "answer");
    expect([propsOf(plain, "strong").length, propsOf(plain, "em").length]).toEqual([0, 0]);
    expect(textOf(plain)).toBe("snake_case_name, 2 * 3 * 4, **unclosed and *stars*");
  });

  test("blank lines part paragraphs, a single line break stays inside one, and lists are lists, numbered from their first number", () => {
    const text = "Who knows:\nthe ones who were there.\n\n- **Danny Okafor**: saw it\n- Priya Nair\n  heard it later\n* Marcus\n\n3. First\n4) Then\n\nThat's all.";
    expect(markdownBlocks(text)).toEqual([
      { kind: "p", lines: ["Who knows:", "the ones who were there."] },
      { kind: "ul", items: ["**Danny Okafor**: saw it", "Priya Nair\nheard it later", "Marcus"] },
      { kind: "ol", start: 3, items: ["First", "Then"] },
      { kind: "p", lines: ["That's all."] },
    ]);
    const tree = markdown(text, "answer");
    expect(propsOf(tree, "p").map((p) => textOf(p.children))).toEqual(["Who knows:\nthe ones who were there.", "That's all."]);
    expect(propsOf(tree, "ul").flatMap((u) => propsOf(u.children, "li")).map((li) => textOf(li.children))).toEqual(["Danny Okafor: saw it", "Priya Nair\nheard it later", "Marcus"]);
    expect(propsOf(tree, "ol").map((o) => o.start)).toEqual([3]);
    expect(propsOf(tree, "ol").flatMap((o) => propsOf(o.children, "li")).map((li) => textOf(li.children))).toEqual(["First", "Then"]);
    // A bold line isn't a bullet, and a table or a rule stays as written.
    expect(markdownBlocks("**Note** this\n| a | b |\n---")).toEqual([{ kind: "p", lines: ["**Note** this", "| a | b |", "---"] }]);
  });

  test("a heading, whatever its level, is one modest heading style with its level kept and its marks read; seven #s, or none with words after it, is no heading", () => {
    const text = "# Who knows\n### The **debt**\n###### Last ##\n####### seven\n#hashtag\n#\nAfter.";
    expect(markdownBlocks(text)).toEqual([
      { kind: "h", level: 1, text: "Who knows" },
      { kind: "h", level: 3, text: "The **debt**" },
      { kind: "h", level: 6, text: "Last" },
      { kind: "p", lines: ["####### seven", "#hashtag"] },
      { kind: "p", lines: ["After."] },
    ]);
    const tree = markdown(text, "answer");
    const headings = propsOf(tree, "p").filter((p) => p.role === "heading");
    expect(headings.map((p) => [p["aria-level"], p.class, textOf(p.children)])).toEqual([
      [1, "lre-md-h", "Who knows"],
      [3, "lre-md-h", "The debt"],
      [6, "lre-md-h", "Last"],
    ]);
    expect(propsOf(headings[1]?.children, "strong").map((p) => textOf(p.children))).toEqual(["debt"]);
    for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"]) expect(propsOf(tree, tag)).toEqual([]);
  });

  test("fenced code is pre and code with its text kept exactly: HTML and marks in it stay text, a longer or other fence closes nothing, and one never closed runs to the end", () => {
    const text = "Run:\n```ts\nconst a = `x`;  \n  <script>alert(1)</script>\n\n**not bold** \\* [x](y)\n```\nThen\n~~~~\n```\nstill code\n~~~~\n   ```\n   indented\n     more\n   ```\n```\nunclosed <b>x</b>";
    const code = "const a = `x`;  \n  <script>alert(1)</script>\n\n**not bold** \\* [x](y)";
    expect(markdownBlocks(text)).toEqual([
      { kind: "p", lines: ["Run:"] },
      { kind: "code", text: code },
      { kind: "p", lines: ["Then"] },
      { kind: "code", text: "```\nstill code" },
      { kind: "code", text: "indented\n  more" },
      { kind: "code", text: "unclosed <b>x</b>" },
    ]);
    const tree = markdown(text, "answer");
    const all = elements(tree);
    expect(all.every((e) => ALLOWED.includes(String(e.type)))).toBe(true);
    expect(all.some((e) => e.props.includes("dangerouslySetInnerHTML"))).toBe(false);
    for (const tag of ["script", "b", "a", "strong", "em"]) expect(propsOf(tree, tag)).toEqual([]);
    expect(propsOf(tree, "pre").map((pre) => propsOf(pre.children, "code").map((c) => c.children))).toEqual([[code], ["```\nstill code"], ["indented\n  more"], ["unclosed <b>x</b>"]]);
  });

  test("a quote is a blockquote whose lines are read as blocks of their own, a quote inside it nested", () => {
    const text = "> Danny said:\n> **don't** tell Priya\n>\n> - the debt\n> - the van\n> > and older still\n\nAfter.";
    expect(markdownBlocks(text)).toEqual([
      {
        kind: "quote",
        blocks: [
          { kind: "p", lines: ["Danny said:", "**don't** tell Priya"] },
          { kind: "ul", items: ["the debt", "the van"] },
          { kind: "quote", blocks: [{ kind: "p", lines: ["and older still"] }] },
        ],
      },
      { kind: "p", lines: ["After."] },
    ]);
    const tree = markdown(text, "answer");
    const [outer, inner] = propsOf(tree, "blockquote");
    expect(propsOf(outer?.children, "strong").map((p) => textOf(p.children))).toEqual(["don't"]);
    expect(propsOf(outer?.children, "li").map((p) => textOf(p.children))).toEqual(["the debt", "the van"]);
    expect(textOf(inner?.children)).toBe("and older still");
    expect(textOf((tree as VNode<Props>).props.children)).toBe("Danny said:\ndon't tell Priyathe debtthe vanand older stillAfter.");
  });

  test("a link is its words with its address after them, never a link; an image is its description, never loaded", () => {
    const tree = markdown("See [the ledger](https://example.com/ledger) and <https://example.com>, or [https://example.com](https://example.com). ![a map of the harbor](https://example.com/map.png)", "answer");
    expect(propsOf(tree, "a")).toEqual([]);
    expect(propsOf(tree, "img")).toEqual([]);
    expect(textOf(tree)).toBe("See the ledger (https://example.com/ledger) and <https://example.com>, or https://example.com. a map of the harbor");
    // Bold words in a link stay bold.
    expect(propsOf(markdown("[**the ledger**](https://example.com)", "answer"), "strong").map((p) => textOf(p.children))).toEqual(["the ledger"]);
  });

  test("the container carries the class it is given", () => {
    expect((markdown("Hi.", "lre-gm-assist-msg-text") as VNode<Props>).props.class).toBe("lre-md lre-gm-assist-msg-text");
  });
});
