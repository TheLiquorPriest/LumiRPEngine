// The Play page (plan §14): the page of the navigation that shows today's Play for the chat the route
// names. The view itself (`mount.tsx`) is in the kept chunk, loaded when the page is first shown (`../slot.tsx`).

import { useApp } from "../../app";
import { useUiSettings } from "../../ui-settings";
import { KeptSlot } from "../slot";

/** The page of the navigation, for the chat the route names. */
export function PlayPage(props: { chat: string }) {
  const app = useApp();
  const settings = useUiSettings();
  // Build opens on the chat the page is for, so it marks the world this chat plays and offers Attach to it.
  return <KeptSlot class="rpe-play" keys={[props.chat]} mount={(kept, root) => kept.mountPlay(root, { client: app.client, chat: props.chat, host: app.keptHost(), timers: app.timers, settings: () => settings.values.get(), openBuild: () => app.go({ page: "build", chat: props.chat }), open: app.go })} />;
}
