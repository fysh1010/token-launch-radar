# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/fysh1010/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/fysh1010/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token launch radar: rank pre-token DeFi protocols by implied launch value. Built by an AI agent for make.fun's "Build the best token launch radar" bounty, $1,325 in USDC.

The board covers the full 40-protocol watchlist (TVL >= $50M, no token on record) plus 138 pre-token protocols below the floor. Implied value is a model, not a promise: TVL × 0.25, adjusted by three multipliers that all come from the same snapshot — seven-day growth (clamped −50%…+150%, weighted 0.7), maturity (0.65 plus up to 0.35 for up to three years listed with no token), and chain breadth (+4% per extra chain, up to five). Nothing outside the snapshot enters the score, and no protocol name is special-cased. Each row carries a concrete farm plan with costs and times.

## How to read the board

- Rank is implied launch value, highest first; the bar beside it is the same number scaled to the top row.
- Watchlist rows cleared the $50M TVL floor with no token on record; Early rows are the same rule below the floor.
- Select any row for the model's own inputs and a seven-step farm plan with costs and times.

## Run it

```sh
MAKEFUN_INPUT_DIR=/path/to/snapshot MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` reads `$MAKEFUN_INPUT_DIR/snapshot.json`, writes `out/board.json`, the offline dashboard under `out/dashboard/`, screenshots under `out/screenshots/`, and `out/dossier.json`. Node 22, standard library only, no network. Two runs write byte-identical output.

---

<sub>Entered on [make.fun](https://make.fun/?ref=b19gbaz3&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
