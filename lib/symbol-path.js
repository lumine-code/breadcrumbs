function comparePoints(left, right) {
  return left.compare ? left.compare(right) : left.row - right.row || left.column - right.column;
}

function containingPath(tree, position) {
  let best = [];
  const visit = (nodes, parents) => {
    for (const node of nodes ?? []) {
      if (node.range?.isEmpty?.() || !node.range?.containsPoint?.(position)) continue;
      const current = [...parents, node];
      if (current.length > best.length) best = current;
      visit(node.children, current);
    }
  };
  visit(tree, []);
  return best;
}

function nearestSymbolPath(tree, position) {
  let first = [];
  let best = [];
  const visit = (nodes, parents) => {
    for (const node of nodes ?? []) {
      const current = [...parents, node];
      if (first.length === 0) first = current;
      if (comparePoints(node.position, position) <= 0) best = current;
      visit(node.children, current);
    }
  };
  visit(tree, []);
  // Outside every structural range, treat symbols as document sections: the
  // last one that began remains current until another starts. Before the first
  // symbol, show that first entry so a non-empty outline never yields an empty
  // breadcrumb solely because a freshly opened editor starts at [0, 0].
  return best.length > 0 ? best : first;
}

exports.forPosition = (tree, position) => {
  const contained = containingPath(tree, position);
  return contained.length > 0 ? contained : nearestSymbolPath(tree, position);
};
