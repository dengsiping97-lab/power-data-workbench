(() => {
  const READY_EVENT = "echarts-ready";
  const ERROR_EVENT = "echarts-error";

  const notify = (name) => window.dispatchEvent(new Event(name));
  if (window.echarts) {
    queueMicrotask(() => notify(READY_EVENT));
    return;
  }
  if (document.querySelector('script[data-echarts-loader="true"]')) return;

  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/echarts@5.6.0/dist/echarts.min.js";
  script.async = true;
  script.dataset.echartsLoader = "true";
  script.addEventListener("load", () => notify(READY_EVENT), { once: true });
  script.addEventListener("error", () => notify(ERROR_EVENT), { once: true });
  document.head.appendChild(script);
})();
