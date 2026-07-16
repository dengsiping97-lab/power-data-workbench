const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const gateSource = fs.readFileSync(path.join(root, "assets", "access-gate.js"), "utf8");
const sessionKey = gateSource.match(/SESSION_KEY\s*=\s*"([^"]+)"/)?.[1];
const passwordHash = gateSource.match(/PASSWORD_HASH\s*=\s*"([^"]+)"/)?.[1];
if (!sessionKey || !passwordHash) throw new Error("Access-gate session metadata missing");

const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  const target = path.resolve(root, pathname === "/" ? "power.html" : `.${pathname}`);
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
  await page.route("https://cdn.jsdelivr.net/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: ""
  }));
  await page.addInitScript(([key, value]) => sessionStorage.setItem(key, value), [sessionKey, passwordHash]);
  await page.goto(`http://127.0.0.1:${server.address().port}/power.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#province-capacity-body tr");
  assert(await page.locator("#access-gate").count() === 0, "access gate did not honor existing session");
  assert(await page.locator("#province-capacity-province option").count() === 31, "province selector mismatch");
  assert(await page.locator("#province-capacity-body tr").count() >= 18, "province monthly table too short");
  const tableScroll = await page.locator(".province-capacity-table").evaluate((node) => ({
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
    overflowY: getComputedStyle(node).overflowY
  }));
  assert(tableScroll.clientHeight <= 390, `province table viewport too tall: ${tableScroll.clientHeight}px`);
  assert(tableScroll.scrollHeight > tableScroll.clientHeight, "province table is not vertically scrollable");
  assert(["auto", "scroll"].includes(tableScroll.overflowY), `province table overflow invalid: ${tableScroll.overflowY}`);
  await page.selectOption("#province-capacity-province", { label: "内蒙古" });
  assert((await page.locator("#province-power-trend-note").innerText()).includes("内蒙古"), "province content did not switch");
  assert((await page.locator("#province-capacity-body").innerText()).includes("—"), "missing values were not rendered explicitly");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#province-capacity-province");
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert(mobileOverflow <= 1, `mobile page overflow: ${mobileOverflow}px`);
  assert(await page.locator("#province-capacity-province").isVisible(), "mobile province selector hidden");
  assert(!errors.length, `browser errors: ${errors.join(" | ")}`);
  await browser.close();
  server.close();
  console.log("Province monthly power verification passed.");
})().catch((error) => {
  server.close();
  console.error(error);
  process.exit(1);
});
