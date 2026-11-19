// A chat's weight, from a read-only copy of RPE's database: what makes its folds and its state view heavy, in numbers. Safe to run on
// anyone's data: it prints numbers, and names that are the code's own, never a value, a text, an id or a key of the world or the chat.
//
//   bun build scripts/perf/shape.ts --target bun --external supports-color --outfile shape.js
//   bun shape.js <copy of rpe.db> <chat id> [build id the server folds under]
//
// What it prints, one JSON line each (sizes are characters of JSON):
// - `tables`: rows (and bytes, where SQLite can say) of the tables named in TABLES below; every other table summed as one.
// - `turns`: the chat's turns: how many, imported, of each kind and status in the fixed lists below; its path's entries and replies.
// - `changes by op`: per operation name, its count and the total and largest size of its values. An op is named only when this
//   build's code knows it (an event type of the packs, a store operation, an area's operation); every other one is summed as `other`.
// - `changes per turn`: how many turns hold 0, 1–9, 10–99, 100–999 and 1,000 or more changes; the largest, where it stands on the
//   path (a number), and its changes by op (named as above).
// - `imported records`, `snapshots`, `world revisions`: counts and sizes (total, median, largest).
// - `head state`, `world revision`, `state view`, `org page`: where the weight of each lies, a line per place: its path, how many
//   values stand there, their total, median and largest size. A path is made only of the words in NAMES below and the ids of this
//   build's packs, areas, panels, organisation sections, kinds, relation types and the fields its packs' kinds define (all read from
//   the code, never from the database); `*` for a key that is none of them, `[]` for an array's items. An object whose keys are not
//   all such words, that has more than MAP_KEYS of them, or that stands in MAPS, is a map: none of its keys is printed, and its
//   entries are counted under `*`. Entities by kind count only the kinds the packs define.
// Nothing else reaches the output: the console is silenced, and an error is printed by its class's name and the part it stopped.

import { Database } from "bun:sqlite";
import { createRegistry } from "../../src/engine/registry-impl";
import { historyTexts, installHistoryLines } from "../../src/iface/history-lines";
import { shippedTexts } from "../../src/iface/texts";
import { ALL_PACKS } from "../../src/packs/index";
import { journalNotes } from "../../src/play/journal";
import { chipsOf } from "../../src/play/panel-reads";
import { TAP_DEFAULTS } from "../../src/play/settings";
import { chatView, chatViewItem } from "../../src/play/view";
import { MAP_DEFAULTS } from "../../src/shared/map-config";
import { ORGS_ORG_PANEL, ORGS_SUMMARY_PANEL } from "../../src/shared/org-view";
import { openStore, STORE_OPS, storedWorlds } from "../../src/store";
import { STORE_AREAS } from "../../src/turn/store-areas";

const write = process.stdout.write.bind(process.stdout);
const say = (row: Record<string, unknown>): void => {
  write(`${JSON.stringify(row)}\n`);
};
for (const k of ["log", "info", "warn", "error", "debug", "trace"] as const) console[k] = () => undefined;
let part = "arguments";
const stopped = (error: unknown): void => {
  say({ part, stopped: error instanceof Error ? error.constructor.name : typeof error });
};
process.on("uncaughtException", (error) => {
  stopped(error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  stopped(error);
  process.exit(1);
});

const [file, chat, build] = process.argv.slice(2);
if (file === undefined || chat === undefined) {
  say({ stopped: "arguments", wants: "<copy of rpe.db> <chat id> [build id]" });
  process.exit(2);
}

/** The code's own words a path may be made of: the property names of the state's, the world's and the view's types. */
const NAMES = `
about above abstain accepted access account accountId accounts accrue acting action actions activated activation activity acts adb adjudicate
adjudication adjustments admit advantage advantageAt after against age ageMonths agent agentDefault agents ai alcohol alert alerts aliases alive
allowance ally also alsoStood alsoStruck always ammo amount amount_cents amount_due amount_formula amount_max amount_min amount_of amount_pct
amount_table anchor anchors annual annual_return_pct annual_volatility_pct answer answered applied applyCredit appoint appreciation_pct approach
approvalDays approval_days approvers apr apr_pct apy_pct archived areas args armful armoire armor as asOf asks asset assets assumed at atMost atOnce
atm audience authority authorized_user auto autopay autopayFrom autopay_cents autopay_from available average average_daily awareness away b back
badge balance band bandTiers bands bank base basis batch beat beats bed before begin belief belong belongs below belowHidden beneficiary
bidirectional birthday block blocked blocks bookcase books bound branchStopped branched breakdown brokerage budget built builtin business
business_checking business_days business_tax businesses buy buyers by byCategory byName byVolume calendar callsAtOnce can canChange canStart
candidates cap_rate_pct capex capitalLoss capital_gains capitalize captured card cardFreeze cardLost cardPaid cardReplace cardUnfreeze
card_replacement cardinality cards carried carriers carry cash cashFlow cash_advance cash_advance_apr_pct cash_advance_min cash_advance_pct cast
casting castings catalog categories category categoryId cause cd ceiling cell cellMeters cents chain chance change changed character characterId
characters charge_card chars chat chatId check checking checks children chips choices cite claim claimChars claimed claims class classLabel classes
classifications clock closeBy closed closes closesText closing clothing code coffee cogs collects_sales_tax colour combat commission_pct commitment
commitmentEdit commitments companies companion company condition confidence config consent consolidate consolidated consolidation containers content
contents continueHead contractor controlled controls convert cooldownMinutes copies core correction corrections correlation cost costs count
counterparty coupon_pct cover created credit credit_card crew cue cues currency current custodian custom customer cut cycles d20 dailyAtmLimit
dailyPurchaseLimit daily_atm_limit daily_limits daily_purchase_limit data date day dayOff dayPart dayParts days days_late dc dead debts decide
decidePct decidedBy decimals decision decisions decline deductible deductions deductions_pct defHash default defaultPosition defaultTick deferred
definitionsFrom delay delegate delegation delegations deleted delinquency delist delta departures depiction depletion deposit depositRank deposits
depreciate depreciated depreciation depth derived description desk detail details di_pct diag diagonal dice digestedTo dir direction disabled
discount_pct dishwasher display dissolved distanceKm distances distribute distributed distribution distribution_every distribution_pct dividends do
domain domains donate donations done donorLimitPct door doorTerrains doors doubted down draft draftVersion drafts draw dresser drive drop dropped
dryer due due_day due_days dues duration durations dying earner earns ebitda ebitdaNote economy edit editable edited edits effects elapsed elected
electorate electronics elsewhere employees employer employerId employerShare enabled encounter end endTurn ended engine engineVersion engine_hours
entertainment entities entity entries entry ep epoch equity escrow estimated events every evidence evidenceShown example except excisePct excise_tax
exempt exemptHolders exercise exists expect expires expiry exposure extends extra face fact factor factorMax factorMin factors facts factsPerChat
factsPerTurn fail fair fallback fallbacks far farRefreshMinutes fatigue features fee fee_income fees fetch fetchMinutes fidelity field fields figure
filedBy files filled finalEdits finalParts financing fire fix fixed fixes fixtures flag flags flipped float floor floors flow flowCreate flowDelete
flowPause flowRenamed flowResume flowRun flowUpdate flow_kind flows flushed follow followRoutine follows for forSale forget format formula found
foundation freezer fridge from fuel_pct full fun furniture futa futaPaid gain game gas_royalty gate gear generation generationId generations
generatorVersion generators gifts given gm gmIntent gmKey goal goals goes gone got governance grace granted grants gregorian grid grids
groceries_baskets groceries_staples gross grossPerPeriod grossProfit group growth growth_pct guests halfLifeDays hand handle harness hash head heads
heavy height held heldAgain here hidden hiddenCarriers hint hints hire hired history hold hold_days holder holderId holders holdersPerFact holding
holdings holds holidays home home_furnishings horizon horizon_months host hostName hours hours_per_week household household_goods households how hows
hp hud hunger id ids implied imported impossibleAt in inForce inLabel inPlay inPlayTurns include income incomeSoFar index industry inferred inherit
initiative input inputs inquiries inserted inside installment institution insurance intent intents interest interrupt interrupts interval inverse
investing investment investmentIncome investments invitations invite invoice invoiceIssue invoicePay invoiceVoid invoice_days invoices is isUser
issued item items job jobs joined joinsIn joint journal keep keepReport keeps kept keptFrom keptFromNames key keys keysSet kind kindLabel kinds
knowledge known knownBy knows label lag_months lane last last4 lastPay lastPresent lastShortfall late late30 late60 late90 late_fee late_fee_pct
late_first late_repeat lates layout layoutPos lead leader lean learn learned learningsPerTurn leaseEnd leaseStart leases leave ledger left leftOfLast
legend legs len lend lending length lengths lenientPricing lent letGo level levelField levels lexicon liabilities liability life lifeKnownBy
lifeStates light limit limited limits line_of_credit lines link links lint list listed listing live liveLimit lived living_costs loan location locked
log lookups lore loreBookId loreBooks loreIndex lorePins lots lre made maintenance maintenance_waive make manage managed manages map mapSettings maps
margin margin_pct margins mark marker markers markersApplied market marketCap marks match_pct materialized matters maturity max maxDelta maxLevel
maxLines maxTokens may mayAnswer mayDraw mayEdit mayGive mayStatus mayWithdraw meals_out mechanical medical memberOf members memo memories memory
memoryLevels memoryNext mention mentioned merge mergedInto message messageId messages meter method min minLevels min_floor min_pct mind mindTokens
minds mine minimum minorUnit minutes missed mix mode model modes modifier modifiers moment money money_market monologue montage month monthly months
months_left mood more mortgage mortgageTerms motion_days motions ms msg multiple multiplier n name named names narrated narrator narratorTokens
natural near nearRefresh nearby need needs needsYou net netIncome netWorth network never new next nextPay no_dues node nol nonprofit normalize
notApplied notCarried notWithYou note noteDays noteEdit notes now nowText nsf number objective objectives observable occupation occurrences odds
odometer_mi of off offTurn offer offers offstage oil_royalty older on onLevel onTimePct once ontime op open opened opening openings opens operating
operatingIncome operating_account opex option optional options ord order orders ordersDone org orgs origin other other_income out outcome outcomes
outfit outline output outside over overdraft overdraft_limit overdraft_link overdraw overlap overview owed own ownKeys owner owners p p95 pack packs
page paid palette paletteFollowsRoutine panel panels params parent parentPath parents park parkMinutes part parties parts party partyKind pass
pass_pct passed passive passivePct past past_due path pause paused pauses pay payCard payEvery payPrefs pay_anchor pay_days pay_every pay_except
pay_from pay_interval pay_months pay_roll pay_unit pay_weekday pay_weekdays payables payee payer payment payment_prefs payments payoutPct payoutSoFar
payouts payroll payroll_account payroll_taxes pays paysFor pays_per_year pct penalty penalty_apr_pct pending people per perPerson perUnit perWeek
perceptions performance periodDays periods person personal_care phase pick pieces pin pin_duplicate pin_missing pin_pending pin_shape pin_target
pin_unread pinned pins place placeCap placeId placeName places placesPerTurn plan planBend planEdit planned plans plate playEntry player
plus_interest pocket points policy pool position positions post pov power powers pre preTax precision prereply presence present preset pressing
presumed presumes pretax preview price priceCents prices priority private probabilities problem produced product production profile profit progress
progression project projects prompt prompts properties property propertyBuy propertySell property_tax public purchase purchase_price purchased
purpose purse putAway qi qty queries quest quests quorum quorumMet quorum_pct quotes raise rank rate ratePct reach reaction reactions read
readElsewhere reads realised realisedLong realisedShort realism reason reasons rebased recHash recall recallTokens receivable recent record recover
recreation recurrence ref refresh refreshLimit refreshQueued refused regard registration reinvest rel relationTypes relations relationships
reliability remaining remove rename renarrateOf rent replacedAt replacedBy replaced_by replaces reply replyClocks reports reportsTo reports_to reqId
request requires rerendered rerunOf resolved rest restructure resume retirement retries retry retryAfter retry_days revenue revenue_adj revision
revisions revocable revoke revolving rewards rewards_pct right riskyAt role roles roll round route routes routine routineRoles routineSettings
routines row rows royalties royalty_deductions rule rules rulesWhy ruleset run runBy runId runSeed runs said sales salesCollected salesHeld
salesRemitted sales_tax salience salt saved savings saw scale scene sceneTicks sceneType schedule scheduleOwner scheduleSlot scheduleSource schedules
scope score scorp season season_from season_to seasons seats secrecy secret secrets section sectionTemplates sections secured securedBy secured_by
seed seedMode sees segment selfDealing seq session set sets settings settle settlement settles settlor severance severance_pct severance_tax severity
shadowed shadowedBy shape share shareOut share_out share_pct shared shares sharesBuyBack sharesClasses sharesDelist sharesIssue sharesList sheet
shift_pattern shifts_per_week short shortfall show showHp shown sides signals since sinceText size sizeFrom sizes skip skipPlan skipPlanCalls skips
slice slot slots sociability social sofa source sourceChat sourceMessage sources spawnCap spawnTier spawned spec specs speed speedThrough speeds
spend spendable spends spent spentToday splits spoiler spoilers spread_pct staff stage staged stages stakeSell stakes stalemate stamp stance stand
standard standing start startMarkers startMinutes started startedAt state statement statement_day statements status statusWords statuses step
stepTokens steps stoppedBy stored story storyTime stove streak streams strike struck structure style successor successorId summary suppressed surface
suspicion suta sutaPaid suta_pct swipe swipeCount swipeHash swipeId swiped swipes symbol symmetric system tab table tables tablesRevision tactics tag
tags tally target tax taxDue tax_brackets tax_exempt tax_pct taxedTo taxes tell template templates tenant term term_months terms terrain text
textHash things thisYear thoughts thread threshold thresholds through tidy tieBreak tiedTo tier tierCaps tiers time timeZone timelapse timings
tips_per_hour title to toName tokens tokensIn tokensOut told told_by tolds tombstones tone tool tools_hardware top5 topics totals touched track
tracking tracks trade transactional transactions transcript transcriptAt transcriptChars transfer transport travel travelSimulation trespass
trivialAt trust trust_distributions trustee trustees_decide truth turn turns tv twelve txn type types unchecked under underlying undistributedPct
undo undone unemployment unemployment_tax unit unitCap units unknown unlocks unpaid unplayed unrealised unset untaken untaxed until untilText
upcoming upkeep_pct upto use user userMessages utilisation utilisationPct v valuation value values vehicle vehicleSpeeds vehicles version via
visibility volume vote voteDelist voteList voteRestructure vote_by vote_rules voter voters votes vs wait waitFor waiting waits walk walk_in wardrobe
warnings wasOn washer water_royalty way ways weapon weather weekdays weeks_per_year weight weighted weights what when where who whose why width
windUp winding window windows with withdraw withheld withholding witness words worker workerId workplace world worldId worn worth wounds write writes
wrote xpField year year_close years yield_pct you yours ytd zones
abilities ability action_points agenda agentDays algorithm annual_return_arithmetic_pct apr_pct_typical aprPct area arrival attack attacks axes axis
base_speed baseUnit bases bill bonus borrowed branch bypass canLend capped cargo carries cha choice classId className close closedBy column columns
con cost_cents cr credit_cents d20_traits daily damage decided defence denominations dex dividend_yield_pct doc donations_deductible double ends
empty_weight_g equip_slot experience facets feet finesse first frame free fromName fuel fuelPct gauge groups handovers hands held_pct hit_dice homeId
hot incident income_tax_exempt int interest_per_cycle invitation item_count lastSeen length_days limit_pct load lose loans magazine magazine_kind
max_dex max_holders mechanics metBy metres minimum_cents mod most move movement nextIn nextOut nonlethal notice odometerLabel offset_days
origination_fee_pct overlays packed_volume_l param passive_income_pct paymentsFrom period pieces_total_weight_g place_ref posted price_cents
price_unit_note proficiency provider rangeLabel range ranks recommended_container road room rounds rule_note rule_text rule_type rulings s
s_corp_holder save saves schema scopes service single skills sky splash stable states stats str stuck sum suppliers t tax_collected tempC tension
thresholdMinutes times total trades_daily trail trained traits truths typical unskilled_bonus usual variants visited wants weapons wearable weekday
weight_g_each whom wis work_shift xp yields yield_to_maturity_pct`
  .split(/\s+/)
  .filter((w) => w !== "");

/** The places in a state whose keys are always ids of the world or the chat, whatever they look like. */
const MAPS = new Set(["state.world.entities", "state.world.accounts", "state.world.tracks", "state.world.materialized", "state.notes", "state.touched", "state.marks", "state.facts", "state.values", "world revision.entities", "world revision.places", "world revision.tracks", "world revision.lore", "state view.replyClocks"]);
/** An object with more keys than this is a map. */
const MAP_KEYS = 64;
/** The tables that bear on a fold and a view. */
const TABLES = ["chat", "turn", "path_node", "change", "snapshot", "snapshot_part", "fold_mark", "world_part", "job", "message_link", "reply_reason", "session", "imported_record", "story_entry", "cast_entry", "cast_doc", "turn_run", "turn_told", "turn_prompt", "kv", "lore_index", "lore_entry_number"];
const TURN_KINDS = ["normal", "regenerate", "swipe", "continue", "impersonate", "renarrate"];
const TURN_STATUSES = ["open", "done", "cut", "dropped", "joined"];
const SNAPSHOT_KINDS = ["cache", "base"];

const registry = createRegistry(ALL_PACKS);
const kinds = [...registry.kinds.values()];
const CODE = new Set<string>([
  ...NAMES,
  ...registry.packs.map((p) => p.id),
  ...STORE_AREAS.map((a) => a.id),
  ...registry.views.map((v) => v.panel),
  ...registry.orgSections.map((s) => s.id),
  ...registry.kinds.keys(),
  ...registry.relations.keys(),
  ...kinds.flatMap((k) => Object.keys(k.fields)),
]);
const storeOps = new Set<string>(Object.values(STORE_OPS));
const areaOps = new Set(STORE_AREAS.flatMap((a) => Object.keys(a.ops).map((op) => `${a.id}.${op}`)));
const opName = (op: string): string => (registry.get(op) !== undefined || storeOps.has(op) || areaOps.has(op) ? op : "other");
const kindName = (kind: unknown): string => (typeof kind === "string" && CODE.has(kind) ? kind : "other");
const fixed = (list: readonly string[], value: unknown): string => (typeof value === "string" && list.includes(value) ? value : "other");

/** Count, total, median and largest of a list of sizes. */
function spread(sizes: number[]): { count: number; total: number; median: number; max: number } {
  const sorted = [...sizes].sort((a, b) => a - b);
  return { count: sorted.length, total: sorted.reduce((n, s) => n + s, 0), median: sorted[Math.floor(sorted.length / 2)] ?? 0, max: sorted.at(-1) ?? 0 };
}

/** The sizes of the values at each path of a walked value; deeper than `MAX_DEPTH` sizes are counted into their parents only. */
const MAX_DEPTH = 7;
class Weights {
  readonly at = new Map<string, number[]>();
  add(path: string, size: number): void {
    const list = this.at.get(path);
    if (list) list.push(size);
    else this.at.set(path, [size]);
  }
}

/** The JSON size of `v`, each value's size kept under its path (see the head of this file for how a path is made). */
function walk(v: unknown, path: string | null, depth: number, weights: Weights): number {
  let size: number;
  if (v === null || v === undefined || typeof v !== "object") size = JSON.stringify(v ?? null).length;
  else if (Array.isArray(v)) {
    size = 2 + Math.max(0, v.length - 1);
    const inner = path === null || depth >= MAX_DEPTH ? null : `${path}[]`;
    for (const item of v) size += walk(item, inner, depth + 1, weights);
  } else {
    const entries = Object.entries(v).filter(([, c]) => c !== undefined);
    const named = path !== null && !MAPS.has(path) && entries.length <= MAP_KEYS && entries.every(([k]) => CODE.has(k));
    size = 2 + Math.max(0, entries.length - 1);
    for (const [k, c] of entries) size += JSON.stringify(k).length + 1 + walk(c, path === null || depth >= MAX_DEPTH ? null : `${path}.${named ? k : "*"}`, depth + 1, weights);
  }
  if (path !== null) weights.add(path, size);
  return size;
}

/** The lines of where `v`'s weight lies: the paths of at least 4 KB or a 500th of the whole, the 300 heaviest, in path order. */
function weightLines(name: string, values: readonly unknown[]): void {
  const weights = new Weights();
  for (const v of values) walk(v, name, 0, weights);
  const whole = spread(weights.at.get(name) ?? []).total;
  const lines = [...weights.at]
    .map(([path, sizes]) => ({ path, ...spread(sizes) }))
    .filter((l) => l.path === name || l.total >= Math.max(4096, whole / 500))
    .sort((a, b) => b.total - a.total)
    .slice(0, 300)
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const l of lines) say({ part: name, ...l });
}

/** Entities by the kinds the packs define, each kind's count and size. */
function byKind(name: string, entities: unknown): void {
  const out: Record<string, { count: number; total: number }> = {};
  for (const e of Object.values(typeof entities === "object" && entities !== null ? entities : {})) {
    const k = kindName(typeof e === "object" && e !== null && "kind" in e ? e.kind : null);
    const row = (out[k] ??= { count: 0, total: 0 });
    row.count++;
    row.total += JSON.stringify(e).length;
  }
  say({ part: `${name}: entities by kind`, kinds: out });
}

const db = new Database(file, { readonly: true });
try {
  part = "chat";
  const row = db.query<{ user: string; world: string | null; head: string | null; path: string }, [string]>("SELECT user, world, head, path FROM chat WHERE id = ?").get(chat);
  if (row === null) throw new Error("no such chat");
  const { user } = row;

  part = "tables";
  const tables = db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  let bytesOf: Map<string, number> | null = null;
  try {
    bytesOf = new Map(db.query<{ name: string; bytes: number }, []>("SELECT name, sum(pgsize) AS bytes FROM dbstat GROUP BY name").all().map((r) => [r.name, r.bytes]));
  } catch {
    bytesOf = null;
  }
  const counted: Record<string, { rows: number; bytes: number | null }> = {};
  const others = { tables: 0, rows: 0, bytes: 0 };
  for (const t of tables) {
    const rows = db.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${t.replaceAll('"', '""')}"`).get()?.n ?? 0;
    const bytes = bytesOf?.get(t) ?? null;
    if (TABLES.includes(t)) counted[t] = { rows, bytes };
    else {
      others.tables++;
      others.rows += rows;
      others.bytes += bytes ?? 0;
    }
  }
  const page = db.query<{ n: number }, []>("SELECT page_count AS n FROM pragma_page_count()").get()?.n ?? 0;
  const pageSize = db.query<{ n: number }, []>("SELECT page_size AS n FROM pragma_page_size()").get()?.n ?? 0;
  say({ part: "tables", fileBytes: page * pageSize, tables: counted, otherTables: others, indexBytes: bytesOf === null ? null : [...bytesOf].filter(([n]) => !tables.includes(n)).reduce((s, [, b]) => s + b, 0) });

  part = "turns";
  const turns = db.query<{ id: string; kind: string; imported: number; status: string; depth: number }, [string, string]>("SELECT id, kind, imported, status, depth FROM turn WHERE user = ? AND chat = ?").all(user, chat);
  const path = JSON.parse(row.path) as { user?: boolean; turn?: string | null }[];
  const tally = (values: string[]): Record<string, number> => values.reduce<Record<string, number>>((o, v) => ({ ...o, [v]: (o[v] ?? 0) + 1 }), {});
  say({
    part: "turns",
    count: turns.length,
    imported: turns.filter((t) => t.imported === 1).length,
    byKind: tally(turns.map((t) => fixed(TURN_KINDS, t.kind))),
    byStatus: tally(turns.map((t) => fixed(TURN_STATUSES, t.status))),
    deepest: Math.max(0, ...turns.map((t) => t.depth)),
    path: { entries: path.length, user: path.filter((e) => e.user === true).length, replies: path.filter((e) => e.user !== true).length, withTurn: path.filter((e) => typeof e.turn === "string").length },
  });

  part = "changes by op";
  db.run("CREATE TEMP TABLE shape_turn (id TEXT PRIMARY KEY)");
  const keep = db.query("INSERT INTO shape_turn (id) VALUES (?)");
  for (const t of turns) keep.run(t.id);
  const ops = db.query<{ op: string; n: number; total: number; max: number }, [string]>("SELECT op, count(*) AS n, sum(length(value)) AS total, max(length(value)) AS max FROM change WHERE user = ? AND turn IN (SELECT id FROM shape_turn) GROUP BY op").all(user);
  const byOp = new Map<string, { count: number; total: number; max: number; ops: number }>();
  for (const o of ops) {
    const name = opName(o.op);
    const was = byOp.get(name) ?? { count: 0, total: 0, max: 0, ops: 0 };
    byOp.set(name, { count: was.count + o.n, total: was.total + o.total, max: Math.max(was.max, o.max), ops: was.ops + 1 });
  }
  for (const [op, o] of [...byOp].sort((a, b) => b[1].count - a[1].count)) say({ part: "changes by op", op, count: o.count, total: o.total, max: o.max, ...(op === "other" ? { distinctOps: o.ops } : {}) });
  const lanes = db.query<{ lane: string; n: number }, [string]>("SELECT lane, count(*) AS n FROM change WHERE user = ? AND turn IN (SELECT id FROM shape_turn) GROUP BY lane").all(user);
  const own = db.query<{ n: number }, [string, string]>("SELECT count(*) AS n FROM change WHERE user = ? AND chat = ?").get(user, chat)?.n ?? 0;
  const ofJobs = db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM change WHERE user = ? AND job IS NOT NULL AND turn IN (SELECT id FROM shape_turn)").get(user)?.n ?? 0;
  say({ part: "changes: lanes", lanes: Object.fromEntries(lanes.map((l) => [fixed(["story", "engine"], l.lane), l.n])), ownChanges: own, ofJobs });

  part = "changes per turn";
  const perTurn = new Map(db.query<{ turn: string; n: number }, [string]>("SELECT turn, count(*) AS n FROM change WHERE user = ? AND turn IN (SELECT id FROM shape_turn) GROUP BY turn").all(user).map((r) => [r.turn, r.n]));
  const buckets = { "0": 0, "1-9": 0, "10-99": 0, "100-999": 0, "1000+": 0 };
  let largest = { id: "", n: -1 };
  for (const t of turns) {
    const n = perTurn.get(t.id) ?? 0;
    buckets[n === 0 ? "0" : n < 10 ? "1-9" : n < 100 ? "10-99" : n < 1000 ? "100-999" : "1000+"]++;
    if (n > largest.n) largest = { id: t.id, n };
  }
  const onPath = path.findIndex((e) => e.turn === largest.id);
  const largestOps = db.query<{ op: string; n: number; total: number }, [string, string]>("SELECT op, count(*) AS n, sum(length(value)) AS total FROM change WHERE user = ? AND turn = ? GROUP BY op").all(user, largest.id);
  const largestBy: Record<string, { count: number; total: number }> = {};
  for (const o of largestOps) {
    const r = (largestBy[opName(o.op)] ??= { count: 0, total: 0 });
    r.count += o.n;
    r.total += o.total;
  }
  say({ part: "changes per turn", turns: buckets, largest: largest.n, largestDepth: turns.find((t) => t.id === largest.id)?.depth ?? null, largestOnPath: onPath < 0 ? null : onPath, largestImported: turns.find((t) => t.id === largest.id)?.imported ?? null, largestByOp: largestBy });

  part = "imported records";
  try {
    say({ part: "imported records", ...spread(db.query<{ n: number }, [string, string]>("SELECT length(record) AS n FROM imported_record WHERE user = ? AND chat = ?").all(user, chat).map((r) => r.n)) });
  } catch (error) {
    stopped(error);
  }

  part = "snapshots";
  const prevOf = db.query<{ prev: string | null }, [string, string]>("SELECT prev FROM path_node WHERE user = ? AND key = ?");
  const nodes: string[] = [];
  for (let at = row.head; at !== null && nodes.length < 1_000_000; at = prevOf.get(user, at)?.prev ?? null) nodes.push(at);
  db.run("CREATE TEMP TABLE shape_node (key TEXT PRIMARY KEY)");
  const keepNode = db.query("INSERT OR IGNORE INTO shape_node (key) VALUES (?)");
  for (const n of nodes) keepNode.run(n);
  const snaps = (where: string): Record<string, { count: number; total: number; fingerprints: number }> =>
    Object.fromEntries(
      db
        .query<{ kind: string; n: number; total: number; prints: number }, [string]>(`SELECT kind, count(*) AS n, sum(length(state)) AS total, count(DISTINCT fingerprint) AS prints FROM snapshot WHERE user = ? ${where} GROUP BY kind`)
        .all(user)
        .map((s) => [fixed(SNAPSHOT_KINDS, s.kind), { count: s.n, total: s.total, fingerprints: s.prints }]),
    );
  const parts = db.query<{ n: number; total: number }, [string]>("SELECT count(*) AS n, sum(length(body)) AS total FROM snapshot_part WHERE user = ?").get(user);
  say({ part: "snapshots", headNodes: nodes.length, onTheChat: snaps("AND node IN (SELECT key FROM shape_node)"), ofTheUser: snaps(""), parts: { count: parts?.n ?? 0, total: parts?.total ?? 0 } });

  part = "world revisions";
  const files = row.world === null ? [] : db.query<{ file: string; n: number }, [string, string]>("SELECT file, length(bytes) AS n FROM world_part WHERE user = ? AND world = ?").all(user, row.world);
  const revs = files.filter((f) => f.file.startsWith("rev/"));
  say({ part: "world revisions", revisions: spread(revs.map((f) => f.n)), otherFiles: spread(files.filter((f) => !f.file.startsWith("rev/")).map((f) => f.n)) });

  part = "head state";
  await installHistoryLines(shippedTexts());
  const store = openStore({ db, registry, worlds: storedWorlds(db), areas: STORE_AREAS, ...(build === undefined ? {} : { fingerprint: build }), log: () => undefined, handlerFailed: () => undefined });
  const s = store.user(user);
  let began = performance.now();
  const head = s.headState(chat).state;
  const foldMs = Math.round(performance.now() - began);
  say({ part: "head state: folded", ms: foldMs, accounts: Object.keys(head.world.accounts).length, tracks: Object.keys(head.world.tracks).length, entities: Object.keys(head.world.entities).length });
  byKind("head state", head.world.entities);
  weightLines("state", [head]);

  part = "world revision";
  const doc = store.env.worlds(head.world.revision);
  if (doc !== undefined) {
    byKind("world revision", doc.entities);
    weightLines("world revision", [doc]);
  }

  part = "state view";
  const texts = await historyTexts(shippedTexts());
  const knowledge = { chat: {}, tracking: TAP_DEFAULTS.choices.tracking, narrator: TAP_DEFAULTS.choices.narrator };
  began = performance.now();
  const journal = await journalNotes(store, user, chat, TAP_DEFAULTS.journalMost, { texts, code: (c) => c, key: "shape" });
  const view = await chatView({ store, user, chat, turn: null, turning: false, offstage: TAP_DEFAULTS.tell, map: MAP_DEFAULTS, knowledge, journal, chips: chipsOf(db, s, user, chat), meter: null, pending: [], clocksMost: TAP_DEFAULTS.clocksMost, staged: null, notCarried: [] });
  say({ part: "state view: built", ms: Math.round(performance.now() - began), journal: journal.length });
  weightLines("state view", [view]);

  part = "org page";
  const at = { store, user, chat, turn: null, offstage: TAP_DEFAULTS.tell, map: MAP_DEFAULTS, knowledge };
  const pages = Object.keys((view.panels[ORGS_SUMMARY_PANEL] ?? {}) as object).map((id) => chatViewItem(at, ORGS_ORG_PANEL, id));
  say({ part: "org pages", ...spread(pages.map((p) => JSON.stringify(p ?? null).length)) });
  weightLines("org page", pages);
} catch (error) {
  stopped(error);
  process.exitCode = 1;
} finally {
  db.close();
}
