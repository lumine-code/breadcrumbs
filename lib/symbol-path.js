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

function nearestPointPath(tree, position) {
  let best = [];
  const visit = (nodes, parents) => {
    for (const node of nodes ?? []) {
      const current = [...parents, node];
      if (node.range?.isEmpty?.() && comparePoints(node.position, position) <= 0) best = current;
      visit(node.children, current);
    }
  };
  visit(tree, []);
  return best;
}

exports.forPosition = (tree, position) => {
  const contained = containingPath(tree, position);
  return contained.length > 0 ? contained : nearestPointPath(tree, position);
};
