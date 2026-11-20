// Token Radar's dashboard, model radar-2. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer with the
// model's own inputs and the protocol's farm plan. No network: every byte it shows is in data.js.
//
// Two derivations live here, and both are the same arithmetic main.ts writes to board.json, so the
// page and the board agree: impliedOf recomputes a row from the snapshot figures, and farmSteps
// rebuilds a row's plan from its category, chains, TVL and age. No protocol name is special-cased.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchlistOnly: false };

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

  // The model in one function: TVL x base multiple, times the growth, maturity and chain-breadth
  // multipliers. The page recomputes a row and checks the number board.json carries, so the page's
  // code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var chainSteps = Math.min(Math.max((row.chains || []).length - 1, 0), model.chain_max_steps);
    var chainMult = 1 + chainSteps * model.chain_step;
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * growthMult * maturity * chainMult));
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

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and
  // age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function gasFor(p) { return chainOf(p) === 'Ethereum' ? 12 : 4; }
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
  function fmtPct(n) { return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
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
    if (c.indexOf('uncollateralized') >= 0) return 'Lend $' + capital + ' of USDC through ' + name + ' on ' + chain + ' to its borrower pool and keep the loan receipts.';
    if (c.indexOf('cdp') >= 0) return 'Lock $' + capital + ' of USDC as collateral in ' + name + ' on ' + chain + ', mint the stablecoin it issues against it, and keep the collateral ratio above the liquidation line.';
    if (c.indexOf('lend') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', borrow a small amount against it, and keep the health factor above the liquidation line.';
    if (c.indexOf('interest rate') >= 0) return 'Deposit $' + capital + ' of USDC as margin for one interest-rate position on ' + name + ' on ' + chain + ', and close it before the rate leg moves against you.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' on ' + chain + ', open one small hedged position, and set a stop so it closes before liquidation.';
    if (c.indexOf('basis') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s basis vault on " + chain + ' and hold the delta-neutral position while funding stays positive.';
    if (c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC into an options vault on ' + name + ' on ' + chain + ' and hold the vault shares through one expiry.';
    if (c.indexOf('leveraged farm') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s leveraged farm on " + chain + ' at the lowest leverage it offers, and watch the borrow rate daily.';
    if (c.indexOf('dex') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main USDC pair on " + chain + ', keeping the position in range, and collect the trading fees.';
    if (c.indexOf('liquidity manager') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' managed vault on ' + chain + ' and let the manager rebalance the range; keep the shares.';
    if (c.indexOf('yield aggregator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s largest vault on " + chain + ' and keep the shares while the strategy runs.';
    if (c.indexOf('yield') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s yield vault on " + chain + ' and keep the shares while the yield runs.';
    if (c.indexOf('curator') >= 0) return 'Deposit $' + capital + ' of USDC into a ' + name + ' curated vault on ' + chain + ' and keep the vault shares; the curator picks the underlying markets, not you.';
    if (c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s allocator vault on " + chain + ' and let it rotate the funds between strategies.';
    if (c.indexOf('restak') >= 0) return 'Restake $' + capital + ' of the receipt token through ' + name + ' on ' + chain + ' and keep the restaking receipt.';
    if (c.indexOf('staking') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app the same week.';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + name + ' and use two of its native apps in the same week, starting with the largest one you can find on its own page.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of the yield-bearing asset through ' + name + ' on ' + chain + " and hold it; read the backing report on the protocol's own page first.";
    if (c.indexOf('wrapper') >= 0) return 'Wrap $' + capital + ' of USDC into the wrapped stable through ' + name + ' on ' + chain + ' and hold the wrapped tokens.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it through one peg check a week.';
    if (c.indexOf('btc') >= 0) return 'Deposit $' + capital + ' of BTC through ' + name + ' on ' + chain + ' and keep the receipt token until the hold ends.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + ' on ' + chain + ', then settle it when the market resolves.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy open through the hold.';
    if (c.indexOf('launchpad') >= 0) return 'Join one ' + name + ' launch with $' + capital + ' on ' + chain + ' and hold the allocation through the lock-up.';
    if (c.indexOf('token locker') >= 0) return 'Lock $' + capital + ' of an asset in ' + name + ' on ' + chain + ' for the shortest term it offers.';
    if (c.indexOf('otc') >= 0) return 'Place one OTC trade of $' + capital + ' through ' + name + ' on ' + chain + ' and keep the trade receipt.';
    if (c.indexOf('cedefi') >= 0) return 'Deposit $' + capital + " of USDC into " + name + "'s CeDeFi vault on " + chain + ' and keep the position open; the vault runs off-chain strategies.';
    if (c.indexOf('payment') >= 0) return 'Pay or receive $' + capital + ' through ' + name + ' on ' + chain + ' and keep the payment receipt.';
    if (c.indexOf('governance') >= 0) return 'Lock $' + capital + ' of the governance asset through ' + name + ' on ' + chain + ' and cast one vote in its next proposal.';
    if (c.indexOf('card') >= 0) return 'Spend $' + capital + ' through a ' + name + ' card on ' + chain + ' and keep the statement for the farm log.';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold the shares through one rebalance.';
    if (c.indexOf('farm') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s farm on " + chain + ' and keep the position open through one reward cycle.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
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
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'Open the pool page on ' + name + ' and check the fees earned and whether the position is still in range.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Open ' + name + "'s staking page on " + chain + ' and check the rewards accrued on your receipt token.';
    if (c.indexOf('rwa') >= 0 || c.indexOf('stable') >= 0 || c.indexOf('wrapper') >= 0) return 'Open ' + name + "'s page on " + chain + ' and check the peg and the backing report.';
    if (c.indexOf('yield') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Open ' + name + "'s vault page on " + chain + " and check the yield accrued and the vault's current strategy.";
    if (c.indexOf('bridge') >= 0 || c.indexOf('chain') >= 0) return 'Open ' + name + ' on ' + chain + ' and check the bridged balance arrived before you move on.';
    if (c.indexOf('prediction') >= 0) return 'Open ' + name + ' and check whether your market has resolved.';
    if (c.indexOf('governance') >= 0) return 'Open ' + name + "'s governance page on " + chain + ' and check the next proposal.';
    if (c.indexOf('insurance') >= 0) return 'Open ' + name + "'s cover page on " + chain + ' and check the policy is still active.';
    return 'Open ' + name + "'s own points or rewards page on " + chain + ' and check what the wallet has earned.';
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
    var gas = gasFor(p);
    var hold = holdDaysFor(p.age_days);
    var secondClause = second === null ? '' : ' Alternate weeks between ' + chain + ' and ' + second + ' so both chains show activity.';
    var youngClause = p.age_days !== null && p.age_days !== undefined && p.age_days < 90 ? ' The protocol is only ' + p.age_days + ' days old, so check its announcements weekly too.' : '';
    var logSecond = second === null ? '' : ' Note the second chain, ' + second + ', if you farmed there too.';
    return [
      { text: 'Set up a fresh wallet on ' + chain + ' with $' + capital + ' of USDC and about $' + gas + ' for gas, and keep its seed phrase offline. ' + growthNote(p), cost: 'about $' + gas + ' of gas to fund the wallet', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one qualifying action each week, such as ' + weeklyActionFor(p) + ', so the wallet reads as active rather than one-off.' + secondClause + youngClause, cost: 'about $2 of gas a week', time: '10 minutes a week' },
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
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function badgeFor(r) {
    return r.on_watchlist
      ? el('span', { class: 'badge watch', text: 'Watchlist' })
      : el('span', { class: 'badge early', text: 'Early' });
  }

  function header() {
    return el('div', { class: 'band' },
      el('div', { class: 'band-in' },
        el('div', { class: 'brand' }, el('span', { class: 'rings', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
        el('div', { class: 'band-meta' },
          el('span', { text: 'Snapshot ' + DATA.as_of }),
          el('span', { text: 'DefiLlama protocol index' }),
          el('span', { text: DATA.model_version + ' model' })
        )
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols below that floor, every one the house rule keeps, with no TVL cap. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
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
    return el('section', { class: 'spot', 'aria-label': 'Top three protocols by implied value' }, cards);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var watchOnly = el('input', { type: 'checkbox', id: 'watchonly', checked: state.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' });
    watchOnly.addEventListener('change', function () { state.watchlistOnly = watchOnly.checked; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
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
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.watchlistOnly = false; writeHash(); render(); } })
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
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
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
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
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
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_steps + ')) )'
      ),
      el('p', { class: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth is how many chains the protocol runs on: more chains, more wallets on launch day. Wrapped, staked and bridged products of a token that already trades are kept off the board, and a protocol above the floor that the watchlist leaves out is never re-added: the house left it out on a record this snapshot does not carry.' })
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
    var recomputed = impliedOf(row, DATA.model);
    var match = recomputed === row.implied_value_usd;
    var standing = row.category_tvl_rank !== null && row.category_tvl_rank !== undefined
      ? 'TVL rank ' + row.category_tvl_rank + ' in ' + (row.category || 'Other') + (row.category_growth_median !== null && row.category_growth_median !== undefined ? ', against a category median 7d growth of ' + fmtPct(row.category_growth_median) : '')
      : null;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? '  ·  Watchlist' : '  ·  Early radar') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + '  ·  records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Chains' }), el('b', { class: 'num', text: String((row.chains || []).length) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(row.growth_multiplier) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Chain multiplier' }), el('b', { class: 'num', text: fmtMult(row.chain_multiplier) })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (match ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' }),
      standing ? el('p', { class: 'sub', text: standing + '.' }) : null
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
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(el('p', { class: 'note', text: 'Source: DefiLlama protocol index, snapshot ' + DATA.as_of + '. "Records no token" means the snapshot carries no market cap, CoinGecko id or symbol for the protocol; it is not proof none exists. Implied value is this entry\'s own model, never a price, and no farm plan promises a token or an airdrop.' }));
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
