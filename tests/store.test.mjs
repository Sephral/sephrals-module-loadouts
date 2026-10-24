import assert from "node:assert/strict";
import test from "node:test";

import { createTestEnvironment, flushPromises, modulePath } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));

const FILE = "modules/sephrals-module-loadouts/storage/installation-loadouts.json";
const STORAGE_DIR = "modules/sephrals-module-loadouts/storage";

function profile(overrides = {}) {
  return __test__.normalizeProfile({
    id: "p1",
    name: "Alpha",
    scope: __test__.PROFILE_SCOPES.GLOBAL,
    moduleIds: ["module-a"],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  }, overrides.scope ?? __test__.PROFILE_SCOPES.GLOBAL);
}

function writeFile(profiles) {
  env.state.directories.add(STORAGE_DIR);
  env.state.files.set(FILE, JSON.stringify({ version: 2, profiles }));
}

function readFile() {
  return JSON.parse(env.state.files.get(FILE));
}

function registerStoreSettings() {
  for (const key of [__test__.GLOBAL_PROFILES_SETTING, __test__.INSTALLATION_MIGRATED_SETTING, __test__.INSTALLATION_REVISION_SETTING, __test__.PINNED_MODULES_SETTING]) {
    env.state.settingsRegistry.set(`${__test__.MODULE_ID}.${key}`, { namespace: __test__.MODULE_ID, key });
  }
}

function setBrowserProfiles(profiles) {
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.GLOBAL_PROFILES_SETTING}`, { version: 2, profiles });
}

test.beforeEach(() => {
  env.reset();
  __test__.resetInstallationStore();
  env.addModule(__test__.MODULE_ID, { title: "Loadouts" });
  env.addModule("module-a", { title: "Alpha" });
  env.addModule("module-b", { title: "Beta" });
  env.state.settingsValues.set("core.moduleConfiguration", { [__test__.MODULE_ID]: true, "module-a": true });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.WORLD_PROFILES_SETTING}`, { version: 2, profiles: [] });
});

test.after(() => {
  env.restore();
});

test("a missing installation file is an empty list and costs no request", async () => {
  let fetches = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetches += 1;
    return originalFetch(...args);
  };
  try {
    assert.deepEqual(await __test__.loadInstallationStore(), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(fetches, 0);
  assert.equal(__test__.isInstallationStoreAvailable(), true);
  assert.deepEqual(env.state.fileOps.map((entry) => entry.op), ["browse"]);

  // The folder exists but holds no file yet.
  env.state.directories.add(STORAGE_DIR);
  assert.deepEqual(await __test__.loadInstallationStore({ force: true }), []);

  // Without the right to browse the fetch decides, a 404 is no error either.
  env.state.browseFails = "You do not have permission to browse";
  assert.deepEqual(await __test__.loadInstallationStore({ force: true }), []);
  assert.equal(__test__.isInstallationStoreAvailable(), true);
});

test("installation loadouts are read from the file and cached", async () => {
  writeFile([profile({ scope: "world" }), { name: "" }]);
  const loaded = await __test__.loadInstallationStore();
  assert.deepEqual(loaded.map((entry) => [entry.id, entry.scope]), [["p1", "global"]]);
  assert.deepEqual(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles.map((entry) => entry.id), ["p1"]);

  // Cached: a changed file needs force.
  writeFile([profile(), profile({ id: "p2", name: "Beta" })]);
  assert.equal((await __test__.loadInstallationStore()).length, 1);
  assert.equal((await __test__.loadInstallationStore({ force: true })).length, 2);

  // Concurrent loads share one read.
  __test__.resetInstallationStore();
  const [first, second] = await Promise.all([__test__.loadInstallationStore(), __test__.loadInstallationStore()]);
  assert.equal(first, second);
});

test("an unreadable file blocks installation writes but not world writes", async () => {
  writeFile([profile()]);
  env.state.fetchFails = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    await __test__.loadInstallationStore({ force: true });
  } finally {
    console.warn = warn;
  }
  assert.equal(__test__.isInstallationStoreAvailable(), false);
  await assert.rejects(() => __test__.saveProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL, [profile()]), /installation unavailable/);
  assert.equal(env.state.fileOps.some((entry) => entry.op === "upload"), false);

  await __test__.saveProfilesForScope(__test__.PROFILE_SCOPES.WORLD, [profile({ id: "w1", scope: "world" })]);
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.length, 1);

  // Broken JSON counts as unreadable as well.
  env.state.fetchFails = false;
  env.state.files.set(FILE, "{ broken");
  console.warn = () => {};
  try {
    await __test__.loadInstallationStore({ force: true });
  } finally {
    console.warn = warn;
  }
  assert.equal(__test__.isInstallationStoreAvailable(), false);

  // A server error status as well.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, statusText: "Server Error" });
  console.warn = () => {};
  try {
    writeFile([profile()]);
    await __test__.loadInstallationStore({ force: true });
  } finally {
    console.warn = warn;
    globalThis.fetch = originalFetch;
  }
  assert.equal(__test__.isInstallationStoreAvailable(), false);
});

test("saving installation loadouts writes the file, bumps the revision and redraws", async () => {
  registerStoreSettings();
  await __test__.loadInstallationStore();
  await __test__.saveProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL, [profile({ scope: "world" })]);
  assert.deepEqual(env.state.fileOps.filter((entry) => entry.op !== "browse").map((entry) => [entry.op, entry.source, entry.directory ?? entry.target]), [
    ["createDirectory", "data", STORAGE_DIR],
    ["upload", "data", STORAGE_DIR]
  ]);
  const file = readFile();
  assert.equal(file.module, __test__.MODULE_ID);
  assert.deepEqual(file.profiles.map((entry) => [entry.id, entry.scope]), [["p1", "global"]]);
  assert.equal(env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.INSTALLATION_MIGRATED_SETTING}`), true);
  const revision = env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.INSTALLATION_REVISION_SETTING}`);
  assert.equal(typeof revision, "number");

  // The second write finds the folder and goes on.
  await __test__.upsertProfile(profile({ id: "p2", name: "Beta" }));
  assert.deepEqual(readFile().profiles.map((entry) => entry.id), ["p1", "p2"]);
  await __test__.removeProfile(profile());
  assert.deepEqual(readFile().profiles.map((entry) => entry.id), ["p2"]);

  // The own revision does not read the file again, another one does.
  const own = env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.INSTALLATION_REVISION_SETTING}`);
  const reads = env.state.fileOps.filter((entry) => entry.op === "browse").length;
  await __test__.onInstallationRevisionChange(own);
  assert.equal(env.state.fileOps.filter((entry) => entry.op === "browse").length, reads);
  writeFile([profile({ id: "p9", name: "From elsewhere" })]);
  await __test__.onInstallationRevisionChange(own + 1);
  assert.deepEqual(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles.map((entry) => entry.id), ["p9"]);
});

test("failed folder creation and uploads end in an error", async () => {
  await __test__.loadInstallationStore();
  env.state.uploadFails = true;
  await assert.rejects(() => __test__.saveProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL, [profile()]), /installation write failed/);
  assert.equal(env.state.files.has(FILE), false);
  assert.deepEqual(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles, []);

  const picker = env.foundry.applications.apps.FilePicker.implementation;
  const original = picker.createDirectory;
  picker.createDirectory = async () => {
    throw new Error("You may not create directories in this location");
  };
  try {
    await assert.rejects(() => __test__.saveProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL, [profile()]), /may not create/);
  } finally {
    picker.createDirectory = original;
  }
});

test("on The Forge the file lives in the Assets Library", async () => {
  const files = new Map();
  globalThis.ForgeVTT = { usingTheForge: true, ASSETS_LIBRARY_URL_PREFIX: "https://assets.example.com/" };
  globalThis.ForgeAPI = { getUserId: async () => "user42" };
  const picker = env.foundry.applications.apps.FilePicker.implementation;
  const originals = { createDirectory: picker.createDirectory, upload: picker.upload, fetch: globalThis.fetch };
  const calls = [];
  picker.createDirectory = async (source, target) => {
    calls.push(["createDirectory", source, target]);
    throw new Error("strange forge answer");
  };
  picker.upload = async (source, directory, file) => {
    calls.push(["upload", source, directory]);
    const url = `https://assets.example.com/user42/${directory}/${file.name}`;
    files.set(url, await file.text());
    return { status: "success", path: url };
  };
  globalThis.fetch = async (url) => {
    const clean = String(url).replace(/\?.*$/, "");
    calls.push(["fetch", clean]);
    return files.has(clean)
      ? { ok: true, status: 200, json: async () => JSON.parse(files.get(clean)) }
      : { ok: false, status: 404, json: async () => ({}) };
  };
  try {
    assert.deepEqual(__test__.getInstallationFileTarget(), {
      source: "forgevtt",
      directory: __test__.MODULE_ID,
      path: `${__test__.MODULE_ID}/installation-loadouts.json`
    });
    assert.deepEqual(await __test__.loadInstallationStore({ force: true }), []);
    await __test__.saveProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL, [profile()]);
    assert.deepEqual(calls.filter((entry) => entry[0] !== "fetch"), [
      ["createDirectory", "forgevtt", __test__.MODULE_ID],
      ["upload", "forgevtt", __test__.MODULE_ID]
    ]);
    assert.deepEqual((await __test__.loadInstallationStore({ force: true })).map((entry) => entry.id), ["p1"]);
    assert.equal(calls.at(-1)[1], `https://assets.example.com/user42/${__test__.MODULE_ID}/installation-loadouts.json`);
  } finally {
    delete globalThis.ForgeVTT;
    delete globalThis.ForgeAPI;
    picker.createDirectory = originals.createDirectory;
    picker.upload = originals.upload;
    globalThis.fetch = originals.fetch;
  }
});

test("browser loadouts of version 1.0.3 show up and move into the file once", async () => {
  registerStoreSettings();
  writeFile([profile({ id: "f1", name: "Shared", moduleIds: ["module-a"] })]);
  setBrowserProfiles([
    profile({ id: "f1", name: "Shared" }),
    profile({ id: "b1", name: "shared", moduleIds: ["module-a"] }),
    profile({ id: "b2", name: "Shared", moduleIds: ["module-b"] }),
    profile({ id: "b3", name: "Browser Only", moduleIds: ["module-b"] })
  ]);
  await __test__.loadInstallationStore();

  // Before the move both lists are visible, the namesake with other modules gets a number.
  assert.deepEqual(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles.map((entry) => `${entry.id}:${entry.name}`), [
    "f1:Shared",
    "b2:Shared (2)",
    "b3:Browser Only"
  ]);

  assert.equal(await __test__.migrateBrowserProfiles(), 2);
  assert.deepEqual(readFile().profiles.map((entry) => entry.id), ["f1", "b2", "b3"]);
  assert.equal(env.state.notifications.info.at(-1), "migrated 2");
  assert.equal(env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.INSTALLATION_MIGRATED_SETTING}`), true);
  // The old browser setting stays as it is.
  assert.equal(env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.GLOBAL_PROFILES_SETTING}`).profiles.length, 4);

  // Once moved, the browser list is no longer merged.
  setBrowserProfiles([profile({ id: "b4", name: "Later" })]);
  assert.equal(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.GLOBAL).profiles.some((entry) => entry.id === "b4"), false);
  assert.equal(await __test__.migrateBrowserProfiles(), 0);
});

test("the move is skipped without permission or a readable file and marks an empty browser done", async () => {
  registerStoreSettings();
  setBrowserProfiles([profile({ id: "b1", name: "Browser" })]);
  env.state.userCanManage = false;
  assert.equal(await __test__.migrateBrowserProfiles(), 0);
  assert.equal(env.state.settingsValues.has(`${__test__.MODULE_ID}.${__test__.INSTALLATION_MIGRATED_SETTING}`), false);

  env.state.userCanManage = true;
  env.state.uploadFails = true;
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await __test__.migrateBrowserProfiles(), 0);
  } finally {
    console.warn = warn;
  }
  assert.equal(env.state.settingsValues.has(`${__test__.MODULE_ID}.${__test__.INSTALLATION_MIGRATED_SETTING}`), false);

  setBrowserProfiles([]);
  env.state.uploadFails = false;
  assert.equal(await __test__.migrateBrowserProfiles(), 0);
  assert.equal(env.state.settingsValues.get(`${__test__.MODULE_ID}.${__test__.INSTALLATION_MIGRATED_SETTING}`), true);
  assert.equal(env.state.files.has(FILE), false);
});

test("helpers for names, module info and pinned modules", async () => {
  assert.equal(__test__.uniqueProfileName("Prep", ["prep", "Prep (2)"]), "Prep (3)");
  assert.equal(__test__.uniqueProfileName("Live", ["Prep"]), "Live");

  assert.deepEqual(__test__.normalizeModuleInfo({
    "module-a": { title: " Alpha ", version: "1.2.0", manifest: "", extra: "x" },
    "module-b": "nonsense",
    other: { title: "Not in the list" }
  }, ["module-a", "module-b"]), { "module-a": { title: "Alpha", version: "1.2.0" } });
  assert.deepEqual(__test__.normalizeModuleInfo(null, ["module-a"]), {});
  assert.deepEqual(__test__.captureModuleInfo(["module-a", "gone"]), { "module-a": { title: "Alpha", version: "1.0.0" } });

  registerStoreSettings();
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.PINNED_MODULES_SETTING}`, ["module-b", "gone", __test__.MODULE_ID, " module-a ", "module-b"]);
  assert.deepEqual(__test__.getPinnedModuleIds(), ["module-a", "module-b"]);
  assert.deepEqual(await __test__.setPinnedModuleIds(new Set(["module-a", "", __test__.MODULE_ID])), ["module-a"]);
});

test("import plans name conflicts and applies replace, keep both and skip", async () => {
  registerStoreSettings();
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.WORLD_PROFILES_SETTING}`, {
    version: 2,
    profiles: [profile({ id: "w1", name: "Prep", scope: "world" }), profile({ id: "w2", name: "Live", scope: "world" })]
  });
  writeFile([profile({ id: "g1", name: "Shared" })]);
  await __test__.loadInstallationStore();

  const imported = __test__.parseImportText(JSON.stringify({
    profiles: [
      { id: "w1", name: "Prep renamed", scope: "world", moduleIds: ["module-b"] },
      { id: "x2", name: "live", scope: "world", moduleIds: ["module-b"] },
      { id: "x3", name: "Shared", scope: "global", moduleIds: ["module-b"] },
      { id: "x4", name: "New one", moduleIds: ["module-b"] }
    ]
  }));
  const plan = __test__.planImport(imported);
  assert.deepEqual(plan.map((entry) => [entry.profile.name, entry.profile.scope, entry.match, entry.existing?.id ?? null]), [
    ["Prep renamed", "world", "id", "w1"],
    ["live", "world", "name", "w2"],
    ["Shared", "global", "name", "g1"],
    ["New one", "global", null, null]
  ]);

  const counts = await __test__.applyImportPlan(plan, ["both", "skip", "replace", "replace"]);
  assert.deepEqual(counts, { added: 2, replaced: 1, skipped: 1 });
  const world = __test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles;
  assert.deepEqual(world.map((entry) => `${entry.id}:${entry.name}`).sort(), ["id-1:Prep renamed", "w1:Prep", "w2:Live"]);
  assert.deepEqual(readFile().profiles.map((entry) => `${entry.id}:${entry.name}:${entry.moduleIds.join(",")}`), [
    "g1:Shared:module-b",
    "x4:New one:module-b"
  ]);

  // Keeping both with the same name numbers the copy.
  const again = __test__.planImport(__test__.parseImportText(JSON.stringify({ profiles: [{ id: "g1", name: "Shared", scope: "global", moduleIds: [] }] })));
  await __test__.applyImportPlan(again, ["both"]);
  assert.deepEqual(readFile().profiles.map((entry) => entry.name), ["Shared", "New one", "Shared (2)"]);

  // Only skips write nothing.
  const writes = env.state.fileOps.filter((entry) => entry.op === "upload").length;
  assert.deepEqual(await __test__.applyImportPlan(again, ["skip"]), { added: 0, replaced: 0, skipped: 1 });
  assert.equal(env.state.fileOps.filter((entry) => entry.op === "upload").length, writes);

  // A chooser that cancels stops the import.
  env.state.fileText = JSON.stringify({ profiles: [{ id: "z", name: "Z", moduleIds: [] }] });
  assert.equal(await __test__.importProfilesFromFile({ name: "z.json" }, { choose: async () => null }), null);
  assert.equal(__test__.findProfileById("z"), null);
  const chosen = await __test__.importProfilesFromFile({ name: "z.json" }, { choose: async (entries) => entries.map(() => "replace") });
  assert.deepEqual(chosen, { added: 1, replaced: 0, skipped: 0 });
  await flushPromises();
  assert.equal(env.state.notifications.info.at(-1), "imported 1 1 0");
});

test("moving a loadout to the installation keeps it in the world when the file cannot be written", async () => {
  registerStoreSettings();
  const local = profile({ id: "m1", name: "Movable", scope: "world" });
  env.state.settingsValues.set(`${__test__.MODULE_ID}.${__test__.WORLD_PROFILES_SETTING}`, { version: 2, profiles: [local] });
  await __test__.loadInstallationStore();
  env.state.uploadFails = true;
  await assert.rejects(() => __test__.moveProfile(local, { ...local, scope: "global" }), /installation write failed/);
  assert.deepEqual(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.map((entry) => entry.id), ["m1"]);

  env.state.uploadFails = false;
  await __test__.moveProfile(local, { ...local, scope: "global" });
  assert.deepEqual(__test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles, []);
  assert.deepEqual(readFile().profiles.map((entry) => entry.id), ["m1"]);
});
