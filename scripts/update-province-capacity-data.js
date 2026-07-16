const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const vaultRoot = path.resolve(root, "..", "..");
const sourceRoot = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "电力数据", "各省情况");
const workbenchPath = path.join(root, "assets", "workbench-data.js");
const fields = ["total", "hydro", "thermal", "wind", "solar", "nuclear"];

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

const parseScopeNotes = (markdown) => {
  const section = markdown.match(/## 数据口径([\s\S]*?)(?:\n## |$)/)?.[1] || "";
  return section
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^-\s*/, ""))
    .filter((line) => /未返回|误匹配|口径|同时返回|不直接|未主观/.test(line))
    .filter((line) => !/^原始单位/.test(line))
    .join("；");
};

const parseProvince = (province) => {
  const file = path.join(sourceRoot, province, `${province}.md`);
  const markdown = fs.readFileSync(file, "utf8");
  const confidence = markdown.match(/^confidence:\s*(.+)$/m)?.[1]?.trim() || "中";
  const scopeNotes = parseScopeNotes(markdown);
  const rows = markdown.split(/\r?\n/).filter((line) => /^\|\s*20\d{2}-12-31\s*\|/.test(line));
  if (rows.length !== 2) throw new Error(`${province}: expected 2 annual rows, got ${rows.length}`);
  return rows.map((line) => {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const values = Object.fromEntries(fields.map((field, index) => [field, parseValue(cells[index + 1])]));
    const missingFields = fields.filter((field) => values[field] === null);
    return {
      province,
      period: cells[0],
      ...values,
      dataSource: "iFinD EDB",
      confidence,
      missingFields,
      scopeNotes
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
  b.period.localeCompare(a.period) || a.province.localeCompare(b.province, "zh-Hans-CN")
);
const workbench = readWorkbench();
workbench.provinceInstalledCapacityAnnual = rows;
fs.writeFileSync(workbenchPath, `window.WORKBENCH_DATA = ${JSON.stringify(workbench, null, 4)};\n`, "utf8");

console.log(JSON.stringify({
  provinces: provinces.length,
  rows: rows.length,
  periods: [...new Set(rows.map((row) => row.period))],
  incompleteRows: rows.filter((row) => row.missingFields.length).length
}, null, 2));
