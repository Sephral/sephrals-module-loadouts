import assert from "node:assert/strict";
import test from "node:test";

import { createFakeForm, createTestEnvironment, flushPromises, modulePath, pressDialogButton } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));
const PINNED_KEY = `sephrals-module-loadouts.${__test__.PINNED_MODULES_SETTING}`;

function profile(overrides = {}) {
  return __test__.normalizeProfile({ id: "p1", name: "Alpha", moduleIds: ["module-a"], ...overrides }, overrides.scope ?? "world");
}

function setPinned(ids) {
  env.state.settingsRegistry.set(PINNED_KEY, { namespace: __test__.MODULE_ID, key: __test__.PINNED_MODULES_SETTING });
  env.state.settingsValues.set(PINNED_KEY, ids);
}

test.beforeEach(() => {
  env.reset();
  __test__.resetInstallationStore();
  env.addModule(__test__.MODULE_ID, { title: "Loadouts" });
  env.addModule("module-a", { title: "Alpha", version: "2.0.0" });
  env.addModule("module-b", { title: "Beta", relationships: { requires: [{ id: "module-lib", type: "module" }] } });
  env.addModule("module-lib", { title: "Library", library: true });
  env.addModule("module-lib2", { title: "Spare Library", library: true });
  env.addModule("module-pin", { title: "Pinned" });
  env.state.settingsValues.set("core.moduleConfiguration", { [__test__.MODULE_ID]: true, "module-a": true, "module-pin": true });
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.WORLD_PROFILES_SETTING}`, { version: 2, profiles: [] });
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, options.buttons[0].action);
});

test.after(() => {
  env.restore();
});

test("pinned modules keep their state in comparison, preflight and the switch", async () => {
  setPinned(["module-pin", "module-b"]);
  const loadout = profile({ moduleIds: ["module-a", "module-b"] });
  const comparison = __test__.buildComparison(loadout);
  assert.deepEqual(comparison.toEnable, []);
  assert.deepEqual(comparison.toDisable, []);
  assert.deepEqual(comparison.pinnedKept.sort(), ["module-b", "module-pin"]);

  const preflight = __test__.collectProfilePreflight(loadout);
  assert.deepEqual(Array.from(preflight.desiredIds).sort(), [__test__.MODULE_ID, "module-a", "module-pin"].sort());

  // A pinned library that a loadout module needs is still switched on.
  setPinned(["module-lib"]);
  const needsLibrary = __test__.collectProfilePreflight(profile({ moduleIds: ["module-b"] }));
  assert.equal(needsLibrary.desiredIds.has("module-lib"), true);

  setPinned(["module-pin"]);
  let content = "";
  env.state.dialogV2WaitHandler = (options) => {
    content = options.content;
    return pressDialogButton(options, "apply");
  };
  assert.equal(await __test__.applyProfile(profile({ moduleIds: ["module-b"] })), true);
  assert.match(content, /SML\.Dialog\.ConfirmApply\.Pinned|Pinned:/);
  assert.deepEqual(Object.keys(env.state.settingsValues.get("core.moduleConfiguration")).sort(), [__test__.MODULE_ID, "module-b", "module-lib", "module-pin"].sort());
});

test("cards show updates since saving, unneeded libraries, settings and links for missing modules", () => {
  setPinned(["module-pin"]);
  env.registerSetting("module-a", "color", { default: "red" });
  env.setWorldSetting("module-a.color", "blue");
  const loadout = profile({
    moduleIds: ["module-a", "module-b", "module-lib", "module-lib2", "gone"],
    moduleInfo: {
      "module-a": { title: "Alpha", version: "1.0.0" },
      gone: { title: "Gone Module", version: "3.1.0", manifest: "https://example.com/gone/module.json" }
    },
    settings: { values: { "module-a.color": "green" }, defaults: [] }
  });
  env.state.localizations.set("SML.Manager.ChangedBadge", "Updated: {count}");
  const card = __test__.presentProfile(loadout);
  assert.equal(card.changedCount, 1);
  assert.deepEqual(card.changedList, ["Alpha: 1.0.0 → 2.0.0"]);
  assert.equal(card.changedBadge, "Updated: 1");
  assert.deepEqual(card.unusedLibraryList, ["Spare Library"]);
  assert.equal(card.settingsCount, 1);
  assert.equal(card.settingsChangeCount, 1);
  assert.deepEqual(card.settingsChangeList, ["Alpha: color (blue → green)"]);
  assert.deepEqual(card.missingList, [{
    id: "gone",
    title: "Gone Module",
    version: "3.1.0",
    manifest: "https://example.com/gone/module.json",
    url: "",
    page: "https://foundryvtt.com/packages/gone"
  }]);
  assert.equal(card.missingTitles, "Gone Module");
  assert.deepEqual(card.pinnedList, ["Pinned"]);
  assert.equal(card.hasModuleDetails, true);

  assert.deepEqual(__test__.findChangedVersions(profile({ moduleInfo: { "module-a": { version: "2.0.0" } } })), []);
  assert.deepEqual(__test__.describeMissingModules(profile(), ["x"]), [{ id: "x", title: "x", version: "", manifest: "", url: "" }]);
  // A library recommended by a module of the loadout is needed.
  env.state.modules.get("module-a").relationships.recommends.push({ id: "module-lib2" });
  assert.deepEqual(__test__.findUnusedLibraries(profile({ moduleIds: ["module-a", "module-lib2"] })), []);
});

test("the pinned dialog lists installed modules and saves the ticked ones", async () => {
  setPinned(["module-b"]);
  const html = __test__.renderPinnedForm();
  assert.match(html, /value="module-b" checked/);
  assert.doesNotMatch(html, /value="sephrals-module-loadouts"/);
  assert.match(html, /data-search="alpha module-a"/);

  // The search box filters rows.
  const rows = [{ dataset: { search: "alpha module-a" }, hidden: false }, { dataset: { search: "beta module-b" }, hidden: false }];
  const search = { value: "", listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; } };
  const element = { querySelector: () => search, querySelectorAll: () => rows };
  env.state.dialogV2WaitHandler = async (options) => {
    options.render({}, { element });
    search.value = "BETA";
    search.listeners.input();
    let prevented = false;
    search.listeners.keydown({ key: "Enter", preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    return pressDialogButton(options, "save", createFakeForm({}, { checked: { pinned: ["module-a", "module-pin"] } }));
  };
  const manager = new __test__.SMLLoadoutsManager();
  env.state.localizations.set("SML.Notification.PinnedSaved", "pinned {count}");
  await manager._onPinnedModules();
  assert.deepEqual(rows.map((row) => row.hidden), [true, false]);
  assert.deepEqual(env.state.settingsValues.get(PINNED_KEY), ["module-a", "module-pin"]);
  assert.equal(env.state.notifications.info.at(-1), "pinned 2");

  // Cancel changes nothing.
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "cancel");
  await manager._onPinnedModules();
  assert.deepEqual(env.state.settingsValues.get(PINNED_KEY), ["module-a", "module-pin"]);
});

test("the import preview offers replace, keep both and skip per loadout", async () => {
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.WORLD_PROFILES_SETTING}`, { version: 2, profiles: [profile({ id: "w1", name: "Prep" })] });
  const plan = __test__.planImport(__test__.parseImportText(JSON.stringify({
    profiles: [
      { id: "w1", name: "Prep", scope: "world", moduleIds: ["module-b"], settings: { values: { "module-b.x": 1 } } },
      { id: "n1", name: "<New>", scope: "world", moduleIds: [] }
    ]
  })));
  const html = __test__.renderImportPreview(plan);
  assert.match(html, /name="choice-0".*value="both"/s);
  assert.doesNotMatch(html.split("choice-1")[1], /value="both"/);
  assert.match(html, /Settings: 1/);
  assert.equal(html.includes("<New>"), false);

  assert.deepEqual(__test__.readImportChoices(createFakeForm({ "choice-0": "skip", "choice-1": "odd" }), plan), ["skip", "replace"]);
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "import", createFakeForm({ "choice-0": "both", "choice-1": "replace" }));
  assert.deepEqual(await __test__.chooseImport(plan), ["both", "replace"]);
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "cancel");
  assert.equal(await __test__.chooseImport(plan), null);
});

test("manifest links are copied, edit keeps or replaces the saved settings", async () => {
  const copied = [];
  env.game.clipboard = { copyPlainText: async (text) => copied.push(text) };
  env.state.localizations.set("SML.Notification.ManifestCopied", "copied");
  const manager = new __test__.SMLLoadoutsManager();
  await __test__.SMLLoadoutsManager.DEFAULT_OPTIONS.actions.copyManifest.call(manager, {}, { dataset: { manifest: "https://x/module.json" } });
  assert.deepEqual(copied, ["https://x/module.json"]);
  assert.equal(env.state.notifications.info.at(-1), "copied");
  await manager._onCopyManifest("");
  env.game.clipboard = { copyPlainText: async () => { throw new Error("denied"); } };
  env.state.localizations.set("SML.Notification.ManifestCopyFailed", "copy failed {manifest}");
  await manager._onCopyManifest("https://y");
  assert.equal(env.state.notifications.warn.at(-1), "copy failed https://y");
  delete env.game.clipboard;

  env.registerSetting("module-a", "color", { default: "red" });
  env.setWorldSetting("module-a.color", "blue");
  const saved = profile({ id: "s1", name: "Saved", settings: { values: { "module-a.color": "green" } } });
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.WORLD_PROFILES_SETTING}`, { version: 2, profiles: [saved] });

  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "save", createFakeForm({ profileName: "Saved", profileScope: "world", profileSettings: "keep" }));
  await manager._onEdit("s1");
  assert.equal(__test__.findProfileById("s1").settings.values["module-a.color"], "green");

  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "save", createFakeForm({ profileName: "Saved", profileScope: "world", profileSettings: "visible" }));
  await manager._onEdit("s1");
  assert.equal(__test__.findProfileById("s1").settings.values["module-a.color"], "blue");

  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "save", createFakeForm({ profileName: "Saved Copy", profileScope: "world", profileSettings: "none" }));
  await manager._onDuplicate("s1");
  const copy = __test__.getAllProfiles().find((entry) => entry.name === "Saved Copy");
  assert.equal(copy.settings, undefined);
  assert.equal(__test__.findProfileById("s1").settings.values["module-a.color"], "blue");
});

test("the bug hunt button opens the start dialog or the running hunt", async () => {
  const manager = new __test__.SMLLoadoutsManager();
  let opened = 0;
  env.state.dialogV2WaitHandler = () => {
    opened += 1;
    return null;
  };
  await __test__.SMLLoadoutsManager.DEFAULT_OPTIONS.actions.bugHunt.call(manager);
  assert.equal(opened, 1);

  env.state.settingsRegistry.set(`sephrals-module-loadouts.${__test__.BUG_HUNT_SETTING}`, {});
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.BUG_HUNT_SETTING}`, { id: "h", phase: "search", originalIds: ["module-a"] });
  await __test__.SMLLoadoutsManager.DEFAULT_OPTIONS.actions.bugHunt.call(manager);
  await flushPromises();
  assert.equal(opened, 1);
  assert.equal(env.instances.get("sml-bug-hunt")?.rendered, true);
});

test("the gear in the title bar opens the module's tab of Foundry's settings", async () => {
  env.state.localizations.set("SML.Actions.OpenSettings", "Settings");
  const manager = new __test__.SMLLoadoutsManager();
  const frame = await manager._renderFrame({});
  const [button] = frame.inserted;
  assert.equal(button.dataset.action, "openSettings");
  assert.equal(button.className, "header-control icon fa-solid fa-gear");
  assert.equal(button.dataset.tooltip, "Settings");
  assert.equal(button.attributes["aria-label"], "Settings");
  // A language switch while the manager is open relabels it.
  env.state.localizations.set("SML.Actions.OpenSettings", "Einstellungen");
  manager._labelSettingsButton();
  assert.equal(button.dataset.tooltip, "Einstellungen");

  const calls = [];
  const warn = console.warn;
  env.game.settings.sheet = {
    async render(options) { calls.push(["render", options]); },
    changeTab(...args) { calls.push(["tab", ...args]); },
    bringToFront() { calls.push(["front"]); }
  };
  try {
    await __test__.SMLLoadoutsManager.DEFAULT_OPTIONS.actions.openSettings.call(manager);
    assert.deepEqual(calls, [["render", { force: true }], ["tab", __test__.MODULE_ID, "categories"], ["front"]]);
    // Without a tab for the module the settings still open.
    calls.length = 0;
    console.warn = () => calls.push(["warn"]);
    env.game.settings.sheet.changeTab = () => { throw new Error("no tab"); };
    await __test__.openModuleSettings();
    assert.deepEqual(calls, [["render", { force: true }], ["warn"], ["front"]]);
  } finally {
    console.warn = warn;
    delete env.game.settings.sheet;
  }
  assert.equal(await __test__.openModuleSettings(), null);
});
