import assert from "node:assert/strict";
import test from "node:test";

import { createFakeForm, createTestEnvironment, modulePath, pressDialogButton } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));

function worldProfiles() {
  return env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.WORLD_PROFILES_SETTING}`).profiles;
}

test.beforeEach(() => {
  env.reset();
  __test__.resetInstallationStore();
  env.addModule(__test__.MODULE_ID, { title: "Loadouts" });
  env.addModule("module-a", { title: "Alpha" });
  env.addModule("module-b", { title: "Beta" });
  env.state.settingsValues.set("core.moduleConfiguration", { [__test__.MODULE_ID]: true, "module-a": true });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.WORLD_PROFILES_SETTING}`, { version: 2, profiles: [] });
  env.state.localizations.set("Alpha Color", "Color of Alpha");

  env.registerSetting("module-a", "color", { name: "Alpha Color", default: "red" });
  env.registerSetting("module-a", "count", { default: 3 });
  env.registerSetting("module-a", "data", { config: false, default: {} });
  env.registerSetting("module-a", "local", { scope: "client" });
  env.registerSetting("module-b", "mode", { default: "x" });
  env.registerSetting(__test__.MODULE_ID, "uiTheme", { scope: "world" });
  env.registerSetting("core", "something", { scope: "world" });
  env.setWorldSetting("module-a.color", "blue");
  env.setWorldSetting("module-a.data", { list: [1, 2] });
  // A module that is not active: stored, but nothing registered.
  env.setWorldSetting("module-c.size", 7);
  env.state.worldSettings.add("module-a.color", "user value", "some-user");
});

test.after(() => {
  env.restore();
});

test("setting keys: visible ones of the loadout's modules, all ones also hidden and unregistered", () => {
  assert.deepEqual(__test__.collectSettingKeys(["module-a", __test__.MODULE_ID, "core"]), ["module-a.color", "module-a.count"]);
  assert.deepEqual(__test__.collectSettingKeys(["module-a", "module-c"], __test__.SETTINGS_MODES.ALL), ["module-a.color", "module-a.count", "module-a.data", "module-c.size"]);
  assert.deepEqual(__test__.collectSettingKeys([]), []);
});

test("capturing keeps stored values, defaults by key and leaves out data stores that are too large", () => {
  const { settings, skipped } = __test__.captureLoadoutSettings(["module-a", "module-b"], __test__.SETTINGS_MODES.VISIBLE, { now: new Date("2026-10-24T10:00:00.000Z") });
  assert.deepEqual(settings, {
    mode: "visible",
    capturedAt: "2026-10-24T10:00:00.000Z",
    values: { "module-a.color": "blue" },
    defaults: ["module-a.count", "module-b.mode"]
  });
  assert.deepEqual(skipped, []);

  env.setWorldSetting("module-a.data", { blob: "x".repeat(__test__.MAX_SETTING_JSON_LENGTH) });
  const all = __test__.captureLoadoutSettings(["module-a"], __test__.SETTINGS_MODES.ALL);
  assert.deepEqual(all.skipped, ["module-a.data"]);
  assert.equal("module-a.data" in all.settings.values, false);

  assert.deepEqual(__test__.captureLoadoutSettings(["module-a"], __test__.SETTINGS_MODES.NONE), { settings: null, skipped: [], secret: [] });
  assert.deepEqual(__test__.captureLoadoutSettings(["module-x"], __test__.SETTINGS_MODES.VISIBLE), { settings: null, skipped: [], secret: [] });

  // A value stored as a plain string (not JSON) is kept as it is.
  env.state.worldSettings.getSetting("module-a.color")._source.value = "not json";
  assert.equal(__test__.readStoredWorldSetting("module-a.color").value, "not json");
  assert.deepEqual(__test__.readStoredWorldSetting("module-a.count"), { stored: false, value: undefined, doc: null });
});

test("normalizing drops foreign keys, keeps defaults apart from values and empties to null", () => {
  assert.deepEqual(__test__.normalizeLoadoutSettings({
    mode: "odd",
    capturedAt: 5,
    values: { "module-a.color": "blue", "core.x": 1, "sephrals-module-loadouts.uiTheme": "x", nodot: 1, "module-a.gone": undefined },
    defaults: ["module-a.count", "module-a.count", "module-a.color", "bad", " module-b.mode "]
  }), {
    mode: "visible",
    capturedAt: "5",
    values: { "module-a.color": "blue" },
    defaults: ["module-a.count", "module-b.mode"]
  });
  assert.equal(__test__.normalizeLoadoutSettings({ values: {}, defaults: [] }), null);
  assert.equal(__test__.normalizeLoadoutSettings("x"), null);
  assert.equal(__test__.normalizeLoadoutSettings({ mode: "all", values: { "module-a.x": null } }).mode, "all");
  assert.deepEqual(__test__.settingKeysOf({ values: { "b.x": 1 }, defaults: ["a.y"] }), ["a.y", "b.x"]);
  assert.deepEqual(__test__.settingKeysOf(null), []);
});

test("the changes leave out equal values and registered defaults and reset stored ones", () => {
  const settings = __test__.normalizeLoadoutSettings({
    values: {
      "module-a.color": "blue",
      "module-a.data": { list: [1, 2] },
      "module-a.count": 3,
      "module-b.mode": "y",
      "module-c.size": 9
    },
    defaults: ["module-a.local", "module-b.never"]
  });
  env.setWorldSetting("module-a.local", "stored");
  // Same object, other key order: no change.
  env.state.worldSettings.getSetting("module-a.data")._source.value = JSON.stringify({ list: [1, 2] });
  const changes = __test__.collectSettingsChanges(settings);
  assert.deepEqual(changes.map((change) => [change.key, change.action, change.from, change.fromStored]), [
    ["module-a.local", "reset", "stored", true],
    ["module-b.mode", "set", undefined, false],
    ["module-c.size", "set", 7, true]
  ]);
  assert.deepEqual(__test__.collectSettingsChanges(null), []);
  assert.equal(__test__.stableJson({ b: 1, a: { d: 2, c: 3 } }), "{\"a\":{\"c\":3,\"d\":2},\"b\":1}");

  const before = __test__.captureSettingsBeforeChanges(changes, { now: new Date("2026-01-01T00:00:00.000Z") });
  assert.deepEqual(before, {
    mode: "all",
    capturedAt: "2026-01-01T00:00:00.000Z",
    values: { "module-a.local": "stored", "module-c.size": 7 },
    defaults: ["module-b.mode"]
  });
  assert.equal(__test__.captureSettingsBeforeChanges([]), null);
});

test("writing creates, updates and deletes Setting documents in one call each", async () => {
  env.setWorldSetting("module-a.local", "stored");
  const count = await __test__.writeSettingsChanges([
    { key: "module-b.mode", action: "set", value: "y" },
    { key: "module-a.color", action: "set", value: { deep: true } },
    { key: "module-a.local", action: "reset" },
    { key: "module-a.count", action: "reset" }
  ]);
  assert.equal(count, 3);
  assert.deepEqual(env.state.settingDocumentCalls.map((call) => call.op), ["create", "update", "delete"]);
  assert.deepEqual(env.state.settingDocumentCalls[0].data, [{ key: "module-b.mode", value: "\"y\"" }]);
  assert.equal(__test__.readStoredWorldSetting("module-a.color").value.deep, true);
  assert.equal(__test__.readStoredWorldSetting("module-a.local").stored, false);
  assert.equal(await __test__.writeSettingsChanges([]), 0);
});

test("labels and previews for the dialogs", () => {
  assert.equal(__test__.settingLabel("module-a.color"), "Color of Alpha");
  assert.equal(__test__.settingLabel("module-c.size.inner"), "size.inner");
  assert.equal(__test__.previewSettingValue(undefined), "default");
  assert.equal(__test__.previewSettingValue("text"), "text");
  assert.equal(__test__.previewSettingValue({ a: 1 }), "{\"a\":1}");
  assert.equal(__test__.previewSettingValue("y".repeat(100)).length, 60);
  // Settings with choices show the label of the choice.
  env.registerSetting("module-a", "mode", { default: "all", choices: { all: "Everyone", gm: "Gamemaster only" } });
  assert.equal(__test__.previewSettingValue("gm", "module-a.mode"), "Gamemaster only");
  assert.equal(__test__.previewSettingValue("other", "module-a.mode"), "other");
  assert.equal(__test__.describeSettingsChange({ key: "module-a.mode", action: "set", value: "gm", from: "all", fromStored: true }).from, "Everyone");
  assert.deepEqual(__test__.describeSettingsChange({ key: "module-a.color", action: "set", value: "green", from: "blue", fromStored: true }), {
    key: "module-a.color",
    module: "Alpha",
    label: "Color of Alpha",
    from: "blue",
    to: "green"
  });
  assert.deepEqual(__test__.describeSettingsChange({ key: "module-b.mode", action: "reset", from: "y", fromStored: true }).to, "default");
  assert.deepEqual(__test__.summarizeLoadoutSettings({ values: { "module-a.x": 1, "module-b.y": 2 }, defaults: ["module-a.z"] }), { count: 3, moduleCount: 2 });
});

test("applying a loadout with settings writes them before the modules and the snapshot can undo them", async () => {
  env.registerSetting(__test__.MODULE_ID, __test__.WORLD_PROFILES_SETTING, { scope: "world", config: false });
  const loadout = __test__.normalizeProfile({
    id: "with-settings",
    name: "With Settings",
    moduleIds: ["module-a", "module-b"],
    settings: { values: { "module-a.color": "green", "module-b.mode": "z" }, defaults: ["module-a.data"] }
  });
  // How many setting writes happened when the Setting documents were written.
  const writesAtUpdate = [];
  const originalUpdate = env.SettingDocument.updateDocuments;
  env.SettingDocument.updateDocuments = async (updates) => {
    writesAtUpdate.push(env.state.settingWrites.length);
    return originalUpdate(updates);
  };
  const pressed = [];
  env.state.dialogV2WaitHandler = (options) => {
    pressed.push(options);
    return pressDialogButton(options, "apply", createFakeForm({ applySettings: true }));
  };
  assert.equal(await __test__.applyProfile(loadout), true);
  assert.match(pressed[0].content, /Settings \(3\):/);
  assert.match(pressed[0].content, /name="applySettings"/);
  assert.equal(__test__.readStoredWorldSetting("module-a.color").value, "green");
  assert.equal(__test__.readStoredWorldSetting("module-b.mode").value, "z");
  assert.equal(__test__.readStoredWorldSetting("module-a.data").stored, false);
  assert.equal(env.state.notifications.info.includes("settings applied 3"), true);
  // Settings first, then the module switch.
  env.SettingDocument.updateDocuments = originalUpdate;
  const coreWrite = env.state.settingWrites.findIndex((entry) => entry.moduleId === "core");
  assert.equal(coreWrite >= 0, true);
  assert.equal(writesAtUpdate.length, 1);
  assert.equal(writesAtUpdate[0] <= coreWrite, true);

  const snapshot = worldProfiles().find((entry) => entry.auto);
  assert.deepEqual(snapshot.settings.values, { "module-a.color": "blue", "module-a.data": { list: [1, 2] } });
  assert.deepEqual(snapshot.settings.defaults, ["module-b.mode"]);

  // Undo puts the settings back, without a question.
  assert.equal(await __test__.applyProfile(__test__.normalizeProfile(snapshot), { confirm: __test__.CONFIRM_MODES.NEVER }), true);
  assert.equal(__test__.readStoredWorldSetting("module-a.color").value, "blue");
  assert.equal(__test__.readStoredWorldSetting("module-b.mode").stored, false);
  assert.deepEqual(__test__.readStoredWorldSetting("module-a.data").value, { list: [1, 2] });
});

test("only settings differ: no module write, but the reload question; unticked settings change nothing", async () => {
  const loadout = __test__.normalizeProfile({
    id: "same-modules",
    name: "Same Modules",
    moduleIds: ["module-a"],
    settings: { values: { "module-a.color": "green" } }
  });
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "apply", createFakeForm({ applySettings: false }));
  assert.equal(await __test__.applyProfile(loadout), false);
  assert.equal(env.state.notifications.info.at(-1), "no changes");
  assert.equal(__test__.readStoredWorldSetting("module-a.color").value, "blue");

  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "apply", createFakeForm({ applySettings: true }));
  assert.equal(await __test__.applyProfile(loadout), true);
  assert.equal(__test__.readStoredWorldSetting("module-a.color").value, "green");
  assert.equal(env.state.settingWrites.some((entry) => entry.moduleId === "core"), false);
  assert.deepEqual(env.state.reloadCalls, [{ world: true }]);

  // The API can leave the settings out.
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.WORLD_PROFILES_SETTING}`, { version: 2, profiles: [__test__.normalizeProfile({ ...loadout, settings: { values: { "module-a.color": "black" } } })] });
  assert.equal(await __test__.apiApply("Same Modules", { confirm: false, settings: false }), false);
  assert.equal(__test__.readStoredWorldSetting("module-a.color").value, "green");
  assert.deepEqual(__test__.apiCompare("Same Modules").settings, ["module-a.color"]);
});

test("saving through the API or the manager form takes the settings along", async () => {
  const saved = await __test__.apiSaveCurrent("Visible", { settings: "visible" });
  assert.deepEqual(saved.settings.values, { "module-a.color": "blue" });
  assert.deepEqual(saved.settings.defaults, ["module-a.count"]);
  assert.equal((await __test__.apiSaveCurrent("Plain")).settings, undefined);

  const resolved = __test__.resolveProfileSettings("keep", ["module-a"], saved.settings);
  assert.equal(resolved.settings, saved.settings);
  assert.equal(__test__.resolveProfileSettings("none", ["module-a"], saved.settings).settings, null);
  assert.equal(__test__.resolveProfileSettings("all", ["module-a"]).settings.mode, "all");

  const fresh = __test__.renderProfileForm({ name: "New" });
  assert.match(fresh, /value="none" selected/);
  assert.doesNotMatch(fresh, /value="keep"/);
  const existing = __test__.renderProfileForm({ name: "Old", settings: saved.settings });
  assert.match(existing, /value="keep" selected/);
  assert.deepEqual(__test__.readProfileForm(createFakeForm({ profileName: " N ", profileSettings: "visible" })), {
    name: "N",
    description: "",
    tags: "",
    scope: "world",
    settings: "visible"
  });

  // The manager warns when there is nothing to take along.
  env.state.localizations.set("SML.Notification.NoSettingsFound", "no settings");
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "save", createFakeForm({ profileName: "Nothing", profileScope: "world", profileSettings: "visible" }));
  env.state.settingsValues.set("core.moduleConfiguration", { [__test__.MODULE_ID]: true });
  const manager = new __test__.SMLLoadoutsManager();
  await manager._onSaveCurrent();
  assert.equal(env.state.notifications.warn.at(-1), "no settings");
  assert.equal(worldProfiles().find((entry) => entry.name === "Nothing").settings, undefined);
});

test("settings that look like passwords or access keys are never captured", () => {
  env.registerSetting("module-a", "apiKey", { default: "" });
  env.registerSetting("module-a", "serverPassword", { default: "" });
  env.registerSetting("module-a", "accessToken", { default: "" });
  env.registerSetting("module-a", "tokenColor", { default: "" });
  env.setWorldSetting("module-a.apiKey", "sk-123");
  const { settings, secret } = __test__.captureLoadoutSettings(["module-a"]);
  assert.deepEqual(secret, ["module-a.accessToken", "module-a.apiKey", "module-a.serverPassword"]);
  assert.equal("module-a.apiKey" in settings.values, false);
  assert.equal(__test__.isSecretSettingKey("module-a.color"), false);
  assert.equal(__test__.isSecretSettingKey("module-a.openai-api-key"), true);
  assert.equal(__test__.isSecretSettingKey("module-a.discordWebhook"), true);
  assert.equal(__test__.isSecretSettingKey("module-a.botToken"), true);
  assert.equal(__test__.isSecretSettingKey("module-a.token"), true);
  // Tokens on the canvas, authors and passive scores are no secrets.
  for (const key of ["tokenColor", "showTokenNames", "defaultToken", "author", "showPassivePerception", "compassSize"]) {
    assert.equal(__test__.isSecretSettingKey(`module-a.${key}`), false, key);
  }
  // The namespace alone does not count.
  assert.equal(__test__.isSecretSettingKey("token-tools.size"), false);

  env.state.localizations.set("SML.Notification.SettingsSecret", "secret {count}");
  env.state.dialogV2WaitHandler = null;
});
