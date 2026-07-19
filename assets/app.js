(function () {
  const data = window.WORKBENCH_DATA;
  const consumptionData = window.CONSUMPTION_DATA || null;
  if (!data) return;

  const fmt = (value, digits = 0) => {
    if (value === null || value === undefined || value === "") return "-";
    return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
  };

  const formatTimeLabel = (value) => {
    const text = String(value ?? "");
    const range = text.match(/^(\d{4})-(\d{2})~(\d{2})$/);
    if (range) return `${range[1]}${range[2]}~${range[1]}${range[3]}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10).replace(/-/g, "");
    if (/^\d{4}-\d{2}$/.test(text)) return text.replace("-", "");
    return text;
  };

  const normalizeTimeText = (value) => String(value ?? "")
    .replace(/\b(\d{4})-(\d{2})~(\d{2})\b/g, "$1$2~$1$3")
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$1$2$3")
    .replace(/\b(\d{4})-(\d{2})\b/g, "$1$2");

  const pct = (value) => {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    const sign = number > 0 ? "+" : "";
    return `${sign}${number.toFixed(1)}%`;
  };

  const changePct = (current, previous) => {
    if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
    return Number(((current / previous - 1) * 100).toFixed(1));
  };

  const isoWeekEndDate = (year, week) => {
    const jan4 = new Date(Date.UTC(Number(year), 0, 4));
    const jan4Day = jan4.getUTCDay() || 7;
    const weekOneMonday = new Date(jan4);
    weekOneMonday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
    const weekEnd = new Date(weekOneMonday);
    weekEnd.setUTCDate(weekOneMonday.getUTCDate() + (Number(week) - 1) * 7 + 6);
    return weekEnd.toISOString().slice(0, 10);
  };

  const weekEndDate = (row) => row?.weekEnd || isoWeekEndDate(row?.isoYear, row?.isoWeek);

  const formatWeekFreshness = (value, fallbackRow) => {
    const match = String(value || "").match(/^(\d{4})-W(\d{1,2})$/i);
    if (match) return `截至 ${isoWeekEndDate(match[1], match[2])}`;
    if (value) return value;
    return fallbackRow ? `截至 ${weekEndDate(fallbackRow)}` : "-";
  };

  const toPctNumber = (value) => {
    if (value === null || value === undefined || value === "" || value === "-") return null;
    const number = Number(String(value).replace("%", "").replace("+", "").trim());
    return Number.isFinite(number) ? number : null;
  };

  const colorizePercentMarkup = (text) => {
    const escaped = String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
    return escaped.replace(/([+-]?\d+(?:\.\d+)?)%/g, (match, raw) => {
      const value = Number(raw);
      const className = value > 0 ? "pct-positive" : value < 0 ? "pct-negative" : "pct-neutral";
      return `<span class="${className}">${match}</span>`;
    });
  };

  const setText = (id, text) => {
    const node = document.getElementById(id);
    if (node) node.innerHTML = colorizePercentMarkup(normalizeTimeText(text));
  };

  const installPercentColorizer = () => {
    const colorize = (node) => {
      if (!node) return;
      if (node.nodeType === 3) {
        const parent = node.parentElement;
        if (!parent || parent.closest(".pct-positive, .pct-negative")) return;
        const text = node.nodeValue || "";
        const pattern = /([+-]?\d+(?:\.\d+)?)%/g;
        if (!pattern.test(text)) return;
        pattern.lastIndex = 0;
        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match;
        while ((match = pattern.exec(text))) {
          if (match.index > lastIndex) fragment.append(document.createTextNode(text.slice(lastIndex, match.index)));
          const span = document.createElement("span");
          const value = Number(match[1]);
          span.className = value > 0 ? "pct-positive" : value < 0 ? "pct-negative" : "pct-neutral";
          span.textContent = match[0];
          fragment.append(span);
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < text.length) fragment.append(document.createTextNode(text.slice(lastIndex)));
        parent.replaceChild(fragment, node);
        return;
      }
      if (node.nodeType !== 1 || node.matches("script, style, .pct-positive, .pct-negative")) return;
      [...node.childNodes].forEach(colorize);
    };
    colorize(document.body);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach(colorize));
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const enhanceWideTables = () => {
    document.querySelectorAll("table").forEach((table) => {
      const columnCount = table.querySelectorAll("thead tr:first-child th").length;
      if (columnCount < 4) return;

      let wrapper = table.closest(".table-scroll");
      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "table-scroll";
        table.parentNode.insertBefore(wrapper, table);
        wrapper.appendChild(table);
      }

      wrapper.classList.add("mobile-data-table", "auto-scroll-table");
      wrapper.style.setProperty("--auto-table-width", `${Math.max(640, columnCount * 110)}px`);
      wrapper.tabIndex = 0;
      wrapper.setAttribute("role", "region");
      wrapper.setAttribute("aria-label", "可左右滑动查看的完整数据表格");
    });
  };

  const chartInstances = new Map();
  const pendingCharts = new Map();
  const chartColors = ["#334e68", "#c85c54", "#2f7e86", "#d49a3a", "#7c78a7"];

  const renderChart = (id, option) => {
    const node = document.getElementById(id);
    if (!node) return null;
    if (!window.echarts) {
      pendingCharts.set(id, option);
      node.innerHTML = '<div class="chart-fallback">图表组件加载失败，明细数据仍可在下方表格查看。</div>';
      node.innerHTML = '<div class="chart-fallback">图表组件加载中，明细数据仍可在下方表格查看。</div>';
      return null;
    }
    pendingCharts.delete(id);
    const chart = chartInstances.get(id) || window.echarts.init(node, null, { renderer: "canvas" });
    chartInstances.set(id, chart);
    chart.setOption({
      color: chartColors,
      animationDuration: 500,
      textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif' },
      tooltip: { ...tooltipStyle, trigger: "axis", axisPointer: { type: "line" } },
      ...option
    }, true);
    return chart;
  };

  const flushPendingCharts = () => {
    if (!window.echarts || !pendingCharts.size) return;
    [...pendingCharts.entries()].forEach(([id, option]) => renderChart(id, option));
  };

  const waitForEcharts = () => {
    if (window.echarts) {
      flushPendingCharts();
      return;
    }
    const retry = window.setInterval(() => {
      if (!window.echarts) return;
      window.clearInterval(retry);
      flushPendingCharts();
    }, 160);
    window.setTimeout(() => window.clearInterval(retry), 6000);
  };

  const axisStyle = {
    axisLine: { lineStyle: { color: "#d9e2e7" } },
    axisTick: { show: false },
    axisLabel: { color: "#74808a", fontSize: 11, formatter: formatTimeLabel },
    splitLine: { lineStyle: { color: "#e8eef1" } }
  };

  const tooltipStyle = {
    trigger: "axis",
    backgroundColor: "rgba(45, 29, 27, .96)",
    borderWidth: 0,
    textStyle: { color: "#fff", fontSize: 12 },
    padding: [10, 12]
  };

  const singleStackItemTooltip = (unit, digits = 1) => ({
    ...tooltipStyle,
    trigger: "item",
    triggerOn: "mousemove",
    axisPointer: { type: "none" },
    formatter: (item) => {
      const rawValue = item.value;
      const value = rawValue === null || rawValue === undefined
        ? "-"
        : Number(rawValue).toLocaleString("zh-CN", { maximumFractionDigits: digits });
      const suffix = rawValue === null || rawValue === undefined ? "" : ` ${unit}`;
      return [
        `<strong style="display:block;margin-bottom:8px;font-size:14px">${item.seriesName}</strong>`,
        `<span style="display:flex;align-items:center;gap:8px">${item.marker}<span>${item.name}</span><strong style="margin-left:8px;font-size:14px">${value}${suffix}</strong></span>`
      ].join("");
    }
  });

  const uniqueSorted = (rows, field) => [...new Set(rows.map((row) => row[field]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

  const rangeOptions = [
    { value: "3", label: "近 3 个月" },
    { value: "6", label: "近 6 个月" },
    { value: "12", label: "近 1 年" },
    { value: "24", label: "近 2 年" }
  ];

  const filterRowsByMonths = (rows, field, months) => {
    if (!Array.isArray(rows) || !rows.length) return rows || [];
    const normalized = rows.map((row) => String(row[field] || "").slice(0, 10)).filter(Boolean).sort();
    const latest = new Date(`${normalized.at(-1)}T00:00:00Z`);
    if (Number.isNaN(latest.getTime())) return rows;
    const cutoff = new Date(latest);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - Number(months));
    const cutoffText = cutoff.toISOString().slice(0, field === "month" ? 7 : 10);
    return rows.filter((row) => String(row[field] || "").slice(0, field === "month" ? 7 : 10) >= cutoffText);
  };

  const setupPageRange = (id, storageKey, mappings, defaultMonths = "12") => {
    const select = document.getElementById(id);
    if (!select) return;
    const selected = sessionStorage.getItem(storageKey) || defaultMonths;
    select.innerHTML = rangeOptions.map((option) => `<option value="${option.value}">${option.label}</option>`).join("");
    select.value = rangeOptions.some((option) => option.value === selected) ? selected : defaultMonths;
    mappings.forEach(({ key, field }) => {
      if (Array.isArray(data[key])) data[key] = filterRowsByMonths(data[key], field, select.value);
    });
    select.addEventListener("change", () => {
      sessionStorage.setItem(storageKey, select.value);
      location.reload();
    });
  };

  const setSelectOptions = (select, options, preferred) => {
    if (!select) return null;
    select.innerHTML = options.map((option) => `<option value="${option}">${option}</option>`).join("");
    const value = options.includes(preferred) ? preferred : options[0];
    select.value = value || "";
    return select.value;
  };

  const avg = (rows, field) => {
    const values = rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined && value !== "");
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + Number(value), 0) / values.length;
  };

  const riverSignal = (avg7d, qtd) => {
    if (avg7d === null || qtd === null || !qtd) return "-";
    const diff = (avg7d / qtd - 1) * 100;
    if (diff >= 10) return "边际改善";
    if (diff <= -10) return "边际回落";
    return "基本持平";
  };

  const buildRiverQtd = () => {
    if (!data.hydroQtdMetrics) return [];
    const groups = {};
    data.hydroQtdMetrics.forEach((row) => {
      if (!groups[row.river]) groups[row.river] = [];
      groups[row.river].push(row);
    });
    return Object.entries(groups).map(([river, rows]) => {
      const latest = avg(rows, "latestInflow");
      const avg7d = avg(rows, "avg7dInflow");
      const avg14d = avg(rows, "avg14dInflow");
      const qtd = avg(rows, "qtdInflow");
      return {
        river,
        stationCount: rows.length,
        latestInflow: latest,
        avg7dInflow: avg7d,
        avg14dInflow: avg14d,
        qtdInflow: qtd,
        signal: riverSignal(avg7d, qtd)
      };
    }).sort((a, b) => (b.qtdInflow || 0) - (a.qtdInflow || 0));
  };

  const renderDashboard = () => {
    const latestWeek = data.hydroWeeklyLatest[0];
    const threeGorges = data.hydroWeeklyLatest.find((row) => row.station === "三峡") || latestWeek;
    const latestHour = data.hydroHourlyLatest[0];
    const latestSpot = data.spotWeeklyLatest?.[0];
    const latestProxy = data.proxyPurchaseLatest?.[0];
    const latestPower = data.powerConsumptionMonthly?.[0];
    const latestCapacity = data.installedCapacityMonthly?.[0];
    const hydroCount = data.hydroWeeklyLatest.length;
    const avgSpot = data.spotWeeklyLatest.reduce((sum, row) => sum + row.spotAvg, 0) / data.spotWeeklyLatest.length;
    const freshness = data.freshness || {};
    const latestPriceDate = freshness.dayAheadDaily || freshness.spotWeekly || (latestSpot ? weekEndDate(latestSpot) : "-");

    setText("metric-hydro-signal", isoWeekEndDate(latestWeek.isoYear, latestWeek.isoWeek));
    setText("metric-hydro-note", `${hydroCount} 个周度电站快照，${threeGorges.station}入库 ${fmt(threeGorges.inflow)} m3/s，同比 ${pct(threeGorges.inflowYoy)}`);
    setText("metric-spot", `${fmt(avgSpot, 0)}`);
    setText("metric-spot-note", `最新电价数据截至 ${latestPriceDate}，单位元/MWh`);
    setText("metric-power", latestPower?.month || latestCapacity?.month || "月度");
    setText("metric-power-note", latestPower && latestCapacity ? `全国全社会用电 ${fmt(latestPower.total)} 亿kWh；装机 ${fmt(latestCapacity.total / 10000, 1)} 亿kW` : "全国用电、发电、装机结构联动");

    setText("freshness-snapshot", data.updatedAt);
    setText("freshness-hydro-week", data.updatedAt || formatWeekFreshness(freshness.hydroWeekly, latestWeek));
    setText("freshness-hydro-hour", String(freshness.hydroHourly || latestHour.time || "").slice(0, 10));
    setText("freshness-weather", window.WEATHER_DATA?.weekEnd ? `截至 ${window.WEATHER_DATA.weekEnd}` : "-");
    setText("freshness-spot", `截至 ${latestPriceDate}`);
    setText("freshness-proxy", freshness.proxyMonthly || latestProxy?.month || "-");
    const latestConsumption = consumptionData?.nationalUtilization
      ? [...consumptionData.nationalUtilization].reverse().find((row) => row.windCumulativeRate !== null && row.solarCumulativeRate !== null)
      : null;
    setText("freshness-consumption", consumptionData?.freshness?.cumulativeRate || "-");
    setText("metric-consumption", latestConsumption
      ? `风 ${fmt(latestConsumption.windCumulativeRate, 1)}% · 光 ${fmt(latestConsumption.solarCumulativeRate, 1)}%`
      : "月度");
    setText("metric-consumption-note", latestConsumption
      ? `${latestConsumption.month} 全国累计利用率`
      : "全国与省级风光利用率");

    const riverQtd = buildRiverQtd();
    const strongestRiver = [...riverQtd]
      .filter((row) => row.qtdInflow && row.avg7dInflow)
      .sort((a, b) => (b.avg7dInflow / b.qtdInflow) - (a.avg7dInflow / a.qtdInflow))[0];
    const goodHydroStations = data.hydroWeeklyLatest
      .filter((row) => Number(row.inflowYoy) > 0 && Number(row.inflow) > 0)
      .sort((a, b) => Number(b.inflowYoy) - Number(a.inflowYoy))
      .slice(0, 3);
    const goodPriceRows = data.spotWeeklyLatest
      .map((row) => ({ ...row, spread: Number(row.spotAvg) - Number(row.coalBenchmark) }))
      .filter((row) => Number.isFinite(row.spread) && row.spread > 0)
      .sort((a, b) => b.spread - a.spread)
      .slice(0, 4);
    const benchmarkValues = data.spotWeeklyLatest
      .map((row) => Number(row.coalBenchmark))
      .filter(Number.isFinite);
    const avgBenchmark = benchmarkValues.length
      ? benchmarkValues.reduce((sum, value) => sum + value, 0) / benchmarkValues.length
      : null;
    const spotSpread = avgBenchmark ? avgSpot - avgBenchmark : null;
    const hydroPhrase = goodHydroStations.length
      ? `${goodHydroStations.slice(0, 2).map((row) => row.station).join("、")}来水同比改善`
      : strongestRiver
        ? `${strongestRiver.river}近 7 日较 QTD ${strongestRiver.avg7dInflow >= strongestRiver.qtdInflow ? "改善" : "基本持平"}`
        : "重点流域等待更多样本";
    const pricePhrase = goodPriceRows.length
      ? `${goodPriceRows.slice(0, 2).map((row) => row.province).join("、")}现货溢价靠前`
      : spotSpread === null
        ? "现货价格继续观察"
        : `样本省份现货均价较煤电基准${spotSpread >= 0 ? "高" : "低"} ${fmt(Math.abs(spotSpread), 0)} 元/MWh`;
    const dayAheadWeeks = [...new Set((data.dayAheadWeeklyHistory || []).map((row) => row.weekStart))].sort().reverse();
    const latestDayAheadWeek = dayAheadWeeks[0];
    const previousDayAheadWeek = dayAheadWeeks[1];
    const latestDayAheadRows = (data.dayAheadWeeklyHistory || []).filter((row) => row.weekStart === latestDayAheadWeek);
    const previousDayAheadMap = new Map(
      (data.dayAheadWeeklyHistory || [])
        .filter((row) => row.weekStart === previousDayAheadWeek)
        .map((row) => [row.province, row])
    );
    const comparableDayAheadRows = latestDayAheadRows.filter((row) => previousDayAheadMap.has(row.province));
    const latestDayAheadAvg = comparableDayAheadRows.length
      ? comparableDayAheadRows.reduce((sum, row) => sum + Number(row.dayAheadAvg), 0) / comparableDayAheadRows.length
      : null;
    const previousDayAheadAvg = comparableDayAheadRows.length
      ? comparableDayAheadRows.reduce((sum, row) => sum + Number(previousDayAheadMap.get(row.province).dayAheadAvg), 0) / comparableDayAheadRows.length
      : null;
    const dayAheadWow = latestDayAheadAvg !== null && previousDayAheadAvg
      ? (latestDayAheadAvg / previousDayAheadAvg - 1) * 100
      : null;
    const dayAheadLeaders = [...latestDayAheadRows]
      .sort((a, b) => Number(b.dayAheadAvg) - Number(a.dayAheadAvg))
      .slice(0, 3);
    const dayAheadDayCounts = latestDayAheadRows.map((row) => Number(row.nDays)).filter(Number.isFinite);
    const dayAheadMinDays = dayAheadDayCounts.length ? Math.min(...dayAheadDayCounts) : null;
    const dayAheadMaxDays = dayAheadDayCounts.length ? Math.max(...dayAheadDayCounts) : null;
    const dayAheadDirection = dayAheadWow === null ? "等待完整数据" : dayAheadWow >= 0 ? "小幅上行" : "有所回落";
    const dayAheadPhrase = dayAheadLeaders.length
      ? `本周日前电价${dayAheadDirection}，${dayAheadLeaders.map((row) => row.province).join("、")}居前`
      : "本周日前电价等待更新";
    const capacityDemandGap = latestPower && latestCapacity
      ? Number(latestCapacity.totalYoy || 0) - Number(latestPower.totalYoy || 0)
      : null;
    const powerPhrase = capacityDemandGap === null
      ? "供需数据等待补充"
      : capacityDemandGap > 0
        ? "装机增速仍快于用电，供需总体偏松"
        : "用电增速快于装机，供需边际收紧";
    setText("weekly-brief-title", `${hydroPhrase}，${pricePhrase}`);
    setText("weekly-brief-note", goodPriceRows.length
      ? "正向信号来自两条线：来水看同比改善电站，电价看现货均价高于煤电基准的省份。"
      : "现货、来水和代理购电采用各自最新可得口径，不将旧数据冒充本周数据。");
    setText("watch-hydro-title", hydroPhrase);
    setText("watch-hydro", goodHydroStations.length
      ? goodHydroStations.map((row) => `${row.station}同比 ${pct(row.inflowYoy)}`).join("；") + "。"
      : strongestRiver ? `${strongestRiver.river}：近7日 ${fmt(strongestRiver.avg7dInflow)}，QTD ${fmt(strongestRiver.qtdInflow)} m3/s。` : "比较近 7 日、近 14 日和 QTD 来水。");
    setText("watch-price-title", dayAheadPhrase);
    setText("watch-price", latestDayAheadRows.length
      ? `截至 ${latestPriceDate}，${latestDayAheadRows.length} 省样本均价 ${fmt(latestDayAheadAvg, 0)} 元/MWh，较上周 ${pct(dayAheadWow)}；${dayAheadLeaders.map((row) => `${row.province} ${fmt(row.dayAheadAvg, 0)}`).join("、")} 元/MWh。本周样本仅 ${dayAheadMinDays === dayAheadMaxDays ? dayAheadMinDays : `${dayAheadMinDays}—${dayAheadMaxDays}`} 个有效日。`
      : "本周日前电价数据等待更新。");
    setText("watch-power-title", powerPhrase);
    setText("watch-power", latestPower && latestCapacity ? `${String(latestPower.month).replace("-", "")}用电同比 ${pct(latestPower.totalYoy)}；${String(latestCapacity.month).replace("-", "")}装机同比 ${pct(latestCapacity.totalYoy)}，增速差 ${fmt(capacityDemandGap, 1)}pct。` : "全国全社会用电量、规上发电量和装机共同验证供需。");

    const hydroEdge = strongestRiver?.qtdInflow
      ? ((Number(strongestRiver.avg7dInflow || 0) / Number(strongestRiver.qtdInflow)) - 1) * 100
      : null;
    const demandEdge = latestPower?.totalYoy === null || latestPower?.totalYoy === undefined
      ? null
      : Number(latestPower.totalYoy);
    const temperatureRows = [
      {
        name: "用电需求",
        raw: demandEdge === null ? "-" : pct(demandEdge),
        status: demandEdge === null ? "等待数据" : demandEdge >= 5 ? "需求偏强" : demandEdge <= 0 ? "需求偏弱" : "需求平稳",
        tone: demandEdge === null ? "neutral" : demandEdge >= 5 ? "tight" : demandEdge <= 0 ? "loose" : "neutral",
        detail: latestPower ? `${latestPower.month} 全社会用电同比` : "暂无最新用电数据"
      },
      {
        name: "新增供给",
        raw: capacityDemandGap === null ? "-" : `${capacityDemandGap >= 0 ? "装机快" : "用电快"} ${Math.abs(capacityDemandGap).toFixed(1)} pct`,
        status: capacityDemandGap >= 2 ? "供给宽松" : capacityDemandGap <= -2 ? "供给偏紧" : "供需同步",
        tone: capacityDemandGap >= 2 ? "loose" : capacityDemandGap <= -2 ? "tight" : "neutral",
        detail: "装机增速与用电增速之差"
      },
      {
        name: "现货价格",
        raw: spotSpread === null ? "-" : `${spotSpread >= 0 ? "+" : ""}${fmt(spotSpread, 0)} 元/MWh`,
        status: spotSpread === null ? "等待数据" : spotSpread >= 20 ? "价格偏强" : spotSpread <= -20 ? "价格偏弱" : "价格平稳",
        tone: spotSpread === null ? "neutral" : spotSpread >= 20 ? "tight" : spotSpread <= -20 ? "loose" : "neutral",
        detail: "样本省份现货均价较煤电基准"
      },
      {
        name: "水电供给",
        raw: hydroEdge === null ? "-" : `${hydroEdge >= 0 ? "+" : ""}${hydroEdge.toFixed(1)}%`,
        status: hydroEdge === null ? "等待数据" : hydroEdge >= 5 ? "来水改善" : hydroEdge <= -5 ? "来水偏弱" : "来水持平",
        tone: hydroEdge === null ? "neutral" : hydroEdge >= 5 ? "loose" : hydroEdge <= -5 ? "tight" : "neutral",
        detail: "重点流域近 7 日来水较 QTD"
      }
    ];
    const tightSignals = temperatureRows.filter((row) => row.tone === "tight");
    const looseSignals = temperatureRows.filter((row) => row.tone === "loose");
    const temperatureSignal = tightSignals.length && looseSignals.length
      ? "信号分化"
      : tightSignals.length >= 2
        ? "供需偏紧"
        : looseSignals.length >= 2
          ? "供需偏松"
          : "总体均衡";
    const temperatureSummary = tightSignals.length && looseSignals.length
      ? `${tightSignals.map((row) => row.name).join("、")}偏紧；${looseSignals.map((row) => row.name).join("、")}偏松。`
      : tightSignals.length
        ? `偏紧信号主要来自${tightSignals.map((row) => row.name).join("、")}。`
        : looseSignals.length
          ? `偏松信号主要来自${looseSignals.map((row) => row.name).join("、")}。`
          : "四项指标暂未形成一致方向。";
    setText("metric-power", capacityDemandGap === null ? "月度" : `${capacityDemandGap >= 0 ? "装机快" : "用电快"}${Math.abs(capacityDemandGap).toFixed(1)}pct`);
    setText("metric-power-note", latestPower && latestCapacity
      ? `${latestPower.month} 用电同比 ${pct(latestPower.totalYoy)}，装机同比 ${pct(latestCapacity.totalYoy)}`
      : "装机增速与用电增速差、偏紧省份");

    const temperatureBoard = document.getElementById("home-temperature-chart");
    if (temperatureBoard) {
      temperatureBoard.innerHTML = `
        <div class="signal-overview">
          <span>综合判断</span>
          <strong>${temperatureSignal}</strong>
          <p>${temperatureSummary}</p>
        </div>
        <div class="home-signal-list">
          ${temperatureRows.map((row) => `
            <article class="home-signal-item">
              <div class="home-signal-item-head">
                <span>${row.name}</span>
                <em class="signal-status ${row.tone}">${row.status}</em>
              </div>
              <strong>${row.raw}</strong>
              <p>${row.detail}</p>
            </article>
          `).join("")}
        </div>
      `;
    }

    const eventList = document.getElementById("home-event-list");
    if (eventList) {
      const rows = (data.eventsCalendar || []).slice(0, 5);
      eventList.innerHTML = rows.length ? rows.map((event) => `
        <article class="event-item">
          <span>${event.date}</span>
          <div>
            <strong>${event.type}｜${event.title}</strong>
            <p>${event.note}</p>
          </div>
        </article>
      `).join("") : '<div class="event-item"><span>-</span><strong>暂无未来 30 天事件</strong></div>';
    }
  };

  const renderDataCatalog = () => {
    const p0Datasets = [...data.datasets.p0, ...(consumptionData?.datasets || [])];
    setText("summary-p0-count", `${p0Datasets.length}`);
    setText("summary-p1-count", `${data.datasets.p1.length}`);
    setText("summary-updated", data.updatedAt);

    const p0Body = document.getElementById("p0-dataset-body");
    if (p0Body) {
      p0Body.innerHTML = p0Datasets.map((row) => `
        <tr>
          <td>${row.module}</td>
          <td><code>${row.name}</code></td>
          <td>${row.grain}</td>
          <td>${row.status}</td>
        </tr>
      `).join("");
    }
  };

  const renderHydroPage = () => {
    const latestWeek = data.hydroWeeklyLatest[0];
    const latestHour = data.hydroHourlyLatest[0];
    const threeGorges = data.hydroWeeklyLatest.find((row) => row.station === "三峡") || latestWeek;
    const riverQtd = buildRiverQtd();
    const focusQtd = riverQtd.find((row) => row.river === "雅砻江") || riverQtd.find((row) => row.river === "大渡河") || riverQtd[0];

    setText("hydro-page-week", weekEndDate(latestWeek));
    setText("hydro-page-week-note", `三峡入库 ${fmt(threeGorges.inflow)} m3/s，同比 ${pct(threeGorges.inflowYoy)}，周度样本 ${data.hydroWeeklyLatest.length} 个`);
    setText("hydro-page-hour", latestHour.time.slice(5));
    setText("hydro-page-hour-note", `${latestHour.river} ${latestHour.station} 入库 ${fmt(latestHour.inflow)} m3/s`);
    if (focusQtd) {
      setText("hydro-page-qtd", `${focusQtd.river} ${fmt(focusQtd.qtdInflow)}`);
      setText("hydro-page-qtd-note", `近7日 ${fmt(focusQtd.avg7dInflow)}；近14日 ${fmt(focusQtd.avg14dInflow)}；${focusQtd.signal}`);
    }

    const freshness = data.freshness || {};
    setText("hydro-freshness-snapshot", data.updatedAt);
    setText("hydro-freshness-week", formatWeekFreshness(freshness.hydroWeekly, latestWeek));
    setText("hydro-freshness-hour", freshness.hydroHourly || latestHour.time);

    const historyRows = data.hydroWeeklyHistory || [];
    const trendSelect = document.getElementById("hydro-trend-station");
    const trendStations = uniqueSorted(historyRows, "station");
    const renderTrendChart = (station) => {
      const rows = historyRows
        .filter((row) => row.station === station)
        .sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)));
      const inflowByWeek = new Map(rows.map((row) => [`${row.isoYear}-${row.isoWeek}`, row.inflow]));
      const inflowYoyRaw = rows.map((row) => {
        if (row.inflowYoy !== null && row.inflowYoy !== undefined) return Number(row.inflowYoy);
        const priorInflow = inflowByWeek.get(`${row.isoYear - 1}-${row.isoWeek}`);
        if (row.inflow === null || row.inflow === undefined || Number(row.inflow) <= 0 || priorInflow === null || priorInflow === undefined || Number(priorInflow) <= 0) return null;
        return Number((((Number(row.inflow) / Number(priorInflow)) - 1) * 100).toFixed(1));
      });
      const validYoy = inflowYoyRaw.filter((value) => value !== null);
      const yoyAxisMax = Math.min(300, Math.max(50, Math.ceil((Math.max(...validYoy.map((value) => Math.abs(value)), 50) * 1.1) / 25) * 25));
      const inflowYoy = inflowYoyRaw.map((rawValue) => {
        if (rawValue === null) return null;
        const clippedValue = Math.max(-yoyAxisMax, Math.min(yoyAxisMax, rawValue));
        return { value: clippedValue, rawValue, clipped: clippedValue !== rawValue };
      });
      renderChart("hydro-trend-chart", {
        tooltip: {
          ...tooltipStyle,
          formatter: (params) => {
            const items = Array.isArray(params) ? params : [params];
            const lines = [items[0]?.axisValueLabel || items[0]?.name || ""];
            items.forEach((item) => {
              const isYoy = item.seriesName === "入库同比";
              const rawValue = isYoy && item.data && typeof item.data === "object" ? item.data.rawValue : item.value;
              const display = rawValue === null || rawValue === undefined
                ? "-"
                : (isYoy ? pct(rawValue) : `${fmt(rawValue)} m3/s`);
              lines.push(`${item.marker}${item.seriesName}：${display}`);
            });
            return lines.join("<br>");
          }
        },
        legend: { top: 12, right: 22, textStyle: { color: "#74808a", fontSize: 11 } },
        grid: { left: 62, right: 68, top: 58, bottom: 72 },
        xAxis: { type: "category", boundaryGap: false, data: rows.map((row) => row.weekStart), ...axisStyle },
        yAxis: [
          { type: "value", name: "m3/s", nameTextStyle: { color: "#74808a" }, ...axisStyle },
          { type: "value", name: "同比", position: "right", min: -yoyAxisMax, max: yoyAxisMax, nameTextStyle: { color: "#c85c54" }, ...axisStyle, axisLabel: { color: "#c85c54", fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } }
        ],
        dataZoom: [
          { type: "inside", start: 0, end: 100 },
          { type: "slider", start: 0, end: 100, height: 18, bottom: 18, borderColor: "#d9e2e7", fillerColor: "rgba(96,125,152,.16)" }
        ],
        series: [
          { name: "入库", type: "line", smooth: true, showSymbol: false, data: rows.map((row) => row.inflow), lineStyle: { width: 2.5 }, areaStyle: { opacity: .08 }, tooltip: { valueFormatter: (value) => `${fmt(value)} m3/s` } },
          { name: "出库", type: "line", smooth: true, showSymbol: false, data: rows.map((row) => row.outflow), lineStyle: { width: 1.5, type: "dashed" }, tooltip: { valueFormatter: (value) => `${fmt(value)} m3/s` } },
          { name: "入库同比", type: "line", yAxisIndex: 1, smooth: true, showSymbol: true, symbol: "circle", symbolSize: (value, params) => params.data?.clipped ? 8 : 0, connectNulls: false, data: inflowYoy, itemStyle: { color: "#c85c54" }, lineStyle: { color: "#c85c54", width: 1.8 }, markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "rgba(197,166,111,.35)", type: "dashed" }, data: [{ yAxis: 0 }] } }
        ]
      });
    };
    if (trendSelect && trendStations.length) {
      const preferredTrend = trendStations.includes("三峡") ? "三峡" : trendStations[0];
      setSelectOptions(trendSelect, trendStations, preferredTrend);
      trendSelect.addEventListener("change", () => renderTrendChart(trendSelect.value));
      renderTrendChart(preferredTrend);
    }

    const riverChartRows = riverQtd.slice(0, 8);
    renderChart("hydro-river-chart", {
      tooltip: { ...tooltipStyle, valueFormatter: (value) => `${fmt(value)} m3/s` },
      legend: { top: 10, right: 16, textStyle: { color: "#74808a", fontSize: 10 } },
      grid: { left: 46, right: 18, top: 52, bottom: 48 },
      xAxis: { type: "category", data: riverChartRows.map((row) => row.river), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, rotate: 26 } },
      yAxis: { type: "value", ...axisStyle },
      series: [
        { name: "近7日", type: "bar", barMaxWidth: 16, data: riverChartRows.map((row) => row.avg7dInflow), itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: "近14日", type: "bar", barMaxWidth: 16, data: riverChartRows.map((row) => row.avg14dInflow), itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: "QTD", type: "line", smooth: true, symbolSize: 6, data: riverChartRows.map((row) => row.qtdInflow) }
      ]
    });

    const renderHydroStationChart = (river) => {
      const rows = (data.hydroQtdMetrics || [])
        .filter((row) => !river || row.river === river)
        .sort((a, b) => (b.qtdInflow || 0) - (a.qtdInflow || 0))
        .slice(0, 10)
        .reverse();
      const delta = rows.map((row) => {
        if (row.avg7dInflow == null || row.qtdInflow == null || row.qtdInflow === 0) return null;
        return ((row.avg7dInflow - row.qtdInflow) / row.qtdInflow) * 100;
      });
      renderChart("hydro-station-chart", {
        tooltip: {
          ...tooltipStyle,
          trigger: "axis",
          axisPointer: { type: "shadow" },
          formatter: (params) => {
            const row = rows[params[0]?.dataIndex] || {};
            const diff = delta[params[0]?.dataIndex];
            return [
              `<strong>${row.station || ""}</strong>`,
              `近7日：${fmt(row.avg7dInflow)} m3/s`,
              `近14日：${fmt(row.avg14dInflow)} m3/s`,
              `QTD：${fmt(row.qtdInflow)} m3/s`,
              `较QTD：${diff == null ? "-" : pct(diff)}`
            ].join("<br>");
          }
        },
        legend: { top: 10, right: 16, textStyle: { color: "#74808a", fontSize: 10 } },
        grid: { left: 18, right: 42, top: 52, bottom: 28, containLabel: true },
        xAxis: { type: "value", ...axisStyle },
        yAxis: { type: "category", data: rows.map((row) => row.station), ...axisStyle },
        series: [
          { name: "近7日", type: "bar", barMaxWidth: 10, data: rows.map((row) => row.avg7dInflow), itemStyle: { borderRadius: [0, 4, 4, 0] } },
          { name: "近14日", type: "bar", barMaxWidth: 10, data: rows.map((row) => row.avg14dInflow), itemStyle: { borderRadius: [0, 4, 4, 0] } },
          { name: "QTD", type: "scatter", symbol: "diamond", symbolSize: 9, data: rows.map((row, index) => [row.qtdInflow, index]) },
          {
            name: "近7日较QTD",
            type: "scatter",
            symbolSize: 0,
            data: rows.map((row, index) => [Math.max(row.avg7dInflow || 0, row.avg14dInflow || 0, row.qtdInflow || 0), index]),
            label: {
              show: true,
              position: "right",
              color: "#74808a",
              fontSize: 10,
              formatter: (params) => delta[params.dataIndex] == null ? "" : pct(delta[params.dataIndex])
            },
            tooltip: { show: false }
          }
        ]
      });
    };
    renderHydroStationChart(null);

    const companyGeneration = [
      {
        name: "长江电力", unit: "亿kWh", confidence: "公告值", mae: "原前瞻高估 3.0%", range: "公告 709.19",
        insight: "2026Q2 公司总发电量已公告为 709.19 亿kWh，同比 +2.82%；原前瞻 730.7 亿kWh已替换为公告真值。",
        periods: ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2"],
        values: [576.79, 689.77, 1084.70, 720.68, 618.25, 709.19],
        lastValueType: "公告实际"
      },
      {
        name: "国投/川投·雅砻江", unit: "亿kWh", confidence: "较高", mae: "3.2%", range: "141–151",
        insight: "雅砻江延续偏枯，国投并表水电与川投投资收益均承压。",
        periods: ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2E"],
        values: [232.37, 197.63, 283.09, 158.43, 209.29, 145.90],
        lastValueType: "测算值"
      },
      {
        name: "国电电力·大渡河", unit: "亿kWh", confidence: "较高", mae: "3.8%", range: "106–114",
        insight: "大渡河三站同窗出力偏弱，Q2 售电量预计同比约 -12%。",
        periods: ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2E"],
        values: [56.51, 125.45, 184.99, 84.49, 62.13, 110.00],
        lastValueType: "测算值"
      },
      {
        name: "桂冠电力", unit: "亿kWh", confidence: "公告值", mae: "事前模型低估 3.2%", range: "公告 113.75",
        insight: "2026Q2 水电发电量已公告为 113.75 亿kWh，同比约 +57.8%；原事前模型 110.1 亿kWh。",
        periods: ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2"],
        values: [63.15, 72.07, 146.35, 134.11, 99.52, 113.75],
        lastValueType: "公告实际"
      },
      {
        name: "黔源电力", unit: "亿kWh", confidence: "公告值", mae: "代理前瞻高估 4.8%", range: "公告约 24.27",
        insight: "2026H1 发电量已公告 40.36 亿kWh，由 Q1 16.08 亿kWh推算 Q2 约 24.27 亿kWh，落在原 24–27 亿kWh区间下沿。",
        periods: ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2"],
        values: [13.63, 15.19, 44.93, 40.78, 16.08, 24.27],
        lastValueType: "公告实际"
      },
      {
        name: "湖北能源", unit: "亿kWh", confidence: "公告值", mae: "原区间上沿仍低 3.3%", range: "公告约 50.63",
        insight: "2026H1 水电发电量已公告 85.51 亿kWh，由 Q1 34.88 亿kWh推算 Q2 约 50.63 亿kWh，6 月弹性明显强于原乐观情景。",
        periods: ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2"],
        values: [18.79, 26.88, 33.60, 33.22, 34.88, 50.63],
        lastValueType: "公告实际"
      },
      {
        name: "五凌电力", unit: "亿kWh", confidence: "观察", mae: "未形成完整Q2", range: "4–5月 54.79",
        insight: "2026Q2 仅披露 4–5 月，累计 54.79 亿kWh、同比 +130.3%；不与完整季度横向排名。",
        periods: ["2025Q1", "2025Q2", "2025Q3", "2025Q4", "2026Q1", "2026Q2·4–5月"],
        values: [34.80, 47.37, 62.69, 37.96, 40.71, 54.79], partialLast: true, lastValueType: "公告部分"
      }
    ];

    const generationYoy = (company) => company.values.map((value, index) => {
      if (index < 4 || value === null || value === undefined) return null;
      const base = company.values[index - 4];
      return base ? Number((((value / base) - 1) * 100).toFixed(1)) : null;
    });

    const companySelect = document.getElementById("hydro-company-select");
    const companyNote = document.getElementById("hydro-company-generation-note");
    const renderCompanyGeneration = (companyName) => {
      const company = companyGeneration.find((item) => item.name === companyName) || companyGeneration[0];
      const yoy = generationYoy(company);
      const barData = company.values.map((value, index) => {
        const isLast = index === company.values.length - 1;
        const isEstimate = isLast && company.lastValueType === "测算值";
        return {
          value,
          itemStyle: isEstimate
            ? { color: "#d49a3a", borderColor: "#334e68", borderWidth: 2, borderType: "dashed", borderRadius: [5, 5, 0, 0] }
            : { color: "#334e68", borderRadius: [5, 5, 0, 0] }
        };
      });
      renderChart("hydro-company-generation-chart", {
        tooltip: {
          ...tooltipStyle,
          formatter: (params) => {
            const items = Array.isArray(params) ? params : [params];
            const lines = [items[0]?.axisValueLabel || ""];
            items.forEach((item) => {
              const suffix = item.seriesName === "同比" ? "%" : ` ${company.unit}`;
              lines.push(`${item.marker}${item.seriesName}：${item.value === null || item.value === undefined ? "-" : fmt(item.value, 1)}${item.value === null || item.value === undefined ? "" : suffix}`);
            });
            return lines.join("<br>");
          }
        },
        legend: { top: 4, right: 12, itemWidth: 20, itemHeight: 10, textStyle: { color: "#74808a", fontSize: 11 } },
        grid: { left: 54, right: 50, top: 42, bottom: 32 },
        xAxis: { type: "category", data: company.periods, ...axisStyle },
        yAxis: [
          { type: "value", name: company.unit, splitNumber: 4, nameTextStyle: { color: "#74808a" }, ...axisStyle },
          { type: "value", position: "right", splitNumber: 4, ...axisStyle, axisLabel: { color: "#c85c54", fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } }
        ],
        series: [
          { name: "季度电量", type: "bar", barMaxWidth: 28, data: barData },
          { name: "同比", type: "line", yAxisIndex: 1, smooth: true, symbol: "circle", symbolSize: 7, data: yoy, itemStyle: { color: "#d49a3a" }, lineStyle: { color: "#d49a3a", width: 2 }, markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "rgba(197,166,111,.35)", type: "dashed" }, data: [{ yAxis: 0 }] } }
        ]
      });
      if (companyNote) companyNote.textContent = `${company.insight} 最新季度口径：${company.lastValueType || "测算值"}；区间/真值：${company.range} ${company.unit}；状态：${company.confidence}；误差备注：${company.mae}。`;
    };
    if (companySelect) {
      setSelectOptions(companySelect, companyGeneration.map((item) => item.name), companyGeneration[0].name);
      companySelect.addEventListener("change", () => renderCompanyGeneration(companySelect.value));
      renderCompanyGeneration(companyGeneration[0].name);
    }

    const rankRows = companyGeneration
      .filter((company) => !company.partialLast)
      .map((company) => ({ company, yoy: generationYoy(company).at(-1) }))
      .filter((row) => row.yoy !== null)
      .sort((a, b) => a.yoy - b.yoy);
    renderChart("hydro-company-rank-chart", {
      tooltip: {
        ...tooltipStyle,
        formatter: (params) => {
          const row = rankRows[params.dataIndex];
          return `${row.company.name}<br>2026Q2：${fmt(row.company.values.at(-1), 1)} ${row.company.unit}<br>口径：${row.company.lastValueType || "测算值"}<br>同比：${pct(row.yoy)}<br>区间/真值：${row.company.range} ${row.company.unit}`;
        }
      },
      grid: { left: 18, right: 58, top: 34, bottom: 30, containLabel: true },
      xAxis: { type: "value", name: "%", ...axisStyle, splitLine: { show: true, lineStyle: { color: "#e5ebef" } } },
      yAxis: { type: "category", data: rankRows.map((row) => row.company.name.replace("国投/川投·", "").replace("国电电力·", "")), ...axisStyle },
      series: [{
        name: "同比",
        type: "bar",
        barMaxWidth: 18,
        data: rankRows.map((row) => ({
          value: row.yoy,
          itemStyle: { color: row.yoy >= 0 ? "#d49a3a" : "#334e68", borderRadius: row.yoy >= 0 ? [0, 5, 5, 0] : [5, 0, 0, 5] },
          label: { show: true, position: row.yoy >= 0 ? "right" : "left", formatter: `${row.yoy > 0 ? "+" : ""}${row.yoy}%`, color: "#334e68", fontSize: 11 }
        })),
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "#cfd9df" }, data: [{ xAxis: 0 }] }
      }]
    });

    const companyWeeklyBody = document.getElementById("hydro-company-weekly-body");
    if (companyWeeklyBody) {
      const rows = data.hydroCompanyWeeklyLatest || [];
      companyWeeklyBody.innerHTML = rows.map((row) => `
        <tr>
          <td>${row.company}</td>
          <td>${row.week || "-"}</td>
          <td>${row.days ?? "-"}</td>
          <td>${row.power == null ? "-" : fmt(row.power, 1)}</td>
          <td>${row.yoy == null ? "-" : pct(row.yoy)}</td>
          <td>${row.scope || row.period || "-"}</td>
          <td>${row.coverage || "-"}</td>
          <td>${row.confidence || "-"}</td>
        </tr>
      `).join("");
    }

    const weeklyBody = document.getElementById("hydro-page-weekly-body");
    const weeklySelect = document.getElementById("hydro-weekly-basin");
    const weeklyNote = document.getElementById("hydro-weekly-basin-note");
    const weeklyBasins = uniqueSorted(data.hydroWeeklyLatest, "basin");
    const renderWeeklyByBasin = (basin) => {
      if (!weeklyBody) return;
      const rows = data.hydroWeeklyLatest.filter((row) => row.basin === basin);
      if (weeklyNote) weeklyNote.textContent = `${basin} 共 ${rows.length} 个电站周度快照`;
      weeklyBody.innerHTML = rows.map((row) => `
        <tr>
          <td>${row.station}</td>
          <td>${row.basin}</td>
          <td>${weekEndDate(row)}</td>
          <td>${fmt(row.inflow)}</td>
          <td>${pct(row.inflowYoy)}</td>
          <td>${fmt(row.outflow)}</td>
          <td>${fmt(row.waterLevel, 2)}</td>
        </tr>
      `).join("");
    };
    if (weeklyBody && weeklySelect) {
      const preferred = weeklyBasins.includes("长江干流") ? "长江干流" : weeklyBasins[0];
      const selected = setSelectOptions(weeklySelect, weeklyBasins, preferred);
      weeklySelect.addEventListener("change", () => renderWeeklyByBasin(weeklySelect.value));
      renderWeeklyByBasin(selected);
    }

    const hourlyBody = document.getElementById("hydro-page-hourly-body");
    const hourlySelect = document.getElementById("hydro-hourly-river");
    const hourlyNote = document.getElementById("hydro-hourly-river-note");
    const hourlyRivers = uniqueSorted(data.hydroHourlyLatest, "river");
    const renderHourlyByRiver = (river) => {
      if (!hourlyBody) return;
      const rows = data.hydroHourlyLatest.filter((row) => row.river === river);
      if (hourlyNote) hourlyNote.textContent = `${river} 共 ${rows.length} 个电站最新小时快照`;
      hourlyBody.innerHTML = rows.map((row) => `
        <tr>
          <td>${row.station}</td>
          <td>${row.river}</td>
          <td>${row.time}</td>
          <td>${fmt(row.inflow)}</td>
          <td>${fmt(row.outflow)}</td>
          <td>${fmt(row.waterLevel, 2)}</td>
        </tr>
      `).join("");
    };
    if (hourlyBody && hourlySelect) {
      const selected = setSelectOptions(hourlySelect, hourlyRivers, hourlyRivers[0]);
      hourlySelect.addEventListener("change", () => renderHourlyByRiver(hourlySelect.value));
      renderHourlyByRiver(selected);
    }

    const qtdBody = document.getElementById("hydro-page-qtd-body");
    const qtdSelect = document.getElementById("hydro-qtd-river");
    const qtdNote = document.getElementById("hydro-qtd-river-note");
    const qtdRivers = uniqueSorted(data.hydroQtdMetrics || [], "river");
    const renderQtdByRiver = (river) => {
      if (!qtdBody) return;
      const rows = data.hydroQtdMetrics.filter((row) => row.river === river);
      if (qtdNote) qtdNote.textContent = `${river} 共 ${rows.length} 个电站 QTD 样本`;
      qtdBody.innerHTML = rows.map((row) => `
        <tr>
          <td>${row.station}</td>
          <td>${row.river}</td>
          <td>${fmt(row.latestInflow)}</td>
          <td>${fmt(row.avg7dInflow)}</td>
          <td>${fmt(row.avg14dInflow)}</td>
          <td>${fmt(row.qtdInflow)}</td>
          <td>${fmt(row.sampleHours)}</td>
        </tr>
      `).join("");
    };
    if (qtdBody && qtdSelect && data.hydroQtdMetrics) {
      const preferred = qtdRivers.includes("金沙江") ? "金沙江" : qtdRivers[0];
      const selected = setSelectOptions(qtdSelect, qtdRivers, preferred);
      qtdSelect.addEventListener("change", () => renderQtdByRiver(qtdSelect.value));
      renderQtdByRiver(selected);
    }

    const riverQtdBody = document.getElementById("hydro-page-river-qtd-body");
    if (riverQtdBody) {
      riverQtdBody.innerHTML = riverQtd.map((row) => `
        <tr>
          <td>${row.river}</td>
          <td>${row.stationCount}</td>
          <td>${fmt(row.latestInflow)}</td>
          <td>${fmt(row.avg7dInflow)}</td>
          <td>${fmt(row.avg14dInflow)}</td>
          <td>${fmt(row.qtdInflow)}</td>
          <td>${row.signal}</td>
        </tr>
      `).join("");
    }
  };

  const renderPricePage = () => {
    const latestSpot = data.spotWeeklyLatest?.reduce((latest, row) => !latest || weekEndDate(row) > weekEndDate(latest) ? row : latest, null);
    const avgRealtime = data.spotWeeklyLatest.reduce((sum, row) => sum + row.spotAvg, 0) / data.spotWeeklyLatest.length;
    const latestDayAheadDate = data.freshness?.dayAheadDaily || data.dayAheadDailyLatest?.[0]?.date || null;
    setText("price-page-date", latestDayAheadDate || "-");
    setText("price-page-avg", `${fmt(avgRealtime, 0)} 元/MWh`);
    setText("price-page-note", `${data.spotWeeklyLatest.length} 个省份各取最新可用周度实时均价`);
    if (data.dayAheadDailyLatest?.length) {
      const avgDayAhead = data.dayAheadDailyLatest.reduce((sum, row) => sum + Number(row.dayAheadAvg), 0) / data.dayAheadDailyLatest.length;
      setText("dayahead-page-avg", `${fmt(avgDayAhead, 0)} 元/MWh`);
      setText("dayahead-page-note", `${data.dayAheadDailyLatest[0].date}，${data.dayAheadDailyLatest.length} 个省份`);
    }
    if (data.proxyPurchaseLatest?.length) {
      const avgProxy = data.proxyPurchaseLatest.reduce((sum, row) => sum + row.proxyPrice, 0) / data.proxyPurchaseLatest.length;
      const latestProxyMonth = data.proxyPurchaseLatest.reduce((latest, row) => row.month > latest ? row.month : latest, data.proxyPurchaseLatest[0].month);
      setText("proxy-page-avg", `${fmt(avgProxy, 0)} 元/MWh`);
      setText("proxy-page-note", `${latestProxyMonth}，${data.proxyPurchaseLatest.length} 个省份样本`);
    }
    if (data.systemFeeLatest?.length) {
      const validTotals = data.systemFeeLatest.map((row) => row.total).filter((value) => value !== null && value !== undefined);
      const avgSystemFee = validTotals.length ? validTotals.reduce((sum, value) => sum + Number(value), 0) / validTotals.length : null;
      const latestSystemFeeMonth = data.systemFeeLatest.reduce((latest, row) => row.month > latest ? row.month : latest, data.systemFeeLatest[0].month);
      setText("system-fee-page-avg", `${fmt(avgSystemFee, 0)} 元/MWh`);
      setText("system-fee-page-note", `${latestSystemFeeMonth}，${data.systemFeeLatest.length} 个省份总值样本；折价可正可负`);
    }

    let spotLatestExpanded = false;
    const provinceBody = document.getElementById("price-province-body");
    const spotLatestToggle = document.getElementById("spot-latest-toggle");
    const renderSpotLatest = () => {
      if (!provinceBody || !data.spotWeeklyLatest) return;
      const rows = spotLatestExpanded ? data.spotWeeklyLatest : data.spotWeeklyLatest.slice(0, 5);
      provinceBody.innerHTML = rows.map((row) => `
        <tr>
          <td>${row.province}</td>
          <td>${fmt(row.coalBenchmark, 1)}</td>
          <td>${weekEndDate(row)}</td>
          <td>${row.weekStart} 至 ${row.weekEnd}</td>
          <td>${fmt(row.spotAvg, 1)}</td>
          <td>${row.spotYoy || "-"}</td>
          <td>${pct(row.spotWow)}</td>
        </tr>
      `).join("");
      if (spotLatestToggle) spotLatestToggle.textContent = spotLatestExpanded ? "收起" : `展开全部 ${data.spotWeeklyLatest.length}`;
    };
    if (spotLatestToggle) {
      spotLatestToggle.addEventListener("click", () => {
        spotLatestExpanded = !spotLatestExpanded;
        renderSpotLatest();
      });
    }
    renderSpotLatest();

    let dayAheadExpanded = false;
    const dayAheadBody = document.getElementById("dayahead-latest-body");
    const dayAheadToggle = document.getElementById("dayahead-latest-toggle");
    const renderDayAheadLatest = () => {
      if (!dayAheadBody || !data.dayAheadDailyLatest) return;
      const rows = dayAheadExpanded ? data.dayAheadDailyLatest : data.dayAheadDailyLatest.slice(0, 5);
      dayAheadBody.innerHTML = rows.map((row) => `
        <tr>
          <td>${row.province}</td>
          <td>${row.date}</td>
          <td>${fmt(row.dayAheadAvg, 1)}</td>
          <td>${row.source || "电碳全国日前"}</td>
        </tr>
      `).join("");
      if (dayAheadToggle) dayAheadToggle.textContent = dayAheadExpanded ? "收起" : `展开全部 ${data.dayAheadDailyLatest.length}`;
    };
    if (dayAheadToggle) {
      dayAheadToggle.addEventListener("click", () => {
        dayAheadExpanded = !dayAheadExpanded;
        renderDayAheadLatest();
      });
    }
    renderDayAheadLatest();

    const provinceSelect = document.getElementById("spot-history-province");
    const historyNote = document.getElementById("spot-history-note");
    const weeklyBody = document.getElementById("price-weekly-history-body");
    const spotHistoryToggle = document.getElementById("spot-history-toggle");
    let spotHistoryExpanded = false;
    const provinces = [...new Set(data.spotWeeklyHistory.map((row) => row.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const preferredProvince = provinces.includes("广东") ? "广东" : (latestSpot?.province || provinces[0]);
    const priceChartSelect = document.getElementById("price-chart-province");

    const renderPriceHistoryChart = (province) => {
      const rows = data.spotWeeklyHistory
        .filter((row) => row.province === province)
        .sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)));
      const yoyRaw = rows.map((row) => toPctNumber(row.spotYoy));
      const validYoy = yoyRaw.filter((value) => value !== null);
      const yoyAxisMax = Math.min(300, Math.max(50, Math.ceil((Math.max(...validYoy.map((value) => Math.abs(value)), 50) * 1.1) / 25) * 25));
      const yoyData = yoyRaw.map((rawValue) => {
        if (rawValue === null) return null;
        const clippedValue = Math.max(-yoyAxisMax, Math.min(yoyAxisMax, rawValue));
        return { value: clippedValue, rawValue, clipped: clippedValue !== rawValue };
      });
      renderChart("price-history-chart", {
        tooltip: {
          ...tooltipStyle,
          formatter: (params) => {
            const items = Array.isArray(params) ? params : [params];
            const lines = [items[0]?.axisValueLabel || items[0]?.name || ""];
            items.forEach((item) => {
              const isYoy = item.seriesName === "同比";
              const rawValue = isYoy && item.data && typeof item.data === "object" ? item.data.rawValue : item.value;
              const display = rawValue === null || rawValue === undefined ? "-" : (isYoy ? pct(rawValue) : `${fmt(rawValue, 1)} 元/MWh`);
              lines.push(`${item.marker}${item.seriesName}：${display}`);
            });
            return lines.join("<br>");
          }
        },
        legend: { top: 12, right: 22, textStyle: { color: "#74808a", fontSize: 11 } },
        grid: { left: 64, right: 68, top: 58, bottom: 72 },
        xAxis: { type: "category", boundaryGap: true, data: rows.map((row) => row.weekStart), ...axisStyle },
        yAxis: [
          { type: "value", name: "元/MWh", nameTextStyle: { color: "#74808a" }, scale: true, ...axisStyle },
          { type: "value", name: "同比", position: "right", min: -yoyAxisMax, max: yoyAxisMax, nameTextStyle: { color: "#c85c54" }, ...axisStyle, axisLabel: { color: "#c85c54", fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } }
        ],
        dataZoom: [
          { type: "inside", start: 0, end: 100 },
          { type: "slider", height: 18, bottom: 18, borderColor: "#d9e2e7", fillerColor: "rgba(60,64,91,.14)" }
        ],
        series: [
          { name: "现货均价", type: "line", smooth: true, showSymbol: false, data: rows.map((row) => row.spotAvg), lineStyle: { width: 2.5 }, areaStyle: { opacity: .08 } },
          { name: "煤电基准", type: "line", smooth: false, showSymbol: false, data: rows.map((row) => row.coalBenchmark), lineStyle: { width: 1.4, type: "dashed", color: "#74808a" }, itemStyle: { color: "#74808a" } },
          { name: "同比", type: "bar", yAxisIndex: 1, barMaxWidth: 14, data: yoyData, itemStyle: { color: "rgba(197,166,111,.32)", borderRadius: [3, 3, 0, 0] }, markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "rgba(197,166,111,.35)", type: "dashed" }, data: [{ yAxis: 0 }] } }
        ]
      });
    };

    const dayAheadChartSelect = document.getElementById("dayahead-chart-province");
    const dayAheadProvinces = [...new Set((data.dayAheadDailyHistory || []).map((row) => row.province))]
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const dayAheadBenchmark = {
      安徽: 384.4, 福建: 393.2, 甘肃: 307.8, 广东: 453.0, 广西: 420.7, 贵州: 351.5,
      海南: 429.8, 冀南: 364.4, 河南: 377.9, 黑龙江: 374.0, 湖北: 416.1, 湖南: 450.0,
      吉林: 373.1, 江苏: 391.0, 江西: 414.3, 辽宁: 374.9, 蒙东: 303.5, 蒙西: 282.9,
      宁夏: 259.5, 青海: 324.7, 山东: 394.9, 山西: 332.0, 陕西: 354.5, 上海: 415.5,
      四川: 401.2, 新疆: 250.0, 云南: 335.8, 浙江: 415.3, 重庆: 396.4
    };

    const renderDayAheadHistoryChart = (province) => {
      const rows = (data.dayAheadDailyHistory || [])
        .filter((row) => row.province === province)
        .sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const rolling7d = rows.map((row, index) => {
        const windowRows = rows.slice(Math.max(0, index - 6), index + 1);
        return Number((windowRows.reduce((sum, item) => sum + Number(item.dayAheadAvg), 0) / windowRows.length).toFixed(1));
      });
      const benchmark = dayAheadBenchmark[province] ?? null;
      renderChart("dayahead-history-chart", {
        tooltip: {
          ...tooltipStyle,
          formatter: (params) => {
            const items = Array.isArray(params) ? params : [params];
            const lines = [items[0]?.axisValueLabel || items[0]?.name || ""];
            items.forEach((item) => lines.push(`${item.marker}${item.seriesName}：${fmt(item.value, 1)} 元/MWh`));
            return lines.join("<br>");
          }
        },
        legend: { top: 12, right: 22, textStyle: { color: "#74808a", fontSize: 11 } },
        grid: { left: 64, right: 32, top: 58, bottom: 72 },
        xAxis: { type: "category", boundaryGap: false, data: rows.map((row) => row.date), ...axisStyle },
        yAxis: { type: "value", name: "元/MWh", nameTextStyle: { color: "#74808a" }, scale: true, ...axisStyle },
        dataZoom: [
          { type: "inside", start: 0, end: 100 },
          { type: "slider", height: 18, bottom: 18, borderColor: "#d9e2e7", fillerColor: "rgba(60,64,91,.14)" }
        ],
        series: [
          { name: "日前日均价", type: "line", smooth: true, showSymbol: false, data: rows.map((row) => row.dayAheadAvg), lineStyle: { width: 2.5 }, areaStyle: { opacity: .08 } },
          { name: "7日均线", type: "line", smooth: true, showSymbol: false, data: rolling7d, lineStyle: { width: 1.8, color: "#d49a3a" }, itemStyle: { color: "#d49a3a" } },
          { name: "煤电基准", type: "line", smooth: false, showSymbol: false, data: rows.map(() => benchmark), lineStyle: { width: 1.4, type: "dashed", color: "#74808a" }, itemStyle: { color: "#74808a" } }
        ]
      });
    };

    if (dayAheadChartSelect && dayAheadProvinces.length) {
      dayAheadChartSelect.innerHTML = dayAheadProvinces.map((province) => `<option value="${province}">${province}</option>`).join("");
      dayAheadChartSelect.value = dayAheadProvinces.includes("广东") ? "广东" : dayAheadProvinces[0];
      dayAheadChartSelect.addEventListener("change", () => renderDayAheadHistoryChart(dayAheadChartSelect.value));
      renderDayAheadHistoryChart(dayAheadChartSelect.value);
    }

    const renderSpotHistory = (province) => {
      if (!weeklyBody) return;
      const rows = data.spotWeeklyHistory.filter((row) => row.province === province);
      if (historyNote) {
        const latest = rows[0];
        const prefix = spotHistoryExpanded ? "全部" : "最近 5 周";
        historyNote.textContent = latest ? `${province} ${prefix} / 共 ${rows.length} 周，最新截至 ${weekEndDate(latest)}` : "暂无历史数据";
      }
      const visibleRows = spotHistoryExpanded ? rows : rows.slice(0, 5);
      weeklyBody.innerHTML = visibleRows.map((row) => `
        <tr>
          <td>${row.province}</td>
          <td>${fmt(row.coalBenchmark, 1)}</td>
          <td>${weekEndDate(row)}</td>
          <td>${row.weekStart} 至 ${row.weekEnd}</td>
          <td>${fmt(row.spotAvg, 1)}</td>
          <td>${row.spotYoy || "-"}</td>
          <td>${pct(row.spotWow)}</td>
        </tr>
      `).join("");
      if (spotHistoryToggle) spotHistoryToggle.textContent = spotHistoryExpanded ? "收起" : `展开全部 ${rows.length}`;
    };

    if (provinceSelect && weeklyBody && data.spotWeeklyHistory) {
      provinceSelect.innerHTML = provinces.map((province) => `<option value="${province}">${province}</option>`).join("");
      provinceSelect.value = preferredProvince;
      if (priceChartSelect) {
        priceChartSelect.innerHTML = provinces.map((province) => `<option value="${province}">${province}</option>`).join("");
        priceChartSelect.value = preferredProvince;
        priceChartSelect.addEventListener("change", () => {
          provinceSelect.value = priceChartSelect.value;
          renderSpotHistory(priceChartSelect.value);
          renderPriceHistoryChart(priceChartSelect.value);
        });
      }
      provinceSelect.addEventListener("change", () => {
        if (priceChartSelect) priceChartSelect.value = provinceSelect.value;
        renderSpotHistory(provinceSelect.value);
        renderPriceHistoryChart(provinceSelect.value);
      });
      if (spotHistoryToggle) {
        spotHistoryToggle.addEventListener("click", () => {
          spotHistoryExpanded = !spotHistoryExpanded;
          renderSpotHistory(provinceSelect.value);
        });
      }
      renderSpotHistory(provinceSelect.value);
      renderPriceHistoryChart(provinceSelect.value);
    }

    const dayAheadWeeklySelect = document.getElementById("dayahead-history-province");
    const dayAheadWeeklyNote = document.getElementById("dayahead-history-note");
    const dayAheadWeeklyBody = document.getElementById("dayahead-weekly-history-body");
    const dayAheadWeeklyToggle = document.getElementById("dayahead-history-toggle");
    let dayAheadWeeklyExpanded = false;
    const dayAheadWeeklyProvinces = [...new Set((data.dayAheadWeeklyHistory || []).map((row) => row.province))]
      .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

    const renderDayAheadWeeklyHistory = (province) => {
      if (!dayAheadWeeklyBody) return;
      const rows = (data.dayAheadWeeklyHistory || [])
        .filter((row) => row.province === province)
        .sort((a, b) => String(b.weekStart).localeCompare(String(a.weekStart)))
        .map((row, index, provinceRows) => {
          const dailyDates = (data.dayAheadDailyHistory || [])
            .filter((daily) => daily.province === province && daily.date >= row.weekStart && daily.date <= row.weekEnd)
            .map((daily) => daily.date)
            .sort();
          return {
            ...row,
            dataThrough: dailyDates.at(-1) || row.weekEnd,
            dayAheadWow: changePct(Number(row.dayAheadAvg), Number(provinceRows[index + 1]?.dayAheadAvg))
          };
        });
      const latest = rows[0];
      const prefix = dayAheadWeeklyExpanded ? "全部" : "最近 5 周";
      if (dayAheadWeeklyNote) {
        const completeness = latest && Number(latest.nDays) < 7 ? `，最新周仅 ${latest.nDays} 天` : "";
        dayAheadWeeklyNote.textContent = latest
          ? `${province} ${prefix} / 共 ${rows.length} 周，最新数据截至 ${latest.dataThrough}，统计周 ${latest.weekStart} 至 ${latest.weekEnd}${completeness}`
          : "暂无日前周度数据";
      }
      const visibleRows = dayAheadWeeklyExpanded ? rows : rows.slice(0, 5);
      dayAheadWeeklyBody.innerHTML = visibleRows.map((row) => `
        <tr>
          <td>${row.province}</td>
          <td>${fmt(dayAheadBenchmark[row.province], 1)}</td>
          <td>${row.dataThrough}</td>
          <td>${row.weekStart} 至 ${row.weekEnd}</td>
          <td>${fmt(row.dayAheadAvg, 1)}</td>
          <td>${row.nDays}${Number(row.nDays) < 7 ? "（未满周）" : ""}</td>
          <td>${pct(row.dayAheadWow)}</td>
        </tr>
      `).join("");
      if (dayAheadWeeklyToggle) dayAheadWeeklyToggle.textContent = dayAheadWeeklyExpanded ? "收起" : `展开全部 ${rows.length}`;
    };

    if (dayAheadWeeklySelect && dayAheadWeeklyProvinces.length) {
      dayAheadWeeklySelect.innerHTML = dayAheadWeeklyProvinces.map((province) => `<option value="${province}">${province}</option>`).join("");
      dayAheadWeeklySelect.value = dayAheadWeeklyProvinces.includes("广东") ? "广东" : dayAheadWeeklyProvinces[0];
      dayAheadWeeklySelect.addEventListener("change", () => renderDayAheadWeeklyHistory(dayAheadWeeklySelect.value));
      if (dayAheadWeeklyToggle) {
        dayAheadWeeklyToggle.addEventListener("click", () => {
          dayAheadWeeklyExpanded = !dayAheadWeeklyExpanded;
          renderDayAheadWeeklyHistory(dayAheadWeeklySelect.value);
        });
      }
      renderDayAheadWeeklyHistory(dayAheadWeeklySelect.value);
    }

    const buildMonthlyYoy = (rows, valueField, derivedField) => {
      const valueByMonth = new Map(rows.map((row) => [row.month, row[valueField]]));
      const raw = rows.map((row) => {
        if (derivedField && row[derivedField] !== null && row[derivedField] !== undefined) return Number(row[derivedField]);
        const [year, month] = String(row.month).split("-");
        const currentValue = row[valueField];
        const priorValue = valueByMonth.get(`${Number(year) - 1}-${month}`);
        if (currentValue === null || currentValue === undefined || Number(currentValue) <= 0 || priorValue === null || priorValue === undefined || Number(priorValue) <= 0) return null;
        return Number((((Number(currentValue) / Number(priorValue)) - 1) * 100).toFixed(1));
      });
      const valid = raw.filter((value) => value !== null);
      const axisMax = Math.min(300, Math.max(50, Math.ceil((Math.max(...valid.map((value) => Math.abs(value)), 50) * 1.1) / 25) * 25));
      return {
        axisMax,
        data: raw.map((rawValue) => rawValue === null ? null : { value: Math.max(-axisMax, Math.min(axisMax, rawValue)), rawValue, clipped: Math.abs(rawValue) > axisMax })
      };
    };

    const proxySelect = document.getElementById("proxy-province");
    const proxyNote = document.getElementById("proxy-province-note");
    const proxyBody = document.getElementById("proxy-history-body");
    const proxyHistoryToggle = document.getElementById("proxy-history-toggle");
    let proxyHistoryExpanded = false;
    const proxyProvinces = data.proxyPurchaseHistory ? [...new Set(data.proxyPurchaseHistory.map((row) => row.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")) : [];
    const preferredProxyProvince = proxyProvinces.includes("广东") ? "广东" : proxyProvinces[0];
    const renderProxyChart = (province) => {
      const rows = data.proxyPurchaseHistory
        .filter((row) => row.province === province)
        .sort((a, b) => String(a.month).localeCompare(String(b.month)));
      const yoy = buildMonthlyYoy(rows, "proxyPrice", "proxyYoy");
      renderChart("proxy-history-chart", {
        tooltip: {
          ...tooltipStyle,
          formatter: (params) => {
            const items = Array.isArray(params) ? params : [params];
            const lines = [items[0]?.axisValueLabel || items[0]?.name || ""];
            items.forEach((item) => {
              const isYoy = item.seriesName === "同比";
              const rawValue = isYoy && item.data && typeof item.data === "object" ? item.data.rawValue : item.value;
              lines.push(`${item.marker}${item.seriesName}：${rawValue === null || rawValue === undefined ? "-" : (isYoy ? pct(rawValue) : `${fmt(rawValue, 1)} 元/MWh`)}`);
            });
            return lines.join("<br>");
          }
        },
        legend: { top: 10, right: 18, textStyle: { color: "#74808a", fontSize: 11 } },
        grid: { left: 62, right: 68, top: 52, bottom: 58 },
        xAxis: { type: "category", data: rows.map((row) => row.month), ...axisStyle },
        yAxis: [
          { type: "value", name: "元/MWh", scale: true, nameTextStyle: { color: "#74808a" }, ...axisStyle },
          { type: "value", name: "同比", position: "right", min: -yoy.axisMax, max: yoy.axisMax, nameTextStyle: { color: "#c85c54" }, ...axisStyle, axisLabel: { color: "#c85c54", fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } }
        ],
        dataZoom: [{ type: "inside", start: Math.max(0, 100 - (24 / Math.max(rows.length, 24)) * 100), end: 100 }],
        series: [
          { name: "代理购电价", type: "line", smooth: true, showSymbol: false, data: rows.map((row) => row.proxyPrice), lineStyle: { width: 2.5 }, areaStyle: { opacity: .08 } },
          { name: "同比", type: "bar", yAxisIndex: 1, barMaxWidth: 14, data: yoy.data, itemStyle: { color: "rgba(197,166,111,.32)", borderRadius: [3, 3, 0, 0] }, markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "rgba(197,166,111,.35)", type: "dashed" }, data: [{ yAxis: 0 }] } }
        ]
      });
    };
    const renderProxyHistory = (province) => {
      if (!proxyBody) return;
      const rows = data.proxyPurchaseHistory.filter((row) => row.province === province);
      if (proxyNote) {
        const latest = rows[0];
        const prefix = proxyHistoryExpanded ? "全部" : "最近 5 月";
        proxyNote.textContent = latest ? `${province} ${prefix} / 共 ${rows.length} 月，最新 ${latest.month}` : "暂无代理购电价";
      }
      const visibleRows = proxyHistoryExpanded ? rows : rows.slice(0, 5);
      proxyBody.innerHTML = visibleRows.map((row) => `
        <tr>
          <td>${row.province}</td>
          <td>${row.month}</td>
          <td>${fmt(row.proxyPrice, 1)}</td>
          <td>${pct(row.proxyWow)}</td>
        </tr>
      `).join("");
      if (proxyHistoryToggle) proxyHistoryToggle.textContent = proxyHistoryExpanded ? "收起" : `展开全部 ${rows.length}`;
      renderProxyChart(province);
    };
    if (proxySelect && proxyBody && data.proxyPurchaseHistory) {
      proxySelect.innerHTML = proxyProvinces.map((province) => `<option value="${province}">${province}</option>`).join("");
      proxySelect.value = preferredProxyProvince;
      proxySelect.addEventListener("change", () => renderProxyHistory(proxySelect.value));
      if (proxyHistoryToggle) {
        proxyHistoryToggle.addEventListener("click", () => {
          proxyHistoryExpanded = !proxyHistoryExpanded;
          renderProxyHistory(proxySelect.value);
        });
      }
      renderProxyHistory(proxySelect.value);
    }

    const systemFeeSelect = document.getElementById("system-fee-province");
    const systemFeeNote = document.getElementById("system-fee-province-note");
    const systemFeeBody = document.getElementById("system-fee-history-body");
    const systemFeeToggle = document.getElementById("system-fee-history-toggle");
    let systemFeeExpanded = false;
    const systemFeeProvinces = data.systemFeeHistory
      ? [...new Set(data.systemFeeHistory.filter((row) => row.total !== null && row.total !== undefined).map((row) => row.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
      : [];
    const preferredSystemFeeProvince = systemFeeProvinces.includes("广东") ? "广东" : systemFeeProvinces[0];
    const renderSystemFeeChart = (province) => {
      const rows = data.systemFeeHistory
        .filter((row) => row.province === province && row.total !== null && row.total !== undefined)
        .sort((a, b) => String(a.month).localeCompare(String(b.month)));
      const yoy = buildMonthlyYoy(rows, "total", "totalYoy");
      renderChart("system-fee-history-chart", {
        tooltip: {
          ...tooltipStyle,
          formatter: (params) => {
            const items = Array.isArray(params) ? params : [params];
            const lines = [items[0]?.axisValueLabel || items[0]?.name || ""];
            items.forEach((item) => {
              const isYoy = item.seriesName === "总值同比";
              const rawValue = isYoy && item.data && typeof item.data === "object" ? item.data.rawValue : item.value;
              lines.push(`${item.marker}${item.seriesName}：${rawValue === null || rawValue === undefined ? "-" : (isYoy ? pct(rawValue) : `${fmt(rawValue, 1)} 元/MWh`)}`);
            });
            return lines.join("<br>");
          }
        },
        legend: { top: 8, right: 16, textStyle: { color: "#74808a", fontSize: 10 } },
        grid: { left: 62, right: 68, top: 54, bottom: 58 },
        xAxis: { type: "category", data: rows.map((row) => row.month), ...axisStyle },
        yAxis: [
          { type: "value", name: "元/MWh", scale: true, nameTextStyle: { color: "#74808a" }, ...axisStyle },
          { type: "value", name: "同比", position: "right", min: -yoy.axisMax, max: yoy.axisMax, nameTextStyle: { color: "#c85c54" }, ...axisStyle, axisLabel: { color: "#c85c54", fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } }
        ],
        series: [
          { name: "总值", type: "line", smooth: true, showSymbol: false, data: rows.map((row) => row.total), lineStyle: { width: 2.6 }, areaStyle: { opacity: .08 } },
          { name: "煤电容量", type: "line", smooth: true, showSymbol: false, connectNulls: false, data: rows.map((row) => row.coalCapacity), lineStyle: { width: 1.4, type: "dashed" } },
          { name: "辅助服务", type: "line", smooth: true, showSymbol: false, connectNulls: false, data: rows.map((row) => row.ancillary), lineStyle: { width: 1.2, type: "dotted" } },
          { name: "抽蓄容量", type: "line", smooth: true, showSymbol: false, connectNulls: false, data: rows.map((row) => row.pumpedStorage), lineStyle: { width: 1.2, type: "dotted" } },
          { name: "总值同比", type: "bar", yAxisIndex: 1, barMaxWidth: 14, data: yoy.data, itemStyle: { color: "rgba(197,166,111,.28)", borderRadius: [3, 3, 0, 0] }, markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "rgba(197,166,111,.35)", type: "dashed" }, data: [{ yAxis: 0 }] } }
        ]
      });
    };
    const renderSystemFeeHistory = (province) => {
      if (!systemFeeBody) return;
      const rows = data.systemFeeHistory.filter((row) => row.province === province && row.total !== null && row.total !== undefined);
      if (systemFeeNote) {
        const latest = rows[0];
        const prefix = systemFeeExpanded ? "全部公开窗口" : "最近 5 月";
        systemFeeNote.textContent = latest ? `${province} ${prefix} / 共 ${rows.length} 月，最新 ${latest.month}` : "暂无系统运行费折价总值";
      }
      const visibleRows = systemFeeExpanded ? rows : rows.slice(0, 5);
      systemFeeBody.innerHTML = visibleRows.map((row) => `
        <tr>
          <td>${row.province}</td>
          <td>${row.month}</td>
          <td>${fmt(row.total, 1)}</td>
          <td>${pct(row.totalWow)}</td>
          <td>${fmt(row.coalCapacity, 1)}</td>
          <td>${fmt(row.ancillary, 1)}</td>
          <td>${fmt(row.pumpedStorage, 1)}</td>
        </tr>
      `).join("");
      if (systemFeeToggle) systemFeeToggle.textContent = systemFeeExpanded ? "收起" : `展开全部 ${rows.length}`;
      renderSystemFeeChart(province);
    };
    if (systemFeeSelect && systemFeeBody && data.systemFeeHistory && systemFeeProvinces.length) {
      systemFeeSelect.innerHTML = systemFeeProvinces.map((province) => `<option value="${province}">${province}</option>`).join("");
      systemFeeSelect.value = preferredSystemFeeProvince;
      systemFeeSelect.addEventListener("change", () => renderSystemFeeHistory(systemFeeSelect.value));
      if (systemFeeToggle) {
        systemFeeToggle.addEventListener("click", () => {
          systemFeeExpanded = !systemFeeExpanded;
          renderSystemFeeHistory(systemFeeSelect.value);
        });
      }
      renderSystemFeeHistory(systemFeeSelect.value);
    }
  };

  const renderBars = (id, rows, maxValue, className = "") => {
    const node = document.getElementById(id);
    if (!node) return;
    node.innerHTML = rows.map((row) => {
      const width = maxValue ? Math.max(0, Math.min(100, (Number(row.value || 0) / maxValue) * 100)) : 0;
      return `
        <div class="bar-row">
          <div>${row.label}</div>
          <div class="track"><div class="fill ${className}" style="width:${width}%"></div></div>
          <div>${row.display}</div>
        </div>
      `;
    }).join("");
  };

  const findByMonth = (rows, month) => rows.find((row) => row.month === month) || {};

  const bindMonthSelect = (id, rows, preferredMonth, onChange) => {
    const select = document.getElementById(id);
    if (!select || !rows?.length) return;
    const months = rows.map((row) => row.month);
    const selected = setSelectOptions(select, months, preferredMonth || months[0]);
    select.addEventListener("change", () => onChange(select.value));
    onChange(selected);
  };

  const renderProvinceCapacity = () => {
    const monthlyRows = data.provincePowerMonthly || [];
    const capacityRows = data.provinceInstalledCapacityMonthly || data.provinceInstalledCapacityAnnual || [];
    if (!monthlyRows.length) return;
    const fields = [
      { label: "总装机", field: "total" },
      { label: "水电", field: "hydro" },
      { label: "火电", field: "thermal" },
      { label: "风电", field: "wind" },
      { label: "太阳能（不含分布式）", field: "solar6000" },
      { label: "核电", field: "nuclear" }
    ];
    const capacitySeriesColors = {
      hydro: "#334e68",
      thermal: "#d49a3a",
      wind: "#2f7e86",
      solar6000: "#c85c54",
      nuclear: "#7c78a7",
      solar: "#c85c54"
    };
    const hasValue = (value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
    const provinces = [...new Set(monthlyRows.map((row) => row.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const yoyFor = (rows, index, field) => {
      const current = rows[index];
      const previous = rows.find((row) => row.month === `${Number(current.month.slice(0, 4)) - 1}${current.month.slice(4)}`);
      if (!previous || !hasValue(current[field]) || !hasValue(previous[field]) || Number(previous[field]) === 0) return null;
      return changePct(Number(current[field]), Number(previous[field]));
    };
    const metricOptions = [
      { label: "\u603b\u53d1\u7535\u91cf", field: "generation", valueName: "\u603b\u53d1\u7535\u91cf" },
      { label: "\u603b\u7528\u7535\u91cf", field: "consumption", valueName: "\u603b\u7528\u7535\u91cf" },
      { label: "\u706b\u7535\u53d1\u7535\u91cf", field: "thermalGeneration", valueName: "\u706b\u7535\u53d1\u7535\u91cf" },
      { label: "\u6c34\u7535\u53d1\u7535\u91cf", field: "hydroGeneration", valueName: "\u6c34\u7535\u53d1\u7535\u91cf" },
      { label: "\u6838\u7535\u53d1\u7535\u91cf", field: "nuclearGeneration", valueName: "\u6838\u7535\u53d1\u7535\u91cf" },
      { label: "\u98ce\u7535\u53d1\u7535\u91cf", field: "windGeneration", valueName: "\u98ce\u7535\u53d1\u7535\u91cf" },
      { label: "\u5149\u4f0f\u53d1\u7535\u91cf", field: "solarGeneration", valueName: "\u5149\u4f0f\u53d1\u7535\u91cf" }
    ];

    const provinceSelect = document.getElementById("province-capacity-province");
    const renderProfile = (province) => {
      const provinceRows = monthlyRows.filter((row) => row.province === province).sort((a, b) => a.month.localeCompare(b.month));
      const provinceCapacity = capacityRows
        .filter((row) => row.province === province && !String(row.period || "").endsWith("-01"))
        .sort((a, b) => a.period.localeCompare(b.period));
      const latestGeneration = provinceRows.filter((row) => hasValue(row.generation)).at(-1) || {};
      const latestConsumption = provinceRows.filter((row) => hasValue(row.consumption)).at(-1) || {};
      const latestCapacity = provinceCapacity.filter((row) => hasValue(row.total)).at(-1) || {};

      setText("province-capacity-period", `${province} · 滚动近两年`);
      setText("province-generation-latest", hasValue(latestGeneration.generation) ? `${fmt(latestGeneration.generation, 1)} 亿kWh` : "—");
      setText("province-generation-note", latestGeneration.month ? `${formatTimeLabel(latestGeneration.month)} 当月值` : "暂无可靠值");
      setText("province-consumption-latest", hasValue(latestConsumption.consumption) ? `${fmt(latestConsumption.consumption, 1)} 亿kWh` : "—");
      setText("province-consumption-note", latestConsumption.month ? `${formatTimeLabel(latestConsumption.month)} 当月值` : "暂无可靠值");
      setText("province-capacity-latest", hasValue(latestCapacity.total) ? `${fmt(latestCapacity.total, 1)} 万kW` : "—");
      setText("province-capacity-note", latestCapacity.period ? `${formatTimeLabel(latestCapacity.period.slice(0, 7))} 月末值` : "暂无可靠值");
      setText("province-month-count", `${provinceRows.length} 期`);
      setText("province-power-trend-note", `${province}，当月值，单位：亿千瓦时`);
        setText("province-capacity-profile-note", `${province}，月末装机结构，单位：万千瓦`);

      renderChart("province-power-trend-chart", {
        tooltip: { ...tooltipStyle, trigger: "axis", valueFormatter: (value) => value === null || value === undefined ? "—" : `${fmt(value, 1)} 亿千瓦时` },
        legend: { top: 8, textStyle: { color: "#74808a" } },
        grid: { left: 58, right: 24, top: 54, bottom: 42 },
        xAxis: { type: "category", data: provinceRows.map((row) => row.month), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, rotate: 35, interval: 2 } },
        yAxis: { type: "value", name: "亿千瓦时", ...axisStyle },
        series: [
          { name: "发电量", type: "line", smooth: true, symbolSize: 6, connectNulls: false, data: provinceRows.map((row) => row.generation) },
          { name: "全社会用电量", type: "line", smooth: true, symbolSize: 6, connectNulls: false, data: provinceRows.map((row) => row.consumption) }
        ]
      });

      const metricSelect = document.getElementById("province-power-metric");
      const renderPowerTrend = (label) => {
        const option = metricOptions.find((item) => item.label === label) || metricOptions[0];
        const trendRows = provinceRows.map((row, index) => ({ ...row, yoy: yoyFor(provinceRows, index, option.field) }));
        setText("province-power-trend-note", `${province}，${option.valueName}当月值及同比增速，单位：亿千瓦时`);
        renderChart("province-power-trend-chart", {
          tooltip: { ...tooltipStyle, trigger: "axis" },
          legend: { top: 8, textStyle: { color: "#74808a" } },
          grid: { left: 58, right: 58, top: 54, bottom: 76 },
        xAxis: { type: "category", data: trendRows.map((row) => row.month), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, rotate: 35, interval: 2 } },
          dataZoom: [
            { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
            { type: "slider", xAxisIndex: 0, bottom: 12, height: 18, brushSelect: false }
          ],
          yAxis: [
            { type: "value", name: "亿千瓦时", ...axisStyle },
            { type: "value", name: "同比", ...axisStyle, axisLabel: { color: "#74808a", formatter: (value) => `${value}%` } }
          ],
          series: [
            { name: option.valueName, type: "line", smooth: true, symbolSize: 6, connectNulls: false, data: trendRows.map((row) => hasValue(row[option.field]) ? row[option.field] : null) },
            { name: "同比增速", type: "bar", yAxisIndex: 1, barMaxWidth: 14, data: trendRows.map((row) => row.yoy) }
          ]
        });
      };
      if (metricSelect) {
        const selectedMetric = setSelectOptions(metricSelect, metricOptions.map((item) => item.label), metricOptions[0].label);
        metricSelect.onchange = () => renderPowerTrend(metricSelect.value);
        renderPowerTrend(selectedMetric);
      } else {
        renderPowerTrend(metricOptions[0].label);
      }

      const missingLabels = fields
        .filter(({ field }) => !hasValue(latestCapacity[field]))
        .map(({ label }) => label);
      const quality = missingLabels.length ? `缺失字段：${missingLabels.join("、")}。` : "六类字段完整。";
      const qualityDetail = latestCapacity.scopeNotes ? ` ${latestCapacity.scopeNotes}` : "";
      setText("province-capacity-quality-note", `${quality}${qualityDetail} 装机按月末观测展示；太阳能含分布式全口径另列于明细表。`);

      renderChart("province-capacity-profile-chart", {
        tooltip: singleStackItemTooltip("万千瓦"),
        legend: { top: 8, left: "center", width: "92%", itemWidth: 13, itemHeight: 8, textStyle: { color: "#74808a", fontSize: 10 } },
        grid: { left: 58, right: 24, top: 72, bottom: 76 },
        xAxis: { type: "category", data: provinceCapacity.map((row) => row.period.slice(0, 7)), ...axisStyle },
        dataZoom: [
          { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
          { type: "slider", xAxisIndex: 0, bottom: 12, height: 18, brushSelect: false }
        ],
        yAxis: { type: "value", name: "万千瓦", ...axisStyle },
        series: [
          ...fields.slice(1).map(({ label, field }) => ({
          name: label,
          type: "bar",
          stack: "装机结构",
          barMaxWidth: 54,
          emphasis: { focus: "series" },
          itemStyle: { color: capacitySeriesColors[field] },
          data: provinceCapacity.map((row) => hasValue(row[field]) ? row[field] : null)
          })),
          {
            name: "太阳能（含分布式）",
            type: "line",
            smooth: true,
            symbolSize: 5,
            lineStyle: { width: 2.5, color: capacitySeriesColors.solar },
            itemStyle: { color: capacitySeriesColors.solar },
            data: provinceCapacity.map((row) => hasValue(row.solar) ? row.solar : null)
          }
        ]
      });

      const body = document.getElementById("province-capacity-body");
      if (body) {
        body.innerHTML = provinceRows.slice().reverse().map((row, reverseIndex) => {
          const index = provinceRows.length - 1 - reverseIndex;
          const generationYoy = yoyFor(provinceRows, index, "generation");
          const consumptionYoy = yoyFor(provinceRows, index, "consumption");
          return `<tr>
            <td>${formatTimeLabel(row.month)}</td>
            <td>${hasValue(row.generation) ? fmt(row.generation, 1) : "—"}</td>
            <td>${generationYoy === null ? "—" : pct(generationYoy)}</td>
            <td>${hasValue(row.consumption) ? fmt(row.consumption, 1) : "—"}</td>
            <td>${consumptionYoy === null ? "—" : pct(consumptionYoy)}</td>
            <td>${hasValue(row.capacity) ? fmt(row.capacity, 1) : "—"}</td>
            <td>${row.capacityScope || "未披露"}</td>
          </tr>`;
        }).join("");
      }

      const capacityBody = document.getElementById("province-capacity-detail-body");
      if (capacityBody) {
        capacityBody.innerHTML = provinceCapacity.slice().reverse().map((row) => `<tr>
          <td>${formatTimeLabel(row.month || row.period)}</td>
          <td>${hasValue(row.total) ? fmt(row.total, 1) : "—"}</td>
          <td>${hasValue(row.thermal) ? fmt(row.thermal, 1) : "—"}</td>
          <td>${hasValue(row.hydro) ? fmt(row.hydro, 1) : "—"}</td>
          <td>${hasValue(row.nuclear) ? fmt(row.nuclear, 1) : "—"}</td>
          <td>${hasValue(row.wind) ? fmt(row.wind, 1) : "—"}</td>
          <td>${hasValue(row.solar) ? fmt(row.solar, 1) : "—"}</td>
          <td>${hasValue(row.solar6000) ? fmt(row.solar6000, 1) : "—"}</td>
        </tr>`).join("");
      }

      setText("province-capacity-source", "发电量、用电量单位：亿千瓦时；装机单位：万千瓦。装机来源：Wind EDB（2026-07-16 提取）；太阳能第二口径为全口径减分布式光伏累计并网容量。“—”表示没有该月可靠观测值，不等于 0。");
    };
    if (provinceSelect) {
      const selectedProvince = setSelectOptions(provinceSelect, provinces, provinces.includes("福建") ? "福建" : provinces[0]);
      provinceSelect.addEventListener("change", () => renderProfile(provinceSelect.value));
      renderProfile(selectedProvince);
    }
  };

  const normalizeVisibleTimeText = () => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      if (node.parentElement?.closest("script,style")) return;
      const next = normalizeTimeText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    });
  };

  const renderPowerPage = () => {
    if (!data.powerConsumptionMonthly || !data.powerGenerationMonthly || !data.installedCapacityMonthly) return;
    const consumption = data.powerConsumptionMonthly[0];
    const generation = data.powerGenerationMonthly[0];
    const capacity = data.installedCapacityMonthly[0];
    const additions = data.installedCapacityAdditions?.[0] || {};

    setText("power-consumption-total", `${fmt(consumption.total)} 亿kWh`);
    setText("power-consumption-note", `${consumption.month}，同比 ${pct(consumption.totalYoy)}`);
    setText("power-generation-total", `${fmt(generation.total)} 亿kWh`);
    setText("power-generation-note", `${generation.month}，同比 ${pct(generation.totalYoy)}`);
    setText("power-capacity-total", `${fmt(capacity.total / 10000, 1)} 亿kW`);
    setText("power-capacity-note", `${capacity.month}，同比 ${pct(capacity.totalYoy)}`);
    setText("power-additions-total", `${fmt(additions.total / 100, 1)} GW`);
    setText("power-additions-note", `${additions.month}，风光新增 ${fmt(((additions.wind || 0) + (additions.solar || 0)) / 100, 1)} GW`);

    const balanceRows = data.powerConsumptionMonthly
      .map((row) => ({ ...row, capacity: findByMonth(data.installedCapacityMonthly, row.month) }))
      .filter((row) => row.totalYoy !== null && row.totalYoy !== undefined && row.capacity.totalYoy !== null && row.capacity.totalYoy !== undefined)
      .slice()
      .reverse();
    const latestBalance = balanceRows[balanceRows.length - 1];
    if (latestBalance) {
      const gap = Number(latestBalance.totalYoy) - Number(latestBalance.capacity.totalYoy);
      setText("power-balance-signal", `${latestBalance.month} ${gap >= 0 ? "需求快" : "供给快"} ${Math.abs(gap).toFixed(1)}pct`);
    }
    renderChart("power-balance-chart", {
      tooltip: { ...tooltipStyle, valueFormatter: (value) => `${Number(value).toFixed(1)}%` },
      legend: { top: 10, textStyle: { color: "#74808a" } },
      grid: { left: 56, right: 28, top: 58, bottom: 42 },
      xAxis: { type: "category", data: balanceRows.map((row) => row.month), ...axisStyle },
      yAxis: { type: "value", name: "%", ...axisStyle },
      series: [
        {
          name: "用电-装机增速差",
          type: "bar",
          barMaxWidth: 18,
          data: balanceRows.map((row) => +(Number(row.totalYoy) - Number(row.capacity.totalYoy)).toFixed(1)),
          itemStyle: { color: "#2f7e86", borderRadius: [4, 4, 0, 0] },
          markLine: { silent: true, symbol: "none", lineStyle: { color: "#f4f1de", type: "dashed" }, data: [{ yAxis: 0 }] }
        },
        {
          name: "用电同比",
          type: "line",
          smooth: true,
          symbolSize: 6,
          data: balanceRows.map((row) => row.totalYoy),
          lineStyle: { width: 3, color: "#334e68" },
          itemStyle: { color: "#334e68" }
        },
        {
          name: "装机同比",
          type: "line",
          smooth: true,
          symbolSize: 6,
          data: balanceRows.map((row) => row.capacity.totalYoy),
          lineStyle: { width: 2, color: "#d49a3a" },
          itemStyle: { color: "#d49a3a" }
        }
      ]
    });

    const generationTrendRows = data.powerGenerationMonthly.slice().reverse();
    renderChart("power-generation-trend-chart", {
      tooltip: { ...tooltipStyle, valueFormatter: (value) => value === null || value === undefined ? "-" : `${Number(value).toFixed(1)}%` },
      legend: { top: 8, itemWidth: 14, itemHeight: 8, textStyle: { color: "#74808a", fontSize: 11 } },
      grid: { left: 48, right: 24, top: 58, bottom: 72 },
      xAxis: { type: "category", data: generationTrendRows.map((row) => row.month), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, interval: 1 } },
      dataZoom: [
        { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
        { type: "slider", xAxisIndex: 0, bottom: 12, height: 18, brushSelect: false }
      ],
      yAxis: { type: "value", name: "%", ...axisStyle },
      series: [
        ["火电", "thermalYoy"],
        ["水电", "hydroYoy"],
        ["核电", "nuclearYoy"],
        ["风电", "windYoy"],
        ["太阳能", "solarYoy"]
      ].map(([name, field]) => ({
        name,
        type: "line",
        smooth: true,
        showSymbol: false,
        emphasis: { focus: "series" },
        data: generationTrendRows.map((row) => row[field])
      }))
    });

    const additionsTrendRows = (data.installedCapacityAdditions || []).slice().reverse();
    if (additions.total) {
      const renewableShare = ((Number(additions.wind || 0) + Number(additions.solar || 0)) / Number(additions.total)) * 100;
      setText("power-renewable-addition-share", `${additions.month} 风光占新增 ${renewableShare.toFixed(0)}%`);
    }
    renderChart("power-additions-trend-chart", {
      tooltip: singleStackItemTooltip("GW"),
      legend: { top: 8, itemWidth: 14, itemHeight: 8, textStyle: { color: "#74808a", fontSize: 11 } },
      grid: { left: 48, right: 24, top: 58, bottom: 72 },
      xAxis: { type: "category", data: additionsTrendRows.map((row) => row.month), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, interval: 1 } },
      dataZoom: [
        { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
        { type: "slider", xAxisIndex: 0, bottom: 12, height: 18, brushSelect: false }
      ],
      yAxis: { type: "value", name: "GW", ...axisStyle },
      series: [
        ["水电", "hydro"],
        ["火电", "thermal"],
        ["核电", "nuclear"],
        ["风电", "wind"],
        ["太阳能", "solar"]
      ].map(([name, field]) => ({
        name,
        type: "bar",
        stack: "新增装机",
        barMaxWidth: 26,
        emphasis: { focus: "series" },
        data: additionsTrendRows.map((row) => +(Number(row[field] || 0) / 100).toFixed(1))
      }))
    });

    const industryOptions = [
      { label: "全社会", field: "total", yoyField: "totalYoy" },
      { label: "一产", field: "primary" },
      { label: "二产", field: "secondary" },
      { label: "三产", field: "tertiary" },
      { label: "居民", field: "residential" }
    ];
    const industryCumulativeRows = (data.powerConsumptionMonthly || [])
      .filter((row) => row.total !== null && row.total !== undefined)
      .sort((a, b) => a.month.localeCompare(b.month));
    const industryCumulativeLookup = new Map((data.powerConsumptionMonthly || []).map((row) => [row.month, row]));
    const cumulativeIndustryRows = industryCumulativeRows.map((row) => ({
      month: row.month,
      label: row.month,
      values: Object.fromEntries(industryOptions.map((option) => [option.field, row[option.field]]))
    }));
    const industrySelect = document.getElementById("power-industry-select");
    const renderIndustryChart = (label) => {
      const option = industryOptions.find((item) => item.label === label) || industryOptions[0];
      const values = cumulativeIndustryRows.map((row) => row.values[option.field]);
      const yoyValues = cumulativeIndustryRows.map((row) => {
        const prior = industryCumulativeLookup.get(`${Number(row.month.slice(0, 4)) - 1}-${row.month.slice(5)}`);
        const samePeriodLastYear = prior?.[option.field];
        if (samePeriodLastYear === null || samePeriodLastYear === undefined || !Number(samePeriodLastYear)) return null;
        return +(((Number(row.values[option.field]) / Number(samePeriodLastYear)) - 1) * 100).toFixed(1);
      });
      const latestIndex = cumulativeIndustryRows.length - 1;
      const latestRow = cumulativeIndustryRows[latestIndex] || {};
      const latestYoy = yoyValues[latestIndex];
      const latestValue = values[latestIndex];
      setText("power-industry-note", latestRow.month ? `${latestRow.month} ${option.label}当月 ${fmt(latestValue)} 亿kWh，同比 ${pct(latestYoy)}` : "选择产业查看走势");
      renderChart("power-industry-year-chart", {
        tooltip: {
          ...tooltipStyle,
          formatter: (params) => {
            const items = Array.isArray(params) ? params : [params];
            const title = items[0]?.axisValue || "";
            return [title, ...items.map((item) => {
              const unit = item.seriesName.includes("同比") ? "%" : " 亿kWh";
              const value = item.value === null || item.value === undefined ? "-" : Number(item.value).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
              return `${item.marker}${item.seriesName}: ${value}${unit}`;
            })].join("<br>");
          }
        },
        legend: { top: 8, textStyle: { color: "#74808a", fontSize: 11 } },
        grid: { left: 58, right: 58, top: 58, bottom: 72 },
        xAxis: { type: "category", data: cumulativeIndustryRows.map((row) => row.month), ...axisStyle },
        dataZoom: [
          { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
          { type: "slider", xAxisIndex: 0, bottom: 12, height: 18, brushSelect: false }
        ],
        yAxis: [
          { type: "value", name: "亿kWh", ...axisStyle },
          { type: "value", name: "%", min: 0, max: (value) => Math.ceil(Math.max(1, value.max) * 1.2), ...axisStyle, splitLine: { show: false } }
        ],
        series: [
          {
            name: option.label,
            type: "bar",
            barMaxWidth: 28,
            data: values,
            itemStyle: { color: "#334e68", borderRadius: [5, 5, 0, 0] }
          },
          {
            name: "同比",
            type: "line",
            yAxisIndex: 1,
            smooth: true,
            symbolSize: 7,
            data: yoyValues,
            lineStyle: { width: 3, color: "#d49a3a" },
            itemStyle: { color: "#d49a3a" }
          }
        ]
      });
    };
    if (industrySelect && industryCumulativeRows.length) {
      const selectedIndustry = setSelectOptions(industrySelect, industryOptions.map((item) => item.label), "二产");
      industrySelect.addEventListener("change", () => renderIndustryChart(industrySelect.value));
      renderIndustryChart(selectedIndustry);
    }

    bindMonthSelect("power-consumption-month", data.powerConsumptionMonthly, consumption.month, (month) => {
      const row = findByMonth(data.powerConsumptionMonthly, month);
      setText("power-consumption-month-note", `${month} 全社会 ${fmt(row.total)} 亿kWh，同比 ${pct(row.totalYoy)}`);
      const bars = [
        { label: "一产", value: row.primary, display: `${fmt(row.primary)} 亿` },
        { label: "二产", value: row.secondary, display: `${fmt(row.secondary)} 亿` },
        { label: "三产", value: row.tertiary, display: `${fmt(row.tertiary)} 亿` },
        { label: "居民", value: row.residential, display: `${fmt(row.residential)} 亿` }
      ];
      renderBars("power-consumption-bars", bars, Math.max(...bars.map((item) => item.value || 0)), "green");
    });

    const consumptionStructureRows = (data.powerConsumptionMonthly || [])
      .filter((row) => row.month)
      .slice()
      .sort((a, b) => a.month.localeCompare(b.month));
    const consumptionStructureSeries = [
      { name: "一产", field: "primary" },
      { name: "二产", field: "secondary" },
      { name: "三产", field: "tertiary" },
      { name: "居民", field: "residential" }
    ];
    renderChart("power-consumption-structure-chart", {
      tooltip: {
        ...tooltipStyle,
        trigger: "axis",
        axisPointer: { type: "shadow" },
        formatter: (params) => {
          const items = Array.isArray(params) ? params : [params];
          const month = items[0]?.axisValueLabel || items[0]?.axisValue || items[0]?.name || "";
          return [month, ...items.map((item) => {
            const value = item.value === null || item.value === undefined
              ? "-"
              : Number(item.value).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
            return `${item.marker}${item.seriesName}：<strong>${value} 亿kWh</strong>`;
          })].join("<br>");
        }
      },
      legend: { top: 8, textStyle: { color: "#74808a", fontSize: 11 } },
      grid: { left: 58, right: 24, top: 58, bottom: 72 },
      xAxis: { type: "category", data: consumptionStructureRows.map((row) => row.month), ...axisStyle },
      dataZoom: [
        { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
        { type: "slider", xAxisIndex: 0, bottom: 12, height: 18, brushSelect: false }
      ],
      yAxis: { type: "value", name: "亿kWh", ...axisStyle },
      series: consumptionStructureSeries.map((item) => ({
        name: item.name,
        type: "bar",
        stack: "industry",
        barMaxWidth: 28,
        data: consumptionStructureRows.map((row) => row[item.field])
      }))
    });

    const powerSourceOptions = [
      { label: "火电", field: "thermal", yoyField: "thermalYoy" },
      { label: "水电", field: "hydro", yoyField: "hydroYoy" },
      { label: "核电", field: "nuclear", yoyField: "nuclearYoy" },
      { label: "风电", field: "wind", yoyField: "windYoy" },
      { label: "太阳能", field: "solar", yoyField: "solarYoy" }
    ];
    const generationSourceRows = data.powerGenerationMonthly
      .slice()
      .reverse();
    const capacitySourceRows = data.installedCapacityMonthly
      .slice()
      .reverse();

    const renderGenerationSourceChart = (label) => {
      const source = powerSourceOptions.find((item) => item.label === label) || powerSourceOptions[0];
      const latestRow = generationSourceRows[generationSourceRows.length - 1] || {};
      setText("power-generation-source-note", latestRow.month ? `${latestRow.month} ${source.label}发电同比 ${pct(latestRow[source.yoyField])}；总发电量 ${fmt(latestRow.total)} 亿kWh` : "选择电源查看走势");
      renderChart("power-generation-source-chart", {
        tooltip: {
          ...tooltipStyle,
          formatter: (params) => {
            const items = Array.isArray(params) ? params : [params];
            const title = items[0]?.axisValue || "";
            return [title, ...items.map((item) => {
              const unit = item.seriesName.includes("同比") ? "%" : " 亿kWh";
              const value = item.value === null || item.value === undefined ? "-" : Number(item.value).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
              return `${item.marker}${item.seriesName}: ${value}${unit}`;
            })].join("<br>");
          }
        },
        legend: { top: 8, textStyle: { color: "#74808a", fontSize: 11 } },
        grid: { left: 58, right: 54, top: 58, bottom: 72 },
        xAxis: { type: "category", data: generationSourceRows.map((row) => row.month), ...axisStyle },
        dataZoom: [
          { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
          { type: "slider", xAxisIndex: 0, bottom: 12, height: 18, brushSelect: false }
        ],
        yAxis: [
          { type: "value", name: "亿kWh", ...axisStyle },
          { type: "value", name: "%", ...axisStyle, splitLine: { show: false } }
        ],
        series: [
          {
            name: "规上总发电量",
            type: "bar",
            barMaxWidth: 24,
            data: generationSourceRows.map((row) => row.total),
            itemStyle: { color: "#334e68", borderRadius: [5, 5, 0, 0] }
          },
          {
            name: `${source.label}同比`,
            type: "line",
            yAxisIndex: 1,
            smooth: true,
            symbolSize: 7,
            data: generationSourceRows.map((row) => row[source.yoyField]),
            lineStyle: { width: 3, color: "#d49a3a" },
            itemStyle: { color: "#d49a3a" }
          }
        ]
      });
    };

    const renderCapacitySourceChart = (label) => {
      const source = powerSourceOptions.find((item) => item.label === label) || powerSourceOptions[0];
      const values = capacitySourceRows.map((row) => +(Number(row[source.field] || 0) / 10000).toFixed(2));
      const yoyValues = capacitySourceRows.map((row) => {
        if (row[source.yoyField] !== null && row[source.yoyField] !== undefined) return row[source.yoyField];
        const lastYearMonth = `${Number(row.month.slice(0, 4)) - 1}${row.month.slice(4)}`;
        const lastYearRow = findByMonth(data.installedCapacityMonthly, lastYearMonth);
        const base = Number(lastYearRow?.[source.field]);
        if (!base) return null;
        return +(((Number(row[source.field] || 0) / base) - 1) * 100).toFixed(1);
      });
      const latestIndex = capacitySourceRows.length - 1;
      const latestRow = capacitySourceRows[latestIndex] || {};
      const latestYoy = yoyValues[latestIndex];
      setText("power-capacity-source-note", latestRow.month ? `${latestRow.month} ${source.label}装机 ${fmt(Number(latestRow[source.field] || 0) / 10000, 2)} 亿kW，同比 ${pct(latestYoy)}` : "选择电源查看走势");
      renderChart("power-capacity-source-chart", {
        tooltip: {
          ...tooltipStyle,
          formatter: (params) => {
            const items = Array.isArray(params) ? params : [params];
            const title = items[0]?.axisValue || "";
            return [title, ...items.map((item) => {
              const unit = item.seriesName.includes("同比") ? "%" : " 亿kW";
              const value = item.value === null || item.value === undefined ? "-" : Number(item.value).toLocaleString("zh-CN", { maximumFractionDigits: 2 });
              return `${item.marker}${item.seriesName}: ${value}${unit}`;
            })].join("<br>");
          }
        },
        legend: { top: 8, textStyle: { color: "#74808a", fontSize: 11 } },
        grid: { left: 58, right: 54, top: 58, bottom: 72 },
        xAxis: { type: "category", data: capacitySourceRows.map((row) => row.month), ...axisStyle },
        dataZoom: [
          { type: "inside", xAxisIndex: 0, start: 0, end: 100 },
          { type: "slider", xAxisIndex: 0, bottom: 12, height: 18, brushSelect: false }
        ],
        yAxis: [
          { type: "value", name: "亿kW", ...axisStyle },
          { type: "value", name: "%", ...axisStyle, splitLine: { show: false } }
        ],
        series: [
          {
            name: `${source.label}装机`,
            type: "bar",
            barMaxWidth: 24,
            data: values,
            itemStyle: { color: "#334e68", borderRadius: [5, 5, 0, 0] }
          },
          {
            name: `${source.label}同比`,
            type: "line",
            yAxisIndex: 1,
            smooth: true,
            symbolSize: 7,
            data: yoyValues,
            lineStyle: { width: 3, color: "#d49a3a" },
            itemStyle: { color: "#d49a3a" }
          }
        ]
      });
    };

    const generationSourceSelect = document.getElementById("power-generation-source");
    if (generationSourceSelect && generationSourceRows.length) {
      const selectedSource = setSelectOptions(generationSourceSelect, powerSourceOptions.map((item) => item.label), "火电");
      generationSourceSelect.addEventListener("change", () => renderGenerationSourceChart(generationSourceSelect.value));
      renderGenerationSourceChart(selectedSource);
    }
    const capacitySourceSelect = document.getElementById("power-capacity-source");
    if (capacitySourceSelect && capacitySourceRows.length) {
      const selectedSource = setSelectOptions(capacitySourceSelect, powerSourceOptions.map((item) => item.label), "火电");
      capacitySourceSelect.addEventListener("change", () => renderCapacitySourceChart(capacitySourceSelect.value));
      renderCapacitySourceChart(selectedSource);
    }

    bindMonthSelect("power-generation-month", data.powerGenerationMonthly, generation.month, (month) => {
      const row = findByMonth(data.powerGenerationMonthly, month);
      setText("power-generation-month-note", `${month} 发电量 ${fmt(row.total)} 亿kWh，同比 ${pct(row.totalYoy)}`);
      const values = [row.thermalYoy, row.hydroYoy, row.nuclearYoy, row.windYoy, row.solarYoy].filter((value) => value !== null && value !== undefined);
      const minValue = Math.min(0, ...values);
      const bars = [
        { label: "火电", value: row.thermalYoy - minValue, display: pct(row.thermalYoy) },
        { label: "水电", value: row.hydroYoy - minValue, display: pct(row.hydroYoy) },
        { label: "核电", value: row.nuclearYoy - minValue, display: pct(row.nuclearYoy) },
        { label: "风电", value: row.windYoy - minValue, display: pct(row.windYoy) },
        { label: "太阳能", value: row.solarYoy - minValue, display: pct(row.solarYoy) }
      ];
      renderBars("power-generation-bars", bars, Math.max(...bars.map((item) => item.value || 0)), "amber");
    });

    bindMonthSelect("power-capacity-month", data.installedCapacityMonthly, capacity.month, (month) => {
      const row = findByMonth(data.installedCapacityMonthly, month);
      setText("power-capacity-month-note", `${month} 总装机 ${fmt(row.total / 10000, 2)} 亿kW，同比 ${pct(row.totalYoy)}`);
      const bars = [
        { label: "水电", value: row.hydro, display: `${fmt(row.hydro / 10000, 2)} 亿kW` },
        { label: "火电", value: row.thermal, display: `${fmt(row.thermal / 10000, 2)} 亿kW` },
        { label: "核电", value: row.nuclear, display: `${fmt(row.nuclear / 10000, 2)} 亿kW` },
        { label: "风电", value: row.wind, display: `${fmt(row.wind / 10000, 2)} 亿kW` },
        { label: "太阳能", value: row.solar, display: `${fmt(row.solar / 10000, 2)} 亿kW` }
      ];
      renderBars("power-capacity-bars", bars, Math.max(...bars.map((item) => item.value || 0)));
    });

    bindMonthSelect("power-additions-month", data.installedCapacityAdditions || [], additions.month, (month) => {
      const row = findByMonth(data.installedCapacityAdditions || [], month);
      setText("power-additions-month-note", `${month} 净增 ${fmt(row.total / 100, 1)} GW，风光 ${fmt(((row.wind || 0) + (row.solar || 0)) / 100, 1)} GW`);
      const bars = [
        { label: "水电", value: row.hydro, display: `${fmt(row.hydro / 100, 1)} GW` },
        { label: "火电", value: row.thermal, display: `${fmt(row.thermal / 100, 1)} GW` },
        { label: "核电", value: row.nuclear, display: `${fmt(row.nuclear / 100, 1)} GW` },
        { label: "风电", value: row.wind, display: `${fmt(row.wind / 100, 1)} GW` },
        { label: "太阳能", value: row.solar, display: `${fmt(row.solar / 100, 1)} GW` }
      ];
      renderBars("power-additions-bars", bars, Math.max(...bars.map((item) => item.value || 0)), "green");
    });

    const months = [...new Set([
      ...data.powerConsumptionMonthly.map((row) => row.month),
      ...data.powerGenerationMonthly.map((row) => row.month),
      ...data.installedCapacityMonthly.map((row) => row.month)
    ])];
    const body = document.getElementById("power-monthly-body");
    if (body) {
      body.innerHTML = months.map((month) => {
        const c = findByMonth(data.powerConsumptionMonthly, month);
        const g = findByMonth(data.powerGenerationMonthly, month);
        const cap = findByMonth(data.installedCapacityMonthly, month);
        const add = findByMonth(data.installedCapacityAdditions || [], month);
        return `
          <tr>
            <td>${month}</td>
            <td>${fmt(c.total)}</td>
            <td>${pct(c.totalYoy)}</td>
            <td>${fmt(g.total)}</td>
            <td>${pct(g.totalYoy)}</td>
            <td>${Number.isFinite(Number(cap.total)) ? `${fmt(cap.total / 10000, 2)} 亿kW` : "—"}</td>
            <td>${pct(cap.totalYoy)}</td>
            <td>${Number.isFinite(Number(add.total)) ? `${fmt(add.total / 100, 1)} GW` : "—"}</td>
          </tr>
        `;
      }).join("");
    }
    renderProvinceCapacity();
  };

  document.addEventListener("DOMContentLoaded", () => {
    installPercentColorizer();
    setupPageRange("hydro-history-range", "workbench-range-hydro", [
      { key: "hydroWeeklyHistory", field: "weekStart" }
    ]);
    setupPageRange("price-history-range", "workbench-range-price", [
      { key: "spotWeeklyHistory", field: "weekStart" },
      { key: "proxyPurchaseHistory", field: "month" },
      { key: "systemFeeHistory", field: "month" },
      { key: "dayAheadDailyHistory", field: "date" },
      { key: "dayAheadWeeklyHistory", field: "weekStart" }
    ]);
    setupPageRange("power-history-range", "workbench-range-power", [
      { key: "powerConsumptionMonthly", field: "month" },
      { key: "powerGenerationMonthly", field: "month" },
      { key: "installedCapacityMonthly", field: "month" },
      { key: "installedCapacityAdditions", field: "month" }
    ]);
    renderDashboard();
    renderDataCatalog();
    renderHydroPage();
    renderPricePage();
    renderPowerPage();
    const nationalMonthlyPanel = document.getElementById("power-monthly-panel");
    const provinceCapacitySection = document.getElementById("province-capacity-section");
    if (nationalMonthlyPanel && provinceCapacitySection) {
      provinceCapacitySection.parentNode.insertBefore(nationalMonthlyPanel, provinceCapacitySection);
    }
    enhanceWideTables();
    normalizeVisibleTimeText();
    waitForEcharts();
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => chartInstances.forEach((chart) => chart.resize()), 120);
    });
  });
})();
