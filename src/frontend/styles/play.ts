// Play's content (S2, contract §4.4, §5.2–5.3): the Now hub (status banners, the scene card with its
// ✎ fixes, Needs you, Here, the quick actions), the Journal with its Save to lore form, and the
// states that replace a destination (no chat, connecting, not a world chat). The Play shell (bottom
// bar, sub-tabs, sheet stack) is in shell.ts.

export const PLAY_CSS = `
.lre-play-now{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-play-status{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-play-status .lre-banner-actions>.lre-chat-keep{flex:1 1 100%;min-width:0;margin:0;padding:0;border:0;border-radius:0;background:none;box-shadow:none}
.lre-play-status[data-lre-status=in_flight] .lre-banner-icon{animation:lre-play-pulse 1.6s ease-in-out infinite}
@keyframes lre-play-pulse{50%{opacity:.3}}
.lre-play-scene{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0;padding:var(--lre-s3) var(--lre-s4) var(--lre-s1);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre-play-scene>.lre-empty{padding-bottom:var(--lre-s4)}
.lre-play-clock{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-play-time{font-size:var(--lre-fs-xl);font-weight:600;line-height:1.25;overflow-wrap:anywhere}
.lre-play-daypart{color:var(--lre-muted)}
.lre-play-place{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap);min-width:0}
.lre-play-place-name{flex:1;min-width:0;font-size:var(--lre-fs-lg);font-weight:600;overflow-wrap:anywhere}
.lre-play-fact-icon{flex:none;color:var(--lre-muted)}
.lre-play-facts{display:flex;flex-direction:column;min-width:0;border-top:1px solid var(--lre-hairline)}
.lre-play-facts:empty{display:none}
.lre-play-fact{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap-lg);min-width:0;padding:2px 0}
.lre-play-fact+.lre-play-fact,.lre-play-fact+.lre-play-fix,.lre-play-fix+.lre-play-fact{border-top:1px solid var(--lre-hairline)}
.lre-play-fact-label{flex:1 1 auto;min-width:0;color:var(--lre-muted)}
.lre-play-fact-value{flex:0 1 auto;min-width:0;display:flex;flex-direction:column;align-items:flex-end;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.lre-play-fact-sub{font-size:var(--lre-fs-sm);font-weight:400;color:var(--lre-muted)}
.lre-play-fixbtn{flex:none;display:inline-flex;width:var(--lre-tap);margin-right:calc(-1 * var(--lre-s2))}
.lre-play-fixbtn>.lre-iconbtn{color:var(--lre-muted)}
.lre-play-fixbtn>.lre-iconbtn:hover:not(:disabled){color:var(--lre-fg)}
.lre-play-fix{padding:var(--lre-s2) 0 var(--lre-s3)}
.lre-play-none{margin:0;padding:var(--lre-s3);color:var(--lre-muted)}
.lre-play-badges{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--lre-s1)}
.lre-play-inline{min-width:0}
.lre-play-quick{display:flex;flex-wrap:wrap;gap:var(--lre-s2);min-width:0;padding-top:var(--lre-s1)}
.lre-play-quick>.lre-btn{flex:1 1 auto;min-height:var(--lre-tap-lg);border-radius:var(--lre-r-pill);white-space:nowrap}
.lre-play-journal{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-play-journal-bar{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-width:0;margin:calc(-1 * var(--lre-s1)) 0}
.lre-play-journal-order{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-play-journal-bar>.lre-btn{margin-right:calc(-1 * var(--lre-s2))}
.lre-play-journal-bar>.lre-btn[aria-expanded=true]{background:var(--lre-accent-soft);color:var(--lre-accent-text)}
.lre-play-lore{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2) var(--lre-s4) var(--lre-s4);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre-play-lore-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2)}
.lre-play-lore-head>.lre-iconbtn{margin-right:calc(-1 * var(--lre-s2))}
.lre-play-lore-title{margin:0;font-size:var(--lre-fs-md);font-weight:600}
.lre-play-lore-help{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-play-lore textarea.lre-input{font-family:inherit;font-size:var(--lre-fs-md)}
.lre-play-lore-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
.lre-play-notes{list-style:none;margin:0;padding:0;min-width:0;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);overflow:hidden}
.lre-play-note{display:flex;gap:var(--lre-s3);padding-left:var(--lre-s3);min-width:0}
.lre-play-note-icon{flex:none;margin-top:var(--lre-s3);color:var(--lre-muted)}
.lre-play-note-icon.accent{color:var(--lre-accent-text)}
.lre-play-note-icon.warn{color:var(--lre-warn)}
.lre-play-note-icon.neg{color:var(--lre-neg)}
.lre-play-note-body{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:var(--lre-s1);padding:var(--lre-s3) var(--lre-s3) var(--lre-s3) 0}
.lre-play-note+.lre-play-note .lre-play-note-body{border-top:1px solid var(--lre-hairline)}
.lre-play-note-text{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.lre-play-notworld{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-play-notworld>.lre-empty{padding-top:var(--lre-s5)}
`;
