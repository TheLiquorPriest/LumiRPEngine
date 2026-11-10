// The GM page's view by part (DESIGN §7): the hook GmPanel reads it through. While the truth is
// shown it keeps one chat's parts (`GmParts`): the open tab's are asked for when it opens, and again
// when the chat moves on (`StateView.gmKey`); the rest go stale until their tab opens. While a turn
// runs and the page holds (Settings → Speed → GM page while a turn runs, read each time the truth is
// shown), a move only marks the parts stale, and the page says it shows the chat as it was, with
// Refresh. A page's needs (`Editor.need`) are loaded with the tab's parts while it is open. Hiding
// the truth, or another chat, lets it all go.

import { useEffect, useRef, useState } from "preact/hooks";
import type { GmReadPart } from "../../shared/gm-parts";
import { GM_PAGE_DEFAULTS, gmPageSettingsOf, type GmDuringTurn } from "../../shared/settings";
import type { ChatStatus, GmView } from "../../shared/state-view";
import type { App } from "../app";
import { GmParts, gmReload, type GmNeed, type GmWant } from "./parts";

/** The GM page's view, as `useGmParts` keeps it. */
export interface GmPartsPage {
  /** The open tab's view, once its parts have landed; null before. */
  gm: GmView | null;
  /** The chat's GM key as the parts were last loaded at: what a tab reads besides them it reads again on this (`GmSectionProps.reloadKey`). */
  reloadKey: string;
  /** The chat moved on while a turn runs and the page holds: the open tab shows it as it was, until Refresh (`load`). */
  held: boolean;
  /** Loads the open tab's parts again, with what its page needs (after an edit, an Undo, a change of its own; Refresh); the view once they landed, null once the truth was hidden. */
  load(): Promise<GmView | null>;
  /** `Editor.need`. */
  need(want: GmNeed): () => void;
}

/**
 * The view the open tab reads (`parts`, `partsOf`) of `chatId` while the truth is shown (`revealed`),
 * loaded again when the chat's GM key (`gmKey`) moves, or held as it was while a turn runs (`status`).
 */
export function useGmParts(app: App, chatId: string, revealed: boolean, parts: readonly GmReadPart[], gmKey: string, status: ChatStatus): GmPartsPage {
  const [, rerender] = useState(0);
  const [hold, setHold] = useState<GmDuringTurn>(GM_PAGE_DEFAULTS.duringTurn);
  const cache = useRef<GmParts | null>(null);
  // The GM key the parts were last loaded at (null: not yet), and whether a move since is held.
  const seen = useRef<string | null>(null);
  const holding = useRef(false);
  const needs = useRef(new Map<number, GmNeed>());
  const needSeq = useRef(0);
  const now = useRef({ parts, gmKey });
  now.current = { parts, gmKey };
  if (!revealed) {
    cache.current = null;
    seen.current = null;
    holding.current = false;
  } else if (cache.current?.chatId !== chatId) {
    const made: GmParts = new GmParts(
      chatId,
      (request) => app.request(request),
      () => {
        if (cache.current === made) rerender((n) => n + 1);
      },
    );
    cache.current = made;
    seen.current = null;
    holding.current = false;
  }
  /** The open tab's parts with every open page's needs. */
  const wantOf = (): GmWant => {
    const entities = new Set<string>();
    const money = new Set<string>();
    for (const need of needs.current.values()) {
      for (const id of need.entities ?? []) entities.add(id);
      for (const id of need.money ?? []) money.add(id);
    }
    return { parts: now.current.parts, entities: [...entities], money: [...money] };
  };
  // What the page does while a turn runs, read once each time the truth is shown.
  useEffect(() => {
    if (!revealed) return;
    let live = true;
    void app.request({ type: "lre.settings.get" }).then((result) => {
      if (live && result) setHold(gmPageSettingsOf(result.settings.gm).duringTurn);
    });
    return () => {
      live = false;
    };
  }, [revealed]);
  // Loaded when the truth is shown, and again when the chat moves on (a turn, an edit, an undo), unless held.
  useEffect(() => {
    const kept = cache.current;
    if (!revealed || !kept) return;
    const next = gmReload(seen.current, gmKey, status, hold);
    if (next === "none") return;
    if (seen.current !== null) kept.moved();
    if (next === "hold") {
      holding.current = true;
      rerender((n) => n + 1);
      return;
    }
    seen.current = gmKey;
    holding.current = false;
    void kept.load(wantOf());
  }, [revealed, chatId, gmKey, status, hold]);
  // A tab opened: what it reads that isn't kept, and, unless held, what went stale.
  useEffect(() => {
    if (revealed) void cache.current?.load(wantOf(), { stale: !holding.current });
  }, [revealed, chatId, parts.join(",")]);
  const want = wantOf();
  const kept = cache.current;
  return {
    gm: kept?.view(want) ?? null,
    reloadKey: seen.current ?? "",
    held: holding.current && (kept?.staleIn(want) ?? false),
    load: async () => {
      const loading = cache.current;
      if (!loading) return null;
      if (seen.current !== null) loading.moved();
      seen.current = now.current.gmKey;
      holding.current = false;
      const asked = wantOf();
      await loading.load(asked);
      return cache.current === loading ? loading.view(asked) : null;
    },
    need: (need) => {
      const id = ++needSeq.current;
      needs.current.set(id, need);
      void cache.current?.load(wantOf(), { stale: !holding.current });
      rerender((n) => n + 1);
      return () => {
        if (needs.current.delete(id)) rerender((n) => n + 1);
      };
    },
  };
}
