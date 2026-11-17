// The Build page (plan §14, "What happens to today's UI"): the page of the navigation that shows today's Build
// mode, the world builder. The view itself (`build.tsx`) is in the kept chunk, loaded when the page is first
// shown (`slot.tsx`). Build's inner place (the worlds, a world, a collection, a list, an item, a part, Problems,
// a job, Secrecy) is the route's own (`at`): the web shell keeps it in the address and the drawer in memory, so a
// reload or Back returns to it. The chat the view knows is the chat Lumiverse has open (the drawer) or the one
// the route names (the web shell), so Build can mark the world it plays and offer Attach.

import { useEffect, useRef, useState } from "preact/hooks";
import type { BuildRoute } from "../../frontend/app";
import { useApp } from "../app";
import { createStore } from "../store";
import { useUiSettings } from "../ui-settings";
import { atOf, placeOf, samePlace } from "./build-place";
import { KeptSlot } from "./slot";

export function BuildPage(props: { chat?: string | null; at?: readonly string[] }) {
  const app = useApp();
  const settings = useUiSettings();
  const [chat] = useState(() => createStore<string | null>(props.chat ?? null));
  const [place] = useState(() => createStore<BuildRoute>(placeOf(props.at)));
  // The chat changes under a page that stays: Build keeps its draft, and the App's view of the open chat follows.
  chat.set(props.chat ?? null);
  // A route that moved (Back, a link, a reload) moves Build; Build's own move goes into the route, once.
  const routed = useRef(placeOf(props.at));
  routed.current = placeOf(props.at);
  if (!samePlace(routed.current, place.get())) place.set(routed.current);
  useEffect(() => place.subscribe((next) => (samePlace(next, routed.current) ? undefined : app.go({ page: "build", chat: props.chat ?? null, at: atOf(next) }))), [props.chat]);
  return <KeptSlot class="rpe-kept" keys={[]} mount={(kept, root) => kept.mountBuild(root, { client: app.client, chat, host: app.keptHost(), timers: app.timers, settings: () => settings.values.get(), open: app.go, place })} />;
}
