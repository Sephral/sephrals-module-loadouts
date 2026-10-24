// Saved loadouts: world loadouts live in a world setting, installation loadouts in a JSON file in the user data
// (on The Forge in the Assets Library), so every gamemaster and every browser of the installation sees them.

import {
  AUTO_SNAPSHOT_TAG,
  GLOBAL_PROFILES_SETTING,
  INSTALLATION_MIGRATED_SETTING,
  INSTALLATION_REVISION_SETTING,
  MAX_AUTO_SNAPSHOTS,
  MODULE_ID,
  PINNED_MODULES_SETTING,
  PROFILE_SCOPES,
  STORAGE_VERSION,
  WORLD_PROFILES_SETTING,
  canManageModules,
  compareModuleIdsByTitle,
  formatSnapshotDate,
  getCurrentActiveModuleIds,
  getRegisteredSettingValue,
  getSortLanguage,
  localize,
  localizeHtml,
  refreshManager
} from "./core.mjs";
import { normalizeLoadoutSettings } from "./loadout-settings.mjs";

export const INSTALLATION_FILE_NAME = "installation-loadouts.json";
const FORGE_STORAGE_SOURCE = "forgevtt";
export const IMPORT_CHOICES = Object.freeze({
  REPLACE: "replace",
  BOTH: "both",
  SKIP: "skip"
});

// The file is read once and then kept here. A write bumps a world setting, other clients read the file again.
const installationStore = {
  profiles: [],
  loaded: false,
  available: true,
  loading: null,
  url: null,
  revision: null
};

export function defaultStore() {
  return {
    version: STORAGE_VERSION,
    profiles: []
  };
}

export function scopeLabel(scope) {
  return localize(scope === PROFILE_SCOPES.GLOBAL ? "SML.Scope.Global" : "SML.Scope.World");
}

export function isGlobalScope(scope) {
  return scope === PROFILE_SCOPES.GLOBAL;
}

export function getStoreSettingKey(scope) {
  return isGlobalScope(scope) ? GLOBAL_PROFILES_SETTING : WORLD_PROFILES_SETTING;
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), getSortLanguage(), { sensitivity: "base" });
}

function cleanText(value) {
  return String(value ?? "").trim();
}

// Title, version and manifest of each module when the loadout was saved: shows updates since then and lets
// a gamemaster without the module find and install it.
export function normalizeModuleInfo(info, moduleIds) {
  if (!info || typeof info !== "object") return {};
  const result = {};
  for (const id of moduleIds) {
    const entry = info[id];
    if (!entry || typeof entry !== "object") continue;
    const compact = Object.fromEntries(["title", "version", "manifest", "url"]
      .map((field) => [field, cleanText(entry[field])])
      .filter(([, value]) => value));
    if (Object.keys(compact).length) result[id] = compact;
  }
  return result;
}

export function captureModuleInfo(moduleIds) {
  const info = {};
  for (const id of moduleIds) {
    const module = game.modules.get(id);
    if (!module) continue;
    info[id] = {
      title: module.title,
      version: module.version,
      manifest: module.manifest,
      url: module.url
    };
  }
  return normalizeModuleInfo(info, moduleIds);
}

export function normalizeProfile(profile, fallbackScope = PROFILE_SCOPES.WORLD) {
  if (!profile) return null;

  const name = cleanText(profile.name);
  if (!name) return null;

  const moduleIds = Array.isArray(profile.moduleIds)
    ? profile.moduleIds
    : Array.isArray(profile.modules)
      ? profile.modules
      : [];

  const uniqueModuleIds = Array.from(new Set(moduleIds
    .map((value) => cleanText(value))
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
  const moduleInfo = normalizeModuleInfo(profile.moduleInfo, uniqueModuleIds);
  const settings = normalizeLoadoutSettings(profile.settings);

  return {
    id: String(profile.id ?? foundry.utils.randomID()),
    name,
    description: cleanText(profile.description),
    tags: Array.from(new Set(tags.map((value) => cleanText(value)).filter(Boolean))).sort(compareText),
    scope: normalizedScope,
    moduleIds: uniqueModuleIds.sort(compareModuleIdsByTitle),
    createdAt,
    updatedAt,
    ...(Object.keys(moduleInfo).length ? { moduleInfo } : {}),
    ...(settings ? { settings } : {}),
    // Only automatic snapshots carry the flag, regular profiles leave it out.
    ...(profile.auto === true ? { auto: true } : {})
  };
}

export function normalizeProfilesStore(store, fallbackScope = PROFILE_SCOPES.WORLD) {
  const profiles = Array.isArray(store?.profiles) ? store.profiles.map((profile) => normalizeProfile(profile, fallbackScope)).filter(Boolean) : [];
  return {
    version: Number(store?.version) || STORAGE_VERSION,
    profiles
  };
}

// ---------------------------------------------------------------------------------------------
// Installation loadouts file
// ---------------------------------------------------------------------------------------------

export function isUsingTheForge() {
  // The Forge may declare ForgeVTT as a top-level class binding, which is global but not a globalThis property.
  return typeof ForgeVTT !== "undefined" && ForgeVTT?.usingTheForge === true;
}

// Off The Forge the file sits in the module's persistent storage folder, which module updates keep.
export function getInstallationFileTarget() {
  if (isUsingTheForge()) {
    return { source: FORGE_STORAGE_SOURCE, directory: MODULE_ID, path: `${MODULE_ID}/${INSTALLATION_FILE_NAME}` };
  }
  const directory = `modules/${MODULE_ID}/storage`;
  return { source: "data", directory, path: `${directory}/${INSTALLATION_FILE_NAME}` };
}

async function getForgeAssetBaseUrl() {
  if (typeof ForgeVTT === "undefined" || typeof ForgeAPI === "undefined") return null;
  const prefix = String(ForgeVTT?.ASSETS_LIBRARY_URL_PREFIX ?? "");
  if (!prefix || typeof ForgeAPI?.getUserId !== "function") return null;
  try {
    const userId = await ForgeAPI.getUserId();
    return userId ? `${prefix.replace(/\/+$/, "")}/${userId}/` : null;
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not resolve the Forge Assets Library URL.`, error);
    return null;
  }
}

async function getInstallationReadUrls() {
  const target = getInstallationFileTarget();
  if (!isUsingTheForge()) return [foundry.utils.getRoute(target.path)];
  const urls = [];
  if (installationStore.url) urls.push(installationStore.url);
  const base = await getForgeAssetBaseUrl();
  if (base) urls.push(`${base}${target.path}`);
  return urls;
}

function withCacheBuster(url) {
  return `${url}${String(url).includes("?") ? "&" : "?"}ts=${Date.now()}`;
}

// Off The Forge a browse of the folder tells whether the file exists, so a missing file costs no 404 in the console.
// undefined: unknown (no permission to browse, The Forge), the fetch decides then.
async function installationFileExists() {
  if (isUsingTheForge()) return undefined;
  const target = getInstallationFileTarget();
  try {
    const result = await foundry.applications.apps.FilePicker.implementation.browse(target.source, target.directory);
    return Array.from(result?.files ?? []).some((file) => decodeURIComponent(String(file)).endsWith(`/${INSTALLATION_FILE_NAME}`));
  } catch (error) {
    const message = String(error?.message ?? error ?? "");
    if (/does not exist|not accessible|ENOENT/i.test(message)) return false;
    return undefined;
  }
}

// null: there is no file yet. Any other failure throws, so a write never replaces a file it could not read.
async function readInstallationFile() {
  if ((await installationFileExists()) === false) return null;
  let failure = null;
  for (const url of await getInstallationReadUrls()) {
    try {
      const response = await fetch(withCacheBuster(url), { cache: "no-store" });
      if (response.status === 404) continue;
      if (!response.ok) {
        failure = new Error(`${response.status} ${response.statusText ?? ""}`.trim());
        continue;
      }
      return await response.json();
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
  return null;
}

async function ensureInstallationDirectory(target) {
  const picker = foundry.applications.apps.FilePicker.implementation;
  try {
    await picker.createDirectory(target.source, target.directory, { notify: false });
  } catch (error) {
    const message = String(error?.message ?? error ?? "");
    // The Forge creates parents itself and reports odd errors for existing folders, the upload decides there.
    if (!isUsingTheForge() && !/EEXIST|already exists|ErrorCreateDirExists/i.test(message)) throw error;
  }
}

async function writeInstallationFile(profiles) {
  const target = getInstallationFileTarget();
  await ensureInstallationDirectory(target);
  const payload = {
    module: MODULE_ID,
    version: STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    profiles
  };
  const file = new File([JSON.stringify(payload, null, 2)], INSTALLATION_FILE_NAME, { type: "application/json", lastModified: Date.now() });
  const response = await foundry.applications.apps.FilePicker.implementation.upload(target.source, target.directory, file, {}, { notify: false });
  if (!response?.path) throw new Error(localize("SML.Installation.WriteFailed"));
  if (/^https?:\/\//i.test(response.path)) installationStore.url = response.path;
}

export async function loadInstallationStore({ force = false } = {}) {
  if (installationStore.loading) return installationStore.loading;
  if (installationStore.loaded && !force) return installationStore.profiles;

  installationStore.loading = (async () => {
    try {
      const data = await readInstallationFile();
      installationStore.profiles = normalizeProfilesStore(data ?? defaultStore(), PROFILE_SCOPES.GLOBAL).profiles
        .map((profile) => ({ ...profile, scope: PROFILE_SCOPES.GLOBAL }));
      installationStore.available = true;
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not read the installation loadouts.`, error);
      installationStore.available = false;
    } finally {
      installationStore.loaded = true;
      installationStore.loading = null;
    }
    return installationStore.profiles;
  })();
  return installationStore.loading;
}

export function isInstallationStoreAvailable() {
  return installationStore.available;
}

export function resetInstallationStore() {
  installationStore.profiles = [];
  installationStore.loaded = false;
  installationStore.available = true;
  installationStore.loading = null;
  installationStore.url = null;
  installationStore.revision = null;
}

// A write elsewhere: read the file again and redraw. The own write is already in the cache.
export async function onInstallationRevisionChange(revision) {
  if (revision !== null && revision !== undefined && revision === installationStore.revision) return;
  await loadInstallationStore({ force: true });
  refreshManager();
}

function isBrowserStoreMigrated() {
  return Boolean(getRegisteredSettingValue(INSTALLATION_MIGRATED_SETTING, false));
}

function getBrowserProfiles() {
  return normalizeProfilesStore(getRegisteredSettingValue(GLOBAL_PROFILES_SETTING, null), PROFILE_SCOPES.GLOBAL).profiles
    .map((profile) => ({ ...profile, scope: PROFILE_SCOPES.GLOBAL }));
}

export function uniqueProfileName(name, takenNames) {
  const taken = new Set(Array.from(takenNames, (entry) => String(entry).toLowerCase()));
  if (!taken.has(String(name).toLowerCase())) return name;
  for (let index = 2; ; index += 1) {
    const candidate = `${name} (${index})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function sameModules(left, right) {
  const a = [...left.moduleIds].sort();
  const b = [...right.moduleIds].sort();
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

// Until this browser's old installation loadouts are in the file, they show up next to the file's ones.
// The first write of the installation scope takes them along.
export function mergeBrowserProfiles(fileProfiles, browserProfiles) {
  const merged = [...fileProfiles];
  let added = 0;
  for (const profile of browserProfiles) {
    if (merged.some((entry) => entry.id === profile.id)) continue;
    const namesake = merged.find((entry) => entry.name.toLowerCase() === profile.name.toLowerCase());
    if (namesake && sameModules(namesake, profile)) continue;
    merged.push(namesake ? { ...profile, name: uniqueProfileName(profile.name, merged.map((entry) => entry.name)) } : profile);
    added += 1;
  }
  return { profiles: merged, added };
}

function getInstallationProfiles() {
  if (isBrowserStoreMigrated()) return installationStore.profiles;
  return mergeBrowserProfiles(installationStore.profiles, getBrowserProfiles()).profiles;
}

async function markBrowserStoreMigrated() {
  if (isBrowserStoreMigrated()) return;
  await game.settings.set(MODULE_ID, INSTALLATION_MIGRATED_SETTING, true);
}

// Moves this browser's installation loadouts of version 1.0.3 and older into the shared file. The old browser
// setting stays as it is.
export async function migrateBrowserProfiles() {
  if (isBrowserStoreMigrated() || !canManageModules()) return 0;
  const browserProfiles = getBrowserProfiles();
  await loadInstallationStore({ force: true });
  if (!installationStore.available) return 0;
  const { profiles, added } = mergeBrowserProfiles(installationStore.profiles, browserProfiles);
  try {
    if (added) await saveProfilesForScope(PROFILE_SCOPES.GLOBAL, profiles);
    else await markBrowserStoreMigrated();
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not move the installation loadouts of this browser.`, error);
    return 0;
  }
  if (added) ui.notifications?.info(localize("SML.Installation.Migrated", { count: added }));
  return added;
}

// ---------------------------------------------------------------------------------------------
// Profiles of both scopes
// ---------------------------------------------------------------------------------------------

export function getProfilesForScope(scope) {
  if (isGlobalScope(scope)) {
    return { version: STORAGE_VERSION, profiles: getInstallationProfiles() };
  }
  return normalizeProfilesStore(game.settings.get(MODULE_ID, WORLD_PROFILES_SETTING), scope);
}

export function getAllProfiles() {
  return [
    ...getProfilesForScope(PROFILE_SCOPES.GLOBAL).profiles,
    ...getProfilesForScope(PROFILE_SCOPES.WORLD).profiles
  ];
}

export async function saveProfilesForScope(scope, profiles) {
  const normalized = profiles.map((profile) => normalizeProfile({ ...profile, scope }, scope)).filter(Boolean);
  if (!isGlobalScope(scope)) {
    await game.settings.set(MODULE_ID, WORLD_PROFILES_SETTING, {
      version: STORAGE_VERSION,
      profiles: normalized
    });
    return;
  }

  if (!installationStore.available) throw new Error(localize("SML.Installation.Unavailable"));
  await writeInstallationFile(normalized);
  installationStore.profiles = normalized;
  installationStore.loaded = true;
  await markBrowserStoreMigrated();
  const revision = Date.now();
  installationStore.revision = revision;
  try {
    await game.settings.set(MODULE_ID, INSTALLATION_REVISION_SETTING, revision);
  } catch (error) {
    // Other clients only miss the live update, the file is written.
    console.warn(`${MODULE_ID} |`, error);
  }
  refreshManager();
}

// The installation file may have changed in another world or browser since it was read.
async function refreshBeforeWrite(scope) {
  if (isGlobalScope(scope)) await loadInstallationStore({ force: true });
}

export async function upsertProfile(profile) {
  const normalized = normalizeProfile(profile, profile.scope ?? PROFILE_SCOPES.WORLD);
  const scope = normalized.scope;
  await refreshBeforeWrite(scope);
  const store = getProfilesForScope(scope);
  const nextProfiles = store.profiles.some((entry) => entry.id === normalized.id)
    ? store.profiles.map((entry) => entry.id === normalized.id ? normalized : entry)
    : [...store.profiles, normalized];
  await saveProfilesForScope(scope, nextProfiles);
}

export async function removeProfile(profile) {
  const normalized = normalizeProfile(profile, profile.scope ?? PROFILE_SCOPES.WORLD);
  await refreshBeforeWrite(normalized.scope);
  const store = getProfilesForScope(normalized.scope);
  await saveProfilesForScope(normalized.scope, store.profiles.filter((entry) => entry.id !== normalized.id));
}

// Saves a profile into a scope and takes it out of the other one, for an edit that changes the scope.
// The new scope comes first: if writing it fails, the loadout is still where it was.
export async function moveProfile(previous, updated) {
  await upsertProfile(updated);
  if (previous && previous.scope !== updated.scope) await removeProfile(previous);
}

// Names are unique per scope without case, like the replace check of the save button and the import.
export function findNameConflict(name, scope, exceptId = null) {
  const lowered = cleanText(name).toLowerCase();
  if (!lowered) return null;
  return getProfilesForScope(scope).profiles
    .find((profile) => profile.id !== exceptId && profile.name.toLowerCase() === lowered) ?? null;
}

export function warnNameConflict(conflict) {
  ui.notifications?.warn(localizeHtml("SML.Notification.NameTaken", { name: conflict.name, scope: scopeLabel(conflict.scope) }));
}

export function findProfileById(profileId) {
  return getAllProfiles().find((entry) => entry.id === profileId) ?? null;
}

// API lookup: id first, then the name without case. The same name can exist in both scopes,
// the world profile wins then.
export function findProfile(idOrName) {
  const key = idOrName && typeof idOrName === "object" ? idOrName.id ?? idOrName.name : idOrName;
  const value = cleanText(key);
  if (!value) return null;

  const profiles = getAllProfiles();
  const byId = profiles.find((entry) => entry.id === value);
  if (byId) return byId;

  const lowered = value.toLowerCase();
  const byName = profiles.filter((entry) => entry.name.toLowerCase() === lowered);
  return byName.find((entry) => entry.scope === PROFILE_SCOPES.WORLD) ?? byName[0] ?? null;
}

export function findProfileOrWarn(idOrName) {
  const profile = findProfile(idOrName);
  if (!profile) {
    const name = idOrName && typeof idOrName === "object" ? idOrName.name ?? idOrName.id : idOrName;
    ui.notifications?.warn(localizeHtml("SML.Notification.ProfileNotFound", { name: String(name ?? "") }));
  }
  return profile;
}

export function createCurrentProfile({ name, description = "", tags = [], scope = PROFILE_SCOPES.WORLD, id = null, createdAt = null, auto = false, moduleIds = null, settings = null } = {}) {
  const timestamp = new Date().toISOString();
  const ids = moduleIds ?? getCurrentActiveModuleIds();
  return normalizeProfile({
    id: id ?? foundry.utils.randomID(),
    name,
    description,
    tags,
    scope,
    moduleIds: ids,
    moduleInfo: captureModuleInfo(ids),
    settings,
    createdAt: createdAt ?? timestamp,
    updatedAt: timestamp,
    auto
  }, scope);
}

// Keeps the newest automatic snapshots. On equal timestamps the later list entry counts as newer.
export function pruneAutoSnapshots(profiles, limit = MAX_AUTO_SNAPSHOTS) {
  const keep = new Set(profiles
    .map((profile, index) => ({ profile, index }))
    .filter(({ profile }) => profile.auto === true)
    .sort((left, right) => String(right.profile.createdAt).localeCompare(String(left.profile.createdAt)) || right.index - left.index)
    .slice(0, limit)
    .map(({ profile }) => profile.id));
  return profiles.filter((profile) => profile.auto !== true || keep.has(profile.id));
}

// Undo for "apply": the module state before the switch is stored as a world profile. Applying a
// snapshot creates the next one, the cap keeps that chain at MAX_AUTO_SNAPSHOTS entries.
export async function saveAutoSnapshot(appliedProfile, { settings = null, nameKey = "SML.Snapshot.Name", descriptionKey = "SML.Snapshot.Description" } = {}) {
  const snapshot = createCurrentProfile({
    name: localize(nameKey, { date: formatSnapshotDate() }),
    description: localize(descriptionKey, { name: appliedProfile.name }),
    tags: [AUTO_SNAPSHOT_TAG],
    scope: PROFILE_SCOPES.WORLD,
    settings,
    auto: true
  });
  const store = getProfilesForScope(PROFILE_SCOPES.WORLD);
  await saveProfilesForScope(PROFILE_SCOPES.WORLD, pruneAutoSnapshots([...store.profiles, snapshot]));
  return snapshot;
}

// Editing or duplicating a snapshot turns it into a regular profile that is never pruned.
export function asRegularProfile(profile) {
  if (profile?.auto !== true) return profile;
  const { auto: _auto, ...regular } = profile;
  return { ...regular, tags: (profile.tags ?? []).filter((tag) => tag !== AUTO_SNAPSHOT_TAG) };
}

// User profiles by name, automatic snapshots after them with the newest first.
export function sortProfilesForDisplay(profiles) {
  const byName = (left, right) => compareText(left.name, right.name);
  const byNewest = (left, right) => String(right.createdAt).localeCompare(String(left.createdAt));
  return [
    ...profiles.filter((profile) => profile.auto !== true).sort(byName),
    ...profiles.filter((profile) => profile.auto === true).sort(byNewest)
  ];
}

export function collectProfileTags(profiles) {
  const tags = new Map();
  for (const tag of profiles.flatMap((profile) => profile.tags ?? [])) {
    const key = tag.toLowerCase();
    if (!tags.has(key)) tags.set(key, tag);
  }
  return Array.from(tags.values()).sort(compareText);
}

export function profileMatchesFilter(profile, { search = "", tag = null } = {}) {
  if (tag && !(profile.tags ?? []).some((entry) => entry.toLowerCase() === tag.toLowerCase())) return false;
  const needle = cleanText(search).toLowerCase();
  if (!needle) return true;
  return [profile.name, profile.description, ...(profile.tags ?? [])].join("\n").toLowerCase().includes(needle);
}

// ---------------------------------------------------------------------------------------------
// Pinned modules
// ---------------------------------------------------------------------------------------------

// Applying a loadout leaves pinned modules as they are, on or off.
export function getPinnedModuleIds() {
  const stored = getRegisteredSettingValue(PINNED_MODULES_SETTING, []);
  const ids = Array.isArray(stored) ? stored : Array.from(stored ?? []);
  return Array.from(new Set(ids.map((id) => cleanText(id)).filter((id) => id && id !== MODULE_ID && game.modules.has(id))))
    .sort(compareModuleIdsByTitle);
}

export async function setPinnedModuleIds(ids) {
  const unique = Array.from(new Set(Array.from(ids ?? []).map((id) => cleanText(id)).filter((id) => id && id !== MODULE_ID)));
  await game.settings.set(MODULE_ID, PINNED_MODULES_SETTING, unique);
  return unique;
}

// ---------------------------------------------------------------------------------------------
// Export and import
// ---------------------------------------------------------------------------------------------

export function buildExportPayload() {
  return {
    module: MODULE_ID,
    formatVersion: STORAGE_VERSION,
    exportedAt: new Date().toISOString(),
    worldId: game.world?.id ?? null,
    worldTitle: game.world?.title ?? game.world?.id ?? null,
    profiles: getAllProfiles()
  };
}

export function exportProfiles() {
  const filename = localize("SML.Export.FileName", { worldId: game.world?.id ?? "world" });
  foundry.utils.saveDataToFile(JSON.stringify(buildExportPayload(), null, 2), "application/json", filename);
}

export function parseImportText(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_error) {
    throw new Error(localize("SML.Import.Invalid"));
  }
  const importedProfiles = normalizeProfilesStore(data, PROFILE_SCOPES.GLOBAL).profiles;
  if (!importedProfiles.length) throw new Error(localize("SML.Import.Invalid"));
  return importedProfiles;
}

// One entry per imported loadout: the stored one it would replace (same id first, then the same name) or none.
export function planImport(importedProfiles) {
  return importedProfiles.map((imported) => {
    const scope = imported.scope ?? PROFILE_SCOPES.GLOBAL;
    const stored = getProfilesForScope(scope).profiles;
    const byId = stored.find((profile) => profile.id === imported.id);
    const existing = byId ?? stored.find((profile) => profile.name.toLowerCase() === imported.name.toLowerCase()) ?? null;
    return { profile: { ...imported, scope }, existing, match: byId ? "id" : existing ? "name" : null };
  });
}

export async function applyImportPlan(plan, choices = []) {
  // The installation file may have changed in another world or browser since the plan was made.
  if (plan.some((entry, index) => isGlobalScope(entry.profile.scope) && choices[index] !== IMPORT_CHOICES.SKIP)) {
    await loadInstallationStore({ force: true });
  }
  const grouped = {
    [PROFILE_SCOPES.WORLD]: Array.from(getProfilesForScope(PROFILE_SCOPES.WORLD).profiles),
    [PROFILE_SCOPES.GLOBAL]: Array.from(getProfilesForScope(PROFILE_SCOPES.GLOBAL).profiles)
  };
  const touched = new Set();
  const counts = { added: 0, replaced: 0, skipped: 0 };

  plan.forEach((entry, index) => {
    const choice = choices[index] ?? IMPORT_CHOICES.REPLACE;
    const imported = entry.profile;
    const scope = imported.scope;
    const bucket = grouped[scope];
    if (choice === IMPORT_CHOICES.SKIP) {
      counts.skipped += 1;
      return;
    }
    touched.add(scope);

    // Looked up again in the bucket, an earlier entry of the same file may have replaced the match.
    const byId = bucket.findIndex((profile) => profile.id === imported.id);
    const target = choice === IMPORT_CHOICES.REPLACE
      ? (byId >= 0 ? byId : bucket.findIndex((profile) => profile.name.toLowerCase() === imported.name.toLowerCase()))
      : -1;

    if (target >= 0) {
      // The stored id stays, otherwise a name match could take over an id that another profile already has.
      bucket[target] = normalizeProfile({
        ...bucket[target],
        ...imported,
        id: bucket[target].id,
        createdAt: bucket[target].createdAt ?? imported.createdAt,
        scope
      }, scope);
      counts.replaced += 1;
      return;
    }

    // Ids are unique across both scopes, the manager and the API look profiles up by id.
    const usedIds = new Set([...grouped[PROFILE_SCOPES.WORLD], ...grouped[PROFILE_SCOPES.GLOBAL]].map((profile) => profile.id));
    const id = usedIds.has(imported.id) ? foundry.utils.randomID() : imported.id;
    const name = uniqueProfileName(imported.name, bucket.map((profile) => profile.name));
    bucket.push(normalizeProfile({ ...imported, id, name }, scope));
    counts.added += 1;
  });

  for (const scope of touched) await saveProfilesForScope(scope, grouped[scope]);
  return counts;
}

// choose(plan) returns one choice per entry, or null to cancel. Without it every conflict is replaced.
export async function importProfilesFromFile(file, { choose = null } = {}) {
  const text = await foundry.utils.readTextFromFile(file);
  const plan = planImport(parseImportText(text));
  const choices = choose ? await choose(plan) : plan.map(() => IMPORT_CHOICES.REPLACE);
  if (!choices) return null;

  const counts = await applyImportPlan(plan, choices);
  ui.notifications?.info(localize("SML.Notification.Imported", {
    count: plan.length - counts.skipped,
    added: counts.added,
    replaced: counts.replaced
  }));
  return counts;
}
