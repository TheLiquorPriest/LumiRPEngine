// Design tokens and base rules (contract §5.1–5.2, §5.6–5.7) on the `.lre` and `.lre-chips` roots.
// Host theme variables with fallbacks, so the UI follows the host theme in light and dark. Text
// tokens mix the host status/muted colours toward the host text colour so they keep WCAG 4.5:1 on
// the host's light and dark surfaces; accent-filled controls use --lre-accent-fill. Earlier token
// names (--lre-fill, --lre-subtle, --lre-radius, --lre-danger…) keep working.

export const TOKENS_CSS = `
.lre,.lre-chips{
--lre-font:var(--lumiverse-font-family,system-ui,-apple-system,"Segoe UI",sans-serif);--lre-mono:var(--lumiverse-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);
--lre-fs-xs:calc(11px * var(--lumiverse-font-scale,1));--lre-fs-sm:calc(12px * var(--lumiverse-font-scale,1));--lre-fs-md:calc(14px * var(--lumiverse-font-scale,1));--lre-fs-lg:calc(16px * var(--lumiverse-font-scale,1));--lre-fs-xl:calc(20px * var(--lumiverse-font-scale,1));
--lre-fg:var(--lumiverse-text,#e8e8ea);--lre-muted:color-mix(in srgb,var(--lumiverse-text-muted,#a3a3ad) 85%,var(--lre-fg));--lre-dim:color-mix(in srgb,var(--lumiverse-text-dim,#7c7c86) 50%,var(--lre-fg));
--lre-surface:var(--lumiverse-bg,#17171c);--lre-card:var(--lumiverse-surface-raised,var(--lumiverse-bg-elevated,rgba(255,255,255,.04)));--lre-well:var(--lumiverse-fill,rgba(0,0,0,.15));--lre-hover:var(--lumiverse-fill-hover,rgba(127,127,127,.12));
--lre-border:var(--lumiverse-border,rgba(255,255,255,.12));--lre-hairline:var(--lumiverse-border-light,rgba(128,128,128,.12));
--lre-fill:var(--lre-well);--lre-subtle:var(--lumiverse-fill-subtle,rgba(255,255,255,.05));--lre-neutral-soft:color-mix(in srgb,var(--lre-fg) 10%,transparent);
--lre-bar-bg:linear-gradient(var(--lre-surface),var(--lre-surface)),var(--lumiverse-bg-deep,#121217);
--lre-accent:var(--lumiverse-primary,#7c6cff);--lre-accent-fg:var(--lumiverse-primary-contrast,#fff);--lre-accent-fill:var(--lre-accent);--lre-accent-soft:color-mix(in srgb,var(--lre-accent) 14%,transparent);--lre-accent-text:color-mix(in srgb,var(--lre-accent) 70%,var(--lre-fg));
--lre-danger:var(--lumiverse-danger,#ef4444);--lre-success:var(--lumiverse-success,#22c55e);--lre-warning:var(--lumiverse-warning,#f59e0b);
--lre-neg:color-mix(in srgb,var(--lre-danger) 55%,var(--lre-fg));--lre-pos:color-mix(in srgb,var(--lre-success) 35%,var(--lre-fg));--lre-warn:color-mix(in srgb,var(--lre-warning) 35%,var(--lre-fg));
--lre-neg-soft:color-mix(in srgb,var(--lre-danger) 12%,transparent);--lre-pos-soft:color-mix(in srgb,var(--lre-success) 12%,transparent);--lre-warn-soft:color-mix(in srgb,var(--lre-warning) 12%,transparent);
--lre-gm:color-mix(in srgb,var(--lumiverse-warning,#f59e0b) 70%,var(--lre-fg));--lre-gm-soft:color-mix(in srgb,var(--lumiverse-warning,#f59e0b) 12%,transparent);--lre-gm-text:color-mix(in srgb,var(--lre-gm) 60%,var(--lre-fg));
--lre-r-sm:var(--lumiverse-radius-sm,6px);--lre-r:var(--lumiverse-radius-md,10px);--lre-r-lg:var(--lumiverse-radius-lg,12px);--lre-r-xl:var(--lumiverse-radius-xl,16px);--lre-r-pill:999px;--lre-radius:var(--lre-r);
--lre-shadow-sm:var(--lumiverse-shadow-sm,0 2px 8px rgba(0,0,0,.2));--lre-shadow-lg:var(--lumiverse-shadow-md,0 8px 24px rgba(0,0,0,.4));
--lre-s1:4px;--lre-s2:8px;--lre-s3:12px;--lre-s4:16px;--lre-s5:24px;--lre-tap:40px;--lre-tap-lg:44px;
--lre-fast:var(--lumiverse-transition-fast,150ms ease);--lre-med:var(--lumiverse-transition,200ms ease);
--lre-series-1:var(--lumiverse-success,#22c55e);--lre-series-2:var(--lre-accent);--lre-series-3:var(--lumiverse-warning,#f59e0b);--lre-series-4:var(--lumiverse-danger,#ef4444);--lre-series-5:color-mix(in srgb,var(--lre-accent) 50%,var(--lumiverse-success,#22c55e));--lre-series-6:var(--lre-dim);
--lre-canvas-bg:var(--lre-well);--lre-canvas-ink:var(--lre-fg);--lre-canvas-muted:var(--lre-muted);--lre-canvas-line:var(--lre-border);--lre-canvas-pov:var(--lre-accent);--lre-canvas-fog:color-mix(in srgb,var(--lre-fg) 8%,transparent);--lre-canvas-item:var(--lumiverse-warning,#f59e0b);
overflow-wrap:break-word}
@supports (color:hsl(from red h s calc(100 - l))){.lre,.lre-chips{--lre-accent-fill:color-mix(in srgb,var(--lre-accent) 80%,hsl(from var(--lre-accent-fg) h s calc(100 - l)))}}
.lre{font:var(--lre-fs-md)/1.45 var(--lre-font);color:var(--lre-fg);box-sizing:border-box;min-width:0}
.lre *,.lre *::before,.lre *::after{box-sizing:border-box}
.lre [hidden]{display:none!important}
.lre button,.lre-chips button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.lre button:disabled,.lre-chips button:disabled{cursor:default;opacity:.5}
.lre :focus-visible,.lre-chips :focus-visible{outline:2px solid var(--lre-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.lre,.lre *,.lre *::before,.lre *::after,.lre-chips,.lre-chips *,.lre-chips *::before,.lre-chips *::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;
