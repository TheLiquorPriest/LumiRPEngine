// One organization's page, read when a sheet over it opens (its page in Orgs, one of its editors, its money): the state view carries
// only each page's summary (`orgs.summary`), and the page itself is read by its own request (`lre.org`) when the sheet opens and again
// whenever the state the sheet shows changes. The page read last stays shown while the next is read.

import { useEffect, useState } from "preact/hooks";
import type { ChatId, EntityId } from "../shared/ids";
import type { OrgView } from "../shared/org-view";
import type { StateView } from "../shared/state-view";
import { useApp } from "./app";

/** An organization's page as a sheet reads it: being read the first time, read (null: the player character knows of no such organization), or a first read that failed (the request has said why). */
export type OrgPageRead = { status: "reading" } | { status: "read"; page: OrgView | null } | { status: "failed" };

/** The page of `org` (none read for null), read when it is first asked and again whenever `state` is another. */
export function useOrgPage(chatId: ChatId, org: EntityId | null, state: StateView): OrgPageRead {
  const app = useApp();
  const [held, setHeld] = useState<{ org: EntityId; read: OrgPageRead } | null>(null);
  useEffect(() => {
    if (org === null) return;
    let live = true;
    void app.request({ type: "lre.org", chatId, org }).then((answer) => {
      if (!live) return;
      // A read that failed keeps the page read before it.
      setHeld((was) => (answer !== null ? { org, read: { status: "read", page: answer.page } } : was?.org === org ? was : { org, read: { status: "failed" } }));
    });
    return () => {
      live = false;
    };
  }, [chatId, org, state]);
  return held !== null && held.org === org ? held.read : { status: "reading" };
}
