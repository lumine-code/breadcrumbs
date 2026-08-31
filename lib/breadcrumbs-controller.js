const { CompositeDisposable } = require("lumine");
const BreadcrumbsView = require("./breadcrumbs-view");

module.exports = class BreadcrumbsController {
  constructor() {
    this.registry = null;
    this.registryDisposable = null;
    this.treeView = null;
    this.views = new Map();
    this.paneDisposables = new Map();
    this.config = lumine.config.get("breadcrumbs");
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      lumine.config.onDidChangeConfiguration((event) => {
        if (!event.affectsConfiguration("breadcrumbs")) return;
        this.config = lumine.config.get("breadcrumbs");
        for (const view of this.views.values()) view.refreshConfig();
      }),
      lumine.project.onDidChangePaths(() => {
        for (const view of this.views.values()) view.invalidateFilePath();
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
    this.views.set(pane, view);
    const paneDisposable = pane.onDidDestroy(() => {
      paneDisposable.dispose();
      this.paneDisposables.delete(pane);
      view.destroy();
      this.views.delete(pane);
    });
    this.paneDisposables.set(pane, paneDisposable);
  }

  setRegistry(registry) {
    this.registryDisposable?.dispose();
    this.registryDisposable = null;
    this.registry = registry;
    for (const view of this.views.values()) view.setRegistry(registry);
    if (!registry) return;

    this.registryDisposable = registry.onDidInvalidateFileSymbols(({ editor }) => {
      for (const view of this.views.values()) {
        if (!editor || view.editor === editor) view.invalidateSymbols();
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
    for (const disposable of this.paneDisposables.values()) disposable.dispose();
    this.paneDisposables.clear();
    for (const view of this.views.values()) view.destroy();
    this.views.clear();
    this.registry = null;
    this.treeView = null;
  }
};
