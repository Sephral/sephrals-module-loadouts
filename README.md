# Sephral's Module Loadouts

Sephral's Module Loadouts is a Foundry VTT utility module for saving, comparing, applying, exporting, and importing module activation profiles for a single world or for your wider installation.

## Current Features

- Save the current active module configuration as a named profile
- Choose a profile scope: `World` or `Installation`
- Reuse installation-scoped loadouts in other worlds on the same Foundry client installation
- Compare each saved profile against the current active module state
- Edit stored profile name, description, tags, and scope
- Duplicate profiles as a starting point for variants like `Live Game`, `Prep`, `Minimal`, `Debug`, or `Performance`
- Apply a saved profile with one click
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

Suggested profiles:

- Live Game
- Prep
- Minimal
- Debug
- Performance
