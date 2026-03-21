const STORAGE_KEY = "msefilter-settings";
const USERS_KEY = "msefilter-users";
const SESSION_KEY = "msefilter-session";
const cloud = globalThis.MSEFILTER_CLOUD;

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

const els = {
  status: document.getElementById("status"),
  url: document.getElementById("url"),
  allowBtn: document.getElementById("allowBtn"),
  blockBtn: document.getElementById("blockBtn"),
  roleHint: document.getElementById("roleHint"),
  openOptions: document.getElementById("openOptions"),
  authBtn: document.getElementById("authBtn"),
  loginPanel: document.getElementById("loginPanel"),
  loginSchoolId: document.getElementById("loginSchoolId"),
  loginId: document.getElementById("loginId"),
  loginPassword: document.getElementById("loginPassword"),
  loginBtn: document.getElementById("loginBtn"),
  loginMessage: document.getElementById("loginMessage"),
  modeSwitch: document.getElementById("modeSwitch"),
};

const normalizeRole = (role) => (role === "teacher" ? "admin" : role || "student");
const isManagerRole = (session) => ["admin", "super"].includes(normalizeRole(session?.role));

const parseLines = (value) =>
  String(value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const formatLines = (lines) => lines.join("\n");

const bufferToBase64 = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer)));

const base64ToBuffer = (base64) =>
  Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

const hashPassword = async (password, saltBuffer) => {
  const encoder = new TextEncoder();
  const passBytes = encoder.encode(password);
  const combined = new Uint8Array(saltBuffer.length + passBytes.length);
  combined.set(saltBuffer);
  combined.set(passBytes, saltBuffer.length);
  const hash = await crypto.subtle.digest("SHA-256", combined);
  return bufferToBase64(hash);
};

const loadSettings = async () => {
  if (cloud) {
    return cloud.getSettings(DEFAULTS);
  }
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  return { ...DEFAULTS, ...(data[STORAGE_KEY] || {}) };
};

const saveSettings = async (settings) => {
  if (cloud) {
    await cloud.saveSettings(settings, DEFAULTS);
  } else {
    await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  }
  await chrome.runtime.sendMessage({ type: "refreshRules" });
};

const loadSession = async () => {
  const data = await chrome.storage.local.get([SESSION_KEY]);
  return data[SESSION_KEY] || null;
};

const saveSession = async (session) => {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
};

const clearSession = async () => {
  await chrome.storage.local.remove(SESSION_KEY);
};

const loadUsers = async () => {
  const users = cloud
    ? await cloud.getUsers(DEFAULTS, { fresh: true, minIntervalMs: 3000 })
    : (await chrome.storage.local.get([USERS_KEY]))[USERS_KEY] || [];
  return users.map((user) => ({ ...user, role: normalizeRole(user.role) }));
};

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
};

const normalizeUrl = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return url || "";
  }
};

const isListed = (url, list) => list.some((item) => url.includes(item));

const getModeForUrl = (url, settings) => {
  const allowed = parseLines(settings.allowedUrls || "");
  const blocked = parseLines(settings.blockedUrls || "");
  if (isListed(url, blocked)) return "block";
  if (isListed(url, allowed)) return "allow";
  return settings.quickAction || "allow";
};

const showLoginPanel = (visible) => {
  els.loginPanel.style.display = visible ? "block" : "none";
};

const setToggleState = (state, disabled) => {
  els.allowBtn.classList.toggle("active", state === "allow");
  els.blockBtn.classList.toggle("active", state === "block");
  if (els.modeSwitch) {
    els.modeSwitch.dataset.mode = state || "allow";
    els.modeSwitch.dataset.disabled = disabled ? "true" : "false";
  }
};

const setStatus = (status) => {
  els.status.textContent = status;
  els.status.classList.toggle("blocked", status === "ブロック");
};

const updateUrlLists = async (mode) => {
  const tab = await getActiveTab();
  if (!tab?.url) return;

  const url = normalizeUrl(tab.url);
  const settings = await loadSettings();
  const allowed = parseLines(settings.allowedUrls || "");
  const blocked = parseLines(settings.blockedUrls || "");

  const nextAllowed = allowed.filter((item) => item !== url);
  const nextBlocked = blocked.filter((item) => item !== url);

  if (mode === "allow") nextAllowed.push(url);
  if (mode === "block") nextBlocked.push(url);

  settings.allowedUrls = formatLines(Array.from(new Set(nextAllowed)));
  settings.blockedUrls = formatLines(Array.from(new Set(nextBlocked)));
  settings.quickAction = mode;
  await saveSettings(settings);
};

const roleText = (session) => {
  const role = normalizeRole(session?.role);
  if (role === "super") return "本部管理者";
  if (role === "admin") return "学校管理者";
  if (role === "student") return "生徒";
  return "未ログイン";
};

const refresh = async () => {
  if (cloud) {
    await cloud.syncCoreData(DEFAULTS, { minIntervalMs: 3000 });
  }
  const tab = await getActiveTab();
  const settings = await loadSettings();
  const session = await loadSession();
  const isManager = isManagerRole(session);

  els.url.textContent = tab?.url || "URL を取得できません";

  if (!session) {
    els.roleHint.textContent = "権限: 未ログイン";
    els.authBtn.textContent = "ログイン";
    els.openOptions.disabled = false;
    showLoginPanel(true);
  } else {
    els.roleHint.textContent = `権限: ${roleText(session)}`;
    els.authBtn.textContent = "ログアウト";
    els.openOptions.disabled = !isManager;
    showLoginPanel(false);
    if (!isManager) {
      els.roleHint.textContent += " / URL変更は管理者のみ";
    }
  }

  els.allowBtn.disabled = !isManager;
  els.blockBtn.disabled = !isManager;

  if (!session || isManager) {
    const mode = tab?.url ? getModeForUrl(tab.url, settings) : settings.quickAction || "allow";
    setToggleState(mode, !isManager);
    setStatus(mode === "block" ? "ブロック" : "許可");
  } else {
    setToggleState(null, true);
    setStatus("閲覧のみ");
  }
};

const handleLogin = async () => {
  const schoolId = els.loginSchoolId.value.trim();
  const id = els.loginId.value.trim();
  const password = els.loginPassword.value;

  if (!schoolId || !id || !password) {
    els.loginMessage.textContent = "学校ID・ID・パスワードを入力してください。";
    return;
  }

  const users = await loadUsers();
  const user = users.find((item) => item.schoolId === schoolId && item.id === id);
  if (!user) {
    els.loginMessage.textContent = "学校IDまたはID/パスワードが違います。";
    return;
  }

  const hash = await hashPassword(password, base64ToBuffer(user.salt));
  if (hash !== user.hash) {
    els.loginMessage.textContent = "学校IDまたはID/パスワードが違います。";
    return;
  }

  await saveSession({ id: user.id, role: user.role, schoolId: user.schoolId });
  els.loginMessage.textContent = "";
  els.loginPassword.value = "";
  await refresh();
};

els.allowBtn.addEventListener("click", async () => {
  const session = await loadSession();
  if (!isManagerRole(session)) return;
  await updateUrlLists("allow");
  setToggleState("allow", false);
  setStatus("許可");
});

els.blockBtn.addEventListener("click", async () => {
  const session = await loadSession();
  if (!isManagerRole(session)) return;
  await updateUrlLists("block");
  setToggleState("block", false);
  setStatus("ブロック");
});

els.openOptions.addEventListener("click", async () => {
  const session = await loadSession();
  if (session && !isManagerRole(session)) {
    els.loginMessage.textContent = "生徒は管理画面を開けません。";
    return;
  }
  chrome.runtime.sendMessage({ type: "openOptions" });
});

els.authBtn.addEventListener("click", async () => {
  const session = await loadSession();
  if (session) {
    await clearSession();
    await refresh();
  } else {
    showLoginPanel(true);
  }
});

els.loginBtn?.addEventListener("click", handleLogin);

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "local") {
    refresh();
  }
});

if (cloud) {
  window.setInterval(async () => {
    await chrome.runtime.sendMessage({ type: "syncCloud" });
    await refresh();
  }, 5000);
}

refresh();
