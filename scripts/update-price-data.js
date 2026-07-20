const fs = require("fs");
const path = require("path");
const vm = require("vm");

const siteRoot = path.resolve(__dirname, "..");
const vaultRoot = path.resolve(siteRoot, "..", "..");
const dataRoot = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "电价数据", "data");
const snapshotPath = path.join(siteRoot, "assets", "workbench-data.js");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ""));
    rows.push(row);
  }
  const headers = rows.shift().map((value) => value.replace(/^\uFEFF/, ""));
  return rows
    .filter((values) => values.some((value) => value !== ""))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function readCsv(name) {
  return parseCsv(fs.readFileSync(path.join(dataRoot, name), "utf8"));
}

function numberOrNull(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function percentChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Number(((current / previous - 1) * 100).toFixed(1));
}

function loadSnapshot() {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(snapshotPath, "utf8"), context, { filename: snapshotPath });
  return context.window.WORKBENCH_DATA;
}

const coalBenchmark = {
  安徽: 384.4, 福建: 393.2, 甘肃: 307.8, 广东: 453.0, 广西: 420.7, 贵州: 351.5,
  海南: 429.8, 河北南网: 364.4, 冀南: 364.4, 河南: 377.9, 黑龙江: 374.0, 湖北: 416.1,
  湖南: 450.0, 吉林: 373.1, 江苏: 391.0, 江西: 414.3, 辽宁: 374.9, 蒙东: 303.5,
  蒙西: 282.9, 呼包东: 282.9, 呼包西: 282.9, 宁夏: 259.5, 青海: 324.7, 山东: 394.9,
  山西: 332.0, 陕西: 354.5, 上海: 415.5, 四川: 401.2, 新疆: 250.0, 云南: 335.8,
  浙江: 415.3, 重庆: 396.4
};

const realtimeByKey = new Map();
const putRealtime = (row) => {
  const key = `${row.province}|${row.weekStart}`;
  const previous = realtimeByKey.get(key);
  if (!previous || row.priority >= previous.priority) realtimeByKey.set(key, row);
};

readCsv("现货易能_周实时_长.csv")
  .filter((row) => !["苏北", "苏南"].includes(row.province))
  .forEach((row) => putRealtime({
    province: row.province,
    weekStart: row.week_start,
    weekEnd: new Date(new Date(`${row.week_start}T00:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10),
    spotAvg: numberOrNull(row.realtime_arith_yuan_mwh),
    spotYoy: null,
    source: "易能周度实时",
    priority: 1
  }));

const ifindRows = readCsv("现货iFind_周度.csv");
const ifindYoy = new Map();
ifindRows.forEach((row) => {
  const key = `${row.province}|${row.week_start}`;
  ifindYoy.set(key, numberOrNull(row.rt_yoy));
  const value = numberOrNull(row.rt_avg);
  if (value === null) return;
  putRealtime({
    province: row.province,
    isoYear: Number(row.iso_year),
    isoWeek: Number(row.iso_week),
    weekStart: row.week_start,
    weekEnd: row.week_end,
    spotAvg: value,
    spotYoy: numberOrNull(row.rt_yoy),
    source: "iFind实时均价",
    priority: 3
  });
});

readCsv("现货四川_日均价_周度.csv").forEach((row) => {
  const value = numberOrNull(row.avg);
  if (value === null) return;
  putRealtime({
    province: "四川",
    isoYear: Number(row.iso_year),
    isoWeek: Number(row.iso_week),
    weekStart: row.week_start,
    weekEnd: row.week_end,
    spotAvg: value,
    spotYoy: null,
    source: "四川现货日均价",
    priority: 3
  });
});

const realtimeGroups = new Map();
[...realtimeByKey.values()].forEach((row) => {
  if (!realtimeGroups.has(row.province)) realtimeGroups.set(row.province, []);
  realtimeGroups.get(row.province).push(row);
});

const spotWeeklyHistory = [];
realtimeGroups.forEach((rows, province) => {
  rows.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
  rows.forEach((row, index) => {
    const previous = rows[index + 1];
    const start = new Date(`${row.weekStart}T00:00:00Z`);
    const end = row.weekEnd || new Date(start.getTime() + 6 * 86400000).toISOString().slice(0, 10);
    spotWeeklyHistory.push({
      province,
      coalBenchmark: coalBenchmark[province] ?? null,
      isoYear: row.isoYear ?? Number(row.weekStart.slice(0, 4)),
      isoWeek: row.isoWeek ?? null,
      weekStart: row.weekStart,
      weekEnd: end,
      spotAvg: row.spotAvg,
      spotYoy: row.spotYoy ?? ifindYoy.get(`${province}|${row.weekStart}`) ?? null,
      spotWow: percentChange(row.spotAvg, previous?.spotAvg),
      source: row.source
    });
  });
});
spotWeeklyHistory.sort((a, b) => a.province.localeCompare(b.province, "zh-Hans-CN") || b.weekStart.localeCompare(a.weekStart));

const spotWeeklyLatest = [...realtimeGroups.keys()]
  .map((province) => spotWeeklyHistory.find((row) => row.province === province))
  .sort((a, b) => b.weekEnd.localeCompare(a.weekEnd) || b.spotAvg - a.spotAvg);

const dayAheadHistory = readCsv("现货电碳_日前_日度.csv")
  .map((row) => ({
    date: row.date,
    province: row.province,
    dayAheadAvg: numberOrNull(row.dayahead_arith_yuan_mwh),
    source: "电碳全国日前"
  }))
  .filter((row) => row.dayAheadAvg !== null)
  .sort((a, b) => b.date.localeCompare(a.date) || b.dayAheadAvg - a.dayAheadAvg);
const latestDayAheadDate = dayAheadHistory[0]?.date || null;
const dayAheadLatest = dayAheadHistory.filter((row) => row.date === latestDayAheadDate);

const dayAheadWeeklyHistory = readCsv("现货电碳_日前_周度.csv")
  .map((row) => ({
    province: row.province,
    isoYear: Number(row.iso_year),
    isoWeek: Number(row.iso_week),
    weekStart: row.week_start,
    weekEnd: row.week_end,
    dayAheadAvg: numberOrNull(row.dayahead_avg),
    nDays: Number(row.n_days),
    source: "电碳全国日前"
  }))
  .filter((row) => row.dayAheadAvg !== null)
  .sort((a, b) => a.province.localeCompare(b.province, "zh-Hans-CN") || b.weekStart.localeCompare(a.weekStart));

const snapshot = loadSnapshot();
const existingDayAheadHistory = Array.isArray(snapshot.dayAheadDailyHistory) ? snapshot.dayAheadDailyHistory : [];
const existingDayAheadLatest = Array.isArray(snapshot.dayAheadDailyLatest) ? snapshot.dayAheadDailyLatest : [];
const existingDayAheadWeeklyHistory = Array.isArray(snapshot.dayAheadWeeklyHistory) ? snapshot.dayAheadWeeklyHistory : [];
const existingDayAheadDate = existingDayAheadHistory.reduce(
  (latest, row) => row?.date && row.date > latest ? row.date : latest,
  ""
);
const keepExistingDayAhead = existingDayAheadDate > (latestDayAheadDate || "");
const effectiveDayAheadDate = keepExistingDayAhead ? existingDayAheadDate : latestDayAheadDate;
const effectiveDayAheadHistory = keepExistingDayAhead ? existingDayAheadHistory : dayAheadHistory;
const effectiveDayAheadLatest = keepExistingDayAhead ? existingDayAheadLatest : dayAheadLatest;
const effectiveDayAheadWeeklyHistory = keepExistingDayAhead ? existingDayAheadWeeklyHistory : dayAheadWeeklyHistory;

snapshot.updatedAt = shanghaiDate();
snapshot.sourceNote = "本地研究工作台快照；现货实时、全国日前、代理购电与水电数据按各自口径维护。";
snapshot.freshness = {
  ...(snapshot.freshness || {}),
  spotWeekly: spotWeeklyLatest.reduce((latest, row) => row.weekEnd > latest ? row.weekEnd : latest, ""),
  dayAheadDaily: effectiveDayAheadDate
};
snapshot.spotWeeklyLatest = spotWeeklyLatest;
snapshot.spotWeeklyHistory = spotWeeklyHistory;
snapshot.dayAheadDailyLatest = effectiveDayAheadLatest;
snapshot.dayAheadDailyHistory = effectiveDayAheadHistory;
snapshot.dayAheadWeeklyHistory = effectiveDayAheadWeeklyHistory;
if (snapshot.datasets?.p0) {
  const additions = [
    { module: "电价", name: "现货电碳_日前_日度.csv", grain: "省份-日", status: "已接入本地站点" },
    { module: "电价", name: "现货四川_日均价_周度.csv", grain: "省份-周", status: "已接入本地站点" }
  ];
  additions.forEach((entry) => {
    if (!snapshot.datasets.p0.some((row) => row.name === entry.name)) snapshot.datasets.p0.push(entry);
  });
}

fs.writeFileSync(snapshotPath, `window.WORKBENCH_DATA = ${JSON.stringify(snapshot, null, 4)};\n`, "utf8");
console.log(`Updated ${snapshotPath}`);
console.log(`Realtime: ${spotWeeklyLatest.length} provinces, latest ${snapshot.freshness.spotWeekly}`);
console.log(`Day-ahead: ${effectiveDayAheadLatest.length} provinces, latest ${effectiveDayAheadDate}${keepExistingDayAhead ? " (kept newer site snapshot)" : ""}`);
