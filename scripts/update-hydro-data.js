const fs = require("fs");
const path = require("path");
const vm = require("vm");

const siteRoot = path.resolve(__dirname, "..");
const vaultRoot = path.resolve(siteRoot, "..", "..");
const workbenchPath = path.join(siteRoot, "assets", "workbench-data.js");
const prototypePath = path.join(vaultRoot, "outputs", "power-data-workbench-prototype", "assets", "workbench-data.js");
const changjiangPath = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "水电数据", "长江电力电量测算", "data", "长电周度电量测算.csv");
const daduPath = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "水电数据", "大渡河电量测算", "data", "大渡河周度电量测算.csv");
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

function readCompanyRows(file, company, valueField, scopeField) {
  return parseCsv(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")).map((row) => ({
    company,
    week: row["周"],
    period: row["区间"],
    days: numberOrNull(row["有效天数"]),
    power: numberOrNull(row[valueField]),
    yoy: numberOrNull(row["同比"] || row["同比%"]),
    scope: row[scopeField] || "",
    coverage: row["数据天数(三/溪/向)"] || row["数据天数(瀑/大/猴)"] ||
      ([row["三峡天数"], row["溪洛渡天数"], row["向家坝天数"]].every((value) => value !== undefined)
        ? [row["三峡天数"], row["溪洛渡天数"], row["向家坝天数"]].join("/") : ""),
    confidence: company === "长江电力" ? "低" : "中",
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

const companyHistory = [
  ...readCompanyRows(changjiangPath, "长江电力", "公司估算", "口径完整性"),
  ...readCompanyRows(daduPath, "国能大渡河", "估算售电量亿kWh", "季度"),
];
workbench.hydroCompanyWeeklyHistory = companyHistory;
const latestByCompany = new Map();
for (const row of companyHistory) {
  if (!latestByCompany.has(row.company) || row.week > latestByCompany.get(row.company).week) latestByCompany.set(row.company, row);
}
workbench.hydroCompanyWeeklyLatest = [
  latestByCompany.get("长江电力"),
  { company: "雅砻江水电", week: latestWeek, period: "周度模型未建", days: 5, power: null, yoy: null, scope: "来水仅作方向判断", coverage: "缺周度电量模型", confidence: "低" },
  latestByCompany.get("国能大渡河"),
  { company: "桂冠电力", week: latestWeek, period: "周度模型未建", days: 5, power: null, yoy: null, scope: "红水河来水代理", coverage: "缺周度电量模型", confidence: "低" },
  { company: "华能水电", week: latestWeek, period: "缺高频水情", days: 0, power: null, yoy: null, scope: "澜沧江", coverage: "缺数据与模型", confidence: "低" },
  { company: "湖北能源", week: latestWeek, period: "周度模型未建", days: 5, power: null, yoy: null, scope: "清江", coverage: "缺周度电量模型", confidence: "低" },
  { company: "黔源电力", week: latestWeek, period: "缺主力站水情", days: 0, power: null, yoy: null, scope: "北盘江", coverage: "缺数据与模型", confidence: "低" },
  { company: "五凌电力", week: latestWeek, period: "数据停在W27", days: 0, power: null, yoy: null, scope: "沅水", coverage: "不可作为本周数", confidence: "低" },
].filter(Boolean);

fs.writeFileSync(workbenchPath, `window.WORKBENCH_DATA = ${JSON.stringify(workbench, null, 4)};\n`, "utf8");
console.log(JSON.stringify({ updatedAt: workbench.updatedAt, hydroWeekly: latestWeek, hydroHourly: latestHour, companyRows: workbench.hydroCompanyWeeklyLatest.length }));
