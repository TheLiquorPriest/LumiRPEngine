// The Harness tab (frontend/harness): the mode bar once it holds a fifth tab, the tab's curtain, the
// note Settings shows a chat on the harness, and what LumiAH's pages need changed to sit under our
// mode bar instead of at the top of a tab of their own.
//
// Five tabs don't fit a phone's row with their labels whole, so up to 420 px of bar each stands its
// icon over its label, as the four do under 300 px. What is pressed here is 44 px tall at least.
//
// LumiAH's shell measures the host's panel and publishes what it finds as custom properties on its
// root (its styles/shell.ts says what each is for). Under our mode bar three of them are ours to
// say: where its bar sticks (below ours), how far the bar reaches (as far as ours), and the height
// the panel shows (less our bar). The shell writes them as inline styles, which only an important
// rule outweighs. Its root fills what our drawer leaves it, so its own least height is taken off.
// A fourth says how tall our bottom bar is: what LumiAH keeps at the panel's foot (a running turn's
// bar, "Jump to the newest", "Back to top", its notices) sticks in the same scrolling panel as our
// bar and would sit under it otherwise.
//
// LumiAH's Runtime page lists the chats it plays. Told that LumiRPEngine switches its chats on in its
// own pages (`RuntimeView.switchedBy`, from the mount's `ownSwitch`), it offers no switch of its own
// there and says where the switch is. One row still goes: a chat set to the harness that LumiAH
// hasn't taken yet (no runtime was linked when it was set; it is taken as its next reply starts)
// would read "LumiAH is off for this chat. Switch it on in LumiRPEngine's own pages", though GM →
// This chat → Engine already has it on the harness.

export const HARNESS_CSS = `
.lre-modeseg[data-lre-modes="5"]>button{position:relative;min-height:var(--lre-tap-lg)}
@container (max-width:420px){.lre-modeseg[data-lre-modes="5"]>button{flex-basis:0;flex-direction:column;gap:0;padding:var(--lre-s1) 2px;font-size:var(--lre-fs-xs)}}
.lre-modeseg>button>.lre-dot{position:absolute;top:5px;right:6px}
.lre-drawer[data-lre-mode=harness]>.lre-mode-body{padding:0}
.lre-harness{flex:1;display:flex;flex-direction:column;min-width:0}
.lre-harness>.lre-harness-curtain{margin:var(--lre-s3) 0 var(--lre-s5)}
.lre-harness-curtain>.lre-btn,.lre-set-engine-note .lre-btn{min-height:var(--lre-tap-lg)}
.lre-story-body>.lah-root{flex:1 1 auto;min-height:0;--lah-stick-top:calc(var(--lre-stick-top,0px) + var(--lre-modebar-h,0px))!important;--lah-stick-bottom:var(--lre-harness-nav-h,0px)!important;--lah-bleed-l:calc(var(--lre-s3) + var(--lre-gutter-l))!important;--lah-bleed-r:calc(var(--lre-s3) + var(--lre-gutter-r))!important;--lah-fill-h:calc(var(--lre-fill-h,100vh) - var(--lre-modebar-h,0px) - var(--lre-harness-nav-h,0px))!important}
.lre-harness .lah-chatrow:has(>.lah-chatswitch[data-on=false]){display:none}
`;
