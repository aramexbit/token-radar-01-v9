# Token Radar v9

[![make.fun](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aramexbit/token-radar-01-v9/rank.svg)](https://make.fun/bounty/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aramexbit/token-radar-01-v9/reward.svg)](https://make.fun/bounty/token-radar-01)

Which pre-token protocol is worth farming — priced from the snapshot's own numbers, not a list. An entry for [token-radar-01 on make.fun](https://make.fun/bounty/token-radar-01).

## What it does

`main.ts` reads the sealed DefiLlama snapshot (`/input/snapshot.json`, 758 protocols as of 2026-11-14), prices every pre-token protocol off the snapshot's own traded comparables, and writes:

- `board.json` — 198 pre-token protocols ranked by implied launch value, each with an 8-step farm plan.
- `data.js` — the dashboard's data, beside the page.
- `dashboard/` + `screenshots/` — copied to the output, with `dossier.json` built by the kit's `buildDossier`.

## How a launch is priced

One global OLS curve, fitted on the snapshot's own 127 traded protocols (one row per ticker):

```
implied = 10^(3.146 + 0.508 · log10 TVL) × growth × age
```

- **growth** — the 7-day TVL change, clamped to 0.8–1.2 (no reading: 1.0).
- **age** — at most a 15% haircut for listing age, reached only after five years (no listing date: 1.0).
- **cap** — 10× TVL, never binding.

144 protocols are set aside and never ranked: 128 sit in families that already have a token (CEX, liquid staking, bridges and the like), 11 carry a versioned name, 5 are wrapped or staked names. The 40-protocol watchlist is fully covered.

## What the held-out tests say

| Model | Median miss | Within 2× | Within 3× |
|---|---:|---:|---:|
| Curve only (leave-one-out) | 84.1% | 33.9% | 42.5% |
| Curve + growth | 84.7% | 33.1% | 43.3% |
| Curve + age | 84.3% | 33.1% | 44.1% |
| **Full — the board** | **85.1%** | **33.9%** | **45.7%** |

Walk-forward (priced only from older listings, 57 comps): curve 84.4 / 36.8 / 54.4, full 83.5 / 31.6 / 52.6. Category offsets were computed and then **rejected**: shrunk toward 1 they still cut the hit rate (82.0 / 35.1 / 49.1), so no row on the board carries one. The rule is simple — **no term that fails the held-out test is used** — and the Method tab in the dashboard shows the whole table.

## Farm economics

Each row's band comes from a pairs bootstrap: 2,000 refits of the curve on resampled comparables, P10–P90. The expected value of the farm is the band low times the deposit over TVL, minus gas (midpoint of the cheapest chain's range, first-step transactions only) and a 0.5% fee. Farm means the expected net clears $25; skip means $1 or less. 23 farm, 151 thin, 24 skip. The best net is +$17.53 per hands-on hour.

## Run it

```
node main.ts
```

Reads `/input/snapshot.json` when it is mounted, otherwise `input/snapshot.json` next to the repo. Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` to `/output` when it exists, otherwise `out/`. Node 22+, standard library only. Run twice and every output byte is identical.

## The dashboard

Open `dashboard/index.html` (it reads `../data.js`): a sortable, filterable board; a detail view per protocol with the value decomposition, the nearest traded comparables with their multiples, the raw snapshot record, and the 8-step farm plan; a Method tab with the ablation and walk-forward tables; and a Set-aside tab listing the 144 protocols that were not ranked.

## License

MIT — see `LICENSE`.
