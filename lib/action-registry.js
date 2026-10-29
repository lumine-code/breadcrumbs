const { Disposable, Emitter } = require("lumine");

module.exports = class ActionRegistry {
  constructor() {
    this.records = new Map();
    this.emitter = new Emitter();
    this.disposed = false;
  }

  addAction(action) {
    if (this.disposed) return new Disposable();
    for (const field of ["id", "icon", "title"]) {
      if (typeof action?.[field] !== "string" || !action[field].trim()) {
        throw new TypeError(`Breadcrumb actions require a non-empty ${field}.`);
      }
    }
    if (typeof action.getState !== "function" || typeof action.didClick !== "function") {
      throw new TypeError("Breadcrumb actions require getState and didClick methods.");
    }
    if (action.order !== undefined && !Number.isFinite(action.order)) {
      throw new TypeError("Breadcrumb action order must be a finite number.");
    }
    if (action.onDidChange !== undefined && typeof action.onDidChange !== "function") {
      throw new TypeError("Breadcrumb action onDidChange must be a function.");
    }
    if (this.records.has(action.id)) {
      throw new Error(`Breadcrumb action ${action.id} is already registered.`);
    }
    const record = { action: { ...action }, subscription: null };
    this.records.set(action.id, record);
    const registration = new Disposable(() => {
      if (this.records.get(action.id) !== record) return;
      this.records.delete(action.id);
      record.subscription?.dispose();
      this.emitter.emit("did-change");
    });
    try {
      if (action.onDidChange) {
        const subscription = action.onDidChange(() => {
          if (!this.disposed && this.records.get(action.id) === record) {
            this.emitter.emit("did-change");
          }
        });
        if (!Disposable.isDisposable(subscription)) {
          throw new TypeError("Breadcrumb action onDidChange must return a Disposable.");
        }
        record.subscription = subscription;
        if (this.disposed || this.records.get(action.id) !== record) subscription.dispose();
      }
      if (!this.disposed && this.records.get(action.id) === record) {
        this.emitter.emit("did-change");
      }
      return registration;
    } catch (error) {
      registration.dispose();
      throw error;
    }
  }

  getActions() {
    return [...this.records.values()]
      .map(({ action }) => action)
      .sort(
        (left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id),
      );
  }

  hasAction(action) {
    return !this.disposed && this.records.get(action.id)?.action === action;
  }

  onDidChange(callback) {
    if (this.disposed) return new Disposable();
    return this.emitter.on("did-change", callback);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const records = [...this.records.values()];
    this.records.clear();
    for (const record of records) record.subscription?.dispose();
    this.emitter.emit("did-change");
    this.emitter.dispose();
  }
};
