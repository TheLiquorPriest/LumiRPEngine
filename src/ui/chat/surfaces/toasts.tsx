// The chat's toolbar shows the toasts of the kept App for the open chat (plan §14, PlanChatUI-2 item 5), so
// a toast is seen with the drawer shut.

import { render } from "preact";
import { AppContext } from "../../../frontend/app";
import { Toasts } from "../../../frontend/components";
import { chatPlay } from "../chat-play";
import type { SurfaceDef } from "../surface";

export const surface: SurfaceDef = {
  id: "toasts",
  surfaces(env) {
    const play = chatPlay(env);
    if (play === null) return [];
    return [
      {
        key: `toasts:${play.chat}`,
        placement: "dom-decorator",
        options: {
          mount: "chat_toolbar",
          render(root) {
            render(
              <AppContext.Provider value={play.app}>
                <Toasts surface="chat" />
              </AppContext.Provider>,
              root,
            );
            return () => render(null, root);
          },
        },
      },
    ];
  },
};
