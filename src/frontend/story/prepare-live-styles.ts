// The live view of the prepared start, inside Play → Now's card (`story/prepare-live.tsx`). Phone
// first: one column that wraps at 360 px and at the drawer's width; where the card is wide (720 px and
// more) the whole lays out in two columns. Stretches and the trail scroll inside their own box, so a
// long preparation never pushes the card past the screen and nothing is cut. Back to top sticks at
// the foot of what shows, above Play's bottom bar, only while the view is on screen; at the view's
// end it takes its own line, so it covers nothing there. Its button is opaque, so its words and the
// view's read cleanly while it floats.

export const PREPARE_LIVE_CSS = `
.lre-prep-live-frame{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-prep-live-frame:focus{outline:none}
.lre-prep-live{container:lre-prep-live/inline-size;display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-prep-live-now{margin:0;overflow-wrap:anywhere}
.lre-prep-live-whole{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--lre-s4);min-width:0;padding-top:var(--lre-s2)}
.lre-prep-live-col{display:flex;flex-direction:column;gap:var(--lre-s4);min-width:0}
@container lre-prep-live (min-width:720px){.lre-prep-live-whole{grid-template-columns:repeat(2,minmax(0,1fr))}}
.lre-prep-live-block{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-prep-live-block h4{margin:0;font-size:var(--lre-fs-sm)}
.lre-prep-live-stages{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-prep-live-stages>li{display:flex;align-items:center;gap:var(--lre-s2);min-width:0;color:var(--lre-muted)}
.lre-prep-live-stages>li[data-state=done]{color:var(--lre-fg)}
.lre-prep-live-stages>li[data-state=now]{color:var(--lre-fg);font-weight:600}
.lre-prep-live-stages>li[data-state=now]>.lre-icon{color:var(--lre-accent)}
.lre-prep-live-stages>li>.lre-icon{flex:none}
.lre-prep-live-stage{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.lre-prep-live-stage-state{flex:0 1 auto;min-width:0;font-size:var(--lre-fs-xs);font-weight:400;color:var(--lre-muted);text-align:right;overflow-wrap:anywhere}
.lre-prep-live-run-line{display:block;overflow-wrap:anywhere}
.lre-prep-live-scroll{max-height:22em;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0;padding:var(--lre-s1) var(--lre-s2);border:1px solid var(--lre-hairline);border-radius:var(--lre-r)}
.lre-prep-live-scroll:focus-visible{outline-offset:-2px}
.lre-prep-live-list,.lre-prep-live-trail{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-prep-live-list>li,.lre-prep-live-trail>li{font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-prep-live-trail>li{display:flex;align-items:baseline;gap:var(--lre-s2)}
.lre-prep-live-trail>li>time{flex:none;font-size:var(--lre-fs-xs);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-prep-live-trail>li>span{flex:1 1 auto;min-width:0}
.lre-prep-live-figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(8em,1fr));gap:var(--lre-s2);min-width:0}
.lre-prep-live-left{margin:0;font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-prep-live-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
.lre-prep-live-actions>.lre-btn{min-height:var(--lre-tap)}
.lre-prep-live-foot{position:sticky;bottom:var(--lre-s2);z-index:1;display:flex;flex-wrap:wrap;justify-content:center;gap:var(--lre-s2);pointer-events:none}
.lre-play .lre-prep-live-foot{bottom:calc(var(--lre-tap-lg) + 2 * var(--lre-s1) + 1px + env(safe-area-inset-bottom,0px) + var(--lre-s2))}
.lre-prep-live-foot>.lre-btn{pointer-events:auto;background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-sm)}
.lre-prep-live-foot>.lre-btn:hover{background:linear-gradient(var(--lre-hover),var(--lre-hover)),var(--lre-bar-bg)}
`;
