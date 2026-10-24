// The loadout manager window, its dialogs and the launcher in Foundry's Manage Modules window.

import {
  MAX_AUTO_SNAPSHOTS,
  MODULE_ID,
  PROFILE_SCOPES,
  applyManagerTheme,
  canManageModules,
  canOpenManager,
  compareModuleIdsByTitle,
  escapeHtml,
  formatDate,
  getCurrentActiveModuleIds,
  getThemePreference,
  localize,
  localizeHtml,
  moduleTitle,
  packagePageUrl,
  setManagerRefresher
} from "./core.mjs";
import {
  SETTINGS_MODES,
  captureLoadoutSettings,
  collectSettingsChanges,
  describeSettingsChange,
  summarizeLoadoutSettings
} from "./loadout-settings.mjs";
import {
  IMPORT_CHOICES,
  asRegularProfile,
  collectProfileTags,
  createCurrentProfile,
  exportProfiles,
  findNameConflict,
  findProfileById,
  getAllProfiles,
  getPinnedModuleIds,
  getProfilesForScope,
  importProfilesFromFile,
  isGlobalScope,
  isInstallationStoreAvailable,
  loadInstallationStore,
  moveProfile,
  normalizeProfile,
  profileMatchesFilter,
  removeProfile,
  scopeLabel,
  setPinnedModuleIds,
  sortProfilesForDisplay,
  upsertProfile,
  warnNameConflict
} from "./store.mjs";
import {
  applyProfile,
  asTagList,
  asTitleList,
  buildComparison,
  collectProfilePreflight,
  describeMissingModules,
  findChangedVersions,
  findUnusedLibraries
} from "./apply.mjs";
import { openBugHuntPanel, openBugHuntStart, readHuntState } from "./bug-hunt.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const KEEP_SETTINGS = "keep";

let managerApp = null;

// Not only when rendered: while a render runs, rendered is false and the update would be lost. render() without
// force does nothing for a window that is not open.
setManagerRefresher(() => {
  managerApp?.render();
});

export function getManagerApp() {
  return managerApp;
}

export function openManager() {
  if (!canOpenManager()) {
    ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
    return null;
  }
  if (!managerApp) managerApp = new SMLLoadoutsManager();
  const app = managerApp;
  // The installation file may have changed in another world or browser.
  void loadInstallationStore({ force: true }).finally(() => app.render({ force: true }));
  return app;
}

// Foundry's settings, opened on the tab of this module.
export async function openModuleSettings() {
  const sheet = game.settings.sheet;
  if (!sheet) return null;
  await sheet.render({ force: true });
  try {
    sheet.changeTab(MODULE_ID, "categories");
  } catch (error) {
    console.warn(`${MODULE_ID} | The settings have no tab for this module`, error);
  }
  sheet.bringToFront?.();
  return sheet;
}

export function injectModuleManagementLauncher(app, html) {
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

// ---------------------------------------------------------------------------------------------
// Card data
// ---------------------------------------------------------------------------------------------

export function presentProfile(profile, { pinnedIds = getPinnedModuleIds() } = {}) {
  const comparison = buildComparison(profile, { pinnedIds });
  const preflight = collectProfilePreflight(profile, { pinnedIds });
  const updatedAtLabel = formatDate(profile.updatedAt);
  const missing = describeMissingModules(profile, comparison.missing);
  const changedVersions = findChangedVersions(profile);
  const unusedLibraries = findUnusedLibraries(profile, preflight.desiredIds);
  const settingsSummary = summarizeLoadoutSettings(profile.settings);
  const settingsChanges = collectSettingsChanges(profile.settings).map(describeSettingsChange);
  const warningCount = preflight.warningDetails.length + preflight.compatibilityWarnings.length;

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
    warningCount,
    blockingCount: preflight.blockingDependencies.length,
    changedCount: changedVersions.length,
    unusedLibraryCount: unusedLibraries.length,
    settingsCount: settingsSummary.count,
    settingsChangeCount: settingsChanges.length,
    matchingTitles: asTitleList(comparison.matches),
    enableTitles: asTitleList(comparison.toEnable),
    disableTitles: asTitleList(comparison.toDisable),
    missingTitles: missing.map((entry) => entry.title).join(", ") || "-",
    autoEnableTitles: Array.from(preflight.autoEnabledTitles).join(", ") || "-",
    warningTitles: [...preflight.warningDetails, ...preflight.compatibilityWarnings].join("\n") || "-",
    blockingTitles: preflight.blockingDependencies.join("\n") || "-",
    changedTitles: changedVersions.map((entry) => `${entry.title}: ${entry.from} → ${entry.to}`).join("\n") || "-",
    unusedLibraryTitles: asTitleList(unusedLibraries),
    settingsTitles: localize("SML.Manager.SettingsHint", { modules: settingsSummary.moduleCount, date: formatDate(profile.settings?.capturedAt) }),
    isAuto: profile.auto === true,
    hasModuleDetails: comparison.toEnable.length + comparison.toDisable.length + comparison.missing.length
      + comparison.pinnedKept.length + changedVersions.length + unusedLibraries.length + settingsChanges.length > 0,
    enableList: comparison.toEnable.map(moduleTitle),
    disableList: comparison.toDisable.map(moduleTitle),
    missingList: missing.map((entry) => ({ ...entry, page: packagePageUrl(entry.id) })),
    pinnedList: comparison.pinnedKept.map(moduleTitle),
    changedList: changedVersions.map((entry) => `${entry.title}: ${entry.from} → ${entry.to}`),
    unusedLibraryList: unusedLibraries.map(moduleTitle),
    settingsChangeList: settingsChanges.map((entry) => `${entry.module}: ${entry.label} (${entry.from} → ${entry.to})`),
    updatedAtLabel,
    modulesBadge: localize("SML.Manager.ModulesBadge", { count: profile.moduleIds.length }),
    matchesBadge: localize("SML.Manager.MatchesBadge", { count: comparison.matches.length }),
    enableBadge: localize("SML.Manager.EnableBadge", { count: comparison.toEnable.length }),
    disableBadge: localize("SML.Manager.DisableBadge", { count: comparison.toDisable.length }),
    missingBadge: localize("SML.Manager.MissingBadge", { count: comparison.missing.length }),
    autoEnableBadge: localize("SML.Manager.AutoEnableBadge", { count: preflight.autoEnabledTitles.size }),
    warningBadge: localize("SML.Manager.WarningBadge", { count: warningCount }),
    blockingBadge: localize("SML.Manager.BlockingBadge", { count: preflight.blockingDependencies.length }),
    changedBadge: localize("SML.Manager.ChangedBadge", { count: changedVersions.length }),
    unusedLibraryBadge: localize("SML.Manager.UnusedLibraryBadge", { count: unusedLibraries.length }),
    settingsBadge: localize("SML.Manager.SettingsBadge", { count: settingsSummary.count }),
    settingsChangeBadge: localize("SML.Manager.SettingsChangeBadge", { count: settingsChanges.length }),
    updatedAtText: localize("SML.Manager.UpdatedAt", { updatedAt: updatedAtLabel })
  };
}

export function getManagerTemplateStrings({ worldName, currentActiveCount, worldCount, globalCount, pinnedCount = 0 }) {
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
    pinned: localize("SML.Actions.Pinned", { count: pinnedCount }),
    bugHunt: localize("SML.Actions.BugHunt"),
    permissionWarning: localize("SML.Manager.PermissionWarning"),
    installationUnavailable: localize("SML.Installation.Unavailable"),
    huntRunning: localize("SML.Hunt.Running"),
    huntOpen: localize("SML.Hunt.Open"),
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
    detailsPinned: localize("SML.Manager.Details.Pinned"),
    detailsChanged: localize("SML.Manager.Details.Changed"),
    detailsUnusedLibraries: localize("SML.Manager.Details.UnusedLibraries"),
    detailsSettings: localize("SML.Manager.Details.Settings"),
    packagePage: localize("SML.Manager.PackagePage"),
    copyManifest: localize("SML.Manager.CopyManifest"),
    autoBadge: localize("SML.Manager.AutoBadge"),
    autoHint: localize("SML.Manager.AutoHint", { count: MAX_AUTO_SNAPSHOTS })
  };
}

// ---------------------------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------------------------

function selectOption(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${selected ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

export function renderProfileForm({ name = "", description = "", tags = [], scope = PROFILE_SCOPES.WORLD, settings = null } = {}) {
  const summary = summarizeLoadoutSettings(settings);
  const settingsOptions = settings
    ? [
      selectOption(KEEP_SETTINGS, localize("SML.Dialog.Profile.SettingsKeep", { count: summary.count }), true),
      selectOption(SETTINGS_MODES.VISIBLE, localize("SML.Dialog.Profile.SettingsVisibleAgain"), false),
      selectOption(SETTINGS_MODES.ALL, localize("SML.Dialog.Profile.SettingsAllAgain"), false),
      selectOption(SETTINGS_MODES.NONE, localize("SML.Dialog.Profile.SettingsRemove"), false)
    ]
    : [
      selectOption(SETTINGS_MODES.NONE, localize("SML.Dialog.Profile.SettingsNone"), true),
      selectOption(SETTINGS_MODES.VISIBLE, localize("SML.Dialog.Profile.SettingsVisible"), false),
      selectOption(SETTINGS_MODES.ALL, localize("SML.Dialog.Profile.SettingsAll"), false)
    ];
  return `
    <div class="sml-dialog-body">
      <div class="form-group">
        <label>${localize("SML.Dialog.Profile.Name")}</label>
        <input type="text" name="profileName" value="${escapeHtml(name)}" autofocus>
      </div>
      <div class="form-group">
        <label>${localize("SML.Dialog.Profile.Description")}</label>
        <input type="text" name="profileDescription" value="${escapeHtml(description)}">
      </div>
      <div class="form-group">
        <label>${localize("SML.Dialog.Profile.Tags")}</label>
        <input type="text" name="profileTags" value="${escapeHtml((tags ?? []).join(", "))}" placeholder="prep, live, debug">
      </div>
      <div class="form-group">
        <label>${localize("SML.Dialog.Profile.Scope")}</label>
        <select name="profileScope">
          ${selectOption(PROFILE_SCOPES.WORLD, localize("SML.Scope.World"), scope !== PROFILE_SCOPES.GLOBAL)}
          ${selectOption(PROFILE_SCOPES.GLOBAL, localize("SML.Scope.Global"), scope === PROFILE_SCOPES.GLOBAL)}
        </select>
      </div>
      <div class="form-group">
        <label>${localize("SML.Dialog.Profile.Settings")}</label>
        <select name="profileSettings">${settingsOptions.join("")}</select>
        <p class="hint">${localize("SML.Dialog.Profile.SettingsHint")}</p>
      </div>
    </div>`;
}

export function readProfileForm(form) {
  const elements = form?.elements ?? {};
  const value = (field) => String(elements[field]?.value ?? "").trim();
  return {
    name: value("profileName"),
    description: value("profileDescription"),
    tags: value("profileTags"),
    scope: value("profileScope") || PROFILE_SCOPES.WORLD,
    settings: value("profileSettings") || SETTINGS_MODES.NONE
  };
}

// The form of the save, edit and duplicate buttons. null: closed or an empty name (with a hint).
export async function promptProfileData(profile = null, duplicate = false) {
  const initial = profile ?? { name: "", description: "", tags: [], scope: PROFILE_SCOPES.WORLD, settings: null };
  const dialogTitle = duplicate
    ? localize("SML.Dialog.Duplicate.Title", { name: initial.name })
    : profile
      ? localize("SML.Dialog.Edit.Title", { name: initial.name })
      : localize("SML.Dialog.SaveCurrent.Title");

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: dialogTitle, icon: "fa-solid fa-layer-group" },
    classes: ["sml-dialog"],
    position: { width: 480 },
    content: renderProfileForm({
      ...initial,
      name: duplicate ? localize("SML.Dialog.Duplicate.Name", { name: initial.name }) : initial.name
    }),
    buttons: [
      {
        action: "save",
        label: localize("SML.Dialog.Profile.Submit"),
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: (_event, button) => readProfileForm(button.form)
      },
      { action: "cancel", label: localize("SML.Actions.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false
  });

  if (!result || typeof result !== "object") return null;
  const name = String(result.name ?? "").trim();
  if (!name) {
    ui.notifications?.warn(localize("SML.Notification.NameRequired"));
    return null;
  }

  return {
    name,
    description: String(result.description ?? "").trim(),
    tags: String(result.tags ?? "").split(",").map((value) => value.trim()).filter(Boolean),
    scope: isGlobalScope(result.scope) ? PROFILE_SCOPES.GLOBAL : PROFILE_SCOPES.WORLD,
    settings: result.settings
  };
}

export async function confirmDialog(titleKey, contentKey, data = {}) {
  const confirmed = await foundry.applications.api.DialogV2.confirm({
    window: { title: localize(titleKey, data) },
    content: `<p>${localizeHtml(contentKey, data)}</p>`,
    rejectClose: false
  });
  return confirmed === true;
}

// The settings a form choice leads to: kept, captured again from this world or none.
export function resolveProfileSettings(choice, moduleIds, previous = null) {
  if (choice === KEEP_SETTINGS) return { settings: previous ?? null, skipped: [], secret: [] };
  if (choice === SETTINGS_MODES.VISIBLE || choice === SETTINGS_MODES.ALL) return captureLoadoutSettings(moduleIds, choice);
  return { settings: null, skipped: [], secret: [] };
}

function notifySettingsCapture(choice, { settings, skipped = [], secret = [] }) {
  if (choice !== SETTINGS_MODES.VISIBLE && choice !== SETTINGS_MODES.ALL) return;
  if (!settings) ui.notifications?.warn(localize("SML.Notification.NoSettingsFound"));
  if (skipped.length) ui.notifications?.warn(localize("SML.Notification.SettingsSkipped", { count: skipped.length }));
  if (secret.length) ui.notifications?.info(localize("SML.Notification.SettingsSecret", { count: secret.length }));
}

function importStatus(entry) {
  if (!entry.existing) return localize("SML.Dialog.Import.New");
  return localizeHtml(entry.match === "id" ? "SML.Dialog.Import.SameId" : "SML.Dialog.Import.SameName", { name: entry.existing.name });
}

export function renderImportPreview(plan) {
  const rows = plan.map((entry, index) => {
    const options = entry.existing
      ? [
        selectOption(IMPORT_CHOICES.REPLACE, localize("SML.Dialog.Import.Replace"), true),
        selectOption(IMPORT_CHOICES.BOTH, localize("SML.Dialog.Import.Both"), false),
        selectOption(IMPORT_CHOICES.SKIP, localize("SML.Dialog.Import.Skip"), false)
      ]
      : [
        selectOption(IMPORT_CHOICES.REPLACE, localize("SML.Dialog.Import.Add"), true),
        selectOption(IMPORT_CHOICES.SKIP, localize("SML.Dialog.Import.Skip"), false)
      ];
    const settings = entry.profile.settings ? ` · ${escapeHtml(localize("SML.Manager.SettingsBadge", { count: summarizeLoadoutSettings(entry.profile.settings).count }))}` : "";
    return [
      `<li class="sml-import-row">`,
      `<div><strong>${escapeHtml(entry.profile.name)}</strong> <span class="sml-dialog-note">${escapeHtml(scopeLabel(entry.profile.scope))} · ${escapeHtml(localize("SML.Manager.ModulesBadge", { count: entry.profile.moduleIds.length }))}${settings}</span>`,
      `<p class="sml-dialog-note">${importStatus(entry)}</p></div>`,
      `<select name="choice-${index}">${options.join("")}</select>`,
      "</li>"
    ].join("");
  });
  return `<div class="sml-dialog-body"><p>${localize("SML.Dialog.Import.Intro", { count: plan.length })}</p><ul class="sml-import-list">${rows.join("")}</ul></div>`;
}

export function readImportChoices(form, plan) {
  return plan.map((_entry, index) => {
    const value = form?.elements?.[`choice-${index}`]?.value;
    return Object.values(IMPORT_CHOICES).includes(value) ? value : IMPORT_CHOICES.REPLACE;
  });
}

export async function chooseImport(plan) {
  return foundry.applications.api.DialogV2.wait({
    window: { title: localize("SML.Dialog.Import.Title"), icon: "fa-solid fa-file-import" },
    classes: ["sml-dialog"],
    position: { width: 560 },
    content: renderImportPreview(plan),
    buttons: [
      {
        action: "import",
        label: localize("SML.Actions.Import"),
        icon: "fa-solid fa-file-import",
        default: true,
        callback: (_event, button) => readImportChoices(button.form, plan)
      },
      { action: "cancel", label: localize("SML.Actions.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false
  }).then((result) => Array.isArray(result) ? result : null);
}

export function renderPinnedForm({ pinnedIds = getPinnedModuleIds(), activeIds = getCurrentActiveModuleIds() } = {}) {
  const pinned = new Set(pinnedIds);
  const active = new Set(activeIds);
  const ids = Array.from(game.modules.keys()).filter((id) => id !== MODULE_ID).sort(compareModuleIdsByTitle);
  const rows = ids.map((id) => [
    `<label class="sml-checkbox sml-pinned-row" data-search="${escapeHtml(`${moduleTitle(id)} ${id}`.toLowerCase())}">`,
    `<input type="checkbox" name="pinned" value="${escapeHtml(id)}"${pinned.has(id) ? " checked" : ""}>`,
    ` <span>${escapeHtml(moduleTitle(id))}</span>`,
    active.has(id) ? ` <span class="sml-badge sml-badge-positive">${escapeHtml(localize("SML.Dialog.Pinned.Active"))}</span>` : "",
    "</label>"
  ].join(""));
  return [
    `<div class="sml-dialog-body">`,
    `<p>${localize("SML.Dialog.Pinned.Intro")}</p>`,
    `<input type="search" name="pinnedFilter" placeholder="${escapeHtml(localize("SML.Dialog.Pinned.Search"))}">`,
    `<div class="sml-pinned-list">${rows.join("")}</div>`,
    "</div>"
  ].join("");
}

function filterPinnedRows(root, needle) {
  const value = String(needle ?? "").trim().toLowerCase();
  for (const row of root.querySelectorAll(".sml-pinned-row")) {
    row.hidden = Boolean(value) && !String(row.dataset.search ?? "").includes(value);
  }
}

export async function choosePinnedModules() {
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("SML.Dialog.Pinned.Title"), icon: "fa-solid fa-thumbtack" },
    classes: ["sml-dialog"],
    position: { width: 480 },
    content: renderPinnedForm(),
    buttons: [
      {
        action: "save",
        label: localize("SML.Dialog.Pinned.Save"),
        icon: "fa-solid fa-floppy-disk",
        default: true,
        callback: (_event, button) => Array.from(button.form.querySelectorAll('input[name="pinned"]:checked')).map((input) => input.value)
      },
      { action: "cancel", label: localize("SML.Actions.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    render: (_event, dialog) => {
      const root = dialog.element;
      const search = root?.querySelector?.('input[name="pinnedFilter"]');
      search?.addEventListener("input", () => filterPinnedRows(root, search.value));
      // Enter in the search box filters instead of saving.
      search?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") event.preventDefault();
      });
    },
    rejectClose: false
  });
  return Array.isArray(result) ? result : null;
}

// ---------------------------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------------------------

export class SMLSettingsMenu extends ApplicationV2 {
  render() {
    openManager();
    return this;
  }
}

export class SMLLoadoutsManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: MODULE_ID,
    classes: ["sml-window"],
    window: { title: "SML.Title", icon: "fa-solid fa-layer-group", resizable: true },
    position: { width: 940, height: 760 },
    actions: {
      saveCurrent() {
        return this._onSaveCurrent();
      },
      exportProfiles() {
        exportProfiles();
      },
      importProfiles() {
        this.element?.querySelector('[data-role="import-file"]')?.click();
      },
      pinnedModules() {
        return this._onPinnedModules();
      },
      bugHunt() {
        return readHuntState() ? openBugHuntPanel() : openBugHuntStart();
      },
      applyProfile(_event, target) {
        return this._onApply(target.dataset.profileId);
      },
      editProfile(_event, target) {
        return this._onEdit(target.dataset.profileId);
      },
      duplicateProfile(_event, target) {
        return this._onDuplicate(target.dataset.profileId);
      },
      deleteProfile(_event, target) {
        return this._onDelete(target.dataset.profileId);
      },
      filterTag(_event, target) {
        this._filter.tag = this._filter.tag === target.dataset.tag ? null : target.dataset.tag;
        this._applyFilter();
      },
      copyManifest(_event, target) {
        return this._onCopyManifest(target.dataset.manifest);
      },
      openSettings() {
        return openModuleSettings();
      }
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/loadouts-manager.html`, scrollable: [".sml-profile-list"] }
  };

  // Filter and open details live on the instance, so they survive re-renders until the window closes.
  _filter = { search: "", tag: null };
  _openDetails = new Set();
  _profiles = new Map();

  get title() {
    return localize("SML.Title");
  }

  async close(options = {}) {
    const result = await super.close(options);
    if (managerApp === this) managerApp = null;
    return result;
  }

  // A gear in the title bar opens the module's settings.
  async _renderFrame(options) {
    const frame = await super._renderFrame(options);
    const close = frame?.querySelector?.('.window-header [data-action="close"]');
    if (close) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "header-control icon fa-solid fa-gear";
      button.dataset.action = "openSettings";
      close.before(button);
      this._settingsButton = button;
      this._labelSettingsButton();
    }
    return frame;
  }

  // Labelled again on every render, the manager can switch its language while it is open.
  _labelSettingsButton() {
    const button = this._settingsButton;
    if (!button) return;
    const label = localize("SML.Actions.OpenSettings");
    button.dataset.tooltip = label;
    button.setAttribute("aria-label", label);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    await loadInstallationStore();
    const pinnedIds = getPinnedModuleIds();
    const profiles = sortProfilesForDisplay(getAllProfiles())
      .map((profile) => ({ ...presentProfile(profile, { pinnedIds }), detailsOpen: this._openDetails.has(profile.id) }));
    this._profiles = new Map(profiles.map((profile) => [profile.id, profile]));

    const tags = collectProfileTags(profiles);
    if (this._filter.tag && !tags.includes(this._filter.tag)) this._filter.tag = null;
    const currentActiveCount = getCurrentActiveModuleIds().length;
    const globalCount = getProfilesForScope(PROFILE_SCOPES.GLOBAL).profiles.length;
    const worldCount = getProfilesForScope(PROFILE_SCOPES.WORLD).profiles.length;
    const worldName = game.world?.title ?? game.world?.id ?? "-";

    return {
      ...context,
      strings: getManagerTemplateStrings({ worldName, currentActiveCount, worldCount, globalCount, pinnedCount: pinnedIds.length }),
      canManage: canManageModules(),
      installationUnavailable: !isInstallationStoreAvailable(),
      huntRunning: Boolean(readHuntState()),
      hasProfiles: profiles.length > 0,
      profiles,
      currentActiveCount,
      worldName,
      globalCount,
      worldCount,
      loadoutCount: profiles.length,
      filterSearch: this._filter.search,
      tagFilters: tags.map((tag) => ({ value: tag, active: tag === this._filter.tag })),
      uiTheme: getThemePreference()
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const element = this.element;
    applyManagerTheme(element, context?.uiTheme ?? getThemePreference());
    this._labelSettingsButton();

    // Filtering hides cards in place instead of re-rendering, so the search box keeps its focus.
    const search = element.querySelector('[data-role="filter-search"]');
    search?.addEventListener("input", () => {
      this._filter.search = search.value ?? "";
      this._applyFilter();
    });
    search?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
    });

    const importFile = element.querySelector('[data-role="import-file"]');
    importFile?.addEventListener("change", (event) => {
      void this._onImport(event);
    });

    for (const details of element.querySelectorAll(".sml-profile-details")) {
      details.addEventListener("toggle", () => {
        if (details.open) this._openDetails.add(details.dataset.profileId);
        else this._openDetails.delete(details.dataset.profileId);
      });
    }

    this._applyFilter();
  }

  _applyFilter(root = this.element) {
    if (!root) return;
    let visibleCount = 0;
    for (const card of root.querySelectorAll(".sml-profile-card")) {
      const profile = this._profiles.get(card.dataset.profileId);
      const visible = !profile || profileMatchesFilter(profile, this._filter);
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    }

    for (const chip of root.querySelectorAll('[data-action="filterTag"]')) {
      const active = chip.dataset.tag === this._filter.tag;
      chip.classList.toggle("is-active", active);
      chip.setAttribute("aria-pressed", String(active));
    }

    const empty = root.querySelector(".sml-filter-empty");
    if (empty) empty.hidden = visibleCount > 0 || this._profiles.size === 0;
  }

  // Saving can fail (for example the installation file), the manager reports it instead of dropping the error.
  async _guard(task) {
    try {
      return await task();
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications?.error(localizeHtml("SML.Notification.SaveFailed", { message: error?.message ?? error }));
      return null;
    }
  }

  async _onSaveCurrent() {
    if (!canManageModules()) {
      ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
      return;
    }
    const result = await promptProfileData();
    if (!result) return;

    const existing = getProfilesForScope(result.scope).profiles.find((profile) => profile.name.toLowerCase() === result.name.toLowerCase());
    if (existing && !(await confirmDialog("SML.Dialog.Replace.Title", "SML.Dialog.Replace.Content", { name: existing.name }))) return;

    const moduleIds = getCurrentActiveModuleIds();
    const captured = resolveProfileSettings(result.settings, moduleIds);
    const profile = createCurrentProfile({
      name: result.name,
      description: result.description,
      tags: result.tags,
      scope: result.scope,
      id: existing?.id ?? null,
      createdAt: existing?.createdAt ?? null,
      moduleIds,
      settings: captured.settings
    });

    const saved = await this._guard(async () => {
      await moveProfile(existing, profile);
      return true;
    });
    if (!saved) return;
    notifySettingsCapture(result.settings, captured);
    ui.notifications?.info(localizeHtml("SML.Notification.ProfileSaved", { name: profile.name }));
    this.render();
  }

  async _onEdit(profileId) {
    const existing = findProfileById(profileId);
    if (!existing) return;
    const result = await promptProfileData(asRegularProfile(existing), false);
    if (!result) return;
    // Another gamemaster may have deleted it while the dialog was open, saving must not bring it back.
    if (!findProfileById(profileId)) {
      ui.notifications?.warn(localizeHtml("SML.Notification.ProfileNotFound", { name: existing.name }));
      this.render();
      return;
    }
    const conflict = findNameConflict(result.name, result.scope, existing.id);
    if (conflict) {
      warnNameConflict(conflict);
      return;
    }

    const captured = resolveProfileSettings(result.settings, existing.moduleIds, existing.settings);
    const updated = normalizeProfile({
      ...asRegularProfile(existing),
      name: result.name,
      description: result.description,
      tags: result.tags,
      scope: result.scope,
      settings: captured.settings,
      updatedAt: new Date().toISOString()
    }, result.scope);

    const saved = await this._guard(async () => {
      await moveProfile(existing, updated);
      return true;
    });
    if (!saved) return;
    notifySettingsCapture(result.settings, captured);
    ui.notifications?.info(localizeHtml("SML.Notification.ProfileSaved", { name: updated.name }));
    this.render();
  }

  async _onDuplicate(profileId) {
    const source = findProfileById(profileId);
    if (!source) return;
    const result = await promptProfileData(asRegularProfile(source), true);
    if (!result) return;
    const conflict = findNameConflict(result.name, result.scope);
    if (conflict) {
      warnNameConflict(conflict);
      return;
    }

    const captured = resolveProfileSettings(result.settings, source.moduleIds, source.settings);
    const timestamp = new Date().toISOString();
    const duplicated = normalizeProfile({
      ...asRegularProfile(source),
      id: foundry.utils.randomID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      name: result.name,
      description: result.description,
      tags: result.tags,
      scope: result.scope,
      settings: captured.settings
    }, result.scope);

    const saved = await this._guard(async () => {
      await upsertProfile(duplicated);
      return true;
    });
    if (!saved) return;
    notifySettingsCapture(result.settings, captured);
    ui.notifications?.info(localizeHtml("SML.Notification.ProfileSaved", { name: duplicated.name }));
    this.render();
  }

  async _onApply(profileId) {
    const profile = findProfileById(profileId);
    if (!profile) return;
    await this._guard(() => applyProfile(profile));
    this.render();
  }

  async _onDelete(profileId) {
    const profile = findProfileById(profileId);
    if (!profile) return;
    if (!(await confirmDialog("SML.Dialog.Delete.Title", "SML.Dialog.Delete.Content", { name: profile.name }))) return;

    const deleted = await this._guard(async () => {
      await removeProfile(profile);
      return true;
    });
    if (!deleted) return;
    ui.notifications?.info(localizeHtml("SML.Notification.ProfileDeleted", { name: profile.name }));
    this.render();
  }

  async _onPinnedModules() {
    if (!canManageModules()) {
      ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
      return;
    }
    const ids = await choosePinnedModules();
    if (!ids) return;
    const saved = await setPinnedModuleIds(ids);
    ui.notifications?.info(localize("SML.Notification.PinnedSaved", { count: saved.length }));
    this.render();
  }

  async _onCopyManifest(manifest) {
    if (!manifest) return;
    try {
      if (game.clipboard?.copyPlainText) await game.clipboard.copyPlainText(manifest);
      else await navigator.clipboard.writeText(manifest);
      ui.notifications?.info(localize("SML.Notification.ManifestCopied"));
    } catch (_error) {
      ui.notifications?.warn(localizeHtml("SML.Notification.ManifestCopyFailed", { manifest }));
    }
  }

  async _onImport(event) {
    const input = event.currentTarget ?? event.target;
    const file = input?.files?.[0];
    if (!file) return;
    if (!canManageModules()) {
      ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
      input.value = "";
      return;
    }

    try {
      await importProfilesFromFile(file, { choose: chooseImport });
      this.render();
    } catch (error) {
      ui.notifications?.error(localizeHtml("SML.Notification.ImportFailed", {
        message: error?.message ?? error
      }));
    } finally {
      input.value = "";
    }
  }
}
