// Settings that travel with a loadout: the world settings of its modules, read from and written to the world's
// Setting documents directly. That also works for modules that are not active yet and have not registered them.

import { MODULE_ID, localize, moduleTitle } from "./core.mjs";

export const SETTINGS_MODES = Object.freeze({
  NONE: "none",
  VISIBLE: "visible",
  ALL: "all"
});
// Values this large are data stores of a module rather than configuration.
export const MAX_SETTING_JSON_LENGTH = 200000;
const VALUE_PREVIEW_LENGTH = 60;
const SETTING_KEY_PATTERN = /^[^.\s]+\.\S+$/;
// Loadouts end up in exports and in the installation file, which the server hands out without a login.
// Settings whose key looks like a password or an access key never go in. A plain "token" is a game piece in
// Foundry (tokenColor, showTokenNames) and "auth" starts "author", so only access tokens and auth keys count.
const SECRET_KEY_PATTERN = /pass(word|phrase|wd)|secret|credential|webhook|authorization|private[-_ ]?key|license[-_ ]?key|(api|access|auth|client|discord|github|patreon|twitch|openai)[-_ ]?(key|token)|(bearer|refresh|session|bot|oauth)[-_ ]?token|^(token|auth)$/i;

export function isSecretSettingKey(key) {
  return SECRET_KEY_PATTERN.test(String(key ?? "").split(".").slice(1).join("."));
}

function isLoadoutSettingKey(key) {
  if (!SETTING_KEY_PATTERN.test(String(key ?? ""))) return false;
  const namespace = settingNamespace(key);
  return namespace !== MODULE_ID && namespace !== "core";
}

export function settingNamespace(key) {
  return String(key ?? "").split(".")[0];
}

function worldStorage() {
  return game.settings?.storage?.get?.("world") ?? null;
}

function settingDocumentClass() {
  return globalThis.CONFIG?.Setting?.documentClass ?? foundry.documents?.Setting;
}

// Keys sorted, so equal objects compare equal however a module built them.
export function stableJson(value) {
  return JSON.stringify(value, (_key, entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]));
  });
}

function sameValue(left, right) {
  return stableJson(left) === stableJson(right);
}

export function normalizeLoadoutSettings(value) {
  if (!value || typeof value !== "object") return null;
  const values = {};
  for (const [key, entry] of Object.entries(value.values ?? {})) {
    if (isLoadoutSettingKey(key) && entry !== undefined) values[key] = entry;
  }
  const defaults = Array.from(new Set((Array.isArray(value.defaults) ? value.defaults : [])
    .map((key) => String(key ?? "").trim())
    .filter((key) => isLoadoutSettingKey(key) && !(key in values))))
    .sort();
  if (!Object.keys(values).length && !defaults.length) return null;

  return {
    mode: value.mode === SETTINGS_MODES.ALL ? SETTINGS_MODES.ALL : SETTINGS_MODES.VISIBLE,
    capturedAt: String(value.capturedAt ?? ""),
    values,
    defaults
  };
}

export function settingKeysOf(settings) {
  if (!settings) return [];
  return [...Object.keys(settings.values ?? {}), ...(settings.defaults ?? [])].sort();
}

// The stored value of a world setting, parsed but not cast. "stored: false" means the world uses the default.
export function readStoredWorldSetting(key) {
  const doc = worldStorage()?.getSetting?.(key, null) ?? null;
  if (!doc) return { stored: false, value: undefined, doc: null };
  const raw = doc._source?.value ?? null;
  if (typeof raw !== "string") return { stored: true, value: raw, doc };
  try {
    return { stored: true, value: JSON.parse(raw), doc };
  } catch (_error) {
    return { stored: true, value: raw, doc };
  }
}

// Visible settings are the ones in Configure Settings. "All" also takes hidden ones and the stored values of
// modules that are not active, whose settings are not registered.
export function collectSettingKeys(moduleIds, mode = SETTINGS_MODES.VISIBLE) {
  const namespaces = new Set(Array.from(moduleIds ?? []).filter((id) => id !== MODULE_ID && id !== "core"));
  const keys = new Set();
  for (const [key, config] of game.settings?.settings ?? []) {
    if (!namespaces.has(config?.namespace ?? settingNamespace(key))) continue;
    if (config?.scope !== "world") continue;
    if (mode !== SETTINGS_MODES.ALL && config?.config !== true) continue;
    keys.add(key);
  }
  if (mode === SETTINGS_MODES.ALL) {
    for (const doc of worldStorage() ?? []) {
      if (doc?.user || !namespaces.has(settingNamespace(doc?.key))) continue;
      if (!game.settings?.settings?.has(doc.key)) keys.add(doc.key);
    }
  }
  return Array.from(keys).filter(isLoadoutSettingKey).sort();
}

function jsonLength(value) {
  try {
    return JSON.stringify(value ?? null).length;
  } catch (_error) {
    return Infinity;
  }
}

export function captureLoadoutSettings(moduleIds, mode = SETTINGS_MODES.VISIBLE, { now = new Date() } = {}) {
  if (mode !== SETTINGS_MODES.VISIBLE && mode !== SETTINGS_MODES.ALL) return { settings: null, skipped: [], secret: [] };
  const values = {};
  const defaults = [];
  const skipped = [];
  const secret = [];
  for (const key of collectSettingKeys(moduleIds, mode)) {
    if (isSecretSettingKey(key)) {
      secret.push(key);
      continue;
    }
    const current = readStoredWorldSetting(key);
    if (!current.stored) {
      defaults.push(key);
      continue;
    }
    if (jsonLength(current.value) > MAX_SETTING_JSON_LENGTH) {
      skipped.push(key);
      continue;
    }
    values[key] = current.value;
  }
  return {
    settings: normalizeLoadoutSettings({ mode, capturedAt: now.toISOString(), values, defaults }),
    skipped,
    secret
  };
}

function registeredDefault(key) {
  const config = game.settings?.settings?.get(key);
  return config && "default" in config ? { known: true, value: config.default } : { known: false };
}

// What applying the saved settings would change in this world. Values that already match are left out.
export function collectSettingsChanges(settings) {
  if (!settings) return [];
  const changes = [];
  for (const [key, value] of Object.entries(settings.values ?? {})) {
    const current = readStoredWorldSetting(key);
    if (current.stored && sameValue(current.value, value)) continue;
    if (!current.stored) {
      const fallback = registeredDefault(key);
      if (fallback.known && sameValue(fallback.value, value)) continue;
    }
    changes.push({ key, action: "set", value, from: current.value, fromStored: current.stored });
  }
  for (const key of settings.defaults ?? []) {
    const current = readStoredWorldSetting(key);
    if (current.stored) changes.push({ key, action: "reset", value: undefined, from: current.value, fromStored: true });
  }
  return changes.sort((left, right) => left.key.localeCompare(right.key));
}

// The state before an apply, as loadout settings: applying it puts every changed setting back.
export function captureSettingsBeforeChanges(changes, { now = new Date() } = {}) {
  const values = {};
  const defaults = [];
  for (const change of changes ?? []) {
    if (change.fromStored) values[change.key] = change.from;
    else defaults.push(change.key);
  }
  return normalizeLoadoutSettings({ mode: SETTINGS_MODES.ALL, capturedAt: now.toISOString(), values, defaults });
}

export async function writeSettingsChanges(changes) {
  if (!changes?.length) return 0;
  const SettingClass = settingDocumentClass();
  const create = [];
  const update = [];
  const remove = [];
  for (const change of changes) {
    const doc = worldStorage()?.getSetting?.(change.key, null) ?? null;
    if (change.action === "reset") {
      if (doc) remove.push(doc.id);
      continue;
    }
    const value = JSON.stringify(change.value ?? null);
    if (doc) update.push({ _id: doc.id, value });
    else create.push({ key: change.key, value });
  }
  if (create.length) await SettingClass.createDocuments(create);
  if (update.length) await SettingClass.updateDocuments(update);
  if (remove.length) await SettingClass.deleteDocuments(remove);
  return create.length + update.length + remove.length;
}

export function settingLabel(key) {
  const config = game.settings?.settings?.get(key);
  const name = config?.name ? localize(config.name) : "";
  return name || String(key ?? "").split(".").slice(1).join(".");
}

// With the key of a setting that offers choices, the label of the choice instead of its stored value.
export function previewSettingValue(value, key = null) {
  if (value === undefined) return localize("SML.LoadoutSettings.DefaultValue");
  const choice = key ? game.settings?.settings?.get(key)?.choices?.[value] : null;
  if (typeof choice === "string" && choice) return localize(choice);
  let text;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch (_error) {
    text = String(value);
  }
  text = String(text ?? "");
  return text.length > VALUE_PREVIEW_LENGTH ? `${text.slice(0, VALUE_PREVIEW_LENGTH - 3)}...` : text;
}

export function describeSettingsChange(change) {
  return {
    key: change.key,
    module: moduleTitle(settingNamespace(change.key)),
    label: settingLabel(change.key),
    from: previewSettingValue(change.fromStored ? change.from : undefined, change.key),
    to: previewSettingValue(change.action === "reset" ? undefined : change.value, change.key)
  };
}

export function summarizeLoadoutSettings(settings) {
  const keys = settingKeysOf(settings);
  return {
    count: keys.length,
    moduleCount: new Set(keys.map(settingNamespace)).size
  };
}
