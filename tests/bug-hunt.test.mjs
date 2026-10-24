import assert from "node:assert/strict";
import test from "node:test";

import { createFakeForm, createTestEnvironment, flushPromises, modulePath, pressDialogButton } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));

const HUNT_KEY = `sephrals-module-loadouts.${__test__.BUG_HUNT_SETTING}`;

// A pure dependency graph for the search steps: id -> required ids.
function graphClosure(graph) {
  return (ids) => {
    const result = new Set();
    const queue = Array.from(ids);
    while (queue.length) {
      const id = queue.shift();
      if (result.has(id)) continue;
      result.add(id);
      queue.push(...(graph[id] ?? []));
    }
    return result;
  };
}

// Runs a hunt to its end. present(activeIds) answers whether the problem shows up.
function runHunt(state, present, closure, limit = 30) {
  let current = state;
  let steps = 0;
  while (current.phase !== __test__.HUNT_PHASES.DONE && steps < limit) {
    current = __test__.advanceHunt(current, present(new Set(current.activeIds)), closure);
    steps += 1;
  }
  return { state: current, steps };
}

const GRAPH = {
  "sephrals-module-loadouts": [],
  lib: [],
  "uses-lib-1": ["lib"],
  "uses-lib-2": ["lib"],
  chain: ["uses-lib-1"],
  solo1: [],
  solo2: [],
  solo3: [],
  solo4: [],
  keepme: []
};
const ALL = Object.keys(GRAPH);

test.beforeEach(() => {
  env.reset();
  __test__.resetInstallationStore();
  __test__.stopStartupErrorCapture(undefined, { force: true });
  __test__.startupCapture.entries.length = 0;
  __test__.startupCapture.keys.clear();
  __test__.startupCapture.holds.clear();
  env.addModule(__test__.MODULE_ID, { title: "Loadouts", active: true });
  env.addModule("module-a", { title: "Alpha", active: true });
  env.addModule("module-b", { title: "Beta", active: true, relationships: { requires: [{ id: "module-lib", type: "module" }] } });
  env.addModule("module-lib", { title: "Library", active: true, library: true });
  env.addModule("module-c", { title: "Gamma", active: true });
  env.addModule("module-off", { title: "Off" });
  env.state.settingsValues.set("core.moduleConfiguration", {
    [__test__.MODULE_ID]: true,
    "module-a": true,
    "module-b": true,
    "module-lib": true,
    "module-c": true
  });
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.WORLD_PROFILES_SETTING}`, { version: 2, profiles: [] });
  env.state.settingsRegistry.set(HUNT_KEY, { namespace: __test__.MODULE_ID, key: __test__.BUG_HUNT_SETTING });
  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, options.buttons[0].action);
});

test.after(() => {
  env.restore();
});

test("the hunt starts with only the kept modules and suspects the rest", () => {
  const closure = graphClosure(GRAPH);
  const state = __test__.createHuntState({ mode: "error", pattern: " boom ", originalIds: ALL, keepIds: ["chain"], user: { id: "u", name: "GM" }, now: 5, id: "hunt" }, closure);
  assert.deepEqual(state.keepIds.sort(), ["chain", "lib", "sephrals-module-loadouts", "uses-lib-1"]);
  assert.deepEqual(state.suspects, ["uses-lib-2", "solo1", "solo2", "solo3", "solo4", "keepme"]);
  assert.deepEqual(state.activeIds.sort(), state.keepIds.sort());
  assert.equal(state.phase, __test__.HUNT_PHASES.BASELINE);
  assert.equal(state.pattern, "boom");
  assert.equal(state.estimate, __test__.estimateSteps(6));
  assert.equal(__test__.createHuntState({ mode: "manual", pattern: "x", originalIds: ALL }, closure).pattern, "");

  assert.equal(__test__.estimateSteps(0), 2);
  assert.equal(__test__.estimateSteps(1), 2);
  assert.equal(__test__.estimateSteps(8), 5);
  assert.equal(__test__.estimateSteps(9), 6);
});

test("a test step takes about half of the suspects, counting the libraries they pull in", () => {
  const closure = graphClosure(GRAPH);
  const suspects = ["lib", "uses-lib-1", "uses-lib-2", "chain", "solo1", "solo2"];
  const plan = __test__.planTest(suspects, ["sephrals-module-loadouts"], closure);
  assert.equal(plan.splits, true);
  assert.equal(plan.testedIds.length, 3);
  for (const id of plan.testedIds) assert.equal(suspects.includes(id), true);
  // Everything a tested module needs is active.
  for (const id of plan.activeIds) {
    for (const dependency of GRAPH[id] ?? []) assert.equal(plan.activeIds.includes(dependency), true);
  }

  // A module that needs every other suspect cannot be split off.
  const tangled = graphClosure({ a: ["b"], b: ["a"] });
  assert.equal(__test__.planTest(["a", "b"], [], tangled).splits, false);

  assert.deepEqual(__test__.findDependents("lib", ["lib", "uses-lib-1", "chain", "solo1"], closure), ["uses-lib-1", "chain"]);
});

test("for every single culprit the hunt finds it within the estimate", () => {
  const closure = graphClosure(GRAPH);
  for (const culprit of ALL.filter((id) => id !== "sephrals-module-loadouts")) {
    const state = __test__.createHuntState({ mode: "manual", originalIds: ALL }, closure);
    const { state: done, steps } = runHunt(state, (active) => active.has(culprit), closure);
    assert.equal(done.result, __test__.HUNT_RESULTS.FOUND, culprit);
    assert.equal(done.culpritId, culprit, culprit);
    assert.equal(steps <= state.estimate, true, `${culprit}: ${steps} > ${state.estimate}`);
    assert.equal(done.history.length, steps);
  }
});

test("the hunt ends early when modules are not the cause, and says so when one module is not enough", () => {
  const closure = graphClosure(GRAPH);
  const always = runHunt(__test__.createHuntState({ mode: "manual", originalIds: ALL }, closure), () => true, closure);
  assert.equal(always.state.result, __test__.HUNT_RESULTS.NOT_MODULES);
  assert.equal(always.steps, 1);

  // Two modules together: the hunt either names one of them (switching it off fixes the problem) or ends unclear,
  // but it never names a module whose removal leaves the problem.
  const pair = runHunt(__test__.createHuntState({ mode: "manual", originalIds: ALL }, closure), (active) => active.has("solo1") && active.has("solo3"), closure);
  assert.equal(pair.state.phase, __test__.HUNT_PHASES.DONE);
  if (pair.state.result === __test__.HUNT_RESULTS.FOUND) assert.equal(["solo1", "solo3"].includes(pair.state.culpritId), true);
  else assert.equal(pair.state.result, __test__.HUNT_RESULTS.UNCLEAR);

  // The problem stays without the last suspect: unclear, the candidate is named.
  let calls = 0;
  const flaky = runHunt(__test__.createHuntState({ mode: "manual", originalIds: ALL }, closure), (active) => {
    calls += 1;
    return calls === 1 ? false : active.has("solo2") || active.size > 6;
  }, closure);
  assert.equal(flaky.state.phase, __test__.HUNT_PHASES.DONE);
  assert.equal([__test__.HUNT_RESULTS.FOUND, __test__.HUNT_RESULTS.UNCLEAR].includes(flaky.state.result), true);

  const verifyFails = { ...__test__.createHuntState({ mode: "manual", originalIds: ALL }, closure), phase: "verify", culpritId: "solo4", suspects: ["solo4"] };
  const unclear = __test__.advanceHunt(verifyFails, true, closure);
  assert.equal(unclear.result, __test__.HUNT_RESULTS.UNCLEAR);
  assert.equal(unclear.culpritId, "solo4");
  // A finished hunt stays as it is.
  assert.equal(__test__.advanceHunt(unclear, false, closure), unclear);
});

test("stored hunt states are checked", () => {
  assert.equal(__test__.normalizeHuntState(null), null);
  assert.equal(__test__.normalizeHuntState({}), null);
  assert.equal(__test__.normalizeHuntState({ id: "x", phase: "nonsense" }), null);
  const loose = __test__.normalizeHuntState({ id: "x", phase: "search", mode: "odd", step: "a", originalIds: ["a", "a", " "], history: [null, { step: "2", present: "yes" }] });
  assert.equal(loose.mode, "manual");
  assert.equal(loose.step, 1);
  assert.deepEqual(loose.originalIds, ["a"]);
  assert.deepEqual(loose.history, [{ step: 2, phase: "", tested: 0, suspects: 0, active: 0, present: false }]);
});

test("error texts match pasted console lines and parts of the message", () => {
  assert.equal(__test__.normalizeErrorText("Uncaught (in promise) TypeError:  Cannot   read X"), "cannot read x");
  assert.equal(__test__.matchesErrorText("Cannot read properties of undefined (reading 'foo')", "Uncaught TypeError: Cannot read properties of undefined (reading 'foo')"), true);
  assert.equal(__test__.matchesErrorText("Cannot read properties of undefined (reading 'foo')", "reading 'foo'"), true);
  assert.equal(__test__.matchesErrorText("short", "a much longer pasted line with short in it"), false);
  assert.equal(__test__.matchesErrorText("something else", "foo"), false);
  assert.equal(__test__.matchesErrorText("x", ""), false);
  assert.deepEqual(__test__.findMatchingErrors("boom", [{ detail: "Big boom" }, { detail: "quiet" }]), [{ detail: "Big boom" }]);
});

test("starting a hunt saves a snapshot and the state and restarts with the kept modules", async () => {
  env.state.userCanManage = false;
  assert.equal(await __test__.startBugHunt({ mode: "manual" }), null);
  assert.equal(env.state.notifications.error.at(-1), "permission required");
  env.state.userCanManage = true;

  env.state.localizations.set("SML.Hunt.PatternRequired", "pattern required");
  assert.equal(await __test__.startBugHunt({ mode: "error", pattern: "  " }), null);
  assert.equal(env.state.notifications.warn.at(-1), "pattern required");

  env.state.localizations.set("SML.Hunt.NothingToSearch", "nothing to search");
  assert.equal(await __test__.startBugHunt({ mode: "manual", keepIds: ["module-a", "module-b", "module-c"] }), null);
  assert.equal(env.state.notifications.warn.at(-1), "nothing to search");

  const state = await __test__.startBugHunt({ mode: "error", pattern: "boom", keepIds: ["module-b"] });
  assert.deepEqual(state.keepIds.sort(), [__test__.MODULE_ID, "module-b", "module-lib"].sort());
  assert.deepEqual(state.suspects.sort(), ["module-a", "module-c"]);
  const snapshot = env.state.settingsValues.get(`sephrals-module-loadouts.${__test__.WORLD_PROFILES_SETTING}`).profiles.find((entry) => entry.auto);
  assert.equal(snapshot.id, state.snapshotId);
  assert.deepEqual(env.state.settingsValues.get(HUNT_KEY).phase, "baseline");
  assert.deepEqual(Object.keys(env.state.settingsValues.get("core.moduleConfiguration")).sort(), [__test__.MODULE_ID, "module-b", "module-lib"].sort());
  // Every step reloads all clients right away, without Foundry's question.
  assert.deepEqual(env.state.socketEmits, [["reload"]]);
  assert.equal(env.state.reloads, 1);
  assert.deepEqual(env.state.reloadCalls, []);

  // A running hunt opens its window instead of a second hunt.
  assert.equal(await __test__.startBugHunt({ mode: "manual" }), null);
  assert.equal(env.instances.get("sml-bug-hunt")?.rendered, true);
});

test("answers advance the hunt and the result restores the modules", async () => {
  const state = await __test__.startBugHunt({ mode: "manual" });
  assert.deepEqual(state.suspects.sort(), ["module-a", "module-b", "module-c", "module-lib"]);
  // Simulate: module-c is the culprit.
  for (let index = 0; index < 10; index += 1) {
    const current = __test__.readHuntState();
    if (current.phase === "done") break;
    const next = await __test__.answerBugHunt(current.activeIds.includes("module-c"));
    assert.equal(next.step > current.step || next.phase === "done", true);
  }
  const done = __test__.readHuntState();
  assert.equal(done.result, "found");
  assert.equal(done.culpritId, "module-c");
  // The last answer shows the result without another restart.
  const emits = env.state.socketEmits.length;
  assert.equal(await __test__.answerBugHunt(true), null);
  assert.equal(env.state.socketEmits.length, emits);

  assert.equal(await __test__.finishBugHunt("without"), true);
  assert.deepEqual(Object.keys(env.state.settingsValues.get("core.moduleConfiguration")).sort(), [__test__.MODULE_ID, "module-a", "module-b", "module-lib"].sort());
  assert.deepEqual(env.state.settingsValues.get(HUNT_KEY), {});
  const marker = env.state.settingsValues.get(`sephrals-module-loadouts.${__test__.CHECK_MARKER_SETTING}`);
  assert.deepEqual(marker.expectedIds.sort(), [__test__.MODULE_ID, "module-a", "module-b", "module-lib"].sort());
  assert.equal(marker.snapshotId, null);
  assert.equal(await __test__.finishBugHunt("all"), false);
});

test("a library culprit takes the modules that need it along, keep leaves the modules alone", async () => {
  await __test__.startBugHunt({ mode: "manual" });
  for (let index = 0; index < 10; index += 1) {
    const current = __test__.readHuntState();
    if (current.phase === "done") break;
    await __test__.answerBugHunt(current.activeIds.includes("module-lib"));
  }
  const done = __test__.readHuntState();
  assert.equal(done.culpritId, "module-lib");
  env.state.localizations.set("SML.Hunt.Dependents", "needs it: {modules}");
  const presented = __test__.presentHuntState(done);
  assert.equal(presented.found, true);
  assert.equal(presented.dependentsText, "needs it: Beta");

  const configuration = env.state.settingsValues.get("core.moduleConfiguration");
  const writes = env.state.settingWrites.filter((entry) => entry.moduleId === "core").length;
  assert.equal(await __test__.finishBugHunt("keep"), true);
  assert.equal(env.state.settingWrites.filter((entry) => entry.moduleId === "core").length, writes);
  assert.equal(env.state.settingsValues.get("core.moduleConfiguration"), configuration);
  assert.deepEqual(env.state.settingsValues.get(HUNT_KEY), {});

  // Restoring all brings every module of the start back.
  env.state.settingsValues.set("core.moduleConfiguration", {
    [__test__.MODULE_ID]: true,
    "module-a": true,
    "module-b": true,
    "module-lib": true,
    "module-c": true
  });
  await __test__.startBugHunt({ mode: "manual" });
  assert.equal(await __test__.finishBugHunt("all"), true);
  assert.deepEqual(Object.keys(env.state.settingsValues.get("core.moduleConfiguration")).sort(), [__test__.MODULE_ID, "module-a", "module-b", "module-c", "module-lib"].sort());
});

test("a running hunt keeps the error capture, the panel shows the error watch", async () => {
  await __test__.startBugHunt({ mode: "error", pattern: "Boom in Alpha" });
  __test__.prepareBugHuntCapture();
  assert.equal(__test__.startupCapture.holds.has(__test__.HUNT_CAPTURE_HOLD), true);
  // The check would end the capture, the hunt holds it.
  assert.equal(__test__.stopStartupErrorCapture(), false);

  env.state.localizations.set("SML.Hunt.ErrorSeen", "seen {count}");
  env.state.localizations.set("SML.Hunt.ErrorNotSeen", "not seen");
  let presented = __test__.presentHuntState(__test__.readHuntState());
  assert.equal(presented.seen, false);
  assert.equal(presented.suggestGone, true);
  assert.equal(presented.seenText, "not seen");

  const panel = __test__.resumeBugHunt() && env.instances.get("sml-bug-hunt");
  assert.equal(panel.rendered, true);
  panel._onFirstRender({}, {});
  const renders = panel.renderCalls.length;
  __test__.recordStartupError({ moduleId: null, kind: "error", detail: "Uncaught Error: boom in alpha happened" });
  assert.equal(panel.renderCalls.length, renders + 1);
  presented = __test__.presentHuntState(__test__.readHuntState());
  assert.equal(presented.seen, true);
  assert.equal(presented.suggestPresent, true);
  assert.equal(presented.seenText, "seen 1");

  const context = await panel._prepareContext({});
  assert.equal(context.hunt.errorMode, true);
  assert.equal(typeof context.strings.question, "string");
  await panel.close();

  // Without a hunt the hold ends.
  env.state.settingsValues.set(HUNT_KEY, {});
  assert.equal(__test__.resumeBugHunt(), null);
  assert.equal(__test__.startupCapture.holds.size, 0);
});

test("the start dialog reads mode, error text and the kept modules", async () => {
  env.state.settingsRegistry.set(`sephrals-module-loadouts.${__test__.PINNED_MODULES_SETTING}`, {});
  env.state.settingsValues.set(`sephrals-module-loadouts.${__test__.PINNED_MODULES_SETTING}`, ["module-c"]);
  const html = __test__.renderStartContent({ pattern: "<b>x</b>" });
  assert.match(html, /value="module-c" checked/);
  assert.doesNotMatch(html, /value="module-a" checked/);
  assert.doesNotMatch(html, /value="sephrals-module-loadouts"/);
  assert.match(html, /value="error" checked/);
  assert.equal(html.includes("<b>x</b>"), false);

  assert.deepEqual(__test__.readStartForm(createFakeForm({ mode: "error", pattern: " boom " }, { checked: { keep: ["module-a"] } })), {
    mode: "error",
    pattern: "boom",
    keepIds: ["module-a"]
  });
  assert.deepEqual(__test__.readStartForm(null), { mode: "manual", pattern: "", keepIds: [] });

  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "cancel");
  assert.equal(await __test__.openBugHuntStart(), null);

  env.state.dialogV2WaitHandler = (options) => pressDialogButton(options, "start", createFakeForm({ mode: "manual", pattern: "" }, { checked: { keep: ["module-a"] } }));
  const state = await __test__.openBugHuntStart();
  assert.equal(state.keepIds.includes("module-a"), true);

  // The check window's button prefills the error text.
  await __test__.finishBugHunt("keep");
  let content = "";
  env.state.dialogV2WaitHandler = (options) => {
    content = options.content;
    return null;
  };
  await __test__.openBugHuntStart({ pattern: "the error" });
  assert.match(content, /value="the error"/);
});

test("the setting change redraws or closes the panel and the manager shows the running hunt", async () => {
  await env.hooks.trigger("init");
  await __test__.startBugHunt({ mode: "manual" });
  const panel = __test__.openBugHuntPanel();
  const renders = panel.renderCalls.length;
  __test__.onBugHuntSettingChange();
  assert.equal(panel.renderCalls.length, renders + 1);

  const manager = new __test__.SMLLoadoutsManager();
  assert.equal((await manager._prepareContext({})).huntRunning, true);

  env.state.dialogV2WaitHandler = null;
  env.state.dialogV2Result = true;
  await __test__.finishBugHunt("keep");
  await flushPromises();
  assert.equal(panel.rendered, false);
  assert.equal((await manager._prepareContext({})).huntRunning, false);
});

test("the panel buttons answer, stop and finish the hunt and report failures", async () => {
  const panelActions = __test__.SMLBugHuntPanel.DEFAULT_OPTIONS.actions;
  const allModules = () => env.state.settingsValues.set("core.moduleConfiguration", {
    [__test__.MODULE_ID]: true,
    "module-a": true,
    "module-b": true,
    "module-lib": true,
    "module-c": true
  });
  await __test__.startBugHunt({ mode: "manual" });
  const panel = __test__.openBugHuntPanel();
  assert.equal(panel.title, "SML.Hunt.Title");
  panel._onRender({}, {});

  await panelActions.answerGone.call(panel);
  assert.equal(__test__.readHuntState().step, 2);
  await panelActions.answerPresent.call(panel);
  assert.equal(__test__.readHuntState().step, 3);

  // Stop asks first: no keeps the hunt.
  env.state.dialogV2Result = false;
  await panelActions.stopHunt.call(panel);
  assert.equal(__test__.readHuntState().step, 3);
  env.state.dialogV2Result = true;
  await panelActions.stopHunt.call(panel);
  assert.equal(__test__.readHuntState(), null);

  for (const [action, choice] of [["restoreAll", "all"], ["restoreWithout", "without"], ["keepModules", "keep"]]) {
    allModules();
    assert.notEqual(await __test__.startBugHunt({ mode: "manual" }), null, choice);
    await panelActions[action].call(panel);
    assert.equal(__test__.readHuntState(), null, choice);
  }

  // A failing step shows an error and frees the buttons again.
  allModules();
  assert.notEqual(await __test__.startBugHunt({ mode: "manual" }), null);
  const originalSet = env.game.settings.set;
  env.game.settings.set = async () => {
    throw new Error("no permission");
  };
  env.state.localizations.set("SML.Hunt.Failed", "failed {message}");
  const consoleError = console.error;
  console.error = () => {};
  try {
    await panelActions.answerGone.call(panel);
  } finally {
    env.game.settings.set = originalSet;
    console.error = consoleError;
  }
  assert.equal(env.state.notifications.error.at(-1), "failed no permission");
  assert.equal((await panel._prepareContext({})).busy, false);

  // Without the permission nothing changes.
  env.state.userCanManage = false;
  assert.equal(await __test__.answerBugHunt(true), null);
  assert.equal(await __test__.finishBugHunt("all"), false);
  assert.equal(await __test__.openBugHuntStart(), null);
  assert.equal(env.state.notifications.error.at(-1), "permission required");
  env.state.userCanManage = true;

  // Result texts for every outcome.
  const state = __test__.readHuntState();
  for (const [result, culpritId, key] of [["notModules", null, "SML.Hunt.Result.NotModules"], ["unclear", null, "SML.Hunt.Result.Unclear"], ["unclear", "module-a", "SML.Hunt.Result.UnclearCandidate"]]) {
    const presented = __test__.presentHuntState({ ...state, phase: "done", result, culpritId });
    assert.equal(presented.resultText, key);
    assert.equal(presented.canAnswer, false);
  }
  const verify = __test__.presentHuntState({ ...state, phase: "verify", culpritId: "module-a" });
  assert.equal(verify.stepText, "SML.Hunt.Step.Verify");
  panel._onClose({});
});

test("only the running gamemaster keeps the capture, the hunt text drops Foundry's hook wrapper", async () => {
  await __test__.startBugHunt({ mode: "manual" });
  __test__.prepareBugHuntCapture();
  env.game.user.isGM = false;
  assert.equal(__test__.resumeBugHunt().id.length > 0, true);
  assert.equal(__test__.startupCapture.holds.size, 0);
  assert.equal(env.instances.has("sml-bug-hunt"), false);
  env.game.user.isGM = true;

  const result = { startupErrors: [{ moduleId: "a", details: ["Error thrown in hooked function 'x' for hook 'ready'. Real message"] }], foundryErrors: [] };
  assert.equal(__test__.firstErrorText(result), "Real message");
  assert.equal(__test__.firstErrorText({ startupErrors: [], foundryErrors: [{ details: ["Manifest broken"] }] }), "Manifest broken");
  assert.equal(__test__.firstErrorText({ startupErrors: [], foundryErrors: [] }), "");
});

test("players do not read the installation file at ready", async () => {
  await env.hooks.trigger("init");
  env.game.user.isGM = false;
  env.state.userCanManage = false;
  await env.hooks.trigger("ready");
  assert.equal(env.state.fileOps.length, 0);
  env.game.user.isGM = true;
  env.state.userCanManage = true;
});
