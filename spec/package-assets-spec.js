const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("breadcrumbs package assets", () => {
  it("keeps its canonical description and metadata in sync", () => {
    const pkg = JSON.parse(read("package.json"));
    const readme = read("README.md").split(/\r?\n/);
    expect(pkg.name).toBe("breadcrumbs");
    expect(pkg.description).toBe("Show file and symbol paths above each pane item.");
    expect(readme[0]).toBe("# breadcrumbs");
    expect(readme[2]).toBe(pkg.description);
    expect(pkg.keywords).toEqual(["navigation", "symbols", "path", "hierarchy", "folders"]);
  });

  it("resolves visibility settings per grammar", () => {
    const config = JSON.parse(read("package.json")).configSchema;
    expect(config.enabled.scopeResolution).toBe("grammar");
    expect(config.filePath.scopeResolution).toBe("grammar");
    expect(config.symbolPath.scopeResolution).toBe("grammar");
  });

  it("consumes the shared symbol tree and tree-view reveal services", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.consumedServices["symbol.registry"].versions["^1.1.0"]).toBe(
      "consumeSymbolRegistry",
    );
    expect(pkg.consumedServices["tree-view.selection"].versions["^1.0.0"]).toBe(
      "consumeTreeViewSelection",
    );
  });

  it("defines the symbol navigation scroll zone", () => {
    const config = JSON.parse(read("package.json")).configSchema.scrollZone;
    expect(config.type).toBe("array");
    expect(config.items).toEqual({ type: "integer", minimum: 0, maximum: 100 });
    expect(config.minItems).toBe(1);
    expect(config.maxItems).toBe(2);
    expect(config.default).toEqual([0, 50]);
  });

  it("hides a redundant single project root by default", () => {
    const config = JSON.parse(read("package.json")).configSchema.hideSingleProjectRoot;
    expect(config.type).toBe("boolean");
    expect(config.default).toBe(true);
  });

  it("ships one menu file, one stylesheet, and no keymap", () => {
    const menu = JSON.parse(read("menus/main.json"));
    expect(menu.menu[0].label).toBe("View");
    expect(menu.menu[0].submenu[0].command).toBe("breadcrumbs:toggle");
    expect(fs.existsSync(path.join(root, "styles", "main.css"))).toBe(true);
    expect(fs.existsSync(path.join(root, "keymaps"))).toBe(false);
    expect(read("styles/main.css")).toContain(
      "background-color: var(--tab-background-color-active)",
    );
    expect(read("styles/main.css")).toContain("align-items: center");
    expect(read("styles/main.css")).not.toContain("background: var(--background-color-highlight)");
    expect(read("styles/main.css")).toContain("cursor: default");
    expect(read("styles/main.css")).not.toContain("cursor: pointer");
  });
});
