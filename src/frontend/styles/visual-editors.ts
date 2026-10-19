// Build's visual editors (S7b, contract §4.6): the editing canvas shared by the grid painter, the
// map editor and the place editor (its zoom buttons and the selection dock under it), brushes and
// swatches, the map's problems and its JSON tab, lint marks over the map preview, the schedule's
// day bar with its handles, the track's stage graph, and the ruleset's parts. Tokens only: canvases
// read the canvas tokens at draw time; the SVG graph and the day bar take theirs from here.

export const VISUAL_EDITORS_CSS = `
/* the editing canvas (space/ui/editors.tsx): opaque and themed, since names on it are cut-outs that show it */
.lre-ve-stage{position:relative;width:100%;min-width:0;overflow:hidden;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-bar-bg);user-select:none;-webkit-user-select:none}
.lre-ve-stage>canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.lre-ve-zoom{position:absolute;right:var(--lre-s2);bottom:var(--lre-s2);display:flex;gap:6px}
.lre-ve-zoom>.lre-iconbtn{background:var(--lre-bar-bg)}
.lre-ve-toolbar{display:flex;align-items:center;gap:var(--lre-s2);min-width:0}
/* brushes: one row that scrolls sideways, so the canvas stays in sight under a long legend */
.lre-ve-brushes{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;mask-image:linear-gradient(90deg,currentColor calc(100% - 24px),transparent)}
.lre-ve-brushes::-webkit-scrollbar{display:none}
.lre-ve-brushes>.lre-form-chip{flex:none}
.lre-ve-toolbar>.lre-seg{flex:1 1 0;min-width:0}
.lre-ve-brush{display:inline-flex;align-items:center;gap:6px;min-width:0}
.lre-ve-brush>.lre-id{margin-left:2px}
.lre-ve-swatch{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;overflow:hidden;border-radius:4px;border:1px solid var(--lre-border);background:var(--lre-bar-bg)}
.lre-ve-swatch>i{position:absolute;inset:0}
.lre-ve-swatch>b{position:relative;font:600 10px/1 var(--lre-mono);color:var(--lre-fg)}
.lre-ve-dock{display:flex;align-items:center;gap:var(--lre-s2);min-width:0;padding:var(--lre-s1) var(--lre-s1) var(--lre-s1) var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-lg);background:var(--lre-card)}
.lre-ve-dock>.grow{flex:1 1 0;min-width:0;overflow-wrap:anywhere}

/* the map editor's problems and its JSON tab (space/ui/map-editor.tsx) */
.lre-ve-valid{display:flex;align-items:center;gap:6px;min-height:24px}
.lre-ve-problems-sum{display:inline-flex;align-items:center;gap:6px;font-weight:600}
.lre-ve-problems{display:flex;flex-direction:column;min-width:0}
.lre-ve-problem{display:flex;align-items:center;gap:var(--lre-s2);width:100%;min-height:var(--lre-tap);padding:var(--lre-s2) var(--lre-s1);border:0;border-bottom:1px solid var(--lre-hairline);background:transparent;color:inherit;font:inherit;text-align:left;transition:background-color var(--lre-fast)}
.lre-ve-problem:last-child{border-bottom:0}
.lre-ve-problem:hover{background:var(--lre-hover)}
.lre-ve-problem>.grow{flex:1 1 0;min-width:0;font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-ve-problem>.lre-icon{color:var(--lre-dim)}
.lre-ve-code{display:flex;height:min(60vh,420px);min-width:0;overflow:hidden;border:1px solid var(--lre-border);border-radius:var(--lre-r);background:var(--lre-well)}
.lre-ve-code:focus-within{border-color:var(--lre-accent)}
.lre-ve-code .gutter{margin:0;padding:var(--lre-s2) 6px;min-width:3em;text-align:right;color:var(--lre-dim);font:12px/18px var(--lre-mono);overflow:hidden;user-select:none;border-right:1px solid var(--lre-hairline)}
.lre-ve-code .gutter>span{display:block;padding:0 2px;border-radius:3px}
.lre-ve-code .gutter>.error{color:var(--lre-fg);background:color-mix(in srgb,var(--lre-danger) 30%,transparent);font-weight:700}
.lre-ve-code .gutter>.warning{color:var(--lre-fg);background:color-mix(in srgb,var(--lre-warning) 30%,transparent);font-style:italic}
.lre-ve-code .text{flex:1;min-width:0;margin:0;padding:var(--lre-s2);border:0;outline:none;resize:none;background:transparent;color:var(--lre-fg);font:12px/18px var(--lre-mono);white-space:pre;overflow:auto;tab-size:2}
.lre-ve-char{width:6em;font-family:var(--lre-mono);text-align:center}

/* lint marks over the map preview (space/ui/map-preview.tsx); the stage under it keeps the taps */
.lre-map .lre-ve-marks{pointer-events:none}

/* the schedule's day bar (calendar/ui/schedule-editor.tsx): slots coloured by value, with the value in words */
.lre-ve-day{position:relative;height:64px;margin:0 var(--lre-s1);touch-action:pan-y}
.lre-ve-day-track{position:absolute;inset:8px 0;border-radius:var(--lre-r);background:repeating-linear-gradient(90deg,transparent 0 calc(100% / 24 - 1px),var(--lre-hairline) calc(100% / 24 - 1px) calc(100% / 24)),var(--lre-well);overflow:hidden}
.lre-ve-day-slot{position:absolute;top:0;bottom:0;min-width:2px;padding:0 4px;border:1px solid var(--slot,var(--lre-accent));border-radius:var(--lre-r-sm);background:color-mix(in srgb,var(--slot,var(--lre-accent)) 30%,var(--lre-card));color:var(--lre-fg);font-size:var(--lre-fs-xs);font-weight:600;line-height:1.2;text-align:left;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.lre-ve-day-slot:hover{background:color-mix(in srgb,var(--slot,var(--lre-accent)) 42%,var(--lre-card))}
.lre-ve-day-slot[aria-current=true]{box-shadow:inset 0 0 0 2px var(--lre-fg)}
.lre-ve-handle{position:absolute;top:0;bottom:0;width:var(--lre-tap);margin-left:calc(var(--lre-tap) / -2);display:flex;align-items:center;justify-content:center;cursor:ew-resize;touch-action:none;z-index:1;border-radius:var(--lre-r)}
.lre-ve-handle>span{display:block;width:10px;height:30px;border-radius:var(--lre-r-pill);border:2px solid var(--lre-fg);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-sm)}
.lre-ve-handle[data-dragging]>span,.lre-ve-handle:hover>span{background:var(--lre-accent-fill);border-color:var(--lre-accent-fg)}
.lre-ve-handle:focus-visible{outline-offset:-2px}
.lre-ve-day-axis{display:flex;justify-content:space-between;margin:0 var(--lre-s1);font-size:var(--lre-fs-xs);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-ve-dot{display:inline-block;flex:none;width:10px;height:10px;border-radius:3px;border:1px solid var(--slot,var(--lre-accent));background:color-mix(in srgb,var(--slot,var(--lre-accent)) 45%,var(--lre-card))}
.lre-ve-times{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--lre-s2)}
.lre-ve-weight{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:var(--lre-s1) var(--lre-s2);padding:var(--lre-s2) 0;border-bottom:1px solid var(--lre-hairline)}
.lre-ve-weight:last-of-type{border-bottom:0}
.lre-ve-weight>.lre-row{grid-column:1/-1;border-bottom:0;padding:0}
.lre-ve-days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:2px}
.lre-ve-days>button{min-height:var(--lre-tap);min-width:0;padding:0;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-sm);background:transparent;color:var(--lre-muted);font-size:var(--lre-fs-sm);font-variant-numeric:tabular-nums}
.lre-ve-days>button[aria-pressed=true]{background:var(--lre-accent-fill);border-color:transparent;color:var(--lre-accent-fg);font-weight:600}
.lre-ve-days>button[aria-pressed=true]:focus-visible{outline-color:var(--lre-fg);box-shadow:inset 0 0 0 2px var(--lre-accent-fg)}

/* the track's stage graph (story/ui/track-editor.tsx): the start in the success colour and marked, a stage it can't reach dashed */
.lre-ve-graph{width:100%;min-width:0;overflow:auto;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-bar-bg);touch-action:pan-x pan-y;overscroll-behavior:contain}
.lre-ve-graph svg{display:block}
.lre-ve-graph .edge{fill:none;stroke:var(--lre-muted);stroke-width:1.5}
.lre-ve-graph .edge.fail{stroke:var(--lre-neg);stroke-dasharray:5 4}
.lre-ve-graph .arrow{fill:var(--lre-muted)}
.lre-ve-graph .arrow.fail{fill:var(--lre-neg)}
.lre-ve-graph .node{cursor:pointer}
.lre-ve-graph .node rect{fill:var(--lre-card);stroke:var(--lre-border);stroke-width:1.5}
.lre-ve-graph .node.start rect{stroke:var(--lre-pos);stroke-width:2.5}
.lre-ve-graph .node.lost rect{stroke:var(--lre-neg);stroke-dasharray:4 3}
.lre-ve-graph .node.current rect{fill:var(--lre-accent-soft);stroke:var(--lre-accent);stroke-width:2.5}
.lre-ve-graph .node:hover rect{fill:var(--lre-hover)}
.lre-ve-graph .node:focus{outline:none}
.lre-ve-graph .node:focus-visible rect{stroke:var(--lre-accent);stroke-width:3}
.lre-ve-graph .node .name{fill:var(--lre-fg);font:500 12px var(--lre-font)}
.lre-ve-graph .node .meta{fill:var(--lre-muted);font:11px var(--lre-font)}
.lre-ve-transition{display:flex;flex-direction:column;gap:var(--lre-s2);padding:var(--lre-s3) 0;border-bottom:1px solid var(--lre-hairline);min-width:0}
.lre-ve-transition:first-child{padding-top:0}
.lre-ve-transition:last-of-type{border-bottom:0}
.lre-ve-transition-head{display:flex;align-items:center;gap:var(--lre-s1);min-width:0}
.lre-ve-transition-head>.grow{flex:1 1 0;min-width:0;font-weight:500;overflow-wrap:anywhere}

/* the ruleset's parts (build/ruleset-editor.tsx) */
.lre-ve-row-target{font-family:var(--lre-mono);font-size:var(--lre-fs-sm)}
`;
