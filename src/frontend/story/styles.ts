// The story's pages (story/): the Harness tab's frame and its bottom bar, Cast, Record and Notebook,
// the file editor, a level of the model ladder, and the prepared start on Play → Now. Phone first:
// everything wraps at 360 px; on a wide drawer a beat's head keeps to one line. The bar's height is
// said once here (`--lre-harness-nav-h`), so LumiAH's pages above it fill only what it leaves.

export const STORY_CSS = `
.lre-story-frame{flex:1;display:flex;flex-direction:column;min-width:0;--lre-harness-nav-h:calc(var(--lre-tap-lg) + 2 * var(--lre-s1) + 1px + env(safe-area-inset-bottom,0px))}
.lre-story-body{flex:1;display:flex;flex-direction:column;min-width:0}
.lre-story-page{padding:var(--lre-s3) 0 var(--lre-s5);gap:var(--lre-s3)}
.lre-story-page .lre-section-body{display:flex;flex-direction:column;gap:var(--lre-s2)}
.lre-story-lead{margin:0;padding:0 var(--lre-s1);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-story-note{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-story-why{margin:0;overflow-wrap:anywhere}
.lre-story-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-story-actions>.lre-btn{min-height:var(--lre-tap)}
.lre-story-actions>.lre-story-note{flex:1 1 14em}
.lre-story-editor{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
textarea.lre-input.lre-story-text{min-height:16em;font-family:var(--lre-font);font-size:var(--lre-fs-md);line-height:1.5}
.lre-story-notice{margin:0;padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r);background:var(--lre-well);font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-story-when{font-size:var(--lre-fs-xs);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-story-quote{margin:0;padding:var(--lre-s1) var(--lre-s3);border-left:3px solid var(--lre-accent-soft);font-style:italic;overflow-wrap:anywhere}
.lre-story-reached,.lre-story-beats,.lre-story-drafts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-story-reached-item,.lre-story-beat,.lre-story-draft{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0;padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-lg);background:var(--lre-card)}
.lre-story-reached-head,.lre-story-beat-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-story-reached-head>span:first-child,.lre-story-beat-who{flex:1 1 auto;min-width:0;font-weight:600;overflow-wrap:anywhere}
.lre-story-text-line,.lre-story-beat-what{margin:0;overflow-wrap:anywhere;white-space:pre-wrap}
.lre-story-beat-body{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-story-beat[data-lre-beat-kind=inner] .lre-story-beat-what{font-style:italic}
.lre-story-beat[data-lre-struck]{border-style:dashed;background:var(--lre-neg-soft)}
.lre-story-beat[data-lre-struck] .lre-story-beat-body{text-decoration:line-through;text-decoration-color:var(--lre-neg);opacity:.75}
.lre-story-struck-why{margin:0;font-size:var(--lre-fs-sm);font-weight:600;color:var(--lre-neg);overflow-wrap:anywhere}
.lre-story-reach{display:flex;flex-direction:column;gap:var(--lre-s1);padding-top:var(--lre-s1);border-top:1px solid var(--lre-hairline);min-width:0}
.lre-story-reach-title{font-size:var(--lre-fs-sm);font-weight:600}
.lre-story-reach-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;min-width:0}
.lre-story-reach-list>li{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px var(--lre-s2);font-size:var(--lre-fs-sm);min-width:0}
.lre-story-reach-how{color:var(--lre-muted)}
.lre-story-reach-got{flex:1 1 100%;padding-left:var(--lre-s3);overflow-wrap:anywhere}
.lre-story-by{margin:0;font-size:var(--lre-fs-xs);color:var(--lre-muted)}
.lre-story-who{display:inline;min-height:0;padding:0;border:0;background:none;color:var(--lre-accent-text);font:inherit;font-weight:600;text-align:left;cursor:pointer;text-decoration:underline;text-decoration-color:var(--lre-accent-soft);text-underline-offset:2px}
.lre-story-who:hover{text-decoration-color:currentColor}
.lre-story-picker{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--lre-s2);min-width:0}
.lre-story-picker>.lre-field{flex:1 1 16em;min-width:0}
.lre-story-picker>.lre-btn{min-height:var(--lre-tap)}
.lre-story-runs{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--lre-s2)}
.lre-story-runs>li{display:flex;flex-direction:column;gap:2px;min-width:0;overflow-wrap:anywhere}
.lre-story-runs-label{font-size:var(--lre-fs-sm);font-weight:600}
.lre-story-pick{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-story-pick>.lre-btn{align-self:flex-start}
.lre-story-prepare{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-story-prepare-figures{display:grid;grid-template-columns:repeat(auto-fit,minmax(9em,1fr));gap:var(--lre-s2)}
.lre-story-prepare-plan{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-story-prepare-plan h4{margin:0;font-size:var(--lre-fs-sm)}
.lre-story-prepare-plan p{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.lre-story-prepare-list{margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:var(--lre-s1);overflow-wrap:anywhere}
.lre-story-prepare-form{display:flex;flex-wrap:wrap;align-items:flex-end;gap:var(--lre-s2);min-width:0}
.lre-story-prepare-form>.lre-field{flex:1 1 14em;min-width:0}
.lre-story-prepare-form>.lre-btn{min-height:var(--lre-tap)}
.lre-story-budget{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--lre-s2)}
@container (max-width:340px){.lre-story-budget{grid-template-columns:1fr}}
textarea.lre-input.lre-story-say{min-height:4.5em;font-family:var(--lre-font);font-size:var(--lre-fs-md);line-height:1.45}
.lre-story-level-head{display:flex;flex-direction:column;align-items:flex-start;gap:2px;flex:1;min-width:0}
.lre-story-level-title{font-weight:500;overflow-wrap:anywhere}
.lre-story-level-value{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-story-problem{color:var(--lre-neg);font-weight:600}
`;
