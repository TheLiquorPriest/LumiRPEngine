// The drawer shell (contract §4.1–4.5, §5.3, §9.4): the sticky mode bar, each mode's body, Play's
// destination area with its sticky sub-tabs, the sheet stack's frame and motion, the bottom bar
// (Play's and GM's), and the GM frame. Content keeps 12 px from each side plus the chat-head gutters
// (--lre-gutter-l/-r, set from the heads' measured overlap); the sticky bars bleed to the edges and
// pad their own content by the same amounts. The drawer fills the host panel's visible height
// (--lre-fill-h), so the bottom bar sits at the bottom and Places can fill the space between the bars.

export const SHELL_CSS = `
.lre-drawer{--lre-gutter-l:0px;--lre-gutter-r:0px;display:flex;flex-direction:column;min-height:var(--lre-fill-h,100%);padding:0 calc(var(--lre-s3) + var(--lre-gutter-r)) 0 calc(var(--lre-s3) + var(--lre-gutter-l))}
.lre-modebar{position:sticky;top:0;z-index:6;margin:0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-r))) 0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-l)));padding:6px calc(var(--lre-s3) + var(--lre-gutter-r)) 6px calc(var(--lre-s3) + var(--lre-gutter-l));background:var(--lre-bar-bg);border-bottom:1px solid var(--lre-hairline);container-type:inline-size}
.lre-modeseg{display:flex;gap:2px;min-height:var(--lre-tap-lg);padding:2px;border-radius:var(--lre-r-lg);background:var(--lre-well);box-shadow:inset 0 0 0 1px var(--lre-hairline)}
.lre-modeseg>button{flex:1 1 auto;min-width:0;min-height:var(--lre-tap);padding:0 var(--lre-s1);display:flex;align-items:center;justify-content:center;gap:6px;border:0;border-radius:calc(var(--lre-r-lg) - 2px);background:transparent;color:var(--lre-muted);font-size:var(--lre-fs-sm);font-weight:500;transition:background-color var(--lre-fast),color var(--lre-fast),box-shadow var(--lre-fast)}
.lre-modeseg>button:hover{color:var(--lre-fg)}
.lre-modeseg>button[aria-selected=true]{background:var(--lre-accent-soft);color:var(--lre-accent-text);font-weight:600;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lre-accent) 35%,transparent)}
.lre-modeseg>button[data-mode=gm]>.lre-icon{color:var(--lre-gm)}
.lre-modeseg>button[data-mode=gm][aria-selected=true]{background:var(--lre-gm-soft);color:var(--lre-gm-text);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lre-gm) 45%,transparent)}
.lre-modeseg>button>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lre-modeseg>button:focus-visible{outline-offset:-2px}
@container (max-width:300px){.lre-modeseg>button{flex-basis:0;flex-direction:column;gap:0;font-size:var(--lre-fs-xs)}}
.lre-mode-body{flex:1;display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0;padding:var(--lre-s3) 0 var(--lre-s5)}
.lre-drawer[data-lre-mode=play]>.lre-mode-body{padding-bottom:0}
.lre-drawer[data-lre-mode=gm]{background-image:linear-gradient(color-mix(in srgb,var(--lumiverse-warning,#f59e0b) 5%,transparent),color-mix(in srgb,var(--lumiverse-warning,#f59e0b) 5%,transparent))}
.lre-drawer[data-lre-mode=gm]>.lre-modebar{background:linear-gradient(var(--lre-gm-soft),var(--lre-gm-soft)),var(--lre-bar-bg);box-shadow:inset 0 3px 0 var(--lre-gm);border-bottom-color:color-mix(in srgb,var(--lre-gm) 35%,transparent)}
.lre-play{flex:1;display:flex;flex-direction:column;min-width:0}
.lre-play-main,.lre-play-sheet{flex:1;display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0;padding-bottom:var(--lre-s3)}
.lre-play>:last-child:not(.lre-bottomnav){padding-bottom:var(--lre-s5)}
.lre-play-away>.lre-empty{margin:auto 0}
.lre-play-tabs{position:sticky;top:var(--lre-modebar-h,0px);z-index:4;margin:calc(-1 * var(--lre-s3)) calc(-1 * (var(--lre-s3) + var(--lre-gutter-r))) 0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-l)));padding:var(--lre-s2) calc(var(--lre-s3) + var(--lre-gutter-r)) var(--lre-s2) calc(var(--lre-s3) + var(--lre-gutter-l));background:var(--lre-bar-bg);border-bottom:1px solid var(--lre-hairline)}
.lre-play-host{min-width:0}
.lre-play-fill{flex:1 1 auto;display:flex;flex-direction:column;min-height:320px}
.lre-play-fill>*{flex:1 1 auto;min-height:0}
.lre-play-sheet{animation:lre-play-in var(--lre-med)}
.lre-play-sheet:focus{outline:none}
.lre-play[data-lre-motion=pop]>.lre-play-main,.lre-play[data-lre-motion=pop]>.lre-play-sheet{animation:lre-play-back var(--lre-med)}
@keyframes lre-play-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
@keyframes lre-play-back{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}
.lre-drawer .lre-bottomnav{margin:0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-r))) 0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-l)));padding-left:calc(var(--lre-s1) + var(--lre-gutter-l));padding-right:calc(var(--lre-s1) + var(--lre-gutter-r))}
.lre-drawer .lre-bottomnav>button{justify-content:flex-start;padding-top:var(--lre-s1)}
.lre-drawer .lre-bottomnav>button[aria-current=page]{background:transparent}
.lre-drawer .lre-bottomnav>button>.lre-icon{box-sizing:content-box;padding:2px 14px;border-radius:var(--lre-r-pill);transition:background-color var(--lre-fast)}
.lre-drawer .lre-bottomnav>button:hover>.lre-icon{background:var(--lre-hover)}
.lre-drawer .lre-bottomnav>button[aria-current=page]>.lre-icon{background:var(--lre-accent-soft)}
.lre-drawer .lre-bottomnav[data-tone=gm]>button[aria-current=page]{background:transparent}
.lre-drawer .lre-bottomnav[data-tone=gm]>button[aria-current=page]>.lre-icon{background:var(--lre-gm-soft)}
.lre-drawer .lre-bottomnav>button>.lre-dot{top:var(--lre-s1);left:calc(50% + 8px)}
`;
