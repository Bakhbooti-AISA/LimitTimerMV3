// popup.js
const $ = sel => document.querySelector(sel);

function render(snapshot) {
  const { usage, limits, activeDomain } = snapshot;
  const rows = new Set([...Object.keys(usage), ...Object.keys(limits)]);
  const body = $("#usageBody");
  body.innerHTML = "";

  // sort: active domain first, then by used desc
  const list = [...rows].sort((a, b) => {
    if (a === activeDomain) return -1;
    if (b === activeDomain) return 1;
    const ua = usage[a] || 0, ub = usage[b] || 0;
    return ub - ua;
    });

  for (const d of list) {
    const used = usage[d] || 0;
    const lim = limits[d] ?? "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${d}${d === activeDomain ? "  🔵" : ""}</td>
      <td>${used}m</td>
      <td>${lim === "-" ? "-" : lim + "m"}</td>
      <td><button class="btn" data-del="${d}">✕</button></td>
    `;
    body.appendChild(tr);
  }

  $("#activeLabel").textContent = activeDomain ? `Active: ${activeDomain}` : "No active domain";
}

async function refresh() {
  const data = await browser.runtime.sendMessage({ type: "STG_GET_SNAPSHOT" });
  render(data);
}

$("#setBtn").addEventListener("click", async () => {
  const domain = $("#domainInput").value.trim().toLowerCase();
  const minutes = parseInt($("#minutesInput").value, 10);
  if (!domain || !/^[a-z0-9.-]+$/.test(domain)) return alert("Enter a valid domain (e.g., youtube.com).");
  await browser.runtime.sendMessage({ type: "STG_SET_LIMIT", domain, minutes });
  $("#domainInput").value = ""; $("#minutesInput").value = "";
  await refresh();
});

$("#usageBody").addEventListener("click", async (e) => {
  const d = e.target?.dataset?.del;
  if (!d) return;
  await browser.runtime.sendMessage({ type: "STG_SET_LIMIT", domain: d, minutes: 0 });
  await refresh();
});

$("#clearBtn").addEventListener("click", async () => {
  if (!confirm("Clear today’s usage for all sites?")) return;
  await browser.runtime.sendMessage({ type: "STG_CLEAR_TODAY" });
  await refresh();
});

// preload active tab’s domain into the domain field
(async () => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || "";
    const host = new URL(url).hostname;
    const base = host.split(".").slice(-2).join(".");
    $("#domainInput").value = base;
  } catch {}
})();

refresh();
