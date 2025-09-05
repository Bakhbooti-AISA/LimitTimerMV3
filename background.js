// background.js (Service Worker)

// ------- helpers -------
const TODAY_KEY = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD

function domainFromUrl(url) {
  try {
    const { hostname } = new URL(url);
    // collapse subdomains to registrable-ish root for common cases (e.g., m.youtube.com -> youtube.com)
    const parts = hostname.split(".");
    if (parts.length >= 3) return parts.slice(-2).join(".");
    return hostname;
  } catch { return null; }
}

async function getState() {
  const { usage = {}, limits = {}, settings = {} } = await browser.storage.local.get(["usage", "limits", "settings"]);
  return { usage, limits, settings };
}

async function setState(patch) {
  await browser.storage.local.set(patch);
}

async function ensureDefaults() {
  const { limits, settings } = await getState();
  if (!settings.init) {
    await setState({
      settings: { init: true, lastDay: TODAY_KEY() },
      limits: {
        "youtube.com": 30,     // minutes per day
        "twitter.com": 20,
        "reddit.com": 25
      },
      usage: {}
    });
  }
}

// ------- tracking state in-memory -------
let activeTabId = null;
let activeDomain = null;
let windowFocused = true;
let userIdle = false;

// create a single minute tick alarm; we keep it always on
browser.alarms.create("STG_TICK", { periodInMinutes: 1 });

// ------- core logic -------
async function tick() {
  // rollover day reset
  const today = TODAY_KEY();
  const state = await getState();
  if (state.settings?.lastDay !== today) {
    await setState({ usage: {}, settings: { ...(state.settings || {}), lastDay: today } });
  }

  if (!(windowFocused && !userIdle && activeTabId && activeDomain)) return;

  // confirm tab is still active/current window and not discarded
  try {
    const tab = await browser.tabs.get(activeTabId);
    if (!tab.active || !tab.id || tab.discarded) return;
  } catch {
    return;
  }

  // add one minute to today's usage for the activeDomain
  const { usage } = await getState();
  const todayUsage = usage[today] || {};
  const minutes = todayUsage[activeDomain] || 0;
  todayUsage[activeDomain] = minutes + 1;
  usage[today] = todayUsage;
  await setState({ usage });

  // if we just crossed the limit, tell all matching tabs to block
  const { limits } = await getState();
  const limit = limits[activeDomain];
  if (limit && todayUsage[activeDomain] >= limit) {
    const tabs = await browser.tabs.query({});
    await Promise.all(
      tabs
        .filter(t => domainFromUrl(t.url || "") === activeDomain)
        .map(t => browser.tabs.sendMessage(t.id, { type: "STG_BLOCK_NOW", domain: activeDomain }).catch(() => {}))
    );
  }
}

// ------- event wiring -------
browser.alarms.onAlarm.addListener(a => { if (a.name === "STG_TICK") tick(); });

browser.runtime.onStartup.addListener(ensureDefaults);
browser.runtime.onInstalled.addListener(ensureDefaults);

browser.idle.setDetectionInterval(60); // seconds
browser.idle.onStateChanged.addListener(state => { userIdle = (state !== "active"); });

browser.windows.onFocusChanged.addListener(async wid => {
  windowFocused = wid !== browser.windows.WINDOW_ID_NONE;
  await updateActive();
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  activeTabId = tabId;
  await updateActive();
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (tabId === activeTabId && changeInfo.status === "complete") await updateActive();
});

async function updateActive() {
  try {
    if (activeTabId == null) {
      const [t] = await browser.tabs.query({ active: true, currentWindow: true });
      if (t) activeTabId = t.id;
    }
    const tab = activeTabId ? await browser.tabs.get(activeTabId) : null;
    const dom = tab?.url ? domainFromUrl(tab.url) : null;
    activeDomain = dom;

    if (!dom) return;

    // On navigation/activation, tell the content whether it should block right away
    const { usage, limits } = await getState();
    const today = TODAY_KEY();
    const used = usage[today]?.[dom] || 0;
    const limit = limits[dom] || null;
    const shouldBlock = !!limit && used >= limit;
    if (tab?.id) {
      browser.tabs.sendMessage(tab.id, { type: "STG_SHOULD_BLOCK", domain: dom, shouldBlock }).catch(() => {});
    }
  } catch {}
}

// ------- messaging: popup & content -------
browser.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg?.type === "STG_GET_SNAPSHOT") {
    const { usage, limits } = await getState();
    const today = TODAY_KEY();
    return {
      date: today,
      usage: usage[today] || {},
      limits,
      activeDomain,
      activeTabId,
    };
  }

  if (msg?.type === "STG_SET_LIMIT") {
    // msg.domain (string), msg.minutes (number|null). Null or 0 deletes.
    const { limits } = await getState();
    if (!msg.minutes || msg.minutes <= 0) {
      delete limits[msg.domain];
    } else {
      limits[msg.domain] = Math.max(1, Math.floor(msg.minutes));
    }
    await setState({ limits });
    // re-evaluate current tab
    await updateActive();
    return { ok: true, limits };
  }

  if (msg?.type === "STG_CLEAR_TODAY") {
    await setState({ usage: {} });
    await updateActive();
    return { ok: true };
  }

  if (msg?.type === "STG_QUERY_BLOCK") {
    const dom = msg.domain;
    const { usage, limits } = await getState();
    const today = TODAY_KEY();
    const used = usage[today]?.[dom] || 0;
    const lim = limits[dom] || null;
    return { shouldBlock: !!lim && used >= lim, used, limit: lim };
  }
});
