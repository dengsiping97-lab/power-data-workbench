(function () {
  const data = window.CONSUMPTION_DATA;
  if (!data) return;

  const charts = new Map();
  const colors = { wind: "#334e68", solar: "#d49a3a", accent: "#2f7e86" };
  const state = { months: 24 };

  const fmt = (value, digits = 1) => value === null || value === undefined
    ? "—"
    : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
  const pct = (value) => value === null || value === undefined ? "—" : `${Number(value).toFixed(1)}%`;
  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };
  const monthIndex = (month) => Number(String(month).slice(0, 4)) * 12 + Number(String(month).slice(5, 7));
  const filterWindow = (rows, field) => {
    const valid = rows.filter((row) => row[field] !== null && row[field] !== undefined);
    if (!valid.length) return [];
    const latest = Math.max(...valid.map((row) => monthIndex(row.month)));
    return valid.filter((row) => monthIndex(row.month) >= latest - state.months + 1);
  };
  const latestWithValue = (rows, field) => [...rows].reverse().find((row) => row[field] !== null && row[field] !== undefined);
  const unique = (values) => [...new Set(values.filter(Boolean))];

  const axisStyle = {
    axisLine: { lineStyle: { color: "#d9e2e7" } },
    axisTick: { show: false },
    axisLabel: { color: "#74808a", fontSize: 11 },
    splitLine: { lineStyle: { color: "#e8eef1" } }
  };
  const tooltip = {
    trigger: "axis",
    backgroundColor: "rgba(45,29,27,.96)",
    borderWidth: 0,
    textStyle: { color: "#fff", fontSize: 12 },
    padding: [10, 12]
  };

  function renderChart(id, option) {
    const node = document.getElementById(id);
    if (!node || !window.echarts) return;
    const chart = charts.get(id) || window.echarts.init(node, null, { renderer: "canvas" });
    charts.set(id, chart);
    chart.setOption({
      animationDuration: 450,
      textStyle: { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif' },
      ...option
    }, true);
  }

  function setSelectOptions(select, values, preferred) {
    if (!select) return null;
    const previous = select.value;
    select.innerHTML = values.map((value) => `<option value="${value}">${value}</option>`).join("");
    const selected = values.includes(previous) ? previous : values.includes(preferred) ? preferred : values.at(-1);
    if (selected) select.value = selected;
    return selected;
  }

  function setupRange() {
    const select = document.getElementById("consumption-history-range");
    const options = [
      [3, "近 3 个月"], [6, "近 6 个月"], [12, "近 1 年"], [24, "近 2 年"]
    ];
    select.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    select.value = String(state.months);
    select.addEventListener("change", () => {
      state.months = Number(select.value);
      renderNational();
      renderRegion();
      renderOperations();
    });
  }

  function renderSummary() {
    const windMonth = latestWithValue(data.nationalUtilization, "windMonthRate");
    const solarMonth = latestWithValue(data.nationalUtilization, "solarMonthRate");
    const windCum = latestWithValue(data.nationalUtilization, "windCumulativeRate");
    const solarCum = latestWithValue(data.nationalUtilization, "solarCumulativeRate");
    setText("consumption-wind-month-rate", pct(windMonth?.windMonthRate));
    setText("consumption-wind-month-note", `${windMonth?.month || "—"} 单月值`);
    setText("consumption-solar-month-rate", pct(solarMonth?.solarMonthRate));
    setText("consumption-solar-month-note", `${solarMonth?.month || "—"} 单月值`);
    setText("consumption-wind-cumulative-rate", pct(windCum?.windCumulativeRate));
    setText("consumption-wind-cumulative-note", `${windCum?.month || "—"} 年内累计`);
    setText("consumption-solar-cumulative-rate", pct(solarCum?.solarCumulativeRate));
    setText("consumption-solar-cumulative-note", `${solarCum?.month || "—"} 年内累计`);
    setText("consumption-freshness-month", `截至 ${data.freshness.monthRate}`);
    setText("consumption-freshness-cumulative", `截至 ${data.freshness.cumulativeRate}`);
    setText("consumption-freshness-generation", `截至 ${data.freshness.generation}`);
    setText("consumption-freshness-capacity", `截至 ${data.freshness.capacity}`);
  }

  function renderNational() {
    const period = document.getElementById("consumption-national-period-type").value;
    const windField = period === "month" ? "windMonthRate" : "windCumulativeRate";
    const solarField = period === "month" ? "solarMonthRate" : "solarCumulativeRate";
    const rows = data.nationalUtilization.filter((row) => row[windField] !== null || row[solarField] !== null);
    const windowed = filterWindow(rows, windField);
    renderChart("consumption-national-chart", {
      color: [colors.wind, colors.solar], tooltip,
      legend: { top: 8, textStyle: { color: "#74808a" } },
      grid: { left: 58, right: 24, top: 58, bottom: 64 },
      xAxis: { type: "category", data: windowed.map((row) => row.month), ...axisStyle },
      yAxis: { type: "value", name: "%", min: (value) => Math.max(0, Math.floor(value.min - 3)), max: 100, ...axisStyle },
      dataZoom: [{ type: "inside" }, { type: "slider", bottom: 10, height: 18, brushSelect: false }],
      series: [
        { name: "风电利用率", type: "line", smooth: true, symbolSize: 7, data: windowed.map((row) => row[windField]), connectNulls: false, lineStyle: { width: 3 } },
        { name: "光伏利用率", type: "line", smooth: true, symbolSize: 7, data: windowed.map((row) => row[solarField]), connectNulls: false, lineStyle: { width: 3 } }
      ]
    });
  }

  function rankingField() {
    const period = document.getElementById("consumption-ranking-period").value;
    const energy = document.getElementById("consumption-ranking-energy").value;
    return `${energy}${period === "month" ? "Month" : "Cumulative"}Rate`;
  }

  function refreshRankingMonths() {
    const field = rankingField();
    const months = unique(data.regionalUtilization
      .filter((row) => row.region !== "全国" && row[field] !== null)
      .map((row) => row.month)).sort();
    const monthSelect = document.getElementById("consumption-ranking-month");
    monthSelect.innerHTML = months.map((month) => `<option value="${month}">${month}</option>`).join("");
    monthSelect.value = months.at(-1) || "";
    renderRanking();
  }

  function renderRanking() {
    const field = rankingField();
    const month = document.getElementById("consumption-ranking-month").value;
    const energy = document.getElementById("consumption-ranking-energy").value;
    const label = energy === "wind" ? "风电" : "光伏";
    const rows = data.regionalUtilization
      .filter((row) => row.month === month && row.region !== "全国" && row[field] !== null)
      .map((row) => ({ region: row.region, value: row[field] }))
      .sort((a, b) => b.value - a.value);
    setText("consumption-ranking-coverage", `${rows.length} 个区域`);
    setText("consumption-ranking-note", `${month} ${label}利用率，数值越低消纳压力越值得跟踪`);
    renderChart("consumption-ranking-chart", {
      color: [energy === "wind" ? colors.wind : colors.solar],
      tooltip: { trigger: "item", formatter: (item) => `${item.name}<br>${label}利用率：${pct(item.value)}` },
      grid: { left: 72, right: 28, top: 16, bottom: 30 },
      xAxis: { type: "value", name: "%", min: (value) => Math.max(0, Math.floor(value.min - 3)), max: 100, ...axisStyle },
      yAxis: { type: "category", inverse: true, data: rows.map((row) => row.region), ...axisStyle },
      series: [{ type: "bar", data: rows.map((row) => row.value), barMaxWidth: 15, itemStyle: { borderRadius: [0, 5, 5, 0] } }]
    });
    const body = document.getElementById("consumption-ranking-body");
    body.innerHTML = rows.map((row, index) => `<tr><td>${index + 1}</td><td>${row.region}</td><td>${pct(row.value)}</td></tr>`).join("");
  }

  function renderRegion() {
    const region = document.getElementById("consumption-region-select").value;
    const period = document.getElementById("consumption-region-period").value;
    const windField = period === "month" ? "windMonthRate" : "windCumulativeRate";
    const solarField = period === "month" ? "solarMonthRate" : "solarCumulativeRate";
    const rows = data.regionalUtilization.filter((row) => row.region === region && (row[windField] !== null || row[solarField] !== null));
    const windowed = filterWindow(rows, windField);
    const latest = windowed.at(-1);
    setText("consumption-region-note", latest ? `${region} ${latest.month}：风电 ${pct(latest[windField])}，光伏 ${pct(latest[solarField])}` : `${region}暂无可用数据`);
    renderChart("consumption-region-chart", {
      color: [colors.wind, colors.solar], tooltip,
      legend: { top: 8, textStyle: { color: "#74808a" } },
      grid: { left: 58, right: 24, top: 58, bottom: 64 },
      xAxis: { type: "category", data: windowed.map((row) => row.month), ...axisStyle },
      yAxis: { type: "value", name: "%", min: (value) => Math.max(0, Math.floor(value.min - 3)), max: 100, ...axisStyle },
      dataZoom: [{ type: "inside" }, { type: "slider", bottom: 10, height: 18, brushSelect: false }],
      series: [
        { name: "风电利用率", type: "line", smooth: true, symbolSize: 7, data: windowed.map((row) => row[windField]), connectNulls: false, lineStyle: { width: 3 } },
        { name: "光伏利用率", type: "line", smooth: true, symbolSize: 7, data: windowed.map((row) => row[solarField]), connectNulls: false, lineStyle: { width: 3 } }
      ]
    });
  }

  function simpleSeriesChart(id, rows, field, name, unit, type, transform = (value) => value) {
    const windowed = filterWindow(rows, field);
    renderChart(id, {
      color: [colors.accent],
      tooltip: { ...tooltip, formatter: (params) => { const item = Array.isArray(params) ? params[0] : params; return `${item.axisValue}<br>${item.marker}${name}：${fmt(item.value, 2)} ${unit}`; } },
      grid: { left: 58, right: 22, top: 24, bottom: 58 },
      xAxis: { type: "category", data: windowed.map((row) => row.month), ...axisStyle },
      yAxis: { type: "value", name: unit, ...axisStyle },
      dataZoom: [{ type: "inside" }, { type: "slider", bottom: 8, height: 16, brushSelect: false }],
      series: [{ name, type, smooth: type === "line", symbolSize: 6, barMaxWidth: 22, data: windowed.map((row) => transform(row[field])), itemStyle: { borderRadius: type === "bar" ? [5, 5, 0, 0] : 0 }, lineStyle: { width: 3 } }]
    });
  }

  function renderUtilizationHoursComparison(energy, label) {
    const yearColors = { 2024: "#6f8fa6", 2025: "#d49a3a", 2026: "#2f7e86" };
    const rows = data.utilizationHoursComparison || [];
    renderChart("consumption-hours-chart", {
      color: rows.map((row) => yearColors[row.year]),
      tooltip: {
        ...tooltip,
        formatter: (params) => {
          const items = Array.isArray(params) ? params : [params];
          return [items[0]?.axisValue || "", ...items.map((item) => `${item.marker}${item.seriesName}：${item.value === null || item.value === undefined ? "—" : `${fmt(item.value, 0)} 小时`}`)].join("<br>");
        }
      },
      legend: { top: 4, textStyle: { color: "#74808a", fontSize: 11 } },
      grid: { left: 58, right: 22, top: 48, bottom: 40 },
      xAxis: {
        type: "category",
        data: Array.from({ length: 12 }, (_, index) => `${index + 1}月`),
        ...axisStyle,
        axisLabel: { ...axisStyle.axisLabel, interval: 0, fontSize: 10 }
      },
      yAxis: { type: "value", name: "小时", ...axisStyle },
      series: rows.map((row) => ({
        name: `${row.year}年`,
        type: "line",
        smooth: false,
        symbolSize: 7,
        connectNulls: false,
        data: row[energy],
        lineStyle: { width: row.year === 2026 ? 3.5 : 2.5 },
        itemStyle: { color: yearColors[row.year] }
      }))
    });
  }

  function renderOperations() {
    const energy = document.getElementById("consumption-operation-energy").value;
    const label = energy === "wind" ? "风电" : "光伏";
    const generationField = `${energy}GenerationMonth`;
    const capacityField = `${energy}Capacity`;
    const hoursField = `${energy}UtilizationHours`;
    const generation = latestWithValue(data.nationalOperations, generationField);
    const capacity = latestWithValue(data.nationalOperations, capacityField);
    const hours = latestWithValue(data.nationalOperations, hoursField);
    setText("consumption-generation-latest", `${fmt(generation?.[generationField], 1)} 亿kWh`);
    setText("consumption-generation-note", `${generation?.month || "—"} ${label}规上工业发电量`);
    const capacityValue = capacity?.[capacityField];
    setText("consumption-capacity-latest", capacityValue === null || capacityValue === undefined ? "—" : `${fmt(capacityValue / 10000, 2)} 亿kW`);
    setText("consumption-capacity-note", `${capacity?.month || "—"} ${label}全国全口径累计装机`);
    setText("consumption-hours-latest", `${fmt(hours?.[hoursField], 0)} 小时`);
    setText("consumption-hours-note", `${hours?.month || "—"} ${label}年内累计利用小时`);
    simpleSeriesChart("consumption-generation-chart", data.nationalOperations, generationField, `${label}单月发电量`, "亿kWh", "bar");
    simpleSeriesChart("consumption-capacity-chart", data.nationalOperations, capacityField, `${label}累计装机`, "亿kW", "line", (value) => Number((value / 10000).toFixed(3)));
    renderUtilizationHoursComparison(energy, label);
  }

  document.addEventListener("DOMContentLoaded", () => {
    setupRange();
    renderSummary();
    const nationalPeriod = document.getElementById("consumption-national-period-type");
    nationalPeriod.addEventListener("change", renderNational);
    document.getElementById("consumption-ranking-period").addEventListener("change", refreshRankingMonths);
    document.getElementById("consumption-ranking-energy").addEventListener("change", refreshRankingMonths);
    document.getElementById("consumption-ranking-month").addEventListener("change", renderRanking);
    const regions = unique(data.regionalUtilization.filter((row) => row.region !== "全国").map((row) => row.region)).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    setSelectOptions(document.getElementById("consumption-region-select"), regions, "新疆");
    document.getElementById("consumption-region-select").addEventListener("change", renderRegion);
    document.getElementById("consumption-region-period").addEventListener("change", renderRegion);
    document.getElementById("consumption-operation-energy").addEventListener("change", renderOperations);
    renderNational();
    refreshRankingMonths();
    renderRegion();
    renderOperations();
    window.addEventListener("echarts-ready", () => {
      renderNational();
      renderRegion();
      renderOperations();
    }, { once: true });
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => charts.forEach((chart) => chart.resize()), 120);
    });
  });
})();
