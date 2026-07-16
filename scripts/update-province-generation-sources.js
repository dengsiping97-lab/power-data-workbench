const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "..");
const workbenchPath = path.join(root, "assets", "workbench-data.js");
const vaultRoot = path.resolve(root, "..", "..");
const sourceRoot = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "电力数据", "各省情况");
const cachePath = path.join(root, "logs", "province-generation-sources-wind.json");
const windRoot = process.env.WIND_SKILL_DIR || "C:\\Users\\admin\\.codex\\skills\\wind-mcp-skill";
const windCli = path.join(windRoot, "scripts", "cli.mjs");

const provinces = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
  "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆"
];
const fields = ["thermalGeneration", "hydroGeneration", "nuclearGeneration", "windGeneration", "solarGeneration"];
const names = { 内蒙古: "内蒙古自治区", 广西: "广西壮族自治区", 宁夏: "宁夏回族自治区", 新疆: "新疆维吾尔自治区", 西藏: "西藏自治区" };
const labels = { thermalGeneration: "火电", hydroGeneration: "水电", nuclearGeneration: "核电", windGeneration: "风电", solarGeneration: "光伏" };

const readWorkbench = () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(workbenchPath, "utf8"), context, { filename: workbenchPath });
  return context.window.WORKBENCH_DATA;
};

const parseWindOutput = (stdout) => {
  const outer = JSON.parse(stdout.trim());
  const text = outer?.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Wind response has no text content");
  const payload = JSON.parse(text);
  if (payload.error) throw new Error(payload.error.message || JSON.stringify(payload.error));
  const dates = payload?.data?.date || [];
  const indicators = payload?.data?.indicatorInfo || [];
  if (!dates.length || !indicators.length) throw new Error("Wind response has no monthly indicators");
  const result = Object.fromEntries(fields.map((field) => [field, {}]));
  for (const indicator of indicators) {
    const name = String(indicator.name || "");
    const field = name.includes("火力") ? "thermalGeneration"
      : name.includes("水力") ? "hydroGeneration"
        : name.includes("核能") ? "nuclearGeneration"
          : name.includes("风力") ? "windGeneration"
            : name.includes("太阳能") ? "solarGeneration" : null;
    if (!field) continue;
    dates.forEach((date, index) => {
      const value = indicator.data?.[index];
      result[field][String(date).slice(0, 6).replace(/(\d{4})(\d{2})/, "$1-$2")] = value === null || value === undefined ? null : +(Number(value) / 10000).toFixed(4);
    });
  }
  return result;
};

const fetchProvince = async (province) => {
  const name = names[province] || `${province}省`;
  const metricIdsStr = `${name}火力发电量、${name}水力发电量、${name}核能发电量、${name}风力发电量、${name}太阳能发电量`;
  const params = JSON.stringify({ metricIdsStr, beginDate: "20240101", endDate: "20260630", freq: "月" });
  const { stdout } = await execFileAsync(process.execPath, [windCli, "call", "economic_data", "get_economic_data", params], { cwd: windRoot, maxBuffer: 16 * 1024 * 1024 });
  return parseWindOutput(stdout);
};

const readCache = () => fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, "utf8")) : {};
const saveCache = (cache) => { fs.mkdirSync(path.dirname(cachePath), { recursive: true }); fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8"); };

const updateMarkdown = (province, rows) => {
  const file = path.join(sourceRoot, province, `${province}.md`);
  if (!fs.existsSync(file)) return;
  const markdown = fs.readFileSync(file, "utf8");
  const start = markdown.indexOf("## 月度发用电");
  const end = markdown.indexOf("## 数据口径");
  const body = rows.slice().sort((a, b) => b.month.localeCompare(a.month)).map((row) => `| ${row.month} | ${row.generation ?? "—"} | ${row.consumption ?? "—"} | ${row.thermalGeneration ?? "—"} | ${row.hydroGeneration ?? "—"} | ${row.nuclearGeneration ?? "—"} | ${row.windGeneration ?? "—"} | ${row.solarGeneration ?? "—"} |`).join("\n");
  const section = `## 月度发用电（当月值）\n\n单位：亿千瓦时。装机仍按原页面的万千瓦口径。\n\n| 月份 | 发电量 | 用电量 | 火电 | 水电 | 核电 | 风电 | 光伏 |\n|---|---:|---:|---:|---:|---:|---:|---:|\n${body}\n\n- 来源：iFinD EDB（发电量、用电量）与 Wind EDB（分电源发电量），提取日期：2026-07-16。\n- “—”表示对应月份或电源没有可靠返回值，不补 0、不插值。\n\n`;
  const next = start >= 0 && end > start ? `${markdown.slice(0, start)}${section}${markdown.slice(end)}` : `${markdown.slice(0, end)}${section}${markdown.slice(end)}`;
  fs.writeFileSync(file, next, "utf8");
};

const main = async () => {
  const cache = readCache();
  const queue = provinces.filter((province) => !cache[province]?.thermalGeneration);
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const province = queue[cursor++];
      try {
        cache[province] = await fetchProvince(province);
        saveCache(cache);
        console.log(`[${Object.keys(cache).length}/${provinces.length}] ${province}: ${Object.values(cache[province]).filter((x) => Object.keys(x).length).length}/5 sources`);
      } catch (error) {
        cache[province] = { error: String(error.message || error) };
        saveCache(cache);
        console.error(`[failed] ${province}: ${error.message || error}`);
      }
    }
  };
  await Promise.all([worker(), worker()]);

  const workbench = readWorkbench();
  const rows = workbench.provincePowerMonthly || [];
  for (const row of rows) {
    const source = cache[row.province] || {};
    for (const field of fields) row[field] = source[field]?.[row.month] ?? null;
    row.dataSource = "iFinD EDB + Wind EDB";
  }
  workbench.provincePowerMonthly = rows;
  workbench.provincePowerMonthlyMeta = { sourceFields: fields, sourceNote: "Wind EDB 分电源月度发电量；iFinD EDB 总发电量与用电量" };
  fs.writeFileSync(workbenchPath, `window.WORKBENCH_DATA = ${JSON.stringify(workbench, null, 4)};\n`, "utf8");

  for (const province of provinces) updateMarkdown(province, rows.filter((row) => row.province === province));
  console.log(JSON.stringify({ provinces: provinces.length, rows: rows.length, completeRows: rows.filter((row) => fields.every((field) => row[field] !== null)).length }, null, 2));
};

main().catch((error) => { console.error(error); process.exit(1); });
