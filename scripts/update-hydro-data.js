const fs = require("fs");
const path = require("path");
const vm = require("vm");

const siteRoot = path.resolve(__dirname, "..");
const vaultRoot = path.resolve(siteRoot, "..", "..");
const workbenchPath = path.join(siteRoot, "assets", "workbench-data.js");
const prototypePath = path.join(vaultRoot, "outputs", "power-data-workbench-prototype", "assets", "workbench-data.js");
const companyWeeklyPath = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "水电数据", "data", "上市公司水电周度测算.csv");
const weeklyHydroPath = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "水电数据", "data", "来水_周度.csv");
const hourlyHydroPath = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "水电数据", "data", "雅砻江大渡河_sczwfw_小时.csv");
const latestSnapshotPath = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "水电数据", "scripts", "latest_snapshot_全库.md");

function loadWindowValue(file, key) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""), context);
  if (!context.window[key]) throw new Error(`Missing window.${key} in ${file}`);
  return context.window[key];
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((r) => r.some((v) => v !== "")).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

function parseMarkdownTable(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().startsWith("|"));
  if (lines.length < 3) return [];
  const split = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((value) => value.trim());
  const headers = split(lines[0]);
  return lines.slice(2).map(split).filter((cells) => cells.length >= headers.length)
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index]])));
}

const numberOrNull = (value) => value === "" || value == null ? null : Number(String(value).replace("%", ""));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function isoWeek(dateText) {
  const date = new Date(`${dateText}T00:00:00Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeekNumber = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  const source = new Date(`${dateText}T00:00:00Z`);
  const sourceDay = source.getUTCDay() || 7;
  source.setUTCDate(source.getUTCDate() - sourceDay + 1);
  return { isoYear, isoWeek: isoWeekNumber, weekStart: source.toISOString().slice(0, 10) };
}

function readCompanyRows(file) {
  return parseCsv(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")).map((row) => ({
    company: row["公司"],
    week: row["周"],
    period: row["区间"],
    days: numberOrNull(row["有效天数"]),
    power: numberOrNull(row["上市公司水电估算亿kWh"]),
    yoy: numberOrNull(row["同比%"]),
    wow: numberOrNull(row["环比(日均)%"]),
    scope: row["口径"],
    coverage: row["覆盖完整性"],
    confidence: row["置信度"],
    method: row["方法"],
  }));
}

const workbench = loadWindowValue(workbenchPath, "WORKBENCH_DATA");
const hydro = loadWindowValue(prototypePath, "WORKBENCH_DATA");
for (const key of ["hydroWeeklyLatest", "hydroHourlyLatest", "hydroQtdMetrics"]) {
  workbench[key] = hydro[key] || [];
}

const weeklySource = parseCsv(fs.readFileSync(weeklyHydroPath, "utf8").replace(/^\uFEFF/, ""));
const weeklyLookup = new Map(weeklySource.map((row) => [`${row.station}|${row.iso_year}|${row.iso_week}`, row]));
const weeklyHistory = weeklySource.map((row) => {
  const inflow = numberOrNull(row["入库"]);
  const prior = weeklyLookup.get(`${row.station}|${Number(row.iso_year) - 1}|${row.iso_week}`);
  const priorInflow = prior ? numberOrNull(prior["入库"]) : null;
  const inflowYoy = inflow > 0 && priorInflow > 0 ? Number((((inflow / priorInflow) - 1) * 100).toFixed(1)) : null;
  return {
    station: row.station,
    basin: row["流域"],
    isoYear: Number(row.iso_year),
    isoWeek: Number(row.iso_week),
    weekStart: row["周一"],
    inflow,
    priorYearInflow: priorInflow,
    inflowYoy,
    outflow: numberOrNull(row["出库"]),
    waterLevel: numberOrNull(row["水位"]),
  };
});

const hourlySource = parseCsv(fs.readFileSync(hourlyHydroPath, "utf8").replace(/^\uFEFF/, ""));
const dailyGroups = new Map();
for (const row of hourlySource) {
  const station = ({ "溪洛渡水库": "溪洛渡", "向家坝水库": "向家坝" })[row["站名"]] || row["站名"];
  const date = String(row["时间"]).slice(0, 10);
  const key = `${station}|${date}`;
  if (!dailyGroups.has(key)) dailyGroups.set(key, { station, river: row["河流"], date, inflow: [], outflow: [], waterLevel: [] });
  const target = dailyGroups.get(key);
  for (const [field, column] of [["inflow", "入库m3s"], ["outflow", "出库m3s"], ["waterLevel", "水位m"]]) {
    const value = numberOrNull(row[column]);
    if (value !== null && Number.isFinite(value)) target[field].push(value);
  }
}

const sczWeekGroups = new Map();
for (const daily of dailyGroups.values()) {
  const info = isoWeek(daily.date);
  const key = `${daily.station}|${info.isoYear}|${info.isoWeek}`;
  if (!sczWeekGroups.has(key)) sczWeekGroups.set(key, { station: daily.station, river: daily.river, ...info, inflow: [], outflow: [], waterLevel: [] });
  const target = sczWeekGroups.get(key);
  for (const field of ["inflow", "outflow", "waterLevel"]) {
    const value = average(daily[field]);
    if (value !== null) target[field].push(value);
  }
}

const sczWeekly = [...sczWeekGroups.values()].map((row) => {
  const prior = weeklyLookup.get(`${row.station}|${row.isoYear - 1}|${row.isoWeek}`);
  const inflow = average(row.inflow);
  const priorInflow = prior ? numberOrNull(prior["入库"]) : null;
  return {
    station: row.station,
    basin: row.river === "金沙江" ? "金沙江下游" : row.river,
    isoYear: row.isoYear,
    isoWeek: row.isoWeek,
    weekStart: row.weekStart,
    inflow,
    priorYearInflow: priorInflow,
    inflowYoy: inflow > 0 && priorInflow > 0 ? Number((((inflow / priorInflow) - 1) * 100).toFixed(1)) : null,
    outflow: average(row.outflow),
    waterLevel: average(row.waterLevel),
  };
});

const historyMap = new Map(weeklyHistory.map((row) => [`${row.station}|${row.isoYear}|${row.isoWeek}`, row]));
for (const row of sczWeekly) historyMap.set(`${row.station}|${row.isoYear}|${row.isoWeek}`, row);
workbench.hydroWeeklyHistory = [...historyMap.values()].sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)) || a.station.localeCompare(b.station, "zh-CN"));
const latestStationMap = new Map();
for (const row of workbench.hydroWeeklyHistory) latestStationMap.set(row.station, row);
workbench.hydroWeeklyLatest = [...latestStationMap.values()].sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)) || a.station.localeCompare(b.station, "zh-CN"));

const snapshotRows = parseMarkdownTable(fs.readFileSync(latestSnapshotPath, "utf8").replace(/^\uFEFF/, ""));
for (const snapshot of snapshotRows) {
  const station = ({ "溪洛渡水库": "溪洛渡", "向家坝水库": "向家坝" })[snapshot["电站"]] || snapshot["电站"];
  const target = latestStationMap.get(station);
  const targetWeek = target ? `${target.isoYear}-W${String(target.isoWeek).padStart(2, "0")}` : "";
  if (!target || !String(snapshot["源/周次"] || "").includes(targetWeek)) continue;
  const inflowMatch = String(snapshot["入库(m³/s)"] || "").match(/^-?\d+(?:\.\d+)?/);
  const yoyMatch = String(snapshot["同比"] || "").match(/([+-]?\d+(?:\.\d+)?)%/);
  const levelMatch = String(snapshot["水位(m)"] || "").match(/^-?\d+(?:\.\d+)?/);
  if (inflowMatch) target.inflow = Number(inflowMatch[0]);
  target.inflowYoy = yoyMatch ? Number(yoyMatch[1]) : null;
  if (levelMatch) target.waterLevel = Number(levelMatch[0]);
}

const latestHour = workbench.hydroHourlyLatest?.[0]?.time || "";
const latestWeek = workbench.hydroWeeklyLatest?.reduce((best, row) => {
  const label = `${row.isoYear}-W${String(row.isoWeek).padStart(2, "0")}`;
  return label > best ? label : best;
}, "") || "";
workbench.updatedAt = latestHour.slice(0, 10) || new Date().toISOString().slice(0, 10);
workbench.freshness = { ...(workbench.freshness || {}), hydroWeekly: latestWeek, hydroHourly: latestHour };

const companyRows = readCompanyRows(companyWeeklyPath);
const companyHistory = companyRows.filter((row) => row.power !== null && Number.isFinite(row.power));
workbench.hydroCompanyWeeklyHistory = companyHistory;
const latestByCompany = new Map();
for (const row of companyRows) {
  if (!latestByCompany.has(row.company) || row.week > latestByCompany.get(row.company).week) latestByCompany.set(row.company, row);
}
const listedCompanies = ["长江电力", "国投电力", "国电电力", "桂冠电力", "华能水电", "湖北能源", "黔源电力", "中国电力（水电）"];
workbench.hydroCompanyWeeklyLatest = listedCompanies.map((company) => latestByCompany.get(company) || {
  company,
  week: latestWeek,
  period: "暂无完整公司口径周度模型",
  days: 0,
  power: null,
  yoy: null,
  wow: null,
  scope: "上市公司完整水电口径",
  coverage: "不以局部电站数据替代公司数据",
  confidence: "低",
  method: "待完整口径数据链建立",
});

fs.writeFileSync(workbenchPath, `window.WORKBENCH_DATA = ${JSON.stringify(workbench, null, 4)};\n`, "utf8");
console.log(JSON.stringify({ updatedAt: workbench.updatedAt, hydroWeekly: latestWeek, hydroHourly: latestHour, companyRows: workbench.hydroCompanyWeeklyLatest.length }));
