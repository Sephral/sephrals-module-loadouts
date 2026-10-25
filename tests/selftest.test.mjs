import assert from "node:assert/strict";
import test from "node:test";

import { createTestEnvironment, modulePath } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));

const PROBLEM_KEYS = [
  "Configuration", "Reload", "ModuleManagement", "Hotkey", "Texts", "CurrentLoadout",
  "SettingsStorage", "SettingsRoundTrip", "InstallationRead", "InstallationUpload", "Permission"
];

// The problems of a run as their message keys, the fake i18n answers with the key itself.
function problemKeys(problems) {
  return problems.map((problem) => problem.replace("SML.SelfTest.", ""));
}

test.beforeEach(async () => {
  env.reset();
  __test__.resetModuleTranslations();
  __test__.resetInstallationStore();
  env.addModule(__test__.MODULE_ID, { title: "Sephral’s Module Loadouts" });
  env.addModule("module-a", { title: "Alpha", relationships: { requires: [{ id: "module-b", type: "module" }] } });
  env.addModule("module-b", { title: "Beta" });
  env.state.settingsValues.set("core.moduleConfiguration", {
    "sephrals-module-loadouts": true,
    "module-a": true,
    "module-b": true
  });
  env.state.localizations.set("SML.Title", "Module Loadouts");
  await env.hooks.trigger("init");
});

test.after(() => {
  env.restore();
});

test("a healthy installation passes every check", async () => {
  env.registerSetting("module-a", "color", { default: "red" });
  env.setWorldSetting("module-a.color", "blue");
  const { problems, checks } = await __test__.checkIntegrations();
  assert.deepEqual(problems, []);
  assert.equal(checks, PROBLEM_KEYS.length);
  // Nothing was written: the round trips only compare.
  assert.deepEqual(env.state.settingDocumentCalls, []);
  assert.equal(env.state.fileOps.some((entry) => entry.op === "upload" || entry.op === "createDirectory"), false);
});

test("each broken dependency is reported", async () => {
  env.state.settingsValues.set("core.moduleConfiguration", { "module-a": true });
  env.state.keybindingActions.clear();
  env.state.localizations.delete("SML.Title");
  env.state.userCanManage = false;
  env.state.userCanUpload = false;
  env.state.browseFails = "Server error";
  env.state.fetchFails = true;
  const { problems, checks } = await __test__.checkIntegrations();
  assert.equal(checks, PROBLEM_KEYS.length);
  assert.deepEqual(problemKeys(problems).sort(), ["Configuration", "Hotkey", "InstallationRead", "InstallationUpload", "Permission", "Texts"]);
});

test("a loadout of the current state that cannot be built is reported", async () => {
  // Stands in for a Foundry change the loadout code trips over: building the loadout throws.
  const randomID = globalThis.foundry.utils.randomID;
  delete globalThis.foundry.utils.randomID;
  try {
    const { problems } = await __test__.checkIntegrations();
    assert.deepEqual(problemKeys(problems), ["CurrentLoadout"]);
  } finally {
    globalThis.foundry.utils.randomID = randomID;
  }
});

test("settings that would change in a round trip are reported", async () => {
  env.registerSetting("module-a", "color", { default: "red" });
  const doc = env.setWorldSetting("module-a.color", "blue");
  // The stored value reads differently the second time, as if Foundry changed how it keeps world settings.
  let reads = 0;
  Object.defineProperty(doc._source, "value", { get: () => JSON.stringify(reads++ === 0 ? "blue" : "green") });
  const { problems } = await __test__.checkIntegrations();
  assert.deepEqual(problemKeys(problems), ["SettingsRoundTrip"]);
});

test("a changed settings storage is reported", async () => {
  const original = globalThis.CONFIG.Setting.documentClass;
  globalThis.CONFIG.Setting.documentClass = { createDocuments() {} };
  try {
    const { problems } = await __test__.checkIntegrations();
    assert.deepEqual(problemKeys(problems), ["SettingsStorage"]);
  } finally {
    globalThis.CONFIG.Setting.documentClass = original;
  }
});

test("a renamed Manage Modules window and a missing reload prompt are reported", async () => {
  const apps = globalThis.foundry.applications.sidebar.apps;
  const original = apps.ModuleManagement;
  const reload = globalThis.foundry.applications.settings.SettingsConfig.reloadConfirm;
  apps.ModuleManagement = class PackageManagement {
    static SETTING = "moduleConfiguration";
  };
  delete globalThis.foundry.applications.settings.SettingsConfig.reloadConfirm;
  try {
    const { problems } = await __test__.checkIntegrations();
    assert.deepEqual(problemKeys(problems).sort(), ["ModuleManagement", "Reload"]);
  } finally {
    apps.ModuleManagement = original;
    globalThis.foundry.applications.settings.SettingsConfig.reloadConfirm = reload;
  }
});

test("runSelfTest reports to the notifications and a whispered chat message", async () => {
  env.state.userCanUpload = false;
  const result = await __test__.runSelfTest();
  assert.equal(result.problems.length, 1);
  assert.deepEqual(env.state.notifications.warn, ["SML.SelfTest.Problems"]);
  assert.equal(env.state.chatMessages.length, 1);
  const message = env.state.chatMessages[0];
  assert.deepEqual(message.whisper, ["gm-user"]);
  assert.match(message.content, /SML\.SelfTest\.InstallationUpload/);
  assert.match(message.content, /SML\.SelfTest\.Version/);

  env.state.userCanUpload = true;
  await __test__.runSelfTest({ report: false });
  assert.deepEqual(env.state.notifications.info, ["SML.SelfTest.Passed"]);
  assert.equal(env.state.chatMessages.length, 1);
});

test("the menu button runs the self-test for gamemasters only", async () => {
  const menu = new __test__.SMLSelfTestMenu();
  assert.equal(menu.render(), menu);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.state.chatMessages.length, 1);

  env.game.user.isGM = false;
  menu.render();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(env.state.chatMessages.length, 1);
});

test("a newer Foundry gives the gamemaster one notice per version", async () => {
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.ACKNOWLEDGED_VERSIONS_SETTING}`, "");
  __test__.noticeNewVersions();
  assert.deepEqual(env.state.notifications.info, []);

  env.state.coreVersion = "14.400";
  __test__.noticeNewVersions();
  __test__.noticeNewVersions();
  assert.deepEqual(env.state.notifications.info, ["SML.SelfTest.NewVersions"]);
  assert.equal(env.game.settings.get(__test__.MODULE_ID, __test__.ACKNOWLEDGED_VERSIONS_SETTING), "core 14.400");

  env.state.coreVersion = "15.300";
  env.game.user.isGM = false;
  __test__.noticeNewVersions();
  assert.equal(env.state.notifications.info.length, 1);
});
