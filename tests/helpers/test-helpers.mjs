import path from "node:path";
import { pathToFileURL } from "node:url";

function compareVersions(left, right) {
  const leftParts = String(left ?? "0").split(".").map((value) => Number.parseInt(value, 10) || 0);
  const rightParts = String(right ?? "0").split(".").map((value) => Number.parseInt(value, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue === rightValue) continue;
    return leftValue > rightValue ? 1 : -1;
  }
  return 0;
}

function createClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...tokens) => {
      for (const token of tokens) values.add(token);
    },
    toggle: (token, force) => {
      if (force === undefined) {
        if (values.has(token)) values.delete(token);
        else values.add(token);
        return values.has(token);
      }

      if (force) values.add(token);
      else values.delete(token);
      return force;
    },
    contains: (token) => values.has(token),
    toArray: () => Array.from(values)
  };
}

export function modulePath(relativePath) {
  const absolute = path.resolve("d:\\_Projekte\\_Foundry-Development\\FoundryVTT_Module\\sephrals-module-loadouts", relativePath);
  return pathToFileURL(absolute).href;
}

export function createModuleRecord(id, overrides = {}) {
  const title = overrides.title ?? id;
  return {
    id,
    title,
    version: overrides.version ?? "1.0.0",
    availability: overrides.availability ?? 0,
    availabilityLabel: overrides.availabilityLabel ?? "",
    availabilityError: overrides.availabilityError ?? "",
    unavailable: overrides.unavailable ?? false,
    ...overrides,
    relationships: {
      requires: Array.from(overrides.relationships?.requires ?? []),
      recommends: Array.from(overrides.relationships?.recommends ?? [])
    }
  };
}

export function createButton(dataset = {}) {
  const listeners = new Map();
  return {
    dataset: { ...dataset },
    disabled: false,
    listeners,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    click() {
      listeners.get("click")?.({ currentTarget: this });
    },
    dispatch(type, event = {}) {
      listeners.get(type)?.({ currentTarget: this, ...event });
    }
  };
}

// A window frame with the close button in its header, as ApplicationV2#_renderFrame builds it.
export function createFrame() {
  const inserted = [];
  const close = { dataset: { action: "close" }, before: (node) => inserted.push(node) };
  return {
    inserted,
    querySelector: (selector) => selector.includes('[data-action="close"]') ? close : null
  };
}

export function createThemeHost() {
  const root = {
    dataset: {},
    classList: createClassList(["sml-app"]),
    querySelector: () => null
  };
  return {
    dataset: {},
    classList: createClassList(),
    querySelector: (selector) => selector === ".sml-app" ? root : null,
    querySelectorAll: () => [],
    root
  };
}

// A form as DialogV2 button callbacks see it: elements by name and checked inputs for querySelectorAll.
export function createFakeForm(values = {}, { checked = {} } = {}) {
  const elements = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value, checked: value === true }]));
  return {
    elements,
    querySelectorAll(selector) {
      const match = /input\[name="([^"]+)"\]:checked/.exec(selector);
      if (!match) return [];
      return (checked[match[1]] ?? []).map((value) => ({ value }));
    }
  };
}

// Answers a DialogV2.wait call like a click on the button with that action.
export async function pressDialogButton(options, action, form = createFakeForm()) {
  const button = options.buttons.find((entry) => entry.action === action);
  if (!button) throw new Error(`No button ${action}`);
  const result = await button.callback?.({}, { form, dataset: { action } }, {});
  return result ?? action;
}

export async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
}

function createHooksStub() {
  const onceHandlers = new Map();
  const onHandlers = new Map();
  return {
    onceHandlers,
    onHandlers,
    once(event, handler) {
      const bucket = onceHandlers.get(event) ?? [];
      bucket.push(handler);
      onceHandlers.set(event, bucket);
    },
    on(event, handler) {
      const bucket = onHandlers.get(event) ?? [];
      bucket.push(handler);
      onHandlers.set(event, bucket);
      return bucket.length;
    },
    off() {},
    async trigger(event, ...args) {
      for (const handler of onceHandlers.get(event) ?? []) await handler(...args);
      for (const handler of onHandlers.get(event) ?? []) await handler(...args);
    }
  };
}

// World Setting documents: getSetting like WorldSettings, the stored value as JSON string in _source.value.
function createWorldSettings(state) {
  const collection = [];
  collection.getSetting = (key, user = null) => collection.find((doc) => doc.key === key && doc.user === user);
  collection.add = (key, value, user = null) => {
    state.settingIdCounter += 1;
    const doc = { id: `setting-${state.settingIdCounter}`, key, user, _source: { value: JSON.stringify(value) } };
    collection.push(doc);
    return doc;
  };
  return collection;
}

export function createTestEnvironment() {
  const PACKAGE_CODES = {
    REQUIRES_CORE_DOWNGRADE: 1,
    REQUIRES_CORE_UPGRADE: 2,
    REQUIRES_SYSTEM: 3,
    REQUIRES_DEPENDENCY: 4,
    MISSING_SYSTEM: 5,
    MISSING_DEPENDENCY: 6,
    UNVERIFIED_GENERATION: 7,
    UNVERIFIED_SYSTEM: 8,
    UNVERIFIED_BUILD: 9
  };

  const state = {
    dialogV2Result: true,
    dialogV2Calls: [],
    dialogV2WaitResult: "ok",
    dialogV2WaitHandler: null,
    dialogV2WaitCalls: [],
    serverTime: null,
    fileText: "",
    randomIdCounter: 0,
    settingIdCounter: 0,
    savedFiles: [],
    notifications: {
      info: [],
      warn: [],
      error: []
    },
    registerCalls: [],
    registerMenuCalls: [],
    keybindingCalls: [],
    settingWrites: [],
    reloadCalls: [],
    reloads: 0,
    socketEmits: [],
    settingsValues: new Map(),
    settingsRegistry: new Map(),
    worldSettings: null,
    settingDocumentCalls: [],
    files: new Map(),
    directories: new Set(),
    fileOps: [],
    uploadFails: false,
    browseFails: null,
    fetchFails: false,
    modules: new Map(),
    world: { id: "test-world", title: "Test World" },
    userCanManage: true,
    lang: "en",
    localizations: new Map()
  };
  state.worldSettings = createWorldSettings(state);

  const hooks = createHooksStub();
  const instances = new Map();

  class TestApplicationV2 {
    static DEFAULT_OPTIONS = {};

    constructor(options = {}) {
      this.options = { ...this.constructor.DEFAULT_OPTIONS, ...options };
      this.renderCalls = [];
      this.element = createThemeHost();
      this.rendered = false;
      this.closed = false;
    }

    get title() {
      return this.options.window?.title ?? "";
    }

    async _prepareContext() {
      return {};
    }

    async _renderFrame() {
      return createFrame();
    }

    _onRender() {}

    _onClose() {}

    _onFirstRender() {}

    async render(options = {}) {
      this.renderCalls.push(options);
      const force = options === true || options?.force === true;
      if (force) {
        this.rendered = true;
        const id = this.options.id;
        if (id) instances.set(id, this);
      }
      return this;
    }

    async close(options = {}) {
      this.closedWith = options;
      this.rendered = false;
      this.closed = true;
      if (this.options.id && instances.get(this.options.id) === this) instances.delete(this.options.id);
      this._onClose(options);
      return this;
    }
  }

  const FilePicker = {
    async browse(source, target) {
      state.fileOps.push({ op: "browse", source, target });
      if (state.browseFails) throw new Error(state.browseFails);
      if (!state.directories.has(target)) throw new Error(`Directory ${target} does not exist or is not accessible in this storage location`);
      const files = Array.from(state.files.keys()).filter((file) => file.startsWith(`${target}/`) && !file.slice(target.length + 1).includes("/"));
      return { target, dirs: [], files };
    },
    async createDirectory(source, target) {
      state.fileOps.push({ op: "createDirectory", source, target });
      if (state.directories.has(target)) throw new Error(`EEXIST: file already exists, mkdir '${target}'`);
      state.directories.add(target);
      return target;
    },
    async upload(source, directory, file) {
      state.fileOps.push({ op: "upload", source, directory, name: file.name });
      if (state.uploadFails) return false;
      const filePath = `${directory}/${file.name}`;
      state.files.set(filePath, await file.text());
      return { status: "success", path: filePath };
    }
  };

  const foundry = {
    utils: {
      randomID() {
        state.randomIdCounter += 1;
        return `id-${state.randomIdCounter}`;
      },
      deepClone(value) {
        return structuredClone(value);
      },
      mergeObject(target, source) {
        const result = Array.isArray(target) ? [...target] : { ...(target ?? {}) };
        for (const [key, value] of Object.entries(source ?? {})) {
          if (value && typeof value === "object" && !Array.isArray(value) && result[key] && typeof result[key] === "object" && !Array.isArray(result[key])) {
            result[key] = foundry.utils.mergeObject(result[key], value);
          } else {
            result[key] = Array.isArray(value) ? [...value] : value;
          }
        }
        return result;
      },
      isNewerVersion(left, right) {
        return compareVersions(left, right) > 0;
      },
      escapeHTML(value) {
        return String(value ?? "")
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      },
      diffObject(left, right) {
        return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right)) ? {} : { changed: true };
      },
      isEmpty(value) {
        return !value || Object.keys(value).length === 0;
      },
      saveDataToFile(data, type, filename) {
        state.savedFiles.push({ data, type, filename });
      },
      async readTextFromFile() {
        return state.fileText;
      },
      getRoute(target) {
        return `/${String(target).replace(/^\/+/, "")}`;
      },
      debouncedReload() {
        state.reloads += 1;
      }
    },
    documents: {},
    applications: {
      instances,
      api: {
        ApplicationV2: TestApplicationV2,
        HandlebarsApplicationMixin: (Base) => class extends Base {},
        DialogV2: {
          async confirm(options) {
            state.dialogV2Calls.push(options);
            return state.dialogV2Result;
          },
          async wait(options) {
            state.dialogV2WaitCalls.push(options);
            if (state.dialogV2WaitHandler) return state.dialogV2WaitHandler(options);
            return state.dialogV2WaitResult;
          }
        }
      },
      apps: {
        FilePicker: { implementation: FilePicker }
      },
      sidebar: {
        apps: {
          ModuleManagement: {
            SETTING: "moduleConfiguration"
          }
        }
      },
      settings: {
        SettingsConfig: {
          reloadConfirm(options) {
            state.reloadCalls.push(options);
          }
        }
      }
    }
  };

  const SettingDocument = {
    async createDocuments(data) {
      state.settingDocumentCalls.push({ op: "create", data });
      return data.map((entry) => {
        state.settingIdCounter += 1;
        const doc = { id: `setting-${state.settingIdCounter}`, key: entry.key, user: entry.user ?? null, _source: { value: entry.value } };
        state.worldSettings.push(doc);
        return doc;
      });
    },
    async updateDocuments(updates) {
      state.settingDocumentCalls.push({ op: "update", data: updates });
      for (const update of updates) {
        const doc = state.worldSettings.find((entry) => entry.id === update._id);
        if (doc) doc._source.value = update.value;
      }
      return updates;
    },
    async deleteDocuments(ids) {
      state.settingDocumentCalls.push({ op: "delete", data: ids });
      for (const id of ids) {
        const index = state.worldSettings.findIndex((entry) => entry.id === id);
        if (index >= 0) state.worldSettings.splice(index, 1);
      }
      return ids;
    }
  };

  const game = {
    i18n: {
      get lang() {
        return state.lang;
      },
      localize(key) {
        return state.localizations.get(key) ?? key;
      },
      format(key, data) {
        const template = state.localizations.get(key) ?? key;
        return Object.entries(data ?? {}).reduce((result, [token, value]) => result.replaceAll(`{${token}}`, value), template);
      },
      getListFormatter() {
        return {
          format(values) {
            return values.join(" | ");
          }
        };
      }
    },
    settings: {
      settings: state.settingsRegistry,
      storage: new Map([["world", state.worldSettings]]),
      register(moduleId, key, data) {
        state.registerCalls.push({ moduleId, key, data });
        state.settingsRegistry.set(`${moduleId}.${key}`, { ...data, namespace: moduleId, key });
      },
      registerMenu(moduleId, key, data) {
        state.registerMenuCalls.push({ moduleId, key, data });
      },
      get(moduleId, key) {
        return state.settingsValues.get(`${moduleId}.${key}`);
      },
      async set(moduleId, key, value) {
        state.settingWrites.push({ moduleId, key, value });
        state.settingsValues.set(`${moduleId}.${key}`, value);
        state.settingsRegistry.get(`${moduleId}.${key}`)?.onChange?.(value);
        return value;
      }
    },
    keybindings: {
      register(moduleId, key, data) {
        state.keybindingCalls.push({ moduleId, key, data });
      }
    },
    socket: {
      emit(...args) {
        state.socketEmits.push(args);
      }
    },
    modules: state.modules,
    world: state.world,
    user: {
      id: "gm-user",
      name: "Gamemaster",
      isGM: true,
      active: true,
      can(permission) {
        return permission === "SETTINGS_MODIFY" ? state.userCanManage : false;
      }
    },
    users: {
      getDesignatedUser(condition) {
        return [game.user].find(condition) ?? null;
      }
    },
    time: {
      get serverTime() {
        return state.serverTime;
      }
    }
  };

  const ui = {
    notifications: {
      info(message) {
        state.notifications.info.push(message);
      },
      warn(message) {
        state.notifications.warn.push(message);
      },
      error(message) {
        state.notifications.error.push(message);
      }
    }
  };

  const originalFetch = globalThis.fetch;
  // Language files answer with an empty object, files of the fake user data with their content.
  function fakeFetch(url) {
    const target = String(url).replace(/^\/+/, "").replace(/\?.*$/, "");
    if (state.fetchFails) return Promise.reject(new Error("network down"));
    if (state.files.has(target)) {
      const text = state.files.get(target);
      return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(text) });
    }
    if (target.includes("/storage/")) return Promise.resolve({ ok: false, status: 404, statusText: "Not Found", json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  }
  globalThis.fetch = fakeFetch;

  const document = {
    createElement() {
      const button = createButton();
      button.attributes = {};
      button.className = "";
      button.type = "";
      button.setAttribute = (name, value) => {
        button.attributes[name] = value;
      };
      return button;
    }
  };

  globalThis.CONST = {
    KEYBINDING_PRECEDENCE: {
      NORMAL: 0
    },
    PACKAGE_AVAILABILITY_CODES: PACKAGE_CODES
  };
  globalThis.CONFIG = { Setting: { documentClass: SettingDocument } };
  globalThis.Hooks = hooks;
  globalThis.foundry = foundry;
  globalThis.game = game;
  globalThis.ui = ui;
  globalThis.document = document;

  return {
    state,
    hooks,
    game,
    foundry,
    ui,
    instances,
    TestApplicationV2,
    SettingDocument,
    reset() {
      state.dialogV2Result = true;
      state.dialogV2Calls = [];
      state.dialogV2WaitResult = "ok";
      state.dialogV2WaitHandler = null;
      state.dialogV2WaitCalls = [];
      state.serverTime = null;
      game.user.isGM = true;
      game.user.active = true;
      state.fileText = "";
      state.randomIdCounter = 0;
      state.savedFiles = [];
      state.notifications.info = [];
      state.notifications.warn = [];
      state.notifications.error = [];
      state.registerCalls = [];
      state.registerMenuCalls = [];
      state.keybindingCalls = [];
      state.settingWrites = [];
      state.reloadCalls = [];
      state.reloads = 0;
      state.socketEmits = [];
      state.settingsValues = new Map();
      state.settingsRegistry = new Map();
      game.settings.settings = state.settingsRegistry;
      state.worldSettings.length = 0;
      state.settingDocumentCalls = [];
      state.files = new Map();
      state.directories = new Set(["modules/sephrals-module-loadouts"]);
      state.fileOps = [];
      state.uploadFails = false;
      state.browseFails = null;
      state.fetchFails = false;
      instances.clear();
      state.modules = new Map();
      game.modules = state.modules;
      state.world = { id: "test-world", title: "Test World" };
      game.world = state.world;
      state.userCanManage = true;
      state.lang = "en";
      state.localizations = new Map([
        ["SML.Settings.Language.Name", "Language"],
        ["SML.Settings.Language.Hint", "Language hint"],
        ["SML.Language.Default", "Follow Foundry"],
        ["SML.Language.De", "Deutsch"],
        ["SML.Language.En", "English"],
        ["SML.Scope.World", "World"],
        ["SML.Scope.Global", "Installation"],
        ["SML.Manager.AvailabilityBlocked", "blocked"],
        ["SML.Manager.AvailabilityWarning", "warning"],
        ["SML.Manager.VerifiedWarningSuffix", "verified up to {version}"],
        ["SML.Dialog.Preflight.Title", "Apply {name}"],
        ["SML.Dialog.Preflight.AutoEnable", "Auto-enable"],
        ["SML.Dialog.Preflight.DependencyWarnings", "Dependency warnings"],
        ["SML.Dialog.Preflight.CompatibilityWarnings", "Compatibility warnings"],
        ["SML.Dialog.Preflight.MissingModules", "Missing modules"],
        ["SML.Notification.ManageModulesRequired", "permission required"],
        ["SML.Notification.BlockingDependencies", "blocking {details}"],
        ["SML.Notification.NoChanges", "no changes"],
        ["SML.Notification.ProfileApplied", "applied {name}"],
        ["SML.Notification.DependencyAutoEnabled", "auto {modules}"],
        ["SML.Notification.MissingModules", "missing {modules}"],
        ["SML.Notification.ApplyWarnings", "warnings {details}"],
        ["SML.Notification.Imported", "imported {count} {added} {replaced}"],
        ["SML.Notification.ImportFailed", "import failed {message}"],
        ["SML.Notification.ProfileSaved", "saved {name}"],
        ["SML.Notification.ProfileDeleted", "deleted {name}"],
        ["SML.Notification.SaveFailed", "save failed {message}"],
        ["SML.Notification.SettingsApplied", "settings applied {count}"],
        ["SML.Export.FileName", "module-loadouts-{worldId}.json"],
        ["SML.Import.Invalid", "invalid import"],
        ["SML.Settings.Theme.Name", "Theme name"],
        ["SML.Settings.Theme.Hint", "Theme hint"],
        ["SML.Theme.Signature", "Signature"],
        ["SML.Theme.Foundry", "Foundry"],
        ["SML.Settings.Menu.Name", "Menu name"],
        ["SML.Settings.Menu.Label", "Menu label"],
        ["SML.Settings.Menu.Hint", "Menu hint"],
        ["SML.Actions.OpenManager", "Open manager"],
        ["SML.Title", "Module Loadouts"],
        ["SML.Dialog.SaveCurrent.Title", "Save current"],
        ["SML.Dialog.Edit.Title", "Edit {name}"],
        ["SML.Dialog.Duplicate.Title", "Duplicate {name}"],
        ["SML.Dialog.Duplicate.Name", "{name} Copy"],
        ["SML.Dialog.Profile.Name", "Name"],
        ["SML.Dialog.Profile.Description", "Description"],
        ["SML.Dialog.Profile.Tags", "Tags"],
        ["SML.Dialog.Profile.Scope", "Scope"],
        ["SML.Dialog.Profile.Submit", "Save"],
        ["SML.Dialog.Replace.Title", "Replace"],
        ["SML.Dialog.Replace.Content", "Replace {name}"],
        ["SML.Dialog.Delete.Title", "Delete"],
        ["SML.Dialog.Delete.Content", "Delete {name}"],
        ["SML.Manager.UpdatedAt", "Updated {updatedAt}"],
        ["SML.Manager.ModulesBadge", "Modules: {count}"],
        ["SML.Manager.SettingsBadge", "Settings: {count}"],
        ["SML.Snapshot.Name", "Before apply ({date})"],
        ["SML.Snapshot.Description", "Before {name}"],
        ["SML.Notification.SnapshotSaved", "snapshot {name}"],
        ["SML.Notification.ProfileNotFound", "not found {name}"],
        ["SML.Notification.NameRequired", "name required"],
        ["SML.Dialog.ConfirmApply.Enable", "Enable:"],
        ["SML.Dialog.ConfirmApply.Disable", "Disable:"],
        ["SML.Dialog.ConfirmApply.Pinned", "Pinned:"],
        ["SML.Dialog.ConfirmApply.Settings", "Settings ({count}):"],
        ["SML.Dialog.ConfirmApply.ChangedVersions", "Updated:"],
        ["SML.Installation.Unavailable", "installation unavailable"],
        ["SML.Installation.WriteFailed", "installation write failed"],
        ["SML.Installation.Migrated", "migrated {count}"],
        ["SML.LoadoutSettings.DefaultValue", "default"]
      ]);
      globalThis.fetch = fakeFetch;
    },
    addModule(id, overrides = {}) {
      const record = createModuleRecord(id, overrides);
      state.modules.set(id, record);
      return record;
    },
    // A registered setting of another module, as game.settings.register leaves it.
    registerSetting(namespace, key, config = {}) {
      const data = { scope: "world", config: true, default: null, ...config, namespace, key };
      state.settingsRegistry.set(`${namespace}.${key}`, data);
      return data;
    },
    setWorldSetting(key, value) {
      const existing = state.worldSettings.getSetting(key);
      if (existing) {
        existing._source.value = JSON.stringify(value);
        return existing;
      }
      return state.worldSettings.add(key, value);
    },
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}
