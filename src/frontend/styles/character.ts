// The character pickers (frontend/character/): a place or bed as a path with its Change button, the
// picker sheet's search, suggestions and browse rows, and a list of text as chips. Built on the tokens
// only; the sheet itself is Build's form sheet (styles/forms.ts).

export const CHARACTER_CSS = `
.lre-cp-field{min-width:0}
.lre-cp-value{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-cp-value>.lre-cp-path{flex:1 1 12rem}
.lre-cp-path{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:0 4px;min-width:0;overflow-wrap:anywhere;line-height:1.35}
.lre-cp-bed{flex:1 1 12rem;display:flex;flex-direction:column;gap:1px;min-width:0;overflow-wrap:anywhere;line-height:1.35}
.lre-cp-path-up{color:var(--lre-muted);font-size:var(--lre-fs-sm)}
.lre-cp-path-name{font-weight:600}
.lre-cp-path>.lre-badge{align-self:center}
.lre-cp-sep{margin-left:4px;color:var(--lre-muted)}
.lre-cp-sheet{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-cp-now{display:flex;flex-direction:column;gap:2px;min-width:0;padding:var(--lre-s2) var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-well)}
.lre-cp-now-label{font-size:var(--lre-fs-xs);font-weight:600;color:var(--lre-muted);text-transform:uppercase;letter-spacing:.04em}
.lre-cp-search{position:relative;display:flex;align-items:center;min-width:0}
.lre-cp-search>.lre-icon{position:absolute;left:var(--lre-s3);color:var(--lre-muted);pointer-events:none}
.lre-cp-search>.lre-input{padding-left:36px}
.lre-cp-note{margin:0;padding:var(--lre-s2) var(--lre-s3);font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-cp-trail{display:flex;flex-wrap:wrap;align-items:center;gap:2px;min-width:0;padding:var(--lre-s2) var(--lre-s3);border-bottom:1px solid var(--lre-hairline)}
.lre-cp-crumb-step{display:inline-flex;align-items:center;min-width:0}
.lre-cp-crumb{min-height:var(--lre-tap);padding:0 var(--lre-s1);border:0;border-radius:var(--lre-r-sm);background:transparent;color:var(--lre-accent-text);font:inherit;font-size:var(--lre-fs-sm);overflow-wrap:anywhere;text-align:left}
.lre-cp-crumb:hover{background:var(--lre-hover)}
.lre-cp-crumb[aria-current=location]{color:var(--lre-fg);font-weight:600}
.lre-cp-rows{display:flex;flex-direction:column;min-width:0}
.lre-cp-row{display:flex;align-items:center;gap:var(--lre-s2);min-width:0;min-height:var(--lre-tap-lg);padding:var(--lre-s1) var(--lre-s2) var(--lre-s1) var(--lre-s3)}
.lre-cp-row+.lre-cp-row{border-top:1px solid var(--lre-hairline)}
.lre-cp-row[aria-current=true]{background:var(--lre-accent-soft)}
.lre-cp-row-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1px}
.lre-cp-row-name{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1);font-weight:500;overflow-wrap:anywhere}
.lre-cp-row-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-cp-row>.lre-btn{flex:none}
.lre-cp-row-gap{flex:none;width:var(--lre-tap)}
.lre-cp-textlist-add{display:flex;gap:var(--lre-s2);min-width:0}
.lre-cp-textlist-add>.lre-input{flex:1 1 auto;min-width:0}
.lre-cp-textlist-add>.lre-btn{flex:none}
.lre-cp-textlist>.lre-cp-note{padding:0}
`;
