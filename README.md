# breadcrumbs

Show file and symbol paths above each pane item.

The bar follows the active item in every non-empty center pane when it exposes a file path. Unsaved text editors can retain a title crumb as an explicit exception, and text editors add symbol segments that jump to their declaration.

## Features

- **Item context**: show a file hierarchy for file-backed items, optionally show titles for pathless items, and control unsaved text editors separately.
- **Symbol path**: follow nested symbols from the shared symbol registry in text editors.
- **Navigation**: reveal path segments in the tree view and jump to symbols.
- **Per-pane state**: every split follows its own active pane item.

## Installation

To install `breadcrumbs` search for it in the Install pane of the Lumine settings, or run `lumine --install lumine-code/breadcrumbs`.

Symbol breadcrumbs require the `symbol` package and a compatible symbol provider. The active item path or enabled title fallback remains available without them.

## Commands

Commands available in `lumine-workspace`:

- `breadcrumbs:toggle`: show or hide breadcrumbs.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
