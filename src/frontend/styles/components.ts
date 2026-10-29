// The shared atoms of components.tsx, built on the tokens only.
// Every interactive atom is at least 40 px tall (44 in the bottom bar); cards are flat inside the
// drawer, with a hairline and the card surface.

export const COMPONENTS_CSS = `
.lre .lre-icon,.lre-chips .lre-icon{flex:none;vertical-align:middle}
.lre-stack{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-inline{display:flex;gap:var(--lre-s2);align-items:center;flex-wrap:wrap;min-width:0}
.lre-spread{display:flex;flex-wrap:wrap;gap:var(--lre-s2);align-items:center;justify-content:space-between;min-width:0}
.lre-inline>*,.lre-spread>*{max-width:100%}
.lre-muted{color:var(--lre-muted)}.lre-dim{color:var(--lre-dim)}.lre-neg{color:var(--lre-neg)}.lre-pos{color:var(--lre-pos)}.lre-warn{color:var(--lre-warn)}
.lre-small{font-size:var(--lre-fs-sm)}
.lre-num{font-variant-numeric:tabular-nums}
.lre-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.lre-id{font:var(--lre-fs-xs)/1.3 var(--lre-mono);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-dot{display:inline-block;flex:none;width:8px;height:8px;border-radius:50%;background:var(--lre-warn)}
.lre-btn{min-height:var(--lre-tap);min-width:var(--lre-tap);max-width:100%;padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r-lg);border:1px solid var(--lre-border);background:var(--lre-subtle);font-weight:500;line-height:1.25;display:inline-flex;align-items:center;justify-content:center;gap:var(--lre-s2);white-space:normal;overflow-wrap:anywhere;text-align:center;transition:background-color var(--lre-fast),border-color var(--lre-fast),color var(--lre-fast)}
.lre-btn:hover:not(:disabled){background:var(--lre-hover);border-color:var(--lumiverse-border-hover,var(--lre-border))}
.lre-btn.primary{background:var(--lre-accent-fill);color:var(--lre-accent-fg);border-color:transparent}
.lre-btn.primary:hover:not(:disabled){background:color-mix(in srgb,var(--lre-accent-fill) 88%,var(--lre-fg));border-color:transparent}
.lre-btn.danger{color:var(--lre-neg);border-color:color-mix(in srgb,var(--lre-danger) 40%,transparent)}
.lre-btn.danger:hover:not(:disabled){background:var(--lre-neg-soft)}
.lre-btn.ghost{background:transparent;border-color:transparent}
.lre-btn.ghost:hover:not(:disabled){background:var(--lre-hover);border-color:transparent}
.lre-btn.block{width:100%}
.lre-btn.small{padding:var(--lre-s1) 10px;font-size:var(--lre-fs-sm)}
.lre-btn[aria-busy=true]{cursor:progress}
.lre-iconbtn{flex:none;width:var(--lre-tap);height:var(--lre-tap);padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:var(--lre-r-lg);border:1px solid transparent;background:transparent;transition:background-color var(--lre-fast),color var(--lre-fast)}
.lre-iconbtn:hover:not(:disabled){background:var(--lre-hover)}
.lre-iconbtn.secondary{background:var(--lre-subtle);border-color:var(--lre-border);color:var(--lre-fg)}
.lre-iconbtn.primary{background:var(--lre-accent-fill);color:var(--lre-accent-fg)}
.lre-iconbtn[aria-pressed=true]{background:var(--lre-accent-soft);color:var(--lre-accent-text)}
.lre-seg{display:flex;gap:2px;flex-wrap:wrap;padding:2px;border-radius:var(--lre-r-lg);background:var(--lre-well)}
.lre-seg>button{flex:1 1 0;min-width:min-content;max-width:100%;min-height:var(--lre-tap);padding:var(--lre-s1) var(--lre-s2);border-radius:calc(var(--lre-r-lg) - 2px);border:0;background:transparent;color:var(--lre-muted);font-size:var(--lre-fs-sm);font-weight:500;white-space:normal;overflow-wrap:break-word;transition:background-color var(--lre-fast),color var(--lre-fast)}
.lre-seg>button:hover:not(:disabled):not([aria-pressed=true]){color:var(--lre-fg)}
.lre-seg>button[aria-pressed=true]{background:var(--lre-accent-fill);color:var(--lre-accent-fg)}
.lre-tabs{display:flex;gap:var(--lre-s2);overflow-x:auto;scrollbar-width:none;padding-bottom:2px;-webkit-overflow-scrolling:touch;position:relative;min-width:0;overscroll-behavior-x:contain}
.lre-tabs::-webkit-scrollbar{display:none}
.lre-tabs>button{flex:0 0 auto;min-height:var(--lre-tap);min-width:var(--lre-tap);padding:0 14px;border-radius:var(--lre-r-pill);border:1px solid var(--lre-hairline);background:transparent;color:var(--lre-muted);font-size:var(--lre-fs-sm);font-weight:500;position:relative;white-space:nowrap;transition:background-color var(--lre-fast),color var(--lre-fast)}
.lre-tabs>button:hover{background:var(--lre-hover);color:var(--lre-fg)}
.lre-tabs>button[aria-selected=true]{background:var(--lre-accent-soft);color:var(--lre-accent-text);border-color:color-mix(in srgb,var(--lre-accent) 35%,transparent);font-weight:600}
.lre-tabs>button .lre-dot{position:absolute;top:6px;right:6px}
.lre-btn.primary:focus-visible,.lre-seg>button[aria-pressed=true]:focus-visible,.lre-iconbtn.primary:focus-visible{outline-color:var(--lre-fg);box-shadow:inset 0 0 0 2px var(--lre-accent-fg)}
.lre-tabs>button:focus-visible{outline-offset:-2px}
.lre-card{border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);padding:var(--lre-s3);background:var(--lre-card);min-width:0}
.lre-card+.lre-card{margin-top:var(--lre-s2)}
.lre-card.preview{border-style:dashed;border-color:var(--lre-border)}
.lre-h{margin:0 0 var(--lre-s1);font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-muted);display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-height:24px}
.lre-h>span{min-width:0;overflow-wrap:anywhere}
.lre-h2{margin:0;font-size:var(--lre-fs-lg);font-weight:600}
.lre-preview-label{font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-warn)}
.lre-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s2) var(--lre-s3);padding:var(--lre-s2) 0;border-bottom:1px solid var(--lre-hairline);min-height:var(--lre-tap);min-width:0}
.lre-row:last-child{border-bottom:0}
.lre-row>.k{flex:1 1 0;min-width:min(9em,100%);overflow-wrap:anywhere}
.lre-row>.v{margin-left:auto;max-width:100%;min-width:0;font-variant-numeric:tabular-nums;font-weight:600;text-align:right;overflow-wrap:anywhere}
.lre-row .sub{display:block;font-size:var(--lre-fs-sm);color:var(--lre-muted);font-weight:400;white-space:normal}
.lre-section{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre-section-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-height:24px;padding:0 var(--lre-s1)}
.lre-section-title{margin:0;min-width:0;font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-section-body{min-width:0;padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre-section.flush>.lre-section-body{padding:0;overflow:hidden}
.lre-rowlist{display:flex;flex-direction:column;min-width:0}
.lre-listrow{min-width:0}
.lre-listrow-hit{display:flex;align-items:stretch;gap:var(--lre-s3);width:100%;min-height:var(--lre-tap-lg);padding:0 0 0 var(--lre-s3);border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;transition:background-color var(--lre-fast)}
button.lre-listrow-hit:hover:not(:disabled){background:var(--lre-hover)}
button.lre-listrow-hit:focus-visible{outline-offset:-2px}
.lre-listrow-hit[aria-current=true]{box-shadow:inset 3px 0 0 var(--lre-accent);background:var(--lre-accent-soft)}
.lre-listrow-hit[aria-disabled=true]{opacity:.5}
.lre-listrow-lead{flex:none;align-self:center;display:flex;color:var(--lre-muted)}
.lre-listrow-content{flex:1;min-width:0;display:flex;align-items:center;gap:var(--lre-s2);padding:var(--lre-s2) var(--lre-s3) var(--lre-s2) 0}
.lre-listrow+.lre-listrow .lre-listrow-content{border-top:1px solid var(--lre-hairline)}
.lre-listrow-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-listrow-title{font-size:var(--lre-fs-md);font-weight:500;overflow-wrap:anywhere}
.lre-listrow-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-listrow-value{flex:0 1 auto;max-width:50%;font-variant-numeric:tabular-nums;font-weight:600;text-align:right;overflow-wrap:anywhere}
.lre-listrow-chev{color:var(--lre-dim)}
.lre-list{display:flex;flex-direction:column;gap:var(--lre-s2)}
.lre-item{display:flex;align-items:center;gap:var(--lre-s3);min-height:var(--lre-tap-lg);width:100%;padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r-lg);border:1px solid var(--lre-hairline);background:var(--lre-card);text-align:left;transition:background-color var(--lre-fast),border-color var(--lre-fast)}
button.lre-item:hover:not(:disabled){background:var(--lre-hover)}
.lre-item>.grow{flex:1;min-width:0}
.lre-item .title{display:block;font-weight:500;overflow-wrap:anywhere}
.lre-item .sub{display:block;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-item[aria-current=true]{border-color:var(--lre-accent);background:var(--lre-accent-soft)}
.lre-stat{display:flex;flex-direction:column;gap:2px;min-width:0}
.lre-stat-label,.lre-stat-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-stat-value{font-size:var(--lre-fs-xl);font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.lre-gauge{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-gauge-head{display:flex;justify-content:space-between;gap:var(--lre-s2);font-size:var(--lre-fs-sm)}
.lre-gauge-label{min-width:0;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-gauge-value{flex:none;font-weight:600;font-variant-numeric:tabular-nums}
.lre-gauge-track{height:8px;border-radius:var(--lre-r-pill);background:var(--lre-neutral-soft);overflow:hidden}
.lre-gauge-track>span{display:block;height:100%;border-radius:inherit;background:var(--lre-accent)}
.lre-gauge.pos .lre-gauge-track>span{background:var(--lre-success)}
.lre-gauge.neg .lre-gauge-track>span{background:var(--lre-danger)}
.lre-gauge.warn .lre-gauge-track>span{background:var(--lre-warning)}
.lre-bar{height:8px;border-radius:var(--lre-r-pill);background:var(--lre-neutral-soft);overflow:hidden}
.lre-bar>span{display:block;height:100%;background:var(--lre-accent)}
.lre-bar.low>span{background:var(--lre-neg)}
.lre-badge{display:inline-flex;align-items:center;gap:var(--lre-s1);min-height:22px;padding:0 var(--lre-s2);border-radius:var(--lre-r-pill);font-size:var(--lre-fs-xs);font-weight:600;background:var(--lre-neutral-soft);color:var(--lre-muted);white-space:nowrap}
.lre-badge.accent{background:var(--lre-accent-soft);color:var(--lre-accent-text)}
.lre-badge.warn{background:var(--lre-warn-soft);color:var(--lre-warn)}
.lre-badge.neg{background:var(--lre-neg-soft);color:var(--lre-neg)}
.lre-badge.pos{background:var(--lre-pos-soft);color:var(--lre-pos)}
.lre-badge.gm{background:var(--lre-gm-soft);color:var(--lre-gm-text)}
.lre-banner{border-radius:var(--lre-r-xl);padding:var(--lre-s3);display:flex;flex-direction:column;gap:var(--lre-s2);border:1px solid var(--lre-hairline);background:var(--lre-card)}
.lre-banner.info{background:var(--lre-accent-soft);border-color:color-mix(in srgb,var(--lre-accent) 35%,transparent)}
.lre-banner.warn{background:var(--lre-warn-soft);border-color:color-mix(in srgb,var(--lre-warning) 40%,transparent)}
.lre-banner.neg{background:var(--lre-neg-soft);border-color:color-mix(in srgb,var(--lre-danger) 40%,transparent)}
.lre-banner.gm{background:var(--lre-gm-soft);border-color:color-mix(in srgb,var(--lre-gm) 40%,transparent)}
.lre-banner-main{display:flex;gap:var(--lre-s3);align-items:flex-start;min-width:0}
.lre-banner-icon{margin-top:1px}
.lre-banner.info .lre-banner-icon{color:var(--lre-accent-text)}.lre-banner.warn .lre-banner-icon{color:var(--lre-warn)}.lre-banner.neg .lre-banner-icon{color:var(--lre-neg)}.lre-banner.gm .lre-banner-icon{color:var(--lre-gm)}
.lre-banner-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-banner-title{font-weight:600}
.lre-banner-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
.lre-empty{padding:var(--lre-s4) var(--lre-s2);text-align:center;color:var(--lre-muted);display:flex;flex-direction:column;align-items:center;gap:var(--lre-s2)}
.lre-empty-icon{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--lre-neutral-soft)}
.lre-empty-title{font-weight:600;color:var(--lre-fg)}
.lre-disclosure{min-width:0}
.lre-disclosure>summary{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap);cursor:pointer;list-style:none;font-weight:500;border-radius:var(--lre-r)}
.lre-disclosure>summary::-webkit-details-marker{display:none}
.lre-disclosure-label{flex:1;min-width:0;overflow-wrap:anywhere}
.lre-disclosure>summary>.lre-icon{color:var(--lre-muted);transition:transform var(--lre-fast)}
.lre-disclosure[open]>summary>.lre-icon{transform:rotate(180deg)}
.lre-disclosure-body{display:flex;flex-direction:column;gap:var(--lre-s2);padding:var(--lre-s1) 0 var(--lre-s2)}
.lre-field{display:flex;flex-direction:column;gap:var(--lre-s1);min-width:0}
.lre-field>label,.lre-field>.label{font-size:var(--lre-fs-sm);font-weight:500;color:var(--lre-muted)}
.lre-field-help{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre-field-error{display:flex;align-items:flex-start;gap:var(--lre-s1);font-size:var(--lre-fs-sm);color:var(--lre-neg)}
.lre-input{min-height:var(--lre-tap);width:100%;padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r);border:1px solid var(--lre-border);background:var(--lre-well);color:var(--lre-fg);font:inherit;min-width:0;transition:border-color var(--lre-fast)}
.lre-input:focus{border-color:var(--lre-accent)}
textarea.lre-input{min-height:80px;resize:vertical;font-family:var(--lre-mono);font-size:var(--lre-fs-sm)}
select.lre-input{appearance:auto}
.lre-input.invalid{border-color:var(--lre-neg)}
.lre-check{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:var(--lre-tap);min-height:var(--lre-tap);cursor:pointer}
.lre-check>input{width:22px;height:22px;margin:0;cursor:pointer;accent-color:var(--lre-accent)}
.lre-stepper{display:inline-flex;align-items:center;gap:var(--lre-s1);margin-left:auto;max-width:100%;min-width:0}
.lre-stepper>.lre-input{flex:0 1 76px;width:76px;min-width:44px;text-align:center;font-variant-numeric:tabular-nums}
.lre-stepper>.lre-btn{flex:0 0 var(--lre-tap);padding:0}
.lre-host-slot{min-height:var(--lre-tap)}
.lre-tree{padding-left:var(--lre-s3);border-left:1px solid var(--lre-hairline);margin-left:var(--lre-s1)}
.lre-avatar{flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--lre-neutral-soft);color:var(--lre-fg);font-weight:600;line-height:1;user-select:none}
.lre-page-header{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap-lg);min-width:0}
.lre-page-header>.lre-iconbtn{margin-left:calc(-1 * var(--lre-s2))}
.lre-page-titles{flex:1;min-width:0}
.lre-page-title{margin:0;font-size:var(--lre-fs-lg);font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.lre-page-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-page-actions{flex:none;display:flex;align-items:center;gap:var(--lre-s1)}
.lre-bottomnav{position:sticky;bottom:0;z-index:5;display:flex;gap:2px;padding:var(--lre-s1) var(--lre-s1) calc(var(--lre-s1) + env(safe-area-inset-bottom,0px));background:var(--lre-bar-bg);border-top:1px solid var(--lre-hairline)}
.lre-bottomnav>button{flex:1 1 0;min-width:0;min-height:var(--lre-tap-lg);padding:var(--lre-s1) 2px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;position:relative;border:0;border-radius:var(--lre-r);background:transparent;color:var(--lre-muted);font-size:var(--lre-fs-xs);font-weight:500;transition:background-color var(--lre-fast),color var(--lre-fast)}
.lre-bottomnav>button:hover{color:var(--lre-fg)}
.lre-bottomnav>button[aria-current=page]{color:var(--lre-accent-text);font-weight:600;background:var(--lre-accent-soft)}
.lre-bottomnav[data-tone=gm]>button[aria-current=page]{color:var(--lre-gm-text);background:var(--lre-gm-soft)}
.lre-bottomnav-label{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lre-bottomnav>button>.lre-dot{position:absolute;top:5px;left:calc(50% + 7px)}
.lre-bottomnav>button:focus-visible{outline-offset:-2px}
.lre-savebar{position:sticky;bottom:0;z-index:4;display:flex;gap:var(--lre-s2);align-items:center;flex-wrap:wrap;margin:0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-r,0px))) 0 calc(-1 * (var(--lre-s3) + var(--lre-gutter-l,0px)));padding:var(--lre-s2) calc(var(--lre-s3) + var(--lre-gutter-r,0px)) calc(var(--lre-s2) + env(safe-area-inset-bottom,0px)) calc(var(--lre-s3) + var(--lre-gutter-l,0px));border-top:1px solid var(--lre-hairline);background:var(--lre-bar-bg)}
.lre-md p,.lre-md ul,.lre-md ol,.lre-md pre,.lre-md blockquote{margin:0}
.lre-md>*+*,.lre-md blockquote>*+*{margin-top:var(--lre-s2)}
.lre-md ul,.lre-md ol{padding-left:1.4em}
.lre-md li+li{margin-top:2px}
.lre-md code{font:.92em/1.3 var(--lre-mono);padding:0 .3em;border-radius:var(--lre-r-sm);background:var(--lre-well)}
.lre-md .lre-md-h{font-size:1em;font-weight:650;line-height:1.35}
.lre-md pre{padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r-sm);background:var(--lre-well);white-space:pre;overflow-x:auto}
.lre-md pre>code{padding:0;background:none}
.lre-md blockquote{padding-left:var(--lre-s3);border-left:2px solid var(--lre-hairline);color:var(--lre-muted)}
`;
