// The Settings page's rules, and the Agents page's settings that use the same rows (plan §14): the bar of where a change goes, the
// search and the Changed filter; the sections, a row of chips that becomes a column beside the settings where the page itself is
// wide (a container query, so the drawer in Lumiverse and a phone read it as one column whatever the window is); each setting's row
// with its control, its advice and its way back; a switch; a list's chips; the row editors of a table and of a list of records; and
// the table of a value per connection or per agent, its first column held in place while the rest scroll sideways. Built on the
// tokens and the shared atoms only. Listed in UI_CSS (src/ui/styles.ts).

export const SETTINGS_PAGE_CSS = `
.rpe-set-page{container-type:inline-size}
.rpe-set-levelbar,.rpe-set-tools{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.rpe-set-tools>.lre-search{flex:1 1 240px}
.rpe-set-filter,.rpe-set-nav>button{display:inline-flex;align-items:center;gap:var(--lre-s1);flex:0 0 auto;min-height:var(--lre-tap);padding:0 14px;border-radius:var(--lre-r-pill);border:1px solid var(--lre-hairline);background:transparent;color:var(--lre-muted);font:inherit;font-size:var(--lre-fs-sm);font-weight:500;white-space:nowrap;cursor:pointer;transition:background-color var(--lre-fast),color var(--lre-fast)}
.rpe-set-filter:hover,.rpe-set-nav>button:hover{background:var(--lre-hover);color:var(--lre-fg)}
.rpe-set-filter[aria-pressed=true],.rpe-set-nav>button[aria-current=true]{background:var(--lre-accent-soft);color:var(--lre-accent-text);border-color:color-mix(in srgb,var(--lre-accent) 35%,transparent);font-weight:600}
.rpe-set-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--lre-s3);min-width:0}
.rpe-set-nav{display:flex;gap:var(--lre-s2);overflow-x:auto;scrollbar-width:none;padding-bottom:2px;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;min-width:0}
.rpe-set-nav::-webkit-scrollbar{display:none}
@container (min-width: 760px){
.rpe-set-layout{grid-template-columns:200px minmax(0,1fr);align-items:start}
.rpe-set-nav{flex-direction:column;gap:2px;overflow:visible;position:sticky;top:var(--lre-s2)}
.rpe-set-nav>button{justify-content:space-between;border-color:transparent;border-radius:var(--lre-r);white-space:normal;text-align:left}
}
.rpe-set-body,.rpe-set-section,.rpe-set-group{display:flex;flex-direction:column;min-width:0}
.rpe-set-section{gap:var(--lre-s3)}
.rpe-set-group{gap:var(--lre-s2)}
.rpe-set-sectionhead{display:flex;flex-direction:column;gap:2px}
.rpe-set-grouptitle{margin:0;font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-muted)}
.rpe-set-rows{display:flex;flex-direction:column;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);min-width:0}
.rpe-set-row{display:flex;flex-direction:column;gap:var(--lre-s1);padding:var(--lre-s3);min-width:0}
.rpe-set-row+.rpe-set-row{border-top:1px solid var(--lre-hairline)}
.rpe-set-row[data-changed]{box-shadow:inset 3px 0 0 var(--lre-accent)}
.rpe-set-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2)}
.rpe-set-name{font-weight:600;overflow-wrap:anywhere}
.rpe-set-about{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.rpe-set-control{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);margin-top:var(--lre-s1);min-width:0}
.rpe-set-control>*{max-width:100%}
.rpe-set-number{flex:1 1 auto}
.rpe-set-numberline,.rpe-set-textline{flex-wrap:wrap}
.rpe-set-input{width:9em;flex:0 0 auto;font-variant-numeric:tabular-nums}
.rpe-set-text{flex:1 1 14em;min-width:0}
.rpe-set-select{width:auto;max-width:100%}
.rpe-set-unit{font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.rpe-set-advice{margin:0;display:flex;gap:var(--lre-s1);align-items:flex-start;font-size:var(--lre-fs-sm);color:var(--lre-warn);overflow-wrap:anywhere}
.rpe-set-advice>.lre-icon{margin-top:2px}
.rpe-set-levels{display:flex;flex-direction:column;gap:2px;font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.rpe-set-foot{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.rpe-set-meta{margin-left:auto}
.rpe-switch{position:relative;display:inline-flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap);cursor:pointer}
.rpe-switch>input{position:absolute;left:0;width:44px;height:26px;margin:0;opacity:0;cursor:pointer}
.rpe-switch-track{position:relative;flex:none;width:44px;height:26px;border-radius:13px;background:var(--lre-border);transition:background-color var(--lre-fast)}
.rpe-switch-track::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--lre-fg);transition:transform var(--lre-fast)}
.rpe-switch>input:checked+.rpe-switch-track{background:var(--lre-accent-fill)}
.rpe-switch>input:checked+.rpe-switch-track::after{transform:translateX(18px);background:var(--lre-accent-fg)}
.rpe-switch>input:focus-visible+.rpe-switch-track{outline:2px solid var(--lre-accent);outline-offset:2px}
.rpe-switch>input:disabled+.rpe-switch-track{opacity:.5}
.rpe-set-chips{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--lre-s1);min-width:0}
.rpe-set-chips>li{display:inline-flex;align-items:center;gap:2px;max-width:100%;padding:2px 2px 2px 10px;border-radius:var(--lre-r-pill);background:var(--lre-well);font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.rpe-set-chip-x{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:var(--lre-muted);cursor:pointer}
.rpe-set-chip-x:hover{background:var(--lre-hover);color:var(--lre-fg)}
.rpe-set-rowedit{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);min-width:0}
.rpe-set-rowedit>.lre-input{flex:1 1 10em;min-width:0}
.rpe-set-tablewrap{overflow-x:auto;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);min-width:0}
.rpe-set-table{border-collapse:separate;border-spacing:0;min-width:100%;font-size:var(--lre-fs-sm)}
.rpe-set-table th,.rpe-set-table td{padding:var(--lre-s1) var(--lre-s2);text-align:left;vertical-align:middle;border-bottom:1px solid var(--lre-hairline)}
.rpe-set-table thead th{font-weight:600;color:var(--lre-muted);white-space:nowrap}
.rpe-set-table tbody tr:last-child>*{border-bottom:0}
.rpe-set-table th[scope=row],.rpe-set-table thead th:first-child{position:sticky;left:0;z-index:1;min-width:7em;max-width:14em;background:var(--lre-card);overflow-wrap:anywhere}
.rpe-set-table th[scope=row]{font-weight:600}
.rpe-set-cell{display:inline-flex;align-items:center;gap:var(--lre-s1);width:100%;min-height:var(--lre-tap);padding:0 var(--lre-s2);border:1px solid transparent;border-radius:var(--lre-r);background:transparent;color:inherit;font:inherit;text-align:left;white-space:nowrap;cursor:pointer}
.rpe-set-cell:hover{background:var(--lre-hover)}
.rpe-set-cell[aria-pressed=true]{border-color:var(--lre-accent);background:var(--lre-accent-soft)}
.rpe-set-cell[data-changed]{font-weight:600}
.rpe-set-cell>.lre-dot{background:var(--lre-accent)}
.rpe-set-cellopen>.rpe-plain{border:1px solid color-mix(in srgb,var(--lre-accent) 35%,transparent);border-radius:var(--lre-r-xl);background:var(--lre-card)}
`;
