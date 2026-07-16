const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const pageName = process.argv[2] || "hydro.html";
const width = Number(process.argv[3] || 390);
const height = Number(process.argv[4] || 844);
const outputName = process.argv[5] || `mobile-${pageName.replace(/\.html$/i, "")}-preview.png`;

const root = path.resolve(__dirname, "..");
const pagePath = path.resolve(root, pageName);
const outputPath = path.resolve(root, outputName);

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });

  page.on("pageerror", (error) => {
    console.error(`PAGEERROR ${error.message}`);
  });

  await page.goto(pathToFileURL(pagePath).href, {
    waitUntil: "domcontentloaded",
    timeout: 15000
  });
  const gate = page.locator("#access-gate");
  if (await gate.count() && process.env.WORKBENCH_TEST_PASSWORD) {
    await page.fill("#access-gate-password", process.env.WORKBENCH_TEST_PASSWORD);
    await page.click("#access-gate button[type=submit]");
    await gate.waitFor({ state: "detached" });
  }
  await page.waitForTimeout(1200);
  await page.screenshot({ path: outputPath, fullPage: false });
  await browser.close();
  console.log(outputPath);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
