// Token Radar's dashboard, model radar-5. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, and a per-protocol detail drawer
// with the model inputs and farm plan. No network: every byte shown is in data.js. impliedOf
// recomputes a row (value times tokenization propensity), propensityOf recomputes the fitted
// score, v2ImpliedOf recomputes the previous release's value, and farmSteps rebuilds a row's
// plan from its category, chains, TVL and age — the same arithmetic main.ts writes to board.json.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchlistOnly: false, verdict: 'all' };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(2) + 'x'; }

  // Medians are board-wide figures from the rows data.js carries, so the page recomputes a row
  // and checks the number board.json carries.
  function medianOf(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    if (n === 0) return null;
    if (n % 2 === 1) return s[(n - 1) / 2];
    return Math.round(((s[n / 2 - 1] + s[n / 2]) / 2) * 100) / 100;
  }
  function modelContext() {
    var tvlMedian = medianOf(DATA.rows.map(function (r) { return r.tvl_usd; }));
    var byCat = {};
    DATA.rows.forEach(function (r) {
      if (r.change_7d === null || r.change_7d === undefined) return;
      var c = r.category || 'Other';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(r.change_7d);
    });
    var catMedian = {};
    Object.keys(byCat).forEach(function (k) { catMedian[k] = medianOf(byCat[k]); });
    return { tvlMedian: tvlMedian, catMedian: catMedian };
  }
  var CTX = modelContext();
  function tvlBaseOf(row) {
    var m = DATA.model;
    return m.base_multiple * Math.pow(row.tvl_usd, m.tvl_exponent) * Math.pow(CTX.tvlMedian, m.median_exponent);
  }
  function growthFactorOf(row) {
    var m = DATA.model;
    if (row.change_7d === null || row.change_7d === undefined) return 1;
    var med = CTX.catMedian[row.category || 'Other'];
    if (med === null || med === undefined) return 1;
    return 1 + m.growth_weight * Math.tanh((row.change_7d - med) / m.growth_scale);
  }
  function chainFactorOf(row) {
    var m = DATA.model;
    return 1 + m.chain_step * Math.min(Math.max((row.chains || []).length - 1, 0), m.chain_max_steps);
  }
  // Tokenization propensity, the same logistic model main.ts fits: four features standardised
  // on the training set, through the fitted weights. The category rate leaves the row itself
  // out, as the fit does. Constants 6, 365 and 30 are the PROPENSITY constants in lib/model.ts.
  function propensityOf(row) {
    var o = DATA.propensity;
    var cat = row.category || 'Other';
    var total = (o.cat_total[cat] || 0) - 1;
    var launched = o.cat_launched[cat] || 0;
    var rate = total > 0 ? (launched + 1) / (total + 2) : 0.5;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var f = [Math.log10(Math.max(row.tvl_usd, 1)), Math.log10(age + 30), Math.min((row.chains || []).length, 6), rate];
    var z = o.weights[0];
    for (var d = 0; d < f.length; d++) z += o.weights[d + 1] * ((f[d] - o.means[d]) / o.sds[d]);
    var clipped = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-clipped));
  }
  function valueIfLaunchesOf(row) {
    return Math.max(1, tvlBaseOf(row) * growthFactorOf(row) * chainFactorOf(row));
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(valueIfLaunchesOf(row) * propensityOf(row)));
  }
  function propensityBand(p) { return p >= 0.66 ? 'High' : p >= 0.33 ? 'Medium' : 'Low'; }

  // The previous release's value, recomputed live: linear TVL, clamped growth weighted 0.7,
  // a maturity factor, 4% a chain.
  function v2ImpliedOf(row) {
    var growth = Math.min(150, Math.max(-50, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * 0.7;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var maturity = 0.65 + (Math.min(Math.max(age, 0), 1095) / 1095) * 0.35;
    var chainSteps = Math.min(Math.max((row.chains || []).length - 1, 0), 5);
    var chainMult = 1 + chainSteps * 0.04;
    return Math.max(1, Math.round(row.tvl_usd * 0.25 * growthMult * maturity * chainMult));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function gasRange(p) { return chainOf(p) === 'Ethereum' ? '$8-15' : '$1-5'; }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function fmtTvl(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function growthNote(p) {
    var change = p.change_7d;
    if (change === null || change === undefined) return 'The snapshot carries no seven-day change, so enter at the standard size and let the first month set the pace.';
    if (change >= 20) return 'TVL is up ' + fmtPct(change) + ' in seven days, so fund the position this week while the growth is fresh.';
    if (change >= 5) return 'TVL is up ' + fmtPct(change) + ' in seven days, so enter now rather than waiting for a pullback.';
    if (change > -5) return 'TVL is near flat over seven days (' + fmtPct(change) + '), so there is no rush to fund it all at once.';
    if (change > -20) return 'TVL is down ' + fmtPct(change) + ' in seven days, so fund half now and the rest only after the decline flattens.';
    return 'TVL is down ' + fmtPct(change) + ' in seven days, so start with half the capital and wait for two flat snapshots before adding.';
  }
  function ageNote(age, hold) {
    if (age === null || age === undefined) return 'The snapshot carries no listing date, so treat the hold as the full ' + hold + ' days.';
    if (age < 90) return 'It was listed only ' + age + ' days ago, so the full ' + hold + '-day hold matters: a young protocol is judged on more than one snapshot.';
    if (age < 365) return 'It has run ' + age + ' days with no token, so hold the full ' + hold + ' days to cross another snapshot cycle.';
    return 'It has run ' + age + ' days with no token, so the hold is about the snapshot cycle, not about waiting on the team.';
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('uncollateralized') >= 0) return 'If ' + name + ' lends to a borrower pool, lend $' + capital + ' of USDC through it on ' + chain + ' and keep the loan receipts.';
    if (c.indexOf('cdp') >= 0) return 'If ' + name + ' mints a stablecoin against collateral, lock $' + capital + ' of USDC in it on ' + chain + ' and keep the collateral ratio above the liquidation line.';
    if (c.indexOf('lend') >= 0 || c.indexOf('collateral') >= 0) return 'If ' + name + ' runs a lending market, supply $' + capital + ' of USDC to it on ' + chain + ', borrow a small amount against it, and keep the health factor above the liquidation line.';
    if (c.indexOf('interest rate') >= 0) return 'If ' + name + ' offers interest-rate positions, deposit $' + capital + ' of USDC as margin for one on ' + chain + ', and close it before the rate leg moves against you.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'If ' + name + ' runs a perpetual or derivatives market, deposit $' + capital + ' of USDC as margin on ' + chain + ', open one small hedged position, and set a stop so it closes before liquidation.';
    if (c.indexOf('basis') >= 0) return 'If ' + name + ' runs a basis vault on ' + chain + ', deposit $' + capital + ' of USDC into it and hold the delta-neutral position while funding stays positive.';
    if (c.indexOf('options') >= 0) return 'If ' + name + ' runs an options vault on ' + chain + ', deposit $' + capital + ' of USDC into it and hold the vault shares through one expiry.';
    if (c.indexOf('leveraged farm') >= 0) return 'If ' + name + ' runs a leveraged farm on ' + chain + ', deposit $' + capital + ' of USDC into it at the lowest leverage it offers, and watch the borrow rate daily.';
    if (c.indexOf('dex') >= 0) return 'If ' + name + ' runs a liquidity pool on ' + chain + ', provide $' + capital + ' of liquidity to its main pool, keeping the position in range, and collect the trading fees.';
    if (c.indexOf('liquidity manager') >= 0) return 'If ' + name + ' runs a managed vault on ' + chain + ', deposit $' + capital + ' of USDC into it and let the manager rebalance the range; keep the shares.';
    if (c.indexOf('yield aggregator') >= 0) return 'If ' + name + ' runs a vault on ' + chain + ', deposit $' + capital + ' of USDC into its main vault and keep the shares while the strategy runs.';
    if (c.indexOf('yield') >= 0) return 'If ' + name + ' runs a yield vault on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the shares while the yield runs.';
    if (c.indexOf('curator') >= 0) return 'If ' + name + ' runs a curated vault on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the vault shares; the curator picks the underlying markets, not you.';
    if (c.indexOf('allocator') >= 0) return 'If ' + name + ' runs an allocator vault on ' + chain + ', deposit $' + capital + ' of USDC into it and let it rotate the funds between strategies.';
    if (c.indexOf('restak') >= 0) return 'If ' + name + ' accepts restaking on ' + chain + ', restake $' + capital + ' of the receipt token through it and keep the restaking receipt.';
    if (c.indexOf('staking') >= 0) return 'If ' + name + ' runs staking on ' + chain + ', stake $' + capital + " of the chain's staking asset through it and keep the receipt token.";
    if (c.indexOf('bridge') >= 0) return 'If ' + name + ' bridges USDC to ' + chain + ', bridge $' + capital + ' of USDC through it and use the bridged funds in its app the same week.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + name + ' and, if it runs native apps, use two of them in the same week, starting with the largest one you can find on its own page.';
    if (c.indexOf('rwa') >= 0) return 'If ' + name + ' issues a yield-bearing asset on ' + chain + ', mint $' + capital + " of it and hold it; read the backing report on the protocol's own page first.";
    if (c.indexOf('wrapper') >= 0) return 'If ' + name + ' wraps USDC into a wrapped stable on ' + chain + ', wrap $' + capital + ' of it and hold the wrapped tokens.';
    if (c.indexOf('stable') >= 0) return 'If ' + name + ' issues or holds a stable asset on ' + chain + ', mint or deposit $' + capital + ' of it and hold it through one peg check a week.';
    if (c.indexOf('btc') >= 0) return 'If ' + name + ' accepts BTC deposits on ' + chain + ', deposit $' + capital + ' of BTC through it and keep the receipt token until the hold ends.';
    if (c.indexOf('prediction') >= 0) return 'If ' + name + ' runs a prediction market on ' + chain + ', fund $' + capital + ' and place one market position on it, then settle it when the market resolves.';
    if (c.indexOf('insurance') >= 0) return 'If ' + name + ' sells cover on ' + chain + ', buy $' + capital + ' of it and keep the policy open through the hold.';
    if (c.indexOf('launchpad') >= 0) return 'If ' + name + ' runs a launch on ' + chain + ', join one with $' + capital + ' on ' + chain + ' and hold the allocation through the lock-up.';
    if (c.indexOf('token locker') >= 0) return 'If ' + name + ' runs a locker on ' + chain + ', lock $' + capital + ' of an asset in it for the shortest term it offers.';
    if (c.indexOf('otc') >= 0) return 'If ' + name + ' runs an OTC desk on ' + chain + ', place one trade of $' + capital + ' through it and keep the trade receipt.';
    if (c.indexOf('cedefi') >= 0) return 'If ' + name + ' runs a CeDeFi vault on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the position open; the vault runs off-chain strategies.';
    if (c.indexOf('payment') >= 0) return 'If ' + name + ' handles payments on ' + chain + ', pay or receive $' + capital + ' through it and keep the payment receipt.';
    if (c.indexOf('governance') >= 0) return 'If ' + name + ' has a governance asset and an open proposal, lock $' + capital + ' of it through ' + name + ' on ' + chain + ' and cast one vote.';
    if (c.indexOf('card') >= 0) return 'If ' + name + ' issues a card, spend $' + capital + ' through it on ' + chain + ' and keep the statement for the farm log.';
    if (c.indexOf('index') >= 0) return 'If ' + name + ' runs an index on ' + chain + ', buy $' + capital + ' of it and hold the shares through one rebalance.';
    if (c.indexOf('farm') >= 0) return 'If ' + name + ' runs a farm on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the position open through one reward cycle.';
    return 'If ' + name + ' accepts deposits on ' + chain + ', deposit $' + capital + ' of USDC into it and keep the position open.';
  }
  function weeklyActionFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('interest rate') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('basis') >= 0) return 'one small trade or hedge, and close it before funding eats the margin';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'a borrow, a repay or a new supply, and check the health factor each time';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'a swap or a liquidity change in the same pool';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'a stake top-up or a rewards check';
    if (c.indexOf('rwa') >= 0 || c.indexOf('stable') >= 0 || c.indexOf('wrapper') >= 0) return 'a peg or backing check';
    if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('leveraged farm') >= 0) return 'a vault deposit or a rewards check';
    if (c.indexOf('prediction') >= 0) return 'one market position, settled when the market resolves';
    if (c.indexOf('governance') >= 0) return 'a vote or a forum post on the next proposal';
    if (c.indexOf('bridge') >= 0 || c.indexOf('chain') >= 0) return 'one bridge or one app interaction on the same chain';
    return 'a deposit, a swap or a vote';
  }
  function checkActionFor(p, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Open ' + name + "'s dashboard on " + chain + ' and check the borrow rate and your health factor.';
    if (c.indexOf('interest rate') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('basis') >= 0) return 'Open ' + name + "'s trading page on " + chain + ' and check funding, margin and any open position.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Open ' + name + "'s page on " + chain + ' and check the pool, if it runs one, and the fees earned and whether the position is still in range.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Open ' + name + "'s page on " + chain + ' and check the staking rewards accrued on your receipt token, if it runs staking.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('stable') >= 0 || c.indexOf('wrapper') >= 0) return 'Open ' + name + "'s page on " + chain + ' and check the peg and the backing report.';
    if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Open ' + name + "'s page on " + chain + " and check the vault, if it runs one, and the yield accrued and the vault's current strategy.";
    if (c.indexOf('bridge') >= 0 || c.indexOf('chain') >= 0) return 'Open ' + name + ' on ' + chain + ' and check the bridged balance arrived before you move on.';
    if (c.indexOf('prediction') >= 0) return 'Open ' + name + ' and check whether your market has resolved.';
    if (c.indexOf('governance') >= 0) return 'Open ' + name + "'s governance page on " + chain + ' and check the next proposal.';
    if (c.indexOf('insurance') >= 0) return 'Open ' + name + "'s cover page on " + chain + ' and check the policy is still active.';
    return 'Open ' + name + "'s own page on " + chain + ' and check whether it runs a points or rewards program; if it does, check what the wallet has earned.';
  }
  function exitActionFor(p) {
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Repay the borrow first, then withdraw the supply.';
    if (c.indexOf('interest rate') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0 || c.indexOf('basis') >= 0) return 'Close the open position first, then withdraw the margin.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Remove the liquidity in one transaction, then check the fees landed.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Unstake the receipt token and wait out the unbonding period.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('stable') >= 0 || c.indexOf('wrapper') >= 0) return 'Redeem the asset back to USDC and check the peg at redemption.';
    if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Withdraw the vault shares and check the final yield.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('chain') >= 0) return 'Bridge the funds back to your home chain before you close the wallet.';
    return 'Withdraw the full position in one go.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var second = secondChainOf(p);
    var capital = capitalFor(p);
    var gas = gasRange(p);
    var hold = holdDaysFor(p.age_days);
    var secondClause = second === null ? '' : ' If you farm on both chains, alternate weeks between ' + chain + ' and ' + second + '.';
    var youngClause = p.age_days !== null && p.age_days !== undefined && p.age_days < 90 ? ' The protocol is only ' + p.age_days + ' days old, so check its announcements weekly too.' : '';
    var logSecond = second === null ? '' : ' Note the second chain, ' + second + ', if you farmed there too.';
    return [
      { text: 'Set up a fresh wallet on ' + chain + ' with $' + capital + ' of USDC and gas money of roughly ' + gas + ' (an estimate, gas moves with the network), and keep its seed phrase offline. ' + growthNote(p), cost: 'gas of roughly ' + gas + ' (estimate) to fund the wallet', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and gas of roughly ' + gas + ' (estimate)', time: '15 minutes to set up' },
      { text: 'If ' + p.name + ' runs a points program, do one qualifying action each week, such as ' + weeklyActionFor(p) + ', so the week\'s activity counts toward it.' + secondClause + youngClause, cost: 'a few dollars of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot. ' + ageNote(p.age_days, hold) + ' TVL is ' + fmtTvl(p.tvl_usd) + ', so your $' + capital + ' position is a small share of the pool.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: checkActionFor(p, chain) + ' Claim only from the link the protocol itself publishes, and never pay to claim.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log: ' + p.name + ' on ' + chain + ', $' + capital + ' entered, hold ends after ' + hold + ' days.' + logSecond, cost: 'nothing but the log', time: '5 minutes' },
      { text: 'Recheck ' + p.name + '\'s TVL and seven-day growth once a month; if TVL halves from ' + fmtTvl(p.tvl_usd) + ', unwind the position. ' + exitActionFor(p), cost: 'nothing to check', time: '5 minutes a month' }
    ].map(stepText);
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('w') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.watchlistOnly) params.set('w', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.verdict !== 'all' && r.farm_verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'propensity') { av = a.propensity; bv = b.propensity; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function badgeFor(r) {
    if (r.on_watchlist) return el('span', { class: 'badge watch', text: 'Watchlist' });
    if (r.off_list) return el('span', { class: 'badge offlist', text: 'Off list' });
    return el('span', { class: 'badge early', text: 'Early' });
  }

  function header() {
    return el('div', { class: 'band' },
      el('div', { class: 'band-in' },
        el('div', { class: 'brand' }, el('span', { class: 'rings', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
        el('div', { class: 'band-meta' },
          el('span', { text: 'Snapshot ' + DATA.as_of }),
          el('span', { text: 'DefiLlama index' }),
          el('span', { text: DATA.model_version + ' model' })
        )
      )
    );
  }

  function lede() {
    var offList = DATA.rows.filter(function (r) { return r.off_list; }).length;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols the house rule keeps — ' + (DATA.early_size - offList) + ' below that floor, ' + offList + ' above it that the watchlist skips, flagged OFF LIST. Implied value is value-if-it-launches times tokenization propensity: a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows, off list among them' }), el('b', { text: String(DATA.early_size) + ' (' + offList + ')' })),
        el('div', { class: 'fact' }, el('span', { text: 'Mean propensity' }), el('b', { text: Math.round(DATA.mean_propensity * 100) + '%' })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function spotlight() {
    var cards = DATA.rows.slice(0, 3).map(function (r) {
      return el('button', { class: 'spot-card', type: 'button', onclick: function () { openDetail(r.slug); } },
        el('span', { class: 'rank', text: 'Rank ' + r.rank }),
        el('b', { text: r.name }),
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) + ' implied' }),
        el('span', { class: 'sub', text: fmtUsd(r.tvl_usd) + ' TVL  ·  ' + fmtPct(r.change_7d) + ' 7d  ·  ' + (r.category || 'Other') })
      );
    });
    return el('section', { class: 'spot', 'aria-label': 'Top three by implied value' }, cards);
  }

  // Distribution of implied value as one inline SVG from the rows in data.js: eight
  // log-spaced bands, bar height by row count.
  function distributionChart() {
    var bands = [
      { min: 100e6, label: '≥$100M' }, { min: 50e6, label: '$50–100M' }, { min: 20e6, label: '$20–50M' },
      { min: 10e6, label: '$10–20M' }, { min: 5e6, label: '$5–10M' }, { min: 2e6, label: '$2–5M' },
      { min: 1e6, label: '$1–2M' }, { min: 0, label: '<$1M' }
    ];
    var counts = bands.map(function () { return 0; });
    DATA.rows.forEach(function (r) {
      for (var i = 0; i < bands.length; i++) {
        if (r.implied_value_usd >= bands[i].min) { counts[i]++; return; }
      }
    });
    var max = Math.max.apply(null, counts);
    var top = counts[0], modal = 0;
    counts.forEach(function (c, i) { if (c > counts[modal]) modal = i; });
    var median = medianOf(DATA.rows.map(function (r) { return r.implied_value_usd; }));
    var parts = ['<svg viewBox="0 0 640 168" role="img" aria-label="Distribution of implied value, ' + DATA.board_size + ' rows">'];
    parts.push('<line x1="0" y1="128" x2="640" y2="128" stroke="#e0d9ca" stroke-width="1"/>');
    counts.forEach(function (c, i) {
      var h = max ? Math.round((c / max) * 96) : 0;
      var x = i * 80 + 18;
      var fill = i === 0 ? '#b45309' : '#0f766e';
      if (h > 0) parts.push('<rect x="' + x + '" y="' + (128 - h) + '" width="44" height="' + h + '" rx="3" fill="' + fill + '"/>');
      parts.push('<text x="' + (x + 22) + '" y="' + (128 - h - 6) + '" text-anchor="middle" font-size="12" font-family="ui-monospace, Menlo, monospace" fill="#16222e">' + c + '</text>');
      parts.push('<text x="' + (x + 22) + '" y="148" text-anchor="middle" font-size="11" font-family="ui-monospace, Menlo, monospace" fill="#5b6a76">' + bands[i].label + '</text>');
    });
    parts.push('</svg>');
    return el('div', { class: 'chart' },
      el('div', { html: parts.join('') }),
      el('p', { class: 'cap', text: 'Median row ' + fmtUsd(median) + ' · ' + top + ' rows above $100M · most rows in the ' + bands[modal].label + ' band.' })
    );
  }

  // Top five categories by total implied value.
  function categoryStrip() {
    var byCat = {};
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (!byCat[c]) byCat[c] = { name: c, count: 0, total: 0, values: [] };
      byCat[c].count++;
      byCat[c].total += r.implied_value_usd;
      byCat[c].values.push(r.implied_value_usd);
    });
    var top = Object.keys(byCat).map(function (k) { return byCat[k]; })
      .sort(function (a, b) { return b.total - a.total; }).slice(0, 5);
    return el('div', { class: 'cat-strip' }, top.map(function (c) {
      return el('div', { class: 'cat' },
        el('b', { text: c.name }),
        el('span', { text: c.count + ' rows' }),
        el('span', { text: fmtUsd(c.total) + ' implied' }),
        el('span', { text: fmtUsd(medianOf(c.values)) + ' median' })
      );
    }));
  }

  function overview() {
    return el('section', { class: 'panel overview', 'aria-label': 'Where the value sits' },
      el('div', { class: 'overview-head' },
        el('h2', { text: 'Where the value sits' }),
        el('p', { class: 'sub', text: 'Five protocols clear $100M; most rows are small, young and unpriced.' })
      ),
      distributionChart(),
      categoryStrip()
    );
  }

  // Radar-2 versus radar-5: the build computes the correlation and movers; the page renders them.
  function comparisonPanel() {
    var comp = DATA.comparison;
    if (!comp) return null;
    var mover = function (m) {
      return el('div', { class: 'mover' },
        el('b', { text: m.name }),
        el('span', { class: 'num', text: 'radar-2 #' + m.v2_rank + '  →  radar-5 #' + m.current_rank }),
        el('span', { class: 'sub', text: m.reason })
      );
    };
    return el('section', { class: 'panel compare', 'aria-label': 'Radar-2 vs radar-5' },
      el('div', { class: 'overview-head' },
        el('h2', { text: 'Radar-2 vs radar-5: what changed' }),
        el('p', { class: 'sub', text: 'Spearman ' + comp.spearman.toFixed(2) + ' — the models mostly agree. Radar-5 scores TVL sub-linearly, measures growth against the protocol\'s own category, drops the age discount, and discounts every value by the fitted propensity.' })
      ),
      el('div', { class: 'movers' },
        el('div', null,
          el('h3', { text: 'Biggest rises' }),
          comp.rises.map(function (m) { return mover(m); })
        ),
        el('div', null,
          el('h3', { text: 'Biggest falls' }),
          comp.falls.map(function (m) { return mover(m); })
        )
      )
    );
  }

  // Tokenization propensity and the holdout checks. Every number here comes from data.js.
  function propensityPanel() {
    var o = DATA.propensity;
    var h = DATA.holdout;
    if (!o || !h) return null;
    var w = o.weights;
    var sign = function (x) { return (x >= 0 ? '+' : '') + x.toFixed(2); };
    var accounting = DATA.accounting.map(function (g) { return g.count + ' ' + g.label.toLowerCase(); }).join(' · ');
    var vc = DATA.verdict_counts;
    var cal = o.calibration.map(function (b) { return Math.round(b.center * 100) + '% → ' + Math.round(b.actual * 100) + '% (n=' + b.n + ')'; }).join(', ');
    var ts = o.time_split;
    return el('section', { class: 'panel odds', 'aria-label': 'Propensity and holdout checks' },
      el('div', { class: 'overview-head' },
        el('h2', { text: 'Tokenization propensity, checked out of sample' }),
        el('p', { class: 'sub', text: 'Implied value is value-if-it-launches times tokenization propensity. What the score is: a cross-sectional heuristic fitted on ' + o.train_size + ' eligible protocols — it separates the ' + o.launched + ' that already have a token from the ' + (o.train_size - o.launched) + ' rankable pre-token ones. It is not a calibrated chance of launching: only this snapshot exists, no launch dates. Shown as a propensity and Low / Medium / High bands, never as a probability.' })
      ),
      el('div', { class: 'formula' },
        'propensity = sigmoid(' + w[0].toFixed(2) + ' ' + sign(w[1]) + ' x z(log TVL) ' + sign(w[2]) + ' x z(log age) ' + sign(w[3]) + ' x z(chains) ' + sign(w[4]) + ' x z(category rate))'
      ),
      el('p', { class: 'sub', text: 'Out-of-fold: ROC-AUC ' + o.roc_auc.toFixed(2) + ' · Brier ' + o.brier.toFixed(2) + ' (' + o.brier_baseline.toFixed(2) + ' always guessing the ' + Math.round(o.base_rate * 100) + '% base rate) · log loss ' + o.log_loss.toFixed(2) + ' (' + o.log_loss_baseline.toFixed(2) + '). Calibration, predicted → actual share with a token: ' + cal + '.' }),
      el('p', { class: 'sub', text: 'By time — fitted on protocols listed before ' + ts.split + ', scored on the ' + ts.n + ' after it — AUC ' + ts.roc_auc.toFixed(2) + ', Brier ' + ts.brier.toFixed(2) + ', log loss ' + ts.log_loss.toFixed(2) + ': the score barely beats chance on newer protocols.' }),
      el('p', { class: 'sub', text: 'Checked on the ' + h.loo_n + ' traded tokens. Leave-one-out: median miss x' + h.loo_median_miss.toFixed(2) + ', against x' + h.loo_flat_median_miss.toFixed(2) + ' for a flat TVL multiple; ' + Math.round(h.loo_within_2x * 100) + '% of caps land within 2x. By time — older half fits, newer half priced, split ' + h.bytime_split + ', ' + h.bytime_n + ' tokens — median miss x' + h.bytime_median_miss.toFixed(2) + ' against x' + h.bytime_flat_median_miss.toFixed(2) + '. The value base is 0.25 x ' + DATA.scale_k.toFixed(2) + ', the scale the traded tokens imply.' }),
      el('p', { class: 'sub', text: 'Uncertainty has two layers. (1) The printed range is the value IF it launches, from the leave-one-out error distribution (x' + h.range_lo_factor.toFixed(2) + ' to x' + h.range_hi_factor.toFixed(2) + ' for P25–P75; P10–P90 x' + h.range_lo10_factor.toFixed(2) + ' to x' + h.range_hi90_factor.toFixed(2) + '). (2) The propensity band is the launch uncertainty — P10–P90 is not an 80% confidence interval on the airdrop value. On the by-time held-out caps, ' + Math.round(h.coverage_2575 * 100) + '% fall inside the printed range, ' + Math.round(h.coverage_1090 * 100) + '% inside P10–P90.' }),
      el('p', { class: 'sub', text: '758 protocols, accounted for: ' + accounting + '.' }),
      el('p', { class: 'sub', text: 'Farm verdicts on the $1,000 plan, at three drop shares (1% conservative, 3% neutral, 7% optimistic): ' + vc.farm + ' Farm · ' + vc.marginal + ' Marginal · ' + vc.skip + ' Skip. Farm needs the 1% net above $10; Marginal the 3% net above $0; Skip a 3% net at or below $0. At 3%, gas and the cost of capital exceed the reward on every row — no Farm, no Marginal. Rewards are assumed proportional to TVL share.' }),
      el('p', { class: 'sub', text: 'Two different goals: the board ranks by expected implied value; the farm verdict is the expected net of a $1,000 plan — a top-ranked protocol can still be a Skip on a small plan.' })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var verdict = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['Farm', 'Marginal', 'Skip'].map(function (v) { return el('option', { value: v, text: v, selected: v === state.verdict ? 'selected' : null }); })
    );
    verdict.addEventListener('change', function () { state.verdict = verdict.value; render(); });
    var watchOnly = el('input', { type: 'checkbox', id: 'watchonly', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchOnly.addEventListener('change', function () { state.watchlistOnly = watchOnly.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Farm verdict' }), verdict),
      el('label', { class: 'check', for: 'watchonly' }, watchOnly, 'Watchlist only'),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.watchlistOnly = false; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('span', null, el('b', { text: r.name }), badgeFor(r)),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: Math.round(r.propensity * 100) + '%' }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'records no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for the model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('propensity', 'Propensity'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'These protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No name is special-cased, no row hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round(value-if-launches x tokenization propensity); value-if-launches = ' + m.base_multiple.toFixed(4) + ' x tvl_usd^' + m.tvl_exponent + ' x tvl_median^' + m.median_exponent + ' x (1 + ' + m.growth_weight + ' x tanh((change_7d - category_median_7d) / ' + m.growth_scale + ')) x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_steps + ')); propensity is the fitted score above.'
      ),
      el('p', { class: 'sub', text: 'TVL enters sub-linearly, anchored on the board median TVL of ' + fmtUsd(CTX.tvlMedian) + ': a protocol ten times bigger is worth about seven times more, not ten. Growth is measured against the protocol\'s own category median: outgrowing your own kind is the signal, and a short spike saturates instead of paying up to 2.05x. Age scores in the propensity, not the value. The base multiple is 0.25 x ' + DATA.scale_k.toFixed(2) + ', set by the traded tokens\' median log error. A protocol above the floor that the watchlist leaves out is ranked and flagged OFF LIST.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row);
    var match = recomputed === row.implied_value_usd;
    var v2recomputed = v2ImpliedOf(row);
    var v2match = v2recomputed === row.v2_implied;
    var standing = row.category_tvl_rank !== null && row.category_tvl_rank !== undefined
      ? 'TVL rank ' + row.category_tvl_rank + ' in ' + (row.category || 'Other') + (row.category_growth_median !== null && row.category_growth_median !== undefined ? ', against a category median 7d growth of ' + fmtPct(row.category_growth_median) : '')
      : null;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? '  ·  Watchlist' : row.off_list ? '  ·  Off list' : '  ·  Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + '  ·  records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var catMed = CTX.catMedian[row.category || 'Other'];
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL base: ' + DATA.model.base_multiple.toFixed(4) + ' x TVL^0.85 x median^0.15' }), el('b', { class: 'num', text: fmtUsd(tvlBaseOf(row)) })),
        el('div', null, el('span', { text: 'Growth factor: 7d vs category median' }), el('b', { class: 'num', text: fmtMult(growthFactorOf(row)) })),
        el('div', null, el('span', { text: 'Chain factor: ' + (row.chains || []).length + ' chains' }), el('b', { class: 'num', text: fmtMult(chainFactorOf(row)) })),
        el('div', null, el('span', { text: 'Value if it launches' }), el('b', { class: 'num', text: fmtUsd(valueIfLaunchesOf(row)) })),
        el('div', null, el('span', { text: 'Tokenization propensity (' + propensityBand(propensityOf(row)) + ')' }), el('b', { class: 'num', text: Math.round(propensityOf(row) * 100) + '%' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value (value x propensity)' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'TVL ' + fmtUsd(row.tvl_usd) + ' against a board median of ' + fmtUsd(CTX.tvlMedian) + '; seven-day growth ' + fmtPct(row.change_7d) + ' against a ' + (row.category || 'Other') + ' median of ' + fmtPct(catMed) + '. Age with no token, ' + fmtAge(row.age_days) + ', scores in the propensity, not the value. The page recomputes this row as ' + fmtUsd(recomputed) + (match ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      el('p', { class: 'sub', text: 'Two layers. (1) Value if it launches: ' + fmtUsd(row.range_lo_usd) + ' to ' + fmtUsd(row.range_hi_usd) + ' (P25–P75), ' + fmtUsd(row.range_lo10_usd) + ' to ' + fmtUsd(row.range_hi90_usd) + ' (P10–P90), cut from the holdout error distribution. (2) Whether it launches: propensity ' + Math.round(row.propensity * 100) + '% (' + propensityBand(row.propensity) + '), a cross-sectional score, not a calibrated chance. P10–P90 is not an 80% confidence interval on the final airdrop value. Farm verdict ' + row.farm_verdict + ': net on a $1,000 plan at a 1% drop share ' + fmtUsd(row.net_1000_conservative_usd) + ', at 3% ' + fmtUsd(row.net_1000_usd) + ', at 7% ' + fmtUsd(row.net_1000_optimistic_usd) + ' (' + fmtUsd(row.net_10000_usd) + ' on $10,000 at 3%), less gas and the cost of the capital. Rewards are assumed proportional to TVL share.' }),
      el('p', { class: 'sub', text: 'Under radar-2 this protocol ranked #' + row.v2_rank + ' with an implied value of ' + fmtUsd(row.v2_implied) + ' (recomputed ' + fmtUsd(v2recomputed) + (v2match ? ', matching.' : ', differing: the data would be stale.') + ' Radar-5 ranks it #' + row.rank + '.' }),
      standing ? el('p', { class: 'sub', text: standing + '.' }) : null
    ));
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Budget and risk' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Capital for one position' }), el('b', { class: 'num', text: '$' + capital })),
        el('div', null, el('span', { text: 'Gas (estimate)' }), el('b', { class: 'num', text: 'roughly ' + gasRange(row) })),
        el('div', null, el('span', { text: 'Hold at least' }), el('b', { class: 'num', text: hold + ' days' })),
        el('div', null, el('span', { text: 'Exit rule' }), el('b', { class: 'num', text: 'unwind if TVL halves from ' + fmtTvl(row.tvl_usd) }))
      ),
      el('p', { class: 'sub', text: 'Gas moves with the network; the plan never states a flat fee. Nothing here promises a token or an airdrop.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    app.appendChild(header());
    var shell = el('div', { class: 'shell' });
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(overview());
      var compare = comparisonPanel();
      if (compare) shell.appendChild(compare);
      var prop = propensityPanel();
      if (prop) shell.appendChild(prop);
      shell.appendChild(modelPanel());
    }
    shell.appendChild(el('p', { class: 'note', text: 'Source: DefiLlama protocol index, snapshot ' + DATA.as_of + '. "Records no token" means the snapshot carries no market cap, CoinGecko id or symbol — not proof none exists. Implied value is this entry\'s own model, never a price, and no farm plan promises a token or an airdrop.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
