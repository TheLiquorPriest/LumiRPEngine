# data-src — raw default data tables

Raw, neutral JSON for the **Modern US** default data pack (design decision D26, `docs/DESIGN.md`). These are source tables, not the engine's schema: `scripts/tables/build.ts` (`bun run tables`) maps them into the pinned pack tables under `src/packs/<pack>/core/tables/modern-us/` (ARCHITECTURE §6), validating types, units, bands and references on the way; every source field must be consumed by a mapping or the build fails. Nothing here is imported by the extension build.

- **Region of the pack:** `us/` (United States).
- **Year the figures reflect:** about **2025–2026** (point-in-time, mid-2025 to early-2026 values).
- **Provenance:** compiled from well-known public statistics as the author knows them (BLS, EIA, Federal Reserve, IRS, FDIC, KFF, Tax Foundation, BEA, USDA, AAA and others), then rounded. Nothing was scraped or fetched live. Every file is marked `"approximate": true` and carries a `basis` string; treat the numbers as plausible defaults, not as authoritative statistics.

## Conventions (all files)

| Convention | Meaning |
|---|---|
| Money | **Integer US cents** (`*_cents`). Fuel is cents per gallon (so 315 = $3.15); EV charging is cents per kWh. The only decimal-cents field is `residential_electricity_cents_per_kwh` in `regions.json` (for example 14.5). |
| Percent | A number in percent units, never a fraction (`state_income_tax_effective_pct: 4.5` means 4.5%). Field names end in `_pct`. |
| Bands | `{ "min": n, "typical": n, "max": n }`, always with min ≤ typical ≤ max (validated). `typical` is the central national value; `max` is an ordinary high end, not luxury or surge extremes. |
| Weights / volumes | grams (`weight_g`), kilograms (`max_load_kg`, `payload_kg`), liters (`volume_l`, `capacity_l`, `cargo_l`). |
| Vehicle consumption | `mpg`, `mi_per_kwh`, or `gal_per_hour` (marine and off-road); tank in US gallons (liters also given). |
| IDs | Lower-snake or lower-case stable keys, unique within a file. |
| Header | Every file has `schema`, `table`, `approximate`, `country`, `currency`, `money_unit`, `reflects_period`, `basis`, `fields` (inline field docs) and the data. |
| US baseline | Where a multiplier is used, the national average is 1.00. |

## Files (`us/`)

| File | Entries | Contents |
|---|---|---|
| `regions.json` | 51 | 50 states + DC |
| `occupations.json` | 56 | occupations in 12 categories |
| `prices.json` | 340 items in 19 categories | price bands |
| `vehicles.json` | 19 | 12 road, 4 marine, 3 off-road classes |
| `gear.json` | 90 items, 34 containers, 5 kits (+ 20 equip slots) | carried and household gear |
| `finance.json` | 7 sections | macro, credit card, deposit accounts, loans, investing, payroll deductions, federal tax |
| `calendar.json` | 11 federal holidays, 30 observances, 24 shift patterns | rules, not dates |

### `regions.json`

`entries[]` fields: `id`, `abbr`, `name`; `census_region` (Northeast | Midwest | South | West), `census_division`; `time_zones` (IANA ids, primary first), `observes_dst`; `state_income_tax_effective_pct` (flat effective state rate on gross wages for a single filer at about $60,000, rounded 0.1; 0.0 where there is no wage tax); `local_income_tax_pct_typical` (extra local/county income tax, 0.0 if rare); `sales_tax_combined_avg_pct` (state plus average local, Tax Foundation 2025); `cost_of_living_multiplier` (US = 1.00; BEA regional price parities, smoothed); `median_rent_1br_cents_per_month`, `median_rent_2br_cents_per_month`; `residential_electricity_cents_per_kwh` (EIA, decimal cents); `minimum_wage_cents_per_hour` (effective 2025 floor, higher of state and the $7.25 federal rate); optional `notes` (zone splits, excluded taxes). `us_reference` holds the national values (rent $1,350/$1,650, 17 cents/kWh, 7.0% sales tax).

Basis: state brackets for 2025 (state revenue departments, Tax Foundation); rent is a blend of Zumper, Apartment List and HUD FY2025 Fair Market Rent patterns, **2BR is derived from 1BR** by a regional ratio (1.22 / 1.27 / 1.27 / 1.24 for Northeast / Midwest / South / West, DC uses South) and rounded to $10. The engine adds `state_income_tax_effective_pct` (and optionally the local rate) to the federal-plus-FICA rate from `occupations.json`.

### `occupations.json`

`entries[]` fields: `id`, `title`, `category` (service, retail, personal_service, trades, healthcare, office, tech, education, public_safety, transport, gig, student); `median_hourly_cents`, `median_annual_cents` (full-time-year-round equivalent), `typical_annual_earnings_cents` (hours × weeks as actually worked, or the salary); `schedule` (`pattern` = id in `calendar.json` `work_shift_patterns`, `typical_hours_per_week`, `weeks_per_year`, `weekend_work`, `shifts` ⊂ {day, evening, night}); `pay_frequency` (weekly | biweekly | semimonthly | monthly | weekly_gig | per_job | none); `benefits` (full | partial | none) with `benefits_note`; `withholding_rate_pct`; flags `tipped`, `self_employed`, `fica_exempt`; for contractors `estimated_tax_set_aside_pct` and `withholding_note`.

Basis: BLS OEWS May 2024 national medians as recalled (rounded); gig, intern and student rows are estimates from platform and survey reports (gig pay is gross before vehicle costs). **`withholding_rate_pct` is computed**, not looked up: federal income tax on `typical_annual_earnings_cents` for a single filer with the 2025 standard deduction ($15,750) and 2025 brackets, plus employee FICA (6.2% to the wage base, 1.45% Medicare); no state/local tax, credits or pre-tax deductions. Contractors have 0.0 withheld; campus-job students are FICA-exempt. Top-level `federal_minimum_wage_cents_per_hour` = 725 and `federal_tipped_cash_wage_cents_per_hour` = 213.

### `prices.json`

`categories[]` → `items[]` with `id`, `name`, `unit` (per gallon, night, month, person, and so on) and `price_cents { min, typical, max }`, optional `notes`. Categories: groceries (per-item staples), groceries (weekly baskets, USDA food-plan style), meals out, coffee, alcohol, clothing, electronics, tools and hardware, household goods, personal care, medical, entertainment, transport (public and for-hire, including bus fare, rideshare base/mile/minute, taxi, flights per segment, trains), fuel and charging (regular, midgrade, premium, diesel, E85, marine gasoline and diesel, EV home/L2/DC fast per kWh), vehicle services (oil change, tires, brakes, inspection, car wash, tow), lodging, utilities (monthly), subscriptions, gifts. Prices exclude sales tax and tip unless the name says otherwise. Scale with `regions.cost_of_living_multiplier` (rents move more than goods).

Basis: BLS CPI average prices, USDA, EIA, AAA, STR, DOT, KFF, Healthcare Bluebook / FAIR Health and published retail list prices, rounded. The medical "billed / uninsured" rows are chargemaster-style amounts; insured patients pay copays and deductibles (see `finance.json`).

### `vehicles.json`

`entries[]` fields: `id`, `name`, `domain` (road | marine | offroad), `fuel_type` (gasoline | diesel | electricity), `tank_capacity_gal`/`tank_capacity_l` or `battery_capacity_kwh_usable`, `consumption` (`mpg` city/highway/combined; `mi_per_kwh` for EVs; `gal_per_hour` idle/cruise/wide-open for marine and off-road), range, `price_new_cents` and `price_used_cents` bands, `insurance_cents_per_month { liability_only, full_coverage }`, `maintenance` (oil, tire, brake and service intervals in miles or hours plus `annual_maintenance_cents_typical`), `registration_cents_per_year` band, `passengers`, `cargo_l`, `payload_kg`, `towing_kg`, `consumption_factors_ref`. `consumption_factor_guides.{road,marine,offroad}` give terrain/load multipliers (>1 burns more) for stop-and-go, hills, towing, cold, chop, mud and so on. Marine entries add `slip_or_storage_cents_per_month`. Road: compact car, midsize sedan, mid-size and full-size pickup, heavy-duty diesel pickup, compact SUV, three-row SUV, minivan, two EVs, motorcycle, scooter. Marine: bass boat (outboard), pontoon, jet ski, sailboat with auxiliary diesel. Off-road: ATV, UTV, dirt bike.

Basis: representative models' MSRP and used-market bands (Edmunds, KBB), EPA fueleconomy.gov, manufacturer spec sheets, Bankrate/Insurify 2025 insurance averages (EVs +15–25%; boats ≈1.5% of value per year), state DMV fee ranges (registration varies enormously).

### `gear.json`

- `equip_slots[]`: slot ids (`head`, `face`, `neck`, `torso_base`, `torso_mid`, `torso_outer`, `full_body`, `hands`, `wrist`, `waist`, `legs`, `underwear`, `socks`, `feet`, `back`, `shoulder`, `hand_held`, `pocket`, `pocket_or_bag`, `none`).
- `items[]` (90): `id`, `name`, `category` (carried, household, tool, clothing, recreation), `equip_slot`, `weight_g` (empty/dry), `volume_l`, `price_cents` band, `notes`.
- `containers[]` (34): `capacity_l`, `max_load_kg`, `empty_weight_g`, `location` (carried | worn | furniture | vehicle_fixed), `equip_slot`, price. Includes wallet, purse, daypack/hiking pack, duffel, suitcases, toolbox, glovebox, vehicle trunks/beds and boat lockers.
- `kits[]` (5): `piece_count`, `pieces_total_weight_g`, `packed_volume_l`, price band, `recommended_container_id` and `pieces[] { name, qty, weight_g_each }`. **`mechanic_toolbox_45` has exactly 45 pieces** (invariant: sum of qty = 45; the box is separate). Also first-aid, camping, fishing tackle (rod/reel is a separate item) and basic sewing kits.

Basis: typical product weights from spec sheets; prices consistent with `prices.json`.

### `finance.json`

Sections: `macro` (Fed funds, prime, CPI, Treasury yields), `credit_card` (APR range, minimum-payment formula with issuer variants and a default, late/returned-payment/cash-advance/foreign fees, grace period, annual fee, credit-score bands), `deposit_accounts` (savings APY regular vs high-yield, money market, CD, checking fees including overdraft and ATM), `loans` (auto new/used by credit tier, mortgage 30/15-year with down payment, PMI, closing costs, tax and insurance, personal loan, federal student loans, payday, BNPL), `investing` (broad-index annual return **11.0% arithmetic / 9.8% geometric, 16.0% volatility** with monthly/daily equivalents and a GBM recipe for seeded price paths; bonds, cash, home appreciation; retirement-account limits), `payroll_deductions_other_than_tax` (health premium ranges for single/family, deductible and out-of-pocket maximums, dental/vision, **401(k) default 3% and typical employee deferral 7.7% with employer match**, FSA/HSA, union dues, garnishment limits), `taxes_federal` (2025 brackets for single and married-filing-jointly in cents, standard deduction, FICA parameters, child tax credit, EITC, capital-gains bands, IRS mileage rate).

Basis: Fed G.19/H.15, FDIC, Freddie Mac PMMS, Bankrate/Edmunds, CFPB, KFF 2025, Vanguard HAS 2025, IRS 2025/2026 announcements (2026 401(k) $24,500 and IRA $7,500 values are as announced in late 2025). Rates float; the table is a snapshot.

### `calendar.json`

`federal_holidays[]` (11) with a `rule` object (`fixed` month/day, or `nth_weekday` with `n = -1` for last) and `private_sector_paid_day_off` (widely | some | few); `common_observances[]` (30; fixed, nth-weekday, relative-to-another-holiday, Easter-relative, computed, lunar or window rules); `daylight_saving_time` (second Sunday of March 02:00 → first Sunday of November 02:00; Arizona except the Navajo Nation, Hawaii and territories excluded; standard offsets); `daylight_hours_geometric` (day length by latitude at solstices and equinox, computed without refraction); `school_year.k12` (about 180 instructional days, start/end windows by region, daily hours, breaks, summer length) and `school_year.college` (semester and quarter systems with start/end/break windows, course load); `work` (40-hour week, FLSA overtime, typical PTO and paid holidays); `work_shift_patterns[]` (24; ids referenced by `occupations.json`) with days per week, typical start, shift length, weekly hours and weekend work. Rules only — no dated instances.

## Known weak spots

- **Rents** are state-level medians blended from asking-rent and HUD patterns, with 2BR derived from 1BR; metro-level spread is large and not modeled.
- **State effective income tax** is a single-filer $60k approximation without credits, local taxes or payroll levies (CA SDI and similar are excluded).
- **Prices** are national averages; eggs, fuel, beef and insurance moved sharply in 2025, so `typical` is a mid-range blend.
- **Gig, intern and student wages** are survey-style estimates, not BLS medians.
- **Boat, ATV and off-road** costs rely on dealer/manufacturer pricing, not large public surveys.
- **Calendar start/end windows** for schools are typical windows, not a calendar for any district.

## Validation

All files parse as JSON; every price band is ordered; `mechanic_toolbox_45` sums to 45; occupation `schedule.pattern` ids resolve to `calendar.json` `work_shift_patterns`; kit `recommended_container_id` and item `equip_slot` ids resolve inside `gear.json`.
