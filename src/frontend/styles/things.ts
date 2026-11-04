// Build's Things (frontend/build/things.tsx, ITEMS-SPEC §10.1) and GM → Things (frontend/gm/things.tsx,
// §10.2), phone first at 390 px: a thing's row (a toggle, its name with what it holds, its chips on
// the line under it, its actions; while a list chooses, its box beside them), the By place and By
// owner trees indented a step per level (four at most), the size choices of Add a thing, and the
// chips Who may use it shows; in GM, the search with Select beside it, Here's people, Tidy up's
// cards with their buttons wrapping under the sentence, Keep in the world's lines, and the thing
// page's row of where-it-is actions; in Play, Gear → Manage's and Things here's at-once controls
// under each row, wrapping. Built on the tokens only; pickers are the character pickers'.

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
`;
