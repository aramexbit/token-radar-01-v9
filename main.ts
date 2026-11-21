// Token Radar — entry point.
//
// Reads the snapshot, prices every pre-token protocol off the snapshot's
// own traded comparables, writes the ranked board, the dashboard's data,
// and the dossier. Run with `node main.ts` from the repository root; the
// snapshot is read from /input when it is mounted, otherwise from the
// repository's own input/ directory.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDossier } from "./vendor/makefun-board.ts";
import {
  ageFactor,
  boardProtocols,
  buildBoard,
  categoryOffsets,
  curveValue,
  growthFactor,
  loadSnapshot,
  nearestComps,
  olsFit,
  setAside,
  tokenOdds,
  tradedComps,
  validate,
  AS_OF,
  type Protocol,
} from "./lib/model.ts";
import { depositMidpoint, farmSteps, gasDisplay, primaryChain } from "./lib/plan.ts";
import { bootstrapBands, rowEconomics } from "./lib/netting.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

function snapshotPath(): string {
  const mounted = "/input/snapshot.json";
  if (existsSync(mounted)) return mounted;
  return join(ROOT, "input", "snapshot.json");
}

function outputDir(): string {
  if (existsSync("/output")) return "/output";
  return join(ROOT, "out");
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function copyTree(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src)) {
    const from = join(src, entry);
    const to = join(dst, entry);
    if (statSync(from).isDirectory()) copyTree(from, to);
    else copyFileSync(from, to);
  }
}

function money(v: number): number {
  return Math.round(v);
}

const snapPath = snapshotPath();
const snap = loadSnapshot(snapPath);
const snapshotSha = sha256File(snapPath);

const comps = tradedComps(snap.protocols);
const fit = olsFit(comps);
const rawFit = olsFit(snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0));

const { rows } = buildBoard(snap.protocols, fit);
const boardRows = rows.map((r, i) => ({
  slug: r.protocol.slug,
  name: r.protocol.name,
  rank: i + 1,
  implied_value_usd: r.implied,
  farm_steps: farmSteps(r.protocol),
}));
const board = { as_of: AS_OF, rows: boardRows };
const boardText = JSON.stringify(board, null, 2) + "\n";
const boardSha = sha256Text(boardText);

const aside = setAside(snap.protocols);
const odds = tokenOdds(snap.protocols);
const validation = validate(comps);
const offsets = categoryOffsets(comps, fit);
const bands = bootstrapBands(rows, comps, fit);
const impliedDesc = rows.map((r) => r.implied).sort((a, b) => b - a);

const watchlist = snap.watchlist ?? [];
const watchlistCovered = watchlist.filter((slug) =>
  boardRows.some((r) => r.slug === slug),
).length;

const categoryCounts = new Map<string, number>();
for (const r of rows) {
  const cat = r.protocol.category ?? "(no category)";
  categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
}
const categories = [...categoryCounts.entries()]
  .map(([category, count]) => ({ category, count }))
  .sort((a, b) => b.count - a.count || (a.category < b.category ? -1 : 1));

const asideGroups = new Map<string, number>();
for (const s of aside) {
  const key = s.reason === "category" ? s.detail : s.reason;
  asideGroups.set(key, (asideGroups.get(key) ?? 0) + 1);
}
const asideSummary = [...asideGroups.entries()]
  .map(([group, count]) => ({ group, count }))
  .sort((a, b) => b.count - a.count);

function decomposition(p: Protocol) {
  const curve = curveValue(fit, p.tvl_usd);
  const growth = growthFactor(p);
  const age = ageFactor(p);
  return {
    curve: money(curve),
    growth,
    afterGrowth: money(curve * growth),
    age,
    implied: money(Math.min(curve * growth * age, 10 * p.tvl_usd)),
    cap: 10 * p.tvl_usd,
    rawCurve128: money(curveValue(rawFit, p.tvl_usd)),
  };
}

const dataRows = rows.map((r, i) => {
  const p = r.protocol;
  const econ = rowEconomics(r, bands[i], impliedDesc);
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    rank: i + 1,
    implied: r.implied,
    tvl: p.tvl_usd,
    change7d: p.change_7d,
    listedAt: p.listed_at,
    ageDays: p.listed_at === null
      ? null
      : Math.round(
        (Date.parse(AS_OF + "T00:00:00Z") - Date.parse(p.listed_at + "T00:00:00Z")) / 86400000,
      ),
    chains: p.chains,
    primaryChain: primaryChain(p),
    gas: gasDisplay(p),
    geckoId: p.gecko_id,
    symbol: p.symbol,
    hasToken: p.symbol !== null,
    farmSteps: boardRows[i].farm_steps,
    bandLow: money(econ.bandLow),
    bandHigh: money(econ.bandHigh),
    deposit: econ.deposit,
    gasCost: econ.gas,
    gasTx: econ.gasTx,
    fees: econ.fees,
    expected: econ.expected,
    net: econ.net,
    netPerHour: econ.netPerHour,
    breakEven: money(econ.breakEven),
    rankLow: econ.rankLow,
    rankHigh: econ.rankHigh,
    verdict: econ.verdict,
    decomposition: decomposition(p),
    nearestComps: nearestComps(p, comps, fit).map((c) => ({
      slug: c.slug,
      name: c.name,
      tvl: c.tvlUsd,
      mcap: c.mcapUsd,
      multiple: c.multiple,
      curveSays: money(c.curveSays),
      sameCategory: c.sameCategory,
    })),
  };
});

const verdictCounts = { farm: 0, thin: 0, skip: 0 };
for (const r of dataRows) verdictCounts[r.verdict]++;
const bestNetPerHour = Math.max(...dataRows.map((r) => r.netPerHour));

const data = {
  meta: {
    asOf: AS_OF,
    source: snap.source,
    floorUsd: snap.floor_usd,
    snapshotSha,
    boardSha,
    slope: fit.slope,
    intercept: fit.intercept,
    r2: fit.r2,
    comps: comps.length,
    rawComps: snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0).length,
    protocols: snap.protocols.length,
    tokened: snap.protocols.filter((p) => p.symbol !== null).length,
    preToken: snap.protocols.filter((p) => p.symbol === null).length,
    boardRows: rows.length,
    setAside: aside.length,
    watchlist: watchlist.length,
    watchlistCovered,
    topImplied: rows[0].implied,
    bestNetPerHour,
    verdictCounts,
  },
  odds,
  categories,
  asideSummary,
  validation,
  offsets,
  scatter: comps.map((p) => ({
    slug: p.slug,
    name: p.name,
    tvl: p.tvl_usd,
    mcap: p.mcap_usd as number,
  })),
  rows: dataRows,
};

const out = outputDir();
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "board.json"), boardText);
writeFileSync(join(out, "data.js"), `window.RADAR = ${JSON.stringify(data)};\n`);
copyTree(join(ROOT, "dashboard"), join(out, "dashboard"));
copyTree(join(ROOT, "screenshots"), join(out, "screenshots"));
const dossier = buildDossier(out, { text_max_bytes: 65536 });
writeFileSync(join(out, "dossier.json"), dossier);

console.log(`board: ${rows.length} rows, sha ${boardSha}`);
console.log(`comps: ${comps.length} (raw ${data.meta.rawComps}), slope ${fit.slope.toFixed(6)}, intercept ${fit.intercept.toFixed(6)}, R2 ${fit.r2.toFixed(3)}`);
console.log(`set aside: ${aside.length}, watchlist ${watchlistCovered}/${watchlist.length}`);
console.log(`verdicts: farm ${verdictCounts.farm}, thin ${verdictCounts.thin}, skip ${verdictCounts.skip}`);
console.log(`dossier: ${dossier.length} bytes`);
console.log(`deposit midpoint check: Sentora $${depositMidpoint(rows[0].protocol)}`);
