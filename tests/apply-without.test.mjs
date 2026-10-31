import assert from "node:assert/strict";
import test from "node:test";

import { createTestEnvironment, modulePath, pressDialogButton } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));
const MODULE_ID = __test__.MODULE_ID;

function activate(...ids) {
  env.state.settingsValues.set("core.moduleConfiguration", Object.fromEntries([MODULE_ID, ...ids].map((id) => [id, true])));
}

function activeIds() {
  return Object.keys(env.state.settingsValues.get("core.moduleConfiguration")).sort();
}

function worldProfiles() {
  return __test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles;
}

function pin(...ids) {
  env.registerSetting(MODULE_ID, __test__.PINNED_MODULES_SETTING, { scope: "world", config: false, default: [] });
  env.state.settingsValues.set(`${MODULE_ID}.${__test__.PINNED_MODULES_SETTING}`, ids);
}

test.beforeEach(() => {
  env.reset();
  __test__.resetModuleTranslations();
  __test__.resetInstallationStore();
  env.addModule(MODULE_ID, { title: "Sephral’s Module Loadouts" });
  env.addModule("lib", { title: "Library" });
  env.addModule("heavy", { title: "Heavy", relationships: { requires: [{ id: "lib", type: "module" }] } });
  env.addModule("addon", { title: "Addon", relationships: { requires: [{ id: "heavy", type: "module" }] } });
  env.addModule("other", { title: "Other" });
  env.addModule("idle", { title: "Idle" });
  activate("lib", "heavy", "addon", "other");
  env.state.settingsValues.set(`${MODULE_ID}.${__test__.WORLD_PROFILES_SETTING}`, { version: __test__.STORAGE_VERSION, profiles: [] });
  for (const [key, text] of [
    ["SML.Dialog.Preflight.Title", "Apply {name}"],
    ["SML.Dialog.ConfirmApply.SaveAs", "also saved as {name}"],
    ["SML.Dialog.ConfirmApply.Dependents", "Need them:"],
    ["SML.Without.Name", "Without {modules}"],
    ["SML.Without.NameCount", "Without {count} modules"],
    ["SML.Without.SavedDescription", "Before switching off {modules}"],
    ["SML.Notification.NothingToSwitchOff", "nothing to switch off"],
    ["SML.Notification.ManageModulesRequired", "permission required"],
    ["SML.Notification.ProfileSaved", "saved {name}"]
  ]) env.state.localizations.set(key, text);
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "apply");
});

test.after(() => {
  env.restore();
});

test("the plan leaves out the named modules and every active module that needs one of them", () => {
  const active = ["addon", "heavy", "lib", "other", MODULE_ID];
  assert.deepEqual(__test__.planWithout(["heavy"], active), {
    named: ["heavy"],
    dependents: ["addon"],
    moduleIds: ["lib", "other", MODULE_ID]
  });
  // A library takes its users along, also the ones that need it through another module.
  assert.deepEqual(__test__.planWithout(["lib"], active).dependents, ["addon", "heavy"]);
  // Module Loadouts itself, inactive and unknown modules are never switched off.
  assert.deepEqual(__test__.planWithout([MODULE_ID, "idle", "missing", " ", null], active).named, []);
  assert.deepEqual(__test__.planWithout(["other", "other"], active).moduleIds, ["addon", "heavy", "lib", MODULE_ID]);
});

test("applyWithout asks, saves the current modules after the confirmation and switches the rest", async () => {
  assert.equal(await __test__.apiApplyWithout(["heavy"], { saveAs: "Before test" }), true);

  const dialog = env.state.dialogV2WaitCalls.at(-1);
  assert.equal(dialog.window.title, "Apply Without Heavy");
  assert.match(dialog.content, /also saved as Before test/);
  assert.match(dialog.content, /Need them:.*Addon/s);
  assert.match(dialog.content, /Disable:.*Addon.*Heavy/s);

  assert.deepEqual(activeIds(), ["lib", "other", MODULE_ID].sort());
  assert.deepEqual(env.state.reloadCalls, [{ world: true }]);

  const saved = worldProfiles().find((profile) => profile.name === "Before test");
  assert.ok(saved);
  assert.equal(saved.auto, undefined);
  assert.deepEqual([...saved.moduleIds].sort(), ["addon", "heavy", "lib", "other", MODULE_ID].sort());
  assert.equal(saved.description, "Before switching off Heavy | Addon");
  // The automatic snapshot of every apply is there as well.
  assert.equal(worldProfiles().filter((profile) => profile.auto === true).length, 1);
  assert.equal(env.state.notifications.info.includes("saved Before test"), true);

  // Applying the saved loadout switches back.
  assert.equal(await __test__.apiApply("Before test"), true);
  assert.deepEqual(activeIds(), ["addon", "heavy", "lib", "other", MODULE_ID].sort());
});

test("a cancelled applyWithout saves and switches nothing", async () => {
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "cancel");
  assert.equal(await __test__.apiApplyWithout(["heavy"], { saveAs: "Before test" }), false);
  assert.deepEqual(worldProfiles(), []);
  assert.equal(env.state.settingWrites.length, 0);
});

test("applyWithout switches named modules off even when pinned and keeps the other pins", async () => {
  pin("heavy", "addon", "other");
  assert.deepEqual(__test__.getPinnedModuleIds(), ["addon", "heavy", "other"]);
  assert.equal(await __test__.apiApplyWithout(["heavy"], { confirm: false }), true);
  assert.equal(env.state.dialogV2WaitCalls.length, 0);
  assert.deepEqual(activeIds(), ["lib", "other", MODULE_ID].sort());
  // Without saveAs only the automatic snapshot is stored.
  assert.deepEqual(worldProfiles().map((profile) => profile.auto), [true]);
});

test("applyWithout names larger sets by count and stops without permission or active modules", async () => {
  activate("lib", "heavy", "addon", "other", "idle");
  assert.equal(await __test__.apiApplyWithout(["other", "idle", "addon", "heavy"]), true);
  assert.equal(env.state.dialogV2WaitCalls.at(-1).window.title, "Apply Without 4 modules");

  assert.equal(await __test__.apiApplyWithout(["missing"]), false);
  assert.deepEqual(env.state.notifications.info.at(-1), "nothing to switch off");

  env.state.userCanManage = false;
  assert.equal(await __test__.apiApplyWithout(["lib"]), false);
  assert.deepEqual(env.state.notifications.error, ["permission required"]);
});

test("a step before the switch that fails stops it", async () => {
  let asked = false;
  assert.equal(await __test__.applyProfile(__test__.createCurrentProfile({ name: "Probe", moduleIds: ["lib"] }), {
    beforeSwitch: async () => {
      asked = true;
      return false;
    }
  }), false);
  assert.equal(asked, true);
  assert.equal(env.state.settingWrites.length, 0);
  assert.deepEqual(activeIds(), ["addon", "heavy", "lib", "other", MODULE_ID].sort());
});
