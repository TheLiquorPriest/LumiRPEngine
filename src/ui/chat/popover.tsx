// A small panel drawn over Lumiverse's chat, fixed to the screen above the control that opened it so the
// composer's own clipping cannot cut it, kept inside the screen on a phone, closed by a press outside
// it or by Escape.

import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

const MARGIN = 8;
const GAP = 6;

export function Popover(props: { anchor: HTMLElement | null; label: string; onClose(): void; children: ComponentChildren }) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; bottom: number } | null>(null);
  const { anchor, onClose } = props;
  const lay = (): void => {
    const own = panel.current;
    if (anchor === null || own === null) return;
    const at = anchor.getBoundingClientRect();
    const width = own.offsetWidth;
    // Right edges line up where there is room, and the panel never leaves the screen.
    const left = Math.max(MARGIN, Math.min(at.right - width, window.innerWidth - width - MARGIN));
    setPlace({ left, bottom: Math.max(MARGIN, window.innerHeight - at.top + GAP) });
  };
  useLayoutEffect(lay, [anchor]);
  useEffect(() => {
    const away = (event: Event): void => {
      const target = event.target as Node | null;
      if (target !== null && (panel.current?.contains(target) || anchor?.contains(target))) return;
      onClose();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", lay);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", lay);
    };
  }, [anchor]);
  return (
    <div ref={panel} class="lre rpe-chat-pop" role="dialog" aria-label={props.label} style={place === null ? { left: "0px", bottom: "0px", visibility: "hidden" } : { left: `${place.left}px`, bottom: `${place.bottom}px` }}>
      {props.children}
    </div>
  );
}
