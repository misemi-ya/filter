const STORAGE_KEY = "msefilter-settings";
const USERS_KEY = "msefilter-users";
const SESSION_KEY = "msefilter-session";
const CATEGORY_LIST = window.MSEFILTER_CATEGORIES?.list || [];
const CATEGORY_KEYWORDS = window.MSEFILTER_CATEGORIES?.keywords || {};

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
};

let blockOverlay = null;
let overlayCategory = null;
let loginOverlay = null;
let teacherNotice = null;
let teacherNoticeShown = false;

const normalizeRole = (role) => (role === "teacher" ? "admin" : role || "student");

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
  const data = await chrome.storage.local.get([STORAGE_KEY]);
  return { ...DEFAULTS, ...(data[STORAGE_KEY] || {}) };
};

const loadUsers = async () => {
  const data = await chrome.storage.local.get([USERS_KEY]);
  return (data[USERS_KEY] || []).map((user) => ({
    ...user,
    role: normalizeRole(user.role),
  }));
};

const loadSession = async () => {
  const data = await chrome.storage.local.get([SESSION_KEY]);
  return data[SESSION_KEY] || null;
};

const saveSession = async (session) => {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
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

const getCategoryLabel = (categoryId) =>
  CATEGORY_LIST.find((item) => item.id === categoryId)?.label ||
  (categoryId === "unclassified" ? "未分類" : categoryId);

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

const decideUrl = (url, settings) => {
  if (!settings.enabled) {
    return { decision: "allow", categoryLabel: "未分類" };
  }

  const lower = url.toLowerCase();
  const allowKeywords = parseCsv(settings.allowKeywords || "");
  const blockKeywords = parseCsv(settings.blockKeywords || "");
  const allowedDomains = parseCsv(settings.allowedDomains || "");
  const blockedDomains = parseCsv(settings.blockedDomains || "");
  const allowedUrls = parseLines(settings.allowedUrls || "");
  const blockedUrls = parseLines(settings.blockedUrls || "");
  const categoryId = classifyUrl(url);
  const categoryLabel = getCategoryLabel(categoryId);

  const matchesDomain = (domains) =>
    domains.some((domain) => lower.includes(domain.toLowerCase()));

  const matchesList = (list) =>
    list.some((item) => lower.includes(item.toLowerCase()));

  const allowHit =
    matchesList(allowKeywords) ||
    matchesDomain(allowedDomains) ||
    matchesList(allowedUrls);

  const blockHit =
    matchesList(blockKeywords) ||
    matchesDomain(blockedDomains) ||
    matchesList(blockedUrls) ||
    ((settings.blockedCategories || []).includes(categoryId) && categoryId !== "unclassified");

  const nightBlocked =
    settings.nightBlockEnabled &&
    isWithinNightWindow(settings.nightBlockStart || "22:00", settings.nightBlockEnd || "06:00");

  if (allowHit) return { decision: "allow", categoryLabel };
  if (settings.strictMode || nightBlocked || blockHit) {
    return { decision: "block", categoryLabel };
  }
  return { decision: "allow", categoryLabel };
};

const createButton = (label, style = "ghost") => {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.style.border = style === "primary" ? "none" : "1px solid #cfd7dd";
  button.style.borderRadius = "999px";
  button.style.padding = "10px 18px";
  button.style.background =
    style === "primary" ? "linear-gradient(135deg, #2ecc75, #96e5ba)" : "#ffffff";
  button.style.color = "#173423";
  button.style.fontWeight = "700";
  button.style.cursor = "pointer";
  return button;
};

const removeOverlay = (overlay) => {
  if (overlay?.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
};

const showBlockOverlay = (categoryLabel) => {
  if (!blockOverlay) {
    blockOverlay = document.createElement("div");
    blockOverlay.id = "msefilter-block-overlay";
    blockOverlay.style.position = "fixed";
    blockOverlay.style.inset = "0";
    blockOverlay.style.zIndex = "2147483647";
    blockOverlay.style.background = "rgba(245, 248, 246, 0.98)";
    blockOverlay.style.display = "grid";
    blockOverlay.style.placeItems = "center";
    blockOverlay.style.fontFamily = "\"Segoe UI\", sans-serif";

    const card = document.createElement("div");
    card.style.width = "min(420px, calc(100vw - 32px))";
    card.style.background = "#ffffff";
    card.style.borderRadius = "20px";
    card.style.padding = "28px";
    card.style.boxShadow = "0 24px 48px rgba(0, 0, 0, 0.14)";
    card.style.textAlign = "center";

    const title = document.createElement("h2");
    title.textContent = "このページはブロックされています";
    title.style.margin = "0 0 10px";
    title.style.color = "#173423";

    const body = document.createElement("p");
    body.textContent = "このページは生徒には表示できません。";
    body.style.margin = "0 0 14px";
    body.style.color = "#4f6358";

    overlayCategory = document.createElement("p");
    overlayCategory.style.margin = "0 0 18px";
    overlayCategory.style.fontWeight = "700";
    overlayCategory.style.color = "#173423";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "10px";
    actions.style.justifyContent = "center";

    const backButton = createButton("前のページへ");
    backButton.addEventListener("click", () => history.back());

    const manageButton = createButton("管理画面を開く", "primary");
    manageButton.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "openOptions" });
    });

    actions.appendChild(backButton);
    actions.appendChild(manageButton);
    card.appendChild(title);
    card.appendChild(body);
    card.appendChild(overlayCategory);
    card.appendChild(actions);
    blockOverlay.appendChild(card);
    document.documentElement.appendChild(blockOverlay);
  }

  if (overlayCategory) {
    overlayCategory.textContent = `カテゴリ: ${categoryLabel}`;
  }
};

const hideBlockOverlay = () => {
  removeOverlay(blockOverlay);
  blockOverlay = null;
  overlayCategory = null;
};

const showTeacherNotice = () => {
  if (teacherNoticeShown) return;
  teacherNoticeShown = true;

  if (teacherNotice) {
    teacherNotice.remove();
  }

  teacherNotice = document.createElement("div");
  teacherNotice.style.position = "fixed";
  teacherNotice.style.top = "24px";
  teacherNotice.style.right = "24px";
  teacherNotice.style.zIndex = "2147483646";
  teacherNotice.style.maxWidth = "360px";
  teacherNotice.style.padding = "16px 18px";
  teacherNotice.style.borderRadius = "20px";
  teacherNotice.style.background = "rgba(255,255,255,0.92)";
  teacherNotice.style.backdropFilter = "blur(16px)";
  teacherNotice.style.boxShadow = "0 18px 48px rgba(17, 33, 24, 0.18)";
  teacherNotice.style.border = "1px solid rgba(53, 201, 117, 0.22)";
  teacherNotice.style.fontFamily = "\"Segoe UI\", \"Yu Gothic\", sans-serif";
  teacherNotice.style.color = "#173423";
  teacherNotice.innerHTML = `
    <div style="font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#239057;margin-bottom:6px;">
      Teacher View
    </div>
    <div style="font-size:16px;font-weight:700;margin-bottom:4px;">
      このページの生徒閲覧を禁止しています。
    </div>
    <div style="font-size:13px;line-height:1.6;color:#52665b;">
      先生アカウントのみ閲覧が可能です。
    </div>
  `;

  document.documentElement.appendChild(teacherNotice);
  window.setTimeout(() => {
    if (teacherNotice?.parentNode) {
      teacherNotice.parentNode.removeChild(teacherNotice);
      teacherNotice = null;
    }
  }, 3800);
};

const showLoginOverlay = () => {
  if (loginOverlay) return;

  loginOverlay = document.createElement("div");
  loginOverlay.style.position = "fixed";
  loginOverlay.style.inset = "0";
  loginOverlay.style.zIndex = "2147483645";
  loginOverlay.style.background = "rgba(248, 249, 248, 0.96)";
  loginOverlay.style.display = "grid";
  loginOverlay.style.placeItems = "center";
  loginOverlay.style.fontFamily = "\"Segoe UI\", sans-serif";

  const card = document.createElement("div");
  card.style.width = "min(420px, calc(100vw - 32px))";
  card.style.background = "#ffffff";
  card.style.borderRadius = "20px";
  card.style.padding = "28px";
  card.style.boxShadow = "0 24px 48px rgba(0, 0, 0, 0.14)";

  const title = document.createElement("h2");
  title.textContent = "ログインしてください";
  title.style.margin = "0 0 8px";
  title.style.color = "#173423";

  const body = document.createElement("p");
  body.textContent = "学校ID、ID、パスワードを入力してください。";
  body.style.margin = "0 0 16px";
  body.style.color = "#4f6358";

  const form = document.createElement("form");
  form.style.display = "grid";
  form.style.gap = "10px";

  const schoolInput = document.createElement("input");
  schoolInput.type = "text";
  schoolInput.placeholder = "学校ID";
  schoolInput.autocomplete = "organization";

  const idInput = document.createElement("input");
  idInput.type = "text";
  idInput.placeholder = "ID";
  idInput.autocomplete = "username";

  const passwordInput = document.createElement("input");
  passwordInput.type = "password";
  passwordInput.placeholder = "パスワード";
  passwordInput.autocomplete = "current-password";

  [schoolInput, idInput, passwordInput].forEach((input) => {
    input.style.padding = "12px 14px";
    input.style.borderRadius = "12px";
    input.style.border = "1px solid #d7dde1";
    input.style.fontSize = "16px";
  });

  const message = document.createElement("p");
  message.style.margin = "0";
  message.style.minHeight = "20px";
  message.style.color = "#c0392b";

  const loginButton = createButton("ログイン", "primary");
  loginButton.type = "submit";
  const manageButton = createButton("管理画面を開く");
  manageButton.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "openOptions" });
  });

  form.appendChild(schoolInput);
  form.appendChild(idInput);
  form.appendChild(passwordInput);
  form.appendChild(loginButton);
  form.appendChild(message);
  form.appendChild(manageButton);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const schoolId = schoolInput.value.trim();
    const id = idInput.value.trim();
    const password = passwordInput.value;

    if (!schoolId || !id || !password) {
      message.textContent = "学校ID・ID・パスワードを入力してください。";
      return;
    }

    const users = await loadUsers();
    const user = users.find((item) => item.schoolId === schoolId && item.id === id);
    if (!user) {
      message.textContent = "学校IDまたはID/パスワードが違います。";
      return;
    }

    const hash = await hashPassword(password, base64ToBuffer(user.salt));
    if (hash !== user.hash) {
      message.textContent = "学校IDまたはID/パスワードが違います。";
      return;
    }

    await saveSession({ id: user.id, role: user.role, schoolId: user.schoolId });
    hideLoginOverlay();
    await evaluatePage();
  });

  card.appendChild(title);
  card.appendChild(body);
  card.appendChild(form);
  loginOverlay.appendChild(card);
  document.documentElement.appendChild(loginOverlay);
};

const hideLoginOverlay = () => {
  removeOverlay(loginOverlay);
  loginOverlay = null;
};

const evaluatePage = async () => {
  const session = await loadSession();
  const settings = await loadSettings();
  const result = decideUrl(location.href, settings);

  if (!session) {
    hideBlockOverlay();
    showLoginOverlay();
    return;
  }

  hideLoginOverlay();

  if (["admin", "super"].includes(normalizeRole(session.role))) {
    hideBlockOverlay();
    if (result.decision === "block") {
      showTeacherNotice();
    } else {
      teacherNoticeShown = false;
    }
    return;
  }

  if (result.decision === "block") {
    showBlockOverlay(result.categoryLabel);
  } else {
    hideBlockOverlay();
    teacherNoticeShown = false;
  }
};

const keepOverlayAlive = () => {
  if (!blockOverlay) return;
  if (!document.documentElement.contains(blockOverlay)) {
    document.documentElement.appendChild(blockOverlay);
  }
};

const init = async () => {
  await evaluatePage();

  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === "local") {
      evaluatePage();
    }
  });

  const observer = new MutationObserver(() => {
    keepOverlayAlive();
  });
  observer.observe(document.documentElement, { childList: true });

  let lastUrl = location.href;
  window.setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      evaluatePage();
    } else {
      keepOverlayAlive();
    }
  }, 800);

  window.setInterval(async () => {
    await chrome.runtime.sendMessage({ type: "syncCloud" });
    await evaluatePage();
  }, 2000);

  window.addEventListener("focus", () => {
    chrome.runtime.sendMessage({ type: "syncCloud" }, () => {
      evaluatePage();
    });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      chrome.runtime.sendMessage({ type: "syncCloud" }, () => {
        evaluatePage();
      });
    }
  });
};

init();
