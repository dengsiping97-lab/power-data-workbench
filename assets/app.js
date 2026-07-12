(function () {
  const data = window.WORKBENCH_DATA;
  if (!data) return;

  const fmt = (value, digits = 0) => {
    if (value === null || value === undefined || value === "") return "-";
    return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
  };

  const pct = (value) => {
    if (value === null || value === undefined || value === "") return "-";
    const number = Number(value);
    const sign = number > 0 ? "+" : "";
    return `${sign}${number.toFixed(1)}%`;
  };

  const setText = (id, text) => {
    const node = document.getElementById(id);
    if (node) node.textContent = text;
  };

  const chartInstances = new Map();
  const chartColors = ["#0f7f78", "#2c6f9d", "#b97716", "#7b68a6", "#b64b42"];

  const renderChart = (id, option) => {
    const node = document.getElementById(id);
    if (!node) return null;
    if (!window.echarts) {
      node.innerHTML = '<div class="chart-fallback">图表组件加载失败，明细数据仍可在下方表格查看。</div>';
      return null;
    }
    const chart = chartInstances.get(id) || window.echarts.init(node, null, { renderer: "canvas" });
    chartInstances.set(id, chart);
    chart.setOption({
      color: chartColors,
      animationDuration: 500,
      textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif' },
      ...option
    }, true);
    return chart;
  };

  const axisStyle = {
    axisLine: { lineStyle: { color: "#dfe7e8" } },
    axisTick: { show: false },
    axisLabel: { color: "#66808a", fontSize: 11 },
    splitLine: { lineStyle: { color: "#edf2f2" } }
  };

  const tooltipStyle = {
    trigger: "axis",
    backgroundColor: "rgba(10, 24, 32, .94)",
    borderWidth: 0,
    textStyle: { color: "#fff", fontSize: 12 },
    padding: [10, 12]
  };

  const uniqueSorted = (rows, field) => [...new Set(rows.map((row) => row[field]).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));

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
    const avgProxy = data.proxyPurchaseLatest?.length ? avg(data.proxyPurchaseLatest.map((row) => row.proxyPrice)) : null;

    setText("metric-hydro-signal", `${latestWeek.isoYear}-W${latestWeek.isoWeek}`);
    setText("metric-hydro-note", `${hydroCount} 个周度电站快照，${threeGorges.station}入库 ${fmt(threeGorges.inflow)} m3/s，同比 ${pct(threeGorges.inflowYoy)}`);
    setText("metric-hydro-hour", latestHour.time.slice(5));
    setText("metric-hydro-hour-note", `${latestHour.river} ${latestHour.station} 入库 ${fmt(latestHour.inflow)} m3/s`);
    setText("metric-spot", `${fmt(avgSpot, 0)}`);
    setText("metric-spot-note", `${latestSpot.isoYear}-W${latestSpot.isoWeek} 周度均值，单位元/MWh`);
    setText("metric-proxy", avgProxy ? `${fmt(avgProxy, 0)}` : "跟踪中");
    setText("metric-proxy-note", latestProxy ? `${latestProxy.month}，${data.proxyPurchaseLatest.length} 个省份样本，单位元/MWh` : "按省份查看月度历史");
    setText("metric-power", latestPower?.month || latestCapacity?.month || "月度");
    setText("metric-power-note", latestPower && latestCapacity ? `用电 ${fmt(latestPower.total)} 亿kWh；装机 ${fmt(latestCapacity.total / 10000, 1)} 亿kW` : "用电、发电、装机结构联动");
    setText("metric-dataset", `${data.datasets.p0.length} 张`);
    setText("metric-dataset-note", `P0 可直接接入，更新于 ${data.updatedAt}`);

    const freshness = data.freshness || {};
    setText("freshness-snapshot", data.updatedAt);
    setText("freshness-hydro-week", freshness.hydroWeekly || `${latestWeek.isoYear}-W${latestWeek.isoWeek}`);
    setText("freshness-hydro-hour", freshness.hydroHourly || latestHour.time);
    setText("freshness-spot", freshness.spotWeekly || latestSpot?.weekStart || "-");
    setText("freshness-proxy", freshness.proxyMonthly || latestProxy?.month || "-");

    const riverQtd = buildRiverQtd();
    const strongestRiver = [...riverQtd]
      .filter((row) => row.qtdInflow && row.avg7dInflow)
      .sort((a, b) => (b.avg7dInflow / b.qtdInflow) - (a.avg7dInflow / a.qtdInflow))[0];
    const avgBenchmark = avg(data.spotWeeklyLatest.map((row) => row.coalBenchmark));
    const spotSpread = avgBenchmark ? avgSpot - avgBenchmark : null;
    const hydroPhrase = strongestRiver
      ? `${strongestRiver.river}近 7 日较 QTD ${strongestRiver.avg7dInflow >= strongestRiver.qtdInflow ? "改善" : "回落"}`
      : "重点流域等待更多样本";
    const pricePhrase = spotSpread === null
      ? "现货价格继续观察"
      : `样本省份现货均价较煤电基准${spotSpread >= 0 ? "高" : "低"} ${fmt(Math.abs(spotSpread), 0)} 元/MWh`;
    setText("weekly-brief-title", `${hydroPhrase}，${pricePhrase}`);
    setText("weekly-brief-note", `快照更新于 ${data.updatedAt}。现货、来水和代理购电采用各自最新可得口径，不将旧数据冒充本周数据。`);
    setText("watch-hydro", strongestRiver ? `${strongestRiver.river}：近7日 ${fmt(strongestRiver.avg7dInflow)}，QTD ${fmt(strongestRiver.qtdInflow)} m3/s。` : "比较近 7 日、近 14 日和 QTD 来水。");
    setText("watch-price", `${data.spotWeeklyLatest.length} 个省份样本，最新数据期 ${freshness.spotWeekly || latestSpot?.weekStart || "-"}。`);
    setText("watch-power", latestPower && latestCapacity ? `${latestPower.month}用电 ${fmt(latestPower.total)} 亿kWh，总装机 ${fmt(latestCapacity.total / 10000, 1)} 亿kW。` : "用电、发电和装机共同验证供需。");

    const riverRows = riverQtd.slice(0, 8);
    renderChart("home-hydro-chart", {
      tooltip: { ...tooltipStyle, valueFormatter: (value) => `${fmt(value)} m3/s` },
      legend: { top: 12, right: 18, textStyle: { color: "#66808a", fontSize: 11 } },
      grid: { left: 58, right: 24, top: 58, bottom: 48 },
      xAxis: { type: "category", data: riverRows.map((row) => row.river), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, rotate: riverRows.length > 6 ? 24 : 0 } },
      yAxis: { type: "value", name: "m3/s", nameTextStyle: { color: "#66808a" }, ...axisStyle },
      series: [
        { name: "近7日", type: "bar", barMaxWidth: 22, data: riverRows.map((row) => row.avg7dInflow), itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: "近14日", type: "bar", barMaxWidth: 22, data: riverRows.map((row) => row.avg14dInflow), itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: "QTD", type: "line", smooth: true, symbolSize: 7, data: riverRows.map((row) => row.qtdInflow), lineStyle: { width: 2.5 } }
      ]
    });

    const priceRows = data.spotWeeklyLatest
      .filter((row) => row.spotAvg !== null && row.coalBenchmark !== null)
      .map((row) => ({ ...row, spread: row.spotAvg - row.coalBenchmark }))
      .sort((a, b) => Math.abs(b.spread) - Math.abs(a.spread))
      .slice(0, 10)
      .sort((a, b) => a.spotAvg - b.spotAvg);
    renderChart("home-price-chart", {
      tooltip: { ...tooltipStyle, valueFormatter: (value) => `${fmt(value, 1)} 元/MWh` },
      legend: { top: 12, right: 18, textStyle: { color: "#66808a", fontSize: 11 } },
      grid: { left: 52, right: 28, top: 58, bottom: 30, containLabel: true },
      xAxis: { type: "value", ...axisStyle },
      yAxis: { type: "category", data: priceRows.map((row) => row.province), ...axisStyle },
      series: [
        { name: "现货均价", type: "bar", data: priceRows.map((row) => row.spotAvg), barMaxWidth: 13, itemStyle: { borderRadius: [0, 4, 4, 0] } },
        { name: "煤电基准", type: "scatter", symbol: "diamond", symbolSize: 10, data: priceRows.map((row, index) => [row.coalBenchmark, index]) }
      ]
    });

    const hydroBody = document.getElementById("hydro-latest-body");
    if (hydroBody) {
      hydroBody.innerHTML = data.hydroWeeklyLatest.slice(0, 8).map((row) => `
        <tr>
          <td>${row.station}</td>
          <td>${row.basin}</td>
          <td>${row.isoYear}-W${row.isoWeek}</td>
          <td>${fmt(row.inflow)}</td>
          <td>${pct(row.inflowYoy)}</td>
          <td>${fmt(row.waterLevel, 2)}</td>
        </tr>
      `).join("");
    }

    const spotBody = document.getElementById("spot-latest-body");
    if (spotBody) {
      spotBody.innerHTML = data.spotWeeklyLatest.map((row) => `
        <tr>
          <td>${row.province}</td>
          <td>${fmt(row.coalBenchmark, 1)}</td>
          <td>${row.isoYear}-W${row.isoWeek}</td>
          <td>${fmt(row.spotAvg, 1)}</td>
          <td>${row.spotYoy || "-"}</td>
          <td>${pct(row.spotWow)}</td>
        </tr>
      `).join("");
    }
  };

  const renderDataCatalog = () => {
    setText("summary-p0-count", `${data.datasets.p0.length}`);
    setText("summary-p1-count", `${data.datasets.p1.length}`);
    setText("summary-updated", data.updatedAt);

    const p0Body = document.getElementById("p0-dataset-body");
    if (p0Body) {
      p0Body.innerHTML = data.datasets.p0.map((row) => `
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

    setText("hydro-page-week", `${latestWeek.isoYear}-W${latestWeek.isoWeek}`);
    setText("hydro-page-week-note", `三峡入库 ${fmt(threeGorges.inflow)} m3/s，同比 ${pct(threeGorges.inflowYoy)}，周度样本 ${data.hydroWeeklyLatest.length} 个`);
    setText("hydro-page-hour", latestHour.time.slice(5));
    setText("hydro-page-hour-note", `${latestHour.river} ${latestHour.station} 入库 ${fmt(latestHour.inflow)} m3/s`);
    if (focusQtd) {
      setText("hydro-page-qtd", `${focusQtd.river} ${fmt(focusQtd.qtdInflow)}`);
      setText("hydro-page-qtd-note", `近7日 ${fmt(focusQtd.avg7dInflow)}；近14日 ${fmt(focusQtd.avg14dInflow)}；${focusQtd.signal}`);
    }

    const freshness = data.freshness || {};
    setText("hydro-freshness-snapshot", data.updatedAt);
    setText("hydro-freshness-week", freshness.hydroWeekly || `${latestWeek.isoYear}-W${latestWeek.isoWeek}`);
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
        legend: { top: 12, right: 22, textStyle: { color: "#66808a", fontSize: 11 } },
        grid: { left: 62, right: 68, top: 58, bottom: 72 },
        xAxis: { type: "category", boundaryGap: false, data: rows.map((row) => row.weekStart), ...axisStyle },
        yAxis: [
          { type: "value", name: "m3/s", nameTextStyle: { color: "#66808a" }, ...axisStyle },
          { type: "value", name: "同比", position: "right", min: -yoyAxisMax, max: yoyAxisMax, nameTextStyle: { color: "#b97716" }, ...axisStyle, axisLabel: { color: "#b97716", fontSize: 11, formatter: "{value}%" }, splitLine: { show: false } }
        ],
        dataZoom: [
          { type: "inside", start: 35, end: 100 },
          { type: "slider", height: 18, bottom: 18, borderColor: "#dfe7e8", fillerColor: "rgba(15,127,120,.14)" }
        ],
        series: [
          { name: "入库", type: "line", smooth: true, showSymbol: false, data: rows.map((row) => row.inflow), lineStyle: { width: 2.5 }, areaStyle: { opacity: .08 }, tooltip: { valueFormatter: (value) => `${fmt(value)} m3/s` } },
          { name: "出库", type: "line", smooth: true, showSymbol: false, data: rows.map((row) => row.outflow), lineStyle: { width: 1.5, type: "dashed" }, tooltip: { valueFormatter: (value) => `${fmt(value)} m3/s` } },
          { name: "入库同比", type: "line", yAxisIndex: 1, smooth: true, showSymbol: true, symbol: "circle", symbolSize: (value, params) => params.data?.clipped ? 8 : 0, connectNulls: false, data: inflowYoy, itemStyle: { color: "#b97716" }, lineStyle: { color: "#b97716", width: 1.8 }, markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "rgba(185,119,22,.35)", type: "dashed" }, data: [{ yAxis: 0 }] } }
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
      legend: { top: 10, right: 16, textStyle: { color: "#66808a", fontSize: 10 } },
      grid: { left: 46, right: 18, top: 52, bottom: 48 },
      xAxis: { type: "category", data: riverChartRows.map((row) => row.river), ...axisStyle, axisLabel: { ...axisStyle.axisLabel, rotate: 26 } },
      yAxis: { type: "value", ...axisStyle },
      series: [
        { name: "近7日", type: "bar", barMaxWidth: 18, data: riverChartRows.map((row) => row.avg7dInflow), itemStyle: { borderRadius: [4, 4, 0, 0] } },
        { name: "QTD", type: "line", smooth: true, symbolSize: 6, data: riverChartRows.map((row) => row.qtdInflow) }
      ]
    });

    const renderHydroStationChart = (river) => {
      const rows = (data.hydroQtdMetrics || [])
        .filter((row) => !river || row.river === river)
        .sort((a, b) => (b.qtdInflow || 0) - (a.qtdInflow || 0))
        .slice(0, 9)
        .reverse();
      renderChart("hydro-station-chart", {
        tooltip: { ...tooltipStyle, valueFormatter: (value) => `${fmt(value)} m3/s` },
        legend: { top: 10, right: 16, textStyle: { color: "#66808a", fontSize: 10 } },
        grid: { left: 18, right: 24, top: 52, bottom: 28, containLabel: true },
        xAxis: { type: "value", ...axisStyle },
        yAxis: { type: "category", data: rows.map((row) => row.station), ...axisStyle },
        series: [
          { name: "最新", type: "bar", barMaxWidth: 12, data: rows.map((row) => row.latestInflow), itemStyle: { borderRadius: [0, 4, 4, 0] } },
          { name: "QTD", type: "scatter", symbol: "diamond", symbolSize: 9, data: rows.map((row, index) => [row.qtdInflow, index]) }
        ]
      });
    };
    renderHydroStationChart(focusQtd?.river || null);

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
          <td>${row.isoYear}-W${row.isoWeek}</td>
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
      renderHydroStationChart(river);
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
    const latestSpot = data.spotWeeklyLatest?.[0];
    const avgRealtime = data.spotWeeklyLatest.reduce((sum, row) => sum + row.spotAvg, 0) / data.spotWeeklyLatest.length;
    setText("price-page-date", latestSpot ? `${latestSpot.isoYear}-W${latestSpot.isoWeek}` : "-");
    setText("price-page-avg", `${fmt(avgRealtime, 0)} 元/MWh`);
    setText("price-page-note", `${data.spotWeeklyLatest.length} 个省份周度样本，现货均价/同环比`);
    if (data.proxyPurchaseLatest?.length) {
      const avgProxy = data.proxyPurchaseLatest.reduce((sum, row) => sum + row.proxyPrice, 0) / data.proxyPurchaseLatest.length;
      const latestProxyMonth = data.proxyPurchaseLatest.reduce((latest, row) => row.month > latest ? row.month : latest, data.proxyPurchaseLatest[0].month);
      setText("proxy-page-avg", `${fmt(avgProxy, 0)} 元/MWh`);
      setText("proxy-page-note", `${latestProxyMonth}，${data.proxyPurchaseLatest.length} 个省份样本`);
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
          <td>${row.isoYear}-W${row.isoWeek}</td>
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

    const provinceSelect = document.getElementById("spot-history-province");
    const historyNote = document.getElementById("spot-history-note");
    const weeklyBody = document.getElementById("price-weekly-history-body");
    const spotHistoryToggle = document.getElementById("spot-history-toggle");
    let spotHistoryExpanded = false;
    const provinces = [...new Set(data.spotWeeklyHistory.map((row) => row.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    const preferredProvince = provinces.includes("广东") ? "广东" : (latestSpot?.province || provinces[0]);

    const renderSpotHistory = (province) => {
      if (!weeklyBody) return;
      const rows = data.spotWeeklyHistory.filter((row) => row.province === province);
      if (historyNote) {
        const latest = rows[0];
        const prefix = spotHistoryExpanded ? "全部" : "最近 5 周";
        historyNote.textContent = latest ? `${province} ${prefix} / 共 ${rows.length} 周，最新 ${latest.isoYear}-W${latest.isoWeek}` : "暂无历史数据";
      }
      const visibleRows = spotHistoryExpanded ? rows : rows.slice(0, 5);
      weeklyBody.innerHTML = visibleRows.map((row) => `
        <tr>
          <td>${row.province}</td>
          <td>${fmt(row.coalBenchmark, 1)}</td>
          <td>${row.isoYear}-W${row.isoWeek}</td>
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
      provinceSelect.addEventListener("change", () => renderSpotHistory(provinceSelect.value));
      if (spotHistoryToggle) {
        spotHistoryToggle.addEventListener("click", () => {
          spotHistoryExpanded = !spotHistoryExpanded;
          renderSpotHistory(provinceSelect.value);
        });
      }
      renderSpotHistory(provinceSelect.value);
    }

    const proxySelect = document.getElementById("proxy-province");
    const proxyNote = document.getElementById("proxy-province-note");
    const proxyBody = document.getElementById("proxy-history-body");
    const proxyHistoryToggle = document.getElementById("proxy-history-toggle");
    let proxyHistoryExpanded = false;
    const proxyProvinces = data.proxyPurchaseHistory ? [...new Set(data.proxyPurchaseHistory.map((row) => row.province))].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")) : [];
    const preferredProxyProvince = proxyProvinces.includes("广东") ? "广东" : proxyProvinces[0];
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
    ])].slice(0, 12);
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
            <td>${fmt(cap.total / 10000, 2)} 亿kW</td>
            <td>${pct(cap.totalYoy)}</td>
            <td>${fmt(add.total / 100, 1)} GW</td>
          </tr>
        `;
      }).join("");
    }
  };

  document.addEventListener("DOMContentLoaded", () => {
    renderDashboard();
    renderDataCatalog();
    renderHydroPage();
    renderPricePage();
    renderPowerPage();
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => chartInstances.forEach((chart) => chart.resize()), 120);
    });
  });
})();
