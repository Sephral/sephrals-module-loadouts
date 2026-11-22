import assert from "node:assert/strict";
import test from "node:test";

import { createTestEnvironment, modulePath } from "./helpers/test-helpers.mjs";

const env = createTestEnvironment();
const { __test__ } = await import(modulePath("scripts/sml.js"));

test.beforeEach(() => {
  env.reset();
  env.addModule(__test__.MODULE_ID, { title: "Sephral’s Module Loadouts" });
});

test.after(() => {
  env.restore();
});

test("the sample loadouts hold made-up modules and cover every state of a card", () => {
  const entries = __test__.buildSampleLoadouts(Date.UTC(2026, 10, 22));
  assert.equal(entries.length, 4);
  const ids = entries.flatMap((entry) => entry.profile.moduleIds);
  assert.ok(ids.every((id) => id.startsWith("sample-")));
  assert.equal(entries.filter((entry) => entry.profile.auto).length, 1);
  const prep = entries[0];
  for (const key of ["toEnable", "toDisable", "missing", "pinnedKept", "matches"]) assert.ok(prep.parts.comparison[key].length, key);
  assert.ok(prep.parts.settingsChanges.length && prep.parts.changedVersions.length && prep.parts.unusedLibraries.length);
  assert.ok(entries[2].parts.preflight.blockingDependencies.length);
});

test("the made-up modules have titles and the closure follows their requirements", () => {
  __test__.registerSampleModules();
  assert.equal(__test__.moduleTitle("sample-bellows"), "Bellows Library");
  assert.deepEqual(Array.from(__test__.sampleClosure(["sample-fogwalker"])).sort(), ["sample-bellows", "sample-fogwalker"]);
});

test("each hunt sample is a valid state with the phase it names", () => {
  const phases = { manual: "baseline", search: "search", verify: "verify", found: "done", notModules: "done", unclear: "done", unclearCandidate: "done" };
  for (const [kind, phase] of Object.entries(phases)) {
    const state = __test__.buildSampleHunt(kind);
    assert.ok(state, kind);
    assert.equal(state.phase, phase, kind);
  }
  assert.equal(__test__.buildSampleHunt("found").result, "found");
  assert.equal(__test__.buildSampleHunt("unclearCandidate").culpritId, "sample-cobalt");
});

test("the check samples are a clean run and a run with every kind of problem", () => {
  const clean = __test__.buildSampleCheck(false);
  assert.equal(clean.result.ok, true);
  const bad = __test__.buildSampleCheck(true);
  assert.equal(bad.result.ok, false);
  assert.ok(bad.result.notActive.length && bad.result.unexpected.length && bad.result.startupErrors.length && bad.result.foundryErrors.length);
});

test("the import sample has a new loadout, one with the same id and one with the same name", () => {
  const plan = __test__.buildSampleImportPlan();
  assert.deepEqual(plan.map((entry) => entry.match), [null, "id", "name"]);
});

test("the list of samples has unique ids and writes nothing", () => {
  const list = __test__.sampleWindows();
  assert.equal(new Set(list.map((entry) => entry.id)).size, list.length);
  assert.ok(list.length >= 15);
  assert.deepEqual(env.state.settingDocumentCalls, []);
});
