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
    relationships: {
      requires: Array.from(overrides.relationships?.requires ?? [])
    },
    ...overrides
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
    root
  };
}

export function createDialogHtml(values = {}) {
  return {
    find(selector) {
      const match = /(?:input|select)\[name="([^"]+)"\]/.exec(selector);
      const name = match?.[1] ?? selector;
      return {
        val: () => values[name]
      };
    }
  };
}

export async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
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
    },
    async trigger(event, ...args) {
      for (const handler of onceHandlers.get(event) ?? []) await handler(...args);
      for (const handler of onHandlers.get(event) ?? []) await handler(...args);
    }
  };
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
    promptValues: null,
    confirmResult: true,
    fileText: "",
    randomIdCounter: 0,
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
    settingsValues: new Map(),
    settingsRegistry: new Map(),
    modules: new Map(),
    world: { id: "test-world", title: "Test World" },
    userCanManage: true,
    lang: "en",
    localizations: new Map()
  };

  const hooks = createHooksStub();

  class TestFormApplication {
    constructor() {
      this.options = {};
      this.renderCalls = [];
      this.element = [createThemeHost()];
    }

    static get defaultOptions() {
      return { base: true, classes: ["base-form"] };
    }

    render(force) {
      this.renderCalls.push(force);
      return this;
    }

    async close(options = {}) {
      this.closedWith = options;
      return { closed: true, options };
    }

    async _render(force, options) {
      this.lastSuperRender = { force, options };
    }

    activateListeners(html) {
      this.lastActivatedHtml = html;
    }
  }

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
      }
    },
    applications: {
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
      register(moduleId, key, data) {
        state.registerCalls.push({ moduleId, key, data });
        state.settingsRegistry.set(`${moduleId}.${key}`, data);
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
        return value;
      }
    },
    keybindings: {
      register(moduleId, key, data) {
        state.keybindingCalls.push({ moduleId, key, data });
      }
    },
    modules: state.modules,
    world: state.world,
    user: {
      can(permission) {
        return permission === "SETTINGS_MODIFY" ? state.userCanManage : false;
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

  const Dialog = {
    async confirm(options) {
      state.lastConfirmOptions = options;
      return state.confirmResult;
    },
    async prompt(options) {
      state.lastPromptOptions = options;
      return options.callback(createDialogHtml(state.promptValues ?? {}));
    }
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

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
  globalThis.Hooks = hooks;
  globalThis.FormApplication = TestFormApplication;
  globalThis.foundry = foundry;
  globalThis.game = game;
  globalThis.ui = ui;
  globalThis.Dialog = Dialog;
  globalThis.document = document;

  return {
    state,
    hooks,
    game,
    foundry,
    ui,
    Dialog,
    TestFormApplication,
    reset() {
      state.promptValues = null;
      state.confirmResult = true;
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
      state.lastConfirmOptions = null;
      state.lastPromptOptions = null;
      state.settingsValues = new Map();
      state.settingsRegistry = new Map();
      game.settings.settings = state.settingsRegistry;
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
        ["SML.Dialog.Profile.Name", "Name"],
        ["SML.Dialog.Profile.Description", "Description"],
        ["SML.Dialog.Profile.Tags", "Tags"],
        ["SML.Dialog.Profile.Scope", "Scope"],
        ["SML.Dialog.Profile.Submit", "Save"],
        ["SML.Dialog.Replace.Title", "Replace"],
        ["SML.Dialog.Replace.Content", "Replace {name}"],
        ["SML.Dialog.Delete.Title", "Delete"],
        ["SML.Dialog.Delete.Content", "Delete {name}"],
        ["SML.Manager.UpdatedAt", "Updated {updatedAt}"]
      ]);
      globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });
    },
    addModule(id, overrides = {}) {
      const record = createModuleRecord(id, overrides);
      state.modules.set(id, record);
      return record;
    },
    restore() {
      globalThis.fetch = originalFetch;
    }
  };
}