// The things browser as the World page shows it (plan §14 l.1539): below the tree, behind its spoiler gate, for the
// chat the page is about. The browser itself (`things.tsx`) is in the kept chunk, loaded when it is first shown.

import { useApp } from "../app";
import { useUiSettings } from "../ui-settings";
import { KeptSlot } from "./slot";

export function KeptThings(props: { chat: string }) {
  const app = useApp();
  const settings = useUiSettings();
  return (
    <div class="rpe-play rpe-kept-things">
      <KeptSlot class="rpe-kept-things-body" keys={[props.chat]} mount={(kept, root) => kept.mountThings(root, { client: app.client, chat: props.chat, host: app.keptHost(), timers: app.timers, settings: () => settings.values.get(), openBuild: () => app.go({ page: "build", chat: props.chat }), open: app.go })} />
    </div>
  );
}
