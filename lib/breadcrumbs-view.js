const { CompositeDisposable } = require("lumine");
const PathSegments = require("./path-segments");
const SymbolPath = require("./symbol-path");

function iconTargetForSymbol(symbol) {
  const explicit = symbol.icon;
  if (explicit?.startsWith("type-")) {
    return { kind: explicit.slice("type-".length), context: "breadcrumbs" };
  }
  const kind = symbol.tag ?? symbol.kind;
  return kind ? { kind, context: "breadcrumbs" } : { name: "code", context: "breadcrumbs" };
}

module.exports = class BreadcrumbsView {
  constructor(pane, { config, registry, treeView }) {
    this.pane = pane;
    this.config = config;
    this.registry = registry;
    this.treeView = treeView;
    this.editor = null;
    this.symbolTree = null;
    this.generation = 0;
    this.editorSubscriptions = null;
    this.iconDisposables = new CompositeDisposable();
    this.tooltipDisposables = new CompositeDisposable();
    this.subscriptions = new CompositeDisposable();

    this.element = document.createElement("div");
    this.element.className = "breadcrumbs";
    this.element.setAttribute("role", "navigation");
    this.element.setAttribute("aria-label", "Breadcrumbs");
    this.content = document.createElement("div");
    this.content.className = "breadcrumbs-content";
    this.element.appendChild(this.content);

    this.subscriptions.add(pane.observeActiveItem((item) => this.setItem(item)));
  }

  setItem(item) {
    const editor = lumine.workspace.isTextEditor(item) ? item : null;
    if (editor === this.editor) return;
    this.generation++;
    this.editorSubscriptions?.dispose();
    this.editorSubscriptions = null;
    this.editor = editor;
    this.symbolTree = null;

    if (editor) {
      this.editorSubscriptions = new CompositeDisposable(
        editor.onDidChangePath(() => this.render()),
        editor.onDidChangeCursorPosition(({ cursor }) => {
          if (cursor === editor.getLastCursor()) this.render();
        }),
      );
      const cached = this.registry?.peekFileSymbolTree?.(editor);
      if (cached) this.symbolTree = cached;
      this.refreshSymbols();
    }
    this.render();
  }

  setConfig(config) {
    const wasEnabled = this.config?.enabled !== false;
    this.config = config;
    this.render();
    if (!wasEnabled && config?.enabled !== false) this.refreshSymbols();
  }

  setRegistry(registry) {
    this.registry = registry;
    this.symbolTree = registry?.peekFileSymbolTree?.(this.editor) ?? null;
    this.render();
    this.refreshSymbols();
  }

  setTreeView(treeView) {
    this.treeView = treeView;
    this.render();
  }

  async refreshSymbols() {
    const editor = this.editor;
    const registry = this.registry;
    if (!editor || !registry || this.config?.enabled === false) return;
    const generation = ++this.generation;
    let tree;
    try {
      tree = await registry.getFileSymbolTree(editor);
    } catch (error) {
      if (generation === this.generation) {
        console.error("breadcrumbs: failed to load symbols", error);
      }
      return;
    }
    if (generation !== this.generation || editor !== this.editor || registry !== this.registry)
      return;
    if (tree !== null) this.symbolTree = tree;
    this.render();
  }

  fileSegments() {
    if (!this.editor || this.config?.filePath === "off") return [];
    const segments = PathSegments.forEditor(this.editor);
    return this.config?.filePath === "last" ? segments.slice(-1) : segments;
  }

  symbolSegments() {
    if (!this.editor || this.config?.symbolPath === "off" || !this.symbolTree) return [];
    const position = this.editor.getLastCursor().getBufferPosition();
    const symbols = SymbolPath.forPosition(this.symbolTree, position);
    return this.config?.symbolPath === "last" ? symbols.slice(-1) : symbols;
  }

  render() {
    this.iconDisposables.dispose();
    this.iconDisposables = new CompositeDisposable();
    this.tooltipDisposables.dispose();
    this.tooltipDisposables = new CompositeDisposable();
    this.content.replaceChildren();

    if (this.config?.enabled === false || !this.editor) {
      this.element.hidden = true;
      return;
    }

    const files = this.fileSegments();
    const symbols = this.symbolSegments();
    this.appendSegments(files, (segment) => this.createPathCrumb(segment));
    this.appendSegments(symbols, (symbol) => this.createSymbolCrumb(symbol), files.length > 0);
    this.element.hidden = files.length === 0 && symbols.length === 0;
    this.scheduleScrollToEnd();
  }

  appendSegments(items, create, needsLeadingSeparator = false) {
    items.forEach((item, index) => {
      if (needsLeadingSeparator || index > 0) this.content.appendChild(this.createSeparator());
      this.content.appendChild(create(item));
      needsLeadingSeparator = false;
    });
  }

  createSeparator() {
    const separator = document.createElement("span");
    separator.className = "breadcrumbs-separator icon-chevron-right";
    separator.setAttribute("aria-hidden", "true");
    return separator;
  }

  createPathCrumb(segment) {
    const clickable = segment.project && segment.path && this.treeView?.revealPath;
    const element = document.createElement(clickable ? "button" : "span");
    element.className = "breadcrumbs-crumb breadcrumbs-path";
    if (clickable) {
      element.type = "button";
      this.appendTooltip(element, `Reveal ${segment.path} in the tree view`);
      element.addEventListener("click", () => this.revealPath(segment.path));
    } else if (segment.path) {
      this.appendTooltip(element, segment.path);
    }
    this.appendIcon(element, {
      path: segment.path,
      context: "breadcrumbs",
      hints: { directory: segment.directory },
    });
    this.appendLabel(element, segment.label);
    return element;
  }

  createSymbolCrumb(symbol) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = "breadcrumbs-crumb breadcrumbs-symbol";
    const kind = symbol.tag ?? symbol.kind;
    this.appendTooltip(element, kind ? `${symbol.name} (${kind})` : symbol.name);
    element.addEventListener("click", () => this.revealSymbol(symbol));
    const explicit = symbol.icon;
    if (this.config?.icons !== false && explicit && !explicit.startsWith("type-")) {
      const icon = document.createElement("span");
      const iconClass = explicit.startsWith("icon-") ? explicit : `icon-${explicit}`;
      icon.className = `breadcrumbs-icon icon ${iconClass}`;
      element.appendChild(icon);
    } else {
      this.appendIcon(element, iconTargetForSymbol(symbol));
    }
    this.appendLabel(element, symbol.name);
    return element;
  }

  appendIcon(element, target) {
    if (this.config?.icons === false || (!target.path && !target.kind && !target.name)) return;
    const icon = document.createElement("span");
    icon.className = "breadcrumbs-icon";
    element.appendChild(icon);
    this.iconDisposables.add(lumine.icons.applyTo(icon, target, { setData: false }));
  }

  appendLabel(element, label) {
    const text = document.createElement("span");
    text.className = "breadcrumbs-label";
    text.textContent = label;
    element.appendChild(text);
  }

  appendTooltip(element, title) {
    this.tooltipDisposables.add(lumine.tooltips.add(element, { title }));
  }

  revealSymbol(symbol) {
    if (!this.editor || !symbol?.position) return;
    this.editor.setCursorBufferPosition(symbol.position, { autoscroll: false });
    this.editor.scrollToCursorPosition({ center: true });
    lumine.views.getView(this.editor)?.focus();
  }

  revealPath(filePath) {
    Promise.resolve(this.treeView?.revealPath?.(filePath, { show: true })).catch((error) => {
      console.warn(`breadcrumbs: could not reveal ${filePath}: ${error.message}`);
    });
  }

  scheduleScrollToEnd() {
    const content = this.content;
    requestAnimationFrame(() => {
      if (this.content === content && this.element.isConnected) {
        this.element.scrollLeft = this.element.scrollWidth;
      }
    });
  }

  destroy() {
    this.generation++;
    this.editorSubscriptions?.dispose();
    this.editorSubscriptions = null;
    this.iconDisposables.dispose();
    this.tooltipDisposables.dispose();
    this.subscriptions.dispose();
    this.element.remove();
    this.editor = null;
    this.registry = null;
    this.treeView = null;
  }
};
