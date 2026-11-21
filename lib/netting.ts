// Token Radar — bootstrap bands and farm economics.
//
// The curve is refit 2,000 times on resampled comparables (pairs
// bootstrap, fixed seed). Each board row gets a P10–P90 band from those
// refits. The farm economics are then plain arithmetic on the band's low
// end: the expected value of the farm is the low-end launch value times
// the deposit over TVL, minus gas and fees. A row is worth farming only
// when that expected net clears $25; at $1 or less it is a skip.

import {
  ageFactor,
  curveValue,
  growthFactor,
  type OlsFit,
  type Protocol,
} from "./model.ts";
import { depositMidpoint, firstStepTx, gasPerTx } from "./plan.ts";

export type Verdict = "farm" | "thin" | "skip";

export type RowEconomics = {
  bandLow: number;
  bandHigh: number;
  deposit: number;
  gas: number;
  gasTx: number;
  fees: number;
  expected: number;
  net: number;
  netPerHour: number;
  breakEven: number;
  rankLow: number;
  rankHigh: number;
  verdict: Verdict;
};

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nearest-rank quantile: index round(q × (n − 1)) on the sorted values. */
export function quantile(sorted: number[], q: number): number {
  const idx = Math.round(q * (sorted.length - 1));
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

export function bootstrapBands(
  rows: { protocol: Protocol; implied: number }[],
  comps: Protocol[],
  fit: OlsFit,
  refits = 2000,
  seed = 2,
): { bandLow: number; bandHigh: number }[] {
  const xs0 = comps.map((p) => Math.log10(p.tvl_usd));
  const ys0 = comps.map((p) => Math.log10(p.mcap_usd as number));
  const n = comps.length;
  const rng = mulberry32(seed);
  const boot = rows.map(() => new Float64Array(refits));
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let b = 0; b < refits; b++) {
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      xs[i] = xs0[j];
      ys[i] = ys0[j];
    }
    const refit = olsFitFromXY(xs, ys);
    for (let k = 0; k < rows.length; k++) {
      const p = rows[k].protocol;
      let v = curveValue(refit, p.tvl_usd) * growthFactor(p) * ageFactor(p);
      const cap = 10 * p.tvl_usd;
      if (v > cap) v = cap;
      boot[k][b] = v;
    }
  }
  return boot.map((arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    return { bandLow: quantile(sorted, 0.1), bandHigh: quantile(sorted, 0.9) };
  });
}

function olsFitFromXY(xs: Float64Array, ys: Float64Array): OlsFit {
  const n = xs.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
    syy += (ys[i] - my) * (ys[i] - my);
  }
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: (sxy * sxy) / (sxx * syy), n };
}

export function rowEconomics(
  row: { protocol: Protocol; implied: number },
  band: { bandLow: number; bandHigh: number },
  allImpliedDesc: number[],
): RowEconomics {
  const p = row.protocol;
  const deposit = depositMidpoint(p);
  const gasTx = firstStepTx(p);
  const gas = gasTx * gasPerTx(p);
  const fees = 0.005 * deposit;
  const expected = (band.bandLow * deposit) / p.tvl_usd;
  const net = expected - gas - fees;
  const netPerHour = net / 2.0;
  const breakEven = ((gas + fees) * p.tvl_usd * row.implied) / (deposit * band.bandLow);
  const rankOf = (v: number): number => {
    let r = 1;
    for (const x of allImpliedDesc) {
      if (x > v) r++;
      else break;
    }
    return r;
  };
  const verdict: Verdict = net >= 25 ? "farm" : net <= 1 ? "skip" : "thin";
  return {
    bandLow: band.bandLow,
    bandHigh: band.bandHigh,
    deposit,
    gas,
    gasTx,
    fees,
    expected,
    net,
    netPerHour,
    breakEven,
    rankLow: rankOf(band.bandHigh),
    rankHigh: rankOf(band.bandLow),
    verdict,
  };
}
