// Token Radar's dashboard, model radar-7. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, and a per-protocol detail drawer
// with the model inputs and farm plan. No network: every byte shown is in data.js. launchValueOf
// recomputes a row's launch value (the primary USD value and the ranking) — the flat TVL multiple
// when the rolling validation falls back to flat, otherwise the log-space blend with the radar
// formula — priorityOf the unitless risk-adjusted score (launch value times propensity, never
// dollars), propensityOf the fitted score under its feature spec, v2ImpliedOf the previous
// release's value. The drawer shows the farm plan board.json carries for the row.
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

  // The TVL anchor is one definition everywhere: each row carries its own category anchor in
  // data.js (the traded-token median, shrunk by category), so the page recomputes a row from
  // that anchor and checks the number board.json carries. Growth medians are board-wide.
  function medianOf(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var n = s.length;
    if (n === 0) return null;
    if (n % 2 === 1) return s[(n - 1) / 2];
    return Math.round(((s[n / 2 - 1] + s[n / 2]) / 2) * 100) / 100;
  }
  function modelContext() {
    var byCat = {};
    DATA.rows.forEach(function (r) {
      if (r.change_7d === null || r.change_7d === undefined) return;
      var c = r.category || 'Other';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(r.change_7d);
    });
    var catMedian = {};
    Object.keys(byCat).forEach(function (k) { catMedian[k] = medianOf(byCat[k]); });
    return { catMedian: catMedian };
  }
  var CTX = modelContext();
  function tvlBaseOf(row) {
    var m = DATA.model;
    return m.base_multiple * Math.pow(row.tvl_usd, m.tvl_exponent) * Math.pow(row.tvl_median, m.median_exponent);
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
  // Tokenization propensity, the same logistic model main.ts fits: the features in the fitted
  // spec, standardised on the training set, through the fitted weights. The category rate
  // leaves the row itself out, as the fit does. Constants 6, 365 and 30 are the PROPENSITY
  // constants in lib/model.ts.
  function propensityOf(row) {
    var o = DATA.propensity;
    var cat = row.category || 'Other';
    var total = (o.cat_total[cat] || 0) - 1;
    var launched = o.cat_launched[cat] || 0;
    var rate = total > 0 ? (launched + 1) / (total + 2) : 0.5;
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    var f = [];
    (o.features || ['tvl', 'chains', 'catRate']).forEach(function (name) {
      if (name === 'tvl') f.push(Math.log10(Math.max(row.tvl_usd, 1)));
      else if (name === 'age') f.push(Math.log10(age + 30));
      else if (name === 'chains') f.push(Math.min((row.chains || []).length, 6));
      else f.push(rate);
    });
    var z = o.weights[0];
    for (var d = 0; d < f.length; d++) z += o.weights[d + 1] * ((f[d] - o.means[d]) / o.sds[d]);
    var clipped = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-clipped));
  }
  // The flat TVL value and the radar value, blended in log space at the rolling-chosen alpha:
  // alpha 1 is the radar formula alone, alpha 0 the flat multiple alone (the fallback when no
  // blend passes the rolling gate). Mirrors blendedValue in lib/model.ts.
  function flatValueOf(row) { return DATA.flat_multiple * row.tvl_usd; }
  function radarValueOf(row) {
    return Math.max(1, Math.round(tvlBaseOf(row) * growthFactorOf(row) * chainFactorOf(row)));
  }
  function valueIfLaunchesOf(row) {
    var alpha = DATA.blend_alpha === undefined || DATA.blend_alpha === null ? 1 : DATA.blend_alpha;
    var radar = tvlBaseOf(row) * growthFactorOf(row) * chainFactorOf(row);
    var flat = flatValueOf(row);
    if (alpha >= 1) return Math.max(1, Math.round(radar));
    if (alpha <= 0) return Math.max(1, Math.round(flat));
    return Math.max(1, Math.round(Math.exp(alpha * Math.log(Math.max(1, radar)) + (1 - alpha) * Math.log(Math.max(1, flat)))));
  }
  // The risk-adjusted score: launch value times propensity, a unitless sort aid — never
  // dollars, never an expected value.
  function priorityOf(row) {
    return Math.round(valueIfLaunchesOf(row) * propensityOf(row) * 100) / 100;
  }
  function fmtNum(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return Math.round(n / 1e3) + 'K';
    return String(Math.round(n));
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

  // The farm plan shown in the drawer is the one board.json carries for the row, derived by
  // main.ts from the protocol's own record — the page does not re-derive it.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  // Gas by hold period, mirroring gasForPlan in lib/model.ts: 3 fixed transactions (approve,
  // deposit, withdraw) plus one weekly action, priced per transaction on its chain — $11.50 on
  // Ethereum, $3.00 elsewhere. Setup and exit touch every chain in the plan; the weekly action
  // runs on the main chain.
  function gasPerTx(chain) { return chain === 'Ethereum' ? 11.5 : 3; }
  function gasTransactionsFor(holdDays) { return 3 + Math.floor(holdDays / 7); }
  function gasForPlan(chains, holdDays) {
    var ntx = gasTransactionsFor(holdDays);
    var weekly = Math.max(0, ntx - 3);
    var list = chains || [];
    var setup = 0, exit = 0;
    list.forEach(function (c) { setup += gasPerTx(c); exit += gasPerTx(c); });
    return Math.round((setup + exit + weekly * gasPerTx(list[0] || 'other')) * 100) / 100;
  }
  function fmtTvl(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
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
      else if (key === 'priority') { av = a.priority_score; bv = b.priority_score; }
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
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by launch value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' more pre-token protocols the house rule keeps — ' + (DATA.early_size - offList) + ' below that floor, ' + offList + ' above it that the watchlist skips, flagged OFF LIST. Launch value is what a protocol would be worth if it launched a token — the ranking, and a model, not a promise. Propensity is a separate indicator; the risk-adjusted score is launch value x propensity, unitless.' })
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
        el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) + ' launch value' }),
        el('span', { class: 'sub', text: fmtUsd(r.tvl_usd) + ' TVL  ·  ' + fmtPct(r.change_7d) + ' 7d  ·  ' + (r.category || 'Other') })
      );
    });
    return el('section', { class: 'spot', 'aria-label': 'Top three by launch value' }, cards);
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
    var parts = ['<svg viewBox="0 0 640 168" role="img" aria-label="Distribution of launch value, ' + DATA.board_size + ' rows">'];
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

  // Top five categories by total launch value.
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
        el('span', { text: fmtUsd(c.total) + ' launch value' }),
        el('span', { text: fmtUsd(medianOf(c.values)) + ' median' })
      );
    }));
  }

  function overview() {
    var over100 = DATA.rows.filter(function (r) { return r.implied_value_usd >= 100e6; }).length;
    return el('section', { class: 'panel overview', 'aria-label': 'Where the value sits' },
      el('div', { class: 'overview-head' },
        el('h2', { text: 'Where the value sits' }),
        el('p', { class: 'sub', text: over100 + ' protocols clear $100M; most rows are small, young and unpriced.' })
      ),
      distributionChart(),
      categoryStrip()
    );
  }

  // Radar-2 versus radar-7: the build computes the correlation and movers; the page renders them.
  // The rolling sentence reads the validation in data.js, so it says flat when the board uses
  // flat and names the blend when a blend passes the gate.
  function rollingSentence() {
    var r = DATA.rolling;
    if (!r) return 'Radar-7 measures growth against the protocol\'s own category, drops the age discount, and keeps propensity out of the dollar value.';
    var best = Math.min.apply(null, r.pooled_miss_all_by_alpha);
    var pct = Math.round((1 - best / r.flat_pooled_miss_all) * 100);
    if (r.board_uses_flat) return 'Radar-7 ranks by the flat TVL multiple: the strict rolling validation found no blend of the radar formula that beats flat TVL out of time — the best blend is only ' + pct + '% below flat across the four blocks, short of the 10% gate, and worse than flat on the held-out block — so the board uses flat and the radar formula stays as an auxiliary valuation per row. Growth is measured against the protocol\'s own category, the age discount is dropped, and propensity stays out of the dollar value.';
    return 'Radar-7 blends the radar formula with the flat TVL multiple at alpha ' + r.chosen_alpha + ' in log space, chosen by the strict rolling validation — the best blend is ' + pct + '% below flat across the four blocks. Growth is measured against the protocol\'s own category, the age discount is dropped, and propensity stays out of the dollar value.';
  }
  function comparisonPanel() {
    var comp = DATA.comparison;
    if (!comp) return null;
    var mover = function (m) {
      return el('div', { class: 'mover' },
        el('b', { text: m.name }),
        el('span', { class: 'num', text: 'radar-2 #' + m.v2_rank + '  →  radar-7 #' + m.current_rank }),
        el('span', { class: 'sub', text: m.reason })
      );
    };
    return el('section', { class: 'panel compare', 'aria-label': 'Radar-2 vs radar-7' },
      el('div', { class: 'overview-head' },
        el('h2', { text: 'Radar-2 vs radar-7: what changed' }),
        el('p', { class: 'sub', text: 'Spearman ' + comp.spearman.toFixed(2) + ' — the models mostly agree. ' + rollingSentence() })
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
    var ab = DATA.age_ablation;
    if (!o || !h) return null;
    var w = o.weights;
    var sign = function (x) { return (x >= 0 ? '+' : '') + x.toFixed(2); };
    var featureLabel = { tvl: 'z(log TVL)', age: 'z(log age)', chains: 'z(chains)', catRate: 'z(category rate)' };
    var terms = (o.features || []).map(function (name, i) { return sign(w[i + 1]) + ' x ' + (featureLabel[name] || name); }).join(' ');
    var accounting = DATA.accounting.map(function (g) { return g.count + ' ' + g.label.toLowerCase(); }).join(' · ');
    var vc = DATA.verdict_counts;
    var cal = o.calibration.map(function (b) { return Math.round(b.center * 100) + '% → ' + Math.round(b.actual * 100) + '% (n=' + b.n + ')'; }).join(', ');
    var ts = o.time_split;
    return el('section', { class: 'panel odds', 'aria-label': 'Propensity and holdout checks' },
      el('div', { class: 'overview-head' },
        el('h2', { text: 'Tokenization propensity, checked out of sample' }),
        el('p', { class: 'sub', text: 'The board ranks by launch value. Propensity is a separate indicator: a cross-sectional score fitted on ' + o.train_size + ' eligible protocols — it separates the ' + o.launched + ' that already have a token from the ' + (o.train_size - o.launched) + ' rankable pre-token ones. It is not a calibrated chance of launching: only this snapshot exists, no launch dates. Shown as a propensity and Low / Medium / High bands, never as a probability.' })
      ),
      el('div', { class: 'formula' },
        'propensity = sigmoid(' + w[0].toFixed(2) + ' ' + terms + ')'
      ),
      el('p', { class: 'sub', text: 'Age ablation: log age lifts random-fold AUC (' + ab.b_with_age.oof_auc.toFixed(2) + ' vs ' + ab.a_no_age.oof_auc.toFixed(2) + ') but cuts time-split AUC (' + ab.b_with_age.ts_auc.toFixed(2) + ' vs ' + ab.a_no_age.ts_auc.toFixed(2) + ') and degrades both newer halves — age is ' + (ab.kept_age ? 'kept' : 'dropped') + '. listed_at is DefiLlama\'s listing date, not the operating start.' }),
      el('p', { class: 'sub', text: 'Out-of-fold: ROC-AUC ' + o.roc_auc.toFixed(2) + ' · Brier ' + o.brier.toFixed(2) + ' (' + o.brier_baseline.toFixed(2) + ' always guessing the ' + Math.round(o.base_rate * 100) + '% base rate) · log loss ' + o.log_loss.toFixed(2) + ' (' + o.log_loss_baseline.toFixed(2) + '). Calibration, predicted → actual share with a token: ' + cal + '.' }),
      el('p', { class: 'sub', text: 'By time — fitted on protocols listed before ' + ts.split + ', scored on the ' + ts.n + ' after it — AUC ' + ts.roc_auc.toFixed(2) + ', Brier ' + ts.brier.toFixed(2) + ' (' + ts.brier_baseline.toFixed(2) + ' always guessing the training base rate), log loss ' + ts.log_loss.toFixed(2) + ' (' + ts.log_loss_baseline.toFixed(2) + ').' + (ts.brier > ts.brier_baseline || ts.log_loss > ts.log_loss_baseline ? ' Below baseline on the time split — the propensity has no reliable cross-period predictive power.' : '') + ' Dropping age lifts AUC from ' + ab.b_with_age.ts_auc.toFixed(2) + ' to ' + ab.a_no_age.ts_auc.toFixed(2) + ', but the Brier stays poor on newer protocols.' }),
      el('p', { class: 'sub', text: 'Checked on the ' + h.loo_n + ' traded tokens, with nested calibration — each test sample\'s scale comes from the others, never its own cap. Leave-one-out: median miss x' + h.loo_median_miss.toFixed(2) + ', against x' + h.loo_flat_median_miss.toFixed(2) + ' for a flat TVL multiple; ' + Math.round(h.loo_within_2x * 100) + '% of caps land within 2x. By time — older half fits, newer half priced, split ' + h.bytime_split + ', ' + h.bytime_n + ' tokens — median miss x' + h.bytime_median_miss.toFixed(2) + ' against x' + h.bytime_flat_median_miss.toFixed(2) + '. The scale drifts: the old half\'s median log error is ' + h.bytime_train_log_median.toFixed(2) + ', the new half\'s ' + h.bytime_test_log_median.toFixed(2) + '. The value base is 0.25 x ' + DATA.scale_k.toFixed(2) + ', the scale the traded tokens imply.' }),
      el('p', { class: 'sub', text: 'Uncertainty has two layers. (1) The printed range is the value IF it launches, from the leave-one-out error distribution (x' + h.range_lo_factor.toFixed(2) + ' to x' + h.range_hi_factor.toFixed(2) + ' for the Central 60% model range, P20–P80; P10–P90 x' + h.range_lo10_factor.toFixed(2) + ' to x' + h.range_hi90_factor.toFixed(2) + '). (2) The propensity band is the launch uncertainty — P10–P90 is not an 80% confidence interval on the airdrop value. On the by-time held-out caps, ' + Math.round(h.coverage_central60 * 100) + '% fall inside the printed range, ' + Math.round(h.coverage_1090 * 100) + '% inside P10–P90 — the nominal targets are 60% and 80%.' }),
      el('p', { class: 'sub', text: '758 protocols, accounted for: ' + accounting + '.' }),
      el('p', { class: 'sub', text: 'Farm verdicts, judged on each plan size: Farm needs the 1% net above $10 on the $1,000 plan; Marginal the 3% net above $0 — on the $1,000 plan, or on the $10,000 plan when the small plan does not clear it; Skip neither. ' + vc.farm + ' Farm · ' + vc.marginal + ' Marginal · ' + vc.skip + ' Skip. Gas is counted per transaction on its chain — 7 for a 30-day hold, 9 for 45, 11 for 60 — so a longer hold costs more. Rewards are conditional — assuming launch and a pro-rata drop allocation — not expected returns.' }),
      el('p', { class: 'sub', text: 'Two different goals: the board ranks by launch value; the farm verdict is the conditional net of a plan — a top-ranked protocol can still be a Skip on a small plan.' })
    );
  }

  // Strict rolling time validation: the 95 dated traded tokens, earliest 47 as the training
  // set, the rest in four blocks of 12, each block priced only from data before it. The first
  // three blocks pick the blend weight; the fourth is held out as final validation. The gate
  // needs a pooled miss at least 10% below flat, at least 3 of 4 blocks better than flat, and
  // the held-out block not clearly worse; when no blend passes, the board uses flat TVL.
  function rollingPanel() {
    var r = DATA.rolling;
    if (!r) return null;
    var best = Math.min.apply(null, r.pooled_miss_all_by_alpha);
    var pct = Math.round((1 - best / r.flat_pooled_miss_all) * 100);
    var last = r.blocks[r.blocks.length - 1];
    var lastWorseAll = last.alpha_median_miss.slice(1).every(function (m) { return m > last.flat_median_miss; });
    var gateText = r.board_uses_flat
      ? 'No blend passes the gate: the best blend is only ' + pct + '% below flat across all four blocks, and the held-out fourth block is worse than flat for every blend — so the board ranks by the flat TVL multiple and the radar formula stays as an auxiliary valuation.'
      : 'Blend alpha ' + r.chosen_alpha + ' passes the gate: ' + pct + '% below flat across all four blocks, better than flat on at least three blocks, and the held-out fourth block is not clearly worse — so the board ranks by the blended value.';
    if (r.board_uses_flat && !lastWorseAll) gateText = 'No blend passes the gate: the best blend is only ' + pct + '% below flat across all four blocks, short of the 10% the gate needs — so the board ranks by the flat TVL multiple and the radar formula stays as an auxiliary valuation.';
    var head = el('tr', null,
      el('th', { scope: 'col', text: 'Block' }),
      el('th', { scope: 'col', text: 'Listed' }),
      el('th', { scope: 'col', text: 'Train' }),
      el('th', { scope: 'col', text: 'Flat (α=0)' }),
      el('th', { scope: 'col', text: 'α=0.25' }),
      el('th', { scope: 'col', text: 'α=0.50' }),
      el('th', { scope: 'col', text: 'α=0.75' }),
      el('th', { scope: 'col', text: 'α=1.00' }),
      el('th', { scope: 'col', text: 'Central 60%' }),
      el('th', { scope: 'col', text: 'P10–P90' })
    );
    var tbody = el('tbody');
    r.blocks.forEach(function (b) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: String(b.block) }),
        el('td', { text: b.start + ' – ' + b.end }),
        el('td', { class: 'num', text: String(b.train_n) }),
        el('td', { class: 'num', text: 'x' + b.alpha_median_miss[0].toFixed(2) }),
        el('td', { class: 'num', text: 'x' + b.alpha_median_miss[1].toFixed(2) }),
        el('td', { class: 'num', text: 'x' + b.alpha_median_miss[2].toFixed(2) }),
        el('td', { class: 'num', text: 'x' + b.alpha_median_miss[3].toFixed(2) }),
        el('td', { class: 'num', text: 'x' + b.alpha_median_miss[4].toFixed(2) }),
        el('td', { class: 'num', text: Math.round(b.central60_coverage * 100) + '%' }),
        el('td', { class: 'num', text: Math.round(b.p1090_coverage * 100) + '%' })
      ));
    });
    return el('section', { class: 'panel odds', 'aria-label': 'Rolling time validation' },
      el('div', { class: 'overview-head' },
        el('h2', { text: 'Rolling time validation: does the model beat flat TVL out of time?' }),
        el('p', { class: 'sub', text: 'The ' + r.dated_n + ' traded tokens with a listing date, earliest ' + r.initial_n + ' as the training set, the rest in four blocks of ' + r.block_n + '. Each block is priced only from data before it — no future sample enters that block\'s anchor, category median, scale or blend choice. The first three blocks pick the blend; the fourth is held out as final validation. Median miss is the median |log(actual / predicted)|, as a multiple.' })
      ),
      el('div', { class: 'table-wrap' }, el('table', null, el('thead', null, head), tbody)),
      el('p', { class: 'sub', text: gateText }),
      el('p', { class: 'sub', text: 'Coverage targets: Central 60% 50%–65% per block, P10–P90 75%–85%. The newest block is the hardest: even the flat multiple misses by x' + r.blocks[3].flat_median_miss.toFixed(2) + ' there, against x' + r.blocks[0].flat_median_miss.toFixed(2) + ', x' + r.blocks[1].flat_median_miss.toFixed(2) + ' and x' + r.blocks[2].flat_median_miss.toFixed(2) + ' in the earlier blocks.' })
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
        el('td', { class: 'num', text: fmtNum(r.priority_score) }),
        el('td', null, el('span', { class: 'status', text: 'records no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest launch value first. Priority is the risk-adjusted score — launch value x propensity, unitless, never dollars. Select a row for the model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('propensity', 'Propensity'),
            sortHeader('implied', 'Launch value'),
            sortHeader('priority', 'Priority'),
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
    var r = DATA.rolling;
    var flat = r && r.board_uses_flat;
    var boardFormula = flat
      ? 'launch value = round(' + DATA.flat_multiple.toFixed(4) + ' x tvl_usd) — the flat TVL multiple, the median market-cap-to-TVL over the traded tokens. The board ranks by this value.'
      : 'launch value = round(exp(' + DATA.blend_alpha + ' x ln(radar value) + ' + (1 - DATA.blend_alpha).toFixed(2) + ' x ln(' + DATA.flat_multiple.toFixed(4) + ' x tvl_usd))) — the log-space blend of the radar value and the flat TVL multiple at the rolling-chosen alpha.';
    var radarFormula = 'radar value = round(' + m.base_multiple.toFixed(4) + ' x tvl_usd^' + m.tvl_exponent + ' x anchor^' + m.median_exponent + ' x (1 + ' + m.growth_weight + ' x tanh((change_7d - category_median_7d) / ' + m.growth_scale + ')) x (1 + ' + m.chain_step + ' x min(chains - 1, ' + m.chain_max_steps + '))); anchor is the traded-token TVL median for the row\'s category, shrunk toward the global median; priority = launch value x propensity (unitless).';
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How launch value is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No name is special-cased, no row hand-picked.' }),
      el('div', { class: 'formula' }, boardFormula),
      el('div', { class: 'formula' }, (flat ? 'Auxiliary: ' : 'Radar value: ') + radarFormula),
      el('p', { class: 'sub', text: flat
        ? 'The board uses the flat multiple because the strict rolling validation found no blend that beats it out of time (see the rolling table): the radar formula is kept as an auxiliary valuation per row. In the radar formula, TVL enters sub-linearly, anchored on the traded-token median for the row\'s category (global ' + fmtUsd(DATA.tvl_anchor_global) + ', shrunk by category): a protocol ten times bigger is worth about seven times more, not ten. Growth is measured against the protocol\'s own category median: outgrowing your own kind is the signal, and a short spike saturates instead of paying up to 2.05x. The base multiple is 0.25 x ' + DATA.scale_k.toFixed(2) + ', set by the traded tokens\' median raw log error under nested calibration. A protocol above the floor that the watchlist leaves out is ranked and flagged OFF LIST.'
        : 'TVL enters sub-linearly in the radar value, anchored on the traded-token median for the row\'s category (global ' + fmtUsd(DATA.tvl_anchor_global) + ', shrunk by category): a protocol ten times bigger is worth about seven times more, not ten. Growth is measured against the protocol\'s own category median: outgrowing your own kind is the signal, and a short spike saturates instead of paying up to 2.05x. The base multiple is 0.25 x ' + DATA.scale_k.toFixed(2) + ', set by the traded tokens\' median raw log error under nested calibration. A protocol above the floor that the watchlist leaves out is ranked and flagged OFF LIST.' })
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
    var steps = row.farm_steps || [];
    var recomputed = valueIfLaunchesOf(row);
    var match = recomputed === row.implied_value_usd;
    var prio = priorityOf(row);
    var prioMatch = prio === row.priority_score;
    var v2recomputed = v2ImpliedOf(row);
    var v2match = v2recomputed === row.v2_implied;
    var hold = holdDaysFor(row.age_days);
    var ntx = gasTransactionsFor(hold);
    var boardUsesFlat = DATA.rolling && DATA.rolling.board_uses_flat;
    var valueText = boardUsesFlat
      ? 'Launch value is the flat TVL multiple (' + DATA.flat_multiple.toFixed(4) + ' x TVL): the strict rolling validation found no blend of the radar formula that beats flat out of time, so the board ranks by flat and the radar value is an auxiliary estimate. '
      : 'Launch value blends the radar value with the flat TVL multiple in log space at alpha ' + DATA.blend_alpha + ', chosen by the strict rolling validation. ';
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
    var netsText = row.farm_plan_size === 10000
      ? 'conditional net at 3% ' + fmtUsd(row.net_10000_usd) + ' (on $1,000 at 1% ' + fmtUsd(row.net_1000_conservative_usd) + ', at 3% ' + fmtUsd(row.net_1000_usd) + ', at 7% ' + fmtUsd(row.net_1000_optimistic_usd) + ')'
      : 'conditional net at 1% ' + fmtUsd(row.net_1000_conservative_usd) + ', at 3% ' + fmtUsd(row.net_1000_usd) + ', at 7% ' + fmtUsd(row.net_1000_optimistic_usd) + ' (' + fmtUsd(row.net_10000_usd) + ' on $10,000 at 3%)';
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Launch value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL base: ' + DATA.model.base_multiple.toFixed(4) + ' x TVL^0.85 x anchor^0.15' }), el('b', { class: 'num', text: fmtUsd(tvlBaseOf(row)) })),
        el('div', null, el('span', { text: 'Growth factor: 7d vs category median' }), el('b', { class: 'num', text: fmtMult(growthFactorOf(row)) })),
        el('div', null, el('span', { text: 'Chain factor: ' + (row.chains || []).length + ' chains' }), el('b', { class: 'num', text: fmtMult(chainFactorOf(row)) })),
        el('div', null, el('span', { text: 'Flat TVL value: ' + DATA.flat_multiple.toFixed(4) + ' x TVL' }), el('b', { class: 'num', text: fmtUsd(flatValueOf(row)) })),
        el('div', null, el('span', { text: 'Auxiliary radar value (TVL base x growth x chain)' }), el('b', { class: 'num', text: fmtUsd(radarValueOf(row)) })),
        el('div', null, el('span', { text: 'Tokenization propensity (' + propensityBand(propensityOf(row)) + ') — indicator only' }), el('b', { class: 'num', text: Math.round(propensityOf(row) * 100) + '%' })),
        el('div', null, el('span', { text: 'Risk-adjusted score (unitless)' }), el('b', { class: 'num', text: fmtNum(prio) })),
        el('div', { class: 'total' }, el('span', { text: 'Launch value (the ranking value)' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: valueText + 'Age with no token, ' + fmtAge(row.age_days) + ', does not enter either value. The page recomputes this row as ' + fmtUsd(recomputed) + (match ? ', the same number board.json carries' : ', which differs from the board: the data would be stale') + ', and its priority score as ' + fmtNum(prio) + (prioMatch ? ', matching.' : ', differing: the data would be stale.') + ' This is an estimate, not a price.' }),
      el('p', { class: 'sub', text: 'Two layers. (1) Value if it launches: ' + fmtUsd(row.range_lo_usd) + ' to ' + fmtUsd(row.range_hi_usd) + ' (Central 60% model range, P20–P80), ' + fmtUsd(row.range_lo10_usd) + ' to ' + fmtUsd(row.range_hi90_usd) + ' (P10–P90), cut from the holdout error distribution. (2) Whether it launches: propensity ' + Math.round(row.propensity * 100) + '% (' + propensityBand(row.propensity) + '), a cross-sectional score, not a calibrated chance. P10–P90 is not an 80% confidence interval on the final airdrop value. Farm verdict ' + row.farm_verdict + ' on a $' + row.farm_plan_size + ' plan: ' + netsText + ', less ' + ntx + ' transactions of gas and the cost of the capital. Conditional on launch and a pro-rata drop — not an expected return.' }),
      el('p', { class: 'sub', text: 'Under radar-2 this protocol ranked #' + row.v2_rank + ' with an implied value of ' + fmtUsd(row.v2_implied) + ' (recomputed ' + fmtUsd(v2recomputed) + (v2match ? ', matching.' : ', differing: the data would be stale.') + ' Radar-7 ranks it #' + row.rank + '.' }),
      standing ? el('p', { class: 'sub', text: standing + '.' }) : null
    ));
    var capital = row.farm_plan_size || 1000;
    var gasTotal = gasForPlan(row.chains, hold);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Budget and risk' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Capital for one position' }), el('b', { class: 'num', text: '$' + capital })),
        el('div', null, el('span', { text: 'Gas budget, ' + ntx + ' transactions (estimate)' }), el('b', { class: 'num', text: '$' + gasTotal.toFixed(2) })),
        el('div', null, el('span', { text: 'Plan state' }), el('b', { class: 'num', text: row.plan_state || 'Conditional' })),
        el('div', null, el('span', { text: 'Hold at least' }), el('b', { class: 'num', text: hold + ' days' })),
        el('div', null, el('span', { text: 'Exit rule' }), el('b', { class: 'num', text: 'unwind if TVL halves from ' + fmtTvl(row.tvl_usd) }))
      ),
      el('p', { class: 'sub', text: 'Gas moves with the network; the budget is conservative, not a live quote. Nothing here promises a token or an airdrop.' })
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
      var rolling = rollingPanel();
      if (rolling) shell.appendChild(rolling);
      shell.appendChild(modelPanel());
    }
    shell.appendChild(el('p', { class: 'note', text: 'Source: DefiLlama protocol index, snapshot ' + DATA.as_of + '. "Records no token" means the snapshot carries no market cap, CoinGecko id or symbol — not proof none exists. Launch value is this entry\'s own model, never a price, and no farm plan promises a token or an airdrop.' }));
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
