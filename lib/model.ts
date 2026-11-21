// Token Radar's scoring model, release radar-9: a sealed snapshot goes in, a ranked board comes out.
//
// Which protocols make the board. The board always carries every slug the snapshot's watchlist
// names — that list is the floor, never the ceiling — and on top of it the early radar adds
// every pre-token protocol the watchlist does not name that clears the house's own visible test
// for "not a wrapped, staked or bridged product of a token that already trades". A protocol
// counts as pre-token when its record shows no token anywhere: no market cap, no CoinGecko id,
// no symbol. The wording matters: "records no token", not "has no token" — DefiLlama's record
// is not proof, and a listed protocol may still hold a token its record fails to show.
//
// The visible test, built from the snapshot's own fields alone: the category must not be Bridge,
// Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX; the name must carry
// no whole word wrapped, staked or staking; the name must not start with an exchange's name
// (Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini); the name must not end in
// a version marker. The house's test carries one further clause this file cannot see,
// DefiLlama's parentProtocol, so a protocol above the floor that the watchlist skips used to be
// left out. Radar-4 ranks it anyway and flags it OFF LIST: the visible test clears it, the flag
// carries the house's omission in the open, and a reader can filter the flag out. That is why
// WBTC, Binance staked ETH, Coinbase Bridge and USDT0 never show up on this board, however
// large their TVL — they fail the visible test itself, not the watchlist.
//
// The board carries three separate numbers per row, never folded into one another:
//
//   launch value        = flat_multiple x tvl_usd — the flat TVL multiple, the median
//                          market-cap-to-TVL over the traded tokens. This is the primary
//                          USD valuation and the board's ranking, because the strict
//                          rolling validation found no blend of the radar formula that
//                          beats flat TVL out of time (see below). The radar formula is
//                          kept as an auxiliary valuation per row:
//                          radar value = base x tvl_usd^0.85 x anchor^0.15 x growth
//                          x chains (the anchor is the traded-token TVL anchor, shrunk
//                          by category — see tvlAnchors — growth is
//                          1 + 0.25 x tanh((change_7d - cat_median) / 25) against the
//                          category median, chains is 1 + 0.03 x min(max(chains - 1, 0), 5)).
//                          The base is not the round 0.25 any more: it is
//                          0.25 x k, where k = exp(median log(MCAP / predicted)) over the
//                          traded tokens' leave-one-out predictions — the value scale the
//                          traded tokens themselves imply, not a round number and not a
//                          competitor's total.
//   tokenization propensity = sigmoid(w0 + w1 x z(log10 TVL) + w2 x z(chains)
//                          + w3 x z(category rate)), a logistic score fitted on the eligible
//                          protocols only — every protocol the board's own visible test keeps,
//                          launched or not — with the protocol itself left out of its category
//                          rate and the features standardised on the training set. It is an
//                          auxiliary indicator, a cross-sectional score, not a probability
//                          that the protocol will launch a token: the label is "has a token
//                          at snapshot time", the snapshot is a single cross-section, and no
//                          future launch dates exist to calibrate against. It is never
//                          multiplied into a USD value. Log age was tried in the ablation and
//                          dropped: it lifts random-fold AUC but cuts time-split AUC, so the
//                          final spec has no age term — see the ablation in
//                          fitPropensityModel. Age never enters the value either: a protocol
//                          that has run three years with no token is not worth more.
//   propensity-weighted priority = launch value x tokenization propensity, a unitless
//                                  sort aid only — never labelled USD, never called an
//                                  expected value. The dashboard offers it as an alternate
//                                  sort; the board's rank, and the implied_value_usd field
//                                  the gate checks, are the launch value.
//
// The value formula is checked out of sample, not just fitted: leave-one-out over the traded
// tokens and by-time (the older half fits the model that prices the newer half), each against
// a flat TVL-multiple baseline, and each with NESTED calibration — a test sample's own market
// cap never enters its own scale factor, so the reported misses are honest. The board's
// launch value is a log-space blend of the radar formula and the flat TVL multiple,
// ln V = alpha x ln V_radar + (1 - alpha) x ln V_flat, and alpha is chosen by STRICT
// ROLLING validation: the dated traded tokens, ordered by listing date, split into an
// initial training set and four consecutive test blocks, each block priced from prior data
// only — no future sample enters that block's anchor, category median, flat multiple or
// scale factor — the first three blocks pick alpha among the alphas that pass the gate
// (two stages: blocks 1-3 pick, pooled median miss at least 10% below flat and at least
// 2 of 3 blocks better; block 4 only vetoes, not more than 10% worse than flat), and
// when no alpha passes the gate the board falls back to the flat TVL multiple and says
// so. The printed range on every row is the Historical model error range (P20-P80) and
// the P10-P90 range, cut from the older half's nested leave-one-out errors and frozen
// before the newer half is scored, so the by-time coverage is a strict held-out number,
// and the coverage those ranges achieve on the by-time held-out caps is measured and
// printed alongside, per rolling block. The range is the value model's error assuming a
// launch; the propensity score is the separate launch uncertainty, and the dashboard
// shows the two apart — the P10-P90 range is not an 80% confidence interval on the
// final airdrop value. No protocol name is ever special-cased, and no row is
// hand-picked: one function scores every row, and the dashboard prints the formula
// alongside the constants it runs. The previous release's formula is kept beside it as
// a comparison function only, never for the ranking.

/** A snapshot protocol entry: the ten fields the sealed input carries, no more. */
export interface SnapshotProtocol {
  slug: string; // DefiLlama slug, unique per protocol
  name: string; // display name
  chains: string[]; // chains the protocol runs on
  category: string | null; // DefiLlama category, when given
  tvl_usd: number; // total value locked, US dollars
  change_7d: number | null; // seven-day TVL change, per cent
  mcap_usd: number | null; // token market cap, when a token trades
  listed_at: string | null; // listing date, YYYY-MM-DD
  gecko_id: string | null; // CoinGecko id, when one exists
  symbol: string | null; // token symbol, when one exists
}

/** The sealed snapshot document, whole. */
export interface Snapshot {
  source: string; // where the snapshot came from
  as_of: string; // snapshot date, YYYY-MM-DD
  floor_usd: number; // watchlist TVL floor, US dollars
  watchlist: string[]; // slugs the house watches
  protocols: SnapshotProtocol[]; // every protocol in the snapshot
}

/** The model's constants, the same ones the dashboard prints. */
export interface ModelConstants {
  base_multiple: number; // TVL multiple for the base value
  tvl_exponent: number; // sub-linear TVL exponent, below 1
  median_exponent: number; // anchor TVL exponent, the complement of the TVL one
  growth_weight: number; // weight of the category-relative growth factor
  growth_scale: number; // tanh scale in per cent: how far from the category median saturates
  chain_step: number; // multiplier step per extra chain
  chain_max_steps: number; // most extra chains that count
}

export const MODEL: ModelConstants = { // the constants the dashboard prints
  base_multiple: 0.25, tvl_exponent: 0.85, median_exponent: 0.15,
  growth_weight: 0.25, growth_scale: 25, chain_step: 0.03, chain_max_steps: 5,
};

/** The previous release's constants, kept only for the radar-2 comparison. */
export interface ModelConstantsV2 {
  base_multiple: number; // TVL multiple for the base value
  growth_weight: number; // weight of seven-day growth
  growth_floor: number; // growth clamp, low end
  growth_cap: number; // growth clamp, high end
  maturity_floor: number; // maturity multiplier floor
  maturity_range: number; // maturity multiplier range above the floor
  maturity_days: number; // days to full maturity
  unknown_age_days: number; // age assumed when unknown
  chain_step: number; // multiplier step per extra chain
  chain_max_steps: number; // most extra chains that count
}

export const MODEL_V2: ModelConstantsV2 = { // radar-2, comparison only
  base_multiple: 0.25, growth_weight: 0.7, growth_floor: -50, growth_cap: 150,
  maturity_floor: 0.65, maturity_range: 0.35, maturity_days: 1095,
  unknown_age_days: 365, chain_step: 0.04, chain_max_steps: 5,
};

/** The model release label, the one the dashboard shows. */
export const MODEL_VERSION: string = 'radar-9';

/** Live-token rows in the dashboard's Live token view, by market cap. */
export const LIVE_ROWS: number = 24;

/** A farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  cost: string; // what the step costs
  time: string; // how long the step takes
  text: string; // the action itself
}

/** A farm verdict, judged on each plan size independently: Farm when even the conservative
 * 1% drop clears the threshold on the $1,000 plan, Marginal when the neutral 3% drop clears
 * zero — on the $1,000 plan, or on the $10,000 plan when the small plan does not clear it —
 * Skip when neither plan clears zero at 3%. The verdict is about the farmer's plan, not the
 * protocol's quality: a large protocol can top the board and still be a Skip on a small plan,
 * because a small position is a dust share of its drop. */
export type FarmVerdict = 'Farm' | 'Marginal' | 'Skip';

/** How executable a protocol's farm plan is, from the snapshot alone: Category-supported
 * means the snapshot shows a large, long-running protocol in a category with one canonical
 * product — the name means the category supports a product, not that the specific vault or
 * pool was checked live; Conditional means the steps are category-inferred hypotheticals,
 * worded "if it runs..."; Research first means the category names no product to pin an
 * interaction on, so the plan starts with research. */
export type PlanState = 'Category-supported' | 'Conditional' | 'Research first';

/** The tokenization-propensity score's constants. */
export interface PropensityConstants {
  iterations: number; // gradient-descent steps, fixed so the fit is deterministic
  learning_rate: number; // step size for the batch gradient
  unknown_age_days: number; // age assumed when a protocol has no listing date
  max_chains: number; // most chains that count in the score
  smoothing: number; // Laplace pseudocount on the category rate
  cv_folds: number; // folds in the cross-validation
}

export const PROPENSITY: PropensityConstants = { // the constants the dashboard prints
  iterations: 3000, learning_rate: 0.5, unknown_age_days: 365,
  max_chains: 6, smoothing: 2, cv_folds: 5,
};

/** One predicted band's calibration: the predicted centre, how many held-out protocols fall
 * in the band, and the share of them that already have a token. */
export interface PropensityBand {
  center: number; // predicted centre of the band: 0.1, 0.3, 0.5, 0.7 or 0.9
  n: number; // held-out protocols in the band
  actual: number; // share of them that already have a token
}

/** The time-split check: the older half of the training set fits the model that scores the
 * newer half, so the numbers are out of sample in time as well as in fold. The baselines
 * are the same quality numbers for always predicting the training set's base rate on the
 * newer half: when the model is worse than its baseline, the dashboard says so plainly
 * instead of presenting the score as a reliable cross-period predictor. */
export interface PropensityTimeSplit {
  split: string; // the listing date the split falls on
  n: number; // newer-half protocols scored
  roc_auc: number; // area under the ROC curve on the newer half
  brier: number; // mean squared error of the score against the label, newer half
  log_loss: number; // mean log loss of the score against the label, newer half
  brier_baseline: number; // Brier score of always predicting the training-set base rate, newer half
  log_loss_baseline: number; // log loss of always predicting the training-set base rate, newer half
}

/** The fitted tokenization-propensity score: the weights in standardised feature space, the
 * feature means and standard deviations they are measured against, and the category counts the
 * leave-one-out category rate is built from. It is a score, not a calibrated probability: the
 * quality numbers below are discrimination and calibration on the cross-sectional label
 * "has a token now", and no number here measures how often a protocol will launch one later. */
export interface PropensityModel {
  features: string[]; // the feature spec the score runs on: 'tvl', 'age', 'chains', 'catRate', in order
  weights: number[]; // intercept first, then one per feature, in standardised space
  means: number[]; // feature means over the training set
  sds: number[]; // feature standard deviations over the training set (population)
  cat_total: Record<string, number>; // protocols per category in the training set
  cat_launched: Record<string, number>; // launched protocols per category in the training set
  base_rate: number; // launched share among the eligible training set
  train_size: number; // training protocols
  launched: number; // launched protocols in the training set
  roc_auc: number; // five-fold out-of-fold ROC-AUC of the score
  brier: number; // five-fold out-of-fold Brier score
  brier_baseline: number; // Brier score of always predicting the base rate
  log_loss: number; // five-fold out-of-fold log loss
  log_loss_baseline: number; // log loss of always predicting the base rate
  calibration: PropensityBand[]; // actual launched share per predicted band, out of fold
  time_split: PropensityTimeSplit; // the same quality numbers on the newer half, by listing date
}

/** What the holdout tests say about the value model: the median miss of the chosen blended
 * value (radar formula and flat TVL multiple, log-space blend at the rolling-chosen alpha)
 * against the flat TVL multiple, leave-one-out and by-time, plus the error distribution
 * the printed ranges are cut from and the coverage those ranges achieve on held-out caps.
 * The printed range is the Historical model error range (P20-P80), not P25-P75, and its
 * bands are cut from the older half's nested leave-one-out errors only, frozen before the
 * newer half is scored — so the by-time coverage is a strict held-out number, not a
 * re-scored in-sample one. */
export interface HoldoutSummary {
  loo_n: number; // traded tokens priced leave-one-out
  loo_median_miss: number; // median miss of the value formula, leave-one-out
  loo_flat_median_miss: number; // median miss of the flat TVL multiple, leave-one-out
  loo_within_2x: number; // share of leave-one-out caps within 2x of the prediction
  bytime_n: number; // traded tokens in the newer half of the by-time test
  bytime_split: string; // the listing date the by-time test splits on
  bytime_median_miss: number; // median miss of the value formula, by-time
  bytime_flat_median_miss: number; // median miss of the flat multiple, by-time
  bytime_train_log_median: number; // median raw log error of the older half — the scale the by-time test calibrates on
  bytime_test_log_median: number; // median raw log error of the newer half before calibration — the scale the test actually needs; the gap between the two is the scale drift
  log_p10: number; // 10th percentile of the nested leave-one-out log error
  log_p20: number; // 20th percentile
  log_p50: number; // median
  log_p80: number; // 80th percentile
  log_p90: number; // 90th percentile
  log_p50_raw: number; // median of the raw (pre-calibration) leave-one-out log errors — the scale the traded tokens imply, used to set the value base; the reported misses above are nested and never reuse it
  range_lo_factor: number; // exp(P20 of the older half's nested leave-one-out log errors): the low end of the printed Historical model error range
  range_hi_factor: number; // exp(P80 of the older half's nested leave-one-out log errors)
  range_lo10_factor: number; // exp(P10 of the older half's nested leave-one-out log errors)
  range_hi90_factor: number; // exp(P90 of the older half's nested leave-one-out log errors)
  coverage_central60: number; // share of by-time held-out caps inside the printed Historical model error range, scored against bands fixed on the older half only
  coverage_1090: number; // share inside the printed P10-P90 range, same frozen bands
}

/** One rolling test block: the consecutive traded tokens listed after the training set,
 * priced from prior data only, with the flat baseline and the chosen model side by side. */
export interface RollingBlock {
  block: number; // 1-based block number
  start: string; // first listing date in the block
  end: string; // last listing date in the block
  n: number; // test protocols in the block
  train_n: number; // training protocols before the block
  flat_median_miss: number; // flat TVL median miss on the block
  chosen_median_miss: number; // median miss of the chosen model on the block
  alpha_median_miss: number[]; // median miss per alpha in BLEND_ALPHAS order, on the block
  central60_coverage: number; // chosen model: share of the block inside the Historical model error range
  p1090_coverage: number; // chosen model: share of the block inside P10-P90
}

/** The strict rolling validation: the dated traded tokens, ordered by listing date, split
 * into an initial training set and four consecutive test blocks. The first three blocks
 * pick alpha among the alphas that pass the two-stage gate; the fourth block is held out
 * as final validation — it can only veto through the gate, never pick. When no alpha
 * passes the gate the board falls back to the flat TVL multiple. The category-multiple
 * experiment runs the same two-stage gate on one extra value model and is reported
 * whatever it says; it never changes the board in this release. */
export interface RollingValidation {
  alphas: number[]; // the blend weights compared, [0, 0.25, 0.5, 0.75, 1]
  dated_n: number; // dated traded tokens the rolling runs on
  initial_n: number; // initial training set size
  block_n: number; // test protocols per block
  pooled_miss_by_alpha: number[]; // pooled median miss on blocks 1-3, per alpha
  flat_pooled_miss: number; // flat pooled median miss, blocks 1-3
  gate_by_alpha: boolean[]; // per-alpha two-stage gate result: blocks 1-3 pooled at least 10% below flat and at least 2 of 3 better, and the held-out block not more than 10% worse
  chosen_alpha: number; // the blend weight the board uses: the best gate-passing alpha on blocks 1-3, or 0 for the flat fallback
  board_uses_flat: boolean; // true when no alpha passed the gate and the board falls back to flat TVL
  cat_multiple: CatMultipleValidation; // the category-multiple experiment under the same two-stage gate
  blocks: RollingBlock[]; // the four test blocks, in listing order
}

/** One extra value model, tested honestly under the same two-stage gate as the blends:
 * per-category flat multiples with shrinkage — each category's median market-cap-to-TVL
 * among the training tokens, shrunk toward the global training median by w = n_c / (n_c
 * + 5). Blocks 1-3 select, block 4 only vetoes. Reported whatever it says; the board
 * never uses it in this release. */
export interface CatMultipleValidation {
  per_block_miss: number[]; // median miss per rolling block, priced from prior data only
  flat_per_block_miss: number[]; // flat median miss per block, same blocks
  pooled_miss_123: number; // pooled median miss over blocks 1-3
  flat_pooled_123: number; // flat pooled median miss over blocks 1-3
  train_gate: boolean; // pooled 10% below flat on blocks 1-3 and at least 2 of 3 blocks better
  veto: boolean; // block 4 not more than 10% worse than flat
  passed: boolean; // train_gate && veto
}

/** One group of the snapshot's protocols, by what happened to them: ranked on the board, a
 * token already trading, or excluded for a named reason. The groups are disjoint and cover
 * the whole snapshot. */
export interface AccountingGroup {
  key: string; // short key
  label: string; // what the group is
  count: number; // protocols in it
}

/** The farm verdict's constants: the three drop-share scenarios, the two plan sizes, the gas
 * a plan costs on Ethereum and elsewhere, the annual cost of the capital, and the net
 * threshold. Gas is a conservative budget, not a live quote, and it follows the hold: a
 * plan runs 2 setup transactions (approve + deposit), one weekly action per full week,
 * and 1 exit — Ntx = 3 + floor(holdDays / 7) — so a 30-day plan runs 7, a 45-day plan 9,
 * a 60-day plan 11, each transaction priced on the chain it actually runs on. No scenario
 * is evidence: the shares are scenarios, and the verdicts are stated against them — Farm
 * when even the conservative drop clears the threshold on the $1,000 plan. */
export interface FarmConstants {
  drop_share_conservative: number; // drop share in the conservative scenario
  drop_share_neutral: number; // drop share in the neutral scenario
  drop_share_optimistic: number; // drop share in the optimistic scenario
  plan_small: number; // small plan size, dollars
  plan_large: number; // large plan size, dollars
  gas_ethereum: number; // gas per transaction on Ethereum, dollars
  gas_other: number; // gas per transaction elsewhere, dollars
  opportunity_rate: number; // annual cost of the capital
  farm_threshold: number; // net on the small plan above which a row is Farm
}

export const FARM: FarmConstants = { // the constants the dashboard prints
  drop_share_conservative: 0.01, drop_share_neutral: 0.03, drop_share_optimistic: 0.07,
  plan_small: 1000, plan_large: 10000,
  gas_ethereum: 11.5, gas_other: 3, opportunity_rate: 0.05, farm_threshold: 10,
};

/** Transactions a farm plan runs for a hold of `holdDays`: 2 setup (approve + deposit),
 * one weekly action per full week, 1 exit — Ntx = 3 + floor(holdDays / 7). A 30-day plan
 * runs 7, a 45-day plan 9, a 60-day plan 11. */
export function gasTransactionsFor(holdDays: number): number {
  return 3 + Math.floor(holdDays / 7);
}

/** Gas per transaction on a chain: Ethereum $11.50, elsewhere $3.00 — a conservative
 * budget assumption, not a live quote. */
function gasPerTx(chain: string): number {
  return chain === 'Ethereum' ? FARM.gas_ethereum : FARM.gas_other;
}

/** The gas a farm plan deducts: setup (2) and exit (1) on the protocol's first chain, the
 * weekly actions alternating between its first and second chain, each transaction priced
 * on the chain it actually runs on. */
export function gasForPlan(entry: SnapshotProtocol, holdDays: number): number {
  const first = entry.chains[0] ?? '';
  const second = entry.chains[1] ?? null;
  const weekly = Math.floor(holdDays / 7);
  let total = 2 * gasPerTx(first) + gasPerTx(first);
  for (let w = 0; w < weekly; w++) {
    total += gasPerTx(w % 2 === 0 ? first : (second ?? first));
  }
  return Math.round(total * 100) / 100;
}

/** A board.json row: one ranked protocol. */
export interface BoardRow {
  rank: number; // 1-based position on the board
  slug: string; // DefiLlama slug
  name: string; // display name
  category: string | null; // DefiLlama category, when given
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, US dollars
  change_7d: number | null; // seven-day TVL change, per cent
  mcap_usd: number | null; // token market cap, when a token trades
  listed_at: string | null; // listing date
  gecko_id: string | null; // CoinGecko id, when one exists
  symbol: string | null; // token symbol, when one exists
  age_days: number | null; // days since listing, when known
  token_status: 'pre-token'; // always pre-token on the board
  implied_value_usd: number; // the launch value (value-if-it-launches, rounded) — the primary USD value and the ranking value
  value_if_launches_usd: number; // the board's launch value (blended radar/flat), rounded, before any propensity is applied
  propensity: number; // tokenization propensity score, 0..1 — cross-sectional, not a launch probability
  priority_score: number; // launch value times propensity — a unitless sort aid, never labelled USD
  range_lo_usd: number; // P20 end of the printed Historical model error range, from the holdout error distribution
  range_hi_usd: number; // P80 end of the printed range
  range_lo10_usd: number; // P10 end of the printed range
  range_hi90_usd: number; // P90 end of the printed range
  farm_verdict: FarmVerdict; // Farm, Marginal or Skip, judged on each plan size independently
  farm_plan_size: number; // the plan size the verdict and the farm steps use: $1,000, or $10,000 for a Marginal earned on the large plan
  plan_state: PlanState; // Category-supported, Conditional or Research first — how executable the farm plan is
  gas_total_usd: number; // the backend-computed gas total for the row's farm plan, dollars — the dashboard displays this number, it never recomputes gas
  breakeven_drop_share: number; // the drop share at which the row's farm plan breaks even — the share where the reward covers the gas plus the 5% annual cost of the capital over the hold; above 1 the plan never breaks even
  net_plan_gas50_usd: number; // conditional net at the row's plan size, neutral 3% drop, with the gas budget at +50% — sensitivity only, the verdict never changes
  net_plan_gas100_usd: number; // conditional net at the row's plan size, neutral 3% drop, with the gas budget doubled — sensitivity only
  verdict_gas50: FarmVerdict; // the farm verdict recomputed with the gas budget at +50% — sensitivity only, the row's verdict never changes
  verdict_gas100: FarmVerdict; // the farm verdict recomputed with the gas budget doubled — sensitivity only
  flat_rank: number; // the row's rank by flat TVL value alone
  radar_rank: number; // the row's rank by the radar formula alone
  rank_diff: number; // flat_rank minus radar_rank: positive when the radar formula ranks the protocol higher than flat TVL does
  net_1000_usd: number; // conditional net of farming at the $1,000 plan size, neutral 3% drop, assuming launch and a pro-rata drop allocation — not an expected return
  net_10000_usd: number; // conditional net of farming at the $10,000 plan size, neutral 3% drop, same assumption
  net_1000_conservative_usd: number; // conditional net at the $1,000 plan size, conservative 1% drop
  net_1000_optimistic_usd: number; // conditional net at the $1,000 plan size, optimistic 7% drop
  off_list: boolean; // true when the protocol is above the floor but the watchlist skips it
  model: { // the factors behind the value, each recomputable from the snapshot
    tvl_base: number; // base_multiple x TVL^0.85 x anchor^0.15, in dollars
    growth_factor: number; // category-relative growth factor, 0.75..1.25
    category_median_7d: number | null; // the category median the growth factor measures against
    chain_factor: number; // chain-breadth factor
    tvl_median: number; // the unified TVL anchor for the row's category
  };
  farm_steps: string[]; // the seven-step farm plan, as text
}

/** A board row in compact form for the dashboard; the page builds the farm plan. */
export interface RadarRow {
  rank: number; // 1-based position on the board
  slug: string; // DefiLlama slug
  name: string; // display name
  category: string | null; // DefiLlama category, when given
  chains: string[]; // chains the protocol runs on
  tvl_usd: number; // total value locked, US dollars
  change_7d: number | null; // seven-day TVL change, per cent
  mcap_usd: number | null; // token market cap, when a token trades
  listed_at: string | null; // listing date
  age_days: number | null; // days since listing, when known
  implied_value_usd: number; // the launch value — the primary USD value and the ranking value
  value_if_launches_usd: number; // the board's launch value (blended radar/flat), rounded, before any propensity is applied
  propensity: number; // tokenization propensity score, 0..1 — cross-sectional, not a launch probability
  priority_score: number; // launch value times propensity — a unitless sort aid, never labelled USD
  range_lo_usd: number; // P20 end of the printed Historical model error range, from the holdout error distribution
  range_hi_usd: number; // P80 end of the printed range
  range_lo10_usd: number; // P10 end of the printed range
  range_hi90_usd: number; // P90 end of the printed range
  farm_verdict: FarmVerdict; // Farm, Marginal or Skip, judged on each plan size independently
  farm_plan_size: number; // the plan size the verdict and the farm steps use: $1,000, or $10,000 for a Marginal earned on the large plan
  plan_state: PlanState; // Category-supported, Conditional or Research first — how executable the farm plan is
  gas_total_usd: number; // the backend-computed gas total for the row's farm plan, dollars — the dashboard displays this number, it never recomputes gas
  breakeven_drop_share: number; // the drop share at which the row's farm plan breaks even — the share where the reward covers the gas plus the 5% annual cost of the capital over the hold; above 1 the plan never breaks even
  net_plan_gas50_usd: number; // conditional net at the row's plan size, neutral 3% drop, with the gas budget at +50% — sensitivity only, the verdict never changes
  net_plan_gas100_usd: number; // conditional net at the row's plan size, neutral 3% drop, with the gas budget doubled — sensitivity only
  verdict_gas50: FarmVerdict; // the farm verdict recomputed with the gas budget at +50% — sensitivity only, the row's verdict never changes
  verdict_gas100: FarmVerdict; // the farm verdict recomputed with the gas budget doubled — sensitivity only
  flat_rank: number; // the row's rank by flat TVL value alone
  radar_rank: number; // the row's rank by the radar formula alone
  rank_diff: number; // flat_rank minus radar_rank: positive when the radar formula ranks the protocol higher than flat TVL does
  net_1000_usd: number; // conditional net of farming at the $1,000 plan size, neutral 3% drop
  net_10000_usd: number; // conditional net of farming at the $10,000 plan size, neutral 3% drop
  net_1000_conservative_usd: number; // conditional net at the $1,000 plan size, conservative 1% drop
  net_1000_optimistic_usd: number; // conditional net at the $1,000 plan size, optimistic 7% drop
  off_list: boolean; // true when the protocol is above the floor but the watchlist skips it
  growth_factor: number; // category-relative growth factor
  chain_factor: number; // chain-breadth factor
  tvl_base: number; // base_multiple x TVL^0.85 x anchor^0.15, in dollars
  category_median_7d: number | null; // category median seven-day growth, when one exists
  tvl_median: number; // the unified TVL anchor for the row's category
  v2_rank: number; // where the previous release ranked this protocol
  v2_implied: number; // the previous release's implied value for this protocol
  on_watchlist: boolean; // true when the slug is watchlisted
  category_tvl_rank: number | null; // TVL rank inside its category
  category_growth_median: number | null; // category median seven-day growth
  farm_steps: string[]; // the farm plan, as text — the same steps board.json carries
}

/** A protocol whose token already trades: the market's value, not a model's. */
export interface LiveRow {
  slug: string; // DefiLlama slug
  name: string; // display name
  chains: string[]; // chains the protocol runs on
  category: string | null; // DefiLlama category, when given
  tvl_usd: number; // total value locked, US dollars
  mcap_usd: number | null; // token market cap
  change_7d: number | null; // seven-day TVL change, per cent
}

/** One protocol's move between the two releases: where it stood, where it stands, and why. */
export interface RankMover {
  slug: string; // DefiLlama slug
  name: string; // display name
  v2_rank: number; // rank under radar-2
  current_rank: number; // rank under the current release
  reason: string; // the factor that drove the move, in one line
}

/** How the two releases' rankings relate: their correlation and the biggest moves. */
export interface ModelComparison {
  spearman: number; // Spearman rank correlation between the radar-2 and current rankings
  rises: RankMover[]; // biggest rank rises, best first
  falls: RankMover[]; // biggest rank falls, worst first
}

/** One feature spec in the age ablation: the out-of-fold and time-split quality of the
 * propensity score with that feature set, plus the two halves of the time-split newer set
 * scored separately, so a feature that helps the old half and hurts the new half is caught. */
export interface AblationSpec {
  spec: string; // the feature set, e.g. 'tvl+chains+catRate'
  oof_auc: number; // five-fold out-of-fold ROC-AUC
  oof_brier: number; // five-fold out-of-fold Brier score
  ts_auc: number; // time-split ROC-AUC on the newer half
  ts_brier: number; // time-split Brier score on the newer half
  ts_sub_older_auc: number; // ROC-AUC on the older half of the time-split newer set
  ts_sub_newer_auc: number; // ROC-AUC on the newer half of the time-split newer set
}

/** The age ablation: the three feature specs side by side and the decision they force. Log
 * age stays only when it lifts the time-split AUC by at least 0.02, does not worsen the
 * time-split Brier score, and degrades neither half of the newer set by more than 0.02. */
export interface AgeAblation {
  a_no_age: AblationSpec; // TVL + chains + category rate
  b_with_age: AblationSpec; // TVL + log age + chains + category rate
  c_no_rate: AblationSpec; // TVL + log age + chains, no category rate
  kept_age: boolean; // true when the age feature survived the rule above
}

/** All the dashboard renders: board, live set and the model behind them. */
export interface RadarData {
  source: string; // where the snapshot came from
  as_of: string; // snapshot date
  floor_usd: number; // watchlist TVL floor, US dollars
  model_version: string; // model release label
  model: ModelConstants; // the constants the model ran with
  watchlist_size: number; // watchlist slug count
  board_size: number; // ranked row count
  early_size: number; // early-radar row count
  live_size: number; // live-token row count
  live: LiveRow[]; // live-token protocols, by market cap
  rows: RadarRow[]; // ranked rows, compact form
  comparison: ModelComparison; // radar-2 versus radar-9, computed by the build
  propensity: PropensityModel; // the fitted tokenization-propensity score, so the page recomputes every row's score
  age_ablation: AgeAblation; // the three feature specs side by side and whether log age survived
  holdout: HoldoutSummary; // what the out-of-sample holdout tests say about the value model
  blend_alpha: number; // the log-space blend weight the board uses: 1 radar alone, 0 flat TVL alone
  flat_multiple: number; // median market-cap-to-TVL over all traded tokens — the flat baseline
  rolling: RollingValidation; // the strict rolling validation that chose the blend weight
  accounting: AccountingGroup[]; // all snapshot protocols, grouped by outcome or reason
  verdict_counts: { farm: number; marginal: number; skip: number }; // farm verdicts on the board
  total_implied_usd: number; // sum of launch value across the board
  mean_propensity: number; // mean tokenization propensity across the board
  base_rate: number; // observed launched share among the eligible training set — a statistic, not a calibration target
  scale_k: number; // the nested leave-one-out median log ratio that sets the value base: base = 0.25 x k
  tvl_anchor_global: number; // the global traded-token median TVL the anchor shrinks toward
}

/** Raised when a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message); // Error keeps the message
    this.name = SnapshotError.name;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The number when it is finite, `fallback` otherwise. */
function finite(candidate: unknown, fallback: number): number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return fallback;
  return candidate;
}

/** Whole days from `from` to `to`, never below zero; null when a date is missing or bad. */
export function ageDays(
  asOf: string,
  listedAt: string | null,
): number | null {
  if (listedAt === null) {
    return null;
  }
  const asOfMs = Date.parse(asOf + 'T00:00:00Z');
  const listedMs = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(asOfMs) || !Number.isFinite(listedMs)) return null;
  const days = Math.floor((asOfMs - listedMs) / DAY_MS);
  return days < 0 ? 0 : days;
}

/** The board-wide figures the radar-9 score is anchored on. The TVL anchor is one definition
 * everywhere: the traded-token median, shrunk by category toward the global median. */
export interface ModelContext {
  anchorByCategory: Map<string, number>; // unified TVL anchor per category (traded-token, shrunk)
  globalAnchor: number; // global traded-token median TVL
  categoryMedian: Map<string, number>; // median seven-day change per category, over the board's rows
  blendAlpha: number; // log-space blend weight: 1 radar alone, 0 flat TVL alone
  flatMultiple: number; // median market-cap-to-TVL over all traded tokens — the flat baseline
}

/**
 * The unified TVL anchor for a priced set: the global median TVL of the traded tokens, and
 * per category the median TVL of that category's traded tokens shrunk toward the global one
 * with w = n / (n + 5), where n is the count of traded tokens with usable TVL in the
 * category. A category with no traded tokens falls back to the global anchor. One definition
 * for the board and the holdout alike; the fitting set differs by context (all traded for
 * the board, the others for a leave-one-out sample, the older half for a by-time sample),
 * as honest validation requires.
 */
export function tvlAnchors(
  traded: SnapshotProtocol[],
): { global: number; byCategory: Map<string, number> } {
  const global = median(traded.map((p) => p.tvl_usd).sort((a, b) => a - b)) ?? 0;
  const byCat = new Map<string, number[]>();
  for (const p of traded) {
    const key = p.category ?? 'Other';
    const values = byCat.get(key) ?? [];
    values.push(p.tvl_usd);
    byCat.set(key, values);
  }
  const byCategory = new Map<string, number>();
  for (const [key, values] of byCat) {
    const med = median(values.sort((a, b) => a - b)) ?? global;
    const n = values.length;
    const w = n / (n + 5);
    byCategory.set(key, w * med + (1 - w) * global);
  }
  return { global, byCategory };
}

/** One protocol's anchor: its category's shrunk median, or the global one. */
export function anchorFor(
  category: string | null,
  anchors: { global: number; byCategory: Map<string, number> },
): number {
  return anchors.byCategory.get(category ?? 'Other') ?? anchors.global;
}

/** One protocol's factors and launch value under the radar-9 formula: the same sub-linear
 * TVL base, now anchored on the unified traded-token anchor, category-relative growth and
 * chain factor, blended in log space with the flat TVL multiple at the rolling-chosen
 * alpha — ln V = alpha x ln V_radar + (1 - alpha) x ln V_flat. Alpha 1 is the radar
 * formula alone, alpha 0 the flat multiple alone (the fallback when no blend passes the
 * rolling gate). No propensity is applied here: the launch value is the primary USD value,
 * and the propensity stays a separate indicator. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  ctx: ModelContext,
): { launchValue: number; tvlBase: number; growthFactor: number; categoryMedian: number | null; chainFactor: number; age: number | null; anchor: number } {
  const protocolAge = ageDays(asOf, protocol.listed_at);
  const anchor = ctx.anchorByCategory.get(protocol.category ?? 'Other') ?? ctx.globalAnchor;
  const tvlBase = model.base_multiple * Math.pow(protocol.tvl_usd, model.tvl_exponent) * Math.pow(anchor, model.median_exponent);
  const catMedian = ctx.categoryMedian.get(protocol.category ?? 'Other') ?? null;
  const growthFactor = protocol.change_7d === null || catMedian === null
    ? 1
    : 1 + model.growth_weight * Math.tanh((protocol.change_7d - catMedian) / model.growth_scale);
  const chainBonus = Math.max(0, Math.min(protocol.chains.length - 1, model.chain_max_steps));
  const chainFactor = 1 + chainBonus * model.chain_step;
  const radarValue = tvlBase * growthFactor * chainFactor;
  const flatValue = ctx.flatMultiple * protocol.tvl_usd;
  const alpha = ctx.blendAlpha;
  const blended = alpha >= 1 ? radarValue : alpha <= 0 ? flatValue : Math.exp(alpha * Math.log(Math.max(1, radarValue)) + (1 - alpha) * Math.log(Math.max(1, flatValue)));
  const launchValue = Math.max(1, Math.round(blended));
  return { launchValue, tvlBase, growthFactor, categoryMedian: catMedian, chainFactor, age: protocolAge, anchor };
}

/** One protocol's implied value under radar-2, the previous release. Comparison only: the
 * board never ranks on it. The old function verbatim: linear TVL, clamped seven-day growth
 * weighted 0.7, a maturity factor that pays older protocols up to 1.54x, and 4% a chain. */
export function impliedValueV2(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstantsV2 = MODEL_V2,
): number {
  const protocolAge = ageDays(asOf, protocol.listed_at);
  const weekChange = finite(protocol.change_7d, 0);
  const growthPct = Math.max(model.growth_floor, Math.min(model.growth_cap, weekChange));
  const growthFactor = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = protocolAge === null ? model.unknown_age_days : protocolAge;
  const cappedAge = Math.max(0, Math.min(ageForModel, model.maturity_days));
  const maturityFactor = model.maturity_floor + (cappedAge / model.maturity_days) * model.maturity_range;
  const chainBonus = Math.max(0, Math.min(protocol.chains.length - 1, model.chain_max_steps));
  const chainFactor = 1 + chainBonus * model.chain_step;
  const sizedValue = protocol.tvl_usd * model.base_multiple;
  return Math.max(1, Math.round(sizedValue * growthFactor * maturityFactor * chainFactor));
}

/** DefiLlama's version-marker test: a name ending in a release is another protocol's pool. */
const VERSIONED = new RegExp('\\s(V\\d+(\\.\\d+)?|v\\d+(\\.\\d+)?|\\d+\\.\\d+)$');

/** Categories the watchlist test keeps out: wrapped, staked and bridged token products. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Restaked BTC', 'Liquid Restaking', 'Liquid Staking', 'Canonical Bridge', 'Bridge']);

/** A name opening with an exchange's name is that exchange's product, not its own launch. */
const EXCHANGE_NAME = new RegExp('^(Gemini|Bitfinex|OKX|Bitget|Kraken|Bybit|Coinbase|Binance)\\b');

/** A whole word wrapped, staked or staking marks a product of a token that trades. */
const WRAPPED_WORD = new RegExp('\\b(staking|staked|wrapped)\\b', 'i');

/** True when a protocol records no token anywhere. */
export function isPreToken(entry: SnapshotProtocol): boolean {
  return entry.symbol === null && entry.gecko_id === null && entry.mcap_usd === null;
}

/**
 * Whether a protocol clears the house's visible test for "not a wrapped, staked or bridged
 * product of a token that already trades", judged from the snapshot's own fields alone. The
 * house's test has one more clause, DefiLlama's parentProtocol, which this file does not carry.
 */
export function passesVisibleRule(entry: SnapshotProtocol): boolean {
  if (entry.category !== null && EXCLUDED_CATEGORIES.has(entry.category)) return false;
  if (WRAPPED_WORD.test(entry.name)) return false;
  if (EXCHANGE_NAME.test(entry.name)) return false;
  if (VERSIONED.test(entry.name)) return false;
  return true;
}

/** True for a protocol the board may rank: pre-token and clearing the visible test. */
export function isRankable(entry: SnapshotProtocol): boolean {
  return isPreToken(entry) && passesVisibleRule(entry);
}

/** Protocols keyed by slug. */
function bySlug(entries: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const lookup = new Map<string, SnapshotProtocol>();
  for (const entry of entries) lookup.set(entry.slug, entry);
  return lookup;
}

/** Median of a sorted list; null for an empty one. */
function median(ordered: number[]): number | null {
  const count = ordered.length;
  if (count === 0) return null;
  const middle = Math.floor(count / 2);
  if (count % 2 === 1) return ordered[middle]!;
  const evenAverage = (ordered[middle - 1]! + ordered[middle]!) / 2;
  return Math.round(evenAverage * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The logistic function, with the exponent clipped so an extreme score cannot overflow. */
function sigmoid(z: number): number {
  const clipped = Math.max(-30, Math.min(30, z));
  return 1 / (1 + Math.exp(-clipped));
}

/**
 * One protocol's category rate, with the protocol itself left out and Laplace smoothing
 * toward one half: a category with few members leans on the prior, a large one on its own
 * record. `selfY` is the protocol's own outcome when it is one of the counted protocols
 * (1 already has a token, 0 records none), or null when it was never counted.
 */
function categoryRate(
  entry: SnapshotProtocol,
  catTotal: Map<string, number>,
  catLaunched: Map<string, number>,
  selfY: number | null,
): number {
  const category = entry.category ?? 'Other';
  const total = (catTotal.get(category) ?? 0) - (selfY === null ? 0 : 1);
  const launched = (catLaunched.get(category) ?? 0) - (selfY === null ? 0 : selfY);
  if (total <= 0) return 0.5;
  return (launched + PROPENSITY.smoothing / 2) / (total + PROPENSITY.smoothing);
}

/**
 * A propensity feature set, in order: 'tvl' is log10 TVL, 'age' is log10 age in days
 * (an unknown age scores as one year, then 30 days are added so a newborn protocol still
 * has a log), 'chains' is the chain count capped at six, 'catRate' is the leave-one-out
 * category rate.
 */
export type FeatureSpec = Array<'tvl' | 'age' | 'chains' | 'catRate'>;

/** One protocol's features under the given spec, in the spec's order. The category rate
 * always leaves the protocol itself out, so no row can leak its own outcome. */
function propensityFeatures(
  entry: SnapshotProtocol,
  asOf: string,
  catTotal: Map<string, number>,
  catLaunched: Map<string, number>,
  selfY: number | null,
  spec: FeatureSpec,
): number[] {
  const out: number[] = [];
  for (const name of spec) {
    if (name === 'tvl') out.push(Math.log10(Math.max(entry.tvl_usd, 1)));
    else if (name === 'age') {
      const age = ageDays(asOf, entry.listed_at);
      out.push(Math.log10((age === null ? PROPENSITY.unknown_age_days : age) + 30));
    } else if (name === 'chains') out.push(Math.min(entry.chains.length, PROPENSITY.max_chains));
    else out.push(categoryRate(entry, catTotal, catLaunched, selfY));
  }
  return out;
}

/**
 * Batch gradient descent on the logistic loss, a fixed number of steps at a fixed rate, so
 * the fit is deterministic: the same snapshot always yields the same weights. The features
 * are standardised on the training set first. No intercept calibration follows: the score is
 * not presented as a calibrated probability, so shifting the intercept to match a base rate
 * would claim a calibration this single snapshot cannot support.
 */
function fitLogistic(
  features: number[][],
  y: number[],
): { weights: number[]; means: number[]; sds: number[] } {
  const n = features.length;
  const dim = features[0]!.length;
  const means = new Array<number>(dim).fill(0);
  const sds = new Array<number>(dim).fill(0);
  for (let d = 0; d < dim; d++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += features[i]![d]!;
    means[d] = sum / n;
  }
  for (let d = 0; d < dim; d++) {
    let sq = 0;
    for (let i = 0; i < n; i++) {
      const diff = features[i]![d]! - means[d]!;
      sq += diff * diff;
    }
    sds[d] = Math.sqrt(sq / n);
    if (sds[d] === 0) sds[d] = 1;
  }
  const x: number[][] = features.map((row) => [1, ...row.map((v, d) => (v - means[d]!) / sds[d]!)]);
  const weights = new Array<number>(dim + 1).fill(0);
  for (let step = 0; step < PROPENSITY.iterations; step++) {
    const grad = new Array<number>(dim + 1).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = x[i]!;
      let z = 0;
      for (let d = 0; d <= dim; d++) z += weights[d]! * xi[d]!;
      const err = sigmoid(z) - y[i]!;
      for (let d = 0; d <= dim; d++) grad[d]! += err * xi[d]!;
    }
    for (let d = 0; d <= dim; d++) weights[d]! -= (PROPENSITY.learning_rate / n) * grad[d]!;
  }
  return { weights, means, sds };
}

/** ROC-AUC from out-of-fold scores: the probability a launched protocol scores above a
 * rankable one, with tied scores sharing the average rank. 0.5 is no discrimination. */
function rocAuc(pairs: Array<{ p: number; y: number }>): number {
  const positives = pairs.filter((pair) => pair.y === 1).length;
  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return 0.5;
  const ordered = [...pairs].sort((a, b) => a.p - b.p || a.y - b.y);
  let rankSum = 0;
  let i = 0;
  while (i < ordered.length) {
    let j = i;
    while (j + 1 < ordered.length && ordered[j + 1]!.p === ordered[i]!.p) j++;
    const averageRank = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) if (ordered[k]!.y === 1) rankSum += averageRank;
    i = j + 1;
  }
  return Math.round(((rankSum - (positives * (positives + 1)) / 2) / (positives * negatives)) * 10000) / 10000;
}

/** Brier score: the mean squared error of the score against the label. Lower is better. */
function brierScore(pairs: Array<{ p: number; y: number }>): number {
  if (pairs.length === 0) return 0;
  const total = pairs.reduce((sum, pair) => sum + (pair.p - pair.y) * (pair.p - pair.y), 0);
  return Math.round((total / pairs.length) * 10000) / 10000;
}

/** Log loss: the mean negative log likelihood of the label under the score, the score
 * clipped away from 0 and 1. Lower is better. */
function logLoss(pairs: Array<{ p: number; y: number }>): number {
  if (pairs.length === 0) return 0;
  let total = 0;
  for (const pair of pairs) {
    const p = Math.max(1e-9, Math.min(1 - 1e-9, pair.p));
    total += pair.y === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return Math.round((total / pairs.length) * 10000) / 10000;
}

/** Calibration by predicted band: the five bands centred on 10%, 30%, 50%, 70% and 90%,
 * each with its count and the actual launched share inside it. */
function calibrationBands(pairs: Array<{ p: number; y: number }>): PropensityBand[] {
  const centres = [0.1, 0.3, 0.5, 0.7, 0.9];
  return centres.map((center) => {
    const inBand = pairs.filter((pair) => pair.p >= center - 0.1 && (center === 0.9 ? pair.p <= 1 : pair.p < center + 0.1));
    const actual = inBand.length === 0 ? 0 : Math.round((inBand.reduce((sum, pair) => sum + pair.y, 0) / inBand.length) * 10000) / 10000;
    return { center, n: inBand.length, actual };
  });
}

/** One score from a fitted model: the protocol's features under the spec, standardised
 * against the training set, through the logistic weights. */
function scoreWith(
  entry: SnapshotProtocol,
  asOf: string,
  fit: { weights: number[]; means: number[]; sds: number[] },
  catTotal: Map<string, number>,
  catLaunched: Map<string, number>,
  selfY: number | null,
  spec: FeatureSpec,
): number {
  const features = propensityFeatures(entry, asOf, catTotal, catLaunched, selfY, spec);
  let z = fit.weights[0]!;
  for (let d = 0; d < features.length; d++) {
    z += fit.weights[d + 1]! * ((features[d]! - fit.means[d]!) / fit.sds[d]!);
  }
  return sigmoid(z);
}

/**
 * One propensity feature spec, fitted and scored on the eligible protocols only: every
 * protocol the board's own visible test keeps, whether it already has a token or records
 * none. Positives and negatives pass the same filter, so a bridge or a liquid-staking
 * product can no longer enter as a positive while a pre-token protocol of the same kind is
 * kept out of the negatives. Sorted by slug so the fit order, and therefore every
 * floating-point sum, is fixed. Quality is measured out of fold — ROC-AUC, Brier score and
 * log loss on the held-out fold, with calibration by predicted band — and again on a time
 * split, the older half fitting the model that scores the newer half by listing date. The
 * newer half is also scored in its older and newer halves separately, so a feature that
 * helps the old half and hurts the new half is caught.
 */
function evaluatePropensitySpec(
  snapshot: Snapshot,
  train: SnapshotProtocol[],
  y: number[],
  spec: FeatureSpec,
): { model: PropensityModel; tsSubOlderAuc: number; tsSubNewerAuc: number } {
  const catTotal = new Map<string, number>();
  const catLaunched = new Map<string, number>();
  for (let i = 0; i < train.length; i++) {
    const key = train[i]!.category ?? 'Other';
    catTotal.set(key, (catTotal.get(key) ?? 0) + 1);
    catLaunched.set(key, (catLaunched.get(key) ?? 0) + y[i]!);
  }
  const features = train.map((entry, i) => propensityFeatures(entry, snapshot.as_of, catTotal, catLaunched, y[i]!, spec));
  const fitted = fitLogistic(features, y);
  // Out-of-fold scores: each fold's model is fitted on the other folds, with its own
  // category counts and standardisation, and scores the held-out fold.
  const oof: Array<{ p: number; y: number }> = [];
  const folds = PROPENSITY.cv_folds;
  for (let fold = 0; fold < folds; fold++) {
    const testIdx: number[] = [];
    const trainIdx: number[] = [];
    for (let i = 0; i < train.length; i++) (i % folds === fold ? testIdx : trainIdx).push(i);
    const foldTotal = new Map<string, number>();
    const foldLaunched = new Map<string, number>();
    for (const i of trainIdx) {
      const key = train[i]!.category ?? 'Other';
      foldTotal.set(key, (foldTotal.get(key) ?? 0) + 1);
      foldLaunched.set(key, (foldLaunched.get(key) ?? 0) + y[i]!);
    }
    const foldFeatures = trainIdx.map((i) => propensityFeatures(train[i]!, snapshot.as_of, foldTotal, foldLaunched, y[i]!, spec));
    const foldY = trainIdx.map((i) => y[i]!);
    const foldFit = fitLogistic(foldFeatures, foldY);
    for (const i of testIdx) {
      oof.push({ p: scoreWith(train[i]!, snapshot.as_of, foldFit, foldTotal, foldLaunched, null, spec), y: y[i]! });
    }
  }
  // Time split: the older half by listing date fits the model that scores the newer half.
  // Protocols with no listing date sit out of this check; the split date is the first
  // listing date of the newer half.
  const dated = train
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.listed_at !== null)
    .sort((a, b) => (a.entry.listed_at! < b.entry.listed_at! ? -1 : a.entry.listed_at! > b.entry.listed_at! ? 1 : a.entry.slug < b.entry.slug ? -1 : a.entry.slug > b.entry.slug ? 1 : 0));
  let timeSplit: PropensityTimeSplit = { split: '', n: 0, roc_auc: 0, brier: 0, log_loss: 0, brier_baseline: 0, log_loss_baseline: 0 };
  let tsSubOlderAuc = 0.5;
  let tsSubNewerAuc = 0.5;
  if (dated.length >= 4) {
    const half = Math.floor(dated.length / 2);
    const older = dated.slice(0, half);
    const newer = dated.slice(half);
    const olderTotal = new Map<string, number>();
    const olderLaunched = new Map<string, number>();
    for (const { entry, i } of older) {
      const key = entry.category ?? 'Other';
      olderTotal.set(key, (olderTotal.get(key) ?? 0) + 1);
      olderLaunched.set(key, (olderLaunched.get(key) ?? 0) + y[i]!);
    }
    const olderFeatures = older.map(({ entry, i }) => propensityFeatures(entry, snapshot.as_of, olderTotal, olderLaunched, y[i]!, spec));
    const olderY = older.map(({ i }) => y[i]!);
    const olderFit = fitLogistic(olderFeatures, olderY);
    const newerPairs = newer.map(({ entry, i }) => ({
      p: scoreWith(entry, snapshot.as_of, olderFit, olderTotal, olderLaunched, null, spec),
      y: y[i]!,
    }));
    // The time-split baselines: what always predicting the training set's base rate scores
    // on the newer half. Brier is the mean squared error of the base rate against the
    // label; log loss is the cross-entropy of the test label mix under the training rate.
    // When the model is worse than its baseline, the dashboard says "below baseline".
    const trainBase = olderY.reduce((sum, v) => sum + v, 0) / olderY.length;
    const testBase = newerPairs.reduce((sum, pair) => sum + pair.y, 0) / newerPairs.length;
    const clippedBase = Math.max(1e-9, Math.min(1 - 1e-9, trainBase));
    const brierBaseline = Math.round((newerPairs.reduce((sum, pair) => sum + (pair.y - trainBase) * (pair.y - trainBase), 0) / newerPairs.length) * 10000) / 10000;
    const logLossBaseline = Math.round((-testBase * Math.log(clippedBase) - (1 - testBase) * Math.log(1 - clippedBase)) * 10000) / 10000;
    timeSplit = {
      split: newer[0]!.entry.listed_at!,
      n: newer.length,
      roc_auc: rocAuc(newerPairs),
      brier: brierScore(newerPairs),
      log_loss: logLoss(newerPairs),
      brier_baseline: brierBaseline,
      log_loss_baseline: logLossBaseline,
    };
    const subHalf = Math.floor(newerPairs.length / 2);
    tsSubOlderAuc = rocAuc(newerPairs.slice(0, subHalf));
    tsSubNewerAuc = rocAuc(newerPairs.slice(subHalf));
  }
  const launched = y.reduce((a, b) => a + b, 0);
  const baseRate = launched / train.length;
  const basePairs = y.map((label) => ({ p: baseRate, y: label }));
  const model: PropensityModel = {
    features: [...spec],
    weights: fitted.weights, means: fitted.means, sds: fitted.sds,
    cat_total: Object.fromEntries(catTotal), cat_launched: Object.fromEntries(catLaunched),
    base_rate: Math.round(baseRate * 10000) / 10000,
    train_size: train.length, launched,
    roc_auc: rocAuc(oof),
    brier: brierScore(oof),
    brier_baseline: brierScore(basePairs),
    log_loss: logLoss(oof),
    log_loss_baseline: logLoss(basePairs),
    calibration: calibrationBands(oof),
    time_split: timeSplit,
  };
  return { model, tsSubOlderAuc, tsSubNewerAuc };
}

/**
 * The age ablation: the same eligible set, fitted three ways — without log age, with it,
 * and with it but no category rate — and the log age feature stays only when it lifts the
 * time-split AUC by at least 0.02, does not worsen the time-split Brier score, and degrades
 * neither half of the newer set by more than 0.02. Log age carries the largest weight but
 * listed_at is DefiLlama's listing date, not the protocol's operating start, and the
 * time-split AUC barely beats chance, so the feature has to earn its place.
 */
export function fitPropensityModel(snapshot: Snapshot): { model: PropensityModel; ablation: AgeAblation } {
  const train = snapshot.protocols
    .filter((entry) => passesVisibleRule(entry))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const y = train.map((entry) => (isPreToken(entry) ? 0 : 1));
  const specA: FeatureSpec = ['tvl', 'chains', 'catRate'];
  const specB: FeatureSpec = ['tvl', 'age', 'chains', 'catRate'];
  const specC: FeatureSpec = ['tvl', 'age', 'chains'];
  const evalA = evaluatePropensitySpec(snapshot, train, y, specA);
  const evalB = evaluatePropensitySpec(snapshot, train, y, specB);
  const evalC = evaluatePropensitySpec(snapshot, train, y, specC);
  const toAblationSpec = (spec: string, result: { model: PropensityModel; tsSubOlderAuc: number; tsSubNewerAuc: number }): AblationSpec => ({
    spec,
    oof_auc: result.model.roc_auc,
    oof_brier: result.model.brier,
    ts_auc: result.model.time_split.roc_auc,
    ts_brier: result.model.time_split.brier,
    ts_sub_older_auc: result.tsSubOlderAuc,
    ts_sub_newer_auc: result.tsSubNewerAuc,
  });
  const ablation: AgeAblation = {
    a_no_age: toAblationSpec('tvl+chains+catRate', evalA),
    b_with_age: toAblationSpec('tvl+age+chains+catRate', evalB),
    c_no_rate: toAblationSpec('tvl+age+chains', evalC),
    kept_age: false,
  };
  ablation.kept_age =
    evalB.model.time_split.roc_auc - evalA.model.time_split.roc_auc >= 0.02
    && evalB.model.time_split.brier <= evalA.model.time_split.brier
    && evalB.tsSubOlderAuc >= evalA.tsSubOlderAuc - 0.02
    && evalB.tsSubNewerAuc >= evalA.tsSubNewerAuc - 0.02;
  return { model: ablation.kept_age ? evalB.model : evalA.model, ablation };
}

/** One protocol's tokenization propensity under the fitted score: its features under the
 * fitted spec, standardised against the training set, through the logistic weights. Board
 * rows are in the training set as rankable pre-token, so their own outcome is left out of
 * the category rate. */
export function propensityScore(
  entry: SnapshotProtocol,
  asOf: string,
  model: PropensityModel,
): number {
  const catTotal = new Map(Object.entries(model.cat_total));
  const catLaunched = new Map(Object.entries(model.cat_launched));
  return scoreWith(
    entry, asOf,
    { weights: model.weights, means: model.means, sds: model.sds },
    catTotal, catLaunched, isPreToken(entry) ? 0 : 1,
    model.features,
  );
}

/** A quantile of a sorted list, by linear interpolation between the two nearest values. */
function quantile(ordered: number[], q: number): number {
  if (ordered.length === 0) return 0;
  const pos = (ordered.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return ordered[lo]!;
  return ordered[lo]! + (ordered[hi]! - ordered[lo]!) * (pos - lo);
}

/** One protocol's value under the radar-9 formula, with anchors fitted on the priced set
 * given: the traded-token anchor (shrunk by category, the one definition shared with the
 * board) and the category growth medians, so the holdout tests the formula's shape, not
 * the board's numbers. */
function valueForHoldout(
  entry: SnapshotProtocol,
  anchors: { global: number; byCategory: Map<string, number> },
  catMedians: Map<string, number>,
  model: ModelConstants,
): number {
  const anchor = anchorFor(entry.category, anchors);
  const tvlBase = model.base_multiple * Math.pow(entry.tvl_usd, model.tvl_exponent) * Math.pow(anchor, model.median_exponent);
  const catMedian = catMedians.get(entry.category ?? 'Other') ?? null;
  const growth = entry.change_7d === null || catMedian === null
    ? 1
    : 1 + model.growth_weight * Math.tanh((entry.change_7d - catMedian) / model.growth_scale);
  const chainBonus = Math.max(0, Math.min(entry.chains.length - 1, model.chain_max_steps));
  return Math.max(1, Math.round(tvlBase * growth * (1 + chainBonus * model.chain_step)));
}

/** The blend weights compared in the rolling validation, in log space: 0 is the flat TVL
 * multiple alone, 1 the radar formula alone. */
export const BLEND_ALPHAS: number[] = [0, 0.25, 0.5, 0.75, 1];

/** Everything a priced set implies: its unified anchor, its category growth medians, and
 * its flat TVL multiple (median market-cap-to-TVL). One definition for the board and the
 * holdout alike; the fitting set differs by context, as honest validation requires. */
export interface PricedSet {
  anchors: { global: number; byCategory: Map<string, number> };
  catMedians: Map<string, number>;
  flatMultiple: number;
}

/** The priced set a group of traded tokens implies: anchors, category medians and the flat
 * multiple, all from that group alone. */
export function pricedSetFor(priced: SnapshotProtocol[]): PricedSet {
  const anchors = tvlAnchors(priced);
  const medians = holdoutMedians(priced);
  return { anchors, catMedians: medians.catMedians, flatMultiple: medians.flatMultiple };
}

/** One protocol's blended value under a priced set: ln V = alpha x ln V_radar + (1 - alpha)
 * x ln V_flat, where V_radar is the radar formula at the model's base and V_flat is the
 * priced set's flat multiple times TVL. Alpha 1 is the radar formula alone, alpha 0 the
 * flat multiple alone. The result is uncalibrated: the caller scales the RADAR component
 * by the scale factor the priced set implies — the flat multiple is already a median and
 * needs no scale — so at alpha 1 the whole prediction carries the scale and at alpha 0 it
 * carries none. */
export function blendedValue(
  entry: SnapshotProtocol,
  set: PricedSet,
  model: ModelConstants,
  alpha: number,
): number {
  const radar = valueForHoldout(entry, set.anchors, set.catMedians, model);
  if (alpha >= 1) return radar;
  const flat = Math.max(1, Math.round(set.flatMultiple * entry.tvl_usd));
  if (alpha <= 0) return flat;
  return Math.max(1, Math.round(Math.exp(alpha * Math.log(radar) + (1 - alpha) * Math.log(flat))));
}

/** The nested leave-one-out pass over a traded set under one blend: pass one prices every
 * token from the others' priced set, keeping the radar and flat components apart; pass two
 * scales each prediction by the median log error of the others — but the scale belongs to
 * the radar component alone. The radar formula's base is arbitrary and needs the traded
 * tokens' median raw log error, while the flat multiple is already a median and needs no
 * correction: scaling the whole blend would add pure noise to the flat component (its raw
 * log errors already centre on zero), so the correction is computed from the radar's raw
 * log errors and applied to the radar component only. At alpha 1 this is identical to
 * scaling the blend; at alpha 0 the blend is the flat multiple untouched. The median raw
 * log error is the scale the set implies — the board's base comes from it — and the nested
 * log errors are the distribution the printed ranges are cut from. */
export interface NestedLoo {
  misses: number[]; // per-sample median miss of the blended value, nested calibration
  flatMisses: number[]; // per-sample miss of the flat TVL multiple
  logErrors: number[]; // nested log errors, log(actual / predicted)
  rawLogErrors: number[]; // raw (pre-calibration) log errors
  p50Raw: number; // median raw log error
}

export function nestedLoo(
  traded: SnapshotProtocol[],
  model: ModelConstants,
  alpha: number,
): NestedLoo {
  const radarRaw: number[] = [];
  const flatPredicted: number[] = [];
  const rawLogErrors: number[] = [];
  const radarLogErrors: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const entry = traded[i]!;
    const others = traded.filter((_, j) => j !== i);
    const set = pricedSetFor(others);
    const radar = valueForHoldout(entry, set.anchors, set.catMedians, model);
    const flat = Math.max(1, Math.round(set.flatMultiple * entry.tvl_usd));
    radarRaw.push(radar);
    flatPredicted.push(flat);
    const blended = alpha >= 1 ? radar : alpha <= 0 ? flat : Math.max(1, Math.round(Math.exp(alpha * Math.log(radar) + (1 - alpha) * Math.log(flat))));
    rawLogErrors.push(Math.log(entry.mcap_usd! / blended));
    radarLogErrors.push(Math.log(entry.mcap_usd! / radar));
  }
  const misses: number[] = [];
  const flatMisses: number[] = [];
  const logErrors: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const othersLog: number[] = [];
    for (let j = 0; j < traded.length; j++) {
      if (j === i) continue;
      othersLog.push(radarLogErrors[j]!);
    }
    const kI = Math.exp(median(othersLog.sort((a, b) => a - b)) ?? 0);
    const radarCal = radarRaw[i]! * kI;
    const predicted = Math.max(1, Math.round(
      alpha >= 1 ? radarCal : alpha <= 0 ? flatPredicted[i]! : Math.exp(alpha * Math.log(Math.max(1, radarCal)) + (1 - alpha) * Math.log(flatPredicted[i]!)),
    ));
    const actual = traded[i]!.mcap_usd!;
    misses.push(Math.max(predicted / actual, actual / predicted));
    flatMisses.push(Math.max(flatPredicted[i]! / actual, actual / flatPredicted[i]!));
    logErrors.push(Math.log(actual / predicted));
  }
  return {
    misses, flatMisses, logErrors, rawLogErrors,
    p50Raw: median([...rawLogErrors].sort((a, b) => a - b)) ?? 0,
  };
}

/** The medians a priced set gives: its per-category median seven-day change and its median
 * market-cap-to-TVL multiple, the flat baseline. The TVL anchor comes from tvlAnchors, the
 * one definition shared with the board. */
function holdoutMedians(
  priced: SnapshotProtocol[],
): { catMedians: Map<string, number>; flatMultiple: number } {
  const byCategory = new Map<string, number[]>();
  for (const p of priced) {
    if (p.change_7d === null) continue;
    const key = p.category ?? 'Other';
    const values = byCategory.get(key) ?? [];
    values.push(p.change_7d);
    byCategory.set(key, values);
  }
  const catMedians = new Map<string, number>();
  for (const [key, values] of byCategory) {
    const med = median(values.sort((a, b) => a - b));
    if (med !== null) catMedians.set(key, med);
  }
  const flatMultiple = median(priced.map((p) => (p.mcap_usd ?? 0) / p.tvl_usd).sort((a, b) => a - b)) ?? 0;
  return { catMedians, flatMultiple };
}

/**
 * The out-of-sample holdout tests on the traded-token protocols, under the blend `alpha`,
 * with NESTED calibration: leave-one-out (each token priced from a fit on the others, and
 * its own scale factor k_i taken from the others' log errors, so its own market cap never
 * enters its own calibration) and by-time (the older half, by listing date, fits the model
 * and the scale factor that prices the newer half), each against a flat TVL-multiple
 * baseline. The printed ranges are cut from the older half's nested leave-one-out log
 * errors, in a pass over the older half alone and frozen before the newer half is scored
 * — the Historical model error range (P20-P80) and P10-P90 — and their coverage is
 * measured on the by-time held-out caps, so the coverage number is a strict held-out
 * number, not a re-scored in-sample one.
 */
export function holdoutValidation(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  alpha: number = 1,
): HoldoutSummary {
  const empty: HoldoutSummary = {
    loo_n: 0, loo_median_miss: 0, loo_flat_median_miss: 0, loo_within_2x: 0,
    bytime_n: 0, bytime_split: '', bytime_median_miss: 0, bytime_flat_median_miss: 0,
    bytime_train_log_median: 0, bytime_test_log_median: 0,
    log_p10: 0, log_p20: 0, log_p50: 0, log_p80: 0, log_p90: 0, log_p50_raw: 0,
    range_lo_factor: 0, range_hi_factor: 0, range_lo10_factor: 0, range_hi90_factor: 0,
    coverage_central60: 0, coverage_1090: 0,
  };
  const traded = snapshot.protocols
    .filter((entry) => entry.mcap_usd !== null && entry.mcap_usd > 0 && entry.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (traded.length < 2) return empty;
  // The nested leave-one-out pass, under the blend being evaluated: pass one prices every
  // traded token from the others' priced set, pass two scales each prediction by the median
  // log error of the others. The median raw log error is the scale the traded tokens
  // imply; it sets the value base, and it is reported as log_p50_raw so the board's base
  // can be audited — the misses below never reuse it.
  const loo = nestedLoo(traded, model, alpha);
  const misses = loo.misses;
  const flatMisses = loo.flatMisses;
  const logErrors = loo.logErrors;
  const sortedLog = [...logErrors].sort((a, b) => a - b);
  const p10 = quantile(sortedLog, 0.1);
  const p20 = quantile(sortedLog, 0.2);
  const p50 = quantile(sortedLog, 0.5);
  const p80 = quantile(sortedLog, 0.8);
  const p90 = quantile(sortedLog, 0.9);
  const p50Raw = loo.p50Raw;
  const within2x = misses.filter((m) => m <= 2).length / misses.length;
  const dated = traded
    .filter((entry) => entry.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  // The printed range bands are cut from the OLDER half's nested leave-one-out errors
  // only, in a pass over the older half alone — so no newer market cap enters the bands
  // through the calibration scale either — and frozen before the newer half is scored.
  // Without a dated split there is no newer half to score, so the bands fall back to
  // the whole set's distribution.
  let bandLog = sortedLog;
  if (dated.length >= 4) {
    const half = Math.floor(dated.length / 2);
    const olderLoo = nestedLoo(dated.slice(0, half), model, alpha);
    const olderSorted = [...olderLoo.logErrors].sort((a, b) => a - b);
    if (olderSorted.length > 0) bandLog = olderSorted;
  }
  const rangeLo = round4(Math.exp(quantile(bandLog, 0.2)));
  const rangeHi = round4(Math.exp(quantile(bandLog, 0.8)));
  const rangeLo10 = round4(Math.exp(quantile(bandLog, 0.1)));
  const rangeHi90 = round4(Math.exp(quantile(bandLog, 0.9)));
  let bytimeN = 0;
  let bytimeSplit = '';
  let bytimeMiss = 0;
  let bytimeFlatMiss = 0;
  let bytimeTrainLogMedian = 0;
  let bytimeTestLogMedian = 0;
  let coverageCentral60 = 0;
  let coverage1090 = 0;
  if (dated.length >= 4) {
    const half = Math.floor(dated.length / 2);
    const older = dated.slice(0, half);
    const newer = dated.slice(half);
    const trainSet = pricedSetFor(older);
    // The by-time scale factor comes from the OLD samples only, fixed before any newer
    // sample is priced — and it belongs to the radar component alone, as in the nested
    // leave-one-out pass: the radar formula's base is arbitrary and needs the scale, the
    // flat multiple is already a median. Each old sample's radar value is priced from the
    // old set's priced set, the median of their log errors sets k_train, and the newer half
    // is priced with the radar component scaled by it. No newer market cap enters the
    // calibration. The train and test log medians below are the blend's raw log errors —
    // the scale drift between the halves — not the calibrated ones.
    const trainRadarLog = older.map((entry) => Math.log(entry.mcap_usd! / valueForHoldout(entry, trainSet.anchors, trainSet.catMedians, model)));
    const kTrain = Math.exp(median(trainRadarLog.sort((a, b) => a - b)) ?? 0);
    const trainLog = older.map((entry) => Math.log(entry.mcap_usd! / blendedValue(entry, trainSet, model, alpha)));
    const trainLogMedian = median([...trainLog].sort((a, b) => a - b)) ?? 0;
    const testLogMedian = median(newer.map((entry) => Math.log(entry.mcap_usd! / blendedValue(entry, trainSet, model, alpha))).sort((a, b) => a - b)) ?? 0;
    const byMisses: number[] = [];
    const byFlatMisses: number[] = [];
    let inCentral60 = 0;
    let in1090 = 0;
    for (const entry of newer) {
      const radar = valueForHoldout(entry, trainSet.anchors, trainSet.catMedians, model) * kTrain;
      const flat = trainSet.flatMultiple * entry.tvl_usd;
      const blended = alpha >= 1 ? radar : alpha <= 0 ? flat : Math.exp(alpha * Math.log(Math.max(1, radar)) + (1 - alpha) * Math.log(Math.max(1, flat)));
      const predicted = Math.max(1, Math.round(blended));
      const flatPredicted = Math.max(1, Math.round(trainSet.flatMultiple * entry.tvl_usd));
      const actual = entry.mcap_usd!;
      byMisses.push(Math.max(predicted / actual, actual / predicted));
      byFlatMisses.push(Math.max(flatPredicted / actual, actual / flatPredicted));
      if (predicted * rangeLo <= actual && actual <= predicted * rangeHi) inCentral60++;
      if (predicted * rangeLo10 <= actual && actual <= predicted * rangeHi90) in1090++;
    }
    bytimeN = newer.length;
    bytimeSplit = newer[0]!.listed_at!;
    bytimeMiss = median(byMisses.sort((a, b) => a - b)) ?? 0;
    bytimeFlatMiss = median(byFlatMisses.sort((a, b) => a - b)) ?? 0;
    bytimeTrainLogMedian = trainLogMedian;
    bytimeTestLogMedian = testLogMedian;
    coverageCentral60 = Math.round((inCentral60 / newer.length) * 10000) / 10000;
    coverage1090 = Math.round((in1090 / newer.length) * 10000) / 10000;
  }
  return {
    loo_n: traded.length,
    loo_median_miss: median(misses.sort((a, b) => a - b)) ?? 0,
    loo_flat_median_miss: median(flatMisses.sort((a, b) => a - b)) ?? 0,
    loo_within_2x: Math.round(within2x * 10000) / 10000,
    bytime_n: bytimeN, bytime_split: bytimeSplit,
    bytime_median_miss: round4(bytimeMiss), bytime_flat_median_miss: round4(bytimeFlatMiss),
    bytime_train_log_median: round4(bytimeTrainLogMedian), bytime_test_log_median: round4(bytimeTestLogMedian),
    log_p10: round4(p10), log_p20: round4(p20), log_p50: round4(p50),
    log_p80: round4(p80), log_p90: round4(p90), log_p50_raw: round4(p50Raw),
    range_lo_factor: rangeLo, range_hi_factor: rangeHi,
    range_lo10_factor: rangeLo10, range_hi90_factor: rangeHi90,
    coverage_central60: coverageCentral60, coverage_1090: coverage1090,
  };
}

/**
 * The strict rolling validation: the dated traded tokens, ordered by listing date, split
 * into an initial training set (the first half) and four consecutive test blocks. Each
 * block is priced from prior data only — its anchor, category medians, flat multiple and
 * scale factor all come from the training set before it — so no future sample enters any
 * block's calibration. The first three blocks pick alpha among the alphas that pass the
 * gate; the fourth block is held out as final validation and can only veto through the
 * gate, never pick. The gate runs in two stages: stage 1, blocks 1-3 pick — the pooled
 * median miss over blocks 1-3 at least 10% below flat, and at least 2 of the 3 blocks
 * better than flat; stage 2, block 4 only vetoes — the held-out block not more than 10%
 * worse than flat. Block 4 enters no selection number. When no alpha passes, the board
 * falls back to the flat TVL multiple. The category-multiple experiment runs the same
 * two-stage gate on one extra value model and is reported whatever it says; it never
 * changes the board in this release.
 *
 * One adaptation the snapshot forces: 95 of the 128 traded tokens carry a listing date,
 * so the rolling runs on 95 — an initial 47 and four blocks of 12 — not the 64 + 4x16 the
 * full 128 would give. Undated tokens sit out of the rolling; they stay in the
 * leave-one-out and by-time checks.
 */
/**
 * The category-multiple experiment: one extra value model, tested honestly under the
 * same two-stage gate as the blends and reported whatever it says. Per category, the
 * median market-cap-to-TVL among the training tokens, shrunk toward the global training
 * median by w = n_c / (n_c + 5); a category with no traded tokens falls back to the
 * global median. Each block is priced from prior data only, blocks 1-3 select, block 4
 * only vetoes. The board never uses it in this release — the experiment is reported so
 * the next review can judge whether a better value model exists at all.
 */
function categoryMultipleValidation(
  dated: SnapshotProtocol[],
  initialN: number,
  blockSize: number,
  blocks: SnapshotProtocol[][],
): CatMultipleValidation {
  const perBlockMiss: number[] = [];
  const flatPerBlock: number[] = [];
  const misses123: number[] = [];
  const flat123: number[] = [];
  for (let b = 0; b < 4; b++) {
    const trainEnd = initialN + b * blockSize;
    const train = dated.slice(0, trainEnd);
    const test = blocks[b]!;
    const globalMed = median(train.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b)) ?? 0;
    const byCat = new Map<string, number[]>();
    for (const p of train) {
      const key = p.category ?? 'Other';
      const values = byCat.get(key) ?? [];
      values.push(p.mcap_usd! / p.tvl_usd);
      byCat.set(key, values);
    }
    const multByCat = new Map<string, number>();
    for (const [key, values] of byCat) {
      const med = median(values.sort((a, b) => a - b)) ?? globalMed;
      const w = values.length / (values.length + 5);
      multByCat.set(key, w * med + (1 - w) * globalMed);
    }
    const misses: number[] = [];
    const flatMisses: number[] = [];
    for (const entry of test) {
      const mult = multByCat.get(entry.category ?? 'Other') ?? globalMed;
      const predicted = Math.max(1, Math.round(mult * entry.tvl_usd));
      const flat = Math.max(1, Math.round(globalMed * entry.tvl_usd));
      const actual = entry.mcap_usd!;
      misses.push(Math.max(predicted / actual, actual / predicted));
      flatMisses.push(Math.max(flat / actual, actual / flat));
    }
    perBlockMiss.push(median([...misses].sort((a, b) => a - b)) ?? 0);
    flatPerBlock.push(median([...flatMisses].sort((a, b) => a - b)) ?? 0);
    if (b < 3) { misses123.push(...misses); flat123.push(...flatMisses); }
  }
  const pooled123 = median(misses123.sort((a, b) => a - b)) ?? 0;
  const flatPooled123 = median(flat123.sort((a, b) => a - b)) ?? 0;
  let better = 0;
  for (let b = 0; b < 3; b++) if (perBlockMiss[b]! < flatPerBlock[b]!) better++;
  const trainGate = pooled123 <= 0.9 * flatPooled123 && better >= 2;
  const veto = perBlockMiss[3]! <= 1.1 * flatPerBlock[3]!;
  return {
    per_block_miss: perBlockMiss.map((m) => round4(m)),
    flat_per_block_miss: flatPerBlock.map((m) => round4(m)),
    pooled_miss_123: round4(pooled123),
    flat_pooled_123: round4(flatPooled123),
    train_gate: trainGate, veto, passed: trainGate && veto,
  };
}

export function rollingValidation(
  snapshot: Snapshot,
): RollingValidation {
  const empty: RollingValidation = {
    alphas: [...BLEND_ALPHAS],
    dated_n: 0, initial_n: 0, block_n: 0,
    pooled_miss_by_alpha: BLEND_ALPHAS.map(() => 0),
    flat_pooled_miss: 0,
    gate_by_alpha: BLEND_ALPHAS.map(() => false),
    chosen_alpha: 0, board_uses_flat: true,
    cat_multiple: {
      per_block_miss: [], flat_per_block_miss: [],
      pooled_miss_123: 0, flat_pooled_123: 0,
      train_gate: false, veto: false, passed: false,
    },
    blocks: [],
  };
  const traded = snapshot.protocols
    .filter((entry) => entry.mcap_usd !== null && entry.mcap_usd > 0 && entry.tvl_usd > 0);
  const dated = traded
    .filter((entry) => entry.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (dated.length < 8) return empty;
  const initialN = Math.floor(dated.length / 2);
  const rest = dated.length - initialN;
  const blockSize = Math.floor(rest / 4);
  if (blockSize < 1) return empty;
  const blocks: SnapshotProtocol[][] = [];
  for (let b = 0; b < 4; b++) {
    const start = initialN + b * blockSize;
    const end = b === 3 ? dated.length : start + blockSize;
    blocks.push(dated.slice(start, end));
  }
  // Per block and per alpha: the block priced from prior data only. The block's scale
  // factor belongs to the radar component alone — exp(median log error of the training
  // set's radar values), the same rule nestedLoo uses — so the scale never sees the
  // block it prices and the flat multiple stays untouched. At alpha 0 the prediction is
  // the flat multiple exactly; at alpha 1 the calibrated radar alone. Range endpoints
  // come from the training set's nested leave-one-out log errors under the same alpha —
  // prior data only, never the block.
  const blockMiss: number[][] = []; // [block][alpha] median miss
  const blockFlatMiss: number[] = [];
  const blockCentral: number[][] = []; // [block][alpha] Historical model error range coverage
  const blockP1090: number[][] = []; // [block][alpha] P10-P90 coverage
  const blockMisses: number[][][] = []; // [block][alpha] per-sample misses, for the pooled medians
  const blockFlatMisses: number[][] = [];
  for (let b = 0; b < 4; b++) {
    const trainEnd = initialN + b * blockSize;
    const train = dated.slice(0, trainEnd);
    const test = blocks[b]!;
    const trainSet = pricedSetFor(train);
    const endpoints: Array<{ lo: number; hi: number; lo10: number; hi90: number }> = BLEND_ALPHAS.map((alpha) => {
      const loo = nestedLoo(train, MODEL, alpha);
      const ordered = [...loo.logErrors].sort((x, y) => x - y);
      return {
        lo: Math.exp(quantile(ordered, 0.2)),
        hi: Math.exp(quantile(ordered, 0.8)),
        lo10: Math.exp(quantile(ordered, 0.1)),
        hi90: Math.exp(quantile(ordered, 0.9)),
      };
    });
    const missRow: number[] = [];
    const centralRow: number[] = [];
    const p1090Row: number[] = [];
    const missesRow: number[][] = [];
    const trainRadarLog = train.map((entry) => Math.log(entry.mcap_usd! / valueForHoldout(entry, trainSet.anchors, trainSet.catMedians, MODEL)));
    const kRadar = Math.exp(median(trainRadarLog.sort((x, y) => x - y)) ?? 0);
    for (let a = 0; a < BLEND_ALPHAS.length; a++) {
      const alpha = BLEND_ALPHAS[a]!;
      const ep = endpoints[a]!;
      const misses: number[] = [];
      let inCentral = 0;
      let in1090 = 0;
      for (const entry of test) {
        const radar = valueForHoldout(entry, trainSet.anchors, trainSet.catMedians, MODEL) * kRadar;
        const flat = trainSet.flatMultiple * entry.tvl_usd;
        const blended = alpha >= 1 ? radar : alpha <= 0 ? flat : Math.exp(alpha * Math.log(Math.max(1, radar)) + (1 - alpha) * Math.log(Math.max(1, flat)));
        const predicted = Math.max(1, Math.round(blended));
        const actual = entry.mcap_usd!;
        misses.push(Math.max(predicted / actual, actual / predicted));
        if (predicted * ep.lo <= actual && actual <= predicted * ep.hi) inCentral++;
        if (predicted * ep.lo10 <= actual && actual <= predicted * ep.hi90) in1090++;
      }
      missRow.push(median([...misses].sort((x, y) => x - y)) ?? 0);
      centralRow.push(Math.round((inCentral / test.length) * 10000) / 10000);
      p1090Row.push(Math.round((in1090 / test.length) * 10000) / 10000);
      missesRow.push(misses);
    }
    const flatMisses = test.map((entry) => {
      const flat = Math.max(1, Math.round(trainSet.flatMultiple * entry.tvl_usd));
      const actual = entry.mcap_usd!;
      return Math.max(flat / actual, actual / flat);
    });
    blockMiss.push(missRow);
    blockCentral.push(centralRow);
    blockP1090.push(p1090Row);
    blockMisses.push(missesRow);
    blockFlatMiss.push(median([...flatMisses].sort((x, y) => x - y)) ?? 0);
    blockFlatMisses.push(flatMisses);
  }
  // Pooled medians over blocks 1-3 only: block 4 never enters a selection number.
  const pooledByAlpha = BLEND_ALPHAS.map((_, a) => {
    const pooled: number[] = [];
    for (let b = 0; b < 3; b++) pooled.push(...blockMisses[b]![a]!);
    return median(pooled.sort((x, y) => x - y)) ?? 0;
  });
  const flatPooled = median(blockFlatMisses.slice(0, 3).flat().sort((x, y) => x - y)) ?? 0;
  // The gate, per alpha, in two stages so the held-out block never picks the model.
  // Stage 1, selection on blocks 1-3 only: the pooled median miss over blocks 1-3 at
  // least 10% below flat, and at least 2 of the 3 blocks better than flat. Stage 2,
  // veto on block 4 only: the held-out block not more than 10% worse than flat.
  const gateByAlpha = BLEND_ALPHAS.map((_, a) => {
    const tenPct = pooledByAlpha[a]! <= 0.9 * flatPooled;
    let better = 0;
    for (let b = 0; b < 3; b++) if (blockMiss[b]![a]! < blockFlatMiss[b]!) better++;
    const trainGate = tenPct && better >= 2;
    const lastOk = blockMiss[3]![a]! <= 1.1 * blockFlatMiss[3]!;
    return trainGate && lastOk;
  });
  // The category-multiple experiment runs the same two-stage gate and is reported
  // whatever it says; it never changes the board in this release.
  const catMultiple = categoryMultipleValidation(dated, initialN, blockSize, blocks);
  // Pick the best gate-passing alpha on blocks 1-3; only a strictly lower pooled miss
  // replaces the pick, so ties keep the smaller alpha, the simpler model. When none
  // passes, the board falls back to flat TVL.
  let chosen = 0;
  let bestPooled = Infinity;
  for (let a = 0; a < BLEND_ALPHAS.length; a++) {
    if (!gateByAlpha[a]) continue;
    if (pooledByAlpha[a]! < bestPooled - 1e-9) {
      bestPooled = pooledByAlpha[a]!;
      chosen = BLEND_ALPHAS[a]!;
    }
  }
  const boardUsesFlat = !gateByAlpha.some((g) => g);
  const chosenAlpha = boardUsesFlat ? 0 : chosen;
  const chosenIdx = BLEND_ALPHAS.indexOf(chosenAlpha);
  const blocksOut: RollingBlock[] = blocks.map((test, b) => ({
    block: b + 1,
    start: test[0]!.listed_at!,
    end: test[test.length - 1]!.listed_at!,
    n: test.length,
    train_n: initialN + b * blockSize,
    flat_median_miss: round4(blockFlatMiss[b]!),
    chosen_median_miss: round4(blockMiss[b]![chosenIdx]!),
    alpha_median_miss: blockMiss[b]!.map((m) => round4(m)),
    central60_coverage: blockCentral[b]![chosenIdx]!,
    p1090_coverage: blockP1090[b]![chosenIdx]!,
  }));
  return {
    alphas: [...BLEND_ALPHAS],
    dated_n: dated.length, initial_n: initialN, block_n: blockSize,
    pooled_miss_by_alpha: pooledByAlpha.map((m) => round4(m)),
    flat_pooled_miss: round4(flatPooled),
    gate_by_alpha: gateByAlpha,
    chosen_alpha: chosenAlpha,
    board_uses_flat: boardUsesFlat,
    cat_multiple: catMultiple,
    blocks: blocksOut,
  };
}

/**
 * The full accounting of the snapshot: every protocol in exactly one group. Ranked first,
 * then a token that already trades, then the exclusion reasons in the order the visible test
 * applies them — bridge, liquid staking or restaking, exchange custody, versioned release,
 * wrapped or staked by name.
 */
export function accountingOf(snapshot: Snapshot): AccountingGroup[] {
  const groups: Array<[string, string]> = [
    ['ranked', 'Ranked on the board'],
    ['has_token', 'Token already trades'],
    ['bridge', 'Bridge'],
    ['liquid_staking', 'Liquid staking or restaking'],
    ['exchange', 'Exchange custody'],
    ['versioned', 'Versioned release'],
    ['wrapped', 'Wrapped or staked by name'],
  ];
  const counts = new Map<string, number>(groups.map(([key]) => [key, 0]));
  for (const entry of snapshot.protocols) {
    const key = isRankable(entry) ? 'ranked'
      : isPreToken(entry) === false ? 'has_token'
      : entry.category === 'Bridge' || entry.category === 'Canonical Bridge' ? 'bridge'
      : entry.category === 'Liquid Staking' || entry.category === 'Liquid Restaking' || entry.category === 'Restaked BTC' ? 'liquid_staking'
      : entry.category === 'CEX' ? 'exchange'
      : VERSIONED.test(entry.name) ? 'versioned'
      : 'wrapped';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return groups.map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0 }));
}

/** The opportunity cost of the capital over the hold: the plan size at the 5% annual
 * rate for the hold's days — the model's own cost of capital, stated as an assumption,
 * not a market rate. */
export function opportunityCostFor(size: number, holdDays: number): number {
  return (size * FARM.opportunity_rate * holdDays) / 365;
}

/** The conditional net of farming one protocol at one plan size under one drop-share
 * scenario: the drop share of the launch value, allocated in proportion to the plan's share
 * of TVL, less the gas and the opportunity cost of the capital over the hold. Conditional
 * means assuming the protocol launches and the drop is allocated pro-rata to TVL share —
 * it is not an expected return, and the launch odds are not multiplied in. The drop is
 * modelled as split by capital share of TVL — a simplification, stated as one in the
 * dashboard, since real drops pay on points and activity rather than TVL share. Gas is a
 * conservative budget that follows the hold: 2 setup transactions, one weekly action per
 * full week, 1 exit — 7 on a 30-day plan, 9 on 45 days, 11 on 60 — each priced on the
 * chain it actually runs on. */
export function farmNet(
  entry: SnapshotProtocol,
  valueIfLaunches: number,
  age: number | null,
  size: number,
  dropShare: number,
): number {
  return farmNetAtGas(entry, valueIfLaunches, age, size, dropShare, 1);
}

/** The conditional net at one gas scale: gasScale 1 is the budget the verdicts use; 1.5
 * and 2 are the sensitivity cases the drawer prints — the verdicts never change. The
 * gas scale multiplies the gas budget only; the reward and the opportunity cost are
 * untouched. */
export function farmNetAtGas(
  entry: SnapshotProtocol,
  valueIfLaunches: number,
  age: number | null,
  size: number,
  dropShare: number,
  gasScale: number,
): number {
  const hold = holdDaysFor(age);
  const gas = gasForPlan(entry, hold) * gasScale;
  const reward = entry.tvl_usd > 0 ? valueIfLaunches * dropShare * (size / entry.tvl_usd) : 0;
  return Math.round((reward - gas - opportunityCostFor(size, hold)) * 100) / 100;
}

/** The drop share at which a farm plan breaks even: the share of the launch value where
 * the reward covers the gas plus the opportunity cost of the capital over the hold.
 * Reward = launchValue x dropShare x capital / TVL, so the break-even share is
 * (gas + opportunityCost) x TVL / (launchValue x capital); on a flat board the launch
 * value is the flat multiple times TVL and this reduces to (gas + opportunityCost) /
 * (flatMultiple x capital) — the reward itself does not depend on TVL, only the gas,
 * the hold and the capital do. Above 1 the plan never breaks even, even if the whole
 * launch value were dropped. */
export function breakevenDropShare(
  entry: SnapshotProtocol,
  valueIfLaunches: number,
  age: number | null,
  size: number,
): number {
  const hold = holdDaysFor(age);
  const cost = gasForPlan(entry, hold) + opportunityCostFor(size, hold);
  if (entry.tvl_usd <= 0 || valueIfLaunches <= 0 || size <= 0) return 0;
  return Math.round(((cost * entry.tvl_usd) / (valueIfLaunches * size)) * 10000) / 10000;
}

/** The farm verdict at one gas scale: the same rules as farmVerdictFor, with the gas
 * budget multiplied — the sensitivity cases the drawer prints, never the verdicts. */
export function farmVerdictAtGas(
  entry: SnapshotProtocol,
  valueIfLaunches: number,
  age: number | null,
  gasScale: number,
): FarmVerdict {
  return farmVerdictFor(
    farmNetAtGas(entry, valueIfLaunches, age, FARM.plan_small, FARM.drop_share_conservative, gasScale),
    farmNetAtGas(entry, valueIfLaunches, age, FARM.plan_small, FARM.drop_share_neutral, gasScale),
    farmNetAtGas(entry, valueIfLaunches, age, FARM.plan_large, FARM.drop_share_neutral, gasScale),
  );
}

/** The farm verdict, judged on each plan size independently: Farm when even the conservative
 * 1% drop clears the threshold on the $1,000 plan, Marginal when the neutral 3% drop clears
 * zero — on the $1,000 plan, or on the $10,000 plan when the small plan does not clear it —
 * Skip when neither plan clears zero at 3%. */
export function farmVerdictFor(
  netSmallConservative: number,
  netSmallNeutral: number,
  netLargeNeutral: number,
): FarmVerdict {
  if (netSmallConservative > FARM.farm_threshold) return 'Farm';
  if (netSmallNeutral > 0) return 'Marginal';
  if (netLargeNeutral > 0) return 'Marginal';
  return 'Skip';
}

/** The board's protocols, strongest first, ranked 1..n. The blend is the rolling-chosen
 * log-space weight between the radar formula and the flat TVL multiple — alpha 0 is the
 * flat fallback when no blend passes the rolling gate. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  propensity: PropensityModel,
  holdout: HoldoutSummary,
  blend: { alpha: number; flatMultiple: number },
): BoardRow[] {
  const lookup = bySlug(snapshot.protocols);
  const picked = new Map<string, SnapshotProtocol>();
  const offList = new Set<string>();
  // The watchlist is the floor: each slug it names joins the board, even one the snapshot no
  // longer carries (it cannot, but board coverage is the gate's row and never rests on a record
  // that might be missing).
  for (const listedSlug of snapshot.watchlist) {
    const entry = lookup.get(listedSlug);
    if (entry !== undefined) picked.set(listedSlug, entry);
  }
  // The early radar: every rankable protocol the watchlist does not name, at any TVL. No TVL
  // cap, no hand-picking: the test decides, and the test is the house's own. A protocol above
  // the floor that the watchlist skips is ranked and flagged OFF LIST rather than dropped:
  // the visible test clears it, and the flag carries the house's omission in the open.
  // A picked protocol stays picked.
  const newcomers = snapshot.protocols
    .filter((entry) => picked.has(entry.slug) === false && isRankable(entry))
    .sort((x, y) => y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
  for (const entry of newcomers) {
    picked.set(entry.slug, entry);
    if (entry.tvl_usd >= snapshot.floor_usd) offList.add(entry.slug);
  }

  // The TVL anchor is one definition everywhere: the traded-token median, shrunk by
  // category, computed here over all traded tokens. The growth medians stay board-wide,
  // computed over the picked rows before any row is scored, so every row scores against
  // the same anchors.
  const pickedRows = [...picked.values()];
  const traded = snapshot.protocols
    .filter((entry) => entry.mcap_usd !== null && entry.mcap_usd > 0 && entry.tvl_usd > 0);
  const anchors = tvlAnchors(traded);
  const growthByCategory = new Map<string, number[]>();
  for (const entry of pickedRows) {
    if (entry.change_7d === null) continue;
    const key = entry.category ?? 'Other';
    const values = growthByCategory.get(key) ?? [];
    values.push(entry.change_7d);
    growthByCategory.set(key, values);
  }
  const categoryMedian = new Map<string, number>();
  for (const [key, values] of growthByCategory) {
    const med = median(values.sort((a, b) => a - b));
    if (med !== null) categoryMedian.set(key, med);
  }
  const ctx: ModelContext = { anchorByCategory: anchors.byCategory, globalAnchor: anchors.global, categoryMedian, blendAlpha: blend.alpha, flatMultiple: blend.flatMultiple };

  // Radar-9 scores each row as three separate numbers: the launch value is the primary USD
  // value and the board's ranking; the tokenization propensity is an auxiliary indicator,
  // never multiplied into a USD value; the propensity-weighted priority is launch value times
  // propensity, a unitless sort aid. The launch value blends the radar formula with the
  // flat TVL multiple at the rolling-chosen alpha — alpha 0 is the flat fallback. The
  // range is the holdout error distribution around the launch value, assuming a launch.
  // The farm verdict is judged on each plan size independently, from the conditional nets
  // under the drop-share scenarios.
  const scored = pickedRows.map((entry) => {
    const result = impliedValue(entry, snapshot.as_of, model, ctx);
    const propensityValue = propensityScore(entry, snapshot.as_of, propensity);
    const valueIfLaunches = result.launchValue;
    const implied = valueIfLaunches;
    const priority = valueIfLaunches * propensityValue;
    return { entry, ...result, propensityValue, valueIfLaunches, implied, priority };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.entry.slug < b.entry.slug ? -1 : a.entry.slug > b.entry.slug ? 1 : 0));
  // Flat and radar ranks: where the row stands by the flat TVL value alone and by the
  // radar formula alone, so the reader sees where the two models disagree. Ties break
  // on slug, the same order the board uses.
  const flatRankBySlug = new Map<string, number>();
  [...scored].sort((a, b) => blend.flatMultiple * b.entry.tvl_usd - blend.flatMultiple * a.entry.tvl_usd || (a.entry.slug < b.entry.slug ? -1 : a.entry.slug > b.entry.slug ? 1 : 0))
    .forEach((item, i) => flatRankBySlug.set(item.entry.slug, i + 1));
  const radarRankBySlug = new Map<string, number>();
  [...scored].sort((a, b) => (b.tvlBase * b.growthFactor * b.chainFactor) - (a.tvlBase * a.growthFactor * a.chainFactor) || (a.entry.slug < b.entry.slug ? -1 : a.entry.slug > b.entry.slug ? 1 : 0))
    .forEach((item, i) => radarRankBySlug.set(item.entry.slug, i + 1));
  return scored.map((item, i) => {
    const netSmallConservative = farmNet(item.entry, item.valueIfLaunches, item.age, FARM.plan_small, FARM.drop_share_conservative);
    const netSmall = farmNet(item.entry, item.valueIfLaunches, item.age, FARM.plan_small, FARM.drop_share_neutral);
    const netSmallOptimistic = farmNet(item.entry, item.valueIfLaunches, item.age, FARM.plan_small, FARM.drop_share_optimistic);
    const netLarge = farmNet(item.entry, item.valueIfLaunches, item.age, FARM.plan_large, FARM.drop_share_neutral);
    const verdict = farmVerdictFor(netSmallConservative, netSmall, netLarge);
    const planSize = verdict === 'Marginal' && netSmall <= 0 ? FARM.plan_large : FARM.plan_small;
    const state = planStateFor(item.entry, item.age);
    const flatRank = flatRankBySlug.get(item.entry.slug)!;
    const radarRank = radarRankBySlug.get(item.entry.slug)!;
    // The gas total comes from the backend alone: gasForPlan here is the single source,
    // the dashboard displays this number and never recomputes it. The break-even share
    // and the gas sensitivity are computed from the same backend numbers, at the row's
    // own plan size — the sensitivity never changes the verdict.
    const gasTotal = gasForPlan(item.entry, holdDaysFor(item.age));
    const breakeven = breakevenDropShare(item.entry, item.valueIfLaunches, item.age, planSize);
    const netPlanGas50 = farmNetAtGas(item.entry, item.valueIfLaunches, item.age, planSize, FARM.drop_share_neutral, 1.5);
    const netPlanGas100 = farmNetAtGas(item.entry, item.valueIfLaunches, item.age, planSize, FARM.drop_share_neutral, 2);
    const verdictGas50 = farmVerdictAtGas(item.entry, item.valueIfLaunches, item.age, 1.5);
    const verdictGas100 = farmVerdictAtGas(item.entry, item.valueIfLaunches, item.age, 2);
    return {
      rank: i + 1, slug: item.entry.slug, name: item.entry.name,
      category: item.entry.category, chains: item.entry.chains, tvl_usd: item.entry.tvl_usd,
      change_7d: item.entry.change_7d, mcap_usd: item.entry.mcap_usd,
      listed_at: item.entry.listed_at, gecko_id: item.entry.gecko_id, symbol: item.entry.symbol,
      token_status: 'pre-token', age_days: item.age, implied_value_usd: item.implied,
      value_if_launches_usd: item.valueIfLaunches,
      propensity: item.propensityValue,
      priority_score: Math.round(item.priority * 100) / 100,
      range_lo_usd: Math.max(1, Math.round(item.implied * holdout.range_lo_factor)),
      range_hi_usd: Math.max(1, Math.round(item.implied * holdout.range_hi_factor)),
      range_lo10_usd: Math.max(1, Math.round(item.implied * holdout.range_lo10_factor)),
      range_hi90_usd: Math.max(1, Math.round(item.implied * holdout.range_hi90_factor)),
      farm_verdict: verdict,
      farm_plan_size: planSize,
      plan_state: state,
      gas_total_usd: gasTotal,
      breakeven_drop_share: breakeven,
      net_plan_gas50_usd: netPlanGas50,
      net_plan_gas100_usd: netPlanGas100,
      verdict_gas50: verdictGas50,
      verdict_gas100: verdictGas100,
      flat_rank: flatRank, radar_rank: radarRank, rank_diff: flatRank - radarRank,
      net_1000_usd: netSmall, net_10000_usd: netLarge,
      net_1000_conservative_usd: netSmallConservative, net_1000_optimistic_usd: netSmallOptimistic,
      off_list: offList.has(item.entry.slug),
      model: {
        tvl_base: round2(item.tvlBase), growth_factor: round4(item.growthFactor),
        category_median_7d: item.categoryMedian, chain_factor: round4(item.chainFactor),
        tvl_median: item.anchor,
      },
      farm_steps: farmSteps(item.entry, item.age, planSize, state).map(stepText),
    };
  });
}

/** One step as a single string: action, cost and time, 20..600 characters. */
export function stepText(
  step: FarmStep,
): string {
  let rendered = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (rendered.length > 600) rendered = rendered.slice(0, 596) + '...';
  if (rendered.length < 20) rendered = rendered + ' Hold the position and check the protocol\'s own page.';
  return rendered;
}

/** A protocol's first named chain, or a neutral phrase when it names none. */
function chainOf(entry: SnapshotProtocol): string {
  return entry.chains[0] ?? 'its main chain';
}

/** A protocol's second named chain, or null when it runs on one chain. */
function secondChainOf(entry: SnapshotProtocol): string | null {
  return entry.chains[1] ?? null;
}

/**
 * How executable a protocol's farm plan is, from the snapshot alone. Category-supported: a large,
 * long-running protocol in a category with one canonical product — the category names the
 * product, and the size and age make it likely to exist, but it is not a live check of the
 * specific vault or pool. Conditional: the category names the kind but the protocol is not
 * large and long-running enough to trust it alone, so the steps are hypotheticals.
 * Research first: the category names no product to pin an interaction on, so the plan
 * starts with research.
 */
export function planStateFor(entry: SnapshotProtocol, age: number | null): PlanState {
  const kind = (entry.category ?? '').toLowerCase();
  // The categories the farm plan can name a product for: every branch of actionFor except
  // a bare chain, whose apps are not named by the snapshot.
  const specific = ['uncollateralized', 'cdp', 'lend', 'collateral', 'interest rate', 'perpetual', 'derivative', 'basis', 'options', 'leveraged farm', 'dex', 'liquidity manager', 'yield aggregator', 'yield', 'curator', 'allocator', 'restak', 'staking', 'bridge', 'rwa', 'wrapper', 'stable', 'btc', 'prediction', 'insurance', 'launchpad', 'token locker', 'otc', 'cedefi', 'payment', 'governance', 'card', 'index', 'farm'];
  const named = specific.some((c) => kind.includes(c));
  if (named && entry.tvl_usd >= 500_000_000 && age !== null && age >= 365) return 'Category-supported';
  if (named) return 'Conditional';
  return 'Research first';
}

/** Gas for one setup transaction, as an estimate range by chain: gas moves with the network,
 * so the plan quotes a range, never a flat fee it cannot know. */
function gasRange(entry: SnapshotProtocol): string {
  return chainOf(entry) === 'Ethereum' ? '$8-15' : '$1-5';
}

/** Hold length from the protocol's age: younger ones get a longer window. */
function holdDaysFor(ageInDays: number | null): number {
  return ageInDays === null ? 30 : ageInDays < 180 ? 60 : ageInDays < 365 ? 45 : 30;
}

/** A TVL figure as the dashboard prints it: $2.75B, $376.0M, $5.0M, $850K. */
function fmtTvl(value: number): string {
  if (value >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
  if (value >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
  if (value >= 1e3) return '$' + Math.round(value / 1e3) + 'K';
  return '$' + Math.round(value);
}

/** A seven-day change as signed per cent, two decimals. */
function fmtPct(value: number): string {
  return (value > 0 ? '+' : '') + value.toFixed(2) + '%';
}

/** Entry timing from the protocol's own seven-day TVL change. */
function growthNote(entry: SnapshotProtocol): string {
  const change = entry.change_7d;
  if (change === null) return 'The snapshot carries no seven-day change, so enter at the standard size and let the first month set the pace.';
  if (change >= 20) return 'TVL is up ' + fmtPct(change) + ' in seven days, so fund the position this week while the growth is fresh.';
  if (change >= 5) return 'TVL is up ' + fmtPct(change) + ' in seven days, so enter now rather than waiting for a pullback.';
  if (change > -5) return 'TVL is near flat over seven days (' + fmtPct(change) + '), so there is no rush to fund it all at once.';
  if (change > -20) return 'TVL is down ' + fmtPct(change) + ' in seven days, so fund half now and the rest only after the decline flattens.';
  return 'TVL is down ' + fmtPct(change) + ' in seven days, so start with half the capital and wait for two flat snapshots before adding.';
}

/** What the hold is for, from the protocol's own age. */
function ageNote(ageInDays: number | null, hold: number): string {
  if (ageInDays === null) return 'The snapshot carries no listing date, so treat the hold as the full ' + hold + ' days.';
  if (ageInDays < 90) return 'It was listed only ' + ageInDays + ' days ago, so the full ' + hold + '-day hold matters: a young protocol is judged on more than one snapshot.';
  if (ageInDays < 365) return 'It has run ' + ageInDays + ' days with no token, so hold the full ' + hold + ' days to cross another snapshot cycle.';
  return 'It has run ' + ageInDays + ' days with no token, so the hold is about the snapshot cycle, not about waiting on the team.';
}

/**
 * One action for the category, worded so a farmer can follow it. The category comes from the
 * snapshot's own field, and the action is derived the same way for every protocol of that kind.
 * Each branch names the asset, the venue and the chain, and adds the mechanic that makes the
 * kind different: the borrow for a lender, the hedge for a perp, the receipt for a staker.
 * Every branch is conditional on the protocol running that product: the category names the
 * kind, never the product — a vault, a pool or a farm is only farmed when the protocol's own
 * page shows it. Never a token name, never a promised airdrop: the plan farms the protocol
 * as it stands.
 */
function actionFor(entry: SnapshotProtocol, capital: number, chain: string): string {
  const kind = (entry.category ?? '').toLowerCase();
  const label = entry.name;
  if (kind.includes('uncollateralized')) return 'If ' + label + ' lends to a borrower pool, lend $' + capital + ' of USDC through it on ' + chain + ' and keep the loan receipts.';
  if (kind.includes('cdp')) return 'If ' + label + ' mints a stablecoin against collateral, lock $' + capital + ' of USDC in it on ' + chain + ' and keep the collateral ratio above the liquidation line.';
  if (kind.includes('lend') || kind.includes('collateral')) return 'If ' + label + ' runs a lending market, supply $' + capital + ' of USDC to it on ' + chain + ', borrow a small amount against it, and keep the health factor above the liquidation line.';
  if (kind.includes('interest rate')) return 'If ' + label + ' offers interest-rate positions, deposit $' + capital + ' of USDC as margin for one on ' + chain + ', and close it before the rate leg moves against you.';
  if (kind.includes('perpetual') || kind.includes('derivative')) return 'If ' + label + ' runs a perpetual or derivatives market, deposit $' + capital + ' of USDC as margin on ' + chain + ', open one small hedged position, and set a stop so it closes before liquidation.';
  if (kind.includes('basis')) return 'If ' + label + ' runs a basis vault on ' + chain + ', deposit $' + capital + ' of USDC into it and hold the delta-neutral position while funding stays positive.';
  if (kind.includes('options')) return 'If ' + label + ' runs an options vault on ' + chain + ', deposit $' + capital + ' of USDC into it and hold the vault shares through one expiry.';
  if (kind.includes('leveraged farm')) return 'If ' + label + ' runs a leveraged farm on ' + chain + ', deposit $' + capital + ' of USDC into it at the lowest leverage it offers, and watch the borrow rate daily.';
  if (kind.includes('dex')) return 'If ' + label + ' runs a liquidity pool on ' + chain + ', provide $' + capital + ' of liquidity to its main pool, keeping the position in range, and collect the trading fees.';
  if (kind.includes('liquidity manager')) return 'If ' + label + ' runs a managed vault on ' + chain + ', deposit $' + capital + ' of USDC into it and let the manager rebalance the range; keep the shares.';
  if (kind.includes('yield aggregator')) return 'If ' + label + ' runs a vault on ' + chain + ', deposit $' + capital + ' of USDC into its main vault and keep the shares while the strategy runs.';
  if (kind.includes('yield')) return 'If ' + label + ' runs a yield vault on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the shares while the yield runs.';
  if (kind.includes('curator')) return 'If ' + label + ' runs a curated vault on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the vault shares; the curator picks the underlying markets, not you.';
  if (kind.includes('allocator')) return 'If ' + label + ' runs an allocator vault on ' + chain + ', deposit $' + capital + ' of USDC into it and let it rotate the funds between strategies.';
  if (kind.includes('restak')) return 'If ' + label + ' accepts restaking on ' + chain + ', restake $' + capital + ' of the receipt token through it and keep the restaking receipt.';
  if (kind.includes('staking')) return 'If ' + label + ' runs staking on ' + chain + ', stake $' + capital + ' of the chain\'s staking asset through it and keep the receipt token.';
  if (kind.includes('bridge')) return 'If ' + label + ' bridges USDC to ' + chain + ', bridge $' + capital + ' of USDC through it and use the bridged funds in its app the same week.';
  if (kind.includes('chain')) return 'Bridge $' + capital + ' of USDC to ' + label + ' and, if it runs native apps, use two of them in the same week, starting with the largest one you can find on its own page.';
  if (kind.includes('rwa')) return 'If ' + label + ' issues a yield-bearing asset on ' + chain + ', mint $' + capital + ' of it and hold it; read the backing report on the protocol\'s own page first.';
  if (kind.includes('wrapper')) return 'If ' + label + ' wraps USDC into a wrapped stable on ' + chain + ', wrap $' + capital + ' of it and hold the wrapped tokens.';
  if (kind.includes('stable')) return 'If ' + label + ' issues or holds a stable asset on ' + chain + ', mint or deposit $' + capital + ' of it and hold it through one peg check a week.';
  if (kind.includes('btc')) return 'If ' + label + ' accepts BTC deposits on ' + chain + ', deposit $' + capital + ' of BTC through it and keep the receipt token until the hold ends.';
  if (kind.includes('prediction')) return 'If ' + label + ' runs a prediction market on ' + chain + ', fund $' + capital + ' and place one market position on it, then settle it when the market resolves.';
  if (kind.includes('insurance')) return 'If ' + label + ' sells cover on ' + chain + ', buy $' + capital + ' of it and keep the policy open through the hold.';
  if (kind.includes('launchpad')) return 'If ' + label + ' runs a launch on ' + chain + ', join one with $' + capital + ' on ' + chain + ' and hold the allocation through the lock-up.';
  if (kind.includes('token locker')) return 'If ' + label + ' runs a locker on ' + chain + ', lock $' + capital + ' of an asset in it for the shortest term it offers.';
  if (kind.includes('otc')) return 'If ' + label + ' runs an OTC desk on ' + chain + ', place one trade of $' + capital + ' through it and keep the trade receipt.';
  if (kind.includes('cedefi')) return 'If ' + label + ' runs a CeDeFi vault on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the position open; the vault runs off-chain strategies.';
  if (kind.includes('payment')) return 'If ' + label + ' handles payments on ' + chain + ', pay or receive $' + capital + ' through it and keep the payment receipt.';
  if (kind.includes('governance')) return 'If ' + label + ' has a governance asset and an open proposal, lock $' + capital + ' of it through ' + label + ' on ' + chain + ' and cast one vote.';
  if (kind.includes('card')) return 'If ' + label + ' issues a card, spend $' + capital + ' through it on ' + chain + ' and keep the statement for the farm log.';
  if (kind.includes('index')) return 'If ' + label + ' runs an index on ' + chain + ', buy $' + capital + ' of it and hold the shares through one rebalance.';
  if (kind.includes('farm')) return 'If ' + label + ' runs a farm on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the position open through one reward cycle.';
  return 'If ' + label + ' accepts deposits on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the position open.';
}

/** The weekly qualifying action for the protocol's kind; repeated weekly it reads as one farmer. */
function weeklyActionFor(entry: SnapshotProtocol): string {
  const kind = (entry.category ?? '').toLowerCase();
  if (kind.includes('interest rate') || kind.includes('perpetual') || kind.includes('derivative') || kind.includes('options') || kind.includes('basis')) return 'one small trade or hedge, and close it before funding eats the margin';
  if (kind.includes('lend') || kind.includes('cdp') || kind.includes('collateral')) return 'a borrow, a repay or a new supply, and check the health factor each time';
  if (kind.includes('dex') || kind.includes('liquidity manager')) return 'a swap or a liquidity change in the same pool';
  if (kind.includes('staking') || kind.includes('restak')) return 'a stake top-up or a rewards check';
  if (kind.includes('rwa') || kind.includes('stable') || kind.includes('wrapper')) return 'a peg or backing check';
  if (kind.includes('yield') || kind.includes('curator') || kind.includes('allocator') || kind.includes('farm') || kind.includes('leveraged farm')) return 'a vault deposit or a rewards check';
  if (kind.includes('prediction')) return 'one market position, settled when the market resolves';
  if (kind.includes('governance')) return 'a vote or a forum post on the next proposal';
  if (kind.includes('bridge') || kind.includes('chain')) return 'one bridge or one app interaction on the same chain';
  const fallbackAction = 'a deposit, a swap or a vote';
  return fallbackAction;
}

/** What to check before claiming anything: the page that shows the position is real. */
function checkActionFor(entry: SnapshotProtocol, chain: string): string {
  const kind = (entry.category ?? '').toLowerCase();
  const label = entry.name;
  if (kind.includes('lend') || kind.includes('cdp') || kind.includes('collateral')) return 'Open ' + label + '\'s dashboard on ' + chain + ' and check the borrow rate and your health factor.';
  if (kind.includes('interest rate') || kind.includes('perpetual') || kind.includes('derivative') || kind.includes('options') || kind.includes('basis')) return 'Open ' + label + '\'s trading page on ' + chain + ' and check funding, margin and any open position.';
  if (kind.includes('dex') || kind.includes('liquidity manager')) return 'Open ' + label + '\'s page on ' + chain + ' and check the pool, if it runs one, and the fees earned and whether the position is still in range.';
  if (kind.includes('staking') || kind.includes('restak')) return 'Open ' + label + '\'s page on ' + chain + ' and check the staking rewards accrued on your receipt token, if it runs staking.';
  if (kind.includes('rwa') || kind.includes('stable') || kind.includes('wrapper')) return 'Open ' + label + '\'s page on ' + chain + ' and check the peg and the backing report.';
  if (kind.includes('yield') || kind.includes('curator') || kind.includes('allocator') || kind.includes('farm') || kind.includes('leveraged farm')) return 'Open ' + label + '\'s page on ' + chain + ' and check the vault, if it runs one, and the yield accrued and the vault\'s current strategy.';
  if (kind.includes('bridge') || kind.includes('chain')) return 'Open ' + label + ' on ' + chain + ' and check the bridged balance arrived before you move on.';
  if (kind.includes('prediction')) return 'Open ' + label + ' and check whether your market has resolved.';
  if (kind.includes('governance')) return 'Open ' + label + '\'s governance page on ' + chain + ' and check the next proposal.';
  if (kind.includes('insurance')) return 'Open ' + label + '\'s cover page on ' + chain + ' and check the policy is still active.';
  return 'Open ' + label + '\'s own page on ' + chain + ' and check whether it runs a points or rewards program; if it does, check what the wallet has earned.';
}

/** How to unwind, in the order that kind demands: the loan before the supply, the trade before the margin. */
function exitActionFor(entry: SnapshotProtocol): string {
  const kind = (entry.category ?? '').toLowerCase();
  if (kind.includes('lend') || kind.includes('cdp') || kind.includes('collateral')) return 'Repay the borrow first, then withdraw the supply.';
  if (kind.includes('interest rate') || kind.includes('perpetual') || kind.includes('derivative') || kind.includes('options') || kind.includes('basis')) return 'Close the open position first, then withdraw the margin.';
  if (kind.includes('dex') || kind.includes('liquidity manager')) return 'Remove the liquidity in one transaction, then check the fees landed.';
  if (kind.includes('staking') || kind.includes('restak')) return 'Unstake the receipt token and wait out the unbonding period.';
  if (kind.includes('rwa') || kind.includes('stable') || kind.includes('wrapper')) return 'Redeem the asset back to USDC and check the peg at redemption.';
  if (kind.includes('yield') || kind.includes('curator') || kind.includes('allocator') || kind.includes('farm') || kind.includes('leveraged farm')) return 'Withdraw the vault shares and check the final yield.';
  if (kind.includes('bridge') || kind.includes('chain')) return 'Bridge the funds back to your home chain before you close the wallet.';
  return 'Withdraw the full position in one go.';
}

/**
 * A protocol's farm plan at one plan size: eight steps, each an action with a cost and a
 * time, derived from the protocol's own record (category, chains, TVL, seven-day change,
 * age) and never from a hand-written list of names. The plan size is $1,000, or $10,000
 * for a Marginal earned on the large plan — the step amounts say which. The second step
 * is the risk check, before any deposit: the reward is modelled as the plan's share of
 * TVL, and the position carries protocol risk, impermanent loss and bridging costs. The
 * entry step times the funding by the seven-day change, the weekly step alternates the
 * chains the protocol actually runs on, the hold step is sized by the protocol's own age
 * and TVL, and the last step is the exit rule, priced by the TVL the farmer entered at.
 * The gas budget follows the hold — 2 setup, one weekly action per full week, 1 exit,
 * each priced on its chain — a conservative budget, not a live quote. The plan state
 * decides how direct the steps are: a Research first plan starts with research and never
 * writes an unverified step as an executable instruction.
 * Nothing here promises a token or an airdrop: the plan farms the protocol as it stands.
 */
export function farmSteps(
  entry: SnapshotProtocol,
  age: number | null,
  planSize: number,
  state: PlanState,
): FarmStep[] {
  const firstChain = chainOf(entry);
  const secondChain = secondChainOf(entry);
  const stake = planSize;
  const holdDays = holdDaysFor(age);
  const gasTotal = gasForPlan(entry, holdDays);
  const nTx = gasTransactionsFor(holdDays);
  const gas = gasRange(entry);
  const secondChainClause = secondChain === null ? '' : ' If you farm on both chains, alternate weeks between ' + firstChain + ' and ' + secondChain + '.';
  const youngClause = age !== null && age < 90 ? ' The protocol is only ' + age + ' days old, so check its announcements weekly too.' : '';
  const logSecond = secondChain === null ? '' : ' Note the second chain, ' + secondChain + ', if you farmed there too.';
  const stateClause = state === 'Category-supported'
    ? 'Plan state: Category-supported — ' + entry.name + ' is large and long-running in ' + (entry.category ?? 'its category') + ', a category with one canonical product; the name means the category supports a product, not that the specific vault or pool was checked — still check its own page before depositing.'
    : state === 'Conditional'
      ? 'Plan state: Conditional — the steps below are category-inferred hypotheticals; deposit only if ' + entry.name + ' actually runs the product named.'
      : 'Plan state: Research first — the snapshot does not pin down a product for ' + entry.name + '; start by reading its own page and only fund it once you have named the product.';
  const actionStep = state === 'Research first'
    ? 'Research ' + entry.name + ' on its own page first: find what it actually runs — a vault, a pool, a market — and only fund $' + stake + ' of USDC into a product you have named. Do not deposit on the category alone.'
    : actionFor(entry, stake, firstChain);
  const weeklyStep = state === 'Research first'
    ? 'If the research step found a product, do one qualifying action each week, such as ' + weeklyActionFor(entry) + ', so the week\'s activity counts toward it.' + secondChainClause + youngClause
    : 'If ' + entry.name + ' runs a points program, do one qualifying action each week, such as ' + weeklyActionFor(entry) + ', so the week\'s activity counts toward it.' + secondChainClause + youngClause;
  const mk = (text: string, cost: string, time: string): FarmStep => ({ text, cost, time });
  const plan: FarmStep[] = [
    mk('Set up a fresh wallet on ' + firstChain + ' with $' + stake + ' of USDC and a gas budget of roughly $' + gasTotal.toFixed(2) + ' (' + nTx + ' transactions across the plan\'s chains — a conservative budget, gas moves with the network), and keep its seed phrase offline. ' + growthNote(entry) + ' ' + stateClause, 'gas budget of roughly $' + gasTotal.toFixed(2) + ' (' + nTx + ' transactions, estimate)', '10 minutes'),
    mk('Risks before you fund: the reward is modelled as your capital\'s share of TVL — real drops pay on points and activity, not TVL share. The position carries protocol risk, impermanent loss in a liquidity position, and bridging costs if you move chains.', 'nothing but the risk check', '10 minutes'),
    mk(actionStep, '$' + stake + ' of capital and gas of roughly ' + gas + ' (estimate)', '15 minutes to set up'),
    mk(weeklyStep, 'a few dollars of gas a week', '10 minutes a week'),
    mk('Hold the position for at least ' + holdDays + ' days so the activity is counted in more than one snapshot. ' + ageNote(age, holdDays) + ' TVL is ' + fmtTvl(entry.tvl_usd) + ', so your $' + stake + ' position is a small share of the pool.', 'the $' + stake + ' stays in the position', holdDays + ' days'),
    mk(checkActionFor(entry, firstChain) + ' Claim only from the link the protocol itself publishes, and never pay to claim.', 'no fee to check, and never pay to claim', '10 minutes'),
    mk('Write the wallet, the dates and every transaction in a farm log: ' + entry.name + ' on ' + firstChain + ', $' + stake + ' entered, hold ends after ' + holdDays + ' days.' + logSecond, 'nothing but the log', '5 minutes'),
    mk('Recheck ' + entry.name + '\'s TVL and seven-day growth once a month; if TVL halves from ' + fmtTvl(entry.tvl_usd) + ', unwind the position. ' + exitActionFor(entry), 'nothing to check', '5 minutes a month'),
  ];
  return plan;
}

/** Live-token protocols by market cap, for the dashboard's Live token view. */
export function liveRows(
  snapshot: Snapshot,
): LiveRow[] {
  const entries = snapshot.protocols;
  return entries
    .filter((entry) => isPreToken(entry) === false && entry.category !== 'CEX')
    .sort((x, y) => (y.mcap_usd ?? 0) - (x.mcap_usd ?? 0) || y.tvl_usd - x.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((entry) => ({
      slug: entry.slug, name: entry.name, category: entry.category, chains: entry.chains,
      tvl_usd: entry.tvl_usd, mcap_usd: entry.mcap_usd, change_7d: entry.change_7d,
    }));
}

/**
 * A board row in compact form for data.js; the farm plan is generated in the page. The category
 * figures show the row's standing among its own kind: TVL rank inside its category, and the
 * category's median seven-day growth, so a reader can tell a fast grower from a category where
 * everything grows.
 */
export function radarRow(
  boardRow: BoardRow,
  tvlRank: number | null,
  growthMedian: number | null,
  isListed: boolean,
  v2Rank: number,
  v2Implied: number,
): RadarRow {
  const out: RadarRow = {
    rank: boardRow.rank, slug: boardRow.slug, name: boardRow.name,
    category: boardRow.category, chains: boardRow.chains, tvl_usd: boardRow.tvl_usd,
    change_7d: boardRow.change_7d, mcap_usd: boardRow.mcap_usd,
    listed_at: boardRow.listed_at, age_days: boardRow.age_days,
    implied_value_usd: boardRow.implied_value_usd,
    value_if_launches_usd: boardRow.value_if_launches_usd,
    propensity: boardRow.propensity,
    priority_score: boardRow.priority_score,
    range_lo_usd: boardRow.range_lo_usd, range_hi_usd: boardRow.range_hi_usd,
    range_lo10_usd: boardRow.range_lo10_usd, range_hi90_usd: boardRow.range_hi90_usd,
    farm_verdict: boardRow.farm_verdict, off_list: boardRow.off_list,
    farm_plan_size: boardRow.farm_plan_size, plan_state: boardRow.plan_state,
    gas_total_usd: boardRow.gas_total_usd,
    breakeven_drop_share: boardRow.breakeven_drop_share,
    net_plan_gas50_usd: boardRow.net_plan_gas50_usd,
    net_plan_gas100_usd: boardRow.net_plan_gas100_usd,
    verdict_gas50: boardRow.verdict_gas50,
    verdict_gas100: boardRow.verdict_gas100,
    flat_rank: boardRow.flat_rank, radar_rank: boardRow.radar_rank, rank_diff: boardRow.rank_diff,
    net_1000_usd: boardRow.net_1000_usd, net_10000_usd: boardRow.net_10000_usd,
    net_1000_conservative_usd: boardRow.net_1000_conservative_usd,
    net_1000_optimistic_usd: boardRow.net_1000_optimistic_usd,
    growth_factor: boardRow.model.growth_factor,
    chain_factor: boardRow.model.chain_factor,
    tvl_base: boardRow.model.tvl_base,
    category_median_7d: boardRow.model.category_median_7d,
    tvl_median: boardRow.model.tvl_median,
    v2_rank: v2Rank, v2_implied: v2Implied,
    category_tvl_rank: tvlRank, category_growth_median: growthMedian,
    on_watchlist: isListed, farm_steps: boardRow.farm_steps,
  };
  return out;
}

/** Spearman rank correlation between two rankings of the same rows, each 1..n. */
function spearman(v2Rank: Map<string, number>, currentRank: Map<string, number>): number {
  const n = v2Rank.size;
  if (n < 2) return 1;
  let squared = 0;
  for (const [slug, r2] of v2Rank) {
    const rNow = currentRank.get(slug) ?? 0;
    squared += (r2 - rNow) * (r2 - rNow);
  }
  return Math.round((1 - (6 * squared) / (n * (n * n - 1))) * 10000) / 10000;
}

/**
 * The four ratios that carry a row's RADAR component from its radar-2 value: their product
 * is the radar component's value over implied_v2, within a dollar of rounding. Growth is
 * the category-relative tanh factor over the old clamped factor; compression is the
 * sub-linear base over the old linear one, including the calibrated scale k and the row's
 * own unified anchor; age is the old maturity factor dropped; chain is the 3% step over
 * the old 4%. The board value blends that radar component toward the flat TVL multiple at
 * the rolling-chosen alpha, so the product is the radar component's ratio, not the board
 * value's. The tokenization propensity is not a ratio here: radar-9 does not multiply it
 * into the value, so it cannot move a row against radar-2.
 */
function changeRatios(
  row: BoardRow,
  calibratedBase: number,
): { growth: number; compression: number; age: number; chain: number } {
  const change = row.change_7d === null ? 0 : row.change_7d;
  const clamped = Math.max(MODEL_V2.growth_floor, Math.min(MODEL_V2.growth_cap, change));
  const growthV2 = 1 + (clamped / 100) * MODEL_V2.growth_weight;
  const growth = row.model.growth_factor / growthV2;
  const compression = (calibratedBase / MODEL_V2.base_multiple) * Math.pow(row.model.tvl_median / row.tvl_usd, 0.15);
  const ageForModel = row.age_days === null ? MODEL_V2.unknown_age_days : row.age_days;
  const cappedAge = Math.max(0, Math.min(ageForModel, MODEL_V2.maturity_days));
  const maturityV2 = MODEL_V2.maturity_floor + (cappedAge / MODEL_V2.maturity_days) * MODEL_V2.maturity_range;
  const age = 1 / maturityV2;
  const chainBonus = Math.max(0, Math.min(row.chains.length - 1, MODEL_V2.chain_max_steps));
  const chainV2 = 1 + chainBonus * MODEL_V2.chain_step;
  const chain = row.model.chain_factor / chainV2;
  return { growth, compression, age, chain };
}

/** One line saying which factor drove a row's move between the releases. Each factor is measured
 * against the board median of that factor, so the reason names what moved this row relative to
 * the board, not what moved the whole board. */
function moveReason(
  row: BoardRow,
  ratios: { growth: number; compression: number; age: number; chain: number },
  medians: { growth: number; compression: number; age: number; chain: number },
  movedUp: boolean,
): string {
  const relative = {
    growth: ratios.growth / medians.growth,
    compression: ratios.compression / medians.compression,
    age: ratios.age / medians.age,
    chain: ratios.chain / medians.chain,
  };
  const entries: Array<[string, number]> = [['growth', relative.growth], ['compression', relative.compression], ['age', relative.age], ['chain', relative.chain]];
  const inDirection = entries.filter(([, value]) => (movedUp ? value > 1 : value < 1));
  const pick = (inDirection.length > 0 ? inDirection : entries)
    .sort((a, b) => Math.abs(Math.log(b[1])) - Math.abs(Math.log(a[1])))[0]!;
  const kind = pick[0];
  const change = row.change_7d;
  const catMedian = row.model.category_median_7d;
  if (kind === 'growth') {
    if (change === null || catMedian === null) return 'No seven-day change on record, so the growth factor scores 1 while other rows move on theirs.';
    const clamped = Math.max(MODEL_V2.growth_floor, Math.min(MODEL_V2.growth_cap, change));
    const growthV2 = 1 + (clamped / 100) * MODEL_V2.growth_weight;
    if (movedUp) return 'Outgrew its category: seven-day change ' + fmtPct(change) + ' against a ' + (row.category ?? 'Other') + ' median of ' + fmtPct(catMedian) + ' (growth ' + row.model.growth_factor.toFixed(2) + 'x, where radar-2 paid ' + growthV2.toFixed(2) + 'x).';
    if (growthV2 >= 1.5) return 'The seven-day spike radar-2 rewarded at ' + growthV2.toFixed(2) + 'x is capped at ' + row.model.growth_factor.toFixed(2) + 'x under radar-9: seven-day change ' + fmtPct(change) + ' against a ' + (row.category ?? 'Other') + ' median of ' + fmtPct(catMedian) + '.';
    return 'Lagged its category: seven-day change ' + fmtPct(change) + ' against a ' + (row.category ?? 'Other') + ' median of ' + fmtPct(catMedian) + ' (growth ' + row.model.growth_factor.toFixed(2) + 'x, where radar-2 paid ' + growthV2.toFixed(2) + 'x).';
  }
  if (kind === 'compression') {
    if (movedUp) return 'Small TVL: the sub-linear base lifts it against the old linear TVL.';
    return 'Large TVL: the sub-linear base compresses it against the old linear TVL.';
  }
  if (kind === 'age') {
    if (movedUp) return 'Young protocol: the age discount is gone, so it is no longer held back for being ' + (row.age_days === null ? 'unlisted' : String(row.age_days)) + ' days old.';
    return 'Old protocol: at ' + (row.age_days === null ? 'unlisted' : String(row.age_days)) + ' days it gets no lift from the age discount being gone, while younger protocols around it rise.';
  }
  return 'Chain breadth: the chain step fell from 4% to 3%, so extra chains count for less than they did.';
}

/** The radar-2 versus radar-9 comparison: Spearman correlation and the biggest movers. */
function buildComparison(
  ranked: BoardRow[],
  v2RankBySlug: Map<string, number>,
  calibratedBase: number,
): ModelComparison {
  const currentRankBySlug = new Map<string, number>();
  ranked.forEach((row, i) => currentRankBySlug.set(row.slug, i + 1));
  const spearmanValue = spearman(v2RankBySlug, currentRankBySlug);
  const ratiosBySlug = new Map<string, { growth: number; compression: number; age: number; chain: number }>();
  for (const row of ranked) ratiosBySlug.set(row.slug, changeRatios(row, calibratedBase));
  const medians = {
    growth: median([...ratiosBySlug.values()].map((r) => r.growth).sort((a, b) => a - b)) ?? 1,
    compression: median([...ratiosBySlug.values()].map((r) => r.compression).sort((a, b) => a - b)) ?? 1,
    age: median([...ratiosBySlug.values()].map((r) => r.age).sort((a, b) => a - b)) ?? 1,
    chain: median([...ratiosBySlug.values()].map((r) => r.chain).sort((a, b) => a - b)) ?? 1,
  };
  const movers = ranked.map((row) => {
    const v2Rank = v2RankBySlug.get(row.slug) ?? 0;
    const delta = v2Rank - row.rank;
    return {
      slug: row.slug, name: row.name, v2_rank: v2Rank, current_rank: row.rank,
      reason: moveReason(row, ratiosBySlug.get(row.slug)!, medians, delta > 0),
      delta,
    };
  });
  const rises = movers.filter((m) => m.delta > 0).sort((a, b) => b.delta - a.delta || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)).slice(0, 5)
    .map(({ slug, name, v2_rank, current_rank, reason }) => ({ slug, name, v2_rank, current_rank, reason }));
  const falls = movers.filter((m) => m.delta < 0).sort((a, b) => a.delta - b.delta || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)).slice(0, 5)
    .map(({ slug, name, v2_rank, current_rank, reason }) => ({ slug, name, v2_rank, current_rank, reason }));
  return { spearman: spearmanValue, rises, falls };
}

/** The dashboard's dataset, built from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const { model: propensity, ablation } = fitPropensityModel(snapshot);
  // Directional scale calibration: the first holdout pass prices the traded tokens with the
  // round 0.25 base; k is exp(median raw log error), the scale the traded tokens themselves
  // imply, so the board runs on 0.25 x k. The holdout numbers the dashboard prints come
  // from nested calibration — each test sample's own scale factor is taken from the others —
  // so the reported misses are honest, not re-priced with the scale they were calibrated
  // with. The second pass, with the calibrated base in place, is the one reported — and
  // with the rolling-chosen blend weight, so the holdout numbers describe the model the
  // board actually runs.
  const firstHoldout = holdoutValidation(snapshot, model);
  const scaleK = Math.exp(firstHoldout.log_p50_raw);
  const calibrated: ModelConstants = { ...model, base_multiple: model.base_multiple * scaleK };
  // Strict rolling validation picks the blend weight on the first three blocks among the
  // alphas that pass the gate; when none passes the board falls back to flat TVL.
  const rolling = rollingValidation(snapshot);
  const holdout = holdoutValidation(snapshot, calibrated, rolling.chosen_alpha);
  const accounting = accountingOf(snapshot);
  const tradedAll = snapshot.protocols
    .filter((entry) => entry.mcap_usd !== null && entry.mcap_usd > 0 && entry.tvl_usd > 0);
  const flatMultiple = holdoutMedians(tradedAll).flatMultiple;
  const ranked = buildBoard(snapshot, calibrated, propensity, holdout, { alpha: rolling.chosen_alpha, flatMultiple });
  const liveSet = liveRows(snapshot);
  const early = ranked.filter((r) => snapshot.watchlist.includes(r.slug) === false).length;
  // The radar-2 comparison: score the same rows with the old function and rank them the same
  // way (implied value down, slug up), so the two releases can be set side by side.
  const lookup = bySlug(snapshot.protocols);
  const v2Implied = new Map<string, number>();
  for (const row of ranked) {
    const entry = lookup.get(row.slug);
    if (entry !== undefined) v2Implied.set(row.slug, impliedValueV2(entry, snapshot.as_of));
  }
  const v2Order = [...ranked].sort((a, b) => (v2Implied.get(b.slug) ?? 0) - (v2Implied.get(a.slug) ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const v2RankBySlug = new Map<string, number>();
  v2Order.forEach((row, i) => v2RankBySlug.set(row.slug, i + 1));
  const comparison = buildComparison(ranked, v2RankBySlug, calibrated.base_multiple);
  // Category standings, built from the board's own rows: TVL rank inside the category, plus the
  // category's median seven-day growth across the rows that report one. Deterministic: ties break
  // on slug, the same order the board uses.
  const groups = new Map<string, BoardRow[]>();
  for (const row of ranked) {
    const key = row.category ?? 'Other';
    const members = groups.get(key) ?? [];
    members.push(row);
    groups.set(key, members);
  }
  const standingBySlug = new Map<string, { tvlRank: number; growthMedian: number | null }>();
  for (const [key, members] of groups) {
    const tvlOrder = [...members].sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    const growthValues = members
      .map((row) => row.change_7d)
      .filter((value): value is number => value !== null)
      .sort((x, y) => x - y);
    const growthMedian = median(growthValues);
    for (let i = 0; i < tvlOrder.length; i++) {
      standingBySlug.set(tvlOrder[i]!.slug, { tvlRank: i + 1, growthMedian });
    }
  }
  const verdictCounts = { farm: 0, marginal: 0, skip: 0 };
  for (const row of ranked) {
    if (row.farm_verdict === 'Farm') verdictCounts.farm++;
    else if (row.farm_verdict === 'Marginal') verdictCounts.marginal++;
    else verdictCounts.skip++;
  }
  const totalImplied = ranked.reduce((sum, row) => sum + row.implied_value_usd, 0);
  const meanPropensity = ranked.length === 0 ? 0 : Math.round((ranked.reduce((sum, row) => sum + row.propensity, 0) / ranked.length) * 10000) / 10000;
  const radarData: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model: calibrated, model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length, board_size: ranked.length,
    early_size: early, live_size: liveSet.length,
    rows: ranked.map((row) => {
      const standing = standingBySlug.get(row.slug) ?? { tvlRank: 0, growthMedian: null };
      return radarRow(row, standing.tvlRank === 0 ? null : standing.tvlRank, standing.growthMedian, snapshot.watchlist.includes(row.slug), v2RankBySlug.get(row.slug) ?? 0, v2Implied.get(row.slug) ?? 0);
    }),
    live: liveSet,
    comparison,
    propensity, age_ablation: ablation, holdout,
    blend_alpha: rolling.chosen_alpha, flat_multiple: flatMultiple, rolling,
    accounting, verdict_counts: verdictCounts,
    total_implied_usd: totalImplied, mean_propensity: meanPropensity, base_rate: propensity.base_rate,
    scale_k: Math.round(scaleK * 10000) / 10000,
    tvl_anchor_global: tvlAnchors(tradedAll).global,
  };
  return { board: ranked, radar: radarData };
}

/** A snapshot parsed from file text, refused unless it has the shape the model scores. */
export function parseSnapshot(
  text: string,
): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text); // throws when the text is not JSON
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new SnapshotError('snapshot.json is not a JSON object');
  const doc = parsed as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || /^\d{4}-\d{2}-\d{2}$/.test(doc.as_of) === false) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || Number.isSafeInteger(doc.floor_usd) === false || doc.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (Array.isArray(doc.protocols) === false) throw new SnapshotError('snapshot.json has no protocols array');
  if (Array.isArray(doc.watchlist) === false || doc.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = doc.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError('snapshot.json\'s protocol ' + i + ' is not an object');
    const entry = v as Record<string, unknown>;
    if (typeof entry.slug !== 'string' || typeof entry.name !== 'string' || typeof entry.tvl_usd !== 'number' || Number.isFinite(entry.tvl_usd) === false) {
      throw new SnapshotError('snapshot.json\'s protocol ' + i + ' lacks a slug, a name or a TVL');
    }
    return {
      slug: entry.slug, name: entry.name,
      category: typeof entry.category === 'string' ? entry.category : null,
      chains: Array.isArray(entry.chains) ? entry.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: entry.tvl_usd,
      change_7d: typeof entry.change_7d === 'number' && Number.isFinite(entry.change_7d) ? entry.change_7d : null,
      listed_at: typeof entry.listed_at === 'string' ? entry.listed_at : null,
      gecko_id: typeof entry.gecko_id === 'string' ? entry.gecko_id : null,
      symbol: typeof entry.symbol === 'string' ? entry.symbol : null,
      mcap_usd: typeof entry.mcap_usd === 'number' && Number.isFinite(entry.mcap_usd) ? entry.mcap_usd : null,
    };
  });
  return {
    as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd,
    protocols, watchlist: doc.watchlist as string[],
  };
}

/** The reason a board fails the gate, or null: coverage, ranks, order, flat values, farm steps. */
export function boardIssue(
  board: BoardRow[],
  snapshot: Snapshot,
): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((s) => slugs.has(s) === false);
  if (missing.length > 0) return 'the board misses ' + missing.length + ' watchlist slug' + (missing.length === 1 ? '' : 's') + ': ' + missing.slice(0, 5).join(', ');
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranks[i];
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
  const endsMatch = board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd;
  if (endsMatch) {
    return 'all ' + board.length + ' rows share the same implied value $' + board[0]!.implied_value_usd + ': a board that ranks nothing by value is not a ranking';
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return row.slug + ' has ' + steps.length + ' farm steps';
    for (const s of steps) if (s.length < 20 || s.length > 600) return row.slug + ' has a farm step of ' + s.length + ' characters';
    if (Number.isSafeInteger(row.implied_value_usd) === false || row.implied_value_usd <= 0) return row.slug + ' has implied value ' + row.implied_value_usd;
    if (row.implied_value_usd !== row.value_if_launches_usd) return row.slug + ' has implied value ' + row.implied_value_usd + ' but its launch value is ' + row.value_if_launches_usd;
    const expectedPriority = Math.round(row.value_if_launches_usd * row.propensity * 100) / 100;
    if (row.priority_score !== expectedPriority) return row.slug + ' has priority score ' + row.priority_score + ' but launch value times propensity is ' + expectedPriority;
    if (row.farm_plan_size !== 1000 && row.farm_plan_size !== 10000) return row.slug + ' has farm plan size ' + row.farm_plan_size;
    if (row.plan_state !== 'Category-supported' && row.plan_state !== 'Conditional' && row.plan_state !== 'Research first') return row.slug + ' has plan state ' + row.plan_state;
    if (Number.isFinite(row.gas_total_usd) === false || row.gas_total_usd < 0) return row.slug + ' has gas total ' + row.gas_total_usd;
    if (Number.isFinite(row.breakeven_drop_share) === false || row.breakeven_drop_share < 0) return row.slug + ' has break-even drop share ' + row.breakeven_drop_share;
    if (row.verdict_gas50 !== 'Farm' && row.verdict_gas50 !== 'Marginal' && row.verdict_gas50 !== 'Skip') return row.slug + ' has gas+50% verdict ' + row.verdict_gas50;
    if (row.verdict_gas100 !== 'Farm' && row.verdict_gas100 !== 'Marginal' && row.verdict_gas100 !== 'Skip') return row.slug + ' has gas+100% verdict ' + row.verdict_gas100;
    const planNet = row.farm_plan_size === 10000 ? row.net_10000_usd : row.net_1000_usd;
    if (Math.abs(row.net_plan_gas50_usd - Math.round((planNet - 0.5 * row.gas_total_usd) * 100) / 100) > 0.02) return row.slug + ' has gas+50% net ' + row.net_plan_gas50_usd + ' but the plan net less half the gas is ' + Math.round((planNet - 0.5 * row.gas_total_usd) * 100) / 100;
    if (Math.abs(row.net_plan_gas100_usd - Math.round((planNet - row.gas_total_usd) * 100) / 100) > 0.02) return row.slug + ' has gas+100% net ' + row.net_plan_gas100_usd + ' but the plan net less the gas is ' + Math.round((planNet - row.gas_total_usd) * 100) / 100;
    if (row.flat_rank < 1 || row.flat_rank > board.length || row.radar_rank < 1 || row.radar_rank > board.length) return row.slug + ' has a rank outside 1..' + board.length;
    if (row.rank_diff !== row.flat_rank - row.radar_rank) return row.slug + ' has rank diff ' + row.rank_diff + ' but flat ' + row.flat_rank + ' minus radar ' + row.radar_rank + ' is ' + (row.flat_rank - row.radar_rank);
    if (row.propensity <= 0 || row.propensity > 1) return row.slug + ' has propensity ' + row.propensity;
    if (row.range_lo_usd > row.implied_value_usd || row.implied_value_usd > row.range_hi_usd) return row.slug + ' has an implied value outside its printed range';
  }
  return null;
}

/** data.js, compact: the dashboard's whole dataset as one script, no fetch, no network. */
export function dataScript(
  radar: RadarData,
): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
