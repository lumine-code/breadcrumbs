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
    const owner = { services: { registry: [], treeView: [] }, creating: false };
    const subscriptions = new CompositeDisposable();
    this.owner = owner;
    this.subscriptions = subscriptions;
    const retain = (resource) => {
      if (this.owner === owner) subscriptions.add(resource);
      else resource.dispose();
    };
    retain(
      lumine.commands.add("lumine-workspace", {
        "breadcrumbs:toggle": {
          description: "Show or hide breadcrumbs above pane items.",
          didDispatch: () => {
            if (this.owner !== owner) return;
            const enabled = lumine.config.get("breadcrumbs.enabled");
            lumine.config.set("breadcrumbs.enabled", !enabled);
          },
        },
      }),
    );
    // Breadcrumbs show paths for every pane item with a path, not only text
    // editors. Image editors and other custom pane items do not trigger the
    // text-editor hook, so initialize the controller when the first pane
    // item is used instead.
    if (this.owner === owner) {
      retain(
        lumine.hooks.on("core:pane-item-used", () => {
          if (this.owner === owner) this.ensureController();
        }),
      );
    }
  },

  deactivate() {
    const subscriptions = this.subscriptions;
    const controller = this.controller;
    const owner = this.owner;
    this.owner = null;
    this.subscriptions = null;
    this.controller = null;
    this.registry = null;
    this.treeView = null;
    if (owner) {
      for (const edges of Object.values(owner.services)) {
        for (const edge of edges) edge.value = null;
        edges.length = 0;
      }
    }
    subscriptions?.dispose();
    controller?.destroy();
  },

  ensureController() {
    if (this.controller) return this.controller;
    const owner = this.owner;
    if (!owner || owner.creating) return null;
    const BreadcrumbsController = require("./breadcrumbs-controller");
    owner.creating = true;
    let controller;
    try {
      controller = new BreadcrumbsController();
      if (this.owner !== owner) {
        controller.destroy();
        return null;
      }
      this.controller = controller;
      controller.setRegistry(this.registry);
      if (this.owner !== owner || this.controller !== controller) return null;
      controller.setTreeView(this.treeView);
      return this.owner === owner && this.controller === controller ? controller : null;
    } finally {
      owner.creating = false;
    }
  },

  consumeSymbolRegistry(registry) {
    return this.consumeService("registry", "setRegistry", registry);
  },

  consumeTreeViewSelection(treeView) {
    return this.consumeService("treeView", "setTreeView", treeView);
  },

  consumeService(field, method, value) {
    const owner = this.owner;
    if (!owner) return new Disposable();
    const edges = owner.services[field];
    const edge = { value };
    edges.push(edge);
    this[field] = value;
    this.controller?.[method](value);
    return new Disposable(() => {
      edge.value = null;
      if (this.owner !== owner) return;
      const index = edges.indexOf(edge);
      if (index === -1) return;
      edges.splice(index, 1);
      const current = edges.at(-1)?.value ?? null;
      this[field] = current;
      this.controller?.[method](current);
    });
  },
};
