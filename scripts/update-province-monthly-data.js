const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const workbenchPath = path.join(root, "assets", "workbench-data.js");
const cachePath = path.join(root, "logs", "province-monthly-ifind.json");
const ifindRoot = process.env.IFIND_SKILL_DIR || "C:\\Users\\admin\\.codex\\skills\\ifind-finance-data";
const { call } = require(path.join(ifindRoot, "call-node.js"));

const provinces = [
  "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
  "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
  "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏", "新疆"
];

const readWorkbench = () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(workbenchPath, "utf8"), context, { filename: workbenchPath });
  return context.window.WORKBENCH_DATA;
};

const readCache = () => {
  if (!fs.existsSync(cachePath)) return {};
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
};

const saveCache = (cache) => {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
};

const unwrap = (response) => {
  const content = response?.data?.result?.content || response?.data?.data?.result?.content;
  const text = content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("iFinD response has no text content");
  const payload = JSON.parse(text);
  const table = payload?.data?.datas?.find((item) => item.success)?.data;
  if (!table?.columns || !table?.data) throw new Error(payload?.subMsg || payload?.msg || "iFinD response has no table");
  return table;
};

const classifyColumn = (column) => {
  if (/日期/.test(column)) return "date";
  if (/发电量/.test(column) && /当月值/.test(column)) return "generation";
  if (/用电量/.test(column) && /当月值/.test(column)) return "consumption";
  return null;
};

const normalizeTable = (province, table) => {
  const mapping = table.columns.map(classifyColumn);
  const attrs = table.attrs || {};
  return {
    rows: table.data.map((cells) => {
      const row = { province, month: null, generation: null, consumption: null };
      cells.forEach((value, index) => {
        const field = mapping[index];
        if (!field) return;
        if (field === "date") row.month = String(value).slice(0, 7);
        else row[field] = value === "" || value === null ? null : +(Number(value) / 1e8).toFixed(4);
      });
      return row;
    }).filter((row) => row.month && (row.generation !== null || row.consumption !== null)),
    indicators: Object.fromEntries(Object.entries(attrs).map(([name, meta]) => [classifyColumn(name) || name, {
      name,
      id: meta.index_id || null,
      unit: meta.unit || null
    }]))
  };
};

const fetchProvince = async (province) => {
  const queryName = province === "重庆" ? "重庆市" : province;
  const query = `${queryName}发电量当月值、${queryName}用电量当月值，月度，2024-01至2026-06；必须是${queryName}省级数据，不要全国数据，不要累计值`;
  const response = await call("edb", "get_edb_data", { query });
  if (!response?.ok) throw new Error(response?.error || `iFinD request failed: ${response?.status_code}`);
  return normalizeTable(province, unwrap(response));
};

const main = async () => {
  const cache = readCache();
  const queue = provinces.filter((province) => !cache[province]?.rows?.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const province = queue[cursor++];
      try {
        cache[province] = await fetchProvince(province);
        saveCache(cache);
        console.log(`[${Object.keys(cache).length}/${provinces.length}] ${province}: ${cache[province].rows.length} months`);
      } catch (error) {
        cache[province] = { rows: [], indicators: {}, error: String(error.message || error) };
        saveCache(cache);
        console.error(`[failed] ${province}: ${error.message || error}`);
      }
    }
  };

  await Promise.all([worker(), worker()]);

  const workbench = readWorkbench();
  const annual = workbench.provinceInstalledCapacityAnnual || [];
  const capacityByProvinceMonth = new Map(annual.map((row) => [`${row.province}|${row.period.slice(0, 7)}`, row.total]));
  workbench.provincePowerMonthly = provinces.flatMap((province) => (cache[province]?.rows || []).map((row) => ({
    ...row,
    capacity: capacityByProvinceMonth.get(`${province}|${row.month}`) ?? null,
    capacityScope: capacityByProvinceMonth.has(`${province}|${row.month}`) ? "全口径年末装机" : null,
    dataSource: "iFinD EDB"
  }))).sort((a, b) => b.month.localeCompare(a.month) || a.province.localeCompare(b.province, "zh-Hans-CN"));
  workbench.provincePowerMonthlyMeta = Object.fromEntries(provinces.map((province) => [province, {
    available: Boolean(cache[province]?.rows?.length),
    error: cache[province]?.error || null
  }]));
  fs.writeFileSync(workbenchPath, `window.WORKBENCH_DATA = ${JSON.stringify(workbench, null, 4)};\n`, "utf8");

  console.log(JSON.stringify({
    provinces: provinces.length,
    provincesWithData: provinces.filter((province) => cache[province]?.rows?.length).length,
    rows: workbench.provincePowerMonthly.length,
    failed: provinces.filter((province) => !cache[province]?.rows?.length)
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
