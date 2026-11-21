# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/fysh1010/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/fysh1010/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: rank pre-token DeFi protocols by implied launch value. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

The board covers the full 40-protocol watchlist (TVL >= $50M, no token on record) plus 158 pre-token protocols the watchlist does not name: 138 below the floor, and 20 above it that the watchlist skips, flagged OFF LIST. Implied value is value-if-it-launches times launch odds. Value-if-it-launches is the radar-3 formula: 0.25 × TVL^0.85 × board-median TVL^0.15, times a growth factor measured against the protocol's own category median (tanh, so spikes saturate) and a chain factor (+3% per extra chain, up to five). Launch odds are a logistic model fitted on the 614 protocols whose outcome the snapshot knows — 416 launched, 198 rankable pre-token — from log TVL, log age, chain count and the category launch rate, calibrated so the mean predicted odds equals the observed launch rate; five-fold cross-validation gets 74% right against 68% for the majority class. The value formula is checked out of sample on the 128 traded tokens: leave-one-out median miss ×4.32 against ×5.07 for a flat TVL multiple, and by-time ×3.88 against ×5.29. Each row prints a P25–P75 range from the leave-one-out error distribution, and the by-time held-out coverage is 52% in-range (79% for P10–P90). Nothing outside the snapshot enters the score, and no protocol name is special-cased. Each row carries a concrete farm plan with costs and times, a Farm / Marginal / Skip verdict on the $1,000 plan's expected net, and the dashboard shows the radar-2 versus radar-4 ranking side by side.

## How to read the board

- Rank is implied launch value, highest first; the bar beside it is the same number scaled to the top row. Launch odds is the fitted probability the protocol launches a token.
- Watchlist rows cleared the $50M TVL floor with no token on record; Early rows are the same rule below the floor; Off list rows are above the floor but the watchlist skips them.
- Select any row for the value-times-odds decomposition, the printed range, the farm verdict, and a seven-step farm plan with costs and times.

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/snapshot MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads `$MAKEFUN_INPUT_DIR/snapshot.json`, writes `out/board.json`, the offline dashboard under `out/dashboard/`, screenshots under `out/screenshots/`, and `out/dossier.json`. Node 22, standard library only, no network. Two runs write byte-identical output.

---

<sub>Entered on [make.fun](https://make.fun/?ref=b19gbaz3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
