// Build's forms: the form sheet (a sub-editor's own page), fields with their lint, chips, the
// typed list editors, the expression editor, the selector and facet widgets, the tier and level
// grids, the data-table editor and the lore editors. Each block below belongs to one editor.

export const FORMS_CSS = `
/* form sheet: while one is open it is all the mode body shows; its ancestors step out of the layout */
.lre-mode-body:has(.lre-form-sheet[data-top]) :not(:has(.lre-form-sheet[data-top])):not(.lre-form-sheet[data-top]):not(.lre-form-sheet[data-top] *){display:none!important}
.lre-mode-body:has(.lre-form-sheet[data-top]) :has(.lre-form-sheet[data-top]){display:contents!important}
.lre-form-sheet{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0;scroll-margin-top:64px}
.lre-form-sheet-body{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}

/* lint under a field */
.lre-form-issues{display:flex;flex-direction:column;gap:2px;min-width:0}
.lre-form-issue{display:flex;align-items:flex-start;gap:var(--lre-s1);font-size:var(--lre-fs-sm);line-height:1.35;overflow-wrap:anywhere}
.lre-form-issue>.lre-icon{flex:none;margin-top:1px}
.lre-form-issue.neg{color:var(--lre-neg)}.lre-form-issue.warn{color:var(--lre-warn)}.lre-form-issue.info{color:var(--lre-muted)}

/* shared field parts: the optional mark, pickers, add rows, a group of fields, item rows with their actions */
.lre-form-optional{font-weight:400;color:var(--lre-dim)}
.lre-form-ref{display:flex;flex-direction:column;gap:2px;min-width:0}
.lre-form-addpick{min-width:0}
.lre-form-addpick>.lre-field>.label{display:none}
.lre-form-add{display:flex;gap:var(--lre-s2);align-items:flex-end;min-width:0}
.lre-form-add>:first-child{flex:1 1 0;min-width:0}
.lre-form-add>.lre-btn{flex:none}
.lre-form-group{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0;padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre-form-group-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-height:var(--lre-tap);min-width:0}
.lre-form-group-title{min-width:0;font-weight:600;overflow-wrap:anywhere}
.lre-field>label.lre-form-switch{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s3);min-height:var(--lre-tap);min-width:0;padding:var(--lre-s1) 0;cursor:pointer;font-size:var(--lre-fs-md);font-weight:400;color:var(--lre-fg)}
.lre-form-switch>.text{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
.lre-form-switch>.text>.help{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-form-items{display:flex;flex-direction:column;min-width:0;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);overflow:hidden}
.lre-form-item{display:flex;align-items:center;gap:var(--lre-s1);min-height:var(--lre-tap-lg);padding:0 var(--lre-s1) 0 0;min-width:0}
.lre-form-item+.lre-form-item{border-top:1px solid var(--lre-hairline)}
.lre-form-item-open{flex:1 1 0;min-width:0;align-self:stretch;display:flex;align-items:center;gap:var(--lre-s2);padding:var(--lre-s2) var(--lre-s2) var(--lre-s2) var(--lre-s3);border:0;background:transparent;color:inherit;font:inherit;text-align:left;transition:background-color var(--lre-fast)}
button.lre-form-item-open:hover{background:var(--lre-hover)}
button.lre-form-item-open:focus-visible{outline-offset:-2px}
.lre-form-item-text{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-form-item-title{font-weight:500;overflow-wrap:anywhere}
.lre-form-item-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-form-item-open>.lre-icon{color:var(--lre-dim)}
.lre-form-item-actions{flex:none;display:flex;align-items:center}
.lre-form-items>.lre-empty{padding:var(--lre-s3)}

/* chips: a pill drawn inside a 40 px target */
.lre-form-chips{display:flex;flex-wrap:wrap;gap:0 var(--lre-s1);min-width:0}
.lre-form-chip{position:relative;isolation:isolate;display:inline-flex;align-items:center;gap:6px;min-height:var(--lre-tap);max-width:100%;padding:0 var(--lre-s3);border:0;background:transparent;color:var(--lre-fg);font-size:var(--lre-fs-sm);font-weight:500;line-height:1.2;text-align:left}
.lre-form-chip::before{content:"";position:absolute;inset:4px 0;z-index:-1;border-radius:var(--lre-r-pill);border:1px solid var(--lre-border);background:var(--lre-subtle);transition:background-color var(--lre-fast),border-color var(--lre-fast)}
button.lre-form-chip:hover:not(:disabled)::before{background:var(--lre-hover)}
.lre-form-chip>.lre-icon{color:var(--lre-muted)}
.lre-form-chip[aria-pressed=true]{color:var(--lre-accent-text)}
.lre-form-chip[aria-pressed=true]::before{background:var(--lre-accent-soft);border-color:color-mix(in srgb,var(--lre-accent) 45%,transparent)}
.lre-form-chip[aria-pressed=true]>.lre-icon{color:inherit}
.lre-form-chip.warn{color:var(--lre-warn)}.lre-form-chip.warn::before{background:var(--lre-warn-soft);border-color:color-mix(in srgb,var(--lre-warning) 40%,transparent)}
.lre-form-chip.neg{color:var(--lre-neg)}.lre-form-chip.neg::before{background:var(--lre-neg-soft);border-color:color-mix(in srgb,var(--lre-danger) 40%,transparent)}
.lre-form-chip.static::before{background:var(--lre-neutral-soft);border-color:transparent}
.lre-form-chip-text{min-width:0;overflow-wrap:anywhere}

/* expression editor and effect arguments (expr-editor.tsx, effect-args.tsx) */
.lre-expr-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-width:0}
.lre-expr-label{min-width:0;overflow-wrap:anywhere}
.lre-expr-actions{flex:none;display:flex;align-items:center}
textarea.lre-input.lre-expr-input{font:var(--lre-fs-sm)/1.5 var(--lre-mono)}
textarea.lre-input.lre-expr-input.page{font-size:var(--lre-fs-md)}
.lre-expr-token{font-family:var(--lre-mono)}
.lre-expr-chip-name{margin-left:6px;font-weight:400;color:var(--lre-muted)}
.lre-expr-suggest.scroll{flex-wrap:nowrap;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;padding:var(--lre-s1);margin:calc(-1 * var(--lre-s1))}
.lre-expr-suggest.scroll>.lre-form-chip{flex:none;max-width:none;white-space:nowrap}
.lre-expr-readout{margin:0;font-size:var(--lre-fs-sm);line-height:1.4;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-expr-page{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-expr-compose{position:sticky;top:calc(var(--lre-stick-top,0px) + var(--lre-modebar-h,0px));z-index:3;display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0;padding:var(--lre-s2) 0;border-bottom:1px solid var(--lre-hairline);background:var(--lre-bar-bg)}
.lre-expr-palette{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-expr-palette.inline{max-height:360px;overflow:auto;overscroll-behavior:contain;padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-well)}
.lre-expr-group{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-expr-group-title{font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-muted)}
.lre-expr-keys{display:grid;grid-template-columns:repeat(auto-fill,minmax(44px,1fr));gap:var(--lre-s1)}
.lre-expr-words{display:flex;flex-wrap:wrap;gap:var(--lre-s1);min-width:0}
.lre-expr-key{display:inline-flex;align-items:center;justify-content:center;min-height:var(--lre-tap);min-width:var(--lre-tap);max-width:100%;padding:0 var(--lre-s2);border:1px solid var(--lre-border);border-radius:var(--lre-r);background:var(--lre-subtle);color:var(--lre-fg);font:500 var(--lre-fs-sm)/1.2 var(--lre-mono);overflow-wrap:anywhere;transition:background-color var(--lre-fast)}
.lre-expr-key:hover{background:var(--lre-hover)}
.lre-expr-key.name{flex-direction:column;align-items:flex-start;gap:2px;padding:var(--lre-s1) var(--lre-s3);font-family:var(--lre-font);text-align:left}
.lre-expr-none{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-field.lre-form-args{gap:var(--lre-s2)}
.lre-form-args-name{font-family:var(--lre-mono);font-size:var(--lre-fs-sm)}
.lre-form-args-aside{flex:none;display:flex;align-items:center;gap:var(--lre-s1)}

/* tier and level grids (schema-form.tsx: levels and band caps) */
.lre-tier-wrap{container-type:inline-size}
.lre-tier-grid{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,72px);gap:4px;align-items:center;font-size:12px}
.lre-tier-grid [role=columnheader],.lre-tier-grid [role=rowheader]{min-width:0;overflow-wrap:break-word;hyphens:auto}
@container (max-width:319px){.lre-tier-grid{grid-template-columns:repeat(3,minmax(40px,1fr))}.lre-tier-grid [role=row]>[role=columnheader]:first-child,.lre-tier-grid [role=rowheader]{grid-column:1/-1}.lre-tier-grid [role=rowheader]{padding-top:4px}}
.lre-tier-grid select{min-height:40px;width:100%;min-width:40px;padding-left:4px;padding-right:4px}

/* schema form: typed lists, records, kind fields, durations and times (schema-form.tsx) */
.lre-form-fields{display:flex;flex-direction:column;gap:var(--lre-s4);min-width:0}
.lre-form-group>.lre-form-fields,.lre-form-sheet-body>.lre-form-fields{gap:var(--lre-s3)}
.lre-input.lre-form-mono{font-family:var(--lre-mono);font-size:var(--lre-fs-sm)}
textarea.lre-input.lre-form-prose{font-family:var(--lre-font);font-size:var(--lre-fs-md);line-height:1.45}
.lre-form-contents{display:contents}
.lre-form-list{gap:var(--lre-s2)}
.lre-form-list-head{display:flex;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-form-list-head>.label{font-size:var(--lre-fs-sm);font-weight:500;color:var(--lre-muted);min-width:0;overflow-wrap:anywhere}
.lre-form-list-add{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
.lre-form-items-none{padding:var(--lre-s3);color:var(--lre-muted);font-size:var(--lre-fs-sm)}
.lre-form-item-sub>.lre-id{margin-left:var(--lre-s1)}
.lre-form-scalar{display:flex;align-items:flex-start;gap:var(--lre-s1);min-width:0}
.lre-form-scalar-field{flex:1 1 0;min-width:0}
.lre-form-scalar-actions{flex:none;display:flex;align-items:center}
.lre-form-sheet-actions{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--lre-s2);padding-top:var(--lre-s2)}
.lre-form-newkey{gap:var(--lre-s3)}
.lre-form-absent{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-height:var(--lre-tap);padding:var(--lre-s1) var(--lre-s3);border:1px dashed var(--lre-border);border-radius:var(--lre-r-xl);min-width:0}
.lre-form-absent-label{flex:1 1 10rem;min-width:0;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-form-kindfields{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-form-formula{display:block;padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r);background:var(--lre-well);font:var(--lre-fs-sm)/1.45 var(--lre-mono);overflow-wrap:anywhere;white-space:pre-wrap}
.lre-form-levels{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,15rem),1fr));gap:var(--lre-s2) var(--lre-s3);min-width:0}
.lre-form-level{display:grid;grid-template-columns:minmax(0,1fr) minmax(8.5rem,10rem);align-items:center;gap:var(--lre-s2);min-width:0}
.lre-form-level>label{min-width:0;overflow-wrap:anywhere}
.lre-form-daytime{display:grid;grid-template-columns:minmax(4.5rem,7rem) minmax(0,1fr);gap:var(--lre-s2);min-width:0}
.lre-form-daytime-part{display:flex;flex-direction:column;gap:2px;min-width:0;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
input[type=datetime-local].lre-input,input[type=date].lre-input,input[type=time].lre-input{min-width:0;color-scheme:inherit}

/* selector, classification widgets and tiers (selector-editor.tsx, facet-editor.tsx, tiers-editor.tsx) */
.lre-form-sel{min-width:0}
.lre-form-sel-absent{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-height:var(--lre-tap);min-width:0}
.lre-form-sel-absent-label{flex:1 1 8rem;min-width:0;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-form-sel-lead{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-form-facet-lines{display:flex;flex-direction:column;gap:1px;min-width:0}
.lre-form-facet-in{font-size:var(--lre-fs-xs);font-weight:400;color:var(--lre-muted)}
.lre-form-chip[aria-pressed=true] .lre-form-facet-in{color:inherit}
.lre-form-chip:has(.lre-form-facet-lines){padding-top:var(--lre-s2);padding-bottom:var(--lre-s2)}
.lre-form-facet-row{min-width:0}
.lre-form-facet-row+.lre-form-facet-row{border-top:1px solid var(--lre-hairline)}
.lre-form-facet-row[data-depth="1"]>.lre-form-item>.lre-form-item-open{padding-left:calc(var(--lre-s3) + var(--lre-s4))}
.lre-form-facet-row[data-depth="2"]>.lre-form-item>.lre-form-item-open{padding-left:calc(var(--lre-s3) + 2 * var(--lre-s4))}
.lre-form-facet-row[data-depth="3"]>.lre-form-item>.lre-form-item-open{padding-left:calc(var(--lre-s3) + 3 * var(--lre-s4))}
.lre-form-facet-row[data-depth="4"]>.lre-form-item>.lre-form-item-open{padding-left:calc(var(--lre-s3) + 4 * var(--lre-s4))}
.lre-form-facet-row-issues{padding:0 var(--lre-s3) var(--lre-s2)}
.lre-form-facet-row-issues:empty{display:none}
.lre-form-facet-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
.lre-form-facet-new{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-field.lre-form-facet-classes{gap:var(--lre-s3)}
.lre-form-facet-class{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-form-facet-label{font-size:var(--lre-fs-sm);font-weight:500;color:var(--lre-fg);overflow-wrap:anywhere}
.lre-form-facet-stale{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-width:0}
.lre-form-facet-stale-text{flex:1 1 12rem;min-width:0;display:flex;align-items:flex-start;gap:var(--lre-s1);font-size:var(--lre-fs-sm);color:var(--lre-warn);overflow-wrap:anywhere}
.lre-form-facet-stale-text>.lre-icon{flex:none;margin-top:1px}
.lre-form-tiers{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-form-tier-intro{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-form-tier{min-width:0}
.lre-form-tier-actions{flex:none;display:flex;align-items:center}
.lre-form-tier-uses{display:flex;flex-direction:column;gap:2px;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-form-tier-spawn,.lre-form-tier-new{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}

/* data-table editor (table-editor.tsx) */
.lre-form-table-code{font:var(--lre-fs-sm)/1.3 var(--lre-mono);overflow-wrap:anywhere}
.lre-form-table-mono{font-family:var(--lre-mono);font-size:var(--lre-fs-sm)}
textarea.lre-input.lre-form-table-prose{font-family:inherit;font-size:var(--lre-fs-md)}
.lre-form-table-tools{padding:var(--lre-s2) var(--lre-s3);border-bottom:1px solid var(--lre-hairline);scroll-margin-top:calc(var(--lre-modebar-h,0px) + 64px)}
.lre-form-table-search{position:relative;display:flex;align-items:center;min-width:0}
.lre-form-table-search>.lre-icon{position:absolute;left:var(--lre-s3);color:var(--lre-muted);pointer-events:none}
.lre-form-table-search>.lre-input{padding-left:36px}
.lre-form-table-scroll{position:relative;container-type:inline-size;overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}
.lre-form-table-scroll:focus-visible{outline-offset:-2px}
.lre-form-table-grid{width:max-content;min-width:100%;border-collapse:separate;border-spacing:0;font-size:var(--lre-fs-sm);line-height:1.35}
.lre-form-table-grid th,.lre-form-table-grid td{padding:var(--lre-s2) var(--lre-s3);border-bottom:1px solid var(--lre-hairline);font-weight:400;text-align:left;vertical-align:middle}
.lre-form-table-grid thead th{font-weight:600;color:var(--lre-muted);vertical-align:bottom}
.lre-form-table-grid tbody tr:last-child>*{border-bottom:0}
.lre-form-table-grid .num{text-align:right;font-variant-numeric:tabular-nums}
.lre-form-table-head{display:block;min-width:4.5em;max-width:11em}
.lre-form-table-grid th.num>.lre-form-table-head{margin-left:auto}
.lre-form-table-name{position:sticky;left:0;z-index:1;border-right:1px solid var(--lre-hairline);background:linear-gradient(var(--lre-card),var(--lre-card)),var(--lre-bar-bg)}
.lre-form-table-grid tbody .lre-form-table-name{padding:0}
.lre-form-table-grid .lre-form-table-open{display:flex;align-items:center;gap:var(--lre-s2);width:clamp(7.5rem,40cqi,15rem);min-height:var(--lre-tap-lg);padding:var(--lre-s1) var(--lre-s3);border:0;background:transparent;color:var(--lre-accent-text);font-size:var(--lre-fs-md);font-weight:500;line-height:1.3;text-align:left;transition:background-color var(--lre-fast)}
.lre-form-table-grid .lre-form-table-open:hover{background:var(--lre-hover)}
.lre-form-table-grid .lre-form-table-open:focus-visible{outline-offset:-2px}
.lre-form-table-open-text{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}
.lre-form-table-open>.lre-badge{flex:none}
.lre-form-table-val{display:flex;align-items:center;gap:var(--lre-s1);min-width:0;max-width:16em}
.lre-form-table-grid td.num>.lre-form-table-val{justify-content:flex-end;margin-left:auto}
.lre-form-table-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lre-form-table-empty{color:var(--lre-dim)}
.lre-form-table-cell.bad{color:var(--lre-neg)}
.lre-form-table-pager{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);padding:var(--lre-s1) var(--lre-s2);border-top:1px solid var(--lre-hairline)}
.lre-form-table-range{min-width:0;font-size:var(--lre-fs-sm);color:var(--lre-muted);font-variant-numeric:tabular-nums;text-align:center}
.lre-form-table-foot{padding:var(--lre-s2) var(--lre-s3);border-top:1px solid var(--lre-hairline)}
.lre-form-table-new{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-form-table-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-form-table-actions.spread{justify-content:space-between}
.lre-form-table-ref .lre-field>.label{display:none}
.lre-form-table-band{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,6.5rem),1fr));gap:var(--lre-s2);min-width:0}

/* lore entries and the lookup table (lore-editor.tsx, lookup-editor.tsx) */
.lre-form-lore-fields{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-form-lore-wrap{display:contents}
.lre-form-lore-row{display:contents}
.lre-form-lore-row+.lre-form-lore-row .lre-listrow-content{border-top:1px solid var(--lre-hairline)}
.lre-form-lore-badges{flex:0 1 auto;max-width:50%;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--lre-s1)}
.lre-form-lore-source{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;overflow-wrap:anywhere}
.lre-form-lore-note{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-form-lore-mono{font:var(--lre-fs-sm)/1.3 var(--lre-mono);overflow-wrap:anywhere}
.lre-form-lore-from{font-weight:400;color:var(--lre-muted)}
.lre-form-lore-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2);min-width:0}
.lre-form-lore-actions>.lre-btn{max-width:100%;white-space:normal}
`;
