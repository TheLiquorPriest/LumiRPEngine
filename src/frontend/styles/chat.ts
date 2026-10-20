// Chat surfaces : under each reply the receipt, decision cards and offers; the
// phone's status line above the message input; the desktop pill and its details; the World sheet and
// the action sheet with Timelapse; the map overlay's frame; toasts; the fix editor and the money
// input. Every sheet, pop-up, toast and float overlay sits on --lre-bar-bg, which stays opaque where
// the host's surface colour is translucent. Toast icons are drawn by masks (the same shapes as
// icons.tsx), so meaning never rests on colour alone.

export const CHAT_CSS = `
.lre .lre-money{display:flex;align-items:center;flex:1 1 8em;min-width:0;min-height:var(--lre-tap);border:1px solid var(--lre-border);border-radius:var(--lre-r);background:var(--lre-well);transition:border-color var(--lre-fast)}
.lre .lre-field>.lre-money,.lre .lre-stack>.lre-money{flex:0 0 auto}
.lre .lre-money:focus-within{border-color:var(--lre-accent);outline:2px solid var(--lre-accent);outline-offset:2px}
.lre .lre-money.invalid{border-color:var(--lre-neg)}
.lre .lre-money>.lre-input{flex:1 1 auto;min-width:0;min-height:calc(var(--lre-tap) - 2px);border:0;border-radius:inherit;background:transparent;font-variant-numeric:tabular-nums}
.lre .lre-money>.lre-input:focus-visible{outline:none}
.lre .lre-money-affix{flex:none;padding:0 var(--lre-s3);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre .lre-money-affix:first-child{padding-right:0}
.lre .lre-money-affix:last-child{padding-left:0}
.lre .lre-money-affix+.lre-input{padding-left:var(--lre-s1)}

.lre .lre-chips{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;margin:var(--lre-s2) 0 var(--lre-s1);font-size:var(--lre-fs-sm);line-height:1.4}
.lre .lre-chat-actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.lre .lre-chat-dot{color:var(--lre-dim)}
.lre .lre-chat-receipt{display:flex;flex-direction:column;align-items:flex-start;gap:var(--lre-s2);min-width:0}
.lre .lre-chat-receipt-line{display:flex;align-items:center;gap:var(--lre-s2);max-width:100%;min-height:var(--lre-tap);padding:var(--lre-s1) var(--lre-s2) var(--lre-s1) var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-lg);background:transparent;color:var(--lre-muted);text-align:left;transition:background-color var(--lre-fast),color var(--lre-fast)}
.lre .lre-chat-receipt-line:hover{background:var(--lre-hover);color:var(--lre-fg)}
.lre .lre-chat-receipt-line[aria-expanded=true]{border-color:var(--lre-border);color:var(--lre-fg)}
.lre .lre-chat-receipt-line:focus-visible{outline-offset:-2px}
.lre .lre-chat-segs{display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;min-width:0}
.lre .lre-chat-seg{display:inline-flex;align-items:center;gap:4px;min-width:0;font-variant-numeric:tabular-nums}
.lre .lre-chat-seg-text{min-width:0;overflow-wrap:anywhere}
.lre .lre-chat-seg[data-tone=neg]{color:var(--lre-neg)}
.lre .lre-chat-seg[data-tone=warn]{color:var(--lre-warn)}
.lre .lre-chat-seg[data-tone=pos]{color:var(--lre-pos)}
.lre .lre-chat-seg.more{color:var(--lre-fg);font-weight:600}
.lre .lre-chat-chev{color:var(--lre-dim)}
.lre .lre-chat-receipt-list{align-self:stretch;display:flex;flex-direction:column;min-width:0;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);overflow:hidden}
.lre .lre-chip{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;padding:var(--lre-s2) var(--lre-s3)}
.lre .lre-chip+.lre-chip{border-top:1px solid var(--lre-hairline)}
.lre .lre-chip.busy,.lre .lre-chat-decision.busy,.lre .lre-chat-offer.busy{opacity:.6}
.lre .lre-chip-row{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2) var(--lre-s3);min-width:0;min-height:var(--lre-tap)}
.lre .lre-chip-icon{color:var(--lre-muted)}
.lre .lre-chip[data-tone=neg] .lre-chip-icon,.lre .lre-chip[data-tone=neg] .lre-chip-label{color:var(--lre-neg)}
.lre .lre-chip[data-tone=warn] .lre-chip-icon{color:var(--lre-warn)}
.lre .lre-chip[data-tone=pos] .lre-chip-icon{color:var(--lre-pos)}
.lre .lre-chip-text{flex:1 1 12em;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre .lre-chip-label{color:var(--lre-fg);font-weight:500;overflow-wrap:anywhere}
.lre .lre-chip-detail{color:var(--lre-muted);overflow-wrap:anywhere;white-space:pre-line}
.lre .lre-chat-form{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;padding:var(--lre-s3);border-radius:var(--lre-r-lg);background:var(--lre-well)}
.lre .lre-chat-decision{flex:1 1 100%;display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;padding:var(--lre-s3);border:1px solid color-mix(in srgb,var(--lre-warning) 40%,transparent);border-radius:var(--lre-r-xl);background:var(--lre-warn-soft)}
.lre .lre-chat-decision[data-tone=neg]{border-color:color-mix(in srgb,var(--lre-danger) 40%,transparent);background:var(--lre-neg-soft)}
.lre .lre-chat-due{display:inline-flex;align-items:center;gap:4px;align-self:flex-start;font-size:var(--lre-fs-xs);font-weight:600;color:var(--lre-warn)}
.lre .lre-chat-decision[data-tone=neg] .lre-chat-due,.lre .lre-chat-decision[data-tone=neg] .lre-chat-decision-icon{color:var(--lre-neg)}
.lre .lre-chat-decision-head{display:flex;align-items:flex-start;gap:var(--lre-s3);min-width:0}
.lre .lre-chat-decision-icon{margin-top:1px;color:var(--lre-warn)}
.lre .lre-chat-decision-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre .lre-chat-decision-label{font-size:var(--lre-fs-md);font-weight:600;line-height:1.35;color:var(--lre-fg);overflow-wrap:anywhere}
.lre .lre-chat-decision-detail{color:var(--lre-muted);overflow-wrap:anywhere;white-space:pre-line}
.lre .lre-chat-keep-rows{display:flex;flex-direction:column;min-width:0;border-top:1px solid var(--lre-hairline)}
.lre .lre-chat-keep-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s2) var(--lre-s3);min-width:0;min-height:var(--lre-tap-lg);padding:var(--lre-s2) 0;border-bottom:1px solid var(--lre-hairline)}
.lre .lre-chat-keep-text{flex:1 1 12em;min-width:0;display:flex;flex-direction:column;gap:2px;color:var(--lre-fg);overflow-wrap:anywhere}
.lre .lre-chat-keep-sub{display:flex;align-items:center;gap:4px;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre .lre-chat-offers{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre .lre-chat-offer{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.lre .lre-chat-offer-lead{display:inline-flex;align-items:center;gap:6px;min-width:0;color:var(--lre-fg);font-weight:500;overflow-wrap:anywhere}
.lre .lre-chat-offer-lead>.lre-icon{color:var(--lre-muted)}
.lre .lre-chat-offer-detail{flex:1 1 14em;min-width:0;color:var(--lre-muted);overflow-wrap:anywhere}
.lre .lre-chat-offer>.lre-chat-form{flex:1 1 100%}
.lre .lre-chat-pill{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:var(--lre-tap);padding:var(--lre-s1) 14px;border:1px solid var(--lre-border);border-radius:var(--lre-r-pill);background:var(--lre-subtle);color:var(--lre-fg);font-size:var(--lre-fs-sm);font-weight:500;line-height:1.3;text-align:left;overflow-wrap:anywhere;transition:background-color var(--lre-fast),border-color var(--lre-fast)}
.lre .lre-chat-pill:hover:not(:disabled){background:var(--lre-hover)}
.lre .lre-chat-pill>.lre-icon{flex:none}
.lre .lre-chat-pill>strong{flex:none;font-weight:600}
.lre .lre-chat-pill-text{min-width:0;font-weight:400}
.lre .lre-chat-pill.primary{border-color:color-mix(in srgb,var(--lre-accent) 45%,transparent);background:var(--lre-accent-soft);color:var(--lre-accent-text)}
.lre .lre-chat-pill.primary:hover:not(:disabled){background:color-mix(in srgb,var(--lre-accent) 24%,transparent)}
.lre .lre-chat-pill.primary .lre-chat-pill-text{color:var(--lre-fg)}
.lre .lre-chat-pill.danger{color:var(--lre-neg);border-color:color-mix(in srgb,var(--lre-danger) 40%,transparent)}
.lre .lre-chat-pill[aria-pressed=true]{border-color:transparent;background:var(--lre-accent-fill);color:var(--lre-accent-fg)}
.lre .lre-chat-pill[aria-pressed=true]:hover:not(:disabled){background:var(--lre-accent-fill)}
.lre .lre-chat-pill[aria-pressed=true]:focus-visible{outline-color:var(--lre-fg);box-shadow:inset 0 0 0 2px var(--lre-accent-fg)}

.lre .lre-chat-status{display:flex;align-items:center;gap:var(--lre-s2);min-width:0;padding:2px 0}
.lre .lre-chat-status-line{flex:1;min-width:0;min-height:var(--lre-tap);display:flex;align-items:center;gap:var(--lre-s2);padding:0 var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-pill);background:var(--lre-card);color:var(--lre-fg);font-size:var(--lre-fs-sm);text-align:left;transition:background-color var(--lre-fast)}
.lre .lre-chat-status-line:hover{background:var(--lre-hover)}
.lre .lre-chat-status-line:focus-visible{outline-offset:-2px}
.lre .lre-chat-status-line>.lre-icon{color:var(--lre-muted)}
.lre .lre-chat-status-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lre .lre-chat-status-text>.lre-chat-dot{margin:0 6px}
.lre .lre-chat-status>.lre-btn{flex:none;border-radius:var(--lre-r-pill);padding:0 var(--lre-s4)}
.lre .lre-chat-pulse{flex:none;width:10px;height:10px;border-radius:50%;background:var(--lre-accent);animation:lre-chat-pulse 1.4s ease-in-out infinite}
@keyframes lre-chat-pulse{50%{opacity:.3;transform:scale(.7)}}

.lre .lre-hud{display:flex;align-items:center;gap:2px;height:100%;padding:0 var(--lre-s1);border:1px solid var(--lre-border);border-radius:var(--lre-r-pill);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-lg);overflow:hidden;font-size:var(--lre-fs-sm)}
.lre .lre-hud>button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-width:var(--lre-tap);min-height:var(--lre-tap);padding:0 var(--lre-s2);border:0;border-radius:var(--lre-r-pill);background:transparent;white-space:nowrap;transition:background-color var(--lre-fast)}
.lre .lre-hud>button:hover{background:var(--lre-hover)}
.lre .lre-hud>button:focus-visible{outline-offset:-2px}
.lre .lre-hud>button>.lre-icon{color:var(--lre-muted)}
.lre .lre-hud .sep{flex:none;width:1px;height:18px;background:var(--lre-hairline)}
.lre .lre-hud>.lre-badge,.lre .lre-hud>.lre-chat-pulse{margin:0 var(--lre-s2)}
.lre .lre-hud-pop{display:flex;flex-direction:column;gap:var(--lre-s2);width:min(360px,calc(100vw - 24px));max-height:100%;overflow:auto;padding:var(--lre-s2) var(--lre-s3) var(--lre-s3);border:1px solid var(--lre-border);border-radius:var(--lre-r-xl);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-lg)}
.lre .lre-hud-pop:focus{outline:none}
.lre .lre-chat-pophead{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap)}
.lre .lre-chat-pophead>.lre-icon{color:var(--lre-muted)}
.lre .lre-chat-poptitle{flex:1;min-width:0;font-size:var(--lre-fs-lg);font-weight:600}

.lre.lre-overlay-root{width:100%;height:100%}
.lre.lre-sheet{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;border:1px solid var(--lre-border);border-bottom:0;border-radius:20px 20px 0 0;background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-lg)}
.lre.lre-sheet.desk{border-bottom:1px solid var(--lre-border);border-radius:var(--lre-r-xl)}
.lre.lre-sheet:focus{outline:none}
.lre.lre-sheet>header{flex:none;display:flex;align-items:center;gap:var(--lre-s2);min-height:56px;padding:var(--lre-s2) var(--lre-s2) var(--lre-s2) var(--lre-s4);border-bottom:1px solid var(--lre-hairline)}
.lre.lre-sheet>header>.lre-icon{color:var(--lre-muted)}
.lre.lre-sheet>header>.title{flex:1;min-width:0;margin:0;font-size:var(--lre-fs-lg);font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.lre.lre-sheet>.lre-chat-tabs{flex:none;padding:var(--lre-s3) var(--lre-s3) 0}
.lre.lre-sheet>.body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:var(--lre-s3);padding:var(--lre-s3) var(--lre-s3) var(--lre-s4)}
.lre.lre-sheet>footer{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);padding:var(--lre-s2) var(--lre-s3) calc(var(--lre-s2) + env(safe-area-inset-bottom,0px));border-top:1px solid var(--lre-hairline);background:var(--lre-bar-bg)}
.lre.lre-sheet>footer>.lre-money{flex:1 1 9em}
.lre .lre-chat-sheetcontent,.lre .lre-chat-world{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre .lre-chat-worldlist{border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);overflow:hidden}
.lre .lre-chat-worldlist .lre-listrow-value{display:flex;max-width:none}
.lre .lre-chat-worldactions{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
.lre .lre-chat-worldactions>.lre-btn{flex:1 1 auto}

.lre .lre-chat-entry{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.lre .lre-chat-entry+.lre-chat-entry{margin-top:var(--lre-s1)}
.lre .lre-chat-entry-head{display:flex;align-items:center;justify-content:space-between;gap:var(--lre-s2);min-height:24px;padding:0 var(--lre-s1)}
.lre .lre-chat-entry-head>h3{margin:0;min-width:0;font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-muted);overflow-wrap:anywhere}
.lre .lre-chat-option{align-items:flex-start}
.lre .lre-chat-option>.grow{display:flex;flex-direction:column;gap:var(--lre-s1)}
.lre .lre-chat-meta{display:flex;flex-wrap:wrap;align-items:center;gap:2px var(--lre-s2);font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre .lre-chat-time{display:inline-flex;align-items:center;gap:4px;font-variant-numeric:tabular-nums}
.lre .lre-chat-odds{display:flex;flex-direction:column;gap:4px;min-width:0}
.lre .lre-chat-oddsbar{display:flex;height:6px;border-radius:var(--lre-r-pill);overflow:hidden;background:var(--lre-neutral-soft)}
.lre .lre-chat-oddsbar>span{height:100%}
.lre .lre-chat-oddswords{font-size:var(--lre-fs-sm);color:var(--lre-muted);font-variant-numeric:tabular-nums}
.lre .lre-chat-oddswords strong{color:var(--lre-fg);font-weight:600}
.lre .lre-chat-whynot{display:flex;align-items:flex-start;gap:4px;font-size:var(--lre-fs-sm);color:var(--lre-fg)}
.lre .lre-chat-whynot>.lre-icon{margin-top:2px;color:var(--lre-warn)}
.lre .lre-chat-option[aria-disabled=true]{border-style:dashed;background:transparent;cursor:default}
.lre .lre-chat-option[aria-disabled=true]:hover{background:transparent}
.lre .lre-chat-option[aria-disabled=true] .title{color:var(--lre-muted)}
.lre .lre-chat-price{flex:none;align-self:center;font-weight:600}
.lre .lre-chat-option>.lre-chat-chev,.lre .lre-chat-option>.lre-chat-price{align-self:center}
.lre .lre-chat-next{display:flex;flex-direction:column;gap:var(--lre-s2);margin-top:var(--lre-s1);padding-left:var(--lre-s3);border-left:2px solid color-mix(in srgb,var(--lre-accent) 45%,transparent)}
.lre .lre-chat-next-head{display:flex;align-items:center;gap:4px;font-size:var(--lre-fs-sm);font-weight:600}
.lre .lre-chat-next-head>.lre-icon{color:var(--lre-accent-text)}
.lre .lre-chat-encounter{display:flex;flex-direction:column;gap:var(--lre-s2);padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre .lre-chat-encounter-head{display:flex;align-items:center;gap:var(--lre-s2)}
.lre .lre-chat-encounter-head>strong{flex:1;min-width:0}
.lre .lre-chat-encounter-left{display:flex;flex-wrap:wrap;gap:6px}
.lre .lre-chat-go{flex:1 1 12em}
.lre .lre-chat-hint{flex:1 1 100%;display:flex;align-items:flex-start;gap:4px;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre .lre-chat-hint>.lre-icon{margin-top:2px}
.lre .lre-chat-hint[role=status]{color:var(--lre-neg)}
.lre .lre-section-body>.lre-chat-hint{margin-top:var(--lre-s3)}
.lre .lre-chat-count{flex:none;display:flex;align-items:center;gap:6px;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre .lre-chat-count>.lre-input{width:72px;text-align:center;font-variant-numeric:tabular-nums}
.lre .lre-chat-durations{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
.lre .lre-chat-custom{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);margin-top:var(--lre-s3)}
.lre .lre-chat-custom>.lre-input{flex:0 0 96px;width:96px}
.lre .lre-chat-custom>.lre-seg{flex:1 1 200px}
.lre .lre-chat-lead{color:var(--lre-muted)}
.lre .lre-odds{display:flex;height:8px;margin-top:4px;border-radius:var(--lre-r-pill);overflow:hidden;background:var(--lre-neutral-soft)}
.lre .lre-odds>span{height:100%}
.lre .lre-odds-legend{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:4px;font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.lre .lre-odds-legend i{display:inline-block;width:8px;height:8px;margin-right:4px;border-radius:2px}

.lre .lre-chat-fix{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0;padding:var(--lre-s3);border:1px solid color-mix(in srgb,var(--lre-accent) 35%,transparent);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre .lre-chat-fix-head{display:inline-flex;align-items:center;gap:6px;font-size:var(--lre-fs-sm);font-weight:600;color:var(--lre-fg)}
.lre .lre-chat-fix-head>.lre-icon,.lre .lre-chat-fix .lre-item>.lre-icon{color:var(--lre-accent-text)}

.lre.lre-chat-mapframe{position:relative;width:100%;height:100%;overflow:hidden;border:1px solid var(--lre-border);border-radius:var(--lre-r-xl);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-lg)}
.lre.lre-chat-mapframe.full{border:0;border-radius:0;box-shadow:none}
.lre.lre-chat-mapframe:focus{outline:none}
.lre.lre-chat-mapframe .lre-map{border:0;border-radius:0}
.lre.lre-chat-mapframe>.lre-empty{padding-top:64px}
.lre .lre-chat-mapbar{position:absolute;top:var(--lre-s2);left:var(--lre-s2);right:var(--lre-s2);z-index:3;display:flex;align-items:center;gap:var(--lre-s2);pointer-events:none}
.lre .lre-chat-mapbar>*{pointer-events:auto}
.lre .lre-chat-mapbar-title{display:flex;align-items:center;gap:6px;min-width:0;min-height:var(--lre-tap);margin-right:auto;padding:0 var(--lre-s3);border:1px solid var(--lre-border);border-radius:var(--lre-r-pill);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-sm);font-weight:600}
.lre .lre-chat-mapbar-title>.lre-icon{color:var(--lre-muted)}
.lre .lre-chat-mapbar-title>span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lre .lre-chat-mapbar>.lre-iconbtn{border-color:var(--lre-border);border-radius:var(--lre-r-pill);background:var(--lre-bar-bg);color:var(--lre-fg);box-shadow:var(--lre-shadow-sm)}
.lre .lre-chat-mapbar>.lre-iconbtn:hover:not(:disabled){background:linear-gradient(var(--lre-hover),var(--lre-hover)),var(--lre-bar-bg)}

.lre.lre-toasts{position:fixed;left:50%;bottom:84px;z-index:2147483000;transform:translateX(-50%);display:flex;flex-direction:column;gap:var(--lre-s2);width:min(420px,calc(100vw - 24px));pointer-events:none}
.lre.lre-toasts.inline{position:static;transform:none;width:auto;margin:var(--lre-s1) 0}
/* A desktop drawer's toasts: over its column (Toasts measures it, in rendered px), clear of the chat's composer. */
.lre.lre-toasts.docked{left:calc(var(--lre-toasts-x,50vw) / var(--lumiverse-ui-scale,1));width:min(420px,calc(var(--lre-toasts-w,100vw) / var(--lumiverse-ui-scale,1) - 24px))}
.lre .lre-toast{pointer-events:auto;display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap-lg);padding:var(--lre-s1) var(--lre-s1) var(--lre-s1) var(--lre-s3);border:1px solid var(--lre-border);border-radius:var(--lre-r-lg);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-lg);color:var(--lre-fg);font-size:var(--lre-fs-sm)}
.lre .lre-toast>.lre-icon{flex:none;color:var(--lre-accent-text)}
.lre .lre-toast.error{border-color:color-mix(in srgb,var(--lre-danger) 50%,transparent)}
.lre .lre-toast.error>.lre-icon{color:var(--lre-neg)}
.lre .lre-toast>span{min-width:0;overflow-wrap:anywhere}
.lre .lre-toast>.lre-iconbtn{color:var(--lre-muted)}
`;
