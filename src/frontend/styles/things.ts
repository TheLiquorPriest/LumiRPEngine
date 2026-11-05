// Build's Things (frontend/build/things.tsx, ITEMS-SPEC §10.1) and GM → Things (frontend/gm/things.tsx,
// §10.2), phone first at 390 px: a thing's row (a toggle, its name with what it holds, its chips on
// the line under it, its actions; while a list chooses, its box beside them), the By place and By
// owner trees indented a step per level (four at most), the size choices and kind chips of Add a
// thing, and the chips Who may use it shows; in GM, the search with Select beside it, Here's people,
// Tidy up's cards with their buttons wrapping under the sentence, Keep in the world's lines, and the
// thing page's row of where-it-is actions. In Play, Belongings (packs/gear/ui/belongings.tsx): the
// search with Select and Add, the filter chips scrolling sideways, the outfit bar, the sections'
// groups of two-line rows (each with one verb and ⋯, a bag's load under it, what is in it indented),
// the saved outfits and loadouts, and the select bar held above Play's bottom bar; and the place
// sheet's at-once controls under each row, wrapping. Built on the tokens only; pickers are the
// character pickers'.

export const THINGS_CSS = `
.lre-thing-tree{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-thing-place,.lre-thing-owner{display:flex;flex-direction:column;gap:2px;min-width:0;padding-bottom:var(--lre-s2);border-bottom:1px solid var(--lre-hairline)}
.lre-thing-place-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--lre-s2);margin:var(--lre-s2) 0 var(--lre-s1);font-size:var(--lre-fs-md);font-weight:400;min-width:0}
.lre-thing-place-count{flex:none;color:var(--lre-muted);font-size:var(--lre-fs-sm)}
.lre-thing-row{--lre-depth:0;display:flex;align-items:flex-start;gap:var(--lre-s1);min-width:0;padding-left:calc(var(--lre-depth) * 12px)}
.lre-thing-gap{flex:none;width:40px;height:40px}
.lre-thing-open{flex:1 1 auto;display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;min-height:44px;padding:6px var(--lre-s1);border:0;border-radius:var(--lre-r-sm);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}
.lre-thing-open:hover{background:var(--lre-hover)}
.lre-thing-open:focus-visible{outline:2px solid var(--lre-accent);outline-offset:1px}
.lre-thing-open.picking{flex-direction:row;align-items:center;gap:var(--lre-s2)}
.lre-thing-text{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0}
.lre-thing-row.picked .lre-thing-open{background:var(--lre-accent-soft)}
.lre-thing-name{font-weight:600;overflow-wrap:anywhere}
.lre-thing-count{color:var(--lre-muted);font-weight:400}
.lre-thing-sub{color:var(--lre-muted);font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-thing-chips{display:flex;flex-wrap:wrap;align-items:center;gap:4px;min-width:0}
.lre-thing-chips.wrap{gap:var(--lre-s1)}
.lre-thing-chip{display:inline-flex;align-items:center;max-width:100%;padding:1px 8px;border-radius:var(--lre-r-pill);background:var(--lre-neutral-soft);font-size:var(--lre-fs-xs);line-height:1.6;overflow-wrap:anywhere}
.lre-thing-chip.muted{color:var(--lre-muted)}
.lre-thing-holder-name{--lre-depth:0;display:flex;align-items:center;gap:6px;min-height:32px;padding-left:calc(var(--lre-depth) * 12px + 8px);color:var(--lre-muted);font-size:var(--lre-fs-sm)}
.lre-thing-owner-head{display:flex;align-items:center;gap:var(--lre-s1);min-width:0}
.lre-thing-owner-text{flex:1 1 auto;display:flex;flex-direction:column;min-width:0}
.lre-thing-owner-name{font-weight:600;overflow-wrap:anywhere}
.lre-thing-owner-is{color:var(--lre-muted);font-weight:400;font-size:var(--lre-fs-sm)}
.lre-thing-bucket{display:flex;flex-direction:column;gap:2px;min-width:0}
.lre-thing-bucket-head{margin-top:var(--lre-s1);padding-left:var(--lre-s1);color:var(--lre-muted);font-size:var(--lre-fs-xs);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.lre-thing-sizes{display:flex;flex-direction:column;gap:var(--lre-s1)}
.lre-thing-size{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-height:44px;padding:var(--lre-s2);border:1px solid var(--lre-border);border-radius:var(--lre-r);background:var(--lre-card);color:inherit;font:inherit;text-align:left;cursor:pointer}
.lre-thing-size[aria-checked="true"]{border-color:var(--lre-accent);background:var(--lre-accent-soft)}
.lre-thing-size-name{font-weight:600}
.lre-thing-size-means,.lre-thing-size-eg{color:var(--lre-muted);font-size:var(--lre-fs-sm)}
.lre-gm-here .lre-thing-owner-head{justify-content:space-between}
.lre-gm-here .lre-thing-owner-head>.lre-thing-holder-name{flex:1 1 auto;min-width:0;padding-left:8px;overflow-wrap:anywhere}
.lre-gm-tidy-text{margin:0;overflow-wrap:anywhere}
.lre-gm-tidy-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s1);min-width:0}
.lre-gm-tidy-actions:empty{display:none}
.lre-gm-tidy-actions>.lre-btn{max-width:100%}
.lre-gm-thing-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s1);margin-top:var(--lre-s2);min-width:0}
.lre-gm-thing-actions>.lre-btn{flex:1 1 calc(50% - var(--lre-s1));min-width:0}
.lre-gm-keep-line{display:block;overflow-wrap:anywhere}
.lre-gm-things-top{display:flex;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-gm-things-top>.lre-gm-search{flex:1 1 auto;min-width:0}
.lre-manage-controls,.lre-manage-into{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1);min-width:0;padding:0 var(--lre-s3) var(--lre-s2)}
.lre-manage-into{padding-top:var(--lre-s1);border-top:1px dashed var(--lre-hairline)}
.lre-manage-controls>.lre-btn,.lre-manage-into>.lre-btn{max-width:100%}
.lre-thing-kinds{display:flex;flex-wrap:wrap;gap:var(--lre-s1);min-width:0}
.lre-thing-kind{min-height:36px;padding:0 12px;border:1px solid var(--lre-border);border-radius:var(--lre-r-pill);background:transparent;color:var(--lre-fg);font:inherit;font-size:var(--lre-fs-sm);font-weight:500;transition:background-color var(--lre-fast)}
.lre-thing-kind:hover:not(:disabled){background:var(--lre-hover)}
.lre-thing-kind[aria-pressed=true]{background:var(--lre-accent-soft);color:var(--lre-accent-text);border-color:color-mix(in srgb,var(--lre-accent) 40%,transparent);font-weight:600}
.lre-bel{gap:var(--lre-s3)}
.lre-bel-top{display:flex;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-bel-top>.lre-btn{flex:none}
.lre-bel-search{position:relative;flex:1 1 auto;display:flex;align-items:center;min-width:0}
.lre-bel-search>.lre-icon{position:absolute;left:var(--lre-s3);color:var(--lre-muted);pointer-events:none}
.lre-bel-search>.lre-input{padding-left:36px}
.lre-bel-chips{display:flex;gap:var(--lre-s1);min-width:0;margin:0 calc(-1 * var(--lre-s1));padding:2px var(--lre-s1);overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain}
.lre-bel-chips::-webkit-scrollbar{display:none}
.lre-bel-chip{flex:none;min-height:36px;padding:0 14px;border:1px solid var(--lre-border);border-radius:var(--lre-r-pill);background:transparent;color:var(--lre-fg);font:inherit;font-size:var(--lre-fs-sm);font-weight:500;white-space:nowrap;transition:background-color var(--lre-fast)}
.lre-bel-chip:hover{background:var(--lre-hover)}
.lre-bel-chip[aria-pressed=true]{background:var(--lre-accent-soft);color:var(--lre-accent-text);border-color:color-mix(in srgb,var(--lre-accent) 40%,transparent);font-weight:600}
.lre-bel-outfit{display:flex;align-items:center;gap:var(--lre-s2);width:100%;min-width:0;min-height:var(--lre-tap-lg);padding:0 var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);color:inherit;font:inherit;text-align:left;transition:background-color var(--lre-fast)}
.lre-bel-outfit:hover{background:var(--lre-hover)}
.lre-bel-outfit>.lre-icon{flex:none;color:var(--lre-muted)}
.lre-bel-outfit-label{flex:none;color:var(--lre-muted);font-size:var(--lre-fs-sm)}
.lre-bel-outfit-name{flex:1 1 auto;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lre-bel-groups{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-bel-group{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-bel-group-head{padding-left:var(--lre-s1);color:var(--lre-muted);font-size:var(--lre-fs-xs);font-weight:600;text-transform:uppercase;letter-spacing:.04em;overflow-wrap:anywhere}
.lre-bel-group-sub{font-weight:400;text-transform:none;letter-spacing:0}
.lre-bel-items{display:flex;flex-direction:column;min-width:0;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);overflow:hidden}
.lre-bel-item{min-width:0}
.lre-bel-items>.lre-bel-item+.lre-bel-item,.lre-bel-tree>.lre-bel-item+.lre-bel-item{border-top:1px solid var(--lre-hairline)}
.lre-bel-tree{border-top:1px solid var(--lre-hairline)}
.lre-bel-line{--lre-depth:0;display:flex;align-items:center;gap:var(--lre-s1);min-width:0;min-height:var(--lre-tap-lg);padding:0 var(--lre-s1) 0 calc(var(--lre-depth) * 12px)}
.lre-bel-line>.lre-btn{flex:none}
.lre-bel-item.picked>.lre-bel-line{background:var(--lre-accent-soft)}
.lre-bel-gap{flex:none;width:var(--lre-tap)}
.lre-bel-open{flex:1 1 auto;min-width:0;min-height:var(--lre-tap-lg);display:flex;align-items:center;gap:var(--lre-s2);padding:var(--lre-s2) var(--lre-s1) var(--lre-s2) 0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;transition:background-color var(--lre-fast)}
.lre-bel-open:hover:not(:disabled){background:var(--lre-hover)}
.lre-bel-open:disabled{opacity:.55}
.lre-bel-open:focus-visible{outline-offset:-2px}
.lre-bel-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-bel-name{font-weight:600;overflow-wrap:anywhere}
.lre-bel-sub{color:var(--lre-muted);font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-bel-load{--lre-depth:0;padding:0 var(--lre-s3) var(--lre-s2) calc(var(--lre-tap) + var(--lre-s1) + var(--lre-depth) * 12px)}
.lre-bel-sets{display:flex;flex-direction:column;min-width:0;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);overflow:hidden}
.lre-bel-set{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2) var(--lre-s3)}
.lre-bel-set+.lre-bel-set{border-top:1px solid var(--lre-hairline)}
.lre-bel-set-text{flex:1 1 12em;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-bel-set-name{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1);font-weight:600;overflow-wrap:anywhere}
.lre-bel-set-sub{color:var(--lre-muted);font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-bel-set-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s1)}
.lre-play .lre-selectbar{bottom:calc(var(--lre-tap-lg) + 2 * var(--lre-s1) + 1px + env(safe-area-inset-bottom,0px) + var(--lre-s2))}
`;
