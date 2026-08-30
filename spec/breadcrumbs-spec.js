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
            tag: "method",
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
  let pack, main, editor, pane, view, registryDisposable, treeDisposable, projectPaths, tempRoot;

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

    symbols[0].click();
    expect(editor.getCursorBufferPosition().isEqual([0, 0])).toBe(true);
    expect(lumine.views.getView(editor).contains(document.activeElement)).toBe(true);
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
