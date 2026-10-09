const fs = require("node:fs/promises"),
  os = require("node:os"),
  path = require("node:path");
const { Emitter, Disposable, Point, Range } = require("lumine");

describe("Breadcrumbs runtime ownership", () => {
  let main, editor, directory, hub, consumers, providers, cleanups;
  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openPath", "openExternal", "openApplication", "showItemInFolder"])
      spyOn(lumine.shell, method).and.resolveTo();
    spyOn(lumine.application, "openWindow").and.resolveTo();
    jasmine.attachToDOM(lumine.workspace.getElement());
    consumers = [];
    providers = [];
    cleanups = [];
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "breadcrumbs-owned-"));
    await fs.writeFile(path.join(directory, "document.txt"), "owned\n");
    lumine.project.setPaths([directory]);
    main = (await lumine.packages.activatePackage("breadcrumbs")).mainModule;
    editor = await lumine.workspace.open(path.join(directory, "document.txt"));
    main.ensureController();
    hub = new lumine.packages.serviceHub.constructor();
  });
  afterEach(async () => {
    cleanups.forEach((cleanup) => cleanup());
    consumers.forEach((consumer) => consumer.dispose());
    providers.forEach((provider) => provider.dispose());
    await lumine.packages.deactivatePackage("breadcrumbs");
    for (const item of lumine.workspace.getTextEditors()) item.destroy();
    lumine.project.setPaths([]);
    await lumine.fileWatchClient.settlePendingTeardown();
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(os.tmpdir()) ||
      !path.basename(target).startsWith("breadcrumbs-owned-")
    ) {
      throw new Error("Unsafe breadcrumb fixture cleanup");
    }
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const view = () => main.controller.views.get(lumine.workspace.paneForItem(editor));
  function consume(name, version, method) {
    consumers.push(hub.consume(name, version, (value) => main[method](value)));
  }
  function provide(name, version, value) {
    const provider = hub.provide(name, version, value);
    providers.push(provider);
    return provider;
  }
  function registry(
    tree = [
      {
        name: "Owned symbol",
        providerName: "Owned provider",
        providerId: "owned-source",
        position: new Point(0, 0),
        range: new Range([0, 0], [1, 0]),
        children: [],
      },
    ],
  ) {
    const emitter = new Emitter();
    cleanups.push(() => emitter.dispose());
    return {
      peekFileSymbolTree: () => tree,
      getFileSymbolTree: async () => tree,
      onDidInvalidateFileSymbols: (callback) => emitter.on("invalidate", callback),
    };
  }

  it("keeps shared symbol registry ownership until the final actual Hub edge ends", async () => {
    consume("symbol.registry", "^1.1.0", "consumeSymbolRegistry");
    const value = registry();
    const first = provide("symbol.registry", "1.1.0", value),
      second = provide("symbol.registry", "1.1.0", value);
    await view().refreshSymbols();
    first.dispose();
    expect(main.registry).toBe(value);
    expect(view().registry).toBe(value);
    expect(view().element.querySelector(".breadcrumbs-symbol").textContent).toContain(
      "Owned symbol",
    );
    second.dispose();
    expect(main.registry).not.toBe(value);
  });

  it("keeps a shared tree selector and its real clickable file crumb", async () => {
    consume("tree-view.selection", "^1.0.0", "consumeTreeViewSelection");
    const value = { revealPath: jasmine.createSpy("reveal owned path").and.resolveTo() };
    const first = provide("tree-view.selection", "1.0.0", value),
      second = provide("tree-view.selection", "1.0.0", value);
    first.dispose();
    expect(main.treeView).toBe(value);
    const crumb = view().element.querySelector(".breadcrumbs-path");
    expect(crumb.tagName).toBe("BUTTON");
    crumb.click();
    await Promise.resolve();
    expect(value.revealPath).toHaveBeenCalledOnceWith(path.join(directory, "document.txt"), {
      show: true,
    });
    second.dispose();
  });

  it("does not add a pane view from a copied retired controller callback", () => {
    main.controller.destroy();
    main.controller = null;
    const center = lumine.workspace.getCenter();
    let armed = false;
    const earlier = center.observePanes(() => {
      if (armed) main.deactivate();
    });
    cleanups.push(() => earlier.dispose());
    const controller = main.ensureController();
    armed = true;
    const pane = lumine.workspace.getActivePane().splitRight({ copyActiveItem: false });
    expect(controller.views.has(pane)).toBe(false);
    cleanups.push(() => controller.destroy());
  });

  it("does not reattach a destroyed view from copied pane active-item callbacks", () => {
    const pane = lumine.workspace.paneForItem(editor);
    const old = main.controller.views.get(pane);
    old.destroy();
    main.controller.views.delete(pane);
    const earlier = pane.onDidChangeActiveItem(() => main.deactivate());
    cleanups.push(() => earlier.dispose());
    main.controller.addPane(pane);
    const current = main.controller.views.get(pane);
    const item = {
      element: document.createElement("div"),
      getTitle: () => "Owned surface",
      getPath: () => path.join(directory, "document.txt"),
    };
    let error;
    try {
      pane.activateItem(item);
    } catch (value) {
      error = value;
    }
    expect(error).toBeUndefined();
    expect(current.element.isConnected).toBe(false);
    cleanups.push(() => pane.destroyItem(item));
  });

  it("retires a lazy controller created while an actual icon allocation disables the package", async () => {
    await lumine.packages.deactivatePackage("breadcrumbs");
    main = (await lumine.packages.activatePackage("breadcrumbs")).mainModule;
    main.controller?.destroy();
    main.controller = null;
    const apply = lumine.icons.applyTo.bind(lumine.icons);
    let first = true;
    spyOn(lumine.icons, "applyTo").and.callFake((...args) => {
      const resource = apply(...args);
      if (first) {
        first = false;
        main.deactivate();
      }
      return resource;
    });
    const controller = main.ensureController();
    cleanups.push(() => controller?.destroy());
    expect(main.controller).toBeNull();
    expect(lumine.workspace.getElement().querySelectorAll(".breadcrumbs").length).toBe(0);
  });

  it("disposes the request-owned buffer listener when its symbol source is retired", () => {
    const current = view();
    const held = new Promise(() => {});
    const value = registry(null);
    value.getFileSymbolTree = () => held;
    const subscribe = editor.getBuffer().onDidChangeText.bind(editor.getBuffer());
    const disposals = [];
    spyOn(editor.getBuffer(), "onDidChangeText").and.callFake((...args) => {
      const subscription = subscribe(...args);
      const dispose = jasmine
        .createSpy("dispose request listener")
        .and.callFake(() => subscription.dispose());
      disposals.push(dispose);
      cleanups.push(() => subscription.dispose());
      return new Disposable(dispose);
    });
    current.setRegistry(value);
    expect(disposals.length).toBe(1);
    current.destroy();
    expect(disposals[0]).toHaveBeenCalledTimes(1);
  });

  it("renders the innermost crumb from a valid deeply nested symbol tree", () => {
    lumine.config.set("breadcrumbs.symbolPath", "last");
    editor.setText("x".repeat(12002));
    editor.setCursorBufferPosition([0, 6000]);
    const node = (name, depth) => ({
      name,
      providerName: "Owned provider",
      providerId: "owned-source",
      position: new Point(0, depth),
      range: new Range([0, depth], [0, 12001 - depth]),
      children: [],
    });
    const tree = [node("Root", 0)];
    let parent = tree[0];
    for (let index = 0; index < 6000; index++) {
      const child = node(`Nested ${index}`, index + 1);
      parent.children.push(child);
      parent = child;
    }
    const current = view();
    current.setRegistry(registry(tree));
    expect(current.element.querySelector(".breadcrumbs-symbol").textContent).toContain(
      "Nested 5999",
    );
  });

  it("follows the newest surviving A-B-A registry and tree selector edges", async () => {
    consume("symbol.registry", "^1.1.0", "consumeSymbolRegistry");
    consume("tree-view.selection", "^1.0.0", "consumeTreeViewSelection");
    const symbolA = registry(),
      symbolB = registry([]);
    const treeA = { revealPath: jasmine.createSpy("tree A") };
    const treeB = { revealPath: jasmine.createSpy("tree B") };
    const first = [
      provide("symbol.registry", "1.1.0", symbolA),
      provide("tree-view.selection", "1.0.0", treeA),
    ];
    const middle = [
      provide("symbol.registry", "1.1.0", symbolB),
      provide("tree-view.selection", "1.0.0", treeB),
    ];
    const last = [
      provide("symbol.registry", "1.1.0", symbolA),
      provide("tree-view.selection", "1.0.0", treeA),
    ];
    await view().refreshSymbols();
    expect(main.registry).toBe(symbolA);
    expect(main.treeView).toBe(treeA);
    last.forEach((edge) => edge.dispose());
    expect(main.registry).toBe(symbolB);
    expect(main.treeView).toBe(treeB);
    middle.forEach((edge) => edge.dispose());
    expect(main.registry).toBe(symbolA);
    expect(main.treeView).toBe(treeA);
    first.forEach((edge) => edge.dispose());
    expect(main.registry).toBeNull();
    expect(main.treeView).toBeNull();
  });

  it("does not let an old service lease withdraw a newly activated identical payload", async () => {
    const value = registry();
    const oldLease = main.consumeSymbolRegistry(value);
    cleanups.push(() => oldLease.dispose());
    await lumine.packages.deactivatePackage("breadcrumbs");
    main = (await lumine.packages.activatePackage("breadcrumbs")).mainModule;
    const currentLease = main.consumeSymbolRegistry(value);
    cleanups.push(() => currentLease.dispose());
    await main.ensureController().views.get(lumine.workspace.paneForItem(editor)).refreshSymbols();
    oldLease.dispose();
    expect(main.registry).toBe(value);
    expect(view().element.querySelector(".breadcrumbs-symbol").textContent).toContain(
      "Owned symbol",
    );
  });

  it("keeps a replacement symbol request when an obsolete request settles", async () => {
    let complete;
    const first = registry(null);
    first.getFileSymbolTree = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    const current = view();
    current.setRegistry(first);
    const pending = current.refreshSymbols();
    const second = registry();
    current.setRegistry(second);
    await current.refreshSymbols();
    complete([{ name: "Obsolete", position: new Point(0, 0), children: [] }]);
    await pending;
    expect(current.registry).toBe(second);
    expect(current.element.querySelector(".breadcrumbs-symbol").textContent).toContain(
      "Owned symbol",
    );
    expect(current.symbolRefresh).toBeNull();
  });

  it("silences an obsolete symbol error without logging or reviving a destroyed view", async () => {
    let reject;
    const value = registry(null);
    value.getFileSymbolTree = () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      });
    const current = view();
    current.setRegistry(value);
    const pending = current.refreshSymbols();
    current.destroy();
    spyOn(console, "error");
    reject(new Error("Owned late error"));
    await pending;
    expect(console.error).not.toHaveBeenCalled();
    expect(current.element.isConnected).toBe(false);
  });
});
