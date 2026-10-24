// Build's shell: the sticky world bar under the mode bar, the overflow menu,
// world cards and template cards, + New, Problems rows (`.lre-lint`, which the form and visual
// editors use as they are), job progress, proposal review, playtest transcripts and the profile
// picker. Phone first: one column, 40 px targets, sticky bars that bleed to the drawer's edges.

export const BUILD_CSS = `
.lre-build-root{display:contents}
.lre-build,.lre-build-page{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-character-page .lre-field:not([data-lre-derived]) .lre-form-optional{display:none}
.lre-character-page .lre-section-body>*+*{margin-top:var(--lre-s3)}
.lre-build-bar{position:sticky;top:var(--lre-modebar-h,0px);z-index:5;display:flex;flex-direction:column;margin:calc(-1 * var(--lre-s3)) calc(-1 * (var(--lre-s3) + var(--lre-gutter-r,0px))) 0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-l,0px)));padding:var(--lre-s1) calc(var(--lre-s3) + var(--lre-gutter-r,0px)) var(--lre-s1) calc(var(--lre-s3) + var(--lre-gutter-l,0px));background:var(--lre-bar-bg);border-bottom:1px solid var(--lre-hairline)}
.lre-build-bar-row{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap-lg);min-width:0}
.lre-build-bar-row>.lre-iconbtn:first-child{margin-left:calc(-1 * var(--lre-s2))}
.lre-build-bar-row>.lre-btn{flex:none}
.lre-build-bar-text{flex:1;min-width:0;display:flex;flex-direction:column}
.lre-build-bar-name{font-size:var(--lre-fs-md);font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lre-build-bar-state{display:flex;flex-wrap:wrap;align-items:center;gap:2px var(--lre-s1);font-size:var(--lre-fs-sm);line-height:1.3;color:var(--lre-muted)}
.lre-build-bar-state>.lre-dot{width:7px;height:7px}
.lre-build-bar-state>.lre-badge{min-height:18px;padding:0 6px}
.lre-build-conflict{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s1) var(--lre-s2);margin:var(--lre-s1) 0;padding:var(--lre-s1) var(--lre-s1) var(--lre-s1) var(--lre-s3);border-radius:var(--lre-r-lg);border:1px solid color-mix(in srgb,var(--lre-warning) 40%,transparent);background:var(--lre-warn-soft)}
.lre-build-conflict-text{flex:1 1 14em;min-width:0;display:flex;align-items:flex-start;gap:var(--lre-s2);font-size:var(--lre-fs-sm)}
.lre-build-conflict-text>.lre-icon{margin-top:1px;color:var(--lre-warn)}
.lre-build-menu{position:relative;flex:none}
.lre-build-menu-list{position:absolute;right:0;top:calc(100% + var(--lre-s1));z-index:30;display:flex;flex-direction:column;min-width:200px;max-width:min(280px,calc(100vw - 32px));padding:var(--lre-s1);border:1px solid var(--lre-border);border-radius:var(--lre-r-lg);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-lg)}
.lre-build-menu-list.up{top:auto;bottom:calc(100% + var(--lre-s1))}
.lre-build-menu-list>button{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap-lg);padding:0 var(--lre-s3);border:0;border-radius:var(--lre-r);background:transparent;font-weight:500;text-align:left;transition:background-color var(--lre-fast)}
.lre-build-menu-list>button:hover:not(:disabled){background:var(--lre-hover)}
.lre-build-menu-list>button:focus-visible{outline-offset:-2px}
.lre-build-menu-list>button>.lre-icon{color:var(--lre-muted)}
.lre-build-menu-list>button.danger,.lre-build-menu-list>button.danger>.lre-icon{color:var(--lre-neg)}
.lre-build-note{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-build-note>.lre-icon{vertical-align:-3px}
.lre-build-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-build-count{font-size:var(--lre-fs-sm);font-weight:500;letter-spacing:0;text-transform:none;color:var(--lre-muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.lre-build-mono{font-family:var(--lre-mono);font-size:var(--lre-fs-sm)}
textarea.lre-input.lre-build-prose{font-family:inherit;font-size:var(--lre-fs-md)}
.lre-build-tile{flex:none;width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--lre-r-lg);background:var(--lre-accent-soft);color:var(--lre-accent-text)}
.lre-build-worlds{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-build-world{display:flex;align-items:center;gap:var(--lre-s1);padding-right:var(--lre-s1);min-width:0;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);transition:background-color var(--lre-fast)}
.lre-build-world:has(>.lre-build-world-open:hover){background:var(--lre-hover)}
.lre-build-world-open{flex:1;min-width:0;display:flex;align-items:center;gap:var(--lre-s3);min-height:64px;padding:var(--lre-s3);border:0;border-radius:var(--lre-r-xl);background:transparent;text-align:left}
.lre-build-world-open:focus-visible{outline-offset:-2px}
.lre-build-world-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-build-world-name{font-size:var(--lre-fs-md);font-weight:600;overflow-wrap:anywhere}
.lre-build-templates{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-build-template{position:relative;display:flex;align-items:flex-start;gap:var(--lre-s3);min-height:var(--lre-tap-lg);padding:var(--lre-s3);border:1px solid var(--lre-border);border-radius:var(--lre-r-lg);cursor:pointer;transition:background-color var(--lre-fast),border-color var(--lre-fast)}
.lre-build-template:hover{background:var(--lre-hover)}
.lre-build-template:has(>input:checked){border-color:var(--lre-accent);background:var(--lre-accent-soft)}
.lre-build-template:has(>input:focus-visible){outline:2px solid var(--lre-accent);outline-offset:2px}
.lre-build-template-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-build-template-name{font-weight:600}
.lre-build-template-mark{flex:none;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1.5px solid var(--lre-border);color:transparent}
.lre-build-template:has(>input:checked) .lre-build-template-mark{border-color:transparent;background:var(--lre-accent-fill);color:var(--lre-accent-fg)}
.lre-build-new{display:flex;flex-direction:column;gap:var(--lre-s3);padding:var(--lre-s3);border:1px solid color-mix(in srgb,var(--lre-accent) 35%,transparent);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre-build-search{position:relative;display:flex;align-items:center;min-width:0}
.lre-build-search>.lre-icon{position:absolute;left:var(--lre-s3);color:var(--lre-muted);pointer-events:none}
.lre-build-search>.lre-input{padding-left:36px}
.lre-lint{display:flex;gap:var(--lre-s2);align-items:flex-start;padding:var(--lre-s2) 0;border-bottom:1px solid var(--lre-hairline);min-width:0}
.lre-lint:last-child{border-bottom:0}
.lre-lint .path{font:var(--lre-fs-xs)/1.3 var(--lre-mono);color:var(--lre-dim);overflow-wrap:anywhere}
.lre-lint>.lre-btn{flex:none}
.lre-lint-text{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:var(--lre-s1)}
.lre-lint-message{overflow-wrap:anywhere}
.lre-lint-where{margin-top:-2px;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-build-issues{display:flex;flex-direction:column;min-width:0}
.lre-build-issues>.lre-lint{padding:var(--lre-s3)}
.lre-build-well{overflow:hidden;border-radius:var(--lre-r-lg);background:var(--lre-well)}
.lre-progress{height:8px;border-radius:var(--lre-r-pill);background:var(--lre-neutral-soft);overflow:hidden}
.lre-progress>span{display:block;height:100%;border-radius:inherit;background:var(--lre-accent);transition:width var(--lre-med)}
.lre-build-picks{display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-lg)}
.lre-build-pick{display:flex;align-items:center;gap:var(--lre-s3);min-height:var(--lre-tap-lg);padding:var(--lre-s1) var(--lre-s3);cursor:pointer;transition:background-color var(--lre-fast)}
.lre-build-pick+.lre-build-pick{border-top:1px solid var(--lre-hairline)}
.lre-build-pick:hover{background:var(--lre-hover)}
.lre-build-pick:has(>input:focus-visible){outline:2px solid var(--lre-accent);outline-offset:-2px}
.lre-build-pick>input{flex:none;width:22px;height:22px;margin:0;cursor:pointer;accent-color:var(--lre-accent)}
.lre-build-pick>input:focus-visible{outline:0}
.lre-build-pick>span{flex:1;min-width:0;overflow-wrap:anywhere}
.lre-build-group{display:flex;flex-direction:column;min-width:0}
.lre-build-group-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);padding:var(--lre-s3) 0 var(--lre-s1);font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-muted)}
.lre-build-proposal{display:flex;align-items:flex-start;gap:var(--lre-s1);min-width:0;padding:var(--lre-s1) 0 var(--lre-s2);border-top:1px solid var(--lre-hairline)}
.lre-build-proposal>.lre-check{margin-left:calc(-1 * var(--lre-s2))}
.lre-build-proposal-body{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding-top:var(--lre-s2)}
.lre-build-proposal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--lre-s2);width:100%;min-width:0}
.lre-build-proposal-title{min-width:0;font-weight:600;overflow-wrap:anywhere}
.lre-build-proposal-line{display:flex;align-items:flex-start;gap:var(--lre-s1);min-width:0;font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-build-proposal-line>.lre-icon{flex:none;margin-top:1px}
.lre-build-reveal{margin:var(--lre-s1) 0 0 -10px}
.lre-build-json{width:100%;padding:var(--lre-s2) var(--lre-s3);overflow-x:auto;border-radius:var(--lre-r);background:var(--lre-well);font-size:var(--lre-fs-sm)}
.lre-build-badges{display:flex;flex:none;align-items:center;gap:var(--lre-s1)}
.lre-build-source{display:flex;flex-direction:column;gap:2px;width:100%;min-width:0}
.lre-build-source-name{padding:0;border:0;background:none;color:var(--lre-accent-text);font:inherit;text-align:left;text-decoration:underline;text-underline-offset:2px;cursor:pointer;overflow-wrap:anywhere}
.lre-build-quote{display:block;margin-left:calc(16px + var(--lre-s1));padding-left:var(--lre-s2);border-left:2px solid var(--lre-hairline);font-size:var(--lre-fs-sm);font-style:italic;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-build-entry{margin:var(--lre-s1) 0 0;padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r);background:var(--lre-well);font-size:var(--lre-fs-sm);white-space:pre-wrap;overflow-wrap:anywhere}
.lre-build-turns{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.lre-build-turn{display:flex;flex-direction:column;gap:var(--lre-s1);padding:var(--lre-s3) 0;border-top:1px solid var(--lre-hairline)}
.lre-build-turn:first-child{padding-top:0;border-top:0}
.lre-build-turn:last-child{padding-bottom:0}
.lre-build-turn-you{font-weight:500;overflow-wrap:anywhere}
.lre-build-turn-who{display:inline-block;margin-right:var(--lre-s1);padding:0 var(--lre-s2);border-radius:var(--lre-r-pill);background:var(--lre-accent-soft);color:var(--lre-accent-text);font-size:var(--lre-fs-xs);font-weight:600}
.lre-build-turn-reply{white-space:pre-wrap;overflow-wrap:anywhere}
.lre-build-notes{margin:0;padding-left:1.25em;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-build-offer{display:flex;align-items:center;gap:var(--lre-s3);min-width:0}
.lre-build-offer-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-build-offer-name{overflow-wrap:anywhere}
.lre-build-profile{gap:var(--lre-s3)}
.lre-build-profile-group{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-build-profile-head{display:flex;align-items:center;gap:var(--lre-s2);font-size:var(--lre-fs-sm);font-weight:500}
.lre-build-chips{display:flex;flex-wrap:wrap;gap:6px}
.lre-build-profile-conflict{display:flex;flex-direction:column;gap:var(--lre-s1);font-size:var(--lre-fs-sm)}
`;
