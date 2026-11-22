# breadcrumbs

Show file and symbol paths above each pane item.

The bar follows the active item in every non-empty center pane when it exposes a file path. Unsaved text editors can retain a title crumb as an explicit exception, and text editors add symbol segments that jump to their declaration.

## Features

- **Item context**: show a file hierarchy for file-backed items, optionally show titles for pathless items, and control unsaved text editors separately.
- **Symbol path**: follow nested symbols from the shared symbol registry in text editors.
- **Navigation**: reveal path segments in the tree view and jump to symbols.
- **Per-pane state**: every split follows its own active pane item.

![Follow the file path and enclosing symbols while editing.](.github/demo.png)

## Installation

To install `breadcrumbs` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/breadcrumbs`.

Symbol breadcrumbs require the `symbol` package and a compatible symbol provider. The active item path or enabled title fallback remains available without them.

Selecting a document symbol source in `symbol` also updates breadcrumbs and the outline. A file choice affects that editor, and a grammar preference applies to editors without a file choice. Auto restores the hub's normal source preference and fallback. File crumbs remain available while the selected source is loading or unavailable.

Breadcrumbs reuse an available symbol tree. When the selected provider has a local path query, Breadcrumbs can fetch the enclosing symbols around the cursor and refresh them as the cursor moves.

## Commands

Commands available in `lumine-workspace`:

- `breadcrumbs:toggle`: show or hide breadcrumbs.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
