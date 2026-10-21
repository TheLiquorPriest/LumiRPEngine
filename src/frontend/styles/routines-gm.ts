// GM → Routines (packs/castlife/ui/routines-gm.tsx): the list, a character's page and the change
// pages over it. Built on the tokens only.

export const ROUTINES_GM_CSS = `
.lre-gm-routines-pages{animation:none}
.lre-gm-routines{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-gm-routines-intro{margin:0;padding:var(--lre-s2) var(--lre-s3) 0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-routines-build{padding:var(--lre-s1) var(--lre-s2) var(--lre-s2)}
.lre-gm-routines-sub{display:flex;flex-wrap:wrap;align-items:center;gap:2px var(--lre-s1);min-width:0}
.lre-gm-routines-lines{display:flex;flex-direction:column;gap:1px;min-width:0;overflow-wrap:anywhere}
.lre-gm-routines-none{margin:0;padding:var(--lre-s3) var(--lre-s3) 0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-routines-none:last-child{padding-bottom:var(--lre-s3)}
.lre-gm-routines-binding{display:flex;flex-direction:column;gap:var(--lre-s1);padding:var(--lre-s3) var(--lre-s3) var(--lre-s1);min-width:0}
.lre-gm-routines-binding>.lre-gm-note{overflow-wrap:anywhere}
.lre-gm-routines-binding>.lre-gm-note:first-child{color:var(--lre-fg);font-size:var(--lre-fs-md)}
.lre-gm-routines-head{padding:var(--lre-s3) var(--lre-s3) var(--lre-s1);font-size:var(--lre-fs-sm);font-weight:600;color:var(--lre-muted)}
.lre-gm-routines-slot{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px var(--lre-s2);min-width:0}
.lre-gm-routines-time{flex:none;font-variant-numeric:tabular-nums;font-weight:600}
.lre-gm-routines-source{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-gm-routines-source>.lre-gm-routines-lines{flex:1 1 12rem}
.lre-gm-routines-source>.lre-btn{flex:none}
.lre-gm-routines-source-label{font-weight:500}
.lre-gm-routines-quote{font-size:var(--lre-fs-sm);font-style:italic;color:var(--lre-muted)}
.lre-gm-routines-shadow{display:flex;flex-direction:column;gap:2px;min-width:0;padding-top:var(--lre-s2);border-top:1px solid var(--lre-hairline)}
.lre-gm-routines-choices{margin:0;padding:0;border:0;min-width:0;display:flex;flex-direction:column}
.lre-gm-routines-choice{display:flex;align-items:flex-start;gap:var(--lre-s3);min-height:var(--lre-tap-lg);padding:var(--lre-s2) 0;cursor:pointer}
.lre-gm-routines-choice+.lre-gm-routines-choice{border-top:1px solid var(--lre-hairline)}
.lre-gm-routines-choice>input{flex:none;width:22px;height:22px;margin:1px 0 0;accent-color:var(--lre-accent);cursor:pointer}
.lre-gm-routines-choice-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-gm-routines-choice-name{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);font-weight:500}
.lre-gm-routines-choice-help{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gm-routines-submit{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
`;
