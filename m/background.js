importScripts("cloud.js", "categories.js");

const STORAGE_KEY = "msefilter-settings";
const CATEGORY_KEYWORDS = self.MSEFILTER_CATEGORIES?.keywords || {};
const CLOUD_SYNC_ALARM = "msefilter-cloud-sync";

const DEFAULTS = {
  enabled: true,
  strictMode: false,
  allowKeywords: "education, study",
  blockKeywords: "adult, gambling",
  allowedDomains: "",
  blockedDomains: "",
  allowedUrls: "",
  blockedUrls: "",
  blockedCategories: [],
  nightBlockEnabled: false,
  nightBlockStart: "22:00",
  nightBlockEnd: "06:00",
  quickAction: "allow",
};

const parseCsv = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const parseLines = (value) =>
  String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const isWithinNightWindow = (start, end) => {
  const now = new Date();
  const [startH, startM] = start.split(":").map(Number);
  const [endH, endM] = end.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
};

const loadSettings = async () => {
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  return { ...DEFAULTS, ...(data[STORAGE_KEY] || {}) };
};

const classifyUrl = (url) => {
  const lower = url.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((word) => lower.includes(word.toLowerCase()))) {
      return category;
    }
  }
  return "unclassified";
};

const isBlockedByRules = (url, settings) => {
  if (!settings.enabled || !url) return false;

  const lower = url.toLowerCase();
  const allowKeywords = parseCsv(settings.allowKeywords || "");
  const blockKeywords = parseCsv(settings.blockKeywords || "");
  const allowedDomains = parseCsv(settings.allowedDomains || "");
  const blockedDomains = parseCsv(settings.blockedDomains || "");
  const allowedUrls = parseLines(settings.allowedUrls || "");
  const blockedUrls = parseLines(settings.blockedUrls || "");

  const matchesDomain = (domains) =>
    domains.some((domain) => lower.includes(domain.toLowerCase()));

  const matchesList = (list) =>
    list.some((item) => lower.includes(item.toLowerCase()));

  const allowHit =
    matchesList(allowKeywords) ||
    matchesDomain(allowedDomains) ||
    matchesList(allowedUrls);

  if (allowHit) return false;

  const blockHit =
    matchesList(blockKeywords) ||
    matchesDomain(blockedDomains) ||
    matchesList(blockedUrls);

  const categoryId = classifyUrl(url);
  const categoryBlocked =
    (settings.blockedCategories || []).includes(categoryId) &&
    categoryId !== "unclassified";

  const nightBlocked =
    settings.nightBlockEnabled &&
    isWithinNightWindow(settings.nightBlockStart || "22:00", settings.nightBlockEnd || "06:00");

  if (settings.strictMode || nightBlocked) return true;
  if (categoryBlocked) return true;
  return blockHit;
};

const updateIconForTab = async (tabId, url, settings) => {
  const blocked = isBlockedByRules(url, settings);
  const iconPath = blocked ? "no.png" : "ok.png";
  await chrome.action.setIcon({
    tabId,
    path: {
      16: iconPath,
      32: iconPath,
      48: iconPath,
    },
  });
};

const updateActiveTabIcon = async (settings) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  await updateIconForTab(tab.id, tab.url || "", settings);
};

const syncCloudCache = async (force = false) => {
  if (!self.MSEFILTER_CLOUD) return loadSettings();
  const core = await self.MSEFILTER_CLOUD.syncCoreData(DEFAULTS, {
    force,
    minIntervalMs: 3000,
  });
  return { ...DEFAULTS, ...(core.settings || {}) };
};

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get([STORAGE_KEY]);
  if (!existing[STORAGE_KEY]) {
    await chrome.storage.local.set({ [STORAGE_KEY]: DEFAULTS });
  }
  await chrome.alarms.create(CLOUD_SYNC_ALARM, { periodInMinutes: 1 });
  await updateActiveTabIcon(await syncCloudCache(true));
});

chrome.runtime.onStartup?.addListener(async () => {
  await chrome.alarms.create(CLOUD_SYNC_ALARM, { periodInMinutes: 1 });
  await syncCloudCache(true);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== CLOUD_SYNC_ALARM) return;
  const settings = await syncCloudCache(true);
  await updateActiveTabIcon(settings);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status && changeInfo.status !== "complete") return;
  await updateIconForTab(tabId, tab.url || "", await syncCloudCache(false));
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const tab = await chrome.tabs.get(activeInfo.tabId);
  await updateIconForTab(activeInfo.tabId, tab.url || "", await syncCloudCache(false));
});

chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "local") return;
  await updateActiveTabIcon(await loadSettings());
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "refreshRules") {
    syncCloudCache(false)
      .then(updateActiveTabIcon)
      .then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message?.type === "syncCloud") {
    syncCloudCache(true)
      .then((settings) => updateActiveTabIcon(settings).then(() => settings))
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "openOptions") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  return false;
});
