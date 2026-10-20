// The money hub (economy pack): Play → Me → Money and GM → Money, their section and detail pages,
// the action forms and Now's money glance. Built on the tokens only.

export const PACKS_MONEY_CSS = `
/* Money in Build (economy/ui/config.tsx, field-editors.tsx): living costs in a grid, the feature and sales tax switches pages, a place's cash machine and branch */
.lre .lre-money-build-bands{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,13rem),1fr));gap:var(--lre-s3);min-width:0}
.lre .lre-money-build-feature{display:flex;flex-wrap:wrap;align-items:center;gap:var(--lre-s2) var(--lre-s3);min-width:0;padding:var(--lre-s2) var(--lre-s3)}
.lre .lre-money-build-feature+.lre-money-build-feature{border-top:1px solid var(--lre-hairline)}
.lre .lre-money-build-feature-text{flex:1 1 12rem;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre .lre-money-build-feature-name{font-weight:500;overflow-wrap:anywhere}
.lre .lre-money-build-feature-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre .lre-money-build-feature>.lre-seg{flex:1 1 14rem;max-width:22rem}
.lre .lre-money-build-feature>.lre-seg>button[aria-pressed=true]:first-child{background:var(--lre-neutral-soft);color:var(--lre-fg)}
.lre .lre-money-build-done{justify-content:flex-end}
.lre .lre-money-build-absent{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--lre-s2) var(--lre-s3);min-width:0}
.lre .lre-money-build-absent-text{flex:1 1 10rem;min-width:0;color:var(--lre-muted);overflow-wrap:anywhere}
.lre .lre-money-build-place{gap:var(--lre-s3)}
.lre .lre-money-build-place-actions{display:flex;flex-wrap:wrap;gap:var(--lre-s2)}
/* The money hub's sections: flows, jobs, businesses, investments, properties, credit and household (economy/ui/flows.tsx, work.tsx, assets.tsx, credit.tsx): a lead amount in words (worked out each time) at a reading size */
.lre .lre-money-hero .lre-money-hero-words{font-size:var(--lre-fs-lg);line-height:1.3;letter-spacing:0}
/* An amount in words in a row's value (what's coming up that's worked out each time) reads as a note beside the figures */
.lre .lre-money-row-words{font-size:var(--lre-fs-sm);font-weight:400;line-height:1.3;color:var(--lre-muted)}
/* The money hub (economy/ui/hub.tsx, panel.tsx, gm.tsx, sheet.tsx), its page frame and shared pieces (nav.tsx, forms.tsx, lines.tsx), accounts and cards (accounts.tsx), payment tiers (pay-prefs.tsx) and Now's glance */
.lre .lre-money-root,.lre .lre-money-hub,.lre .lre-money-page,.lre .lre-money-page-body,.lre .lre-money-level,.lre .lre-money-form{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre .lre-money-hero{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0;padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card)}
/* A figure stays whole (it breaks only where it can't fit the card at all), so the badges beside it wrap under it instead */
.lre .lre-money-hero-main{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:var(--lre-s3);min-width:0}
.lre .lre-money-hero-main>.lre-stat{flex:1 1 auto}
.lre .lre-money-hero .lre-money-hero-main .lre-stat-value{font-size:calc(var(--lre-fs-xl) * 1.5);line-height:1.15;letter-spacing:-.01em;overflow-wrap:break-word}
.lre .lre-money-hero-badges{flex:none;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:var(--lre-s1);max-width:50%}
.lre .lre-money-top>.lre-money-hero-badges{max-width:none;justify-content:flex-start}
/* Cash on hand, assets and what's owed flow two or three to a line as the card allows, each figure whole */
.lre .lre-money-stats{display:flex;flex-wrap:wrap;gap:var(--lre-s3);padding-top:var(--lre-s3);border-top:1px solid var(--lre-hairline)}
.lre .lre-money-stats>.lre-stat{flex:1 1 7rem;min-width:auto}
.lre .lre-money-stats .lre-stat-value{font-size:var(--lre-fs-lg);overflow-wrap:break-word}
.lre .lre-money-controls{display:flex;flex-wrap:wrap;gap:var(--lre-s2);min-width:0;container:lre-money-controls/inline-size}
.lre .lre-money-controls>.lre-btn{flex:1 1 9rem;min-width:fit-content}
@container lre-money-controls (min-width:560px){.lre .lre-money-controls>.lre-btn{flex:0 1 auto;min-width:11rem}}
.lre .lre-money-note{margin:0;font-size:var(--lre-fs-md);line-height:1.45;overflow-wrap:anywhere}
.lre .lre-money-problem{margin:0;font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre .lre-money-form>.lre-btn[type=submit]{margin-top:var(--lre-s1)}
.lre .lre-money-choices{margin:0;padding:0;border:0;min-width:0;display:flex;flex-direction:column;gap:var(--lre-s1)}
.lre .lre-money-choices-label{padding:0;font-size:var(--lre-fs-sm);font-weight:500;color:var(--lre-muted)}
.lre .lre-money-choice-list{display:flex;flex-direction:column;min-width:0;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-lg);background:var(--lre-card);overflow:hidden}
.lre .lre-money-choice{display:flex;align-items:center;gap:var(--lre-s3);min-height:var(--lre-tap-lg);padding:var(--lre-s2) var(--lre-s3);cursor:pointer;transition:background-color var(--lre-fast)}
.lre .lre-money-choice+.lre-money-choice{border-top:1px solid var(--lre-hairline)}
.lre .lre-money-choice:hover{background:var(--lre-hover)}
.lre .lre-money-choice:has(input:checked){background:var(--lre-accent-soft)}
.lre .lre-money-choice:has(input:focus-visible){outline:2px solid var(--lre-accent);outline-offset:-2px}
.lre .lre-money-choice>input{flex:none;width:20px;height:20px;margin:0;accent-color:var(--lre-accent);cursor:pointer}
.lre .lre-money-choice>input:focus-visible{outline:none}
.lre .lre-money-choices:disabled .lre-money-choice{opacity:.6;cursor:default}
.lre .lre-money-choice-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre .lre-money-choice-label{font-weight:500;overflow-wrap:anywhere}
.lre .lre-money-choice-detail{font-size:var(--lre-fs-sm);color:var(--lre-muted);font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.lre .lre-money-toggle{display:flex;align-items:center;gap:var(--lre-s3);min-height:var(--lre-tap);cursor:pointer}
.lre .lre-money-toggle-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-weight:500;overflow-wrap:anywhere}
.lre .lre-money-lines{min-width:0}
.lre .lre-money-more{padding:var(--lre-s1) var(--lre-s2) var(--lre-s2);border-top:1px solid var(--lre-hairline)}
.lre .lre-money-rank{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--lre-neutral-soft);color:var(--lre-fg);font-size:var(--lre-fs-xs);font-weight:600;font-variant-numeric:tabular-nums}
.lre .lre-money-tiers{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0}
.lre .lre-money-tiers>.lre-btn{align-self:flex-start}
.lre .lre-money-tier{display:flex;flex-direction:column;gap:var(--lre-s3);min-width:0;padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card)}
.lre .lre-money-tier-head{display:flex;align-items:center;gap:2px;min-width:0;margin:calc(-1 * var(--lre-s2)) calc(-1 * var(--lre-s2)) calc(-1 * var(--lre-s1)) 0}
.lre .lre-money-tier-title{flex:1;min-width:0;font-weight:600}
.lre .lre-money-tier-range{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,9rem),1fr));gap:var(--lre-s3);min-width:0}
.lre .lre-money-whose{display:flex;flex-direction:column;gap:var(--lre-s2);min-width:0}
`;
