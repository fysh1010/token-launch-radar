# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/fysh1010/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/fysh1010/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: rank pre-token DeFi protocols by implied launch value. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

The board covers the full 40-protocol watchlist (TVL >= $50M, no token on record) plus 158 pre-token protocols the watchlist does not name: 138 below the floor, and 20 above it that the watchlist skips, flagged OFF LIST. Each row carries three separate numbers, never folded into one another. Launch value is the primary USD valuation and the ranking: the radar-3 formula with a calibrated base, 0.25 × 0.88 (k = 0.8781) × TVL^0.85 × anchor^0.15, times a growth factor measured against the protocol's own category median (tanh, so spikes saturate) and a chain factor (+3% per extra chain, up to five). The anchor is one definition everywhere: the traded-token TVL median for the row's category, shrunk toward the global median of $32.6M — the board and the holdout use the same anchor. The 0.88 scale is set by the traded tokens' own median raw log error, not by any competitor's total. Tokenization propensity is a logistic score fitted on the 442 eligible protocols — 244 already have a token, 198 rankable pre-token — from log TVL, chain count and the category rate, with the same eligibility filter on both sides. Log age was dropped by ablation: it lifts random-fold AUC (0.70 vs 0.64) but cuts time-split AUC (0.56 vs 0.62) and degrades both halves of the newer set. Propensity is a cross-sectional heuristic, not a calibrated chance of launching: only this snapshot exists, so true future-launch calibration cannot be computed. Out-of-fold quality: ROC-AUC 0.64, Brier 0.23 (0.25 for always guessing the 55% base rate), log loss 0.65 (0.69); by time, fitted before 2025-05-05 and scored after, AUC 0.62. The third number is the risk-adjusted score, launch value times propensity — a unitless sort aid, never labelled USD and never called an expected value. The value formula is checked out of sample on the 128 traded tokens with nested calibration, so no test sample's own market cap enters its own scale factor: leave-one-out median miss ×4.35 against ×5.07 for a flat TVL multiple, and by-time ×5.11 against ×5.29. The by-time miss is worse than the last release's leaky ×3.87 because the scale drifts forward in time: the old half's median log error is −0.40, the new half's +0.18. Each row prints a P25–P75 range from the leave-one-out error distribution, and the by-time held-out coverage is 42% in-range (79% for P10–P90) — below the nominal 50% for the same reason. Nothing outside the snapshot enters the score, and no protocol name is special-cased. Each row carries a concrete seven-step farm plan with costs and times, a plan state (Verified / Conditional / Research first), and a Farm / Marginal / Skip verdict judged on each plan size independently under three drop-share scenarios (1% / 3% / 7%); on this board the verdicts are 0 Farm, 68 Marginal, 130 Skip — all 68 Marginal earn it on the $10,000 plan, and no $1,000 plan clears $0 at the neutral 3% share once 7 transactions of gas are counted ($80.50 on Ethereum, $21.00 elsewhere, a conservative budget). Farm rewards are conditional — assuming the protocol launches and the drop is allocated pro-rata to TVL share — not expected returns. The dashboard shows the radar-2 versus radar-6 ranking side by side (Spearman 0.98).

## How to read the board

- Rank is launch value, highest first; the bar beside it is the same number scaled to the top row. Tokenization propensity is a cross-sectional score, not a calibrated chance of launching; the risk-adjusted score is launch value times propensity, unitless.
- Watchlist rows cleared the $50M TVL floor with no token on record; Early rows are the same rule below the floor; Off list rows are above the floor but the watchlist skips them.
- Select any row for the three-number decomposition, the printed range, the farm verdict and plan state, and a seven-step farm plan with costs and times.

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/snapshot MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads `$MAKEFUN_INPUT_DIR/snapshot.json`, writes `out/board.json`, the offline dashboard under `out/dashboard/`, screenshots under `out/screenshots/`, and `out/dossier.json`. Node 22, standard library only, no network. Two runs write byte-identical output.

---

<sub>Entered on [make.fun](https://make.fun/?ref=b19gbaz3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
