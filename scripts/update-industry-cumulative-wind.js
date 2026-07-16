const fs = require("fs");
const path = require("path");
const vm = require("vm");

const file = path.join(__dirname, "..", "assets", "workbench-data.js");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(file, "utf8"), context, { filename: file });
const workbench = context.window.WORKBENCH_DATA;

const months = ["2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
const values = {
  total: [15564, 23846, 31566, 39665, 48418, 58633, 68788, 77675, 86246, 94602, 103682, null, 16546, 25141, 33345, 42018, 50999],
  primary: [208, 314, 424, 543, 676, 847, 1012, 1142, 1262, 1374, 1494, null, 223, 336, 449, 574, 711],
  secondary: [9636, 15214, 20497, 25914, 31485, 37403, 43386, 49093, 54781, 60436, 66366, null, 10279, 15987, 21569, 27324, 33057],
  tertiary: [2980, 4465, 5856, 7406, 9164, 11251, 13297, 15062, 16671, 18204, 19942, null, 3231, 4833, 6351, 8055, 9916],
  residential: [2740, 3853, 4789, 5802, 7093, 9132, 11094, 12378, 13532, 14588, 15880, null, 2813, 3985, 4976, 6065, 7315]
};
workbench.powerConsumptionCumulativeWind = months.map((month, index) => ({
  month,
  total: values.total[index],
  primary: values.primary[index],
  secondary: values.secondary[index],
  tertiary: values.tertiary[index],
  residential: values.residential[index],
  dataSource: "Wind EDB / 国家能源局",
  indicatorCodes: "S0048389/S0048390/S0048391/S0048392/S0048393"
}));
fs.writeFileSync(file, `window.WORKBENCH_DATA = ${JSON.stringify(workbench, null, 4)};\n`, "utf8");
console.log(JSON.stringify({ rows: workbench.powerConsumptionCumulativeWind.length, latest: workbench.powerConsumptionCumulativeWind.at(-1) }, null, 2));
