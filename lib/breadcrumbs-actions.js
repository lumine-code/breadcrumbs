const { CompositeDisposable } = require("lumine");

module.exports = class BreadcrumbsActions {
  constructor(document, registry, getContext) {
    this.registry = registry;
    this.getContext = getContext;
    this.buttons = new Map();
    this.element = document.createElement("div");
    this.element.className = "breadcrumbs-actions";
    this.element.setAttribute("role", "toolbar");
    this.element.setAttribute("aria-label", "Document actions");
    this.element.hidden = true;
    this.element.addEventListener("keydown", (event) => this.navigate(event));
    this.element.addEventListener("focusin", () => this.updateTabStops());
  }

  update() {
    if (this.destroyed) return false;
    const context = this.getContext();
    const visible = new Set();
    if (context?.item) {
      for (const action of this.registry?.getActions() ?? []) {
        const state = this.stateForAction(action, context);
        if (!state || state.visible === false || !this.registry?.hasAction(action)) continue;
        visible.add(action);
        let record = this.buttons.get(action);
        if (!record) {
          record = this.createButton(action);
          if (!record) continue;
          this.buttons.set(action, record);
        }
        const { button } = record;
        button.disabled = state.enabled === false;
        if (typeof state.pressed === "boolean") {
          button.setAttribute("aria-pressed", String(state.pressed));
        } else {
          button.removeAttribute("aria-pressed");
        }
        const sibling = this.element.children[visible.size - 1] ?? null;
        if (sibling !== button) this.element.insertBefore(button, sibling);
      }
    }
    if (this.destroyed) return false;
    for (const [action, record] of this.buttons) {
      if (visible.has(action)) continue;
      record.disposables.dispose();
      record.button.remove();
      this.buttons.delete(action);
    }
    this.element.hidden = visible.size === 0;
    this.updateTabStops();
    return visible.size > 0;
  }

  stateForAction(action, context) {
    try {
      const state = action.getState(context);
      if (!state || typeof state !== "object" || typeof state.then === "function") {
        throw new TypeError("getState must synchronously return an action state.");
      }
      return state;
    } catch (error) {
      console.error(`breadcrumbs: failed to get state for ${action.id}`, error);
      return null;
    }
  }

  createButton(action) {
    const document = this.element.ownerDocument;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "breadcrumbs-action";
    button.dataset.actionId = action.id;
    button.setAttribute("aria-label", action.title);
    const icon = document.createElement("span");
    icon.className = "breadcrumbs-action-icon";
    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);
    const disposables = new CompositeDisposable();
    for (const allocate of [
      () => lumine.icons.applyTo(icon, { name: action.icon, context: "breadcrumbs-actions" }),
      () => lumine.tooltips.add(button, { title: action.title }),
    ]) {
      const resource = allocate();
      disposables.add(resource);
      if (this.destroyed || !this.registry?.hasAction(action)) {
        disposables.dispose();
        return null;
      }
    }
    // Mouse actions retain the document's focus. Keyboard users can enter the
    // toolbar normally and activate its native buttons with Enter or Space.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.didClick(action);
    });
    return { button, disposables };
  }

  async didClick(action) {
    if (this.destroyed || !this.registry?.hasAction(action)) return;
    const context = this.getContext();
    if (!context?.item) return;
    const state = this.stateForAction(action, context);
    if (
      !state ||
      state.visible === false ||
      state.enabled === false ||
      this.destroyed ||
      !this.registry?.hasAction(action)
    )
      return;
    try {
      await action.didClick(context);
    } catch (error) {
      console.error(`breadcrumbs: failed to run ${action.id}`, error);
    }
  }

  updateTabStops() {
    const buttons = [...this.element.children].filter((button) => !button.disabled);
    const focused = this.element.ownerDocument.activeElement;
    const entry = buttons.includes(focused) ? focused : buttons[0];
    for (const button of this.element.children) button.tabIndex = button === entry ? 0 : -1;
  }

  navigate(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...this.element.children].filter((button) => !button.disabled);
    const index = buttons.indexOf(event.target);
    if (index === -1 || buttons.length === 0) return;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
    event.preventDefault();
    event.stopPropagation();
  }

  clear() {
    for (const { button, disposables } of this.buttons.values()) {
      disposables.dispose();
      button.remove();
    }
    this.buttons.clear();
    this.element.hidden = true;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
    this.registry = null;
    this.getContext = null;
    this.element.remove();
  }
};
