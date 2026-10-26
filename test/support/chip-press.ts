// A chip's button pressed as the chat's page presses it (`sendChipChoice`): the choice goes to the
// backend, then the page starts the reply the chip waits for, which Lumiverse begins here (and starts
// again once an engine run it stopped for asks), or tells the player what to press.

import type { App } from "../../src/frontend/app";
import { sendChipChoice } from "../../src/frontend/chips";
import type { JsonObject } from "../../src/shared/json";
import type { Chip } from "../../src/shared/state-view";
import type { Generation } from "./fake-host";
import type { Rig } from "./rig";

/** Presses `choice` on `chip` (with an Edit's `payload`): what began, and what the player was told. */
export async function press(rig: Rig, chatId: string, chip: Chip, choice: string, payload?: JsonObject): Promise<{ began: Generation[]; told: string[] }> {
  const began: Generation[] = [];
  const told: string[] = [];
  const app = {
    send: (request: Record<string, unknown>) => rig.send(request),
    toast: (text: string) => told.push(text),
    host: {
      generate: async (as: "regenerate" | "continue") => {
        began.push(await rig.host.start(chatId, { type: as }));
        return true;
      },
    },
  } as unknown as App;
  await sendChipChoice(app, chip, choice, chatId, payload);
  return { began, told };
}
