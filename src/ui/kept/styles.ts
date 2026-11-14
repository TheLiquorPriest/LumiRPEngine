// Today's stylesheets for the Build page (`frontend/styles/`), put in the page while it shows and taken
// out when it is left. The new pages already carry today's tokens and atoms (`ui/styles.ts`); these are
// the areas Build mode and the packs' editors draw with, in today's order, so an area's rule still
// overrides an atom's at equal specificity. Left out are the surfaces this build does not have: the
// drawer's frame and mode bar, Play, GM's Live, Assistant and Workspace, Diagnostics, the Harness tab
// and the story's pages. Every rule of these sheets is under today's own class names (`lre-` and the
// area's), none under the new pages' (`rpe-`), and none reaches a new page's own markup.

import { BUILD_CSS } from "../../frontend/styles/build";
import { CHARACTER_CSS } from "../../frontend/styles/character";
import { CHAT_CSS } from "../../frontend/styles/chat";
import { FORMS_CSS } from "../../frontend/styles/forms";
import { GM_CSS } from "../../frontend/styles/gm";
import { MINDS_CSS } from "../../frontend/styles/minds";
import { PACKS_ME_CSS } from "../../frontend/styles/packs-me";
import { PACKS_MONEY_CSS } from "../../frontend/styles/packs-money";
import { PACKS_WORLD_CSS } from "../../frontend/styles/packs-world";
import { ROUTINES_GM_CSS } from "../../frontend/styles/routines-gm";
import { SELECT_CSS } from "../../frontend/styles/select";
import { SETTINGS_CSS } from "../../frontend/styles/settings";
import { THINGS_CSS } from "../../frontend/styles/things";
import { VISUAL_EDITORS_CSS } from "../../frontend/styles/visual-editors";

/**
 * The page's own: the column Build is drawn in, and the switch the web shell draws for it (host.ts).
 * Build's bars that stick (its world bar at the top, Save and the selection bar at the bottom) stay
 * clear of the web shell's own: its top bar, one tap high and padded above and below, and at its phone
 * width (ui/styles.ts) the bar of pages at the bottom.
 */
const OWN_CSS = `
.rpe-kept,.rpe-kept-body{display:flex;flex-direction:column;min-width:0}
.rpe-kept-switch{width:20px;height:20px;margin:0;accent-color:var(--lre-accent)}
.rpe-web .rpe-kept{--lre-modebar-h:calc(var(--lre-tap) + 2 * var(--lre-s2) + 1px + env(safe-area-inset-top,0px))}
@media (max-width:640px){
.rpe-web .rpe-kept .lre-savebar,.rpe-web .rpe-kept .lre-selectbar{bottom:calc(var(--lre-tap-lg) + 2 * var(--lre-s1) + 1px + env(safe-area-inset-bottom,0px))}
}
`;

/** Today's areas Build draws with (CHAT holds today's toasts and money fields), then the page's own. */
export const KEPT_CSS = [CHAT_CSS, PACKS_ME_CSS, PACKS_MONEY_CSS, PACKS_WORLD_CSS, GM_CSS, MINDS_CSS, ROUTINES_GM_CSS, SELECT_CSS, SETTINGS_CSS, BUILD_CSS, FORMS_CSS, CHARACTER_CSS, THINGS_CSS, VISUAL_EDITORS_CSS, OWN_CSS].join("\n");
