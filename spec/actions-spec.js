const { CompositeDisposable, Disposable, Emitter } = require("lumine");

describe("breadcrumb document actions", () => {
  let main, editor, pane, view, subscriptions, extraItems;

  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    subscriptions = new CompositeDisposable();
    extraItems = [];
    lumine.config.set("breadcrumbs.enabled", true);
    lumine.config.set("breadcrumbs.onlyWithPath", true);
    lumine.config.set("breadcrumbs.showUnsavedEditors", true);
    lumine.config.set("breadcrumbs.filePath", "on");
    lumine.config.set("breadcrumbs.symbolPath", "off");
    const pack = await lumine.packages.activatePackage("breadcrumbs");
    main = pack.mainModule;
    editor = await lumine.workspace.open();
    pane = lumine.workspace.paneForItem(editor);
    view = main.controller.views.get(pane);
  });

  afterEach(async () => {
    subscriptions.dispose();
    for (const item of extraItems) {
      const owner = lumine.workspace.paneForItem(item);
      if (owner) await owner.destroyItem(item);
    }
    editor?.destroy();
    await lumine.packages.deactivatePackage("breadcrumbs");
  });

  const action = (options = {}) => ({
    id: "spec:details",
    icon: "info",
    title: "Document details",
    getState: () => ({}),
    didClick() {},
    ...options,
  });

  const addAction = (options) => {
    const registration = main.provideBreadcrumbsActions().addAction(action(options));
    subscriptions.add(registration);
    return registration;
  };

  it("keeps actions outside the scrolling path and uses their own inactive pane context", () => {
    const secondEditor = lumine.workspace.buildTextEditor();
    extraItems.push(secondEditor);
    const secondPane = pane.splitRight({ items: [secondEditor] });
    secondPane.activate();
    const didClick = jasmine.createSpy("didClick");
    addAction({ didClick });
    const button = view.element.querySelector(".breadcrumbs-action");
    expect(view.scroller.nextElementSibling).toBe(view.actions.element);
    expect(view.scroller.contains(button)).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Document details");
    expect(button.querySelector(".icon-info")).not.toBeNull();
    expect(view.scroller.getAttribute("role")).toBe("navigation");
    expect(view.actions.element.getAttribute("role")).toBe("toolbar");

    const editorElement = lumine.views.getView(secondEditor);
    editorElement.focus();
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    button.click();
    expect(didClick).toHaveBeenCalledWith({
      item: editor,
      pane,
      window: pane.getContainer().getWindow(),
      document: pane.getElement().ownerDocument,
    });
    expect(lumine.workspace.getCenter().getActivePane()).toBe(secondPane);
    expect(editorElement.contains(document.activeElement)).toBe(true);
    expect(lumine.tooltips.findTooltips(button).length).toBe(1);
  });

  it("shows actions for pathless items and respects the whole bar's enabled setting", () => {
    const item = document.createElement("div");
    item.getTitle = () => "Pathless preview";
    extraItems.push(item);
    pane.addItem(item);
    pane.activateItem(item);
    expect(view.element.hidden).toBe(true);
    const registration = addAction();
    expect(view.element.hidden).toBe(false);
    expect(view.scroller.hidden).toBe(true);
    expect(view.element.querySelector(".breadcrumbs-action")).not.toBeNull();
    expect(view.element.querySelector(".breadcrumbs-crumb")).toBeNull();

    lumine.config.set("breadcrumbs.enabled", false);
    expect(view.element.hidden).toBe(true);
    expect(view.element.querySelector(".breadcrumbs-action")).toBeNull();
    lumine.config.set("breadcrumbs.enabled", true);
    expect(view.element.hidden).toBe(false);
    registration.dispose();
    expect(view.element.hidden).toBe(true);

    pane.activateItem(editor);
    lumine.config.set("breadcrumbs.filePath", "off");
    addAction();
    expect(view.element.querySelector(".breadcrumbs-crumb")).toBeNull();
    expect(view.element.querySelector(".breadcrumbs-action")).not.toBeNull();
    expect(view.element.hidden).toBe(false);
  });

  it("refreshes toggle state without replacing focused buttons and rechecks state on click", () => {
    const emitter = new Emitter();
    subscriptions.add(emitter);
    let state = { pressed: false };
    const didClick = jasmine.createSpy("didClick");
    const listenerDisposed = jasmine.createSpy("listenerDisposed");
    const registration = addAction({
      getState: () => state,
      didClick,
      onDidChange: (refresh) =>
        new CompositeDisposable(emitter.on("change", refresh), new Disposable(listenerDisposed)),
    });
    const button = view.element.querySelector(".breadcrumbs-action");
    button.focus();
    state = { pressed: true };
    emitter.emit("change");
    expect(view.element.querySelector(".breadcrumbs-action")).toBe(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(button);
    state = { enabled: false };
    button.click();
    expect(didClick).not.toHaveBeenCalled();
    emitter.emit("change");
    expect(button.disabled).toBe(true);
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    registration.dispose();
    expect(listenerDisposed).toHaveBeenCalledTimes(1);
    expect(lumine.tooltips.findTooltips(button)).toEqual([]);
    expect(button.isConnected).toBe(false);
    emitter.emit("change");
    expect(view.element.querySelector(".breadcrumbs-action")).toBeNull();
  });

  it("orders actions and moves keyboard focus across enabled buttons", () => {
    addAction({ id: "spec:last", order: 20 });
    addAction({ id: "spec:disabled", order: 10, getState: () => ({ enabled: false }) });
    addAction({ id: "spec:first", order: 0 });
    const buttons = [...view.actions.element.children];
    expect(buttons.map((button) => button.dataset.actionId)).toEqual([
      "spec:first",
      "spec:disabled",
      "spec:last",
    ]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1]);
    buttons[0].focus();
    buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(buttons[2]);
    expect(buttons.map((button) => button.tabIndex)).toEqual([-1, -1, 0]);
    buttons[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);
    buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(buttons[2]);
  });

  it("creates action DOM and context in the pane's physical document", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    subscriptions.add(new Disposable(() => frame.remove()));
    const foreignDocument = frame.contentDocument;
    const paneElement = foreignDocument.createElement("div");
    paneElement.innerHTML = '<div class="item-views"></div>';
    foreignDocument.body.appendChild(paneElement);
    const item = { getTitle: () => "Preview" };
    const editorWindow = {};
    const foreignPane = {
      getElement: () => paneElement,
      getContainer: () => ({ getWindow: () => editorWindow }),
      observeActiveItem(callback) {
        callback(item);
        return new Disposable();
      },
    };
    const didClick = jasmine.createSpy("didClick");
    addAction({ didClick });
    // Reacquire this generation's view constructor from the active package.
    const foreignView = new view.constructor(foreignPane, { actions: main.actionRegistry });
    subscriptions.add(new Disposable(() => foreignView.destroy()));
    const button = foreignView.element.querySelector(".breadcrumbs-action");
    expect(button.ownerDocument).toBe(foreignDocument);
    expect(button.firstElementChild.ownerDocument).toBe(foreignDocument);
    button.click();
    expect(didClick).toHaveBeenCalledWith({
      item,
      pane: foreignPane,
      window: editorWindow,
      document: foreignDocument,
    });
  });

  it("retires service handles and listeners across package generations", async () => {
    const service = main.provideBreadcrumbsActions();
    const didClick = jasmine.createSpy("didClick");
    const onDidChange = jasmine.createSpy("onDidChange").and.returnValue(new Disposable());
    addAction({ didClick });
    const oldButton = view.element.querySelector(".breadcrumbs-action");
    await lumine.packages.deactivatePackage("breadcrumbs");
    service.addAction(action({ id: "spec:retired", onDidChange }));
    oldButton.click();
    expect(onDidChange).not.toHaveBeenCalled();
    expect(didClick).not.toHaveBeenCalled();
    expect(document.querySelector(".breadcrumbs-action")).toBeNull();

    const pack = await lumine.packages.activatePackage("breadcrumbs");
    main = pack.mainModule;
    main.ensureController();
    view = main.controller.views.get(pane);
    addAction({ id: "spec:new" });
    expect(view.element.querySelectorAll(".breadcrumbs-action").length).toBe(1);
    service.addAction(action({ id: "spec:still-retired", onDidChange }));
    expect(onDidChange).not.toHaveBeenCalled();
    expect(view.element.querySelectorAll(".breadcrumbs-action").length).toBe(1);
  });

  it("releases an action icon when its allocation deactivates the package", () => {
    const applyIcon = lumine.icons.applyTo.bind(lumine.icons);
    let iconDisposed;
    spyOn(lumine.icons, "applyTo").and.callFake((...args) => {
      const resource = applyIcon(...args);
      if (args[1].context === "breadcrumbs-actions") {
        iconDisposed = spyOn(resource, "dispose").and.callThrough();
        main.deactivate();
      }
      return resource;
    });
    spyOn(lumine.tooltips, "add").and.callThrough();
    addAction();
    expect(iconDisposed).toHaveBeenCalledTimes(1);
    expect(lumine.tooltips.add).not.toHaveBeenCalled();
    expect(view.element.querySelector(".breadcrumbs-action")).toBeNull();
    expect(view.element.isConnected).toBe(false);
  });

  it("rejects ambiguous IDs and malformed descriptors without removing another action", () => {
    addAction();
    const service = main.provideBreadcrumbsActions();
    expect(() => service.addAction(action())).toThrowError(/already registered/);
    expect(() => service.addAction(action({ id: "spec:invalid", order: Infinity }))).toThrowError(
      /finite number/,
    );
    expect(() =>
      service.addAction(action({ id: "spec:invalid", onDidChange: () => null })),
    ).toThrowError(/Disposable/);
    expect(view.element.querySelectorAll(".breadcrumbs-action").length).toBe(1);
  });
});
