(() => {
  const d = window.WEATHER_DATA; if (!d) return;
  const n = (v, digits=1) => v === null || v === undefined ? '-' : Number(v).toFixed(digits);
  const signed = (v, unit='') => v === null || v === undefined ? '-' : `${v > 0 ? '+' : ''}${n(v)}${unit}`;
  const tempTone = (v) => v > 1 ? 'up' : v < -1 ? 'down' : 'muted';
  document.getElementById('weather-hero-date').textContent = d.weekEnd || '-';
  document.getElementById('week-end').textContent = `截至 ${d.weekEnd}`;
  document.getElementById('coverage').textContent = `${d.rows.length} 省`;
  document.getElementById('source').textContent = 'ERA5 再分析';
  document.getElementById('quality-note').textContent = `口径提示：${d.qualityNote}`;
  document.getElementById('national-takeaway').textContent = d.nationalTakeaway || '全国天气结论将在最新周度数据更新后生成。';
  const rows = [...d.rows], by = field => [...rows].sort((a,b)=>(b[field]??-999)-(a[field]??-999));
  const hot=by('temperature_yoy_c')[0], cool=by('temperature_yoy_c').at(-1), cdd=by('cdd26_yoy')[0];
  const fill=(id,row,note)=>{document.getElementById(id).textContent=row.province;document.getElementById(`${id}-note`).textContent=note(row)};
  fill('top-cdd',cdd,r=>`CDD26 ${n(r.cdd26)}，同比 ${signed(r.cdd26_yoy)}`); fill('top-hot',hot,r=>`温度同比 ${signed(r.temperature_yoy_c,'C')}`); fill('top-cool',cool,r=>`温度同比 ${signed(r.temperature_yoy_c,'C')}`);
  const implication=r=>r.cdd26_yoy>=15?'制冷负荷明显增强':r.cdd26_yoy<=-15?'同比制冷驱动走弱':r.temperature_yoy_c>=1?'偏热，负荷偏强':'季节性附近';
  const anomalous=rows.filter(r=>Math.abs(r.temperature_yoy_c??0)>=1||Math.abs(r.cdd26_yoy??0)>=20).sort((a,b)=>Math.abs(b.temperature_yoy_c??0)-Math.abs(a.temperature_yoy_c??0));
  document.getElementById('anomaly-body').innerHTML=anomalous.map(r=>`<tr><td>${r.province}</td><td>${n(r.temperature_mean_c)}C</td><td class="${tempTone(r.temperature_yoy_c)}">${signed(r.temperature_yoy_c,'C')}</td><td>${n(r.cdd26)}</td><td>${signed(r.cdd26_yoy)}</td><td>${r.heat_days_ge_35}</td><td>${implication(r)}</td></tr>`).join('');
  document.getElementById('matrix-body').innerHTML=rows.filter(r=>['广东','江苏','河北','湖北','四川','重庆'].includes(r.province)).map(r=>`<tr><td>${r.province}</td><td>${implication(r)}</td><td>${r.cdd26_yoy>=15?'峰荷上行支持':'天气同比支撑有限'}</td><td>不在本页推断</td><td>负荷中心气象</td></tr>`).join('');
  document.getElementById('all-body').innerHTML=rows.sort((a,b)=>a.province.localeCompare(b.province,'zh-CN')).map(r=>`<tr><td>${r.province}</td><td>${n(r.temperature_mean_c)}C</td><td class="${tempTone(r.temperature_yoy_c)}">${signed(r.temperature_yoy_c,'C')}</td><td>${n(r.precipitation_mm)} mm</td><td>${n(r.cdd26)}</td><td>${signed(r.cdd26_yoy)}</td><td>${n(r.hdd18)}</td><td>${r.heat_days_ge_35}</td></tr>`).join('');
  const history = window.WEATHER_HISTORY || [];
  const selector = document.getElementById('weather-province');
  const note = document.getElementById('history-note');
  const provinces = [...new Set(history.map(r => r.province))].sort((a,b) => a.localeCompare(b, 'zh-Hans-CN'));
  let chart;
  const isoWeek = value => {
    const d = new Date(`${value}T00:00:00Z`);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  };
  const renderHistory = province => {
    const series = history.filter(r => r.province === province).sort((a,b) => a.weekStart.localeCompare(b.weekStart));
    if (note) note.textContent = `${province} 共 ${series.length} 个完整自然周，${series[0]?.weekStart || '-'} 至 ${series.at(-1)?.weekEnd || '-'}；默认展示最近两年，可拖动查看十年历史。`;
    if (!window.echarts || !series.length) return;
    const node = document.getElementById('weather-history-chart');
    chart?.dispose(); chart = window.echarts.init(node);
    const yoyLimit = Math.max(5, Math.ceil(Math.max(...series.map(r => Math.abs(r.temperatureYoy ?? 0))) / 2) * 2);
    const climate = new Map();
    series.filter(r => Number(r.weekStart.slice(0,4)) <= 2025).forEach(r => {
      const week = isoWeek(r.weekStart), bucket = climate.get(week) || [];
      bucket.push(r.temperature); climate.set(week, bucket);
    });
    const climateLine = series.map(r => {
      const bucket = climate.get(isoWeek(r.weekStart)) || [];
      return bucket.length ? Number((bucket.reduce((sum,value) => sum + value, 0) / bucket.length).toFixed(2)) : null;
    });
    const zoomStart = Math.max(0, 100 - (104 / series.length) * 100);
    const compactChart = window.matchMedia('(max-width: 720px)').matches;
    chart.setOption({
      animation:false,
      color:['#526f89','#9aa8b1','#c5a66f'],
      tooltip:{trigger:'axis',backgroundColor:'rgba(42,52,60,.94)',borderWidth:0,textStyle:{color:'#fff'},formatter:items => `${items[0].axisValue}<br>${items.map(i => `${i.marker}${i.seriesName}：${i.value === null ? '-' : `${Number(i.value).toFixed(1)}°C`}`).join('<br>')}`},
      legend:{top:compactChart ? 2 : 8,right:compactChart ? 2 : 16,itemWidth:22,itemHeight:8,textStyle:{color:'#74808a',fontSize:11}},grid:{left:compactChart ? 40 : 58,right:compactChart ? 40 : 66,top:compactChart ? 42 : 54,bottom:compactChart ? 50 : 72},
      xAxis:{type:'category',boundaryGap:true,data:series.map(r=>r.weekStart),axisTick:{show:false},axisLine:{lineStyle:{color:'#d9e2e7'}},axisLabel:{color:'#74808a',fontSize:11,hideOverlap:true}},
      yAxis:[{type:'value',name:'气温 °C',scale:true,nameTextStyle:{color:'#74808a'},axisLabel:{color:'#74808a',fontSize:11,formatter:'{value}°'},axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:'#edf1f3'}}},{type:'value',name:'同比 °C',position:'right',min:-yoyLimit,max:yoyLimit,nameTextStyle:{color:'#a88752'},axisLabel:{color:'#a88752',fontSize:11,formatter:'{value}°'},axisLine:{show:false},axisTick:{show:false},splitLine:{show:false}}],
      dataZoom:[{type:'inside',start:zoomStart,end:100},{type:'slider',start:zoomStart,end:100,height:compactChart ? 14 : 18,bottom:compactChart ? 8 : 18,borderColor:'#d9e2e7',backgroundColor:'#f6f8f9',fillerColor:'rgba(96,125,152,.14)',handleStyle:{color:'#607d98'}}],
      series:[
        {name:'周均温',type:'line',smooth:.28,showSymbol:false,data:series.map(r=>r.temperature),lineStyle:{width:2.8,color:'#526f89'},areaStyle:{color:'rgba(96,125,152,.10)'},z:3},
        {name:'十年同期均值',type:'line',smooth:.28,showSymbol:false,data:climateLine,lineStyle:{width:1.6,type:'dashed',color:'#9aa8b1'},z:2},
        {name:'温度同比',type:'bar',yAxisIndex:1,barMaxWidth:7,data:series.map(r=>r.temperatureYoy === null ? null : ({value:r.temperatureYoy,itemStyle:{color:r.temperatureYoy >= 0 ? 'rgba(197,166,111,.48)' : 'rgba(96,125,152,.24)',borderRadius:r.temperatureYoy >= 0 ? [2,2,0,0] : [0,0,2,2]}})),markLine:{silent:true,symbol:'none',label:{show:false},lineStyle:{color:'rgba(197,166,111,.32)',type:'dashed'},data:[{yAxis:0}]},z:1}
      ]
    });
  };
  const setupHistory = () => {
    if (!selector || !history.length) return;
    selector.innerHTML = provinces.map(p => `<option value="${p}">${p}</option>`).join('');
    selector.value = provinces.includes('广东') ? '广东' : provinces[0];
    selector.addEventListener('change', () => renderHistory(selector.value));
    renderHistory(selector.value);
    window.addEventListener('resize', () => chart?.resize());
  };
  const waitForEcharts = (tries=0) => { if (window.echarts) setupHistory(); else if (tries < 40) setTimeout(() => waitForEcharts(tries + 1), 120); };
  waitForEcharts();
})();
