const { CompositeDisposable, Disposable } = require("lumine");
module.exports = {
  provideBackgroundTips() {
    return {
      packageName: "breadcrumbs",
      tips: ["Breadcrumbs show the active item path and text-editor symbols above each pane."],
    };
  },

  registry: null,
  treeView: null,

  activate() {
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
      // Breadcrumbs show paths for every pane item with a path, not only text
      // editors. Image editors and other custom pane items do not trigger the
      // text-editor hook, so initialize the controller when the first pane
      // item is used instead.
      lumine.hooks.on("core:pane-item-used", () => this.ensureController()),
    );
  },

  deactivate() {
    this.subscriptions?.dispose();
    this.subscriptions = null;
    this.controller?.destroy();
    this.controller = null;
    this.registry = null;
    this.treeView = null;
  },

  ensureController() {
    if (this.controller) return this.controller;
    const BreadcrumbsController = require("./breadcrumbs-controller");
    this.controller = new BreadcrumbsController();
    this.controller.setRegistry(this.registry);
    this.controller.setTreeView(this.treeView);
    return this.controller;
  },

  consumeSymbolRegistry(registry) {
    this.registry = registry;
    this.controller?.setRegistry(registry);
    return new Disposable(() => {
      if (this.registry === registry) this.registry = null;
      if (this.controller?.registry === registry) this.controller.setRegistry(null);
    });
  },

  consumeTreeViewSelection(treeView) {
    this.treeView = treeView;
    this.controller?.setTreeView(treeView);
    return new Disposable(() => {
      if (this.treeView === treeView) this.treeView = null;
      if (this.controller?.treeView === treeView) this.controller.setTreeView(null);
    });
  },
};
