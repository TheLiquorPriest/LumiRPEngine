// One stylesheet for every LumiRPEngine surface, added with `ctx.dom.addStyle`. Host theme
// variables with fallbacks; every interactive element is at least 40 px tall (DESIGN §12).
// Text tokens mix the host status/muted colours toward the host text colour so they keep WCAG
// 4.5:1 on the host's light and dark surfaces; accent-filled controls use --lre-accent-fill.

export const CSS = `
.lre,.lre-chips{--lre-fg:var(--lumiverse-text,#e8e8ea);--lre-muted:color-mix(in srgb,var(--lumiverse-text-muted,#a3a3ad) 85%,var(--lre-fg));--lre-dim:color-mix(in srgb,var(--lumiverse-text-dim,#7c7c86) 50%,var(--lre-fg));--lre-fill:var(--lumiverse-fill,#17171c);--lre-surface:var(--lumiverse-bg-deep,#121217);--lre-subtle:var(--lumiverse-fill-subtle,rgba(255,255,255,.05));--lre-border:var(--lumiverse-border,rgba(255,255,255,.12));--lre-accent:var(--lumiverse-primary,#7c6cff);--lre-accent-fg:var(--lumiverse-primary-contrast,#fff);--lre-accent-fill:var(--lre-accent);--lre-radius:var(--lumiverse-radius,10px);--lre-danger:var(--lumiverse-danger,#ef4444);--lre-success:var(--lumiverse-success,#22c55e);--lre-warning:var(--lumiverse-warning,#f59e0b);--lre-neg:color-mix(in srgb,var(--lre-danger) 55%,var(--lre-fg));--lre-pos:color-mix(in srgb,var(--lre-success) 35%,var(--lre-fg));--lre-warn:color-mix(in srgb,var(--lre-warning) 35%,var(--lre-fg));--lre-gutter:0px;overflow-wrap:break-word}
@supports (color:hsl(from red h s calc(100 - l))){.lre,.lre-chips{--lre-accent-fill:color-mix(in srgb,var(--lre-accent) 80%,hsl(from var(--lre-accent-fg) h s calc(100 - l)))}}
.lre{font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--lre-fg);box-sizing:border-box;min-width:0}
.lre *,.lre *::before,.lre *::after{box-sizing:border-box}
.lre-drawer{padding:8px calc(10px + var(--lre-gutter)) 24px 10px;display:flex;flex-direction:column;gap:8px;min-height:100%}
.lre button,.lre-chips button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.lre button:disabled,.lre-chips button:disabled{cursor:default;opacity:.5}
.lre-btn{min-height:40px;min-width:40px;max-width:100%;padding:6px 12px;border-radius:var(--lre-radius);border:1px solid var(--lre-border);background:var(--lre-subtle);display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:normal;overflow-wrap:anywhere;text-align:center}
.lre-btn:hover:not(:disabled){border-color:var(--lumiverse-border-hover,rgba(255,255,255,.25))}
.lre-btn.primary{background:var(--lre-accent-fill);color:var(--lre-accent-fg);border-color:transparent}
.lre-btn.danger{color:var(--lre-neg);border-color:color-mix(in srgb,var(--lre-danger) 40%,transparent)}
.lre-btn.ghost{background:transparent;border-color:transparent}
.lre-btn.block{width:100%}
.lre-btn.small{min-height:40px;padding:6px 10px;font-size:13px}
.lre-seg{display:flex;gap:4px;flex-wrap:wrap}
.lre-seg>button{flex:1 0 auto;max-width:100%;min-height:40px;min-width:40px;padding:4px 8px;border-radius:var(--lre-radius);border:1px solid var(--lre-border);background:var(--lre-subtle);font-size:13px;white-space:normal;overflow-wrap:anywhere}
.lre-seg>button[aria-pressed=true]{background:var(--lre-accent-fill);color:var(--lre-accent-fg);border-color:transparent}
.lre-tabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding-bottom:2px;-webkit-overflow-scrolling:touch}
.lre-tabs::-webkit-scrollbar{display:none}
.lre-tabs>button{flex:0 0 auto;min-height:40px;min-width:40px;padding:0 12px;border-radius:20px;border:1px solid var(--lre-border);background:var(--lre-subtle);font-size:13px;position:relative}
.lre-tabs>button[aria-selected=true]{background:var(--lre-accent-fill);color:var(--lre-accent-fg);border-color:transparent}
.lre-tabs>button .lre-dot{position:absolute;top:6px;right:6px;width:7px;height:7px;border-radius:50%;background:var(--lre-warn)}
.lre-top{display:flex;gap:6px;align-items:center}
.lre-top>.lre-seg{flex:1;min-width:0}
.lre-card{border:1px solid var(--lre-border);border-radius:12px;padding:10px;background:var(--lre-subtle);min-width:0}
.lre-card+.lre-card{margin-top:8px}
.lre-card.preview{border-style:dashed}
.lre-h{margin:4px 0 6px;font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--lre-muted);display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}
.lre-h>span{min-width:0;overflow-wrap:anywhere}
.lre-h2{margin:0;font-size:15px;font-weight:600}
.lre-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.15);min-height:40px;min-width:0}
.lre-row:last-child{border-bottom:0}
.lre-row>.k{flex:1 1 0;min-width:min(9em,100%);overflow-wrap:anywhere}
.lre-row>.v{margin-left:auto;max-width:100%;min-width:0;font-variant-numeric:tabular-nums;font-weight:600;text-align:right;overflow-wrap:anywhere}
.lre-row .sub{display:block;font-size:12px;color:var(--lre-muted);font-weight:400;white-space:normal}
.lre-stack{display:flex;flex-direction:column;gap:8px;min-width:0}
.lre-inline{display:flex;gap:6px;align-items:center;flex-wrap:wrap;min-width:0}
.lre-spread{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;min-width:0}
.lre-inline>*,.lre-spread>*{max-width:100%}
.lre-muted{color:var(--lre-muted)}.lre-dim{color:var(--lre-dim)}.lre-neg{color:var(--lre-neg)}.lre-pos{color:var(--lre-pos)}.lre-warn{color:var(--lre-warn)}
.lre-small{font-size:12px}
.lre-num{font-variant-numeric:tabular-nums}
.lre-empty{padding:16px 8px;text-align:center;color:var(--lre-muted)}
.lre-banner{border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;border:1px solid var(--lre-border)}
.lre-banner.warn{background:color-mix(in srgb,var(--lre-warning) 10%,transparent);border-color:color-mix(in srgb,var(--lre-warning) 45%,transparent)}
.lre-banner.info{background:color-mix(in srgb,var(--lre-accent) 10%,transparent);border-color:color-mix(in srgb,var(--lre-accent) 40%,transparent)}
.lre-badge{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:11px;font-size:11px;background:rgba(127,127,127,.18);color:var(--lre-muted);white-space:nowrap}
.lre-badge.accent{background:color-mix(in srgb,var(--lre-accent) 22%,transparent);color:var(--lre-fg)}
.lre-badge.warn{background:color-mix(in srgb,var(--lre-warning) 20%,transparent);color:var(--lre-warn)}
.lre-badge.neg{background:color-mix(in srgb,var(--lre-danger) 18%,transparent);color:var(--lre-neg)}
.lre-badge.pos{background:color-mix(in srgb,var(--lre-success) 16%,transparent);color:var(--lre-pos)}
.lre-preview-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-warn)}
.lre-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.lre-field>label,.lre-field>.label{font-size:12px;color:var(--lre-muted)}
.lre-input{min-height:40px;width:100%;padding:8px 10px;border-radius:var(--lre-radius);border:1px solid var(--lre-border);background:var(--lre-fill);color:var(--lre-fg);font:inherit;min-width:0}
textarea.lre-input{min-height:80px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
select.lre-input{appearance:auto}
.lre-input.invalid{border-color:var(--lre-neg)}
.lre-money{display:flex;align-items:center;gap:6px;flex:1 1 8em;min-width:0}
.lre-money>.lre-input{flex:1 1 auto;min-width:0;font-variant-numeric:tabular-nums}
.lre-money-affix{flex:0 0 auto;color:var(--lre-muted)}
.lre-list{display:flex;flex-direction:column;gap:6px}
.lre-item{display:flex;align-items:center;gap:10px;min-height:44px;width:100%;padding:8px 10px;border-radius:var(--lre-radius);border:1px solid var(--lre-border);background:var(--lre-subtle);text-align:left}
.lre-item>.grow{flex:1;min-width:0}
.lre-item .title{display:block;font-weight:600;overflow-wrap:anywhere}
.lre-item .sub{display:block;font-size:12px;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-item[aria-current=true]{border-color:var(--lre-accent)}
.lre-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 2px;font:13px/1.3 system-ui,-apple-system,sans-serif}
@media (max-width:600px),(pointer:coarse){.lre-chips{padding-right:44px}}
.lre-chip{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;min-height:44px;max-width:100%;padding:2px 2px 2px 12px;border-radius:22px;border:1px solid color-mix(in srgb,var(--lre-accent) 40%,transparent);background:color-mix(in srgb,var(--lre-accent) 12%,transparent)}
.lre-chip.info{padding-right:12px}
.lre-chip>.lab{flex:1 1 auto;min-width:0;overflow-wrap:anywhere}
.lre-chip>.det{color:var(--lre-muted);font-size:12px}
.lre-chip button{flex:0 0 auto;max-width:100%;min-height:40px;min-width:40px;padding:4px 12px;border-radius:20px;border:1px solid var(--lre-border);background:var(--lre-fill);white-space:normal;overflow-wrap:anywhere;text-align:center}
.lre-chip button.primary{background:var(--lre-accent-fill);color:var(--lre-accent-fg);border-color:transparent}
.lre-chip button.danger{color:var(--lre-neg)}
.lre-chip[data-kind=decline],.lre-chip[data-kind=degraded],.lre-chip[data-kind=read_failed]{border-color:color-mix(in srgb,var(--lre-danger) 45%,transparent);background:color-mix(in srgb,var(--lre-danger) 10%,transparent)}
.lre-chip-form{display:flex;flex-wrap:wrap;align-items:center;gap:6px;flex:1 1 100%;min-width:0;padding:0 10px 6px 0}
.lre-chip-form .lre-input{box-sizing:border-box;min-height:40px}
.lre-chip-form select.lre-input{flex:1 1 12em;width:auto}
.lre-chip[data-kind=confirm],.lre-chip[data-kind=overdue],.lre-chip[data-kind=keep_report],.lre-chip[data-kind=pending]{border-color:color-mix(in srgb,var(--lre-warning) 50%,transparent);background:color-mix(in srgb,var(--lre-warning) 10%,transparent)}
.lre-chip[data-kind=change],.lre-chip[data-kind=elapsed],.lre-chip[data-kind=price],.lre-chip[data-kind=roll]{border-color:var(--lre-border);background:var(--lre-subtle)}
.lre-chip.busy{opacity:.6}
.lre-keep{flex-basis:100%;border:1px solid color-mix(in srgb,var(--lre-warning) 50%,transparent);border-radius:12px;padding:8px 10px;background:color-mix(in srgb,var(--lre-warning) 6%,transparent)}
.lre-keep .lre-row{padding:6px 0}
.lre-hud{display:flex;align-items:center;gap:2px;height:100%;padding:0 4px;border-radius:22px;border:1px solid var(--lre-border);background:color-mix(in srgb,var(--lre-surface) 94%,transparent);backdrop-filter:blur(10px);box-shadow:0 4px 18px rgba(0,0,0,.45);overflow:hidden}
.lre-hud>button{min-height:40px;min-width:40px;padding:0 8px;border:0;background:transparent;display:inline-flex;align-items:center;justify-content:center;gap:4px;white-space:nowrap;border-radius:18px;font-size:13px}
.lre-hud>button:hover{background:var(--lre-subtle)}
.lre-hud .sep{width:1px;height:18px;background:var(--lre-border)}
.lre-hud-pop{width:min(340px,calc(100vw - 24px));padding:10px;border-radius:14px;border:1px solid var(--lre-border);background:var(--lre-surface);box-shadow:0 10px 30px rgba(0,0,0,.45);max-height:100%;overflow:auto}
.lre-sheet{display:flex;flex-direction:column;height:100%;background:var(--lre-surface);border:1px solid var(--lre-border);border-radius:16px 16px 0 0;box-shadow:0 -10px 30px rgba(0,0,0,.45);overflow:hidden}
.lre-sheet.desk{border-radius:16px}
.lre-sheet>header{display:flex;align-items:center;gap:8px;padding:8px 8px 6px 14px;border-bottom:1px solid var(--lre-border)}
.lre-sheet>header>.title{flex:1;min-width:0;font-weight:600;overflow-wrap:anywhere}
.lre-sheet>.body{flex:1;overflow:auto;padding:10px 12px 16px;display:flex;flex-direction:column;gap:10px;overscroll-behavior:contain}
.lre-sheet>footer{padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--lre-border);display:flex;flex-wrap:wrap;gap:8px}
.lre-odds{display:flex;height:8px;border-radius:4px;overflow:hidden;background:rgba(127,127,127,.2);margin-top:4px}
.lre-odds>span{height:100%}
.lre-odds-legend{display:flex;gap:10px;flex-wrap:wrap;font-size:12px;color:var(--lre-muted);margin-top:4px}
.lre-odds-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}
.lre-map{position:relative;width:100%;height:100%;overflow:hidden;touch-action:none;background:#12141a;border-radius:12px;user-select:none}
.lre-map.full{border-radius:0}
.lre-map canvas{position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none}
.lre-map .bar{position:absolute;top:8px;left:8px;right:8px;display:flex;gap:6px;justify-content:flex-end;align-items:center;pointer-events:none}
.lre-map .bar>*{pointer-events:auto}
.lre-map .bar .title{margin-right:auto;min-width:0;padding:0 10px;min-height:40px;display:flex;align-items:center;border-radius:20px;background:rgba(0,0,0,.45);color:#fff;font-weight:600;overflow-wrap:anywhere}
.lre-map .bar .lre-btn,.lre-map .zoom .lre-btn{background:var(--lre-surface)}
.lre-map .bar :focus-visible,.lre-map .zoom :focus-visible{outline-color:#fff}
.lre-map .dock{position:absolute;left:8px;right:8px;bottom:8px;padding:10px;border-radius:14px;background:color-mix(in srgb,var(--lre-surface) 94%,transparent);border:1px solid var(--lre-border);display:flex;flex-direction:column;gap:8px;max-height:55%;overflow:auto}
.lre-map .zoom{position:absolute;right:8px;bottom:8px;display:flex;flex-direction:column;gap:6px}
.lre-map .mode{position:absolute;left:8px;bottom:8px;padding:4px;border-radius:12px;background:rgba(0,0,0,.45)}
.lre-map .mode .lre-seg{flex-wrap:nowrap}
.lre-map .mode .lre-seg>button:not([aria-pressed=true]){background:var(--lre-surface)}
.lre-map .crumbs{position:absolute;top:8px;left:8px;right:8px;display:flex;align-items:center;gap:4px;overflow-x:auto;scrollbar-width:none;white-space:nowrap;color:#fff}
.lre-map .crumbs::-webkit-scrollbar{display:none}
.lre-overlay-root .lre-map .crumbs{top:56px}
.lre-map .crumb{display:inline-flex;align-items:center;gap:4px;flex:none}
.lre-map .crumb .lre-btn{background:rgba(0,0,0,.5);color:#fff;border-color:transparent;border-radius:20px}
.lre-map .crumb.current{min-height:40px;padding:0 12px;border-radius:20px;background:rgba(0,0,0,.65);font-weight:600}
.lre-map .crumb.current .lre-muted{color:rgba(255,255,255,.7);font-weight:400}
.lre-map .crumbs :focus-visible{outline-color:#fff}
.lre-toasts{position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:2147483000;display:flex;flex-direction:column;gap:6px;width:min(420px,calc(100vw - 24px));pointer-events:none}
.lre-toast{pointer-events:auto;padding:10px 12px;border-radius:12px;background:var(--lre-surface);border:1px solid var(--lre-border);box-shadow:0 8px 24px rgba(0,0,0,.45);display:flex;gap:8px;align-items:center}
.lre-toast>span{min-width:0;overflow-wrap:anywhere}
.lre-toasts.inline{position:static;transform:none;width:auto;margin:4px 0}
.lre-overlay-root{width:100%;height:100%}
.lre-toast.error{border-color:color-mix(in srgb,var(--lre-danger) 60%,transparent)}
.lre-meter{display:grid;grid-template-columns:auto repeat(4,1fr);gap:4px 10px;font-size:12px;font-variant-numeric:tabular-nums}
.lre-meter>.hd{color:var(--lre-muted)}
.lre-timeline{display:flex;height:16px;border-radius:4px;overflow:hidden;background:rgba(127,127,127,.15);margin-top:6px}
.lre-timeline>span{height:100%;border-right:1px solid rgba(0,0,0,.25)}
.lre-tl-work{background:#6b5cff}.lre-tl-sleep{background:#2d3a6b}.lre-tl-free{background:#2d5a3c}.lre-tl-travel{background:#8a6b2d}.lre-tl-other{background:#555}
.lre-bar{height:8px;border-radius:4px;background:rgba(127,127,127,.2);overflow:hidden}
.lre-bar>span{display:block;height:100%;background:var(--lre-accent)}
.lre-bar.low>span{background:var(--lre-neg)}
.lre-tree{padding-left:12px;border-left:1px solid var(--lre-border);margin-left:4px}
.lre-json{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0;color:var(--lre-muted)}
.lre-graph{width:100%;overflow:auto;border:1px solid var(--lre-border);border-radius:12px;background:#12141a;touch-action:pan-x pan-y}
.lre-graph svg{display:block}
.lre-grid-editor{position:relative;width:100%;height:320px;border:1px solid var(--lre-border);border-radius:12px;overflow:hidden;touch-action:none;background:#12141a}
.lre-grid-editor canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
.lre-expr-tools{display:flex;gap:4px;flex-wrap:wrap;max-height:220px;overflow:auto;overscroll-behavior:contain}
.lre-expr-tools>button{min-height:40px;min-width:40px;padding:0 8px;border-radius:8px;border:1px solid var(--lre-border);background:var(--lre-subtle);font:12px ui-monospace,Menlo,monospace}
.lre-sched{position:relative;height:44px;border-radius:8px;background:rgba(127,127,127,.12);overflow:hidden}
.lre-sched>button{position:absolute;top:2px;bottom:2px;border-radius:6px;border:1px solid rgba(0,0,0,.3);background:var(--lre-accent-fill);color:var(--lre-accent-fg);font-size:11px;overflow:hidden;padding:0 4px;min-width:40px}
.lre-sched>button[aria-current=true]{outline:2px solid var(--lre-fg)}
.lre-sched-axis{display:flex;justify-content:space-between;font-size:10px;color:var(--lre-dim);margin-top:2px}
.lre-lint{display:flex;gap:8px;align-items:flex-start;padding:8px 0;border-bottom:1px solid rgba(127,127,127,.15)}
.lre-lint:last-child{border-bottom:0}
.lre-lint .path{font:11px ui-monospace,Menlo,monospace;color:var(--lre-dim);overflow-wrap:anywhere}
.lre-lint.jump{width:100%;min-height:40px;background:none;border:0;border-bottom:1px solid rgba(127,127,127,.15);color:inherit;font:inherit;text-align:left;cursor:pointer;align-items:center}
.lre-lint.jump>.grow{flex:1;min-width:0;overflow-wrap:anywhere}
.lre-code{display:flex;height:340px;border:1px solid var(--lre-border);border-radius:var(--lre-radius);background:var(--lre-fill);overflow:hidden}
.lre-code .gutter{margin:0;padding:8px 6px;min-width:3em;text-align:right;color:var(--lre-dim);font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;user-select:none;border-right:1px solid var(--lre-border)}
.lre-code .gutter>span{display:block;padding:0 2px;border-radius:3px}
.lre-code .gutter>.error{color:var(--lre-fg);background:color-mix(in srgb,var(--lre-neg) 45%,transparent)}
.lre-code .gutter>.warning{color:var(--lre-fg);background:color-mix(in srgb,var(--lre-warning) 40%,transparent)}
.lre-code .text{flex:1;min-width:0;margin:0;padding:8px;border:0;outline:none;resize:none;background:transparent;color:var(--lre-fg);font:12px/18px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;overflow:auto;tab-size:2}
.lre-code:focus-within{border-color:var(--lre-accent)}
.lre-progress{height:6px;border-radius:3px;background:rgba(127,127,127,.2);overflow:hidden}
.lre-progress>span{display:block;height:100%;background:var(--lre-accent);transition:width .3s}
.lre-host-slot{min-height:40px}
.lre-tier-wrap{container-type:inline-size}
.lre-tier-grid{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,52px);gap:4px;align-items:center;font-size:12px}
.lre-tier-grid [role=columnheader],.lre-tier-grid [role=rowheader]{min-width:0;overflow-wrap:break-word;hyphens:auto}
@container (max-width:240px){.lre-tier-grid{grid-template-columns:repeat(3,minmax(40px,1fr))}.lre-tier-grid [role=row]>[role=columnheader]:first-child,.lre-tier-grid [role=rowheader]{grid-column:1/-1}.lre-tier-grid [role=rowheader]{padding-top:4px}}
.lre-tier-grid select{min-height:40px;width:100%;min-width:40px;padding-left:4px;padding-right:4px}
.lre-check{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;min-width:40px;min-height:40px;cursor:pointer}
.lre-check>input{width:22px;height:22px;margin:0;cursor:pointer}
.lre-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.lre-stepper{display:inline-flex;align-items:center;gap:4px;margin-left:auto;max-width:100%;min-width:0}
.lre-stepper>.lre-input{flex:0 1 76px;width:76px;min-width:44px;text-align:center;font-variant-numeric:tabular-nums}
.lre-stepper>.lre-btn{flex:0 0 40px;padding:0}
.lre :focus-visible,.lre-chips :focus-visible{outline:2px solid var(--lre-accent);outline-offset:2px}
.lre-btn.primary:focus-visible,.lre-seg>button[aria-pressed=true]:focus-visible,.lre-tabs>button[aria-selected=true]:focus-visible,.lre-chip button.primary:focus-visible,.lre-sched>button:focus-visible{outline-color:var(--lre-fg);box-shadow:inset 0 0 0 2px var(--lre-accent-fg)}
.lre-tabs>button:focus-visible,.lre-hud>button:focus-visible,.lre-sched>button:focus-visible{outline-offset:-2px}
.lre-sheet:focus,[data-lre-overlay=map]:focus,.lre-hud-pop:focus{outline:none}
@media (prefers-reduced-motion:reduce){.lre,.lre *,.lre *::before,.lre *::after,.lre-chips,.lre-chips *,.lre-chips *::before,.lre-chips *::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;
