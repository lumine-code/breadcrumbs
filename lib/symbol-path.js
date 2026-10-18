const indexes = new WeakMap();
const EMPTY_PATH = Object.freeze([]);
const BEFORE_ALL = [-Infinity, -Infinity];
const AFTER_ALL = [Infinity, Infinity];

function comparePoints(left, right) {
  return (
    (left.row ?? left[0]) - (right.row ?? right[0]) ||
    (left.column ?? left[1]) - (right.column ?? right[1])
  );
}

function minimum(left, right) {
  if (!left) return right;
  if (!right) return left;
  return comparePoints(left, right) <= 0 ? left : right;
}

function maximum(left, right) {
  if (!left) return right;
  if (!right) return left;
  return comparePoints(left, right) >= 0 ? left : right;
}

// Keep coordinate objects: the registry's monotone edit translations preserve
// these extrema while consumers retain a generation during its replacement.
exports.prepare = async function prepare(
  tree,
  { signal, yieldTask = () => new Promise((resolve) => setImmediate(resolve)) } = {},
) {
  signal?.throwIfAborted();
  if (!tree || indexes.has(tree)) return;
  let operations = 0;
  let deadline = performance.now() + 4;
  const shouldYield = () =>
    ++operations % 64 === 0 && (operations >= 1024 || performance.now() >= deadline);
  const yieldWork = async () => {
    await yieldTask();
    signal?.throwIfAborted();
    operations = 0;
    deadline = performance.now() + 4;
  };
  const entries = [];
  const active = new WeakSet();
  const stack = [{ iterator: tree[Symbol.iterator](), parent: null }];
  while (stack.length) {
    if (shouldYield()) await yieldWork();
    const frame = stack.at(-1);
    const next = frame.iterator.next();
    if (next.done) {
      stack.pop();
      if (frame.parent) active.delete(frame.parent.node);
      continue;
    }
    const node = next.value;
    if (active.has(node)) continue;
    const parent = frame.parent;
    const range = node.range;
    const canContain =
      (!parent || parent.canContain) &&
      range?.isEmpty?.() !== true &&
      typeof range?.containsPoint === "function";
    const start = canContain ? maximum(parent?.start, range.start ?? BEFORE_ALL) : null;
    const entry = {
      node,
      parent,
      depth: (parent?.depth ?? 0) + 1,
      canContain,
      start,
      startRange: start && start === parent?.start ? parent.startRange : range,
      end: canContain ? minimum(parent?.end, range.end ?? AFTER_ALL) : null,
    };
    entries.push(entry);
    active.add(node);
    stack.push({ iterator: (node.children ?? [])[Symbol.iterator](), parent: entry });
  }

  let base = 1;
  while (base < entries.length) base *= 2;
  const positions = new Array(base * 2);
  const starts = new Array(base * 2);
  const startRanges = new Array(base * 2);
  const ends = new Array(base * 2);
  const depths = new Uint32Array(base * 2);
  for (let index = 0; index < entries.length; index++) {
    if (shouldYield()) await yieldWork();
    const entry = entries[index];
    const slot = base + index;
    positions[slot] = entry.node.position;
    if (entry.canContain) {
      starts[slot] = entry.start;
      startRanges[slot] = entry.startRange;
      ends[slot] = entry.end;
      depths[slot] = entry.depth;
    }
  }
  for (let slot = base - 1; slot > 0; slot--) {
    if (shouldYield()) await yieldWork();
    const left = slot * 2;
    const right = left + 1;
    positions[slot] = minimum(positions[left], positions[right]);
    starts[slot] = minimum(starts[left], starts[right]);
    startRanges[slot] = starts[slot] === starts[left] ? startRanges[left] : startRanges[right];
    ends[slot] = maximum(ends[left], ends[right]);
    depths[slot] = Math.max(depths[left], depths[right]);
  }
  signal?.throwIfAborted();
  indexes.set(tree, { entries, base, positions, starts, startRanges, ends, depths });
};

exports.isPrepared = (tree) => Boolean(tree && indexes.has(tree));

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

function contains(entry, position, contained) {
  const path = [];
  while (entry && !contained.has(entry)) {
    path.push(entry);
    entry = entry.parent;
  }
  let result = entry ? contained.get(entry) : true;
  while (path.length) {
    const current = path.pop();
    const range = current.node.range;
    result = result && !range.isEmpty?.() && range.containsPoint(position);
    contained.set(current, result);
  }
  return result;
}

function containingEntry(index, position) {
  const { entries, base, starts, startRanges, ends, depths } = index;
  let best = null;
  let bestOrdinal = Infinity;
  const contained = new Map();
  const stack = [1, 0, base];
  while (stack.length) {
    const width = stack.pop();
    const first = stack.pop();
    const slot = stack.pop();
    if (
      !depths[slot] ||
      depths[slot] < (best?.depth ?? 0) ||
      (depths[slot] === best?.depth && first >= bestOrdinal) ||
      // A deleted range becomes point-only and subsequently follows inserts
      // with right affinity. Its old minimum can move past a surviving range;
      // retain a conservative bound until the replacement index is ready.
      (startRanges[slot]?.isEmpty?.() !== true && comparePoints(starts[slot], position) > 0) ||
      comparePoints(ends[slot], position) < 0
    ) {
      continue;
    }
    if (slot >= base) {
      const ordinal = slot - base;
      const entry = entries[ordinal];
      if (
        (entry.depth > (best?.depth ?? 0) || ordinal < bestOrdinal) &&
        contains(entry, position, contained)
      ) {
        best = entry;
        bestOrdinal = ordinal;
      }
      continue;
    }
    const left = slot * 2;
    const right = left + 1;
    const half = width / 2;
    // Deeper candidates first; equal-depth overlaps retain depth-first order.
    if (depths[right] > depths[left]) stack.push(left, first, half, right, first + half, half);
    else stack.push(right, first + half, half, left, first, half);
  }
  return best;
}

function nearestEntry(index, position) {
  const { entries, base, positions } = index;
  let slot = 1;
  if (!positions[slot] || comparePoints(positions[slot], position) > 0) return null;
  while (slot < base) {
    const right = slot * 2 + 1;
    slot = positions[right] && comparePoints(positions[right], position) <= 0 ? right : right - 1;
  }
  return entries[slot - base];
}

function entryForPosition(tree, position) {
  const index = tree && indexes.get(tree);
  return index ? (containingEntry(index, position) ?? nearestEntry(index, position)) : null;
}

exports.forPosition = (tree, position) => pathFor(entryForPosition(tree, position));
exports.lastForPosition = (tree, position) => lastPathFor(entryForPosition(tree, position));
