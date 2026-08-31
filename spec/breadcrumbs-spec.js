const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Emitter, Point, Range } = require("lumine");
const PathSegments = require("../lib/path-segments");

function makeRegistry() {
  const emitter = new Emitter();
  return {
    tree: [
      {
        name: "Outer",
        tag: "class",
        position: new Point(0, 0),
        range: new Range([0, 0], [8, 0]),
        children: [
          {
            name: "inner",
            position: new Point(2, 2),
            range: new Range([2, 0], [5, 0]),
            children: [],
          },
        ],
      },
    ],
    peekFileSymbolTree() {
      return this.tree;
    },
    async getFileSymbolTree() {
      return this.tree;
    },
    onDidInvalidateFileSymbols(callback) {
      return emitter.on("invalidate", callback);
    },
    invalidate(editor = null) {
      emitter.emit("invalidate", { editor, provider: null });
    },
  };
}

describe("breadcrumbs", () => {
  let pack,
    main,
    editor,
    pane,
    view,
    registryDisposable,
    treeDisposable,
    iconRegistration,
    projectPaths,
    tempRoot;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    projectPaths = lumine.project.getPaths();
    lumine.config.set("breadcrumbs.enabled", true);
    lumine.config.set("breadcrumbs.filePath", "on");
    lumine.config.set("breadcrumbs.symbolPath", "on");
    lumine.config.set("breadcrumbs.icons", true);
    lumine.config.set("breadcrumbs.scrollZone", [0, 50]);
    pack = await lumine.packages.activatePackage("breadcrumbs");
    main = pack.mainModule;
    editor = await lumine.workspace.open();
    editor.setText(Array(10).fill("// line").join("\n"));
    pane = lumine.workspace.getCenter().getActivePane();
    view = main.controller.views.get(pane);
  });

  afterEach(async () => {
    registryDisposable?.dispose();
    treeDisposable?.dispose();
    iconRegistration?.dispose();
    lumine.project.setPaths(projectPaths);
    editor?.destroy();
    await lumine.packages.deactivatePackage("breadcrumbs");
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("places one bar before the item views in every center pane", () => {
    const paneElement = pane.getElement();
    expect(view.element.nextElementSibling).toBe(paneElement.querySelector(":scope > .item-views"));

    const secondEditor = lumine.workspace.buildTextEditor();
    const secondPane = pane.splitRight({ items: [secondEditor] });
    expect(main.controller.views.has(secondPane)).toBe(true);
    expect(secondPane.getElement().querySelector(":scope > .breadcrumbs")).not.toBeNull();
  });

  it("does not attach a bar to an empty pane", () => {
    const emptyPane = pane.splitRight();
    expect(main.controller.views.has(emptyPane)).toBe(true);
    expect(emptyPane.getElement().querySelector(":scope > .breadcrumbs")).toBeNull();
  });

  it("detaches the bar after the last pane item is closed", async () => {
    await pane.destroyItem(editor);
    expect(view.editor).toBeNull();
    expect(pane.getElement().querySelector(":scope > .breadcrumbs")).toBeNull();
  });

  it("shows the containing symbol path and jumps to a clicked symbol", async () => {
    const registry = makeRegistry();
    registryDisposable = main.consumeSymbolRegistry(registry);
    editor.setCursorBufferPosition([3, 0]);

    await waitForFrames(() => view.element.querySelectorAll(".breadcrumbs-symbol").length === 2, {
      description: "the nested symbol path to render",
    });
    const symbols = view.element.querySelectorAll(".breadcrumbs-symbol");
    expect(Array.from(symbols, (element) => element.textContent)).toEqual(["Outer", "inner"]);
    expect(lumine.tooltips.findTooltips(symbols[0])[0].getTitle()).toBe("Outer (class)");
    expect(symbols[0].querySelector(".breadcrumbs-icon").classList).toContain("icon-puzzle");
    expect(symbols[1].querySelector(".breadcrumbs-icon").classList).toContain("icon-code");

    lumine.config.set("breadcrumbs.scrollZone", [25]);
    const scrollToCursor = spyOn(editor, "scrollToCursorPosition").and.callThrough();
    symbols[0].click();
    expect(editor.getCursorBufferPosition().isEqual([0, 0])).toBe(true);
    expect(scrollToCursor).toHaveBeenCalledWith({ zone: [25] });
    expect(lumine.views.getView(editor).contains(document.activeElement)).toBe(true);
  });

  it("does no DOM, icon, tooltip, or scroll work while the active symbol is unchanged", async () => {
    registryDisposable = main.consumeSymbolRegistry(makeRegistry());
    editor.setCursorBufferPosition([3, 0]);
    await waitForFrames(() => view.element.querySelectorAll(".breadcrumbs-symbol").length === 2, {
      description: "the initial symbol path to render",
    });

    const pathCrumb = view.element.querySelector(".breadcrumbs-path");
    const symbolCrumbs = Array.from(view.element.querySelectorAll(".breadcrumbs-symbol"));
    symbolCrumbs[1].focus();
    const focusedCrumb = document.activeElement;
    const fileReplacement = spyOn(view.fileContent, "replaceChildren").and.callThrough();
    const symbolReplacement = spyOn(view.symbolContent, "replaceChildren").and.callThrough();
    const iconApplication = spyOn(lumine.icons, "applyTo").and.callThrough();
    const tooltipCreation = spyOn(lumine.tooltips, "add").and.callThrough();
    const pathCalculation = spyOn(PathSegments, "forEditor").and.callThrough();
    const scrollScheduling = spyOn(view, "scheduleScrollToEnd").and.callThrough();

    for (let index = 0; index < 1000; index++) {
      editor.setCursorBufferPosition([3 + (index % 2), 0]);
    }

    expect(fileReplacement).not.toHaveBeenCalled();
    expect(symbolReplacement).not.toHaveBeenCalled();
    expect(iconApplication).not.toHaveBeenCalled();
    expect(tooltipCreation).not.toHaveBeenCalled();
    expect(pathCalculation).not.toHaveBeenCalled();
    expect(scrollScheduling).not.toHaveBeenCalled();
    expect(view.element.querySelector(".breadcrumbs-path")).toBe(pathCrumb);
    expect(Array.from(view.element.querySelectorAll(".breadcrumbs-symbol"))).toEqual(symbolCrumbs);
    expect(document.activeElement).toBe(focusedCrumb);
  });

  it("does not fetch or react to cursors while symbols or breadcrumbs are off", async () => {
    const registry = makeRegistry();
    spyOn(registry, "getFileSymbolTree").and.callThrough();
    lumine.config.set("breadcrumbs.symbolPath", "off");
    registryDisposable = main.consumeSymbolRegistry(registry);
    await Promise.resolve();

    const render = spyOn(view, "render").and.callThrough();
    editor.setCursorBufferPosition([1, 0]);
    editor.setCursorBufferPosition([2, 0]);
    expect(registry.getFileSymbolTree).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();

    lumine.config.set("breadcrumbs.symbolPath", "on");
    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol"), {
      description: "symbols to load after enabling their path",
    });
    expect(registry.getFileSymbolTree).toHaveBeenCalledTimes(1);

    lumine.config.set("breadcrumbs.enabled", false);
    registry.getFileSymbolTree.calls.reset();
    render.calls.reset();
    editor.setCursorBufferPosition([3, 0]);
    editor.setCursorBufferPosition([4, 0]);
    expect(registry.getFileSymbolTree).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it("uses and live-updates the shared kind icon registry", async () => {
    registryDisposable = main.consumeSymbolRegistry(makeRegistry());
    editor.setCursorBufferPosition([3, 0]);
    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol .icon-puzzle"), {
      description: "the core class icon to render",
    });

    iconRegistration = lumine.icons.addProvider(
      {
        id: "breadcrumbs-spec",
        handles: ["kind"],
        iconFor(target) {
          return target.context === "breadcrumbs" && target.kind === "class" ? "icon-flame" : null;
        },
      },
      { priority: 100 },
    );
    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol .icon-flame"), {
      description: "the package-supplied class icon to repaint",
    });

    iconRegistration.dispose();
    iconRegistration = null;
    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol .icon-puzzle"), {
      description: "the core class icon to return",
    });
  });

  it("recovers when a provider becomes ready after the editor was restored", async () => {
    const registry = makeRegistry();
    const restoredTree = registry.tree;
    registry.tree = null;
    registryDisposable = main.consumeSymbolRegistry(registry);
    await Promise.resolve();
    expect(view.element.querySelectorAll(".breadcrumbs-symbol").length).toBe(0);

    editor.setCursorBufferPosition([3, 0]);
    registry.tree = restoredTree;
    registry.invalidate(editor);
    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol"), {
      description: "symbols to appear without reopening the restored editor",
    });
    expect(view.element.querySelector(".breadcrumbs-symbol").textContent).toBe("Outer");
  });

  it("adopts a tree another consumer cached after the initial request", async () => {
    const registry = makeRegistry();
    const cachedTree = registry.tree;
    registry.tree = null;
    registryDisposable = main.consumeSymbolRegistry(registry);
    await Promise.resolve();
    expect(view.symbolTree).toBeNull();

    // Simulate Outline warming the shared registry without another
    // invalidation after breadcrumbs' transient null result.
    registry.tree = cachedTree;
    editor.setCursorBufferPosition([3, 0]);
    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol"), {
      description: "breadcrumbs to adopt the shared cached tree on cursor movement",
    });
    expect(view.element.querySelector(".breadcrumbs-symbol").textContent).toBe("Outer");
  });

  it("retries a transient null symbol request when the cursor moves", async () => {
    const registry = makeRegistry();
    const availableTree = registry.tree;
    let providerReady = false;
    registry.peekFileSymbolTree = () => null;
    registry.getFileSymbolTree = async () => (providerReady ? availableTree : null);
    registryDisposable = main.consumeSymbolRegistry(registry);
    await Promise.resolve();
    expect(view.symbolTree).toBeNull();

    providerReady = true;
    editor.setCursorBufferPosition([3, 0]);
    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol"), {
      description: "cursor movement to retry the transient symbol request",
    });
    expect(view.element.querySelector(".breadcrumbs-symbol").textContent).toBe("Outer");
  });

  it("limits cursor retries after repeated null symbol results", async () => {
    const registry = makeRegistry();
    registry.peekFileSymbolTree = () => null;
    spyOn(registry, "getFileSymbolTree").and.resolveTo(null);
    registryDisposable = main.consumeSymbolRegistry(registry);
    await view.symbolRefresh.promise;
    expect(registry.getFileSymbolTree).toHaveBeenCalledTimes(1);

    editor.setCursorBufferPosition([1, 0]);
    await view.symbolRefresh.promise;
    expect(registry.getFileSymbolTree).toHaveBeenCalledTimes(2);

    for (let row = 2; row < 9; row++) editor.setCursorBufferPosition([row, 0]);
    await Promise.resolve();
    expect(registry.getFileSymbolTree).toHaveBeenCalledTimes(2);

    registry.invalidate(editor);
    await view.symbolRefresh.promise;
    expect(registry.getFileSymbolTree).toHaveBeenCalledTimes(3);
  });

  it("loads symbols after the active editor is closed and another is opened", async () => {
    registryDisposable = main.consumeSymbolRegistry(makeRegistry());
    editor.setCursorBufferPosition([3, 0]);
    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol"), {
      description: "the first editor symbol to render",
    });

    await pane.destroyItem(editor);
    editor = await lumine.workspace.open();
    editor.setText(Array(10).fill("// line").join("\n"));
    editor.setCursorBufferPosition([3, 0]);
    pane = lumine.workspace.getCenter().getActivePane();
    view = main.controller.views.get(pane);

    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol"), {
      description: "the reopened editor symbol to render",
    });
    expect(view.element.querySelector(".breadcrumbs-symbol").textContent).toBe("Outer");
  });

  it("reveals project path segments through tree-view.selection", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadcrumbs-"));
    const source = path.join(tempRoot, "src");
    fs.mkdirSync(source);
    const filePath = path.join(source, "sample.js");
    lumine.project.setPaths([tempRoot]);
    await editor.saveAs(filePath);

    const treeView = {
      revealPath: jasmine.createSpy("revealPath").and.returnValue(Promise.resolve()),
    };
    treeDisposable = main.consumeTreeViewSelection(treeView);
    view.render();
    const paths = view.element.querySelectorAll("button.breadcrumbs-path");
    expect(Array.from(paths, (element) => element.textContent)).toEqual([
      path.basename(tempRoot),
      "src",
      "sample.js",
    ]);
    expect(lumine.tooltips.findTooltips(paths[1])[0].getTitle()).toBe(
      `Reveal ${source} in the tree view`,
    );

    paths[1].click();
    expect(treeView.revealPath).toHaveBeenCalledWith(source, { show: true });
  });

  it("updates only file crumbs when project roots change", async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "breadcrumbs-"));
    const source = path.join(tempRoot, "src");
    fs.mkdirSync(source);
    lumine.project.setPaths([]);
    await editor.saveAs(path.join(source, "sample.js"));
    registryDisposable = main.consumeSymbolRegistry(makeRegistry());
    editor.setCursorBufferPosition([3, 0]);
    await waitForFrames(() => view.element.querySelectorAll(".breadcrumbs-symbol").length === 2, {
      description: "symbols for the external file to render",
    });

    const symbolCrumbs = Array.from(view.element.querySelectorAll(".breadcrumbs-symbol"));
    const previousPathCrumbs = Array.from(view.element.querySelectorAll(".breadcrumbs-path"));
    lumine.project.setPaths([tempRoot]);

    const pathCrumbs = Array.from(view.element.querySelectorAll(".breadcrumbs-path"));
    expect(pathCrumbs.map((item) => item.textContent)).toEqual([
      path.basename(tempRoot),
      "src",
      "sample.js",
    ]);
    expect(pathCrumbs[0]).not.toBe(previousPathCrumbs[0]);
    expect(Array.from(view.element.querySelectorAll(".breadcrumbs-symbol"))).toEqual(symbolCrumbs);
  });

  it("reports synchronous non-Error failures from tree reveal", async () => {
    spyOn(console, "warn");
    treeDisposable = main.consumeTreeViewSelection({
      revealPath() {
        throw "not available";
      },
    });

    await view.revealPath("missing.js");
    expect(console.warn).toHaveBeenCalledWith(
      "breadcrumbs: could not reveal missing.js: not available",
    );
  });

  it("honors last/off settings and the toggle command", async () => {
    registryDisposable = main.consumeSymbolRegistry(makeRegistry());
    editor.setCursorBufferPosition([3, 0]);
    lumine.config.set("breadcrumbs.filePath", "last");
    lumine.config.set("breadcrumbs.symbolPath", "last");
    await waitForFrames(() => view.element.querySelectorAll(".breadcrumbs-symbol").length === 1, {
      description: "the innermost symbol only to render",
    });
    expect(view.element.querySelectorAll(".breadcrumbs-path").length).toBe(1);
    expect(view.element.querySelector(".breadcrumbs-symbol").textContent).toBe("inner");

    lumine.commands.dispatch(lumine.workspace.getElement(), "breadcrumbs:toggle");
    expect(view.element.hidden).toBe(true);
    lumine.commands.dispatch(lumine.workspace.getElement(), "breadcrumbs:toggle");
    expect(view.element.hidden).toBe(false);
  });

  it("honors visibility settings scoped to the editor grammar", async () => {
    registryDisposable = main.consumeSymbolRegistry(makeRegistry());
    editor.setCursorBufferPosition([3, 0]);
    await waitForFrames(() => view.element.querySelectorAll(".breadcrumbs-symbol").length === 2, {
      description: "the initial symbol path to render",
    });

    const rootScope = editor.getRootScopeDescriptor().getScopesArray()[0];
    const options = { scopeSelector: `.${rootScope}` };
    try {
      lumine.config.set("breadcrumbs.filePath", "off", options);
      lumine.config.set("breadcrumbs.symbolPath", "last", options);
      await waitForFrames(
        () =>
          view.element.querySelectorAll(".breadcrumbs-path").length === 0 &&
          view.element.querySelectorAll(".breadcrumbs-symbol").length === 1,
        { description: "the grammar-scoped path settings to apply" },
      );
      expect(view.element.querySelector(".breadcrumbs-symbol").textContent).toBe("inner");

      lumine.config.set("breadcrumbs.enabled", false, options);
      await waitForFrames(() => view.element.hidden, {
        description: "the grammar-scoped disable to apply",
      });
    } finally {
      lumine.config.unset("breadcrumbs.enabled", options);
      lumine.config.unset("breadcrumbs.filePath", options);
      lumine.config.unset("breadcrumbs.symbolPath", options);
    }
  });

  it("keeps file breadcrumbs when no symbol registry is available", () => {
    expect(view.element.hidden).toBe(false);
    expect(view.element.querySelectorAll(".breadcrumbs-path").length).toBe(1);
    expect(view.element.querySelectorAll(".breadcrumbs-symbol").length).toBe(0);
  });
});
