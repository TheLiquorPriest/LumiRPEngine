// The drawer tab "LumiRPEngine" (DESIGN §12): Play, Build and Settings. On mobile the content keeps
// clear of the host's chat-head bubbles on the right edge (DESIGN §12) through a measured gutter.

import { useEffect, useRef } from "preact/hooks";
import type { Section } from "./app";
import { useApp, useUi } from "./app";
import { Build } from "./build/build";
import { Seg } from "./components";
import { rightGutter } from "./layout";
import { Play } from "./play/play";
import { Settings } from "./settings/settings";
import { useSelect } from "./store";

export function Drawer(props: { measure(el: HTMLElement): { x: number; y: number; width: number; height: number } }) {
  const app = useApp();
  const section = useUi((ui) => ui.section);
  const viewport = useSelect(app.host.viewport, (vp) => vp);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const apply = () => el.style.setProperty("--lre-gutter", `${rightGutter(props.measure(el), viewport)}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    // The host slides the drawer in with a transform, which no ResizeObserver sees: re-measure when it settles.
    document.addEventListener("transitionend", apply, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("transitionend", apply, true);
    };
  }, [viewport]);
  return (
    <div ref={root} class="lre lre-drawer" data-lre-panel="drawer" data-lre-active={section}>
      <div class="lre-top">
        <Seg<Section>
          label="LumiRPEngine sections"
          value={section}
          options={[
            { value: "play", label: "Play" },
            { value: "build", label: "Build" },
            { value: "settings", label: "Settings" },
          ]}
          onChange={(next) => app.ui.update((ui) => ({ ...ui, section: next }))}
        />
      </div>
      {section === "play" ? <Play /> : section === "build" ? <Build /> : <Settings />}
    </div>
  );
}
