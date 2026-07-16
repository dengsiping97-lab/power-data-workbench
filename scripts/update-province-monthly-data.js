const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const workbenchPath = path.join(root, "assets", "workbench-data.js");
const cachePath = path.join(root, "logs", "province-monthly-ifind.json");
const sourceCachePath = path.join(root, "logs", "province-generation-source-ifind.json");
const vaultRoot = path.resolve(root, "..", "..");
const provinceRoot = path.join(vaultRoot, "wiki", "行业", "公用事业", "数据库", "电力数据", "各省情况");
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

const readCache = (file = cachePath) => {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const saveCache = (cache, file = cachePath) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
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

const sourceFieldLabels = {
  thermal: "火电",
  hydro: "水电",
  nuclear: "核电",
  wind: "风电",
  solar: "光伏"
};

const classifySourceColumn = (province, column) => {
  if (/日期/.test(column)) return "date";
  if (!column.includes(province) || !/发电量/.test(column) || !/当月值/.test(column)) return null;
  if (/火电|火力/.test(column)) return "thermal";
  if (/水电|水力/.test(column)) return "hydro";
  if (/核电|核能/.test(column)) return "nuclear";
  if (/风电|风力/.test(column)) return "wind";
  if (/太阳能|光伏/.test(column)) return "solar";
  return null;
};

const normalizeSourceTable = (province, table) => {
  const mapping = table.columns.map((column) => classifySourceColumn(province, column));
  const attrs = table.attrs || {};
  return {
    rows: table.data.map((cells) => {
      const row = { province, month: null, thermal: null, hydro: null, nuclear: null, wind: null, solar: null };
      cells.forEach((value, index) => {
        const field = mapping[index];
        if (!field) return;
        if (field === "date") row.month = String(value).slice(0, 7);
        else row[field] = value === "" || value === null ? null : +(Number(value) / 1e8).toFixed(4);
      });
      return row;
    }).filter((row) => row.month && Object.keys(sourceFieldLabels).some((field) => row[field] !== null)),
    indicators: Object.fromEntries(Object.entries(attrs).map(([name, meta]) => {
      const field = classifySourceColumn(province, name);
      return [field || name, { name, id: meta.index_id || null, unit: meta.unit || null }];
    }))
  };
};

const fetchSourceProvince = async (province) => {
  const queryName = province === "重庆" ? "重庆市" : province;
  const query = `发电量:火电:${queryName}:当月值、发电量:水电:${queryName}:当月值、发电量:核电:${queryName}:当月值、发电量:风电:${queryName}:当月值、发电量:太阳能:${queryName}:当月值，2024-01至2026-06，月度；必须是${queryName}数据`;
  const response = await call("edb", "get_edb_data", { query });
  if (!response?.ok) throw new Error(response?.error || `iFinD request failed: ${response?.status_code}`);
  try {
    return normalizeSourceTable(province, unwrap(response));
  } catch (error) {
    const splitQueries = [
      `发电量:火电:${queryName}:当月值、发电量:风电:${queryName}:当月值、发电量:太阳能:${queryName}:当月值，2024-01至2026-06，月度`,
      `发电量:水电:${queryName}:当月值、发电量:核电:${queryName}:当月值，2024-01至2026-06，月度`
    ];
    const parts = [];
    for (const splitQuery of splitQueries) {
      const splitResponse = await call("edb", "get_edb_data", { query: splitQuery });
      if (!splitResponse?.ok) throw new Error(splitResponse?.error || `iFinD split request failed: ${splitResponse?.status_code}`);
      parts.push(normalizeSourceTable(province, unwrap(splitResponse)));
    }
    const byMonth = new Map();
    parts.flatMap((part) => part.rows).forEach((row) => {
      byMonth.set(row.month, { ...(byMonth.get(row.month) || {}), ...row });
    });
    return {
      rows: [...byMonth.values()],
      indicators: Object.assign({}, ...parts.map((part) => part.indicators))
    };
  }
};

const updateProvinceMarkdown = (province, rows, baseMeta, sourceMeta) => {
  const file = path.join(provinceRoot, province, `${province}.md`);
  if (!fs.existsSync(file)) return;
  const format = (value) => value === null || value === undefined ? "—" : Number(value).toFixed(1);
  const ordered = rows.slice().sort((a, b) => b.month.localeCompare(a.month));
  const ids = [
    baseMeta?.indicators?.generation?.id,
    baseMeta?.indicators?.consumption?.id,
    ...Object.keys(sourceFieldLabels).map((field) => sourceMeta?.indicators?.[field]?.id)
  ].filter(Boolean);
  const section = [
    "## 月度发用电与分电源发电",
    "",
    "单位：亿千瓦时；均为当月值。`—` 表示数据库未返回可靠省级值，不等于 0。",
    "",
    "| 月份 | 总发电量 | 全社会用电量 | 火电 | 水电 | 核电 | 风电 | 光伏 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
    ...ordered.map((row) => `| ${row.month} | ${format(row.generation)} | ${format(row.consumption)} | ${format(row.thermal)} | ${format(row.hydro)} | ${format(row.nuclear)} | ${format(row.wind)} | ${format(row.solar)} |`),
    "",
    `- 来源：iFinD EDB（2026-07-16 提取）；指标 ID：${ids.join(" / ") || "未返回"}。`,
    "- 同比由同月当月值计算；网站端在具备上年同期观测时动态展示。",
    ""
  ].join("\n");
  let markdown = fs.readFileSync(file, "utf8");
  if (/\n## 月度发用电与分电源发电/.test(markdown)) {
    markdown = markdown.replace(/\n## 月度发用电与分电源发电[\s\S]*?(?=\n## 数据口径)/, `\n${section}`);
  } else {
    markdown = markdown.replace(/\n## 数据口径/, `\n${section}\n## 数据口径`);
  }
  const logLine = "- 2026-07-16：补充月度总发电、全社会用电及火电/水电/核电/风电/光伏发电量（来源：iFinD EDB，2026-07-16）。";
  if (!markdown.includes(logLine)) markdown = `${markdown.trimEnd()}\n${logLine}\n`;
  fs.writeFileSync(file, markdown, "utf8");
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

  const sourceCache = readCache(sourceCachePath);
  const sourceQueue = provinces.filter((province) => !sourceCache[province]?.rows?.length);
  let sourceCursor = 0;
  const sourceWorker = async () => {
    while (sourceCursor < sourceQueue.length) {
      const province = sourceQueue[sourceCursor++];
      try {
        sourceCache[province] = await fetchSourceProvince(province);
        saveCache(sourceCache, sourceCachePath);
        console.log(`[sources ${Object.keys(sourceCache).length}/${provinces.length}] ${province}: ${sourceCache[province].rows.length} months`);
      } catch (error) {
        sourceCache[province] = { rows: [], indicators: {}, error: String(error.message || error) };
        saveCache(sourceCache, sourceCachePath);
        console.error(`[sources failed] ${province}: ${error.message || error}`);
      }
    }
  };
  await Promise.all([sourceWorker(), sourceWorker()]);

  const workbench = readWorkbench();
  const annual = workbench.provinceInstalledCapacityAnnual || [];
  const capacityByProvinceMonth = new Map(annual.map((row) => [`${row.province}|${row.period.slice(0, 7)}`, row.total]));
  workbench.provincePowerMonthly = provinces.flatMap((province) => {
    const sourcesByMonth = new Map((sourceCache[province]?.rows || []).map((row) => [row.month, row]));
    const rows = (cache[province]?.rows || []).map((row) => ({
      ...row,
      thermal: sourcesByMonth.get(row.month)?.thermal ?? null,
      hydro: sourcesByMonth.get(row.month)?.hydro ?? null,
      nuclear: sourcesByMonth.get(row.month)?.nuclear ?? null,
      wind: sourcesByMonth.get(row.month)?.wind ?? null,
      solar: sourcesByMonth.get(row.month)?.solar ?? null,
      capacity: capacityByProvinceMonth.get(`${province}|${row.month}`) ?? null,
      capacityScope: capacityByProvinceMonth.has(`${province}|${row.month}`) ? "全口径年末装机" : null,
      dataSource: "iFinD EDB"
    }));
    updateProvinceMarkdown(province, rows, cache[province], sourceCache[province]);
    return rows;
  }).sort((a, b) => b.month.localeCompare(a.month) || a.province.localeCompare(b.province, "zh-Hans-CN"));
  workbench.provincePowerMonthlyMeta = Object.fromEntries(provinces.map((province) => [province, {
    available: Boolean(cache[province]?.rows?.length),
    error: cache[province]?.error || null
  }]));
  fs.writeFileSync(workbenchPath, `window.WORKBENCH_DATA = ${JSON.stringify(workbench, null, 4)};\n`, "utf8");

  console.log(JSON.stringify({
    provinces: provinces.length,
    provincesWithData: provinces.filter((province) => cache[province]?.rows?.length).length,
    rows: workbench.provincePowerMonthly.length,
    failed: provinces.filter((province) => !cache[province]?.rows?.length),
    sourceProvincesWithData: provinces.filter((province) => sourceCache[province]?.rows?.length).length,
    sourceFailed: provinces.filter((province) => !sourceCache[province]?.rows?.length)
  }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
