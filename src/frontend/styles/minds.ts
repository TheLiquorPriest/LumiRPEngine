// Character minds: GM → Minds (the minds pack's tab), Play → What you know, and the notes under Build's Needs and
// Routines parts. Built on the tokens only.

export const MINDS_CSS = `
/* The notes under Build's Needs and Routines parts */
.lre-minds-note{margin:0;font-size:var(--lre-fs-sm);line-height:1.4;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-minds-body{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-minds-body>.lre-row,.lre-minds-limit>.lre-row,.lre-minds-group>.lre-row,.lre-minds-override>.lre-row{border-bottom:0}
.lre-minds-body>.lre-minds-note+.lre-row,.lre-minds-body>.lre-minds-note+.lre-minds-limit,.lre-minds-body>.lre-minds-note+.lre-disclosure{margin-top:var(--lre-s2)}
.lre-minds-limit{display:flex;flex-direction:column;min-width:0}
.lre-minds-group{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-minds-group+.lre-minds-group{margin-top:var(--lre-s2);padding-top:var(--lre-s3);border-top:1px solid var(--lre-hairline)}
.lre-disclosure-body>.lre-minds-group:first-child{margin-top:var(--lre-s1);padding-top:var(--lre-s3);border-top:1px solid var(--lre-hairline)}
.lre-disclosure-body>.lre-minds-overrides{border-top:1px solid var(--lre-hairline)}
.lre-minds-group-title,.lre-minds-subhead{font-size:var(--lre-fs-md);font-weight:600;color:var(--lre-fg);overflow-wrap:anywhere}
.lre-minds-summary{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-width:0}
.lre-minds-summary>.lre-badge{flex:none}
.lre-minds-overrides{display:flex;flex-direction:column;min-width:0}
.lre-minds-override{display:flex;flex-direction:column;gap:2px;padding:var(--lre-s2) 0;min-width:0}
.lre-minds-override+.lre-minds-override{border-top:1px solid var(--lre-hairline)}
.lre-minds-override-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-minds-prompts{display:flex;flex-direction:column;min-width:0}
.lre-minds-prompts-lead{padding:var(--lre-s3) var(--lre-s3) var(--lre-s2)}
.lre-minds-prompt{min-width:0;padding:0 var(--lre-s3);border-top:1px solid var(--lre-hairline)}
.lre-minds-prompt>.lre-disclosure>summary{min-height:var(--lre-tap-lg)}
.lre-minds-prompt>.lre-disclosure>.lre-disclosure-body{gap:var(--lre-s2);padding-bottom:var(--lre-s3)}
.lre-minds-prompt-head{display:flex;align-items:center;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2) 0}
.lre-minds-prompt-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-minds-prompt-title{font-size:var(--lre-fs-md);font-weight:500;overflow-wrap:anywhere}
.lre-minds-prompt-sub{font-size:var(--lre-fs-sm);font-weight:400;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-minds-prompt-head>.lre-badge{flex:none}
textarea.lre-input.lre-minds-prompt-input{min-height:200px;font-family:var(--lre-font);font-size:var(--lre-fs-md);line-height:1.45}
.lre-minds-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2);min-width:0}
.lre-minds-default{min-width:0;border-top:1px solid var(--lre-hairline)}
.lre-minds-code{margin:0;max-height:min(50vh,360px);overflow:auto;overscroll-behavior:contain;padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r);background:var(--lre-well);color:var(--lre-fg);font:var(--lre-fs-sm)/1.45 var(--lre-mono);white-space:pre-wrap;overflow-wrap:anywhere}
.lre-minds-vars{min-width:0;border-top:1px solid var(--lre-hairline)}
.lre-minds-vars-list{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:var(--lre-s1) var(--lre-s3);margin:0;font-size:var(--lre-fs-sm)}
.lre-minds-var{display:contents}
.lre-minds-var dt{font:var(--lre-fs-sm)/1.45 var(--lre-mono)}
.lre-minds-var dd{margin:0;color:var(--lre-muted);overflow-wrap:anywhere}
/* Play → What you know (packs/minds/ui/known.tsx) */
.lre-known-tags{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-known-kept{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
/* GM → Minds (packs/minds/ui/gm.tsx): the list, a character's page and the change pages over it */
.lre-gm-minds-pages{animation:none}
.lre-gm-minds{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-gm-minds-head .lre-listrow-value{max-width:70%}
.lre-gm-minds-keep{white-space:nowrap}
.lre-gm-minds-sub{display:flex;flex-wrap:wrap;align-items:center;gap:2px var(--lre-s1);min-width:0}
.lre-gm-minds-score{display:inline-flex;flex-direction:column;align-items:flex-end;line-height:1.15}
.lre-gm-minds-score-n{font-size:var(--lre-fs-md);font-weight:600;font-variant-numeric:tabular-nums}
.lre-gm-minds-score-k{font-size:var(--lre-fs-xs);font-weight:500;color:var(--lre-muted)}
.lre-gm-minds-lines{display:flex;flex-direction:column;gap:1px;min-width:0}
.lre-gm-minds-none{margin:0;padding:var(--lre-s3) var(--lre-s3) 0;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-gm-minds-reasons{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;min-width:0}
.lre-gm-minds-reasons>li{display:flex;align-items:baseline;justify-content:space-between;gap:var(--lre-s3);min-width:0;padding:6px 0;border-top:1px solid var(--lre-hairline)}
.lre-gm-minds-reasons>li>span:first-child{min-width:0;overflow-wrap:anywhere}
.lre-gm-minds-reasons>li.rule{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-gm-minds-points{flex:none;font-weight:600;font-variant-numeric:tabular-nums}
.lre-gm-minds-when{display:flex;flex-direction:column;gap:2px;min-width:0}
.lre-gm-minds-clock{font-weight:600;font-variant-numeric:tabular-nums}
.lre-gm-minds-why{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-minds-thought{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0;padding-top:var(--lre-s2);border-top:1px solid var(--lre-hairline)}
.lre-gm-minds-thought-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);font-size:var(--lre-fs-sm);font-weight:600;color:var(--lre-muted)}
.lre-gm-minds-thought-text{white-space:pre-wrap;overflow-wrap:anywhere}
.lre-gm-minds-reactions{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:var(--lre-s1);white-space:normal}
.lre-gm-minds-prose{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.lre-gm-minds-choices{margin:0;padding:0;border:0;min-width:0;display:flex;flex-direction:column}
.lre-gm-minds-choice{display:flex;align-items:flex-start;gap:var(--lre-s3);min-height:var(--lre-tap-lg);padding:var(--lre-s2) 0;cursor:pointer}
.lre-gm-minds-choice+.lre-gm-minds-choice{border-top:1px solid var(--lre-hairline)}
.lre-gm-minds-choice>input{flex:none;width:22px;height:22px;margin:1px 0 0;accent-color:var(--lre-accent);cursor:pointer}
.lre-gm-minds-choice-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-gm-minds-choice-name{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);font-weight:500}
.lre-gm-minds-choice-help{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-minds-submit{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-gm-minds-due{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.lre-gm-minds-due>.lre-input{flex:1 1 10em;width:auto}
.lre-gm-minds-due>.lre-btn{flex:0 0 auto}
/* GM → Minds: a run on demand (packs/minds/ui/run.tsx) and the pinned lore; choosing who to run is the shared multi-select (styles/select.ts) */
.lre-gm-minds-run-meter{padding:var(--lre-s3) var(--lre-s3) var(--lre-s1)}
.lre-gm-minds-run-note{margin:0;padding:var(--lre-s2) var(--lre-s3);font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-minds-run-sub{display:flex;flex-direction:column;gap:2px;min-width:0}
.lre-gm-minds-run-why{color:var(--lre-neg-text,var(--lre-fg));overflow-wrap:anywhere}
.lre-gm-minds-run-pins{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-minds-run-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);padding:var(--lre-s2) var(--lre-s3) var(--lre-s3);min-width:0}
.lre-gm-minds-run-actions:empty{display:none}
.lre-gm-minds-pinned{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
/* Build → an entity's or place's page, Pinned lore (build/lore-pins.tsx) */
.lre-form-pins-add{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-form-pins-add>label{font-size:var(--lre-fs-sm);font-weight:600;color:var(--lre-muted)}
.lre-form-pins-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2);min-width:0}
.lre-form-pins-keep{min-width:0}
.lre-form-pins-keep>.lre-input{width:auto;max-width:100%}
`;
