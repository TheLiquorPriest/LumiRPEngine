// The kept chunk (plan §4.3, §14): Build, the Play view, the things browser and the chat's three sheets, the
// part of the UI that carries the previous build's panels, packs and engine code, and so is loaded when one
// of them is first shown, not with the page. In the web shell the build splits it off the page's script
// (`import("./kept/chunk")`); in Lumiverse it is `dist/widget.js`, the second file Lumiverse serves
// (`host-file.ts`). What the light part may know of it is `chunk-api.ts`, whose `KeptChunk` this module is.

import { createOverlays } from "../../frontend/overlays";
import { mountBuild } from "./build";
import { CATALOG } from "./catalog";
import type { KeptChunk } from "./chunk-api";
import { mountPlay } from "./play/mount";
import { PLAY_CSS } from "./play/styles";
import { mountThings } from "./things";

/** The sheets draw with today's Play areas, which the chat's frame does not carry; they are added with the sheets and taken away with them. */
const createSheets: KeptChunk["createSheets"] = (app, host) => {
  const removeStyle = host.addStyle(PLAY_CSS);
  const sheets = createOverlays({ ...app, catalog: CATALOG }, host);
  return {
    ...sheets,
    destroy() {
      sheets.destroy();
      removeStyle();
    },
  };
};

export { createSheets, mountBuild, mountPlay, mountThings };
export { setupWidget } from "./widget";
