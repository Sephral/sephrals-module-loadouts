// Self-test: what Module Loadouts relies on in Foundry, checked with round trips that change nothing.
// Meant to be run after every Foundry update; the gamemaster also gets a notice once when a newer Foundry is installed.

import {
  ACKNOWLEDGED_VERSIONS_SETTING,
  MODULE_ID,
  TESTED_VERSIONS,
  canManageModules,
  ensureModuleTranslationsLoaded,
  escapeHtml,
  getCurrentActiveModuleIds,
  getCurrentModuleConfiguration,
  getModuleConfigurationSettingKey,
  localize
} from "./core.mjs";
import { SETTINGS_MODES, captureLoadoutSettings, collectSettingsChanges } from "./loadout-settings.mjs";
import { createCurrentProfile, getInstallationFileTarget, isInstallationStoreAvailable, loadInstallationStore } from "./store.mjs";
import { buildComparison, collectProfilePreflight } from "./apply.mjs";
import { countFeature } from "./usage.mjs";

const { ApplicationV2 } = foundry.applications.api;

// Runs one check. A check that throws counts as failed and leaves its error in the console.
async function attempt(label, probe) {
  try {
    return Boolean(await probe());
  } catch (error) {
    console.warn(`${MODULE_ID} | Self-test: ${label}`, error);
    return false;
  }
}

export async function checkIntegrations() {
  const problems = [];
  let checks = 0;
  const check = (ok, key, data) => {
    checks += 1;
    if (!ok) problems.push(localize(`SML.SelfTest.${key}`, data));
  };

  const configurationKey = getModuleConfigurationSettingKey();
  check(await attempt("module configuration", () => getCurrentModuleConfiguration()?.[MODULE_ID] === true),
    "Configuration", { key: `core.${configurationKey}` });
  check(typeof foundry.applications?.settings?.SettingsConfig?.reloadConfirm === "function", "Reload");

  // The layers button in Manage Modules hangs on the render hook, which Foundry names after the class.
  check(foundry.applications?.sidebar?.apps?.ModuleManagement?.name === "ModuleManagement", "ModuleManagement");
  check(game.keybindings?.actions?.has?.(`${MODULE_ID}.openManager`) === true, "Hotkey");
  check(game.i18n?.has?.("SML.Title") === true, "Texts");

  // A loadout of the current state has to match the current state, with its required modules resolved.
  check(await attempt("current loadout", () => {
    const profile = createCurrentProfile({ name: "self test" });
    const comparison = buildComparison(profile, { pinnedIds: [] });
    collectProfilePreflight(profile, { pinnedIds: [] });
    return !comparison.toEnable.length && !comparison.toDisable.length;
  }), "CurrentLoadout");

  // The same for settings: what a loadout takes along from this world would change nothing here.
  const settingClass = globalThis.CONFIG?.Setting?.documentClass;
  check(["createDocuments", "updateDocuments", "deleteDocuments"].every((name) => typeof settingClass?.[name] === "function")
    && typeof game.settings?.storage?.get?.("world")?.getSetting === "function", "SettingsStorage");
  check(await attempt("settings round trip", () => {
    const { settings } = captureLoadoutSettings(getCurrentActiveModuleIds(), SETTINGS_MODES.ALL);
    return collectSettingsChanges(settings).length === 0;
  }), "SettingsRoundTrip");

  // Installation loadouts: the file has to be readable, and saving needs the upload permission.
  await attempt("installation file", () => loadInstallationStore({ force: true }));
  check(isInstallationStoreAvailable(), "InstallationRead", { path: getInstallationFileTarget().path });
  check(game.user?.can?.("FILES_UPLOAD") === true, "InstallationUpload");

  // Gamemasters without the permission may look at the loadouts but not apply them.
  check(canManageModules(), "Permission");
  return { problems, checks };
}

// Runs the self-test and reports the result as a notification and a chat message whispered to the user.
export async function runSelfTest({ report = true } = {}) {
  countFeature(MODULE_ID, "selfTestRun");
  await ensureModuleTranslationsLoaded();
  const { problems, checks } = await checkIntegrations();
  const versions = localize("SML.SelfTest.Version", { current: game.version, tested: TESTED_VERSIONS.core });
  const summary = problems.length
    ? localize("SML.SelfTest.Problems", { problems: problems.length, checks })
    : localize("SML.SelfTest.Passed", { checks });

  if (problems.length) ui.notifications.warn(summary, { permanent: true });
  else ui.notifications.info(summary);

  if (report) {
    let content = `<h3>${escapeHtml(localize("SML.SelfTest.Title"))}</h3><p>${escapeHtml(summary)}</p><p><small>${escapeHtml(versions)}</small></p>`;
    if (problems.length) content += `<ul>${problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join("")}</ul>`;
    await ChatMessage.implementation.create({ content, whisper: [game.user.id], speaker: { alias: game.modules.get(MODULE_ID)?.title } });
  }
  return { problems, checks };
}

// Tells the gamemaster once when Foundry is newer than the version the module was verified against.
export function noticeNewVersions() {
  if (!game.user?.isGM || !foundry.utils.isNewerVersion(game.version, TESTED_VERSIONS.core)) return;
  const signature = `core ${game.version}`;
  if (game.settings.get(MODULE_ID, ACKNOWLEDGED_VERSIONS_SETTING) === signature) return;
  void game.settings.set(MODULE_ID, ACKNOWLEDGED_VERSIONS_SETTING, signature);
  ui.notifications.info(localize("SML.SelfTest.NewVersions", { versions: signature }), { permanent: true });
}

// The button in the module settings: runs the self-test instead of opening a window.
export class SMLSelfTestMenu extends ApplicationV2 {
  render() {
    if (game.user?.isGM) void runSelfTest();
    return this;
  }
}
