// The Radar-3 challenger, model radar-10: the v3 complex model, re-implemented fresh
// from its formula — never copied from the v3 code — and validated on the same terms
// as the flat champion and the radar-9 formula. The challenger is a challenger, not
// the board: the two-stage rolling gate decides whether it takes the board, exactly as
// it decides the blends. If it fails, flat stays champion and radar-3 stays an
// auxiliary valuation per row, alongside the radar-9 one.
//
// The formula, as specified:
//
//   challenger value = round(0.25 x TVL^0.85 x M_c^0.15 x G x C)
//
//   G = 1 + 0.25 x tanh((change_7d - categoryMedian7d) / 25)
//   C = 1 + 0.03 x min(chains - 1, 5)
//
// M_c is the RAW category median TVL of the traded tokens — the median of the
// category's own traded tokens, falling back to the global traded-token median when
// the category has none. That raw median is the formula-structure difference from
// radar-9, whose anchor is the category-SHRUNK median A_c. The distinction matters:
// with the shrunk anchor the challenger would be a constant multiple of radar-9
// (same TVL exponent, same growth, same chains, only the base differs), and the
// nested calibration — which scales the radar component by the median log error of
// the training set — would absorb that constant exactly, making the challenger
// identical to radar-9 on every validation number. A challenger that cannot differ
// is not a challenger. The raw median is what makes the comparison real: the ratio
// M_c / A_c varies by category, so the two models genuinely disagree on some rows.
//
// The category growth medians and the flat multiple come from the same priced set
// the radar-9 validation uses — the traded tokens' own medians — so the challenger
// differs from radar-9 only in the anchor (raw vs shrunk) and the base (round 0.25
// vs the calibrated 0.25 x k). Everything else — the snapshot, the 198 ranked rows,
// the training sets and splits, the two-stage gate, the nested calibration, the
// held-out range method — is identical, so the comparison table is apples to
// apples. The base is NOT a difference that survives validation: each model's own
// nested calibration sets its scale from its own log errors, so the base constant
// is absorbed and only the anchor's shape can move the numbers.
//
// Calibration discipline, the same as radar-9's: the scale belongs to the challenger
// component alone. The flat multiple is already a median and needs no scale. The
// nested leave-one-out pass prices each traded token from the others' priced set
// and scales it by the median log error of the others; the by-time pass fits the
// older half and prices the newer half with a scale from the old samples only; the
// rolling pass prices each block from prior data only. No test sample's own market
// cap ever enters its own scale factor.

import type { Snapshot, SnapshotProtocol } from './model.ts';

/** The challenger release label. */
export const CHALLENGER_VERSION: string = 'radar-3';

/** The challenger's constants, printed beside the model. */
export interface ChallengerConstants {
  base_multiple: number; // round base, before the traded tokens' own scale
  tvl_exponent: number; // sub-linear TVL exponent, below 1
  median_exponent: number; // anchor TVL exponent, the complement of the TVL one
  growth_weight: number; // weight of the category-relative growth factor
  growth_scale: number; // tanh scale in per cent
  chain_step: number; // multiplier step per extra chain
  chain_max_steps: number; // most extra chains that count
}

export const CHALLENGER: ChallengerConstants = {
  base_multiple: 0.25, tvl_exponent: 0.85, median_exponent: 0.15,
  growth_weight: 0.25, growth_scale: 25, chain_step: 0.03, chain_max_steps: 5,
};

/** The challenger's priced set: raw category-median anchors, the priced set's
 * category growth medians, and its flat TVL multiple. The growth medians and the
 * flat multiple are the traded tokens' own medians, the same definition the
 * radar-9 validation uses, so the two models share everything but the anchor. */
export interface ChallengerPricedSet {
  anchors: { global: number; byCategory: Map<string, number> }; // raw category medians
  catMedians: Map<string, number>; // median seven-day change per category, traded tokens
  flatMultiple: number; // median market-cap-to-TVL, traded tokens
}

/** Median of a sorted list; null for an empty one. The even average is rounded to
 * two decimals, the same rule the radar-9 code uses, so a median is a median
 * whichever model reads it. */
function medianSorted(ordered: number[]): number | null {
  const count = ordered.length;
  if (count === 0) return null;
  const middle = Math.floor(count / 2);
  if (count % 2 === 1) return ordered[middle]!;
  return Math.round(((ordered[middle - 1]! + ordered[middle]!) / 2) * 100) / 100;
}

/** A quantile of a sorted list, by linear interpolation between the two nearest values. */
function quantileSorted(ordered: number[], q: number): number {
  if (ordered.length === 0) return 0;
  const pos = (ordered.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return ordered[lo]!;
  return ordered[lo]! + (ordered[hi]! - ordered[lo]!) * (pos - lo);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * The challenger's anchors: the raw category median TVL of the traded tokens, per
 * category, with the global traded-token median as the fallback. No shrinkage: a
 * category with one traded token keeps that token's TVL as its anchor, however far
 * from the global median — that is the v3 definition, and the difference from the
 * shrunk anchor is the experiment.
 */
export function challengerAnchors(
  traded: SnapshotProtocol[],
): { global: number; byCategory: Map<string, number> } {
  const global = medianSorted(traded.map((p) => p.tvl_usd).sort((a, b) => a - b)) ?? 0;
  const byCat = new Map<string, number[]>();
  for (const p of traded) {
    const key = p.category ?? 'Other';
    const values = byCat.get(key) ?? [];
    values.push(p.tvl_usd);
    byCat.set(key, values);
  }
  const byCategory = new Map<string, number>();
  for (const [key, values] of byCat) {
    byCategory.set(key, medianSorted(values.sort((a, b) => a - b)) ?? global);
  }
  return { global, byCategory };
}

/** One protocol's raw anchor: its category's traded-token median, or the global one. */
export function challengerAnchorFor(
  category: string | null,
  anchors: { global: number; byCategory: Map<string, number> },
): number {
  return anchors.byCategory.get(category ?? 'Other') ?? anchors.global;
}

/** The priced set a group of traded tokens implies for the challenger: raw anchors,
 * plus the category growth medians and flat multiple from the same group — the same
 * medians the radar-9 validation reads, so the two models share the priced set
 * except for the anchor. */
export function challengerPricedSet(
  priced: SnapshotProtocol[],
): ChallengerPricedSet {
  const anchors = challengerAnchors(priced);
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
    const med = medianSorted(values.sort((a, b) => a - b));
    if (med !== null) catMedians.set(key, med);
  }
  const flatMultiple = medianSorted(priced.map((p) => (p.mcap_usd ?? 0) / p.tvl_usd).sort((a, b) => a - b)) ?? 0;
  return { anchors, catMedians, flatMultiple };
}

/**
 * One protocol's value under the challenger formula, with anchors and category
 * medians fitted on the priced set given: round(0.25 x TVL^0.85 x M_c^0.15 x G x C).
 * The base is the round 0.25 here — the calibration scale is applied by the caller,
 * never inside this function, so the raw value and the calibrated value stay apart.
 */
export function challengerValue(
  entry: SnapshotProtocol,
  set: ChallengerPricedSet,
): number {
  const anchor = challengerAnchorFor(entry.category, set.anchors);
  const tvlBase = CHALLENGER.base_multiple * Math.pow(entry.tvl_usd, CHALLENGER.tvl_exponent) * Math.pow(anchor, CHALLENGER.median_exponent);
  const catMedian = set.catMedians.get(entry.category ?? 'Other') ?? null;
  const growth = entry.change_7d === null || catMedian === null
    ? 1
    : 1 + CHALLENGER.growth_weight * Math.tanh((entry.change_7d - catMedian) / CHALLENGER.growth_scale);
  const chainBonus = Math.max(0, Math.min(entry.chains.length - 1, CHALLENGER.chain_max_steps));
  return Math.max(1, Math.round(tvlBase * growth * (1 + chainBonus * CHALLENGER.chain_step)));
}

/**
 * One protocol's challenger factors on the board: the calibrated challenger value
 * and the pieces behind it, so a board row can carry them the way it carries the
 * radar-9 factors. The growth median here is the BOARD-wide one (over the picked
 * rows), the same split the radar-9 board path uses: the board scores against the
 * board's own medians, while the validation scores against the priced set's. The
 * scale k3 is the challenger's own, from its full-set nested leave-one-out pass.
 */
export function challengerRowFactors(
  entry: SnapshotProtocol,
  anchors: { global: number; byCategory: Map<string, number> },
  boardCatMedian: number | null,
  k3: number,
): { value: number; tvlBase: number; growthFactor: number; chainFactor: number; anchor: number } {
  const anchor = challengerAnchorFor(entry.category, anchors);
  const tvlBase = CHALLENGER.base_multiple * k3 * Math.pow(entry.tvl_usd, CHALLENGER.tvl_exponent) * Math.pow(anchor, CHALLENGER.median_exponent);
  const growthFactor = entry.change_7d === null || boardCatMedian === null
    ? 1
    : 1 + CHALLENGER.growth_weight * Math.tanh((entry.change_7d - boardCatMedian) / CHALLENGER.growth_scale);
  const chainBonus = Math.max(0, Math.min(entry.chains.length - 1, CHALLENGER.chain_max_steps));
  const chainFactor = 1 + chainBonus * CHALLENGER.chain_step;
  const value = Math.max(1, Math.round(tvlBase * growthFactor * chainFactor));
  return { value, tvlBase, growthFactor, chainFactor, anchor };
}

/** The nested leave-one-out pass over a traded set under the challenger: pass one
 * prices every token from the others' priced set; pass two scales each prediction
 * by the median log error of the others — the scale belongs to the challenger
 * alone, and the flat multiple is already a median and needs none. The median raw
 * log error is the scale the set implies for the challenger, and the nested log
 * errors are the distribution the printed ranges are cut from. */
export interface ChallengerNestedLoo {
  misses: number[]; // per-sample miss of the calibrated challenger value
  flatMisses: number[]; // per-sample miss of the flat TVL multiple
  logErrors: number[]; // nested log errors, log(actual / predicted)
  rawLogErrors: number[]; // raw (pre-calibration) log errors
  p50Raw: number; // median raw log error
}

export function challengerNestedLoo(
  traded: SnapshotProtocol[],
): ChallengerNestedLoo {
  const rawValues: number[] = [];
  const flatPredicted: number[] = [];
  const rawLogErrors: number[] = [];
  const challengerLogErrors: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const entry = traded[i]!;
    const others = traded.filter((_, j) => j !== i);
    const set = challengerPricedSet(others);
    const raw = challengerValue(entry, set);
    const flat = Math.max(1, Math.round(set.flatMultiple * entry.tvl_usd));
    rawValues.push(raw);
    flatPredicted.push(flat);
    rawLogErrors.push(Math.log(entry.mcap_usd! / raw));
    challengerLogErrors.push(Math.log(entry.mcap_usd! / raw));
  }
  const misses: number[] = [];
  const flatMisses: number[] = [];
  const logErrors: number[] = [];
  for (let i = 0; i < traded.length; i++) {
    const othersLog: number[] = [];
    for (let j = 0; j < traded.length; j++) {
      if (j === i) continue;
      othersLog.push(challengerLogErrors[j]!);
    }
    const kI = Math.exp(medianSorted(othersLog.sort((a, b) => a - b)) ?? 0);
    const predicted = Math.max(1, Math.round(rawValues[i]! * kI));
    const actual = traded[i]!.mcap_usd!;
    misses.push(Math.max(predicted / actual, actual / predicted));
    flatMisses.push(Math.max(flatPredicted[i]! / actual, actual / flatPredicted[i]!));
    logErrors.push(Math.log(actual / predicted));
  }
  return {
    misses, flatMisses, logErrors, rawLogErrors,
    p50Raw: medianSorted([...rawLogErrors].sort((a, b) => a - b)) ?? 0,
  };
}

/** What the holdout tests say about the challenger: leave-one-out and by-time
 * against the flat TVL multiple, with nested calibration, and the printed ranges
 * cut from the older half's nested leave-one-out errors and frozen before the
 * newer half is scored — the same held-out range method the board uses. */
export interface ChallengerHoldout {
  loo_n: number; // traded tokens priced leave-one-out
  loo_median_miss: number; // median miss of the challenger, leave-one-out
  loo_flat_median_miss: number; // median miss of the flat TVL multiple, leave-one-out
  loo_within_2x: number; // share of leave-one-out caps within 2x of the prediction
  bytime_n: number; // traded tokens in the newer half of the by-time test
  bytime_split: string; // the listing date the by-time test splits on
  bytime_median_miss: number; // median miss of the challenger, by-time
  bytime_flat_median_miss: number; // median miss of the flat multiple, by-time
  bytime_train_log_median: number; // median raw log error of the older half
  bytime_test_log_median: number; // median raw log error of the newer half before calibration
  log_p10: number; // 10th percentile of the nested leave-one-out log error
  log_p20: number; // 20th percentile
  log_p50: number; // median
  log_p80: number; // 80th percentile
  log_p90: number; // 90th percentile
  log_p50_raw: number; // median of the raw (pre-calibration) leave-one-out log errors
  range_lo_factor: number; // exp(P20 of the older half's nested leave-one-out log errors)
  range_hi_factor: number; // exp(P80)
  range_lo10_factor: number; // exp(P10)
  range_hi90_factor: number; // exp(P90)
  coverage_central60: number; // share of by-time held-out caps inside the printed Historical model error range
  coverage_1090: number; // share inside the printed P10-P90 range
}

export function challengerHoldout(
  snapshot: Snapshot,
): ChallengerHoldout {
  const empty: ChallengerHoldout = {
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
  const loo = challengerNestedLoo(traded);
  const misses = loo.misses;
  const flatMisses = loo.flatMisses;
  const logErrors = loo.logErrors;
  const sortedLog = [...logErrors].sort((a, b) => a - b);
  const p10 = quantileSorted(sortedLog, 0.1);
  const p20 = quantileSorted(sortedLog, 0.2);
  const p50 = quantileSorted(sortedLog, 0.5);
  const p80 = quantileSorted(sortedLog, 0.8);
  const p90 = quantileSorted(sortedLog, 0.9);
  const p50Raw = loo.p50Raw;
  const within2x = misses.filter((m) => m <= 2).length / misses.length;
  const dated = traded
    .filter((entry) => entry.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  let bandLog = sortedLog;
  if (dated.length >= 4) {
    const half = Math.floor(dated.length / 2);
    const olderLoo = challengerNestedLoo(dated.slice(0, half));
    const olderSorted = [...olderLoo.logErrors].sort((a, b) => a - b);
    if (olderSorted.length > 0) bandLog = olderSorted;
  }
  const rangeLo = round4(Math.exp(quantileSorted(bandLog, 0.2)));
  const rangeHi = round4(Math.exp(quantileSorted(bandLog, 0.8)));
  const rangeLo10 = round4(Math.exp(quantileSorted(bandLog, 0.1)));
  const rangeHi90 = round4(Math.exp(quantileSorted(bandLog, 0.9)));
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
    const trainSet = challengerPricedSet(older);
    // The by-time scale factor comes from the OLD samples only, fixed before any newer
    // sample is priced, and it belongs to the challenger alone: each old sample's
    // challenger value is priced from the old set's priced set, the median of their
    // log errors sets k_train, and the newer half is priced with the challenger scaled
    // by it. No newer market cap enters the calibration.
    const trainChallengerLog = older.map((entry) => Math.log(entry.mcap_usd! / challengerValue(entry, trainSet)));
    const kTrain = Math.exp(medianSorted(trainChallengerLog.sort((a, b) => a - b)) ?? 0);
    const trainLogMedian = medianSorted(older.map((entry) => Math.log(entry.mcap_usd! / challengerValue(entry, trainSet))).sort((a, b) => a - b)) ?? 0;
    const testLogMedian = medianSorted(newer.map((entry) => Math.log(entry.mcap_usd! / challengerValue(entry, trainSet))).sort((a, b) => a - b)) ?? 0;
    const byMisses: number[] = [];
    const byFlatMisses: number[] = [];
    let inCentral60 = 0;
    let in1090 = 0;
    for (const entry of newer) {
      const predicted = Math.max(1, Math.round(challengerValue(entry, trainSet) * kTrain));
      const flatPredicted = Math.max(1, Math.round(trainSet.flatMultiple * entry.tvl_usd));
      const actual = entry.mcap_usd!;
      byMisses.push(Math.max(predicted / actual, actual / predicted));
      byFlatMisses.push(Math.max(flatPredicted / actual, actual / flatPredicted));
      if (predicted * rangeLo <= actual && actual <= predicted * rangeHi) inCentral60++;
      if (predicted * rangeLo10 <= actual && actual <= predicted * rangeHi90) in1090++;
    }
    bytimeN = newer.length;
    bytimeSplit = newer[0]!.listed_at!;
    bytimeMiss = medianSorted(byMisses.sort((a, b) => a - b)) ?? 0;
    bytimeFlatMiss = medianSorted(byFlatMisses.sort((a, b) => a - b)) ?? 0;
    bytimeTrainLogMedian = trainLogMedian;
    bytimeTestLogMedian = testLogMedian;
    coverageCentral60 = Math.round((inCentral60 / newer.length) * 10000) / 10000;
    coverage1090 = Math.round((in1090 / newer.length) * 10000) / 10000;
  }
  return {
    loo_n: traded.length,
    loo_median_miss: medianSorted(misses.sort((a, b) => a - b)) ?? 0,
    loo_flat_median_miss: medianSorted(flatMisses.sort((a, b) => a - b)) ?? 0,
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

/** One rolling test block for the challenger. */
export interface ChallengerBlock {
  block: number; // 1-based block number
  start: string; // first listing date in the block
  end: string; // last listing date in the block
  n: number; // test protocols in the block
  train_n: number; // training protocols before the block
  flat_median_miss: number; // flat TVL median miss on the block
  challenger_median_miss: number; // median miss of the challenger on the block
  central60_coverage: number; // challenger: share of the block inside the Historical model error range
  p1090_coverage: number; // challenger: share of the block inside P10-P90
}

/** The challenger's strict rolling validation: the same dated traded tokens, the
 * same initial training set and four consecutive test blocks as the radar-9
 * rolling validation, each block priced from prior data only, the same two-stage
 * gate — blocks 1-3 select (pooled median miss at least 10% below flat and at
 * least 2 of 3 blocks better), block 4 only vetoes (not more than 10% worse than
 * flat). One model, not a blend: the gate is the challenger's own, and it is the
 * gate that decides whether the board switches to it. */
export interface ChallengerRolling {
  dated_n: number; // dated traded tokens the rolling runs on
  initial_n: number; // initial training set size
  block_n: number; // test protocols per block
  pooled_miss_123: number; // pooled median miss on blocks 1-3
  flat_pooled_123: number; // flat pooled median miss, blocks 1-3
  better_123: number; // blocks 1-3 better than flat, 0..3
  veto: boolean; // block 4 not more than 10% worse than flat
  passed: boolean; // train gate and veto
  per_block_miss: number[]; // median miss per rolling block
  flat_per_block_miss: number[]; // flat median miss per block
  blocks: ChallengerBlock[]; // the four test blocks, in listing order
}

export function challengerRolling(
  snapshot: Snapshot,
): ChallengerRolling {
  const empty: ChallengerRolling = {
    dated_n: 0, initial_n: 0, block_n: 0,
    pooled_miss_123: 0, flat_pooled_123: 0, better_123: 0, veto: false, passed: false,
    per_block_miss: [], flat_per_block_miss: [], blocks: [],
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
  // Per block: the block priced from prior data only. The block's scale factor
  // belongs to the challenger alone — exp(median log error of the training set's
  // challenger values) — so the scale never sees the block it prices and the flat
  // multiple stays untouched. Range endpoints come from the training set's nested
  // leave-one-out log errors under the challenger — prior data only, never the block.
  const blockMiss: number[] = [];
  const blockFlatMiss: number[] = [];
  const blockCentral: number[] = [];
  const blockP1090: number[] = [];
  const blockMisses: number[][] = [];
  const blockFlatMisses: number[][] = [];
  for (let b = 0; b < 4; b++) {
    const trainEnd = initialN + b * blockSize;
    const train = dated.slice(0, trainEnd);
    const test = blocks[b]!;
    const trainSet = challengerPricedSet(train);
    const loo = challengerNestedLoo(train);
    const ordered = [...loo.logErrors].sort((x, y) => x - y);
    const ep = {
      lo: Math.exp(quantileSorted(ordered, 0.2)),
      hi: Math.exp(quantileSorted(ordered, 0.8)),
      lo10: Math.exp(quantileSorted(ordered, 0.1)),
      hi90: Math.exp(quantileSorted(ordered, 0.9)),
    };
    const trainChallengerLog = train.map((entry) => Math.log(entry.mcap_usd! / challengerValue(entry, trainSet)));
    const kRadar3 = Math.exp(medianSorted(trainChallengerLog.sort((x, y) => x - y)) ?? 0);
    const misses: number[] = [];
    let inCentral = 0;
    let in1090 = 0;
    for (const entry of test) {
      const predicted = Math.max(1, Math.round(challengerValue(entry, trainSet) * kRadar3));
      const actual = entry.mcap_usd!;
      misses.push(Math.max(predicted / actual, actual / predicted));
      if (predicted * ep.lo <= actual && actual <= predicted * ep.hi) inCentral++;
      if (predicted * ep.lo10 <= actual && actual <= predicted * ep.hi90) in1090++;
    }
    const flatMisses = test.map((entry) => {
      const flat = Math.max(1, Math.round(trainSet.flatMultiple * entry.tvl_usd));
      const actual = entry.mcap_usd!;
      return Math.max(flat / actual, actual / flat);
    });
    blockMiss.push(medianSorted([...misses].sort((x, y) => x - y)) ?? 0);
    blockCentral.push(Math.round((inCentral / test.length) * 10000) / 10000);
    blockP1090.push(Math.round((in1090 / test.length) * 10000) / 10000);
    blockMisses.push(misses);
    blockFlatMiss.push(medianSorted([...flatMisses].sort((x, y) => x - y)) ?? 0);
    blockFlatMisses.push(flatMisses);
  }
  // Pooled medians over blocks 1-3 only: block 4 never enters a selection number.
  const pooled123 = medianSorted(blockMisses.slice(0, 3).flat().sort((x, y) => x - y)) ?? 0;
  const flatPooled123 = medianSorted(blockFlatMisses.slice(0, 3).flat().sort((x, y) => x - y)) ?? 0;
  let better = 0;
  for (let b = 0; b < 3; b++) if (blockMiss[b]! < blockFlatMiss[b]!) better++;
  const trainGate = pooled123 <= 0.9 * flatPooled123 && better >= 2;
  const veto = blockMiss[3]! <= 1.1 * blockFlatMiss[3]!;
  const blocksOut: ChallengerBlock[] = blocks.map((test, b) => ({
    block: b + 1,
    start: test[0]!.listed_at!,
    end: test[test.length - 1]!.listed_at!,
    n: test.length,
    train_n: initialN + b * blockSize,
    flat_median_miss: round4(blockFlatMiss[b]!),
    challenger_median_miss: round4(blockMiss[b]!),
    central60_coverage: blockCentral[b]!,
    p1090_coverage: blockP1090[b]!,
  }));
  return {
    dated_n: dated.length, initial_n: initialN, block_n: blockSize,
    pooled_miss_123: round4(pooled123), flat_pooled_123: round4(flatPooled123),
    better_123: better, veto, passed: trainGate && veto,
    per_block_miss: blockMiss.map((m) => round4(m)),
    flat_per_block_miss: blockFlatMiss.map((m) => round4(m)),
    blocks: blocksOut,
  };
}

/** The challenger's full validation: the nested leave-one-out scale, the holdout
 * and the rolling gate, all on the same snapshot the board runs on. */
export interface ChallengerValidation {
  version: string; // 'radar-3'
  scale_k3: number; // exp of the full-set nested leave-one-out median raw log error — the challenger's own scale, so its board values carry it the way the radar-9 board carries 0.25 x k
  anchors: { global: number; byCategory: Map<string, number> }; // the raw category-median TVL anchors from the full traded set, the ones the board scores against
  holdout: ChallengerHoldout; // leave-one-out and by-time, nested calibration
  rolling: ChallengerRolling; // strict rolling validation and the two-stage gate
  gate_notes: string; // one line saying whether the challenger passes the gate and why, in numbers
}

export function validateChallenger(
  snapshot: Snapshot,
): ChallengerValidation {
  const holdout = challengerHoldout(snapshot);
  const rolling = challengerRolling(snapshot);
  const traded = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const anchors = challengerAnchors(traded);
  const pctBelow = Math.round((1 - rolling.pooled_miss_123 / rolling.flat_pooled_123) * 1000) / 10;
  const gate_notes = rolling.passed
    ? 'Radar-3 passes the two-stage gate: pooled miss ' + rolling.pooled_miss_123 + ' vs flat ' + rolling.flat_pooled_123 + ' (' + pctBelow + '% below), ' + rolling.better_123 + '/3 blocks better, block 4 veto passes.'
    : 'Radar-3 fails the two-stage gate: pooled miss ' + rolling.pooled_miss_123 + ' vs flat ' + rolling.flat_pooled_123 + ' (' + pctBelow + '% below, needs 10%), ' + rolling.better_123 + '/3 blocks better' + (rolling.veto ? '' : ', block 4 veto fails') + '.';
  return {
    version: CHALLENGER_VERSION,
    scale_k3: Math.round(Math.exp(holdout.log_p50_raw) * 10000) / 10000,
    anchors,
    holdout,
    rolling,
    gate_notes,
  };
}
