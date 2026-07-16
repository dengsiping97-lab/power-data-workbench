const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const loadWindowValue = (file, key) => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), context, { filename: file });
  return context.window[key];
};
const fail = (message) => { throw new Error(message); };
const workbench = loadWindowValue("assets/workbench-data.js", "WORKBENCH_DATA");
const latestMonth = (rows) => rows.map((row) => String(row.month || "").slice(0, 7)).filter(Boolean).sort().at(-1);
const assertDescending = (rows, key) => {
  for (let i = 1; i < rows.length; i += 1) if (String(rows[i - 1][key]) < String(rows[i][key])) fail(`${key} not descending at row ${i}`);
};

const consumption = workbench.powerConsumptionMonthly || [];
const generation = workbench.powerGenerationMonthly || [];
const capacity = workbench.installedCapacityMonthly || [];
const provinceMonthly = workbench.provincePowerMonthly || [];
if (!consumption.length || !generation.length || !capacity.length) fail("national monthly datasets are empty");
assertDescending(consumption, "month");
assertDescending(generation, "month");
assertDescending(capacity, "month");
if (latestMonth(consumption) !== latestMonth(generation)) fail("national generation and consumption periods differ");

const provinces = new Set(provinceMonthly.map((row) => row.province));
if (provinces.size !== 31) fail(`province coverage mismatch: ${provinces.size}`);
const provinceLatest = [...new Set([...provinces].map((province) => latestMonth(provinceMonthly.filter((row) => row.province === province))))];
if (provinceLatest.length !== 1) fail(`province monthly periods are inconsistent: ${provinceLatest.join(",")}`);

const result = {
  asOf: workbench.updatedAt,
  nationalLatest: { consumption: latestMonth(consumption), generation: latestMonth(generation), capacity: latestMonth(capacity) },
  industryMonthlyLatest: latestMonth(consumption),
  provinceMonthlyLatest: provinceLatest[0],
  provinceCoverage: provinces.size,
  notes: ["全国装机数据最新期落后用电/发电一个月，按披露节奏保留，不插值。", "全国发电数据含 2025-01~02 合并期，按源数据口径保留。"]
};
console.log(JSON.stringify(result, null, 2));
