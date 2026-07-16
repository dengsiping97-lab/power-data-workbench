const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const workbenchPath = path.join(root, "assets", "workbench-data.js");
const weatherHistoryPath = path.join(root, "assets", "weather-history-data.js");
const companyGenerationPath = path.join(root, "assets", "company-generation-data.js");

const readWindowValue = (file, key) => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  if (!context.window[key]) throw new Error(`Missing window.${key} in ${file}`);
  return context.window[key];
};

const shiftYears = (dateText, years) => {
  const value = new Date(`${String(dateText).slice(0, 10)}T00:00:00Z`);
  value.setUTCFullYear(value.getUTCFullYear() + years);
  return value.toISOString().slice(0, 10);
};

const monthKey = (value) => String(value || "").slice(0, 7);
const isoWeek = (value) => {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
};

const filterRows = (rows, field, cutoff, monthly = false) => (rows || []).filter((row) => {
  const value = monthly ? monthKey(row[field]) : String(row[field] || "").slice(0, 10);
  return value && value >= (monthly ? monthKey(cutoff) : cutoff);
});

const writeWindowValue = (file, key, value) => {
  fs.writeFileSync(file, `window.${key} = ${JSON.stringify(value, null, 4)};\n`, "utf8");
};

const workbench = readWindowValue(workbenchPath, "WORKBENCH_DATA");
const asOf = String(workbench.updatedAt || new Date().toISOString().slice(0, 10)).slice(0, 10);
const cutoff = shiftYears(asOf, -2);
const before = {};
const after = {};

const recordFilter = (key, field, monthly = false) => {
  before[key] = workbench[key]?.length || 0;
  workbench[key] = filterRows(workbench[key], field, cutoff, monthly);
  after[key] = workbench[key]?.length || 0;
};

const hydroLookup = new Map((workbench.hydroWeeklyHistory || []).map((row) => [
  `${row.station}|${Number(row.isoYear) - 1}|${row.isoWeek}`,
  Number(row.inflow)
]));
workbench.hydroWeeklyHistory = (workbench.hydroWeeklyHistory || []).map((row) => {
  if (row.inflowYoy !== null && row.inflowYoy !== undefined) return row;
  const prior = hydroLookup.get(`${row.station}|${row.isoYear}|${row.isoWeek}`);
  if (!prior || !Number(row.inflow)) return row;
  return { ...row, inflowYoy: Number(((Number(row.inflow) / prior - 1) * 100).toFixed(1)) };
});

const addMonthlyYoy = (key, valueField, outputField) => {
  const lookup = new Map((workbench[key] || []).map((row) => [`${row.province}|${monthKey(row.month)}`, Number(row[valueField]) ]));
  workbench[key] = (workbench[key] || []).map((row) => {
    const month = monthKey(row.month);
    const priorMonth = `${Number(month.slice(0, 4)) - 1}${month.slice(4)}`;
    const prior = lookup.get(`${row.province}|${priorMonth}`);
    return prior ? { ...row, [outputField]: Number(((Number(row[valueField]) / prior - 1) * 100).toFixed(1)) } : row;
  });
};
addMonthlyYoy("proxyPurchaseHistory", "proxyPrice", "proxyYoy");
addMonthlyYoy("systemFeeHistory", "total", "totalYoy");

recordFilter("hydroWeeklyHistory", "weekStart");
recordFilter("spotWeeklyHistory", "weekStart");
recordFilter("proxyPurchaseHistory", "month", true);
recordFilter("systemFeeHistory", "month", true);
recordFilter("powerConsumptionMonthly", "month", true);
recordFilter("powerGenerationMonthly", "month", true);
recordFilter("installedCapacityMonthly", "month", true);
recordFilter("installedCapacityAdditions", "month", true);
recordFilter("dayAheadDailyHistory", "date");
recordFilter("dayAheadWeeklyHistory", "weekStart");
workbench.publicWindow = { label: "滚动近两年", cutoff, asOf };
writeWindowValue(workbenchPath, "WORKBENCH_DATA", workbench);

const weatherHistory = readWindowValue(weatherHistoryPath, "WEATHER_HISTORY");
const climateBuckets = new Map();
weatherHistory.filter((row) => Number(String(row.weekStart).slice(0, 4)) <= Number(asOf.slice(0, 4)) - 1).forEach((row) => {
  const key = `${row.province}|${isoWeek(row.weekStart)}`;
  const bucket = climateBuckets.get(key) || [];
  if (Number.isFinite(Number(row.temperature))) bucket.push(Number(row.temperature));
  climateBuckets.set(key, bucket);
});
const publicWeatherHistory = filterRows(weatherHistory, "weekStart", cutoff).map((row) => {
  const bucket = climateBuckets.get(`${row.province}|${isoWeek(row.weekStart)}`) || [];
  const climateTemperature = row.climateTemperature ?? (bucket.length
    ? Number((bucket.reduce((sum, value) => sum + value, 0) / bucket.length).toFixed(2))
    : null);
  return { ...row, climateTemperature };
});
writeWindowValue(weatherHistoryPath, "WEATHER_HISTORY", publicWeatherHistory);

const companyGeneration = readWindowValue(companyGenerationPath, "COMPANY_GENERATION_DATA");
const companyBefore = companyGeneration.facts?.length || 0;
companyGeneration.facts = filterRows(companyGeneration.facts, "period", cutoff);
companyGeneration.factCount = companyGeneration.facts.length;
companyGeneration.publicWindow = { label: "滚动近两年", cutoff, asOf };
writeWindowValue(companyGenerationPath, "COMPANY_GENERATION_DATA", companyGeneration);

console.log(JSON.stringify({
  asOf,
  cutoff,
  workbench: Object.fromEntries(Object.keys(before).map((key) => [key, `${before[key]} -> ${after[key]}`])),
  weatherHistory: `${weatherHistory.length} -> ${publicWeatherHistory.length}`,
  companyFacts: `${companyBefore} -> ${companyGeneration.facts.length}`
}, null, 2));
