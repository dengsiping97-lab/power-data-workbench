const fs = require("fs");
const path = require("path");
const vm = require("vm");

const siteRoot = path.resolve(__dirname, "..");
const snapshotPath = path.join(siteRoot, "assets", "workbench-data.js");

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(snapshotPath, "utf8"), context, { filename: snapshotPath });
const data = context.window.WORKBENCH_DATA;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

assert(data.updatedAt === "2026-07-21", "price snapshot updatedAt mismatch");
assert(data.freshness?.spotWeekly === "2026-07-12", "spot freshness mismatch");
assert(data.freshness?.dayAheadDaily === "2026-07-18", "day-ahead data regressed");
assert(data.spotWeeklyLatest?.length === 31, "latest realtime province count mismatch");

const latestByProvince = Object.fromEntries(data.spotWeeklyLatest.map((row) => [row.province, row]));
[
  ["上海", 470],
  ["河南", 451],
  ["湖北", 225],
  ["湖南", 14]
].forEach(([province, value]) => {
  assert(latestByProvince[province]?.spotAvg === value, `${province} latest realtime mismatch`);
});

const week629 = data.spotWeeklyHistory.filter((row) => row.weekStart === "2026-06-29");
const week706 = data.spotWeeklyHistory.filter((row) => row.weekStart === "2026-07-06");
assert(week629.length === 31, "2026-06-29 realtime week incomplete");
assert(week706.length === 31, "2026-07-06 realtime week incomplete");
assert(
  data.dayAheadDailyHistory.reduce((latest, row) => row.date > latest ? row.date : latest, "") === "2026-07-18",
  "day-ahead history latest date mismatch"
);
assert(Array.isArray(data.hydroWeeklyLatest) && data.hydroWeeklyLatest.length > 0, "existing hydro snapshot fields were not preserved");

const indexHtml = fs.readFileSync(path.join(siteRoot, "index.html"), "utf8");
const priceHtml = fs.readFileSync(path.join(siteRoot, "price.html"), "utf8");
assert(indexHtml.includes('id="weekly-brief-title"'), "homepage weekly brief missing");
assert(indexHtml.includes('id="watch-price"'), "homepage price watch missing");
assert(indexHtml.includes('id="metric-spot">287'), "homepage price fallback mismatch");
assert(indexHtml.includes("workbench-data.js?v=20260720-price-1"), "homepage cache version mismatch");
assert(priceHtml.includes("workbench-data.js?v=20260720-price-1"), "price page cache version mismatch");

const latestSpotAverage = data.spotWeeklyLatest.reduce((sum, row) => sum + row.spotAvg, 0) / data.spotWeeklyLatest.length;
console.log("Price release verification passed", {
  updatedAt: data.updatedAt,
  spotWeekly: data.freshness.spotWeekly,
  dayAheadDaily: data.freshness.dayAheadDaily,
  latestProvinces: data.spotWeeklyLatest.length,
  week629: week629.length,
  week706: week706.length,
  latestSpotAverage: Number(latestSpotAverage.toFixed(1)),
  dayAheadLatestRows: data.dayAheadDailyLatest.length,
  hydroLatestRows: data.hydroWeeklyLatest.length
});
