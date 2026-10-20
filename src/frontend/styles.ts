// One stylesheet for every LumiRPEngine surface, added with `ctx.dom.addStyle`. Each
// area keeps its rules in its own module under styles/; they join here in a fixed order: the tokens
// and base rules, the shared atoms, the drawer shell, then the areas, so an area's rule overrides an
// atom's at equal specificity.

import { BUILD_CSS } from "./styles/build";
import { CHAT_CSS } from "./styles/chat";
import { COMPONENTS_CSS } from "./styles/components";
import { DIAGNOSTICS_CSS } from "./styles/diagnostics";
import { FORMS_CSS } from "./styles/forms";
import { GM_CSS } from "./styles/gm";
import { MINDS_CSS } from "./styles/minds";
import { PACKS_ME_CSS } from "./styles/packs-me";
import { PACKS_MONEY_CSS } from "./styles/packs-money";
import { PACKS_WORLD_CSS } from "./styles/packs-world";
import { PLAY_CSS } from "./styles/play";
import { SETTINGS_CSS } from "./styles/settings";
import { SHELL_CSS } from "./styles/shell";
import { TOKENS_CSS } from "./styles/tokens";
import { VISUAL_EDITORS_CSS } from "./styles/visual-editors";

export const CSS = [TOKENS_CSS, COMPONENTS_CSS, SHELL_CSS, CHAT_CSS, PLAY_CSS, PACKS_ME_CSS, PACKS_MONEY_CSS, PACKS_WORLD_CSS, GM_CSS, MINDS_CSS, SETTINGS_CSS, BUILD_CSS, FORMS_CSS, VISUAL_EDITORS_CSS, DIAGNOSTICS_CSS].join("\n");
