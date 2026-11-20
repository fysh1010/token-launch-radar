// Token Radar's scoring model, release radar-2: a sealed snapshot goes in, a ranked board comes out.
//
// Which protocols make the board. The board always carries every slug the snapshot's watchlist
// names — that list is the floor, never the ceiling — and on top of it the early radar adds
// pre-token protocols sitting below the watchlist floor that clear the house's own visible test
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
// DefiLlama's parentProtocol, so a protocol above the floor that the watchlist skips is never
// added back: the house skipped it, and the board does not overrule a record it cannot read.
// That is why WBTC, Binance staked ETH, Coinbase Bridge and USDT0 never show up on this board,
// however large their TVL.
//
// Implied value comes only from the snapshot's own numbers, the same function scoring every row:
//
//   base      = tvl_usd x BASE_MULTIPLE
//   growth    = clamp(change_7d, -50, 150) per cent          (a missing change counts as 0)
//   growthMul = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity  = 0.65 + min(age_days, 1095) / 1095 x 0.35     (age unknown: 365 days)
//   chainsMul = 1 + 0.04 x min(max(chains - 1, 0), 5)
//   implied   = max(1, round(base x growthMul x maturity x chainsMul))
//
// TVL measures the business a token would price. Seven-day growth is momentum: a protocol
// adding TVL fast is worth more than a flat one of the same size, and a shrinking one less.
// Age is how long the protocol has run with no token: survival is the record of a launch that
// has not happened yet, so older protocols are discounted less. Chain breadth is distribution:
// a protocol live on more chains reaches more wallets on launch day. No protocol name is ever
// special-cased, and no row is hand-picked: one function scores every row, and the dashboard
// prints the formula alongside the constants it runs.

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
  growth_weight: number; // weight of seven-day growth
  growth_floor: number; // growth clamp, low end
  growth_cap: number; // growth clamp, high end
  base_multiple: number; // TVL multiple for the base value
  maturity_floor: number; // maturity multiplier floor
  maturity_range: number; // maturity multiplier range above the floor
  maturity_days: number; // days to full maturity
  unknown_age_days: number; // age assumed when unknown
  chain_step: number; // multiplier step per extra chain
  chain_max_steps: number; // most extra chains that count
}

export const MODEL: ModelConstants = { // the constants the dashboard prints
  base_multiple: 0.25, growth_weight: 0.7, growth_floor: -50, growth_cap: 150,
  maturity_floor: 0.65, maturity_range: 0.35, maturity_days: 1095,
  unknown_age_days: 365, chain_step: 0.04, chain_max_steps: 5,
};

/** The model release label, the one the dashboard shows. */
export const MODEL_VERSION: string = 'radar-2';

/** Live-token rows in the dashboard's Live token view, by market cap. */
export const LIVE_ROWS: number = 24;

/** A farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  cost: string; // what the step costs
  time: string; // how long the step takes
  text: string; // the action itself
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
  implied_value_usd: number; // the model's implied value
  model: { // the multipliers behind the value
    age_days: number | null; // days used for maturity
    base_multiple: number; // TVL multiple used
    growth_pct: number; // clamped seven-day growth
    growth_multiplier: number; // growth multiplier
    maturity_multiplier: number; // maturity multiplier
    chain_multiplier: number; // chain-breadth multiplier
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
  growth_multiplier: number; // growth multiplier
  maturity_multiplier: number; // maturity multiplier
  chain_multiplier: number; // chain-breadth multiplier
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

/** One protocol's four multipliers and implied value under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
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
  const implied = Math.max(1, Math.round(sizedValue * growthFactor * maturityFactor * chainFactor));
  return { implied, growthPct, growthMult: growthFactor, maturityMult: maturityFactor, chainMult: chainFactor, age: protocolAge };
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

/** The board's protocols, strongest first, ranked 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): BoardRow[] {
  const lookup = bySlug(snapshot.protocols);
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: each slug it names joins the board, even one the snapshot no
  // longer carries (it cannot, but board coverage is the gate's row and never rests on a record
  // that might be missing).
  for (const listedSlug of snapshot.watchlist) {
    const entry = lookup.get(listedSlug);
    if (entry !== undefined) picked.set(listedSlug, entry);
  }
  // The early radar: each pre-token protocol below the watchlist floor that clears the visible
  // test. No TVL cap, no hand-picking: the test decides, and the test is the house's own. A
  // protocol above the floor that the watchlist skips is never added back here: the house skipped
  // it on a record this file cannot see (parentProtocol), and the board does not overrule it.
  // A picked protocol stays picked.
  const newcomers = snapshot.protocols
    .filter((entry) => picked.has(entry.slug) === false && isRankable(entry) && entry.tvl_usd < snapshot.floor_usd)
    .sort((x, y) => y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
  for (const entry of newcomers) picked.set(entry.slug, entry);

  const scored = [...picked.values()].map((entry) => {
    const result = impliedValue(entry, snapshot.as_of, model);
    return { entry, ...result };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.entry.slug < b.entry.slug ? -1 : a.entry.slug > b.entry.slug ? 1 : 0));
  return scored.map((item, i) => ({
    rank: i + 1, slug: item.entry.slug, name: item.entry.name,
    category: item.entry.category, chains: item.entry.chains, tvl_usd: item.entry.tvl_usd,
    change_7d: item.entry.change_7d, mcap_usd: item.entry.mcap_usd,
    listed_at: item.entry.listed_at, gecko_id: item.entry.gecko_id, symbol: item.entry.symbol,
    token_status: 'pre-token', age_days: item.age, implied_value_usd: item.implied,
    model: {
      base_multiple: model.base_multiple, growth_pct: item.growthPct,
      growth_multiplier: round4(item.growthMult), maturity_multiplier: round4(item.maturityMult),
      chain_multiplier: round4(item.chainMult), age_days: item.age,
    },
    farm_steps: farmSteps(item.entry, item.age).map(stepText),
  }));
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

/** Gas for one setup transaction, priced by the chain it runs on. */
function gasFor(entry: SnapshotProtocol): number {
  return chainOf(entry) === 'Ethereum' ? 12 : 4;
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
 * Never a token name, never a promised airdrop: the plan farms the protocol as it stands.
 */
function actionFor(entry: SnapshotProtocol, capital: number, chain: string): string {
  const kind = (entry.category ?? '').toLowerCase();
  const label = entry.name;
  if (kind.includes('uncollateralized')) return 'Lend $' + capital + ' of USDC through ' + label + ' on ' + chain + ' to its borrower pool and keep the loan receipts.';
  if (kind.includes('cdp')) return 'Lock $' + capital + ' of USDC as collateral in ' + label + ' on ' + chain + ', mint the stablecoin it issues against it, and keep the collateral ratio above the liquidation line.';
  if (kind.includes('lend') || kind.includes('collateral')) return 'Supply $' + capital + ' of USDC to ' + label + ' on ' + chain + ', borrow a small amount against it, and keep the health factor above the liquidation line.';
  if (kind.includes('interest rate')) return 'Deposit $' + capital + ' of USDC as margin for one interest-rate position on ' + label + ' on ' + chain + ', and close it before the rate leg moves against you.';
  if (kind.includes('perpetual') || kind.includes('derivative')) return 'Deposit $' + capital + ' of USDC as margin on ' + label + ' on ' + chain + ', open one small hedged position, and set a stop so it closes before liquidation.';
  if (kind.includes('basis')) return 'Deposit $' + capital + ' of USDC into ' + label + '\'s basis vault on ' + chain + ' and hold the delta-neutral position while funding stays positive.';
  if (kind.includes('options')) return 'Deposit $' + capital + ' of USDC into an options vault on ' + label + ' on ' + chain + ' and hold the vault shares through one expiry.';
  if (kind.includes('leveraged farm')) return 'Deposit $' + capital + ' of USDC into ' + label + '\'s leveraged farm on ' + chain + ' at the lowest leverage it offers, and watch the borrow rate daily.';
  if (kind.includes('dex')) return 'Provide $' + capital + ' of liquidity to ' + label + '\'s main USDC pair on ' + chain + ', keeping the position in range, and collect the trading fees.';
  if (kind.includes('liquidity manager')) return 'Deposit $' + capital + ' of USDC into a ' + label + ' managed vault on ' + chain + ' and let the manager rebalance the range; keep the shares.';
  if (kind.includes('yield aggregator')) return 'Deposit $' + capital + ' of USDC into ' + label + '\'s largest vault on ' + chain + ' and keep the shares while the strategy runs.';
  if (kind.includes('yield')) return 'Deposit $' + capital + ' of USDC into ' + label + '\'s yield vault on ' + chain + ' and keep the shares while the yield runs.';
  if (kind.includes('curator')) return 'Deposit $' + capital + ' of USDC into a ' + label + ' curated vault on ' + chain + ' and keep the vault shares; the curator picks the underlying markets, not you.';
  if (kind.includes('allocator')) return 'Deposit $' + capital + ' of USDC into ' + label + '\'s allocator vault on ' + chain + ' and let it rotate the funds between strategies.';
  if (kind.includes('restak')) return 'Restake $' + capital + ' of the receipt token through ' + label + ' on ' + chain + ' and keep the restaking receipt.';
  if (kind.includes('staking')) return 'Stake $' + capital + ' of the chain\'s staking asset through ' + label + ' on ' + chain + ' and keep the receipt token.';
  if (kind.includes('bridge')) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + label + ' and use the bridged funds in its app the same week.';
  if (kind.includes('chain')) return 'Bridge $' + capital + ' of USDC to ' + label + ' and use two of its native apps in the same week, starting with the largest one you can find on its own page.';
  if (kind.includes('rwa')) return 'Mint $' + capital + ' of the yield-bearing asset through ' + label + ' on ' + chain + ' and hold it; read the backing report on the protocol\'s own page first.';
  if (kind.includes('wrapper')) return 'Wrap $' + capital + ' of USDC into the wrapped stable through ' + label + ' on ' + chain + ' and hold the wrapped tokens.';
  if (kind.includes('stable')) return 'Mint or deposit $' + capital + ' of the stable asset through ' + label + ' on ' + chain + ' and hold it through one peg check a week.';
  if (kind.includes('btc')) return 'Deposit $' + capital + ' of BTC through ' + label + ' on ' + chain + ' and keep the receipt token until the hold ends.';
  if (kind.includes('prediction')) return 'Fund $' + capital + ' and place one market position on ' + label + ' on ' + chain + ', then settle it when the market resolves.';
  if (kind.includes('insurance')) return 'Buy $' + capital + ' of cover from ' + label + ' on ' + chain + ' and keep the policy open through the hold.';
  if (kind.includes('launchpad')) return 'Join one ' + label + ' launch with $' + capital + ' on ' + chain + ' and hold the allocation through the lock-up.';
  if (kind.includes('token locker')) return 'Lock $' + capital + ' of an asset in ' + label + ' on ' + chain + ' for the shortest term it offers.';
  if (kind.includes('otc')) return 'Place one OTC trade of $' + capital + ' through ' + label + ' on ' + chain + ' and keep the trade receipt.';
  if (kind.includes('cedefi')) return 'Deposit $' + capital + ' of USDC into ' + label + '\'s CeDeFi vault on ' + chain + ' and keep the position open; the vault runs off-chain strategies.';
  if (kind.includes('payment')) return 'Pay or receive $' + capital + ' through ' + label + ' on ' + chain + ' and keep the payment receipt.';
  if (kind.includes('governance')) return 'Lock $' + capital + ' of the governance asset through ' + label + ' on ' + chain + ' and cast one vote in its next proposal.';
  if (kind.includes('card')) return 'Spend $' + capital + ' through a ' + label + ' card on ' + chain + ' and keep the statement for the farm log.';
  if (kind.includes('index')) return 'Buy $' + capital + ' of the ' + label + ' index on ' + chain + ' and hold the shares through one rebalance.';
  if (kind.includes('farm')) return 'Deposit $' + capital + ' of USDC into ' + label + '\'s farm on ' + chain + ' and keep the position open through one reward cycle.';
  return 'Deposit $' + capital + ' of USDC into ' + label + ' on ' + chain + ' and keep the position open.';
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
  if (kind.includes('dex') || kind.includes('liquidity manager')) return 'Open the pool page on ' + label + ' and check the fees earned and whether the position is still in range.';
  if (kind.includes('staking') || kind.includes('restak')) return 'Open ' + label + '\'s staking page on ' + chain + ' and check the rewards accrued on your receipt token.';
  if (kind.includes('rwa') || kind.includes('stable') || kind.includes('wrapper')) return 'Open ' + label + '\'s page on ' + chain + ' and check the peg and the backing report.';
  if (kind.includes('yield') || kind.includes('curator') || kind.includes('allocator') || kind.includes('farm') || kind.includes('leveraged farm')) return 'Open ' + label + '\'s vault page on ' + chain + ' and check the yield accrued and the vault\'s current strategy.';
  if (kind.includes('bridge') || kind.includes('chain')) return 'Open ' + label + ' on ' + chain + ' and check the bridged balance arrived before you move on.';
  if (kind.includes('prediction')) return 'Open ' + label + ' and check whether your market has resolved.';
  if (kind.includes('governance')) return 'Open ' + label + '\'s governance page on ' + chain + ' and check the next proposal.';
  if (kind.includes('insurance')) return 'Open ' + label + '\'s cover page on ' + chain + ' and check the policy is still active.';
  return 'Open ' + label + '\'s own points or rewards page on ' + chain + ' and check what the wallet has earned.';
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
  const gas = gasFor(entry);
  const holdDays = holdDaysFor(age);
  const secondChainClause = secondChain === null ? '' : ' Alternate weeks between ' + firstChain + ' and ' + secondChain + ' so both chains show activity.';
  const youngClause = age !== null && age < 90 ? ' The protocol is only ' + age + ' days old, so check its announcements weekly too.' : '';
  const logSecond = secondChain === null ? '' : ' Note the second chain, ' + secondChain + ', if you farmed there too.';
  const mk = (text: string, cost: string, time: string): FarmStep => ({ text, cost, time });
  const plan: FarmStep[] = [
    mk('Set up a fresh wallet on ' + firstChain + ' with $' + stake + ' of USDC and about $' + gas + ' for gas, and keep its seed phrase offline. ' + growthNote(entry), 'about $' + gas + ' of gas to fund the wallet', '10 minutes'),
    mk(actionFor(entry, stake, firstChain), '$' + stake + ' of capital and about $' + gas + ' of gas', '15 minutes to set up'),
    mk('Do one qualifying action each week, such as ' + weeklyActionFor(entry) + ', so the wallet reads as active rather than one-off.' + secondChainClause + youngClause, 'about $2 of gas a week', '10 minutes a week'),
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
): RadarRow {
  const out: RadarRow = {
    rank: boardRow.rank, slug: boardRow.slug, name: boardRow.name,
    category: boardRow.category, chains: boardRow.chains, tvl_usd: boardRow.tvl_usd,
    change_7d: boardRow.change_7d, mcap_usd: boardRow.mcap_usd,
    listed_at: boardRow.listed_at, age_days: boardRow.age_days,
    implied_value_usd: boardRow.implied_value_usd,
    growth_multiplier: boardRow.model.growth_multiplier,
    maturity_multiplier: boardRow.model.maturity_multiplier,
    chain_multiplier: boardRow.model.chain_multiplier,
    category_tvl_rank: tvlRank, category_growth_median: growthMedian,
    on_watchlist: isListed,
  };
  return out;
}

/** The dashboard's dataset, built from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const ranked = buildBoard(snapshot, model);
  const liveSet = liveRows(snapshot);
  const early = ranked.filter((r) => snapshot.watchlist.includes(r.slug) === false).length;
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
  const radarData: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length, board_size: ranked.length,
    early_size: early, live_size: liveSet.length,
    rows: ranked.map((row) => {
      const standing = standingBySlug.get(row.slug) ?? { tvlRank: 0, growthMedian: null };
      return radarRow(row, standing.tvlRank === 0 ? null : standing.tvlRank, standing.growthMedian, snapshot.watchlist.includes(row.slug));
    }),
    live: liveSet,
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
  }
  return null;
}

/** data.js, compact: the dashboard's whole dataset as one script, no fetch, no network. */
export function dataScript(
  radar: RadarData,
): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}
