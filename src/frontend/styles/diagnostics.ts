// Diagnostics: the activity line (the HUD pill, the phone's status line and the drawer's bar) and
// Settings → Diagnostics (diagnostics.tsx). Built on the tokens only.

export const DIAGNOSTICS_CSS = `
/* The activity line: a pulse, the step's label and the time it has taken; a failure in the danger tone */
.lre .lre-activity{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;color:var(--lre-fg);font-size:var(--lre-fs-sm);white-space:nowrap}
.lre .lre-activity-label{min-width:0;overflow:hidden;text-overflow:ellipsis}
.lre .lre-activity-time{flex:none;color:var(--lre-muted)}
.lre .lre-hud>.lre-activity{margin:0 var(--lre-s2);flex:none}
.lre .lre-activity.failed{min-height:var(--lre-tap);min-width:var(--lre-tap);justify-content:center;padding:0 var(--lre-s2);border:1px solid color-mix(in srgb,var(--lre-danger) 40%,transparent);border-radius:var(--lre-r-pill);background:var(--lre-neg-soft);color:var(--lre-neg);font-weight:600}
.lre .lre-activity.failed>.lre-icon{color:var(--lre-neg)}
.lre .lre-hud>.lre-activity.failed{border-color:transparent}
.lre .lre-chat-status>.lre-activity.failed{flex:none}
.lre .lre-chat-status-line>.lre-activity{flex:none;max-width:62%}

/* The drawer's bar under the mode bar, sticky with it; its tint laid over the bar's own background, so nothing shows through */
.lre-activity-bar{position:sticky;top:calc(var(--lre-stick-top,0px) + var(--lre-modebar-h,0px));z-index:5;display:flex;align-items:center;gap:var(--lre-s2);min-height:36px;margin:0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-r))) 0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-l)));padding:var(--lre-s1) calc(var(--lre-s3) + var(--lre-gutter-r)) var(--lre-s1) calc(var(--lre-s3) + var(--lre-gutter-l));background:linear-gradient(var(--lre-accent-soft),var(--lre-accent-soft)),var(--lre-bar-bg);border-bottom:1px solid var(--lre-hairline);font-size:var(--lre-fs-sm);color:var(--lre-fg)}
.lre-activity-bar>.lre-activity-label{flex:1}
.lre-activity-banner{margin-top:var(--lre-s3)}

/* Settings → Diagnostics */
.lre-diag-tools{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-diag-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
.lre-diag-errors{gap:var(--lre-s2)}
.lre-diag-fix{margin:0;font-size:var(--lre-fs-sm);line-height:1.4;color:var(--lre-fg);overflow-wrap:anywhere}
.lre-diag-row{display:flex;flex-direction:column;min-width:0}
.lre-diag-row+.lre-diag-row{border-top:1px solid var(--lre-hairline)}
.lre-diag-row>.lre-diag-fix{padding:0 var(--lre-s3) var(--lre-s2) calc(var(--lre-s3) + 28px)}
.lre-diag-row[data-lre-diag-status=failed] .lre-listrow-title{color:var(--lre-neg)}
.lre-diag-calls{margin:0;padding:0 var(--lre-s3) var(--lre-s2) calc(var(--lre-s3) + 28px);list-style:none;display:flex;flex-direction:column;gap:2px;font-size:var(--lre-fs-xs);line-height:1.4;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-diag-calls>li[data-lre-diag-call=bad]{color:var(--lre-neg)}
@container (min-width:640px){.lre-diag-tools{flex-direction:row;align-items:center;justify-content:space-between}}
`;
