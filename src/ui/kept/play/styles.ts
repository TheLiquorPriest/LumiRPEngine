// Today's stylesheets for the Play page (`frontend/styles/`), put in the page while it shows and taken
// out when it is left. The new pages already carry today's tokens and atoms (`ui/styles.ts`); these are
// the areas today's Play, its HUD and the packs' panels, sheets and glances draw with, in today's
// order, so an area's rule still overrides an atom's at equal specificity. The shell's sheet is there
// for Play's frame (its destination area, sticky sub-tabs, sheet stack and bottom bar); its drawer and
// mode-bar rules match nothing here. Every rule is under today's own class names (`lre-` and the
// area's), none under the new pages' (`rpe-`).

import { CHARACTER_CSS } from "../../../frontend/styles/character";
import { CHAT_CSS } from "../../../frontend/styles/chat";
import { FORMS_CSS } from "../../../frontend/styles/forms";
import { GM_CSS } from "../../../frontend/styles/gm";
import { MINDS_CSS } from "../../../frontend/styles/minds";
import { PACKS_ME_CSS } from "../../../frontend/styles/packs-me";
import { PACKS_MONEY_CSS } from "../../../frontend/styles/packs-money";
import { PACKS_WORLD_CSS } from "../../../frontend/styles/packs-world";
import { PLAY_CSS as TODAY_PLAY_CSS } from "../../../frontend/styles/play";
import { ROUTINES_GM_CSS } from "../../../frontend/styles/routines-gm";
import { SELECT_CSS } from "../../../frontend/styles/select";
import { SETTINGS_CSS } from "../../../frontend/styles/settings";
import { SHELL_CSS } from "../../../frontend/styles/shell";
import { THINGS_CSS } from "../../../frontend/styles/things";
import { VISUAL_EDITORS_CSS } from "../../../frontend/styles/visual-editors";

/**
 * The page's own: the column Play is drawn in, with no gutter for chat heads (today's drawer measures
 * them; these pages have none), and the HUD strip as a bar across the top rather than a floating pill:
 * where the page is narrower than its values (the drawer, whatever the window's width), they wrap to
 * another line instead of running into each other. In the web shell Play's sticky bars keep clear of
 * the shell's own: the sub-tabs below its top bar, one tap high and padded above and below, and at its
 * phone width (ui/styles.ts) Play's bottom bar above the shell's bar of pages.
 */
const OWN_CSS = `
.rpe-play,.rpe-play-body{--lre-gutter-l:0px;--lre-gutter-r:0px;flex:1;display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.rpe-play-hud{display:flex;min-width:0}
.rpe-play-hud>.lre-hud{flex:1;flex-wrap:wrap;min-width:0;min-height:var(--lre-tap-lg);height:auto;border-radius:var(--lre-r-xl);box-shadow:none}
.rpe-play-hud>.lre-hud>*{flex:none;max-width:100%}
.rpe-play-hud>.lre-hud>button{white-space:normal;text-align:left}
.rpe-play-hud>.lre-hud-pop{width:100%;max-width:none;box-shadow:none}
.rpe-web .rpe-play{--lre-modebar-h:calc(var(--lre-tap) + 2 * var(--lre-s2) + 1px + env(safe-area-inset-top,0px))}
@media (max-width:640px){
.rpe-web .rpe-play .lre-play>.lre-bottomnav{bottom:calc(var(--lre-tap-lg) + 2 * var(--lre-s1) + 1px + env(safe-area-inset-bottom,0px))}
}
`;

/** Today's areas Play draws with (CHAT holds the HUD, today's toasts and money fields), then the page's own. */
export const PLAY_CSS = [SHELL_CSS, CHAT_CSS, TODAY_PLAY_CSS, PACKS_ME_CSS, PACKS_MONEY_CSS, PACKS_WORLD_CSS, GM_CSS, MINDS_CSS, ROUTINES_GM_CSS, SELECT_CSS, SETTINGS_CSS, FORMS_CSS, CHARACTER_CSS, THINGS_CSS, VISUAL_EDITORS_CSS, OWN_CSS].join("\n");
