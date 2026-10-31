# Sephral’s Module Loadouts Manual

This manual covers the details. For a quick overview see the [README](README.md).

## Opening the manager

Open the manager from Foundry's settings menu via **Sephral’s Module Loadouts** (`Open Loadout Manager`), with the layers icon in the title bar of the core **Manage Modules** window or with `Ctrl + Shift + L`. Managing loadouts needs the Foundry permission to manage modules. Gamemasters without it see the loadouts read-only, players without it cannot open the manager. The gear in the manager's title bar opens the module settings.

## Features

* Save the current active module configuration as a named loadout with description and tags
* Take the world settings of the loadout's modules along, so a new world gets the modules and their configuration in one step
* Choose a scope: `World` or `Installation`
* Installation loadouts are shared by every gamemaster and every browser of the installation
* Compare each loadout with the current state: modules to enable or disable, missing modules, settings that would change, modules updated since the loadout was saved and libraries nothing needs
* Missing modules link to their package page and keep their manifest URL, so they are easy to install
* Pin modules that a loadout never switches on or off
* Apply a loadout after a summary of everything that changes
* Switch back after an apply: the previous modules and settings are saved automatically and the last three snapshots are kept
* Check the result after the restart: modules that are not active, unexpected modules and startup errors are reported, with buttons to undo the switch or to find the cause
* Find the module behind a problem with the bug hunt, which switches off half of the suspects per restart
* Enable installed required dependencies automatically and block an apply when required dependencies are missing or unavailable
* Export all loadouts to JSON and import them again with a preview that asks what to do with each one
* Filter loadouts by tag or search their names, descriptions and tags
* Choose the manager design in the module settings (`Signature` or `Foundry Default`)
* Sephral’s Module Loadouts always stays active when a loadout is applied, so the manager never disables itself

## Working with the manager

Loadout names are unique within a scope, without regard to case. A world loadout and an installation loadout may share a name.

Counters with a value of zero are hidden. Open **Module changes** on a loadout to read which modules would be enabled, disabled or are not installed here, which pinned modules stay as they are, which modules were updated since the loadout was saved, which libraries no module of the loadout needs and which settings would change.

Click a tag above the list to show only the loadouts with that tag. Click it again to show all loadouts. The search box looks at names, descriptions and tags. Both filters stay in place while the manager is open.

The manager design is a personal setting, so every browser can keep its own look.

## World and installation loadouts

* `World` loadouts belong to the world and only appear there.
* `Installation` loadouts appear in every world of the installation, for every gamemaster and in every browser. They are stored in the user data in `modules/sephrals-module-loadouts/storage/installation-loadouts.json`, a folder that module updates keep. On The Forge the file is `sephrals-module-loadouts/installation-loadouts.json` in your Assets Library.
* Up to version 1.0.3 installation loadouts lived in the browser. When a gamemaster opens a world with this version, the loadouts of that browser move into the shared file once. The old browser copy stays untouched.
* If the file cannot be read, the manager says so and installation loadouts stay unchanged until it can be read again. World loadouts keep working.
* Saving an installation loadout needs the Foundry permissions to create folders and upload files, which gamemasters and assistant gamemasters have by default.
* Foundry hands out files of the user data to anyone who knows their address. Loadouts never contain passwords: see **Settings in a loadout**.

## Settings in a loadout

When you save, edit or duplicate a loadout, the **Settings** field decides what comes along:

* **Modules only:** no settings (the default).
* **Modules and their settings:** the world settings of the loadout's modules that appear in Configure Settings.
* **Modules and all their settings, hidden ones too:** also settings that modules keep for themselves, and the stored settings of loadout modules that are not active right now. Hidden settings often hold data of a module, for example indexes or saved states, so only take them along when you know what they do.

Editing a loadout with settings offers to keep them, to save them again from this world or to remove them.

Good to know:

* Only world settings count. Client settings (per browser) and user settings stay as they are.
* Settings that still have their default value are remembered as "default": applying the loadout resets them to the default.
* Settings with very large values (more than about 200,000 characters) are left out, they are data rather than configuration.
* Settings whose name looks like a password, a secret, a webhook, an access token or an API key are never saved. The manager tells you how many it left out. Settings about tokens on the map are not affected.

Applying a loadout lists every setting that would change, with the current and the saved value. Untick **Apply the saved settings too** to switch only the modules. The settings are written first, then the modules switch and Foundry asks to reload. Settings of modules that are not active yet arrive as well: they are in place when the module starts after the reload.

## Pinned modules

**Pinned** in the toolbar opens a list of all installed modules. Applying a loadout leaves the ticked modules as they are: an active one stays active, an inactive one stays off. Use it for modules you want in every setup, or for modules you switch by hand. A module that a loadout module requires is still switched on.

Pinned modules belong to the world. They are also ticked as "modules that stay on" when a bug hunt starts.

## Versions and missing modules

A loadout remembers the title, version and manifest URL of each module when it is saved. The card shows how many modules were updated since then and the details list them with the old and the new version.

Missing modules show their title from the loadout instead of a bare id. The title links to the package page on foundryvtt.com, the link icon copies the manifest URL for **Install Module** in Foundry's setup.

Loadouts saved with version 1.0.3 or older do not know versions yet. Save them again to add them.

## Undo for Apply

Before a loadout is applied, the module saves the current module state as a world loadout named `Before apply` with the date and time. If the switch changes settings, their old values are part of that snapshot. These snapshots carry the tag `auto` and an **Auto** marker. Apply one of them to switch back.

Only the last three snapshots are kept. Older ones are removed when a new one is saved. Edit or duplicate a snapshot to keep it for good.

## Check after the restart

After a loadout is applied, from the manager or with a macro, the next start of the world checks the result. The check looks for:

* modules of the loadout that are not active, for example because they were uninstalled, are not compatible or were switched off again
* active modules that are not part of the loadout
* errors that modules of the loadout caused while the world started, for example a script file that could not be loaded or an error in their setup
* errors that Foundry itself reports for these modules

If everything is fine, a short notice says so. If there are problems, a window lists them by module. **Undo** in that window applies the `Before apply` snapshot of this switch, so the previous modules and settings are back after the reload. **Find the cause** starts a bug hunt for the first error of the list.

The world setting **Check after restart** decides whether a clean result opens the window as well (`Always show the result`) or only shows the notice (`Only show problems`, the default). Problems always open the window.

Good to know:

* Only one gamemaster sees the result, and only one who may manage modules. When several gamemasters are online, a full Gamemaster comes before an Assistant.
* The check runs once. If the world is not started again within one hour after the switch, the check is dropped.
* Errors are matched to a module by the file they come from. Errors from Foundry itself or from the game system are not listed.
* A module that fails before Module Loadouts is loaded only shows up when one of its files could not be loaded at all.

## Usage statistics

The module can take part in a small usage report shared by all of Sephral’s modules. Nothing is counted or sent until the GM agrees: shortly after the world starts, the active GM is asked, and the question comes back at every start until there is an answer. The answer counts for all of Sephral’s modules in the world. *Share usage statistics* in the module settings turns the report on or off at any time, and *Manage statistics* below it shows what the report contains right now.

With the GM’s consent only the active GM’s browser counts, and it sends at most one report a day. The counts are kept in a hidden world setting, so all browsers and computers of the GM count together, and turning the statistics off deletes them. A copy of a world gets its own world ID. The question lists everything the report contains, from the Foundry version to a random world ID. For Module Loadouts it holds:

* on how many of the last 30 days the module was used
* how often loadouts are saved (and whether with settings) and applied, loadouts are exported or imported, pinned modules are saved, a bug hunt starts, an apply is undone in the check after the restart and the self test runs
* the settings *Manager design*, *Language* and *Check after restart* (only the chosen option)
* where errors occur in the module code: file, line and error type, never the error message

No names, chat messages, notes, dice results or other content of the world are sent.

## Bug hunt

The bug hunt finds the module behind a problem. **Bug Hunt** in the toolbar opens it.

1. Choose what the problem is: an error message (paste it or a part of it) or something else that you check yourself.
2. Tick the modules that stay on in every step, for example modules you need to reproduce the problem. They are never suspected. Pinned modules are ticked already.
3. Start. The first step switches off every suspected module and restarts the world. If the problem is still there, no module causes it and the hunt ends.
4. Each further step switches on about half of the remaining suspects and restarts. Answer whether the problem is still there. A module that a tested module requires counts as tested too.
5. When one module is left, a last step runs all your modules except that one. If the problem is gone, the hunt found it.

With an error message the hunt watches the console during the start and while the step waits for your answer. The window shows whether the error appeared and highlights the matching answer. Some errors only appear when you do something, for example open a sheet, so check before you answer.

At the end you choose: **Restore my modules without it** (the modules that need it stay off as well), **Restore all my modules** or **Keep the current modules**. **Stop and restore my modules** ends the hunt at any time. The modules from before the hunt are also saved as an automatic snapshot named `Before bug hunt`.

Good to know:

* Every step reloads the world for everyone who is connected. Hunt alone, or warn your players.
* The number of restarts grows slowly: about 7 for 30 modules, about 9 for 100.
* A hunt survives the reloads and can be continued by any gamemaster who may manage modules. A running hunt shows a banner in the manager.
* If a problem only appears when two modules run together, the hunt names one of them or says that no single module could be found.
* While a hunt runs, console errors pass through Module Loadouts, so the browser console shows its file next to error lines.

## Import and export

**Export** saves all world and installation loadouts in one JSON file, with their saved settings. **Import** reads such a file and shows each loadout with what would happen:

* a new loadout is added
* a loadout with the same id or the same name in its scope can be replaced, kept next to the stored one (the copy gets a number) or skipped

Loadouts without a scope are imported as installation loadouts.

## Self test

**Run self test** in the module settings checks what the manager relies on in Foundry, without changing anything. It covers:

* the module configuration and the reload prompt
* the button in Manage Modules and the hotkey
* a loadout of the active modules, which has to match the active modules
* the storage of world settings and a round trip of the settings of the active modules
* the installation file and your permissions to upload files and to manage modules

The result appears as a notice and as a chat message only you see. Run it after every Foundry update. When Foundry is newer than the version the module was verified with, the gamemaster gets a notice once.

## Debug file

For bug reports, the GM saves one file about all of Sephral’s modules in this world: `Save debug file` in the module settings, or `Save Debug File (Sephral’s Modules)` in the context menu of a chat message. It holds the versions of Foundry, the system and the active modules, the settings of the modules and what they recorded, for Module Loadouts how many loadouts there are and where they are kept, a pending check after the restart and the state of a running bug hunt. The loadouts themselves are left out. Macros call `game.modules.get("sephrals-module-loadouts").api.saveDebugFile()`.

The file contains chat text and whispers. Check it before you share it.

## Sephral’s Modules

The first button in the module settings, *Sephral’s Modules* (GMs only), opens one window for all of Sephral's modules in the world: the version, self test, settings, manual and demo video of each, a button that switches on an installed module that is off (Foundry then reloads the world for everyone), and the debug file. Below, *More from Sephral* lists other modules that fit the game system of the world, shown only after a click, each with its demo video. The list is part of the module. Only a video you start is loaded, from the module page on GitHub.

## API for macros

The module API is available at `game.modules.get("sephrals-module-loadouts").api`. Loadouts can be named by id or by name. Names ignore case. If a world loadout and an installation loadout share a name, the world loadout is used.

| Function | What it does |
| --- | --- |
| `apply(idOrName, { confirm = true, settings = true })` | Applies a loadout. It asks first unless `confirm` is `false`. `settings: false` leaves the saved settings out. Returns `true` when modules or settings changed. |
| `applyWithout(moduleIds, { confirm = true, saveAs })` | Switches off the given modules and the active modules that need them, everything else stays as it is. The given modules are switched off even when they are pinned. `saveAs` names a world loadout of the current modules, saved after the confirmation and right before the switch, so applying it switches back (a loadout with that name is replaced). It asks first unless `confirm` is `false`. Returns `true` when modules changed. Sephral’s Performance Doctor uses it to test the world without the modules that cost time. |
| `saveCurrent(name, { scope, description, tags, settings })` | Saves the active modules. `scope` is `"world"` (default) or `"global"` for an installation loadout. `settings` is `"visible"` or `"all"` to take the settings along. A loadout with the same name in that scope is replaced. Returns the saved loadout. |
| `compare(idOrName)` | Returns `{ toEnable, toDisable, missing, settings }` as lists of module ids and setting keys. |
| `getProfiles()` | Returns all saved loadouts. |
| `getPinned()` | Returns the ids of the pinned modules. |
| `setPinned(ids)` | Pins exactly these modules. Returns the stored ids. |
| `bugHunt({ pattern })` | Opens the bug hunt, with an error text filled in, or the window of the running hunt. |
| `openManager()` | Opens the manager window. |
| `runSelfTest({ report = true })` | Runs the self test. Returns `{ problems, checks }`. `report: false` leaves out the chat message. |
| `saveDebugFile()` | Saves the debug file of Sephral’s modules (GM). See [Debug file](#debug-file). |

`apply`, `applyWithout`, `saveCurrent` and the bug hunt need the permission to manage modules, just like the manager. Missing or incompatible required dependencies still stop an apply.

Hotbar macro example:

```js
game.modules.get("sephrals-module-loadouts").api.apply("Prep")
```

## Suggested loadouts

* Live Game
* Prep
* Minimal
* Debug
* Performance
