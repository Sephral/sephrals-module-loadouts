// Constants and helpers every part of Module Loadouts uses: language, design, permissions and module lookups.

export const MODULE_ID = "sephrals-module-loadouts";
export const WORLD_PROFILES_SETTING = "worldProfiles";
export const GLOBAL_PROFILES_SETTING = "globalProfiles";
export const UI_LANGUAGE_SETTING = "uiLanguage";
export const UI_THEME_SETTING = "uiTheme";
export const CHECK_MARKER_SETTING = "pendingCheck";
export const CHECK_DISPLAY_SETTING = "checkResultDisplay";
export const PINNED_MODULES_SETTING = "pinnedModules";
export const INSTALLATION_REVISION_SETTING = "installationRevision";
export const INSTALLATION_MIGRATED_SETTING = "installationMigrated";
export const BUG_HUNT_SETTING = "bugHunt";
export const STORAGE_VERSION = 2;
export const HOTKEY_PRECEDENCE = CONST.KEYBINDING_PRECEDENCE.NORMAL;
export const SUPPORTED_UI_LANGUAGES = Object.freeze(["en", "de"]);
export const DEFAULT_UI_LANGUAGE = "en";
export const PROFILE_SCOPES = Object.freeze({
  WORLD: "world",
  GLOBAL: "global"
});
export const UI_THEMES = Object.freeze({
  SIGNATURE: "signature",
  FOUNDRY: "foundry"
});
export const AUTO_SNAPSHOT_TAG = "auto";
export const MAX_AUTO_SNAPSHOTS = 3;
// "always" is the manager button and the API default, "never" the API's confirm: false.
export const CONFIRM_MODES = Object.freeze({
  ALWAYS: "always",
  NEVER: "never"
});
export const CHECK_DISPLAY_MODES = Object.freeze({
  ALWAYS: "always",
  PROBLEMS: "problems"
});
export const PACKAGE_PAGE_URL = "https://foundryvtt.com/packages/";

const MODULE_TRANSLATION_CACHE = new Map();
let MODULE_TRANSLATION_LOAD = null;

// The manager registers itself here, so the other files can redraw it without importing the window class.
const managerHooks = { refresh: null };

export function setManagerRefresher(refresh) {
  managerHooks.refresh = refresh;
}

export function refreshManager() {
  managerHooks.refresh?.();
}

export function interpolateTemplate(template, data = {}) {
  return String(template ?? "").replace(/\{([^}]+)\}/g, (_match, field) => {
    const replacement = data[field];
    return replacement === undefined || replacement === null ? `{${field}}` : String(replacement);
  });
}

export function localize(key, data = null) {
  const overrideLanguage = getOverrideLanguage();
  const override = overrideLanguage ? MODULE_TRANSLATION_CACHE.get(overrideLanguage)?.[key] : null;
  if (override) return data && Object.keys(data).length ? interpolateTemplate(override, data) : override;
  if (data && Object.keys(data).length) return game.i18n.format(key, data);
  return game.i18n.localize(key);
}

export function escapeHtml(value) {
  const escape = globalThis.foundry?.utils?.escapeHTML ?? ((text) => String(text));
  return escape(String(value ?? ""));
}

// For text that ends up as HTML (dialog content, notifications): the values are escaped,
// so profile names or imported module ids show up literally and never run as markup.
export function localizeHtml(key, data = {}) {
  const escaped = Object.fromEntries(Object.entries(data ?? {}).map(([field, value]) => [field, escapeHtml(value)]));
  return localize(key, escaped);
}

export function getRegisteredSettingValue(settingKey, fallback) {
  const fullKey = `${MODULE_ID}.${settingKey}`;
  if (!game?.settings?.settings?.has(fullKey)) return fallback;

  try {
    return game.settings.get(MODULE_ID, settingKey);
  } catch (_error) {
    return fallback;
  }
}

export function normalizeUiLanguage(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_UI_LANGUAGE;
  if (SUPPORTED_UI_LANGUAGES.includes(normalized)) return normalized;

  const baseLanguage = normalized.split(/[-_.]/)[0];
  return SUPPORTED_UI_LANGUAGES.includes(baseLanguage) ? baseLanguage : DEFAULT_UI_LANGUAGE;
}

export function getPreferredLanguage() {
  return getRegisteredSettingValue(UI_LANGUAGE_SETTING, "default");
}

export function getModuleLanguage(preferredLanguage = getPreferredLanguage()) {
  if (SUPPORTED_UI_LANGUAGES.includes(preferredLanguage)) return preferredLanguage;
  return normalizeUiLanguage(game.i18n?.lang);
}

// Bundled translations only override Foundry's own when a language was picked explicitly,
// so "Follow Foundry" keeps community translations from game.i18n.
export function getOverrideLanguage(preferredLanguage = getPreferredLanguage()) {
  return SUPPORTED_UI_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : null;
}

export function getSortLanguage() {
  return getOverrideLanguage() ?? (game.i18n?.lang || DEFAULT_UI_LANGUAGE);
}

async function loadModuleTranslations(language) {
  const normalized = normalizeUiLanguage(language);
  if (MODULE_TRANSLATION_CACHE.has(normalized)) return MODULE_TRANSLATION_CACHE.get(normalized);

  const response = await fetch(`modules/${MODULE_ID}/lang/${normalized}.json`);
  if (!response.ok) throw new Error(`Failed to load ${normalized} translations (${response.status})`);

  const translations = await response.json();
  MODULE_TRANSLATION_CACHE.set(normalized, translations);
  return translations;
}

export async function ensureModuleTranslationsLoaded() {
  if (!MODULE_TRANSLATION_LOAD) {
    MODULE_TRANSLATION_LOAD = Promise.all(SUPPORTED_UI_LANGUAGES.map((language) => loadModuleTranslations(language)))
      .catch((error) => {
        console.warn(`${MODULE_ID} |`, error);
        return null;
      });
  }

  return MODULE_TRANSLATION_LOAD;
}

export function resetModuleTranslations() {
  MODULE_TRANSLATION_CACHE.clear();
  MODULE_TRANSLATION_LOAD = null;
}

export function normalizeTheme(theme) {
  return theme === UI_THEMES.FOUNDRY ? UI_THEMES.FOUNDRY : UI_THEMES.SIGNATURE;
}

export function getThemePreference() {
  return normalizeTheme(getRegisteredSettingValue(UI_THEME_SETTING, UI_THEMES.SIGNATURE));
}

export function applyManagerTheme(element, theme = getThemePreference()) {
  if (!element) return;

  const resolvedTheme = normalizeTheme(theme);
  element.dataset.uiTheme = resolvedTheme;
  element.classList.toggle("is-theme-foundry", resolvedTheme === UI_THEMES.FOUNDRY);
  element.classList.toggle("is-theme-signature", resolvedTheme !== UI_THEMES.FOUNDRY);

  const root = element.querySelector(".sml-app");
  if (root) root.dataset.uiTheme = resolvedTheme;
}

export function canManageModules() {
  return game.user?.can("SETTINGS_MODIFY") ?? false;
}

// Gamemasters may look at the loadouts even without the module permission (the manager shows a notice then),
// players only with that permission, like the settings menu and the hotkey.
export function canOpenManager() {
  return Boolean(game.user?.isGM) || canManageModules();
}

export function getModuleConfigurationSettingKey() {
  return foundry.applications?.sidebar?.apps?.ModuleManagement?.SETTING ?? "moduleConfiguration";
}

export function getCurrentModuleConfiguration() {
  const key = getModuleConfigurationSettingKey();
  const configuration = game.settings.get("core", key) ?? {};
  return foundry.utils.deepClone(configuration);
}

export function getEnabledModuleIdsFromConfiguration(configuration = {}) {
  return Object.keys(configuration)
    .filter((id) => configuration[id] === true && game.modules.has(id))
    .sort(compareModuleIdsByTitle);
}

export function equalModuleIdLists(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function moduleTitle(moduleId) {
  return game.modules.get(moduleId)?.title ?? moduleId;
}

export function compareModuleIdsByTitle(left, right) {
  return moduleTitle(left).localeCompare(moduleTitle(right), getSortLanguage(), { sensitivity: "base" });
}

export function getCurrentActiveModuleIds() {
  return getEnabledModuleIdsFromConfiguration(getCurrentModuleConfiguration());
}

export function formatList(values) {
  return game.i18n.getListFormatter().format(values);
}

export function formatModuleList(moduleIds) {
  return formatList(moduleIds.map(moduleTitle));
}

export function formatSnapshotDate(date = new Date()) {
  try {
    return date.toLocaleString(getSortLanguage(), { dateStyle: "short", timeStyle: "medium" });
  } catch (_error) {
    return date.toISOString();
  }
}

export function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toLocaleString(getSortLanguage());
}

export function packagePageUrl(moduleId) {
  return `${PACKAGE_PAGE_URL}${encodeURIComponent(moduleId)}`;
}
