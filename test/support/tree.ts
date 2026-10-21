// Walking rendered Preact trees without a DOM, as the settings controls' tests do: find a control by
// its component and label, and press it through the props its screen handed it.

import type { VNode } from "preact";

export type Props = Record<string, unknown>;

/** The props of every element of `type` in a rendered tree, in order. */
export function propsOf(node: unknown, type: unknown): Props[] {
  if (Array.isArray(node)) return node.flatMap((n) => propsOf(n, type));
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const v = node as VNode<Props>;
  return [...(v.type === type ? [v.props] : []), ...propsOf(v.props.children, type)];
}

/** The one element of `type` labelled `label`. */
export function labelled(node: unknown, type: unknown, label: string): Props {
  const found = propsOf(node, type).filter((p) => p.label === label);
  if (found.length !== 1) throw new Error(`${found.length} controls labelled ${label}`);
  return found[0] ?? {};
}

export function press(props: Props, value: unknown): void {
  const onChange = props.onChange;
  if (typeof onChange !== "function") throw new Error("not a control");
  onChange(value);
}

/** A component element rendered one level down, so the controls it lays out can be pressed. */
export function expand(node: unknown): unknown {
  if (!node || typeof node !== "object" || !("type" in node) || typeof node.type !== "function") throw new Error("not a component");
  const v = node as VNode<Props>;
  return (v.type as (props: Props) => unknown)(v.props);
}
