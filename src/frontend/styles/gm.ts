// GM mode's content (S4, contract §4.5, §9.4): the gate and the truth bar, the section body over the
// GM bottom bar, pages over a section's list, rows with their own actions, the entity editor's
// forms, track and money cards, This chat's rules (realism with its band-cap grid, checks, time,
// pins and the Upgrade review) and the Inspector. The GM frame (rule, tint, the mode bar's GM
// segment) is in shell.ts. GM gold marks GM chrome only: --lre-gm for rules and fills,
// --lre-gm-text for text.

export const GM_CSS = `
.lre-drawer[data-lre-mode=gm]>.lre-mode-body{padding-bottom:0}
.lre-gm{flex:1;display:flex;flex-direction:column;min-width:0}
.lre-gm-body{flex:1;display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0;padding-bottom:var(--lre-s5)}
.lre-gm .lre-section-body,.lre-gm-time .lre-section-body{display:flex;flex-direction:column;gap:var(--lre-s3)}
.lre-gm .lre-card+.lre-card{margin-top:0}
.lre-gm-truth-view{gap:var(--lre-s3)}
.lre-gm-gate{display:flex;flex-direction:column;align-items:center;gap:var(--lre-s3);padding:var(--lre-s5) var(--lre-s4);text-align:center;border:1px solid color-mix(in srgb,var(--lre-gm) 40%,transparent);border-radius:var(--lre-r-xl);background:linear-gradient(var(--lre-gm-soft),var(--lre-gm-soft)),var(--lre-card)}
.lre-gm-gate-icon{width:48px;height:48px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--lre-gm-soft);color:var(--lre-gm-text);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--lre-gm) 45%,transparent)}
.lre-gm-gate-title{margin:0;font-size:var(--lre-fs-lg);font-weight:600;color:var(--lre-gm-text)}
.lre-gm-gate-text{margin:0;max-width:34em}
.lre-gm-gate-note{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-gm-gate>.lre-btn{min-width:min(100%,220px)}
.lre-gm-truthbar{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap);padding:0 var(--lre-s1) 0 var(--lre-s3);border:1px solid color-mix(in srgb,var(--lre-gm) 35%,transparent);border-radius:var(--lre-r-lg);background:var(--lre-gm-soft);color:var(--lre-gm-text)}
.lre-gm-truthbar-text{flex:1;min-width:0;font-size:var(--lre-fs-sm);font-weight:600}
.lre-gm-truthbar>.lre-btn{color:var(--lre-gm-text)}
.lre-gm-pages{display:flex;flex-direction:column;min-width:0}
.lre-gm-list{gap:var(--lre-s3)}
.lre-gm-page{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0;animation:lre-gm-page-in var(--lre-med)}
@keyframes lre-gm-page-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
.lre-gm-page .lre-page-sub>.lre-id{display:block}
.lre-gm-tools{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-gm-search{position:relative;flex:1 1 100%;display:flex;align-items:center;min-width:0}
.lre-gm-search>.lre-icon{position:absolute;left:var(--lre-s3);color:var(--lre-muted);pointer-events:none}
.lre-gm-search>.lre-input{padding-left:36px}
.lre-gm-tools>select.lre-input{flex:1 1 9em;width:auto}
.lre-gm-tools>.lre-btn{flex:0 0 auto}
.lre-gm-badges{display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--lre-s1);min-width:0}
.lre-gm-badges.start{justify-content:flex-start}
.lre-gm-indent{display:inline-flex;align-items:center;color:var(--lre-muted)}
.lre-gm-rows{display:flex;flex-direction:column;min-width:0}
.lre-gm-row{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2) 0;border-bottom:1px solid var(--lre-hairline)}
.lre-gm-rows>.lre-gm-row:first-child{padding-top:0}
.lre-gm-rows>.lre-gm-row:last-child{padding-bottom:0;border-bottom:0}
.lre-gm-row-main{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap);min-width:0}
.lre-gm-row-text{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-gm-row-title{font-size:var(--lre-fs-md);font-weight:500;overflow-wrap:anywhere}
.lre-gm-row-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-row-value{flex:0 0 auto;max-width:55%;font-weight:600;font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:break-word}
.lre-gm-row-actions{flex:none;display:flex;align-items:center;gap:2px;margin-right:calc(-1 * var(--lre-s1))}
.lre-gm-row-actions>.lre-iconbtn{color:var(--lre-muted)}
.lre-gm-row-actions>.lre-iconbtn:hover:not(:disabled){color:var(--lre-fg)}
.lre-gm-row-long{white-space:pre-wrap;overflow-wrap:anywhere}
.lre-gm-label{display:inline-flex;align-items:center;gap:var(--lre-s1)}
.lre-gm-label>.lre-icon{color:var(--lre-muted)}
textarea.lre-input.lre-gm-prose{font-family:inherit;font-size:var(--lre-fs-md)}
.lre-gm-meterrow{gap:var(--lre-s1)}
.lre-gm-none,.lre-gm-note{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-gm-subform{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;padding-top:var(--lre-s3);border-top:1px solid var(--lre-hairline)}
.lre-gm-subtitle{font-size:var(--lre-fs-sm);font-weight:600}
.lre-gm-subtitle-note{font-weight:400;color:var(--lre-muted)}
.lre-gm-addto{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-gm-addto>select.lre-input{flex:1 1 9em;width:auto}
.lre-gm-addto>.lre-input,.lre-gm-addto>.lre-money{flex:1 1 6em;width:auto}
.lre-gm-addto>.lre-btn{flex:0 0 auto}
.lre-gm-levels{display:flex;flex-direction:column;gap:var(--lre-s2)}
.lre-gm-level{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2)}
.lre-gm-level-name{flex:1 1 8em;min-width:0;display:flex;flex-direction:column;font-weight:500}
.lre-gm-level-now{font-size:var(--lre-fs-xs);font-weight:400;color:var(--lre-muted)}
.lre-gm-level>select.lre-input{flex:1 1 10em;width:auto}
.lre-gm-entity{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-gm-card{display:flex;flex-direction:column;gap:var(--lre-s3)}
.lre-gm-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--lre-s2);min-width:0}
.lre-gm-card-titles{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-gm-card-title{margin:0;font-size:var(--lre-fs-md);font-weight:600;overflow-wrap:anywhere}
.lre-gm-card-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-gm-truths{display:flex;flex-direction:column;gap:var(--lre-s2)}
.lre-gm-truth{padding:var(--lre-s1) 0 var(--lre-s1) var(--lre-s3);border-left:3px solid var(--lre-hairline)}
.lre-gm-truth[aria-current=step]{border-left-color:var(--lre-gm)}
.lre-gm-truth-stage{display:flex;align-items:center;gap:var(--lre-s2);font-size:var(--lre-fs-sm);font-weight:600;color:var(--lre-muted)}
.lre-gm-truth>p{margin:2px 0 0}
.lre-gm-lines{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:var(--lre-s1);font-size:var(--lre-fs-sm)}
.lre-gm-preview-lines{margin:var(--lre-s1) 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:var(--lre-s1)}
.lre-gm-preview-lines>li{display:flex;align-items:flex-start;gap:var(--lre-s2)}
.lre-gm-preview-lines .lre-icon{margin-top:2px;color:var(--lre-accent-text)}
.lre-gm-sliders{display:flex;flex-direction:column;gap:var(--lre-s2);padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre-gm-level-slider{display:flex;flex-direction:column;gap:2px;min-width:0}
.lre-gm-level-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--lre-s1) var(--lre-s2)}
.lre-gm-level-domain{font-weight:500}
.lre-gm-level-value{font-size:var(--lre-fs-sm);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-gm-caps-wrap{container-type:inline-size}
.lre-gm-caps{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,minmax(56px,72px));gap:var(--lre-s1);align-items:center;font-size:var(--lre-fs-sm)}
.lre-gm-caps-row,.lre-gm-caps-cell{display:contents}
.lre-gm-caps [role=columnheader],.lre-gm-caps [role=rowheader]{min-width:0;overflow-wrap:break-word;hyphens:auto}
.lre-gm-caps-band{color:var(--lre-muted);text-align:center}
.lre-gm-caps select.lre-input{width:100%;min-width:40px;padding-left:var(--lre-s1);padding-right:var(--lre-s1)}
@container (max-width:319px){.lre-gm-caps{grid-template-columns:repeat(3,minmax(40px,1fr))}.lre-gm-caps-row>[role=columnheader]:first-child,.lre-gm-caps [role=rowheader]{grid-column:1/-1}.lre-gm-caps [role=rowheader]{padding-top:var(--lre-s1)}}
.lre-gm-speed{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-gm-speed+.lre-gm-speed{padding-top:var(--lre-s3);border-top:1px solid var(--lre-hairline)}
.lre-gm-upgrade{gap:var(--lre-s3)}
.lre-gm-upgrade-head{display:flex;flex-direction:column;gap:var(--lre-s1)}
.lre-gm-rev{font:var(--lre-fs-sm)/1.3 var(--lre-mono)}
.lre-gm-pager{display:flex;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-gm-pager-text{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center}
.lre-gm-pager-when{font-weight:600;font-variant-numeric:tabular-nums}
.lre-gm-pager-count{font-size:var(--lre-fs-xs);color:var(--lre-muted)}
.lre-gm-lore{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-gm-lore+.lre-gm-lore{padding-top:var(--lre-s3);border-top:1px solid var(--lre-hairline)}
.lre-gm-queries{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-warnline{margin:0;display:flex;align-items:flex-start;gap:var(--lre-s1);font-size:var(--lre-fs-sm);color:var(--lre-warn)}
`;
