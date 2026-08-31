# breadcrumbs

Show file and symbol paths above each editor.

The bar follows every text editor pane. Project path segments reveal their file or folder in the tree view, while symbol segments jump to their declaration.

## Features

- **File path**: show directories and the active file, keeping the project root when it adds context.
- **Symbol path**: follow nested symbols from the shared symbol registry.
- **Navigation**: reveal path segments in the tree view and jump to symbols.
- **Per-pane state**: every split editor carries its own breadcrumbs.

## Installation

To install `breadcrumbs` search for it in the Install pane of the Lumine settings, or run `lumine --install lumine-code/breadcrumbs`.

Symbol breadcrumbs require the `symbol` package and a compatible symbol provider. The file path remains available without them.

## Commands

Commands available in `lumine-workspace`:

- `breadcrumbs:toggle`: show or hide breadcrumbs.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
