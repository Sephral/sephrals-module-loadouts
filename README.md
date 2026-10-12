# Sephral's Module Loadouts

Sephral's Module Loadouts is a Foundry VTT utility module for saving, comparing, applying, exporting, and importing module activation profiles for a single world or for your wider installation.

## Foundry VTT

[![Foundry VTT package](https://img.shields.io/badge/Foundry%20VTT-Package%20page-fe6a1f?logo=foundryvirtualtabletop&logoColor=white)](https://foundryvtt.com/packages/sephrals-module-loadouts)

Install the module from the package browser in Foundry VTT or open its [package page on foundryvtt.com](https://foundryvtt.com/packages/sephrals-module-loadouts).

## Discord

[![Join Discord](https://img.shields.io/badge/Discord-Join%20the%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/7BjCgDYaBP)

Questions, feedback, and module support are welcome on [Discord](https://discord.gg/7BjCgDYaBP).

## More modules

[![More modules by Sephral](https://img.shields.io/badge/GitHub-More%20modules%20by%20Sephral-181717?logo=github&logoColor=white)](https://github.com/Sephral)

More modules by Sephral for Foundry VTT are listed on [github.com/Sephral](https://github.com/Sephral).

## Demo

![SCBR demo](media/demo.gif)

If the embedded preview is not available in your GitHub view, please check the media folder.

## Current Features

- Save the current active module configuration as a named profile
- Choose a profile scope: `World` or `Installation`
- Reuse installation-scoped loadouts in other worlds on the same Foundry client installation
- Compare each saved profile against the current active module state
- Edit stored profile name, description, tags, and scope
- Duplicate profiles as a starting point for variants like `Live Game`, `Prep`, `Minimal`, `Debug`, or `Performance`
- Apply a saved profile with one click
- Switch back after an apply: the previous module state is saved automatically and the last three snapshots are kept
- See which modules a profile would enable, disable, or is missing in an expandable list
- Filter profiles by tag or search their names, descriptions, and tags
- Apply, save, and compare profiles from macros through the module API
- Auto-enable installed required module dependencies
- Warn before applying when dependencies need auto-enabling, when profile modules are missing, or when compatibility is only partially verified
- Block applying when required dependencies are missing or unavailable
- Export all saved profiles to JSON
- Import saved profiles from JSON
- Choose the manager design in the module settings (`Signature` or `Foundry Default`)
- Open the manager from Foundry settings or directly from the `Manage Modules` dialog
- Keep Sephral's Module Loadouts active when applying a profile so the manager never disables itself

## Storage Model

- `World` loadouts are stored in a world setting and only appear in that world
- `Installation` loadouts are stored in a client setting and can be reused in other worlds from the same Foundry installation/browser profile
- Exported JSON contains module metadata, export timestamp, world identifier, and all saved profiles including their scopes

## Usage

Open the manager from Foundry's settings menu via **Sephral's Module Loadouts** or from the core **Manage Modules** dialog.

The manager design is configured in the module settings. The setting is client-scoped, so each Foundry installation or browser profile can keep its own preferred look.

Counters with a value of zero are hidden. Open **Module changes** on a profile to read which modules would be enabled, disabled, or are not installed here.

Click a tag above the list to show only the profiles with that tag. Click it again to show all profiles. The search box looks at names, descriptions, and tags. Both filters stay in place while the manager is open.

## Undo for Apply

Before a profile is applied, the module saves the current module state as a world profile named `Before apply` with the date and time. These snapshots carry the tag `auto` and an **Auto** marker. Apply one of them to switch back.

Only the last three snapshots are kept. Older ones are removed when a new one is saved. Edit or duplicate a snapshot to keep it for good.

## API for Macros

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

Suggested profiles:

- Live Game
- Prep
- Minimal
- Debug
- Performance
