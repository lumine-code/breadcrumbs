const path = require("path");

const PACKAGE_NAME = "breadcrumbs";
const PACKAGE_PATH = path.join(__dirname, "..");

describe("breadcrumbs bootstrap activation", () => {
  let pack;
  let workspaceElement;

  beforeEach(async () => {
    if (lumine.packages.isPackageLoaded(PACKAGE_NAME)) {
      await lumine.packages.unloadPackage(PACKAGE_NAME);
    }
    workspaceElement = lumine.views.getView(lumine.workspace);
    jasmine.attachToDOM(workspaceElement);
    pack = await lumine.packages.startPackage(PACKAGE_PATH);
  });

  afterEach(async () => {
    if (lumine.packages.isPackageLoaded(PACKAGE_NAME)) {
      await lumine.packages.unloadPackage(PACKAGE_NAME);
    }
  });

  it("activates its lightweight controller before the first editor", () => {
    expect(lumine.packages.getPackageLifecycleState(PACKAGE_NAME)).toBe("active");
    expect(pack.mainModule).not.toBeNull();
    expect(pack.mainActivated).toBe(true);
  });

  it("runs the workspace command immediately", async () => {
    await lumine.commands.dispatch(workspaceElement, "breadcrumbs:toggle");

    expect(lumine.packages.getPackageLifecycleState(PACKAGE_NAME)).toBe("active");
    expect(pack.mainActivated).toBe(true);
  });

  it("initializes its controller for the first pane item, including custom items", async () => {
    const pane = lumine.workspace.getActivePane();
    const nonTextItem = document.createElement("div");
    nonTextItem.getPath = () => path.join(PACKAGE_PATH, "package.json");
    pane.addItem(nonTextItem);

    expect(lumine.packages.getPackageLifecycleState(PACKAGE_NAME)).toBe("active");
    expect(pack.mainModule).not.toBeNull();
    expect(pack.mainModule.controller).not.toBeNull();

    const editor = await lumine.workspace.open(null, { autoIndent: false });

    expect(lumine.packages.getPackageLifecycleState(PACKAGE_NAME)).toBe("active");
    expect(pack.mainActivated).toBe(true);

    await pane.destroyItem(nonTextItem);
    editor.destroy();
  });
});
