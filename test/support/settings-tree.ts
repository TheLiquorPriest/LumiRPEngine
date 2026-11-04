// Settings pages rendered all the way down without a DOM, for the settings kit's tests: each
// component called with its props, but the controls a test presses (and any with hooks of its own,
// which can't run outside a render) left as they are, so `propsOf` finds them by type. And every word
// a rendered page shows or names a control with, for tests of what the pages say.

import type { VNode } from "preact";
import { Button, HostModelPicker, HostSelect, HostSwitch, NumberStepper, Seg } from "../../src/frontend/components";
import { NavRow, ToggleChips } from "../../src/frontend/settings/kit";
import { ConnectionSelect } from "../../src/frontend/settings/steps";

/** The controls a settings page is pressed through. */
const LEAVES = new Set<unknown>([Button, HostModelPicker, HostSelect, HostSwitch, NumberStepper, Seg, ConnectionSelect, ToggleChips, NavRow]);

type Node = VNode<Record<string, unknown>>;

/** `node` rendered down to the controls: a component with hooks of its own stays as it is, as a control does. */
export function rendered(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(rendered);
  if (!node || typeof node !== "object" || !("type" in node) || !("props" in node)) return node;
  const v = node as Node;
  if (typeof v.type === "function" && !LEAVES.has(v.type)) {
    let out: unknown;
    try {
      out = (v.type as (props: unknown) => unknown)(v.props);
    } catch {
      return v;
    }
    return rendered(out);
  }
  return { type: v.type, props: { ...v.props, children: rendered(v.props.children) } };
}

/** The props that carry words: a control's name, a row's title and line, a field's hint. */
const WORDS = ["label", "aria-label", "title", "subtitle", "placeholder", "firstLabel", "help", "noneLabel"] as const;

/** Every word a rendered tree shows: its text, each control's name, each choice's label, the summary of a fold and the aside of a section. */
export function texts(node: unknown): string[] {
  if (typeof node === "string") return node.trim() === "" ? [] : [node];
  if (typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const props = (node as Node).props;
  const own = WORDS.flatMap((key) => (typeof props[key] === "string" ? [props[key] as string] : []));
  const options = Array.isArray(props.options) ? (props.options as { label?: unknown }[]).flatMap((o) => (typeof o.label === "string" ? [o.label] : [])) : [];
  return [...own, ...options, ...texts(rendered(props.summary)), ...texts(rendered(props.aside)), ...texts(rendered(props.badge)), ...texts(props.children)];
}
