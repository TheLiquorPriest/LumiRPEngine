// What the state view does not carry, read when a sheet that draws it opens (an organization's page, its money, who may use a thing of
// the player's): by its own request, when the sheet opens and again whenever the state the sheet shows changes. What was read last
// stays shown while the next is read.

import { useEffect, useState } from "preact/hooks";
import type { ResultBodies } from "../shared/protocol";
import type { StateView } from "../shared/state-view";
import { useApp } from "./app";
import type { RequestBody } from "./registry";

/** A read apart as a sheet holds it: being read the first time, read, or a first read that failed (the request has said why). */
export type ReadApart<T> = { status: "reading" } | { status: "read"; value: T } | { status: "failed" };

/** What `body` asks (nothing for null), read when it is first asked and again whenever `state` is another. */
export function useReadApart<K extends keyof ResultBodies>(body: Extract<RequestBody, { type: K }> | null, state: StateView): ReadApart<ResultBodies[K]> {
  const app = useApp();
  const asked = body === null ? null : JSON.stringify(body);
  const [held, setHeld] = useState<{ asked: string; read: ReadApart<ResultBodies[K]> } | null>(null);
  useEffect(() => {
    if (body === null || asked === null) return;
    let live = true;
    void app.request<K>(body).then((answer) => {
      if (!live) return;
      // A read that failed keeps what was read before it.
      setHeld((was) => (answer !== null ? { asked, read: { status: "read", value: answer } } : was?.asked === asked ? was : { asked, read: { status: "failed" } }));
    });
    return () => {
      live = false;
    };
  }, [asked, state]);
  return held !== null && held.asked === asked ? held.read : { status: "reading" };
}
