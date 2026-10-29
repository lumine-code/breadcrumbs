Register document actions beside each pane's breadcrumb path.

| Metadata    | Value                                     |
| ----------- | ----------------------------------------- |
| Version     | `1.0.0`                                   |
| Provided by | `breadcrumbs`                             |
| Consumed by | Packages that contribute document actions |
| Owner       | `breadcrumbs`                             |

## Registration

Declare `breadcrumbs.actions` in `consumedServices`, mapping `^1.0.0` to `consumeBreadcrumbsActions`. Return each registration's `Disposable` from the consumer callback so that losing the service removes the contribution.

## Contract

```ts
interface BreadcrumbsActions {
  addAction(action: Action): Disposable;
}

interface Context {
  item: unknown;
  pane: Pane;
  window: EditorWindow;
  document: Document;
}

interface Action {
  id: string;
  icon: string;
  title: string;
  getState(context: Context): {
    visible?: boolean;
    enabled?: boolean;
    pressed?: boolean;
  };
  didClick(context: Context): void | Promise<void>;
  order?: number;
  onDidChange?(refresh: () => void): Disposable;
}
```

`id`, `icon` and `title` are non-empty strings. IDs must be unique across active registrations. `icon` is a name resolved through the core icon service using the `breadcrumbs-actions` context. Descriptors remain fixed for the registration's lifetime; dispose and register again to change them.

`getState` is synchronous and free of side effects and I/O. Omitted `visible` and `enabled` fields mean `true`; omitting `pressed` produces a normal action button, and a Boolean produces a toggle button with `aria-pressed`. An invalid state or a thrown error hides that action and logs the error without hiding other actions.

`order`, when supplied, is a finite number. Actions are sorted by ascending order, defaulting to zero, then by ID. `onDidChange` registers one refresh listener for the contribution and must return a `Disposable`. Call the listener when the state used by `getState` changes. Item switches and breadcrumb configuration changes also refresh actions.

## Minimal example

```js
consumeBreadcrumbsActions(service) {
  return service.addAction({
    id: "my-package:details",
    icon: "info",
    title: "Document details",
    getState: ({ item }) => ({ visible: this.canShowDetails(item) }),
    didClick: ({ item, pane, window }) => this.showDetails(item, { pane, window }),
  });
}
```

## Behavior

Each pane receives independent native buttons. Context always describes that pane's current item and physical document, including in an inactive split or another workspace window. Actions do not redirect to the globally active item, dispatch another package's commands, or activate the pane automatically. The click handler checks state again before invoking `didClick`; asynchronous handlers retain the captured item context.

Buttons remain fixed at the right edge while breadcrumbs scroll. A visible action can keep the bar visible for a pathless item whose crumbs are hidden. Disabling breadcrumbs hides the whole bar. An empty pane never shows actions. A mouse click preserves the document's focus; Tab enters the toolbar, arrows move between enabled actions, Home and End select its first and last enabled actions, and Enter or Space activates the focused native button.

## Teardown

Disposing the returned registration removes all of its buttons, icon bindings, tooltips and refresh subscriptions. Closing a pane removes its presentation without removing the contribution from other panes. Provider deactivation retires all registrations; retained service objects and registrations become inert and cannot create UI in a later activation. Contributors own the lifetime of any UI they open themselves.

## Versioning

Additive optional fields remain compatible within `1.x`. Removing fields, changing callback context or changing registration ownership requires a new major version.
