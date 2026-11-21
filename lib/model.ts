import { readFileSync } from "node:fs";
//
// The model is one global OLS curve fitted on the snapshot's own traded
// protocols: log10(market cap) against log10(TVL). A pre-token protocol is
// priced by reading its TVL off that curve, then applying two small,
// held-out-tested adjustments: 7-day TVL growth and listing age. Nothing
// else enters the price — in particular no category tilt, even though one
// was computed and is shown in the Method tab with the reason it was left
// out.

export type Protocol = {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
};

export type Snapshot = {
  as_of: string;
  source: string;
  protocols: Protocol[];
};

export type OlsFit = { slope: number; intercept: number; r2: number; n: number };

export type BoardRow = {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
};

export type Board = { as_of: string; rows: BoardRow[] };

export const AS_OF = "2026-11-14";
// Token-odds cohorts are cut a couple of days earlier so the listing-age
// buckets are whole calendar years; see tokenOdds below.
export const ODDS_AS_OF = "2026-11-12";

export function loadSnapshot(path: string): Snapshot {
  return parseSnapshot(readFileSync(path, "utf8"));
}

export function parseSnapshot(text: string): Snapshot {
  return JSON.parse(text) as Snapshot;
}

/** Traded comparables: market cap above zero, one row per ticker. When two
 *  protocols share a ticker the first one in snapshot order is kept. */
export function tradedComps(protocols: Protocol[]): Protocol[] {
  const seen = new Set<string>();
  const out: Protocol[] = [];
  for (const p of protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const ticker = (p.symbol ?? "").toLowerCase();
    if (ticker !== "" && seen.has(ticker)) continue;
    if (ticker !== "") seen.add(ticker);
    out.push(p);
  }
  return out;
}

export function olsFit(rows: Protocol[]): OlsFit {
  const xs = rows.map((p) => Math.log10(p.tvl_usd));
  const ys = rows.map((p) => Math.log10(p.mcap_usd as number));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
    syy += (ys[i] - my) * (ys[i] - my);
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

export function curveValue(fit: OlsFit, tvlUsd: number): number {
  return Math.pow(10, fit.intercept + fit.slope * Math.log10(tvlUsd));
}

/** 7-day TVL growth, clamped to the 0.8–1.2 band. No reading: 1.0. */
export function growthFactor(p: Protocol): number {
  if (p.change_7d === null) return 1;
  return Math.min(1.2, Math.max(0.8, 1 + p.change_7d / 100));
}

export function ageDays(p: Protocol, asOf = AS_OF): number | null {
  if (p.listed_at === null) return null;
  const listed = Date.parse(p.listed_at + "T00:00:00Z");
  const ref = Date.parse(asOf + "T00:00:00Z");
  return Math.round((ref - listed) / 86400000);
}

/** Listing-age haircut: at most 15% off, reached only after five years. */
export function ageFactor(p: Protocol, asOf = AS_OF): number {
  const days = ageDays(p, asOf);
  if (days === null) return 1;
  const years = days / 365.25;
  return Math.max(0.85, 1 - (0.15 * Math.log(1 + years)) / Math.log(6));
}

export function impliedValue(p: Protocol, fit: OlsFit, asOf = AS_OF): number {
  const raw = curveValue(fit, p.tvl_usd) * growthFactor(p) * ageFactor(p, asOf);
  const cap = 10 * p.tvl_usd;
  return Math.round(Math.min(raw, cap));
}

const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

export type SetAsideReason =
  | "category"
  | "versioned"
  | "wrapped"
  | "exchange";

/** Protocols that are not ranked, with the reason each one is out. A
 *  protocol can only be ranked if it has no token yet and no listed parent
 *  already carries the token. */
export function setAside(
  protocols: Protocol[],
): { protocol: Protocol; reason: SetAsideReason; detail: string }[] {
  const out: { protocol: Protocol; reason: SetAsideReason; detail: string }[] = [];
  const familyCategories = new Set([
    "CEX",
    "Liquid Staking",
    "Bridge",
    "Canonical Bridge",
    "Liquid Restaking",
    "Restaked BTC",
  ]);
  for (const p of protocols) {
    if (p.symbol !== null) continue; // already has a token
    if (p.category !== null && familyCategories.has(p.category)) {
      out.push({ protocol: p, reason: "category", detail: p.category });
    } else if (VERSION_RE.test(p.name)) {
      out.push({ protocol: p, reason: "versioned", detail: "versioned name" });
    } else if (WRAPPED_RE.test(p.name)) {
      out.push({ protocol: p, reason: "wrapped", detail: "wrapped or staked name" });
    } else if (EXCHANGE_RE.test(p.name)) {
      out.push({ protocol: p, reason: "exchange", detail: "exchange name" });
    }
  }
  return out;
}

export function boardProtocols(protocols: Protocol[]): Protocol[] {
  const aside = new Set(setAside(protocols).map((s) => s.protocol.slug));
  return protocols.filter((p) => p.symbol === null && !aside.has(p.slug));
}

export function buildBoard(
  protocols: Protocol[],
  fit: OlsFit,
): { rows: { protocol: Protocol; implied: number }[] } {
  const rows = boardProtocols(protocols)
    .map((p) => ({ protocol: p, implied: impliedValue(p, fit) }))
    .sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : 1));
  return { rows };
}

// ---------------------------------------------------------------------------
// Token odds: what share of the protocols listed at least N years ago
// (whole calendar years, 365 days a year, cut at ODDS_AS_OF) have a token
// today. Display only — a base rate for the field, never a forecast for
// one protocol.
// ---------------------------------------------------------------------------

export type OddsCohort = { years: number; listed: number; tokened: number; pct: number };

export function tokenOdds(protocols: Protocol[]): OddsCohort[] {
  const ref = Date.parse(ODDS_AS_OF + "T00:00:00Z");
  const out: OddsCohort[] = [];
  for (const years of [1, 2, 3]) {
    const cutoff = ref - years * 365 * 86400000;
    let listed = 0;
    let tokened = 0;
    for (const p of protocols) {
      if (p.listed_at === null) continue;
      if (Date.parse(p.listed_at + "T00:00:00Z") > cutoff) continue;
      listed++;
      if (p.symbol !== null) tokened++;
    }
    out.push({ years, listed, tokened, pct: (100 * tokened) / listed });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Validation. Every figure is a median miss (%), the share of predictions
// within 2x of the real market cap, and the share within 3x.
// ---------------------------------------------------------------------------

export type ValidationScore = { medianMiss: number; in2x: number; in3x: number };

export function scorePredictions(preds: number[], actuals: number[]): ValidationScore {
  const miss = preds.map((pr, i) => Math.abs(pr - actuals[i]) / actuals[i]);
  const sorted = [...miss].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const in2 = preds.filter((pr, i) => pr >= actuals[i] / 2 && pr <= actuals[i] * 2).length;
  const in3 = preds.filter((pr, i) => pr >= actuals[i] / 3 && pr <= actuals[i] * 3).length;
  return {
    medianMiss: 100 * median,
    in2x: (100 * in2) / preds.length,
    in3x: (100 * in3) / preds.length,
  };
}

function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export type CategoryOffset = {
  category: string;
  n: number;
  medianRatio: number;
  shrunk: number;
};

/** Per-category median of (market cap / curve value), shrunk toward 1 by
 *  n / (n + 4) in log space. Computed here; the board does not use it. */
export function categoryOffsets(comps: Protocol[], fit: OlsFit): CategoryOffset[] {
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const cat = p.category ?? "(no category)";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push((p.mcap_usd as number) / curveValue(fit, p.tvl_usd));
  }
  const out: CategoryOffset[] = [];
  for (const [category, ratios] of byCat) {
    const med = medianOf(ratios);
    const n = ratios.length;
    out.push({ category, n, medianRatio: med, shrunk: Math.pow(med, n / (n + 4)) });
  }
  out.sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  return out;
}

function offsetsFrom(
  train: Protocol[],
  fit: OlsFit,
): Map<string, number> {
  const byCat = new Map<string, number[]>();
  for (const p of train) {
    const cat = p.category ?? "(no category)";
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push((p.mcap_usd as number) / curveValue(fit, p.tvl_usd));
  }
  const out = new Map<string, number>();
  for (const [cat, ratios] of byCat) {
    const med = medianOf(ratios);
    out.set(cat, Math.pow(med, ratios.length / (ratios.length + 4)));
  }
  return out;
}

export type Validation = {
  looFlat: ValidationScore;
  looCurve: ValidationScore;
  looGrowth: ValidationScore;
  looAge: ValidationScore;
  looFull: ValidationScore;
  blind: ValidationScore;
  blindTrain: number;
  blindTest: number;
  wfFolds: { fold: number; medianMiss: number; in2x: number }[];
  wfPooledCurve: ValidationScore;
  wfPooledFull: ValidationScore;
  wfOffsetsShrunk: ValidationScore;
  wfOffsetsFull: ValidationScore;
  wfN: number;
};

export function validate(comps: Protocol[]): Validation {
  // Leave-one-out, five variants.
  const looFlatPreds: number[] = [];
  const looCurvePreds: number[] = [];
  const looGrowthPreds: number[] = [];
  const looAgePreds: number[] = [];
  const looFullPreds: number[] = [];
  const actuals: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const held = comps[i];
    const rest = comps.filter((_, j) => j !== i);
    const fit = olsFit(rest);
    const curve = curveValue(fit, held.tvl_usd);
    const flat = held.tvl_usd * medianOf(rest.map((p) => (p.mcap_usd as number) / p.tvl_usd));
    looFlatPreds.push(flat);
    looCurvePreds.push(curve);
    looGrowthPreds.push(curve * growthFactor(held));
    looAgePreds.push(curve * ageFactor(held));
    looFullPreds.push(curve * growthFactor(held) * ageFactor(held));
    actuals.push(held.mcap_usd as number);
  }

  // Blind split: train on protocols listed before 2024-02-18, test the rest.
  const cutoff = Date.parse("2024-02-18T00:00:00Z");
  const dated = comps.filter((p) => p.listed_at !== null);
  const train = dated.filter((p) => Date.parse(p.listed_at + "T00:00:00Z") < cutoff);
  const test = dated.filter((p) => Date.parse(p.listed_at + "T00:00:00Z") >= cutoff);
  const blindFit = olsFit(train);
  const blindPreds = test.map((p) => curveValue(blindFit, p.tvl_usd));
  const blindActuals = test.map((p) => p.mcap_usd as number);

  // Walk-forward: dated comps sorted by listing date, five groups of 19.
  const sorted = [...dated].sort((a, b) => (a.listed_at as string) < (b.listed_at as string) ? -1 : 1);
  const groups: Protocol[][] = [];
  for (let i = 0; i < sorted.length; i += 19) groups.push(sorted.slice(i, i + 19));
  const wfFolds: { fold: number; medianMiss: number; in2x: number }[] = [];
  const pooledCurvePreds: number[] = [];
  const pooledFullPreds: number[] = [];
  const pooledOffShrunkPreds: number[] = [];
  const pooledOffFullPreds: number[] = [];
  const pooledActuals: number[] = [];
  for (let k = 2; k <= 4; k++) {
    const trainGroups = groups.slice(0, k).flat();
    const testGroup = groups[k];
    const fit = olsFit(trainGroups);
    const off = offsetsFrom(trainGroups, fit);
    const foldPreds = testGroup.map((p) => curveValue(fit, p.tvl_usd));
    const foldActuals = testGroup.map((p) => p.mcap_usd as number);
    const foldScore = scorePredictions(foldPreds, foldActuals);
    wfFolds.push({ fold: k, medianMiss: foldScore.medianMiss, in2x: foldScore.in2x });
    for (const p of testGroup) {
      const curve = curveValue(fit, p.tvl_usd);
      const o = off.get(p.category ?? "(no category)") ?? 1;
      pooledCurvePreds.push(curve);
      pooledFullPreds.push(curve * growthFactor(p) * ageFactor(p));
      pooledOffShrunkPreds.push(curve * o);
      pooledOffFullPreds.push(curve * growthFactor(p) * ageFactor(p) * o);
      pooledActuals.push(p.mcap_usd as number);
    }
  }

  return {
    looFlat: scorePredictions(looFlatPreds, actuals),
    looCurve: scorePredictions(looCurvePreds, actuals),
    looGrowth: scorePredictions(looGrowthPreds, actuals),
    looAge: scorePredictions(looAgePreds, actuals),
    looFull: scorePredictions(looFullPreds, actuals),
    blind: scorePredictions(blindPreds, blindActuals),
    blindTrain: train.length,
    blindTest: test.length,
    wfFolds,
    wfPooledCurve: scorePredictions(pooledCurvePreds, pooledActuals),
    wfPooledFull: scorePredictions(pooledFullPreds, pooledActuals),
    wfOffsetsShrunk: scorePredictions(pooledOffShrunkPreds, pooledActuals),
    wfOffsetsFull: scorePredictions(pooledOffFullPreds, pooledActuals),
    wfN: pooledActuals.length,
  };
}

/** The four nearest traded comparables for a board row: the closest one in
 *  its own category first (when one exists), then the three closest by
 *  |log10 TVL − log10 row TVL|. */
export type NearestComp = {
  slug: string;
  name: string;
  category: string | null;
  tvlUsd: number;
  mcapUsd: number;
  multiple: number;
  curveSays: number;
  sameCategory: boolean;
};

export function nearestComps(
  row: Protocol,
  comps: Protocol[],
  fit: OlsFit,
): NearestComp[] {
  const byDistance = [...comps].sort(
    (a, b) =>
      Math.abs(Math.log10(a.tvl_usd) - Math.log10(row.tvl_usd)) -
      Math.abs(Math.log10(b.tvl_usd) - Math.log10(row.tvl_usd)),
  );
  const out: NearestComp[] = [];
  const sameCat = byDistance.filter((p) => p.category === row.category);
  if (sameCat.length > 0) {
    const p = sameCat[0];
    out.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvlUsd: p.tvl_usd,
      mcapUsd: p.mcap_usd as number,
      multiple: (p.mcap_usd as number) / p.tvl_usd,
      curveSays: curveValue(fit, p.tvl_usd),
      sameCategory: true,
    });
  }
  for (const p of byDistance) {
    if (out.length >= 4) break;
    if (out.some((o) => o.slug === p.slug)) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvlUsd: p.tvl_usd,
      mcapUsd: p.mcap_usd as number,
      multiple: (p.mcap_usd as number) / p.tvl_usd,
      curveSays: curveValue(fit, p.tvl_usd),
      sameCategory: false,
    });
  }
  return out;
}
