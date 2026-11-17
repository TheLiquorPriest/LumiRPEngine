// The two form parts the chat's own surfaces share with Build's forms: a sub-editor's own page (the form
// sheet) and a value as a pill (the chip). They live here, apart from Build's form kit, because the HUD's
// fixes and the place picker reach them and the extension's first file holds nothing of Build.
// Styles: styles/forms.ts.

import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "../ui/icons";
import { PageHeader } from "./components";
import { revealInScroller } from "./scroll";

/** Lets a sheet know a sheet opened inside it, so only the innermost one shows. */
const SheetParent = createContext<((open: 1 | -1) => void) | null>(null);

/**
 * A sub-editor's own page (sub-editors open as full pages on phones). The caller
 * renders it in place, only while open. It stays in the flow rather than the top layer, so the
 * host's pickers, confirms and toasts work inside it. While it is open it is all the mode body
 * shows: forms.ts hides everything else and takes its ancestors out of the layout. Back and Escape
 * close it (the innermost one first); focus starts on Back and returns to the control that opened
 * it. Never put one inside a `<label>` or `<details>`.
 */
export function FormSheet(props: { title: ComponentChildren; subtitle?: ComponentChildren; backLabel?: string; actions?: ComponentChildren; onClose(): void; children: ComponentChildren }) {
  const root = useRef<HTMLDivElement>(null);
  const parent = useContext(SheetParent);
  const [inner, setInner] = useState(0);
  // Read while the opener still shows: once the sheet is in, forms.ts hides it.
  const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
  useEffect(() => {
    parent?.(1);
    const el = root.current;
    revealInScroller(el ?? null, "start");
    el?.querySelector<HTMLElement>(".lre-page-header button")?.focus({ preventScroll: true });
    return () => {
      parent?.(-1);
      // The opener shows again once the sheet has left the page.
      setTimeout(() => {
        if (opener?.isConnected) opener.focus();
      }, 0);
    };
  }, []);
  return (
    <SheetParent.Provider value={(open) => setInner((n) => n + open)}>
      <div
        ref={root}
        class="lre-form-sheet"
        data-top={inner === 0 ? "" : undefined}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }}
      >
        <PageHeader title={props.title} subtitle={props.subtitle} onBack={props.onClose} backLabel={props.backLabel} actions={props.actions} />
        <div class="lre-form-sheet-body">{props.children}</div>
      </div>
    </SheetParent.Provider>
  );
}

/**
 * A value as a pill. With `onRemove` it is a button that takes the value away (named by
 * `removeLabel`); with `onToggle` a toggle, pressed while `pressed`; with `onPress` a plain action
 * (a suggestion to insert, named by `label` when its text alone doesn't); with none, just the
 * label. The pill is drawn inside a 40 px tall target.
 */
export function Chip(props: { children: ComponentChildren; onRemove?(): void; removeLabel?: string; onToggle?(): void; pressed?: boolean; onPress?(): void; label?: string; tone?: "warn" | "neg"; disabled?: boolean }) {
  const tone = props.tone ? ` ${props.tone}` : "";
  const onRemove = props.onRemove;
  const onToggle = props.onToggle;
  const onPress = props.onPress;
  if (onRemove) {
    return (
      <button type="button" class={`lre-form-chip${tone}`} aria-label={props.removeLabel} title={props.removeLabel} disabled={props.disabled} onClick={() => onRemove()}>
        <span class="lre-form-chip-text">{props.children}</span>
        <Icon name="close" size={16} />
      </button>
    );
  }
  if (onToggle) {
    return (
      <button type="button" class={`lre-form-chip${tone}`} aria-pressed={props.pressed === true} disabled={props.disabled} onClick={() => onToggle()}>
        {props.pressed ? <Icon name="check" size={16} /> : null}
        <span class="lre-form-chip-text">{props.children}</span>
      </button>
    );
  }
  if (onPress) {
    return (
      <button type="button" class={`lre-form-chip${tone}`} aria-label={props.label} disabled={props.disabled} onClick={() => onPress()}>
        <span class="lre-form-chip-text">{props.children}</span>
      </button>
    );
  }
  return (
    <span class={`lre-form-chip static${tone}`}>
      <span class="lre-form-chip-text">{props.children}</span>
    </span>
  );
}
