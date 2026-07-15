(function () {
  const form = document.querySelector("[data-email-form]");
  if (!form) return;

  const status = document.getElementById("form-status");
  const recipient = form.dataset.recipient;
  const subject = form.dataset.subject;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const fields = [...form.querySelectorAll("[data-label]")]
      .filter((field) => field.type !== "checkbox")
      .map((field) => `${field.dataset.label}：${field.value.trim() || "未填写"}`)
      .join("\n");
    const body = `${fields}\n\n我已阅读并同意仅为本次研究交流/订阅服务使用以上信息。`;
    window.location.href = `mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (status) status.textContent = "已打开邮件客户端。发送邮件后，我们会按你的申请或订阅需求处理。";
  });
})();
