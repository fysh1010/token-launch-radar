// Token Radar's scoring model, release radar-5: a sealed snapshot goes in, a ranked board comes out.
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
// Implied value is value-if-it-launches times tokenization propensity, both from the snapshot's
// own numbers:
//
//   value-if-launches  = base x tvl_usd^0.85 x tvl_median^0.15 x growth x chains
//                          (the radar-3 value formula, kept whole: tvl_median is the median TVL
//                          across the board's own rows, growth is 1 + 0.25 x tanh((change_7d -
//                          cat_median) / 25) against the category median, chains is
//                          1 + 0.03 x min(max(chains - 1, 0), 5)). The base is not the round 0.25
//                          any more: it is 0.25 x k, where k = exp(median log(MCAP / predicted))
//                          over the traded tokens' leave-one-out predictions — the value scale
//                          the traded tokens themselves imply, not a round number and not a
//                          competitor's total.
//   tokenization propensity = sigmoid(w0 + w1 x z(log10 TVL) + w2 x z(log10(age + 30)) + w3 x z(chains)
//                          + w4 x z(category rate)), a logistic score fitted on the eligible
//                          protocols only — every protocol the board's own visible test keeps,
//                          launched or not — with the protocol itself left out of its category
//                          rate and the features standardised on the training set. It is a
//                          cross-sectional score, not a probability that the protocol will launch
//                          a token: the label is "has a token at snapshot time", the snapshot is
//                          a single cross-section, and no future launch dates exist to calibrate
//                          against. Age scores in the propensity now, not in the value: a protocol
//                          that has run three years with no token is not worth more, but among the
//                          eligible protocols the older ones more often have a token already.
//   implied            = max(1, round(value-if-launches x tokenization propensity))
//
// The value formula is checked out of sample, not just fitted: leave-one-out over the traded
// tokens (each priced from a fit on the others) and by-time (the older half fits the model that
// prices the newer half), each against a flat TVL-multiple baseline. The printed range on every
// row is the leave-one-out error distribution's P25-P75 (and P10-P90) around the implied value,
// and the coverage those ranges achieve on the by-time held-out caps is measured and printed
// alongside. The range is the value model's error assuming a launch; the propensity score is the
// separate launch uncertainty, and the dashboard shows the two apart — the P10-P90 range is not
// an 80% confidence interval on the final airdrop value. No protocol name is ever special-cased,
// and no row is hand-picked: one function scores every row, and the dashboard prints the formula
// alongside the constants it runs. The previous release's formula is kept beside it as a
// comparison function only, never for the ranking.

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
  median_exponent: number; // board-median TVL exponent, the complement of the TVL one
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
export const MODEL_VERSION: string = 'radar-5';

/** Live-token rows in the dashboard's Live token view, by market cap. */
export const LIVE_ROWS: number = 24;

/** A farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  cost: string; // what the step costs
  time: string; // how long the step takes
  text: string; // the action itself
}

/** A farm verdict on the small plan's expected net under the drop-share scenarios: Farm when
 * even the conservative 1% drop clears the threshold, Marginal when the neutral 3% drop
 * clears zero, Skip when the neutral drop loses money. The verdict is about the farmer's
 * plan, not the protocol's quality: a large protocol can top the board and still be a Skip
 * on a small plan, because a small position is a dust share of its drop. */
export type FarmVerdict = 'Farm' | 'Marginal' | 'Skip';

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
 * newer half, so the numbers are out of sample in time as well as in fold. */
export interface PropensityTimeSplit {
  split: string; // the listing date the split falls on
  n: number; // newer-half protocols scored
  roc_auc: number; // area under the ROC curve on the newer half
  brier: number; // mean squared error of the score against the label, newer half
  log_loss: number; // mean log loss of the score against the label, newer half
}

/** The fitted tokenization-propensity score: the weights in standardised feature space, the
 * feature means and standard deviations they are measured against, and the category counts the
 * leave-one-out category rate is built from. It is a score, not a calibrated probability: the
 * quality numbers below are discrimination and calibration on the cross-sectional label
 * "has a token now", and no number here measures how often a protocol will launch one later. */
export interface PropensityModel {
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

/** What the holdout tests say about the value model: the median miss of the radar-3 value
 * formula against the flat TVL multiple, leave-one-out and by-time, plus the error
 * distribution the printed ranges are cut from and the coverage those ranges achieve on
 * held-out caps. */
export interface HoldoutSummary {
  loo_n: number; // traded tokens priced leave-one-out
  loo_median_miss: number; // median miss of the value formula, leave-one-out
  loo_flat_median_miss: number; // median miss of the flat TVL multiple, leave-one-out
  loo_within_2x: number; // share of leave-one-out caps within 2x of the prediction
  bytime_n: number; // traded tokens in the newer half of the by-time test
  bytime_split: string; // the listing date the by-time test splits on
  bytime_median_miss: number; // median miss of the value formula, by-time
  bytime_flat_median_miss: number; // median miss of the flat multiple, by-time
  log_p10: number; // 10th percentile of the leave-one-out log error
  log_p25: number; // 25th percentile
  log_p50: number; // median
  log_p75: number; // 75th percentile
  log_p90: number; // 90th percentile
  range_lo_factor: number; // exp(P25): the low end of the printed P25-P75 range
  range_hi_factor: number; // exp(P75)
  range_lo10_factor: number; // exp(P10)
  range_hi90_factor: number; // exp(P90)
  coverage_2575: number; // share of by-time held-out caps inside the printed P25-P75 range
  coverage_1090: number; // share inside the printed P10-P90 range
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
 * a setup costs on Ethereum and elsewhere, the annual cost of the capital, and the net
 * threshold. No scenario is evidence: the shares are scenarios, and the verdicts are stated
 * against them — Farm when even the conservative drop clears the threshold. */
export interface FarmConstants {
  drop_share_conservative: number; // drop share in the conservative scenario
  drop_share_neutral: number; // drop share in the neutral scenario
  drop_share_optimistic: number; // drop share in the optimistic scenario
  plan_small: number; // small plan size, dollars
  plan_large: number; // large plan size, dollars
  gas_ethereum: number; // setup gas on Ethereum, dollars
  gas_other: number; // setup gas elsewhere, dollars
  opportunity_rate: number; // annual cost of the capital
  farm_threshold: number; // net on the small plan above which a row is Farm
}

export const FARM: FarmConstants = { // the constants the dashboard prints
  drop_share_conservative: 0.01, drop_share_neutral: 0.03, drop_share_optimistic: 0.07,
  plan_small: 1000, plan_large: 10000,
  gas_ethereum: 11.5, gas_other: 3, opportunity_rate: 0.05, farm_threshold: 10,
};

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
  implied_value_usd: number; // value-if-it-launches times tokenization propensity, the ranking value
  value_if_launches_usd: number; // the radar-3 value formula, before the propensity discount it
  propensity: number; // tokenization propensity score, 0..1 — cross-sectional, not a launch probability
  range_lo_usd: number; // P25 end of the printed range, from the holdout error distribution
  range_hi_usd: number; // P75 end of the printed range
  range_lo10_usd: number; // P10 end of the printed range
  range_hi90_usd: number; // P90 end of the printed range
  farm_verdict: FarmVerdict; // Farm, Marginal or Skip on the small plan's expected net
  net_1000_usd: number; // expected net of farming at the $1,000 plan size, neutral 3% drop
  net_10000_usd: number; // expected net of farming at the $10,000 plan size, neutral 3% drop
  net_1000_conservative_usd: number; // expected net at the $1,000 plan size, conservative 1% drop
  net_1000_optimistic_usd: number; // expected net at the $1,000 plan size, optimistic 7% drop
  off_list: boolean; // true when the protocol is above the floor but the watchlist skips it
  model: { // the factors behind the value, each recomputable from the snapshot
    tvl_base: number; // 0.25 x TVL^0.85 x board-median TVL^0.15, in dollars
    growth_factor: number; // category-relative growth factor, 0.75..1.25
    category_median_7d: number | null; // the category median the growth factor measures against
    chain_factor: number; // chain-breadth factor
    tvl_median: number; // board-median TVL the base is anchored on
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
  implied_value_usd: number; // the model's implied value
  value_if_launches_usd: number; // the radar-3 value formula, before the propensity discount it
  propensity: number; // tokenization propensity score, 0..1 — cross-sectional, not a launch probability
  range_lo_usd: number; // P25 end of the printed range, from the holdout error distribution
  range_hi_usd: number; // P75 end of the printed range
  range_lo10_usd: number; // P10 end of the printed range
  range_hi90_usd: number; // P90 end of the printed range
  farm_verdict: FarmVerdict; // Farm, Marginal or Skip on the small plan's expected net
  net_1000_usd: number; // expected net of farming at the $1,000 plan size, neutral 3% drop
  net_10000_usd: number; // expected net of farming at the $10,000 plan size, neutral 3% drop
  net_1000_conservative_usd: number; // expected net at the $1,000 plan size, conservative 1% drop
  net_1000_optimistic_usd: number; // expected net at the $1,000 plan size, optimistic 7% drop
  off_list: boolean; // true when the protocol is above the floor but the watchlist skips it
  growth_factor: number; // category-relative growth factor
  chain_factor: number; // chain-breadth factor
  tvl_base: number; // 0.25 x TVL^0.85 x board-median TVL^0.15, in dollars
  category_median_7d: number | null; // category median seven-day growth, when one exists
  tvl_median: number; // board-median TVL the base is anchored on
  v2_rank: number; // where the previous release ranked this protocol
  v2_implied: number; // the previous release's implied value for this protocol
  on_watchlist: boolean; // true when the slug is watchlisted
  category_tvl_rank: number | null; // TVL rank inside its category
  category_growth_median: number | null; // category median seven-day growth
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
  comparison: ModelComparison; // radar-2 versus radar-5, computed by the build
  propensity: PropensityModel; // the fitted tokenization-propensity score, so the page recomputes every row's score
  holdout: HoldoutSummary; // what the out-of-sample holdout tests say about the value model
  accounting: AccountingGroup[]; // all snapshot protocols, grouped by outcome or reason
  verdict_counts: { farm: number; marginal: number; skip: number }; // farm verdicts on the board
  total_implied_usd: number; // sum of implied value across the board
  mean_propensity: number; // mean tokenization propensity across the board
  base_rate: number; // observed launched share among the eligible training set — a statistic, not a calibration target
  scale_k: number; // the leave-one-out median log ratio that sets the value base: base = 0.25 x k
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

/** The board-wide figures the radar-3 score is anchored on. */
export interface ModelContext {
  tvlMedian: number; // median TVL across the board's rows
  categoryMedian: Map<string, number>; // median seven-day change per category, over the board's rows
}

/** One protocol's factors and value-if-it-launches under the radar-3 formula, the value half
 * of radar-5: the same sub-linear TVL base, category-relative growth and chain factor, with
 * the tokenization propensity applied later, in buildBoard. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  ctx: ModelContext,
): { implied: number; tvlBase: number; growthFactor: number; categoryMedian: number | null; chainFactor: number; age: number | null } {
  const protocolAge = ageDays(asOf, protocol.listed_at);
  const tvlBase = model.base_multiple * Math.pow(protocol.tvl_usd, model.tvl_exponent) * Math.pow(ctx.tvlMedian, model.median_exponent);
  const catMedian = ctx.categoryMedian.get(protocol.category ?? 'Other') ?? null;
  const growthFactor = protocol.change_7d === null || catMedian === null
    ? 1
    : 1 + model.growth_weight * Math.tanh((protocol.change_7d - catMedian) / model.growth_scale);
  const chainBonus = Math.max(0, Math.min(protocol.chains.length - 1, model.chain_max_steps));
  const chainFactor = 1 + chainBonus * model.chain_step;
  const implied = Math.max(1, Math.round(tvlBase * growthFactor * chainFactor));
  return { implied, tvlBase, growthFactor, categoryMedian: catMedian, chainFactor, age: protocolAge };
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
 * One protocol's four propensity features, from the snapshot's own fields: log10 TVL, log10 age
 * (an unknown age scores as one year, then 30 days are added so a newborn protocol still
 * has a log), chain count capped at six, and the leave-one-out category rate.
 */
function propensityFeatures(
  entry: SnapshotProtocol,
  asOf: string,
  catTotal: Map<string, number>,
  catLaunched: Map<string, number>,
  selfY: number | null,
): number[] {
  const age = ageDays(asOf, entry.listed_at);
  const logAge = Math.log10((age === null ? PROPENSITY.unknown_age_days : age) + 30);
  return [
    Math.log10(Math.max(entry.tvl_usd, 1)),
    logAge,
    Math.min(entry.chains.length, PROPENSITY.max_chains),
    categoryRate(entry, catTotal, catLaunched, selfY),
  ];
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

/** One score from a fitted model: the protocol's four features, standardised against the
 * training set, through the logistic weights. */
function scoreWith(
  entry: SnapshotProtocol,
  asOf: string,
  fit: { weights: number[]; means: number[]; sds: number[] },
  catTotal: Map<string, number>,
  catLaunched: Map<string, number>,
  selfY: number | null,
): number {
  const features = propensityFeatures(entry, asOf, catTotal, catLaunched, selfY);
  let z = fit.weights[0]!;
  for (let d = 0; d < features.length; d++) {
    z += fit.weights[d + 1]! * ((features[d]! - fit.means[d]!) / fit.sds[d]!);
  }
  return sigmoid(z);
}

/**
 * The tokenization-propensity score, fitted on the eligible protocols only: every protocol
 * the board's own visible test keeps, whether it already has a token or records none.
 * Positives and negatives pass the same filter, so a bridge or a liquid-staking product can
 * no longer enter as a positive while a pre-token protocol of the same kind is kept out of
 * the negatives. Sorted by slug so the fit order, and therefore every floating-point sum,
 * is fixed. Quality is measured out of fold — ROC-AUC, Brier score and log loss on the
 * held-out fold, with calibration by predicted band — and again on a time split, the older
 * half fitting the model that scores the newer half by listing date.
 */
export function fitPropensityModel(snapshot: Snapshot): PropensityModel {
  const train = snapshot.protocols
    .filter((entry) => passesVisibleRule(entry))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const y = train.map((entry) => (isPreToken(entry) ? 0 : 1));
  const catTotal = new Map<string, number>();
  const catLaunched = new Map<string, number>();
  for (let i = 0; i < train.length; i++) {
    const key = train[i]!.category ?? 'Other';
    catTotal.set(key, (catTotal.get(key) ?? 0) + 1);
    catLaunched.set(key, (catLaunched.get(key) ?? 0) + y[i]!);
  }
  const features = train.map((entry, i) => propensityFeatures(entry, snapshot.as_of, catTotal, catLaunched, y[i]!));
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
    const foldFeatures = trainIdx.map((i) => propensityFeatures(train[i]!, snapshot.as_of, foldTotal, foldLaunched, y[i]!));
    const foldY = trainIdx.map((i) => y[i]!);
    const foldFit = fitLogistic(foldFeatures, foldY);
    for (const i of testIdx) {
      oof.push({ p: scoreWith(train[i]!, snapshot.as_of, foldFit, foldTotal, foldLaunched, null), y: y[i]! });
    }
  }
  // Time split: the older half by listing date fits the model that scores the newer half.
  // Protocols with no listing date sit out of this check; the split date is the first
  // listing date of the newer half.
  const dated = train
    .map((entry, i) => ({ entry, i }))
    .filter(({ entry }) => entry.listed_at !== null)
    .sort((a, b) => (a.entry.listed_at! < b.entry.listed_at! ? -1 : a.entry.listed_at! > b.entry.listed_at! ? 1 : a.entry.slug < b.entry.slug ? -1 : a.entry.slug > b.entry.slug ? 1 : 0));
  let timeSplit: PropensityTimeSplit = { split: '', n: 0, roc_auc: 0, brier: 0, log_loss: 0 };
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
    const olderFeatures = older.map(({ entry, i }) => propensityFeatures(entry, snapshot.as_of, olderTotal, olderLaunched, y[i]!));
    const olderY = older.map(({ i }) => y[i]!);
    const olderFit = fitLogistic(olderFeatures, olderY);
    const newerPairs = newer.map(({ entry, i }) => ({
      p: scoreWith(entry, snapshot.as_of, olderFit, olderTotal, olderLaunched, null),
      y: y[i]!,
    }));
    timeSplit = {
      split: newer[0]!.entry.listed_at!,
      n: newer.length,
      roc_auc: rocAuc(newerPairs),
      brier: brierScore(newerPairs),
      log_loss: logLoss(newerPairs),
    };
  }
  const launched = y.reduce((a, b) => a + b, 0);
  const baseRate = launched / train.length;
  const basePairs = y.map((label) => ({ p: baseRate, y: label }));
  return {
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
}

/** One protocol's tokenization propensity under the fitted score: its four features,
 * standardised against the training set, through the logistic weights. Board rows are in
 * the training set as rankable pre-token, so their own outcome is left out of the category
 * rate. */
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

/** One protocol's value under the radar-3 formula, with anchors fitted on the priced set
 * given: the board median is replaced by the traded median, the category medians by the
 * traded ones, so the holdout tests the formula's shape, not the board's anchors. */
function valueForHoldout(
  entry: SnapshotProtocol,
  tvlMedian: number,
  catMedians: Map<string, number>,
  model: ModelConstants,
): number {
  const tvlBase = model.base_multiple * Math.pow(entry.tvl_usd, model.tvl_exponent) * Math.pow(tvlMedian, model.median_exponent);
  const catMedian = catMedians.get(entry.category ?? 'Other') ?? null;
  const growth = entry.change_7d === null || catMedian === null
    ? 1
    : 1 + model.growth_weight * Math.tanh((entry.change_7d - catMedian) / model.growth_scale);
  const chainBonus = Math.max(0, Math.min(entry.chains.length - 1, model.chain_max_steps));
  return Math.max(1, Math.round(tvlBase * growth * (1 + chainBonus * model.chain_step)));
}

/** The anchors a priced set gives: its median TVL, its per-category median seven-day change,
 * and its median market-cap-to-TVL multiple, the flat baseline. */
function holdoutAnchors(
  priced: SnapshotProtocol[],
): { tvlMedian: number; catMedians: Map<string, number>; flatMultiple: number } {
  const tvlMedian = median(priced.map((p) => p.tvl_usd).sort((a, b) => a - b)) ?? 0;
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
  return { tvlMedian, catMedians, flatMultiple };
}

/**
 * The out-of-sample holdout tests on the traded-token protocols: leave-one-out (each token
 * priced from a fit on the others) and by-time (the older half, by listing date, fits the
 * model that prices the newer half), each against a flat TVL-multiple baseline. The printed
 * ranges are cut from the leave-one-out log-error distribution, and their coverage is
 * measured on the by-time held-out caps, so the coverage number is itself out of sample.
 */
export function holdoutValidation(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): HoldoutSummary {
  const empty: HoldoutSummary = {
    loo_n: 0, loo_median_miss: 0, loo_flat_median_miss: 0, loo_within_2x: 0,
    bytime_n: 0, bytime_split: '', bytime_median_miss: 0, bytime_flat_median_miss: 0,
    log_p10: 0, log_p25: 0, log_p50: 0, log_p75: 0, log_p90: 0,
    range_lo_factor: 0, range_hi_factor: 0, range_lo10_factor: 0, range_hi90_factor: 0,
    coverage_2575: 0, coverage_1090: 0,
  };
  const traded = snapshot.protocols
    .filter((entry) => entry.mcap_usd !== null && entry.mcap_usd > 0 && entry.tvl_usd > 0)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (traded.length < 2) return empty;
  const misses: number[] = [];
  const flatMisses: number[] = [];
  const logErrors: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const entry = traded[i]!;
    const others = traded.filter((_, j) => j !== i);
    const anchors = holdoutAnchors(others);
    const predicted = valueForHoldout(entry, anchors.tvlMedian, anchors.catMedians, model);
    const flatPredicted = Math.max(1, Math.round(anchors.flatMultiple * entry.tvl_usd));
    const actual = entry.mcap_usd!;
    misses.push(Math.max(predicted / actual, actual / predicted));
    flatMisses.push(Math.max(flatPredicted / actual, actual / flatPredicted));
    logErrors.push(Math.log(actual / predicted));
  }
  const sortedLog = [...logErrors].sort((a, b) => a - b);
  const p10 = quantile(sortedLog, 0.1);
  const p25 = quantile(sortedLog, 0.25);
  const p50 = quantile(sortedLog, 0.5);
  const p75 = quantile(sortedLog, 0.75);
  const p90 = quantile(sortedLog, 0.9);
  const rangeLo = round4(Math.exp(p25));
  const rangeHi = round4(Math.exp(p75));
  const rangeLo10 = round4(Math.exp(p10));
  const rangeHi90 = round4(Math.exp(p90));
  const within2x = misses.filter((m) => m <= 2).length / misses.length;
  const dated = traded
    .filter((entry) => entry.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  let bytimeN = 0;
  let bytimeSplit = '';
  let bytimeMiss = 0;
  let bytimeFlatMiss = 0;
  let coverage2575 = 0;
  let coverage1090 = 0;
  if (dated.length >= 4) {
    const half = Math.floor(dated.length / 2);
    const older = dated.slice(0, half);
    const newer = dated.slice(half);
    const anchors = holdoutAnchors(older);
    const byMisses: number[] = [];
    const byFlatMisses: number[] = [];
    let in2575 = 0;
    let in1090 = 0;
    for (const entry of newer) {
      const predicted = valueForHoldout(entry, anchors.tvlMedian, anchors.catMedians, model);
      const flatPredicted = Math.max(1, Math.round(anchors.flatMultiple * entry.tvl_usd));
      const actual = entry.mcap_usd!;
      byMisses.push(Math.max(predicted / actual, actual / predicted));
      byFlatMisses.push(Math.max(flatPredicted / actual, actual / flatPredicted));
      if (predicted * rangeLo <= actual && actual <= predicted * rangeHi) in2575++;
      if (predicted * rangeLo10 <= actual && actual <= predicted * rangeHi90) in1090++;
    }
    bytimeN = newer.length;
    bytimeSplit = newer[0]!.listed_at!;
    bytimeMiss = median(byMisses.sort((a, b) => a - b)) ?? 0;
    bytimeFlatMiss = median(byFlatMisses.sort((a, b) => a - b)) ?? 0;
    coverage2575 = Math.round((in2575 / newer.length) * 10000) / 10000;
    coverage1090 = Math.round((in1090 / newer.length) * 10000) / 10000;
  }
  return {
    loo_n: traded.length,
    loo_median_miss: median(misses.sort((a, b) => a - b)) ?? 0,
    loo_flat_median_miss: median(flatMisses.sort((a, b) => a - b)) ?? 0,
    loo_within_2x: Math.round(within2x * 10000) / 10000,
    bytime_n: bytimeN, bytime_split: bytimeSplit,
    bytime_median_miss: round4(bytimeMiss), bytime_flat_median_miss: round4(bytimeFlatMiss),
    log_p10: round4(p10), log_p25: round4(p25), log_p50: round4(p50),
    log_p75: round4(p75), log_p90: round4(p90),
    range_lo_factor: rangeLo, range_hi_factor: rangeHi,
    range_lo10_factor: rangeLo10, range_hi90_factor: rangeHi90,
    coverage_2575: coverage2575, coverage_1090: coverage1090,
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

/** The expected net of farming one protocol at one plan size under one drop-share scenario:
 * the drop share of the implied value, allocated in proportion to the plan's share of TVL,
 * less the setup gas and the opportunity cost of the capital over the hold. The drop is
 * modelled as split by capital share of TVL — a simplification, stated as one in the
 * dashboard, since real drops pay on points and activity rather than TVL share. */
export function farmNet(
  entry: SnapshotProtocol,
  implied: number,
  age: number | null,
  size: number,
  dropShare: number,
): number {
  const gas = (entry.chains[0] ?? '') === 'Ethereum' ? FARM.gas_ethereum : FARM.gas_other;
  const hold = holdDaysFor(age);
  const reward = entry.tvl_usd > 0 ? implied * dropShare * (size / entry.tvl_usd) : 0;
  return Math.round((reward - gas - (size * FARM.opportunity_rate * hold) / 365) * 100) / 100;
}

/** The farm verdict from the small plan's expected net under two scenarios: Farm when even
 * the conservative 1% drop clears the threshold, Marginal when the neutral 3% drop clears
 * zero, Skip when the neutral drop loses money. */
export function farmVerdictFor(netConservative: number, netNeutral: number): FarmVerdict {
  if (netConservative > FARM.farm_threshold) return 'Farm';
  if (netNeutral > 0) return 'Marginal';
  return 'Skip';
}

/** The board's protocols, strongest first, ranked 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  propensity: PropensityModel,
  holdout: HoldoutSummary,
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

  // The value formula's anchors are board-wide figures, so they are computed over the picked rows
  // before any row is scored: the median TVL of the whole board, and the median seven-day
  // change inside each category. Every row then scores against the same anchors.
  const pickedRows = [...picked.values()];
  const tvlMedian = median(pickedRows.map((entry) => entry.tvl_usd).sort((a, b) => a - b)) ?? 0;
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
  const ctx: ModelContext = { tvlMedian, categoryMedian };

  // Radar-5 scores each row as value-if-it-launches times tokenization propensity: the radar-3
  // value formula, unrounded, discounted by the fitted score. The range is the holdout error
  // distribution around the implied value; the verdict is the small plan's expected net under
  // the three drop-share scenarios.
  const scored = pickedRows.map((entry) => {
    const result = impliedValue(entry, snapshot.as_of, model, ctx);
    const propensityValue = propensityScore(entry, snapshot.as_of, propensity);
    const valueIfLaunches = Math.max(1, result.tvlBase * result.growthFactor * result.chainFactor);
    const implied = Math.max(1, Math.round(valueIfLaunches * propensityValue));
    return { entry, ...result, propensityValue, valueIfLaunches, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.entry.slug < b.entry.slug ? -1 : a.entry.slug > b.entry.slug ? 1 : 0));
  return scored.map((item, i) => {
    const netSmallConservative = farmNet(item.entry, item.implied, item.age, FARM.plan_small, FARM.drop_share_conservative);
    const netSmall = farmNet(item.entry, item.implied, item.age, FARM.plan_small, FARM.drop_share_neutral);
    const netSmallOptimistic = farmNet(item.entry, item.implied, item.age, FARM.plan_small, FARM.drop_share_optimistic);
    const netLarge = farmNet(item.entry, item.implied, item.age, FARM.plan_large, FARM.drop_share_neutral);
    return {
      rank: i + 1, slug: item.entry.slug, name: item.entry.name,
      category: item.entry.category, chains: item.entry.chains, tvl_usd: item.entry.tvl_usd,
      change_7d: item.entry.change_7d, mcap_usd: item.entry.mcap_usd,
      listed_at: item.entry.listed_at, gecko_id: item.entry.gecko_id, symbol: item.entry.symbol,
      token_status: 'pre-token', age_days: item.age, implied_value_usd: item.implied,
      value_if_launches_usd: item.valueIfLaunches,
      propensity: item.propensityValue,
      range_lo_usd: Math.max(1, Math.round(item.implied * holdout.range_lo_factor)),
      range_hi_usd: Math.max(1, Math.round(item.implied * holdout.range_hi_factor)),
      range_lo10_usd: Math.max(1, Math.round(item.implied * holdout.range_lo10_factor)),
      range_hi90_usd: Math.max(1, Math.round(item.implied * holdout.range_hi90_factor)),
      farm_verdict: farmVerdictFor(netSmallConservative, netSmall),
      net_1000_usd: netSmall, net_10000_usd: netLarge,
      net_1000_conservative_usd: netSmallConservative, net_1000_optimistic_usd: netSmallOptimistic,
      off_list: offList.has(item.entry.slug),
      model: {
        tvl_base: round2(item.tvlBase), growth_factor: round4(item.growthFactor),
        category_median_7d: item.categoryMedian, chain_factor: round4(item.chainFactor),
        tvl_median: tvlMedian,
      },
      farm_steps: farmSteps(item.entry, item.age).map(stepText),
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

/** Capital for one farm position, sized from the protocol's own TVL. */
function capitalFor(entry: SnapshotProtocol): number {
  const defaultCapital = 50;
  const tiers: Array<[number, number]> = [
    [5_000_000_000, 250],
    [1_000_000_000, 150],
    [100_000_000, 100],
  ];
  for (const [floor, amount] of tiers) {
    if (entry.tvl_usd >= floor) return amount;
  }
  return defaultCapital;
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
 * A protocol's farm plan: seven steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, seven-day change, age) and never from a
 * hand-written list of names. The entry step times the funding by the seven-day change, the
 * weekly step alternates the chains the protocol actually runs on, the hold step is sized by
 * the protocol's own age and TVL, and the last step is the exit rule, priced by the TVL the
 * farmer entered at. Nothing here promises a token or an airdrop: the plan farms the protocol
 * as it stands.
 */
export function farmSteps(
  entry: SnapshotProtocol,
  age: number | null,
): FarmStep[] {
  const firstChain = chainOf(entry);
  const secondChain = secondChainOf(entry);
  const stake = capitalFor(entry);
  const gas = gasRange(entry);
  const holdDays = holdDaysFor(age);
  const secondChainClause = secondChain === null ? '' : ' If you farm on both chains, alternate weeks between ' + firstChain + ' and ' + secondChain + '.';
  const youngClause = age !== null && age < 90 ? ' The protocol is only ' + age + ' days old, so check its announcements weekly too.' : '';
  const logSecond = secondChain === null ? '' : ' Note the second chain, ' + secondChain + ', if you farmed there too.';
  const mk = (text: string, cost: string, time: string): FarmStep => ({ text, cost, time });
  const plan: FarmStep[] = [
    mk('Set up a fresh wallet on ' + firstChain + ' with $' + stake + ' of USDC and gas money of roughly ' + gas + ' (an estimate, gas moves with the network), and keep its seed phrase offline. ' + growthNote(entry), 'gas of roughly ' + gas + ' (estimate) to fund the wallet', '10 minutes'),
    mk(actionFor(entry, stake, firstChain), '$' + stake + ' of capital and gas of roughly ' + gas + ' (estimate)', '15 minutes to set up'),
    mk('If ' + entry.name + ' runs a points program, do one qualifying action each week, such as ' + weeklyActionFor(entry) + ', so the week\'s activity counts toward it.' + secondChainClause + youngClause, 'a few dollars of gas a week', '10 minutes a week'),
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
    range_lo_usd: boardRow.range_lo_usd, range_hi_usd: boardRow.range_hi_usd,
    range_lo10_usd: boardRow.range_lo10_usd, range_hi90_usd: boardRow.range_hi90_usd,
    farm_verdict: boardRow.farm_verdict, off_list: boardRow.off_list,
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
    on_watchlist: isListed,
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
 * The five ratios that carry a row from its radar-2 value to its radar-5 value: their product
 * is implied_v5 / implied_v2, within a dollar of rounding. Growth is the category-relative
 * tanh factor over the old clamped factor; compression is the sub-linear base over the old
 * linear one; age is the old maturity factor dropped; chain is the 3% step over the old 4%;
 * propensity is the tokenization-propensity discount radar-5 applies to the radar-3 value.
 */
function changeRatios(
  row: BoardRow,
  tvlMedian: number,
): { growth: number; compression: number; age: number; chain: number; propensity: number } {
  const change = row.change_7d === null ? 0 : row.change_7d;
  const clamped = Math.max(MODEL_V2.growth_floor, Math.min(MODEL_V2.growth_cap, change));
  const growthV2 = 1 + (clamped / 100) * MODEL_V2.growth_weight;
  const growth = row.model.growth_factor / growthV2;
  const compression = Math.pow(tvlMedian / row.tvl_usd, 0.15);
  const ageForModel = row.age_days === null ? MODEL_V2.unknown_age_days : row.age_days;
  const cappedAge = Math.max(0, Math.min(ageForModel, MODEL_V2.maturity_days));
  const maturityV2 = MODEL_V2.maturity_floor + (cappedAge / MODEL_V2.maturity_days) * MODEL_V2.maturity_range;
  const age = 1 / maturityV2;
  const chainBonus = Math.max(0, Math.min(row.chains.length - 1, MODEL_V2.chain_max_steps));
  const chainV2 = 1 + chainBonus * MODEL_V2.chain_step;
  const chain = row.model.chain_factor / chainV2;
  return { growth, compression, age, chain, propensity: row.propensity };
}

/** One line saying which factor drove a row's move between the releases. Each factor is measured
 * against the board median of that factor, so the reason names what moved this row relative to
 * the board, not what moved the whole board. */
function moveReason(
  row: BoardRow,
  ratios: { growth: number; compression: number; age: number; chain: number; propensity: number },
  medians: { growth: number; compression: number; age: number; chain: number; propensity: number },
  movedUp: boolean,
): string {
  const relative = {
    growth: ratios.growth / medians.growth,
    compression: ratios.compression / medians.compression,
    age: ratios.age / medians.age,
    chain: ratios.chain / medians.chain,
    propensity: ratios.propensity / medians.propensity,
  };
  const entries: Array<[string, number]> = [['growth', relative.growth], ['compression', relative.compression], ['age', relative.age], ['chain', relative.chain], ['propensity', relative.propensity]];
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
    if (growthV2 >= 1.5) return 'The seven-day spike radar-2 rewarded at ' + growthV2.toFixed(2) + 'x is capped at ' + row.model.growth_factor.toFixed(2) + 'x under radar-5: seven-day change ' + fmtPct(change) + ' against a ' + (row.category ?? 'Other') + ' median of ' + fmtPct(catMedian) + '.';
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
  if (kind === 'propensity') {
    if (movedUp) return 'High tokenization propensity of ' + Math.round(row.propensity * 100) + '% lifts it: the value-if-it-launches is barely discounted.';
    return 'Low tokenization propensity of ' + Math.round(row.propensity * 100) + '% holds it back: most of the value-if-it-launches is discounted away.';
  }
  return 'Chain breadth: the chain step fell from 4% to 3%, so extra chains count for less than they did.';
}

/** The radar-2 versus radar-5 comparison: Spearman correlation and the biggest movers. */
function buildComparison(
  ranked: BoardRow[],
  v2RankBySlug: Map<string, number>,
): ModelComparison {
  const currentRankBySlug = new Map<string, number>();
  ranked.forEach((row, i) => currentRankBySlug.set(row.slug, i + 1));
  const spearmanValue = spearman(v2RankBySlug, currentRankBySlug);
  const tvlMedian = ranked[0]?.model.tvl_median ?? 0;
  const ratiosBySlug = new Map<string, { growth: number; compression: number; age: number; chain: number; propensity: number }>();
  for (const row of ranked) ratiosBySlug.set(row.slug, changeRatios(row, tvlMedian));
  const medians = {
    growth: median([...ratiosBySlug.values()].map((r) => r.growth).sort((a, b) => a - b)) ?? 1,
    compression: median([...ratiosBySlug.values()].map((r) => r.compression).sort((a, b) => a - b)) ?? 1,
    age: median([...ratiosBySlug.values()].map((r) => r.age).sort((a, b) => a - b)) ?? 1,
    chain: median([...ratiosBySlug.values()].map((r) => r.chain).sort((a, b) => a - b)) ?? 1,
    propensity: median([...ratiosBySlug.values()].map((r) => r.propensity).sort((a, b) => a - b)) ?? 1,
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
  const propensity = fitPropensityModel(snapshot);
  // Directional scale calibration: the first holdout pass prices the traded tokens with the
  // round 0.25 base; k is the median log ratio of actual cap to predicted value, so the
  // second pass — and the board — run on 0.25 x k, the scale the traded tokens themselves
  // imply. The holdout numbers the dashboard prints come from the second pass, with the
  // calibrated base in place.
  const firstHoldout = holdoutValidation(snapshot, model);
  const scaleK = Math.exp(firstHoldout.log_p50);
  const calibrated: ModelConstants = { ...model, base_multiple: model.base_multiple * scaleK };
  const holdout = holdoutValidation(snapshot, calibrated);
  const accounting = accountingOf(snapshot);
  const ranked = buildBoard(snapshot, calibrated, propensity, holdout);
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
  const comparison = buildComparison(ranked, v2RankBySlug);
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
    propensity, holdout, accounting, verdict_counts: verdictCounts,
    total_implied_usd: totalImplied, mean_propensity: meanPropensity, base_rate: propensity.base_rate,
    scale_k: Math.round(scaleK * 10000) / 10000,
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
    const expected = Math.max(1, Math.round(row.value_if_launches_usd * row.propensity));
    if (row.implied_value_usd !== expected) return row.slug + ' has implied value ' + row.implied_value_usd + ' but value times propensity is ' + expected;
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
