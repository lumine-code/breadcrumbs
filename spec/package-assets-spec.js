const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("breadcrumbs package assets", () => {
  it("keeps its canonical description and metadata in sync", () => {
    const pkg = JSON.parse(read("package.json"));
    const readme = read("README.md").split(/\r?\n/);
    expect(pkg.name).toBe("breadcrumbs");
    expect(pkg.description).toBe("Show file and symbol paths above each editor.");
    expect(readme[0]).toBe("# breadcrumbs");
    expect(readme[2]).toBe(pkg.description);
    expect(pkg.keywords).toEqual(["navigation", "symbols", "path", "hierarchy", "folders"]);
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
  });
});
