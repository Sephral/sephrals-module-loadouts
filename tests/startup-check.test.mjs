import assert from "node:assert/strict";
import test from "node:test";

import { createTestEnvironment, modulePath } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));

const MARKER_KEY = `sephrals-module-loadouts.${__test__.CHECK_MARKER_SETTING}`;
const DISPLAY_KEY = `sephrals-module-loadouts.${__test__.CHECK_DISPLAY_SETTING}`;
const BASE = "http://localhost:30013";

function frame(moduleId, file = "scripts/main.js") {
  return `    at fn (${BASE}/modules/${moduleId}/${file}:10:5)`;
}

function stackOf(message, ...frames) {
  return [`Error: ${message}`, ...frames].join("\n");
}

function errorFrom(moduleId, message, cause = undefined) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.stack = stackOf(message, moduleId ? frame(moduleId) : `    at core (${BASE}/scripts/foundry.mjs:1:1)`);
  return error;
}

function freshLog() {
  return { entries: [], keys: new Set(), seen: new WeakSet(), stop: null };
}

function resetCapture() {
  __test__.stopStartupErrorCapture();
  __test__.startupCapture.entries.length = 0;
  __test__.startupCapture.keys.clear();
  __test__.startupCapture.seen = new WeakSet();
}

function createEventTarget() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, handler, capture) {
      listeners.push({ type, handler, capture });
    },
    removeEventListener(type, handler, capture) {
      const index = listeners.findIndex((entry) => entry.type === type && entry.handler === handler && entry.capture === capture);
      if (index >= 0) listeners.splice(index, 1);
    },
    dispatch(type, event) {
      for (const entry of listeners.filter((listener) => listener.type === type)) entry.handler(event);
    }
  };
}

function registerSettings() {
  env.state.settingsRegistry.set(MARKER_KEY, {});
  env.state.settingsRegistry.set(DISPLAY_KEY, {});
}

function setMarker(overrides = {}) {
  const marker = {
    profileId: "prep",
    profileName: "Prep",
    expectedIds: ["module-a", "module-b", __test__.MODULE_ID],
    titles: { "module-a": "Alpha", "module-b": "Beta", [__test__.MODULE_ID]: "Loadouts" },
    snapshotId: "snap-1",
    appliedAt: Date.now() - 1000,
    userId: "gm-user",
    userName: "Gamemaster",
    ...overrides
  };
  env.state.settingsValues.set(MARKER_KEY, marker);
  return marker;
}

function setWorldProfiles(profiles) {
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.WORLD_PROFILES_SETTING}`, {
    version: __test__.STORAGE_VERSION,
    profiles
  });
}

test.beforeEach(() => {
  env.reset();
  resetCapture();
  env.state.localizations.set("SML.Check.AllGood", "all good {name} {count}");
  env.state.localizations.set("SML.Check.Problems", "problems {name}");
  env.state.localizations.set("SML.Check.AppliedBy", "by {user} at {date}");
  env.state.localizations.set("SML.Check.LoadFailed", "could not load {file}");
  env.state.localizations.set("SML.Check.MoreErrors", "{count} more");
  env.addModule(__test__.MODULE_ID, { title: "Loadouts", active: true });
  env.addModule("module-a", { title: "Alpha", active: true });
  env.addModule("module-b", { title: "Beta", active: true });
  env.addModule("module-c", { title: "Gamma", active: false });
  env.state.settingsValues.set("core.moduleConfiguration", {
    [__test__.MODULE_ID]: true,
    "module-a": true,
    "module-c": true
  });
  setWorldProfiles([]);
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.GLOBAL_PROFILES_SETTING}`, { version: __test__.STORAGE_VERSION, profiles: [] });
});

test.after(() => {
  resetCapture();
  env.restore();
});

test("module ids are read from module paths and the first stack frame wins", () => {
  assert.deepEqual(__test__.findModuleIdsInText(`${frame("mod-one")}\n${frame("mod-two")}\n${frame("mod-one")}`), ["mod-one", "mod-two"]);
  assert.deepEqual(__test__.findModuleIdsInText(`${BASE}/prefix/modules/my%20mod/x.js`), ["my mod"]);
  assert.deepEqual(__test__.findModuleIdsInText(`${BASE}/modules/bad%E0/x.js`), ["bad%E0"]);
  assert.deepEqual(__test__.findModuleIdsInText(`${BASE}/systems/dnd5e/dnd5e.mjs`), []);
  assert.equal(__test__.attributeModuleId(["no path", undefined, frame("mod-two")]), "mod-two");
  assert.equal(__test__.attributeModuleId(["nothing here"]), null);

  // Foundry wraps hook errors, the module frame is only in the cause.
  const wrapped = errorFrom(null, "Error thrown in hooked function 'x' for hook 'init'. boom", errorFrom("mod-cause", "boom"));
  assert.equal(__test__.attributeModuleId(__test__.collectErrorTexts(wrapped)), "mod-cause");
  assert.deepEqual(__test__.collectErrorTexts("plain"), ["plain"]);
  assert.deepEqual(__test__.collectErrorTexts(null), []);

  assert.equal(__test__.firstLine("\n  first line \nsecond"), "first line");
  assert.equal(__test__.firstLine("x".repeat(400)).length, 300);
  assert.equal(__test__.firstLine("x".repeat(400)).endsWith("..."), true);
  assert.deepEqual(__test__.stripConsoleStyles(["%cFoundry%c | hi", "color: red", "color: blue", "rest"]), ["Foundry | hi", "rest"]);
  assert.deepEqual(__test__.stripConsoleStyles(["plain", "x"]), ["plain", "x"]);
  assert.equal(__test__.stripOwnFrames(`Error\n${frame(__test__.MODULE_ID, "scripts/sml.js")}\n${frame("caller")}`).trim(), frame("caller").trim());
  assert.equal(__test__.stripOwnFrames(`Error\n${frame(__test__.MODULE_ID, "scripts/sml.js")}\n${frame(__test__.MODULE_ID, "scripts/sml.js")}\n${frame("caller")}\n${frame(__test__.MODULE_ID, "scripts/sml.js")}`),
    `${frame("caller")}\n${frame(__test__.MODULE_ID, "scripts/sml.js")}`);
  // This module's own frames never decide the attribution.
  assert.equal(__test__.attributeModuleId([frame(__test__.MODULE_ID, "scripts/sml.js")]), null);
  assert.equal(__test__.attributeModuleId([`${frame(__test__.MODULE_ID, "scripts/sml.js")}\n${frame("mod-two")}`]), "mod-two");
  assert.equal(__test__.stripOwnFrames("a\nb"), "a\nb");
  assert.equal(__test__.moduleFilePath(`${BASE}/modules/mod-one/scripts/main.js?v=2`), "modules/mod-one/scripts/main.js");
  assert.equal(__test__.moduleFilePath("elsewhere.js"), "elsewhere.js");
});

test("errors from events, rejections and console calls are attributed to modules", () => {
  // Failed script and stylesheet loads, other elements are ignored.
  assert.deepEqual(__test__.describeErrorEvent({ target: { tagName: "script", src: `${BASE}/modules/mod-one/main.js` } }),
    { moduleId: "mod-one", kind: "load", detail: "modules/mod-one/main.js" });
  assert.deepEqual(__test__.describeErrorEvent({ target: { tagName: "LINK", href: `${BASE}/modules/mod-two/style.css` } }).moduleId, "mod-two");
  assert.equal(__test__.describeErrorEvent({ target: { tagName: "SCRIPT", src: `${BASE}/scripts/foundry.mjs` } }), null);
  assert.equal(__test__.describeErrorEvent({ target: { tagName: "IMG", src: `${BASE}/modules/mod-one/icon.png` } }), null);

  const thrown = errorFrom("mod-one", "kaput");
  assert.equal(__test__.describeErrorEvent({ target: {}, error: thrown }).detail, "kaput");
  assert.deepEqual(__test__.describeErrorEvent({ target: {}, error: null, message: "Uncaught SyntaxError", filename: `${BASE}/modules/mod-two/x.js` }),
    { moduleId: "mod-two", kind: "error", detail: "Uncaught SyntaxError", error: null });
  assert.equal(__test__.describeRejection({ reason: errorFrom("mod-one", "async fail") }).moduleId, "mod-one");
  assert.equal(__test__.describeRejection({ reason: "no module" }), null);
  assert.equal(__test__.describeThrown(errorFrom("mod-one", "")), null);

  // Console: error arguments first, then strings, then the call site below the wrapper.
  const fromArgument = __test__.describeConsoleError(["%cFoundry", "color: red", errorFrom("mod-one", "bad data")], "");
  assert.equal(fromArgument.moduleId, "mod-one");
  assert.equal(fromArgument.detail, "Foundry bad data");
  assert.equal(__test__.describeConsoleError([`see ${BASE}/modules/mod-two/x.js`]).moduleId, "mod-two");
  const callSite = `Error\n${frame(__test__.MODULE_ID, "scripts/sml.js")}\n${frame("mod-caller")}`;
  assert.equal(__test__.describeConsoleError(["something failed", { data: 1 }], callSite).moduleId, "mod-caller");
  assert.equal(__test__.describeConsoleError(["core only"], `Error\n${frame(__test__.MODULE_ID, "scripts/sml.js")}`), null);
  assert.equal(__test__.describeConsoleError([{ data: 1 }], callSite), null);

  assert.deepEqual(__test__.collectFailedModuleLoads([
    { name: `${BASE}/modules/mod-one/main.mjs`, responseStatus: 404 },
    { name: `${BASE}/modules/mod-one/ok.js`, responseStatus: 200 },
    { name: `${BASE}/modules/mod-one/icon.png`, responseStatus: 404 },
    { name: `${BASE}/scripts/foundry.mjs`, responseStatus: 500 },
    { name: `${BASE}/modules/mod-two/style.css?v=1`, responseStatus: 500 },
    { name: `${BASE}/modules/mod-three/x.js` }
  ]), [
    { moduleId: "mod-one", kind: "load", detail: "modules/mod-one/main.mjs" },
    { moduleId: "mod-two", kind: "load", detail: "modules/mod-two/style.css" }
  ]);
  assert.deepEqual(__test__.collectFailedModuleLoads(undefined), []);
});

test("core errors logged through Hooks.onError are never blamed on this module", () => {
  // Live v13 case: a broken scene in the world, logged by core while the game is set up.
  const core = (name, line) => `    at ${name} (${BASE}/scripts/foundry.mjs:${line}:17)`;
  const own = (name, line) => `    at ${name} (${BASE}/modules/${__test__.MODULE_ID}/scripts/sml.js:${line}:9)`;
  const message = "Failed to initialize Scene [srbDemo13Scene1]. Scene [srbDemo13Scene1] validation errors:\n  _id: must be a valid 16-character alphanumeric ID";
  const cause = new Error("Scene [srbDemo13Scene1] validation errors:\n  _id: must be a valid 16-character alphanumeric ID");
  cause.stack = [`DataModelValidationError: ${cause.message}`, core("Scene.validate", 15051), core("Scene._initializeSource", 14890), core("Scenes._initialize", 61420)].join("\n");
  const wrapped = new Error(message, { cause });
  wrapped.stack = [`Error: ${message}`, core("Hooks.onError", 4120), core("Scenes._initialize", 61425), core("Game.setupGame", 98510), core("async Game.initialize", 98390)].join("\n");

  // Call site stacks as the console wrapper sees them, before and after the fix.
  const helperFrames = ["Error", own("<anonymous>", 1165), own("recordSafely", 1132), own("console.smlStartupConsoleError", 1165), core("Hooks.onError", 4121), core("Scenes._initialize", 61425), core("Game.setupGame", 98510)].join("\n");
  const wrapperOnly = ["Error", own("console.smlStartupConsoleError", 1164), core("Hooks.onError", 4121), core("Scenes._initialize", 61425)].join("\n");
  assert.equal(__test__.describeConsoleError([wrapped], helperFrames), null);
  assert.equal(__test__.describeConsoleError([wrapped], wrapperOnly), null);
  assert.equal(__test__.describeConsoleError([message], helperFrames), null);
  // The same error object through Foundry's "error" hook.
  assert.equal(__test__.describeThrown(wrapped), null);
  // Window listeners: the event comes from this module's listener, the error from core.
  assert.equal(__test__.describeErrorEvent({ target: {}, error: wrapped, filename: `${BASE}/scripts/foundry.mjs` }), null);

  // A module below the capture frames still counts.
  const fromModule = ["Error", own("<anonymous>", 1165), own("recordSafely", 1132), own("console.smlStartupConsoleError", 1165), frame("mod-caller"), core("Hooks.callAll", 4000)].join("\n");
  assert.equal(__test__.describeConsoleError(["module failed"], fromModule).moduleId, "mod-caller");

  // End to end through the capture: nothing is recorded.
  const log = freshLog();
  let errorHook = null;
  const consoleObject = { error() {} };
  __test__.installStartupErrorCapture({
    target: createEventTarget(),
    consoleObject,
    hooks: { on: (_event, handler) => { errorHook = handler; return 1; }, off() {} },
    log
  });
  consoleObject.error(wrapped);
  errorHook("WorldCollection#_initialize", wrapped, {});
  __test__.stopStartupErrorCapture(log);
  assert.deepEqual(log.entries, []);
});

test("the startup log drops duplicates and stops at its limit", () => {
  const log = freshLog();
  const error = errorFrom("mod-one", "boom");
  assert.equal(__test__.recordStartupError({ moduleId: "mod-one", kind: "error", detail: "boom", error }, log), true);
  // The same error object again (console and "error" hook), and the same text again.
  assert.equal(__test__.recordStartupError({ moduleId: "mod-one", kind: "error", detail: "other", error }, log), false);
  assert.equal(__test__.recordStartupError({ moduleId: "mod-one", kind: "error", detail: "boom" }, log), false);
  assert.equal(__test__.recordStartupError({ moduleId: "mod-two", kind: "error", detail: "boom" }, log), true);
  assert.equal(__test__.recordStartupError(null, log), false);
  assert.equal(__test__.recordStartupError({ moduleId: "mod-one", detail: "" }, log), false);
  assert.deepEqual(log.entries, [
    { moduleId: "mod-one", kind: "error", detail: "boom" },
    { moduleId: "mod-two", kind: "error", detail: "boom" }
  ]);

  for (let index = 0; index < __test__.MAX_STARTUP_ERRORS + 10; index += 1) {
    __test__.recordStartupError({ moduleId: "mod-three", kind: "error", detail: `error ${index}` }, log);
  }
  assert.equal(log.entries.length, __test__.MAX_STARTUP_ERRORS);
});

test("the capture listens to window, console and the error hook and restores everything on stop", () => {
  const log = freshLog();
  const target = createEventTarget();
  const printed = [];
  const consoleObject = { error: (...args) => printed.push(args) };
  const originalError = consoleObject.error;
  const hookHandlers = new Map();
  const hooks = {
    on(event, handler) {
      hookHandlers.set(7, { event, handler });
      return 7;
    },
    off(event, id) {
      if (hookHandlers.get(id)?.event === event) hookHandlers.delete(id);
    }
  };

  assert.equal(__test__.installStartupErrorCapture({ target: undefined, log }), false);
  assert.equal(__test__.installStartupErrorCapture({ target, consoleObject, hooks, log }), true);
  assert.equal(__test__.installStartupErrorCapture({ target, consoleObject, hooks, log }), false);
  assert.equal(target.listeners.find((entry) => entry.type === "error").capture, true);

  target.dispatch("error", { target: { tagName: "SCRIPT", src: `${BASE}/modules/mod-one/main.js` } });
  target.dispatch("unhandledrejection", { reason: errorFrom("mod-two", "async") });
  const hookError = errorFrom(null, "Error thrown in hooked function", errorFrom("mod-three", "in hook"));
  consoleObject.error(hookError);
  hookHandlers.get(7).handler("Hooks.#call", hookError, {});
  hookHandlers.get(7).handler("Hooks.#call", errorFrom("mod-four", "notify only"), {});
  // A broken describe step must not break the console call.
  consoleObject.error({ get message() { throw new Error("nope"); }, stack: "" });

  assert.equal(printed.length, 2);
  assert.equal(printed[0][0], hookError);
  assert.deepEqual(log.entries.map((entry) => [entry.moduleId, entry.kind]), [
    ["mod-one", "load"],
    ["mod-two", "error"],
    ["mod-three", "error"],
    ["mod-four", "error"]
  ]);

  __test__.stopStartupErrorCapture(log);
  assert.equal(consoleObject.error, originalError);
  assert.equal(target.listeners.length, 0);
  assert.equal(hookHandlers.size, 0);
  assert.equal(log.stop, null);
  __test__.stopStartupErrorCapture(log);

  // Someone else wrapped console.error later: that wrapper stays.
  const later = freshLog();
  __test__.installStartupErrorCapture({ target, consoleObject, hooks: null, log: later });
  const foreign = () => {};
  consoleObject.error = foreign;
  __test__.stopStartupErrorCapture(later);
  assert.equal(consoleObject.error, foreign);
});

test("init ends the capture when no check is pending and keeps it otherwise", async () => {
  const target = createEventTarget();
  __test__.installStartupErrorCapture({ target, consoleObject: { error() {} } });
  await env.hooks.trigger("init");
  assert.equal(__test__.startupCapture.stop, null);
  assert.equal(target.listeners.length, 0);

  __test__.installStartupErrorCapture({ target, consoleObject: { error() {} } });
  setMarker();
  await env.hooks.trigger("init");
  assert.equal(typeof __test__.startupCapture.stop, "function");
  __test__.stopStartupErrorCapture();
});

test("markers are built, normalized and expire after an hour", () => {
  const marker = __test__.buildCheckMarker({ id: "prep", name: "Prep" }, {
    expectedIds: ["module-a", "gone"],
    snapshotId: "snap",
    appliedAt: 1000,
    user: { id: "u1", name: "Gamemaster" }
  });
  assert.deepEqual(marker, {
    profileId: "prep",
    profileName: "Prep",
    expectedIds: ["module-a", "gone"],
    titles: { "module-a": "Alpha", gone: "gone" },
    snapshotId: "snap",
    appliedAt: 1000,
    userId: "u1",
    userName: "Gamemaster"
  });
  assert.equal(__test__.buildCheckMarker({ id: "p", name: "P" }).userId, null);

  assert.deepEqual(__test__.normalizeCheckMarker(marker), marker);
  assert.equal(__test__.normalizeCheckMarker({}), null);
  assert.equal(__test__.normalizeCheckMarker(null), null);
  assert.equal(__test__.normalizeCheckMarker({ expectedIds: ["a"], appliedAt: "soon" }), null);
  assert.equal(__test__.normalizeCheckMarker({ expectedIds: [], appliedAt: 5 }), null);
  const loose = __test__.normalizeCheckMarker({ expectedIds: [" a ", "a", ""], appliedAt: "5", titles: "x" });
  assert.deepEqual(loose.expectedIds, ["a"]);
  assert.deepEqual(loose.titles, {});
  assert.equal(loose.snapshotId, null);

  const hour = __test__.CHECK_MARKER_MAX_AGE_MS;
  assert.equal(__test__.isCheckMarkerPending(marker, 1000 + hour), true);
  assert.equal(__test__.isCheckMarkerPending(marker, 1001 + hour), false);
  assert.equal(__test__.isCheckMarkerPending(marker, 1000 - 30 * 1000), true);
  // Client clocks of two GMs may be a few minutes apart.
  assert.equal(__test__.isCheckMarkerPending(marker, 1000 - 5 * 60 * 1000), true);
  assert.equal(__test__.isCheckMarkerPending(marker, 1000 - 11 * 60 * 1000), false);
  assert.equal(__test__.isCheckMarkerPending(null, 1000), false);
});

test("applying a profile stores the marker with the real switch before the reload prompt", async () => {
  registerSettings();
  // v13's serverTime counts from the server start, the marker must use epoch time.
  env.state.serverTime = 5000;
  const before = Date.now();
  const prep = __test__.normalizeProfile({ id: "prep", name: "Prep", moduleIds: ["module-b"] });
  assert.equal(await __test__.applyProfile(prep), true);

  const marker = __test__.readCheckMarker();
  const snapshot = __test__.getProfilesForScope(__test__.PROFILE_SCOPES.WORLD).profiles.find((profile) => profile.auto);
  assert.deepEqual(marker.expectedIds, ["module-b", __test__.MODULE_ID]);
  assert.equal(marker.profileId, "prep");
  assert.equal(marker.snapshotId, snapshot.id);
  assert.equal(marker.appliedAt >= before && marker.appliedAt <= Date.now(), true);
  assert.equal(new Date(marker.appliedAt).getFullYear() >= 2024, true);
  assert.equal(marker.userId, "gm-user");
  assert.equal(marker.userName, "Gamemaster");
  const keys = env.state.settingWrites.map((entry) => entry.moduleId === "core" ? "core" : entry.key);
  assert.equal(keys.indexOf(__test__.CHECK_MARKER_SETTING) < keys.indexOf("core"), true);
});

test("the evaluation lists inactive, unexpected and failing modules", () => {
  const marker = __test__.normalizeCheckMarker(setMarker({ expectedIds: ["module-a", "module-b", "gone", __test__.MODULE_ID] }));
  const clean = __test__.evaluateStartupCheck(marker, { activeIds: ["module-a", "module-b", "gone", __test__.MODULE_ID] });
  assert.equal(clean.ok, true);
  assert.equal(clean.expectedCount, 4);

  const result = __test__.evaluateStartupCheck(marker, {
    activeIds: ["module-a", __test__.MODULE_ID, "module-c"],
    installedIds: ["module-a", "module-b", "module-c", __test__.MODULE_ID],
    errors: [
      { moduleId: "module-a", kind: "error", detail: "first" },
      { moduleId: "unrelated", kind: "error", detail: "ignored" },
      { moduleId: "module-c", kind: "load", detail: "modules/module-c/main.js" },
      { moduleId: "module-a", kind: "error", detail: "second" }
    ],
    packageIssues: {
      "module-a": { error: ["Manifest broken\nmore"], warning: ["only a warning"] },
      "module-b": { error: [], warning: ["warning"] },
      unrelated: { error: ["ignored"] },
      "module-c": { warning: [] }
    }
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.notActive, [
    { moduleId: "module-b", installed: true },
    { moduleId: "gone", installed: false }
  ]);
  assert.deepEqual(result.unexpected, ["module-c"]);
  assert.deepEqual(result.startupErrors, [
    { moduleId: "module-a", details: ["first", "second"] },
    { moduleId: "module-c", details: ["could not load modules/module-c/main.js"] }
  ]);
  assert.deepEqual(result.foundryErrors, [{ moduleId: "module-a", details: ["Manifest broken"] }]);

  const html = __test__.renderStartupCheckContent(marker, result, { canUndo: true });
  assert.match(html, /problems Prep/);
  assert.match(html, /by Gamemaster at/);
  assert.match(html, /SML\.Check\.NotActive.*Beta \(SML\.Check\.ReasonDisabled\).*gone \(SML\.Check\.ReasonMissing\)/s);
  assert.match(html, /SML\.Check\.Unexpected.*Gamma/s);
  assert.match(html, /SML\.Check\.Errors.*<strong>Alpha<\/strong><ul><li>first<\/li><li>second<\/li>/s);
  assert.match(html, /SML\.Check\.FoundryIssues.*Manifest broken/s);
  assert.match(html, /SML\.Check\.UndoHint/);

  const many = __test__.evaluateStartupCheck(marker, {
    activeIds: marker.expectedIds,
    errors: Array.from({ length: 8 }, (_value, index) => ({ moduleId: "module-a", kind: "error", detail: `<b>${index}</b>` }))
  });
  const manyHtml = __test__.renderStartupCheckContent({ ...marker, profileName: "<i>X</i>", userName: "" }, many, { snapshotMissing: true });
  assert.equal((manyHtml.match(/<li>&lt;b&gt;/g) ?? []).length, __test__.MAX_ERRORS_SHOWN_PER_MODULE);
  assert.match(manyHtml, /3 more/);
  assert.match(manyHtml, /problems &lt;i&gt;X&lt;\/i&gt;/);
  assert.match(manyHtml, /by - at/);
  assert.match(manyHtml, /SML\.Check\.UndoMissing/);
  assert.doesNotMatch(manyHtml, /UndoHint/);
});

test("only the designated GM who may manage modules runs the check", () => {
  assert.equal(__test__.isCheckRunner(), true);
  env.state.userCanManage = false;
  assert.equal(__test__.isCheckRunner(), false);
  env.state.userCanManage = true;
  env.game.user.isGM = false;
  assert.equal(__test__.isCheckRunner(), false);
  env.game.user.isGM = true;

  const otherGm = { id: "other", isGM: true, active: true, can: () => true };
  const originalUsers = env.game.users;
  env.game.users = { getDesignatedUser: () => otherGm };
  assert.equal(__test__.isCheckRunner(), false);
  env.game.users = { activeGM: env.game.user };
  assert.equal(__test__.isCheckRunner(), true);
  env.game.users = {};
  assert.equal(__test__.isCheckRunner(), false);
  env.game.users = originalUsers;
});

test("a clean start shows a notification, clears the marker and ends the capture", async () => {
  registerSettings();
  setMarker();
  const target = createEventTarget();
  __test__.installStartupErrorCapture({ target, consoleObject: { error() {} } });

  const result = await __test__.runStartupCheck({ delay: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(env.state.notifications.info, ["all good Prep 3"]);
  assert.equal(env.state.dialogV2WaitCalls.length, 0);
  assert.deepEqual(env.state.settingsValues.get(MARKER_KEY), {});
  assert.equal(__test__.startupCapture.stop, null);
  assert.equal(target.listeners.length, 0);

  // "Always" opens the dialog for a clean result too.
  setMarker();
  env.state.settingsValues.set(DISPLAY_KEY, __test__.CHECK_DISPLAY_MODES.ALWAYS);
  assert.equal(__test__.getCheckDisplayMode(), __test__.CHECK_DISPLAY_MODES.ALWAYS);
  await __test__.runStartupCheck({ delay: 0 });
  assert.equal(env.state.dialogV2WaitCalls.length, 1);
  assert.match(env.state.dialogV2WaitCalls[0].content, /all good Prep 3/);
  env.state.settingsValues.set(DISPLAY_KEY, "nonsense");
  assert.equal(__test__.getCheckDisplayMode(), __test__.CHECK_DISPLAY_MODES.PROBLEMS);
});

test("problems open the dialog and Undo applies the snapshot from before the switch", async () => {
  registerSettings();
  const snapshot = __test__.normalizeProfile({
    id: "snap-1",
    name: "Before apply",
    moduleIds: ["module-a", "module-c", __test__.MODULE_ID],
    tags: [__test__.AUTO_SNAPSHOT_TAG],
    auto: true
  });
  setWorldProfiles([snapshot]);
  setMarker();
  env.state.settingsValues.set("core.moduleConfiguration", {
    [__test__.MODULE_ID]: true,
    "module-a": true,
    "module-b": true
  });
  env.state.modules.get("module-b").active = false;
  __test__.recordStartupError({ moduleId: "module-a", kind: "error", detail: "init failed" });

  const originalPerformance = globalThis.performance;
  Object.defineProperty(globalThis, "performance", {
    configurable: true,
    value: { getEntriesByType: () => [{ name: `${BASE}/modules/module-a/missing.js`, responseStatus: 404 }] }
  });
  env.state.dialogV2WaitResult = "undo";
  let result;
  try {
    result = await __test__.runStartupCheck({ delay: 0 });
  } finally {
    Object.defineProperty(globalThis, "performance", { configurable: true, value: originalPerformance });
  }

  assert.equal(result.ok, false);
  assert.deepEqual(result.startupErrors, [{ moduleId: "module-a", details: ["init failed", "could not load modules/module-a/missing.js"] }]);
  const dialog = env.state.dialogV2WaitCalls[0];
  assert.deepEqual(dialog.buttons.map((button) => button.action), ["ok", "undo"]);
  assert.match(dialog.content, /problems Prep/);
  assert.match(dialog.content, /init failed/);
  assert.deepEqual(dialog.classes, ["sml-check-dialog"]);

  // The dialog is not awaited by the check, give the undo a moment.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(env.state.settingsValues.get("core.moduleConfiguration"), {
    "module-a": true,
    "module-c": true,
    [__test__.MODULE_ID]: true
  });
  // The undo is an apply like any other and leaves its own marker for the next start.
  assert.equal(__test__.readCheckMarker().profileId, "snap-1");
});

test("undo is offered only with a snapshot and the permission to manage modules", async () => {
  registerSettings();
  const marker = __test__.normalizeCheckMarker(setMarker({ snapshotId: "missing" }));
  const result = __test__.evaluateStartupCheck(marker, { activeIds: [] });

  env.state.dialogV2WaitResult = "undo";
  assert.equal(await __test__.showStartupCheckDialog(marker, result), false);
  assert.deepEqual(env.state.dialogV2WaitCalls[0].buttons.map((button) => button.action), ["ok"]);
  assert.match(env.state.dialogV2WaitCalls[0].content, /SML\.Check\.UndoMissing/);

  // The snapshot disappears while the dialog is open.
  const snapshot = __test__.normalizeProfile({ id: "snap-2", name: "Before", moduleIds: ["module-a"], auto: true });
  setWorldProfiles([snapshot]);
  const withSnapshot = { ...marker, snapshotId: "snap-2" };
  const originalWait = env.foundry.applications.api.DialogV2.wait;
  env.foundry.applications.api.DialogV2.wait = async () => {
    setWorldProfiles([]);
    return "undo";
  };
  try {
    assert.equal(await __test__.showStartupCheckDialog(withSnapshot, result), false);
  } finally {
    env.foundry.applications.api.DialogV2.wait = originalWait;
  }
  assert.equal(env.state.notifications.warn.at(-1), "SML.Check.UndoMissing");

  setWorldProfiles([snapshot]);
  env.state.dialogV2WaitResult = "ok";
  assert.equal(await __test__.showStartupCheckDialog(withSnapshot, result), false);
  env.state.userCanManage = false;
  await __test__.showStartupCheckDialog(withSnapshot, result);
  assert.deepEqual(env.state.dialogV2WaitCalls.at(-1).buttons.map((button) => button.action), ["ok"]);
});

test("expired, taken or foreign markers never show a result", async () => {
  registerSettings();

  // No marker: nothing happens, the capture still ends.
  __test__.installStartupErrorCapture({ target: createEventTarget(), consoleObject: { error() {} } });
  assert.equal(await __test__.runStartupCheck({ delay: 0 }), null);
  assert.equal(__test__.startupCapture.stop, null);

  // Expired: cleared quietly.
  setMarker({ appliedAt: Date.now() - __test__.CHECK_MARKER_MAX_AGE_MS - 1000 });
  assert.equal(await __test__.runStartupCheck({ delay: 0 }), null);
  assert.deepEqual(env.state.settingsValues.get(MARKER_KEY), {});
  assert.equal(env.state.notifications.info.length + env.state.dialogV2WaitCalls.length, 0);

  // Another client is the designated GM: the marker stays for that one.
  const marker = setMarker();
  env.game.user.isGM = false;
  assert.equal(await __test__.runStartupCheck({ delay: 0 }), null);
  assert.deepEqual(env.state.settingsValues.get(MARKER_KEY), marker);
  env.game.user.isGM = true;

  // A newer apply replaced the marker while this client waited.
  const pending = __test__.runStartupCheck({ delay: 5 });
  setMarker({ appliedAt: Date.now() + 10 });
  assert.equal(await pending, null);
  assert.equal(__test__.readCheckMarker().appliedAt > marker.appliedAt, true);

  // The marker cannot be cleared: no result, so it cannot show up twice.
  const originalSet = env.game.settings.set;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  env.game.settings.set = async () => {
    throw new Error("no permission");
  };
  try {
    assert.equal(await __test__.runStartupCheck({ delay: 0 }), null);
  } finally {
    env.game.settings.set = originalSet;
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.equal(env.state.notifications.info.length + env.state.dialogV2WaitCalls.length, 0);

  // Unexpected failures are logged, never thrown into the ready hook.
  const originalModules = env.game.modules;
  console.warn = (...args) => warnings.push(args);
  env.game.modules = { get: () => null, values: () => { throw new Error("broken"); }, keys: () => [] };
  try {
    assert.equal(await __test__.runStartupCheck({ delay: 0 }), null);
  } finally {
    env.game.modules = originalModules;
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 2);
});

test("ready runs the check and ends the capture when nothing is pending", async () => {
  registerSettings();
  __test__.installStartupErrorCapture({ target: createEventTarget(), consoleObject: { error() {} } });
  await env.hooks.trigger("ready");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(__test__.startupCapture.stop, null);
  assert.equal(typeof env.game.modules.get(__test__.MODULE_ID).api.apply, "function");
});
