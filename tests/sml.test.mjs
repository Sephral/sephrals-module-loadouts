import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createButton,
  createTestEnvironment,
  createThemeHost,
  flushPromises,
  modulePath
} from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));

function setStore(scope, profiles = []) {
  env.state.settingsValues.set(`sephrals-module-loadouts.${scope}`, {
    version: __test__.STORAGE_VERSION,
    profiles
  });
}

function createProfile(overrides = {}) {
  return __test__.normalizeProfile({
    id: overrides.id ?? "profile-1",
    name: overrides.name ?? "Alpha",
    description: overrides.description ?? "",
    tags: overrides.tags ?? ["tag"],
    scope: overrides.scope ?? __test__.PROFILE_SCOPES.WORLD,
    moduleIds: overrides.moduleIds ?? ["module-a"],
    createdAt: overrides.createdAt ?? "2024-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2024-01-02T00:00:00.000Z",
    auto: overrides.auto
  }, overrides.scope ?? __test__.PROFILE_SCOPES.WORLD);
}

function createSnapshot(id, createdAt, tags = [__test__.AUTO_SNAPSHOT_TAG]) {
  return createProfile({ id, name: `Snapshot ${id}`, tags, createdAt, updatedAt: createdAt, auto: true });
}

function getAutoSnapshots() {
  return __test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.filter((profile) => profile.auto === true);
}

function createFilterHtml(profileIds, tags) {
  const chips = tags.map((tag) => {
    const chip = Object.assign(createButton({ tag }), { attributes: {}, classes: new Set() });
    chip.classList = { toggle: (token, force) => (force ? chip.classes.add(token) : chip.classes.delete(token)) };
    chip.setAttribute = (name, value) => {
      chip.attributes[name] = value;
    };
    return chip;
  });
  const cards = profileIds.map((profileId) => ({ dataset: { profileId }, hidden: false }));
  const search = Object.assign(createButton(), { value: "" });
  const details = Object.assign(createButton({ profileId: profileIds[0] }), { open: false });
  const empty = { hidden: true };
  const root = {
    dataset: {},
    querySelector(selector) {
      return {
        '[data-action="filter-search"]': search,
        ".sml-filter-empty": empty
      }[selector] ?? null;
    },
    querySelectorAll(selector) {
      return {
        ".sml-profile-card": cards,
        '[data-action="filter-tag"]': chips,
        ".sml-profile-details": [details]
      }[selector] ?? [];
    }
  };

  return { html: [root], cards, chips, search, details, empty };
}

function createManagerHtml() {
  const saveCurrent = createButton();
  const exportProfiles = createButton();
  const importProfiles = createButton();
  const importFile = createButton();
  const applyButtons = [createButton({ profileId: "profile-1" })];
  const editButtons = [createButton({ profileId: "profile-1" })];
  const duplicateButtons = [createButton({ profileId: "profile-1" })];
  const deleteButtons = [createButton({ profileId: "profile-1" })];

  importFile.files = [{ name: "profiles.json" }];
  importFile.value = "profiles.json";
  importFile.clickCount = 0;
  importFile.click = () => {
    importFile.clickCount += 1;
  };

  const root = {
    dataset: { uiTheme: __test__.UI_THEMES.FOUNDRY },
    querySelector(selector) {
      return {
        '[data-action="save-current"]': saveCurrent,
        '[data-action="export-profiles"]': exportProfiles,
        '[data-action="import-profiles"]': importProfiles,
        '[data-action="import-file"]': importFile
      }[selector] ?? null;
    },
    querySelectorAll(selector) {
      return {
        '[data-action="apply-profile"]': applyButtons,
        '[data-action="edit-profile"]': editButtons,
        '[data-action="duplicate-profile"]': duplicateButtons,
        '[data-action="delete-profile"]': deleteButtons
      }[selector] ?? [];
    }
  };

  return {
    html: [root],
    controls: {
      saveCurrent,
      exportProfiles,
      importProfiles,
      importFile,
      applyButton: applyButtons[0],
      editButton: editButtons[0],
      duplicateButton: duplicateButtons[0],
      deleteButton: deleteButtons[0]
    }
  };
}

test.beforeEach(() => {
  env.reset();
  __test__.resetModuleTranslations();
  env.addModule(__test__.MODULE_ID, { title: "Sephral's Module Loadouts" });
  env.addModule("module-a", { title: "Alpha" });
  env.addModule("module-b", { title: "Beta" });
  env.addModule("module-c", { title: "Gamma" });
  env.state.settingsValues.set("core.moduleConfiguration", {
    "sephrals-module-loadouts": true,
    "module-a": true,
    "module-c": true
  });
  setStore(__test__.WORLD_PROFILES_SETTING, []);
  setStore(__test__.GLOBAL_PROFILES_SETTING, []);
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_THEME_SETTING}`, __test__.UI_THEMES.SIGNATURE);
});

test.after(() => {
  env.restore();
});

test("registers settings, menu, keybinding, and ready API", async () => {
  await env.hooks.trigger("init");
  assert.equal(env.state.registerCalls.length, 4);
  const languageSetting = env.state.registerCalls.find((entry) => entry.key === __test__.UI_LANGUAGE_SETTING);
  assert.deepEqual(languageSetting.data.choices, {
    default: "Follow Foundry",
    de: "Deutsch",
    en: "English"
  });
  assert.equal(env.state.registerMenuCalls.length, 1);
  assert.equal(env.state.keybindingCalls.length, 1);
  assert.equal(env.state.keybindingCalls[0].data.restricted, true);

  const keybindingResult = env.state.keybindingCalls[0].data.onDown();
  assert.equal(keybindingResult, true);

  await env.hooks.trigger("ready");
  const api = env.game.modules.get(__test__.MODULE_ID).api;
  assert.deepEqual(Object.keys(api).sort(), ["apply", "compare", "getProfiles", "openManager", "saveCurrent"]);
  assert.equal(Object.values(api).every((entry) => typeof entry === "function"), true);

  const manager = api.openManager();
  assert.equal(manager.renderCalls.at(-1), true);
  await manager.close();

  env.state.modules.delete(__test__.MODULE_ID);
  await env.hooks.trigger("ready");
});

test("language helpers load overrides and rerender the open manager", async () => {
  await env.hooks.trigger("init");

  globalThis.fetch = async (url) => ({
    ok: true,
    async json() {
      const language = /\/(en|de)\.json$/.exec(String(url))?.[1];
      if (language === "de") {
        return {
          "SML.Title": "Modul-Loadouts",
          "SML.Settings.Menu.Label": "Manager öffnen"
        };
      }

      return {
        "SML.Title": "Module Loadouts",
        "SML.Settings.Menu.Label": "Open Loadout Manager"
      };
    }
  });

  assert.equal(__test__.normalizeUiLanguage("de-DE"), "de");
  assert.equal(__test__.normalizeUiLanguage("en_US"), "en");
  assert.equal(__test__.normalizeUiLanguage("fr"), "en");

  env.state.settingsRegistry.set(`sephrals-module-loadouts.${__test__.UI_LANGUAGE_SETTING}`, {});
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_LANGUAGE_SETTING}`, "default");
  env.state.lang = "de-DE";
  assert.equal(__test__.getModuleLanguage(), "de");

  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_LANGUAGE_SETTING}`, "en");
  assert.equal(__test__.getModuleLanguage(), "en");

  const manager = __test__.openManager();
  const baselineRenderCount = manager.renderCalls.length;
  const languageSetting = env.state.registerCalls.find((entry) => entry.key === __test__.UI_LANGUAGE_SETTING);

  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_LANGUAGE_SETTING}`, "de");
  languageSetting.data.onChange("de");
  await flushPromises();

  assert.equal(manager.options.title, "Modul-Loadouts");
  assert.equal(__test__.localize("SML.Settings.Menu.Label"), "Manager öffnen");
  assert.equal(manager.renderCalls.length, baselineRenderCount + 1);

  // "Follow Foundry" with a language the module does not bundle uses Foundry's (community) translation.
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_LANGUAGE_SETTING}`, "default");
  env.state.lang = "fr";
  env.state.localizations.set("SML.Settings.Menu.Label", "Ouvrir le gestionnaire");
  assert.equal(__test__.getOverrideLanguage(), null);
  assert.equal(__test__.localize("SML.Settings.Menu.Label"), "Ouvrir le gestionnaire");
  assert.equal(__test__.getSortLanguage(), "fr");
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_LANGUAGE_SETTING}`, "en");
  assert.equal(__test__.localize("SML.Settings.Menu.Label"), "Open Loadout Manager");
  assert.equal(__test__.getSortLanguage(), "en");

  await manager.close();
});

test("localization and theme helpers handle missing settings and theme toggles", () => {
  assert.deepEqual(__test__.defaultStore(), { version: 2, profiles: [] });
  assert.equal(__test__.localize("SML.Scope.World"), "World");
  assert.equal(__test__.localize("SML.Manager.UpdatedAt", { updatedAt: "now" }), "Updated now");
  assert.equal(__test__.getRegisteredSettingValue(__test__.UI_THEME_SETTING, "fallback"), "fallback");

  env.game.settings.settings.set(`sephrals-module-loadouts.${__test__.UI_THEME_SETTING}`, {});
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_THEME_SETTING}`, __test__.UI_THEMES.FOUNDRY);
  assert.equal(__test__.getThemePreference(), __test__.UI_THEMES.FOUNDRY);
  assert.equal(__test__.normalizeTheme("other"), __test__.UI_THEMES.SIGNATURE);

  const originalGet = env.game.settings.get;
  env.game.settings.get = () => {
    throw new Error("boom");
  };
  assert.equal(__test__.getRegisteredSettingValue(__test__.UI_THEME_SETTING, "fallback"), "fallback");
  env.game.settings.get = originalGet;

  const host = createThemeHost();
  __test__.applyManagerTheme(host, __test__.UI_THEMES.FOUNDRY);
  assert.equal(host.dataset.uiTheme, __test__.UI_THEMES.FOUNDRY);
  assert.equal(host.classList.contains("is-theme-foundry"), true);
  assert.equal(host.root.dataset.uiTheme, __test__.UI_THEMES.FOUNDRY);
});

test("injects the module management launcher only once and wires the click", async () => {
  await env.hooks.trigger("init");
  let insertedButton = null;
  const closeButton = { marker: "close" };
  const header = {
    querySelector(selector) {
      return selector === '[data-action="close"]' ? closeButton : null;
    },
    insertBefore(button, sibling) {
      insertedButton = { button, sibling };
    },
    append(button) {
      insertedButton = { button, sibling: null };
    }
  };
  const windowRoot = {
    buttonExists: false,
    querySelector(selector) {
      if (selector === ".sml-module-management-link") return this.buttonExists ? {} : null;
      if (selector === ".window-header") return header;
      return null;
    }
  };
  const contentRoot = {
    closest() {
      return windowRoot;
    }
  };

  await env.hooks.trigger("renderModuleManagement", {}, [contentRoot]);
  assert.equal(insertedButton.sibling, closeButton);
  insertedButton.button.click();
  await flushPromises();
  const manager = __test__.openManager();
  assert.equal(manager.renderCalls.length >= 1, true);
  await manager.close();

  windowRoot.buttonExists = true;
  insertedButton = null;
  __test__.injectModuleManagementLauncher({}, [contentRoot]);
  assert.equal(insertedButton, null);

  const appendHeader = {
    querySelector() {
      return null;
    },
    insertBefore() {
      throw new Error("should not insert before without close button");
    },
    append(button) {
      insertedButton = { button, sibling: null };
    }
  };
  const appendRoot = {
    querySelector(selector) {
      if (selector === ".sml-module-management-link") return null;
      if (selector === ".window-header") return appendHeader;
      return null;
    }
  };
  __test__.injectModuleManagementLauncher({}, { closest: () => appendRoot });
  assert.equal(insertedButton.sibling, null);
});

test("profile normalization and store helpers cover aliases, tags, scope, and persistence", async () => {
  const normalized = __test__.normalizeProfile({
    id: null,
    name: "  Mixed  ",
    description: "  desc  ",
    tags: "beta, alpha, beta",
    scope: "unknown",
    modules: ["module-b", "module-a", "module-a"]
  }, __test__.PROFILE_SCOPES.GLOBAL);

  assert.equal(normalized.name, "Mixed");
  assert.equal(normalized.description, "desc");
  assert.deepEqual(normalized.tags, ["alpha", "beta"]);
  assert.deepEqual(normalized.moduleIds, ["module-a", "module-b"]);
  assert.equal(normalized.scope, __test__.PROFILE_SCOPES.GLOBAL);
  assert.equal(__test__.normalizeProfile({ name: "   " }), null);

  const legacyStore = __test__.normalizeProfilesStore({
    version: 1,
    profiles: [{ name: "One", modules: ["module-a"], scope: __test__.PROFILE_SCOPES.WORLD }, null]
  }, __test__.PROFILE_SCOPES.WORLD);
  assert.equal(legacyStore.version, 1);
  assert.equal(legacyStore.profiles.length, 1);

  await __test__.saveProfilesForScope(__test__.PROFILE_SCOPES.WORLD, [normalized]);
  assert.equal(env.state.settingWrites.at(-1).key, __test__.WORLD_PROFILES_SETTING);

  await __test__.upsertProfile({ ...normalized, scope: __test__.PROFILE_SCOPES.WORLD });
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.length, 1);
  assert.equal(__test__.findProfileById(normalized.id).name, "Mixed");

  await __test__.removeProfile({ ...normalized, scope: __test__.PROFILE_SCOPES.WORLD });
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.length, 0);

  const currentProfile = __test__.createCurrentProfile({ name: "Snapshot", scope: __test__.PROFILE_SCOPES.WORLD });
  assert.deepEqual(currentProfile.moduleIds, ["module-a", "module-c", "sephrals-module-loadouts"]);
});

test("comparison, presentation, and preflight logic resolve dependencies and warnings", () => {
  env.addModule("module-d", {
    title: "Delta",
    relationships: {
      requires: [
        { id: "module-b", type: "module", compatibility: { verified: "1.2.0" } },
        { id: "module-e", type: "module" }
      ]
    }
  });
  env.addModule("module-e", {
    title: "Echo",
    availability: CONST.PACKAGE_AVAILABILITY_CODES.UNVERIFIED_BUILD,
    availabilityLabel: "needs testing"
  });

  const comparison = __test__.buildComparison(createProfile({ moduleIds: ["module-a", "module-b", "missing-module"] }));
  assert.deepEqual(comparison.matches, ["module-a"]);
  assert.deepEqual(comparison.toEnable, ["module-b"]);
  assert.deepEqual(comparison.toDisable, ["module-c"]);
  assert.deepEqual(comparison.missing, ["missing-module"]);
  assert.equal(__test__.asTitleList([]), "-");
  assert.equal(__test__.asTagList(["one", "two"]), "one, two");

  const blockingState = __test__.getModuleCompatibilityState({ availability: CONST.PACKAGE_AVAILABILITY_CODES.REQUIRES_SYSTEM, availabilityLabel: "blocked" });
  assert.equal(blockingState.blocking, true);
  const warningState = __test__.getModuleCompatibilityState({ availability: CONST.PACKAGE_AVAILABILITY_CODES.UNVERIFIED_BUILD, availabilityLabel: "warn" });
  assert.equal(warningState.warning, true);

  const preflight = __test__.collectProfilePreflight(createProfile({ name: "Delta", moduleIds: ["module-d", "missing-module"] }));
  assert.equal(preflight.desiredIds.has(__test__.MODULE_ID), true);
  assert.equal(preflight.desiredIds.has("module-b"), true);
  assert.equal(preflight.missingModules.includes("missing-module"), true);
  assert.equal(preflight.autoEnabledTitles.has("Beta"), true);
  assert.equal(preflight.compatibilityWarnings.some((entry) => entry.includes("Echo")), true);

  const presented = __test__.presentProfile(createProfile({ name: "Presented", moduleIds: ["module-a", "module-b"] }));
  assert.equal(presented.scopeLabel, "World");
  assert.equal(presented.tagsLabel, "tag");
  assert.equal(presented.moduleCount, 2);
  assert.equal(typeof presented.updatedAtLabel, "string");
  assert.equal(__test__.formatModuleList(["module-a", "module-b"]), "Alpha | Beta");

  env.addModule("module-limit", {
    title: "Limiter",
    relationships: {
      requires: [
        { id: "module-min", type: "module", compatibility: { minimum: "2.0.0" } },
        { id: "module-max", type: "module", compatibility: { maximum: "1.0.0" } },
        { id: "module-verified", type: "module", compatibility: { verified: "2.0.0" } },
        { id: "module-verified-old", type: "module", compatibility: { verified: "2.0.0" } },
        { id: "module-verified-new", type: "module", compatibility: { verified: "2.0.0" } },
        { id: "module-missing", type: "module" },
        { id: "skip-system", type: "system" }
      ]
    }
  });
  env.addModule("module-min", { title: "Min", version: "1.0.0" });
  env.addModule("module-max", { title: "Max", version: "2.0.0" });
  env.addModule("module-verified", { title: "Verified", version: "2.0.0" });
  env.addModule("module-verified-old", { title: "Verified Old", version: "1.5.0" });
  env.addModule("module-verified-new", { title: "Verified New", version: "2.1.0" });
  env.addModule("module-blocking-dep", {
    title: "Blocking Dependency",
    availability: CONST.PACKAGE_AVAILABILITY_CODES.REQUIRES_SYSTEM,
    availabilityLabel: "requires system"
  });
  env.state.modules.get("module-limit").relationships.requires.push({ id: "module-blocking-dep", type: "module" });

  const desiredIds = new Set(["module-limit"]);
  const autoEnabledTitles = new Set();
  const blockingDetails = [];
  const warningDetails = [];
  const compatibilityWarnings = [];
  __test__.resolveRequiredModules("module-limit", desiredIds, autoEnabledTitles, blockingDetails, warningDetails, compatibilityWarnings);
  assert.equal(blockingDetails.some((entry) => entry.includes("module-missing")), true);
  assert.equal(blockingDetails.some((entry) => entry.includes(">= 2.0.0")), true);
  assert.equal(blockingDetails.some((entry) => entry.includes("<= 1.0.0")), true);
  assert.equal(blockingDetails.some((entry) => entry.includes("Blocking Dependency: requires system")), true);
  // Only a dependency newer than the verified version warns.
  const verifiedWarnings = warningDetails.filter((entry) => entry.includes("verified up to 2.0.0"));
  assert.equal(verifiedWarnings.length, 1);
  assert.match(verifiedWarnings[0], /^Limiter -> Verified New /);
});

test("confirm and apply profile handle permission, blocking, no-change, and success paths", async () => {
  assert.equal(await __test__.confirmProfileApplication(createProfile({ name: "Clean" }), {
    autoEnabledTitles: new Set(),
    warningDetails: [],
    compatibilityWarnings: [],
    missingModules: []
  }), true);

  env.state.confirmResult = false;
  const confirmResult = await __test__.confirmProfileApplication(createProfile({ name: "Warn" }), {
    autoEnabledTitles: new Set(["Beta"]),
    warningDetails: ["warning one"],
    compatibilityWarnings: ["compat two"],
    missingModules: ["missing-module"]
  });
  assert.equal(confirmResult, false);
  assert.match(env.state.lastConfirmOptions.content, /Auto-enable/);

  env.state.userCanManage = false;
  await __test__.applyProfile(createProfile({ name: "Blocked" }));
  assert.deepEqual(env.state.notifications.error, ["permission required"]);

  env.state.userCanManage = true;
  env.addModule("module-blocked", {
    title: "Blocked",
    availability: CONST.PACKAGE_AVAILABILITY_CODES.REQUIRES_SYSTEM,
    availabilityLabel: "requires system"
  });
  await __test__.applyProfile(createProfile({ name: "Blocked", moduleIds: ["module-blocked"] }));
  assert.match(env.state.notifications.error.at(-1), /blocking/);

  env.state.confirmResult = false;
  await __test__.applyProfile(createProfile({ name: "Cancelled", moduleIds: ["missing-module"] }));
  assert.equal(env.state.settingWrites.some((entry) => entry.moduleId === "core"), false);

  env.state.confirmResult = true;
  env.state.settingsValues.set("core.moduleConfiguration", {
    "sephrals-module-loadouts": true,
    "module-a": true
  });
  await __test__.applyProfile(createProfile({ name: "No Change", moduleIds: ["module-a", "sephrals-module-loadouts"] }));
  assert.equal(env.state.notifications.info.includes("no changes"), true);

  env.addModule("module-d", {
    title: "Delta",
    relationships: {
      requires: [{ id: "module-b", type: "module", compatibility: { verified: "2.0.0" } }]
    }
  });
  env.state.settingsValues.set("core.moduleConfiguration", {
    "sephrals-module-loadouts": true,
    "module-a": true,
    "module-c": true
  });
  await __test__.applyProfile(createProfile({ name: "Deploy", moduleIds: ["module-d", "missing-module"] }));
  assert.deepEqual(env.state.reloadCalls, [{ world: true }]);
  assert.equal(env.state.settingWrites.at(-1).moduleId, "core");
  assert.equal(env.state.notifications.info.some((entry) => entry.includes("Deploy")), true);
  assert.equal(env.state.notifications.warn.length >= 1, true);
});

test("apply profile treats removal-only changes as changes even if diffObject misses deletions", async () => {
  const originalDiffObject = env.foundry.utils.diffObject;
  env.foundry.utils.diffObject = (left, right) => {
    const addedOrChanged = Object.entries(right).some(([key, value]) => left[key] !== value);
    return addedOrChanged ? { changed: true } : {};
  };

  env.state.settingsValues.set("core.moduleConfiguration", {
    "sephrals-module-loadouts": true,
    "module-a": true,
    "module-b": true,
    "module-c": true
  });

  try {
    await __test__.applyProfile(createProfile({ name: "Trim", moduleIds: ["module-a"] }));
  } finally {
    env.foundry.utils.diffObject = originalDiffObject;
  }

  assert.deepEqual(env.state.reloadCalls, [{ world: true }]);
  assert.equal(env.state.settingWrites.at(-1).moduleId, "core");
  assert.deepEqual(env.state.settingWrites.at(-1).value, {
    "sephrals-module-loadouts": true,
    "module-a": true
  });
  assert.equal(env.state.notifications.info.includes("no changes"), false);
  assert.equal(env.state.notifications.info.some((entry) => entry.includes("Trim")), true);
});

test("exports and imports profiles, including replacement and explicit world scopes", async () => {
  setStore(__test__.WORLD_PROFILES_SETTING, [createProfile({ id: "w1", name: "World", scope: __test__.PROFILE_SCOPES.WORLD })]);
  setStore(__test__.GLOBAL_PROFILES_SETTING, [createProfile({ id: "g1", name: "Global", scope: __test__.PROFILE_SCOPES.GLOBAL })]);

  __test__.exportProfiles();
  assert.equal(env.state.savedFiles.length, 1);
  const exportPayload = JSON.parse(env.state.savedFiles[0].data);
  assert.equal(exportPayload.profiles.length, 2);
  assert.equal(env.state.savedFiles[0].filename, "module-loadouts-test-world.json");

  await assert.rejects(() => __test__.importProfilesFromFile({ name: "bad.json" }), /invalid import/);

  env.state.fileText = JSON.stringify({
    profiles: [
      { id: "w1", name: "World", scope: __test__.PROFILE_SCOPES.WORLD, moduleIds: ["module-b"] },
      { id: "g2", name: "Added", scope: __test__.PROFILE_SCOPES.GLOBAL, moduleIds: ["module-c"] }
    ]
  });
  await __test__.importProfilesFromFile({ name: "good.json" });
  const worldProfiles = __test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles;
  const globalProfiles = __test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles;
  assert.deepEqual(worldProfiles.map((profile) => profile.id), ["w1"]);
  assert.deepEqual(globalProfiles.map((profile) => profile.id).sort(), ["g1", "g2"]);
  assert.equal(worldProfiles[0].scope, __test__.PROFILE_SCOPES.WORLD);
  assert.equal(env.state.notifications.info.at(-1), "imported 2 1 1");
});

test("settings menu and manager lifecycle expose the expected UI behavior", async () => {
  const manager = new __test__.SMLLoadoutsManager();
  const settingsMenu = new __test__.SMLSettingsMenu();
  const returnedMenu = settingsMenu.render();
  assert.equal(returnedMenu, settingsMenu);

  const defaultOptions = __test__.SMLLoadoutsManager.defaultOptions;
  assert.equal(defaultOptions.id, __test__.MODULE_ID);
  assert.equal(defaultOptions.template.includes("loadouts-manager.html"), true);
  assert.equal(defaultOptions.classes.includes("sml-window"), true);

  setStore(__test__.WORLD_PROFILES_SETTING, [createProfile({ id: "w1", name: "World One", scope: __test__.PROFILE_SCOPES.WORLD })]);
  setStore(__test__.GLOBAL_PROFILES_SETTING, [createProfile({ id: "g1", name: "Global One", scope: __test__.PROFILE_SCOPES.GLOBAL })]);
  const data = manager.getData();
  assert.equal(data.hasProfiles, true);
  assert.equal(data.globalCount, 1);
  assert.equal(data.worldCount, 1);
  assert.equal(data.strings.title, "Module Loadouts");

  manager.element = [createThemeHost()];
  await manager._render(true, { test: true });
  assert.equal(manager.element[0].dataset.uiTheme, __test__.UI_THEMES.SIGNATURE);

  const firstManager = __test__.openManager();
  await firstManager.close();
  const secondManager = __test__.openManager();
  assert.notEqual(firstManager, secondManager);
  await secondManager.close();
});

test("manager template is driven by prelocalized strings", () => {
  const template = readFileSync(new URL(modulePath("templates/loadouts-manager.html")), "utf8");

  assert.equal(template.includes("{{localize \"SML."), false);
  assert.equal(typeof __test__.getManagerTemplateStrings, "function");
  assert.equal(__test__.getManagerTemplateStrings({
    worldName: "Test World",
    currentActiveCount: 6,
    worldCount: 1,
    globalCount: 0
  }).title, "Module Loadouts");
});

test("manager listeners exercise save, export, import, edit, duplicate, apply, and delete flows", async () => {
  const profile = createProfile({ id: "profile-1", name: "Original", moduleIds: ["module-a"] });
  setStore(__test__.WORLD_PROFILES_SETTING, [profile]);

  const manager = new __test__.SMLLoadoutsManager();
  manager.element = [createThemeHost()];
  const { html, controls } = createManagerHtml();

  env.state.promptValues = {
    profileName: "Saved Profile",
    profileDescription: "Snapshot",
    profileTags: "live, prep",
    profileScope: __test__.PROFILE_SCOPES.WORLD
  };
  env.state.fileText = JSON.stringify({
    profiles: [{ id: "imported", name: "Imported", scope: __test__.PROFILE_SCOPES.GLOBAL, moduleIds: ["module-b"] }]
  });

  manager.activateListeners(html);

  controls.saveCurrent.click();
  await flushPromises();
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.some((entry) => entry.name === "Saved Profile"), true);

  controls.exportProfiles.click();
  assert.equal(env.state.savedFiles.length >= 1, true);

  controls.importProfiles.click();
  assert.equal(controls.importFile.clickCount, 1);

  controls.importFile.dispatch("change", { currentTarget: controls.importFile });
  await flushPromises();
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles.some((entry) => entry.id === "imported"), true);
  assert.equal(controls.importFile.value, "");

  env.state.promptValues = {
    profileName: "Edited Profile",
    profileDescription: "Changed",
    profileTags: "alpha",
    profileScope: __test__.PROFILE_SCOPES.GLOBAL
  };
  controls.editButton.click();
  await flushPromises();
  assert.equal(__test__.findProfileById("profile-1").scope, __test__.PROFILE_SCOPES.GLOBAL);

  env.state.promptValues = {
    profileName: "Duplicate Profile",
    profileDescription: "Copy",
    profileTags: "copy",
    profileScope: __test__.PROFILE_SCOPES.WORLD
  };
  controls.duplicateButton.click();
  await flushPromises();
  assert.equal(__test__.getAllProfiles().some((entry) => entry.name === "Duplicate Profile"), true);

  env.state.confirmResult = true;
  controls.applyButton.click();
  await flushPromises();
  assert.equal(env.state.settingWrites.some((entry) => entry.moduleId === "core"), true);

  controls.deleteButton.click();
  await flushPromises();
  assert.equal(__test__.findProfileById("profile-1"), null);
});

test("manager listener abort and error branches are handled", async () => {
  const existing = createProfile({ id: "profile-1", name: "Original", moduleIds: ["module-a"] });
  setStore(__test__.WORLD_PROFILES_SETTING, [existing]);

  const manager = new __test__.SMLLoadoutsManager();
  manager.element = [createThemeHost()];
  const { html, controls } = createManagerHtml();
  manager.activateListeners(html);

  env.state.promptValues = {
    profileName: "Original",
    profileDescription: "Same",
    profileTags: "same",
    profileScope: __test__.PROFILE_SCOPES.WORLD
  };
  env.state.confirmResult = false;
  controls.saveCurrent.click();
  await flushPromises();
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.length, 1);

  controls.importFile.files = [{ name: "broken.json" }];
  controls.importFile.value = "broken.json";
  env.state.fileText = "{";
  controls.importFile.dispatch("change", { currentTarget: controls.importFile });
  await flushPromises();
  assert.equal(env.state.notifications.error.at(-1), "import failed invalid import");
  assert.equal(controls.importFile.value, "");
});
test("auto snapshot helpers keep the newest three and turn into regular profiles on edit", () => {
  const profiles = [
    createProfile({ id: "r1", name: "Regular" }),
    createSnapshot("s1", "2026-01-01T00:00:00.000Z"),
    createSnapshot("s2", "2026-01-03T00:00:00.000Z"),
    createSnapshot("s3", "2026-01-02T00:00:00.000Z"),
    createSnapshot("s4", "2026-01-05T00:00:00.000Z"),
    createSnapshot("s5", "2026-01-04T00:00:00.000Z")
  ];
  assert.equal(__test__.MAX_AUTO_SNAPSHOTS, 3);
  assert.deepEqual(__test__.pruneAutoSnapshots(profiles).map((profile) => profile.id), ["r1", "s2", "s4", "s5"]);
  assert.deepEqual(__test__.pruneAutoSnapshots(profiles, 1).map((profile) => profile.id), ["r1", "s4"]);

  // Equal timestamps: the later list entry is the newer snapshot.
  const tied = ["t1", "t2", "t3", "t4"].map((id) => createSnapshot(id, "2026-01-01T00:00:00.000Z"));
  assert.deepEqual(__test__.pruneAutoSnapshots(tied).map((profile) => profile.id), ["t2", "t3", "t4"]);

  assert.equal(__test__.normalizeProfile({ name: "Flag", auto: true }).auto, true);
  assert.equal("auto" in __test__.normalizeProfile({ name: "Plain", auto: "yes" }), false);

  const regular = __test__.asRegularProfile(createSnapshot("s9", "2026-01-01T00:00:00.000Z", ["auto", "keep"]));
  assert.equal("auto" in regular, false);
  assert.deepEqual(regular.tags, ["keep"]);
  const plain = createProfile();
  assert.equal(__test__.asRegularProfile(plain), plain);

  const sorted = __test__.sortProfilesForDisplay([
    createSnapshot("old", "2026-01-01T00:00:00.000Z"),
    createProfile({ id: "z", name: "Zeta" }),
    createSnapshot("new", "2026-02-01T00:00:00.000Z"),
    createProfile({ id: "a", name: "alpha" })
  ]);
  assert.deepEqual(sorted.map((profile) => profile.id), ["a", "z", "new", "old"]);

  assert.equal(typeof __test__.formatSnapshotDate(new Date("2026-10-12T10:00:00.000Z")), "string");
  env.state.lang = "not a locale!";
  assert.equal(__test__.formatSnapshotDate(new Date("2026-10-12T10:00:00.000Z")), "2026-10-12T10:00:00.000Z");
});

test("applying a profile saves an undo snapshot first and keeps at most three", async () => {
  const prep = createProfile({ id: "prep", name: "Prep", moduleIds: ["module-b"] });
  const live = createProfile({ id: "live", name: "Live", moduleIds: ["module-a", "module-c"] });
  setStore(__test__.WORLD_PROFILES_SETTING, [prep, live]);

  assert.equal(await __test__.applyProfile(prep), true);
  assert.deepEqual(env.state.settingWrites.map((entry) => entry.moduleId === "core" ? "core" : entry.key), [__test__.WORLD_PROFILES_SETTING, "core"]);

  let snapshots = getAutoSnapshots();
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].moduleIds, ["module-a", "module-c", __test__.MODULE_ID]);
  assert.deepEqual(snapshots[0].tags, [__test__.AUTO_SNAPSHOT_TAG]);
  assert.equal(snapshots[0].scope, __test__.PROFILE_SCOPES.WORLD);
  assert.match(snapshots[0].name, /^Before apply \(.+\)$/);
  assert.equal(snapshots[0].description, "Before Prep");
  assert.equal(env.state.notifications.info.includes(`snapshot ${snapshots[0].name}`), true);

  // Undo: applying the snapshot restores the old state and stores the next snapshot.
  assert.equal(await __test__.applyProfile(snapshots[0]), true);
  assert.deepEqual(env.state.settingsValues.get("core.moduleConfiguration"), {
    "module-a": true,
    "module-c": true,
    "sephrals-module-loadouts": true
  });
  assert.equal(getAutoSnapshots().length, 2);

  for (const profile of [prep, live, prep, live]) assert.equal(await __test__.applyProfile(profile), true);
  snapshots = getAutoSnapshots();
  assert.equal(snapshots.length, __test__.MAX_AUTO_SNAPSHOTS);
  assert.deepEqual(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles
    .filter((profile) => profile.auto !== true)
    .map((profile) => profile.id)
    .sort(), ["live", "prep"]);

  // No change and a cancelled preflight leave the snapshots alone.
  const writeCount = env.state.settingWrites.length;
  assert.equal(await __test__.applyProfile(live), false);
  env.state.confirmResult = false;
  assert.equal(await __test__.applyProfile(createProfile({ id: "warn", name: "Warn", moduleIds: ["missing-module"] })), false);
  assert.equal(env.state.settingWrites.length, writeCount);
});

test("manager template hides zero badges and lists module changes in a details element", () => {
  const template = readFileSync(new URL(modulePath("templates/loadouts-manager.html")), "utf8");
  const metaStart = template.indexOf('<div class="sml-profile-meta">');
  const meta = template.slice(metaStart, template.indexOf("</div>", metaStart));
  const badgeLines = meta.split(/\r?\n/).filter((line) => line.includes('class="sml-badge'));
  assert.equal(badgeLines.length, 8);
  assert.equal(badgeLines.every((line) => /^\s*\{\{#if \w+\}\}<span class="sml-badge[^>]*>\{\{\w+\}\}<\/span>\{\{\/if\}\}$/.test(line)), true);
  assert.match(template, /<details class="sml-profile-details" data-profile-id="\{\{id\}\}"/);
  assert.match(template, /data-action="filter-search"/);
  assert.match(template, /data-action="filter-tag"/);

  const presented = __test__.presentProfile(createProfile({ moduleIds: ["module-a", "module-b", "missing-module"] }));
  assert.equal(presented.hasModuleDetails, true);
  assert.deepEqual(presented.enableList, ["Beta"]);
  assert.deepEqual(presented.disableList, ["Gamma"]);
  assert.deepEqual(presented.missingList, ["missing-module"]);
  assert.equal(presented.isAuto, false);

  const matching = __test__.presentProfile(createProfile({ moduleIds: ["module-a", "module-c"] }));
  assert.equal(matching.hasModuleDetails, false);
  assert.equal(matching.toEnableCount, 0);
  assert.equal(__test__.presentProfile(createSnapshot("s1", "2026-01-01T00:00:00.000Z")).isAuto, true);

  const strings = __test__.getManagerTemplateStrings({ worldName: "World", currentActiveCount: 1, worldCount: 1, globalCount: 0 });
  for (const key of ["searchPlaceholder", "filterEmpty", "moduleDetails", "detailsEnable", "detailsDisable", "detailsMissing", "autoBadge", "autoHint"]) {
    assert.equal(typeof strings[key], "string", key);
  }
});

test("profile filter matches name, description and tags and the manager keeps it while open", () => {
  const beta = createProfile({ name: "Beta Live", description: "Session night", tags: ["live"] });
  assert.equal(__test__.profileMatchesFilter(beta, {}), true);
  assert.equal(__test__.profileMatchesFilter(beta, { search: "  NIGHT " }), true);
  assert.equal(__test__.profileMatchesFilter(beta, { search: "liv" }), true);
  assert.equal(__test__.profileMatchesFilter(beta, { search: "prep" }), false);
  assert.equal(__test__.profileMatchesFilter(beta, { tag: "LIVE" }), true);
  assert.equal(__test__.profileMatchesFilter(beta, { tag: "live", search: "alpha" }), false);
  assert.equal(__test__.profileMatchesFilter(beta, { tag: "prep" }), false);

  setStore(__test__.WORLD_PROFILES_SETTING, [
    createProfile({ id: "p-alpha", name: "Alpha Prep", tags: ["Prep"], moduleIds: ["module-a"] }),
    createProfile({ id: "p-beta", name: "Beta Live", description: "Session night", tags: ["live"], moduleIds: ["module-b"] }),
    createProfile({ id: "p-gamma", name: "Gamma", tags: ["prep", "debug"], moduleIds: ["module-c"] })
  ]);
  const manager = new __test__.SMLLoadoutsManager();
  const data = manager.getData();
  assert.deepEqual(data.tagFilters.map((entry) => entry.value), ["debug", "live", "Prep"]);
  assert.equal(data.tagFilters.some((entry) => entry.active), false);

  const { html, cards, chips, search, details, empty } = createFilterHtml(["p-alpha", "p-beta", "p-gamma"], ["debug", "live", "Prep"]);
  manager.activateListeners(html);
  const hiddenStates = () => cards.map((card) => card.hidden);
  assert.deepEqual(hiddenStates(), [false, false, false]);

  search.value = "SESSION";
  search.dispatch("input");
  assert.deepEqual(hiddenStates(), [true, false, true]);

  search.value = "";
  search.dispatch("input");
  chips[2].click();
  assert.deepEqual(hiddenStates(), [false, true, false]);
  assert.equal(chips[2].classes.has("is-active"), true);
  assert.equal(chips[2].attributes["aria-pressed"], "true");
  assert.equal(chips[0].attributes["aria-pressed"], "false");

  search.value = "gam";
  search.dispatch("input");
  assert.deepEqual(hiddenStates(), [true, true, false]);
  assert.equal(empty.hidden, true);

  search.value = "nothing";
  search.dispatch("input");
  assert.deepEqual(hiddenStates(), [true, true, true]);
  assert.equal(empty.hidden, false);

  // A re-render starts from the stored filter.
  const rerendered = manager.getData();
  assert.equal(rerendered.filterSearch, "nothing");
  assert.equal(rerendered.tagFilters.find((entry) => entry.value === "Prep").active, true);

  chips[2].click();
  assert.equal(chips[2].classes.has("is-active"), false);

  details.open = true;
  details.dispatch("toggle");
  assert.equal(manager.getData().profiles.find((profile) => profile.id === "p-alpha").detailsOpen, true);
  details.open = false;
  details.dispatch("toggle");
  assert.equal(manager.getData().profiles.find((profile) => profile.id === "p-alpha").detailsOpen, false);

  // A tag filter whose last profile is gone falls back to no tag.
  chips[0].click();
  setStore(__test__.WORLD_PROFILES_SETTING, [createProfile({ id: "p-beta", name: "Beta Live", tags: ["live"] })]);
  assert.equal(manager.getData().tagFilters.some((entry) => entry.active), false);
});

test("API compare, saveCurrent and apply follow the manager's rules", async () => {
  await env.hooks.trigger("ready");
  const api = env.game.modules.get(__test__.MODULE_ID).api;

  setStore(__test__.WORLD_PROFILES_SETTING, [
    createProfile({ id: "w-prep", name: "Prep", moduleIds: ["module-b"] }),
    createProfile({ id: "w-warn", name: "Warn", moduleIds: ["module-c", "missing-module"] })
  ]);
  setStore(__test__.GLOBAL_PROFILES_SETTING, [
    createProfile({ id: "g-prep", name: "prep", scope: __test__.PROFILE_SCOPES.GLOBAL, moduleIds: ["module-a", "missing-module"] })
  ]);

  // Names match without case, the world profile wins over the installation one.
  assert.deepEqual(api.compare("PREP"), { toEnable: ["module-b"], toDisable: ["module-a", "module-c"], missing: [] });
  assert.deepEqual(api.compare("g-prep"), { toEnable: [], toDisable: ["module-c"], missing: ["missing-module"] });
  assert.deepEqual(api.compare({ id: "w-warn" }).missing, ["missing-module"]);
  assert.equal(api.compare("nope"), null);
  assert.equal(env.state.notifications.warn.at(-1), "not found nope");

  env.state.userCanManage = false;
  assert.equal(await api.saveCurrent("Session"), null);
  assert.equal(env.state.notifications.error.at(-1), "permission required");
  assert.equal(await api.apply("Prep"), false);
  assert.equal(env.state.notifications.error.at(-1), "permission required");
  env.state.userCanManage = true;

  assert.equal(await api.saveCurrent("   "), null);
  assert.equal(env.state.notifications.warn.at(-1), "name required");

  const saved = await api.saveCurrent("Session", { description: "Tonight", tags: "live, prep" });
  assert.equal(saved.scope, __test__.PROFILE_SCOPES.WORLD);
  assert.equal(saved.description, "Tonight");
  assert.deepEqual(saved.tags, ["live", "prep"]);
  assert.deepEqual(saved.moduleIds, ["module-a", "module-c", __test__.MODULE_ID]);
  assert.equal(env.state.notifications.info.at(-1), "saved Session");

  const installation = await api.saveCurrent("session", { scope: "global", tags: ["one"] });
  assert.equal(installation.scope, __test__.PROFILE_SCOPES.GLOBAL);
  assert.notEqual(installation.id, saved.id);

  const replaced = await api.saveCurrent("SESSION");
  assert.equal(replaced.id, saved.id);
  assert.equal(replaced.createdAt, saved.createdAt);
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles
    .filter((profile) => profile.name.toLowerCase() === "session").length, 1);

  // apply() always asks by default and lists the real switch.
  env.state.dialogV2Result = false;
  assert.equal(await api.apply("Prep"), false);
  assert.equal(env.state.dialogV2Calls.length, 1);
  assert.match(env.state.dialogV2Calls[0].content, /Enable:.*Beta/s);
  assert.match(env.state.dialogV2Calls[0].content, /Disable:.*Alpha.*Gamma/s);
  assert.equal(env.state.settingWrites.some((entry) => entry.moduleId === "core"), false);

  env.state.dialogV2Result = true;
  assert.equal(await api.apply("w-prep"), true);
  assert.deepEqual(env.state.settingsValues.get("core.moduleConfiguration"), {
    "module-b": true,
    "sephrals-module-loadouts": true
  });
  assert.equal(getAutoSnapshots().length, 1);

  // confirm: false skips every dialog, also the preflight warning.
  env.state.confirmResult = false;
  env.state.lastConfirmOptions = null;
  assert.equal(await api.apply("Warn", { confirm: false }), true);
  assert.equal(env.state.dialogV2Calls.length, 2);
  assert.equal(env.state.lastConfirmOptions, null);
  assert.equal(env.state.notifications.warn.at(-1), "missing missing-module");

  assert.equal(await api.apply("unknown"), false);
  assert.equal(env.state.notifications.warn.at(-1), "not found unknown");
});
