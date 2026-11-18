// GM mode's things browser, kept on the World page behind its spoiler gate (plan §14 l.1539; PlanChatUI-P6, -P7): today's
// GM → Things (Here, By place, By owner, Find, a thing's page, a person's things, Select and the bulk bar, + Add, Tidy up and Keep
// in the world), over a kept App of its own for the chat (`app.ts`) whose call files read RPE's typed routes. The GM view's parts it
// reads load as GM mode loaded them (`useGmParts`), again when the chat moves on. Every change is his own edit through the taps
// route, sent in edits of at most `engine.editOps` operations each, with one Undo for all of them; after one applies, a notice says
// what it did with that Undo. The bounds its controls hold to are RPE's settings, read when it mounts. The World page shows it only
// with its gate open (`things-page.tsx`), which loads the kept chunk (`chunk.ts`) that mounts it here.

import { render } from "preact";
import { useState } from "preact/hooks";
import { AppContext as TodayContext, useApp as useToday } from "../../frontend/app";
import { chunks } from "../../frontend/batch";
import { Empty, Toasts, useBusy } from "../../frontend/components";
import { setCurrency } from "../../frontend/format";
import { type BulkEditor, editNotice, type EditNotice, noticeStands, sendEdits } from "../../frontend/gm/editor";
import { partsOf } from "../../frontend/gm/parts";
import { ThingsSection } from "../../frontend/gm/things";
import { EditNoticeBar } from "../../frontend/gm/ui";
import { gmReloadKey, useGmParts } from "../../frontend/gm/use-gm-parts";
import { editRequest } from "../../frontend/requests";
import type { EditOp } from "../../shared/edit-ops";
import { DEFAULT_CURRENCY } from "../../shared/world";
import type { RpeClient } from "../client";
import { useSelect, createStore } from "../store";
import { keptApp } from "./app";
import { CATALOG } from "./catalog";
import { PLAY_CSS } from "./play/styles";
import type { PlayMount } from "./play/mount";

type Limits = BulkEditor["limits"];

/** The bounds as RPE's settings give them for the chat: one edit's operations, one move's things, and the fewest a Tidy up run shows. */
async function limitsOf(client: Pick<RpeClient, "call">, chat: string): Promise<Limits> {
  const read = await client.call("GET /api/v1/settings", {}, { query: { chat } });
  const of = (key: string) => read.settings.find((s) => s.key === key);
  const whole = (key: string): number => {
    const value = of(key)?.value;
    if (typeof value !== "number") throw new Error(`RPE gave no value for ${key}.`);
    return value;
  };
  const takes = of("things.tidyRunMost")?.takes;
  const least = (takes !== undefined && "least" in takes ? takes.least : undefined) ?? 1;
  return { editOps: whole("engine.editOps"), thingsMost: whole("taps.thingsMost"), tidyRunLeast: least };
}

/** The browser over the kept App: the GM view's things parts, the editor every control sends through, and the notice with its Undo. */
function Browser(props: { chat: string; limits: Limits }) {
  const app = useToday();
  const view = useSelect(app.sync, (s) => s.view);
  const [notice, setNotice] = useState<EditNotice | null>(null);
  const [busy, run] = useBusy();
  const page = useGmParts(app, props.chat, true, partsOf("things"), view === null ? "" : (view.gmKey ?? gmReloadKey(view)), view?.status ?? "idle");
  if (page.gm === null) return <Empty icon="hourglass">Reading this chat's things…</Empty>;
  const commit = (sendAll: (send: (ops: EditOp[]) => Promise<boolean>) => Promise<{ applied: number; of: number }>, done?: (count: number) => string) => {
    const { promise, resolve } = Promise.withResolvers<{ applied: number; of: number }>();
    run(async () => {
      const sent = await sendEdits(sendAll, (ops) => app.request(editRequest(props.chat, ops)));
      if (sent.applied > 0) {
        const loaded = await page.load();
        if (sent.undo.length > 0) setNotice(editNotice(sent.undo, loaded?.edits ?? [], done?.(sent.count)));
      }
      resolve({ applied: sent.applied, of: sent.of });
    });
    return promise;
  };
  const sendAll = (ops: readonly EditOp[]) => async (send: (ops: EditOp[]) => Promise<boolean>) => {
    const all = chunks(ops, props.limits.editOps);
    let applied = 0;
    for (const chunk of all) {
      if (!(await send(chunk))) break;
      applied++;
    }
    return { applied, of: all.length };
  };
  const undo = (edits: readonly string[]) =>
    run(async () => {
      for (const chip of edits) if (!(await app.request({ type: "lre.chip", chatId: props.chat, chip, choice: "undo" }))) break;
      setNotice(null);
      await page.load();
    });
  const editor: BulkEditor = {
    gm: page.gm,
    currency: view?.currency ?? DEFAULT_CURRENCY,
    busy,
    reloadKey: page.reloadKey,
    need: page.need,
    limits: props.limits,
    edit: (ops, done) => commit(sendAll(ops), done === undefined ? undefined : () => done).then((outcome) => outcome.applied > 0),
    editAll: (ops, done) => commit(sendAll(ops), done),
  };
  const shown = notice !== null && noticeStands(notice, page.gm) ? notice : null;
  return (
    <div class="lre-stack lre-gm" data-lre-kept-things={props.chat}>
      {shown ? <EditNoticeBar notice={shown} busy={busy} onUndo={() => undo(shown.undo)} onDismiss={() => setNotice(null)} /> : null}
      <ThingsSection editor={editor} chatId={props.chat} />
    </div>
  );
}

/** What the things browser is given to mount: what the Play view is. */
export type ThingsMount = PlayMount;

/**
 * The things browser for `mount.chat` in `root`: a kept App of its own while it shows, taken away with all it started. It reads the
 * bounds first; if they cannot be read it says so where the browser would be.
 */
export function mountThings(root: HTMLElement, mount: ThingsMount): () => void {
  let live = true;
  let stop: (() => void) | null = null;
  void limitsOf(mount.client, mount.chat).then(
    (limits) => {
      if (!live) return;
      const removeStyle = mount.host.addStyle(PLAY_CSS);
      const kept = keptApp({ ...mount, chat: createStore<string | null>(mount.chat), mode: "play", catalog: CATALOG });
      const offCurrency = kept.app.sync.subscribe((held) => setCurrency(held.view?.currency ?? null));
      render(
        <TodayContext.Provider value={kept.app}>
          <div class="lre">
            <Browser chat={mount.chat} limits={limits} />
            <Toasts surface="drawer" />
          </div>
        </TodayContext.Provider>,
        root,
      );
      stop = () => {
        render(null, root);
        kept.stop();
        offCurrency();
        mount.host.dispose();
        removeStyle();
      };
    },
    (error: unknown) => {
      if (!live) return;
      render(<p class="lre-muted rpe-line">{`The things could not be read: ${error instanceof Error ? error.message : String(error)}`}</p>, root);
      stop = () => render(null, root);
    },
  );
  return () => {
    live = false;
    stop?.();
  };
}
