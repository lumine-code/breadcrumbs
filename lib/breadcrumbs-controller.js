const { CompositeDisposable } = require("lumine");
const BreadcrumbsView = require("./breadcrumbs-view");

module.exports = class BreadcrumbsController {
  constructor() {
    this.registry = null;
    this.registryDisposable = null;
    this.treeView = null;
    this.views = new Map();
    this.config = lumine.config.get("breadcrumbs");
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      lumine.config.onDidChange("breadcrumbs", ({ newValue }) => {
        this.config = newValue;
        for (const view of this.views.values()) view.setConfig(newValue);
      }),
      lumine.workspace.getCenter().observePanes((pane) => this.addPane(pane)),
    );
  }

  addPane(pane) {
    if (this.views.has(pane)) return;
    const view = new BreadcrumbsView(pane, {
      config: this.config,
      registry: this.registry,
      treeView: this.treeView,
    });
    const paneElement = pane.getElement();
    const itemViews = paneElement.querySelector(":scope > .item-views");
    paneElement.insertBefore(view.element, itemViews);
    this.views.set(pane, view);
    this.subscriptions.add(
      pane.onDidDestroy(() => {
        view.destroy();
        this.views.delete(pane);
      }),
    );
  }

  setRegistry(registry) {
    this.registryDisposable?.dispose();
    this.registryDisposable = null;
    this.registry = registry;
    for (const view of this.views.values()) view.setRegistry(registry);
    if (!registry) return;

    this.registryDisposable = registry.onDidInvalidateFileSymbols(({ editor }) => {
      for (const view of this.views.values()) {
        if (!editor || view.editor === editor) view.refreshSymbols();
      }
    });
  }

  setTreeView(treeView) {
    this.treeView = treeView;
    for (const view of this.views.values()) view.setTreeView(treeView);
  }

  destroy() {
    this.registryDisposable?.dispose();
    this.registryDisposable = null;
    this.subscriptions.dispose();
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    this.registry = null;
    this.treeView = null;
  }
};
