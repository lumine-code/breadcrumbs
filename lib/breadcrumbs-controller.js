const { CompositeDisposable } = require("lumine");
const BreadcrumbsView = require("./breadcrumbs-view");

module.exports = class BreadcrumbsController {
  constructor() {
    this.destroyed = false;
    this.registryRevision = 0;
    this.registry = null;
    this.registryDisposable = null;
    this.treeView = null;
    this.views = new Map();
    this.paneDisposables = new Map();
    this.config = lumine.config.get("breadcrumbs");
    this.subscriptions = new CompositeDisposable();
    this.subscriptions.add(
      lumine.config.onDidChangeConfiguration((event) => {
        if (this.destroyed || !event.affectsConfiguration("breadcrumbs")) return;
        this.config = lumine.config.get("breadcrumbs");
        for (const view of this.views.values()) view.refreshConfig();
      }),
      lumine.project.onDidChangePaths(() => {
        if (this.destroyed) return;
        for (const view of this.views.values()) view.invalidateFilePath();
      }),
      lumine.workspace.getCenter().observePanes((pane) => this.addPane(pane)),
    );
  }

  addPane(pane) {
    if (this.destroyed || this.views.has(pane)) return;
    const view = new BreadcrumbsView(pane, {
      config: this.config,
      registry: this.registry,
      treeView: this.treeView,
    });
    if (this.destroyed) {
      view.destroy();
      return;
    }
    this.views.set(pane, view);
    const paneDisposable = pane.onDidDestroy(() => {
      if (this.destroyed || this.views.get(pane) !== view) return;
      paneDisposable.dispose();
      this.paneDisposables.delete(pane);
      this.views.delete(pane);
      view.destroy();
    });
    if (this.destroyed || this.views.get(pane) !== view) paneDisposable.dispose();
    else this.paneDisposables.set(pane, paneDisposable);
  }

  setRegistry(registry) {
    if (this.destroyed || registry === this.registry) return;
    const previous = this.registryDisposable;
    const revision = ++this.registryRevision;
    this.registryDisposable = null;
    this.registry = registry;
    previous?.dispose();
    if (this.destroyed || revision !== this.registryRevision) return;
    for (const view of this.views.values()) {
      if (this.destroyed || revision !== this.registryRevision) return;
      view.setRegistry(registry);
    }
    if (!registry || this.destroyed || revision !== this.registryRevision) return;

    const disposable = registry.onDidInvalidateFileSymbols(({ editor }) => {
      if (this.destroyed || revision !== this.registryRevision) return;
      for (const view of this.views.values()) {
        if (!editor || view.editor === editor) view.invalidateSymbols();
      }
    });
    if (this.destroyed || revision !== this.registryRevision) disposable.dispose();
    else this.registryDisposable = disposable;
  }

  setTreeView(treeView) {
    if (this.destroyed || treeView === this.treeView) return;
    this.treeView = treeView;
    for (const view of this.views.values()) {
      if (this.destroyed || this.treeView !== treeView) return;
      view.setTreeView(treeView);
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.registryRevision++;
    const registryDisposable = this.registryDisposable;
    const panes = this.paneDisposables;
    const views = this.views;
    this.registryDisposable = null;
    this.paneDisposables = new Map();
    this.views = new Map();
    this.registry = null;
    this.treeView = null;
    registryDisposable?.dispose();
    this.subscriptions.dispose();
    for (const disposable of panes.values()) disposable.dispose();
    panes.clear();
    for (const view of views.values()) view.destroy();
    views.clear();
  }
};
