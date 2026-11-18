// Pins (R-174): a file says which agents it is pinned for, and a pin is made or taken away here: a pinned file is
// handed to that agent whole at the start of each of its runs. A pin is written in the `stack.pins` list of his own
// config, or of the chat's with one open; RPE refuses a path its view does not hold in its words.

import type { LayerLevel, TreeFileRow } from "../../../shared/api";
import { Button } from "../../../frontend/components";
import { LEVEL_WORDS } from "../../words";
import type { FilesShown } from "./model";

type PinLevel = "global" | "chat";

export interface PinActions {
  onPin(path: string, level: PinLevel, agent: string, pinned: boolean): void;
  onPinning(next: FilesShown["pinning"]): void;
}

const pinLevelWords = (level: LayerLevel): string => LEVEL_WORDS[level].toLowerCase();

/** The pin form: the agent to pin it for, among those the page knows, or typed where it knows none, and the level whose config holds the pin. */
function PinForm(props: PinActions & { path: string; chat: string | null; agents: readonly string[] | null; taken: readonly string[]; busy: boolean; pinning: FilesShown["pinning"] }) {
  const { pinning } = props;
  const level: PinLevel = pinning.level ?? (props.chat === null ? "global" : "chat");
  const choices = (props.agents ?? []).filter((a) => !props.taken.includes(a));
  return (
    <div class="lre-stack" data-pin-form>
      <label class="lre-field">
        <span class="label">Pin it for</span>
        {props.agents === null ? (
          <input class="lre-input" type="text" value={pinning.agent} autoComplete="off" spellcheck={false} onInput={(event) => props.onPinning({ ...pinning, agent: (event.currentTarget as HTMLInputElement).value })} />
        ) : (
          <select class="lre-input" onChange={(event) => props.onPinning({ ...pinning, agent: (event.currentTarget as HTMLSelectElement).value })}>
            <option value="" selected={pinning.agent === ""}>
              Choose an agent
            </option>
            {choices.map((name) => (
              <option key={name} value={name} selected={name === pinning.agent}>
                {name}
              </option>
            ))}
          </select>
        )}
      </label>
      {props.chat === null ? null : (
        <label class="lre-field">
          <span class="label">In the config of</span>
          <select class="lre-input" onChange={(event) => props.onPinning({ ...pinning, level: (event.currentTarget as HTMLSelectElement).value === "global" ? "global" : "chat" })}>
            {(["global", "chat"] as const).map((l) => (
              <option key={l} value={l} selected={l === level}>
                {l === "global" ? "Yours, for every chat" : "This chat"}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button size="sm" busy={props.busy} disabled={pinning.agent.trim() === ""} onClick={() => props.onPin(props.path, level, pinning.agent.trim(), true)}>
        Pin
      </Button>
    </div>
  );
}

/** A file's pins: each agent it is pinned for, with the level of the config that holds it, and the way to take it away or add one. */
export function PinPanel(props: PinActions & { entry: TreeFileRow; chat: string | null; agents: readonly string[] | null; busy: boolean; pinning: FilesShown["pinning"] }) {
  const pins = props.entry.pinnedFor ?? [];
  return (
    <div class="lre-stack" data-pins>
      {pins.length === 0 ? (
        <p class="rpe-meta">Pinned for no agent.</p>
      ) : (
        <ul class="rpe-plain lre-stack">
          {pins.map((pin) => (
            <li key={`${pin.level}:${pin.agent}`} class="lre-inline rpe-wrap" data-pinned-for={pin.agent}>
              <span class="rpe-line">{`Pinned for ${pin.agent}, in the config of ${pinLevelWords(pin.level)}`}</span>
              {pin.level === "global" || pin.level === "chat" ? (
                <Button size="sm" variant="ghost" busy={props.busy} onClick={() => props.onPin(props.entry.path, pin.level as PinLevel, pin.agent, false)}>
                  Unpin
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <PinForm path={props.entry.path} chat={props.chat} agents={props.agents} taken={pins.map((p) => p.agent)} busy={props.busy} pinning={props.pinning} onPin={props.onPin} onPinning={props.onPinning} />
    </div>
  );
}
