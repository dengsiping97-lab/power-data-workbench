(() => {
  const SESSION_KEY = "power-workbench-access-v1";
  const PASSWORD_HASH = "dc0827d04c287bc86f24fe745b01e4e0e0a806d5a5e46c9f651dfbb9846238f2";
  document.documentElement.classList.add("access-pending");

  const digest = async (value) => {
    const bytes = new TextEncoder().encode(value);
    const hash = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(hash)].map((part) => part.toString(16).padStart(2, "0")).join("");
  };

  const unlock = () => {
    document.documentElement.classList.remove("access-pending");
    document.body.classList.remove("access-gate-ready");
    document.getElementById("access-gate")?.remove();
    const logout = document.createElement("button");
    logout.className = "access-gate-logout";
    logout.type = "button";
    logout.textContent = "退出访问";
    logout.addEventListener("click", () => {
      sessionStorage.removeItem(SESSION_KEY);
      location.reload();
    });
    document.body.appendChild(logout);
    if (!document.querySelector(".site-disclaimer")) {
      const disclaimer = document.createElement("footer");
      disclaimer.className = "site-disclaimer";
      disclaimer.textContent = "© 电力数据研究工作台 · 展示版仅供研究交流，未经授权不得批量复制、转载或用于商业用途。";
      document.body.appendChild(disclaimer);
    }
  };

  const mountGate = () => {
    if (sessionStorage.getItem(SESSION_KEY) === PASSWORD_HASH) {
      unlock();
      return;
    }

    document.body.classList.add("access-gate-ready");
    const gate = document.createElement("div");
    gate.id = "access-gate";
    gate.className = "access-gate";
    gate.innerHTML = `
      <form class="access-gate-card" autocomplete="off">
        <div class="access-gate-eyebrow">POWER DATA WORKBENCH</div>
        <h1>访问电力数据研究工作台</h1>
        <p>本站为研究交流展示版，输入访问口令后查看近两年滚动数据。</p>
        <label for="access-gate-password">访问口令</label>
        <div class="access-gate-row">
          <input id="access-gate-password" name="password" type="password" required autofocus aria-describedby="access-gate-error">
          <button type="submit">进入工作台</button>
        </div>
        <div class="access-gate-error" id="access-gate-error" role="alert"></div>
        <div class="access-gate-footnote">轻量访问保护仅用于阻挡随手访问；公开站不承载完整原始数据库或敏感信息。</div>
      </form>`;
    document.body.appendChild(gate);

    gate.querySelector("form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = gate.querySelector("input");
      const error = gate.querySelector(".access-gate-error");
      const valueHash = await digest(input.value);
      if (valueHash !== PASSWORD_HASH) {
        error.textContent = "访问口令不正确，请重新输入。";
        input.select();
        return;
      }
      sessionStorage.setItem(SESSION_KEY, PASSWORD_HASH);
      unlock();
    });
  };

  if (document.body) {
    mountGate();
  } else {
    const bodyObserver = new MutationObserver(() => {
      if (!document.body) return;
      bodyObserver.disconnect();
      mountGate();
    });
    bodyObserver.observe(document.documentElement, { childList: true });
  }
})();
