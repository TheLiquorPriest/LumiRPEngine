// World packs: the map (`.lre-map` base rules; also the map overlay's frame and
// Build's previews, which add rules under their own classes), its bar, zoom, list, dock and
// Known/Fog control; People's list and filters; the person sheet with its day timeline; the place
// and quest sheets; the Calendar; the Encounter; the Orgs trees (the home's, the Org Chart's), each
// row 44 px, indented 12 px a level (`--lre-tree-indent`), with its inline menu and breadcrumb.
// Tokens only. Controls laid over the map canvas sit on the opaque bar background, so they read over
// any part of the drawing in either theme.

export const PACKS_WORLD_CSS = `
.lre-map{position:relative;width:100%;height:100%;min-height:0;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;background:var(--lre-bar-bg);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);color:var(--lre-fg)}
.lre-map.full{border:0;border-radius:0}
.lre-map canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.lre-map .lre-iconbtn.secondary{background:var(--lre-bar-bg);border-color:var(--lre-border);box-shadow:var(--lre-shadow-sm)}
.lre-map .lre-iconbtn.secondary:hover:not(:disabled){background:linear-gradient(var(--lre-hover),var(--lre-hover)),var(--lre-bar-bg)}
.lre-map .lre-iconbtn.secondary[aria-pressed=true]{background:linear-gradient(var(--lre-accent-soft),var(--lre-accent-soft)),var(--lre-bar-bg);color:var(--lre-accent-text);border-color:color-mix(in srgb,var(--lre-accent) 40%,transparent)}
.lre-map .lre-world-zoom{position:absolute;right:8px;bottom:8px;z-index:1;display:flex;flex-direction:column;gap:6px}
.lre-world-map{flex:1 1 auto;min-height:320px}
.lre-world-map.in-overlay{min-height:0;border:0;border-radius:0}
.lre-world-mapbar{position:absolute;top:8px;left:8px;right:8px;z-index:1;display:flex;align-items:center;gap:6px;pointer-events:none}
.lre-world-map.in-overlay .lre-world-mapbar{top:56px}
.lre-world-mapbar>*{pointer-events:auto}
.lre-world-crumbs{flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:2px;overflow-x:auto;scrollbar-width:none;white-space:nowrap;pointer-events:auto}
.lre-world-crumbs::-webkit-scrollbar{display:none}
.lre-world-crumb{display:inline-flex;align-items:center;gap:2px;flex:none}
.lre-world-crumb-sep{color:var(--lre-muted)}
.lre-world-pill{flex:none;display:inline-flex;align-items:center;min-height:var(--lre-tap);padding:0 14px;border-radius:var(--lre-r-pill);border:1px solid var(--lre-border);background:var(--lre-bar-bg);color:var(--lre-fg);font-size:var(--lre-fs-sm);font-weight:500;box-shadow:var(--lre-shadow-sm);transition:background-color var(--lre-fast)}
button.lre-world-pill:hover{background:linear-gradient(var(--lre-hover),var(--lre-hover)),var(--lre-bar-bg)}
.lre-world-pill.current{font-weight:600}
.lre-world-pill-note{margin-left:4px;color:var(--lre-muted);font-weight:400}
.lre-world-mode{position:absolute;left:8px;bottom:8px;z-index:1;padding:2px;border-radius:var(--lre-r-lg);background:var(--lre-bar-bg);border:1px solid var(--lre-border);box-shadow:var(--lre-shadow-sm)}
.lre-world-mode .lre-seg{flex-wrap:nowrap}
.lre-world-mode .lre-seg>button{flex:1 0 auto;min-width:var(--lre-tap)}
.lre-world-legend{display:flex;flex-wrap:wrap;gap:2px var(--lre-s3);margin:0;padding:2px var(--lre-s2) 0;list-style:none;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-world-legend>li{display:inline-flex;align-items:center;gap:4px}
.lre-world-dock,.lre-world-maplist{position:absolute;left:8px;right:8px;bottom:8px;z-index:2;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:var(--lre-s2);padding:var(--lre-s3);border-radius:var(--lre-r-xl);border:1px solid var(--lre-border);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-lg)}
.lre-world-dock{max-height:min(65%,440px)}
.lre-world-dock-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-width:0}
.lre-world-dock-head>strong{min-width:0;font-size:var(--lre-fs-lg);font-weight:600;overflow-wrap:anywhere}
.lre-world-dock [data-lre-map-walk]{border:1px solid var(--lre-hairline);border-radius:var(--lre-r-lg);background:var(--lre-card);overflow:hidden}
.lre-world-status{display:flex;align-items:flex-start;gap:var(--lre-s2);margin:0;min-width:0;color:var(--lre-muted)}
.lre-world-status>.lre-icon{margin-top:2px}
.lre-world-status>span{min-width:0;overflow-wrap:anywhere}
.lre-world-badges{display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--lre-s1);min-width:0;max-width:40%}
.lre-world-badges.start{justify-content:flex-start;max-width:100%}
.lre-world-filters{padding:0 var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre-world-filters-summary{display:inline-flex;align-items:center;flex-wrap:wrap;gap:var(--lre-s2);color:var(--lre-fg)}
.lre-world-filters-summary>.lre-icon{color:var(--lre-muted)}
.lre-world-chips{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-world-chips-label{flex-basis:100%;font-size:var(--lre-fs-sm);font-weight:500;color:var(--lre-muted)}
.lre-world-chip{display:inline-flex;align-items:center;gap:var(--lre-s1);min-height:var(--lre-tap);max-width:100%;padding:0 14px;border-radius:var(--lre-r-pill);border:1px solid var(--lre-border);background:transparent;color:var(--lre-fg);font-size:var(--lre-fs-sm);font-weight:500;overflow-wrap:anywhere;transition:background-color var(--lre-fast),color var(--lre-fast)}
.lre-world-chip:hover{background:var(--lre-hover)}
.lre-world-chip[aria-pressed=true]{background:var(--lre-accent-soft);color:var(--lre-accent-text);border-color:color-mix(in srgb,var(--lre-accent) 40%,transparent);font-weight:600}
.lre-world-person-head{display:flex;align-items:center;gap:var(--lre-s3);min-width:0}
.lre-world-person-status{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-world-person-status .lre-world-status{color:var(--lre-fg)}
.lre-world-person-status .lre-world-badges{justify-content:flex-start;max-width:100%}
.lre-world-timeline{display:flex;height:16px;border-radius:var(--lre-r-sm);overflow:hidden;background:var(--lre-neutral-soft)}
.lre-world-timeline>span{height:100%;box-shadow:inset -1px 0 0 var(--lre-card)}
.lre-world-axis{display:flex;justify-content:space-between;margin-top:calc(-1 * var(--lre-s1));font-size:var(--lre-fs-xs);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-world-legend{display:flex;flex-wrap:wrap;gap:var(--lre-s1) var(--lre-s3);font-size:var(--lre-fs-xs);color:var(--lre-muted)}
.lre-world-legend i{display:inline-block;width:8px;height:8px;margin-right:var(--lre-s1);border-radius:2px;vertical-align:baseline}
.lre-world-timeline+.lre-world-axis+.lre-world-legend+.lre-rowlist{margin:0 calc(-1 * var(--lre-s3));border-top:1px solid var(--lre-hairline)}
.lre-world-stage{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-world-stage>strong{font-weight:600;overflow-wrap:anywhere}
.lre-world-cue,.lre-world-hint{margin:0;white-space:normal;overflow-wrap:anywhere}
.lre-world-hint{display:flex;gap:var(--lre-s2);align-items:flex-start}
.lre-world-hint>.lre-icon{margin-top:2px;color:var(--lre-muted)}
.lre .lre-world-done{color:var(--lre-pos)}
.lre-world-todo{display:block;width:16px;height:16px;margin:2px;border-radius:50%;border:1.75px solid var(--lre-muted)}
.lre-world-clock .lre-stat-value{font-size:calc(var(--lre-fs-xl) * 1.4)}
.lre-world-pointer{display:flex}
.lre-world-pointer .lre-btn{justify-content:flex-start;text-align:left;color:var(--lre-muted)}
.lre-world-fighters{display:flex;flex-direction:column;margin:0 calc(-1 * var(--lre-s3))}
.lre-world-fighter{display:grid;grid-template-columns:28px minmax(0,1fr) minmax(88px,38%);align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap-lg);padding:var(--lre-s2) var(--lre-s3)}
.lre-world-fighter+.lre-world-fighter{border-top:1px solid var(--lre-hairline)}
.lre-world-fighter.current{background:var(--lre-accent-soft);box-shadow:inset 3px 0 0 var(--lre-accent)}
.lre-world-fighter-turn{display:flex;justify-content:center;color:var(--lre-accent-text)}
.lre-world-init{font-size:var(--lre-fs-sm);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-world-fighter-who{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-world-fighter-name{font-weight:500;overflow-wrap:anywhere}
.lre-world-fighter-hp{min-width:0;display:flex;justify-content:flex-end}
.lre-world-fighter-hp>.lre-gauge{flex:1}
.lre-world-hp{font-size:var(--lre-fs-sm);font-weight:600;font-variant-numeric:tabular-nums}
.lre-world-budgets,.lre-world-moves,.lre-world-log{display:flex;flex-direction:column;gap:var(--lre-s2);padding-top:var(--lre-s3);border-top:1px solid var(--lre-hairline)}
.lre-world-sublabel{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-world-log>p{margin:0;font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-tree-frame{display:flex;flex-direction:column;min-width:0}
.lre-tree,.lre-tree-group{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;min-width:0}
.lre-tree-item{min-width:0;outline:none}
.lre-tree-item:focus-visible>.lre-tree-row{outline:2px solid var(--lre-accent);outline-offset:-2px}
.lre-tree-row{display:flex;align-items:center;gap:var(--lre-s2);width:100%;min-width:0;min-height:var(--lre-tap-lg);padding:var(--lre-s1) var(--lre-s3) var(--lre-s1) calc(var(--lre-s1) + var(--lre-tree-indent,0px));border:0;border-top:1px solid var(--lre-hairline);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color var(--lre-fast)}
.lre-tree>.lre-tree-item:first-child>.lre-tree-row{border-top:0}
.lre-tree-row:hover{background:var(--lre-hover)}
.lre-tree-row.inert{cursor:default}
.lre-tree-row.inert:hover{background:transparent}
.lre-tree-row.current{background:var(--lre-accent-soft);box-shadow:inset 3px 0 0 var(--lre-accent)}
.lre-tree-item.muted>.lre-tree-row{color:var(--lre-muted)}
.lre-tree-item.muted>.lre-tree-row .lre-tree-label{font-weight:400;font-style:italic}
.lre-tree-toggle{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;align-self:stretch;margin:calc(-1 * var(--lre-s1)) 0;color:var(--lre-muted)}
.lre-tree-icon{flex:none;display:inline-flex;color:var(--lre-muted)}
.lre-tree-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;padding:2px 0}
.lre-tree-label{font-size:var(--lre-fs-md);font-weight:500;overflow-wrap:anywhere}
.lre-tree-detail{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-tree-badges{display:flex;flex-wrap:wrap;gap:var(--lre-s1);min-width:0}
.lre-tree-value{flex:0 1 auto;max-width:38%;font-size:var(--lre-fs-sm);font-weight:500;color:var(--lre-muted);text-align:right;overflow-wrap:anywhere}
.lre-tree-trail{flex:none;color:var(--lre-dim)}
.lre-tree-menu{display:flex;flex-direction:column;margin:0 var(--lre-s3) var(--lre-s2) calc(var(--lre-s3) + 28px + var(--lre-tree-indent,0px));border:1px solid var(--lre-border);border-radius:var(--lre-r-lg);background:var(--lre-card);box-shadow:var(--lre-shadow-sm);overflow:hidden}
.lre-tree-action{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap-lg);padding:0 var(--lre-s3);border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color var(--lre-fast)}
.lre-tree-action+.lre-tree-action{border-top:1px solid var(--lre-hairline)}
.lre-tree-action:hover{background:var(--lre-hover)}
.lre-tree-action:focus-visible{outline-offset:-2px}
.lre-tree-action>.lre-icon{flex:none;color:var(--lre-muted)}
.lre-tree-action.danger,.lre-tree-action.danger>.lre-icon{color:var(--lre-neg)}
.lre-tree-crumbs{display:flex;align-items:center;flex-wrap:wrap;gap:2px;min-width:0;padding:var(--lre-s1) var(--lre-s2);border-bottom:1px solid var(--lre-hairline);font-size:var(--lre-fs-sm)}
.lre-tree-crumb-step{display:inline-flex;align-items:center;gap:2px;min-width:0}
.lre-tree-crumb{display:inline-flex;align-items:center;min-height:var(--lre-tap-lg);max-width:100%;padding:0 var(--lre-s2);border:0;border-radius:var(--lre-r-pill);background:transparent;color:var(--lre-accent-text);font:inherit;font-weight:500;text-align:left;overflow-wrap:anywhere;cursor:pointer}
button.lre-tree-crumb:hover{background:var(--lre-hover)}
.lre-tree-crumb.current{color:var(--lre-fg);font-weight:600;cursor:default}
.lre-tree-crumb-sep{flex:none;color:var(--lre-muted)}
.lre-tree-flat{border-bottom:1px solid var(--lre-hairline)}
`;
