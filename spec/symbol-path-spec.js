const { Point, Range } = require("lumine");
const SymbolPath = require("../lib/symbol-path");

const symbol = (name, start, end, children = []) => ({
  name,
  position: new Point(...start),
  range: new Range(start, end),
  children,
});

describe("breadcrumbs symbol path", () => {
  it("returns the deepest containing hierarchy", async () => {
    const tree = [
      symbol(
        "Outer",
        [0, 0],
        [20, 0],
        [symbol("middle", [2, 0], [10, 0], [symbol("inner", [4, 0], [6, 0])])],
      ),
    ];

    await SymbolPath.prepare(tree);
    expect(SymbolPath.forPosition(tree, new Point(5, 0)).map(({ name }) => name)).toEqual([
      "Outer",
      "middle",
      "inner",
    ]);
    expect(SymbolPath.forPosition(tree, new Point(15, 0)).map(({ name }) => name)).toEqual([
      "Outer",
    ]);
    const delayed = [symbol("Later", [2, 0], [4, 0])];
    await SymbolPath.prepare(delayed);
    expect(SymbolPath.forPosition(delayed, new Point(0, 0))).toEqual([]);
  });

  it("falls back to the nearest preceding point symbol", async () => {
    const point = (name, row, children = []) => ({
      name,
      position: new Point(row, 0),
      range: new Range([row, 0], [row, 0]),
      children,
    });
    const tree = [point("first", 1, [point("child", 3)]), point("second", 8)];
    await SymbolPath.prepare(tree);

    expect(SymbolPath.forPosition(tree, new Point(5, 0)).map(({ name }) => name)).toEqual([
      "first",
      "child",
    ]);
    expect(SymbolPath.forPosition(tree, new Point(9, 0)).map(({ name }) => name)).toEqual([
      "second",
    ]);
    expect(SymbolPath.forPosition(tree, new Point(0, 0))).toEqual([]);
  });

  it("keeps a completed range current until the next symbol begins", async () => {
    const tree = [symbol("doc", [2, 0], [2, 3]), symbol("next", [8, 0], [8, 4])];
    await SymbolPath.prepare(tree);
    expect(SymbolPath.forPosition(tree, new Point(0, 0))).toEqual([]);
    expect(SymbolPath.forPosition(tree, new Point(5, 0)).map(({ name }) => name)).toEqual(["doc"]);
    expect(SymbolPath.forPosition(tree, new Point(9, 0)).map(({ name }) => name)).toEqual(["next"]);
  });

  it("checks a deeply nested containing hierarchy only once per level", async () => {
    let rangeChecks = 0;
    let children = [];
    for (let depth = 999; depth >= 0; depth--) {
      children = [
        {
          name: `level-${depth}`,
          position: new Point(depth, 0),
          range: {
            isEmpty: () => false,
            containsPoint: () => {
              rangeChecks++;
              return true;
            },
          },
          children,
        },
      ];
    }

    await SymbolPath.prepare(children);
    expect(SymbolPath.forPosition(children, new Point(999, 0)).length).toBe(1000);
    expect(rangeChecks).toBe(1000);
  });

  it("reuses full and last paths for the same active symbol", async () => {
    const tree = [symbol("outer", [0, 0], [10, 0], [symbol("inner", [2, 0], [8, 0])])];
    const position = new Point(4, 0);
    await SymbolPath.prepare(tree);

    expect(SymbolPath.forPosition(tree, position)).toBe(SymbolPath.forPosition(tree, position));
    expect(SymbolPath.lastForPosition(tree, position)).toBe(
      SymbolPath.lastForPosition(tree, position),
    );
  });

  it("skips containment walks for point-only trees", async () => {
    let rangeChecks = 0;
    const tree = Array.from({ length: 2048 }, (_, row) => ({
      name: `point-${row}`,
      position: new Point(row, 0),
      range: {
        isEmpty() {
          rangeChecks++;
          return true;
        },
      },
      children: [],
    }));

    await SymbolPath.prepare(tree);
    SymbolPath.forPosition(tree, new Point(1024, 0));
    const indexingChecks = rangeChecks;
    for (let index = 0; index < 100; index++) {
      SymbolPath.forPosition(tree, new Point(1024 + (index % 2), 0));
    }

    expect(indexingChecks).toBe(tree.length);
    expect(rangeChecks).toBe(indexingChecks);
  });

  it("preserves deepest containment, overlapping sibling order and inclusive boundaries", async () => {
    const first = symbol("first", [2, 0], [8, 0]);
    const second = symbol("second", [5, 0], [12, 0]);
    const tree = [symbol("outer", [0, 0], [20, 0], [first, second])];
    await SymbolPath.prepare(tree);
    expect(SymbolPath.lastForPosition(tree, new Point(6, 0))[0]).toBe(first);
    expect(SymbolPath.lastForPosition(tree, new Point(8, 0))[0]).toBe(first);
    expect(SymbolPath.lastForPosition(tree, new Point(9, 0))[0]).toBe(second);

    const deeper = symbol("deep", [5, 0], [7, 0]);
    const overlapping = [
      ...tree,
      symbol("other", [0, 0], [30, 0], [symbol("middle", [2, 0], [15, 0], [deeper])]),
    ];
    await SymbolPath.prepare(overlapping);
    expect(SymbolPath.forPosition(overlapping, new Point(6, 0)).map(({ name }) => name)).toEqual([
      "other",
      "middle",
      "deep",
    ]);
  });

  it("requires every ancestor to contain the position and skips cycles", async () => {
    const child = symbol("outside its parent", [5, 0], [9, 0]);
    const parent = symbol("parent", [0, 0], [3, 0], [child]);
    child.children.push(parent);
    const containing = symbol("containing", [0, 0], [20, 0]);
    const tree = [parent, containing];
    await SymbolPath.prepare(tree);
    expect(SymbolPath.forPosition(tree, new Point(6, 0))).toEqual([containing]);
  });

  it("uses the last preceding depth-first entry when navigation positions are unsorted", async () => {
    const tree = [
      symbol("late", [10, 0], [10, 0]),
      symbol("early", [2, 0], [2, 0], [symbol("child", [8, 0], [8, 0])]),
      symbol("last", [2, 0], [2, 0]),
    ];
    await SymbolPath.prepare(tree);
    expect(SymbolPath.forPosition(tree, new Point(9, 0)).map(({ name }) => name)).toEqual(["last"]);
    expect(SymbolPath.forPosition(tree, new Point(1, 0))).toEqual([]);
  });

  it("follows translated coordinate objects and rejects ranges collapsed by edits", async () => {
    const child = symbol("child", [2, 0], [8, 0]);
    const parent = symbol("parent", [0, 0], [10, 0], [child]);
    const other = symbol("other", [0, 0], [20, 0]);
    const tree = [parent, other];
    await SymbolPath.prepare(tree);
    for (const node of [parent, child, other]) {
      node.position.row += 10;
      node.range.start.row += 10;
      node.range.end.row += 10;
    }
    expect(SymbolPath.forPosition(tree, new Point(15, 0))).toEqual([parent, child]);
    parent.range.start.row = 15;
    parent.range.end.row = 15;
    expect(SymbolPath.forPosition(tree, new Point(15, 0))).toEqual([other]);
  });

  it("keeps bounds conservative when deleted ranges follow a later boundary insertion", async () => {
    const deleted = symbol("deleted", [0, 0], [1, 0]);
    const surviving = symbol("surviving", [1, 0], [5, 0]);
    const tree = [deleted, surviving];
    await SymbolPath.prepare(tree);
    // Deleting the first line collapses its range and moves the next start to
    // the same boundary. A later insert moves only the point-only start right.
    deleted.range.end.row = 0;
    surviving.position.row = 0;
    surviving.range.start.row = 0;
    surviving.range.end.row = 4;
    deleted.position.row = 2;
    deleted.range.start.row = 2;
    deleted.range.end.row = 2;
    surviving.position.row = 2;
    surviving.range.end.row = 6;
    expect(SymbolPath.forPosition(tree, new Point(1, 0))).toEqual([surviving]);
  });

  it("bounds preparation, cancels obsolete work and publishes only completed indexes", async () => {
    const tree = Array.from({ length: 8192 }, (_, row) =>
      symbol(`item-${row}`, [row, 0], [row, 1]),
    );
    const controller = new AbortController();
    let yields = 0;
    expect(SymbolPath.forPosition(tree, new Point(4096, 0))).toEqual([]);
    await expectAsync(
      SymbolPath.prepare(tree, {
        signal: controller.signal,
        yieldTask: async () => {
          yields++;
          controller.abort();
        },
      }),
    ).toBeRejected();
    expect(yields).toBe(1);
    expect(SymbolPath.isPrepared(tree)).toBe(false);
    await SymbolPath.prepare(tree, { yieldTask: async () => yields++ });
    expect(yields).toBeGreaterThan(10);
    expect(SymbolPath.isPrepared(tree)).toBe(true);
    expect(SymbolPath.lastForPosition(tree, new Point(4096, 0))[0]).toBe(tree[4096]);
  });

  it("prunes large ranged trees and equal-depth overlaps instead of walking every symbol", async () => {
    let checks = 0;
    const tree = Array.from({ length: 8192 }, (_, row) => {
      const node = symbol(`item-${row}`, [row, 0], [row, 1]);
      const contains = node.range.containsPoint.bind(node.range);
      node.range.containsPoint = (position) => {
        checks++;
        return contains(position);
      };
      return node;
    });
    await SymbolPath.prepare(tree);
    expect(SymbolPath.lastForPosition(tree, new Point(4096, 0))[0]).toBe(tree[4096]);
    expect(checks).toBe(1);
    for (const node of tree) {
      node.range.start.row = 0;
      node.range.end.row = 10000;
    }
    expect(SymbolPath.lastForPosition(tree, new Point(4096, 0))[0]).toBe(tree[0]);
    expect(checks).toBe(2);
  });
});
