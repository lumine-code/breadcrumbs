const { CompositeDisposable, Disposable } = require("lumine");
const BreadcrumbsController = require("./breadcrumbs-controller");

module.exports = {
  activate() {
    this.controller = new BreadcrumbsController();
    this.subscriptions = new CompositeDisposable(
      lumine.commands.add("lumine-workspace", {
        "breadcrumbs:toggle": {
          description: "Show or hide breadcrumbs above pane items.",
          didDispatch: () => {
            const enabled = lumine.config.get("breadcrumbs.enabled");
            lumine.config.set("breadcrumbs.enabled", !enabled);
          },
        },
      }),
    );
  },

  deactivate() {
    this.subscriptions?.dispose();
    this.subscriptions = null;
    this.controller?.destroy();
    this.controller = null;
  },

  consumeSymbolRegistry(registry) {
    this.controller?.setRegistry(registry);
    return new Disposable(() => {
      if (this.controller?.registry === registry) this.controller.setRegistry(null);
    });
  },

  consumeTreeViewSelection(treeView) {
    this.controller?.setTreeView(treeView);
    return new Disposable(() => {
      if (this.controller?.treeView === treeView) this.controller.setTreeView(null);
    });
  },
};
