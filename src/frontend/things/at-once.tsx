// Changes to things made at once, off screen (DESIGN §11, ITEMS-SPEC §10.3): one gear action sent
// with `offstage` and no words, or a ✎ fix of one or more things (`lre.fix`, `thing` or `things`),
// each recorded as the player's fix with its Undo. `useAtOnce` sends one and keeps what it did for
// the notice over the list, which offers the Undo (none while a reply is in flight, when it lands
// after it). Play → Me → Belongings, the item sheet, the place sheet's Things here, Move to…,
// Owner & use… and the Garage share them.

import { useState } from "preact/hooks";
import type { ChatId } from "../../shared/ids";
import type { ItemFix } from "../../shared/things";
import { useApp } from "../app";
import { Banner, Button, IconButton, useBusy } from "../components";
import { QUEUED_TOAST } from "../queued";
import type { Req } from "../requests";

/** A ✎ fix of things (`lre.fix {things}`): all or none, one entry with one Undo, its label what the notice says. */
export type ThingsFixRequest = Extract<Req<"lre.fix">, { things: ItemFix[] }>;

export function thingsFix(chatId: ChatId, things: ItemFix[], label: string): ThingsFixRequest {
  return { type: "lre.fix", chatId, things, label };
}

/** What the last change did: its sentence, its Undo chip (none while a reply is in flight), and whether it waits for that reply. */
export interface AtOnceDone {
  text: string;
  undo: string | null;
  pending: boolean;
}

/** A surface's at-once changes: whether one is on its way, the last one done, and the requests. */
export interface AtOnce {
  busy: boolean;
  done: AtOnceDone | null;
  /** Sends one change; `landed` runs once it applied (an answer that isn't an at-once one, staged or played, isn't this surface's). */
  send(request: Req<"lre.action"> | Req<"lre.fix">, text: string, landed?: () => void): void;
  undo(): void;
  dismiss(): void;
}

export function useAtOnce(chatId: ChatId): AtOnce {
  const app = useApp();
  const [busy, run] = useBusy();
  const [done, setDone] = useState<AtOnceDone | null>(null);
  return {
    busy,
    done,
    send: (request, text, landed) =>
      run(async () => {
        const result = request.type === "lre.fix" ? await app.request(request) : await app.request(request);
        if (!result || !("pending" in result)) return;
        setDone({ text, undo: result.undo ?? null, pending: result.pending });
        landed?.();
      }),
    undo: () =>
      run(async () => {
        const chip = done?.undo;
        if (chip && (await app.request({ type: "lre.chip", chatId, chip, choice: "undo" })) !== null) setDone(null);
      }),
    dismiss: () => setDone(null),
  };
}

/** The notice over the list: what was just done (`title`: at once, off screen, unless said otherwise), with its Undo; while a reply is in flight, that it lands after it. Hook-free. */
export function AtOnceNotice(props: { done: AtOnceDone | null; busy: boolean; title?: string; onUndo(): void; onDismiss(): void }) {
  const done = props.done;
  if (!done) return null;
  return (
    <Banner
      tone="info"
      icon="check"
      title={props.title ?? "Done at once, off screen"}
      actions={
        <>
          {done.undo !== null ? (
            <Button size="sm" icon="undo" disabled={props.busy} onClick={props.onUndo}>
              Undo
            </Button>
          ) : null}
          <IconButton icon="close" label="Dismiss" onClick={props.onDismiss} />
        </>
      }
    >
      <span data-lre-manage-done="">{done.pending ? `${done.text} ${QUEUED_TOAST}.` : done.text}</span>
    </Banner>
  );
}
