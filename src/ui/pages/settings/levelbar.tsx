// Where a change made on a page of settings goes: every chat, or this chat alone. Shown by every page that writes settings, with a chat open.

import { Seg } from "../../../frontend/components";
import type { ChangeLevel } from "./model";

export function LevelBar(props: { level: ChangeLevel; onLevel(level: ChangeLevel): void }) {
  return (
    <div class="rpe-set-levelbar">
      <span class="rpe-meta">A change here is</span>
      <Seg
        value={props.level}
        options={[
          { value: "global", label: "For every chat" },
          { value: "chat", label: "For this chat only" },
        ]}
        label="Where a change goes"
        onChange={props.onLevel}
      />
    </div>
  );
}
