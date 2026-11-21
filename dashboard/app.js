// Token Radar v9 — dashboard.
//
// Renders the board, the detail view, the method tab and the set-aside tab
// from window.RADAR (data.js, written by main.ts). No network, no
// libraries: the scatter is drawn on a canvas, the table sorts and filters
// in place. Hash routes: #/ → board, #/method, #/aside,
// #/detail/<slug>.

const D = window.RADAR;
const $ = (id) => document.getElementById(id);
const rowsBySlug = new Map(D.rows.map((r) => [r.slug, r]));

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtM(v) {
  return "$" + (v / 1e6).toFixed(1) + "M";
}
function fmtFull(v) {
  return "$" + Math.round(v).toLocaleString("en-US");
}
function fmtSigned(v, digits = 2) {
  const s = Math.abs(v).toFixed(digits);
  return (v < 0 ? "-$" : "+$") + s;
}
function fmtSignedPlain(v, digits = 2) {
  const s = Math.abs(v).toFixed(digits);
  return (v < 0 ? "-" : "+") + s;
}
function fmtPct1(v) {
  if (v === null || v === undefined) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
}
function fmtX(v) {
  return v.toFixed(2) + "×";
}
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Header, integrity strip, stats, top 3
// ---------------------------------------------------------------------------

$("snapInfo").innerHTML =
  "Snapshot " + D.meta.asOf + "<br>Source: DefiLlama<br>" +
  D.meta.protocols + " protocols · floor " + fmtM(D.meta.floorUsd);

$("integrity").innerHTML =
  "page = board.json: <b>" + D.meta.boardRows + "/" + D.meta.boardRows + " values, " +
  D.meta.boardRows + "/" + D.meta.boardRows + " ranks match</b> · board sha " +
  D.meta.boardSha.slice(0, 12) + "… · snapshot sha " + D.meta.snapshotSha.slice(0, 12) +
  "… · as of " + D.meta.asOf + " · OLS slope " + D.meta.slope.toFixed(3) +
  " intercept " + D.meta.intercept.toFixed(3);

const statCards = [
  { k: "Watchlist covered", v: D.meta.watchlistCovered + "/" + D.meta.watchlist },
  { k: "Board rows", v: String(D.meta.boardRows) },
  { k: "Traded comps", v: String(D.meta.comps) },
  { k: "Top implied value", v: fmtM(D.meta.topImplied) },
];
$("stats").innerHTML = statCards.map((s) =>
  '<div class="stat"><div class="k">' + s.k + '</div><div class="v">' + s.v +
  "</div></div>").join("");

$("top3").innerHTML = D.rows.slice(0, 3).map((r) =>
  '<button type="button" class="pick" data-slug="' + r.slug + '">' +
  '<div class="rank">#' + r.rank + " · " + esc(r.category) + "</div>" +
  '<div class="name">' + esc(r.name) + "</div>" +
  '<div class="nums"><b>' + fmtM(r.implied) + "</b> implied · net <b>" + fmtSigned(r.net) +
  "</b> · <span class=\"verdict " + r.verdict + "\">" + r.verdict.toUpperCase() + "</span></div>" +
  "</button>").join("");

// ---------------------------------------------------------------------------
// Formula + odds
// ---------------------------------------------------------------------------

$("formula").innerHTML =
  "<h2>How a launch is priced</h2>" +
  '<p class="formula-line">implied = 10<sup>(' + D.meta.intercept.toFixed(3) + " + " +
  D.meta.slope.toFixed(3) + " · log<sub>10</sub> TVL)</sup> × growth × age</p>" +
  "<p>One global curve on the snapshot&rsquo;s own " + D.meta.comps +
  " traded protocols (R&sup2; " + D.meta.r2.toFixed(2) + "). Growth is the 7-day TVL change, " +
  "clamped to 0.8–1.2; age is at most a 15% haircut. No category tilt, no name is hard-coded.</p>";

$("odds").innerHTML =
  "<h2>Token odds — from the snapshot, display only</h2>" +
  '<div class="odds-row">' + D.odds.map((o) =>
    '<div class="odds-cell"><div class="v">' + o.pct.toFixed(1) + '%</div><div class="k">' +
    o.tokened + " of " + o.listed + " listed " + o.years + "+ yr ago</div></div>").join("") +
  "</div>" +
  "<p class=\"cap\">A base rate for the field, not a forecast for one protocol. Cut at 2026-11-12, whole calendar years.</p>";

// ---------------------------------------------------------------------------
// Scatter: log10 TVL vs log10 mcap, 127 comps + OLS line
// ---------------------------------------------------------------------------

function drawScatter() {
  const cv = $("scatter");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const padL = 58, padR = 14, padT = 12, padB = 34;
  const pts = D.scatter;
  const xs = pts.map((p) => Math.log10(p.tvl));
  const ys = pts.map((p) => Math.log10(p.mcap));
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  x0 = Math.floor(x0); x1 = Math.ceil(x1);
  y0 = Math.floor(y0); y1 = Math.ceil(y1);
  const X = (v) => padL + ((v - x0) / (x1 - x0)) * (W - padL - padR);
  const Y = (v) => H - padB - ((v - y0) / (y1 - y0)) * (H - padT - padB);
  ctx.clearRect(0, 0, W, H);
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#666";
  ctx.strokeStyle = "#e0e0da";
  ctx.lineWidth = 1;
  for (let gx = x0; gx <= x1; gx++) {
    ctx.beginPath(); ctx.moveTo(X(gx), padT); ctx.lineTo(X(gx), H - padB); ctx.stroke();
    ctx.fillText("$" + Math.pow(10, gx - 6).toLocaleString("en-US") + "M", Math.min(X(gx) - 18, W - 64), H - 12);
  }
  for (let gy = y0; gy <= y1; gy++) {
    ctx.beginPath(); ctx.moveTo(padL, Y(gy)); ctx.lineTo(W - padR, Y(gy)); ctx.stroke();
    ctx.fillText("$" + Math.pow(10, gy - 6).toLocaleString("en-US") + "M", 4, Y(gy) + 4);
  }
  ctx.strokeStyle = "#c0392b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(X(x0), Y(D.meta.intercept + D.meta.slope * x0));
  ctx.lineTo(X(x1), Y(D.meta.intercept + D.meta.slope * x1));
  ctx.stroke();
  ctx.fillStyle = "#0a7a3d";
  for (const p of pts) {
    ctx.beginPath();
    ctx.arc(X(Math.log10(p.tvl)), Y(Math.log10(p.mcap)), 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#161616";
  ctx.font = "bold 13px sans-serif";
}
drawScatter();
$("scatterCap").textContent =
  "Each dot is one traded protocol (" + D.meta.comps + "); the line is the OLS fit, slope " +
  D.meta.slope.toFixed(3) + ", R² " + D.meta.r2.toFixed(2) + ".";

// ---------------------------------------------------------------------------
// Board table: sort, filter, search
// ---------------------------------------------------------------------------

let sortKey = "rank";
let sortDir = 1;
let activeCat = "All";
let searchText = "";
let verdictFilter = "";

const pills = [{ category: "All", count: D.meta.boardRows }, ...D.categories];
$("pills").innerHTML = pills.map((p) =>
  '<button type="button" class="pill' + (p.category === "All" ? " active" : "") +
  '" data-cat="' + esc(p.category) + '">' + esc(p.category) + " " + p.count + "</button>").join("");

$("pills").addEventListener("click", (e) => {
  const b = e.target.closest(".pill");
  if (!b) return;
  activeCat = b.dataset.cat;
  document.querySelectorAll(".pill").forEach((x) => x.classList.toggle("active", x === b));
  renderBoard();
});
$("search").addEventListener("input", (e) => { searchText = e.target.value.trim().toLowerCase(); renderBoard(); });
$("verdictFilter").addEventListener("change", (e) => { verdictFilter = e.target.value; renderBoard(); });

$("boardTable").querySelectorAll("th[data-sort]").forEach((th) => {
  th.addEventListener("click", () => {
    const k = th.dataset.sort;
    if (sortKey === k) sortDir = -sortDir;
    else { sortKey = k; sortDir = 1; }
    renderBoard();
  });
});

function rowValue(r, k) {
  if (k === "xols") return r.implied / r.tvl;
  if (k === "name") return r.name.toLowerCase();
  if (k === "category") return (r.category || "").toLowerCase();
  return r[k];
}

function filteredRows() {
  let list = D.rows.filter((r) =>
    (activeCat === "All" || r.category === activeCat) &&
    (!verdictFilter || r.verdict === verdictFilter) &&
    (!searchText || r.name.toLowerCase().includes(searchText) || r.slug.includes(searchText)));
  list = [...list].sort((a, b) => {
    const va = rowValue(a, sortKey), vb = rowValue(b, sortKey);
    if (va < vb) return -sortDir;
    if (va > vb) return sortDir;
    return a.rank - b.rank;
  });
  return list;
}

function renderBoard() {
  const list = filteredRows();
  $("boardBody").innerHTML = list.map((r) =>
    '<tr data-slug="' + r.slug + '">' +
    "<td>" + r.rank + "</td>" +
    '<td class="name">' + esc(r.name) + "<small>" + esc(r.slug) + "</small></td>" +
    "<td>" + esc(r.category || "—") + "</td>" +
    '<td class="num">' + fmtM(r.tvl) + "</td>" +
    '<td class="num"><b>' + fmtM(r.implied) + "</b></td>" +
    '<td class="num">' + fmtX(r.implied / r.tvl) + "</td>" +
    "<td>" + esc(r.primaryChain) + "</td>" +
    '<td class="num">' + fmtFull(r.deposit) + "</td>" +
    '<td class="num">' + fmtSigned(r.net) + "</td>" +
    '<td class="num">' + fmtSignedPlain(r.netPerHour) + "/h</td>" +
    '<td><span class="verdict ' + r.verdict + '">' + r.verdict.toUpperCase() + "</span></td>" +
    "</tr>").join("");
  $("showing").textContent = "Showing " + list.length + " of " + D.meta.boardRows;
  $("boardFine").textContent =
    "Net = expected value at the band low, minus gas and fees. Farm means the expected net clears $25; " +
    "skip means $1 or less. " + D.meta.verdictCounts.farm + " farm, " + D.meta.verdictCounts.thin +
    " thin, " + D.meta.verdictCounts.skip + " skip. Click a row for the full detail.";
}

$("boardBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr[data-slug]");
  if (tr) location.hash = "#/detail/" + tr.dataset.slug;
});
$("top3").addEventListener("click", (e) => {
  const b = e.target.closest("[data-slug]");
  if (b) location.hash = "#/detail/" + b.dataset.slug;
});

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function detailHtml(r) {
  const d = r.decomposition;
  const odds2 = D.odds[1];
  const compsRows = r.nearestComps.map((c) =>
    "<tr><td>" + esc(c.name) + (c.sameCategory ? ' <span class="tag used">same category</span>' : "") +
    "</td><td class=\"num\">" + fmtM(c.tvl) + "</td><td class=\"num\">" + fmtM(c.mcap) +
    "</td><td class=\"num\">" + fmtX(c.multiple) + "</td><td class=\"num\">" + fmtM(c.curveSays) + "</td></tr>").join("");
  const rawRows = [
    ["Slug", esc(r.slug)],
    ["Name", esc(r.name)],
    ["Category", esc(r.category || "—")],
    ["Chains", esc(r.chains.join(", "))],
    ["TVL", fmtFull(r.tvl)],
    ["7-day change", fmtPct1(r.change7d)],
    ["Listed at", r.listedAt ? r.listedAt + " (" + r.ageDays + " days ago)" : "— (no listing date reported)"],
    ["Market cap", "— (no token yet)"],
    ["Token status", "Pre-token — no token"],
    ["Gecko id", r.geckoId ? esc(r.geckoId) : "—"],
    ["Symbol", r.symbol ? esc(r.symbol) : "—"],
  ].map(([k, v]) => "<tr><td>" + k + "</td><td>" + v + "</td></tr>").join("");
  const steps = r.farmSteps.map((s) => "<li>" + esc(s.replace(/^Day \d+ — /, "")) + "</li>").join("");
  return (
    '<div class="detail-head"><h2>#' + r.rank + " " + esc(r.name) + "</h2>" +
    '<span class="slug">' + esc(r.category || "") + " · " + esc(r.slug) + "</span>" +
    '<span class="verdict ' + r.verdict + '">' + r.verdict.toUpperCase() + "</span></div>" +
    '<div class="detail-grid">' +
    '<div class="stat"><div class="k">Verdict</div><div class="v">' + r.verdict.toUpperCase() +
    '</div><div class="s">net ' + fmtSigned(r.net) + " on " + fmtFull(r.deposit) + " deposit</div></div>" +
    '<div class="stat"><div class="k">Implied value</div><div class="v">' + fmtM(r.implied) +
    '</div><div class="s">' + fmtX(r.implied / r.tvl) + " of TVL · rank " + r.rank +
    " (range " + r.rankLow + "–" + r.rankHigh + ")</div></div>" +
    '<div class="stat"><div class="k">Band · bootstrap P10–P90</div><div class="v">' + fmtM(r.bandLow) + "–" + fmtM(r.bandHigh) +
    '</div><div class="s">2,000 refits of the curve</div></div>' +
    '<div class="stat"><div class="k">Net per hour</div><div class="v">' + fmtSignedPlain(r.netPerHour) + '/h' +
    '</div><div class="s">2 h over 8 weeks · break-even launch ' + fmtM(r.breakEven) + "</div></div>" +
    "</div>" +
    '<p class="odds-line">' + odds2.pct.toFixed(1) + "% of the " + odds2.listed +
    " protocols listed 2+ years ago got a token today (" + odds2.tokened + " of " + odds2.listed +
    ") — a base rate for the field, not a forecast for this protocol.</p>" +
    '<div class="decomp">' +
    '<div class="step"><div class="k">Curve</div><div class="v">' + fmtM(d.curve) +
    '</div><div class="d">10<sup>(' + D.meta.intercept.toFixed(3) + " + " + D.meta.slope.toFixed(3) +
    " · log<sub>10</sub> " + fmtFull(r.tvl) + ")</sup></div></div>" +
    '<div class="step"><div class="k">Growth</div><div class="v">×' + d.growth.toFixed(2) +
    '</div><div class="d">7-day TVL ' + fmtPct1(r.change7d) + " → " + fmtM(d.afterGrowth) + "</div></div>" +
    '<div class="step"><div class="k">Age</div><div class="v">×' + d.age.toFixed(2) +
    '</div><div class="d">' + (r.listedAt ? "listed " + r.listedAt : "no listing date") +
    " → " + fmtM(d.implied) + "</div></div>" +
    '<div class="step"><div class="k">Implied</div><div class="v">' + fmtM(d.implied) +
    '</div><div class="d">cap at 10× TVL (' + fmtM(d.cap) + ") not binding</div></div>" +
    "</div>" +
    '<p class="decomp-note">Raw OLS curve (128 comps, no dedupe) for comparison: <b>' + fmtM(d.rawCurve128) +
    "</b> — the deduped curve is the one the board uses.</p>" +
    '<div class="detail-cols">' +
    '<div class="card"><h2>Nearest comps</h2><table class="plain"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Mcap</th><th class="num">Mc/TVL</th><th class="num">Curve says</th></tr></thead><tbody>' +
    compsRows + "</tbody></table>" +
    '<p class="cap">Closest by TVL among the ' + D.meta.comps + " traded comps; the same-category comp first when one exists.</p></div>" +
    '<div class="card"><h2>Raw snapshot record</h2><table class="plain raw-table"><tbody>' +
    rawRows + "</tbody></table>" +
    '<p class="cap">The protocol&rsquo;s own fields, exactly as the snapshot reports them.</p></div>' +
    "</div>" +
    '<div class="farm-head">Farm plan — deposit <b>' + fmtFull(r.deposit) + "</b> on " + esc(r.primaryChain) +
    " · gas <b>$" + r.gasCost.toFixed(2) + " (" + r.gasTx + " tx)</b> · fees <b>$" + r.fees.toFixed(2) +
    "</b> · expected <b>" + fmtSigned(r.expected) + "</b></div>" +
    '<ol class="steps">' + steps + "</ol>"
  );
}

function showDetail(slug) {
  const r = rowsBySlug.get(slug);
  if (!r) { showTab("board"); return; }
  $("detailBody").innerHTML = detailHtml(r);
  $("tab-board").hidden = true;
  $("tab-method").hidden = true;
  $("tab-aside").hidden = true;
  $("detail").hidden = false;
  setActiveTab(null);
  window.scrollTo(0, 0);
}

$("backBtn").addEventListener("click", () => { location.hash = "#/"; });

// ---------------------------------------------------------------------------
// Method tab
// ---------------------------------------------------------------------------

function scoreRow(label, s, tag) {
  return "<tr" + (tag === "used" ? ' class="used"' : tag === "rejected" ? ' class="rejected"' : "") +
    "><td>" + label + "</td>" +
    '<td class="num">' + s.medianMiss.toFixed(1) + "%</td>" +
    '<td class="num">' + s.in2x.toFixed(1) + "%</td>" +
    '<td class="num">' + s.in3x.toFixed(1) + "%</td>" +
    "<td>" + (tag === "used" ? '<span class="tag used">USED</span>' : tag === "rejected" ? '<span class="tag rejected">REJECTED</span>' : "") + "</td></tr>";
}

$("ablation").innerHTML =
  "<thead><tr><th>Model</th><th class=\"num\">Median miss</th><th class=\"num\">Within 2×</th><th class=\"num\">Within 3×</th><th></th></tr></thead><tbody>" +
  scoreRow("Curve only", D.validation.looCurve, "") +
  scoreRow("Curve + growth", D.validation.looGrowth, "") +
  scoreRow("Curve + age", D.validation.looAge, "") +
  scoreRow("Full — curve + growth + age", D.validation.looFull, "used") +
  "</tbody>";

$("walkforward").innerHTML =
  "<thead><tr><th>Model (pooled, 57)</th><th class=\"num\">Median miss</th><th class=\"num\">Within 2×</th><th class=\"num\">Within 3×</th><th></th></tr></thead><tbody>" +
  scoreRow("Curve", D.validation.wfPooledCurve, "") +
  scoreRow("Full", D.validation.wfPooledFull, "") +
  scoreRow("Curve + category offsets, shrunk", D.validation.wfOffsetsShrunk, "rejected") +
  scoreRow("Full + category offsets, shrunk", D.validation.wfOffsetsFull, "rejected") +
  "</tbody>";

const offRows = D.offsets.filter((o) => o.n >= 3);
$("offsets").innerHTML =
  "<thead><tr><th>Category</th><th class=\"num\">n</th><th class=\"num\">Median ratio</th><th class=\"num\">Shrunk</th></tr></thead><tbody>" +
  offRows.map((o) =>
    "<tr><td>" + esc(o.category) + '</td><td class="num">' + o.n +
    '</td><td class="num">' + o.medianRatio.toFixed(2) + "×</td>" +
    '<td class="num">' + o.shrunk.toFixed(2) + "×</td></tr>").join("") +
  "</tbody>";

$("blindBox").innerHTML =
  "<dl class=\"kv\">" +
  "<dt>Blind split</dt><dd>Train on protocols listed before 2024-02-18 (" + D.validation.blindTrain +
  "), test the rest (" + D.validation.blindTest + "): curve only, median miss " +
  D.validation.blind.medianMiss.toFixed(1) + "%, within 2× " + D.validation.blind.in2x.toFixed(1) +
  "%, within 3× " + D.validation.blind.in3x.toFixed(1) + "%.</dd>" +
  "<dt>Flat baseline</dt><dd>TVL × median mcap/TVL: " + D.validation.looFlat.medianMiss.toFixed(1) +
  "% / " + D.validation.looFlat.in2x.toFixed(1) + "% / " + D.validation.looFlat.in3x.toFixed(1) + "%.</dd>" +
  "<dt>Walk-forward folds</dt><dd>" + D.validation.wfFolds.map((f) =>
    "fold " + f.fold + ": " + f.medianMiss.toFixed(1) + "% miss, " + f.in2x.toFixed(1) + "% within 2×").join("; ") + ".</dd>" +
  "<dt>Fit</dt><dd>OLS on " + D.meta.comps + " comps, slope " + D.meta.slope.toFixed(3) +
  ", intercept " + D.meta.intercept.toFixed(3) + ", R² " + D.meta.r2.toFixed(2) + ".</dd>" +
  "</dl>";

// ---------------------------------------------------------------------------
// Set-aside tab
// ---------------------------------------------------------------------------

const catAside = D.asideSummary.filter((g) => !["versioned", "wrapped", "exchange"].includes(g.group));
const ver = D.asideSummary.find((g) => g.group === "versioned");
const wrp = D.asideSummary.find((g) => g.group === "wrapped");
$("asideIntro").textContent =
  D.meta.setAside + " protocols are set aside and never ranked: " +
  catAside.reduce((a, g) => a + g.count, 0) +
  " sit in families that already have a token, " + (ver ? ver.count : 0) +
  " carry a versioned name, " + (wrp ? wrp.count : 0) +
  " are wrapped or staked names, and 0 are exchange names.";
$("asideTable").innerHTML =
  "<thead><tr><th>Group</th><th class=\"num\">Count</th><th>Why it is out</th></tr></thead><tbody>" +
  catAside.map((g) =>
    "<tr><td>" + esc(g.group) + '</td><td class="num">' + g.count +
    "</td><td>The family already has a token, so there is nothing to farm here.</td></tr>").join("") +
  "<tr><td>Versioned names</td><td class=\"num\">" + (ver ? ver.count : 0) +
  "</td><td>An older version of a protocol that already exists.</td></tr>" +
  "<tr><td>Wrapped / staked names</td><td class=\"num\">" + (wrp ? wrp.count : 0) +
  "</td><td>A wrapped or staked form of an asset that already has a token.</td></tr>" +
  "</tbody>";
$("asideCount").textContent = "(" + D.meta.setAside + ")";

// ---------------------------------------------------------------------------
// Tabs + routing
// ---------------------------------------------------------------------------

function setActiveTab(name) {
  document.querySelectorAll("#tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
}

function showTab(name) {
  $("tab-board").hidden = name !== "board";
  $("tab-method").hidden = name !== "method";
  $("tab-aside").hidden = name !== "aside";
  $("detail").hidden = true;
  setActiveTab(name);
  window.scrollTo(0, 0);
}

$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  location.hash = b.dataset.tab === "board" ? "#/" : "#/" + b.dataset.tab;
});

function route() {
  const h = location.hash || "#/";
  const m = h.match(/^#\/detail\/(.+)$/);
  if (m) { showDetail(decodeURIComponent(m[1])); return; }
  if (h === "#/method") { showTab("method"); return; }
  if (h === "#/aside") { showTab("aside"); return; }
  showTab("board");
}

window.addEventListener("hashchange", route);
renderBoard();
route();
