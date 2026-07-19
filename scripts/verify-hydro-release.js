const fs = require("fs");
const path = require("path");
const vm = require("vm");

const siteRoot = path.resolve(__dirname, "..");
const vaultRoot = path.resolve(siteRoot, "..", "..");
const workbenchPath = path.join(siteRoot, "assets", "workbench-data.js");
const companiesPath = path.join(siteRoot, "companies.html");
const sourcePath = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "水电数据", "data", "上市公司水电周度测算.csv");
const assert = (condition, message) => { if (!condition) throw new Error(message); };

function loadWindowValue(file, key) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""), context);
  return context.window[key];
}

function parseCsv(text) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = rows.shift();
  return rows.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
}

const num = (value) => value === "" || value == null ? null : Number(String(value).replace("%", ""));
const latest = (rows, company, field = "week") => rows.filter((row) => row.company === company || row["公司"] === company)
  .sort((a, b) => String(a[field] || a["周"]).localeCompare(String(b[field] || b["周"]))).at(-1);

const sourceRows = parseCsv(fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, ""));
const workbench = loadWindowValue(workbenchPath, "WORKBENCH_DATA");
const publishedRows = workbench.hydroCompanyWeeklyHistory || [];
const latestRows = workbench.hydroCompanyWeeklyLatest || [];
const html = fs.readFileSync(companiesPath, "utf8");
const listed = ["长江电力", "国投电力", "国电电力", "桂冠电力", "华能水电", "湖北能源", "黔源电力", "中国电力（水电）"];

for (const row of publishedRows) {
  assert(row.scope === "上市公司完整水电口径", `${row.company} ${row.week}: non-company scope published`);
  assert(row.power !== null && Number.isFinite(row.power), `${row.company} ${row.week}: power missing`);
}
for (const company of listed) {
  const published = latest(publishedRows, company);
  const source = latest(sourceRows, company, "周");
  if (!source) {
    assert(latestRows.some((row) => row.company === company && row.power === null), `${company}: missing safe placeholder`);
    continue;
  }
  const sourcePower = num(source["上市公司水电估算亿kWh"]);
  if (sourcePower === null) {
    const latestRow = latestRows.find((row) => row.company === company);
    assert(latestRow?.week === source["周"], `${company}: missing-state week differs from source`);
    assert(latestRow?.power === null, `${company}: missing-state row published as numeric power`);
    assert(latestRow?.coverage === source["覆盖完整性"], `${company}: missing-state coverage differs from source`);
    continue;
  }
  assert(published, `${company}: website history missing`);
  assert(published.week === source["周"], `${company}: latest week differs from source`);
  assert(Math.abs(published.power - sourcePower) < 1e-9, `${company}: power differs from source`);
  assert(published.yoy === num(source["同比%"]), `${company}: yoy differs from source`);
  assert(published.wow === num(source["环比(日均)%"]), `${company}: wow differs from source`);
}

assert(latestRows.length === listed.length, "listed-company coverage mismatch");
assert(!publishedRows.some((row) => ["雅砻江水电", "国能大渡河", "五凌电力"].includes(row.company)), "asset-platform row leaked as listed company");
assert(!html.includes("companyWeeklyCharts"), "hard-coded synthetic weekly series returned");
assert(!html.includes("雅砻江水电") && !html.includes("国能大渡河") && !html.includes("五凌电力"), "asset-platform name remains on company page");
const changjiang = publishedRows.find((row) => row.company === "长江电力" && row.week === "2026-W29");
assert(changjiang?.power > 50 && changjiang?.days === 7, "Changjiang W29 full-scope seven-day power missing");

console.log(JSON.stringify({ status: "hydro release verified", companies: latestRows.map((row) => ({ company: row.company, week: row.week, power: row.power, yoy: row.yoy })) }, null, 2));
