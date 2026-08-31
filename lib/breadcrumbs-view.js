const { CompositeDisposable, Disposable } = require("lumine");
const PathSegments = require("./path-segments");
const SymbolPath = require("./symbol-path");

const EMPTY_SEGMENTS = Object.freeze([]);
const GRAMMAR_SCOPED_SETTINGS = ["enabled", "filePath", "symbolPath"];

function iconTargetForSymbol(symbol) {
  const explicit = symbol.icon;
  if (explicit?.startsWith("type-")) {
    return { kind: explicit.slice("type-".length), context: "breadcrumbs" };
  }
  if (explicit) {
    const name = explicit.startsWith("icon-") ? explicit.slice("icon-".length) : explicit;
    return { name, context: "breadcrumbs" };
  }
  const kind = symbol.tag ?? symbol.kind;
  return kind ? { kind, context: "breadcrumbs" } : { name: "code", context: "breadcrumbs" };
}

function sameItems(left, right, isEqual) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((item, index) => isEqual(item, right[index]));
}

function sameFileSegment(left, right) {
  return (
    left.label === right.label &&
    left.path === right.path &&
    left.directory === right.directory &&
    left.project === right.project &&
    left.iconName === right.iconName
  );
}

module.exports = class BreadcrumbsView {
  constructor(pane, { config, registry, treeView }) {
    this.pane = pane;
    this.config = config;
    this.registry = registry;
    this.treeView = treeView;
    this.item = null;
    this.editor = null;
    this.symbolTree = null;
    this.symbolRefresh = null;
    this.retrySymbolsAfterRefresh = false;
    this.cursorNullRetriesRemaining = 1;
    this.cachedFileSegments = null;
    this.cachedLastFileSegments = null;
    this.scrollFrame = null;
    this.generation = 0;
    this.destroyed = false;
    this.itemSubscriptions = null;
    this.fileDisposables = new CompositeDisposable();
    this.symbolDisposables = new CompositeDisposable();
    this.subscriptions = new CompositeDisposable();
    this.renderedFiles = null;
    this.renderedFileOptions = null;
    this.renderedSymbols = null;
    this.renderedSymbolOptions = null;

    this.element = document.createElement("div");
    this.element.className = "breadcrumbs";
    this.element.setAttribute("role", "navigation");
    this.element.setAttribute("aria-label", "Breadcrumbs");
    this.content = document.createElement("div");
    this.content.className = "breadcrumbs-content";
    this.fileContent = document.createElement("span");
    this.fileContent.className = "breadcrumbs-files";
    this.symbolContent = document.createElement("span");
    this.symbolContent.className = "breadcrumbs-symbols";
    this.content.append(this.fileContent, this.symbolContent);
    this.element.appendChild(this.content);

    this.subscriptions.add(pane.observeActiveItem((item) => this.setItem(item)));
  }

  setItem(item) {
    if (item === this.item) return;
    const editor = lumine.workspace.isTextEditor(item) ? item : null;

    this.resetSymbolSource();
    this.itemSubscriptions?.dispose();
    this.itemSubscriptions = null;
    this.item = item ?? null;
    this.editor = editor;
    this.config = this.configForItem();
    this.clearFileSegmentCache();
    this.symbolTree = this.canLoadSymbols() ? this.peekSymbolTree() : null;
    this.invalidateRenderedModels();
    this.updateAttachment();
    this.configureItemSubscriptions();

    if (this.canLoadSymbols()) this.refreshSymbols();
    this.render();
  }

  configForItem() {
    const config = { ...lumine.config.get("breadcrumbs") };
    if (!this.item) return config;

    let scope = null;
    if (typeof this.item.getRootScopeDescriptor === "function") {
      scope = this.item.getRootScopeDescriptor();
    } else if (typeof this.item.getGrammar === "function") {
      const scopeName = this.item.getGrammar()?.scopeName;
      if (scopeName) scope = [scopeName];
    }
    if (!scope) return config;
    for (const setting of GRAMMAR_SCOPED_SETTINGS) {
      config[setting] = lumine.config.get(`breadcrumbs.${setting}`, { scope });
    }
    return config;
  }

  refreshConfig() {
    this.setConfig(this.configForItem());
  }

  updateAttachment() {
    if (!this.item) {
      this.element.remove();
      return;
    }
    const paneElement = this.pane.getElement();
    const itemViews = paneElement.querySelector(":scope > .item-views");
    if (
      this.element.parentElement !== paneElement ||
      this.element.nextElementSibling !== itemViews
    ) {
      paneElement.insertBefore(this.element, itemViews);
    }
  }

  setConfig(config) {
    const couldLoadSymbols = this.canLoadSymbols();
    const wasTrackingFilePath = this.config?.enabled !== false && this.config?.filePath !== "off";
    const projectRootVisibilityChanged =
      this.config?.hideSingleProjectRoot !== config?.hideSingleProjectRoot;
    const iconVisibilityChanged = this.config?.icons !== config?.icons;
    this.config = config;
    const canLoadSymbols = this.canLoadSymbols();
    const isTrackingFilePath = this.config?.enabled !== false && this.config?.filePath !== "off";

    if (!canLoadSymbols && couldLoadSymbols) this.resetSymbolSource();
    else if (!canLoadSymbols) this.resetSymbolRetry();
    if (canLoadSymbols && !couldLoadSymbols) {
      this.resetSymbolRetry();
      this.symbolTree = this.peekSymbolTree();
    }
    if (
      projectRootVisibilityChanged ||
      iconVisibilityChanged ||
      (isTrackingFilePath && !wasTrackingFilePath)
    ) {
      this.clearFileSegmentCache();
    }

    this.configureItemSubscriptions();
    this.render();
    if (canLoadSymbols && !couldLoadSymbols) this.refreshSymbols();
  }

  setRegistry(registry) {
    if (registry === this.registry) return;
    this.resetSymbolSource();
    this.registry = registry;
    this.symbolTree = this.canLoadSymbols() ? this.peekSymbolTree() : null;
    this.configureItemSubscriptions();
    this.render();
    if (this.canLoadSymbols()) this.refreshSymbols();
  }

  setTreeView(treeView) {
    if (treeView === this.treeView) return;
    this.treeView = treeView;
    this.render();
  }

  invalidateFilePath() {
    this.clearFileSegmentCache();
    this.render();
  }

  canLoadSymbols() {
    return Boolean(
      !this.destroyed &&
      this.editor &&
      this.registry &&
      this.config?.enabled !== false &&
      this.config?.symbolPath !== "off",
    );
  }

  peekSymbolTree() {
    return this.registry?.peekFileSymbolTree?.(this.editor) ?? null;
  }

  configureItemSubscriptions() {
    this.itemSubscriptions?.dispose();
    this.itemSubscriptions = null;
    if (!this.item) return;

    const subscriptions = [];
    this.addItemSubscription(subscriptions, "onDidChangeGrammar", () => this.refreshConfig());
    if (this.config?.enabled !== false && this.config?.filePath !== "off") {
      this.addItemSubscription(subscriptions, "onDidChangePath", () => this.invalidateFilePath());
      this.addItemSubscription(subscriptions, "onDidChangeTitle", () => this.invalidateFilePath());
      if (this.config?.icons !== false) {
        this.addItemSubscription(subscriptions, "onDidChangeIcon", () => this.invalidateFilePath());
      }
    }
    if (this.config?.enabled !== false && this.canLoadSymbols()) {
      subscriptions.push(
        this.editor.onDidChangeCursorPosition(({ cursor }) => {
          if (cursor !== this.editor?.getLastCursor()) return;
          this.didChangeCursorPosition();
        }),
      );
    }
    this.itemSubscriptions = new CompositeDisposable(...subscriptions);
  }

  addItemSubscription(subscriptions, method, callback) {
    if (typeof this.item?.[method] !== "function") return;
    const disposable = this.item[method](callback);
    if (Disposable.isDisposable(disposable)) {
      subscriptions.push(disposable);
    } else {
      console.warn(`breadcrumbs: ${method} did not return a Disposable`, this.item);
    }
  }

  didChangeCursorPosition() {
    if (this.symbolTree === null) {
      const cached = this.peekSymbolTree();
      if (cached !== null) {
        this.symbolTree = cached;
        this.resetSymbolRetry();
      } else {
        this.retrySymbolsForCursor();
      }
    }
    this.render();
  }

  async refreshSymbols({ force = false } = {}) {
    if (!this.canLoadSymbols()) return null;

    const editor = this.editor;
    const registry = this.registry;
    if (
      !force &&
      this.symbolRefresh?.editor === editor &&
      this.symbolRefresh?.registry === registry
    ) {
      return this.symbolRefresh.promise;
    }

    const generation = ++this.generation;
    const request = { editor, registry, promise: null };
    const load = async () => {
      let tree;
      try {
        tree = await registry.getFileSymbolTree(editor);
      } catch (error) {
        if (generation === this.generation) {
          console.error("breadcrumbs: failed to load symbols", error);
          this.recordNullSymbolResult();
        }
        return null;
      }
      if (
        generation !== this.generation ||
        editor !== this.editor ||
        registry !== this.registry ||
        !this.canLoadSymbols()
      ) {
        return tree;
      }

      if (tree === null) {
        this.recordNullSymbolResult();
      } else {
        this.resetSymbolRetry();
        this.symbolTree = tree;
      }
      this.render();
      return tree;
    };

    request.promise = load().finally(() => {
      if (this.symbolRefresh !== request) return;
      this.symbolRefresh = null;
      if (this.retrySymbolsAfterRefresh && this.symbolTree === null) {
        this.retrySymbolsAfterRefresh = false;
        this.retrySymbolsForCursor();
      }
    });
    this.symbolRefresh = request;
    return request.promise;
  }

  retrySymbolsForCursor() {
    if (!this.canLoadSymbols() || this.symbolTree !== null) return;
    if (this.cursorNullRetriesRemaining <= 0) return;
    if (this.symbolRefresh) {
      this.retrySymbolsAfterRefresh = true;
      return;
    }
    this.cursorNullRetriesRemaining--;
    this.refreshSymbols();
  }

  recordNullSymbolResult() {
    // A null result is deliberately not cached here. The shared registry
    // owns negative caching; the next cursor request remains able to recover
    // when a provider becomes ready without creating a background retry loop.
  }

  invalidateSymbols() {
    if (!this.canLoadSymbols()) return Promise.resolve(null);
    this.generation++;
    this.symbolRefresh = null;
    this.resetSymbolRetry();
    return this.refreshSymbols({ force: true });
  }

  resetSymbolRetry() {
    this.retrySymbolsAfterRefresh = false;
    this.cursorNullRetriesRemaining = 1;
  }

  resetSymbolSource() {
    this.generation++;
    this.symbolRefresh = null;
    this.resetSymbolRetry();
  }

  fileSegments() {
    if (!this.item || this.config?.filePath === "off") return EMPTY_SEGMENTS;
    if (!this.cachedFileSegments) {
      this.cachedFileSegments = PathSegments.forItem(this.item, {
        hideSingleProjectRoot: this.config?.hideSingleProjectRoot !== false,
        titleFallback: true,
      });
      this.cachedLastFileSegments = this.cachedFileSegments.slice(-1);
    }
    return this.config?.filePath === "last" ? this.cachedLastFileSegments : this.cachedFileSegments;
  }

  clearFileSegmentCache() {
    this.cachedFileSegments = null;
    this.cachedLastFileSegments = null;
  }

  canShowForItem() {
    if (this.item?.getPath?.()) return true;
    if (this.editor) return this.config?.showUnsavedEditors !== false;
    return this.config?.onlyWithPath === false;
  }

  symbolSegments() {
    if (!this.editor || this.config?.symbolPath === "off" || !this.symbolTree) {
      return EMPTY_SEGMENTS;
    }
    const position = this.editor.getLastCursor().getBufferPosition();
    return this.config?.symbolPath === "last"
      ? SymbolPath.lastForPosition(this.symbolTree, position)
      : SymbolPath.forPosition(this.symbolTree, position);
  }

  render() {
    if (this.config?.enabled === false || !this.item || !this.canShowForItem()) {
      this.element.hidden = true;
      this.clearRenderedContent();
      this.cancelScroll();
      return;
    }

    const files = this.fileSegments();
    const symbols = this.symbolSegments();
    const icons = this.config?.icons !== false;
    let contentChanged = false;

    const fileOptions = { icons, treeView: this.treeView };
    if (
      !this.renderedFileOptions ||
      this.renderedFileOptions.icons !== fileOptions.icons ||
      this.renderedFileOptions.treeView !== fileOptions.treeView ||
      !sameItems(this.renderedFiles, files, sameFileSegment)
    ) {
      this.renderFiles(files);
      this.renderedFiles = files;
      this.renderedFileOptions = fileOptions;
      contentChanged = true;
    }

    const symbolOptions = { icons, hasFiles: files.length > 0 };
    if (
      !this.renderedSymbolOptions ||
      this.renderedSymbolOptions.icons !== symbolOptions.icons ||
      this.renderedSymbolOptions.hasFiles !== symbolOptions.hasFiles ||
      !sameItems(this.renderedSymbols, symbols, (left, right) => left === right)
    ) {
      this.renderSymbols(symbols, symbolOptions.hasFiles);
      this.renderedSymbols = symbols;
      this.renderedSymbolOptions = symbolOptions;
      contentChanged = true;
    }

    this.element.hidden = false;
    if (files.length === 0 && symbols.length === 0) this.cancelScroll();
    else if (contentChanged) this.scheduleScrollToEnd();
  }

  renderFiles(files) {
    this.fileDisposables.dispose();
    this.fileDisposables = new CompositeDisposable();
    const fragment = document.createDocumentFragment();
    this.appendSegments(
      fragment,
      files,
      (segment) => this.createPathCrumb(segment, this.fileDisposables),
      false,
    );
    this.fileContent.replaceChildren(fragment);
  }

  renderSymbols(symbols, hasFiles) {
    this.symbolDisposables.dispose();
    this.symbolDisposables = new CompositeDisposable();
    const fragment = document.createDocumentFragment();
    this.appendSegments(
      fragment,
      symbols,
      (symbol) => this.createSymbolCrumb(symbol, this.symbolDisposables),
      hasFiles,
    );
    this.symbolContent.replaceChildren(fragment);
  }

  clearRenderedContent() {
    if (
      this.renderedFiles === null &&
      this.renderedSymbols === null &&
      this.fileContent.childNodes.length === 0 &&
      this.symbolContent.childNodes.length === 0
    ) {
      return;
    }
    this.fileDisposables.dispose();
    this.symbolDisposables.dispose();
    this.fileDisposables = new CompositeDisposable();
    this.symbolDisposables = new CompositeDisposable();
    this.fileContent.replaceChildren();
    this.symbolContent.replaceChildren();
    this.invalidateRenderedModels();
  }

  invalidateRenderedModels() {
    this.renderedFiles = null;
    this.renderedFileOptions = null;
    this.renderedSymbols = null;
    this.renderedSymbolOptions = null;
  }

  appendSegments(container, items, create, needsLeadingSeparator = false) {
    items.forEach((item, index) => {
      if (needsLeadingSeparator || index > 0) container.appendChild(this.createSeparator());
      container.appendChild(create(item));
      needsLeadingSeparator = false;
    });
  }

  createSeparator() {
    const separator = document.createElement("span");
    separator.className = "breadcrumbs-separator icon-chevron-right";
    separator.setAttribute("aria-hidden", "true");
    return separator;
  }

  createPathCrumb(segment, disposables) {
    const clickable = segment.project && segment.path && this.treeView?.revealPath;
    const element = document.createElement(clickable ? "button" : "span");
    element.className = "breadcrumbs-crumb breadcrumbs-path";
    if (clickable) {
      element.type = "button";
      element.addEventListener("click", () => this.revealPath(segment.path));
    }
    const iconTarget = segment.path
      ? {
          path: segment.path,
          context: "breadcrumbs",
          hints: { directory: segment.directory },
        }
      : { name: segment.iconName, context: "breadcrumbs" };
    this.appendIcon(element, iconTarget, disposables);
    this.appendLabel(element, segment.label);
    return element;
  }

  createSymbolCrumb(symbol, disposables) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "breadcrumbs-crumb breadcrumbs-symbol";
    element.addEventListener("click", () => this.revealSymbol(symbol));
    this.appendIcon(element, iconTargetForSymbol(symbol), disposables);
    this.appendLabel(element, symbol.name);
    return element;
  }

  appendIcon(element, target, disposables) {
    if (this.config?.icons === false || (!target.path && !target.kind && !target.name)) return;
    const icon = document.createElement("span");
    icon.className = "breadcrumbs-icon";
    element.appendChild(icon);
    disposables.add(lumine.icons.applyTo(icon, target, { setData: false }));
  }

  appendLabel(element, label) {
    const text = document.createElement("span");
    text.className = "breadcrumbs-label";
    text.textContent = label;
    element.appendChild(text);
  }

  revealSymbol(symbol) {
    if (!this.editor || !symbol?.position) return;
    this.editor.setCursorBufferPosition(symbol.position, { autoscroll: false });
    this.editor.scrollToCursorPosition({
      zone: lumine.config.get("breadcrumbs.scrollZone"),
    });
    lumine.views.getView(this.editor)?.focus();
  }

  revealPath(filePath) {
    let result;
    try {
      result = this.treeView?.revealPath?.(filePath, { show: true });
    } catch (error) {
      this.warnRevealFailure(filePath, error);
      return Promise.resolve();
    }
    return Promise.resolve(result).catch((error) => this.warnRevealFailure(filePath, error));
  }

  warnRevealFailure(filePath, error) {
    const reason = error instanceof Error ? error.message : String(error ?? "unknown error");
    console.warn(`breadcrumbs: could not reveal ${filePath}: ${reason}`);
  }

  scheduleScrollToEnd() {
    if (this.scrollFrame !== null) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = null;
      if (this.element.isConnected && !this.element.hidden) {
        this.element.scrollLeft = this.element.scrollWidth;
      }
    });
  }

  cancelScroll() {
    if (this.scrollFrame === null) return;
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resetSymbolSource();
    this.cancelScroll();
    this.itemSubscriptions?.dispose();
    this.itemSubscriptions = null;
    this.fileDisposables.dispose();
    this.symbolDisposables.dispose();
    this.subscriptions.dispose();
    this.element.remove();
    this.item = null;
    this.editor = null;
    this.registry = null;
    this.treeView = null;
    this.pane = null;
  }
};
