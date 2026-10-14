# Sephral's Module Loadouts Manual

This manual covers the details. For a quick overview see the [README](README.md).

## Opening the manager

Open the manager from Foundry's settings menu via **Sephral's Module Loadouts** (`Open Loadout Manager`) or with the layers icon in the title bar of the core **Manage Modules** window. Managing loadouts needs the Foundry permission to manage modules. Gamemasters without it see the loadouts read-only, players without it cannot open the manager.

## Features

* Save the current active module configuration as a named profile with description and tags
* Choose a profile scope: `World` or `Installation`
* Compare each saved profile against the current active module state
* Edit the name, description, tags and scope of a stored profile
* Duplicate profiles as a starting point for variants like `Live Game`, `Prep`, `Minimal`, `Debug` or `Performance`
* Apply a saved profile with one click
* Switch back after an apply: the previous module state is saved automatically and the last three snapshots are kept
* Check the result after the restart: modules that are not active, unexpected modules and startup errors are reported, with an undo button
* See which modules a profile would enable, disable or is missing in an expandable list
* Filter profiles by tag or search their names, descriptions and tags
* Enable installed required dependencies automatically
* Warn before applying when dependencies need to be enabled, when profile modules are missing or when a module that would be enabled is only partially verified (modules that already run are not repeated)
* Block applying when required dependencies are missing or unavailable
* Export all saved profiles to JSON and import them again
* Choose the manager design in the module settings (`Signature` or `Foundry Default`)
* Sephral's Module Loadouts always stays active when a profile is applied, so the manager never disables itself

## Working with the manager

Loadout names are unique within a scope, without regard to case. A world loadout and an installation loadout may share a name.

Counters with a value of zero are hidden. Open **Module changes** on a profile to read which modules would be enabled, disabled or are not installed here.

Click a tag above the list to show only the profiles with that tag. Click it again to show all profiles. The search box looks at names, descriptions and tags. Both filters stay in place while the manager is open.

The manager design is a personal setting, so every browser can keep its own look.

## World and installation loadouts

* `World` loadouts belong to the world and only appear there.
* `Installation` loadouts are saved in your browser. They appear in every world you open with this browser, but not on another computer or in another browser. Export them to take them along.
* An export contains all saved loadouts with their scope and can be imported in any world.
* An import replaces a loadout of the same scope with the same id, otherwise one with the same name, and adds the rest. Loadouts without a scope are imported as installation loadouts.

## Undo for Apply

Before a profile is applied, the module saves the current module state as a world profile named `Before apply` with the date and time. These snapshots carry the tag `auto` and an **Auto** marker. Apply one of them to switch back.

Only the last three snapshots are kept. Older ones are removed when a new one is saved. Edit or duplicate a snapshot to keep it for good.

## Check after the restart

After a profile is applied, from the manager or with a macro, the next start of the world checks the result. The check looks for:

* modules of the profile that are not active, for example because they were uninstalled, are not compatible or were switched off again
* active modules that are not part of the profile
* errors that modules of the profile caused while the world started, for example a script file that could not be loaded or an error in their setup
* errors that Foundry itself reports for these modules

If everything is fine, a short notice says so. If there are problems, a window lists them by module. **Undo** in that window applies the `Before apply` snapshot of this switch, so the previous modules are active again after the reload.

The world setting **Check after restart** decides whether a clean result opens the window as well (`Always show the result`) or only shows the notice (`Only show problems`, the default). Problems always open the window.

Good to know:

* Only one gamemaster sees the result, and only one who may manage modules. When several gamemasters are online, a full Gamemaster comes before an Assistant.
* The check runs once. If the world is not started again within one hour after the switch, the check is dropped.
* Errors are matched to a module by the file they come from. Errors from Foundry itself or from the game system are not listed.
* A module that fails before Module Loadouts is loaded only shows up when one of its files could not be loaded at all.

## API for macros

The module API is available at `game.modules.get("sephrals-module-loadouts").api`. Profiles can be named by id or by name. Names ignore case. If a world profile and an installation profile share a name, the world profile is used.

| Function | What it does |
| --- | --- |
| `apply(idOrName, { confirm = true })` | Applies a profile. It asks first unless `confirm` is `false`. Returns `true` when the module setup changed. |
| `saveCurrent(name, { scope, description, tags })` | Saves the active modules. `scope` is `"world"` (default) or `"global"` for an installation profile. A profile with the same name in that scope is replaced. Returns the saved profile. |
| `compare(idOrName)` | Returns `{ toEnable, toDisable, missing }` as lists of module ids. |
| `getProfiles()` | Returns all saved profiles. |
| `openManager()` | Opens the manager window. |

`apply` and `saveCurrent` need the permission to manage modules, just like the manager. Missing or incompatible required dependencies still stop an apply.

Hotbar macro example:

```js
game.modules.get("sephrals-module-loadouts").api.apply("Prep")
```

## Suggested profiles

* Live Game
* Prep
* Minimal
* Debug
* Performance
