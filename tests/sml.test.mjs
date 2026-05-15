import assert from "node:assert/strict";
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
    updatedAt: overrides.updatedAt ?? "2024-01-02T00:00:00.000Z"
  }, overrides.scope ?? __test__.PROFILE_SCOPES.WORLD);
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

test("registers settings, menu, keybinding, and ready API", async () => {
  await env.hooks.trigger("init");
  assert.equal(env.state.registerCalls.length, 3);
  assert.equal(env.state.registerMenuCalls.length, 1);
  assert.equal(env.state.keybindingCalls.length, 1);
  assert.equal(env.state.keybindingCalls[0].data.restricted, true);

  const keybindingResult = env.state.keybindingCalls[0].data.onDown();
  assert.equal(keybindingResult, true);

  await env.hooks.trigger("ready");
  const api = env.game.modules.get(__test__.MODULE_ID).api;
  assert.equal(typeof api.openManager, "function");
  assert.equal(typeof api.getProfiles, "function");

  const manager = api.openManager();
  assert.equal(manager.renderCalls.at(-1), true);
  await manager.close();

  env.state.modules.delete(__test__.MODULE_ID);
  await env.hooks.trigger("ready");
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
        { id: "module-missing", type: "module" },
        { id: "skip-system", type: "system" }
      ]
    }
  });
  env.addModule("module-min", { title: "Min", version: "1.0.0" });
  env.addModule("module-max", { title: "Max", version: "2.0.0" });
  env.addModule("module-verified", { title: "Verified", version: "2.0.0" });
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
  assert.equal(warningDetails.some((entry) => entry.includes("verified up to 2.0.0")), true);
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

  manager.element = [createThemeHost()];
  await manager._render(true, { test: true });
  assert.equal(manager.element[0].dataset.uiTheme, __test__.UI_THEMES.SIGNATURE);

  const firstManager = __test__.openManager();
  await firstManager.close();
  const secondManager = __test__.openManager();
  assert.notEqual(firstManager, secondManager);
  await secondManager.close();
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