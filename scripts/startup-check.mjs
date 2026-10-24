// Check after the restart: applying a profile leaves a hidden marker, the next start compares it with the modules
// that really loaded and reports errors those modules threw during startup. The same error capture feeds the
// bug hunt, which keeps it running while a step waits for the answer.

import {
  CHECK_DISPLAY_MODES,
  CHECK_DISPLAY_SETTING,
  CHECK_MARKER_SETTING,
  MODULE_ID,
  canManageModules,
  ensureModuleTranslationsLoaded,
  escapeHtml,
  formatSnapshotDate,
  getRegisteredSettingValue,
  localize,
  localizeHtml
} from "./core.mjs";
import { renderPreflightSection } from "./render.mjs";
import { findProfileById } from "./store.mjs";

export const CHECK_MARKER_MAX_AGE_MS = 60 * 60 * 1000;
// The marker uses the client clock of the applying user, the check the one of the running GM.
// Those can be a few minutes apart.
const CHECK_CLOCK_TOLERANCE_MS = 10 * 60 * 1000;
// Other modules still run their own "ready" work, so the check waits a moment for late errors.
const CHECK_DELAY_MS = 2000;
export const MAX_STARTUP_ERRORS = 300;
export const MAX_ERRORS_SHOWN_PER_MODULE = 5;
const MAX_ERROR_DETAIL_LENGTH = 300;
const MODULE_PATH_PATTERN = /\/modules\/([^/?#\s"'()]+)\//g;

// Errors are collected from the moment this file loads, before "init". The capture stops at "init" when nothing
// needs it, otherwise once the check has run and no bug hunt holds it.
export const startupCapture = {
  entries: [],
  keys: new Set(),
  seen: new WeakSet(),
  stop: null,
  holds: new Set(),
  listeners: new Set()
};

// ---------------------------------------------------------------------------------------------
// Startup error capture
// ---------------------------------------------------------------------------------------------

// Module ids in the order they appear, read from URLs such as ".../modules/<id>/scripts/main.js".
export function findModuleIdsInText(text) {
  const ids = [];
  for (const match of String(text ?? "").matchAll(MODULE_PATH_PATTERN)) {
    let id = match[1];
    try {
      id = decodeURIComponent(id);
    } catch (_error) {
      // Keep the raw id.
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Wrapper libraries sit in the call path of the modules that use them, libWrapper even wraps Hooks.onError.
// Their frames only count when no other module shows up.
const WRAPPER_LIBRARY_IDS = new Set(["lib-wrapper"]);

// The first module path in the first text that has one wins. For a stack that is the top frame.
// This module's own frames never count: the capture code (console wrapper, listeners, error hook)
// sits in every call site stack, and an error without any other module frame belongs to Foundry,
// the system or the world, not to the loadout.
export function attributeModuleId(texts = []) {
  let wrapperId = null;
  for (const text of texts) {
    const ids = findModuleIdsInText(text).filter((id) => id !== MODULE_ID);
    const moduleId = ids.find((id) => !WRAPPER_LIBRARY_IDS.has(id));
    if (moduleId) return moduleId;
    wrapperId ??= ids[0] ?? null;
  }
  return wrapperId;
}

function isErrorLike(value) {
  return value instanceof Error
    || Boolean(value && typeof value === "object" && typeof value.message === "string" && typeof value.stack === "string");
}

// Stack and message of an error and its causes, the innermost cause first. Foundry wraps errors from hooks
// in a new error whose stack starts at Hooks.onError, the frame of the module that threw is only in the cause.
export function collectErrorTexts(error, depth = 0) {
  if (typeof error === "string") return [error];
  if (!error || typeof error !== "object" || depth > 4) return [];
  const own = [error.stack, error.message, error.fileName].filter((value) => typeof value === "string" && value);
  return [...collectErrorTexts(error.cause, depth + 1), ...own];
}

export function firstLine(value) {
  const line = String(value ?? "").split(/\r?\n/).map((part) => part.trim()).find(Boolean) ?? "";
  return line.length > MAX_ERROR_DETAIL_LENGTH ? `${line.slice(0, MAX_ERROR_DETAIL_LENGTH - 3)}...` : line;
}

// "%c" placeholders take a CSS string each, those arguments are no part of the message.
export function stripConsoleStyles(args = []) {
  const [first, ...rest] = args;
  if (typeof first !== "string" || !first.includes("%c")) return args;
  const styleCount = first.match(/%c/g).length;
  return [first.replace(/%c/g, ""), ...rest.slice(styleCount)];
}

// Drops the frames up to and including the run of this module's capture frames (console wrapper
// and the helpers it calls) from a call site stack, so only the caller's frames remain.
export function stripOwnFrames(stack) {
  const lines = String(stack ?? "").split(/\r?\n/);
  const isOwn = (line) => line.includes(`/modules/${MODULE_ID}/`);
  let lastOwn = lines.findIndex(isOwn);
  if (lastOwn < 0) return lines.join("\n");
  while (lastOwn + 1 < lines.length && isOwn(lines[lastOwn + 1])) lastOwn += 1;
  return lines.slice(lastOwn + 1).join("\n");
}

export function moduleFilePath(url) {
  const match = /\/modules\/([^?#]+)/.exec(String(url ?? ""));
  return match ? `modules/${match[1]}` : String(url ?? "");
}

// Errors without a module frame are kept with moduleId null: the check skips them, the bug hunt can look for them.
export function describeThrown(error, extraTexts = []) {
  const moduleId = attributeModuleId([...collectErrorTexts(error), ...extraTexts]);
  const detail = firstLine(isErrorLike(error) ? error.message : typeof error === "string" ? error : "");
  if (!detail) return null;
  return { moduleId, kind: "error", detail, error: isErrorLike(error) ? error : null };
}

export function describeErrorEvent(event) {
  const target = event?.target;
  const tagName = String(target?.tagName ?? "").toUpperCase();
  // Failed <script> and <link> loads only reach a capturing listener on window.
  if (tagName === "SCRIPT" || tagName === "LINK") {
    const url = target.src || target.href || "";
    const moduleId = attributeModuleId([url]);
    return moduleId ? { moduleId, kind: "load", detail: moduleFilePath(url) } : null;
  }
  // Other elements (images, audio) are no startup errors. Script errors arrive with window as target.
  if (tagName) return null;
  return describeThrown(event?.error ?? event?.message, [event?.filename]);
}

export function describeRejection(event) {
  return describeThrown(event?.reason);
}

export function describeConsoleError(args = [], callStack = "") {
  const values = stripConsoleStyles(Array.from(args));
  const errors = values.filter(isErrorLike);
  const strings = values.filter((value) => typeof value === "string");
  const detail = firstLine(values
    .map((value) => isErrorLike(value) ? value.message : typeof value === "string" ? value : "")
    .filter(Boolean)
    .join(" "));
  const moduleId = attributeModuleId([
    ...errors.flatMap((error) => collectErrorTexts(error)),
    ...strings,
    stripOwnFrames(callStack)
  ]);
  if (!detail) return null;
  return { moduleId, kind: "error", detail, error: errors[0] ?? null };
}

// Script or stylesheet files of modules that answered with an error status. This also covers files
// that failed before this module was loaded.
export function collectFailedModuleLoads(entries = []) {
  return Array.from(entries ?? [])
    .filter((entry) => Number(entry?.responseStatus) >= 400 && /\.(?:m?js|css)(?:[?#]|$)/i.test(String(entry?.name ?? "")))
    .map((entry) => ({ moduleId: attributeModuleId([entry.name]), kind: "load", detail: moduleFilePath(entry.name) }))
    .filter((entry) => entry.moduleId);
}

export function recordStartupError(entry, log = startupCapture) {
  if (!entry?.detail) return false;
  if (entry.error && typeof entry.error === "object") {
    // Foundry logs a hook error and passes the same object to the "error" hook.
    if (log.seen.has(entry.error)) return false;
    log.seen.add(entry.error);
  }
  const moduleId = entry.moduleId ?? null;
  const key = `${moduleId ?? ""}|${entry.kind}|${entry.detail}`;
  if (log.keys.has(key) || log.entries.length >= MAX_STARTUP_ERRORS) return false;
  log.keys.add(key);
  const recorded = { moduleId, kind: entry.kind, detail: entry.detail };
  log.entries.push(recorded);
  for (const listener of log.listeners ?? []) {
    try {
      listener(recorded);
    } catch (_error) {
      // A listener must not break the capture.
    }
  }
  return true;
}

function recordSafely(describe, log) {
  try {
    recordStartupError(describe(), log);
  } catch (_error) {
    // The capture must never break the page or the original console call.
  }
}

export function installStartupErrorCapture({
  target = globalThis.window,
  consoleObject = globalThis.console,
  hooks = globalThis.Hooks,
  log = startupCapture
} = {}) {
  if (log.stop || typeof target?.addEventListener !== "function") return false;

  const onError = (event) => recordSafely(() => describeErrorEvent(event), log);
  const onRejection = (event) => recordSafely(() => describeRejection(event), log);
  target.addEventListener("error", onError, true);
  target.addEventListener("unhandledrejection", onRejection);

  const originalError = consoleObject?.error;
  const wrapper = typeof originalError === "function"
    ? function smlStartupConsoleError(...args) {
      // Taken here, directly in the wrapper, so the caller is the first frame below the own ones.
      const callStack = new Error().stack;
      recordSafely(() => describeConsoleError(args, callStack), log);
      return originalError.apply(this, args);
    }
    : null;
  if (wrapper) consoleObject.error = wrapper;

  const hookId = typeof hooks?.on === "function"
    ? hooks.on("error", (_location, error) => recordSafely(() => describeThrown(error), log))
    : undefined;

  log.stop = () => {
    target.removeEventListener("error", onError, true);
    target.removeEventListener("unhandledrejection", onRejection);
    if (wrapper && consoleObject.error === wrapper) consoleObject.error = originalError;
    if (hookId !== undefined) hooks?.off?.("error", hookId);
    log.stop = null;
  };
  return true;
}

// Ends the capture unless something still holds it (the bug hunt). force ends it anyway.
export function stopStartupErrorCapture(log = startupCapture, { force = false } = {}) {
  if (!force && log.holds?.size) return false;
  log.stop?.();
  return true;
}

export function holdStartupCapture(reason, log = startupCapture) {
  log.holds.add(reason);
}

export function releaseStartupCapture(reason, log = startupCapture) {
  log.holds.delete(reason);
  stopStartupErrorCapture(log);
}

export function onStartupError(listener, log = startupCapture) {
  log.listeners.add(listener);
  return () => log.listeners.delete(listener);
}

// Lower case, single spaces and without the "Uncaught TypeError:" style prefix a console line starts with.
export function normalizeErrorText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^(uncaught( \(in promise\))? )?([a-z]*error: )?/, "")
    .trim();
}

// A pasted console line, a part of the message or the whole message match.
export function matchesErrorText(detail, pattern) {
  const needle = normalizeErrorText(pattern);
  const text = normalizeErrorText(detail);
  if (!needle || !text) return false;
  return text.includes(needle) || (text.length >= 12 && needle.includes(text));
}

export function findMatchingErrors(pattern, entries = startupCapture.entries) {
  return entries.filter((entry) => matchesErrorText(entry.detail, pattern));
}

// ---------------------------------------------------------------------------------------------
// Marker and evaluation
// ---------------------------------------------------------------------------------------------

export function buildCheckMarker(profile, { expectedIds = [], snapshotId = null, appliedAt = Date.now(), user = null } = {}) {
  return {
    profileId: profile.id,
    profileName: profile.name,
    expectedIds: Array.from(expectedIds),
    // Titles for modules that are gone after the restart and cannot be looked up any more.
    titles: Object.fromEntries(Array.from(expectedIds).map((id) => [id, game.modules.get(id)?.title ?? id])),
    snapshotId,
    appliedAt,
    userId: user?.id ?? null,
    userName: user?.name ?? ""
  };
}

export function normalizeCheckMarker(value) {
  if (!value || typeof value !== "object") return null;
  const appliedAt = Number(value.appliedAt);
  const expectedIds = Array.isArray(value.expectedIds)
    ? Array.from(new Set(value.expectedIds.map((id) => String(id ?? "").trim()).filter(Boolean)))
    : [];
  if (!Number.isFinite(appliedAt) || !expectedIds.length) return null;
  return {
    profileId: String(value.profileId ?? ""),
    profileName: String(value.profileName ?? ""),
    expectedIds,
    titles: value.titles && typeof value.titles === "object" ? { ...value.titles } : {},
    snapshotId: value.snapshotId ? String(value.snapshotId) : null,
    appliedAt,
    userId: value.userId ? String(value.userId) : null,
    userName: String(value.userName ?? "")
  };
}

export function isCheckMarkerPending(marker, now = Date.now(), maxAge = CHECK_MARKER_MAX_AGE_MS) {
  if (!marker) return false;
  const age = now - marker.appliedAt;
  return age >= -CHECK_CLOCK_TOLERANCE_MS && age <= maxAge;
}

export function readCheckMarker() {
  return normalizeCheckMarker(getRegisteredSettingValue(CHECK_MARKER_SETTING, null));
}

export async function saveCheckMarker(marker) {
  await game.settings.set(MODULE_ID, CHECK_MARKER_SETTING, marker);
}

export async function clearCheckMarker() {
  try {
    await game.settings.set(MODULE_ID, CHECK_MARKER_SETTING, {});
    return true;
  } catch (error) {
    console.warn(`${MODULE_ID} |`, error);
    return false;
  }
}

export function getCheckDisplayMode() {
  const mode = getRegisteredSettingValue(CHECK_DISPLAY_SETTING, CHECK_DISPLAY_MODES.PROBLEMS);
  return mode === CHECK_DISPLAY_MODES.ALWAYS ? CHECK_DISPLAY_MODES.ALWAYS : CHECK_DISPLAY_MODES.PROBLEMS;
}

// One client runs the check: the active GM among the users who may manage modules.
export function isCheckRunner() {
  const user = game.user;
  if (!user?.isGM || !canManageModules()) return false;
  const designated = game.users?.getDesignatedUser?.((entry) => entry.active && entry.isGM && entry.can("SETTINGS_MODIFY"))
    ?? game.users?.activeGM
    ?? null;
  return designated ? designated === user || designated.id === user.id : false;
}

function groupByModule(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.moduleId)) groups.set(entry.moduleId, []);
    groups.get(entry.moduleId).push(entry.kind === "load" ? localize("SML.Check.LoadFailed", { file: entry.detail }) : entry.detail);
  }
  return Array.from(groups, ([moduleId, details]) => ({ moduleId, details }));
}

export function evaluateStartupCheck(marker, { activeIds = [], installedIds = [], errors = [], packageIssues = {} } = {}) {
  const expected = new Set(marker.expectedIds);
  const active = new Set(activeIds);
  const installed = new Set(installedIds);
  const relevant = new Set([...expected, ...active]);

  const notActive = marker.expectedIds
    .filter((id) => !active.has(id))
    .map((id) => ({ moduleId: id, installed: installed.has(id) }));
  const unexpected = Array.from(active).filter((id) => !expected.has(id));
  const startupErrors = groupByModule(errors.filter((entry) => entry.moduleId && relevant.has(entry.moduleId)));
  const foundryErrors = groupByModule(Object.entries(packageIssues ?? {})
    .filter(([id]) => relevant.has(id))
    .flatMap(([moduleId, issue]) => (Array.isArray(issue?.error) ? issue.error : [])
      .map((message) => ({ moduleId, detail: firstLine(message) }))
      .filter((entry) => entry.detail)));

  return {
    expectedCount: expected.size,
    notActive,
    unexpected,
    startupErrors,
    foundryErrors,
    ok: !notActive.length && !unexpected.length && !startupErrors.length && !foundryErrors.length
  };
}

function checkModuleTitle(moduleId, marker) {
  return game.modules.get(moduleId)?.title ?? marker?.titles?.[moduleId] ?? moduleId;
}

function formatCheckDate(timestamp) {
  return formatSnapshotDate(new Date(timestamp));
}

function renderCheckErrorSection(label, groups, marker) {
  if (!groups.length) return "";
  const items = groups.map(({ moduleId, details }) => {
    const shown = details.slice(0, MAX_ERRORS_SHOWN_PER_MODULE).map((detail) => `<li>${escapeHtml(detail)}</li>`);
    const hidden = details.length - MAX_ERRORS_SHOWN_PER_MODULE;
    if (hidden > 0) shown.push(`<li>${escapeHtml(localize("SML.Check.MoreErrors", { count: hidden }))}</li>`);
    return `<li><strong>${escapeHtml(checkModuleTitle(moduleId, marker))}</strong><ul>${shown.join("")}</ul></li>`;
  });
  return `<section><p><strong>${label}</strong></p><ul>${items.join("")}</ul></section>`;
}

export function renderStartupCheckContent(marker, result, { canUndo = false, snapshotMissing = false, canHunt = false } = {}) {
  const name = escapeHtml(marker.profileName);
  const parts = [
    `<p>${localize(result.ok ? "SML.Check.AllGood" : "SML.Check.Problems", { name, count: result.expectedCount })}</p>`,
    `<p class="sml-check-meta">${localize("SML.Check.AppliedBy", { user: escapeHtml(marker.userName || "-"), date: escapeHtml(formatCheckDate(marker.appliedAt)) })}</p>`
  ];

  parts.push(renderPreflightSection(localize("SML.Check.NotActive"), result.notActive.map(({ moduleId, installed }) =>
    `${checkModuleTitle(moduleId, marker)} (${localize(installed ? "SML.Check.ReasonDisabled" : "SML.Check.ReasonMissing")})`)));
  parts.push(renderPreflightSection(localize("SML.Check.Unexpected"), result.unexpected.map((id) => checkModuleTitle(id, marker))));
  parts.push(renderCheckErrorSection(localize("SML.Check.Errors"), result.startupErrors, marker));
  parts.push(renderCheckErrorSection(localize("SML.Check.FoundryIssues"), result.foundryErrors, marker));

  if (canUndo) parts.push(`<p class="sml-check-meta">${localize("SML.Check.UndoHint")}</p>`);
  else if (snapshotMissing) parts.push(`<p class="sml-check-meta">${localize("SML.Check.UndoMissing")}</p>`);
  if (canHunt) parts.push(`<p class="sml-check-meta">${localize("SML.Check.HuntHint")}</p>`);
  return `<div class="sml-check">${parts.filter(Boolean).join("")}</div>`;
}

// The text the bug hunt looks for. Foundry's wrapper around hook errors is the same for every module, so it goes.
const HOOK_ERROR_PREFIX = /^Error thrown in hooked function '[^']*' for hook '[^']*'\.\s*/;

export function firstErrorText(result) {
  const text = result.startupErrors[0]?.details?.[0] ?? result.foundryErrors[0]?.details?.[0] ?? "";
  return text.replace(HOOK_ERROR_PREFIX, "") || text;
}

// undo(snapshot) applies the snapshot, hunt(errorText) opens the bug hunt. Both come from the entry file.
export async function showStartupCheckDialog(marker, result, { undo = null, hunt = null } = {}) {
  const snapshot = marker.snapshotId ? findProfileById(marker.snapshotId) : null;
  const canUndo = Boolean(snapshot) && canManageModules() && typeof undo === "function";
  const errorText = firstErrorText(result);
  const canHunt = Boolean(errorText) && canManageModules() && typeof hunt === "function";
  const buttons = [{ action: "ok", label: localize("SML.Check.Ok"), icon: "fa-solid fa-check", default: true }];
  if (canUndo) buttons.push({ action: "undo", label: localize("SML.Check.Undo"), icon: "fa-solid fa-rotate-left" });
  if (canHunt) buttons.push({ action: "hunt", label: localize("SML.Check.Hunt"), icon: "fa-solid fa-magnifying-glass" });

  const choice = await foundry.applications.api.DialogV2.wait({
    window: { title: localize("SML.Check.Title", { name: marker.profileName }), icon: "fa-solid fa-layer-group" },
    classes: ["sml-check-dialog"],
    position: { width: 520 },
    content: renderStartupCheckContent(marker, result, { canUndo, snapshotMissing: !snapshot, canHunt }),
    buttons,
    rejectClose: false
  });
  if (choice === "hunt") {
    await hunt(errorText);
    return false;
  }
  if (choice !== "undo") return false;

  // Looked up again, the snapshot could have been deleted while the dialog was open.
  const current = findProfileById(marker.snapshotId);
  if (!current) {
    ui.notifications?.warn(localize("SML.Check.UndoMissing"));
    return false;
  }
  return undo(current);
}

function getActiveModuleIds() {
  return Array.from(game.modules?.values?.() ?? []).filter((module) => module?.active).map((module) => module.id);
}

export async function runStartupCheck({ delay = CHECK_DELAY_MS, undo = null, hunt = null } = {}) {
  try {
    const marker = readCheckMarker();
    if (!marker || !isCheckRunner()) return null;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

    // Another GM client may have taken the marker while this one waited.
    const current = readCheckMarker();
    if (!current || current.appliedAt !== marker.appliedAt || !isCheckRunner()) return null;
    if (!(await clearCheckMarker())) return null;
    // Client clock on purpose: game.time.serverTime is no epoch time in v13.
    if (!isCheckMarkerPending(current, Date.now())) return null;

    for (const entry of collectFailedModuleLoads(globalThis.performance?.getEntriesByType?.("resource"))) {
      recordStartupError(entry);
    }
    const result = evaluateStartupCheck(current, {
      activeIds: getActiveModuleIds(),
      installedIds: Array.from(game.modules?.keys?.() ?? []),
      errors: startupCapture.entries,
      packageIssues: game.issues?.packageCompatibilityIssues ?? {}
    });

    await ensureModuleTranslationsLoaded();
    if (result.ok && getCheckDisplayMode() !== CHECK_DISPLAY_MODES.ALWAYS) {
      ui.notifications?.info(localizeHtml("SML.Check.AllGood", { name: current.profileName, count: result.expectedCount }));
    } else {
      // Not awaited: the capture ends now, the dialog may stay open as long as the GM likes.
      showStartupCheckDialog(current, result, { undo, hunt }).catch((error) => console.warn(`${MODULE_ID} |`, error));
    }
    return result;
  } catch (error) {
    console.warn(`${MODULE_ID} |`, error);
    return null;
  } finally {
    stopStartupErrorCapture();
  }
}

installStartupErrorCapture();
