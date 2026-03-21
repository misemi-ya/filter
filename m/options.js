(() => {
  const STORAGE_KEY = "msefilter-settings";
  const USERS_KEY = "msefilter-users";
  const LOG_KEY = "msefilter-logs";
  const SESSION_KEY = "msefilter-session";
  const SCHOOLS_KEY = "msefilter-schools";
  const cloud = globalThis.MSEFILTER_CLOUD;

  const DEFAULTS = {
    displayName: "店大教育部作成 - ミセフィルタ",
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

  const DEFAULT_SCHOOL_NAME = "本部管理学校";
  const CATEGORY_LIST = window.MSEFILTER_CATEGORIES?.list || [];
  const CATEGORY_KEYWORDS = window.MSEFILTER_CATEGORIES?.keywords || {};

  const els = {
    navItems: Array.from(document.querySelectorAll(".nav-item")),
    tabs: Array.from(document.querySelectorAll(".tab")),
    enabledToggle: document.getElementById("enabledToggle"),
    statusText: document.getElementById("statusText"),
    currentUserId: document.getElementById("currentUserId"),
    summaryStatus: document.getElementById("summaryStatus"),
    summaryCategories: document.getElementById("summaryCategories"),
    syncStatus: document.getElementById("syncStatus"),
    allowKeywords: document.getElementById("allowKeywords"),
    blockKeywords: document.getElementById("blockKeywords"),
    allowedDomains: document.getElementById("allowedDomains"),
    blockedDomains: document.getElementById("blockedDomains"),
    allowedUrls: document.getElementById("allowedUrls"),
    blockedUrls: document.getElementById("blockedUrls"),
    strictToggle: document.getElementById("strictToggle"),
    nightToggle: document.getElementById("nightToggle"),
    nightStart: document.getElementById("nightStart"),
    nightEnd: document.getElementById("nightEnd"),
    displayName: document.getElementById("displayName"),
    brandTitle: document.getElementById("brandTitle"),
    lastSaved: document.getElementById("lastSaved"),
    saveBtn: document.getElementById("saveBtn"),
    resetBtn: document.getElementById("resetBtn"),
    logoutBtn: document.getElementById("logoutBtn"),
    lockScreen: document.getElementById("lockScreen"),
    lockTitle: document.getElementById("lockTitle"),
    lockMessage: document.getElementById("lockMessage"),
    loginForm: document.getElementById("loginForm"),
    loginSchoolId: document.getElementById("loginSchoolId"),
    loginId: document.getElementById("loginId"),
    loginPassword: document.getElementById("loginPassword"),
    setupForm: document.getElementById("setupForm"),
    setupSchoolId: document.getElementById("setupSchoolId"),
    setupId: document.getElementById("setupId"),
    setupPassword: document.getElementById("setupPassword"),
    setupConfirm: document.getElementById("setupConfirm"),
    schoolAdminCard: document.getElementById("schoolAdminCard"),
    schoolId: document.getElementById("schoolId"),
    schoolName: document.getElementById("schoolName"),
    addSchoolBtn: document.getElementById("addSchoolBtn"),
    schoolList: document.getElementById("schoolList"),
    userSchoolId: document.getElementById("userSchoolId"),
    bulkSchoolId: document.getElementById("bulkSchoolId"),
    bulkStudents: document.getElementById("bulkStudents"),
    bulkAddBtn: document.getElementById("bulkAddBtn"),
    bulkDeleteBtn: document.getElementById("bulkDeleteBtn"),
    testUrl: document.getElementById("testUrl"),
    runTest: document.getElementById("runTest"),
    testCategory: document.getElementById("testCategory"),
    testDecision: document.getElementById("testDecision"),
    logList: document.getElementById("logList"),
    categoryContainer: document.getElementById("categoryContainer"),
    categorySearch: document.getElementById("categorySearch"),
    categoryCount: document.getElementById("categoryCount"),
    userId: document.getElementById("userId"),
    userRole: document.getElementById("userRole"),
    userPassword: document.getElementById("userPassword"),
    userPasswordConfirm: document.getElementById("userPasswordConfirm"),
    addUserBtn: document.getElementById("addUserBtn"),
    userList: document.getElementById("userList"),
  };

  let blockedCategorySet = new Set();
  let currentSettings = { ...DEFAULTS };
  let currentSession = null;
  let saveTimer = null;
  let suppressSettingsReloadUntil = 0;

  const normalizeRole = (role) => (role === "teacher" ? "admin" : role || "student");
  const isSuper = (session) => normalizeRole(session?.role) === "super";
  const isAdmin = (session) => ["admin", "super"].includes(normalizeRole(session?.role));

  const roleLabel = (role) => {
    const normalized = normalizeRole(role);
    if (normalized === "super") return "本部管理者";
    if (normalized === "admin") return "学校管理者";
    return "生徒";
  };

  const sanitizeCommaList = (value) =>
    String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .join(", ");

  const sanitizeLineList = (value) =>
    String(value || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");

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

  const createUser = async (id, role, schoolId, password) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return {
      id,
      role: normalizeRole(role),
      schoolId,
      salt: bufferToBase64(salt),
      hash: await hashPassword(password, salt),
    };
  };

  const loadSettings = async () => {
    const settings = cloud
      ? await cloud.getSettings(DEFAULTS)
      : { ...DEFAULTS, ...((await chrome.storage.local.get([STORAGE_KEY]))[STORAGE_KEY] || {}) };
    currentSettings = settings;
    return settings;
  };

  const saveSettingsToStorage = async (settings) => {
    currentSettings = settings;
    suppressSettingsReloadUntil = Date.now() + 2000;
    if (cloud) {
      await cloud.saveSettings(settings, DEFAULTS);
    } else {
      await chrome.storage.local.set({ [STORAGE_KEY]: settings });
    }
    await chrome.runtime.sendMessage({ type: "refreshRules" });
  };

  const loadUsers = async () => {
    const users = cloud
      ? await cloud.getUsers(DEFAULTS)
      : (await chrome.storage.local.get([USERS_KEY]))[USERS_KEY] || [];
    return users.map((user) => ({
      ...user,
      role: normalizeRole(user.role),
    }));
  };

  const saveUsers = async (users) => {
    if (cloud) {
      await cloud.saveUsers(users, DEFAULTS);
    } else {
      await chrome.storage.local.set({ [USERS_KEY]: users });
    }
  };

  const loadSchools = async () => {
    if (cloud) {
      return cloud.getSchools(DEFAULTS);
    }
    const data = await chrome.storage.local.get([SCHOOLS_KEY]);
    return data[SCHOOLS_KEY] || [];
  };

  const saveSchools = async (schools) => {
    if (cloud) {
      await cloud.saveSchools(schools, DEFAULTS);
    } else {
      await chrome.storage.local.set({ [SCHOOLS_KEY]: schools });
    }
  };

  const loadSession = async () => {
    const data = await chrome.storage.local.get([SESSION_KEY]);
    return data[SESSION_KEY] || null;
  };

  const saveSession = async (session) => {
    currentSession = session;
    await chrome.storage.local.set({ [SESSION_KEY]: session });
  };

  const clearSession = async () => {
    currentSession = null;
    await chrome.storage.local.remove(SESSION_KEY);
  };

  const updateCurrentUserLabel = () => {
    if (!currentSession) {
      els.currentUserId.textContent = "-";
      return;
    }
    els.currentUserId.textContent = `${currentSession.schoolId} / ${currentSession.id}`;
  };

  const isEditingForm = () => {
    const active = document.activeElement;
    if (!active) return false;
    return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
  };

  const addLog = async (message) => {
    const data = await chrome.storage.local.get([LOG_KEY]);
    const logs = data[LOG_KEY] || [];
    logs.unshift({ message, time: new Date().toLocaleString() });
    await chrome.storage.local.set({ [LOG_KEY]: logs.slice(0, 50) });
    await renderLogs();
  };

  const renderLogs = async () => {
    const data = await chrome.storage.local.get([LOG_KEY]);
    const logs = data[LOG_KEY] || [];
    els.logList.innerHTML = "";

    if (logs.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = "ログはありません";
      els.logList.appendChild(empty);
      return;
    }

    logs.forEach((log) => {
      const li = document.createElement("li");
      li.textContent = `${log.time} - ${log.message}`;
      els.logList.appendChild(li);
    });
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

  const decideUrl = (url, settings) => {
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

    const categoryId = classifyUrl(url);
    const categoryBlocked =
      (settings.blockedCategories || []).includes(categoryId) &&
      categoryId !== "unclassified";

    if (
      matchesList(allowKeywords) ||
      matchesDomain(allowedDomains) ||
      matchesList(allowedUrls)
    ) {
      return "許可";
    }
    if (settings.strictMode || categoryBlocked) {
      return "ブロック";
    }
    if (
      matchesList(blockKeywords) ||
      matchesDomain(blockedDomains) ||
      matchesList(blockedUrls)
    ) {
      return "ブロック";
    }
    return "通常";
  };

  const showLock = (mode, message) => {
    els.lockMessage.textContent = message;
    els.lockTitle.textContent = mode === "setup" ? "初回セットアップ" : "管理画面ログイン";
    els.loginForm.classList.toggle("lock-hidden", mode !== "login");
    els.setupForm.classList.toggle("lock-hidden", mode !== "setup");
    els.lockScreen.classList.remove("lock-hidden");
  };

  const hideLock = () => {
    els.lockScreen.classList.add("lock-hidden");
  };

  const setStatus = (enabled) => {
    const text = enabled ? "有効" : "停止";
    els.statusText.textContent = text;
    els.summaryStatus.textContent = text;
  };

  const updateSummary = (settings) => {
    setStatus(settings.enabled);
    els.summaryCategories.textContent = String((settings.blockedCategories || []).length);
    els.syncStatus.textContent = "保存先: この端末";
  };

  const renderCategories = (filterText = "") => {
    const filter = filterText.trim().toLowerCase();
    els.categoryContainer.innerHTML = "";

    const items = CATEGORY_LIST.filter((item) => {
      if (!filter) return true;
      return item.label.toLowerCase().includes(filter) || item.id.toLowerCase().includes(filter);
    });

    items.forEach((item) => {
      const label = document.createElement("label");
      label.className = "category";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = blockedCategorySet.has(item.id);
      input.addEventListener("change", () => {
        if (input.checked) {
          blockedCategorySet.add(item.id);
        } else {
          blockedCategorySet.delete(item.id);
        }
        queueSave("auto");
      });

      const span = document.createElement("span");
      span.textContent = item.label;

      label.appendChild(input);
      label.appendChild(span);
      els.categoryContainer.appendChild(label);
    });

    els.categoryCount.textContent = `${items.length} 件`;
  };

  const applySettingsToForm = (settings) => {
    els.enabledToggle.checked = Boolean(settings.enabled);
    els.strictToggle.checked = Boolean(settings.strictMode);
    els.allowKeywords.value = settings.allowKeywords || "";
    els.blockKeywords.value = settings.blockKeywords || "";
    els.allowedDomains.value = settings.allowedDomains || "";
    els.blockedDomains.value = settings.blockedDomains || "";
    els.allowedUrls.value = settings.allowedUrls || "";
    els.blockedUrls.value = settings.blockedUrls || "";
    els.nightToggle.checked = Boolean(settings.nightBlockEnabled);
    els.nightStart.value = settings.nightBlockStart || "22:00";
    els.nightEnd.value = settings.nightBlockEnd || "06:00";
    els.displayName.value = settings.displayName || DEFAULTS.displayName;
    els.brandTitle.textContent = settings.displayName || DEFAULTS.displayName;
    blockedCategorySet = new Set(settings.blockedCategories || []);
    renderCategories(els.categorySearch.value || "");
    updateSummary(settings);
  };

  const collectSettings = () => ({
    displayName: els.displayName.value.trim() || DEFAULTS.displayName,
    enabled: els.enabledToggle.checked,
    strictMode: els.strictToggle.checked,
    allowKeywords: sanitizeCommaList(els.allowKeywords.value),
    blockKeywords: sanitizeCommaList(els.blockKeywords.value),
    allowedDomains: sanitizeCommaList(els.allowedDomains.value),
    blockedDomains: sanitizeCommaList(els.blockedDomains.value),
    allowedUrls: sanitizeLineList(els.allowedUrls.value),
    blockedUrls: sanitizeLineList(els.blockedUrls.value),
    blockedCategories: Array.from(blockedCategorySet),
    nightBlockEnabled: els.nightToggle.checked,
    nightBlockStart: els.nightStart.value || "22:00",
    nightBlockEnd: els.nightEnd.value || "06:00",
    quickAction: currentSettings.quickAction || "allow",
  });

  const saveSettings = async (source = "manual") => {
    const settings = collectSettings();
    await saveSettingsToStorage(settings);
    applySettingsToForm(settings);
    els.lastSaved.textContent =
      source === "auto"
        ? `自動保存 ${new Date().toLocaleTimeString()}`
        : `保存しました ${new Date().toLocaleTimeString()}`;
  };

  const queueSave = (source = "auto") => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveSettings(source);
    }, 350);
  };

  const resetSettings = async () => {
    await saveSettingsToStorage({ ...DEFAULTS });
    applySettingsToForm({ ...DEFAULTS });
    els.lastSaved.textContent = "初期設定に戻しました";
  };

  const setTab = (tabId) => {
    els.navItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.tab === tabId);
    });
    els.tabs.forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.tab === tabId);
    });
  };

  const renderSchools = async () => {
    const schools = await loadSchools();
    els.schoolList.innerHTML = "";
    if (schools.length === 0) {
      const li = document.createElement("li");
      li.textContent = "学校がありません";
      els.schoolList.appendChild(li);
      return;
    }

    schools.forEach((school) => {
      const li = document.createElement("li");
      li.textContent = `${school.id} - ${school.name}`;
      els.schoolList.appendChild(li);
    });
  };

  const renderSchoolOptions = async () => {
    const schools = await loadSchools();
    els.userSchoolId.innerHTML = "";
    els.bulkSchoolId.innerHTML = "";

    schools.forEach((school) => {
      [els.userSchoolId, els.bulkSchoolId].forEach((select) => {
        const option = document.createElement("option");
        option.value = school.id;
        option.textContent = `${school.id} - ${school.name}`;
        select.appendChild(option);
      });
    });

    if (currentSession?.schoolId) {
      els.userSchoolId.value = currentSession.schoolId;
      els.bulkSchoolId.value = currentSession.schoolId;
    }

    els.userSchoolId.disabled = !isSuper(currentSession);
    els.bulkSchoolId.disabled = !isSuper(currentSession);
  };

  const renderRoleOptions = () => {
    els.userRole.innerHTML = "";

    if (isSuper(currentSession)) {
      const adminOption = document.createElement("option");
      adminOption.value = "admin";
      adminOption.textContent = "学校管理者";
      els.userRole.appendChild(adminOption);
    }

    const studentOption = document.createElement("option");
    studentOption.value = "student";
    studentOption.textContent = "生徒";
    els.userRole.appendChild(studentOption);
  };

  const renderAccessControls = async () => {
    els.schoolAdminCard.style.display = isSuper(currentSession) ? "block" : "none";
    await renderSchools();
    await renderSchoolOptions();
    renderRoleOptions();
  };

  const renderUsers = async () => {
    const [users, schools] = await Promise.all([loadUsers(), loadSchools()]);
    const schoolMap = new Map(schools.map((school) => [school.id, school.name]));
    const visibleUsers = isSuper(currentSession)
      ? users
      : users.filter(
          (user) => user.schoolId === currentSession?.schoolId && user.role !== "super"
        );

    els.userList.innerHTML = "";

    if (visibleUsers.length === 0) {
      const empty = document.createElement("div");
      empty.className = "school-group";
      empty.textContent = "ユーザーがいません";
      els.userList.appendChild(empty);
      return;
    }

    const groupedUsers = visibleUsers.reduce((map, user) => {
      const list = map.get(user.schoolId) || [];
      list.push(user);
      map.set(user.schoolId, list);
      return map;
    }, new Map());

    groupedUsers.forEach((groupUsers, schoolId) => {
      const section = document.createElement("section");
      section.className = "school-group";

      const head = document.createElement("div");
      head.className = "school-group-head";

      const titleWrap = document.createElement("div");
      const title = document.createElement("p");
      title.className = "school-group-title";
      title.textContent = schoolMap.get(schoolId) || schoolId;
      const meta = document.createElement("p");
      meta.className = "school-group-meta";
      meta.textContent = `${schoolId} / ${groupUsers.length}人`;
      titleWrap.appendChild(title);
      titleWrap.appendChild(meta);
      head.appendChild(titleWrap);

      section.appendChild(head);

      const list = document.createElement("div");
      list.className = "user-chip-list";

      groupUsers.forEach((user) => {
        const item = document.createElement("div");
        item.className = "user-chip";

        const text = document.createElement("div");
        text.innerHTML = `<strong>${user.id}</strong><span>${roleLabel(user.role)}</span>`;
        item.appendChild(text);

        const canDelete =
          isSuper(currentSession) ||
          (normalizeRole(currentSession?.role) === "admin" &&
            user.role === "student" &&
            user.schoolId === currentSession.schoolId);

        if (canDelete) {
          const button = document.createElement("button");
          button.className = "ghost";
          button.textContent = "削除";
          button.addEventListener("click", async () => {
            const nextUsers = (await loadUsers()).filter(
              (itemUser) => !(itemUser.id === user.id && itemUser.schoolId === user.schoolId)
            );
            await saveUsers(nextUsers);
            await renderUsers();
          });
          item.appendChild(button);
        }

        list.appendChild(item);
      });

      section.appendChild(list);
      els.userList.appendChild(section);
    });
  };

  const loadSettingsIntoPage = async () => {
    const settings = await loadSettings();
    applySettingsToForm(settings);
  };

  const initAuth = async () => {
    const [users, session] = await Promise.all([loadUsers(), loadSession()]);

    if (users.length === 0) {
      showLock("setup", "初回は学校ID・ID・パスワードを自分で決めてください。");
      updateCurrentUserLabel();
      return;
    }

    if (session) {
      const match = users.find(
        (user) =>
          user.id === session.id &&
          user.schoolId === session.schoolId &&
          user.role === normalizeRole(session.role)
      );

      if (match) {
        if (normalizeRole(match.role) === "student") {
          currentSession = null;
          updateCurrentUserLabel();
          showLock("login", "生徒は管理画面に入れません。管理者でログインしてください。");
          return;
        }

        currentSession = {
          id: match.id,
          role: match.role,
          schoolId: match.schoolId,
        };
        updateCurrentUserLabel();
        hideLock();
        return;
      }
    }

    currentSession = null;
    updateCurrentUserLabel();
    showLock("login", "学校ID・ID・パスワードを入力してください。");
  };

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const schoolId = els.loginSchoolId.value.trim();
    const id = els.loginId.value.trim();
    const password = els.loginPassword.value;

    if (!schoolId || !id || !password) {
      showLock("login", "学校ID・ID・パスワードを入力してください。");
      return;
    }

    const users = await loadUsers();
    const user = users.find((item) => item.schoolId === schoolId && item.id === id);
    if (!user) {
      showLock("login", "学校IDまたはID/パスワードが違います。");
      return;
    }

    if (normalizeRole(user.role) === "student") {
      showLock("login", "生徒は管理画面に入れません。管理者でログインしてください。");
      return;
    }

    const hash = await hashPassword(password, base64ToBuffer(user.salt));
    if (hash !== user.hash) {
      showLock("login", "学校IDまたはID/パスワードが違います。");
      return;
    }

    await saveSession({ id: user.id, role: user.role, schoolId: user.schoolId });
    updateCurrentUserLabel();
    hideLock();
    await renderAccessControls();
    await renderUsers();
  });

  els.setupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const schoolId = els.setupSchoolId.value.trim();
    const id = els.setupId.value.trim();
    const password = els.setupPassword.value;
    const confirm = els.setupConfirm.value;

    if (!schoolId || !id || password.length < 6) {
      showLock("setup", "学校ID・ID・6文字以上のパスワードを入力してください。");
      return;
    }

    if (password !== confirm) {
      showLock("setup", "パスワードが一致しません。");
      return;
    }

    const schools = await loadSchools();
    if (schools.some((school) => school.id === schoolId)) {
      showLock("setup", "その学校IDはすでに使われています。");
      return;
    }

    const nextSchools = schools.concat([{ id: schoolId, name: DEFAULT_SCHOOL_NAME }]);
    const user = await createUser(id, "super", schoolId, password);
    await saveSchools(nextSchools);
    await saveUsers([user]);
    await saveSession({ id: user.id, role: user.role, schoolId: user.schoolId });
    updateCurrentUserLabel();
    await addLog(`初回管理者 ${id} を作成しました`);
    hideLock();
    await renderAccessControls();
    await renderUsers();
  });

  els.logoutBtn.addEventListener("click", async () => {
    await clearSession();
    updateCurrentUserLabel();
    showLock("login", "学校ID・ID・パスワードを入力してください。");
  });

  els.addSchoolBtn.addEventListener("click", async () => {
    if (!isSuper(currentSession)) {
      els.lastSaved.textContent = "本部管理者のみ学校を追加できます。";
      return;
    }

    const id = els.schoolId.value.trim();
    const name = els.schoolName.value.trim();

    if (!id || !name) {
      els.lastSaved.textContent = "学校IDと学校名を入力してください。";
      return;
    }

    const schools = await loadSchools();
    if (schools.some((school) => school.id === id)) {
      els.lastSaved.textContent = "同じ学校IDが存在します。";
      return;
    }

    await saveSchools(schools.concat([{ id, name }]));
    els.schoolId.value = "";
    els.schoolName.value = "";
    els.lastSaved.textContent = "学校を追加しました";
    await renderAccessControls();
  });

  els.addUserBtn.addEventListener("click", async () => {
    if (!isAdmin(currentSession)) {
      els.lastSaved.textContent = "学校管理者以上のみユーザー追加できます。";
      return;
    }

    const id = els.userId.value.trim();
    const password = els.userPassword.value;
    const confirm = els.userPasswordConfirm.value;
    const role = isSuper(currentSession) ? els.userRole.value : "student";
    const schoolId = isSuper(currentSession) ? els.userSchoolId.value : currentSession.schoolId;

    if (!id || password.length < 6) {
      els.lastSaved.textContent = "IDと6文字以上のパスワードを入力してください。";
      return;
    }

    if (password !== confirm) {
      els.lastSaved.textContent = "パスワードが一致しません。";
      return;
    }

    const users = await loadUsers();
    if (users.some((user) => user.id === id && user.schoolId === schoolId)) {
      els.lastSaved.textContent = "同じ学校IDに同じユーザーIDが存在します。";
      return;
    }

    const user = await createUser(id, role, schoolId, password);
    await saveUsers(users.concat([user]));
    els.userId.value = "";
    els.userPassword.value = "";
    els.userPasswordConfirm.value = "";
    els.lastSaved.textContent = `${roleLabel(role)}を追加しました`;
    await renderUsers();
  });

  els.bulkAddBtn.addEventListener("click", async () => {
    if (!isAdmin(currentSession)) {
      els.lastSaved.textContent = "学校管理者以上のみ生徒一括追加できます。";
      return;
    }

    const schoolId = isSuper(currentSession) ? els.bulkSchoolId.value : currentSession.schoolId;
    const lines = els.bulkStudents.value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      els.lastSaved.textContent = "一括追加する生徒情報を入力してください。";
      return;
    }

    const users = await loadUsers();
    const createdUsers = [];

    for (const line of lines) {
      const [id, password] = line.split(",").map((item) => item?.trim());
      if (!id || !password || password.length < 6) {
        els.lastSaved.textContent = `形式エラー: ${line}`;
        return;
      }
      if (users.some((user) => user.id === id && user.schoolId === schoolId)) {
        els.lastSaved.textContent = `同じ学校に同じIDがあります: ${id}`;
        return;
      }
      createdUsers.push(await createUser(id, "student", schoolId, password));
    }

    await saveUsers(users.concat(createdUsers));
    els.bulkStudents.value = "";
    els.lastSaved.textContent = `${createdUsers.length}人の生徒を追加しました`;
    await renderUsers();
  });

  els.bulkDeleteBtn.addEventListener("click", async () => {
    if (!isAdmin(currentSession)) {
      els.lastSaved.textContent = "学校管理者以上のみ生徒一括削除できます。";
      return;
    }

    const schoolId = isSuper(currentSession) ? els.bulkSchoolId.value : currentSession.schoolId;
    const users = await loadUsers();
    const remainingUsers = users.filter(
      (user) => !(user.schoolId === schoolId && user.role === "student")
    );

    if (remainingUsers.length === users.length) {
      els.lastSaved.textContent = "削除できる生徒がいません。";
      return;
    }

    await saveUsers(remainingUsers);
    els.lastSaved.textContent = `${schoolId} の生徒を全削除しました`;
    await renderUsers();
  });

  els.navItems.forEach((item) => {
    item.addEventListener("click", () => {
      setTab(item.dataset.tab);
    });
  });

  els.enabledToggle.addEventListener("change", () => {
    setStatus(els.enabledToggle.checked);
    queueSave("auto");
  });

  els.displayName.addEventListener("input", () => {
    els.brandTitle.textContent = els.displayName.value.trim() || DEFAULTS.displayName;
    queueSave("auto");
  });

  [
    els.allowKeywords,
    els.blockKeywords,
    els.allowedDomains,
    els.blockedDomains,
    els.allowedUrls,
    els.blockedUrls,
    els.strictToggle,
    els.nightToggle,
    els.nightStart,
    els.nightEnd,
  ].forEach((element) => {
    element.addEventListener("input", () => queueSave("auto"));
    element.addEventListener("change", () => queueSave("auto"));
  });

  els.categorySearch.addEventListener("input", () => {
    renderCategories(els.categorySearch.value);
  });

  els.saveBtn.addEventListener("click", async () => {
    await saveSettings("manual");
    await addLog("設定を保存しました");
  });

  els.resetBtn.addEventListener("click", async () => {
    await resetSettings();
    await addLog("設定をリセットしました");
  });

  els.runTest.addEventListener("click", async () => {
    const url = els.testUrl.value.trim();
    if (!url) return;

    const settings = await loadSettings();
    const categoryId = classifyUrl(url);
    const categoryLabel = getCategoryLabel(categoryId);
    const decision = decideUrl(url, settings);

    els.testCategory.textContent = categoryLabel;
    els.testDecision.textContent = decision;
    await addLog(`診断: ${url} -> ${categoryLabel} / ${decision}`);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEY]) {
      if (Date.now() < suppressSettingsReloadUntil) return;
      if (isEditingForm()) return;
      loadSettingsIntoPage();
    }
  });

  const startLiveSync = () => {
    if (!cloud) return;
    window.setInterval(async () => {
      await cloud.syncCoreData(DEFAULTS, { force: true });
      await chrome.runtime.sendMessage({ type: "syncCloud" });
      if (isEditingForm()) return;
      await loadSettingsIntoPage();
      await renderAccessControls();
      await renderUsers();
    }, 5000);
  };

  const init = async () => {
    if (cloud) {
      await cloud.syncCoreData(DEFAULTS, { force: true });
      await chrome.runtime.sendMessage({ type: "syncCloud" });
    }
    updateCurrentUserLabel();
    await loadSettingsIntoPage();
    await renderLogs();
    await initAuth();
    if (currentSession) {
      await renderAccessControls();
      await renderUsers();
    }
    startLiveSync();
  };

  init();
})();
