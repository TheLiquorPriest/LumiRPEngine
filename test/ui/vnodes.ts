// Reading what a view draws without a browser: the pages' views hold no state of their own, so each
// component can be called with its props, down to plain elements, and the tree searched for text,
// buttons and marks.

import type { VNode } from "preact";

type Props = Record<string, unknown> & { children?: unknown };

/** A component of the page that reads the app through a hook, which a call made with no page to render in cannot, drawn by a stand-in of the test's own. */
export type Stand = ReadonlyMap<unknown, (props: Props) => unknown>;

/** The tree with every component called, down to plain elements. */
export function expand(node: unknown, stand?: Stand): unknown {
  if (Array.isArray(node)) return node.map((each) => expand(each, stand));
  if (node === null || typeof node !== "object" || !("type" in node)) return node;
  const vnode = node as VNode<Props>;
  if (typeof vnode.type === "function") return expand((stand?.get(vnode.type) ?? (vnode.type as (props: Props) => unknown))(vnode.props), stand);
  return { ...vnode, props: { ...vnode.props, children: expand(vnode.props.children, stand) } };
}

/** Every word an expanded tree shows, in order. */
export function textOf(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node !== null && typeof node === "object" && "props" in node) return textOf((node as VNode<Props>).props.children);
  return "";
}

/** Every element of an expanded tree, with its tag and props, in order. */
export function elements(node: unknown): { type: string; props: Props }[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const vnode = node as VNode<Props>;
  return [{ type: String(vnode.type), props: vnode.props }, ...elements(vnode.props.children)];
}

/** Each banner a view shows, in order: its title, and everything it says, its title included. */
export function banners(tree: unknown): { title: string; text: string }[] {
  return elements(tree)
    .filter((e) => typeof e.props.class === "string" && e.props.class.startsWith("lre-banner ") && e.props.role !== undefined)
    .map((e) => ({ title: textOf(elements(e.props.children).find((c) => c.props.class === "lre-banner-title")?.props.children), text: textOf(e.props.children) }));
}

/** Presses the one button whose words are `text`. */
export function press(tree: unknown, text: string): void {
  const found = elements(tree).filter((e) => e.type === "button" && textOf(e.props.children) === text);
  const [button] = found;
  if (found.length !== 1 || button === undefined) throw new Error(`${found.length} buttons “${text}”`);
  const onClick = button.props.onClick;
  if (typeof onClick !== "function") throw new Error(`“${text}” does nothing`);
  onClick();
}
