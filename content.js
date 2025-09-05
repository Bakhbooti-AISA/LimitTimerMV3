// content.js
let blockEl = null;

function ensureStyles() {
  if (document.getElementById("stg-block-style")) return;
  const style = document.createElement("style");
  style.id = "stg-block-style";
  style.textContent = `
    .stg-block {
      position: fixed; inset: 0; z-index: 2147483647;
      display: flex; align-items: center; justify-content: center;
      backdrop-filter: blur(3px);
      background: rgba(0,0,0,0.55);
    }
    .stg-card {
      max-width: 520px; width: 92%;
      background: #111; color: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,.4);
      font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial, sans-serif;
      text-align: center;
    }
    .stg-card h1 { margin: 0 0 8px; font-size: 22px; }
    .stg-card p { opacity: .9; margin: 6px 0 16px; }
    .stg-row { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
    .stg-btn {
      border: 0; border-radius: 10px; padding: 10px 14px; cursor: pointer;
    }
    .stg-primary { background: #ff6363; color: #111; font-weight: 700; }
    .stg-ghost { background: #222; color: #fff; }
    .stg-input {
      width: 90px; padding: 8px; border-radius: 8px; border: 1px solid #444; background: #000; color: #fff;
      text-align: center;
    }
  `;
  document.documentElement.appendChild(style);
}

function showBlock(domain, used, limit) {
  if (blockEl) return;
  ensureStyles();
  blockEl = document.createElement("div");
  blockEl.className = "stg-block";
  blockEl.innerHTML = `
    <div class="stg-card" role="dialog" aria-modal="true">
      <h1>Time’s up for ${domain}</h1>
      <p>You used <strong>${used}</strong> / ${limit} minutes today.</p>
      <div class="stg-row" style="margin-top: 4px">
        <button class="stg-btn stg-primary" id="stg-close-tab">Close tab</button>
        <button class="stg-btn stg-ghost" id="stg-back">Go back</button>
      </div>
      <p style="opacity:.7;margin-top:14px;">Need more time? Set a new limit in the extension popup.</p>
    </div>
  `;
  document.documentElement.appendChild(blockEl);

  document.getElementById("stg-close-tab")?.addEventListener("click", () => window.close());
  document.getElementById("stg-back")?.addEventListener("click", () => history.length > 1 ? history.back() : window.close());
}

function hideBlock() {
  if (blockEl) { blockEl.remove(); blockEl = null; }
}

async function check() {
  const domain = location.hostname.split(".").slice(-2).join(".");
  try {
    const res = await browser.runtime.sendMessage({ type: "STG_QUERY_BLOCK", domain });
    if (res?.shouldBlock) showBlock(domain, res.used, res.limit);
    else hideBlock();
  } catch {}
}

// initial check
check();

// react to background nudges
browser.runtime.onMessage.addListener(msg => {
  if (msg?.type === "STG_BLOCK_NOW") {
    const d = msg.domain || location.hostname.split(".").slice(-2).join(".");
    showBlock(d);
  }
  if (msg?.type === "STG_SHOULD_BLOCK") {
    if (msg.shouldBlock) showBlock(msg.domain);
    else hideBlock();
  }
});
