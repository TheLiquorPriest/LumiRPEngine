// The pages' styles: today's design tokens and atoms (`src/frontend/styles/`), which follow Lumiverse's
// theme inside its drawer and fall back to their own dark values in the web shell, then the new pages'
// own rules, all under `rpe-`. Two width rules decide the web shell's navigation (frame.tsx's bars): below
// 1280 px, where the bar across the top cannot hold every page, it keeps the pages used most and More; at
// 640 px and below it gives way to the bar at the bottom. The drawer always has its own.

import { COMPONENTS_CSS } from "../frontend/styles/components";
import { TOKENS_CSS } from "../frontend/styles/tokens";

const OWN_CSS = `
.rpe{min-width:0}
.rpe-line{margin:0;overflow-wrap:anywhere}
.rpe-page{gap:var(--lre-s3)}
.rpe-meta{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.rpe-caption{font-size:var(--lre-fs-xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--lre-muted)}
.rpe-stats{display:flex;flex-wrap:wrap;gap:var(--lre-s1) var(--lre-s3);font-size:var(--lre-fs-sm);color:var(--lre-muted)}
.rpe-notices:empty{display:none}
.rpe-road{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2);font-size:var(--lre-fs-sm);color:var(--lre-muted);min-width:0}
.rpe-road .lre-disclosure>summary{min-height:28px}
.rpe-runhead{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.rpe-runhead-title{font-size:var(--lre-fs-lg);overflow-wrap:anywhere}
.rpe-pre{margin:0;padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r-sm);background:var(--lre-well);font:var(--lre-fs-sm)/1.5 var(--lre-mono);white-space:pre-wrap;overflow-wrap:anywhere;max-height:min(60vh,520px);overflow:auto;overscroll-behavior:contain}
.rpe-pre.prose{font:var(--lre-fs-md)/1.55 var(--lre-font)}
.rpe-stream::after{content:"";display:inline-block;width:.5em;height:1em;margin-left:2px;vertical-align:text-bottom;background:var(--lre-accent);animation:rpe-caret 1s steps(2,start) infinite}
@keyframes rpe-caret{to{visibility:hidden}}
.rpe-progress,.rpe-reports{margin:0;padding-left:1.2em;font-size:var(--lre-fs-sm);overflow-wrap:anywhere}
.rpe-progress{color:var(--lre-muted)}
.rpe-files{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.rpe-files>li{display:inline-flex;align-items:center;gap:var(--lre-s1);min-width:0;max-width:100%}
.rpe-files .lre-btn{max-width:100%;overflow-wrap:anywhere;text-align:left;height:auto}
.rpe-point{display:flex;align-items:flex-end;gap:var(--lre-s2);min-width:0}
.rpe-point>.lre-field{flex:1}
.rpe-wrap{flex-wrap:wrap}
.rpe-note{font-style:italic}
.rpe-fact{padding-left:var(--lre-s3);font-size:var(--lre-fs-sm)}
.rpe-plain{list-style:none;margin:0;padding:0}
.rpe-gatebar{padding:0 var(--lre-s1)}
.rpe-tree{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.rpe-agent{border:1px solid var(--lre-hairline);border-radius:var(--lre-r-lg);background:var(--lre-surface);min-width:0}
.rpe-agent>summary{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-height:var(--lre-tap);padding:var(--lre-s2) var(--lre-s3);cursor:pointer;list-style:none}
.rpe-agent>summary::-webkit-details-marker{display:none}
.rpe-agent>summary:focus-visible{outline-offset:-2px}
.rpe-agent-name{font-weight:600;overflow-wrap:anywhere}
.rpe-agent-body{display:flex;flex-direction:column;gap:var(--lre-s2);padding:0 var(--lre-s3) var(--lre-s3);min-width:0}
.rpe-steps{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
.rpe-step{border-top:1px solid var(--lre-hairline);padding-top:var(--lre-s2);min-width:0}
.rpe-step-head{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s1) var(--lre-s2);min-width:0}
.rpe-step-head>.lre-icon{color:var(--lre-muted)}
.rpe-step-title{font-weight:600;overflow-wrap:anywhere}
.rpe-children{display:flex;flex-direction:column;gap:var(--lre-s2);margin-top:var(--lre-s1);padding-left:var(--lre-s2);border-left:2px solid var(--lre-accent-soft);min-width:0}
.rpe-todo{list-style:none;margin:0;padding:var(--lre-s2) var(--lre-s3);border-radius:var(--lre-r);background:var(--lre-well);display:flex;flex-direction:column;gap:2px;font-size:var(--lre-fs-sm)}
.rpe-todo li{display:flex;gap:var(--lre-s2);align-items:flex-start;overflow-wrap:anywhere}
.rpe-todo li>.lre-icon{margin-top:2px}
.rpe-todo li[data-done=true]{color:var(--lre-muted);text-decoration:line-through}
.rpe-written{max-height:min(60vh,520px);overflow:auto;overscroll-behavior:contain}
.rpe-signin{width:100%;max-width:440px;margin:var(--lre-s5) auto}
.rpe-file .lre-btn{max-width:100%;overflow-wrap:anywhere;text-align:left;height:auto}
.rpe-open{padding:var(--lre-s2) 0 var(--lre-s2) var(--lre-s3);border-left:2px solid var(--lre-accent-soft);min-width:0}
.rpe-editor{min-height:min(50vh,420px)}
.rpe-diff-added{color:var(--lre-pos)}
.rpe-diff-removed{color:var(--lre-neg)}
.rpe-strong{font-weight:600}
.rpe-suggestion{border-top:1px solid var(--lre-hairline);padding-top:var(--lre-s3);min-width:0}
.rpe-suggestion:first-child{border-top:0;padding-top:0}
.rpe-migrated{border-top:1px solid var(--lre-hairline);padding-top:var(--lre-s2);min-width:0}
.rpe-migrated:first-child{border-top:0;padding-top:0}
.rpe-hash{font-size:var(--lre-fs-xs);overflow-wrap:anywhere;word-break:break-all}

.rpe-web{min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;background:var(--lre-surface)}
.rpe-web-top{position:sticky;top:0;z-index:6;display:flex;align-items:center;gap:var(--lre-s2) var(--lre-s3);padding:calc(var(--lre-s2) + env(safe-area-inset-top,0px)) var(--lre-s4) var(--lre-s2);background:var(--lre-bar-bg);border-bottom:1px solid var(--lre-hairline);min-width:0}
.rpe-web-brand{flex:none;font-weight:700;font-size:var(--lre-fs-lg);letter-spacing:.02em}
.rpe-web-nav{position:relative;display:flex;gap:var(--lre-s1)}
.rpe-web-nav>button{display:inline-flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap);padding:0 var(--lre-s3);border:0;border-radius:var(--lre-r-lg);background:transparent;color:var(--lre-muted);font-weight:500;transition:background-color var(--lre-fast),color var(--lre-fast)}
.rpe-web-nav>button:hover:not(:disabled){background:var(--lre-hover);color:var(--lre-fg)}
.rpe-web-nav>button[aria-current=page]{background:var(--lre-accent-soft);color:var(--lre-accent-text);font-weight:600}
.rpe-web-chat{flex:1;min-width:0;text-align:right;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rpe-web-main{flex:1;width:100%;max-width:1040px;margin:0 auto;padding:var(--lre-s4);display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.rpe-web-nav>button.rpe-more{display:none}
.rpe-web-bottom{display:none}
@media (max-width:1279px){
.rpe-web-nav>button{padding:0 var(--lre-s2)}
.rpe-web-nav>button.rpe-spare{display:none}
.rpe-web-nav>button.rpe-more{display:inline-flex}
}
@media (max-width:640px){
.rpe-web-top{padding-left:var(--lre-s3);padding-right:var(--lre-s3)}
.rpe-web-nav{display:none}
.rpe-web-main{padding:var(--lre-s3) var(--lre-s3) calc(72px + env(safe-area-inset-bottom,0px))}
.rpe .rpe-web-bottom{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:6}
}

.rpe-drawer{display:flex;flex-direction:column;gap:var(--lre-s3);padding-bottom:var(--lre-s4);min-width:0}
.rpe-drawer-bar{display:flex;flex-direction:column;gap:var(--lre-s1);padding:var(--lre-s1) 0 0}
.rpe-drawer-nav{position:relative;z-index:20;min-width:0}
.rpe-drawer-nav .lre-tabs>button[aria-current=page]{background:var(--lre-accent-soft);color:var(--lre-accent-text);border-color:color-mix(in srgb,var(--lre-accent) 35%,transparent);font-weight:600}

.rpe-more-away{position:fixed;inset:0;z-index:-1}
.rpe-more-list{position:absolute;right:0;top:calc(100% + var(--lre-s1));z-index:1;display:flex;flex-direction:column;min-width:200px;max-width:calc(100vw - 2 * var(--lre-s2));padding:var(--lre-s1);border:1px solid var(--lre-border);border-radius:var(--lre-r-lg);background:var(--lre-bar-bg);box-shadow:var(--lre-shadow-lg)}
.rpe-web-bottom>.rpe-more-list{top:auto;right:var(--lre-s1);bottom:calc(100% + var(--lre-s1))}
.rpe-more-list>button{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap-lg);padding:0 var(--lre-s3);border:0;border-radius:var(--lre-r);background:transparent;color:inherit;font-weight:500;text-align:left;transition:background-color var(--lre-fast)}
.rpe-more-list>button:hover:not(:disabled){background:var(--lre-hover)}
.rpe-more-list>button[aria-current=page]{background:var(--lre-accent-soft);color:var(--lre-accent-text);font-weight:600}
`;

export const UI_CSS = [TOKENS_CSS, COMPONENTS_CSS, OWN_CSS].join("\n");
