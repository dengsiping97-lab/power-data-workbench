const fs = require("fs");
const path = require("path");
const vm = require("vm");

const siteRoot = path.resolve(__dirname, "..");
const vaultRoot = path.resolve(siteRoot, "..", "..");
const utilizationPath = path.join(
  vaultRoot,
  "wiki", "行业", "公用事业", "数据库", "消纳数据", "data", "新能源利用率_月度主表.csv"
);
const nationalPath = path.join(
  vaultRoot,
  "wiki", "行业", "公用事业", "数据库", "消纳数据", "data", "新能源消纳_全国月度.csv"
);
const workbenchPath = path.join(siteRoot, "assets", "workbench-data.js");
const outputPath = path.join(siteRoot, "assets", "consumption-data.js");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
  const headers = rows.shift().map((value) => value.replace(/^\uFEFF/, ""));
  return rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function loadWindowValue(file, key) {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  if (!context.window[key]) throw new Error(`Missing window.${key} in ${file}`);
  return context.window[key];
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function shiftYears(dateText, years) {
  const value = new Date(`${String(dateText).slice(0, 10)}T00:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() + years);
  return value.toISOString().slice(0, 10);
}

function latestPeriod(rows, predicate) {
  return rows.filter(predicate).map((row) => row.period).filter(Boolean).sort().at(-1) || null;
}

const workbench = loadWindowValue(workbenchPath, "WORKBENCH_DATA");
const asOf = String(workbench.updatedAt || new Date().toISOString().slice(0, 10)).slice(0, 10);
const cutoff = shiftYears(asOf, -2);
const cutoffMonth = cutoff.slice(0, 7);

const utilizationSource = parseCsv(fs.readFileSync(utilizationPath, "utf8"));
const nationalSource = parseCsv(fs.readFileSync(nationalPath, "utf8"));

const utilization = utilizationSource
  .filter((row) => row.period >= cutoffMonth)
  .map((row) => ({
    month: row.period,
    region: row.region,
    windMonthRate: numberOrNull(row.wind_month_pct),
    windCumulativeRate: numberOrNull(row.wind_cumulative_pct),
    solarMonthRate: numberOrNull(row.solar_month_pct),
    solarCumulativeRate: numberOrNull(row.solar_cumulative_pct)
  }))
  .sort((a, b) => a.month.localeCompare(b.month) || a.region.localeCompare(b.region, "zh-Hans-CN"));

const operationsByMonth = new Map();
for (const row of nationalSource.filter((item) => item.period >= cutoffMonth)) {
  const month = row.period;
  const energy = row.energy_type === "风电" ? "wind" : row.energy_type === "光伏" ? "solar" : null;
  if (!energy) continue;
  const target = operationsByMonth.get(month) || { month };
  const value = numberOrNull(row.value);
  if (row.indicator === "generation" && row.period_type === "单月") target[`${energy}GenerationMonth`] = value;
  if (row.indicator === "generation" && row.period_type === "累计") target[`${energy}GenerationCumulative`] = value;
  if (row.indicator === "installed_capacity" && row.period_type === "累计") target[`${energy}Capacity`] = value;
  if (row.indicator === "utilization_hours" && row.period_type === "累计") target[`${energy}UtilizationHours`] = value;
  operationsByMonth.set(month, target);
}
const nationalOperations = [...operationsByMonth.values()].sort((a, b) => a.month.localeCompare(b.month));

const comparisonYears = [2024, 2025, 2026];
const utilizationHoursComparison = comparisonYears.map((year) => {
  const result = { year, wind: Array(12).fill(null), solar: Array(12).fill(null) };
  nationalSource
    .filter((row) => row.indicator === "utilization_hours" && Number(row.period.slice(0, 4)) === year)
    .forEach((row) => {
      const energy = row.energy_type === "风电" ? "wind" : row.energy_type === "光伏" ? "solar" : null;
      const month = Number(row.period.slice(5, 7));
      if (energy && month >= 1 && month <= 12) result[energy][month - 1] = numberOrNull(row.value);
    });
  return result;
});

const monthRatePeriod = latestPeriod(utilizationSource, (row) => row.wind_month_pct !== "" || row.solar_month_pct !== "");
const cumulativeRatePeriod = latestPeriod(utilizationSource, (row) => row.wind_cumulative_pct !== "" || row.solar_cumulative_pct !== "");
const generationPeriod = latestPeriod(nationalSource, (row) => row.indicator === "generation");
const capacityPeriod = latestPeriod(nationalSource, (row) => row.indicator === "installed_capacity");
const utilizationHoursPeriod = latestPeriod(nationalSource, (row) => row.indicator === "utilization_hours");

const regionCount = new Set(utilization.map((row) => row.region)).size;
const latestMonthCoverage = utilization.filter((row) => row.month === monthRatePeriod);
const latestCumulativeCoverage = utilization.filter((row) => row.month === cumulativeRatePeriod);

const output = {
  updatedAt: asOf,
  publicWindow: { label: "滚动近两年", cutoff, asOf },
  freshness: {
    monthRate: monthRatePeriod,
    cumulativeRate: cumulativeRatePeriod,
    generation: generationPeriod,
    capacity: capacityPeriod,
    utilizationHours: utilizationHoursPeriod
  },
  coverage: {
    regionCount,
    monthRate: {
      month: monthRatePeriod,
      wind: latestMonthCoverage.filter((row) => row.windMonthRate !== null).length,
      solar: latestMonthCoverage.filter((row) => row.solarMonthRate !== null).length
    },
    cumulativeRate: {
      month: cumulativeRatePeriod,
      wind: latestCumulativeCoverage.filter((row) => row.windCumulativeRate !== null).length,
      solar: latestCumulativeCoverage.filter((row) => row.solarCumulativeRate !== null).length
    }
  },
  sources: {
    utilization: "iFinD 优先，Wind 与官方整理值仅用于历史补缺和复核",
    generation: "国家统计局规模以上工业发电量口径，经金融数据库整理",
    capacity: "全国全口径累计装机，经金融数据库整理",
    utilizationHours: "全国累计利用小时，经金融数据库整理"
  },
  datasets: [
    { module: "新能源消纳", name: "新能源利用率_月度主表.csv", grain: "区域-月", status: "已接入消纳页" },
    { module: "新能源消纳", name: "新能源消纳_全国月度.csv", grain: "全国-电源-月-指标", status: "已接入消纳页" }
  ],
  nationalUtilization: utilization.filter((row) => row.region === "全国"),
  regionalUtilization: utilization,
  nationalOperations,
  utilizationHoursComparison
};

const serialized = JSON.stringify(output, null, 2);
for (const forbidden of ["source_url_or_path", "D:\\workspace", "C:\\Users", "指标ID"]) {
  if (serialized.includes(forbidden)) throw new Error(`Private field leaked into public consumption data: ${forbidden}`);
}

fs.writeFileSync(outputPath, `window.CONSUMPTION_DATA = ${serialized};\n`, "utf8");
console.log(JSON.stringify({
  output: path.relative(siteRoot, outputPath),
  publicWindow: output.publicWindow,
  freshness: output.freshness,
  coverage: output.coverage,
  rows: {
    nationalUtilization: output.nationalUtilization.length,
    regionalUtilization: output.regionalUtilization.length,
    nationalOperations: output.nationalOperations.length,
    utilizationHoursComparison: output.utilizationHoursComparison.length
  }
}, null, 2));
