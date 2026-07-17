const fs = require("fs");
const http = require("http");
const path = require("path");
const vm = require("vm");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const password = process.env.WORKBENCH_TEST_PASSWORD;
const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png" };

const loadWindowValue = (file, key) => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8"), context);
  return context.window[key];
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const verifyDataWindow = () => {
  const workbench = loadWindowValue("assets/workbench-data.js", "WORKBENCH_DATA");
  const weather = loadWindowValue("assets/weather-history-data.js", "WEATHER_HISTORY");
  const company = loadWindowValue("assets/company-generation-data.js", "COMPANY_GENERATION_DATA");
  const cutoff = workbench.publicWindow?.cutoff;
  assert(cutoff, "workbench public cutoff missing");
  const checks = [
    [workbench.hydroWeeklyHistory, "weekStart"],
    [workbench.spotWeeklyHistory, "weekStart"],
    [workbench.proxyPurchaseHistory, "month"],
    [workbench.systemFeeHistory, "month"],
    [workbench.installedCapacityMonthly, "month"],
    [workbench.provinceInstalledCapacityAnnual, "period"],
    [workbench.provincePowerMonthly, "month"],
    [weather, "weekStart"],
    [company.facts, "period"]
  ];
  checks.forEach(([rows, field]) => {
    const min = rows.map((row) => String(row[field]).slice(0, 7)).sort()[0];
    assert(min >= cutoff.slice(0, 7), `${field} exceeds public window: ${min}`);
  });
  const provinceRows = workbench.provinceInstalledCapacityAnnual || [];
  const provinces = new Set(provinceRows.map((row) => row.province));
  const periods = new Set(provinceRows.map((row) => row.period));
  assert(provinceRows.length === 62, `province capacity row count mismatch: ${provinceRows.length}`);
  assert(provinces.size === 31, `province capacity coverage mismatch: ${provinces.size}`);
  assert(periods.has("2024-12-31") && periods.has("2025-12-31"), "province capacity periods missing");
  assert(provinceRows.some((row) => row.solar === null), "province capacity missing values were incorrectly filled");
  assert(!JSON.stringify(provinceRows).includes("S0030"), "paid database indicator ids leaked into public snapshot");
  const provinceMonthlyRows = workbench.provincePowerMonthly || [];
  assert(new Set(provinceMonthlyRows.map((row) => row.province)).size === 31, "province monthly coverage mismatch");
  assert(provinceMonthlyRows.length >= 580, `province monthly row count too small: ${provinceMonthlyRows.length}`);
  assert(weather.every((row) => row.climateTemperature !== null && row.climateTemperature !== undefined), "weather climate baseline missing");
  assert((workbench.hydroCompanyWeeklyLatest || []).length >= 8, "hydro company weekly coverage mismatch");
  assert((workbench.hydroCompanyWeeklyLatest || []).some((row) => row.company === "国能大渡河" && row.power !== null), "Dadu weekly power estimate missing");
  assert((workbench.hydroWeeklyLatest || []).some((row) => row.station === "二滩"), "Yalong weekly hydrology missing");
  assert((workbench.hydroWeeklyLatest || []).some((row) => row.station === "瀑布沟"), "Dadu weekly hydrology missing");
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(root, pathname === "/" ? "index.html" : `.${pathname}`);
  if (!target.startsWith(root) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(response);
});

(async () => {
  assert(password, "WORKBENCH_TEST_PASSWORD is required for access-gate verification");
  verifyDataWindow();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#access-gate");
  await page.fill("#access-gate-password", "wrong-password");
  await page.click("#access-gate button[type=submit]");
  await page.waitForSelector("#access-gate-error:not(:empty)");
  await page.fill("#access-gate-password", password);
  await page.click("#access-gate button[type=submit]");
  await page.waitForSelector("#access-gate", { state: "detached" });

  for (const [pageName, rangeId] of [["hydro.html", "hydro-history-range"], ["price.html", "price-history-range"], ["power.html", "power-history-range"], ["weather.html", "weather-history-range"]]) {
    await page.goto(`http://127.0.0.1:${port}/${pageName}`, { waitUntil: "domcontentloaded" });
    assert(await page.locator("#access-gate").count() === 0, `${pageName} unexpectedly locked in same session`);
    await page.waitForSelector(`#${rangeId}`);
    assert(await page.locator(`#${rangeId} option`).count() === 4, `${pageName} range options missing`);
    if (pageName === "hydro.html") {
      await page.waitForSelector("#hydro-company-weekly-body tr");
      assert(await page.locator("#hydro-company-weekly-body tr").count() >= 8, "hydro company weekly table mismatch");
    }
    if (pageName === "power.html") {
      await page.waitForSelector("#province-capacity-body tr");
      assert(await page.locator("#province-capacity-province option").count() === 31, "province profile selector mismatch");
      assert(await page.locator("#province-capacity-body tr").count() >= 18, "province monthly table mismatch");
      await page.selectOption("#province-capacity-province", { label: "内蒙古" });
      assert((await page.locator("#province-power-trend-note").innerText()).includes("内蒙古"), "province selector did not update content");
    }
  }

  await browser.close();
  server.close();
  assert(!pageErrors.length, `browser page errors: ${pageErrors.join(" | ")}`);
  console.log("Public site verification passed.");
})().catch((error) => {
  server.close();
  console.error(error);
  process.exit(1);
});
