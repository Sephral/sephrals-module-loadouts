// Sample windows (api.samples, contract in samples.mjs): the loadout manager, the questions and the bug hunt filled with
// made-up loadouts and made-up modules, so translators and testers see every text in its place without saving loadouts
// or starting a hunt first. Nothing here writes: no setting, no module state, no reload. The made-up modules live in
// the registry of core.mjs (sampleModules), so the real rendering code finds their titles. Buttons that would change
// something only say that they do nothing.

import { MODULE_ID, PROFILE_SCOPES, formatDate, getThemePreference, localize, localizeHtml, sampleModules } from "./core.mjs";
import { normalizeProfile } from "./store.mjs";
import { SMLLoadoutsManager, filterPinnedRows, getManagerTemplateStrings, presentProfile, renderImportPreview, renderPinnedForm, renderProfileForm } from "./manager.mjs";
import { renderConfirmContent } from "./apply.mjs";
import { HUNT_MODES, HUNT_PHASES, HUNT_RESULTS, SMLBugHuntPanel, normalizeHuntState, presentHuntState, renderStartContent } from "./bug-hunt.mjs";
import { evaluateStartupCheck, renderStartupCheckContent } from "./startup-check.mjs";
import { markSample, openSampleDialog, sampleActions, sampleBlocked, sampleId } from "./samples.mjs";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// Actions of the manager that only look: filter by tag, open the settings.
const LOOKING = ["filterTag", "openSettings"];

/* -------------------------------------------- */
/*  The made-up modules and loadouts            */
/* -------------------------------------------- */

// Names that exist nowhere. "requires" feeds the dependents list of the bug hunt.
const MODULES = [
  { id: "sample-brightwick", title: "Brightwick Lanterns", version: "2.3.1" },
  { id: "sample-dicebox", title: "Dicebox Deluxe", version: "4.0.2" },
  { id: "sample-fogwalker", title: "Fogwalker", version: "1.8.0", requires: ["sample-bellows"] },
  { id: "sample-mapleleaf", title: "Mapleleaf Maps", version: "3.1.4" },
  { id: "sample-questboard", title: "Questboard", version: "1.2.0", requires: ["sample-bellows"] },
  { id: "sample-cobalt", title: "Cobalt Combat Tweaks", version: "0.9.7" },
  { id: "sample-marrow", title: "Marrowdeep Audio", version: "2.0.0" },
  { id: "sample-harrow", title: "Harrow Handouts", version: "1.5.3" },
  { id: "sample-bellows", title: "Bellows Library", version: "1.0.4" },
  { id: "sample-pocket", title: "Pocket Merchant", version: "1.1.0", requires: ["sample-bellows"] },
  { id: "sample-hexcraft", title: "Hexcraft Terrain", version: "5.2.0" }
];
const MODULE_IDS = MODULES.map((entry) => entry.id);

export function registerSampleModules() {
  for (const entry of MODULES) sampleModules.set(entry.id, { title: entry.title, version: entry.version });
}

// The given modules and every made-up module they need, like the real closure of the bug hunt.
export function sampleClosure(ids) {
  const result = new Set();
  const queue = Array.from(ids ?? []);
  while (queue.length) {
    const id = queue.shift();
    const entry = MODULES.find((module) => module.id === id);
    if (result.has(id) || !entry) continue;
    result.add(id);
    queue.push(...(entry.requires ?? []));
  }
  return result;
}

function moduleInfo(ids) {
  return Object.fromEntries(ids.map((id) => {
    const entry = MODULES.find((module) => module.id === id);
    return [id, { title: entry.title, version: entry.version, manifest: `https://example.invalid/${id}/module.json`, url: `https://example.invalid/${id}` }];
  }));
}

/**
 * The loadouts of the manager sample, each with what a comparison with the running world would say (the real
 * comparison reads the installed modules, which these are not). Dates are relative to "now".
 */
export function buildSampleLoadouts(now = Date.now()) {
  registerSampleModules();
  const at = (ms) => new Date(now - ms).toISOString();
  const [brightwick, dicebox, fogwalker, mapleleaf, questboard, cobalt, marrow, harrow, bellows, pocket, hexcraft] = MODULE_IDS;
  const emptyPreflight = () => ({
    desiredIds: new Set(),
    missingModules: [],
    autoEnabledTitles: new Set(),
    blockingDependencies: [],
    warningDetails: [],
    compatibilityWarnings: []
  });
  const comparison = (parts) => ({ matches: [], toEnable: [], toDisable: [], missing: [], pinnedKept: [], ...parts });

  const prep = {
    profile: normalizeProfile({
      id: "sample-prep",
      name: localize("SML.Sample.Prep.Name"),
      description: localize("SML.Sample.Prep.Description"),
      tags: [localize("SML.Sample.Tag.Prep"), localize("SML.Sample.Tag.Weekly")],
      scope: PROFILE_SCOPES.WORLD,
      moduleIds: [brightwick, mapleleaf, questboard, harrow, pocket, bellows, hexcraft],
      moduleInfo: moduleInfo([brightwick, mapleleaf, questboard, harrow, pocket, bellows, hexcraft]),
      settings: {
        mode: "visible",
        capturedAt: at(3 * DAY),
        values: { "sample-questboard.showCompleted": true, "sample-brightwick.radius": 30, "sample-harrow.autoOpen": false },
        defaults: []
      },
      createdAt: at(21 * DAY),
      updatedAt: at(3 * DAY)
    }),
    parts: {
      comparison: comparison({
        matches: [brightwick, mapleleaf, questboard],
        toEnable: [harrow, pocket, bellows],
        toDisable: [cobalt, marrow],
        missing: [hexcraft],
        pinnedKept: [dicebox]
      }),
      preflight: {
        ...emptyPreflight(),
        autoEnabledTitles: new Set(["Bellows Library"]),
        warningDetails: [`Pocket Merchant -> Bellows Library ${localize("SML.Manager.VerifiedWarningSuffix", { version: "1.0.2" })}`],
        compatibilityWarnings: [`Harrow Handouts: ${localize("SML.Manager.AvailabilityWarning")}`]
      },
      changedVersions: [{ id: questboard, title: "Questboard", from: "1.1.0", to: "1.2.0" }],
      unusedLibraries: [bellows],
      settingsChanges: [
        { key: "sample-questboard.showCompleted", action: "set", value: true, from: false, fromStored: true },
        { key: "sample-brightwick.radius", action: "set", value: 30, from: undefined, fromStored: false }
      ]
    }
  };

  const night = {
    profile: normalizeProfile({
      id: "sample-night",
      name: localize("SML.Sample.Night.Name"),
      description: localize("SML.Sample.Night.Description"),
      tags: [localize("SML.Sample.Tag.Live")],
      scope: PROFILE_SCOPES.WORLD,
      moduleIds: [brightwick, dicebox, fogwalker, mapleleaf, questboard, bellows],
      moduleInfo: moduleInfo([brightwick, dicebox, fogwalker, mapleleaf, questboard, bellows]),
      createdAt: at(40 * DAY),
      updatedAt: at(2 * HOUR)
    }),
    parts: {
      comparison: comparison({ matches: [brightwick, dicebox, fogwalker, mapleleaf, questboard, bellows] }),
      preflight: emptyPreflight(),
      changedVersions: [],
      unusedLibraries: [],
      settingsChanges: []
    }
  };

  const lean = {
    profile: normalizeProfile({
      id: "sample-lean",
      name: localize("SML.Sample.Lean.Name"),
      description: localize("SML.Sample.Lean.Description"),
      tags: [localize("SML.Sample.Tag.Live"), localize("SML.Sample.Tag.Travel")],
      scope: PROFILE_SCOPES.GLOBAL,
      moduleIds: [dicebox, mapleleaf, fogwalker],
      moduleInfo: moduleInfo([dicebox, mapleleaf, fogwalker]),
      createdAt: at(60 * DAY),
      updatedAt: at(9 * DAY)
    }, PROFILE_SCOPES.GLOBAL),
    parts: {
      comparison: comparison({ matches: [dicebox, mapleleaf], toEnable: [fogwalker], toDisable: [brightwick, questboard, cobalt, marrow] }),
      preflight: {
        ...emptyPreflight(),
        blockingDependencies: [`Fogwalker -> Bellows Library: ${localize("SML.Manager.AvailabilityBlocked")}`]
      },
      changedVersions: [],
      unusedLibraries: [],
      settingsChanges: []
    }
  };

  const snapshot = {
    profile: normalizeProfile({
      id: "sample-auto",
      name: localize("SML.Snapshot.Name", { date: formatDate(at(26 * HOUR)) }),
      description: localize("SML.Snapshot.Description", { name: localize("SML.Sample.Prep.Name") }),
      tags: ["auto"],
      scope: PROFILE_SCOPES.WORLD,
      auto: true,
      moduleIds: [brightwick, dicebox, mapleleaf, cobalt, marrow],
      moduleInfo: moduleInfo([brightwick, dicebox, mapleleaf, cobalt, marrow]),
      createdAt: at(26 * HOUR),
      updatedAt: at(26 * HOUR)
    }),
    parts: {
      comparison: comparison({ matches: [brightwick, mapleleaf], toEnable: [cobalt, marrow], toDisable: [questboard, harrow] }),
      preflight: emptyPreflight(),
      changedVersions: [],
      unusedLibraries: [],
      settingsChanges: []
    }
  };

  return [prep, night, lean, snapshot];
}

/** The state of a hunt in each phase, as the settings of a real hunt would hold it. */
export function buildSampleHunt(kind, now = Date.now()) {
  registerSampleModules();
  const everything = MODULE_IDS.filter((id) => id !== "sample-hexcraft");
  const keepIds = [MODULE_ID, "sample-dicebox"];
  const suspects = everything.filter((id) => !keepIds.includes(id));
  const base = {
    id: "sample-hunt",
    mode: HUNT_MODES.ERROR,
    pattern: "TypeError: Cannot read properties of undefined (reading 'actor')",
    startedAt: now - 12 * MINUTE,
    userName: "Gamemaster",
    originalIds: everything,
    keepIds,
    suspects,
    testedIds: [],
    activeIds: keepIds,
    phase: HUNT_PHASES.BASELINE,
    step: 1,
    estimate: 5,
    history: []
  };
  const past = [
    { step: 1, phase: HUNT_PHASES.BASELINE, tested: 0, suspects: suspects.length, active: keepIds.length, present: false },
    { step: 2, phase: HUNT_PHASES.SEARCH, tested: 4, suspects: suspects.length, active: 6, present: true }
  ];
  switch (kind) {
    case "manual":
      return normalizeHuntState({ ...base, mode: HUNT_MODES.MANUAL, pattern: "" });
    case "search": {
      const left = suspects.slice(0, 5);
      return normalizeHuntState({
        ...base, suspects: left, testedIds: left.slice(0, 2), activeIds: [...keepIds, ...left.slice(0, 2)],
        phase: HUNT_PHASES.SEARCH, step: 3, history: past
      });
    }
    case "verify":
      return normalizeHuntState({
        ...base, suspects: ["sample-bellows"], culpritId: "sample-bellows", activeIds: [...keepIds, "sample-brightwick", "sample-mapleleaf", "sample-cobalt", "sample-marrow", "sample-harrow"],
        phase: HUNT_PHASES.VERIFY, step: 5, history: [...past, { step: 3, phase: HUNT_PHASES.SEARCH, tested: 2, suspects: 5, active: 4, present: true }, { step: 4, phase: HUNT_PHASES.SEARCH, tested: 1, suspects: 2, active: 3, present: false }]
      });
    case "found":
      return normalizeHuntState({
        ...base, suspects: [], culpritId: "sample-bellows", activeIds: [...keepIds, "sample-brightwick", "sample-mapleleaf", "sample-cobalt", "sample-marrow", "sample-harrow"],
        phase: HUNT_PHASES.DONE, result: HUNT_RESULTS.FOUND, step: 5,
        history: [...past, { step: 3, phase: HUNT_PHASES.SEARCH, tested: 2, suspects: 5, active: 4, present: true }, { step: 4, phase: HUNT_PHASES.VERIFY, tested: 0, suspects: 1, active: 5, present: false }]
      });
    case "notModules":
      return normalizeHuntState({
        ...base, phase: HUNT_PHASES.DONE, result: HUNT_RESULTS.NOT_MODULES, step: 1,
        history: [{ step: 1, phase: HUNT_PHASES.BASELINE, tested: 0, suspects: suspects.length, active: keepIds.length, present: true }]
      });
    case "unclear":
      return normalizeHuntState({
        ...base, suspects: [], phase: HUNT_PHASES.DONE, result: HUNT_RESULTS.UNCLEAR, step: 4, history: past
      });
    case "unclearCandidate":
      return normalizeHuntState({
        ...base, suspects: [], culpritId: "sample-cobalt", phase: HUNT_PHASES.DONE, result: HUNT_RESULTS.UNCLEAR, step: 5, history: past
      });
    default:
      return normalizeHuntState({ ...base, phase: HUNT_PHASES.BASELINE });
  }
}

/** The error the hunt watches for, as the capture would have recorded it. */
function sampleErrors(kind) {
  if (kind !== "search") return [];
  return [{ moduleId: "sample-questboard", kind: "error", detail: "TypeError: Cannot read properties of undefined (reading 'actor')" }];
}

/** The marker and the findings of a check after a switch. problems: false gives the clean run. */
export function buildSampleCheck(problems, now = Date.now()) {
  registerSampleModules();
  const expected = ["sample-brightwick", "sample-dicebox", "sample-fogwalker", "sample-mapleleaf", "sample-questboard", "sample-bellows", "sample-hexcraft"];
  const marker = {
    profileId: "sample-prep",
    profileName: localize("SML.Sample.Prep.Name"),
    expectedIds: expected,
    titles: Object.fromEntries(MODULES.map((entry) => [entry.id, entry.title])),
    snapshotId: problems ? "sample-auto" : null,
    appliedAt: now - 4 * MINUTE,
    userId: null,
    userName: "Gamemaster"
  };
  if (!problems) {
    return { marker, result: evaluateStartupCheck(marker, { activeIds: expected, installedIds: expected }) };
  }
  const active = ["sample-brightwick", "sample-dicebox", "sample-mapleleaf", "sample-questboard", "sample-bellows", "sample-cobalt"];
  const errors = [
    { moduleId: "sample-questboard", kind: "error", detail: "TypeError: Cannot read properties of undefined (reading 'actor')" },
    { moduleId: "sample-questboard", kind: "load", detail: "modules/sample-questboard/scripts/board.js" },
    ...[1, 2, 3, 4, 5, 6, 7].map((number) => ({ moduleId: "sample-mapleleaf", kind: "error", detail: `ReferenceError: tile ${number} is not defined` }))
  ];
  const result = evaluateStartupCheck(marker, {
    activeIds: active,
    installedIds: [...active, "sample-dicebox", "sample-fogwalker"],
    errors,
    packageIssues: { "sample-bellows": { error: ["Bellows Library requires Foundry 15 or newer.\nFurther details."] } }
  });
  return { marker, result };
}

/** Plan of the import sample: one new loadout, one that has the same id, one that has the same name. */
export function buildSampleImportPlan(now = Date.now()) {
  const loadouts = buildSampleLoadouts(now);
  const [prep, night, lean] = loadouts.map((entry) => entry.profile);
  return [
    { profile: { ...lean, id: "sample-new" }, existing: null, match: null },
    { profile: prep, existing: prep, match: "id" },
    { profile: { ...night, id: "sample-other" }, existing: night, match: "name" }
  ];
}

/* -------------------------------------------- */
/*  Windows                                     */
/* -------------------------------------------- */

class SampleManager extends SMLLoadoutsManager {
  constructor({ notices = false, ...options } = {}) {
    super(options);
    this.notices = notices;
    this._openDetails = new Set(["sample-prep"]);
  }

  async _prepareContext() {
    const entries = buildSampleLoadouts();
    const profiles = entries.map(({ profile, parts }) => ({ ...presentProfile(profile, { pinnedIds: ["sample-dicebox"], parts }), detailsOpen: this._openDetails.has(profile.id) }));
    this._profiles = new Map(profiles.map((profile) => [profile.id, profile]));
    const tags = Array.from(new Set(profiles.flatMap((profile) => profile.tags ?? []))).sort();
    const worldCount = profiles.filter((profile) => profile.scope === PROFILE_SCOPES.WORLD).length;
    return {
      strings: getManagerTemplateStrings({ worldName: localize("SML.Sample.World"), currentActiveCount: 9, worldCount, globalCount: profiles.length - worldCount, pinnedCount: 1 }),
      canManage: !this.notices,
      installationUnavailable: this.notices,
      huntRunning: this.notices,
      hasProfiles: true,
      profiles,
      currentActiveCount: 9,
      loadoutCount: profiles.length,
      filterSearch: this._filter.search,
      tagFilters: tags.map((value) => ({ value, active: value === this._filter.tag })),
      uiTheme: getThemePreference()
    };
  }

  // A file chosen for the import would be read and saved.
  async _onImport() {
    sampleBlocked();
  }
}

class SampleHuntPanel extends SMLBugHuntPanel {
  constructor({ kind, ...options } = {}) {
    super(options);
    this.kind = kind;
  }

  async _prepareContext() {
    const state = buildSampleHunt(this.kind);
    return {
      strings: SampleHuntPanel.strings(),
      hunt: presentHuntState(state, { errors: sampleErrors(this.kind), closureOf: sampleClosure }),
      busy: false
    };
  }

  // The same strings as the real panel (its helper is not exported).
  static strings() {
    return {
      title: localize("SML.Hunt.Title"),
      question: localize("SML.Hunt.Question"),
      present: localize("SML.Hunt.AnswerPresent"),
      gone: localize("SML.Hunt.AnswerGone"),
      stop: localize("SML.Hunt.Stop"),
      restoreWithout: localize("SML.Hunt.RestoreWithout"),
      restoreAll: localize("SML.Hunt.RestoreAll"),
      keep: localize("SML.Hunt.Keep"),
      manualHint: localize("SML.Hunt.ManualHint"),
      patternLabel: localize("SML.Hunt.PatternLabel"),
      suggestion: localize("SML.Hunt.Suggestion")
    };
  }
}

async function openManagerSample(id, options = {}) {
  const appId = sampleId(MODULE_ID, id);
  await foundry.applications.instances.get(appId)?.close({ animate: false });
  const app = markSample(new SampleManager({ id: appId, actions: sampleActions(SMLLoadoutsManager, LOOKING), ...options }));
  await app.render({ force: true });
  return app;
}

async function openHuntSample(id, kind) {
  const appId = sampleId(MODULE_ID, id);
  await foundry.applications.instances.get(appId)?.close({ animate: false });
  const app = markSample(new SampleHuntPanel({ id: appId, kind, actions: sampleActions(SMLBugHuntPanel) }));
  await app.render({ force: true });
  return app;
}

const cancelButton = () => ({ label: localize("SML.Actions.Cancel"), icon: "fa-solid fa-xmark" });
const yesNo = () => [
  { label: game.i18n.localize("Yes"), icon: "fa-solid fa-check", default: true },
  { label: game.i18n.localize("No"), icon: "fa-solid fa-xmark" }
];
const dialog = (id, options) => openSampleDialog({ moduleId: MODULE_ID, id, classes: ["sml-dialog"], ...options });

/** The list for api.samples(). */
export function sampleWindows() {
  const group = (key) => localize(`SML.Sample.Group.${key}`);
  const label = (key) => localize(`SML.Sample.${key}`);
  const entry = (groupKey, id, labelKey, open) => ({
    id,
    group: group(groupKey),
    label: label(labelKey),
    open: async () => {
      registerSampleModules();
      return open();
    }
  });
  const prepProfile = () => buildSampleLoadouts()[0];

  return [
    entry("Loadouts", "list", "List", () => openManagerSample("list")),
    entry("Loadouts", "notices", "Notices", () => openManagerSample("notices", { notices: true })),

    entry("Questions", "save", "Save", () => dialog("save", {
      title: localize("SML.Dialog.SaveCurrent.Title"),
      width: 480,
      content: () => renderProfileForm(),
      buttons: [{ label: localize("SML.Dialog.Profile.Submit"), icon: "fa-solid fa-floppy-disk", default: true }, cancelButton()]
    })),
    entry("Questions", "edit", "Edit", () => {
      const { profile } = prepProfile();
      return dialog("edit", {
        title: localize("SML.Dialog.Edit.Title", { name: profile.name }),
        width: 480,
        content: () => renderProfileForm(profile),
        buttons: [{ label: localize("SML.Dialog.Profile.Submit"), icon: "fa-solid fa-floppy-disk", default: true }, cancelButton()]
      });
    }),
    entry("Questions", "apply", "Apply", () => {
      const { profile, parts } = prepProfile();
      return dialog("apply", {
        title: localize("SML.Dialog.Preflight.Title", { name: profile.name }),
        width: 520,
        content: () => renderConfirmContent(profile, parts.preflight, {
          enableIds: ["sample-harrow", "sample-pocket", "sample-bellows"],
          disableIds: ["sample-cobalt", "sample-marrow"],
          settingsChanges: parts.settingsChanges,
          pinnedKept: parts.comparison.pinnedKept,
          changedVersions: parts.changedVersions
        }),
        buttons: [{ label: localize("SML.Actions.Apply"), icon: "fa-solid fa-bolt", default: true }, cancelButton()]
      });
    }),
    entry("Questions", "import", "Import", () => dialog("import", {
      title: localize("SML.Dialog.Import.Title"),
      width: 560,
      content: () => renderImportPreview(buildSampleImportPlan()),
      buttons: [{ label: localize("SML.Actions.Import"), icon: "fa-solid fa-file-import", default: true }, cancelButton()]
    })),
    entry("Questions", "pinned", "Pinned", () => dialog("pinned", {
      title: localize("SML.Dialog.Pinned.Title"),
      width: 480,
      content: () => renderPinnedForm({ pinnedIds: ["sample-dicebox"], activeIds: MODULE_IDS.slice(0, 9), installedIds: MODULE_IDS }),
      buttons: [{ label: localize("SML.Dialog.Pinned.Save"), icon: "fa-solid fa-floppy-disk", default: true }, cancelButton()],
      render: (_event, app) => {
        const root = app.element;
        const search = root?.querySelector?.('input[name="pinnedFilter"]');
        search?.addEventListener("input", () => filterPinnedRows(root, search.value));
      }
    })),
    entry("Questions", "delete", "Delete", () => dialog("delete", {
      title: localize("SML.Dialog.Delete.Title"),
      content: () => `<p>${localizeHtml("SML.Dialog.Delete.Content", { name: prepProfile().profile.name })}</p>`,
      buttons: yesNo()
    })),
    entry("Questions", "replace", "Replace", () => dialog("replace", {
      title: localize("SML.Dialog.Replace.Title"),
      content: () => `<p>${localizeHtml("SML.Dialog.Replace.Content", { name: prepProfile().profile.name })}</p>`,
      buttons: yesNo()
    })),

    entry("Hunt", "hunt-start", "HuntStart", () => dialog("hunt-start", {
      title: localize("SML.Hunt.Title"),
      width: 520,
      content: () => renderStartContent({ pattern: "", activeIds: MODULE_IDS.filter((id) => id !== "sample-hexcraft").concat(MODULE_ID), pinnedIds: ["sample-dicebox"] }),
      buttons: [{ label: localize("SML.Hunt.Start"), icon: "fa-solid fa-play", default: true }, cancelButton()]
    })),
    entry("Hunt", "hunt-manual", "HuntManual", () => openHuntSample("hunt-manual", "manual")),
    entry("Hunt", "hunt-search", "HuntSearch", () => openHuntSample("hunt-search", "search")),
    entry("Hunt", "hunt-verify", "HuntVerify", () => openHuntSample("hunt-verify", "verify")),
    entry("Hunt", "hunt-found", "HuntFound", () => openHuntSample("hunt-found", "found")),
    entry("Hunt", "hunt-not-modules", "HuntNotModules", () => openHuntSample("hunt-not-modules", "notModules")),
    entry("Hunt", "hunt-unclear", "HuntUnclear", () => openHuntSample("hunt-unclear", "unclear")),
    entry("Hunt", "hunt-candidate", "HuntCandidate", () => openHuntSample("hunt-candidate", "unclearCandidate")),
    entry("Hunt", "hunt-stop", "HuntStop", () => dialog("hunt-stop", {
      title: localize("SML.Hunt.Title"),
      content: () => `<p>${localize("SML.Hunt.StopConfirm")}</p>`,
      buttons: yesNo()
    })),

    entry("Check", "check-ok", "CheckOk", () => {
      const { marker, result } = buildSampleCheck(false);
      return dialog("check-ok", {
        title: localize("SML.Check.Title", { name: marker.profileName }),
        width: 520,
        classes: ["sml-check-dialog"],
        content: () => renderStartupCheckContent(marker, result, { canUndo: false, snapshotMissing: true, canHunt: false }),
        buttons: [{ label: localize("SML.Check.Ok"), icon: "fa-solid fa-check", default: true }]
      });
    }),
    entry("Check", "check-problems", "CheckProblems", () => {
      const { marker, result } = buildSampleCheck(true);
      return dialog("check-problems", {
        title: localize("SML.Check.Title", { name: marker.profileName }),
        width: 520,
        classes: ["sml-check-dialog"],
        content: () => renderStartupCheckContent(marker, result, { canUndo: true, snapshotMissing: false, canHunt: true }),
        buttons: [
          { label: localize("SML.Check.Ok"), icon: "fa-solid fa-check", default: true },
          { label: localize("SML.Check.Undo"), icon: "fa-solid fa-rotate-left" },
          { label: localize("SML.Check.Hunt"), icon: "fa-solid fa-magnifying-glass" }
        ]
      });
    })
  ];
}

export const __test__ = { MODULES, sampleClosure, sampleErrors };
