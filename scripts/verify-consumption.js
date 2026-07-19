const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "assets", "consumption-data.js");
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(dataPath, "utf8"), context, { filename: dataPath });
const data = context.window.CONSUMPTION_DATA;

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const findNational = (month) => data.nationalUtilization.find((row) => row.month === month);
const minMonth = (rows) => rows.map((row) => row.month).filter(Boolean).sort()[0];

assert(data, "window.CONSUMPTION_DATA missing");
assert(data.publicWindow?.cutoff, "public cutoff missing");
assert(data.freshness.monthRate === "2026-01", `single-month freshness mismatch: ${data.freshness.monthRate}`);
assert(data.freshness.cumulativeRate === "2026-03", `cumulative freshness mismatch: ${data.freshness.cumulativeRate}`);
assert(data.freshness.generation === "2026-06", `generation freshness mismatch: ${data.freshness.generation}`);
assert(data.freshness.capacity === "2026-05", `capacity freshness mismatch: ${data.freshness.capacity}`);
assert(data.freshness.utilizationHours === "2026-05", `utilization-hours freshness mismatch: ${data.freshness.utilizationHours}`);
assert(data.coverage.regionCount === 33, `region coverage mismatch: ${data.coverage.regionCount}`);
assert(data.coverage.monthRate.wind === 33 && data.coverage.monthRate.solar === 33, "latest single-month coverage is incomplete");
assert(data.coverage.cumulativeRate.wind === 33 && data.coverage.cumulativeRate.solar === 33, "latest cumulative coverage is incomplete");
assert(data.utilizationHoursComparison?.length === 3, "utilization-hours year comparison missing");
assert(data.utilizationHoursComparison.map((row) => row.year).join(",") === "2024,2025,2026", "utilization-hours comparison years mismatch");
assert(data.utilizationHoursComparison.every((row) => row.wind.length === 12 && row.solar.length === 12), "utilization-hours month axis mismatch");
assert(data.utilizationHoursComparison.find((row) => row.year === 2024).wind[0] === null, "missing January utilization hours were filled");
assert(data.utilizationHoursComparison.find((row) => row.year === 2026).wind[4] === 802.1089154, "2026 wind utilization hours mismatch");

const monthRow = findNational("2026-01");
const cumulativeRow = findNational("2026-03");
assert(monthRow?.windMonthRate === 94.5 && monthRow?.solarMonthRate === 94.3, "national 2026-01 rates mismatch");
assert(cumulativeRow?.windCumulativeRate === 91.9 && cumulativeRow?.solarCumulativeRate === 91.2, "national 2026-03 cumulative rates mismatch");

for (const rows of [data.nationalUtilization, data.regionalUtilization, data.nationalOperations]) {
  assert(minMonth(rows) >= data.publicWindow.cutoff.slice(0, 7), `rows exceed public window: ${minMonth(rows)}`);
}
for (const row of data.regionalUtilization) {
  for (const field of ["windMonthRate", "windCumulativeRate", "solarMonthRate", "solarCumulativeRate"]) {
    const value = row[field];
    assert(value === null || (value >= 0 && value <= 100), `${field} out of range: ${row.region} ${row.month} ${value}`);
  }
}

const serialized = JSON.stringify(data);
for (const forbidden of ["source_url_or_path", "D:\\workspace", "C:\\Users", "指标ID", "curtailmentRate", "greenCertificate"]) {
  assert(!serialized.includes(forbidden), `forbidden public field found: ${forbidden}`);
}

const navFiles = [
  "index.html", "hydro.html", "weather.html", "price.html", "power.html", "company-generation.html",
  "holdings.html", "tools.html", "data-catalog.html", "data-request.html", "subscribe.html", "consumption.html"
];
for (const file of navFiles) {
  const html = fs.readFileSync(path.join(root, file), "utf8");
  assert(html.includes('href="consumption.html"'), `consumption navigation missing in ${file}`);
}
const pageHtml = fs.readFileSync(path.join(root, "consumption.html"), "utf8");
assert(pageHtml.includes("assets/consumption-data.js") && pageHtml.includes("assets/consumption.js"), "consumption page assets missing");

const gateSource = fs.readFileSync(path.join(root, "assets", "access-gate.js"), "utf8");
const sessionKey = gateSource.match(/SESSION_KEY\s*=\s*"([^"]+)"/)?.[1];
const passwordHash = gateSource.match(/PASSWORD_HASH\s*=\s*"([^"]+)"/)?.[1];
assert(sessionKey && passwordHash, "access-gate session metadata missing");

const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(root, pathname === "/" ? "consumption.html" : `.${pathname}`);
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(response);
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [sessionKey, passwordHash]);
  await page.goto(`http://127.0.0.1:${server.address().port}/consumption.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#consumption-ranking-body tr").length === 32);
  assert(await page.locator("#access-gate").count() === 0, "access gate did not honor existing session");
  assert(await page.locator("#consumption-history-range option").count() === 4, "history range options missing");
  assert(await page.locator("#consumption-region-select option").count() === 32, "region selector mismatch");
  assert((await page.locator("#consumption-wind-month-rate").innerText()).includes("94.5%"), "wind single-month card mismatch");
  assert((await page.locator("#consumption-solar-cumulative-rate").innerText()).includes("91.2%"), "solar cumulative card mismatch");
  await page.selectOption("#consumption-ranking-period", "cumulative");
  await page.selectOption("#consumption-ranking-energy", "solar");
  assert(await page.locator("#consumption-ranking-month").inputValue() === "2026-03", "ranking latest cumulative month mismatch");
  await page.selectOption("#consumption-region-select", { label: "西藏" });
  await page.selectOption("#consumption-region-period", "cumulative");
  assert((await page.locator("#consumption-region-note").innerText()).includes("西藏"), "region detail did not switch");
  await page.selectOption("#consumption-operation-energy", "solar");
  assert((await page.locator("#consumption-generation-note").innerText()).includes("光伏"), "operation energy did not switch");
  assert((await page.locator("#consumption-hours-chart").count()) === 1, "utilization-hours comparison chart missing");
  const desktopOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(desktopOverflow <= 1, `desktop page overflow: ${desktopOverflow}px`);
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#metric-consumption")?.textContent.includes("91.9"));
  assert(await page.locator('a.metric[href="consumption.html"]').count() === 1, "homepage consumption card missing");
  assert((await page.locator("#freshness-consumption").innerText()).includes("202603"), "homepage consumption freshness mismatch");
  const homepageConsumption = await page.locator("#metric-consumption").innerText();
  assert(homepageConsumption.includes("风 91.9%") && homepageConsumption.includes("光 91.2%"), "homepage wind/solar utilization mismatch");
  const homepagePriceNote = await page.locator("#metric-spot-note").innerText();
  assert(homepagePriceNote.includes("最新电价数据截至") && !homepagePriceNote.includes("现货周均截至"), "homepage price note mismatch");
  const weeklyBriefTitle = await page.locator("#weekly-brief-title").innerText();
  assert(weeklyBriefTitle.includes("本周日前电价") && !weeklyBriefTitle.includes("现货溢价靠前"), "homepage weekly brief did not use the latest price signal");
  assert(await page.locator("#weekly-brief-note").count() === 0, "homepage weekly brief note was not removed");
  const desktopMetricColumns = await page.locator(".signal-metrics").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  assert(desktopMetricColumns === 4, `homepage desktop metric grid mismatch: ${desktopMetricColumns} columns`);
  await page.goto(`http://127.0.0.1:${server.address().port}/data-catalog.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#p0-dataset-body")?.textContent.includes("新能源利用率_月度主表.csv"));
  assert((await page.locator("#p0-dataset-body").innerText()).includes("新能源消纳_全国月度.csv"), "consumption dataset catalog entry missing");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://127.0.0.1:${server.address().port}/consumption.html`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("#consumption-ranking-body tr").length === 32);
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(mobileOverflow <= 1, `mobile page overflow: ${mobileOverflow}px`);
  assert(await page.locator("#consumption-ranking-month").isVisible(), "mobile ranking selector hidden");
  assert(await page.locator("#consumption-region-select").isVisible(), "mobile region selector hidden");
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "domcontentloaded" });
  const mobileMetricColumns = await page.locator(".signal-metrics").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  assert(mobileMetricColumns === 1, `homepage mobile metric grid mismatch: ${mobileMetricColumns} columns`);
  assert(!errors.length, `browser errors: ${errors.join(" | ")}`);
  await browser.close();
  server.close();
  console.log(`Consumption verification passed: ${data.coverage.regionCount} regions, ${data.regionalUtilization.length} utilization rows, desktop and mobile layouts.`);
})().catch((error) => {
  server.close();
  console.error(error);
  process.exit(1);
});
