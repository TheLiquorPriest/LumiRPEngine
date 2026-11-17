// Where a page shows one of the kept views (Build, Play, the things browser): a root of its own, in which the
// kept chunk mounts the view once the shell has loaded the chunk (`chunk-api.ts`). While it loads the page says
// so, and if it cannot be had the page says why, in the shell's own words for it; leaving the page takes the
// view away, and a change of `keys` (the chat it is about) mounts it again.

import { useEffect, useRef, useState } from "preact/hooks";
import { useApp } from "../app";
import { Banner } from "../atoms";
import { errorWords } from "../words";
import type { KeptChunk } from "./chunk-api";

type Loading = { phase: "loading" } | { phase: "ready" } | { phase: "failed"; words: string };

export function KeptSlot(props: { class: string; keys: readonly unknown[]; mount(kept: KeptChunk, root: HTMLElement): () => void }) {
  const app = useApp();
  const root = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState<Loading>({ phase: "loading" });
  useEffect(() => {
    const at = root.current;
    if (at === null) return undefined;
    let live = true;
    let stop: (() => void) | null = null;
    setLoading({ phase: "loading" });
    app.kept().then(
      (kept) => {
        if (!live) return;
        stop = props.mount(kept, at);
        setLoading({ phase: "ready" });
      },
      (error: unknown) => {
        if (live) setLoading({ phase: "failed", words: errorWords(error) });
      },
    );
    return () => {
      live = false;
      stop?.();
    };
  }, props.keys);
  return (
    <>
      {loading.phase === "loading" ? <p class="lre-muted rpe-line">Loading this view…</p> : null}
      {loading.phase === "failed" ? (
        <Banner tone="neg" icon="alert" title="This view could not be loaded">
          <span>{loading.words}</span>
        </Banner>
      ) : null}
      <div ref={root} class={props.class} />
    </>
  );
}
