const MODULE_ID = "sephrals-module-loadouts";
const WORLD_PROFILES_SETTING = "worldProfiles";
const GLOBAL_PROFILES_SETTING = "globalProfiles";
const UI_LANGUAGE_SETTING = "uiLanguage";
const UI_THEME_SETTING = "uiTheme";
const STORAGE_VERSION = 2;
const HOTKEY_PRECEDENCE = CONST.KEYBINDING_PRECEDENCE.NORMAL;
const SUPPORTED_UI_LANGUAGES = Object.freeze(["en", "de"]);
const DEFAULT_UI_LANGUAGE = "en";
const PROFILE_SCOPES = Object.freeze({
  WORLD: "world",
  GLOBAL: "global"
});
const UI_THEMES = Object.freeze({
  SIGNATURE: "signature",
  FOUNDRY: "foundry"
});
const AUTO_SNAPSHOT_TAG = "auto";
const MAX_AUTO_SNAPSHOTS = 3;
// "warnings" is the manager button (ask only when the preflight found something),
// "always" and "never" belong to the API's confirm option.
const CONFIRM_MODES = Object.freeze({
  WARNINGS: "warnings",
  ALWAYS: "always",
  NEVER: "never"
});
const MODULE_TRANSLATION_CACHE = new Map();
let MODULE_TRANSLATION_LOAD = null;

let managerApp = null;

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, WORLD_PROFILES_SETTING, {
    scope: "world",
    config: false,
    type: Object,
    default: defaultStore()
  });

  game.settings.register(MODULE_ID, GLOBAL_PROFILES_SETTING, {
    scope: "client",
    config: false,
    type: Object,
    default: defaultStore()
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
    }
  });

  game.settings.registerMenu(MODULE_ID, "openManager", {
    name: localize("SML.Settings.Menu.Name"),
    label: localize("SML.Settings.Menu.Label"),
    hint: localize("SML.Settings.Menu.Hint"),
    icon: "fa-solid fa-layer-group",
    type: SMLSettingsMenu,
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
      openManager();
      return true;
    }
  });

  Hooks.on("renderModuleManagement", (app, html) => {
    injectModuleManagementLauncher(app, html);
  });
});

Hooks.once("ready", () => {
  void ensureModuleTranslationsLoaded();
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = createApi();
});

function defaultStore() {
  return {
    version: STORAGE_VERSION,
    profiles: []
  };
}

function interpolateTemplate(template, data = {}) {
  return String(template ?? "").replace(/\{([^}]+)\}/g, (_match, field) => {
    const replacement = data[field];
    return replacement === undefined || replacement === null ? `{${field}}` : String(replacement);
  });
}

function localize(key, data = null) {
  const overrideLanguage = getOverrideLanguage();
  const override = overrideLanguage ? MODULE_TRANSLATION_CACHE.get(overrideLanguage)?.[key] : null;
  if (override) return data && Object.keys(data).length ? interpolateTemplate(override, data) : override;
  if (data && Object.keys(data).length) return game.i18n.format(key, data);
  return game.i18n.localize(key);
}

function getRegisteredSettingValue(settingKey, fallback) {
  const fullKey = `${MODULE_ID}.${settingKey}`;
  if (!game?.settings?.settings?.has(fullKey)) return fallback;

  try {
    return game.settings.get(MODULE_ID, settingKey);
  } catch (_error) {
    return fallback;
  }
}

function normalizeUiLanguage(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return DEFAULT_UI_LANGUAGE;
  if (SUPPORTED_UI_LANGUAGES.includes(normalized)) return normalized;

  const baseLanguage = normalized.split(/[-_.]/)[0];
  return SUPPORTED_UI_LANGUAGES.includes(baseLanguage) ? baseLanguage : DEFAULT_UI_LANGUAGE;
}

function getPreferredLanguage() {
  return getRegisteredSettingValue(UI_LANGUAGE_SETTING, "default");
}

function getModuleLanguage(preferredLanguage = getPreferredLanguage()) {
  if (SUPPORTED_UI_LANGUAGES.includes(preferredLanguage)) return preferredLanguage;
  return normalizeUiLanguage(game.i18n?.lang);
}

// Bundled translations only override Foundry's own when a language was picked explicitly,
// so "Follow Foundry" keeps community translations from game.i18n.
function getOverrideLanguage(preferredLanguage = getPreferredLanguage()) {
  return SUPPORTED_UI_LANGUAGES.includes(preferredLanguage) ? preferredLanguage : null;
}

function getSortLanguage() {
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

async function ensureModuleTranslationsLoaded() {
  if (!MODULE_TRANSLATION_LOAD) {
    MODULE_TRANSLATION_LOAD = Promise.all(SUPPORTED_UI_LANGUAGES.map((language) => loadModuleTranslations(language)))
      .catch((error) => {
        console.warn(`${MODULE_ID} |`, error);
        return null;
      });
  }

  return MODULE_TRANSLATION_LOAD;
}

function refreshLocalizedUi() {
  if (!managerApp) return;
  managerApp.options ??= {};
  managerApp.options.title = localize("SML.Title");
  managerApp.render(true);
}

function resetModuleTranslations() {
  MODULE_TRANSLATION_CACHE.clear();
  MODULE_TRANSLATION_LOAD = null;
}

function normalizeTheme(theme) {
  return theme === UI_THEMES.FOUNDRY ? UI_THEMES.FOUNDRY : UI_THEMES.SIGNATURE;
}

function getThemePreference() {
  return normalizeTheme(getRegisteredSettingValue(UI_THEME_SETTING, UI_THEMES.SIGNATURE));
}

function applyManagerTheme(element, theme = getThemePreference()) {
  if (!element) return;

  const resolvedTheme = normalizeTheme(theme);
  element.dataset.uiTheme = resolvedTheme;
  element.classList.toggle("is-theme-foundry", resolvedTheme === UI_THEMES.FOUNDRY);
  element.classList.toggle("is-theme-signature", resolvedTheme !== UI_THEMES.FOUNDRY);

  const root = element.querySelector(".sml-app");
  if (root) root.dataset.uiTheme = resolvedTheme;
}

function injectModuleManagementLauncher(app, html) {
  const contentRoot = html?.[0] ?? html;
  const windowRoot = contentRoot?.closest?.(".window-app, .application") ?? contentRoot;
  if (!windowRoot || windowRoot.querySelector(".sml-module-management-link")) return;

  const header = windowRoot.querySelector(".window-header");
  if (!header) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon fa-solid fa-layer-group sml-module-management-link";
  button.setAttribute("aria-label", localize("SML.Actions.OpenManager"));
  button.setAttribute("title", localize("SML.Actions.OpenManager"));
  button.setAttribute("data-tooltip", localize("SML.Actions.OpenManager"));
  button.addEventListener("click", () => {
    openManager();
  });

  const closeButton = header.querySelector('[data-action="close"]');
  if (closeButton) header.insertBefore(button, closeButton);
  else header.append(button);
}

function openManager() {
  if (!managerApp) managerApp = new SMLLoadoutsManager();
  managerApp.options ??= {};
  managerApp.options.title = localize("SML.Title");
  managerApp.render(true);
  return managerApp;
}

function canManageModules() {
  return game.user?.can("SETTINGS_MODIFY") ?? false;
}

function getModuleConfigurationSettingKey() {
  return foundry.applications?.sidebar?.apps?.ModuleManagement?.SETTING ?? "moduleConfiguration";
}

function getCurrentModuleConfiguration() {
  const key = getModuleConfigurationSettingKey();
  const configuration = game.settings.get("core", key) ?? {};
  return foundry.utils.deepClone(configuration);
}

function getEnabledModuleIdsFromConfiguration(configuration = {}) {
  return Object.keys(configuration)
    .filter((id) => configuration[id] === true && game.modules.has(id))
    .sort(compareModuleIdsByTitle);
}

function equalModuleIdLists(left, right) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function compareModuleIdsByTitle(left, right) {
  return moduleTitle(left).localeCompare(moduleTitle(right), getSortLanguage(), { sensitivity: "base" });
}

function getCurrentActiveModuleIds() {
  return getEnabledModuleIdsFromConfiguration(getCurrentModuleConfiguration());
}

function moduleTitle(moduleId) {
  return game.modules.get(moduleId)?.title ?? moduleId;
}

function scopeLabel(scope) {
  return localize(scope === PROFILE_SCOPES.GLOBAL ? "SML.Scope.Global" : "SML.Scope.World");
}

function isGlobalScope(scope) {
  return scope === PROFILE_SCOPES.GLOBAL;
}

function getStoreSettingKey(scope) {
  return isGlobalScope(scope) ? GLOBAL_PROFILES_SETTING : WORLD_PROFILES_SETTING;
}

function normalizeProfilesStore(store, fallbackScope = PROFILE_SCOPES.WORLD) {
  const profiles = Array.isArray(store?.profiles) ? store.profiles.map((profile) => normalizeProfile(profile, fallbackScope)).filter(Boolean) : [];
  return {
    version: Number(store?.version) || STORAGE_VERSION,
    profiles
  };
}

function normalizeProfile(profile, fallbackScope = PROFILE_SCOPES.WORLD) {
  if (!profile) return null;

  const name = String(profile.name ?? "").trim();
  if (!name) return null;

  const moduleIds = Array.isArray(profile.moduleIds)
    ? profile.moduleIds
    : Array.isArray(profile.modules)
      ? profile.modules
      : [];

  const uniqueModuleIds = Array.from(new Set(moduleIds
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)));

  const tags = Array.isArray(profile.tags)
    ? profile.tags
    : String(profile.tags ?? "").split(",");

  const normalizedScope = isGlobalScope(profile.scope)
    ? PROFILE_SCOPES.GLOBAL
    : profile.scope === PROFILE_SCOPES.WORLD
      ? PROFILE_SCOPES.WORLD
      : fallbackScope;
  const createdAt = String(profile.createdAt ?? new Date().toISOString());
  const updatedAt = String(profile.updatedAt ?? createdAt);

  return {
    id: String(profile.id ?? foundry.utils.randomID()),
    name,
    description: String(profile.description ?? "").trim(),
    tags: Array.from(new Set(tags.map((value) => String(value ?? "").trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right, getSortLanguage(), { sensitivity: "base" })),
    scope: normalizedScope,
    moduleIds: uniqueModuleIds.sort(compareModuleIdsByTitle),
    createdAt,
    updatedAt,
    // Only automatic snapshots carry the flag, regular profiles leave it out.
    ...(profile.auto === true ? { auto: true } : {})
  };
}

function getProfilesForScope(scope) {
  const settingKey = getStoreSettingKey(scope);
  return normalizeProfilesStore(game.settings.get(MODULE_ID, settingKey), scope);
}

function getAllProfiles() {
  return [
    ...getProfilesForScope(PROFILE_SCOPES.GLOBAL).profiles,
    ...getProfilesForScope(PROFILE_SCOPES.WORLD).profiles
  ];
}

async function saveProfilesForScope(scope, profiles) {
  const normalized = profiles.map((profile) => normalizeProfile(profile, scope)).filter(Boolean);
  await game.settings.set(MODULE_ID, getStoreSettingKey(scope), {
    version: STORAGE_VERSION,
    profiles: normalized
  });
}

async function upsertProfile(profile) {
  const normalized = normalizeProfile(profile, profile.scope ?? PROFILE_SCOPES.WORLD);
  const scope = normalized.scope;
  const store = getProfilesForScope(scope);
  const nextProfiles = store.profiles.some((entry) => entry.id === normalized.id)
    ? store.profiles.map((entry) => entry.id === normalized.id ? normalized : entry)
    : [...store.profiles, normalized];
  await saveProfilesForScope(scope, nextProfiles);
}

async function removeProfile(profile) {
  const normalized = normalizeProfile(profile, profile.scope ?? PROFILE_SCOPES.WORLD);
  const store = getProfilesForScope(normalized.scope);
  await saveProfilesForScope(normalized.scope, store.profiles.filter((entry) => entry.id !== normalized.id));
}

function findProfileById(profileId) {
  return getAllProfiles().find((entry) => entry.id === profileId) ?? null;
}

// API lookup: id first, then the name without case. The same name can exist in both scopes,
// the world profile wins then.
function findProfile(idOrName) {
  const key = idOrName && typeof idOrName === "object" ? idOrName.id ?? idOrName.name : idOrName;
  const value = String(key ?? "").trim();
  if (!value) return null;

  const profiles = getAllProfiles();
  const byId = profiles.find((entry) => entry.id === value);
  if (byId) return byId;

  const lowered = value.toLowerCase();
  const byName = profiles.filter((entry) => entry.name.toLowerCase() === lowered);
  return byName.find((entry) => entry.scope === PROFILE_SCOPES.WORLD) ?? byName[0] ?? null;
}

function createCurrentProfile({ name, description = "", tags = [], scope = PROFILE_SCOPES.WORLD, id = null, createdAt = null, auto = false } = {}) {
  const timestamp = new Date().toISOString();
  return normalizeProfile({
    id: id ?? foundry.utils.randomID(),
    name,
    description,
    tags,
    scope,
    moduleIds: getCurrentActiveModuleIds(),
    createdAt: createdAt ?? timestamp,
    updatedAt: timestamp,
    auto
  }, scope);
}

// Keeps the newest automatic snapshots. On equal timestamps the later list entry counts as newer.
function pruneAutoSnapshots(profiles, limit = MAX_AUTO_SNAPSHOTS) {
  const keep = new Set(profiles
    .map((profile, index) => ({ profile, index }))
    .filter(({ profile }) => profile.auto === true)
    .sort((left, right) => String(right.profile.createdAt).localeCompare(String(left.profile.createdAt)) || right.index - left.index)
    .slice(0, limit)
    .map(({ profile }) => profile.id));
  return profiles.filter((profile) => profile.auto !== true || keep.has(profile.id));
}

function formatSnapshotDate(date = new Date()) {
  try {
    return date.toLocaleString(getSortLanguage(), { dateStyle: "short", timeStyle: "medium" });
  } catch (_error) {
    return date.toISOString();
  }
}

// Undo for "apply": the module state before the switch is stored as a world profile. Applying a
// snapshot creates the next one, the cap keeps that chain at MAX_AUTO_SNAPSHOTS entries.
async function saveAutoSnapshot(appliedProfile) {
  const snapshot = createCurrentProfile({
    name: localize("SML.Snapshot.Name", { date: formatSnapshotDate() }),
    description: localize("SML.Snapshot.Description", { name: appliedProfile.name }),
    tags: [AUTO_SNAPSHOT_TAG],
    scope: PROFILE_SCOPES.WORLD,
    auto: true
  });
  const store = getProfilesForScope(PROFILE_SCOPES.WORLD);
  await saveProfilesForScope(PROFILE_SCOPES.WORLD, pruneAutoSnapshots([...store.profiles, snapshot]));
  return snapshot;
}

// Editing or duplicating a snapshot turns it into a regular profile that is never pruned.
function asRegularProfile(profile) {
  if (profile?.auto !== true) return profile;
  const { auto: _auto, ...regular } = profile;
  return { ...regular, tags: (profile.tags ?? []).filter((tag) => tag !== AUTO_SNAPSHOT_TAG) };
}

// User profiles by name, automatic snapshots after them with the newest first.
function sortProfilesForDisplay(profiles) {
  const byName = (left, right) => left.name.localeCompare(right.name, getSortLanguage(), { sensitivity: "base" });
  const byNewest = (left, right) => String(right.createdAt).localeCompare(String(left.createdAt));
  return [
    ...profiles.filter((profile) => profile.auto !== true).sort(byName),
    ...profiles.filter((profile) => profile.auto === true).sort(byNewest)
  ];
}

function collectProfileTags(profiles) {
  const tags = new Map();
  for (const tag of profiles.flatMap((profile) => profile.tags ?? [])) {
    const key = tag.toLowerCase();
    if (!tags.has(key)) tags.set(key, tag);
  }
  return Array.from(tags.values()).sort((left, right) => left.localeCompare(right, getSortLanguage(), { sensitivity: "base" }));
}

function profileMatchesFilter(profile, { search = "", tag = null } = {}) {
  if (tag && !(profile.tags ?? []).some((entry) => entry.toLowerCase() === tag.toLowerCase())) return false;
  const needle = String(search ?? "").trim().toLowerCase();
  if (!needle) return true;
  return [profile.name, profile.description, ...(profile.tags ?? [])].join("\n").toLowerCase().includes(needle);
}

function buildComparison(profile) {
  const currentSet = new Set(getCurrentActiveModuleIds());
  const desiredInstalled = profile.moduleIds.filter((id) => game.modules.has(id));
  const desiredSet = new Set(desiredInstalled);
  const matches = desiredInstalled.filter((id) => currentSet.has(id));
  const toEnable = desiredInstalled.filter((id) => !currentSet.has(id));
  const toDisable = Array.from(currentSet).filter((id) => id !== MODULE_ID && !desiredSet.has(id));
  const missing = profile.moduleIds.filter((id) => !game.modules.has(id));

  return {
    matches,
    toEnable,
    toDisable,
    missing
  };
}

function asTitleList(moduleIds) {
  if (!moduleIds.length) return "-";
  return moduleIds.map(moduleTitle).join(", ");
}

function asTagList(tags) {
  if (!tags?.length) return "";
  return tags.join(", ");
}

function getModuleCompatibilityState(module) {
  if (!module) return { blocking: false, warning: false, label: "" };
  const availability = Number(module.availability ?? 0);
  const codes = CONST.PACKAGE_AVAILABILITY_CODES ?? {};
  const blockingStates = new Set([codes.REQUIRES_CORE_DOWNGRADE, codes.REQUIRES_CORE_UPGRADE, codes.REQUIRES_SYSTEM, codes.REQUIRES_DEPENDENCY, codes.MISSING_SYSTEM, codes.MISSING_DEPENDENCY]);
  const warningStates = new Set([codes.UNVERIFIED_GENERATION, codes.UNVERIFIED_SYSTEM, codes.UNVERIFIED_BUILD]);
  return {
    blocking: blockingStates.has(availability) || Boolean(module.unavailable),
    warning: warningStates.has(availability),
    label: module?.availabilityLabel ?? module?.availabilityError ?? ""
  };
}

function resolveRequiredModules(moduleId, desiredIds, autoEnabledTitles, blockingDetails, warningDetails, compatibilityWarnings, visited = new Set()) {
  if (visited.has(moduleId)) return;
  visited.add(moduleId);

  const module = game.modules.get(moduleId);
  if (!module) return;

  for (const requirement of Array.from(module.relationships?.requires ?? [])) {
    if (requirement.type && requirement.type !== "module") continue;

    const dependency = game.modules.get(requirement.id);
    if (!dependency || dependency.unavailable) {
      blockingDetails.push(`${module.title} -> ${requirement.id}`);
      continue;
    }

    const dependencyCompatibility = getModuleCompatibilityState(dependency);
    if (dependencyCompatibility.blocking) {
      blockingDetails.push(`${module.title} -> ${dependency.title}: ${dependencyCompatibility.label || localize("SML.Manager.AvailabilityBlocked")}`);
      continue;
    }

    if (dependencyCompatibility.warning) {
      compatibilityWarnings.push(`${dependency.title}: ${dependencyCompatibility.label || localize("SML.Manager.AvailabilityWarning")}`);
    }

    if (requirement.compatibility) {
      const version = dependency.version;
      const compatibility = requirement.compatibility;
      if (compatibility.minimum && foundry.utils.isNewerVersion(compatibility.minimum, version)) {
        blockingDetails.push(`${module.title} -> ${dependency.title} >= ${compatibility.minimum}`);
        continue;
      }
      if (compatibility.maximum && foundry.utils.isNewerVersion(version, compatibility.maximum)) {
        blockingDetails.push(`${module.title} -> ${dependency.title} <= ${compatibility.maximum}`);
        continue;
      }
      if (compatibility.verified && foundry.utils.isNewerVersion(version, compatibility.verified)) {
        warningDetails.push(`${module.title} -> ${dependency.title} ${localize("SML.Manager.VerifiedWarningSuffix", { version: compatibility.verified })}`);
      }
    }

    if (!desiredIds.has(dependency.id)) autoEnabledTitles.add(dependency.title);
    desiredIds.add(dependency.id);
    resolveRequiredModules(dependency.id, desiredIds, autoEnabledTitles, blockingDetails, warningDetails, compatibilityWarnings, visited);
  }
}

function collectProfilePreflight(profile) {
  const desiredIds = new Set();
  const missingModules = [];
  const autoEnabledTitles = new Set();
  const blockingDependencies = [];
  const warningDetails = [];
  const compatibilityWarnings = [];

  for (const moduleId of profile.moduleIds) {
    const module = game.modules.get(moduleId);
    if (!module) {
      missingModules.push(moduleId);
      continue;
    }

    desiredIds.add(moduleId);
    const compatibility = getModuleCompatibilityState(module);
    if (compatibility.blocking) blockingDependencies.push(`${module.title}: ${compatibility.label || localize("SML.Manager.AvailabilityBlocked")}`);
    else if (compatibility.warning) compatibilityWarnings.push(`${module.title}: ${compatibility.label || localize("SML.Manager.AvailabilityWarning")}`);
  }

  for (const moduleId of Array.from(desiredIds)) {
    resolveRequiredModules(moduleId, desiredIds, autoEnabledTitles, blockingDependencies, warningDetails, compatibilityWarnings);
  }

  desiredIds.add(MODULE_ID);

  return {
    desiredIds,
    missingModules,
    autoEnabledTitles,
    blockingDependencies,
    warningDetails,
    compatibilityWarnings
  };
}

function presentProfile(profile) {
  const comparison = buildComparison(profile);
  const preflight = collectProfilePreflight(profile);
  const updatedDate = new Date(profile.updatedAt);
  const updatedAtLabel = Number.isNaN(updatedDate.getTime()) ? profile.updatedAt : updatedDate.toLocaleString(getSortLanguage());

  return {
    ...profile,
    scopeLabel: scopeLabel(profile.scope),
    tagsLabel: asTagList(profile.tags),
    moduleCount: profile.moduleIds.length,
    matchesCount: comparison.matches.length,
    toEnableCount: comparison.toEnable.length,
    toDisableCount: comparison.toDisable.length,
    missingCount: comparison.missing.length,
    autoEnableCount: preflight.autoEnabledTitles.size,
    warningCount: preflight.warningDetails.length + preflight.compatibilityWarnings.length,
    blockingCount: preflight.blockingDependencies.length,
    matchingTitles: asTitleList(comparison.matches),
    enableTitles: asTitleList(comparison.toEnable),
    disableTitles: asTitleList(comparison.toDisable),
    missingTitles: asTitleList(comparison.missing),
    autoEnableTitles: Array.from(preflight.autoEnabledTitles).join(", ") || "-",
    warningTitles: [...preflight.warningDetails, ...preflight.compatibilityWarnings].join("\n") || "-",
    blockingTitles: preflight.blockingDependencies.join("\n") || "-",
    isAuto: profile.auto === true,
    hasModuleDetails: comparison.toEnable.length + comparison.toDisable.length + comparison.missing.length > 0,
    enableList: comparison.toEnable.map(moduleTitle),
    disableList: comparison.toDisable.map(moduleTitle),
    missingList: comparison.missing.map(moduleTitle),
    updatedAtLabel,
    modulesBadge: localize("SML.Manager.ModulesBadge", { count: profile.moduleIds.length }),
    matchesBadge: localize("SML.Manager.MatchesBadge", { count: comparison.matches.length }),
    enableBadge: localize("SML.Manager.EnableBadge", { count: comparison.toEnable.length }),
    disableBadge: localize("SML.Manager.DisableBadge", { count: comparison.toDisable.length }),
    missingBadge: localize("SML.Manager.MissingBadge", { count: comparison.missing.length }),
    autoEnableBadge: localize("SML.Manager.AutoEnableBadge", { count: preflight.autoEnabledTitles.size }),
    warningBadge: localize("SML.Manager.WarningBadge", {
      count: preflight.warningDetails.length + preflight.compatibilityWarnings.length
    }),
    blockingBadge: localize("SML.Manager.BlockingBadge", { count: preflight.blockingDependencies.length }),
    updatedAtText: localize("SML.Manager.UpdatedAt", { updatedAt: updatedAtLabel })
  };
}

function getManagerTemplateStrings({ worldName, currentActiveCount, worldCount, globalCount }) {
  return {
    eyebrow: localize("SML.Manager.Eyebrow"),
    title: localize("SML.Title"),
    summary: localize("SML.Manager.Summary", { world: worldName, count: currentActiveCount }),
    scopeSummary: localize("SML.Manager.ScopeSummary", { worldCount, globalCount }),
    activeModulesStat: localize("SML.Manager.ActiveModulesStat"),
    loadoutsStat: localize("SML.Manager.LoadoutsStat"),
    controlsTitle: localize("SML.Manager.ControlsTitle"),
    controlsHint: localize("SML.Manager.ControlsHint"),
    saveCurrent: localize("SML.Actions.SaveCurrent"),
    export: localize("SML.Actions.Export"),
    import: localize("SML.Actions.Import"),
    permissionWarning: localize("SML.Manager.PermissionWarning"),
    apply: localize("SML.Actions.Apply"),
    edit: localize("SML.Actions.Edit"),
    duplicate: localize("SML.Actions.Duplicate"),
    delete: localize("SML.Actions.Delete"),
    emptyTitle: localize("SML.Manager.EmptyTitle"),
    emptyBody: localize("SML.Manager.EmptyBody"),
    searchLabel: localize("SML.Filter.SearchLabel"),
    searchPlaceholder: localize("SML.Filter.SearchPlaceholder"),
    tagFilterLabel: localize("SML.Filter.TagsLabel"),
    filterEmpty: localize("SML.Filter.Empty"),
    moduleDetails: localize("SML.Manager.Details.Summary"),
    detailsEnable: localize("SML.Manager.Details.Enable"),
    detailsDisable: localize("SML.Manager.Details.Disable"),
    detailsMissing: localize("SML.Manager.Details.Missing"),
    autoBadge: localize("SML.Manager.AutoBadge"),
    autoHint: localize("SML.Manager.AutoHint", { count: MAX_AUTO_SNAPSHOTS })
  };
}

function formatModuleList(moduleIds) {
  return game.i18n.getListFormatter().format(moduleIds.map(moduleTitle));
}

function renderPreflightSection(label, items) {
  if (!items.length) return "";
  const entries = items
    .map((item) => `<li>${foundry.utils.escapeHTML(String(item))}</li>`)
    .join("");
  return `<section><p><strong>${label}</strong></p><ul>${entries}</ul></section>`;
}

function renderPreflightSections(preflight) {
  const parts = [];
  if (preflight.autoEnabledTitles.size) {
    parts.push(renderPreflightSection(localize("SML.Dialog.Preflight.AutoEnable"), Array.from(preflight.autoEnabledTitles)));
  }
  if (preflight.warningDetails.length) {
    parts.push(renderPreflightSection(localize("SML.Dialog.Preflight.DependencyWarnings"), preflight.warningDetails));
  }
  if (preflight.compatibilityWarnings.length) {
    parts.push(renderPreflightSection(localize("SML.Dialog.Preflight.CompatibilityWarnings"), preflight.compatibilityWarnings));
  }
  if (preflight.missingModules.length) {
    parts.push(renderPreflightSection(localize("SML.Dialog.Preflight.MissingModules"), preflight.missingModules.map(moduleTitle)));
  }
  return parts;
}

async function confirmProfileApplication(profile, preflight) {
  const parts = renderPreflightSections(preflight);
  if (!parts.length) return true;

  return Dialog.confirm({
    title: localize("SML.Dialog.Preflight.Title", { name: profile.name }),
    content: parts.join("")
  });
}

// API confirmation: always asks and lists the real switch, dependencies included.
async function confirmProfileChanges(profile, preflight, { enableIds, disableIds }) {
  const parts = [
    `<p>${localize("SML.Dialog.ConfirmApply.Snapshot")}</p>`,
    renderPreflightSection(localize("SML.Dialog.ConfirmApply.Enable"), enableIds.map(moduleTitle)),
    renderPreflightSection(localize("SML.Dialog.ConfirmApply.Disable"), disableIds.map(moduleTitle)),
    ...renderPreflightSections(preflight)
  ];

  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: localize("SML.Dialog.Preflight.Title", { name: profile.name }) },
    content: parts.join(""),
    yes: { label: localize("SML.Actions.Apply"), icon: "fa-solid fa-bolt" },
    modal: true,
    rejectClose: false
  });
  return confirmed === true;
}

async function applyProfile(profile, { confirm = CONFIRM_MODES.WARNINGS } = {}) {
  if (!canManageModules()) {
    ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
    return false;
  }

  const preflight = collectProfilePreflight(profile);
  if (preflight.blockingDependencies.length) {
    ui.notifications?.error(localize("SML.Notification.BlockingDependencies", {
      details: game.i18n.getListFormatter().format(preflight.blockingDependencies)
    }));
    return false;
  }

  const oldSettings = getCurrentModuleConfiguration();
  const newSettings = {};
  for (const moduleId of preflight.desiredIds) {
    if (game.modules.has(moduleId)) newSettings[moduleId] = true;
  }

  const oldIds = getEnabledModuleIdsFromConfiguration(oldSettings);
  const newIds = getEnabledModuleIdsFromConfiguration(newSettings);
  if (equalModuleIdLists(oldIds, newIds)) {
    ui.notifications?.info(localize("SML.Notification.NoChanges"));
    return false;
  }

  let confirmed = true;
  if (confirm === CONFIRM_MODES.ALWAYS) {
    confirmed = await confirmProfileChanges(profile, preflight, {
      enableIds: newIds.filter((id) => !oldIds.includes(id)),
      disableIds: oldIds.filter((id) => !newIds.includes(id))
    });
  } else if (confirm !== CONFIRM_MODES.NEVER) {
    confirmed = await confirmProfileApplication(profile, preflight);
  }
  if (!confirmed) return false;

  // Saved before the reload prompt so a quick reload cannot skip it.
  const snapshot = await saveAutoSnapshot(profile);
  foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
  await game.settings.set("core", getModuleConfigurationSettingKey(), newSettings);
  ui.notifications?.info(localize("SML.Notification.ProfileApplied", { name: profile.name }));
  ui.notifications?.info(localize("SML.Notification.SnapshotSaved", { name: snapshot.name }));

  if (preflight.autoEnabledTitles.size) {
    ui.notifications?.info(localize("SML.Notification.DependencyAutoEnabled", {
      modules: game.i18n.getListFormatter().format(Array.from(preflight.autoEnabledTitles))
    }));
  }

  if (preflight.missingModules.length) {
    ui.notifications?.warn(localize("SML.Notification.MissingModules", {
      modules: formatModuleList(preflight.missingModules)
    }));
  }

  if (preflight.warningDetails.length || preflight.compatibilityWarnings.length) {
    ui.notifications?.warn(localize("SML.Notification.ApplyWarnings", {
      details: game.i18n.getListFormatter().format([...preflight.warningDetails, ...preflight.compatibilityWarnings])
    }));
  }

  return true;
}

function findProfileOrWarn(idOrName) {
  const profile = findProfile(idOrName);
  if (!profile) {
    const name = idOrName && typeof idOrName === "object" ? idOrName.name ?? idOrName.id : idOrName;
    ui.notifications?.warn(localize("SML.Notification.ProfileNotFound", { name: String(name ?? "") }));
  }
  return profile;
}

// Macro entry point. confirm: false skips the dialog, blocking dependencies still stop the switch.
async function apiApply(idOrName, { confirm = true } = {}) {
  const profile = findProfileOrWarn(idOrName);
  if (!profile) return false;
  return applyProfile(profile, { confirm: confirm ? CONFIRM_MODES.ALWAYS : CONFIRM_MODES.NEVER });
}

// Same as the manager's save button, but a profile with the same name in that scope is replaced without asking.
async function apiSaveCurrent(name, { scope = PROFILE_SCOPES.WORLD, description = "", tags = [] } = {}) {
  if (!canManageModules()) {
    ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
    return null;
  }

  const profileName = String(name ?? "").trim();
  if (!profileName) {
    ui.notifications?.warn(localize("SML.Notification.NameRequired"));
    return null;
  }

  const targetScope = isGlobalScope(scope) ? PROFILE_SCOPES.GLOBAL : PROFILE_SCOPES.WORLD;
  const existing = getProfilesForScope(targetScope).profiles
    .find((profile) => profile.name.toLowerCase() === profileName.toLowerCase());
  const profile = createCurrentProfile({
    name: profileName,
    description,
    tags,
    scope: targetScope,
    id: existing?.id ?? null,
    createdAt: existing?.createdAt ?? null
  });

  await upsertProfile(profile);
  ui.notifications?.info(localize("SML.Notification.ProfileSaved", { name: profile.name }));
  managerApp?.render(false);
  return profile;
}

function apiCompare(idOrName) {
  const profile = findProfileOrWarn(idOrName);
  if (!profile) return null;
  const { toEnable, toDisable, missing } = buildComparison(profile);
  return { toEnable, toDisable, missing };
}

function createApi() {
  return {
    openManager,
    getProfiles: getAllProfiles,
    apply: apiApply,
    saveCurrent: apiSaveCurrent,
    compare: apiCompare
  };
}

function exportProfiles() {
  const payload = {
    module: MODULE_ID,
    formatVersion: STORAGE_VERSION,
    exportedAt: new Date().toISOString(),
    worldId: game.world?.id ?? null,
    worldTitle: game.world?.title ?? game.world?.id ?? null,
    profiles: getAllProfiles()
  };

  const filename = localize("SML.Export.FileName", { worldId: game.world?.id ?? "world" });
  foundry.utils.saveDataToFile(JSON.stringify(payload, null, 2), "application/json", filename);
}

async function importProfilesFromFile(file) {
  const text = await foundry.utils.readTextFromFile(file);
  let data;
  try {
    data = JSON.parse(text);
  } catch (_error) {
    throw new Error(localize("SML.Import.Invalid"));
  }
  const importedProfiles = normalizeProfilesStore(data, PROFILE_SCOPES.GLOBAL).profiles;
  if (!importedProfiles.length) throw new Error(localize("SML.Import.Invalid"));

  const grouped = {
    [PROFILE_SCOPES.WORLD]: Array.from(getProfilesForScope(PROFILE_SCOPES.WORLD).profiles),
    [PROFILE_SCOPES.GLOBAL]: Array.from(getProfilesForScope(PROFILE_SCOPES.GLOBAL).profiles)
  };
  let added = 0;
  let replaced = 0;

  for (const imported of importedProfiles) {
    const scope = imported.scope ?? PROFILE_SCOPES.GLOBAL;
    const bucket = grouped[scope];
    const index = bucket.findIndex((profile) => (profile.id === imported.id)
      || (profile.name.toLowerCase() === imported.name.toLowerCase()));

    if (index >= 0) {
      bucket[index] = normalizeProfile({
        ...bucket[index],
        ...imported,
        createdAt: bucket[index].createdAt ?? imported.createdAt,
        scope
      }, scope);
      replaced += 1;
    } else {
      bucket.push(normalizeProfile(imported, scope));
      added += 1;
    }
  }

  await saveProfilesForScope(PROFILE_SCOPES.WORLD, grouped[PROFILE_SCOPES.WORLD]);
  await saveProfilesForScope(PROFILE_SCOPES.GLOBAL, grouped[PROFILE_SCOPES.GLOBAL]);
  ui.notifications?.info(localize("SML.Notification.Imported", {
    count: importedProfiles.length,
    added,
    replaced
  }));
}

class SMLSettingsMenu extends FormApplication {
  render() {
    openManager();
    return this;
  }

  async _updateObject() {}
}

class SMLLoadoutsManager extends FormApplication {
  // Filter and open details live on the instance, so they survive re-renders until the window closes.
  #filter = { search: "", tag: null };
  #openDetails = new Set();
  #profiles = new Map();

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: MODULE_ID,
      title: localize("SML.Title"),
      template: `modules/${MODULE_ID}/templates/loadouts-manager.html`,
      classes: ["standard-form", "sml-window"],
      width: 940,
      height: 760,
      resizable: true,
      closeOnSubmit: false,
      submitOnClose: false
    });
  }

  async close(options = {}) {
    const result = await super.close(options);
    if (managerApp === this) managerApp = null;
    return result;
  }

  getData() {
    const profiles = sortProfilesForDisplay(getAllProfiles())
      .map((profile) => ({ ...presentProfile(profile), detailsOpen: this.#openDetails.has(profile.id) }));
    this.#profiles = new Map(profiles.map((profile) => [profile.id, profile]));

    const tags = collectProfileTags(profiles);
    if (this.#filter.tag && !tags.includes(this.#filter.tag)) this.#filter.tag = null;
    const uiTheme = getThemePreference();
    const currentActiveCount = getCurrentActiveModuleIds().length;
    const globalCount = getProfilesForScope(PROFILE_SCOPES.GLOBAL).profiles.length;
    const worldCount = getProfilesForScope(PROFILE_SCOPES.WORLD).profiles.length;
    const worldName = game.world?.title ?? game.world?.id ?? "-";

    return {
      strings: getManagerTemplateStrings({
        worldName,
        currentActiveCount,
        worldCount,
        globalCount
      }),
      canManage: canManageModules(),
      hasProfiles: profiles.length > 0,
      profiles,
      currentActiveCount,
      worldName,
      globalCount,
      worldCount,
      loadoutCount: profiles.length,
      filterSearch: this.#filter.search,
      tagFilters: tags.map((tag) => ({ value: tag, active: tag === this.#filter.tag })),
      uiTheme
    };
  }

  #applyFilter(root) {
    let visibleCount = 0;
    for (const card of root.querySelectorAll(".sml-profile-card")) {
      const profile = this.#profiles.get(card.dataset.profileId);
      const visible = !profile || profileMatchesFilter(profile, this.#filter);
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    }

    for (const chip of root.querySelectorAll('[data-action="filter-tag"]')) {
      const active = chip.dataset.tag === this.#filter.tag;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    }

    const empty = root.querySelector(".sml-filter-empty");
    if (empty) empty.hidden = visibleCount > 0 || this.#profiles.size === 0;
  }

  async _render(force, options) {
    await super._render(force, options);
    applyManagerTheme(this.element?.[0]);
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    applyManagerTheme(this.element?.[0], root.dataset.uiTheme ?? getThemePreference());

    root.querySelector('[data-action="save-current"]')?.addEventListener("click", () => {
      void this.#onSaveCurrent();
    });

    root.querySelector('[data-action="export-profiles"]')?.addEventListener("click", () => {
      exportProfiles();
    });

    root.querySelector('[data-action="import-profiles"]')?.addEventListener("click", () => {
      root.querySelector('[data-action="import-file"]')?.click();
    });

    root.querySelector('[data-action="import-file"]')?.addEventListener("change", (event) => {
      void this.#onImport(event);
    });

    for (const button of root.querySelectorAll('[data-action="apply-profile"]')) {
      button.addEventListener("click", () => {
        void this.#onApply(button.dataset.profileId);
      });
    }

    for (const button of root.querySelectorAll('[data-action="delete-profile"]')) {
      button.addEventListener("click", () => {
        void this.#onDelete(button.dataset.profileId);
      });
    }

    for (const button of root.querySelectorAll('[data-action="edit-profile"]')) {
      button.addEventListener("click", () => {
        void this.#onEdit(button.dataset.profileId);
      });
    }

    for (const button of root.querySelectorAll('[data-action="duplicate-profile"]')) {
      button.addEventListener("click", () => {
        void this.#onDuplicate(button.dataset.profileId);
      });
    }

    // Filtering hides cards in place instead of re-rendering, so the search box keeps its focus.
    const search = root.querySelector('[data-action="filter-search"]');
    search?.addEventListener("input", () => {
      this.#filter.search = search.value ?? "";
      this.#applyFilter(root);
    });
    search?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
    });

    for (const chip of root.querySelectorAll('[data-action="filter-tag"]')) {
      chip.addEventListener("click", () => {
        this.#filter.tag = this.#filter.tag === chip.dataset.tag ? null : chip.dataset.tag;
        this.#applyFilter(root);
      });
    }

    for (const details of root.querySelectorAll(".sml-profile-details")) {
      details.addEventListener("toggle", () => {
        if (details.open) this.#openDetails.add(details.dataset.profileId);
        else this.#openDetails.delete(details.dataset.profileId);
      });
    }

    this.#applyFilter(root);
  }

  async #promptProfileData(profile = null, duplicate = false) {
    const initial = profile ?? {
      name: "",
      description: "",
      tags: [],
      scope: PROFILE_SCOPES.WORLD
    };

    const dialogTitle = duplicate
      ? localize("SML.Dialog.Duplicate.Title", { name: initial.name })
      : profile
        ? localize("SML.Dialog.Edit.Title", { name: initial.name })
        : localize("SML.Dialog.SaveCurrent.Title");

    const result = await Dialog.prompt({
      title: dialogTitle,
      content: `
        <form>
          <div class="form-group">
            <label>${localize("SML.Dialog.Profile.Name")}</label>
            <input type="text" name="profileName" value="${foundry.utils.escapeHTML(duplicate ? `${initial.name} Copy` : initial.name)}" autofocus>
          </div>
          <div class="form-group">
            <label>${localize("SML.Dialog.Profile.Description")}</label>
            <input type="text" name="profileDescription" value="${foundry.utils.escapeHTML(initial.description ?? "")}">
          </div>
          <div class="form-group">
            <label>${localize("SML.Dialog.Profile.Tags")}</label>
            <input type="text" name="profileTags" value="${foundry.utils.escapeHTML((initial.tags ?? []).join(", "))}" placeholder="prep, live, debug">
          </div>
          <div class="form-group">
            <label>${localize("SML.Dialog.Profile.Scope")}</label>
            <select name="profileScope">
              <option value="${PROFILE_SCOPES.WORLD}" ${initial.scope === PROFILE_SCOPES.WORLD ? "selected" : ""}>${localize("SML.Scope.World")}</option>
              <option value="${PROFILE_SCOPES.GLOBAL}" ${initial.scope === PROFILE_SCOPES.GLOBAL ? "selected" : ""}>${localize("SML.Scope.Global")}</option>
            </select>
          </div>
        </form>
      `,
      label: localize("SML.Dialog.Profile.Submit"),
      callback: (dialogHtml) => ({
        name: dialogHtml.find('input[name="profileName"]').val()?.trim(),
        description: dialogHtml.find('input[name="profileDescription"]').val()?.trim() ?? "",
        tags: dialogHtml.find('input[name="profileTags"]').val()?.trim() ?? "",
        scope: dialogHtml.find('select[name="profileScope"]').val()?.trim() ?? PROFILE_SCOPES.WORLD
      })
    });

    const name = String(result?.name ?? "").trim();
    if (!name) return null;

    return {
      name,
      description: String(result?.description ?? "").trim(),
      tags: String(result?.tags ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      scope: isGlobalScope(result?.scope) ? PROFILE_SCOPES.GLOBAL : PROFILE_SCOPES.WORLD
    };
  }

  async #onSaveCurrent() {
    const result = await this.#promptProfileData();
    if (!result) return;

    const targetStore = getProfilesForScope(result.scope);
    const existing = targetStore.profiles.find((profile) => profile.name.toLowerCase() === result.name.toLowerCase());
    if (existing) {
      const confirmed = await Dialog.confirm({
        title: localize("SML.Dialog.Replace.Title"),
        content: `<p>${localize("SML.Dialog.Replace.Content", { name: existing.name })}</p>`
      });
      if (!confirmed) return;
    }

    const profile = createCurrentProfile({
      name: result.name,
      description: result.description,
      tags: result.tags,
      scope: result.scope,
      id: existing?.id ?? null,
      createdAt: existing?.createdAt ?? null
    });

    if (existing && existing.scope !== profile.scope) await removeProfile(existing);
    await upsertProfile(profile);
    ui.notifications?.info(localize("SML.Notification.ProfileSaved", { name: profile.name }));
    this.render(false);
  }

  async #onEdit(profileId) {
    const existing = findProfileById(profileId);
    if (!existing) return;
    const result = await this.#promptProfileData(asRegularProfile(existing), false);
    if (!result) return;

    const updated = normalizeProfile({
      ...asRegularProfile(existing),
      ...result,
      updatedAt: new Date().toISOString()
    }, result.scope);

    if (existing.scope !== updated.scope) await removeProfile(existing);
    await upsertProfile(updated);
    ui.notifications?.info(localize("SML.Notification.ProfileSaved", { name: updated.name }));
    this.render(false);
  }

  async #onDuplicate(profileId) {
    const source = findProfileById(profileId);
    if (!source) return;
    const result = await this.#promptProfileData(asRegularProfile(source), true);
    if (!result) return;

    const duplicated = normalizeProfile({
      ...asRegularProfile(source),
      id: foundry.utils.randomID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...result
    }, result.scope);

    await upsertProfile(duplicated);
    ui.notifications?.info(localize("SML.Notification.ProfileSaved", { name: duplicated.name }));
    this.render(false);
  }

  async #onApply(profileId) {
    const profile = findProfileById(profileId);
    if (!profile) return;
    await applyProfile(profile);
    this.render(false);
  }

  async #onDelete(profileId) {
    const profile = findProfileById(profileId);
    if (!profile) return;

    const confirmed = await Dialog.confirm({
      title: localize("SML.Dialog.Delete.Title"),
      content: `<p>${localize("SML.Dialog.Delete.Content", { name: profile.name })}</p>`
    });
    if (!confirmed) return;

    await removeProfile(profile);
    ui.notifications?.info(localize("SML.Notification.ProfileDeleted", { name: profile.name }));
    this.render(false);
  }

  async #onImport(event) {
    const input = event.currentTarget;
    const file = input?.files?.[0];
    if (!file) return;

    try {
      await importProfilesFromFile(file);
      this.render(false);
    } catch (error) {
      ui.notifications?.error(localize("SML.Notification.ImportFailed", {
        message: error?.message ?? error
      }));
    } finally {
      input.value = "";
    }
  }

  async _updateObject() {}
}

export const __test__ = {
  MODULE_ID,
  WORLD_PROFILES_SETTING,
  GLOBAL_PROFILES_SETTING,
  UI_LANGUAGE_SETTING,
  UI_THEME_SETTING,
  STORAGE_VERSION,
  HOTKEY_PRECEDENCE,
  SUPPORTED_UI_LANGUAGES,
  PROFILE_SCOPES,
  UI_THEMES,
  AUTO_SNAPSHOT_TAG,
  MAX_AUTO_SNAPSHOTS,
  CONFIRM_MODES,
  defaultStore,
  localize,
  getRegisteredSettingValue,
  normalizeUiLanguage,
  getPreferredLanguage,
  getModuleLanguage,
  getOverrideLanguage,
  getSortLanguage,
  ensureModuleTranslationsLoaded,
  refreshLocalizedUi,
  resetModuleTranslations,
  normalizeTheme,
  getThemePreference,
  applyManagerTheme,
  injectModuleManagementLauncher,
  openManager,
  canManageModules,
  getModuleConfigurationSettingKey,
  getCurrentModuleConfiguration,
  getEnabledModuleIdsFromConfiguration,
  equalModuleIdLists,
  compareModuleIdsByTitle,
  getCurrentActiveModuleIds,
  moduleTitle,
  scopeLabel,
  isGlobalScope,
  getStoreSettingKey,
  normalizeProfilesStore,
  normalizeProfile,
  getProfilesForScope,
  getAllProfiles,
  saveProfilesForScope,
  upsertProfile,
  removeProfile,
  findProfileById,
  findProfile,
  createCurrentProfile,
  pruneAutoSnapshots,
  formatSnapshotDate,
  saveAutoSnapshot,
  asRegularProfile,
  sortProfilesForDisplay,
  collectProfileTags,
  profileMatchesFilter,
  buildComparison,
  asTitleList,
  asTagList,
  getModuleCompatibilityState,
  resolveRequiredModules,
  collectProfilePreflight,
  presentProfile,
  formatModuleList,
  confirmProfileApplication,
  confirmProfileChanges,
  applyProfile,
  apiApply,
  apiSaveCurrent,
  apiCompare,
  createApi,
  exportProfiles,
  importProfilesFromFile,
  getManagerTemplateStrings,
  SMLSettingsMenu,
  SMLLoadoutsManager
};