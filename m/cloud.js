(() => {
  const CLOUD_BASE_URL =
    "https://loilo-9c765-default-rtdb.asia-southeast1.firebasedatabase.app";

  const STORAGE_KEY = "msefilter-settings";
  const USERS_KEY = "msefilter-users";
  const SCHOOLS_KEY = "msefilter-schools";

  let lastSyncAt = 0;
  let syncPromise = null;

  const hasItems = (value) => Array.isArray(value) && value.length > 0;

  const normalizeSettings = (settings, defaults) => ({
    ...(defaults || {}),
    ...(settings || {}),
  });

  const normalizeCore = (core, defaults) => ({
    settings: normalizeSettings(core?.settings, defaults),
    users: Array.isArray(core?.users) ? core.users : [],
    schools: Array.isArray(core?.schools) ? core.schools : [],
  });

  const readLocalCore = async (defaults) => {
    const data = await chrome.storage.local.get([STORAGE_KEY, USERS_KEY, SCHOOLS_KEY]);
    return normalizeCore(
      {
        settings: data[STORAGE_KEY],
        users: data[USERS_KEY],
        schools: data[SCHOOLS_KEY],
      },
      defaults
    );
  };

  const writeLocalCore = async (core, defaults) => {
    const normalized = normalizeCore(core, defaults);
    await chrome.storage.local.set({
      [STORAGE_KEY]: normalized.settings,
      [USERS_KEY]: normalized.users,
      [SCHOOLS_KEY]: normalized.schools,
    });
    return normalized;
  };

  const fetchCloudJson = async (path, options = {}) => {
    const url = `${CLOUD_BASE_URL}${path}.json`;
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Cloud request failed: ${response.status}`);
    }

    return response.json();
  };

  const readCloudCore = async (defaults) => {
    const raw = await fetchCloudJson("/");
    return normalizeCore(raw || {}, defaults);
  };

  const writeCloudCore = async (core, defaults) => {
    const normalized = normalizeCore(core, defaults);
    await fetchCloudJson("/", {
      method: "PATCH",
      body: normalized,
    });
    return normalized;
  };

  const shouldUseCloud = (core, defaults) => {
    if (hasItems(core.users) || hasItems(core.schools)) return true;
    const normalizedDefaults = normalizeSettings({}, defaults);
    const current = normalizeSettings(core.settings, defaults);
    return JSON.stringify(current) !== JSON.stringify(normalizedDefaults);
  };

  const syncCoreData = async (defaults, options = {}) => {
    const minIntervalMs = options.minIntervalMs ?? 15000;
    const force = Boolean(options.force);

    if (!force && Date.now() - lastSyncAt < minIntervalMs) {
      return readLocalCore(defaults);
    }

    if (syncPromise) {
      return syncPromise;
    }

    syncPromise = (async () => {
      const localCore = await readLocalCore(defaults);

      try {
        const cloudCore = await readCloudCore(defaults);
        const cloudHasData = shouldUseCloud(cloudCore, defaults);

        if (cloudHasData) {
          const written = await writeLocalCore(cloudCore, defaults);
          lastSyncAt = Date.now();
          return written;
        }

        const uploaded = await writeCloudCore(localCore, defaults);
        await writeLocalCore(uploaded, defaults);
        lastSyncAt = Date.now();
        return uploaded;
      } catch {
        return localCore;
      }
    })().finally(() => {
      syncPromise = null;
    });

    return syncPromise;
  };

  const saveSettings = async (settings, defaults) => {
    const localCore = await readLocalCore(defaults);
    const nextCore = {
      ...localCore,
      settings: normalizeSettings(settings, defaults),
    };
    await writeLocalCore(nextCore, defaults);
    try {
      await writeCloudCore(nextCore, defaults);
      lastSyncAt = Date.now();
    } catch {}
    return nextCore.settings;
  };

  const saveUsers = async (users, defaults) => {
    const localCore = await readLocalCore(defaults);
    const nextCore = {
      ...localCore,
      users: Array.isArray(users) ? users : [],
    };
    await writeLocalCore(nextCore, defaults);
    try {
      await writeCloudCore(nextCore, defaults);
      lastSyncAt = Date.now();
    } catch {}
    return nextCore.users;
  };

  const saveSchools = async (schools, defaults) => {
    const localCore = await readLocalCore(defaults);
    const nextCore = {
      ...localCore,
      schools: Array.isArray(schools) ? schools : [],
    };
    await writeLocalCore(nextCore, defaults);
    try {
      await writeCloudCore(nextCore, defaults);
      lastSyncAt = Date.now();
    } catch {}
    return nextCore.schools;
  };

  const api = {
    syncCoreData,
    readLocalCore,
    getSettings: async (defaults, options = {}) => {
      if (options.fresh) {
        await syncCoreData(defaults, options);
      }
      const core = await readLocalCore(defaults);
      return core.settings;
    },
    getUsers: async (defaults, options = {}) => {
      if (options.fresh) {
        await syncCoreData(defaults, options);
      }
      const core = await readLocalCore(defaults);
      return core.users;
    },
    getSchools: async (defaults, options = {}) => {
      if (options.fresh) {
        await syncCoreData(defaults, options);
      }
      const core = await readLocalCore(defaults);
      return core.schools;
    },
    saveSettings,
    saveUsers,
    saveSchools,
  };

  if (typeof self !== "undefined") {
    self.MSEFILTER_CLOUD = api;
  }
  if (typeof window !== "undefined") {
    window.MSEFILTER_CLOUD = api;
  }
})();
