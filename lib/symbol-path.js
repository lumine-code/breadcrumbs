const indexes = new WeakMap();
const EMPTY_PATH = Object.freeze([]);

function pointCoordinates(point) {
  return Array.isArray(point) ? point : [point?.row ?? 0, point?.column ?? 0];
}

function comparePoints(left, right) {
  if (left?.compare) return left.compare(right);
  const [leftRow, leftColumn] = pointCoordinates(left);
  const [rightRow, rightColumn] = pointCoordinates(right);
  return leftRow - rightRow || leftColumn - rightColumn;
}

function createIndex(tree) {
  const entries = [];
  const entriesByNode = new WeakMap();
  let positionsAreSorted = true;
  let hasNonEmptyRanges = false;
  let previousPosition = null;

  const active = new WeakSet();
  const stack = [{ iterator: (tree ?? [])[Symbol.iterator](), parent: null }];
  while (stack.length > 0) {
    const frame = stack.at(-1);
    const next = frame.iterator.next();
    if (next.done) {
      stack.pop();
      if (frame.parent) active.delete(frame.parent.node);
      continue;
    }
    const node = next.value;
    if (active.has(node)) continue;
    const entry = { node, parent: frame.parent, depth: (frame.parent?.depth ?? 0) + 1 };
    if (previousPosition && comparePoints(previousPosition, node.position) > 0) {
      positionsAreSorted = false;
    }
    previousPosition = node.position;
    entries.push(entry);
    entriesByNode.set(node, entry);
    if (node.range && node.range.isEmpty?.() !== true) hasNonEmptyRanges = true;
    active.add(node);
    stack.push({ iterator: (node.children ?? [])[Symbol.iterator](), parent: entry });
  }
  return { tree, entries, entriesByNode, positionsAreSorted, hasNonEmptyRanges };
}

function indexFor(tree) {
  if (!tree || (typeof tree !== "object" && typeof tree !== "function")) {
    return {
      tree: [],
      entries: [],
      entriesByNode: new WeakMap(),
      positionsAreSorted: true,
      hasNonEmptyRanges: false,
    };
  }
  let index = indexes.get(tree);
  if (!index) {
    index = createIndex(tree);
    indexes.set(tree, index);
  }
  return index;
}

function pathFor(entry) {
  if (!entry) return EMPTY_PATH;
  if (entry.path) return entry.path;
  const target = entry;
  const path = new Array(entry.depth);
  for (let index = entry.depth - 1; index >= 0; index--) {
    path[index] = entry.node;
    entry = entry.parent;
  }
  target.path = path;
  return target.path;
}

function lastPathFor(entry) {
  if (!entry) return EMPTY_PATH;
  entry.lastPath ??= [entry.node];
  return entry.lastPath;
}

function containingEntry(index, position) {
  let best = null;
  const contained = new Set();
  for (const entry of index.entries) {
    if (entry.parent && !contained.has(entry.parent)) continue;
    const { node } = entry;
    if (node.range?.isEmpty?.() || !node.range?.containsPoint?.(position)) continue;
    contained.add(entry);
    if (!best || entry.depth > best.depth) best = entry;
  }
  return best;
}

function nearestEntry(index, position) {
  const { entries, positionsAreSorted } = index;
  if (!positionsAreSorted) {
    for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex--) {
      if (comparePoints(entries[entryIndex].node.position, position) <= 0) {
        return entries[entryIndex];
      }
    }
    return null;
  }

  let low = 0;
  let high = entries.length - 1;
  let nearest = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (comparePoints(entries[middle].node.position, position) <= 0) {
      nearest = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return nearest === -1 ? null : entries[nearest];
}

function entryForPosition(tree, position) {
  const index = indexFor(tree);
  const contained = index.hasNonEmptyRanges ? containingEntry(index, position) : null;
  return contained ?? nearestEntry(index, position);
}

exports.forPosition = (tree, position) => pathFor(entryForPosition(tree, position));
exports.lastForPosition = (tree, position) => lastPathFor(entryForPosition(tree, position));
