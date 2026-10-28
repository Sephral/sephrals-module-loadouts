// Module Loadouts in the shared debug file of Sephral's modules: how many loadouts there are and where they live, a
// pending start check and a running bug hunt. The loadouts themselves stay out, they can hold module settings.

import { GLOBAL_PROFILES_SETTING, MODULE_ID, PROFILE_SCOPES, WORLD_PROFILES_SETTING, localize } from "./core.mjs";
import { readHuntState } from "./bug-hunt.mjs";
import { registerDebugMenu, registerDebugProvider } from "./debug-file.mjs";
import { readCheckMarker } from "./startup-check.mjs";
import * as store from "./store.mjs";

function attempt(fn) {
  try {
    return fn();
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

function countLoadouts(profiles) {
  return {
    total: profiles.length,
    auto: profiles.filter((profile) => profile.auto).length,
    withSettings: profiles.filter((profile) => profile.settings).length
  };
}

export function describeState() {
  const marker = attempt(readCheckMarker);
  const hunt = attempt(readHuntState);
  return {
    loadouts: {
      world: attempt(() => countLoadouts(store.getProfilesForScope(PROFILE_SCOPES.WORLD).profiles)),
      installation: attempt(() => countLoadouts(store.getProfilesForScope(PROFILE_SCOPES.GLOBAL).profiles)),
      installationFile: attempt(() => store.isInstallationStoreAvailable()),
      forge: attempt(() => store.isUsingTheForge())
    },
    pinnedModules: attempt(() => store.getPinnedModuleIds().length),
    activeModules: Array.from(game.modules ?? []).filter((module) => module?.active).length,
    pendingCheck: marker && !marker.error
      ? { profileName: marker.profileName, appliedAt: marker.appliedAt, expectedModules: marker.expectedIds.length, snapshot: Boolean(marker.snapshotId) }
      : marker,
    bugHunt: hunt && !hunt.error
      ? { mode: hunt.mode, phase: hunt.phase, result: hunt.result, step: hunt.step, estimate: hunt.estimate, suspects: hunt.suspects.length, tested: hunt.testedIds.length, culpritId: hunt.culpritId }
      : hunt
  };
}

// Call in "init": the menu button and the part of the debug file.
export function registerDebug() {
  registerDebugMenu(MODULE_ID, { name: localize("SML.Debug.Title"), label: localize("SML.Debug.Save"), hint: localize("SML.Debug.Hint") });
  registerDebugProvider({
    moduleId: MODULE_ID,
    label: () => localize("SML.Debug.Entry"),
    notice: (file) => localize("SML.Debug.Saved", { file }),
    recent: () => ({ details: describeState() }),
    omitSettings: [WORLD_PROFILES_SETTING, GLOBAL_PROFILES_SETTING]
  });
}
