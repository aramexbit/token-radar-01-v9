// Token Radar — farm plans.
//
// Every board row gets an 8-step plan, one step a week over 8 weeks, in the
// idiom of the protocol's own category. The steps are built from the
// snapshot's own figures only: the deposit tier from TVL, the chain from
// the cheapest gas, the week-1 advice from the 7-day TVL change, and the
// week-6 note from the listing age. Nothing is invented per protocol.

import { ageDays, type Protocol } from "./model.ts";

// ---------------------------------------------------------------------------
// Gas. One typical fee per chain, as a range. The default is the cheapest
// band; the exceptions are the chains whose usual fee sits higher.
// ---------------------------------------------------------------------------

const GAS_EXCEPTIONS: Record<string, number> = {
  Ethereum: 2,
  Bitcoin: 0.5,
  Arbitrum: 0.1,
  Avalanche: 0.1,
  Bittensor: 0.1,
  Berachain: 0.05,
  Binance: 0.05,
  Optimism: 0.05,
  Starknet: 0.05,
  "zkSync Era": 0.05,
  Linea: 0.05,
  Blast: 0.05,
  Scroll: 0.05,
};

const GAS_RANGE: Record<number, [string, string, number]> = {
  0.01: ["0.01", "0.05", 0.03],
  0.05: ["0.05", "0.20", 0.125],
  0.1: ["0.10", "0.50", 0.3],
  0.5: ["0.50", "2.00", 1.25],
  2: ["2", "10", 6],
};

export function gasLow(chain: string): number {
  return GAS_EXCEPTIONS[chain] ?? 0.01;
}

/** Cheapest chain first; on a tie Solana wins, then the earliest chain in
 *  the snapshot's own list. */
export function orderedChains(p: Protocol): string[] {
  return [...p.chains]
    .map((c, i) => ({ c, low: gasLow(c), sol: c === "Solana" ? 0 : 1, i }))
    .sort((a, b) => a.low - b.low || a.sol - b.sol || a.i - b.i)
    .map((x) => x.c);
}

export function primaryChain(p: Protocol): string {
  return orderedChains(p)[0];
}

export function fallbackChain(p: Protocol): string | null {
  const ord = orderedChains(p);
  return ord.length > 1 ? ord[1] : null;
}

/** The gas range as printed in a step, e.g. "$0.01–0.05". Solana's range
 *  collapses to a single figure. */
export function gasDisplay(p: Protocol): string {
  const primary = primaryChain(p);
  const low = gasLow(primary);
  if (primary === "Solana") return "$0.01";
  const [lo, hi] = GAS_RANGE[low];
  return `$${lo}–${hi}`;
}

/** The per-transaction gas used by the netting: the midpoint of the range. */
export function gasPerTx(p: Protocol): number {
  const primary = primaryChain(p);
  if (primary === "Solana") return 0.01;
  return GAS_RANGE[gasLow(primary)][2];
}

// ---------------------------------------------------------------------------
// Deposit tiers. The first step deposits one band; later steps add a
// smaller band. The midpoint of the first band is the netting deposit.
// ---------------------------------------------------------------------------

export type Tier = "S" | "M" | "L";

export function depositTier(p: Protocol): Tier {
  if (p.tvl_usd < 100_000_000) return "S";
  if (p.tvl_usd < 1_000_000_000) return "M";
  return "L";
}

const DEPOSIT_RANGE: Record<Tier, string> = {
  S: "$25–100",
  M: "$100–500",
  L: "$500–2,000",
};

const ADD_AMOUNT: Record<Tier, string> = {
  S: "$25–50",
  M: "$50–200",
  L: "$200–500",
};

const DEPOSIT_MID: Record<Tier, number> = { S: 62.5, M: 300, L: 1250 };

export function depositMidpoint(p: Protocol): number {
  return DEPOSIT_MID[depositTier(p)];
}

// ---------------------------------------------------------------------------
// Week-1 advice, from the raw 7-day TVL change.
// ---------------------------------------------------------------------------

export function growthAdvice(p: Protocol): string {
  if (p.change_7d === null) return "(no 7-day change reported — check every 2 weeks)";
  const ch = p.change_7d;
  const dir = ch >= 0 ? "up" : "down";
  const pct = Math.abs(ch).toFixed(1);
  let advice: string;
  if (ch > 20) {
    advice = "momentum is strong, compound weekly while it lasts";
  } else if (ch >= 0) {
    advice = "check every 2 weeks";
  } else if (ch > -10) {
    advice = "check every 2 weeks and watch for a deeper slide";
  } else {
    advice = "check weekly and shrink the next deposit if it keeps falling";
  }
  return `(TVL ${dir} ${pct}% in 7 days — ${advice})`;
}

// ---------------------------------------------------------------------------
// Week-6 note, from the listing age.
// ---------------------------------------------------------------------------

export function ageClause(p: Protocol): string {
  const days = ageDays(p);
  if (days === null) {
    return "no listing date is reported, so hold the full 8 weeks before judging the farm";
  }
  if (days < 180) {
    return `only ${days} days unlaunched — a fresh listing, so move in week 1 and reassess at day 56`;
  }
  if (days <= 540) {
    return `${days} days unlaunched — a seasoned wait, so hold the full 8 weeks before judging it`;
  }
  const years = (days / 365.25).toFixed(1);
  return `${days} days unlaunched (${years} years) — a long wait, so treat this as patient accumulation and hold 8+ weeks`;
}

type Ctx = {
  name: string;
  poss1: string; // straight apostrophe, as in step 1
  poss2: string; // curly apostrophe, as in step 2
  primary: string;
  fallback: string;
  range: string;
  add: string;
  gas: string;
  advice: string;
  age: string;
};

function context(p: Protocol): Ctx {
  const primary = primaryChain(p);
  const second = fallbackChain(p);
  const fallback =
    second === null
      ? "no second chain is on record — the fallback is to wait, not to bridge blind"
      : `keep ${second} as the fallback route if ${primary} stalls`;
  const tier = depositTier(p);
  return {
    name: p.name,
    poss1: `${p.name}'s`,
    poss2: `${p.name}’s`,
    primary,
    fallback,
    range: DEPOSIT_RANGE[tier],
    add: ADD_AMOUNT[tier],
    gas: gasDisplay(p),
    advice: growthAdvice(p),
    age: ageClause(p),
  };
}

const DAYS = ["Day 1", "Day 3", "Day 7", "Day 14", "Day 21", "Day 28", "Day 42", "Day 56"];

type Play = (c: Ctx) => string[];

const depositCurator: Play = (c) => [
  `Deposit ${c.range} into ${c.poss1} largest curated vault on ${c.primary} (gas ~${c.gas}, ~3 min); hold 8 weeks.`,
  `Check ${c.poss2} curator, allocation and APY weekly; fallback: ${c.fallback}.`,
  `Harvest or compound vault yield ${c.advice}; each harvest costs ~${c.gas}, ~5 min.`,
  `Add ${c.add} to a second vault run by a different curator (deposit gas ~${c.gas}).`,
  `Withdraw a 10–20% test slice, then re-deposit it the same day (two legs, gas ~${c.gas} each).`,
  `Claim vault yield and re-deposit it (claim gas ~${c.gas}); switch vaults if the curator changes strategy.`,
  `${c.age}; review the curator’s allocation weekly (10 min) — a strategy change is the signal to move.`,
  `Decide: keep the vaults if yield beats gas, else withdraw and export the full log.`,
];

const depositVault: Play = (c) => [
  `Deposit ${c.range} into ${c.poss1} highest-TVL vault on ${c.primary} (gas ~${c.gas}, ~3 min); funds stay 8 weeks.`,
  `Read ${c.poss2} vault list on ${c.primary} and note the fallback: ${c.fallback}.`,
  `Harvest or compound the yield ${c.advice}; each harvest costs ~${c.gas}, ~5 min.`,
  `Split a second deposit (${c.add}) into another vault or strategy to widen coverage (gas ~${c.gas}).`,
  `Withdraw a 10–20% test slice, then re-deposit it the same day (two legs, gas ~${c.gas} each).`,
  `Claim yield and re-deposit it (claim gas ~${c.gas}, ~10 min); log vault returns weekly.`,
  `${c.age}; keep a weekly log of vault deposits and yields, 10 min a week, no extra gas.`,
  `Decide: keep the vaults if net yield beats gas, else withdraw and export the full log.`,
];

const swap: Play = (c) => [
  `Swap ${c.range} into ${c.poss1} main pair on ${c.primary} (gas ~${c.gas} per swap, ~2 min) and save the receipt.`,
  `Check ${c.poss2} deepest pool on ${c.primary} and note the fallback: ${c.fallback}.`,
  `Add ${c.range} of liquidity to the deepest pool ${c.advice}; deposit gas ~${c.gas}, hold the LP 8 weeks.`,
  `Swap back 10–25% of the LP to show repeat usage (one swap, gas ~${c.gas}, ~2 min).`,
  `Withdraw a 10–20% test slice of the LP, then re-deposit it the same day (two legs, gas ~${c.gas} each).`,
  `Claim trading-fee rewards and re-deposit them (claim gas ~${c.gas}, ~15 min); log the amounts.`,
  `${c.age}; keep the LP open and review the pool’s depth before adding more.`,
  `Decide: keep the LP if fees beat gas, else exit to the flagship stablecoin on ${c.primary} and export the full log.`,
];

const mint: Play = (c) => [
  `Mint or buy ${c.range} of ${c.poss1} tokenised asset on ${c.primary} (gas ~${c.gas}, ~5 min) and keep the receipt.`,
  `Check ${c.poss2} redemption terms on ${c.primary}; fallback: ${c.fallback}.`,
  `Hold the position — RWA farms reward holding time, not churn ${c.advice}; check the position weekly.`,
  `Add ${c.add} to the same asset class to show a growing position (gas ~${c.gas}).`,
  `Redeem a 10–20% test slice, then buy it back the same day (two legs, gas ~${c.gas} each) to prove the redemption path.`,
  `Claim any payout the asset pays and re-deposit it monthly (claim gas ~${c.gas}, ~10 min).`,
  `${c.age}; keep the purchase receipt and position history — export them monthly (10 min).`,
  `Decide: keep holding if the asset’s payout beats gas, else redeem and export the full record.`,
];

const supply: Play = (c) => [
  `Supply ${c.range} of a major asset (ETH, USDC or wBTC) as collateral to ${c.name} on ${c.primary} (gas ~${c.gas}, ~3 min).`,
  `Check ${c.poss2} borrow rates and health-factor rules on ${c.primary}; fallback: ${c.fallback}.`,
  `Borrow 20–40% of the supplied value in a stablecoin ${c.advice}; borrow tx costs ~${c.gas}.`,
  `Repay 10–20% of the loan, then re-borrow a different asset (each leg gas ~${c.gas}, ~5 min).`,
  `Withdraw a 10–20% test slice of the collateral, then re-supply it the same day (two legs, gas ~${c.gas} each).`,
  `Top up collateral by ${c.add} so the position stays healthy (top-up gas ~${c.gas}); log the health factor.`,
  `${c.age}; never let the health factor near 1 — check it weekly, 10 min.`,
  `Decide: keep the supply/borrow loop if rates beat gas, else repay in full and export the history.`,
];

const lock: Play = (c) => [
  `Lock ${c.range} of collateral (ETH or wBTC) in a ${c.name} vault on ${c.primary} (gas ~${c.gas}, ~3 min).`,
  `Check ${c.poss2} collateral-ratio rules on ${c.primary}; fallback: ${c.fallback}.`,
  `Mint stablecoins against 25–40% of the collateral value ${c.advice}; minting costs ~${c.gas}, keep the ratio safe.`,
  `Repay 10–20% of the minted debt with ${c.add}, then mint a smaller amount again (each leg gas ~${c.gas}).`,
  `Withdraw a 10–20% test slice of collateral, then re-lock it the same day (two legs, gas ~${c.gas} each).`,
  `Add collateral monthly so the ratio stays above 200% (top-up gas ~${c.gas}, ~5 min); log the ratio weekly.`,
  `${c.age}; check the collateral ratio weekly (10 min) and never let it near liquidation.`,
  `Decide: keep the vault open if the minted stablecoins earn more than gas, else repay in full and export the log.`,
];

const open: Play = (c) => [
  `Open a small long or short on ${c.name} (${c.range} notional, 1–2x leverage) on ${c.primary} (gas ~${c.gas} plus taker fee, ~5 min).`,
  `Set a stop-loss and take-profit on the position the same day; fallback: ${c.fallback}.`,
  `Close the first position and open a fresh one the next week ${c.advice}; each close costs ~${c.gas}, ~5 min.`,
  `Trade the opposite direction with ${c.add} notional to show two-sided use (gas ~${c.gas} plus taker fee).`,
  `Close a 10–20% slice of the open position, then re-open it the same day (two legs, gas ~${c.gas} each).`,
  `Settle the month’s round trips and log PnL per trade (settlement gas ~${c.gas}); never risk more than 5% of the farm budget on one trade.`,
  `${c.age}; keep at least 4 round trips over the 8 weeks — breadth beats one big bet.`,
  `Decide: keep trading small if the venue’s fees beat gas, else close out and export the trade diary.`,
];

const stake: Play = (c) => [
  `Stake ${c.range} of the base asset with ${c.name} on ${c.primary} (gas ~${c.gas}, ~3 min); funds stay staked 8 weeks.`,
  `Check ${c.poss2} staking terms and unbonding time on ${c.primary}; fallback: ${c.fallback}.`,
  `Claim staking rewards and restake them ${c.advice}; each claim costs ~${c.gas}, ~5 min.`,
  `Add ${c.add} to the stake to show a growing position (top-up gas ~${c.gas}).`,
  `Unstake a 10–20% test slice, then re-stake it the same day (two legs, gas ~${c.gas} each).`,
  `Restake a slice (25–50%) of the stake once if restaking is offered (restake gas ~${c.gas}, ~5 min).`,
  `${c.age}; unstaking can take days — plan the exit a week ahead, never at the last minute.`,
  `Decide: keep staking if rewards beat gas, else unstake and export the staking history.`,
];

const bridge: Play = (c) => [
  `Bridge ${c.range} onto ${c.poss1} chain and make a first swap on its flagship DEX (gas ~${c.gas} each, ~10 min).`,
  `Pick a second native dApp to try this week; fallback: ${c.fallback}.`,
  `Interact with one native dApp (lending or perps) weekly for 8 weeks ${c.advice}; each interaction costs ~${c.gas}.`,
  `Add ${c.add} to the chain balance and use a second native app (gas ~${c.gas}, ~15 min).`,
  `Move a 10–20% test slice to another native app, then move it back the same day (two legs, gas ~${c.gas} each).`,
  `Settle the month’s activity and hold a small native-token balance ($10–50) for gas (settlement gas ~${c.gas}).`,
  `${c.age}; keep activity steady — 2–3 tx a week for a month beats 20 tx in one day.`,
  `Decide: keep living on the chain if dApp fees beat gas, else consolidate and export the activity log.`,
];

const buyIndex: Play = (c) => [
  `Buy ${c.range} of ${c.poss1} index token on ${c.primary} (gas ~${c.gas}, ~3 min); hold at least 8 weeks.`,
  `Check ${c.poss2} basket weights and rebalance date on ${c.primary}; fallback: ${c.fallback}.`,
  `Compare the index price to its NAV weekly ${c.advice}; note any discount — it is part of the farm record.`,
  `Add ${c.add} on the monthly rebalance date if the index reweights (top-up gas ~${c.gas}).`,
  `Redeem a 10–20% test slice, then buy it back the same day (two legs, gas ~${c.gas} each).`,
  `Settle the month’s position and log price vs NAV (settlement gas ~${c.gas}, ~10 min).`,
  `${c.age}; hold through at least one full rebalance cycle (usually a month) before judging the position.`,
  `Decide: keep the index if the basket beats gas, else redeem and export the full log.`,
];

const buyShares: Play = (c) => [
  `Buy ${c.range} of shares in a ${c.name} market resolving in 2–4 weeks on ${c.primary} (gas ~${c.gas}, ~3 min).`,
  `Pick a second market in a different category; fallback: ${c.fallback}.`,
  `Trade a second market the next week ${c.advice}; each trade costs ~${c.gas}.`,
  `Add ${c.add} to a market in a new category to widen breadth (gas ~${c.gas}).`,
  `Sell a 10–20% test slice of one position, then buy it back the same day (two legs, gas ~${c.gas} each).`,
  `Settle the month’s resolved markets and record every outcome (settlement gas ~${c.gas}).`,
  `${c.age}; place 4–8 small trades over 8 weeks rather than one big bet — breadth beats size.`,
  `Decide: keep trading small if resolution payouts beat gas, else stop and export the trade history.`,
];

const payment: Play = (c) => [
  `Make a first real payment of ${c.range} through ${c.name} on ${c.primary} (gas ~${c.gas}, ~3 min) and keep the receipt.`,
  `Check ${c.poss2} second payment rail or currency on ${c.primary}; fallback: ${c.fallback}.`,
  `Repeat a payment weekly for 8 weeks ${c.advice}; each payment costs ~${c.gas}.`,
  `Try a second payment rail or currency with ${c.add} (each try gas ~${c.gas}).`,
  `Send a 10–20% test payment out and settle it back the same day (two legs, gas ~${c.gas} each).`,
  `Settle accumulated balances monthly (settlement gas ~${c.gas}, ~10 min); export the receipts.`,
  `${c.age}; keep receipts for every payment — export the history monthly (10 min) as proof of sustained use.`,
  `Decide: keep paying through ${c.name} if fees beat gas, else settle out and export the payment history.`,
];

const quote: Play = (c) => [
  `Request a quote for a ${c.range} trade with ${c.name} on ${c.primary} (quoting is free, settling costs ~${c.gas}, ~10 min).`,
  `Check ${c.poss2} limit and RFQ order types on ${c.primary}; fallback: ${c.fallback}.`,
  `Settle one small trade to open the account history ${c.advice}; settlement costs ~${c.gas} plus the agreed spread.`,
  `Repeat a trade in a different pair with ${c.add} (each settlement gas ~${c.gas}).`,
  `Settle a 10–20% test trade out and back the same day (two legs, gas ~${c.gas} each).`,
  `Settle the month’s trades and log every fill (settlement gas ~${c.gas}); use limit or RFQ orders when offered.`,
  `${c.age}; keep 4+ settled trades over 8 weeks — export the trade history monthly (10 min).`,
  `Decide: keep trading OTC if spreads beat gas, else stop and export the full history.`,
];

const bridgeFrom: Play = (c) => [
  `Bridge ${c.range} from ${c.primary} to another supported chain through ${c.name} (gas ~${c.gas} plus the bridge fee, ~10 min).`,
  `Check ${c.poss2} supported routes from ${c.primary}; fallback: ${c.fallback}.`,
  `Bridge a different asset the following week ${c.advice}; allow 10–30 min for finality each time.`,
  `Bridge ${c.add} back so the flow is two-way, not one-way (return leg gas ~${c.gas} plus the bridge fee).`,
  `Bridge a 10–20% test slice out and back the same day (two legs, gas ~${c.gas} each plus bridge fees).`,
  `Settle the month’s crossings and log every tx hash (settlement gas ~${c.gas}); keep each bridge above the venue minimum (usually $10–25).`,
  `${c.age}; bridging history is the farm record here — 6+ crossings over 8 weeks beats one burst.`,
  `Decide: keep bridging weekly if fees beat gas, else stop and export the crossing history.`,
];

const lockDelegate: Play = (c) => [
  `Lock or delegate ${c.range} of voting power with ${c.name} on ${c.primary} (gas ~${c.gas}, ~3 min); lock for 8 weeks.`,
  `Read ${c.poss2} live proposals on ${c.primary}; fallback: ${c.fallback}.`,
  `Vote on every live proposal while locked ${c.advice}; voting costs ~${c.gas} each — missing votes is the usual disqualifier.`,
  `Add ${c.add} to the lock to show a growing position (top-up gas ~${c.gas}).`,
  `Unlock a 10–20% test slice, then re-lock it the same day (two legs, gas ~${c.gas} each).`,
  `Claim voting rewards and re-lock them (claim gas ~${c.gas}, ~5 min a week).`,
  `${c.age}; join one governance discussion per proposal cycle (~15 min, no gas).`,
  `Decide: keep the lock through at least two proposal cycles before unlocking; early exit can forfeit rewards.`,
];

const buyCover: Play = (c) => [
  `Buy cover of ${c.range} for 30–90 days with ${c.name} on ${c.primary} (gas ~${c.gas} plus the premium, ~5 min).`,
  `Check ${c.poss2} cover terms and claim window on ${c.primary}; fallback: ${c.fallback}.`,
  `Hold the cover live — lapsed cover breaks the farm record ${c.advice}; check the policy weekly.`,
  `Extend or top up the cover with ${c.add} if the term allows (gas ~${c.gas}).`,
  `Provide a 10–20% test slice of underwriting capacity if offered, then withdraw it the same day (two legs, gas ~${c.gas} each).`,
  `Settle the month’s cover and log the policy status (settlement gas ~${c.gas}, ~10 min).`,
  `${c.age}; file a claim only if a real covered event happens — never file a false claim.`,
  `Decide: renew the cover if the premium beats gas, else let it lapse and export the policy history.`,
];

const PLAYS: Record<string, Play> = {
  "Risk Curators": depositCurator,
  "Onchain Capital Allocator": depositCurator,
  CeDeFi: depositCurator,
  "Liquidity Manager": depositCurator,
  Yield: depositVault,
  "Yield Aggregator": depositVault,
  Farm: depositVault,
  "Leveraged Farming": depositVault,
  Dexs: swap,
  RWA: mint,
  "Stablecoin Wrapper": mint,
  "Anchor BTC": mint,
  "Dual-Token Stablecoin": mint,
  "Decentralized BTC": mint,
  Lending: supply,
  "Collateral Markets": supply,
  "Uncollateralized Lending": supply,
  CDP: lock,
  "CDP Manager": lock,
  Derivatives: open,
  "Basis Trading": open,
  "Interest Rate Derivatives": open,
  "Staking Pool": stake,
  Restaking: stake,
  Chain: bridge,
  Indexes: buyIndex,
  "Prediction Market": buyShares,
  Payments: payment,
  "Crypto Card Issuer": payment,
  "OTC Marketplace": quote,
  "Cross Chain Bridge": bridgeFrom,
  "Governance Incentives": lockDelegate,
  Insurance: buyCover,
};

/** Transactions in the first step, by play. The netting charges the gas of
 *  the first step only. */
const FIRST_STEP_TX: Record<string, number> = {
  "Risk Curators": 6,
  "Onchain Capital Allocator": 6,
  CeDeFi: 6,
  "Liquidity Manager": 6,
  Yield: 6,
  "Yield Aggregator": 6,
  Farm: 6,
  "Leveraged Farming": 6,
  RWA: 4,
  "Stablecoin Wrapper": 4,
  "Anchor BTC": 4,
  "Dual-Token Stablecoin": 4,
  "Decentralized BTC": 4,
  "Cross Chain Bridge": 4,
  Indexes: 4,
  Insurance: 4,
};

export function firstStepTx(p: Protocol): number {
  return FIRST_STEP_TX[p.category ?? ""] ?? 5;
}

export function farmSteps(p: Protocol): string[] {
  const play = PLAYS[p.category ?? ""];
  if (!play) throw new Error(`no farm play for category ${p.category ?? "(null)"} (${p.slug})`);
  const c = context(p);
  return play(c).map((body, i) => `${DAYS[i]} — ${body}`);
}
