const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const htmlFiles = fs.readdirSync(root).filter((name) => name.endsWith(".html"));
const loaderPages = [];
htmlFiles.forEach((name) => {
  const html = fs.readFileSync(path.join(root, name), "utf8");
  assert(!html.includes("cdn.jsdelivr.net/npm/echarts"), `${name} still blocks on the external ECharts CDN`);
  if (html.includes("assets/echarts-loader.js")) loaderPages.push(name);
});
assert(loaderPages.length === 8, `unexpected ECharts loader page count: ${loaderPages.length}`);

const gateSource = fs.readFileSync(path.join(root, "assets", "access-gate.js"), "utf8");
const loaderSource = fs.readFileSync(path.join(root, "assets", "echarts-loader.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "assets", "app.js"), "utf8");
const consumptionSource = fs.readFileSync(path.join(root, "assets", "consumption.js"), "utf8");
const weatherSource = fs.readFileSync(path.join(root, "assets", "weather.js"), "utf8");
const companyGeneration = fs.readFileSync(path.join(root, "company-generation.html"), "utf8");

assert(!gateSource.includes('addEventListener("DOMContentLoaded"'), "access gate still waits for DOMContentLoaded");
assert(gateSource.includes("new MutationObserver"), "access gate does not mount independently when body becomes available");
assert(loaderSource.includes("script.async = true"), "ECharts loader is not asynchronous");
assert(loaderSource.includes('notify("echarts-ready")') || loaderSource.includes("notify(READY_EVENT)"), "ECharts ready event missing");
assert(appSource.includes('addEventListener("echarts-ready"'), "main charts do not resume after async ECharts load");
assert(consumptionSource.includes('addEventListener("echarts-ready"'), "consumption charts do not resume after async ECharts load");
assert(weatherSource.includes('addEventListener("echarts-ready"'), "weather chart does not resume after async ECharts load");
assert(companyGeneration.includes('addEventListener("echarts-ready"'), "company generation chart does not wait for async ECharts load");

console.log(`Access gate loading verification passed: ${loaderPages.length} chart pages use the async loader and the gate is CDN-independent.`);
