// "Me" packs (S3a): You, Money, Gear and Garage panels, their glances, and the item and account
// sheets. Built on the tokens only (contract §5); cards are flat with a hairline, rows are 44 px
// tall at least, and nested contents indent under a hairline rule.

export const PACKS_ME_CSS = `
.lre-me-hero{display:flex;align-items:center;gap:var(--lre-s3);padding:var(--lre-s3);border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);min-width:0}
.lre-me-hero-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-me-hero-name{margin:0;font-size:var(--lre-fs-lg);font-weight:600;line-height:1.3;overflow-wrap:anywhere}
.lre-me-hero-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-me-stats{display:flex;flex-direction:column;min-width:0}
.lre-me-stat{display:flex;align-items:center;gap:var(--lre-s2);min-height:var(--lre-tap-lg);padding:var(--lre-s2) var(--lre-s1) var(--lre-s2) var(--lre-s3);min-width:0}
.lre-me-stat+.lre-me-stat{border-top:1px solid var(--lre-hairline)}
.lre-me-stat.fixing{display:block;padding:var(--lre-s2) var(--lre-s3)}
.lre-me-stat-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--lre-s1)}
.lre-me-stat-line{display:flex;align-items:baseline;justify-content:space-between;gap:var(--lre-s3);min-width:0}
.lre-me-stat-k{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-weight:500;overflow-wrap:anywhere}
.lre-me-stat-v{flex:0 1 auto;max-width:55%;font-weight:600;font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}
.lre-me-stat-sub{font-size:var(--lre-fs-sm);font-weight:400;color:var(--lre-muted);overflow-wrap:anywhere}
.lre-me-stat:not(:has(.lre-iconbtn)){padding-right:var(--lre-s3)}
.lre-me-stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr));gap:var(--lre-s3)}
.lre-me-badges{display:flex;flex-wrap:wrap;gap:var(--lre-s1);justify-content:flex-end;min-width:0}
.lre-me-pad{padding:var(--lre-s3)}
.lre-me-pad+.lre-rowlist{border-top:1px solid var(--lre-hairline)}
.lre-me-items{display:flex;flex-direction:column;min-width:0;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);overflow:hidden}
.lre-me-item{min-width:0}
.lre-me-items>.lre-me-item+.lre-me-item,.lre-me-tree>.lre-me-item+.lre-me-item{border-top:1px solid var(--lre-hairline)}
.lre-me-item-line{display:flex;align-items:center;gap:var(--lre-s1);min-height:var(--lre-tap-lg);padding:0 0 0 var(--lre-s1);min-width:0}
.lre-me-item-gap{flex:none;width:var(--lre-tap)}
.lre-me-item-open{flex:1;min-width:0;min-height:var(--lre-tap-lg);display:flex;align-items:center;gap:var(--lre-s2);padding:var(--lre-s2) var(--lre-s3) var(--lre-s2) 0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left;transition:background-color var(--lre-fast)}
.lre-me-item-open:hover{background:var(--lre-hover)}
.lre-me-item-open:focus-visible{outline-offset:-2px}
.lre-me-item-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.lre-me-item-name{font-weight:500;overflow-wrap:anywhere}
.lre-me-item-sub{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-me-chev{color:var(--lre-dim)}
.lre-me-item-extra{display:flex;flex-direction:column;gap:var(--lre-s2);padding:0 var(--lre-s3) var(--lre-s3) calc(var(--lre-s1) + var(--lre-tap) + var(--lre-s1))}
.lre-me-tree{display:flex;flex-direction:column;margin-left:calc(var(--lre-s1) + var(--lre-tap) / 2);border-left:1px solid var(--lre-hairline);border-top:1px solid var(--lre-hairline);min-width:0}
.lre-me-vehicle{display:flex;flex-direction:column;border:1px solid var(--lre-hairline);border-radius:var(--lre-r-xl);background:var(--lre-card);overflow:hidden;min-width:0}
.lre-me-vehicle-head{display:flex;align-items:center;gap:var(--lre-s3);padding:var(--lre-s3);min-width:0;flex-wrap:wrap}
.lre-me-vehicle-icon{flex:none;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--lre-neutral-soft);color:var(--lre-muted)}
.lre-me-vehicle-titles{flex:1;min-width:min(10em,100%);display:flex;flex-direction:column;gap:2px}
.lre-me-vehicle-name{margin:0;font-size:var(--lre-fs-md);font-weight:600;overflow-wrap:anywhere}
.lre-me-vehicle-kind{font-size:var(--lre-fs-sm);color:var(--lre-muted);overflow-wrap:anywhere}
.lre-me-vehicle-meters{display:flex;flex-direction:column;gap:var(--lre-s3);padding:0 var(--lre-s3) var(--lre-s3)}
.lre-me-vehicle>.lre-rowlist{border-top:1px solid var(--lre-hairline)}
`;
