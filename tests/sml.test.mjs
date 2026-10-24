import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createButton,
  createFakeForm,
  createTestEnvironment,
  createThemeHost,
  flushPromises,
  modulePath,
  pressDialogButton
} from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));
const actions = __test__.SMLLoadoutsManager.DEFAULT_OPTIONS.actions;

function setStore(scope, profiles = []) {
  env.state.settingsValues.set(`sephrals-module-loadouts.${scope}`, {
    version: __test__.STORAGE_VERSION,
    profiles
  });
}

// Installation loadouts live in a file in the user data, read once into the cache.
async function setInstallationFile(profiles = []) {
  env.state.directories.add("modules/sephrals-module-loadouts/storage");
  env.state.files.set("modules/sephrals-module-loadouts/storage/installation-loadouts.json", JSON.stringify({ version: 2, profiles }));
  await __test__.loadInstallationStore({ force: true });
}

function createProfile(overrides = {}) {
  return __test__.normalizeProfile({
    id: overrides.id ?? "profile-1",
    name: overrides.name ?? "Alpha",
    description: overrides.description ?? "",
    tags: overrides.tags ?? ["tag"],
    scope: overrides.scope ?? __test__.PROFILE_SCOPES.WORLD,
    moduleIds: overrides.moduleIds ?? ["module-a"],
    moduleInfo: overrides.moduleInfo,
    settings: overrides.settings,
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

// Form values for the profile dialog, the default answer of every DialogV2.wait: its first (default) button.
let formValues = {};
function useForm(values) {
  formValues = {
    profileName: "",
    profileDescription: "",
    profileTags: "",
    profileScope: __test__.PROFILE_SCOPES.WORLD,
    profileSettings: "none",
    ...values
  };
}

function createFilterRoot(profileIds, tags) {
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
  const importFile = Object.assign(createButton(), { value: "" });
  const details = Object.assign(createButton({ profileId: profileIds[0] }), { open: false });
  const empty = { hidden: true };
  const host = createThemeHost();
  const root = {
    ...host,
    querySelector(selector) {
      return {
        '[data-role="filter-search"]': search,
        '[data-role="import-file"]': importFile,
        ".sml-filter-empty": empty,
        ".sml-app": host.root
      }[selector] ?? null;
    },
    querySelectorAll(selector) {
      return {
        ".sml-profile-card": cards,
        '[data-action="filterTag"]': chips,
        ".sml-profile-details": [details]
      }[selector] ?? [];
    }
  };

  return { root, cards, chips, search, details, empty, importFile };
}

test.beforeEach(() => {
  env.reset();
  __test__.resetModuleTranslations();
  __test__.resetInstallationStore();
  env.addModule(__test__.MODULE_ID, { title: "Sephral’s Module Loadouts" });
  env.addModule("module-a", { title: "Alpha" });
  env.addModule("module-b", { title: "Beta" });
  env.addModule("module-c", { title: "Gamma" });
  env.state.settingsValues.set("core.moduleConfiguration", {
    "sephrals-module-loadouts": true,
    "module-a": true,
    "module-c": true
  });
  setStore(__test__.WORLD_PROFILES_SETTING, []);
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_THEME_SETTING}`, __test__.UI_THEMES.SIGNATURE);
  useForm({});
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, options.buttons[0].action, createFakeForm(formValues));
});

test.after(() => {
  env.restore();
});

test("registers settings, menu, keybinding, and ready API", async () => {
  await env.hooks.trigger("init");
  assert.deepEqual(env.state.registerCalls.map((entry) => entry.key).sort(), [
    "bugHunt",
    "checkResultDisplay",
    "globalProfiles",
    "installationMigrated",
    "installationRevision",
    "pendingCheck",
    "pinnedModules",
    "uiLanguage",
    "uiTheme",
    "worldProfiles"
  ]);
  const displaySetting = env.state.registerCalls.find((entry) => entry.key === __test__.CHECK_DISPLAY_SETTING);
  assert.equal(displaySetting.data.scope, "world");
  assert.equal(displaySetting.data.config, true);
  assert.equal(displaySetting.data.default, __test__.CHECK_DISPLAY_MODES.PROBLEMS);
  const markerSetting = env.state.registerCalls.find((entry) => entry.key === __test__.CHECK_MARKER_SETTING);
  assert.equal(markerSetting.data.scope, "world");
  assert.equal(markerSetting.data.config, false);
  assert.equal(env.state.registerCalls.find((entry) => entry.key === __test__.INSTALLATION_MIGRATED_SETTING).data.scope, "client");
  assert.equal(env.state.registerCalls.find((entry) => entry.key === __test__.PINNED_MODULES_SETTING).data.scope, "world");
  const languageSetting = env.state.registerCalls.find((entry) => entry.key === __test__.UI_LANGUAGE_SETTING);
  assert.deepEqual(languageSetting.data.choices, {
    default: "Follow Foundry",
    de: "Deutsch",
    en: "English"
  });
  assert.equal(env.state.registerMenuCalls.length, 1);
  assert.equal(env.state.registerMenuCalls[0].data.type, __test__.SMLSettingsMenu);
  assert.equal(env.state.keybindingCalls.length, 1);
  assert.equal(env.state.keybindingCalls[0].data.restricted, true);

  const keybindingResult = env.state.keybindingCalls[0].data.onDown();
  assert.equal(keybindingResult, true);

  await env.hooks.trigger("ready");
  const api = env.game.modules.get(__test__.MODULE_ID).api;
  assert.deepEqual(Object.keys(api).sort(), ["apply", "bugHunt", "compare", "getPinned", "getProfiles", "openManager", "saveCurrent", "setPinned"]);
  assert.equal(Object.values(api).every((entry) => typeof entry === "function"), true);

  const manager = api.openManager();
  await flushPromises();
  assert.equal(manager.renderCalls.at(-1).force, true);
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

  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_LANGUAGE_SETTING}`, "default");
  env.state.lang = "de-DE";
  assert.equal(__test__.getModuleLanguage(), "de");

  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_LANGUAGE_SETTING}`, "en");
  assert.equal(__test__.getModuleLanguage(), "en");

  const manager = __test__.openManager();
  await flushPromises();
  const baselineRenderCount = manager.renderCalls.length;
  const languageSetting = env.state.registerCalls.find((entry) => entry.key === __test__.UI_LANGUAGE_SETTING);

  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.UI_LANGUAGE_SETTING}`, "de");
  languageSetting.data.onChange("de");
  await flushPromises();

  assert.equal(manager.title, "Modul-Loadouts");
  assert.equal(__test__.localize("SML.Settings.Menu.Label"), "Manager öffnen");
  assert.equal(manager.renderCalls.length, baselineRenderCount + 1);
  assert.deepEqual(manager.renderCalls.at(-1), { window: { title: "Modul-Loadouts" } });

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
  __test__.applyManagerTheme(null);
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
  const manager = __test__.getManagerApp();
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
  assert.equal("moduleInfo" in normalized, false);
  assert.equal("settings" in normalized, false);
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

  env.state.modules.get("module-a").manifest = "https://example.com/module-a/module.json";
  const currentProfile = __test__.createCurrentProfile({ name: "Snapshot", scope: __test__.PROFILE_SCOPES.WORLD });
  assert.deepEqual(currentProfile.moduleIds, ["module-a", "module-c", "sephrals-module-loadouts"]);
  assert.deepEqual(currentProfile.moduleInfo["module-a"], { title: "Alpha", version: "1.0.0", manifest: "https://example.com/module-a/module.json" });
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
  assert.deepEqual(comparison.pinnedKept, []);
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

test("apply asks first and handles permission, blocking, cancel, no-change, and success paths", async () => {
  env.state.userCanManage = false;
  assert.equal(await __test__.applyProfile(createProfile({ name: "Blocked" })), false);
  assert.deepEqual(env.state.notifications.error, ["permission required"]);

  env.state.userCanManage = true;
  env.addModule("module-blocked", {
    title: "Blocked",
    availability: CONST.PACKAGE_AVAILABILITY_CODES.REQUIRES_SYSTEM,
    availabilityLabel: "requires system"
  });
  await __test__.applyProfile(createProfile({ name: "Blocked", moduleIds: ["module-blocked"] }));
  assert.match(env.state.notifications.error.at(-1), /blocking/);

  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "cancel");
  assert.equal(await __test__.applyProfile(createProfile({ name: "Cancelled", moduleIds: ["missing-module"] })), false);
  assert.equal(env.state.settingWrites.some((entry) => entry.moduleId === "core"), false);
  assert.match(env.state.dialogV2WaitCalls.at(-1).content, /Missing modules/);

  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "apply");
  env.state.settingsValues.set("core.moduleConfiguration", {
    "sephrals-module-loadouts": true,
    "module-a": true
  });
  const calls = env.state.dialogV2WaitCalls.length;
  assert.equal(await __test__.applyProfile(createProfile({ name: "No Change", moduleIds: ["module-a", "sephrals-module-loadouts"] })), false);
  assert.equal(env.state.notifications.info.includes("no changes"), true);
  assert.equal(env.state.dialogV2WaitCalls.length, calls);

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
  assert.equal(await __test__.applyProfile(createProfile({ name: "Deploy", moduleIds: ["module-d", "missing-module"] })), true);
  const dialog = env.state.dialogV2WaitCalls.at(-1);
  assert.match(dialog.content, /Enable:.*Delta/s);
  assert.match(dialog.content, /Disable:.*Alpha.*Gamma/s);
  assert.match(dialog.content, /Auto-enable.*Beta/s);
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
  await setInstallationFile([createProfile({ id: "g1", name: "Global", scope: __test__.PROFILE_SCOPES.GLOBAL })]);

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
  assert.deepEqual(worldProfiles[0].moduleIds, ["module-b"]);
  assert.deepEqual(globalProfiles.map((profile) => profile.id).sort(), ["g1", "g2"]);
  assert.equal(worldProfiles[0].scope, __test__.PROFILE_SCOPES.WORLD);
  assert.equal(env.state.notifications.info.at(-1), "imported 2 1 1");
  // Installation loadouts go into the file in the user data.
  const file = JSON.parse(env.state.files.get("modules/sephrals-module-loadouts/storage/installation-loadouts.json"));
  assert.deepEqual(file.profiles.map((profile) => profile.id).sort(), ["g1", "g2"]);
});

test("settings menu and manager lifecycle expose the expected UI behavior", async () => {
  const settingsMenu = new __test__.SMLSettingsMenu();
  assert.equal(settingsMenu.render(), settingsMenu);
  await flushPromises();
  await __test__.getManagerApp().close();

  const options = __test__.SMLLoadoutsManager.DEFAULT_OPTIONS;
  assert.equal(options.id, __test__.MODULE_ID);
  assert.equal(__test__.SMLLoadoutsManager.PARTS.main.template.includes("loadouts-manager.html"), true);
  assert.equal(options.classes.includes("sml-window"), true);
  assert.equal(options.window.resizable, true);

  setStore(__test__.WORLD_PROFILES_SETTING, [createProfile({ id: "w1", name: "World One", scope: __test__.PROFILE_SCOPES.WORLD })]);
  await setInstallationFile([createProfile({ id: "g1", name: "Global One", scope: __test__.PROFILE_SCOPES.GLOBAL })]);
  const manager = new __test__.SMLLoadoutsManager();
  const data = await manager._prepareContext({});
  assert.equal(data.hasProfiles, true);
  assert.equal(data.globalCount, 1);
  assert.equal(data.worldCount, 1);
  assert.equal(data.strings.title, "Module Loadouts");
  assert.equal(data.installationUnavailable, false);
  assert.equal(data.huntRunning, false);
  assert.equal(manager.title, "Module Loadouts");

  const { root } = createFilterRoot(["w1", "g1"], []);
  manager.element = root;
  manager._onRender({ uiTheme: __test__.UI_THEMES.FOUNDRY }, {});
  assert.equal(root.dataset.uiTheme, __test__.UI_THEMES.FOUNDRY);

  const firstManager = __test__.openManager();
  await flushPromises();
  await firstManager.close();
  const secondManager = __test__.openManager();
  assert.notEqual(firstManager, secondManager);
  await flushPromises();
  await secondManager.close();
});

test("manager template is driven by prelocalized strings", () => {
  const template = readFileSync(new URL(modulePath("templates/loadouts-manager.html")), "utf8");

  assert.equal(template.includes("{{localize \"SML."), false);
  assert.equal(typeof __test__.getManagerTemplateStrings, "function");
  const strings = __test__.getManagerTemplateStrings({
    worldName: "Test World",
    currentActiveCount: 6,
    worldCount: 1,
    globalCount: 0,
    pinnedCount: 2
  });
  assert.equal(strings.title, "Module Loadouts");
  for (const action of ["saveCurrent", "pinnedModules", "bugHunt", "exportProfiles", "importProfiles", "applyProfile", "editProfile", "duplicateProfile", "deleteProfile", "filterTag", "copyManifest"]) {
    assert.match(template, new RegExp(`data-action="${action}"`), action);
    assert.equal(typeof actions[action], "function", action);
  }
});

test("manager actions exercise save, export, import, edit, duplicate, apply, and delete flows", async () => {
  const profile = createProfile({ id: "profile-1", name: "Original", moduleIds: ["module-a"] });
  setStore(__test__.WORLD_PROFILES_SETTING, [profile]);

  const manager = new __test__.SMLLoadoutsManager();
  const { root, importFile } = createFilterRoot(["profile-1"], []);
  manager.element = root;

  useForm({ profileName: "Saved Profile", profileDescription: "Snapshot", profileTags: "live, prep" });
  await actions.saveCurrent.call(manager);
  const saved = __test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.find((entry) => entry.name === "Saved Profile");
  assert.deepEqual(saved.tags, ["live", "prep"]);
  assert.equal("settings" in saved, false);

  actions.exportProfiles.call(manager);
  assert.equal(env.state.savedFiles.length >= 1, true);

  let clicked = 0;
  importFile.click = () => {
    clicked += 1;
  };
  actions.importProfiles.call(manager);
  assert.equal(clicked, 1);

  env.state.fileText = JSON.stringify({
    profiles: [{ id: "imported", name: "Imported", scope: __test__.PROFILE_SCOPES.GLOBAL, moduleIds: ["module-b"] }]
  });
  importFile.files = [{ name: "profiles.json" }];
  importFile.value = "profiles.json";
  await manager._onImport({ currentTarget: importFile });
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles.some((entry) => entry.id === "imported"), true);
  assert.equal(importFile.value, "");
  // The import shows its preview first.
  assert.match(env.state.dialogV2WaitCalls.at(-1).content, /Imported/);

  useForm({ profileName: "Edited Profile", profileDescription: "Changed", profileTags: "alpha", profileScope: __test__.PROFILE_SCOPES.GLOBAL });
  await actions.editProfile.call(manager, {}, { dataset: { profileId: "profile-1" } });
  assert.equal(__test__.findProfileById("profile-1").scope, __test__.PROFILE_SCOPES.GLOBAL);
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.some((entry) => entry.id === "profile-1"), false);

  useForm({ profileName: "Duplicate Profile", profileDescription: "Copy", profileTags: "copy" });
  await actions.duplicateProfile.call(manager, {}, { dataset: { profileId: "profile-1" } });
  assert.equal(__test__.getAllProfiles().some((entry) => entry.name === "Duplicate Profile"), true);

  await actions.applyProfile.call(manager, {}, { dataset: { profileId: "profile-1" } });
  assert.equal(env.state.settingWrites.some((entry) => entry.moduleId === "core"), true);

  await actions.deleteProfile.call(manager, {}, { dataset: { profileId: "profile-1" } });
  assert.equal(__test__.findProfileById("profile-1"), null);
});

test("manager abort and error branches are handled", async () => {
  const existing = createProfile({ id: "profile-1", name: "Original", moduleIds: ["module-a"] });
  setStore(__test__.WORLD_PROFILES_SETTING, [existing]);

  const manager = new __test__.SMLLoadoutsManager();
  const { root, importFile } = createFilterRoot(["profile-1"], []);
  manager.element = root;

  // Same name: the replace question is answered with no.
  useForm({ profileName: "Original", profileDescription: "Same", profileTags: "same" });
  env.state.dialogV2Result = false;
  await manager._onSaveCurrent();
  assert.deepEqual(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.map((entry) => entry.description), [""]);

  // Yes replaces it and keeps the id.
  env.state.dialogV2Result = true;
  await manager._onSaveCurrent();
  const replaced = __test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles;
  assert.deepEqual(replaced.map((entry) => [entry.id, entry.description]), [["profile-1", "Same"]]);

  importFile.files = [{ name: "broken.json" }];
  importFile.value = "broken.json";
  env.state.fileText = "{";
  await manager._onImport({ currentTarget: importFile });
  assert.equal(env.state.notifications.error.at(-1), "import failed invalid import");
  assert.equal(importFile.value, "");

  // No file chosen: nothing happens.
  importFile.files = [];
  await manager._onImport({ currentTarget: importFile });

  // A failing installation write is reported, not thrown.
  env.state.uploadFails = true;
  useForm({ profileName: "Installed", profileScope: __test__.PROFILE_SCOPES.GLOBAL });
  const consoleError = console.error;
  console.error = () => {};
  try {
    await manager._onSaveCurrent();
  } finally {
    console.error = consoleError;
  }
  assert.equal(env.state.notifications.error.at(-1), "save failed installation write failed");
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles.length, 0);
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
  assert.deepEqual(env.state.settingWrites.map((entry) => entry.moduleId === "core" ? "core" : entry.key), [__test__.WORLD_PROFILES_SETTING, __test__.CHECK_MARKER_SETTING, "core"]);

  let snapshots = getAutoSnapshots();
  assert.equal(snapshots.length, 1);
  assert.deepEqual(snapshots[0].moduleIds, ["module-a", "module-c", __test__.MODULE_ID]);
  assert.deepEqual(snapshots[0].tags, [__test__.AUTO_SNAPSHOT_TAG]);
  assert.equal(snapshots[0].scope, __test__.PROFILE_SCOPES.WORLD);
  assert.match(snapshots[0].name, /^Before apply \(.+\)$/);
  assert.equal(snapshots[0].description, "Before Prep");
  assert.equal("settings" in snapshots[0], false);
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

  // No change and a cancelled dialog leave the snapshots alone.
  const writeCount = env.state.settingWrites.length;
  assert.equal(await __test__.applyProfile(live), false);
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "cancel");
  assert.equal(await __test__.applyProfile(createProfile({ id: "warn", name: "Warn", moduleIds: ["missing-module"] })), false);
  assert.equal(env.state.settingWrites.length, writeCount);
});

test("manager template hides zero badges and lists module changes in a details element", () => {
  const template = readFileSync(new URL(modulePath("templates/loadouts-manager.html")), "utf8");
  const metaStart = template.indexOf('<div class="sml-profile-meta">');
  const meta = template.slice(metaStart, template.indexOf("</div>", metaStart));
  const badgeLines = meta.split(/\r?\n/).filter((line) => line.includes('class="sml-badge'));
  assert.equal(badgeLines.length, 12);
  assert.equal(badgeLines.every((line) => /^\s*\{\{#if \w+\}\}<span class="sml-badge[^>]*>\{\{\w+\}\}<\/span>\{\{\/if\}\}$/.test(line)), true);
  assert.match(template, /<details class="sml-profile-details" data-profile-id="\{\{id\}\}"/);
  assert.match(template, /data-role="filter-search"/);
  assert.match(template, /data-action="filterTag"/);

  const presented = __test__.presentProfile(createProfile({ moduleIds: ["module-a", "module-b", "missing-module"] }));
  assert.equal(presented.hasModuleDetails, true);
  assert.deepEqual(presented.enableList, ["Beta"]);
  assert.deepEqual(presented.disableList, ["Gamma"]);
  assert.deepEqual(presented.missingList.map((entry) => [entry.title, entry.page]), [["missing-module", "https://foundryvtt.com/packages/missing-module"]]);
  assert.equal(presented.isAuto, false);

  const matching = __test__.presentProfile(createProfile({ moduleIds: ["module-a", "module-c"] }));
  assert.equal(matching.hasModuleDetails, false);
  assert.equal(matching.toEnableCount, 0);
  assert.equal(__test__.presentProfile(createSnapshot("s1", "2026-01-01T00:00:00.000Z")).isAuto, true);

  const strings = __test__.getManagerTemplateStrings({ worldName: "World", currentActiveCount: 1, worldCount: 1, globalCount: 0 });
  for (const key of ["searchPlaceholder", "filterEmpty", "moduleDetails", "detailsEnable", "detailsDisable", "detailsMissing", "detailsPinned", "detailsChanged", "detailsUnusedLibraries", "detailsSettings", "autoBadge", "autoHint", "pinned", "bugHunt"]) {
    assert.equal(typeof strings[key], "string", key);
  }
});

test("profile filter matches name, description and tags and the manager keeps it while open", async () => {
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
  const data = await manager._prepareContext({});
  assert.deepEqual(data.tagFilters.map((entry) => entry.value), ["debug", "live", "Prep"]);
  assert.equal(data.tagFilters.some((entry) => entry.active), false);

  const { root, cards, chips, search, details, empty } = createFilterRoot(["p-alpha", "p-beta", "p-gamma"], ["debug", "live", "Prep"]);
  manager.element = root;
  manager._onRender(data, {});
  const hiddenStates = () => cards.map((card) => card.hidden);
  assert.deepEqual(hiddenStates(), [false, false, false]);

  search.value = "SESSION";
  search.dispatch("input");
  assert.deepEqual(hiddenStates(), [true, false, true]);

  search.value = "";
  search.dispatch("input");
  actions.filterTag.call(manager, {}, chips[2]);
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
  const rerendered = await manager._prepareContext({});
  assert.equal(rerendered.filterSearch, "nothing");
  assert.equal(rerendered.tagFilters.find((entry) => entry.value === "Prep").active, true);

  actions.filterTag.call(manager, {}, chips[2]);
  assert.equal(chips[2].classes.has("is-active"), false);

  details.open = true;
  details.dispatch("toggle");
  assert.equal((await manager._prepareContext({})).profiles.find((profile) => profile.id === "p-alpha").detailsOpen, true);
  details.open = false;
  details.dispatch("toggle");
  assert.equal((await manager._prepareContext({})).profiles.find((profile) => profile.id === "p-alpha").detailsOpen, false);

  // A tag filter whose last profile is gone falls back to no tag.
  actions.filterTag.call(manager, {}, chips[0]);
  setStore(__test__.WORLD_PROFILES_SETTING, [createProfile({ id: "p-beta", name: "Beta Live", tags: ["live"] })]);
  assert.equal((await manager._prepareContext({})).tagFilters.some((entry) => entry.active), false);
});

test("API compare, saveCurrent and apply follow the manager's rules", async () => {
  await env.hooks.trigger("ready");
  const api = env.game.modules.get(__test__.MODULE_ID).api;

  setStore(__test__.WORLD_PROFILES_SETTING, [
    createProfile({ id: "w-prep", name: "Prep", moduleIds: ["module-b"] }),
    createProfile({ id: "w-warn", name: "Warn", moduleIds: ["module-c", "missing-module"] })
  ]);
  await setInstallationFile([
    createProfile({ id: "g-prep", name: "prep", scope: __test__.PROFILE_SCOPES.GLOBAL, moduleIds: ["module-a", "missing-module"] })
  ]);

  // Names match without case, the world profile wins over the installation one.
  assert.deepEqual(api.compare("PREP"), { toEnable: ["module-b"], toDisable: ["module-a", "module-c"], missing: [], settings: [] });
  assert.deepEqual(api.compare("g-prep"), { toEnable: [], toDisable: ["module-c"], missing: ["missing-module"], settings: [] });
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
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "cancel");
  const calls = env.state.dialogV2WaitCalls.length;
  assert.equal(await api.apply("Prep"), false);
  assert.equal(env.state.dialogV2WaitCalls.length, calls + 1);
  assert.match(env.state.dialogV2WaitCalls.at(-1).content, /Enable:.*Beta/s);
  assert.match(env.state.dialogV2WaitCalls.at(-1).content, /Disable:.*Alpha.*Gamma/s);
  assert.equal(env.state.settingWrites.some((entry) => entry.moduleId === "core"), false);

  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "apply");
  assert.equal(await api.apply("w-prep"), true);
  assert.deepEqual(env.state.settingsValues.get("core.moduleConfiguration"), {
    "module-b": true,
    "sephrals-module-loadouts": true
  });
  assert.equal(getAutoSnapshots().length, 1);

  // confirm: false skips every dialog.
  const before = env.state.dialogV2WaitCalls.length;
  assert.equal(await api.apply("Warn", { confirm: false }), true);
  assert.equal(env.state.dialogV2WaitCalls.length, before);
  assert.equal(env.state.notifications.warn.at(-1), "missing missing-module");

  assert.equal(await api.apply("unknown"), false);
  assert.equal(env.state.notifications.warn.at(-1), "not found unknown");

  assert.deepEqual(await api.setPinned(["module-b", "module-b", __test__.MODULE_ID, ""]), ["module-b"]);
});

test("names go into dialog content and notifications escaped", async () => {
  const evil = "Evil <img src=x onerror=\"alert(1)\">";
  assert.equal(__test__.localizeHtml("SML.Dialog.Delete.Content", { name: evil }), "Delete Evil &lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  setStore(__test__.WORLD_PROFILES_SETTING, [createProfile({ id: "profile-1", name: evil })]);

  const manager = new __test__.SMLLoadoutsManager();
  manager.element = createFilterRoot(["profile-1"], []).root;
  env.state.dialogV2Result = true;
  await actions.deleteProfile.call(manager, {}, { dataset: { profileId: "profile-1" } });
  assert.equal(env.state.dialogV2Calls.at(-1).content.includes("<img"), false);
  assert.equal(env.state.dialogV2Calls.at(-1).content.includes("&lt;img"), true);
  assert.equal(env.state.notifications.info.at(-1).includes("<img"), false);

  await __test__.apiSaveCurrent("<b>Bold</b>");
  assert.equal(env.state.notifications.info.at(-1), "saved &lt;b&gt;Bold&lt;/b&gt;");

  const form = __test__.renderProfileForm({ name: evil, description: "\"quoted\"", tags: ["<t>"] });
  assert.equal(form.includes("<img"), false);
  assert.equal(form.includes("&quot;quoted&quot;"), true);
});

test("edit and duplicate refuse names that already exist in the target scope, empty names warn", async () => {
  env.state.localizations.set("SML.Notification.NameTaken", "taken {name} {scope}");
  setStore(__test__.WORLD_PROFILES_SETTING, [
    createProfile({ id: "profile-1", name: "Original" }),
    createProfile({ id: "profile-2", name: "Other" })
  ]);
  await setInstallationFile([createProfile({ id: "g1", name: "Installed", scope: __test__.PROFILE_SCOPES.GLOBAL })]);
  assert.equal(__test__.findNameConflict("other", __test__.PROFILE_SCOPES.WORLD)?.id, "profile-2");
  assert.equal(__test__.findNameConflict("Original", __test__.PROFILE_SCOPES.WORLD, "profile-1"), null);
  assert.equal(__test__.findNameConflict("Other", __test__.PROFILE_SCOPES.GLOBAL), null);

  const manager = new __test__.SMLLoadoutsManager();
  manager.element = createFilterRoot(["profile-1"], []).root;

  // Edit onto another profile's name (other case) is refused
  useForm({ profileName: "OTHER" });
  await manager._onEdit("profile-1");
  assert.equal(__test__.findProfileById("profile-1").name, "Original");
  assert.equal(env.state.notifications.warn.at(-1), "taken Other World");

  // Keeping the own name (other case) is fine, and so is a name that only exists in the other scope
  useForm({ profileName: "ORIGINAL" });
  await manager._onEdit("profile-1");
  assert.equal(__test__.findProfileById("profile-1").name, "ORIGINAL");
  useForm({ profileName: "Installed" });
  await manager._onDuplicate("profile-1");
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.some((entry) => entry.name === "Installed"), true);

  // Duplicate onto an existing name in the target scope is refused
  const count = __test__.getAllProfiles().length;
  useForm({ profileName: "installed", profileScope: __test__.PROFILE_SCOPES.GLOBAL });
  await manager._onDuplicate("profile-1");
  assert.equal(__test__.getAllProfiles().length, count);
  assert.equal(env.state.notifications.warn.at(-1), "taken Installed Installation");

  // A submitted empty name warns, a closed dialog stays silent and is not rejected
  const warnings = env.state.notifications.warn.length;
  useForm({ profileName: "   " });
  await manager._onSaveCurrent();
  assert.equal(env.state.notifications.warn.at(-1), "name required");
  assert.equal(env.state.dialogV2WaitCalls.at(-1).rejectClose, false);
  env.state.dialogV2WaitHandler = () => null;
  await manager._onEdit("profile-1");
  assert.equal(env.state.notifications.warn.length, warnings + 1);
});

test("import keeps ids unique: id match wins, stored ids stay, ids of the other scope are replaced", async () => {
  setStore(__test__.WORLD_PROFILES_SETTING, [
    createProfile({ id: "w1", name: "First" }),
    createProfile({ id: "w2", name: "Second" })
  ]);
  await setInstallationFile([createProfile({ id: "g1", name: "Global", scope: __test__.PROFILE_SCOPES.GLOBAL })]);
  env.state.fileText = JSON.stringify({
    profiles: [
      // name of w1 with an unknown id: replaces w1 and keeps the id w1
      { id: "new-id", name: "FIRST", scope: __test__.PROFILE_SCOPES.WORLD, moduleIds: ["module-b"] },
      // id of w2: replaces w2 even though the name is new
      { id: "w2", name: "Second Renamed", scope: __test__.PROFILE_SCOPES.WORLD, moduleIds: ["module-c"] },
      // id of the world profile w1 in the installation scope: added with a fresh id
      { id: "w1", name: "Cross", scope: __test__.PROFILE_SCOPES.GLOBAL, moduleIds: ["module-a"] }
    ]
  });
  await __test__.importProfilesFromFile({ name: "ids.json" });
  const world = __test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles;
  const global = __test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles;
  assert.deepEqual(world.map((entry) => `${entry.id}:${entry.name}`).sort(), ["w1:FIRST", "w2:Second Renamed"]);
  const cross = global.find((entry) => entry.name === "Cross");
  assert.notEqual(cross.id, "w1");
  const ids = __test__.getAllProfiles().map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(env.state.notifications.info.at(-1), "imported 3 1 2");
});

test("players without the module permission get no manager, read-only users cannot save or import", async () => {
  env.game.user.isGM = false;
  env.state.userCanManage = false;
  assert.equal(__test__.canOpenManager(), false);
  assert.equal(__test__.openManager(), null);
  assert.equal(env.state.notifications.error.at(-1), "permission required");
  env.state.userCanManage = true;
  assert.equal(__test__.canOpenManager(), true);
  env.game.user.isGM = true;
  env.state.userCanManage = false;
  assert.equal(__test__.canOpenManager(), true);

  const template = readFileSync(new URL(modulePath("templates/loadouts-manager.html")), "utf8");
  for (const action of ["saveCurrent", "importProfiles", "pinnedModules", "bugHunt"]) {
    assert.match(template, new RegExp(`data-action="${action}" \\{\\{#unless canManage\\}\\}disabled\\{\\{/unless\\}\\}`), action);
  }

  const manager = new __test__.SMLLoadoutsManager();
  const { root, importFile } = createFilterRoot([], []);
  manager.element = root;
  useForm({ profileName: "Denied" });
  env.state.fileText = JSON.stringify({ profiles: [{ id: "x", name: "Denied Import", moduleIds: [] }] });
  await manager._onSaveCurrent();
  importFile.files = [{ name: "profiles.json" }];
  importFile.value = "profiles.json";
  await manager._onImport({ currentTarget: importFile });
  await manager._onPinnedModules();
  assert.equal(__test__.getAllProfiles().length, 0);
  assert.equal(env.state.notifications.error.filter((entry) => entry === "permission required").length, 4);
  assert.equal(importFile.value, "");
  assert.equal(env.state.dialogV2WaitCalls.length, 0);
});

test("an open manager re-renders when the world loadouts or pinned modules change elsewhere", async () => {
  await env.hooks.trigger("init");
  const manager = __test__.openManager();
  await flushPromises();
  const renders = manager.renderCalls.length;
  env.state.settingsRegistry.get(`${__test__.MODULE_ID}.${__test__.WORLD_PROFILES_SETTING}`).onChange();
  env.state.settingsRegistry.get(`${__test__.MODULE_ID}.${__test__.PINNED_MODULES_SETTING}`).onChange();
  assert.deepEqual(manager.renderCalls.slice(renders), [{}, {}]);
  await manager.close();
  // A closed manager is forgotten, nothing renders it again.
  env.state.settingsRegistry.get(`${__test__.MODULE_ID}.${__test__.WORLD_PROFILES_SETTING}`).onChange();
  assert.equal(manager.renderCalls.length, renders + 2);
});

test("editing a profile that another gamemaster deleted meanwhile does not bring it back", async () => {
  setStore(__test__.WORLD_PROFILES_SETTING, [createProfile({ id: "profile-1", name: "Original" })]);
  const manager = new __test__.SMLLoadoutsManager();
  manager.element = createFilterRoot(["profile-1"], []).root;
  env.state.dialogV2WaitHandler = (options) => {
    setStore(__test__.WORLD_PROFILES_SETTING, []);
    return pressDialogButton(options, "save", createFakeForm({ profileName: "Renamed", profileScope: "world", profileSettings: "none" }));
  };
  await manager._onEdit("profile-1");
  assert.equal(__test__.getAllProfiles().length, 0);
  assert.equal(env.state.notifications.warn.at(-1), "not found Original");
});
