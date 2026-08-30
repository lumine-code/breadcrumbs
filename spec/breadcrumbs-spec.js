const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Emitter, Point, Range } = require("lumine");

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

    symbols[0].click();
    expect(editor.getCursorBufferPosition().isEqual([0, 0])).toBe(true);
    expect(lumine.views.getView(editor).contains(document.activeElement)).toBe(true);
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

  it("shows the first outline symbol at a freshly opened editor position", async () => {
    const registry = makeRegistry();
    registry.tree[0].position = new Point(2, 0);
    registry.tree[0].range = new Range([2, 0], [8, 0]);
    registryDisposable = main.consumeSymbolRegistry(registry);
    editor.setCursorBufferPosition([0, 0]);

    await waitForFrames(() => view.element.querySelector(".breadcrumbs-symbol"), {
      description: "the first outline symbol to represent the start of the document",
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

  it("keeps file breadcrumbs when no symbol registry is available", () => {
    expect(view.element.hidden).toBe(false);
    expect(view.element.querySelectorAll(".breadcrumbs-path").length).toBe(1);
    expect(view.element.querySelectorAll(".breadcrumbs-symbol").length).toBe(0);
  });
});
