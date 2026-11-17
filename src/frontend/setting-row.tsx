// One setting's row (a pack's config fields lay their settings out with it): its name, a Changed
// badge while it differs from its default, its control, a line of help, and only while changed, its
// default and Default. Hook-free, so tests press what renders without a DOM. Styles: styles/settings.ts.

import type { ComponentChildren } from "preact";
import { Badge, Button } from "./components";

/** "Changed", or how many are: a row's settings that differ from their defaults. */
export function ChangedBadge(props: { count?: number }) {
  return <Badge tone="accent">{props.count === undefined ? "Changed" : `${props.count} changed`}</Badge>;
}

/** A setting's way back to its default: what the button says to a screen reader, the default in words, and the reset. */
export interface Reset {
  label: string;
  to: ComponentChildren;
  onClick(): void;
}

/**
 * One setting: its name, a Changed badge while it differs from its default, its control, a line of
 * help, and only while changed, its default and Default. A `bare` row's control shows its own name
 * (a switch, a select, a stepper), so the row names it only to screen readers and its Default.
 */
export function SettingRow(props: { id: string; label: string; changed: boolean; bare?: boolean; reset?: Reset; help?: ComponentChildren; busy: boolean; children?: ComponentChildren }) {
  const reset = props.changed ? props.reset : undefined;
  return (
    <div class="lre-set-row" data-lre-setting={props.id} data-lre-changed={props.changed ? "" : undefined}>
      {props.bare && !props.changed ? null : (
        <div class={props.bare ? "lre-set-row-head bare" : "lre-set-row-head"}>
          {props.bare ? null : <span class="lre-set-row-label">{props.label}</span>}
          {props.changed ? <ChangedBadge /> : null}
        </div>
      )}
      {props.children}
      {props.help !== undefined ? <span class="lre-field-help">{props.help}</span> : null}
      {reset ? (
        <div class="lre-set-row-default">
          <span class="lre-small lre-muted">Default: {reset.to}</span>
          <Button size="sm" variant="ghost" icon="undo" label={reset.label} disabled={props.busy} onClick={reset.onClick}>
            Default
          </Button>
        </div>
      ) : null}
    </div>
  );
}
