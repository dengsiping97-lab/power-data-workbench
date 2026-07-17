const fs = require("fs");
const path = require("path");
const vm = require("vm");

const siteRoot = path.resolve(__dirname, "..");
const vaultRoot = path.resolve(siteRoot, "..", "..");
const workbenchPath = path.join(siteRoot, "assets", "workbench-data.js");
const companiesPath = path.join(siteRoot, "companies.html");
const changjiangPath = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "水电数据", "长江电力电量测算", "data", "长电周度电量测算.csv");
const daduPath = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "水电数据", "大渡河电量测算", "data", "大渡河周度电量测算.csv");

const assert = (condition, message) => { if (!condition) throw new Error(message); };

function loadWindowValue(file, key) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""), context);
  return context.window[key];
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
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
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

const latestSource = (file) => parseCsv(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""))
  .sort((a, b) => String(a["周"]).localeCompare(String(b["周"]))).at(-1);
const numberOrNull = (value) => value === "" || value == null ? null : Number(String(value).replace("%", ""));

const workbench = loadWindowValue(workbenchPath, "WORKBENCH_DATA");
const companiesHtml = fs.readFileSync(companiesPath, "utf8");
const latestHistory = (company) => (workbench.hydroCompanyWeeklyHistory || [])
  .filter((row) => row.company === company).sort((a, b) => String(a.week).localeCompare(String(b.week))).at(-1);

for (const [company, file, valueField, yoyField] of [
  ["长江电力", changjiangPath, "公司估算", "同比%"],
  ["国能大渡河", daduPath, "估算售电量亿kWh", "同比"],
]) {
  const source = latestSource(file);
  const published = latestHistory(company);
  assert(published, `${company}: website history missing`);
  assert(published.week === source["周"], `${company}: website week ${published.week} != source ${source["周"]}`);
  assert(Math.abs(published.power - numberOrNull(source[valueField])) < 1e-9, `${company}: website power differs from source`);
  assert(published.days === numberOrNull(source["有效天数"]), `${company}: effective-day count differs from source`);
  const sourceYoy = numberOrNull(source[yoyField]);
  assert(published.yoy === sourceYoy, `${company}: website yoy differs from source`);
}

assert(companiesHtml.includes('src="assets/workbench-data.js"'), "companies.html does not load the shared hydro snapshot");
assert(companiesHtml.includes("hydroCompanyWeeklyHistory"), "company main chart is not bound to hydro company history");
assert(!companiesHtml.includes("buildCompanyYtdSeries"), "synthetic company weekly series returned");
assert((workbench.hydroCompanyWeeklyLatest || []).length >= 8, "major hydro company coverage is incomplete");
assert(workbench.freshness?.hydroWeekly, "hydro weekly freshness is missing");

console.log(JSON.stringify({
  status: "hydro release verified",
  freshness: workbench.freshness.hydroWeekly,
  changjiang: latestHistory("长江电力"),
  dadu: latestHistory("国能大渡河"),
}, null, 2));
