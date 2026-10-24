// Bug hunt: finds the module behind a problem by switching off half of the suspects per restart. In error mode it
// watches for a chosen error message and suggests the answer; otherwise the gamemaster judges each step.

import {
  BUG_HUNT_SETTING,
  MODULE_ID,
  applyManagerTheme,
  canManageModules,
  compareModuleIdsByTitle,
  escapeHtml,
  formatList,
  getCurrentActiveModuleIds,
  getEnabledModuleIdsFromConfiguration,
  getRegisteredSettingValue,
  localize,
  localizeHtml,
  moduleTitle,
  refreshManager
} from "./core.mjs";
import { buildModuleConfiguration, withRequiredModules, writeModuleConfiguration } from "./apply.mjs";
import { getPinnedModuleIds, saveAutoSnapshot } from "./store.mjs";
import {
  buildCheckMarker,
  findMatchingErrors,
  holdStartupCapture,
  isCheckRunner,
  onStartupError,
  releaseStartupCapture,
  saveCheckMarker,
  startupCapture
} from "./startup-check.mjs";

export const HUNT_MODES = Object.freeze({
  ERROR: "error",
  MANUAL: "manual"
});
export const HUNT_PHASES = Object.freeze({
  BASELINE: "baseline",
  SEARCH: "search",
  VERIFY: "verify",
  DONE: "done"
});
export const HUNT_RESULTS = Object.freeze({
  FOUND: "found",
  NOT_MODULES: "notModules",
  UNCLEAR: "unclear"
});
export const HUNT_CAPTURE_HOLD = "bugHunt";
const HUNT_WINDOW_ID = "sml-bug-hunt";
const MAX_PATTERN_LENGTH = 300;

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

// ---------------------------------------------------------------------------------------------
// State and search steps (pure: closure(ids) returns the ids with everything they require)
// ---------------------------------------------------------------------------------------------

function uniqueIds(ids) {
  return Array.from(new Set(Array.from(ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean)));
}

export function normalizeHuntState(value) {
  if (!value || typeof value !== "object" || !value.id) return null;
  const phase = Object.values(HUNT_PHASES).includes(value.phase) ? value.phase : null;
  if (!phase) return null;
  return {
    id: String(value.id),
    mode: value.mode === HUNT_MODES.ERROR ? HUNT_MODES.ERROR : HUNT_MODES.MANUAL,
    pattern: String(value.pattern ?? "").slice(0, MAX_PATTERN_LENGTH),
    startedAt: Number(value.startedAt) || 0,
    userId: value.userId ? String(value.userId) : null,
    userName: String(value.userName ?? ""),
    originalIds: uniqueIds(value.originalIds),
    keepIds: uniqueIds(value.keepIds),
    suspects: uniqueIds(value.suspects),
    testedIds: uniqueIds(value.testedIds),
    activeIds: uniqueIds(value.activeIds),
    culpritId: value.culpritId ? String(value.culpritId) : null,
    snapshotId: value.snapshotId ? String(value.snapshotId) : null,
    phase,
    result: Object.values(HUNT_RESULTS).includes(value.result) ? value.result : null,
    step: Math.max(1, Number(value.step) || 1),
    estimate: Math.max(1, Number(value.estimate) || 1),
    history: Array.isArray(value.history) ? value.history.filter((entry) => entry && typeof entry === "object").map((entry) => ({
      step: Number(entry.step) || 0,
      phase: String(entry.phase ?? ""),
      tested: Number(entry.tested) || 0,
      suspects: Number(entry.suspects) || 0,
      active: Number(entry.active) || 0,
      present: entry.present === true
    })) : []
  };
}

export function estimateSteps(suspectCount) {
  if (suspectCount <= 1) return 2;
  return 2 + Math.ceil(Math.log2(suspectCount));
}

// Half of the suspects, counted with the modules they pull in: a library a tested module requires is tested too.
// Modules that pull in few others come first, so the split stays close to half.
export function planTest(suspects, keepIds, closure) {
  const suspectSet = new Set(suspects);
  const target = Math.ceil(suspects.length / 2);
  const testedBy = (ids) => Array.from(closure([...keepIds, ...ids])).filter((id) => suspectSet.has(id));
  const ordered = suspects
    .map((id, index) => ({ id, index, size: testedBy([id]).length }))
    .sort((left, right) => left.size - right.size || left.index - right.index)
    .map((entry) => entry.id);

  const part = [];
  let tested = [];
  for (const id of ordered) {
    part.push(id);
    tested = testedBy(part);
    if (tested.length >= target) break;
  }
  return {
    testedIds: suspects.filter((id) => tested.includes(id)),
    activeIds: Array.from(closure([...keepIds, ...part])),
    splits: tested.length < suspects.length
  };
}

// Modules of the list that need the given module, directly or through others.
export function findDependents(moduleId, moduleIds, closure) {
  return moduleIds.filter((id) => id !== moduleId && closure([id]).has(moduleId));
}

function verifyConfiguration(state, culpritId, closure) {
  const dependents = new Set(findDependents(culpritId, state.originalIds, closure));
  const remaining = state.originalIds.filter((id) => id !== culpritId && !dependents.has(id));
  return Array.from(closure([...state.keepIds, ...remaining]));
}

export function createHuntState({ mode, pattern = "", originalIds, keepIds = [], user = null, snapshotId = null, now = Date.now(), id = null }, closure) {
  const keep = Array.from(closure(uniqueIds([...keepIds, MODULE_ID])));
  const keepSet = new Set(keep);
  const suspects = uniqueIds(originalIds).filter((moduleId) => !keepSet.has(moduleId));
  return normalizeHuntState({
    id: id ?? foundry.utils.randomID(),
    mode,
    pattern: mode === HUNT_MODES.ERROR ? String(pattern ?? "").trim() : "",
    startedAt: now,
    userId: user?.id ?? null,
    userName: user?.name ?? "",
    originalIds: uniqueIds(originalIds),
    keepIds: keep,
    suspects,
    testedIds: [],
    activeIds: keep,
    snapshotId,
    phase: HUNT_PHASES.BASELINE,
    step: 1,
    estimate: estimateSteps(suspects.length),
    history: []
  });
}

function nextSearchState(state, suspects, closure) {
  if (!suspects.length) return { ...state, suspects, phase: HUNT_PHASES.DONE, result: HUNT_RESULTS.UNCLEAR, testedIds: [] };
  if (suspects.length === 1) {
    return {
      ...state,
      suspects,
      culpritId: suspects[0],
      testedIds: [],
      activeIds: verifyConfiguration(state, suspects[0], closure),
      phase: HUNT_PHASES.VERIFY
    };
  }
  const plan = planTest(suspects, state.keepIds, closure);
  if (!plan.splits) return { ...state, suspects, phase: HUNT_PHASES.DONE, result: HUNT_RESULTS.UNCLEAR, testedIds: [] };
  return { ...state, suspects, testedIds: plan.testedIds, activeIds: plan.activeIds, phase: HUNT_PHASES.SEARCH };
}

// present: the problem showed up in the current step.
export function advanceHunt(state, present, closure) {
  if (state.phase === HUNT_PHASES.DONE) return state;
  const history = [...state.history, {
    step: state.step,
    phase: state.phase,
    tested: state.phase === HUNT_PHASES.BASELINE ? 0 : state.testedIds.length,
    suspects: state.suspects.length,
    active: state.activeIds.length,
    present: present === true
  }];
  const base = { ...state, history, step: state.step + 1 };

  let next;
  if (state.phase === HUNT_PHASES.BASELINE) {
    next = present
      ? { ...base, phase: HUNT_PHASES.DONE, result: HUNT_RESULTS.NOT_MODULES }
      : nextSearchState(base, state.suspects, closure);
  } else if (state.phase === HUNT_PHASES.SEARCH) {
    const tested = new Set(state.testedIds);
    const suspects = state.suspects.filter((id) => present ? tested.has(id) : !tested.has(id));
    next = nextSearchState(base, suspects, closure);
  } else {
    // Verify ran everything except the culprit: a problem that stays has another cause.
    next = { ...base, phase: HUNT_PHASES.DONE, result: present ? HUNT_RESULTS.UNCLEAR : HUNT_RESULTS.FOUND };
  }
  if (next.phase === HUNT_PHASES.DONE) next = { ...next, step: state.step, activeIds: state.activeIds };
  return normalizeHuntState(next);
}

// ---------------------------------------------------------------------------------------------
// Running the hunt in the world
// ---------------------------------------------------------------------------------------------

function closure(ids) {
  return withRequiredModules(ids);
}

export function readHuntState() {
  return normalizeHuntState(getRegisteredSettingValue(BUG_HUNT_SETTING, null));
}

async function saveHuntState(state) {
  await game.settings.set(MODULE_ID, BUG_HUNT_SETTING, state ?? {});
}

async function switchToStep(state) {
  await saveHuntState(state);
  await writeModuleConfiguration(buildModuleConfiguration(state.activeIds), { reload: "now" });
}

export async function startBugHunt({ mode = HUNT_MODES.MANUAL, pattern = "", keepIds = [] } = {}) {
  if (!canManageModules()) {
    ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
    return null;
  }
  if (readHuntState()) {
    openBugHuntPanel();
    return null;
  }
  if (mode === HUNT_MODES.ERROR && !String(pattern ?? "").trim()) {
    ui.notifications?.warn(localize("SML.Hunt.PatternRequired"));
    return null;
  }

  const originalIds = getCurrentActiveModuleIds();
  const draft = createHuntState({ mode, pattern, originalIds, keepIds, user: game.user }, closure);
  if (!draft.suspects.length) {
    ui.notifications?.warn(localize("SML.Hunt.NothingToSearch"));
    return null;
  }

  const snapshot = await saveAutoSnapshot({ name: localize("SML.Hunt.Title") }, {
    nameKey: "SML.Hunt.SnapshotName",
    descriptionKey: "SML.Hunt.SnapshotDescription"
  });
  const state = { ...draft, snapshotId: snapshot.id };
  await switchToStep(state);
  return state;
}

export async function answerBugHunt(present) {
  const state = readHuntState();
  if (!state || state.phase === HUNT_PHASES.DONE || !canManageModules()) return null;
  const next = advanceHunt(state, present, closure);
  if (next.phase === HUNT_PHASES.DONE) {
    // No restart: the result shows right away, the gamemaster picks how to restore.
    await saveHuntState(next);
    renderBugHuntPanel();
    return next;
  }
  await switchToStep(next);
  return next;
}

// Ends the hunt. "all" restores the modules from before the hunt, "without" leaves out the culprit and the
// modules that need it, "keep" leaves the current modules.
export async function finishBugHunt(choice = "all") {
  const state = readHuntState();
  if (!state) return false;
  if (!canManageModules()) {
    ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
    return false;
  }
  releaseStartupCapture(HUNT_CAPTURE_HOLD);
  if (choice === "keep") {
    await saveHuntState(null);
    closeBugHuntPanel();
    refreshManager();
    return true;
  }

  let ids = state.originalIds;
  if (choice === "without" && state.culpritId) {
    const dependents = new Set(findDependents(state.culpritId, state.originalIds, closure));
    ids = state.originalIds.filter((id) => id !== state.culpritId && !dependents.has(id));
  }
  const configuration = buildModuleConfiguration(closure(ids));
  const name = choice === "without" && state.culpritId
    ? localize("SML.Hunt.RestoreWithoutName", { module: moduleTitle(state.culpritId) })
    : localize("SML.Hunt.RestoreName");
  await saveCheckMarker(buildCheckMarker({ id: state.snapshotId ?? state.id, name }, {
    expectedIds: getEnabledModuleIdsFromConfiguration(configuration),
    snapshotId: null,
    appliedAt: Date.now(),
    user: game.user
  }));
  await saveHuntState(null);
  await writeModuleConfiguration(configuration, { reload: "now" });
  return true;
}

// Called at "init": a running hunt keeps the error capture alive until the step is answered.
export function prepareBugHuntCapture() {
  if (readHuntState()) holdStartupCapture(HUNT_CAPTURE_HOLD);
}

// Only the gamemaster who runs the hunt needs the error capture, every other client lets it go.
export function resumeBugHunt() {
  const state = readHuntState();
  if (!state || !isCheckRunner()) {
    releaseStartupCapture(HUNT_CAPTURE_HOLD);
    return state;
  }
  openBugHuntPanel();
  return state;
}

export function onBugHuntSettingChange() {
  if (!readHuntState()) {
    closeBugHuntPanel();
    refreshManager();
    return;
  }
  renderBugHuntPanel();
  refreshManager();
}

// ---------------------------------------------------------------------------------------------
// Start dialog
// ---------------------------------------------------------------------------------------------

export function renderStartContent({ pattern = "", activeIds = getCurrentActiveModuleIds(), pinnedIds = getPinnedModuleIds() } = {}) {
  const pinned = new Set(pinnedIds);
  const candidates = activeIds.filter((id) => id !== MODULE_ID).sort(compareModuleIdsByTitle);
  const rows = candidates.map((id) => [
    `<label class="sml-checkbox sml-hunt-keep-row">`,
    `<input type="checkbox" name="keep" value="${escapeHtml(id)}"${pinned.has(id) ? " checked" : ""}>`,
    ` <span>${escapeHtml(moduleTitle(id))}</span>`,
    "</label>"
  ].join(""));
  const mode = pattern ? HUNT_MODES.ERROR : HUNT_MODES.MANUAL;
  return [
    `<div class="sml-dialog-body sml-hunt-start">`,
    `<p>${localize("SML.Hunt.Intro", { count: candidates.length, steps: estimateSteps(candidates.length) })}</p>`,
    `<p class="sml-dialog-note"><i class="fa-solid fa-rotate"></i> ${localize("SML.Hunt.ReloadNote")}</p>`,
    `<fieldset><legend>${localize("SML.Hunt.ModeLegend")}</legend>`,
    `<label class="sml-checkbox"><input type="radio" name="mode" value="${HUNT_MODES.ERROR}"${mode === HUNT_MODES.ERROR ? " checked" : ""}> ${localize("SML.Hunt.ModeError")}</label>`,
    `<input type="text" name="pattern" value="${escapeHtml(pattern)}" placeholder="${escapeHtml(localize("SML.Hunt.PatternPlaceholder"))}" maxlength="${MAX_PATTERN_LENGTH}">`,
    `<label class="sml-checkbox"><input type="radio" name="mode" value="${HUNT_MODES.MANUAL}"${mode === HUNT_MODES.MANUAL ? " checked" : ""}> ${localize("SML.Hunt.ModeManual")}</label>`,
    "</fieldset>",
    `<fieldset><legend>${localize("SML.Hunt.KeepLegend")}</legend>`,
    `<p class="sml-dialog-note">${localize("SML.Hunt.KeepHint")}</p>`,
    `<div class="sml-hunt-keep-list">${rows.join("") || `<p>${localize("SML.Hunt.NoModules")}</p>`}</div>`,
    "</fieldset>",
    "</div>"
  ].join("");
}

export function readStartForm(form) {
  const elements = form?.elements;
  const mode = elements?.mode?.value === HUNT_MODES.ERROR ? HUNT_MODES.ERROR : HUNT_MODES.MANUAL;
  const keepIds = Array.from(form?.querySelectorAll?.('input[name="keep"]:checked') ?? []).map((input) => input.value);
  return { mode, pattern: String(elements?.pattern?.value ?? "").trim(), keepIds };
}

export async function openBugHuntStart({ pattern = "" } = {}) {
  if (!canManageModules()) {
    ui.notifications?.error(localize("SML.Notification.ManageModulesRequired"));
    return null;
  }
  if (readHuntState()) {
    openBugHuntPanel();
    return null;
  }
  const options = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("SML.Hunt.Title"), icon: "fa-solid fa-magnifying-glass" },
    classes: ["sml-dialog"],
    position: { width: 520 },
    content: renderStartContent({ pattern }),
    buttons: [
      {
        action: "start",
        label: localize("SML.Hunt.Start"),
        icon: "fa-solid fa-play",
        default: true,
        callback: (_event, button) => readStartForm(button.form)
      },
      { action: "cancel", label: localize("SML.Actions.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ],
    rejectClose: false
  });
  if (!options || typeof options !== "object") return null;
  return startBugHunt(options);
}

// ---------------------------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------------------------

function huntModuleList(ids) {
  return Array.from(ids).sort(compareModuleIdsByTitle).map((id) => moduleTitle(id));
}

export function presentHuntState(state, { errors = startupCapture.entries } = {}) {
  const matches = state.mode === HUNT_MODES.ERROR ? findMatchingErrors(state.pattern, errors) : [];
  const done = state.phase === HUNT_PHASES.DONE;
  const culpritTitle = state.culpritId ? moduleTitle(state.culpritId) : "";
  const culprit = state.culpritId ? game.modules.get(state.culpritId) : null;
  const dependents = state.culpritId ? findDependents(state.culpritId, state.originalIds, closure).map(moduleTitle) : [];
  let stepText = "";
  if (state.phase === HUNT_PHASES.BASELINE) stepText = localize("SML.Hunt.Step.Baseline", { count: state.keepIds.length });
  else if (state.phase === HUNT_PHASES.SEARCH) stepText = localize("SML.Hunt.Step.Search", { tested: state.testedIds.length, suspects: state.suspects.length, active: state.activeIds.length });
  else if (state.phase === HUNT_PHASES.VERIFY) stepText = localize("SML.Hunt.Step.Verify", { module: culpritTitle });

  let resultText = "";
  if (state.result === HUNT_RESULTS.FOUND) resultText = localize("SML.Hunt.Result.Found", { module: culpritTitle });
  else if (state.result === HUNT_RESULTS.NOT_MODULES) resultText = localize("SML.Hunt.Result.NotModules");
  else if (state.result === HUNT_RESULTS.UNCLEAR) resultText = state.culpritId
    ? localize("SML.Hunt.Result.UnclearCandidate", { module: culpritTitle })
    : localize("SML.Hunt.Result.Unclear");

  return {
    done,
    found: state.result === HUNT_RESULTS.FOUND,
    errorMode: state.mode === HUNT_MODES.ERROR,
    pattern: state.pattern,
    seen: matches.length > 0,
    seenText: matches.length
      ? localize("SML.Hunt.ErrorSeen", { count: matches.length })
      : localize("SML.Hunt.ErrorNotSeen"),
    seenDetail: matches[0]?.detail ?? "",
    suggestPresent: state.mode === HUNT_MODES.ERROR && matches.length > 0,
    suggestGone: state.mode === HUNT_MODES.ERROR && matches.length === 0,
    stepLabel: localize("SML.Hunt.StepLabel", { step: state.step, estimate: Math.max(state.estimate, state.step) }),
    stepText,
    resultText,
    culpritTitle,
    culpritVersion: culprit?.version ?? "",
    dependentsText: dependents.length ? localize("SML.Hunt.Dependents", { modules: formatList(dependents) }) : "",
    activeModules: huntModuleList(state.activeIds),
    activeLabel: localize("SML.Hunt.ActiveModules", { count: state.activeIds.length }),
    suspectModules: done ? [] : huntModuleList(state.suspects),
    suspectsLabel: localize("SML.Hunt.Suspects", { count: state.suspects.length }),
    history: state.history.map((entry) => localize(entry.present ? "SML.Hunt.History.Present" : "SML.Hunt.History.Gone", {
      step: entry.step,
      active: entry.active
    })),
    historyLabel: localize("SML.Hunt.HistoryLabel"),
    canAnswer: !done && canManageModules()
  };
}

function huntStrings() {
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

export class SMLBugHuntPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: HUNT_WINDOW_ID,
    classes: ["sml-window", "sml-hunt-window"],
    window: { title: "SML.Hunt.Title", icon: "fa-solid fa-magnifying-glass", resizable: true },
    position: { width: 440, height: "auto" },
    actions: {
      answerPresent: SMLBugHuntPanel.#onAnswerPresent,
      answerGone: SMLBugHuntPanel.#onAnswerGone,
      stopHunt: SMLBugHuntPanel.#onStop,
      restoreAll: SMLBugHuntPanel.#onRestoreAll,
      restoreWithout: SMLBugHuntPanel.#onRestoreWithout,
      keepModules: SMLBugHuntPanel.#onKeep
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/bug-hunt.html` }
  };

  #unsubscribe = null;
  #busy = false;

  get title() {
    return localize("SML.Hunt.Title");
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const state = readHuntState();
    return {
      ...context,
      strings: huntStrings(),
      hunt: state ? presentHuntState(state) : null,
      busy: this.#busy
    };
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    // New errors redraw the status while the step waits for the answer.
    // render() and not "if rendered": while another render runs, rendered is false and the update would be lost.
    this.#unsubscribe = onStartupError(() => this.render());
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    applyManagerTheme(this.element);
  }

  _onClose(options) {
    super._onClose?.(options);
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  async #run(task) {
    if (this.#busy) return;
    this.#busy = true;
    try {
      await this.render();
      await task();
    } catch (error) {
      console.error(`${MODULE_ID} |`, error);
      ui.notifications?.error(localizeHtml("SML.Hunt.Failed", { message: error?.message ?? error }));
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  static async #onAnswerPresent() {
    await this.#run(() => answerBugHunt(true));
  }

  static async #onAnswerGone() {
    await this.#run(() => answerBugHunt(false));
  }

  static async #onStop() {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: localize("SML.Hunt.Title") },
      content: `<p>${localize("SML.Hunt.StopConfirm")}</p>`,
      rejectClose: false
    });
    if (confirmed) await this.#run(() => finishBugHunt("all"));
  }

  static async #onRestoreAll() {
    await this.#run(() => finishBugHunt("all"));
  }

  static async #onRestoreWithout() {
    await this.#run(() => finishBugHunt("without"));
  }

  static async #onKeep() {
    await this.#run(() => finishBugHunt("keep"));
  }
}

function getPanel() {
  return foundry.applications.instances?.get?.(HUNT_WINDOW_ID) ?? null;
}

export function openBugHuntPanel() {
  const panel = getPanel() ?? new SMLBugHuntPanel();
  panel.render({ force: true });
  return panel;
}

export function renderBugHuntPanel() {
  getPanel()?.render();
}

export function closeBugHuntPanel() {
  const panel = getPanel();
  if (panel?.rendered) panel.close();
}
