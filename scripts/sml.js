// Entry file of Sephral’s Module Loadouts: registers settings, menu, hotkey and API and wires the hooks.
// The behavior lives in the files next to it.

import * as core from "./core.mjs";
import * as loadoutSettings from "./loadout-settings.mjs";
import * as store from "./store.mjs";
import * as startupCheck from "./startup-check.mjs";
import * as apply from "./apply.mjs";
import * as bugHunt from "./bug-hunt.mjs";
import * as manager from "./manager.mjs";

const {
  BUG_HUNT_SETTING,
  CHECK_DISPLAY_MODES,
  CHECK_DISPLAY_SETTING,
  CHECK_MARKER_SETTING,
  GLOBAL_PROFILES_SETTING,
  HOTKEY_PRECEDENCE,
  INSTALLATION_MIGRATED_SETTING,
  INSTALLATION_REVISION_SETTING,
  MODULE_ID,
  PINNED_MODULES_SETTING,
  UI_LANGUAGE_SETTING,
  UI_THEMES,
  UI_THEME_SETTING,
  WORLD_PROFILES_SETTING,
  ensureModuleTranslationsLoaded,
  localize,
  refreshManager
} = core;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, WORLD_PROFILES_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: store.defaultStore(),
    // Keeps an open manager current when another gamemaster saves, edits or deletes a world loadout.
    onChange: () => refreshManager()
  });

  // Installation loadouts up to version 1.0.3, kept in this browser. They move into the shared file once.
  game.settings.register(MODULE_ID, GLOBAL_PROFILES_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: store.defaultStore()
  });

  game.settings.register(MODULE_ID, INSTALLATION_MIGRATED_SETTING, {
    scope: "client",
    config: false,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, INSTALLATION_REVISION_SETTING, {
    scope: "world",
    config: false,
    type: Number,
    default: 0,
    onChange: (value) => {
      void store.onInstallationRevisionChange(value);
    }
  });

  game.settings.register(MODULE_ID, PINNED_MODULES_SETTING, {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => refreshManager()
  });

  game.settings.register(MODULE_ID, BUG_HUNT_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => bugHunt.onBugHuntSettingChange()
  });

  game.settings.register(MODULE_ID, UI_LANGUAGE_SETTING, {
    scope: "client",
    config: true,
    type: String,
    default: "default",
    name: game.i18n.localize("SML.Settings.Language.Name"),
    hint: game.i18n.localize("SML.Settings.Language.Hint"),
    choices: {
      default: game.i18n.localize("SML.Language.Default"),
      de: game.i18n.localize("SML.Language.De"),
      en: game.i18n.localize("SML.Language.En")
    },
    onChange: () => {
      void ensureModuleTranslationsLoaded().then(() => refreshLocalizedUi());
    }
  });

  game.settings.register(MODULE_ID, UI_THEME_SETTING, {
    scope: "client",
    config: true,
    type: String,
    default: UI_THEMES.SIGNATURE,
    name: localize("SML.Settings.Theme.Name"),
    hint: localize("SML.Settings.Theme.Hint"),
    choices: {
      [UI_THEMES.SIGNATURE]: localize("SML.Theme.Signature"),
      [UI_THEMES.FOUNDRY]: localize("SML.Theme.Foundry")
    },
    onChange: () => refreshManager()
  });

  game.settings.register(MODULE_ID, CHECK_DISPLAY_SETTING, {
    scope: "world",
    config: true,
    type: String,
    default: CHECK_DISPLAY_MODES.PROBLEMS,
    name: localize("SML.Settings.CheckDisplay.Name"),
    hint: localize("SML.Settings.CheckDisplay.Hint"),
    choices: {
      [CHECK_DISPLAY_MODES.PROBLEMS]: localize("SML.CheckDisplay.Problems"),
      [CHECK_DISPLAY_MODES.ALWAYS]: localize("SML.CheckDisplay.Always")
    }
  });

  game.settings.register(MODULE_ID, CHECK_MARKER_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

  // A running bug hunt holds the error capture. Without it and without a pending check there is nothing
  // to attribute, so the capture ends right here.
  bugHunt.prepareBugHuntCapture();
  if (!startupCheck.readCheckMarker()) startupCheck.stopStartupErrorCapture();

  game.settings.registerMenu(MODULE_ID, "openManager", {
    name: localize("SML.Settings.Menu.Name"),
    label: localize("SML.Settings.Menu.Label"),
    hint: localize("SML.Settings.Menu.Hint"),
    icon: "fa-solid fa-layer-group",
    type: manager.SMLSettingsMenu,
    restricted: true
  });

  game.keybindings.register(MODULE_ID, "openManager", {
    name: localize("SML.Settings.Menu.Label"),
    hint: localize("SML.Settings.Menu.Hint"),
    editable: [
      {
        key: "KeyL",
        modifiers: ["CONTROL", "SHIFT"]
      }
    ],
    precedence: HOTKEY_PRECEDENCE,
    restricted: true,
    onDown: () => {
      manager.openManager();
      return true;
    }
  });

  Hooks.on("renderModuleManagement", (app, html) => {
    manager.injectModuleManagementLauncher(app, html);
  });
});

Hooks.once("ready", async () => {
  void ensureModuleTranslationsLoaded();
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = createApi();
  // Players never see the loadouts, so only users who may open the manager read the installation file.
  if (core.canOpenManager()) {
    try {
      await store.loadInstallationStore();
      await store.migrateBrowserProfiles();
    } catch (error) {
      console.warn(`${MODULE_ID} |`, error);
    }
  }
  bugHunt.resumeBugHunt();
  void startupCheck.runStartupCheck({
    // The gamemaster chose Undo in the check window already, so no second question.
    undo: (snapshot) => apply.applyProfile(snapshot, { confirm: core.CONFIRM_MODES.NEVER }),
    hunt: (errorText) => bugHunt.openBugHuntStart({ pattern: errorText })
  });
});

// The window titles follow the module language too.
function refreshLocalizedUi() {
  manager.getManagerApp()?.render({ window: { title: localize("SML.Title") } });
  foundry.applications.instances?.get?.("sml-bug-hunt")?.render({ window: { title: localize("SML.Hunt.Title") } });
}

function createApi() {
  return {
    openManager: manager.openManager,
    getProfiles: store.getAllProfiles,
    apply: apply.apiApply,
    saveCurrent: apply.apiSaveCurrent,
    compare: apply.apiCompare,
    getPinned: store.getPinnedModuleIds,
    setPinned: store.setPinnedModuleIds,
    bugHunt: (options = {}) => bugHunt.readHuntState() ? bugHunt.openBugHuntPanel() : bugHunt.openBugHuntStart(options)
  };
}

export const __test__ = {
  ...core,
  ...loadoutSettings,
  ...store,
  ...startupCheck,
  ...apply,
  ...bugHunt,
  ...manager,
  refreshLocalizedUi,
  createApi
};
