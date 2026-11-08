// Settings: the home list, page leads, the model-use preset cards, the call meter table, the
// per-step cards, the extraction rows, the timeout and agent limit rows, the drawer's notices, and
// the settings kit (kit.tsx): a setting's row with its Changed badge and Default, a folded limit,
// a row that opens a page, tool chips, a role's routes, the Agents hub's turn at a glance and the
// sections of an agent's page; Settings → Loopback's lines to copy, a relay's facts and the
// connection's steps. Built on the tokens and the shared atoms only.

export const SETTINGS_CSS = `
.lre-set{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre-set .lre-card+.lre-card{margin-top:0}
.lre-set-lead{margin:0;padding:0 var(--lre-s1);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-set-home-row+.lre-set-home-row .lre-listrow-content{border-top:1px solid var(--lre-hairline)}
.lre-set-caveat{font-weight:400;font-size:var(--lre-fs-sm)}
.lre-set-code{font:var(--lre-fs-sm)/1.3 var(--lre-mono);overflow-wrap:anywhere}
.lre-set-presets{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:var(--lre-s2);min-width:0}
.lre-set-preset{display:flex;flex-direction:column;align-items:stretch;gap:var(--lre-s1);min-width:0;min-height:var(--lre-tap-lg);padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);color:inherit;font:inherit;text-align:left;transition:background-color var(--lre-fast),border-color var(--lre-fast)}
.lre-set-preset:hover:not(:disabled):not([aria-checked=true]){background:var(--lre-hover)}
.lre-set-preset[aria-checked=true]{border-color:var(--lre-accent);background:var(--lre-accent-soft);box-shadow:inset 0 0 0 1px var(--lre-accent)}
.lre-set-preset:disabled{cursor:progress}
.lre-set-preset-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-width:0}
.lre-set-preset-name{font-size:var(--lre-fs-md);font-weight:600}
.lre-set-preset-mark{display:inline-flex;align-items:center;gap:var(--lre-s1);font-size:var(--lre-fs-sm);font-weight:600;color:var(--lre-accent-text)}
.lre-set-preset-plain{overflow-wrap:anywhere}
.lre-set-preset-note{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-set-meter{display:grid;grid-template-columns:minmax(0,1fr) repeat(4,auto);gap:var(--lre-s2) var(--lre-s3);font-size:var(--lre-fs-sm);font-variant-numeric:tabular-nums;min-width:0}
.lre-set-meter>[role=row]>span{text-align:right;min-width:0;overflow-wrap:anywhere}
.lre-set-meter>[role=row]>span:first-child{text-align:left}
.lre-set-meter .hd{font-size:var(--lre-fs-xs);font-weight:600;color:var(--lre-muted)}
.lre-set-meter .rh{color:var(--lre-muted)}
.lre-set-meter [role=cell]{font-weight:600}
.lre-set-group{display:flex;flex-direction:column;min-width:0}
.lre-set-group+.lre-set-group{margin-top:var(--lre-s2);padding-top:var(--lre-s2);border-top:1px solid var(--lre-hairline)}
.lre-card.lre-set-step{padding:0 var(--lre-s3)}
.lre-set-step>.lre-disclosure>summary{min-height:var(--lre-tap-lg)}
.lre-set-step>.lre-disclosure>.lre-disclosure-body{padding-bottom:var(--lre-s3)}
.lre-set-step .lre-disclosure-body>.lre-disclosure{border-top:1px solid var(--lre-hairline);margin-top:var(--lre-s1)}
.lre-set-step-head{display:flex;align-items:center;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2) 0}
.lre-set-step-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-set-step-title{font-size:var(--lre-fs-md);font-weight:500;overflow-wrap:anywhere}
.lre-set-step-sub{font-size:var(--lre-fs-sm);font-weight:400;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-set-warn{display:flex;align-items:flex-start;gap:var(--lre-s1);font-size:var(--lre-fs-sm);color:var(--lre-warn)}
.lre-set-warn>.lre-icon{margin-top:1px}
.lre-set-rows{display:flex;flex-direction:column;min-width:0}
.lre-set-ext{display:flex;flex-direction:column;gap:var(--lre-s2);padding:var(--lre-s3);min-width:0}
.lre-set-ext+.lre-set-ext{border-top:1px solid var(--lre-hairline)}
.lre-set-ext-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-height:32px;min-width:0}
.lre-set-ext-title{font-size:var(--lre-fs-md);font-weight:500;min-width:0;overflow-wrap:anywhere}
.lre-set-timeout-lead{margin:0;padding:var(--lre-s3) var(--lre-s3) 0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-set-timeout{gap:var(--lre-s1)}
.lre-set-timeout>.lre-row{border-bottom:0;padding:var(--lre-s1) 0}
.lre-set-timeout-text{overflow-wrap:anywhere}
.lre-set-timeout-cap{flex:none;font-size:var(--lre-fs-sm);font-weight:600;font-variant-numeric:tabular-nums}
.lre-update-notice{margin-top:var(--lre-s3)}
.lre-update-notice .lre-list{margin-top:var(--lre-s2)}
.lre-acceptance-banner{margin-top:var(--lre-s3)}
[data-lre-mcp-server]{border-bottom:1px solid var(--lre-hairline)}
[data-lre-mcp-server]:last-child{border-bottom:0}
[data-lre-mcp-server="cannot"] .lre-set-caveat,[data-lre-mcp-server="old"] .lre-set-caveat{color:var(--lre-muted)}
.lre-row-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2);padding:0 var(--lre-s3) var(--lre-s2)}
.lre-row-actions:empty{display:none}
[data-lre-mcp-setup]{display:flex;flex-direction:column;align-items:flex-start;gap:var(--lre-s3)}
[data-lre-mcp-setup-runtime]{align-self:stretch;align-items:flex-start}
[data-lre-mcp-setup] code{display:block;width:100%;box-sizing:border-box;padding:var(--lre-s2);border:1px solid var(--lre-hairline);background:var(--lre-accent-soft);font-size:var(--lre-fs-sm);overflow-wrap:anywhere;user-select:all}
.lre-set-note{margin:0;padding:var(--lre-s2) var(--lre-s3) 0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-set-row{display:flex;flex-direction:column;gap:var(--lre-s2);padding:var(--lre-s3);min-width:0}
.lre-set-rows>*+.lre-set-row,.lre-set-rows>*+.lre-set-fold,.lre-set-rows>.lre-set-fold+*{border-top:1px solid var(--lre-hairline)}
.lre-set-row-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-height:28px;min-width:0}
.lre-set-row-head.bare{justify-content:flex-end;min-height:0}
.lre-set-row-label{font-size:var(--lre-fs-md);font-weight:500;min-width:0;overflow-wrap:anywhere}
.lre-set-row-default{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-set-row .lre-seg{flex-wrap:wrap}
.lre-set-fold{min-width:0}
.lre-set-fold>.lre-disclosure>summary{min-height:var(--lre-tap);padding:0 var(--lre-s3)}
.lre-set-fold-head{display:flex;align-items:center;gap:var(--lre-s2);min-width:0;width:100%}
.lre-set-fold-label{flex:1;min-width:0;overflow-wrap:anywhere}
.lre-set-fold-value{flex:none;font-size:var(--lre-fs-sm);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre-set-fold-body{display:flex;flex-direction:column;gap:var(--lre-s2);padding:0 var(--lre-s3) var(--lre-s3);min-width:0}
.lre-set-fold-text{overflow-wrap:anywhere}
.lre-set-fold-body>.lre-row,.lre-set-row>.lre-row,.lre-set-optional>.lre-row{border-bottom:0;padding:var(--lre-s1) 0}
.lre-set-optional{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-set-picker{padding:var(--lre-s3)}
.lre-set-follows{display:block;padding:0 var(--lre-s3) var(--lre-s3)}
.lre-set-nav+.lre-set-nav .lre-listrow-content{border-top:1px solid var(--lre-hairline)}
.lre-set-chips{display:flex;flex-wrap:wrap;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre-set-chip{min-height:36px;padding:0 var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-pill);background:var(--lre-card);color:inherit;font:inherit;font-size:var(--lre-fs-sm);transition:background-color var(--lre-fast),border-color var(--lre-fast)}
.lre-set-chip:hover:not(:disabled){background:var(--lre-hover)}
.lre-set-chip[aria-pressed=true]{border-color:var(--lre-accent);background:var(--lre-accent-soft);color:var(--lre-accent-text);font-weight:600}
.lre-set-chip:disabled{cursor:progress}
.lre-set-link{display:inline;padding:0;border:0;background:none;color:var(--lre-accent-text);font:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}
.lre-set-routes{list-style:none;margin:0;padding:var(--lre-s2) var(--lre-s3);display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-set-route{display:flex;flex-wrap:wrap;justify-content:space-between;gap:0 var(--lre-s2);font-size:var(--lre-fs-sm);min-width:0}
.lre-set-route-task{font-weight:500}
.lre-set-route-to{color:var(--lre-muted);text-align:right;margin-left:auto;overflow-wrap:anywhere}
.lre-set-glance{list-style:none;margin:0;padding:0 var(--lre-s3) var(--lre-s2);min-width:0}
.lre-set-glance-stage{display:grid;grid-template-columns:24px minmax(0,1fr);gap:var(--lre-s2);padding:var(--lre-s2) 0}
.lre-set-glance-stage+.lre-set-glance-stage{border-top:1px solid var(--lre-hairline)}
.lre-set-glance-num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:var(--lre-r-pill);background:var(--lre-accent-soft);color:var(--lre-accent-text);font-size:var(--lre-fs-sm);font-weight:600;font-variant-numeric:tabular-nums}
.lre-set-glance-body{display:flex;flex-direction:column;gap:2px;min-width:0}
.lre-set-glance-title{font-weight:500}
.lre-set-glance-row{font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.lre-set-glance-route{color:var(--lre-muted)}
.lre-set-agent-section{min-width:0}
.lre-set-agent-section:focus{outline:none}
.lre-set-agent-section:focus-visible{outline:2px solid var(--lre-accent);outline-offset:2px}
.lre-set-agent-reset{display:flex;justify-content:center;padding:var(--lre-s2) 0}
.lre-loopback-line{align-items:flex-start}
.lre-loopback-line>code{display:block;align-self:stretch;box-sizing:border-box;padding:var(--lre-s2);border:1px solid var(--lre-hairline);border-radius:var(--lre-r);background:var(--lre-well);user-select:all}
.lre-loopback-badges{display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--lre-s1)}
.lre-loopback-facts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;font-size:var(--lre-fs-sm);color:var(--lre-muted);min-width:0;overflow-wrap:anywhere}
.lre-loopback-steps{margin:0;padding-left:1.2em;display:flex;flex-direction:column;gap:var(--lre-s2);font-size:var(--lre-fs-sm);min-width:0;overflow-wrap:anywhere}
`;
