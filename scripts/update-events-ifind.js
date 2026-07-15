/**
 * 更新首页“未来 30 天事件日历”
 *
 * 本地执行：
 *   node scripts/update-events-ifind.js
 *
 * 只预览不写入：
 *   node scripts/update-events-ifind.js --dry-run
 *
 * 设计原则：
 * - iFinD 公告/资讯优先，用于捕捉最新公司公告、业绩预告、电价政策和煤价长协事件。
 * - iFinD 无结果或网络失败时，不覆盖旧数据，保留现有 eventsCalendar。
 * - 每次成功或失败都会写入 logs/events-calendar-latest.json，便于复盘。
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { call } = require("C:/Users/admin/.codex/skills/ifind-finance-data/call-node.js");

const root = path.resolve(__dirname, "..");
const dataFile = path.join(root, "assets", "workbench-data.js");
const logDir = path.join(root, "logs");
const logFile = path.join(logDir, "events-calendar-latest.json");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

const now = new Date();
const start = new Date(now);
const end = new Date(now);
end.setDate(end.getDate() + 30);

function fmtDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

const queryPlan = [
  {
    source: "iFinD公告",
    tool: "search_notice",
    query: "电力 公用事业 半年度业绩预告 发电量 售电量 公告",
    weight: 5
  },
  {
    source: "iFinD公告",
    tool: "search_notice",
    query: "长江电力 桂冠电力 黔源电力 国投电力 川投能源 发电量 售电量 来水",
    weight: 5
  },
  {
    source: "iFinD公告",
    tool: "search_notice",
    query: "代理购电 系统运行费 峰谷电价 煤电基准 长协煤 电价政策",
    weight: 4
  },
  {
    source: "iFinD资讯",
    tool: "search_news",
    query: "迎峰度夏 电力负荷 来水 水电 煤价 长协 电价 政策",
    weight: 3
  }
];

const fallbackEvents = [
  {
    date: "2026-07下旬",
    type: "公司电量",
    title: "水电公司 Q2 / 月度电量公告继续校准测算值",
    note: "长江电力、桂冠电力、黔源电力等已公告口径优先，未公告公司保留测算。",
    source: "本地规则"
  },
  {
    date: "2026-07下旬",
    type: "电价政策",
    title: "跟踪各省代理购电、系统运行费用与峰谷价差调整",
    note: "电价页保留分省明细，首页只提示是否出现盈利方向变化。",
    source: "本地规则"
  },
  {
    date: "2026-08上旬",
    type: "天气负荷",
    title: "迎峰度夏负荷、水库入库和现货价格联动验证",
    note: "重点观察高温负荷、来水边际、火电利用小时和现货溢价能否共振。",
    source: "本地规则"
  },
  {
    date: "2026-08中旬",
    type: "煤价长协",
    title: "煤价与长协调整影响火电度电毛利",
    note: "若煤价上行但电价不跟，火电盈利弹性需要下修。",
    source: "本地规则"
  }
];

const eventRules = [
  {
    type: "公司电量",
    pattern: /发电量|售电量|上网电量|电量|来水|水情/,
    priority: 5
  },
  {
    type: "中报预告",
    pattern: /业绩预告|半年度|中报|半年报|扭亏|预增|预减/,
    priority: 5
  },
  {
    type: "电价政策",
    pattern: /电价|代理购电|系统运行费|峰谷|煤电基准|容量电价|长协/,
    priority: 4
  },
  {
    type: "天气负荷",
    pattern: /迎峰度夏|负荷|高温|水库|入库|出库|汛期/,
    priority: 3
  },
  {
    type: "煤价长协",
    pattern: /煤价|长协煤|动力煤|燃料成本/,
    priority: 3
  }
];

const focusWords = [
  "长江电力",
  "桂冠电力",
  "黔源电力",
  "国投电力",
  "川投能源",
  "国电电力",
  "华能水电",
  "中国电力",
  "深南电A",
  "粤电力A",
  "申能股份",
  "浙能电力",
  "皖能电力",
  "华能国际",
  "华电国际",
  "大唐发电",
  "建投能源",
  "宝新能源",
  "川能动力",
  "电投水电",
  "代理购电",
  "系统运行费",
  "峰谷",
  "煤价",
  "长协",
  "迎峰度夏",
  "来水",
  "水电"
];

const policyThemePattern = /电价|代理购电|系统运行费|容量电价|煤价|长协|迎峰度夏|负荷|来水|水库|汛期/;
const excludePattern = /基金|招募说明书|通讯|通信|算力|电机|设备|燃气|天然气|必应|债券|可转债|评级/;

function ensureLogDir() {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
}

function loadWorkbenchData() {
  const source = fs.readFileSync(dataFile, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { filename: dataFile });
  if (!sandbox.window.WORKBENCH_DATA) {
    throw new Error("未能读取 WORKBENCH_DATA。");
  }
  return sandbox.window.WORKBENCH_DATA;
}

function writeWorkbenchData(data) {
  fs.writeFileSync(dataFile, `window.WORKBENCH_DATA = ${JSON.stringify(data, null, 4)};\n`, "utf8");
}

function writeLog(payload) {
  ensureLogDir();
  fs.writeFileSync(logFile, JSON.stringify(payload, null, 2), "utf8");
}

function parseIfindRows(result) {
  const text = result?.data?.result?.content?.[0]?.text;
  if (!text) return [];

  let outer;
  try {
    outer = JSON.parse(text);
  } catch {
    return [];
  }

  const raw = outer?.data?.data;
  if (!raw || typeof raw !== "string" || raw.startsWith("# 查询结果")) return [];

  try {
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function getFirst(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && String(row[name]).trim()) {
      return String(row[name]).trim();
    }
  }
  return "";
}

function inferType(title, content) {
  const text = `${title} ${content}`;
  const matched = eventRules.find((rule) => rule.pattern.test(text));
  return matched?.type || "公告资讯";
}

function scoreEvent(event, baseWeight = 0) {
  const text = `${event.title} ${event.note}`;
  const rule = eventRules.find((item) => item.type === event.type);
  const keywordScore = focusWords.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  return baseWeight + (rule?.priority || 1) + keywordScore;
}

function normalizeRow(row, plan) {
  const title = getFirst(row, ["公告标题", "标题", "新闻标题", "资讯标题"]);
  const note = getFirst(row, ["公告片段内容", "内容", "新闻内容", "资讯内容", "摘要"]);
  const date = getFirst(row, ["日期", "公告日期", "发布时间", "时间"]) || fmtDate(now);
  if (!title) return null;
  const text = `${title} ${note}`;
  if (excludePattern.test(text)) return null;
  const hasFocusCompanyOrKeyword = focusWords.some((word) => text.includes(word));
  if (!hasFocusCompanyOrKeyword && !policyThemePattern.test(text)) return null;

  const event = {
    date,
    type: inferType(title, note),
    title,
    note: note.replace(/\s+/g, " ").slice(0, 96),
    source: plan.source
  };
  event.score = scoreEvent(event, plan.weight);
  return event;
}

function mergeWithFallback(events) {
  const seen = new Set();
  const merged = [];
  for (const event of [...events, ...fallbackEvents]) {
    const key = `${event.date}-${event.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(event);
    if (merged.length >= 5) break;
  }
  return merged;
}

function dedupeAndRank(events) {
  const seen = new Set();
  return events
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .filter((event) => {
      const key = `${event.date}-${event.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 5)
    .map(({ score, ...event }) => event);
}

async function fetchIfindEvents() {
  const rows = [];
  const errors = [];

  for (const plan of queryPlan) {
    try {
      const result = await call("news", plan.tool, {
        query: plan.query,
        time_start: fmtDate(start),
        time_end: fmtDate(end),
        size: 8
      });

      if (!result?.ok) {
        errors.push({ query: plan.query, error: result?.error || "iFinD 返回失败" });
        continue;
      }

      const parsedRows = parseIfindRows(result);
      rows.push(...parsedRows.map((row) => normalizeRow(row, plan)));
    } catch (error) {
      errors.push({ query: plan.query, error: error.message });
    }
  }

  return {
    events: dedupeAndRank(rows),
    errors
  };
}

async function main() {
  const before = loadWorkbenchData();
  const previousEvents = Array.isArray(before.eventsCalendar) ? before.eventsCalendar : [];
  const result = await fetchIfindEvents();

  let status = "updated";
  let events = mergeWithFallback(result.events);
  let message = `iFinD 更新成功，生成 ${events.length} 条事件。`;

  if (!result.events.length) {
    status = "kept_previous";
    events = previousEvents.length ? previousEvents : fallbackEvents;
    message = "iFinD 没有返回可用事件，保留原事件日历。";
  }

  const logPayload = {
    status,
    dryRun,
    generatedAt: new Date().toISOString(),
    queryRange: {
      start: fmtDate(start),
      end: fmtDate(end)
    },
    eventCount: events.length,
    errors: result.errors,
    events
  };

  writeLog(logPayload);

  if (!dryRun && status === "updated") {
    const next = {
      ...before,
      eventsCalendar: events,
      freshness: {
        ...(before.freshness || {}),
        eventsCalendar: fmtDate(now)
      }
    };
    writeWorkbenchData(next);
  }

  console.log(message);
  console.log(`日志：${path.relative(root, logFile)}`);
  if (dryRun) console.log("dry-run 模式：未写入 workbench-data.js。");
}

main().catch((error) => {
  const fallbackMessage = {
    status: "failed",
    dryRun,
    generatedAt: new Date().toISOString(),
    error: error.message
  };
  writeLog(fallbackMessage);
  console.error(`事件日历更新失败：${error.message}`);
  process.exit(1);
});
