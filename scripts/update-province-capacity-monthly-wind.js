const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const vaultRoot = path.resolve(root, "..", "..");
const sourceRoot = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "电力数据", "各省情况");
const workbenchPath = path.join(root, "assets", "workbench-data.js");

const readWorkbench = () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(workbenchPath, "utf8"), context, { filename: workbenchPath });
  if (!context.window.WORKBENCH_DATA) throw new Error("Missing window.WORKBENCH_DATA");
  return context.window.WORKBENCH_DATA;
};

const parseValue = (cell) => {
  const text = String(cell || "").trim();
  if (!text || text === "—" || text === "-") return null;
  const value = Number(text.replace(/\*/g, "").replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
};

const parseProvince = (province) => {
  const file = path.join(sourceRoot, province, `${province}.md`);
  const markdown = fs.readFileSync(file, "utf8");
  const confidence = markdown.match(/^confidence:\s*(.+)$/m)?.[1]?.trim() || "中";
  const section = markdown.match(/## 月度分电源装机（总量 \+ 分电源）([\s\S]*?)(?:\n## 数据口径|$)/)?.[1] || "";
  const rows = section.split(/\r?\n/).filter((line) => /^\|\s*20\d{2}-\d{2}\s*\|/.test(line));
  if (rows.length !== 28) throw new Error(`${province}: expected 28 monthly rows, got ${rows.length}`);
  return rows.map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const values = {
      total: parseValue(cells[1]),
      thermal: parseValue(cells[2]),
      hydro: parseValue(cells[3]),
      nuclear: parseValue(cells[4]),
      wind: parseValue(cells[5]),
      solar: parseValue(cells[6]),
      solar6000: parseValue(cells[7])
    };
    return {
      province,
      month: cells[0],
      period: cells[0],
      ...values,
      dataSource: "Wind EDB",
      confidence,
      missingFields: Object.entries(values).filter(([, value]) => value === null).map(([field]) => field),
      scopeNotes: "太阳能（含分布式）为 Wind 全口径；太阳能（6000+电厂）按 Wind 全口径减分布式光伏累计并网容量计算。"
    };
  });
};

const provinces = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((province) => fs.existsSync(path.join(sourceRoot, province, `${province}.md`)))
  .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

if (provinces.length !== 31) throw new Error(`Expected 31 province directories, got ${provinces.length}`);

const rows = provinces.flatMap(parseProvince).sort((a, b) =>
  b.month.localeCompare(a.month) || a.province.localeCompare(b.province, "zh-Hans-CN")
);
const workbench = readWorkbench();
workbench.provinceInstalledCapacityMonthly = rows;
workbench.provinceInstalledCapacityAnnual = rows.filter((row) => ["2024-12", "2025-12"].includes(row.month)).map((row) => ({
  ...row,
  period: `${row.month}-31`,
  solar: row.solar6000
}));
if (workbench.publicWindow) workbench.publicWindow.cutoff = "2024-02-01";
fs.writeFileSync(workbenchPath, `window.WORKBENCH_DATA = ${JSON.stringify(workbench, null, 4)};\n`, "utf8");

console.log(JSON.stringify({ provinces: provinces.length, rows: rows.length, monthlyRows: rows.length, annualRows: workbench.provinceInstalledCapacityAnnual.length }, null, 2));
