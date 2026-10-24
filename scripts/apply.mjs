// Comparing a loadout with the running world, the checks before a switch and the switch itself.

import {
  CONFIRM_MODES,
  MODULE_ID,
  PROFILE_SCOPES,
  canManageModules,
  escapeHtml,
  formatList,
  getCurrentActiveModuleIds,
  getCurrentModuleConfiguration,
  getEnabledModuleIdsFromConfiguration,
  getModuleConfigurationSettingKey,
  equalModuleIdLists,
  localize,
  localizeHtml,
  moduleTitle,
  refreshManager
} from "./core.mjs";
import {
  captureLoadoutSettings,
  captureSettingsBeforeChanges,
  collectSettingsChanges,
  describeSettingsChange,
  writeSettingsChanges
} from "./loadout-settings.mjs";
import {
  createCurrentProfile,
  findProfileOrWarn,
  getPinnedModuleIds,
  getProfilesForScope,
  isGlobalScope,
  saveAutoSnapshot,
  upsertProfile
} from "./store.mjs";
import { renderPreflightSection } from "./render.mjs";
import { buildCheckMarker, saveCheckMarker } from "./startup-check.mjs";
import { countFeature } from "./usage.mjs";

export function asTitleList(moduleIds) {
  if (!moduleIds.length) return "-";
  return moduleIds.map(moduleTitle).join(", ");
}

export function asTagList(tags) {
  if (!tags?.length) return "";
  return tags.join(", ");
}

export function buildComparison(profile, { pinnedIds = getPinnedModuleIds() } = {}) {
  const currentSet = new Set(getCurrentActiveModuleIds());
  const pinned = new Set(pinnedIds);
  const desiredInstalled = profile.moduleIds.filter((id) => game.modules.has(id));
  const desiredSet = new Set(desiredInstalled);
  const matches = desiredInstalled.filter((id) => currentSet.has(id));
  const toEnable = desiredInstalled.filter((id) => !currentSet.has(id) && !pinned.has(id));
  const toDisable = Array.from(currentSet).filter((id) => id !== MODULE_ID && !desiredSet.has(id) && !pinned.has(id));
  const missing = profile.moduleIds.filter((id) => !game.modules.has(id));
  // Pinned modules the loadout would switch, left as they are.
  const pinnedKept = Array.from(pinned).filter((id) => desiredSet.has(id) !== currentSet.has(id));

  return {
    matches,
    toEnable,
    toDisable,
    missing,
    pinnedKept
  };
}

export function getModuleCompatibilityState(module) {
  if (!module) return { blocking: false, warning: false, label: "" };
  const availability = Number(module.availability ?? 0);
  const codes = CONST.PACKAGE_AVAILABILITY_CODES ?? {};
  // Every REQUIRES_* and MISSING_* code blocks (core upgrade stable/unstable/unknown, dependency update, ...).
  const blockingStates = new Set(Object.entries(codes).filter(([key]) => /^(REQUIRES|MISSING)_/.test(key)).map(([, code]) => code));
  const warningStates = new Set([codes.UNVERIFIED_GENERATION, codes.UNVERIFIED_SYSTEM, codes.UNVERIFIED_BUILD]);
  return {
    blocking: blockingStates.has(availability) || Boolean(module.unavailable),
    warning: warningStates.has(availability),
    label: module?.availabilityLabel ?? module?.availabilityError ?? ""
  };
}

export function resolveRequiredModules(moduleId, desiredIds, autoEnabledTitles, blockingDetails, warningDetails, compatibilityWarnings, visited = new Set()) {
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

    // A module that already runs needs no warning: Foundry reported it at startup and nothing changes for it.
    if (dependencyCompatibility.warning && !dependency.active) {
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

// The given modules plus every installed module they require, directly or through others.
export function withRequiredModules(moduleIds) {
  const result = new Set();
  const queue = Array.from(moduleIds ?? []);
  while (queue.length) {
    const id = queue.shift();
    if (result.has(id) || !game.modules.has(id)) continue;
    result.add(id);
    for (const requirement of Array.from(game.modules.get(id).relationships?.requires ?? [])) {
      if (requirement.type && requirement.type !== "module") continue;
      if (game.modules.has(requirement.id) && !result.has(requirement.id)) queue.push(requirement.id);
    }
  }
  return result;
}

export function collectProfilePreflight(profile, { pinnedIds = getPinnedModuleIds() } = {}) {
  const desiredIds = new Set();
  const missingModules = [];
  const autoEnabledTitles = new Set();
  const blockingDependencies = [];
  const warningDetails = [];
  const compatibilityWarnings = [];
  const pinned = new Set(pinnedIds);
  const currentSet = new Set(getCurrentActiveModuleIds());

  for (const moduleId of profile.moduleIds) {
    const module = game.modules.get(moduleId);
    if (!module) {
      missingModules.push(moduleId);
      continue;
    }
    if (pinned.has(moduleId)) continue;

    desiredIds.add(moduleId);
    const compatibility = getModuleCompatibilityState(module);
    if (compatibility.blocking) blockingDependencies.push(`${module.title}: ${compatibility.label || localize("SML.Manager.AvailabilityBlocked")}`);
    else if (compatibility.warning && !module.active) compatibilityWarnings.push(`${module.title}: ${compatibility.label || localize("SML.Manager.AvailabilityWarning")}`);
  }

  // Pinned modules keep their state: the active ones stay active, whatever the loadout says.
  for (const moduleId of pinned) {
    if (currentSet.has(moduleId)) desiredIds.add(moduleId);
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

// Libraries of the loadout that no other module of it requires or recommends.
export function findUnusedLibraries(profile, desiredIds = collectProfilePreflight(profile).desiredIds) {
  const needed = new Set();
  for (const id of desiredIds) {
    const relationships = game.modules.get(id)?.relationships ?? {};
    for (const entry of [...Array.from(relationships.requires ?? []), ...Array.from(relationships.recommends ?? [])]) {
      if (!entry.type || entry.type === "module") needed.add(entry.id);
    }
  }
  return profile.moduleIds.filter((id) => desiredIds.has(id) && game.modules.get(id)?.library === true && !needed.has(id));
}

// Modules whose installed version differs from the one the loadout was saved with.
export function findChangedVersions(profile) {
  const changes = [];
  for (const id of profile.moduleIds) {
    const saved = profile.moduleInfo?.[id]?.version;
    const module = game.modules.get(id);
    if (!saved || !module?.version || module.version === saved) continue;
    changes.push({ id, title: module.title, from: saved, to: module.version });
  }
  return changes;
}

// Missing modules with what the loadout remembers about them, so they can be found and installed.
export function describeMissingModules(profile, missingIds) {
  return missingIds.map((id) => {
    const info = profile.moduleInfo?.[id] ?? {};
    return {
      id,
      title: info.title || id,
      version: info.version ?? "",
      manifest: info.manifest ?? "",
      url: info.url ?? ""
    };
  });
}

export function renderPreflightSections(preflight, profile = null) {
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
    const missing = profile ? describeMissingModules(profile, preflight.missingModules).map((entry) => entry.title) : preflight.missingModules.map(moduleTitle);
    parts.push(renderPreflightSection(localize("SML.Dialog.Preflight.MissingModules"), missing));
  }
  return parts;
}

function renderSettingsSection(changes) {
  if (!changes.length) return "";
  const rows = changes.map(describeSettingsChange).map((entry) => [
    "<li>",
    `<span class="sml-setting-name">${escapeHtml(entry.module)}: ${escapeHtml(entry.label)}</span>`,
    `<span class="sml-setting-change">${escapeHtml(entry.from)} &rarr; ${escapeHtml(entry.to)}</span>`,
    "</li>"
  ].join(""));
  return [
    `<section class="sml-settings-changes"><p><strong>${localize("SML.Dialog.ConfirmApply.Settings", { count: changes.length })}</strong></p>`,
    `<ul>${rows.join("")}</ul>`,
    `<label class="sml-checkbox"><input type="checkbox" name="applySettings" checked> ${localize("SML.Dialog.ConfirmApply.ApplySettings")}</label>`,
    "</section>"
  ].join("");
}

// Asks before every switch and lists what really happens: modules, dependencies, settings and warnings.
export async function confirmProfileChanges(profile, preflight, { enableIds, disableIds, settingsChanges = [], pinnedKept = [] }) {
  const changedVersions = findChangedVersions(profile).map((entry) => `${entry.title}: ${entry.from} → ${entry.to}`);
  const parts = [
    `<p>${localize("SML.Dialog.ConfirmApply.Snapshot")}</p>`,
    renderPreflightSection(localize("SML.Dialog.ConfirmApply.Enable"), enableIds.map(moduleTitle)),
    renderPreflightSection(localize("SML.Dialog.ConfirmApply.Disable"), disableIds.map(moduleTitle)),
    renderPreflightSection(localize("SML.Dialog.ConfirmApply.Pinned"), pinnedKept.map(moduleTitle)),
    renderSettingsSection(settingsChanges),
    ...renderPreflightSections(preflight, profile),
    renderPreflightSection(localize("SML.Dialog.ConfirmApply.ChangedVersions"), changedVersions)
  ];

  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("SML.Dialog.Preflight.Title", { name: profile.name }), icon: "fa-solid fa-layer-group" },
    classes: ["sml-dialog"],
    position: { width: 520 },
    content: `<div class="sml-dialog-body">${parts.filter(Boolean).join("")}</div>`,
    buttons: [
      {
        action: "apply",
        label: localize("SML.Actions.Apply"),
        icon: "fa-solid fa-bolt",
        default: true,
        callback: (_event, button) => ({ applySettings: button?.form?.elements?.applySettings?.checked ?? true })
      },
      { action: "cancel", label: localize("SML.Actions.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    modal: true,
    rejectClose: false
  });
  return result && typeof result === "object" ? { confirmed: true, applySettings: result.applySettings !== false } : { confirmed: false, applySettings: false };
}

export function buildModuleConfiguration(moduleIds) {
  const configuration = {};
  for (const moduleId of moduleIds) {
    if (game.modules.has(moduleId)) configuration[moduleId] = true;
  }
  configuration[MODULE_ID] = true;
  return configuration;
}

// Writes the module configuration. "confirm" shows Foundry's reload prompt, "now" reloads every client at once.
export async function writeModuleConfiguration(configuration, { reload = "confirm" } = {}) {
  if (reload === "confirm") foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });
  await game.settings.set("core", getModuleConfigurationSettingKey(), configuration);
  if (reload === "now") {
    if (canManageModules()) game.socket?.emit?.("reload");
    foundry.utils.debouncedReload?.();
  }
}

export async function applyProfile(profile, { confirm = CONFIRM_MODES.ALWAYS, applySettings = true } = {}) {
  if (!canManageModules()) {
    ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
    return false;
  }

  const preflight = collectProfilePreflight(profile);
  if (preflight.blockingDependencies.length) {
    ui.notifications?.error(localizeHtml("SML.Notification.BlockingDependencies", {
      details: formatList(preflight.blockingDependencies)
    }));
    return false;
  }

  const oldSettings = getCurrentModuleConfiguration();
  const newSettings = buildModuleConfiguration(preflight.desiredIds);
  const oldIds = getEnabledModuleIdsFromConfiguration(oldSettings);
  const newIds = getEnabledModuleIdsFromConfiguration(newSettings);
  const modulesChange = !equalModuleIdLists(oldIds, newIds);
  let settingsChanges = applySettings ? collectSettingsChanges(profile.settings) : [];
  if (!modulesChange && !settingsChanges.length) {
    ui.notifications?.info(localize("SML.Notification.NoChanges"));
    return false;
  }

  if (confirm !== CONFIRM_MODES.NEVER) {
    const answer = await confirmProfileChanges(profile, preflight, {
      enableIds: newIds.filter((id) => !oldIds.includes(id)),
      disableIds: oldIds.filter((id) => !newIds.includes(id)),
      settingsChanges,
      pinnedKept: buildComparison(profile).pinnedKept
    });
    if (!answer.confirmed) return false;
    if (!answer.applySettings) settingsChanges = [];
    if (!modulesChange && !settingsChanges.length) {
      ui.notifications?.info(localize("SML.Notification.NoChanges"));
      return false;
    }
  }

  // Saved before the reload prompt so a quick reload cannot skip them.
  const snapshot = await saveAutoSnapshot(profile, { settings: captureSettingsBeforeChanges(settingsChanges) });
  await saveCheckMarker(buildCheckMarker(profile, {
    expectedIds: newIds,
    snapshotId: snapshot.id,
    appliedAt: Date.now(),
    user: game.user
  }));
  await writeSettingsChanges(settingsChanges);
  if (modulesChange) await writeModuleConfiguration(newSettings);
  else foundry.applications.settings.SettingsConfig.reloadConfirm({ world: true });

  ui.notifications?.info(localizeHtml("SML.Notification.ProfileApplied", { name: profile.name }));
  ui.notifications?.info(localizeHtml("SML.Notification.SnapshotSaved", { name: snapshot.name }));
  if (settingsChanges.length) ui.notifications?.info(localize("SML.Notification.SettingsApplied", { count: settingsChanges.length }));

  if (preflight.autoEnabledTitles.size) {
    ui.notifications?.info(localizeHtml("SML.Notification.DependencyAutoEnabled", {
      modules: formatList(Array.from(preflight.autoEnabledTitles))
    }));
  }

  if (preflight.missingModules.length) {
    ui.notifications?.warn(localizeHtml("SML.Notification.MissingModules", {
      modules: formatList(describeMissingModules(profile, preflight.missingModules).map((entry) => entry.title))
    }));
  }

  if (preflight.warningDetails.length || preflight.compatibilityWarnings.length) {
    ui.notifications?.warn(localizeHtml("SML.Notification.ApplyWarnings", {
      details: formatList([...preflight.warningDetails, ...preflight.compatibilityWarnings])
    }));
  }

  refreshManager();
  return true;
}

// Macro entry point. confirm: false skips the dialog, blocking dependencies still stop the switch.
export async function apiApply(idOrName, { confirm = true, settings = true } = {}) {
  const profile = findProfileOrWarn(idOrName);
  if (!profile) return false;
  const applied = await applyProfile(profile, { confirm: confirm ? CONFIRM_MODES.ALWAYS : CONFIRM_MODES.NEVER, applySettings: settings !== false });
  if (applied) countFeature(MODULE_ID, "loadoutApplied");
  return applied;
}

// Same as the manager's save button, but a profile with the same name in that scope is replaced without asking.
export async function apiSaveCurrent(name, { scope = PROFILE_SCOPES.WORLD, description = "", tags = [], settings = null } = {}) {
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
  const moduleIds = getCurrentActiveModuleIds();
  const captured = settings ? captureLoadoutSettings(moduleIds, settings).settings : null;
  const profile = createCurrentProfile({
    name: profileName,
    description,
    tags,
    scope: targetScope,
    id: existing?.id ?? null,
    createdAt: existing?.createdAt ?? null,
    moduleIds,
    settings: captured
  });

  await upsertProfile(profile);
  ui.notifications?.info(localizeHtml("SML.Notification.ProfileSaved", { name: profile.name }));
  refreshManager();
  return profile;
}

export function apiCompare(idOrName) {
  const profile = findProfileOrWarn(idOrName);
  if (!profile) return null;
  const { toEnable, toDisable, missing } = buildComparison(profile);
  const settings = collectSettingsChanges(profile.settings).map((change) => change.key);
  return { toEnable, toDisable, missing, settings };
}
